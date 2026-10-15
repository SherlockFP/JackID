/**
 * Upgrade Ledger (GAME-TYCOON, GDD §10.3): a leather ledger book that opens in front of the camera (3D, in the
 * first-person overlay). The left page is the summary (machine, owner, pit holdings, keys); the right page lists the
 * upgrades of this machine with level and price, four to a page. A/D turn the spread, W/S select, Enter or Space
 * (or a click on a row, twice) buys, M cycles ×1 / ×10 / MAX, Esc or U closes. It is a plain view over `TycoonApi`:
 * rows come from `upgradesFor`, purchases go through `buy`, and the book repaints on `onChange`.
 * With `opts.mods` the book has a second tab, MODS (T switches): the machine's two mod sockets and the five mods that fit
 * them (`machineMods.ts`). Its rows are `MOD_DEFS`; buying goes through `mods.buy`, and the book repaints on `mods.onChange`.
 */
import * as THREE from 'three';
import { clamp, lerp } from '@/core/math';
import { fmtCoins, t } from '@/core/i18n';
import type { InstanceId } from '@/core/types';
import type { Pix } from '@/core/texgen/pixel';
import type { BuyMode, TycoonApi, UpgradeView } from '@/game/tycoon.types';
import { MOD_DEFS } from '@/game/data/upgrades';
import { MOD_SOCKETS, type MachineMods } from '@/game/machineMods';
import { boxGeo, cue, dimVeil, ease, fit, PixSurface, Stage3D, txt, unlit, wrap, type TxtOpts } from './ui3d';

const MODES: readonly BuyMode[] = [1, 10, 'max'];

/** Upgrades per page; a spread is the summary + list page on the left and list pages on the right. */
const PER = 4;
/**
 * Page canvas (texels) and its size on the table, in metres. The pages are 2× the old texel count and every line is
 * drawn at text scale 2 (`BIG` / `SMALL`), so the glyphs are about 14 texels tall and survive the 400×225 internal frame.
 */
const PX_W = 224, PX_H = 300;
const PW = 0.15, PH = 0.2;
/** Book tilt (rotation about X): the pages face the eye and the spine stands upright in the middle. */
const TILT = 1.07;
const BOOK_REST = -0.12, BOOK_LOW = -0.42;
const LEATHER = 0x5a3320;
const PAPER = 0xf3e9cc, PAPER_EDGE = 0xa88f5e, INK = 0x1c1108, MUTED = 0x5b4a30, ACCENT = 0x9b2414, HILITE = 0xe0c97f;
/** Text styles: px5 headline/body at scale 2, and the 3×5 micro face at scale 2 for small print. */
const BIG: TxtOpts = { scale: 2 };
const BIG_R: TxtOpts = { scale: 2, align: 'right' };
const SMALL: TxtOpts = { micro: true, scale: 2 };
const SMALL_R: TxtOpts = { micro: true, scale: 2, align: 'right' };
const SMALL_C: TxtOpts = { micro: true, scale: 2, align: 'center' };

export interface LedgerOpts {
  /** Called once when the book closes (Esc / U / `close()`). */
  onClose?(): void;
  /** Optional toast sink (HUD feed). Receives refusal and milestone text. */
  toast?(text: string): void;
  /** Machine mods (backlog #7). Without it the book has only the UPGRADES tab. */
  mods?: MachineMods;
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
  /** The active tab: UPGRADES (the machine's tracks) or MODS (its sockets). MODS exists only with `opts.mods`. */
  let tab: 'upg' | 'mods' = 'upg';
  const mods = opts.mods ?? null;

  const stage = new Stage3D();
  dimVeil(stage, 0.35);
  stage.own(api.onChange(() => render()));
  if (mods) stage.own(mods.onChange(() => render()));

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
  /** Length of the active list: the machine's upgrade rows, or the mod defs on the MODS tab. */
  const listLen = (): number => (tab === 'mods' && mods ? MOD_DEFS.length : rows.length);
  const pageCount = (): number => 1 + Math.ceil(listLen() / PER);
  const spreadCount = (): number => Math.ceil(pageCount() / 2);
  const spreadOf = (i: number): number => Math.floor((1 + Math.floor(i / PER)) / 2);
  /** Row indices shown by spread `s` (its left page 2s, right page 2s+1; page 0 is the summary). */
  const rangeOf = (s: number): [number, number] => [(Math.max(2 * s, 1) - 1) * PER, Math.min(listLen(), (2 * s + 1) * PER)];

  const TW = PX_W - 24;   // usable text width on a page

  function paintSummary(p: Pix): void {
    txt(p, fit(t('tyc.ledger.title'), TW, BIG), 12, 12, INK, BIG);
    txt(p, fit(String(instance), TW, SMALL), 12, 36, MUTED, SMALL);
    p.rect(12, 54, TW, 2, PAPER_EDGE);
    const owned = api.owned(instance);
    if (owned) {
      txt(p, fit(t('tyc.ledger.owner', { who: owned.owner ? String(owned.owner) : '-' }), TW, SMALL), 12, 64, INK, SMALL);
    } else {
      wrap(t('tyc.ledger.notOwned'), TW, SMALL).forEach((ln, i) => txt(p, ln, 12, 64 + i * 12, INK, SMALL));
    }
    if (mods && owned) txt(p, fit(t('mod.sockets', { n: mods.installed(instance).length, max: MOD_SOCKETS }), TW, SMALL), 12, 84, INK, SMALL);
    txt(p, fit(t('tyc.ledger.pit'), TW, SMALL), 12, 108, MUTED, SMALL);
    txt(p, fit(fmtCoins(api.holdings(), true), TW, BIG), 12, 124, ACCENT, BIG);
    txt(p, fit(modeLabel(mode), TW, BIG), 12, 160, INK, BIG);
    if (mods) txt(p, fit(`${t(tab === 'mods' ? 'mod.tab.mods' : 'mod.tab.upg')}  ${t('mod.tab.hint')}`, TW, SMALL), 12, 178, ACCENT, SMALL);
    wrap(t('tyc.ledger.hint3d'), TW, SMALL).forEach((ln, i) => txt(p, ln, 12, 200 + i * 12, MUTED, SMALL));
  }

  /** One MODS page: up to PER mod defs. A row shows its state (installed, why it cannot be bought) and its price. */
  function paintModRows(p: Pix, page: number, hits: Hit2[] | null): void {
    if (!mods) return;
    txt(p, fit(t('mod.tab.mods'), TW, SMALL), 12, 10, MUTED, SMALL);
    p.rect(12, 24, TW, 2, PAPER_EDGE);
    const first = (page - 1) * PER;
    for (let i = 0; i < PER; i++) {
      const idx = first + i;
      const def = MOD_DEFS[idx];
      if (!def) break;
      const y0 = 34 + i * 62;
      if (idx === sel) {
        p.rect(4, y0 - 6, PX_W - 8, 62, HILITE);
        txt(p, '>', 8, y0, ACCENT, BIG);
      }
      txt(p, fit(t(`mod.${def.id}.name`), TW - 20, BIG), 34, y0, INK, BIG);
      txt(p, fit(t(`mod.${def.id}.desc`), TW - 20, SMALL), 34, y0 + 16, MUTED, SMALL);
      const isOn = mods.installed(instance).includes(def.id);
      const q = mods.quote(instance, def.id);
      txt(p, fit(isOn ? t('mod.installed') : q.why ? t(`mod.why.${q.why}`) : t(`mod.fits.${def.machines?.[0] ?? 'any'}`), TW - 20, SMALL), 34, y0 + 30, MUTED, SMALL);
      const priceTxt = isOn ? '' : `${t('mod.install')} ${fmtCoins(q.price, true)}`;
      if (priceTxt) txt(p, fit(priceTxt, 110, BIG), PX_W - 12, y0 + 28, !q.why ? ACCENT : MUTED, BIG_R);
      if (hits) hits.push({ x: 2, y: y0 - 6, w: PX_W - 4, h: 62, act: () => modAct(idx) });
    }
  }

  function paintRows(p: Pix, page: number, hits: Hit2[] | null): void {
    if (tab === 'mods' && mods) { paintModRows(p, page, hits); return; }
    txt(p, fit(t('tyc.ledger.title'), TW, SMALL), 12, 10, MUTED, SMALL);
    p.rect(12, 24, TW, 2, PAPER_EDGE);
    const first = (page - 1) * PER;
    for (let i = 0; i < PER; i++) {
      const idx = first + i;
      const v = rows[idx];
      if (!v) break;
      // one upgrade = 62 texels: name, description, level + price, next step
      const y0 = 34 + i * 62;
      const cur = idx === sel;
      if (cur) {
        p.rect(4, y0 - 6, PX_W - 8, 62, HILITE);
        txt(p, '>', 8, y0, ACCENT, BIG);
      }
      const swatch = v.def.template.color;
      if (swatch !== undefined) p.rect(22, y0 + 2, 6, 12, swatch);
      const max = v.def.maxLevel;
      txt(p, fit(trackName(v), TW - 20, BIG), 34, y0, INK, BIG);
      txt(p, fit(trackDesc(v), TW - 20, SMALL), 34, y0 + 16, MUTED, SMALL);
      txt(p, t('tyc.ledger.level', { n: v.level, max }), 34, y0 + 30, MUTED, SMALL);
      const q = api.quote(v.def.id, mode);
      const maxed = v.level >= max;
      const priceTxt = maxed ? t('tyc.ledger.maxed') : `${t('tyc.ledger.buy')} ${fmtCoins(q.cost, true)}`;
      txt(p, fit(priceTxt, 110, BIG), PX_W - 12, y0 + 28, !maxed && q.affordable ? ACCENT : MUTED, BIG_R);
      const next = v.next;
      const nextTxt = next ? t('tyc.ledger.next', { n: next.level, what: next.feature ?? next.visual ?? '' }) : t('tyc.ledger.nextNone');
      txt(p, fit(nextTxt, TW - 20, SMALL), 34, y0 + 46, MUTED, SMALL);
      if (hits) hits.push({ x: 2, y: y0 - 6, w: PX_W - 4, h: 62, act: () => rowAct(idx) });
    }
  }

  /** One page of the spread. `hits` is given only for the static pages (the turning leaves are not clickable). */
  function paintPage(p: Pix, page: number, side: 'L' | 'R', hits: Hit2[] | null): void {
    p.clear(PAPER);
    p.rect(side === 'L' ? PX_W - 8 : 0, 0, 8, PX_H, PAPER_EDGE);
    if (page === 0) paintSummary(p);
    else paintRows(p, page, hits);
    txt(p, t('tyc.ledger.pageOf', { n: page + 1, max: pageCount() }), PX_W / 2, PX_H - 14, MUTED, SMALL_C);
    if (!hits) return;
    if (side === 'L' && spread > 0) {
      txt(p, '<', 12, PX_H - 16, ACCENT, SMALL);
      hits.push({ x: 0, y: PX_H - 24, w: 56, h: 24, act: () => turn(-1) });
    }
    if (side === 'R' && spread < spreadCount() - 1) {
      txt(p, '>', PX_W - 20, PX_H - 16, ACCENT, SMALL);
      hits.push({ x: PX_W - 56, y: PX_H - 24, w: 56, h: 24, act: () => turn(1) });
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
    if (sel >= listLen()) sel = Math.max(0, listLen() - 1);
    spread = Math.min(spread, spreadCount() - 1);
    if (!turning) repaintStatic();
  }

  // ── actions ──────────────────────────────────────────────────────────────────────────────────────
  function buySelected(): void {
    if (tab === 'mods' && mods) { buyMod(sel); return; }
    const v = rows[sel];
    if (!v) return;
    const q = api.quote(v.def.id, mode);
    if (q.levels <= 0) { cue('hover', 0.3); opts.toast?.(refusalText(q.blocked)); return; }
    if (!api.buy(v.def.id, mode)) { cue('hover', 0.3); opts.toast?.(refusalText('funds')); return; }
    cue('cashRegister', 0.7);
    cue('coinLand', 0.5);
    stage.animate(0.28, (k) => { book.rotation.z = Math.sin(k * Math.PI * 5) * 0.02 * (1 - k); }, () => { book.rotation.z = 0; });
  }

  /** Install mod `idx` on this machine. The refusal is toasted; the book repaints from `mods.onChange`. */
  function buyMod(idx: number): void {
    const def = MOD_DEFS[idx];
    if (!def || !mods) return;
    const r = mods.buy(instance, def.id);
    if (!r.ok) { cue('hover', 0.3); opts.toast?.(t(`mod.why.${r.why}`)); return; }
    cue('cashRegister', 0.7);
    cue('coinLand', 0.5);
    opts.toast?.(t('mod.installedToast', { name: t(`mod.${def.id}.name`) }));
    stage.animate(0.28, (k) => { book.rotation.z = Math.sin(k * Math.PI * 5) * 0.02 * (1 - k); }, () => { book.rotation.z = 0; });
  }

  function rowAct(idx: number): void {
    if (sel === idx) { buySelected(); return; }
    sel = idx;
    cue('hover', 0.35);
    repaintStatic();
  }

  function modAct(idx: number): void {
    if (sel === idx) { buyMod(idx); return; }
    sel = idx;
    cue('hover', 0.35);
    repaintStatic();
  }

  /** T: flip between UPGRADES and MODS. The spread goes back to the summary; the selection to the first row. */
  function toggleTab(): void {
    if (!mods || turning || closed) return;
    tab = tab === 'upg' ? 'mods' : 'upg';
    sel = 0;
    spread = 0;
    cue('click', 0.4);
    render();
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
    if (turning || listLen() === 0) return;
    const n = clamp(sel + d, 0, listLen() - 1);
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
      case 'KeyT':
        if (mods) { k.preventDefault(); toggleTab(); }
        return;
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
