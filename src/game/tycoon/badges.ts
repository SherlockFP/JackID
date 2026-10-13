/**
 * Service plate badges (GAME-TYCOON visuals). A brass plate with level pips, a staff badge and horseshoes, built from
 * plain three.js primitives with unlit PSX materials. They are mounted on the SLOT GROUP (never `machine.root`, DECISIONS
 * C26), so the world can swap or remove a machine without losing the plate. Pure build + sync; no tween loop here.
 */
import * as THREE from 'three';
import type { InstanceId } from '@/core/types';
import type { TycoonApi } from '@/game/tycoon.types';

/** Name of the group under the slot group. Sync replaces it, so there is never more than one. */
export const BADGE_GROUP_NAME = 'tyc.badges';

const BRASS = 0xc9a24a;
const GOLD = 0xffd060;
const SILVER = 0xd8dde6;
const STAR = 0xffe9a0;
const HORSESHOE = 0x9aa0a6;

/** Plate size (GDD §3.7.1: 0.12 × 0.08 m). */
const PLATE_W = 0.12;
const PLATE_H = 0.08;

function mat(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

/** Staff badge tier for a staff track level: brass ≥ L10, silver ≥ L25, gold ≥ L50, none below. */
export function staffBadgeColor(level: number): number | null {
  if (level >= 50) return GOLD;
  if (level >= 25) return SILVER;
  if (level >= 10) return BRASS;
  return null;
}

/**
 * Build the badge group for one instance. `at` is the plate origin in slot-group space (the plate faces +Z).
 * Pips: one star per 10 Payout levels (max 5). Horseshoes: one per 2 Luck levels (max 5). Staff badge: see above.
 */
export function buildServiceBadges(api: TycoonApi, instance: InstanceId, at: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.name = BADGE_GROUP_NAME;
  g.position.copy(at);

  const payout = api.level(`upg.${instance}.payout`);
  const luck = api.level(`upg.${instance}.luck`);
  const staff = api.level(`upg.${instance}.staff`);

  const plate = new THREE.Mesh(new THREE.BoxGeometry(PLATE_W, PLATE_H, 0.004), mat(payout >= 50 ? GOLD : BRASS));
  plate.name = 'tyc.plate';
  g.add(plate);

  const stars = Math.min(5, Math.floor(payout / 10));
  const starGeo = new THREE.OctahedronGeometry(0.008, 0);
  for (let i = 0; i < stars; i++) {
    const s = new THREE.Mesh(starGeo, mat(STAR));
    s.position.set(-PLATE_W / 2 + 0.012 + i * 0.016, PLATE_H / 2 - 0.012, 0.004);
    s.name = 'tyc.star';
    g.add(s);
  }

  const staffColor = staffBadgeColor(staff);
  if (staffColor !== null) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.011, 8), mat(staffColor));
    disc.position.set(PLATE_W / 2 - 0.014, -PLATE_H / 2 + 0.014, 0.0045);
    disc.name = 'tyc.staffBadge';
    g.add(disc);
  }

  const shoes = Math.min(5, Math.floor(luck / 2));
  const shoeGeo = new THREE.TorusGeometry(0.008, 0.0025, 4, 8, Math.PI);
  for (let i = 0; i < shoes; i++) {
    const h = new THREE.Mesh(shoeGeo, mat(HORSESHOE));
    h.position.set(-PLATE_W / 2 + 0.014 + i * 0.018, -PLATE_H / 2 + 0.016, 0.0045);
    h.rotation.z = Math.PI;
    h.name = 'tyc.horseshoe';
    g.add(h);
  }
  return g;
}

/**
 * Replace the instance's badge group under `slotGroup`. Safe to call on every tycoon change; disposes the old
 * geometry and materials. Returns the new group (already parented).
 */
export function syncServiceBadges(slotGroup: THREE.Object3D, api: TycoonApi, instance: InstanceId, at: THREE.Vector3): THREE.Group {
  for (const old of slotGroup.children.filter((c) => c.name === BADGE_GROUP_NAME)) disposeBadges(old);
  const g = buildServiceBadges(api, instance, at);
  slotGroup.add(g);
  return g;
}

/** Remove and free a badge group (geometry and materials are per-group, so they are safe to drop). */
export function disposeBadges(group: THREE.Object3D): void {
  group.removeFromParent();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
  });
}

/**
 * Juice for a fresh purchase: the plate pops from `k = 0` (just bought) to `k = 1` (settled). Call from the
 * world's tween/timer callback; scale overshoots to 1.35 then settles.
 */
export function popBadges(group: THREE.Object3D, k: number): void {
  const t = Math.min(1, Math.max(0, k));
  group.scale.setScalar(t < 0.4 ? 1 + 0.35 * Math.sin((t / 0.4) * Math.PI) : 1);
}
