/**
 * Notes and tapes in the pit (STORY lane). `placeNotes()` builds one flat paper or tape prop per {@link NOTES} entry
 * next to its world anchor and registers an interactable (E reads it). Reading opens a DOM panel (DECISIONS C7);
 * the journal lists every note found this run. Found state lives in memory for the run only.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import { log } from '@/core/log';
import { button, focusFirst, frame, h, modalPanel } from '@/core/ui/widgets';
import type { World } from '@/world/types';
import { NOTES, type NoteDef } from './notes.data';

export const READER_PANEL = 'story-note';
export const JOURNAL_PANEL = 'story-journal';

const PAPER = new THREE.MeshLambertMaterial({ color: 0xd9cfae });
const TAPE = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
const FLOOR_RAY_TOP = 3;   // m above the anchor the floor ray starts from
const FLOOR_RAY_LEN = 6;   // m

const found = new Set<string>();
let readerOpen: NoteDef | null = null;
let offInteract: (() => void) | null = null;

export function notesFound(): number { return found.size; }
export function noteFound(id: string): boolean { return found.has(id); }
export function resetNotes(): void { found.clear(); readerOpen = null; }

const indexOf = (id: string): number => NOTES.findIndex((n) => n.id === id);

/** Build every note whose anchor exists. Returns the disposer (world dispose / state exit). */
export function placeNotes(world: World): () => void {
  const disposers: Array<() => void> = [];
  const up = new THREE.Vector3();
  const at = new THREE.Vector3();
  NOTES.forEach((def, i) => {
    const anchor = world.anchor(def.anchor);
    if (!anchor) { log.warn('story', `note ${def.id}: anchor "${def.anchor}" missing`); return; }
    anchor.getWorldPosition(at);
    // drop onto the floor under the spot: a downward ray from above the anchor
    const hit = world.collision.raycast(up.set(at.x + def.dx, at.y + FLOOR_RAY_TOP, at.z + def.dz), new THREE.Vector3(0, -1, 0), FLOOR_RAY_LEN);
    const floorY = hit ? at.y + FLOOR_RAY_TOP - hit.dist : at.y;
    const p = new THREE.Vector3(at.x + def.dx, floorY + 0.01, at.z + def.dz);

    const geo = def.kind === 'tape' ? new THREE.BoxGeometry(0.1, 0.02, 0.06) : new THREE.PlaneGeometry(0.2, 0.27);
    const mesh = new THREE.Mesh(geo, def.kind === 'tape' ? TAPE : PAPER);
    mesh.name = `story.note.${def.id}`;
    mesh.rotation.set(-Math.PI / 2, def.yaw, 0);
    if (def.kind === 'tape') mesh.rotation.set(0, def.yaw, 0);
    mesh.position.copy(world.root.worldToLocal(p.clone()));
    world.root.add(mesh);

    const box = new THREE.Box3().setFromCenterAndSize(p.clone().setY(p.y + 0.5), new THREE.Vector3(1.1, 1.1, 1.1));
    const off = world.interact.add({
      id: `story.note.${def.id}`,
      box,
      maxDist: 2.0,
      priority: 1,
      enabled: () => readerOpen === null,
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

/** Open a note's reader (from the interactable, or from the journal). */
export function openNote(def: NoteDef): void {
  if (readerOpen) return;
  readerOpen = def;
  found.add(def.id);
  app.input.setMode('ui');
  app.input.exitLock();
  offInteract?.();
  offInteract = app.input.on('interact', (down) => { if (down && readerOpen) closeNote(); });
  app.ui.panel(READER_PANEL, (el) => buildReader(el, def));
}

export function closeNote(): void {
  if (!readerOpen) return;
  app.ui.closePanel(READER_PANEL);
}

/** Journal: every note of the run, found ones are readable again. */
export function openJournal(): void {
  app.ui.closePanel(READER_PANEL);
  readerOpen = null;
  app.input.setMode('ui');
  app.input.exitLock();
  app.ui.panel(JOURNAL_PANEL, (el) => buildJournal(el));
}

function restoreWalk(): void {
  offInteract?.();
  offInteract = null;
  readerOpen = null;
  if (app.input.mode === 'ui') {
    app.input.setMode('walk');
    void app.input.requestLock();
  }
}

function buildReader(el: HTMLElement, def: NoteDef): () => void {
  modalPanel(el, { escClose: true, dim: true });
  const i = indexOf(def.id);
  const f = frame(el, { title: t(`story.note.${def.id}.t`), variant: 'brass' });
  if (def.kind === 'tape') h('p', 'px-hint', f.body, t('story.ui.tapeLabel'));
  h('p', 'px-body', f.body, t(`story.note.${def.id}.b`));
  h('p', 'px-hint', f.body, t('story.ui.noteCount', { i: i + 1, total: NOTES.length }));
  button(f.body, { label: t('story.ui.close'), kind: 'primary', onClick: () => app.ui.closePanel(READER_PANEL) });
  button(f.body, { label: t('story.ui.journal'), onClick: () => openJournal() });
  h('p', 'px-hint', f.body, t('story.ui.readHint'));
  focusFirst(el);
  return () => restoreWalk();
}

function buildJournal(el: HTMLElement): () => void {
  modalPanel(el, { escClose: true, dim: true });
  const f = frame(el, { title: t('story.ui.journal'), variant: 'brass' });
  h('p', 'px-hint', f.body, t('story.ui.journalCount', { found: found.size, total: NOTES.length }));
  if (found.size === 0) h('p', 'px-body', f.body, t('story.ui.journalEmpty'));
  for (const def of NOTES) {
    if (!found.has(def.id)) continue;
    button(f.body, {
      label: t(`story.note.${def.id}.t`),
      onClick: () => { app.ui.closePanel(JOURNAL_PANEL); openNote(def); },
    });
  }
  h('p', 'px-hint', f.body, t('story.ui.journalHint'));
  focusFirst(el);
  return () => restoreWalk();
}
