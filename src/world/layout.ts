/**
 * The pit layout data (WORLD-ARCH, GDD §8). Pure data: no THREE, no DOM.
 *
 *   SLOTS        GDD §8.6 slot table verbatim (machine and pad positions). Props that are not placements
 *                (clock, lift panel, X plate, quota board, charm board, furnace, chair) live in `level.ts`.
 *   ZONES        GDD §8.3 footprints + §8.7 fog / ambient. The Sump is an underground pit, not a zone.
 *   ASSIGN       default slot → device table (`ASSIGN.default`). Pads are the slots with no entry.
 *   BUSY_FLOOR   GDD §8.6 multiplayer override (host option, default on with ≥ 4 players). `assignment()` merges it.
 *   NAV_*        visitation / patrol graph (GDD §8.8: zone centres, nave corners, doorway mouths).
 *
 * Wall-mounted devices (bounty board, pawn window, desk, cashier) use `y` = mount height; `pos[1]` stays 0 (DECISIONS C25).
 * Wall-mounted items have no size class in GDD §8.5, so they take M or L by footprint (director to confirm).
 */
import type { GameMode, Hex, InstanceId, MachineId, SlotSize, ZoneId } from '@/core/types';
import { SLOT_SIZES } from '@/core/types';
import { createRng, hashSeed, type Rng } from '@/core/rng';
import type { SlotDef } from './types';
import type { ZoneDef } from './sys/arch';

type Rot = 0 | 90 | 180 | 270;
const S = (id: InstanceId, zone: ZoneId, size: SlotSize, x: number, z: number, rotY: Rot, y?: number): SlotDef =>
  y === undefined ? { id, size, zone, pos: [x, 0, z], rotY } : { id, size, zone, pos: [x, 0, z], rotY, y };

/**
 * GDD §8.6 — every slot in the pit: 48 machine instances + 11 system devices (Terminal, Hotline ×2, Bounty, Charm,
 * Concession, Cashier, Jukebox, Tape, Tonic, Shrine) + 30 pads (27 + 3 Counting Room). The Clock, lift panel, X plate,
 * quota board, charm board, furnace and chair are props, not slots, and live in `level.ts`.
 */
export const SLOTS: SlotDef[] = [
  // The Mouth
  S('MOUTH-01', 'mouth', 'M', -8.5, -29.35, 0),
  S('MOUTH-02', 'mouth', 'M', 10.35, -27.8, 270),
  S('MOUTH-TERM', 'mouth', 'M', 0, -29.35, 0),
  S('MOUTH-PHONE', 'mouth', 'M', 4.0, -29.3, 0),
  S('MOUTH-BOUNTY', 'mouth', 'M', 8.0, -29.84, 0, 1.5),
  // The Well
  S('WELL-01', 'well', 'XL', 0, -4.0, 180, 0.15),
  S('WELL-02', 'well', 'XL', -5.0, -13.0, 0),
  S('WELL-03', 'well', 'L', 5.0, -13.0, 0),
  S('WELL-04', 'well', 'M', -10.35, -19.5, 90),
  S('WELL-05', 'well', 'M', -10.35, -17.0, 90),
  S('WELL-06', 'well', 'M', -10.35, -5.0, 90),
  S('WELL-07', 'well', 'M', -10.35, -2.5, 90),
  S('WELL-08', 'well', 'M', -10.35, 0.5, 90),
  S('WELL-09', 'well', 'M', 10.35, -19.5, 270),
  S('WELL-10', 'well', 'M', 10.35, -17.0, 270),
  S('WELL-11', 'well', 'M', 10.35, -5.0, 270),
  S('WELL-12', 'well', 'M', 10.35, -2.5, 270),
  S('WELL-13', 'well', 'S', 10.45, 0.5, 270),
  // The Lobby
  S('LOB-01', 'lobby', 'M', -10.35, 9.0, 90),
  S('LOB-02', 'lobby', 'M', -10.35, 11.5, 90),
  S('LOB-03', 'lobby', 'S', -10.45, 13.5, 90),
  S('LOB-PAWN', 'lobby', 'L', -6.0, 19.35, 180, 1.0),
  S('LOB-PHONE2', 'lobby', 'M', -3.0, 19.3, 180),
  S('LOB-DESK', 'lobby', 'L', 0, 19.2, 180),
  S('LOB-CASH', 'lobby', 'L', 6.0, 19.35, 180),
  S('LOB-JUKE', 'lobby', 'M', 10.35, 9.0, 270),
  S('LOB-TAPE', 'lobby', 'S', 10.45, 10.7, 270),
  S('LOB-TONIC', 'lobby', 'M', 10.35, 12.5, 270),
  // The Midway
  S('MID-01', 'midway', 'XL', -26.0, -27.0, 0),
  S('MID-02', 'midway', 'XL', -17.5, -27.0, 0),
  S('MID-03', 'midway', 'M', -30.35, -20.0, 90),
  S('MID-04', 'midway', 'M', -30.35, -18.4, 90),
  S('MID-05', 'midway', 'M', -22.0, -16.65, 180),
  S('MID-06', 'midway', 'M', -19.0, -16.65, 180),
  S('MID-07', 'midway', 'M', -25.0, -16.65, 180),
  S('MID-08', 'midway', 'L', -21.0, -21.5, 0),
  // The Card Room
  S('CARD-01', 'cards', 'XL', -24.0, -9.0, 90),
  S('CARD-02', 'cards', 'L', -16.0, -14.95, 0),
  S('CARD-03', 'cards', 'L', -16.0, -3.05, 180),
  S('CARD-04', 'cards', 'M', -30.35, -14.0, 90),
  S('CARD-05', 'cards', 'M', -30.35, -4.0, 90),
  S('CARD-06', 'cards', 'M', -21.0, -15.35, 0),
  S('CARD-07', 'cards', 'M', -21.0, -2.65, 180),
  S('CARD-08', 'cards', 'L', -16.0, -9.0, 270),
  // The Laundry
  S('LAU-01', 'laundry', 'XL', -24.5, 5.0, 90),
  S('LAU-02', 'laundry', 'L', -20.0, -0.95, 0),
  S('LAU-03', 'laundry', 'M', -28.0, 11.35, 180),
  S('LAU-04', 'laundry', 'M', -26.7, 11.35, 180),
  S('LAU-05', 'laundry', 'M', -25.4, 11.35, 180),
  S('LAU-06', 'laundry', 'L', -16.0, 9.0, 180),
  S('LAU-07', 'laundry', 'M', -13.0, 11.35, 180),
  S('LAU-08', 'laundry', 'L', -29.95, 0.0, 90),
  S('LAU-09', 'laundry', 'M', -30.35, 2.5, 90),
  S('LAU-10', 'laundry', 'L', -18.0, 4.5, 90),
  // The Boiler
  S('BOI-01', 'boiler', 'XL', 22.0, -23.0, 0),
  S('BOI-02', 'boiler', 'L', 14.5, -28.95, 0),
  S('BOI-03', 'boiler', 'L', 29.95, -27.0, 270),
  S('BOI-04', 'boiler', 'L', 14.5, -17.05, 180),
  S('BOI-05', 'boiler', 'S', 30.45, -19.0, 270),
  S('BOI-06', 'boiler', 'M', 30.35, -23.0, 270),
  S('BOI-07', 'boiler', 'L', 22.0, -17.05, 180),
  // The Slot Gallery
  S('GAL-01', 'gallery', 'M', 14.5, -15.35, 0),
  S('GAL-02', 'gallery', 'M', 16.0, -15.35, 0),
  S('GAL-03', 'gallery', 'M', 17.5, -15.35, 0),
  S('GAL-04', 'gallery', 'M', 20.5, -15.35, 0),
  S('GAL-05', 'gallery', 'M', 22.0, -15.35, 0),
  S('GAL-06', 'gallery', 'M', 25.0, -15.35, 0),
  S('GAL-07', 'gallery', 'M', 14.5, -2.65, 180),
  S('GAL-08', 'gallery', 'M', 16.0, -2.65, 180),
  S('GAL-09', 'gallery', 'M', 17.5, -2.65, 180),
  S('GAL-10', 'gallery', 'M', 20.5, -2.65, 180),
  S('GAL-11', 'gallery', 'M', 22.0, -2.65, 180),
  S('GAL-12', 'gallery', 'S', 25.0, -2.55, 180),
  S('GAL-13', 'gallery', 'M', 20.0, -8.5, 0),
  S('GAL-14', 'gallery', 'M', 20.0, -9.5, 180),
  S('GAL-15', 'gallery', 'L', 29.95, -9.0, 270),
  // The Wheel House
  S('WH-01', 'wheels', 'L', 21.0, -0.95, 0),
  S('WH-02', 'wheels', 'L', 29.95, 2.0, 270),
  S('WH-03', 'wheels', 'L', 16.0, 10.95, 180),
  S('WH-04', 'wheels', 'XL', 21.0, 5.5, 0),
  S('WH-05', 'wheels', 'M', 30.35, 6.5, 270),
  S('WH-06', 'wheels', 'L', 25.5, 10.95, 180),
  // The Parlour
  S('PAR-01', 'parlour', 'L', 24.0, 16.0, 270),
  // Director decision: the Parlour seats the three T1 card/tile tables as L slots (PAR-02/03 resized M→L, PAR-04 new L).
  S('PAR-02', 'parlour', 'L', 14.6, 18.6, 180),   // pisti
  S('PAR-03', 'parlour', 'L', 14.0, 13.8, 0),     // sonkart
  S('PAR-04', 'parlour', 'L', 19.0, 13.8, 0),     // tavla
  S('PAR-SHRINE', 'parlour', 'S', 28.0, 12.55, 0),
  // The Counting Room (meta-unlocked pads only)
  S('CNT-01', 'counting', 'M', -28.0, 12.65, 0),
  S('CNT-02', 'counting', 'M', -25.0, 12.65, 0),
  S('CNT-03', 'counting', 'L', -20.0, 18.95, 180),
];

/** Default device per slot (GDD §8.6). Instance id = slot id; duplicates are independent instances. */
export const DEFAULT_ASSIGN: Partial<Record<InstanceId, MachineId>> = {
  'MOUTH-01': 'fortuneteller', 'MOUTH-TERM': 'debt_terminal', 'MOUTH-PHONE': 'hotline', 'MOUTH-BOUNTY': 'bounty_board',
  'WELL-01': 'bigone', 'WELL-02': 'roulette', 'WELL-03': 'blackjack', 'WELL-04': 'bandit', 'WELL-06': 'bandit', 'WELL-07': 'shellgame',
  'WELL-08': 'hilo', 'WELL-09': 'plinko', 'WELL-11': 'mines', 'WELL-13': 'coinflip',
  'LOB-01': 'scratch', 'LOB-PAWN': 'charm_vendor', 'LOB-PHONE2': 'hotline', 'LOB-DESK': 'threecard',
  'LOB-CASH': 'cashier', 'LOB-JUKE': 'jukebox', 'LOB-TONIC': 'tonic_vendor',
  'MID-01': 'elevator', 'MID-02': 'derby', 'MID-03': 'claw', 'MID-04': 'claw', 'MID-05': 'stacker', 'MID-06': 'cyclone',
  'CARD-02': 'baccarat', 'CARD-03': 'cardwar', 'CARD-04': 'videopoker', 'CARD-05': 'videopoker',
  'LAU-01': 'bingo', 'LAU-02': 'keno', 'LAU-03': 'pachinko', 'LAU-04': 'pachinko', 'LAU-05': 'pachinko',
  'LAU-06': 'coinpusher', 'LAU-07': 'lottoblower', 'LAU-08': 'bingopin',
  'BOI-01': 'craps', 'BOI-02': 'sicbo', 'BOI-03': 'dicetower', 'BOI-04': 'teetotum', 'BOI-05': 'coinflip',
  'GAL-01': 'pachislot', 'GAL-02': 'pachislot', 'GAL-03': 'pachislot', 'GAL-04': 'fruitmachine', 'GAL-05': 'fruitmachine',
  'GAL-06': 'lootbox', 'GAL-07': 'bandit', 'GAL-08': 'bandit',
  'WH-01': 'bigsix', 'WH-02': 'tombola', 'WH-03': 'fantan',
  'PAR-01': 'devilstable', 'PAR-02': 'pisti', 'PAR-03': 'sonkart', 'PAR-04': 'tavla', 'PAR-SHRINE': 'shrine',
};

/** GDD §8.6 busy-floor override: pad → device (host option, default on with ≥ 4 players). */
export const BUSY_FLOOR: Partial<Record<InstanceId, MachineId>> = {
  'WELL-05': 'videopoker', 'WELL-10': 'bandit', 'WELL-12': 'coinflip', 'LOB-02': 'scratch',
  'GAL-09': 'bandit', 'GAL-10': 'pachislot', 'GAL-13': 'pachislot', 'GAL-14': 'bandit',
  'LAU-09': 'pachinko', 'MID-07': 'mines', 'CARD-06': 'videopoker', 'BOI-06': 'dicetower', 'WH-04': 'roulette',
};

/**
 * Pads with no default device (GDD §8.6 "PAD": 30 in total; the busy-floor override fills 13 of them). CARD-01 (XL, was holdem)
 * and LOB-TAPE (was tape_deck) are pads too: no registered machine fills them yet. The Concession Desk (LOB-DESK, was
 * concession_desk, unregistered) now holds Three Card, which is L like the slot.
 */
export const DEFAULT_PADS: readonly InstanceId[] = SLOTS.filter((s) => !(s.id in DEFAULT_ASSIGN)).map((s) => s.id);

/** Slot → device map for a mode. The busy floor merges `BUSY_FLOOR` on top of the default table. */
export function assignment(mode: GameMode, o: { busyFloor?: boolean } = {}): Partial<Record<InstanceId, MachineId | null>> {
  // Modes change which devices a slot accepts (`def.modes`, checked by placement), not the table itself.
  void mode;
  return o.busyFloor ? { ...DEFAULT_ASSIGN, ...BUSY_FLOOR } : { ...DEFAULT_ASSIGN };
}

/** Shape read by WORLD-SYS: `ASSIGN.default` plus one entry per game mode. */
export const ASSIGN: Record<'default' | GameMode, Partial<Record<InstanceId, MachineId | null>>> = {
  default: DEFAULT_ASSIGN, debt: {}, coop: {}, versus: {}, free: {},
};

// ── zones (GDD §8.3 footprints, §8.7 look). Smaller rectangles win where zones overlap. ─────────────────
const look = (color: Hex, near: number, far: number, ambient: Hex) => ({ fog: { color, near, far }, ambient });
export const ZONES: ZoneDef[] = [
  { id: 'mouth', rect: [-11, -30, 11, -18], ...look(0x120a06, 6, 28, 0x2a1a10) },
  { id: 'well', rect: [-11, -18, 11, 2], ...look(0x0e0806, 6, 32, 0x1e1410) },
  { id: 'lobby', rect: [-11, 2, 11, 20], ...look(0x0d0a06, 6, 26, 0x1a120c) },
  { id: 'midway', rect: [-31, -30, -11, -16], gated: true, ...look(0x120814, 4, 22, 0x1c0e1e) },
  { id: 'cards', rect: [-31, -16, -11, -2], gated: true, ...look(0x06100a, 4, 20, 0x0a120c) },
  { id: 'laundry', rect: [-31, -2, -11, 12], gated: true, ...look(0x0a1418, 6, 26, 0x0e1e26) },
  { id: 'boiler', rect: [11, -30, 31, -16], gated: true, ...look(0x140404, 4, 22, 0x200808) },
  { id: 'gallery', rect: [11, -16, 31, -2], gated: true, ...look(0x08040f, 5, 24, 0x10061a) },
  { id: 'wheels', rect: [11, -2, 31, 12], gated: true, ...look(0x140505, 4, 22, 0x1e0808) },
  { id: 'parlour', rect: [11, 12, 31, 20], gated: true, ...look(0x030202, 2, 10, 0x050303) },
  { id: 'counting', rect: [-31, 12, -11, 20], gated: true, ...look(0x050302, 2, 12, 0x080504) },
  // Lift car niche (opens at the lobby, Dawn and endings).
  { id: 'lift', rect: [-5.1, -32.2, -2.9, -30], gated: true, ...look(0x2a2418, 20, 60, 0x2a2418) },
];

/**
 * Visitation / patrol graph (GDD §8.8). Nodes: zone centres, the four nave corners and doorway mouths.
 * Edges are walkable links; `doorway: true` marks a grille (blocked while its zone is closed).
 */
export interface NavNode { id: string; pos: [number, number]; zone: ZoneId }
export interface NavEdge { a: string; b: string; doorway?: boolean }
export const NAV_NODES: NavNode[] = [
  { id: 'c.mouth', pos: [0, -24], zone: 'mouth' }, { id: 'c.well', pos: [0, -9], zone: 'well' },
  { id: 'c.lobby', pos: [0, 11], zone: 'lobby' }, { id: 'c.midway', pos: [-21, -23], zone: 'midway' },
  { id: 'c.cards', pos: [-21, -9], zone: 'cards' }, { id: 'c.laundry', pos: [-21, 5], zone: 'laundry' },
  { id: 'c.counting', pos: [-21, 16], zone: 'counting' }, { id: 'c.boiler', pos: [21, -23], zone: 'boiler' },
  { id: 'c.gallery', pos: [21, -9], zone: 'gallery' }, { id: 'c.wheels', pos: [21, 5], zone: 'wheels' },
  { id: 'c.parlour', pos: [21, 16], zone: 'parlour' },
  { id: 'nave.nw', pos: [-10, -28], zone: 'mouth' }, { id: 'nave.ne', pos: [10, -28], zone: 'mouth' },
  { id: 'nave.sw', pos: [-10, 18], zone: 'lobby' }, { id: 'nave.se', pos: [10, 18], zone: 'lobby' },
  { id: 'd.midway', pos: [-11, -23], zone: 'mouth' }, { id: 'd.boiler', pos: [11, -23], zone: 'mouth' },
  { id: 'd.cards', pos: [-11, -9], zone: 'well' }, { id: 'd.gallery', pos: [11, -9], zone: 'well' },
  { id: 'd.laundry', pos: [-11, 5], zone: 'lobby' }, { id: 'd.wheels', pos: [11, 5], zone: 'lobby' },
  { id: 'd.counting', pos: [-11, 16], zone: 'lobby' }, { id: 'd.parlour', pos: [11, 16], zone: 'lobby' },
  { id: 'd.lift', pos: [-4, -30], zone: 'mouth' },
];
export const NAV_EDGES: NavEdge[] = [
  { a: 'c.mouth', b: 'nave.nw' }, { a: 'c.mouth', b: 'nave.ne' }, { a: 'c.mouth', b: 'c.well' },
  { a: 'c.well', b: 'c.lobby' }, { a: 'c.lobby', b: 'nave.sw' }, { a: 'c.lobby', b: 'nave.se' },
  { a: 'c.mouth', b: 'd.midway' }, { a: 'd.midway', b: 'c.midway', doorway: true },
  { a: 'c.mouth', b: 'd.boiler' }, { a: 'd.boiler', b: 'c.boiler', doorway: true },
  { a: 'c.well', b: 'd.cards' }, { a: 'd.cards', b: 'c.cards', doorway: true },
  { a: 'c.well', b: 'd.gallery' }, { a: 'd.gallery', b: 'c.gallery', doorway: true },
  { a: 'c.lobby', b: 'd.laundry' }, { a: 'd.laundry', b: 'c.laundry', doorway: true },
  { a: 'c.lobby', b: 'd.wheels' }, { a: 'd.wheels', b: 'c.wheels', doorway: true },
  { a: 'c.lobby', b: 'd.parlour' }, { a: 'd.parlour', b: 'c.parlour', doorway: true },
  { a: 'c.lobby', b: 'd.counting' }, { a: 'd.counting', b: 'c.counting', doorway: true },
  { a: 'c.mouth', b: 'd.lift' },
];

// ── Pit Deck (WAVE 8 item 8): the random line-up ─────────────────────────────────────────────────────
/** The flexible pads: the only slots `rosterFor` reassigns. Every other slot keeps its GDD §8.6 device. */
export const ROSTER_PADS: readonly InstanceId[] = ['WELL-04', 'WELL-06', 'WELL-07', 'WELL-08', 'WELL-09', 'WELL-11', 'WELL-13', 'LOB-01'];
/** Machines that never move, whatever the line-up: the marquee and table games, plus the vendors and terminals. */
export const ROSTER_FIXED: ReadonlySet<MachineId> = new Set<MachineId>([
  'bigone', 'roulette', 'blackjack', 'coinflip',
  'charm_vendor', 'cashier', 'jukebox', 'tonic_vendor', 'bounty_board', 'hotline',
  'debt_terminal', 'shrine',
]);
/** Volatility class (WAVE8 item 5). */
export type Volatility = 'STEADY' | 'SWINGY' | 'WILD';
/** One machine the line-up may draw from. The caller builds these from the registry; this file stays pure data. */
export interface RosterCandidate {
  id: MachineId;
  slotSize: SlotSize;
  /** Unlock tier (0 = system device, never drawn). The line-up draws tiers 1 to `ROSTER_MAX_TIER`. */
  tier?: number;
  /** Solo machines have one seat and are not shared. */
  seats: number;
  shared?: boolean;
  modes?: readonly GameMode[];
  /** Suit name (GDD §3.4.1: REELS, CARDS, DICE, WHEELS, DROPS, CURIOS). Undefined = unknown. */
  suit?: string;
  volatility?: Volatility;
}
/** At least this many distinct suits among the rolled pads (GDD §3.4.1 has six). */
export const ROSTER_MIN_SUITS = 4;
/**
 * Highest unlock tier in the line-up pool. The spec asks for tier 1, but in the registry only bandit, scratch and
 * videopoker are solo and tier 1 (bigone, roulette and blackjack are fixed), which can never pass the suit rule.
 * Tier 2 adds the solo machines that make it reachable (cyclone, hilo, lootbox, mines, pachinko, pachislot, plinko).
 */
export const ROSTER_MAX_TIER = 2;
const ROSTER_TRIES = 48;
const PAD_SIZE: ReadonlyMap<InstanceId, SlotSize> = new Map<InstanceId, SlotSize>(
  SLOTS.filter((s) => ROSTER_PADS.includes(s.id)).map((s): [InstanceId, SlotSize] => [s.id, s.size]),
);
const fitsSlot = (machine: SlotSize, slot: SlotSize): boolean => SLOT_SIZES.indexOf(machine) <= SLOT_SIZES.indexOf(slot);

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/** The line-up is valid when the rolled pads show ≥ `ROSTER_MIN_SUITS` suits and hold a STEADY and a WILD machine. */
function rosterOk(chosen: ReadonlyArray<RosterCandidate | null>): boolean {
  const picked = chosen.filter((c): c is RosterCandidate => c !== null);
  const suits = new Set(picked.map((c) => c.suit).filter((s): s is string => !!s));
  return suits.size >= ROSTER_MIN_SUITS
    && picked.some((c) => c.volatility === 'STEADY')
    && picked.some((c) => c.volatility === 'WILD');
}

/**
 * Seeded random line-up for the flexible pads (WAVE8 item 8). Same seed and catalogue → same line-up. Returns one
 * device per entry of `ROSTER_PADS`, to pass as `createWorld({ assign })`. The guard: when no line-up passes the
 * suit and volatility rules after `ROSTER_TRIES` shuffles (or the catalogue is empty), every pad keeps its GDD §8.6
 * default, so the result is never worse than the fixed layout.
 */
export function rosterFor(seed: number, candidates: readonly RosterCandidate[], mode: GameMode = 'debt'): Partial<Record<InstanceId, MachineId>> {
  const fallback = (): Partial<Record<InstanceId, MachineId>> => {
    const out: Partial<Record<InstanceId, MachineId>> = {};
    for (const pad of ROSTER_PADS) { const d = DEFAULT_ASSIGN[pad]; if (d) out[pad] = d; }
    return out;
  };
  const pool = candidates.filter((c) => !ROSTER_FIXED.has(c.id) && c.tier !== undefined && c.tier >= 1 && c.tier <= ROSTER_MAX_TIER
    && c.seats === 1 && !c.shared
    && (!c.modes || c.modes.includes(mode)));
  if (pool.length === 0) return fallback();
  const rng = createRng(hashSeed('pitdeck', seed));
  for (let attempt = 0; attempt < ROSTER_TRIES; attempt++) {
    const order = shuffled(pool, rng);
    const used = new Set<MachineId>();
    const chosen: Array<RosterCandidate | null> = [];
    for (const pad of ROSTER_PADS) {
      const fitting = order.filter((c) => fitsSlot(c.slotSize, PAD_SIZE.get(pad) ?? 'S'));
      const pick = fitting.find((c) => !used.has(c.id)) ?? fitting[0] ?? null;
      if (pick) used.add(pick.id);
      chosen.push(pick);
    }
    if (!rosterOk(chosen)) continue;
    const out: Partial<Record<InstanceId, MachineId>> = {};
    ROSTER_PADS.forEach((pad, i) => {
      const id = chosen[i]?.id ?? DEFAULT_ASSIGN[pad];
      if (id) out[pad] = id;
    });
    return out;
  }
  return fallback();
}
