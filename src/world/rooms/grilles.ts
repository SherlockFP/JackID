/**
 * Brass grille plates for the sealed wings (WAVE 24 §2): the wing name with SEALED or KEY READY (amber padlock), gone
 * when the wing opens. Each sealed grille has two interactables: Spend KEY (n) and BUY 1.5× quota. Both send the tycoon
 * request `{op:'zone', zone, key}` through the rooms bridge. Behind the bars a marquee blinks (zone flicker lights);
 * a key that becomes ready plays the music-box cue, pulses the light and names the nearest key-ready grille.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { LabelPart, NeonPart } from '@/kit/types';
import type { ZoneId } from '@/core/types';
import type { Interactable, InteractionSystem, WorldLights } from '../types';
import type { LightHint } from '../sys/arch';
import { createRng, type Rng } from '@/core/rng';
import { t } from '@/core/i18n';
import { app } from '@/core/app';
import { roomsBridge, type WingId, type WingState } from './bridge';
import {
  GRILLES, faceDeg, nearestKeyReady, plateView, plateX, shouldCue, signX, type GrilleSpec, type PlateView,
} from './logic';

const PLATE_W = 1.5;
const PLATE_H = 0.5;
const PLATE_Y = 2.3;
const POLL_S = 0.25;
/** Half the doorway width (m): the grille gaps are 4 m wide (level.ts). */
const GRILLE_HALF_W = 2;
const SIGN_FLASH_S = 0.12;
const AMBER = 0xffb020;
const BRASS = 0x8c6b29;

interface Plate {
  spec: GrilleSpec;
  zone: ZoneId;
  root: THREE.Group;
  label: LabelPart;
  sign: NeonPart;
  lockBody: THREE.Mesh;
  lockShackle: THREE.Mesh;
  matSealed: THREE.Material;
  matKey: THREE.Material;
  view: PlateView | null;
  text: string;
  state: WingState | undefined;
  blinkIn: number;
  offIn: number;
  pulseIn: number;
}

export interface GrilleBuild {
  root: THREE.Group;
  lights: LightHint[];
  update(dt: number): void;
  /** Re-read the bridge on the next update (after a run change). */
  refresh(): void;
  dispose(): void;
}

export interface GrilleCtx {
  kit: KitX;
  seed: number;
  isOpen: (zone: ZoneId) => boolean;
  interact?: InteractionSystem;
  lights?: WorldLights;
}

export function buildGrilles(ctx: GrilleCtx): GrilleBuild {
  const { kit, isOpen } = ctx;
  const root = kit.group('rooms:grilles');
  const lights: LightHint[] = [];
  const plates: Plate[] = [];
  const unsubs: Array<() => void> = [];
  const rng: Rng = createRng(`rooms:grille:${ctx.seed}`);
  const brass = kit.mat({ color: BRASS });
  let pollIn = 0;

  const boxAt = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.Box3 =>
    new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));

  for (const spec of GRILLES) {
    const zone = spec.wing as ZoneId;
    const px = plateX(spec);
    const face = THREE.MathUtils.degToRad(faceDeg(spec));
    const matSealed = kit.mat({ color: 0x3a3a40 });
    const matKey = kit.mat({ color: AMBER });

    // plate: brass backplate, label, padlock on the right
    const plate = kit.group(`rooms:plate:${spec.wing}`);
    plate.position.set(px, PLATE_Y, spec.z);
    plate.rotation.y = face;
    root.add(plate);
    kit.box(PLATE_W, PLATE_H, 0.05, brass, { parent: plate });
    const label = kit.label({ text: '', w: 1.1, h: 0.34, color: 0x20140a, bg: null });
    label.mesh.position.set(-0.12, 0, 0.035);
    plate.add(label.mesh);
    const lock = kit.group('padlock');
    lock.position.set(0.6, -0.02, 0.04);
    plate.add(lock);
    const lockBody = kit.box(0.18, 0.14, 0.05, matSealed, { parent: lock, pos: [0, -0.03, 0] });
    const lockShackle = kit.torus(0.06, 0.018, matSealed, { parent: lock, pos: [0, 0.06, 0], arc: Math.PI });

    // marquee behind the bars, inside the room
    const sign = kit.neon({ text: { key: `wroom.wing.${spec.wing}` }, h: 0.42, color: spec.neon, flicker: 0.2 });
    sign.root.position.set(signX(spec), spec.signY, spec.z);
    sign.root.rotation.y = face;
    root.add(sign.root);
    lights.push({
      id: `rooms:sign:${spec.wing}`,
      pos: [signX(spec) - spec.side * 0.3, spec.signY, spec.z],
      color: spec.neon, intensity: 0.5, range: 3.5, flicker: 'BUZZ', zone,
    });

    const p: Plate = {
      spec, zone, root: plate, label, sign, lockBody, lockShackle, matSealed, matKey,
      view: null, text: '', state: undefined, blinkIn: rng.float(1, 4), offIn: 0, pulseIn: 0,
    };
    plates.push(p);

    if (ctx.interact) {
      // The whole doorway answers (4 m wide, floor to lintel), not just half the plate. Both actions cover it: with a Key in hand
      // the Key spend wins; with none the BUY line shows. (Before, the upper z-half was the Key and the lower z-half was BUY.)
      const doorBox = (): THREE.Box3 => boxAt(Math.min(px, spec.x) - 0.4, 0, spec.z - GRILLE_HALF_W, Math.max(px, spec.x) + 0.4, 3.2, spec.z + GRILLE_HALF_W);
      const keyBox = doorBox();
      const buyBox = doorBox();
      const wingName = (): string => t(`wroom.wing.${spec.wing}`);
      const keyAct: Interactable = {
        id: `rooms:key:${spec.wing}`,
        box: keyBox,
        maxDist: 2.8,
        priority: 2,
        enabled: () => p.view !== null && p.view !== 'gone' && roomsBridge().keys() > 0,
        label: () => t('wroom.act.key', { n: String(roomsBridge().keys()) }),
        sub: () => t('wroom.sub.opens', { wing: wingName() }),
        onInteract: () => { if (p.view !== null && p.view !== 'gone') roomsBridge().sendZone(spec.wing, true); },
      };
      const buyAct: Interactable = {
        id: `rooms:buy:${spec.wing}`,
        box: buyBox,
        maxDist: 2.8,
        priority: 1,
        enabled: () => p.view !== null && p.view !== 'gone' && roomsBridge().keys() <= 0,
        label: () => t('wroom.act.buy'),
        sub: () => t('wroom.sub.opens', { wing: wingName() }),
        onInteract: () => { if (p.view !== null && p.view !== 'gone') roomsBridge().sendZone(spec.wing, false); },
      };
      unsubs.push(ctx.interact.add(keyAct), ctx.interact.add(buyAct));
    }
  }

  function applyView(p: Plate, view: PlateView, state: WingState): void {
    p.view = view;
    p.root.visible = view !== 'gone';
    p.sign.setOn(true);
    const mat = view === 'keyReady' ? p.matKey : p.matSealed;
    p.lockBody.material = mat;
    p.lockShackle.material = mat;
    if (view === 'gone') { p.offIn = 0; return; }
    p.blinkIn = rng.float(2.5, 5.5);
  }

  function setPlateText(p: Plate): void {
    const status = t(p.view === 'keyReady' ? 'wroom.status.keyReady' : 'wroom.status.sealed');
    const next = t('wroom.plate.line', { wing: t(`wroom.wing.${p.spec.wing}`), status });
    if (next === p.text) return;
    p.text = next;
    p.label.setText(next);
  }

  function cue(p: Plate, states: Partial<Record<WingId, WingState>>): void {
    try {
      app.audio.play('chime', { vol: 0.7, priority: 7 });        // music-box cue
      app.audio.music.stinger('discovery', { vol: 0.5 });
    } catch { /* audio is optional here */ }
    ctx.lights?.pulse(p.zone, { color: AMBER, mul: 1.6, dur: 1.2 });
    const pos = app.player?.pos;
    const near = pos ? nearestKeyReady({ x: pos.x, z: pos.z }, states) : null;
    const msg = near
      ? t('wroom.toast.keyDist', { wing: t(`wroom.wing.${near.wing}`), m: String(Math.round(near.dist)) })
      : t('wroom.toast.key', { wing: t(`wroom.wing.${p.spec.wing}`) });
    try { app.ui.toast(msg, 'good', 3.5); } catch { /* UI optional here */ }
    if (near) {
      const target = plates.find((q) => q.spec.wing === near.wing);
      if (target) ctx.lights?.pulse(target.zone, { color: AMBER, mul: 1.4, dur: 0.9 });
    }
  }

  function poll(): void {
    const bridge = roomsBridge();
    const states: Partial<Record<WingId, WingState>> = {};
    for (const p of plates) states[p.spec.wing] = bridge.wingState(p.spec.wing);
    for (const p of plates) {
      const state = states[p.spec.wing] ?? 'sealed';
      const edge = shouldCue(p.state, state);
      p.state = state;
      const view = plateView(state, isOpen(p.zone));
      if (view !== p.view) applyView(p, view, state);
      if (view !== 'gone') setPlateText(p);
      if (edge && view !== 'gone') cue(p, states);
    }
  }

  return {
    root,
    lights,
    update(dt: number): void {
      pollIn -= dt;
      if (pollIn <= 0) { pollIn = POLL_S; poll(); }
      for (const p of plates) {
        if (p.view === null || p.view === 'gone') continue;
        if (p.offIn > 0) {
          p.offIn -= dt;
          if (p.offIn <= 0) p.sign.setOn(true);
        }
        p.blinkIn -= dt;
        if (p.blinkIn <= 0) {
          p.blinkIn = rng.float(2.5, 5.5);
          ctx.lights?.flicker(p.zone, 0.6, 0.3);
          p.sign.setOn(false);
          p.offIn = SIGN_FLASH_S;
        }
        if (p.view === 'keyReady') {
          p.pulseIn -= dt;
          if (p.pulseIn <= 0) {
            p.pulseIn = 2.0;
            ctx.lights?.pulse(p.zone, { color: AMBER, mul: 1.2, dur: 0.5 });
          }
        }
      }
    },
    refresh(): void { pollIn = 0; },
    dispose(): void {
      for (const u of unsubs.splice(0)) u();
    },
  };
}
