/**
 * Recorded sounds (vendored CC0 / CC BY packs, see docs/ASSETS.md and public/assets/vendor/SFX_INDEX.md) wired in as
 * sample-backed recipes. Everything here is lazy and optional:
 *  - a clip is fetched + decoded the first time a recipe asks for it (the engine also warms the small ones a few seconds
 *    after start); until it is decoded, or when the file fails to load, the recipe's procedural version plays instead;
 *  - clips are peak-normalised at play time (`Kit.clip`), so a recipe's `vol` is its final peak and the recordings sit at
 *    the same loudness as the synthesised set whatever the file's level; per-clip `off`/`dur` trim the long tails;
 *  - the long files (cheers, horror hits) share a small LRU pool so only a handful stay decoded in memory;
 *  - variants are picked at random from the clips that are ready (never the same twice in a row) with ±pitch jitter
 *    from the seeded audio rng.
 * `installReal` replaces or layers the procedural recipes in `SFX_DEFS` and adds the new names. Calm switches the horror
 * hits off (`setAudioCalm`).
 */
import type { PlayOpts } from './types';
import { Kit, pick, rnd, sampleStore } from './synth';
import type { SfxDef } from './sfx';

const V = `${import.meta.env.BASE_URL}assets/vendor/`;

/** One recorded clip: file + the window worth playing (seconds into the file) + a loudness multiplier. */
export interface Clip { u: string; off?: number; dur?: number; lv?: number }
type Group = readonly Clip[];
const c = (dir: string, file: string, o: Omit<Clip, 'u'> = {}): Clip => ({ u: `${V}${dir}/${file}`, ...o });
const many = (dir: string, files: string[], o: Omit<Clip, 'u'> = {}): Clip[] => files.map((f) => c(dir, f, o));

const OWL = 'sfx-owlish-more-sfx', LAL = 'sfx-laleksic-various', RUB = 'sfx-rubberduck-metal-wood', QDOOR = 'sfx-qubodup-doors';
const GROUPS = {
  ring: [c('sfx-chirptone-ringtone', 'chirptone.wav')],
  phoneClick: [c(OWL, 'phone2.wav')],
  coinsSmall: many(OWL, ['money_07.wav', 'money_12.wav', 'money_13.wav', 'money_15.wav', 'money_27.wav', 'money_29.wav'], { lv: 0.8 }),
  coinsBig: [c(OWL, 'money_16.wav'), c(LAL, 'pickup_coins.wav')],
  bills: [c(OWL, 'money_31.wav')],
  keys: [...many(RUB, ['keys_01.ogg', 'keys_03.ogg', 'keys_05.ogg', 'keys_07.ogg']), c(LAL, 'pickup_keys.wav')],
  keyTurn: many(OWL, ['key_lock_door_04.wav', 'key_lock_door_11.wav', 'key_lock_door_39.wav']),
  lockClunk: [c(OWL, 'key_lock_door_51.wav'), c(LAL, 'lock.wav'), c(RUB, 'lock_open_01.ogg')],
  latch: [c(OWL, 'key_lock_door_30.wav')],
  rattle: [c(OWL, 'key_lock_door_48.wav', { dur: 1.2 }), c(LAL, 'cant_open.wav')],
  doorOpenWood: [...many(QDOOR, Array.from({ length: 8 }, (_, i) => `qubodup-DoorOpen0${i + 1}.ogg`)), c(LAL, 'door_open.wav')],
  doorCloseWood: [...many(QDOOR, Array.from({ length: 10 }, (_, i) => `qubodup-DoorClose${String(i + 1).padStart(2, '0')}.ogg`)), c(RUB, 'wood_close_01.ogg'), c(RUB, 'wood_close_02.ogg'), c(LAL, 'door_close.wav')],
  doorOpenMetal: [c(RUB, 'metal_open_01.ogg')],
  doorCloseMetal: [c(RUB, 'metal_close_01.ogg')],
  slamWood: [c(RUB, 'wood_slam_01.ogg'), c(RUB, 'wood_slam_02.ogg')],
  slamMetal: [c(RUB, 'metal_slam_01.ogg'), c(LAL, 'clang_metal.wav')],
  squeakOpen: [c(LAL, 'door_creak_open.wav')],
  squeakClose: [c(LAL, 'door_creak_close.wav')],
  squeak: [c(RUB, 'wood_squeak_01.ogg'), c(RUB, 'wood_squeak_02.ogg')],
  floorCreak: many(LAL, ['floor_creak1.wav', 'floor_creak2.wav', 'floor_creak3.wav'], { dur: 1.6 }),
  knock: [c(RUB, 'wood_hit_01.ogg'), c(RUB, 'wood_hit_02.ogg')],
  liftDoor: [c('sfx-pagdev-elevator-door', 'elevator_door.wav')],
  bell: [c(LAL, 'bell.wav', { dur: 1.7 })],
  drawer: [c(LAL, 'drawer_open.wav')],
  rat: { attack: [c('sfx-qubodup-rat', 'rat_attack.ogg')], pain: [c('sfx-qubodup-rat', 'rat_pain.ogg')], death: [c('sfx-qubodup-rat', 'rat_death.ogg')] },
  // The long files: loaded one at a time on demand and kept in a small LRU pool (POOL_MAX).
  cheer: [
    [c('sfx-quendel-crowd-cheering', 'quendel_06_soft_cheering_ii.mp3', { off: 1, dur: 2.6 }), c('sfx-quendel-crowd-cheering', 'quendel_05_soft_cheering_i.mp3', { off: 1, dur: 2.6 })],                       // big
    [c('sfx-quendel-crowd-cheering', 'quendel_04_strong_cheering_ii_short.mp3', { off: 0.5, dur: 3.6 }), c('sfx-quendel-crowd-cheering', 'quendel_08_rhythmic_cheering.mp3', { off: 0.5, dur: 3.6 })],   // huge
    [c('sfx-quendel-crowd-cheering', 'quendel_03_strong_cheering_i.mp3', { off: 0.5, dur: 4.6 }), c('sfx-quendel-crowd-cheering', 'quendel_04_strong_cheering_ii_short.mp3', { off: 0.5, dur: 4.6 })],  // mega
    [c('sfx-quendel-crowd-cheering', 'quendel_03_strong_cheering_i.mp3', { off: 0.5, dur: 6 }), c('sfx-quendel-crowd-cheering', 'quendel_08_rhythmic_cheering.mp3', { off: 0.5, dur: 6 })],               // jackpot
  ] as readonly Group[],
  // Horror hits, quietest/shortest first so `param` 0..1 climbs from a quick scare to a heavy one.
  horror: [
    c('sfx-psychhead-horror-hits', 'high_13.wav', { dur: 2.2 }),
    c('sfx-psychhead-horror-hits', 'high_06.wav', { dur: 2.6 }),
    c('sfx-psychhead-horror-hits', 'mid_07.wav', { dur: 2.6 }),
    c('sfx-psychhead-horror-hits', 'mid_06.wav', { dur: 3.2 }),
    c('sfx-psychhead-horror-hits', 'bassy_01.wav', { dur: 2.8 }),
    c('sfx-psychhead-horror-hits', 'very_bassy_02.wav', { dur: 3 }),
    c('sfx-psychhead-horror-hits', 'very_bassy_03.wav', { dur: 3 }),
    c('sfx-psychhead-horror-hits', 'bassy_05.wav', { dur: 3.2 }),
  ] as Group,
};

/** The casino-floor crowd loop (27 s). The ambience bed crossfades it with itself. */
export const CROWD_LOOP = `${V}sfx-starninjas-crowd/crowd_shouting.ogg`;

/** Small files the engine warms in the background a few seconds after start (the long ones stay on demand). */
export const WARM_URLS: string[] = [
  ...GROUPS.ring, ...GROUPS.phoneClick, ...GROUPS.coinsSmall, ...GROUPS.coinsBig, ...GROUPS.bills, ...GROUPS.keys, ...GROUPS.keyTurn,
  ...GROUPS.lockClunk, ...GROUPS.latch, ...GROUPS.rattle, ...GROUPS.doorOpenWood, ...GROUPS.doorCloseWood, ...GROUPS.doorOpenMetal,
  ...GROUPS.doorCloseMetal, ...GROUPS.slamWood, ...GROUPS.slamMetal, ...GROUPS.squeakOpen, ...GROUPS.squeakClose, ...GROUPS.squeak,
  ...GROUPS.knock, ...GROUPS.liftDoor, ...GROUPS.bell, ...GROUPS.drawer, ...GROUPS.rat.attack, ...GROUPS.rat.pain, ...GROUPS.rat.death,
].map((x) => x.u).filter((u, i, a) => a.indexOf(u) === i);

// ── Calm ──────────────────────────────────────────────────────────────────────────────────────────
let calm = false;
/** Calm Mode: no recorded horror hits (the engine exposes this as `setCalm`; main.ts passes `settings.calm`). */
export function setAudioCalm(on: boolean): void { calm = on; }
export const audioCalm = (): boolean => calm;

// ── pool + picking ────────────────────────────────────────────────────────────────────────────────
const POOL_MAX = 6;
const pool: string[] = [];
/** Mark a long clip as just used; the least recently used beyond POOL_MAX is dropped from the decoded store (reloads on demand). */
function touch(u: string): void {
  const i = pool.indexOf(u);
  if (i >= 0) pool.splice(i, 1);
  pool.push(u);
  while (pool.length > POOL_MAX) { const old = pool.shift(); if (old) sampleStore.delete(old); }
}
const isLong = (cl: Clip): boolean => cl.u.includes('quendel') || cl.u.includes('psychhead');
const lastPick = new WeakMap<Group, string>();

interface ClipOpts { at?: number; vol?: number; rate?: number; rand?: number; dur?: number; a?: number; r?: number; pan?: number }
/** Play a random ready clip of `group` (peak `vol`); false when none is decoded yet (and kicks off the next load). */
function play(k: Kit, group: Group, o: ClipOpts = {}): boolean {
  const ready = group.filter((x) => sampleStore.has(x.u));
  if (ready.length < group.length) { const next = group.find((x) => !sampleStore.has(x.u)); if (next) k.host.sample(next.u); }   // lazy: load one more
  if (!ready.length) return false;
  const prev = lastPick.get(group);
  const cand = ready.length > 1 ? ready.filter((x) => x.u !== prev) : ready;
  const cl = pick(cand);
  lastPick.set(group, cl.u);
  const ok = k.clip(cl.u, { ...o, vol: (o.vol ?? 0.5) * (cl.lv ?? 1), off: cl.off, dur: Math.min(cl.dur ?? Infinity, o.dur ?? Infinity) });
  if (ok && isLong(cl)) touch(cl.u);
  return ok;
}

/**
 * Replace and layer recipes in the engine's table. `defs` is `SFX_DEFS`; every recipe keeps its procedural body as the
 * fallback. Sample levels are divided by the recipe's loudness trim so the final peak is the number written here.
 */
export function installReal(defs: Map<string, SfxDef>, makeDef: (names: string | string[], run: (k: Kit, o: PlayOpts) => number, meta?: SfxDef['meta']) => void): void {
  const trimOf = (n: string): number => defs.get(n)?.meta.gain ?? 1;
  /** Run `real` first; if it plays nothing the original procedural recipe runs. `real` gets the trim compensation `t`. */
  const replace = (names: string[], real: (k: Kit, o: PlayOpts, t: number) => number | null): void => {
    for (const n of names) {
      const d = defs.get(n);
      if (!d) continue;
      const orig = d.run, t = 1 / (d.meta.gain ?? 1);
      d.run = (k, o) => real(k, o, t) ?? orig(k, o);
    }
  };
  /** Run the original, then add recorded layers on top. */
  const layer = (names: string[], add: (k: Kit, o: PlayOpts, t: number) => number): void => {
    for (const n of names) {
      const d = defs.get(n);
      if (!d) continue;
      const orig = d.run, t = 1 / (d.meta.gain ?? 1);
      d.run = (k, o) => Math.max(orig(k, o), add(k, o, t));
    }
  };

  // ── phone: the Chirptone ringtone, two rings (one chunk per ring in a loop) ──
  replace(['phoneRing'], (k, o, t) => {
    if (!play(k, GROUPS.ring, { vol: 0.5 * t, rand: 0.01, r: 0.08 })) return null;
    if (o.loop) return 2.9;
    play(k, GROUPS.ring, { at: 3, vol: 0.5 * t, rand: 0.01, r: 0.08 });
    return 5.6;
  });
  layer(['phonePickup'], (k, _o, t) => { play(k, GROUPS.phoneClick, { vol: 0.4 * t }); return 0.2; });

  // ── doors, locks, chain at home ──
  replace(['door'], (k, _o, t) => {
    if (!play(k, GROUPS.doorOpenWood, { vol: 0.5 * t })) return null;
    play(k, GROUPS.doorCloseWood, { at: 0.75, vol: 0.55 * t });
    return 1.8;
  });
  replace(['doorCreak'], (k, _o, t) => (play(k, GROUPS.squeakOpen, { vol: 0.42 * t }) ? 1.6 : null));
  replace(['doorSlam'], (k, _o, t) => (play(k, GROUPS.slamWood, { vol: 0.62 * t }) ? 0.6 : null));
  replace(['lockTurn'], (k, _o, t) => {
    if (!play(k, GROUPS.keyTurn, { vol: 0.5 * t })) return null;
    play(k, GROUPS.lockClunk, { at: 0.32, vol: 0.6 * t });
    return 0.9;
  });
  layer(['chainRattle'], (k, _o, t) => {
    play(k, GROUPS.rattle, { vol: 0.28 * t, dur: 0.7, rand: 0.1 });
    play(k, GROUPS.latch, { at: 0.5, vol: 0.4 * t });
    return 0.9;
  });
  replace(['knock'], (k, _o, t) => {
    if (!GROUPS.knock.some((x) => sampleStore.has(x.u))) { k.host.sample(GROUPS.knock[0].u); return null; }
    let at = 0;
    for (let i = 0; i < 3; i++) { play(k, GROUPS.knock, { at, vol: rnd(0.55, 0.7) * t, rand: 0.06 }); at += rnd(0.3, 0.36); }
    return at + 0.2;
  });
  layer(['bedCreak', 'creak'], (k, o, t) => (o.loop ? 0 : (play(k, GROUPS.floorCreak, { vol: 0.2 * t, rand: 0.12 }) ? 1.6 : 0)));

  // ── lift: the two-tone ding on a real bell (A5 then a fourth lower), the doors slide after it ──
  replace(['liftDing'], (k, _o, t) => {
    if (!play(k, GROUPS.bell, { vol: 0.5 * t, rand: 0.01 })) return null;
    play(k, GROUPS.bell, { at: 0.45, vol: 0.46 * t, rate: 0.749, rand: 0.01 });
    play(k, GROUPS.liftDoor, { at: 1.1, vol: 0.28 * t, dur: 2.6, rand: 0.03 });
    return 3.6;
  });
  replace(['elevatorDing'], (k, _o, t) => {
    if (!play(k, GROUPS.bell, { vol: 0.5 * t, rate: 1.05, rand: 0.01 })) return null;
    play(k, GROUPS.bell, { at: 0.42, vol: 0.44 * t, rate: 0.79, rand: 0.01 });
    return 1.9;
  });

  // ── cash and coin handling (terminal, pawn, shop) ──
  layer(['coinInsert'], (k, _o, t) => { play(k, GROUPS.coinsSmall, { vol: 0.3 * t }); return 0.3; });
  layer(['purchase', 'cashRegister'], (k, _o, t) => {
    play(k, GROUPS.bills, { at: 0.05, vol: 0.28 * t, dur: 0.8 });
    play(k, GROUPS.coinsBig, { at: 0.2, vol: 0.34 * t, dur: 0.9 });
    return 1.2;
  });

  // ── crowd cheers by win tier: param 0.4 big, 0.7 huge, 0.9 mega, 1 jackpot (winJingle) ──
  replace(['cheer'], (k, o, t) => {
    const p = o.param ?? 0.5, tier = p >= 0.95 ? 3 : p >= 0.8 ? 2 : p >= 0.6 ? 1 : 0;
    const g = GROUPS.cheer[tier], len = g[0].dur ?? 3;
    if (!play(k, g, { vol: (0.34 + tier * 0.04) * t, a: 0.25, r: 0.9, rand: 0.03 })) return null;
    return len + 0.4;
  });

  // ── new names (other lanes call these) ──
  makeDef(['doorOpen', 'doorOpenWood'], (k, _o) => (play(k, GROUPS.doorOpenWood, { vol: 0.5 }) ? 1.1 : (doorFallback(k, 0), 0.5)), { pri: 5, max: 3 });
  makeDef(['doorClose', 'doorCloseWood'], (k) => (play(k, GROUPS.doorCloseWood, { vol: 0.55 }) ? 1.1 : (doorFallback(k, 1), 0.4)), { pri: 5, max: 3 });
  makeDef(['doorOpenMetal', 'gateOpen'], (k) => (play(k, GROUPS.doorOpenMetal, { vol: 0.5 }) ? 1.3 : (doorFallback(k, 0), 0.5)), { pri: 5, max: 3 });
  makeDef(['doorCloseMetal', 'gateClose'], (k) => (play(k, GROUPS.doorCloseMetal, { vol: 0.55 }) ? 1 : (doorFallback(k, 1), 0.4)), { pri: 5, max: 3 });
  makeDef(['doorSlamMetal'], (k) => (play(k, GROUPS.slamMetal, { vol: 0.6 }) ? 0.8 : (doorFallback(k, 1), 0.4)), { pri: 7, max: 2 });
  makeDef(['doorSqueak', 'doorCreakOpen'], (k) => (play(k, GROUPS.squeakOpen, { vol: 0.42 }) ? 1.6 : (play(k, GROUPS.squeak, { vol: 0.4 }) ? 0.6 : (doorFallback(k, 0), 0.5))), { pri: 4, max: 2 });
  makeDef(['doorCreakClose'], (k) => (play(k, GROUPS.squeakClose, { vol: 0.42 }) ? 1.6 : (doorFallback(k, 1), 0.5)), { pri: 4, max: 2 });
  makeDef(['liftDoor', 'elevatorDoor'], (k) => (play(k, GROUPS.liftDoor, { vol: 0.4, dur: 3.2, rand: 0.03 }) ? 3.6 : (doorFallback(k, 0), 0.6)), { pri: 6, max: 2, long: true });
  makeDef(['keys', 'keyJangle'], (k) => (play(k, GROUPS.keys, { vol: 0.4 }) ? 0.7 : (k.osc('triangle', 2600, 0.06, { vol: 0.1 }), 0.1)), { pri: 4, max: 3 });
  makeDef(['drawer', 'drawerOpen', 'cabinet'], (k) => (play(k, GROUPS.drawer, { vol: 0.45 }) ? 1 : (doorFallback(k, 0), 0.4)), { pri: 4, max: 2 });
  makeDef(['cashHandle', 'billsCount', 'pawn', 'sellItem'], (k) => {
    const real = play(k, GROUPS.bills, { vol: 0.35, dur: 0.9 });
    play(k, GROUPS.coinsBig, { at: real ? 0.35 : 0, vol: 0.3, dur: 0.9 });
    play(k, GROUPS.coinsSmall, { at: 0.7, vol: 0.22 });
    return 1.5;
  }, { pri: 6, max: 3 });
  makeDef(['coinsHandle', 'coinTap'], (k) => (play(k, GROUPS.coinsSmall, { vol: 0.32 }) ? 0.4 : 0), { pri: 3, max: 6 });
  makeDef(['ratSqueak', 'ratAttack'], (k, o) => (ratPlay(k, o) ? 0.5 : (k.osc('sine', 2800, 0.1, { vol: 0.12, to: 3600 }), 0.15)), { pri: 4, max: 3 });
  makeDef(['ratPain'], (k) => { play(k, GROUPS.rat.pain, { vol: 0.4 }); return 0.3; }, { pri: 4, max: 3 });
  makeDef(['ratDeath', 'critterCaught'], (k) => { play(k, GROUPS.rat.death, { vol: 0.4 }); return 0.5; }, { pri: 5, max: 3 });
  makeDef(['crowdCheer'], (k, o) => {
    const d = defs.get('cheer');
    return d ? d.run(k, o) : 0;
  }, { bus: 'amb', pri: 3, max: 1 });

  /** Horror hit: `param` 0..1 climbs from a short bright scare to the heaviest sub hit. Silent in Calm. */
  const horror = (k: Kit, o: PlayOpts): number => {
    if (calm) return 0;
    const p = o.param ?? 0.5, n = GROUPS.horror.length, i = Math.min(n - 1, Math.floor(p * n)), lo = Math.max(0, i - 1), hi = Math.min(n - 1, i + 1);
    const g: Group = GROUPS.horror.slice(lo, hi + 1);
    if (!play(k, g, { vol: 0.62, a: 0.002, r: 0.9, rand: 0.02 })) return 0;
    return (g[0].dur ?? 2.6) + 0.5;
  };
  makeDef(['horrorHit', 'knockStinger', 'visitorStinger', 'mafiaStinger'], (k, o) => horror(k, o), { pri: 8, max: 1, long: true });
  // Dread events already on the floor get the recording underneath (quieter than a stinger of their own).
  layer(['powerDown'], (k, o) => (calm ? 0 : horror(k, { ...o, param: 0.75 })));
  layer(['trapdoor'], (k, o) => (calm ? 0 : horror(k, { ...o, param: 0.95 })));

  function ratPlay(k: Kit, o: PlayOpts): boolean {
    const p = o.param ?? 0, g = p > 0.66 ? GROUPS.rat.death : p > 0.33 ? GROUPS.rat.pain : GROUPS.rat.attack;
    return play(k, g, { vol: 0.4, rand: 0.1 });
  }
  /** Small procedural stand-in for the new door names when the recordings are not decoded yet. */
  function doorFallback(k: Kit, close: number): void {
    k.noise(0.06, { vol: 0.35, filter: 'bandpass', freq: close ? 500 : 1500, q: 1, env: { a: 0.002, d: 0.05, s: 0, r: 0.01 } });
    k.osc('sine', close ? 110 : 190, 0.12, { vol: 0.4, to: close ? 55 : 120, env: { a: 0.002, d: 0.11, s: 0, r: 0.01 } });
  }
}

/** Play one of the stinger-matched horror hits for a music stinger id (jumpscare and friends). Null when not a scare. */
export function horrorForStinger(id: string): number | null {
  switch (id) {
    case 'jumpscare': return 0.9;
    case 'curse': return 0.7;
    case 'collector': return 0.55;
    case 'blackout': return 0.8;
    default: return null;
  }
}
