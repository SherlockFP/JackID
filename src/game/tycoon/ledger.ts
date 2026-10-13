/**
 * Upgrade Ledger (GAME-TYCOON, GDD §10.3): a leather ledger book that opens in front of the camera (3D, in the
 * first-person overlay). The left page is the summary (machine, owner, pit holdings, keys); the right page lists the
 * upgrades of this machine with level and price, four to a page. A/D turn the spread, W/S select, Enter or Space
 * (or a click on a row, twice) buys, M cycles ×1 / ×10 / MAX, Esc or U closes. It is a plain view over `TycoonApi`:
 * rows come from `upgradesFor`, purchases go through `buy`, and the book repaints on `onChange`.
 */
import * as THREE from 'three';
import { clamp, lerp } from '@/core/math';
import { fmtCoins, t } from '@/core/i18n';
import type { InstanceId } from '@/core/types';
import type { Pix } from '@/core/texgen/pixel';
import type { BuyMode, TycoonApi, UpgradeView } from '@/game/tycoon.types';
import { boxGeo, cue, dimVeil, ease, fit, PixSurface, Stage3D, txt, unlit, wrap } from './ui3d';

const MODES: readonly BuyMode[] = [1, 10, 'max'];

/** Upgrades per page; a spread is the summary + list page on the left and list pages on the right. */
const PER = 4;
/** Page canvas (low-res) and its size on the table, in metres. */
const PX_W = 112, PX_H = 150;
const PW = 0.15, PH = 0.2;
/** Book tilt (rotation about X): the pages face the eye and the spine stands upright in the middle. */
const TILT = 1.07;
const BOOK_REST = -0.12, BOOK_LOW = -0.42;
const LEATHER = 0x5a3320;
const PAPER = 0xe9dcb4, PAPER_EDGE = 0xb9a06e, INK = 0x2a1a0c, MUTED = 0x7a6446, ACCENT = 0x8a2a1a, HILITE = 0xd6bd82;

export interface LedgerOpts {
  /** Called once when the book closes (Esc / U / `close()`). */
  onClose?(): void;
  /** Optional toast sink (HUD feed). Receives refusal and milestone text. */
  toast?(text: string): void;
}
export interface LedgerHandle {
  close(): void;
  readonly instance: InstanceId;
}

/** A clickable rectangle on a painted page, in page-pixel coordinates. */
interface Hit2 { x: number; y: number; w: number; h: number; act(): void }

/** Localised refusal text for a `TycoonNoReason`. */
export function refusalText(reason: string | null | undefined): string {
  return t(`tyc.refuse.${reason ?? 'invalid'}`);
}

function modeLabel(m: BuyMode): string {
  return m === 'max' ? t('tyc.ledger.modeMax') : t('tyc.ledger.mode', { n: m });
}

/** Template strings hold i18n keys (`tyc.upg.<track>.name|desc`); `t()` resolves them in the current language. */
function trackName(v: UpgradeView): string {
  return t(v.def.template.strings.en.name);
}
function trackDesc(v: UpgradeView): string {
  return t(v.def.template.strings.en.desc);
}

/**
 * Mount the ledger for `instance` into `host` (the panel slot the caller created; it stays empty). Returns a handle;
 * `close()` plays the close beat, removes listeners and the 3D book. Safe to call again for another instance after
 * `close()`. If the host is removed by someone else, the book tears itself down without calling `onClose`.
 */
export function mountLedger(host: HTMLElement, api: TycoonApi, instance: InstanceId, opts: LedgerOpts = {}): LedgerHandle {
  let mode: BuyMode = 1;
  let sel = 0;
  let spread = 0;
  let closed = false;
  let turning = false;
  let rows: UpgradeView[] = [];
  let hitsL: Hit2[] = [];
  let hitsR: Hit2[] = [];

  const stage = new Stage3D();
  dimVeil(stage, 0.35);
  stage.own(api.onChange(() => render()));

  // ── the book: spine on the local Z axis, pages facing +Y, tilted up toward the eye ───────────────
  const book = new THREE.Group();
  book.position.set(0, BOOK_LOW, -0.5);
  book.rotation.x = 1.5;
  stage.add(book);

  const leather = unlit({ color: LEATHER, vertexColors: true });
  const board = new THREE.Mesh(boxGeo(2 * PW + 0.024, 0.006, PH + 0.024), leather);
  board.position.y = -0.003;
  book.add(board);
  const closedBlock = new THREE.Mesh(boxGeo(2 * PW + 0.02, 0.022, PH + 0.02), leather);
  closedBlock.position.y = 0.008;
  book.add(closedBlock);

  const pages = new THREE.Group();
  pages.visible = false;
  book.add(pages);
  const leftSurf = new PixSurface(PX_W, PX_H);
  const rightSurf = new PixSurface(PX_W, PX_H);
  const pageMesh = (s: PixSurface, x: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), unlit({ map: s.tex }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.003, 0);
    m.userData.pick = true;
    return m;
  };
  const leftMesh = pageMesh(leftSurf, -PW / 2);
  const rightMesh = pageMesh(rightSurf, PW / 2);
  pages.add(leftMesh, rightMesh);

  // the front cover flips over the spine to the left while the book opens
  const coverPivot = new THREE.Group();
  coverPivot.visible = false;
  const cover = new THREE.Mesh(boxGeo(PW + 0.01, 0.004, PH + 0.02), leather);
  cover.position.set(PW / 2 + 0.005, 0.014, 0);
  coverPivot.add(cover);
  book.add(coverPivot);

  // a turning leaf: `leafTop` is seen on the right before the turn, `leafUnder` on the left after it
  const leafPivot = new THREE.Group();
  leafPivot.position.set(0, 0.004, 0);
  leafPivot.visible = false;
  book.add(leafPivot);
  const leafTop = new PixSurface(PX_W, PX_H);
  const leafUnder = new PixSurface(PX_W, PX_H);
  const leafFront = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), unlit({ map: leafTop.tex, side: 'front' }));
  const leafBack = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), unlit({ map: leafUnder.tex, side: 'back' }));
  for (const m of [leafFront, leafBack]) {
    m.rotation.x = -Math.PI / 2;
    m.position.set(PW / 2, 0, 0);
    leafPivot.add(m);
  }
  stage.own(() => leftSurf.dispose());
  stage.own(() => rightSurf.dispose());
  stage.own(() => leafTop.dispose());
  stage.own(() => leafUnder.dispose());

  // ── spreads and rows ─────────────────────────────────────────────────────────────────────────────
  const pageCount = (): number => 1 + Math.ceil(rows.length / PER);
  const spreadCount = (): number => Math.ceil(pageCount() / 2);
  const spreadOf = (i: number): number => Math.floor((1 + Math.floor(i / PER)) / 2);
  /** Row indices shown by spread `s` (its left page 2s, right page 2s+1; page 0 is the summary). */
  const rangeOf = (s: number): [number, number] => [(Math.max(2 * s, 1) - 1) * PER, Math.min(rows.length, (2 * s + 1) * PER)];

  function paintSummary(p: Pix): void {
    txt(p, fit(t('tyc.ledger.title'), PX_W - 12), 6, 6, INK);
    txt(p, fit(String(instance), PX_W - 12, { micro: true }), 6, 17, MUTED, { micro: true });
    p.rect(6, 25, PX_W - 12, 1, PAPER_EDGE);
    const owned = api.owned(instance);
    if (owned) {
      txt(p, fit(t('tyc.ledger.owner', { who: owned.owner ? String(owned.owner) : '-' }), PX_W - 12, { micro: true }), 6, 30, INK, { micro: true });
    } else {
      wrap(t('tyc.ledger.notOwned'), PX_W - 12).forEach((ln, i) => txt(p, ln, 6, 30 + i * 7, INK, { micro: true }));
    }
    txt(p, fit(t('tyc.ledger.pit'), PX_W - 12, { micro: true }), 6, 52, MUTED, { micro: true });
    txt(p, fit(fmtCoins(api.holdings(), true), PX_W - 12), 6, 60, ACCENT);
    txt(p, fit(modeLabel(mode), PX_W - 12), 6, 80, INK);
    wrap(t('tyc.ledger.hint3d'), PX_W - 12).forEach((ln, i) => txt(p, ln, 6, 100 + i * 8, MUTED, { micro: true }));
  }

  function paintRows(p: Pix, page: number, hits: Hit2[] | null): void {
    txt(p, fit(t('tyc.ledger.title'), PX_W - 12, { micro: true }), 6, 5, MUTED, { micro: true });
    p.rect(6, 13, PX_W - 12, 1, PAPER_EDGE);
    const first = (page - 1) * PER;
    for (let i = 0; i < PER; i++) {
      const idx = first + i;
      const v = rows[idx];
      if (!v) break;
      const y0 = 18 + i * 30;
      const cur = idx === sel;
      if (cur) {
        p.rect(3, y0 - 3, PX_W - 6, 28, HILITE);
        txt(p, '>', 5, y0, ACCENT);
      }
      const swatch = v.def.template.color;
      if (swatch !== undefined) p.rect(12, y0 + 1, 3, 5, swatch);
      const max = v.def.maxLevel;
      txt(p, fit(trackName(v), PX_W - 56), 18, y0, INK);
      txt(p, t('tyc.ledger.level', { n: v.level, max }), PX_W - 5, y0 + 2, MUTED, { micro: true, align: 'right' });
      txt(p, fit(trackDesc(v), PX_W - 22, { micro: true }), 18, y0 + 8, MUTED, { micro: true });
      const next = v.next;
      const nextTxt = next ? t('tyc.ledger.next', { n: next.level, what: next.feature ?? next.visual ?? '' }) : t('tyc.ledger.nextNone');
      txt(p, fit(nextTxt, 46, { micro: true }), 18, y0 + 17, MUTED, { micro: true });
      const q = api.quote(v.def.id, mode);
      const maxed = v.level >= max;
      const priceTxt = maxed ? t('tyc.ledger.maxed') : `${t('tyc.ledger.buy')} ${fmtCoins(q.cost, true)}`;
      txt(p, fit(priceTxt, 56), PX_W - 5, y0 + 15, !maxed && q.affordable ? ACCENT : MUTED, { align: 'right' });
      if (hits) hits.push({ x: 2, y: y0 - 3, w: PX_W - 4, h: 28, act: () => rowAct(idx) });
    }
  }

  /** One page of the spread. `hits` is given only for the static pages (the turning leaves are not clickable). */
  function paintPage(p: Pix, page: number, side: 'L' | 'R', hits: Hit2[] | null): void {
    p.clear(PAPER);
    p.rect(side === 'L' ? PX_W - 4 : 0, 0, 4, PX_H, PAPER_EDGE);
    if (page === 0) paintSummary(p);
    else paintRows(p, page, hits);
    txt(p, t('tyc.ledger.pageOf', { n: page + 1, max: pageCount() }), PX_W / 2, PX_H - 9, MUTED, { micro: true, align: 'center' });
    if (!hits) return;
    if (side === 'L' && spread > 0) {
      txt(p, '<', 5, PX_H - 10, ACCENT, { micro: true });
      hits.push({ x: 0, y: PX_H - 16, w: 28, h: 16, act: () => turn(-1) });
    }
    if (side === 'R' && spread < spreadCount() - 1) {
      txt(p, '>', PX_W - 9, PX_H - 10, ACCENT, { micro: true });
      hits.push({ x: PX_W - 28, y: PX_H - 16, w: 28, h: 16, act: () => turn(1) });
    }
  }

  function repaintStatic(): void {
    const l = 2 * spread, r = 2 * spread + 1;
    leftSurf.paint((p) => { hitsL = []; paintPage(p, l, 'L', hitsL); });
    rightSurf.paint((p) => { hitsR = []; paintPage(p, r, 'R', hitsR); });
  }

  function render(): void {
    if (closed) return;
    rows = api.owned(instance) ? [...api.upgradesFor(instance)] : [];
    if (sel >= rows.length) sel = Math.max(0, rows.length - 1);
    spread = Math.min(spread, spreadCount() - 1);
    if (!turning) repaintStatic();
  }

  // ── actions ──────────────────────────────────────────────────────────────────────────────────────
  function buySelected(): void {
    const v = rows[sel];
    if (!v) return;
    const q = api.quote(v.def.id, mode);
    if (q.levels <= 0) { cue('hover', 0.3); opts.toast?.(refusalText(q.blocked)); return; }
    if (!api.buy(v.def.id, mode)) { cue('hover', 0.3); opts.toast?.(refusalText('funds')); return; }
    cue('cashRegister', 0.7);
    cue('coinLand', 0.5);
    stage.animate(0.28, (k) => { book.rotation.z = Math.sin(k * Math.PI * 5) * 0.02 * (1 - k); }, () => { book.rotation.z = 0; });
  }

  function rowAct(idx: number): void {
    if (sel === idx) { buySelected(); return; }
    sel = idx;
    cue('hover', 0.35);
    repaintStatic();
  }

  /** Turn one spread: forward (A/D right) lifts the right page over to the left; back does the reverse. */
  function turn(dir: 1 | -1): void {
    const next = spread + dir;
    if (turning || closed || next < 0 || next >= spreadCount()) return;
    turning = true;
    if (dir > 0) {
      leafTop.copyFrom(rightSurf.pix);
      leafUnder.paint((p) => paintPage(p, 2 * next, 'L', null));
    } else {
      leafTop.paint((p) => paintPage(p, 2 * next + 1, 'R', null));
      leafUnder.copyFrom(leftSurf.pix);
    }
    spread = next;
    const [lo, hi] = rangeOf(spread);
    sel = clamp(sel, lo, Math.max(lo, hi - 1));
    leafPivot.visible = true;
    cue('whoosh', 0.6);
    stage.animate(0.55, (k) => {
      const e = ease.inOut(k);
      leafPivot.rotation.z = dir > 0 ? Math.PI * e : Math.PI * (1 - e);
      leafPivot.position.y = 0.004 + 0.02 * Math.sin(k * Math.PI);
    }, () => {
      turning = false;
      leafPivot.visible = false;
      leafPivot.rotation.z = 0;
      leafPivot.position.y = 0.004;
      repaintStatic();
    });
  }

  function moveSel(d: number): void {
    if (turning || rows.length === 0) return;
    const n = clamp(sel + d, 0, rows.length - 1);
    if (n === sel) return;
    sel = n;
    cue('hover', 0.35);
    const s = spreadOf(sel);
    if (s !== spread) turn(s > spread ? 1 : -1);
    else repaintStatic();
  }

  /** Close beat: the book sinks shut, then the stage is disposed. */
  function shut(): void {
    if (closed) return;
    closed = true;
    cue('cardFlip', 0.5);
    stage.animate(0.25, (k) => {
      book.position.y = lerp(BOOK_REST, BOOK_LOW, ease.inOut(k));
      book.rotation.x = lerp(TILT, 1.5, ease.inOut(k));
    }, () => stage.dispose());
    opts.onClose?.();
  }

  // ── input ────────────────────────────────────────────────────────────────────────────────────────
  stage.listen('keydown', (e) => {
    const k = e as KeyboardEvent;
    if (closed) return;
    switch (k.code) {
      case 'Escape': case 'KeyU': k.preventDefault(); shut(); return;
      case 'KeyW': case 'ArrowUp': k.preventDefault(); moveSel(-1); return;
      case 'KeyS': case 'ArrowDown': k.preventDefault(); moveSel(1); return;
      case 'KeyA': case 'ArrowLeft': k.preventDefault(); turn(-1); return;
      case 'KeyD': case 'ArrowRight': k.preventDefault(); turn(1); return;
      case 'KeyM':
        mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
        cue('click', 0.4);
        repaintStatic();
        return;
      case 'Enter': case 'NumpadEnter': case 'Space':
        k.preventDefault();
        if (!k.repeat) buySelected();
        return;
      default:
    }
  });
  stage.listen('pointerdown', (_e, hit) => {
    if (!hit || closed || turning) return;
    const hits = hit.obj === leftMesh ? hitsL : hit.obj === rightMesh ? hitsR : null;
    if (!hits) return;
    const px = hit.uv.x * PX_W, py = (1 - hit.uv.y) * PX_H;
    hits.find((r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)?.act();
  });

  // the host panel is the only link to the game UI: if someone removes it, tear the book down quietly
  stage.onTick(() => { if (!closed && !host.isConnected) { closed = true; stage.dispose(); } });

  // ── open: the book rises in front of the camera, the cover flips, the pages appear ───────────────
  stage.animate(0.8, (k) => {
    book.position.y = lerp(BOOK_LOW, BOOK_REST, ease.outBack(k));
    book.rotation.x = lerp(1.5, TILT, ease.outCubic(k));
    closedBlock.visible = k < 0.35;
    pages.visible = k >= 0.35;
    coverPivot.visible = k >= 0.35;
    coverPivot.rotation.z = Math.PI * ease.inOut((k - 0.35) / 0.65);
  });
  cue('cardFlip', 0.6);
  render();

  const handle: LedgerHandle = {
    instance,
    close(): void { shut(); },
  };
  return handle;
}
