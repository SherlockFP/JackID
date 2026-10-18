/**
 * Notes and tapes in the pit (STORY lane). `placeNotes()` builds one flat paper or tape prop per {@link NOTES} entry
 * next to its world anchor and registers an interactable (E picks it up). Reading holds the object up in front of the
 * eye as a 3D placard (`placard3d.ts`): a paper note, a cassette in a tiny player with subtitles, or the journal, a
 * 3D notebook of every note found this run. Nothing here is DOM. Found state lives in memory for the run only.
 *
 * Keys while a placard is up: E / Esc close · A D or ← → turn the page · J journal · (journal) W S or ↑ ↓ pick a note,
 * Enter reads it. Clicks work on the buttons on the board.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import type { InputMode } from '@/core/input/types';
import { t } from '@/core/i18n';
import { log } from '@/core/log';
import { uiSfx } from '@/core/ui/widgets';
import type { World } from '@/world/types';
import {
  BRASS, CREAM, INK, INK_SOFT, PAPER, PAPER_DARK, Placard3D, button, fitPx5, paginate, put, rowsIn, rule, setPlacardHost,
  speckle, wrapPx5, type OverlayRig,
} from '@/machines/_base/placard3d';
import { setFlashPrefsHost } from '@/machines/_base/juice';
import { NOTES, noteOpen, type NoteDef, type NoteGate } from './notes.data';

// The placards (notes, tape, journal, and the machines' almanac and rules cards) live in the first-person overlay.
// Machines may not import the app core, so the story layer, which may, hands them the overlay and the canvas.
setPlacardHost({
  overlay: (): OverlayRig | null => (app as unknown as { player?: { overlay?: OverlayRig } | null } | undefined)?.player?.overlay ?? null,
  canvas: (): HTMLCanvasElement | null => (app as unknown as { canvas?: HTMLCanvasElement } | undefined)?.canvas ?? null,
});

// the Big One's combo show reads the player's flash settings the same way
setFlashPrefsHost(() => ({ reduced: !!app.save.data.settings.reduceFlashing, calm: !!app.save.data.settings.calm }));

const PAPER_MAT = new THREE.MeshLambertMaterial({ color: 0xd9cfae });
const TAPE_MAT = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
const FLOOR_RAY_TOP = 3;   // m above the anchor the floor ray starts from
const FLOOR_RAY_LEN = 6;   // m

// canvas geometry (texels) and metres
const NOTE_PX: [number, number] = [208, 272], NOTE_W = 0.24, NOTE_H = 0.31;
const TAPE_PX: [number, number] = [224, 176], TAPE_W = 0.28, TAPE_H = 0.22;
const JOURNAL_PX: [number, number] = [336, 216], JOURNAL_W = 0.36, JOURNAL_H = 0.23;
const PAGE_W = 144;                       // one page of the journal spread / the note's text column
const LIST_TOP = 38, LIST_ROW = 12;
/** Paper-note text is drawn at double size (the 5×7 face read as mush at 800×450); its line pitch is 2 × 10 rows. */
const TEXT_SC = 2, LINE = 10 * TEXT_SC;

const found = new Set<string>();
/** The NoteDef of the reader open right now (null when no note is being read). */
let readerOpen: NoteDef | null = null;
/** The one placard that holds input: the reader, the tape or the journal. */
let stage: Placard3D | null = null;
let offInteract: (() => void) | null = null;
/** The input mode to restore when the last board goes down (set when the first board opens). */
let resumeMode: InputMode = 'walk';

export function notesFound(): number { return found.size; }
export function noteFound(id: string): boolean { return found.has(id); }
export function resetNotes(): void {
  found.clear();
  journalLine = null;
  tallyClear();
  readerOpen = null;
  const s = stage;
  stage = null;
  s?.dispose();
  offInteract?.();
  offInteract = null;
}

// ── the Tally Sheet: a journal page of what the player has learned about cheats (the Crooked Table fills it) ─────────────
/** Strings live with the event (`event.watch.crooked_table.*`). */
const TALLY_KEY = 'event.watch.crooked_table.';
export interface TallyLine { key: string; vars?: Record<string, number> }
const tallyLines: TallyLine[] = [];
/** The journal's virtual page (not a world note: it has no anchor and never gets a prop). */
const TALLY_PAGE: NoteDef = { id: 'tally', kind: 'note', anchor: '', dx: 0, dz: 0, yaw: 0 };
/**
 * Adds a line to the Tally Sheet (a key under `event.watch.crooked_table.`, such as `sheet.l.plate` or a `tell.*` line).
 * The same key with the same vars is kept once; a tell line for the same table and kind replaces the older wording.
 */
export function tallyAdd(key: string, vars?: Record<string, number>): void {
  const same = tallyLines.findIndex((l) => l.key === key && JSON.stringify(l.vars ?? null) === JSON.stringify(vars ?? null));
  if (same >= 0) return;
  // a tell at the same table (`t`) with the same family (`tell.tally`) is an update of the count, not a new line
  const fam = key.startsWith('tell.') ? key.split('.').slice(0, 2).join('.') : null;
  const old = fam && vars?.t !== undefined ? tallyLines.findIndex((l) => l.key.startsWith(fam) && l.vars?.t === vars.t) : -1;
  if (old >= 0) tallyLines[old] = { key, vars }; else tallyLines.push({ key, vars });
}
export function tallyLinesNow(): readonly TallyLine[] { return tallyLines; }
export function tallyClear(): void { tallyLines.length = 0; }
const tallyTitle = (): string => t(`${TALLY_KEY}sheet.t`);
const tallyBody = (): string => (tallyLines.length ? tallyLines.map((l) => `- ${t(TALLY_KEY + l.key, l.vars)}`).join('\n') : t(`${TALLY_KEY}sheet.empty`));
const titleOf = (d: NoteDef): string => (d === TALLY_PAGE ? tallyTitle() : t(`story.note.${d.id}.t`));
const bodyOf = (d: NoteDef): string => (d === TALLY_PAGE ? tallyBody() : t(`story.note.${d.id}.b`));

const indexOf = (id: string): number => NOTES.findIndex((n) => n.id === id);

/** The ids of the notes a gate places right now, in table order (a refresh compares these to skip needless rebuilds). */
export function placedNoteIds(gate: NoteGate | null): string[] {
  return NOTES.filter((d) => noteOpen(d, gate)).map((d) => d.id);
}

/**
 * Build every note whose gate is open and whose anchor exists. Notes in closed wings or before their Night are skipped
 * (no mesh, no interactable, no warning). Returns the disposer (world dispose / state exit / a refresh).
 */
export function placeNotes(world: World, gate: NoteGate | null = null): () => void {
  const disposers: Array<() => void> = [];
  const up = new THREE.Vector3();
  const at = new THREE.Vector3();
  NOTES.forEach((def, i) => {
    if (!noteOpen(def, gate)) return;
    const anchor = world.anchor(def.anchor);
    if (!anchor) { log.warn('story', `note ${def.id}: anchor "${def.anchor}" missing`); return; }
    anchor.getWorldPosition(at);
    // drop onto the floor under the spot: a downward ray from above the anchor
    const hit = world.collision.raycast(up.set(at.x + def.dx, at.y + FLOOR_RAY_TOP, at.z + def.dz), new THREE.Vector3(0, -1, 0), FLOOR_RAY_LEN);
    const floorY = hit ? at.y + FLOOR_RAY_TOP - hit.dist : at.y;
    const p = new THREE.Vector3(at.x + def.dx, floorY + 0.01, at.z + def.dz);

    const geo = def.kind === 'tape' ? new THREE.BoxGeometry(0.1, 0.02, 0.06) : new THREE.PlaneGeometry(0.2, 0.27);
    const mesh = new THREE.Mesh(geo, def.kind === 'tape' ? TAPE_MAT : PAPER_MAT);
    mesh.name = `story.note.${def.id}`;
    mesh.rotation.set(-Math.PI / 2, def.yaw, 0);
    if (def.kind === 'tape') mesh.rotation.set(0, def.yaw, 0);
    mesh.position.copy(world.root.worldToLocal(p.clone()));
    world.root.add(mesh);

    const box = new THREE.Box3().setFromCenterAndSize(p.clone().setY(p.y + 0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    const off = world.interact.add({
      id: `story.note.${def.id}`,
      box,
      maxDist: 2.0,
      priority: -1,                       // below machines: a note lying on a machine must never steal its prompt
      enabled: () => stage === null,
      label: () => t('story.ui.label', { title: t(`story.note.${def.id}.t`) }),
      sub: () => found.has(def.id) ? t('story.ui.subFound') : t('story.ui.sub', { i: i + 1, total: NOTES.length }),
      onInteract: () => openNote(def),
    });
    disposers.push(() => {
      off();
      world.root.remove(mesh);
      geo.dispose();
    });
  });
  return () => {
    closeNote();
    for (const d of disposers) d();
    disposers.length = 0;
  };
}

// ── stage: one placard at a time, input routed to it ───────────────────────────────────────────────
/** Show `p` as the stage (the previous one slides away). Takes the mouse and the keys from the walk. */
function present(p: Placard3D, def: NoteDef | null): void {
  if (!p.show()) { p.dispose(); return; }
  const old = stage;
  // The mode to come back to is the one the first board was opened from (a board opened from another board keeps it).
  if (!old) resumeMode = app.input.mode === 'ui' ? 'walk' : app.input.mode;
  stage = p;
  readerOpen = def;
  old?.hide();
  app.input.setMode('ui');
  app.input.exitLock();
  if (!offInteract) offInteract = app.input.on('interact', (down) => { if (down && stage) closeStage(); });
}

/** Take the stage down; the walk comes back when the board has gone. */
function closeStage(): void {
  const s = stage;
  if (!s) return;
  stage = null;
  readerOpen = null;
  s.hide();
  restoreWalk();
}

/** Restores the input mode the boards were opened from (walk, in practice); the pointer lock comes back with walk. */
function restoreWalk(): void {
  offInteract?.();
  offInteract = null;
  if (app.input.mode === 'ui') {
    app.input.setMode(resumeMode);
    if (resumeMode === 'walk') void app.input.requestLock();
  }
}

/** Who hears a note read (the Wash ledger counts its pages here). Every open calls them, repeat reads included. */
const readListeners = new Set<(id: string) => void>();
export function onNoteRead(fn: (id: string) => void): () => void {
  readListeners.add(fn);
  return () => { readListeners.delete(fn); };
}

/** The journal's quest line (the Wash ledger objective) while a quest runs; null shows the note count. */
let journalLine: string | null = null;
export function setJournalLine(line: string | null): void { journalLine = line; }

/** Open a note's reader (from the interactable). */
export function openNote(def: NoteDef): void {
  if (readerOpen) return;
  found.add(def.id);
  for (const fn of readListeners) fn(def.id);
  present(readPlacard(def), def);
}

/** The board for one note: a paper note, or a cassette in its player. */
function readPlacard(def: NoteDef): Placard3D {
  return def.kind === 'tape' ? tapePlacard(def) : notePlacard(def);
}

export function closeNote(): void { closeStage(); }

/** Journal: every note of the run, found ones are readable again. */
export function openJournal(): void {
  present(journalPlacard(), null);
}

// ── paper note ─────────────────────────────────────────────────────────────────────────────────────
function notePlacard(def: NoteDef): Placard3D {
  const i = indexOf(def.id);
  const title = wrapPx5(t(`story.note.${def.id}.t`), NOTE_PX[0] - 28, TEXT_SC);
  const bodyY = 12 + title.length * LINE + 8;
  const pages = paginate(wrapPx5(t(`story.note.${def.id}.b`), NOTE_PX[0] - 28, TEXT_SC), rowsIn(NOTE_PX[1] - bodyY - 64, TEXT_SC));
  const isNote = def.kind === 'note';
  return new Placard3D({
    name: `story-${def.id}`,
    w: NOTE_W, h: NOTE_H, px: NOTE_PX,
    pages: () => pages.length,
    bg: PAPER,
    frame: { color: 0xcdbf98, pad: 0.004, depth: 0.002 },
    rest: [0, -0.02, -0.46],
    paint: (c) => {
      const { g, w, h } = c;
      speckle(g, w, h, 97 * (i + 3), PAPER_DARK, 70);
      let y = 12;
      for (const r of title) { put(g, r, 14, y, INK, 'left', TEXT_SC); y += LINE; }
      rule(g, 14, y + 2, w - 28);
      pages[Math.min(c.page, pages.length - 1)].forEach((r, k) => put(g, r, 14, bodyY + k * LINE, INK, 'left', TEXT_SC));
      rule(g, 14, h - 62, w - 28);
      put(g, t('story.ui.noteCount', { i: i + 1, total: NOTES.length }), w / 2, h - 54, INK_SOFT, 'center');
      if (pages.length > 1) {
        button(c, 14, h - 40, 22, 13, '<', 'prev');
        button(c, w - 36, h - 40, 22, 13, '>', 'next');
        put(g, `${c.page + 1}/${pages.length}`, w / 2, h - 37, INK_SOFT, 'center');
      }
      button(c, 14, h - 22, 84, 13, t('story.ui.close'), 'close');
      if (isNote) button(c, w - 98, h - 22, 84, 13, t('story.ui.journal'), 'journal');
    },
    act: (a) => {
      if (a === 'prev') stage?.turn(-1);
      else if (a === 'next') stage?.turn(1);
      else if (a === 'close') closeStage();
      else if (a === 'journal') openJournal();
    },
    keys: { Escape: 'close', KeyE: 'close', ArrowLeft: 'prev', KeyA: 'prev', ArrowRight: 'next', KeyD: 'next', KeyJ: 'journal' },
  });
}

// ── tape: a cassette in a tiny player, subtitles scroll under the reels ────────────────────────────
const SUB_W = TAPE_PX[0] - 28;
const SUB_ROWS = 4;
const CHARS_PER_S = 28;
const HOLD_S = 2.4;

function tapePlacard(def: NoteDef): Placard3D {
  const subs = paginate(wrapPx5(t(`story.note.${def.id}.b`), SUB_W), SUB_ROWS).map((rows) => rows.join('\n'));
  const label = fitPx5(`${t('story.ui.tapeLabel')}: ${t(`story.note.${def.id}.t`)}`, 200);
  let playing = true, ended = false, pg = 0, shown = 0, acc = 0, hold = 0, reel = 0;
  let led: THREE.Mesh | null = null;
  let ledT = 0;

  const restart = (): void => { pg = 0; shown = 0; acc = 0; hold = 0; ended = false; playing = true; };

  const p: Placard3D = new Placard3D({
    name: `story-${def.id}`,
    w: TAPE_W, h: TAPE_H, px: TAPE_PX,
    pages: () => subs.length,
    bg: '#0e1a14',
    frame: { color: 0x262a31, pad: 0.03, depth: 0.05 },
    rest: [0, -0.02, -0.46],
    build: (root) => {
      const m = new THREE.MeshBasicMaterial({ color: 0xff4a3a });
      led = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.004), m);
      led.position.set(TAPE_W / 2 + 0.02, TAPE_H / 2 + 0.02, 0.002);
      root.add(led);
    },
    tick: (dt) => {
      if (led) {
        ledT += dt;
        (led.material as THREE.MeshBasicMaterial).color.setHex(playing && Math.floor(ledT * 2) % 2 === 0 ? 0xff4a3a : 0x3a1410);
      }
      if (!playing || ended) return false;
      reel += dt * 3;
      const full = subs[pg]?.length ?? 0;
      if (shown < full) {
        acc += dt * CHARS_PER_S;
        const n = Math.min(full, Math.floor(acc));
        if (n > shown) { shown = n; if (shown % 3 === 0) uiSfx('typewriter', 0.22); }
      } else {
        hold += dt;
        if (hold > HOLD_S) {
          hold = 0;
          if (pg < subs.length - 1) { pg++; shown = 0; acc = 0; }
          else { ended = true; playing = false; uiSfx('tapeStop', 0.6); }
        }
      }
      return true;
    },
    paint: (c) => {
      const { g, w, h } = c;
      // label strip and the cassette window with two reels; the pack shrinks as the tape plays on
      g.fillStyle = CREAM; g.fillRect(12, 6, w - 24, 12);
      put(g, label, w / 2, 8, INK, 'center');
      g.fillStyle = '#15171c'; g.fillRect(12, 22, w - 24, 62);
      const total = Math.max(1, subs.length);
      const k = pg / total;
      const reelAt = (x: number, r: number, spin: number): void => {
        g.fillStyle = '#4a4f5a'; disc(g, x, 52, r);
        g.fillStyle = '#0c0d10'; disc(g, x, 52, Math.max(3, r - 3));
        g.fillStyle = '#c7ccd6';
        for (let s = 0; s < 3; s++) {
          const a = spin + s * (Math.PI * 2 / 3);
          g.fillRect(Math.round(x + Math.cos(a) * (r - 5)), Math.round(52 + Math.sin(a) * (r - 5)), 2, 2);
        }
      };
      reelAt(60, Math.round(22 - k * 8), reel);
      reelAt(w - 60, Math.round(12 + k * 8), reel);
      // subtitles, VFD green; the revealed part only
      g.fillStyle = '#0a120e'; g.fillRect(12, 90, w - 24, 46);
      const line = ended ? t('story.ui.tapeEnd') : (subs[pg] ?? '').slice(0, shown);
      if (ended) put(g, line, w / 2, 100, '#9be7a6', 'center');
      else put(g, line, 16, 94, '#9be7a6');
      // transport: play / pause, rewind, close
      button(c, 12, 144, 58, 14, playing ? t('story.ui.pause') : (ended ? t('story.ui.again') : t('story.ui.play')), 'play');
      button(c, 76, 144, 44, 14, t('story.ui.rew'), 'rew');
      button(c, w - 12 - 56, 144, 56, 14, t('story.ui.close'), 'close');
      // tape counter bar
      g.fillStyle = '#2b2f37'; g.fillRect(12, 164, w - 24, 4);
      g.fillStyle = BRASS; g.fillRect(12, 164, Math.round((w - 24) * (ended ? 1 : (pg + (shown / Math.max(1, subs[pg]?.length ?? 1))) / total)), 4);
      c.region(12, 90, w - 24, 46, 'skip');                       // the screen: skip the line / the page
    },
    act: (a) => {
      if (a === 'play') {
        if (ended) restart(); else playing = !playing;
        uiSfx(playing ? 'lever' : 'click', 0.6);
      } else if (a === 'rew') {
        restart();
        uiSfx('whoosh', 0.4);
      } else if (a === 'skip') {
        if (ended) return;
        if (shown < (subs[pg]?.length ?? 0)) shown = subs[pg].length; else hold = HOLD_S + 1;
      } else if (a === 'close') {
        closeStage();
        return;
      }
      p.repaint();
    },
    keys: { Escape: 'close', KeyE: 'close', Space: 'play', Enter: 'play', KeyR: 'rew' },
  });
  return p;
}

/** A filled disc (cassette reel) on the canvas. */
function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    const span = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    g.fillRect(Math.round(x) - span, Math.round(y) + dy, span * 2 + 1, 1);
  }
}

// ── journal: a 3D notebook, found notes on the left page, the chosen one on the right ─────────────
function journalPlacard(): Placard3D {
  let sel = 0;
  let spin = 0;
  let mark: THREE.Mesh | null = null;
  const list = (): NoteDef[] => {
    const l = NOTES.filter((d) => found.has(d.id));
    return tallyLines.length ? [...l, TALLY_PAGE] : l;
  };
  const bodyRows = (d: NoteDef): string[] => wrapPx5(bodyOf(d), PAGE_W);
  const rightRows = JOURNAL_PX[1] - 26 - 30;
  const pagesOf = (): number => {
    const l = list();
    return l.length ? paginate(bodyRows(l[Math.min(sel, l.length - 1)]), rowsIn(rightRows)).length : 1;
  };

  const p: Placard3D = new Placard3D({
    name: 'story-journal',
    w: JOURNAL_W, h: JOURNAL_H, px: JOURNAL_PX,
    pages: pagesOf,
    bg: PAPER,
    frame: { color: 0x3d2616, pad: 0.016, depth: 0.012 },
    rest: [0, -0.03, -0.46],
    build: (root) => {
      mark = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.07, 0.002), new THREE.MeshBasicMaterial({ color: 0xb8322a }));
      mark.position.set(0.08, -JOURNAL_H / 2 - 0.03, -0.004);
      root.add(mark);
    },
    tick: (dt) => {
      if (!mark) return false;
      spin += dt;
      mark.rotation.z = Math.sin(spin * 1.6) * 0.05;
      return false;
    },
    paint: (c) => {
      const { g, w, h } = c;
      const l = list();
      const top = Math.floor(sel / LIST_ROWS) * LIST_ROWS;
      put(g, t('story.ui.journal'), 14, 8, INK);
      put(g, journalLine ?? t('story.ui.journalCount', { found: found.size, total: NOTES.length }), 14, 20, INK_SOFT);
      rule(g, 14, 32, PAGE_W);
      g.fillStyle = INK_SOFT; g.fillRect(w / 2, 8, 1, h - 16);       // the gutter
      if (!l.length) {
        wrapPx5(t('story.ui.journalEmpty'), PAGE_W).slice(0, LIST_ROWS).forEach((r, k) => put(g, r, 14, LIST_TOP + k * LIST_ROW, INK));
      }
      for (let k = top; k < Math.min(l.length, top + LIST_ROWS); k++) {
        const y = LIST_TOP + (k - top) * LIST_ROW;
        const on = k === sel;
        if (on || c.hover === `pick:${k}`) {
          g.fillStyle = on ? INK : BRASS;
          g.fillRect(12, y - 1, PAGE_W + 4, LIST_ROW - 1);
        }
        put(g, fitPx5(titleOf(l[k]), PAGE_W - 6), 14, y + 1, on ? CREAM : INK);
        c.region(12, y - 1, PAGE_W + 4, LIST_ROW - 1, `pick:${k}`);
      }
      const cur = l[Math.min(sel, Math.max(0, l.length - 1))];
      if (cur) {
        const x = w / 2 + 14;
        put(g, fitPx5(titleOf(cur), PAGE_W), x, 8, INK);
        rule(g, x, 20, PAGE_W);
        const pages = paginate(bodyRows(cur), rowsIn(rightRows));
        pages[Math.min(c.page, pages.length - 1)].forEach((r, k) => put(g, r, x, 26 + k * 10, INK));
        if (pages.length > 1) {
          button(c, x, h - 22, 18, 13, '<', 'prev');
          button(c, x + 22, h - 22, 18, 13, '>', 'next');
          put(g, `${Math.min(c.page, pages.length - 1) + 1}/${pages.length}`, x + 52, h - 19, INK_SOFT);
        }
        if (cur !== TALLY_PAGE) button(c, w - 14 - 56, h - 22, 56, 13, t('story.ui.read'), 'read');
      }
      button(c, 14, h - 22, 56, 13, t('story.ui.close'), 'close');
    },
    act: (a) => {
      const l = list();
      if (a === 'close') { closeStage(); return; }
      if (a === 'prev') { stage?.turn(-1); return; }
      if (a === 'next') { stage?.turn(1); return; }
      if (a === 'up' || a === 'down') {
        if (!l.length) return;
        sel = Math.max(0, Math.min(l.length - 1, sel + (a === 'up' ? -1 : 1)));
        uiSfx('hover', 0.3);
        p.jump(0);
        return;
      }
      if (a.startsWith('pick:')) {
        const k = Number(a.slice(5));
        if (k !== sel) { sel = k; p.jump(0); }
        return;
      }
      if (a === 'read' && l.length) {
        const d = l[Math.min(sel, l.length - 1)];
        if (d !== TALLY_PAGE) present(readPlacard(d), d);   // the Tally Sheet is read in the journal itself
      }
    },
    keys: {
      Escape: 'close', KeyE: 'close', KeyJ: 'close',
      ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'prev', KeyA: 'prev', ArrowRight: 'next', KeyD: 'next',
      Enter: 'read', NumpadEnter: 'read', Space: 'read',
    },
  });
  return p;
}

const LIST_ROWS = Math.floor((JOURNAL_PX[1] - LIST_TOP - 30) / LIST_ROW);
