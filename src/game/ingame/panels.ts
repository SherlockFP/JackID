/**
 * In-world modal panels of the Debt Run session: the pause card (Esc) and the Intermission terminal (between Watches
 * and Nights). Both are 3D objects in the first-person overlay (the pass that draws the hands), not DOM panels: the
 * pause is a JackID card held up in front of the camera, the Intermission a CRT on the floor in front of you. Painted
 * from low-res canvases and driven by a ray from the mouse or the W/S/Enter keys. The DOM panel slot stays empty and
 * only carries the modal flags, so Input switches to 'ui' while they are open.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { clamp, lerp } from '@/core/math';
import { fmtCoins, t } from '@/core/i18n';
import type { UIOverlayX } from '@/core/ui/ui';
import { modalPanel } from '@/core/ui/widgets';
import { darken, type Pix } from '@/core/texgen/pixel';
import type { DebtRun } from '@/game/run';
import { boxGeo, cue, dimVeil, ease, fit, PixSurface, Stage3D, txt, unlit } from '@/game/tycoon/ui3d';

export const PAUSE_PANEL = 'ingame-pause';
export const INTER_PANEL = 'ingame-intermission';

export interface PauseOpts {
  onResume(): void; onQuit(): void; onGone(): void; onSettings?(): void; onJournal?(): void;
  /** Online session: the game does NOT stop behind the card. The card says so (GAME CONTINUES) and its title becomes MENU. */
  live?: boolean;
  /** Wave 25: Soul Marks left on the JackID card (seals under the title). At 0 the card reads BLANK. Absent: no seals row. */
  marks?: { left: number; max: number };
}

// ── pause card ───────────────────────────────────────────────────────────────────────────────────
const CARD_W = 96, CARD_H = 144;
/** Holding ENTER (or the mouse) on LEAVE THE RUN for this long leaves; releasing early cancels. */
const CARD_HOLD_S = 0.8;
const CARD_INK = 0xf2e8c9, CARD_BRASS = 0xc9a24a, CARD_DANGER = 0xe0584a, CARD_HILITE = 0x3a2c18, CARD_FELT = 0x1a1410, CARD_LIVE = 0xe69431;
const ROW0 = 42, ROW_H = 18;

/** The Soul Marks as wax seals on the card (wave 25): a lit seal per Mark left, an empty ring per Mark lost, BLANK at 0. */
function paintSeals(p: Pix, left: number, max: number): void {
  if (left <= 0) { txt(p, fit(t('duelrun.blank'), 80, { micro: true }), CARD_W / 2, 19, 0x9a9a9a, { micro: true, align: 'center' }); return; }
  const x0 = Math.round(CARD_W / 2 - (max * 10 - 4) / 2);
  for (let i = 0; i < max; i++) {
    const x = x0 + i * 10;
    if (i < left) { p.rect(x, 18, 7, 7, 0x8c1f1a); p.rect(x + 1, 19, 5, 5, 0xd2483a); p.rect(x + 2, 20, 1, 1, 0xf0a090); }
    else p.frame(x, 18, 7, 7, 0x5a4220);
  }
}

interface MenuRow { label: string; danger: boolean; hold: boolean; act(): void }

/**
 * Pause card. `onGone` runs when the panel closes for any reason (Esc, a menu line, state exit). `onSettings` and `onJournal` add their lines when given.
 * Four lines at most: RESUME, SETTINGS, JOURNAL, QUIT (standing up has its key, the tutorial skips on an Esc hold).
 */
export function buildPause(el: HTMLElement, o: PauseOpts): () => void {
  modalPanel(el, { escClose: true, dim: false });
  const stage = new Stage3D();
  dimVeil(stage, 0.55);
  const surf = new PixSurface(CARD_W, CARD_H);
  stage.own(() => surf.dispose());

  const rows: MenuRow[] = [
    { label: t('ingame.pause.resume'), danger: false, hold: false, act: o.onResume },
    ...(o.onSettings ? [{ label: t('ingame.pause.settings'), danger: false, hold: false, act: o.onSettings }] : []),
    ...(o.onJournal ? [{ label: t('ingame.pause.journal'), danger: false, hold: false, act: o.onJournal }] : []),
    { label: t('ingame.pause.quit'), danger: true, hold: true, act: o.onQuit },
  ];

  const card = new THREE.Group();
  const face = unlit({ map: surf.tex });
  const back = unlit({ color: 0x5b1c1c });
  const edge = unlit({ color: 0x2a1c10 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.28, 0.004), [edge, edge, edge, edge, face, back]);
  body.userData.pick = true;
  card.add(body);
  card.position.set(0, -0.42, -0.42);
  card.rotation.x = -1.2;
  stage.add(card);

  let sel = 0;
  let hold = 0;
  let holding = false;
  const repaint = (): void => surf.paint((p: Pix) => {
    p.clear(CARD_FELT);
    p.frame(0, 0, CARD_W, CARD_H, CARD_BRASS);
    p.frame(2, 2, CARD_W - 4, CARD_H - 4, 0x5a4220);
    txt(p, fit(t(o.live ? 'pauselive.title' : 'ingame.pause.title'), 84), CARD_W / 2, 10, CARD_INK, { align: 'center' });
    p.rect(8, 28, CARD_W - 16, 1, 0x8a6a30);
    if (o.marks) paintSeals(p, o.marks.left, o.marks.max);
    rows.forEach((r, i) => {
      const y = ROW0 + i * ROW_H;
      if (i === sel) {
        p.rect(6, y - 3, CARD_W - 12, 13, CARD_HILITE);
        txt(p, '>', 9, y, CARD_BRASS);
      }
      txt(p, fit(r.label, 72), 18, y, r.danger ? CARD_DANGER : CARD_INK);
      if (r.hold && holding) p.rect(6, y + 11, Math.round((CARD_W - 12) * hold), 1, CARD_DANGER);
    });
    if (o.live) txt(p, fit(t('pauselive.label'), 88, { micro: true }), CARD_W / 2, CARD_H - 31, CARD_LIVE, { micro: true, align: 'center' });
    // two micro lines (5 px tall) clear of the 2 px frame: the hold hint 22 px up from the bottom, the key line 13 px up
    txt(p, fit(t('ingame.pause.holdHint'), 84, { micro: true }), CARD_W / 2, CARD_H - 22, 0x9c8a62, { micro: true, align: 'center' });
    txt(p, fit(t('ingame.pause.keys'), 84, { micro: true }), CARD_W / 2, CARD_H - 13, 0x7a6a4c, { micro: true, align: 'center' });
  });

  const press = (i: number): void => {
    const r = rows[i];
    if (!r) return;
    sel = i;
    if (r.hold) { holding = true; hold = 0; cue('click', 0.5); repaint(); return; }
    cue('click', 0.6);
    r.act();
  };
  const release = (): void => {
    if (!holding) return;
    holding = false; hold = 0;
    repaint();
  };
  const move = (d: number): void => {
    sel = (sel + d + rows.length) % rows.length;
    cue('hover', 0.4);
    repaint();
  };
  const rowAt = (uv: THREE.Vector2): number => {
    const px = uv.x * CARD_W, py = (1 - uv.y) * CARD_H;
    if (px < 6 || px > CARD_W - 6) return -1;
    return rows.findIndex((_r, i) => py >= ROW0 + i * ROW_H - 3 && py < ROW0 + i * ROW_H + 10);
  };

  stage.listen('keydown', (e) => {
    const k = e as KeyboardEvent;
    if (k.repeat) return;
    if (k.code === 'KeyW' || k.code === 'ArrowUp') move(-1);
    else if (k.code === 'KeyS' || k.code === 'ArrowDown') move(1);
    else if (k.code === 'Enter' || k.code === 'NumpadEnter' || k.code === 'Space') { k.preventDefault(); press(sel); }
  });
  stage.listen('keyup', (e) => {
    const c = (e as KeyboardEvent).code;
    if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') release();
  });
  stage.listen('pointermove', (_e, hit) => {
    if (!hit || hit.obj !== body) return;
    const i = rowAt(hit.uv);
    if (i >= 0 && i !== sel) { sel = i; cue('hover', 0.4); repaint(); }
  });
  stage.listen('pointerdown', (_e, hit) => {
    if (!hit || hit.obj !== body) return;
    const i = rowAt(hit.uv);
    if (i >= 0) press(i);
  });
  stage.listen('pointerup', () => release());

  // the card rises into the hands and tips up to face you; it then sways gently
  let clock = 0;
  stage.animate(0.55, (k) => {
    card.position.y = lerp(-0.42, -0.03, ease.outBack(k));
    card.rotation.x = lerp(-1.2, -0.38, ease.outCubic(k));
  });
  stage.onTick((dt) => {
    clock += dt;
    card.rotation.z = Math.sin(clock * 1.3) * 0.025;
    card.rotation.y = Math.sin(clock * 0.9) * 0.06;
    if (!holding) return;
    hold = Math.min(1, hold + dt / CARD_HOLD_S);
    if (hold >= 1) {
      holding = false; hold = 0;
      cue('chime', 0.5);
      rows[sel]?.act();
      return;
    }
    repaint();
  });
  repaint();
  cue('cardFlip', 0.7);

  return () => { stage.dispose(); o.onGone(); };
}

// ── intermission HUD hint ────────────────────────────────────────────────────────────────────────
/** The free-roam Intermission: one small, non-blocking line on the HUD layer (no modal, the mouse and keys stay free). */
export interface InterHint { set(text: string | null): void; dispose(): void }

export function createInterHint(parent: HTMLElement): InterHint {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  Object.assign(el.style, {
    position: 'absolute', left: '50%', bottom: '30%', transform: 'translateX(-50%)', maxWidth: 'min(62%, 560px)', boxSizing: 'border-box',
    padding: 'calc(3 * var(--u, 3px)) calc(6 * var(--u, 3px))', background: 'rgba(8, 6, 4, 0.74)',
    border: 'calc(1 * var(--u, 3px)) solid var(--amber, #e69431)', color: 'var(--ivory, #e6dec5)',
    fontFamily: 'var(--f-head, monospace)', fontSize: 'calc(6 * var(--u, 3px))', lineHeight: '1.4', textAlign: 'center',
    pointerEvents: 'none', display: 'none', zIndex: '4',
  } satisfies Partial<CSSStyleDeclaration>);
  parent.appendChild(el);
  let shown: string | null = null;
  return {
    set(text) {
      if (text === shown) return;
      shown = text;
      el.textContent = text ?? '';
      el.style.display = text ? 'block' : 'none';
    },
    dispose() { el.remove(); },
  };
}

// ── intermission terminal ────────────────────────────────────────────────────────────────────────
export interface InterOpts { redraw(): void }

const SCR_W = 128, SCR_H = 96;
const SCR_BG = 0x06161b, SCR_CYAN = 0x7ff0ff, SCR_DIM = 0x2f7f8c, SCR_HI = 0xffffff;

/**
 * Topside choice (after the 8th Night paid): STAY UP (win) or GO BACK DOWN (Overdrawn). This is the only modal left:
 * the ordinary Intermission is free-roam (Pawn Window, phone, Debt Terminal levers; see `createInterHint`). The CONTINUE
 * line stays as a fallback that opens the floor or rings the Bell, but `inGameState` only mounts this panel on Topside.
 * The terminal boots open from its centre line; ENTER (or a click) picks the highlighted line.
 */
export function buildIntermission(el: HTMLElement, run: DebtRun, o: InterOpts): () => void {
  modalPanel(el, { escClose: false, dim: false });
  const stage = new Stage3D();
  dimVeil(stage, 0.45);
  const surf = new PixSurface(SCR_W, SCR_H);
  stage.own(() => surf.dispose());

  const rig = new THREE.Group();
  rig.position.set(0, -0.03, -0.5);
  stage.add(rig);
  rig.add(new THREE.Mesh(boxGeo(0.4, 0.31, 0.12), unlit({ color: 0x3b3530, vertexColors: true })));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.255), unlit({ map: surf.tex }));
  screen.position.set(0, 0.005, 0.0625);
  screen.userData.pick = true;
  rig.add(screen);
  const neck = new THREE.Mesh(boxGeo(0.07, 0.07, 0.05), unlit({ color: 0x3b3530, vertexColors: true }));
  neck.position.set(0, -0.19, -0.02);
  rig.add(neck);
  const base = new THREE.Mesh(boxGeo(0.2, 0.012, 0.14), unlit({ color: 0x2a2622, vertexColors: true }));
  base.position.set(0, -0.23, 0);
  rig.add(base);

  const cont = (): void => {
    if (run.openFloor()) {
      // THE EVENING: the lever took the lift, so no Night has opened yet; the bed's banner names the Night when it does
      if (run.homeStage() === null) void (app.ui as UIOverlayX).banner(t('ingame.night', { n: run.night() }));
      o.redraw();
    } else {
      run.startWatch();
    }
  };
  const btns: Array<{ label: string; y: number; act(): void }> = run.topsideOpen
    ? [
      { label: t('ingame.inter.stayUp'), y: 52, act: () => { run.stayUp(); } },
      { label: t('ingame.inter.goBack'), y: 70, act: () => { run.goBackDown(); o.redraw(); } },
    ]
    : [{ label: t('ingame.inter.continue'), y: 62, act: cont }];
  const topside = run.topsideOpen;
  let sel = 0;
  let boot = 0;

  const repaint = (): void => {
    const q = run.debt();
    surf.paint((p: Pix) => {
      p.clear(SCR_BG);
      txt(p, fit(t('ingame.night', { n: run.night() }), SCR_W - 16), SCR_W / 2, 5, SCR_HI, { align: 'center' });
      p.rect(8, 15, SCR_W - 16, 1, SCR_DIM);
      txt(p, fit(t('ingame.inter.debt', { paid: fmtCoins(q.paid), due: fmtCoins(q.due) }), SCR_W - 16), 8, 21, SCR_CYAN);
      p.frame(8, 31, SCR_W - 16, 7, SCR_DIM);
      const frac = q.due > 0 ? clamp(q.paid / q.due, 0, 1) : 0;
      p.rect(10, 33, Math.round((SCR_W - 20) * frac), 3, SCR_CYAN);
      btns.forEach((b, i) => {
        const on = i === sel;
        const x = 14, w = SCR_W - 28;
        if (on) p.rect(x, b.y - 2, w, 12, SCR_CYAN);
        else p.frame(x, b.y - 2, w, 12, SCR_DIM);
        txt(p, fit(b.label, w - 8), SCR_W / 2, b.y, on ? SCR_BG : SCR_CYAN, { align: 'center' });
      });
      txt(p, fit(t('ingame.inter.hintShort'), SCR_W - 16, { micro: true }), SCR_W / 2, SCR_H - 11, SCR_DIM, { micro: true, align: 'center' });
      // CRT: the picture opens from the centre line during the boot, then scanlines darken every odd row
      const half = (SCR_H * ease.outCubic(boot)) / 2;
      for (let y = 0; y < SCR_H; y++) {
        if (Math.abs(y + 0.5 - SCR_H / 2) > half) p.rect(0, y, SCR_W, 1, 0x000000);
      }
      p.map((_x, y, c) => (y % 2 === 1 ? darken(c, 0.25) : undefined));
    });
  };

  const btnAt = (uv: THREE.Vector2): number => {
    const px = uv.x * SCR_W, py = (1 - uv.y) * SCR_H;
    if (px < 14 || px > SCR_W - 14) return -1;
    return btns.findIndex((b) => py >= b.y - 2 && py < b.y + 10);
  };
  const fire = (): void => {
    const b = btns[sel];
    if (!b) return;
    cue('chime', 0.5);
    b.act();
  };
  const move = (d: number): void => {
    if (!topside) return;
    sel = clamp(sel + d, 0, btns.length - 1);
    cue('hover', 0.4);
    repaint();
  };

  stage.listen('keydown', (e) => {
    const k = e as KeyboardEvent;
    if (k.repeat) return;
    if (k.code === 'KeyW' || k.code === 'ArrowUp') move(-1);
    else if (k.code === 'KeyS' || k.code === 'ArrowDown') move(1);
    else if (k.code === 'Enter' || k.code === 'NumpadEnter' || k.code === 'Space') { k.preventDefault(); fire(); }
  });
  stage.listen('pointermove', (_e, hit) => {
    if (!hit || hit.obj !== screen || !topside) return;
    const i = btnAt(hit.uv);
    if (i >= 0 && i !== sel) { sel = i; cue('hover', 0.4); repaint(); }
  });
  stage.listen('pointerdown', (_e, hit) => {
    if (!hit || hit.obj !== screen) return;
    const i = btnAt(hit.uv);
    if (i >= 0) { sel = i; fire(); }
  });

  // the terminal swings up from below and the picture boots open
  rig.position.y = -0.2;
  stage.animate(0.6, (k) => {
    rig.position.y = lerp(-0.2, -0.03, ease.outBack(k));
    boot = k;
    repaint();
  });
  cue('chime', 0.5);
  repaint();

  return () => stage.dispose();
}
