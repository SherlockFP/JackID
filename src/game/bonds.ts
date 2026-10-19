/**
 * BONDS (docs/STORY_BIBLE.md §10; client: "arkadaş ilişkileri de önemli olsun"). One plain 0..3 value for each of Selim, Mira, Tamsin,
 * Lucan, Mimosa, Vell and the Collector (Ada keeps Harmony, Loki keeps Trust; the Clerk and the Compere have none). Pure rules: no DOM,
 * no run import, no clock. Inputs are the printed Night and an event; outputs are a {@link BondChange} (deltas with their toast line key,
 * and the unlock ids gained and lost). run.ts funnels the events (`bond()`), saves it and emits `bond:change`; the bar is food.ts, the PEOPLE page story/notes.ts.
 *
 * Moves: help, a kept word, a share, showing up and defending raise a bond by 1, once per character per Night. A rival beaten clean
 * starts at 1; a win on Loki's hand sets them to 0. Three Nights without a touch cost a pip. A betrayal sets the bond to 0 for good: they
 * act against you once on Night 8 ({@link Bonds.against}), however the bond recovers. Selim lends his name seals to a short quota (bond 2+);
 * an unpaid loan is forgotten {@link FORGET_AFTER} Nights later or on Night 8, and then he has forgotten you; his last seal makes him still.
 *
 * Bonds NEVER gate an outcome of the run. Unlocks are earlier clues, small perks, covered debt and help at the tables, and
 * {@link Bonds.floor} only says who is waiting on Night 8. Nothing here decides, or can block, how the run ends.
 */
import { createRng, hashSeed } from '@/core/rng';

declare module '@/core/events' {
  interface GameEvents {
    /** A bond moved (the wiring emits one per {@link BondDelta}). From Night 5 Ada's phone asks where you were when `to > from`. */
    'bond:change': { who: BondId; from: number; to: number; why: BondWhy; night: number };
  }
}

export const BOND_IDS = ['selim', 'mira', 'tamsin', 'lucan', 'mimosa', 'vell', 'collector'] as const;
export type BondId = (typeof BOND_IDS)[number];

export const BOND_MAX = 3;
/** Nights in a row without a touch before a pip goes. */
export const NEGLECT_NIGHTS = 3;
/** Selim's name seals (§3). Each loan holds one out; with none left he goes still. */
export const SELIM_SEALS = 2;
/** An unpaid loan is forgotten this many Nights after it was lent, or on the final Night, whichever comes first. */
export const FORGET_AFTER = 3;
export const FINAL_NIGHT = 8;
/** The small things Selim can forget (`bonds.selim.thing.0..3`). */
export const SELIM_THINGS = 4;

/** The Night each one first meets the player (§3, §4). Neglect counts from here. */
export const INTRO: Readonly<Record<BondId, number>> = { selim: 1, collector: 1, mira: 2, tamsin: 2, lucan: 3, mimosa: 4, vell: 4 };

/** Rival ids (`story/duels/rivals.ts`) to their bond: the Collector is `orrin` there. Kuro has none. */
const RIVAL_BOND = new Map<string, BondId>([['tamsin', 'tamsin'], ['lucan', 'lucan'], ['mimosa', 'mimosa'], ['vell', 'vell'], ['orrin', 'collector']]);
const RIVAL_SET: ReadonlySet<BondId> = new Set(RIVAL_BOND.values());
export const bondOfRival = (rivalId: string): BondId | null => RIVAL_BOND.get(rivalId) ?? null;

/** What one unlock is for: a `tip` or small `perk`, a covered debt (`cover`), `help` at a table, an earlier `clue`, a hidden kept-`pair` clue, or Night 8 `floor` colour. */
export type UnlockKind = 'tip' | 'perk' | 'cover' | 'help' | 'clue' | 'pair' | 'floor';
export interface UnlockDef { id: string; who: BondId; at: 1 | 2 | 3; kind: UnlockKind }
const u = (who: BondId, at: 1 | 2 | 3, kind: UnlockKind, name: string): UnlockDef => ({ id: `${who}.${name}`, who, at, kind });

/** §10 "What it opens". An unlock is held while the bond is at or above `at`; a drop takes it away (reported in `BondChange.locked`). */
export const UNLOCKS: readonly UnlockDef[] = [
  u('selim', 1, 'tip', 'tip'),          // his tip of the Night
  u('selim', 2, 'perk', 'food'),        // a free food a Night
  u('selim', 2, 'cover', 'cover'),      // his seal on a short quota
  u('selim', 3, 'clue', 'night0'),      // Night 0 at his bar, and that the Compere used to sit at the tables
  u('selim', 3, 'pair', 'pair'),        // "Two people keep the same word, there's nothing on the table to take."
  u('selim', 3, 'help', 'water'),       // his glass of water at the Wager stops the tremble
  u('selim', 3, 'floor', 'rideUp'),     // rides up if you share your N8 winnings
  u('mira', 1, 'tip', 'call'),          // a call each Night with one true floor tip
  u('mira', 2, 'pair', 'pair'),         // the kept pair, said outright (N7)
  u('mira', 3, 'floor', 'liftCall'),    // the lift call in KEPT PAIR
  u('tamsin', 1, 'tip', 'early'),       // her apology comes a turn earlier
  u('tamsin', 2, 'help', 'silence'),    // the Champion's silence tell
  u('tamsin', 3, 'perk', 'fair'),       // one Crooked Table a Night runs fair for you
  u('lucan', 1, 'perk', 'rematch'),     // a rematch without the watch
  u('lucan', 2, 'pair', 'pair'),        // "Unless both keep it. Then nobody gets paid."
  u('lucan', 2, 'help', 'howAda'),      // how Ada beat him
  u('lucan', 3, 'help', 'tell'),        // front row: the Champion's tell aloud, once
  u('mimosa', 1, 'perk', 'charm'),      // one lost charm back
  u('mimosa', 2, 'clue', 'memory'),     // your memory of Night 0, even if you didn't beat her
  u('mimosa', 3, 'clue', 'early'),      // the memory on N6
  u('mimosa', 3, 'help', 'eye'),        // +1 Eye at the Wager
  u('vell', 1, 'tip', 'tape'),          // a tape's hidden line
  u('vell', 2, 'clue', 'count'),        // the count of Night 0
  u('vell', 3, 'help', 'call'),         // he lets you call his throw
  u('vell', 3, 'floor', 'rideUp'),      // rides up with you
  u('collector', 1, 'tip', 'early'),    // he calls before he knocks
  u('collector', 2, 'clue', 'deal'),    // "I took it once. Don't."
  u('collector', 3, 'perk', 'visit'),   // THE VISIT: one more Dawn, once
  u('collector', 3, 'floor', 'lift'),   // he holds the lift door in KEPT PAIR
];

/** A bond value clamped to 0..{@link BOND_MAX} (NaN reads 0). */
export const clampBond = (n: number): number => Math.max(0, Math.min(BOND_MAX, Math.floor(Number.isFinite(n) ? n : 0)));
/** Unlock ids held by `who` at `level`. */
export const unlocksFor = (who: BondId, level: number): string[] => UNLOCKS.filter((x) => x.who === who && x.at <= level).map((x) => x.id);
/** An i18n key of `bonds.strings.ts`: `bonds.<who>.<part>` (part is a level 0..3, `up`, `down`, `betray`, `loki`, or one of Selim's). */
export const lineKey = (who: BondId, part: string | number): string => `bonds.${who}.${part}`;

/** Ways to earn a pip. */
export type RaiseKind = 'help' | 'word' | 'share' | 'show' | 'defend';
/** Why a bond moved. */
export type BondWhy = RaiseKind | 'clean' | 'loki' | 'drop' | 'neglect' | 'betray' | 'lend' | 'forgot';

/**
 * Events about a person: a raise; `clean` (rival beaten with no takeover: at least 1, rivals only); `loki` (a win on Loki's hand: 0,
 * not a betrayal, rivals only); `drop` (-1, not a betrayal: letting it go when Ada asks about Selim on N6); `betray` (a broken word, a
 * false accusation); `talk` (a touch that only resets the neglect clock).
 */
export interface PersonEvent { kind: RaiseKind | 'clean' | 'loki' | 'drop' | 'betray' | 'talk'; who: BondId }
/** `lend` / `repay`: Selim's seal on a short quota and the pay-back at his bar. `dawn`: a paid Dawn closed the Night (also once before the Night 8 Wager). */
export type BondEvent = PersonEvent | { kind: 'lend'; /** Coins of the quota his seal covered: the pay-back price. */ coins?: number } | { kind: 'repay' } | { kind: 'dawn' };

export interface BondDelta { who: BondId; from: number; to: number; why: BondWhy; /** The toast key (`t(line)`). */ line: string }
export interface BondChange {
  deltas: BondDelta[];
  /** Unlock ids gained and lost by this event. */
  unlocked: string[];
  locked: string[];
  /** Selim's loan: the narration key (`bonds.selim.lend` / `repay`) and the small thing (`bonds.selim.thing.<n>`, the `{thing}` var). */
  line?: string;
  thing?: number;
  /** A lend or repay turned down, and why. */
  refused?: 'bond' | 'night' | 'forgot' | 'still' | 'none';
}

interface Rec { v: number; /** The last Night the player touched them. */ last: number; /** The last Night they rose. */ up: number; burned: boolean }
interface Loan { night: number; thing: number; coins: number }

/** Save shape (`resume.ext.bonds`). Everything checked on restore; a save without it reads as a fresh run. */
export interface BondsSave { v: 1; b: Record<BondId, Rec>; loans: Loan[]; taken: number; forgot: boolean; /** Once-a-run unlocks already spent ({@link Bonds.useOnce}). */ used?: string[] }

const freshRecs = (): Record<BondId, Rec> =>
  Object.fromEntries(BOND_IDS.map((w) => [w, { v: w === 'selim' ? 1 : 0, last: INTRO[w] - 1, up: 0, burned: false }])) as Record<BondId, Rec>;

export class Bonds {
  private rec = freshRecs();
  /** Seals Selim lent that are not paid back, oldest first. Each holds one of his {@link SELIM_SEALS} out. */
  private loans: Loan[] = [];
  /** Loans ever made: picks the next small thing from the seeded order. */
  private taken = 0;
  private forgot = false;
  private used: string[] = [];
  private readonly order: number[];

  constructor(seed: number) {
    // shortcut: the thing is picked from a seeded shuffle of 4, so two loans never repeat; add strings and bump SELIM_THINGS for more.
    this.order = createRng(hashSeed('bonds.forget', seed)).shuffle(Array.from({ length: SELIM_THINGS }, (_, i) => i));
  }

  level(who: BondId): number { return this.rec[who].v; }
  /** Unlock ids held now. */
  unlocked(): string[] { return BOND_IDS.flatMap((w) => unlocksFor(w, this.rec[w].v)); }
  has(id: string): boolean { return this.unlocked().includes(id); }
  /** Selim out of seals: he stands still behind the bar. */
  private get still(): boolean { return this.loans.length >= SELIM_SEALS; }
  /** Selim's books: seals he still has, loans out, the price of paying the oldest back, and whether he has forgotten you. */
  selim(): { seals: number; owes: number; price: number; forgot: boolean; still: boolean } {
    return { seals: SELIM_SEALS - this.loans.length, owes: this.loans.length, price: this.loans[0]?.coins ?? 0, forgot: this.forgot, still: this.still };
  }
  /** A once-a-run unlock (the Collector's VISIT, Lucan's line): true the first time it is asked while held, then never again. */
  useOnce(id: string): boolean {
    if (!this.has(id) || this.used.includes(id)) return false;
    this.used.push(id);
    return true;
  }
  /** Who is waiting on Night 8 (bond 3, never betrayed). Colour only: the run ends the same with or without them. */
  floor(): BondId[] { return BOND_IDS.filter((w) => this.rec[w].v >= BOND_MAX && !this.rec[w].burned); }
  /** Who was betrayed. Each acts against you once on Night 8 (the wiring plan lists the seven acts; the Collector's is Heat +1 every Night). */
  against(): BondId[] { return BOND_IDS.filter((w) => this.rec[w].burned); }
  /** The key of what `who` says to you now: Selim's still and forgotten lines first, else the line for their level. */
  greeting(who: BondId): string {
    if (who === 'selim' && this.still) return lineKey('selim', 'still');
    if (who === 'selim' && this.forgot) return lineKey('selim', 'forgotYou');
    return lineKey(who, this.rec[who].v);
  }

  /** Applies one event in printed Night `night`. */
  apply(night: number, ev: BondEvent): BondChange {
    const before = this.unlocked();
    const out: BondChange = { deltas: [], unlocked: [], locked: [] };
    if (ev.kind === 'dawn') this.dawn(night, out);
    else if (ev.kind === 'lend') this.lend(night, out, ev.coins ?? 0);
    else if (ev.kind === 'repay') this.repay(night, out);
    else this.person(night, ev, out);
    const after = this.unlocked();
    out.unlocked = after.filter((id) => !before.includes(id));
    out.locked = before.filter((id) => !after.includes(id));
    return out;
  }

  private move(who: BondId, to: number, why: BondWhy, line: string, out: BondChange, force = false): void {
    const r = this.rec[who];
    if (to === r.v && !force) return;
    out.deltas.push({ who, from: r.v, to, why, line });
    r.v = to;
  }

  private touch(who: BondId, night: number): void { this.rec[who].last = Math.max(this.rec[who].last, night); }

  private person(night: number, ev: PersonEvent, out: BondChange): void {
    const { who } = ev;
    const r = this.rec[who];
    if ((ev.kind === 'clean' || ev.kind === 'loki') && !RIVAL_SET.has(who)) return;
    this.touch(who, night);
    switch (ev.kind) {
      case 'talk': break;
      case 'betray':
        if (r.burned) break;
        r.burned = true;
        this.move(who, 0, 'betray', lineKey(who, 'betray'), out, true);
        break;
      case 'loki': this.move(who, 0, 'loki', lineKey(who, 'loki'), out); break;
      case 'drop': this.move(who, Math.max(0, r.v - 1), 'drop', lineKey(who, 'down'), out); break;
      case 'clean': if (r.v < 1) this.rise(who, night, 'clean', out); break;
      default: this.rise(who, night, ev.kind, out);
    }
  }

  /** +1, once per Night, never past the cap and never for a Selim who stands still. */
  private rise(who: BondId, night: number, why: BondWhy, out: BondChange): void {
    const r = this.rec[who];
    if (r.v >= BOND_MAX || r.up === night || (who === 'selim' && this.still)) return;
    r.up = night;
    this.move(who, r.v + 1, why, lineKey(who, 'up'), out);
  }

  /** The Dawn that closes `night`: three Nights untouched cost a pip, and Selim forgets a loan that came due. */
  private dawn(night: number, out: BondChange): void {
    for (const who of BOND_IDS) {
      const r = this.rec[who];
      if (r.v > 0 && night - r.last >= NEGLECT_NIGHTS) {
        r.last = night;
        this.move(who, r.v - 1, 'neglect', lineKey(who, 'down'), out);
      }
    }
    if (!this.forgot && this.loans.some((l) => night >= Math.min(l.night + FORGET_AFTER, FINAL_NIGHT))) {
      this.forgot = true;
      this.rec.selim.burned = true;
      this.move('selim', 0, 'forgot', lineKey('selim', 'forgot'), out, true);
    }
  }

  /** Selim's seal on a short quota: bond 2+, a seal left, not forgotten, once a Night. The last seal makes him still. */
  private lend(night: number, out: BondChange, coins: number): void {
    const no = this.forgot ? 'forgot' : this.still ? 'still' : this.rec.selim.v < 2 ? 'bond' : this.loans.some((l) => l.night === night) ? 'night' : null;
    if (no) { out.refused = no; return; }
    const thing = this.order[this.taken++ % SELIM_THINGS];
    this.loans.push({ night, thing, coins: Math.max(0, Math.floor(coins)) });
    this.touch('selim', night);
    out.thing = thing;
    out.line = lineKey('selim', 'lend');
    if (this.still) this.move('selim', 0, 'lend', lineKey('selim', 'still'), out);
  }

  /** The pay-back at the bar: the Clerk returns the oldest loan's seal and the thing. Refused once he forgot you or stands still. The price is the caller's. */
  private repay(night: number, out: BondChange): void {
    const no = this.forgot ? 'forgot' : this.still ? 'still' : this.loans.length === 0 ? 'none' : null;
    if (no) { out.refused = no; return; }
    out.thing = (this.loans.shift() as Loan).thing;
    out.line = lineKey('selim', 'repay');
    this.touch('selim', night);
  }

  snapshot(): BondsSave {
    const b = {} as Record<BondId, Rec>;
    for (const w of BOND_IDS) b[w] = { ...this.rec[w] };
    return { v: 1, b, loans: this.loans.map((l) => ({ ...l })), taken: this.taken, forgot: this.forgot, used: [...this.used] };
  }

  /** Restores a save; anything damaged falls back to the fresh value, and the Selim invariants (burned when forgotten, 0 when still) are re-applied. */
  restore(s: unknown): void {
    this.rec = freshRecs();
    this.loans = [];
    this.taken = 0;
    this.forgot = false;
    this.used = [];
    if (!s || typeof s !== 'object') return;
    const o = s as Partial<BondsSave>;
    const n = (x: unknown, hi: number): number | null => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= hi ? x : null);
    for (const w of BOND_IDS) {
      const x = o.b && typeof o.b === 'object' ? o.b[w] : undefined;
      if (!x || typeof x !== 'object') continue;
      const r = this.rec[w];
      r.v = n(x.v, BOND_MAX) ?? r.v;
      r.last = n(x.last, 9999) ?? r.last;
      r.up = n(x.up, 9999) ?? r.up;
      r.burned = x.burned === true;
    }
    if (Array.isArray(o.loans)) {
      for (const l of o.loans) {
        const night = n(l?.night, 9999);
        const thing = n(l?.thing, SELIM_THINGS - 1);
        if (night !== null && thing !== null && this.loans.length < SELIM_SEALS) this.loans.push({ night, thing, coins: n(l?.coins, 1e12) ?? 0 });
      }
    }
    this.taken = n(o.taken, 99999) ?? this.loans.length;
    this.forgot = o.forgot === true;
    if (Array.isArray(o.used)) this.used = o.used.filter((x): x is string => typeof x === 'string' && UNLOCKS.some((d) => d.id === x));
    if (this.forgot) this.rec.selim.burned = true;
    if (this.still) this.rec.selim.v = 0;
  }
}
