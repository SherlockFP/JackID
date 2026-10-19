/**
 * Seat coach (`_base`): teaches a machine by doing, in place of the old first-sit HOW TO PLAY card.
 *
 *   steps     `def.coach`: 2-4 `{ key, say, done }`. The step's key pulses in the seat HUD key bar and its short line
 *             (`coach.say.<say>`) sits in one small box over the bar. A step shows only while its key is in the bar.
 *   result    after a coached round, one line on what happened (`×5 → 10`, or the machine's `coach.lose.<id>`) and the
 *             machine's one-line rule (`coach.why.<id>`), once the round's show has finished.
 *   practice  solo machines with a script: the first PRACTICE_ROUNDS plays per machine type per profile are free. MachineBase
 *             skips `run.bet` / `run.win` and draws the round from its own seeded stream, so paid play is untouched.
 *   progress  per profile, in the save's `seen` record: `coach.<id>` = steps done, `practice.<id>` = free plays used.
 *
 * DOM-free: MachineBase feeds it and publishes `coach:view`; seatHud.ts draws it (coach.css).
 */
import { fmtCoins, has, t } from '@/core/i18n';

declare module '@/core/events' {
  interface GameEvents {
    /** The seated machine's coach box (null: no coach, or stood up). MachineBase publishes, the seat HUD draws. */
    'coach:view': { view: CoachView | null };
  }
}

/**
 * When a step is done: `press` its key was pressed · `round` a play started · `result` a play settled (told once its show
 * ends) · `bet` the stake changed · `gamble` DOUBLE OR NOTHING was offered and then taken or let go (the step shows only
 * while the offer is live).
 */
export type CoachDone = 'press' | 'round' | 'result' | 'bet' | 'gamble';
/** `key`: the bar action(s) to press (the HUD control's `action`; several separated by a space). `say`: `coach.say.<say>`. */
export interface CoachStep { key: string; say: string; done: CoachDone }

/** What the seat HUD draws. `keys` empty: `line` is a result note and shows as is. */
export interface CoachView { keys: string[]; line: string; why: string; tone: 'good' | 'bad' | ''; tag: string }

export const PRACTICE_ROUNDS = 2;
/** Seconds a result note stays before the next step line comes back. */
const NOTE_S = 4;

/** Per-profile progress. The app hands in the save's `seen` record (machines may not import the app core). */
export interface CoachStore { get(key: string): number; set(key: string, v: number): void }
const mem = new Map<string, number>();
let store: CoachStore = { get: (k) => mem.get(k) ?? 0, set: (k, v) => { mem.set(k, v); } };
/** Without a store (bench, tests) progress lives in memory for the page. */
export function setCoachStore(s: CoachStore): void { store = s; }

const MAIN = new Set(['primary', 'confirm']);
const same = (a: string, b: string): boolean => a === b || (MAIN.has(a) && MAIN.has(b));
/** A step's bar actions ('' = a line with no key, shown as is). */
const keysOf = (s: CoachStep): string[] => s.key.split(' ').filter(Boolean);

type Note = { text: string; why: string; tone: 'good' | 'bad'; free: boolean; t: number };

export class Coach {
  private stepN: number;
  private used: number;
  private freeRound = false;
  private pend: { gross: number; bet: number; free: boolean } | null = null;
  private note: Note | null = null;
  private offerOn = false;

  constructor(readonly id: string, readonly steps: readonly CoachStep[], private readonly canPractice: boolean) {
    this.stepN = Math.min(steps.length, Math.max(0, store.get(`coach.${id}`)));
    this.used = Math.max(0, store.get(`practice.${id}`));
  }

  get done(): boolean { return this.stepN >= this.steps.length; }
  /** The next play is free. */
  get practice(): boolean { return this.canPractice && this.used < PRACTICE_ROUNDS; }
  /** The round in play is a practice round. */
  get practiceRound(): boolean { return this.freeRound; }
  /** The free plays used on this machine type (also the seed index of the next practice round). */
  get practiceUsed(): number { return this.used; }

  private get cur(): CoachStep | undefined { return this.steps[this.stepN]; }
  private advance(kind: CoachDone, action = ''): void {
    const s = this.cur;
    if (!s || s.done !== kind) return;
    if (kind === 'press' && !keysOf(s).some((k) => same(k, action))) return;
    this.stepN++;
    store.set(`coach.${this.id}`, this.stepN);
  }

  press(action: string): void { this.advance('press', action); }
  bet(): void { this.advance('bet'); }
  /** A play started; `free` = a practice round (MachineBase decides it from `practice`). */
  round(free: boolean): void {
    this.freeRound = free;
    this.note = null;
    this.advance('round');
  }
  /** A play settled. A practice round counts as used at once; the note waits for `tick` (the show is still running). */
  result(gross: number, bet: number): void {
    const free = this.freeRound;
    this.freeRound = false;
    if (free) store.set(`practice.${this.id}`, ++this.used);
    this.pend = { gross, bet, free };
  }
  /** DOUBLE OR NOTHING offer state, every step. */
  offer(on: boolean): void {
    if (this.offerOn && !on) this.advance('gamble');
    this.offerOn = on;
  }
  /** Fixed step. `quiet`: no presentation is queued, so a settled round can be told now. */
  tick(dt: number, quiet: boolean): void {
    if (this.note && (this.note.t -= dt) <= 0) this.note = null;
    const r = this.pend;
    if (!r || !quiet) return;
    this.pend = null;
    const teaching = this.cur !== undefined && this.cur.done !== 'gamble';
    if (teaching || r.free) this.note = { ...noteOf(this.id, r.gross, r.bet), free: r.free, t: NOTE_S };
    this.advance('result');
  }

  view(): CoachView {
    const n = this.note;
    const s = n ? undefined : this.cur;
    const step = s !== undefined && (s.done !== 'gamble' || this.offerOn) ? s : undefined;
    const told = n?.free || this.pend?.free;             // a practice round settled (its show may still run): its own number
    const free = told ? this.used : this.freeRound || this.practice ? this.used + 1 : 0;
    return {
      keys: step ? keysOf(step) : [],
      line: step ? t(`coach.say.${step.say}`) : n?.text ?? '',
      why: n?.why ?? '',
      tone: n?.tone ?? '',
      tag: free > 0 ? t('coach.tag', { n: Math.min(free, PRACTICE_ROUNDS), of: PRACTICE_ROUNDS }) : '',
    };
  }
}

/** The one-line result: `×x → gross` for a win (or part of the stake back), the machine's loss line, and its rule. */
function noteOf(id: string, gross: number, bet: number): { text: string; why: string; tone: 'good' | 'bad' } {
  const why = has(`coach.why.${id}`) ? t(`coach.why.${id}`) : '';
  if (gross <= 0) return { text: t(has(`coach.lose.${id}`) ? `coach.lose.${id}` : 'coach.lose'), why, tone: 'bad' };
  const x = String(Number((gross / Math.max(1, bet)).toFixed(1)));
  return { text: t(gross > bet ? 'coach.win' : 'coach.back', { x, n: fmtCoins(gross) }), why, tone: gross > bet ? 'good' : 'bad' };
}
