/**
 * Rivals of the Tally Bench (STORY lane, Wave 25 "TALLY"; spec docs/WAVE25_TALLY.md). Pure data and the spawn schedule.
 *
 * Phase 1 (playable): Tamsin (side duel, Jade, Nights 2+), Kuro (side duel, Boiler, Night 5), Lucan (Night 3 boss, Parlour; plays Rock, Paper, Promise with the watch mirror, STORY_BIBLE S4).
 * Phase 2 (live now: duel games lockershuffle, thequestion and lastcount exist): Mimosa (Night 4, Wash), Orrin (Night 6 boss, Parlour), Vell (Night 8 boss, Counting). Pass `{ phase2: false }` to hide them.
 *
 * Every text field is an i18n key (strings in `rivals.strings.ts`, prefix `story.duel.`). The portrait spec id belongs to the
 * manga lane, the duel id to the duel games lane, and the zone to the rooms lane. Nothing here imports the duel engine.
 *
 * API for the integrator:
 *   rivalsForNight(night, { phase2? })  side duels offered that Night (optional; none on boss Nights)
 *   bossRivalFor(night, { phase2? })    the boss rival for Night 3, 6 or 8, or null (the standard boss stays)
 *   rivalById(id)                       the RivalDef
 */
import type { Hex } from '@/core/types';
import { BOSS_NIGHTS } from '@/game/data/bosses';

export type RivalId = 'tamsin' | 'kuro' | 'lucan' | 'mimosa' | 'orrin' | 'vell';
export type RivalExpr = 'calm' | 'smirk' | 'shock' | 'rage' | 'hollow';

/** Kit props for the mannequin: a face mask and held or worn props (kit ids, see `kit/props.ts`). */
export interface RivalLook {
  mask: string | null;
  props: Array<{ prop: string; bone: string }>;
}

/** Dialogue keys. `intro` is the rival's line when the duel opens; the rest are used in play or in outro scenes. */
export interface RivalLines {
  catch: string;
  intro: string;
  reveal?: string;
  taunt?: string;
  called?: string;
  loss?: string;
  end?: string;
}

export interface RivalDef {
  id: RivalId;
  phase: 1 | 2;
  /** First and last Night the rival can appear (side duel range, or the single boss Night). */
  nights: [number, number];
  /** i18n keys: name, title, accessory description. */
  name: string;
  title: string;
  accessory: string;
  /** One accent colour for the portrait and the UI; `body` is the suit colour of the mannequin. */
  accent: Hex;
  body: Hex;
  look: RivalLook;
  /** Portrait spec id for the manga portrait (lane C). Expressions: calm, smirk, shock, rage, hollow. */
  portrait: string;
  /** Signature duel: the id of the duel rules module in `src/game/duels/<game>/` (lane B). */
  duel: string;
  /** Venue zone (rooms lane zone id) and the world anchor the duel camera looks at (`duel.<zone>`). */
  zone: string;
  venue: string;
  /** Portrait expression for each beat. */
  expr: { intro: RivalExpr; won: RivalExpr; lost: RivalExpr };
  lines: RivalLines;
  /** The rival's Pledge when they lose: a themed Rare charm (theme names the charm pool) plus Obols. */
  pledge: { theme: string; obols: number };
  /** Extra drop when the rival is beaten (Orrin drops the Manager's Key). */
  drops?: string[];
  /** Clerk line said before the duel (phase 2, Night 6). */
  clerk?: string;
}

const S = 'story.duel.';

export const RIVALS: Readonly<Record<RivalId, RivalDef>> = {
  tamsin: {
    id: 'tamsin', phase: 1, nights: [2, 8],
    name: `${S}rival.tamsin.name`, title: `${S}rival.tamsin.title`, accessory: `${S}rival.tamsin.accessory`,
    accent: 0x3fa37a, body: 0x1d2b26,
    look: { mask: 'mask_porcelain', props: [] },
    portrait: 'tamsin', duel: 'sealedwall', zone: 'cards', venue: 'duel.cards',
    expr: { intro: 'calm', won: 'shock', lost: 'calm' },
    lines: {
      catch: `${S}rival.tamsin.catch`, intro: `${S}line.tamsin.intro`, reveal: `${S}line.tamsin.reveal`,
      taunt: `${S}rival.tamsin.taunt`, called: `${S}rival.tamsin.called`, loss: `${S}rival.tamsin.loss`,
    },
    pledge: { theme: 'jade', obols: 2 },
  },
  kuro: {
    id: 'kuro', phase: 1, nights: [5, 5],
    name: `${S}rival.kuro.name`, title: `${S}rival.kuro.title`, accessory: `${S}rival.kuro.accessory`,
    accent: 0xc9782b, body: 0x2a2320,
    look: { mask: 'mask_owl', props: [] },
    portrait: 'kuro', duel: 'steamcount', zone: 'boiler', venue: 'duel.boiler',
    expr: { intro: 'smirk', won: 'rage', lost: 'smirk' },
    lines: {
      catch: `${S}rival.kuro.catch`, intro: `${S}line.kuro.intro`,
      taunt: `${S}rival.kuro.taunt`, called: `${S}rival.kuro.called`, loss: `${S}rival.kuro.loss`,
    },
    pledge: { theme: 'brass', obols: 2 },
  },
  lucan: {
    id: 'lucan', phase: 1, nights: [3, 3],
    name: `${S}rival.lucan.name`, title: `${S}rival.lucan.title`, accessory: `${S}rival.lucan.accessory`,
    accent: 0xb3262e, body: 0x1e1416,
    look: { mask: 'mask_fox', props: [{ prop: 'watch', bone: 'hand_l' }] },
    portrait: 'lucan', duel: 'promise', zone: 'parlour', venue: 'duel.parlour',
    expr: { intro: 'smirk', won: 'hollow', lost: 'smirk' },
    lines: {
      catch: `${S}rival.lucan.catch`, intro: `${S}line.lucan.load`,
      taunt: `${S}rival.lucan.taunt`, called: `${S}rival.lucan.called`, loss: `${S}rival.lucan.loss`,
    },
    pledge: { theme: 'red', obols: 2 },
  },
  mimosa: {
    id: 'mimosa', phase: 2, nights: [4, 4],
    name: `${S}rival.mimosa.name`, title: `${S}rival.mimosa.title`, accessory: `${S}rival.mimosa.accessory`,
    accent: 0xe0c23a, body: 0x2c2a1c,
    look: { mask: 'mask_hare', props: [] },
    portrait: 'mimosa', duel: 'lockershuffle', zone: 'laundry', venue: 'duel.laundry',
    expr: { intro: 'smirk', won: 'shock', lost: 'smirk' },
    lines: {
      catch: `${S}rival.mimosa.catch`, intro: `${S}line.mimosa.intro`,
      taunt: `${S}rival.mimosa.taunt`, called: `${S}rival.mimosa.called`, loss: `${S}rival.mimosa.loss`,
    },
    pledge: { theme: 'yellow', obols: 2 },
  },
  orrin: {
    id: 'orrin', phase: 2, nights: [6, 6],
    name: `${S}rival.orrin.name`, title: `${S}rival.orrin.title`, accessory: `${S}rival.orrin.accessory`,
    accent: 0xc9a13a, body: 0x3a3c40,
    look: { mask: 'mask_collector', props: [{ prop: 'key', bone: 'hand_r' }] },
    portrait: 'orrin', duel: 'thequestion', zone: 'parlour', venue: 'duel.parlour',
    expr: { intro: 'hollow', won: 'rage', lost: 'calm' },
    lines: {
      catch: `${S}rival.orrin.catch`, intro: `${S}line.orrin.intro`,
      taunt: `${S}rival.orrin.taunt`, called: `${S}rival.orrin.called`, loss: `${S}rival.orrin.loss`,
    },
    pledge: { theme: 'gold', obols: 2 },
    drops: ['manager_key'],
    clerk: `${S}line.clerk.ledger`,
  },
  vell: {
    id: 'vell', phase: 2, nights: [8, 8],
    name: `${S}rival.vell.name`, title: `${S}rival.vell.title`, accessory: `${S}rival.vell.accessory`,
    accent: 0x9a9a9a, body: 0x222222,
    look: { mask: null, props: [{ prop: 'ledger', bone: 'hand_r' }] },
    portrait: 'vell', duel: 'lastcount', zone: 'counting', venue: 'duel.counting',
    expr: { intro: 'calm', won: 'hollow', lost: 'calm' },
    lines: {
      catch: `${S}rival.vell.catch`, intro: `${S}line.vell.intro`, end: `${S}line.vell.end`,
      taunt: `${S}rival.vell.taunt`, called: `${S}rival.vell.called`, loss: `${S}rival.vell.loss`,
    },
    pledge: { theme: 'grey', obols: 2 },
  },
};

/** Night on which the run ends (the last boss, Vell). Side duels run from their first Night to this one at most. */
export const FINAL_NIGHT = 8;

export interface SpawnOpts {
  /** Include the phase 2 rivals (Mimosa, Orrin, Vell). On by default since the three duel games exist; pass false to hide them. */
  phase2?: boolean;
}

const phase2On = (opts: SpawnOpts): boolean => opts.phase2 ?? true;

/** True for the three rivals who hold a boss Night (Lucan 3, Orrin 6, Vell 8): their intro announces the Rival's Terms. */
export function isBossRival(id: RivalId): boolean {
  return Object.values(BOSS_SLOTS).includes(id);
}

/** One side duel offered on a Night. The integrator also checks the venue zone is open before it is shown. */
export interface RivalSpawn {
  rival: RivalDef;
  night: number;
  zone: string;
  /** Side duels are always optional: the player walks into the venue to take one. */
  optional: true;
}

interface SideSlot { rival: RivalId; from: number; to: number }

/** Side duel schedule (WAVE25 Arc): Tamsin from Night 2 in Jade, Mimosa on Night 4 in the Wash (phase 2), Kuro on Night 5. */
const SIDE_SLOTS: readonly SideSlot[] = [
  { rival: 'tamsin', from: 2, to: FINAL_NIGHT },
  { rival: 'mimosa', from: 4, to: 4 },
  { rival: 'kuro', from: 5, to: 5 },
];

/** Boss rival per boss Night (WAVE25 Arc): Lucan on Night 3, Orrin on Night 6, Vell on Night 8. */
const BOSS_SLOTS: Readonly<Record<number, RivalId>> = { 3: 'lucan', 6: 'orrin', 8: 'vell' };

/** Side duels offered on `night`. Boss Nights offer none: the boss rival takes the venue. */
export function rivalsForNight(night: number, opts: SpawnOpts = {}): RivalSpawn[] {
  if (BOSS_NIGHTS.includes(night)) return [];
  const out: RivalSpawn[] = [];
  for (const slot of SIDE_SLOTS) {
    if (night < slot.from || night > slot.to) continue;
    const rival = RIVALS[slot.rival];
    if (rival.phase === 2 && !phase2On(opts)) continue;
    out.push({ rival, night, zone: rival.zone, optional: true });
  }
  return out;
}

/** The boss rival for `night` (3, 6 or 8), or null when the Night has no rival boss or the rival is not enabled. */
export function bossRivalFor(night: number, opts: SpawnOpts = {}): RivalDef | null {
  const id = BOSS_SLOTS[night];
  if (!id) return null;
  const rival = RIVALS[id];
  return rival.phase === 1 || phase2On(opts) ? rival : null;
}

export function rivalById(id: RivalId): RivalDef {
  return RIVALS[id];
}

/** Dialogue keys the duel machine shows in the manga dialogue box (lane C `dialogue`). */
export const CALL_LINES = {
  /** The player's call, said aloud (WAVE25 Dialogue 7). */
  mark: `${S}line.mark.call`,
  /** The Notary's ruling on a correct call (Dialogue 8). */
  cheat: `${S}line.notary.cheat`,
  /** The Notary's ruling on a wrong call (Dialogue 9). */
  wrong: `${S}line.notary.wrong`,
  /** The Notary's line on the seal (Dialogue 1), speaker `${S}speaker.notary`. */
  seal: `${S}line.notary.seal`,
  /** The Mark's line on the seal (Dialogue 2). */
  markIntro: `${S}line.mark.intro`,
  /** The Clerk's line (Dialogue 12), speaker `${S}speaker.clerk`. */
  clerk: `${S}line.clerk.ledger`,
} as const;

/** The rival's dialogue key of a kind, or undefined when that rival has no such line (phase 2 has fewer). */
export function lineOf(id: RivalId, kind: 'catch' | 'intro' | 'reveal' | 'taunt' | 'called' | 'loss' | 'end'): string | undefined {
  return RIVALS[id].lines[kind];
}
