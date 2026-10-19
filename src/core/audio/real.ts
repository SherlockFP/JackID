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
import { Kit, pick, rnd, sampleStore, semi } from './synth';
import type { SfxDef } from './sfx';

const V = `${import.meta.env.BASE_URL}assets/vendor/`;

/** One recorded clip: file + the window worth playing (seconds into the file) + a loudness multiplier. */
export interface Clip { u: string; off?: number; dur?: number; lv?: number }
type Group = readonly Clip[];
const c = (dir: string, file: string, o: Omit<Clip, 'u'> = {}): Clip => ({ u: `${V}${dir}/${file}`, ...o });
const many = (dir: string, files: string[], o: Omit<Clip, 'u'> = {}): Clip[] => files.map((f) => c(dir, f, o));

const OWL = 'sfx-owlish-more-sfx', LAL = 'sfx-laleksic-various', RUB = 'sfx-rubberduck-metal-wood', QDOOR = 'sfx-qubodup-doors';
const MIX = 'sfx-mixkit-casino', OGA = 'sfx-oga-wins';
// wave 83 sound pass: ObsydianX UI, Chequered Ink 400, Halfwits dice, heyheythere footsteps, Liminal horror, Polar_34 magic
const OBS = 'sfx-obsydianx-ui', CIK = 'sfx-ci-400', DIC = 'sfx-halfwits-dice', HEY = 'sfx-heyheythere-footsteps', LIM = 'sfx-liminal-horror', MAG = 'sfx-polar-magic';
/** `[file, lv]` pairs: lv = the clip's level trim inside its group, from the crest factor (peak minus loudest-200 ms RMS), see SFX_INDEX.md. */
const lvs = (dir: string, files: Array<[string, number]>, o: Omit<Clip, 'u' | 'lv'> = {}): Clip[] => files.map(([f, lv]) => c(dir, f, { ...o, lv }));
const LATCH = c(OWL, 'key_lock_door_30.wav');
const GROUPS = {
  ring: [c('sfx-chirptone-ringtone', 'chirptone.wav')],
  phoneClick: [c(OWL, 'phone2.wav')],
  coinsSmall: many(OWL, ['money_07.wav', 'money_12.wav', 'money_13.wav', 'money_15.wav', 'money_27.wav', 'money_29.wav'], { lv: 0.8 }),
  coinsBig: [c(OWL, 'money_16.wav'), c(LAL, 'pickup_coins.wav')],
  bills: [c(OWL, 'money_31.wav')],
  keys: [...many(RUB, ['keys_01.ogg', 'keys_03.ogg', 'keys_05.ogg', 'keys_07.ogg']), c(LAL, 'pickup_keys.wav')],
  keyTurn: many(OWL, ['key_lock_door_04.wav', 'key_lock_door_11.wav', 'key_lock_door_39.wav']),
  lockClunk: [c(OWL, 'key_lock_door_51.wav'), c(LAL, 'lock.wav'), c(RUB, 'lock_open_01.ogg')],
  latch: [LATCH],
  // the click under a reel stop: the latch and two short metal hits (never auditioned in the game: peak-normalised and kept low)
  clack: [LATCH, c(RUB, 'metal_hit_01.ogg', { dur: 0.2 }), c(RUB, 'metal_hit_02.ogg', { dur: 0.2 })],
  rattle: [c(OWL, 'key_lock_door_48.wav', { dur: 1.2 }), c(LAL, 'cant_open.wav')],
  doorOpenWood: [...many(QDOOR, Array.from({ length: 8 }, (_, i) => `qubodup-DoorOpen0${i + 1}.ogg`)), c(LAL, 'door_open.wav')],
  doorCloseWood: [...many(QDOOR, Array.from({ length: 10 }, (_, i) => `qubodup-DoorClose${String(i + 1).padStart(2, '0')}.ogg`)), c(RUB, 'wood_close_01.ogg'), c(RUB, 'wood_close_02.ogg'), c(LAL, 'door_close.wav')],
  doorOpenMetal: [c(RUB, 'metal_open_01.ogg')],
  doorCloseMetal: [c(RUB, 'metal_close_01.ogg')],
  slamWood: [c(RUB, 'wood_slam_01.ogg'), c(RUB, 'wood_slam_02.ogg')],
  slamMetal: [c(RUB, 'metal_slam_01.ogg'), c(LAL, 'clang_metal.wav')],
  squeakOpen: [c(LAL, 'door_creak_open.wav'), ...lvs(LIM, [['creak-door-2.wav', 1.01], ['creak-door-4.wav', 0.99]])],
  squeakClose: [c(LAL, 'door_creak_close.wav'), ...lvs(LIM, [['creak-door-6.wav', 0.98], ['creak-door-7.wav', 1]])],
  squeak: [c(RUB, 'wood_squeak_01.ogg'), c(RUB, 'wood_squeak_02.ogg')],
  floorCreak: [...many(LAL, ['floor_creak1.wav', 'floor_creak2.wav', 'floor_creak3.wav'], { dur: 1.6 }), ...lvs(LIM, [['creak-door-6.wav', 0.98], ['creak-door-7.wav', 1]], { dur: 1.2 })],
  knock: [c(RUB, 'wood_hit_01.ogg'), c(RUB, 'wood_hit_02.ogg'), c(CIK, 'knock-soft.wav', { lv: 0.8 })],
  liftDoor: [c('sfx-pagdev-elevator-door', 'elevator_door.wav')],
  bell: [c(LAL, 'bell.wav', { dur: 1.7 })],
  drawer: [c(LAL, 'drawer_open.wav')],
  // ── the casino loop (Mixkit casino, Mixkit SFX Free License; OpenGameArt win jingles, CC0). Windows measured offline
  //    (scripts/qa/sfxLoud.mjs): the wheel whirr repeats every 0.4 s from 0.4 s to 4.0 s; the notification chime rings 0.1–2.1 s;
  //    the jingle (F major) is 2.3 s; the fanfare (G major) runs 16 s at a steady level, accents at 0, 1.25, 2.25, 8.5 s; the
  //    winner alarm rings flat from 0 to 10.4 s; the alarm-with-coins clip rattles from 0.2 to 15.5 s.
  wheel: [c(MIX, 'slot_wheel_1932.mp3')],
  winChime: [c(MIX, 'casino_win_notification_1986.mp3', { off: 0.09 })],
  winJingle: [c(OGA, 'win_jingle_fupi.ogg', { dur: 2.4 })],
  fanfare: [c(OGA, 'win_fanfare_gchoc.ogg')],
  alarm: [c(MIX, 'classic_winner_alarm_1997.mp3')],
  coinAlarm: [c(MIX, 'casino_win_alarm_coins_1990.mp3', { off: 0.2 })],
  bellsReward: [c(MIX, 'casino_bells_reward_1981.mp3', { off: 0.1 })],
  rat: { attack: [c('sfx-qubodup-rat', 'rat_attack.ogg')], pain: [c('sfx-qubodup-rat', 'rat_pain.ogg')], death: [c('sfx-qubodup-rat', 'rat_death.ogg')] },
  // The long files: loaded one at a time on demand and kept in a small LRU pool (POOL_MAX).
  cheer: [
    [c('sfx-quendel-crowd-cheering', 'quendel_06_soft_cheering_ii.mp3', { off: 1, dur: 2.6 }), c('sfx-quendel-crowd-cheering', 'quendel_05_soft_cheering_i.mp3', { off: 1, dur: 2.6 })],                       // big
    [c('sfx-quendel-crowd-cheering', 'quendel_04_strong_cheering_ii_short.mp3', { off: 0.5, dur: 3.6 }), c('sfx-quendel-crowd-cheering', 'quendel_08_rhythmic_cheering.mp3', { off: 0.5, dur: 3.6 })],   // huge
    [c('sfx-quendel-crowd-cheering', 'quendel_03_strong_cheering_i.mp3', { off: 0.5, dur: 4.6 }), c('sfx-quendel-crowd-cheering', 'quendel_04_strong_cheering_ii_short.mp3', { off: 0.5, dur: 4.6 })],  // mega
    [c('sfx-quendel-crowd-cheering', 'quendel_03_strong_cheering_i.mp3', { off: 0.5, dur: 8 }), c('sfx-quendel-crowd-cheering', 'quendel_08_rhythmic_cheering.mp3', { off: 0.5, dur: 8 })],               // jackpot
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
  // ── wave 83 sound pass. Dark, short interface tones (ObsydianX styles 4/5, no upbeat ones), cards (Chequered Ink), d6 rolls ──
  uiHover: lvs(OBS, [['ui-cursor-2.wav', 0.95], ['ui-cursor-4.wav', 1]]),
  uiClick: lvs(CIK, [['ui-select-2.wav', 1], ['ui-select-4.wav', 0.99]]),
  uiConfirm: lvs(OBS, [['ui-confirm-1.wav', 1.04], ['ui-confirm-2.wav', 1], ['ui-confirm-3.wav', 0.96]]),
  uiBack: lvs(OBS, [['ui-back-1.wav', 1], ['ui-back-2.wav', 0.89]]),
  uiError: lvs(OBS, [['ui-error-1.wav', 0.94], ['ui-error-2.wav', 1]]),
  uiPop: lvs(CIK, [['ui-pop-1.wav', 1.01], ['ui-pop-3.wav', 1], ['ui-pop-4.wav', 0.95]]),
  cardDraw: lvs(CIK, [['card-draw-1.wav', 0.97], ['card-draw-2.wav', 1.3], ['card-draw-3.wav', 1]]),
  cardFan: lvs(CIK, [['card-fan-1.wav', 0.98], ['card-fan-2.wav', 1]]),
  cardSlide: [c(CIK, 'card-slide-click.wav')],
  diceShake: [c(CIK, 'dice-shake-3.wav')],
  diceGrab: [c(CIK, 'dice-grab.wav')],
  diceTumble: [...lvs(CIK, [['dice-roll-1.wav', 1.06], ['dice-roll-2.wav', 1], ['dice-roll-3.wav', 0.94]]), ...lvs(DIC, [['roll-1d6.wav', 1]])],   // a single die landing
  diceD6: lvs(DIC, [['roll-1d6.wav', 1], ['roll-2d6.wav', 0.9], ['roll-3d6.wav', 1.03], ['roll-5d6.wav', 0.77]]),
  // footsteps by floor (src/player/surface.ts: hardness 0.1 carpet · 0.25 dirt · 0.45 wood · 0.8 tile · 1 metal; wet and concrete have their own names)
  step: {
    carpet: [...lvs(HEY, [['step-carpet-1.ogg', 1.33]]), ...lvs(CIK, [['step-carpet-2.wav', 0.89], ['step-carpet-3.wav', 1]])],
    wood: lvs(HEY, [['step-wood-1.ogg', 1], ['step-wood-2.ogg', 0.91], ['step-wood-3.ogg', 1]]),
    tile: lvs(HEY, [['step-tile-1.ogg', 1.02], ['step-tile-2.ogg', 1], ['step-tile-3.ogg', 0.98]]),
    metal: lvs(HEY, [['step-metal-1.ogg', 1], ['step-metal-2.ogg', 0.77]]),
    dirt: lvs(HEY, [['step-dirt-1.ogg', 1], ['step-dirt-2.ogg', 0.88]]),
    wet: lvs(HEY, [['step-wet-1.ogg', 1], ['step-wet-2.ogg', 0.67], ['step-wet-3.ogg', 1.01]]),
    concrete: lvs(HEY, [['step-concrete-1.ogg', 1], ['step-concrete-2.ogg', 0.93]]),
  } as Record<string, Group>,
  // horror: a long creak, growls, wind and drones for dread, a heavy door knock and single soft knocks
  creakLong: [c(LIM, 'creak-door-9-long.wav')],
  growl: lvs(LIM, [['growl-2.wav', 1.28], ['growl-4.wav', 1], ['growl-6.wav', 0.94]]),
  wind: lvs(LIM, [['wind-2.wav', 1], ['wind-4.wav', 0.96]]),
  drone: [c(LIM, 'drone-5.wav'), c(CIK, 'ghost-long.wav', { lv: 0.8 })],
  knockDoor: [c(CIK, 'knock-door.wav')],
  knockSoft: [c(CIK, 'knock-soft.wav', { lv: 0.8 })],
  // the gods' blessings (docs/BLESSINGS.md): registered and ready, nothing calls them until that feature ships
  magicOffer: [c(MAG, 'locate.wav')],
  magicChimes: [c(MAG, 'chimes.wav')],
  magicPick: [c(MAG, 'success.wav')],
  magicSpell: [c(MAG, 'spell.wav')],
  magicOmen: [c(MAG, 'sonar.wav', { lv: 0.8 })],
  magicEcho: [c(MAG, 'echo1.wav'), c(MAG, 'echo2.wav')],
};

/** The casino-floor crowd loop (27 s). The ambience bed crossfades it with itself. */
export const CROWD_LOOP = `${V}sfx-starninjas-crowd/crowd_shouting.ogg`;

/** Small files the engine warms in the background a few seconds after start (the long ones stay on demand). */
export const WARM_URLS: string[] = [
  ...GROUPS.ring, ...GROUPS.phoneClick, ...GROUPS.coinsSmall, ...GROUPS.coinsBig, ...GROUPS.bills, ...GROUPS.keys, ...GROUPS.keyTurn,
  ...GROUPS.lockClunk, ...GROUPS.latch, ...GROUPS.rattle, ...GROUPS.doorOpenWood, ...GROUPS.doorCloseWood, ...GROUPS.doorOpenMetal,
  ...GROUPS.doorCloseMetal, ...GROUPS.slamWood, ...GROUPS.slamMetal, ...GROUPS.squeakOpen, ...GROUPS.squeakClose, ...GROUPS.squeak,
  ...GROUPS.knock, ...GROUPS.liftDoor, ...GROUPS.bell, ...GROUPS.drawer, ...GROUPS.rat.attack, ...GROUPS.rat.pain, ...GROUPS.rat.death,
  ...GROUPS.clack, ...GROUPS.wheel, ...GROUPS.winChime, ...GROUPS.winJingle, ...GROUPS.fanfare, ...GROUPS.alarm, ...GROUPS.coinAlarm,
  ...GROUPS.bellsReward,
  // wave 83: the interface, cards, dice, footsteps and the single knocks are warmed; creaks, winds, drones and the magic set load on first use
  ...GROUPS.uiHover, ...GROUPS.uiClick, ...GROUPS.uiConfirm, ...GROUPS.uiBack, ...GROUPS.uiError, ...GROUPS.uiPop,
  ...GROUPS.cardDraw, ...GROUPS.cardFan, ...GROUPS.cardSlide, ...GROUPS.diceShake, ...GROUPS.diceGrab, ...GROUPS.diceTumble, ...GROUPS.diceD6,
  ...Object.values(GROUPS.step).flat(), ...GROUPS.knockSoft,
].map((x) => x.u).filter((u, i, a) => a.indexOf(u) === i);

/** Every recorded file real.ts can play (the loudness harness decodes them all; a test checks each one exists). */
export const CLIP_URLS: string[] = [...new Set(JSON.stringify(GROUPS).match(/"u":"[^"]+"/g)!.map((m) => m.slice(5, -1)))];

/** The casino-loop clips the recipes in sfx.ts play directly (with their procedural version as the fallback). */
export type WinClip = 'wheel' | 'winChime' | 'winJingle' | 'fanfare' | 'alarm' | 'coinAlarm' | 'bellsReward' | 'lockClunk';
/** Play one of the casino-loop clips into the recipe's Kit (peak `vol` before the recipe's trim). False = not decoded yet: use the synth. */
export function winClip(k: Kit, id: WinClip, o: ClipOpts = {}): boolean { return play(k, GROUPS[id], { rand: 0, ...o }); }

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

interface ClipOpts { at?: number; vol?: number; rate?: number; rand?: number; off?: number; dur?: number; a?: number; r?: number; pan?: number }
/** Play a random ready clip of `group` (peak `vol`); false when none is decoded yet (and kicks off the next load). */
function play(k: Kit, group: Group, o: ClipOpts = {}): boolean {
  const ready = group.filter((x) => sampleStore.has(x.u));
  if (ready.length < group.length) { const next = group.find((x) => !sampleStore.has(x.u)); if (next) k.host.sample(next.u); }   // lazy: load one more
  if (!ready.length) return false;
  const prev = lastPick.get(group);
  const cand = ready.length > 1 ? ready.filter((x) => x.u !== prev) : ready;
  const cl = pick(cand);
  lastPick.set(group, cl.u);
  const ok = k.clip(cl.u, { ...o, vol: (o.vol ?? 0.5) * (cl.lv ?? 1), off: (cl.off ?? 0) + (o.off ?? 0), dur: Math.min(cl.dur ?? Infinity, o.dur ?? Infinity) });
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

  // ── slot mechanics: a recorded click under the synthesised clack so a stop and a lever throw have a real edge ──
  // (kept low: the synthesised hit already peaks near 0.6 full scale at the same instant)
  layer(['reelStop'], (k, o, t) => { play(k, GROUPS.clack, { vol: 0.15 * t, rate: semi((o.param ?? 0) * 7), dur: 0.25 }); return 0.3; });
  layer(['lever'], (k, _o, t) => {
    play(k, GROUPS.latch, { vol: 0.15 * t, dur: 0.25 });
    play(k, GROUPS.lockClunk, { at: 0.16, vol: 0.25 * t, rate: 0.85, dur: 0.4 });
    return 0.56;
  });

  // ── crowd cheers by win tier: param 0.4 big, 0.7 huge, 0.9 mega, 1 jackpot (winJingle) ──
  replace(['cheer'], (k, o, t) => {
    const p = o.param ?? 0.5, tier = p >= 0.95 ? 3 : p >= 0.8 ? 2 : p >= 0.6 ? 1 : 0;
    const g = GROUPS.cheer[tier], len = g[0].dur ?? 3;
    if (!play(k, g, { vol: (0.34 + tier * 0.04) * t, a: tier === 3 ? 1.6 : 0.25, r: 0.9, rand: 0.03 })) return null;   // the jackpot crowd swells in
    return len + 0.4;
  });

  // ── wave 83 sound pass. Every `replace` keeps its procedural recipe as the fallback; each `vol` is the final peak ──
  // interface: short dark tones (hover, error, toast pop replaced; the click keeps its synthesised tick with a soft recorded one under it)
  replace(['hover'], (k, _o, t) => (play(k, GROUPS.uiHover, { vol: 0.3 * t, rand: 0.03 }) ? 0.25 : null));
  layer(['click'], (k, _o, t) => { play(k, GROUPS.uiClick, { vol: 0.22 * t, rand: 0.04 }); return 0.17; });
  replace(['error'], (k, _o, t) => (play(k, GROUPS.uiError, { vol: 0.5 * t, rand: 0.01 }) ? 0.45 : null));
  replace(['popUp'], (k, o, t) => (play(k, GROUPS.uiPop, { vol: 0.5 * t, rate: semi(((o.param ?? 0.4) - 0.4) * 6) }) ? 0.15 : null));

  // cards: Chequered Ink draws, fans and a slide under the Kenney samples and the synthesised snaps
  layer(['card'], (k, _o, t) => { play(k, GROUPS.cardDraw, { vol: 0.3 * t, rand: 0.06 }); return 0.25; });
  layer(['cardFlip'], (k, _o, t) => { play(k, GROUPS.cardSlide, { vol: 0.22 * t, dur: 0.45, rand: 0.05 }); return 0.45; });
  layer(['cardSlap'], (k, _o, t) => { play(k, GROUPS.cardDraw, { vol: 0.35 * t, rate: 0.8 }); return 0.3; });
  layer(['shuffle'], (k, _o, t) => {
    play(k, GROUPS.cardFan, { at: 0.05, vol: 0.3 * t });
    play(k, GROUPS.cardFan, { at: 0.5, vol: 0.28 * t, rate: 1.05 });
    play(k, GROUPS.cardDraw, { at: 0.95, vol: 0.3 * t });
    return 1.2;
  });

  // dice: the grab and shake, then a d6 roll across the felt; a single die landing uses the shorter tumbles
  replace(['dice', 'diceRoll'], (k, _o, t) => {
    const grab = play(k, GROUPS.diceGrab, { vol: 0.25 * t }), shake = play(k, GROUPS.diceShake, { at: 0.1, vol: 0.4 * t, dur: 0.55 });
    if (!grab && !shake) return null;
    play(k, GROUPS.diceD6, { at: 0.5, vol: 0.75 * t, rand: 0.04 });
    return 2;
  });
  replace(['diceLand'], (k, _o, t) => (play(k, GROUPS.diceTumble, { vol: 0.6 * t, rand: 0.05 }) ? 0.7 : null));

  // footsteps by floor: `footstep` carries the surface hardness in `param` (src/player/surface.ts); the named ones pick their own floor
  const FLOOR: Record<string, string> = { footstepCarpet: 'carpet', footstepConcrete: 'concrete', footstepMetal: 'metal', footstepWood: 'wood', footstepWet: 'wet' };
  const floorOf = (n: string, p: number): string => FLOOR[n] ?? (p < 0.17 ? 'carpet' : p < 0.35 ? 'dirt' : p < 0.65 ? 'wood' : p < 0.9 ? 'tile' : 'metal');
  // The caller's `pitch` (a per-floor offset, carpet -3 .. metal +4, plus a +-1 wobble) suits the synthesised step only; a recording
  // already sounds like its floor, so it is cancelled with the opposite rate (the clip's own `rand` supplies the variation).
  for (const n of ['footstep', ...Object.keys(FLOOR)]) replace([n], (k, o, t) => (play(k, GROUPS.step[floorOf(n, o.param ?? 0)], { vol: 0.55 * t, rate: semi(-(o.pitch ?? 0)), rand: 0.04 }) ? 0.45 : null));

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
    if (p >= 0.45) play(k, GROUPS.growl, { at: 0.04, vol: 0.12 + 0.22 * p, a: 0.02, r: 0.6, dur: 1.6 });   // something answers under the hit
    if (p >= 0.3) play(k, GROUPS.drone, { at: 0.05, vol: 0.14 + 0.1 * p, a: 0.5, r: 1.4, dur: 3.2 });      // wind / low drone bed, swells in
    return (g[0].dur ?? 2.6) + 0.5;
  };
  makeDef(['horrorHit', 'knockStinger', 'visitorStinger', 'mafiaStinger'], (k, o) => horror(k, o), { pri: 8, max: 1, long: true });
  // Dread events already on the floor get the recording underneath (quieter than a stinger of their own).
  layer(['knockStinger'], (k) => (calm ? 0 : (play(k, GROUPS.knockDoor, { vol: 0.5 }) ? 0.8 : 0)));
  layer(['powerDown'], (k, o) => (calm ? 0 : horror(k, { ...o, param: 0.75 })));
  layer(['trapdoor'], (k, o) => (calm ? 0 : horror(k, { ...o, param: 0.95 })));

  // ── wave 83 new names. UI (bus ui): the dark confirm and back tones, a procedural stand-in until they decode ──
  makeDef(['confirm'], (k) => (play(k, GROUPS.uiConfirm, { vol: 0.5, rand: 0.02 }) ? 0.45 : (k.osc('triangle', 520, 0.12, { vol: 0.12, to: 780, env: { a: 0.003, d: 0.1, s: 0, r: 0.01 } }), 0.15)), { bus: 'ui', pri: 7, max: 2 });
  makeDef(['back'], (k) => (play(k, GROUPS.uiBack, { vol: 0.45, rand: 0.02 }) ? 0.4 : (k.osc('triangle', 520, 0.1, { vol: 0.12, to: 340, env: { a: 0.003, d: 0.08, s: 0, r: 0.01 } }), 0.15)), { bus: 'ui', pri: 7, max: 2 });

  // horror and dread (all silent in Calm Mode except the creak and the single knock, which the home already plays)
  makeDef(['creakLong'], (k) => (play(k, GROUPS.creakLong, { vol: 0.4, a: 0.05, r: 0.5 }) ? 4.9 : (play(k, GROUPS.squeakOpen, { vol: 0.42 }), 1.6)), { pri: 4, max: 2, long: true });
  makeDef(['growl'], (k, o) => (calm ? 0 : (play(k, GROUPS.growl, { vol: 0.35 + 0.25 * (o.param ?? 0.5), a: 0.02, r: 0.5, rand: 0.06 }) ? 2 : 0)), { pri: 6, max: 1, long: true });
  makeDef(['windGust'], (k) => (play(k, GROUPS.wind, { vol: 0.32, a: 0.9, r: 1.6, rand: 0.05 }) ? 5 : 0), { bus: 'amb', pri: 2, max: 1, long: true });
  makeDef(['dreadDrone'], (k) => (calm ? 0 : (play(k, GROUPS.drone, { vol: 0.34, a: 0.8, r: 1.6, rand: 0.03 }) ? 5 : 0)), { pri: 5, max: 1, long: true });
  makeDef(['knockDoor'], (k) => (play(k, GROUPS.knockDoor, { vol: 0.6, rand: 0.03 }) ? 0.8 : 0), { pri: 6, max: 2 });
  makeDef(['knockSingle'], (k) => (play(k, GROUPS.knockSoft, { vol: 0.65, rate: 0.9, rand: 0.05 }) ? 0.35 : (k.osc('sine', 150, 0.09, { vol: 0.4, to: 65, env: { a: 0.002, d: 0.08, s: 0, r: 0.01 } }), 0.15)), { pri: 6, max: 3 });
  /** Knocks heard through the building: three soft ones far away, rate and level falling. Silent in Calm Mode. */
  makeDef(['knockDistant'], (k) => {
    if (calm) return 0;
    let at = 0;
    for (let i = 0; i < 3; i++) { play(k, GROUPS.knockSoft, { at, vol: (0.3 - i * 0.04) * rnd(0.85, 1), rate: 0.78, rand: 0.04 }); at += rnd(0.42, 0.6); }
    return at + 0.3;
  }, { bus: 'amb', pri: 2, max: 1 });

  // ── the gods' blessings (docs/BLESSINGS.md): sounds are registered and ready, nothing in the game plays them yet ──
  // boonOffer: the card turns over · boonPick: a boon taken · omen: a warning from the unseen (visual only in Calm) · spell: a rite · divineEcho: a god's voice carrying
  makeDef(['boonOffer'], (k) => {
    if (!play(k, GROUPS.magicOffer, { vol: 0.4 })) return 0;
    play(k, GROUPS.magicChimes, { at: 0.12, vol: 0.34, rand: 0.02 });
    return 1.1;
  }, { pri: 6, max: 2 });
  makeDef(['boonPick'], (k) => {
    if (!play(k, GROUPS.magicPick, { vol: 0.5 })) return 0;
    play(k, GROUPS.magicSpell, { at: 0.05, vol: 0.2 });
    return 1.4;
  }, { pri: 7, max: 2, long: true });
  makeDef(['omen'], (k) => {
    if (calm || !play(k, GROUPS.magicOmen, { vol: 0.4, a: 0.05, r: 0.8 })) return 0;
    play(k, GROUPS.magicEcho, { at: 0.35, vol: 0.28, rate: 0.85 });
    return 2.2;
  }, { pri: 7, max: 1, long: true });
  makeDef(['spell'], (k) => (play(k, GROUPS.magicSpell, { vol: 0.45 }) ? 0.8 : 0), { pri: 6, max: 2 });
  makeDef(['divineEcho'], (k) => (play(k, GROUPS.magicEcho, { vol: 0.38, rand: 0.02 }) ? 1.9 : 0), { pri: 5, max: 2, long: true });

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
