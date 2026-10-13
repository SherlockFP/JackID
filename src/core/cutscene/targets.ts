/**
 * Cutscene target resolution (CUTSCENE WP). Turns a `CutTarget` (literal point, cutscene actor bone, named world
 * anchor, player eye, machine anchor) into a world-space point, every frame. Unknown targets resolve to the origin
 * and warn once, so a missing anchor never breaks a scene.
 */
import * as THREE from 'three';
import type { MannequinActor } from '@/kit/types';
import type { CutTarget } from './types';
import { app } from '../app';
import { log } from '../log';

const HEAD_HEIGHT = 1.6;       // m, fallback head point for actors without a skeleton yet

/** Actor lookup for `{ actor }` targets; the cutscene passes its own table. */
export type ActorLookup = (key: string) => MannequinActor | undefined;

/** World point of `tg` written into `out`. `role` picks the default bone for actors. */
export function resolveTarget(tg: CutTarget, role: 'pos' | 'look', out: THREE.Vector3, actors: ActorLookup): THREE.Vector3 {
  if (Array.isArray(tg)) return out.set(tg[0], tg[1], tg[2]);
  if ('actor' in tg) return actorPoint(tg, role, out, actors);
  if ('anchor' in tg) {
    const obj = app.world?.anchor(tg.anchor) ?? null;
    if (!obj) return missing(`anchor:${tg.anchor}`, `cutscene: anchor "${tg.anchor}" not found`, out);
    obj.getWorldPosition(out);
    return addOffset(out, tg.offset);
  }
  if ('player' in tg) {
    const p = app.player;
    if (!p) return missing('player', 'cutscene: no local player for a player target', out);
    if (tg.player !== 'local') log.warnOnce('cutscene:remote-player', 'cutscene', 'remote player targets fall back to the local eye');
    p.camera.getWorldPosition(out);
    return addOffset(out, tg.offset);
  }
  if ('machine' in tg) {
    const m = app.world?.machine(tg.machine);
    if (!m) return missing(`machine:${tg.machine}`, `cutscene: machine "${tg.machine}" not found`, out);
    const anchor = tg.anchor ? m.model?.anchors?.[tg.anchor] : undefined;
    (anchor ?? m.root).getWorldPosition(out);
    return addOffset(out, tg.offset);
  }
  return out.set(0, 0, 0);
}

function actorPoint(tg: { actor: string; bone?: string; offset?: [number, number, number] }, role: 'pos' | 'look',
  out: THREE.Vector3, actors: ActorLookup): THREE.Vector3 {
  const a = actors(tg.actor);
  if (!a) return missing(`actor:${tg.actor}`, `cutscene: actor "${tg.actor}" is not on stage`, out);
  const bone = tg.bone ?? (role === 'look' ? 'Head' : 'root');   // i18n-ok: skeleton joint name
  const obj = bone === 'root' ? null : a.bone(bone);
  if (obj) obj.getWorldPosition(out);
  else {
    a.root.getWorldPosition(out);
    if (role === 'look' && bone === 'Head') out.y += HEAD_HEIGHT;
  }
  return addOffset(out, tg.offset);
}

function addOffset(out: THREE.Vector3, o?: [number, number, number]): THREE.Vector3 {
  if (o) { out.x += o[0]; out.y += o[1]; out.z += o[2]; }
  return out;
}

function missing(key: string, msg: string, out: THREE.Vector3): THREE.Vector3 {
  log.warnOnce(`cutscene:target:${key}`, 'cutscene', msg);
  return out.set(0, 0, 0);
}
