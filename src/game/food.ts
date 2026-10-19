/**
 * FOOD (client: "put food like bananas we can eat, with extra bonuses, tune them well"). Five small foods, each a readable bonus
 * on the existing modifier pipeline, sold at the Apothecary's food page (src/machines/tonic_vendor) and kept in the fridge at home.
 *
 *   banana      +1 pull on the next Watch             (x.run.pullsAdd +1)
 *   coffee      steadier hands: Tilt grace +1          (x.tilt.grace +1)
 *   sandwich    +1 ŞANS star on the next Watch         (payout.mult x1.01, one star = 1 %, src/game/luck.ts)
 *   energy      +15 s on the next Watch clock          (x.run.clockAdd +15)
 *   soup        eaten at home with Ada: Harmony +1, once a Night (no timed bonus)
 *
 * ONE FOOD BONUS AT A TIME: a new meal replaces the old one. The four bonuses are buffs `food.*` (src/game/data/buffs.ts), each
 * lasting one Watch (`shifts`). The buff defs call back here (`onFoodAdded`, `onPendingTick`), so the rules hold for every way a
 * meal arrives (the bar, the fridge) without a mount. The pull and clock numbers are read when a Watch starts, so a meal eaten
 * DURING a Watch is kept as a hidden `food.pending` buff and turns into the real bonus the moment the Watch is over: it always
 * works for "the next Watch", never for a Watch already running. Eaten between Watches (Dawn, the Evening, the Mola), it is live at once.
 *
 * The fridge (`mountFood`) holds up to FRIDGE_MAX meals. Ada leaves something in it each Night; the economy lane's market delivers with
 * `addToFridge(id)`. Eating plays a short hand animation (src/player/viewmodel.ts) and a sound; no setTimeout, no wall clock.
 * Saved with `fridgeSnapshot()` / `fridgeRestore()`; the buffs travel with the buff save.
 *
 * SELIM'S BAR (bonds, docs/STORY_BIBLE.md §10): the food page is his bar. Opening it (`bar:food`, from the machine) is a word with
 * him; the first time a Night he greets you by bond, gives his tip (bond 1: the next Hot Lamp), the kept-pair line (bond 3) and a
 * free coffee (bond 2). Then a short pick list: TIP (a share, +1 bond) and PAY BACK while he holds a loan (the share of the quota his
 * seal covered). His last seal at a short Dawn asks here too (`selim:ask`).
 */
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { createRng, hashSeed } from '@/core/rng';
import type { BuffsApi } from './buffs.types';
import type { HomePhoneApi } from './home/contract';
import { hooksOf } from './home/phone';
import { machineName } from './progression';
import type { BondChange, BondEvent, Bonds } from './bonds';
import type { MachineId } from '@/core/types';

export type FoodId = 'banana' | 'coffee' | 'sandwich' | 'energy' | 'soup';
export const FOOD_IDS: readonly FoodId[] = ['banana', 'coffee', 'sandwich', 'energy', 'soup'];

export interface FoodDef {
  id: FoodId;
  /** The buff this food gives (null: no timed bonus). */
  buff: string | null;
  /** Coins at the bar (soup is not sold there; its price is the market's reference). */
  price: number;
  /** The hand animation: bite or sip. */
  verb: 'eat' | 'drink';
  /** Sold on the Apothecary's food page. */
  bar: boolean;
}

/**
 * Tuning (coins are Night 1 scale: a tonic costs 25 to 90). Prices stay low: a food is a snack, not a charm.
 * banana 8 buys one pull (the cheapest, the weakest); coffee 14, energy 28 and sandwich 20 cost about what the tonic they echo costs per second.
 */
export const FOODS: Readonly<Record<FoodId, FoodDef>> = {
  banana: { id: 'banana', buff: 'food.banana', price: 8, verb: 'eat', bar: true },
  coffee: { id: 'coffee', buff: 'food.coffee', price: 14, verb: 'drink', bar: true },
  sandwich: { id: 'sandwich', buff: 'food.sandwich', price: 20, verb: 'eat', bar: true },
  energy: { id: 'energy', buff: 'food.energy', price: 28, verb: 'drink', bar: true },
  soup: { id: 'soup', buff: null, price: 16, verb: 'drink', bar: false },
};

/** The bonus numbers (data/buffs.ts holds the same values as effects; the tests keep the two in step). */
export const FOOD_FX = { pulls: 1, tiltGrace: 1, starPayout: 1.01, clockSec: 15 } as const;

/** The bar's food page, in slot order. */
export const BAR_MENU: readonly FoodId[] = FOOD_IDS.filter((id) => FOODS[id].bar);

/** Every food buff id, and the hidden slot a meal waits in while a Watch is running. */
export const FOOD_BUFFS: readonly string[] = FOOD_IDS.flatMap((id) => (FOODS[id].buff ? [FOODS[id].buff as string] : []));
export const PENDING_BUFF = 'food.pending';

export const foodOfBuff = (buffId: string): FoodId | null => FOOD_IDS.find((id) => FOODS[id].buff === buffId) ?? null;
export const isFoodId = (v: unknown): v is FoodId => typeof v === 'string' && (FOOD_IDS as readonly string[]).includes(v);

/** The Watch is running (the bell has rung and the settle is not over): pull and clock numbers are already read. */
export function isWatchLive(phase: string): boolean {
  return phase === 'bell' || phase === 'play' || phase === 'lastCall' || phase === 'closing' || phase === 'settle';
}

// ── the fridge ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const FRIDGE_MAX = 8;
/** Chance Ada has made soup on a Night (she only does when there is Harmony to keep, and not every Night). */
export const ADA_SOUP_CHANCE = 0.5;
const ADA_SNACKS: readonly FoodId[] = ['banana', 'sandwich', 'coffee'];

/**
 * What Ada leaves in the fridge on `night`: always one snack; soup on about every other Night while there is Harmony to keep
 * (1..4; at 0 she is not home, at 5 there is nothing to add). Both draws are made every time, so the stream never shifts.
 */
export function adaStock(seed: number, night: number, harmony: number): FoodId[] {
  const rng = createRng(hashSeed(seed, 'fridge', night));
  const snack = ADA_SNACKS[rng.int(0, ADA_SNACKS.length - 1)];
  const soup = rng.chance(ADA_SOUP_CHANCE);
  const out: FoodId[] = [snack];
  if (soup && harmony >= 1 && harmony < 5) out.push('soup');
  return out;
}

export type SoupOutcome = 'alone' | 'plain' | 'warm';
/** Soup with Ada: not home (Harmony 0) it waits; already shared tonight, or nothing left to gain, it is only a warm meal; else Harmony +1. */
export function soupOutcome(harmony: number, soupDoneTonight: boolean): SoupOutcome {
  if (harmony <= 0) return 'alone';
  if (soupDoneTonight || harmony >= 5) return 'plain';
  return 'warm';
}

export interface FridgeSave { items: FoodId[]; stocked: number; soupNight: number }
export interface Fridge {
  items(): FoodId[];
  count(id: FoodId): number;
  /** Puts a meal in. False when the id is unknown or the fridge is full. */
  add(id: string): boolean;
  /** Takes one out. False when there is none. */
  take(id: FoodId): boolean;
  /** Ada's stock for `night`, once per Night. Returns what went in. */
  restock(seed: number, night: number, harmony: number): FoodId[];
  /** Soup was shared with Ada on `night`. */
  soupDone(night: number): boolean;
  markSoup(night: number): void;
  snapshot(): FridgeSave;
  restore(s: unknown): void;
}

export function createFridge(): Fridge {
  let items: FoodId[] = [];
  let stocked = 0;
  let soupNight = 0;
  const fridge: Fridge = {
    items: () => [...items],
    count: (id) => items.filter((i) => i === id).length,
    add(id) {
      if (!isFoodId(id) || items.length >= FRIDGE_MAX) return false;
      items.push(id);
      return true;
    },
    take(id) {
      const i = items.indexOf(id);
      if (i < 0) return false;
      items.splice(i, 1);
      return true;
    },
    restock(seed, night, harmony) {
      if (night <= stocked) return [];
      stocked = night;
      const put: FoodId[] = [];
      for (const id of adaStock(seed, night, harmony)) if (fridge.add(id)) put.push(id);
      return put;
    },
    soupDone: (night) => soupNight === night,
    markSoup(night) { soupNight = night; },
    snapshot: () => ({ items: [...items], stocked, soupNight }),
    restore(s) {
      items = []; stocked = 0; soupNight = 0;
      if (!s || typeof s !== 'object') return;
      const o = s as Partial<FridgeSave>;
      if (Array.isArray(o.items)) for (const id of o.items) if (isFoodId(id) && items.length < FRIDGE_MAX) items.push(id);
      if (typeof o.stocked === 'number' && Number.isFinite(o.stocked)) stocked = Math.max(0, Math.floor(o.stocked));
      if (typeof o.soupNight === 'number' && Number.isFinite(o.soupNight)) soupNight = Math.max(0, Math.floor(o.soupNight));
    },
  };
  return fridge;
}

/** The run's fridge. Always there (so a market delivery before the mount is not lost); `mountFood` clears it for a new run. */
let fridge: Fridge = createFridge();
export const fridgeOf = (): Fridge => fridge;

/** The economy lane's market delivers here. False when the id is unknown or the fridge is full. */
export function addToFridge(id: string): boolean {
  const ok = fridge.add(id);
  if (ok) {
    try { app?.ui?.toast(t('food.fridge.stored', { name: t(`food.${id}.name`) }), 'info', 2.5); } catch { /* no UI in tests */ }
  }
  return ok;
}
export const fridgeSnapshot = (): FridgeSave => fridge.snapshot();
export const fridgeRestore = (s: unknown): void => fridge.restore(s);

// ── eating: the buff callbacks ───────────────────────────────────────────────────────────────────────────────────────
/** The slice of the buff context the callbacks use (the BuffCtx of src/game/buffs.types.ts). */
export interface FoodCtx { owner: unknown; data: Record<string, unknown>; remove(): void }

export interface FoodRunPort {
  selfId: number;
  buffs: BuffsApi;
  shift: { phase: string };
}
const runPort = (): FoodRunPort | null => (app?.run as unknown as FoodRunPort | null) ?? null;
const pidOf = (c: FoodCtx, run: FoodRunPort): number => (typeof c.owner === 'number' ? c.owner : run.selfId);

/** A `food.*` buff was just added to the player: one food at a time, the Watch rule, then the meal's show. */
export function onFoodAdded(buffId: string, c: FoodCtx, run: FoodRunPort | null = runPort()): void {
  const food = foodOfBuff(buffId);
  if (!run || !food) return;
  const pid = pidOf(c, run);
  for (const other of [...FOOD_BUFFS, PENDING_BUFF]) {
    if (other !== buffId && run.buffs.has(other, { pid })) run.buffs.remove(other, { pid });
  }
  if (c.data.held) return;                               // it came out of the pending slot: already announced
  const later = isWatchLive(run.shift.phase);
  if (later) {
    c.remove();
    run.buffs.add(PENDING_BUFF, { pid, data: { food }, source: { kind: 'system', id: 'food' } });
  }
  if (pid === run.selfId && run === runPort()) present(food, later);
}

/** Once a second while a meal waits: the Watch is over, so it becomes the real bonus. */
export function onPendingTick(c: FoodCtx, run: FoodRunPort | null = runPort()): void {
  if (!run || isWatchLive(run.shift.phase)) return;
  const food = c.data.food;
  c.remove();
  if (!isFoodId(food)) return;
  const buff = FOODS[food].buff;
  if (buff) run.buffs.add(buff, { pid: pidOf(c, run), data: { held: 1 }, source: { kind: 'system', id: 'food' } });
}

/** Clears every food bonus (and a waiting meal) for `pid`. Used before a new meal so eating the same food again still replays. */
export function clearFoodBuffs(buffs: Pick<BuffsApi, 'has' | 'remove'>, pid: number): void {
  for (const id of [...FOOD_BUFFS, PENDING_BUFF]) if (buffs.has(id, { pid })) buffs.remove(id, { pid });
}

// ── eating: the show (hands, sound, toast) ───────────────────────────────────────────────────────────────────────────
let sfxReady = false;
function ensureSfx(): void {
  if (sfxReady) return;
  const audio = app?.audio as unknown as { register?: (n: string, r: (k: any, o: any) => number, m?: object) => void } | null;
  if (!audio?.register) return;
  sfxReady = true;
  const env = (d: number) => ({ a: 0.002, d, s: 0, r: 0.02 });
  // a crunchy bite, three times, after the hand reaches the mouth
  audio.register('foodBite', (k) => {
    for (let i = 0; i < 3; i++) {
      const at = 0.5 + i * 0.16;
      k.noise(0.06, { at, vol: 0.34, filter: 'bandpass', freq: 1800 + i * 350, q: 1.2, env: env(0.04) });
      k.osc('triangle', 230 - i * 25, 0.05, { at, vol: 0.1, to: 120 });
    }
    return 1.1;
  }, { pri: 6, max: 2 });
  // a sip and a swallow
  audio.register('foodSip', (k) => {
    k.noise(0.28, { at: 0.5, vol: 0.05, filter: 'lowpass', freq: 900, env: { a: 0.04, d: 0.1, s: 0.5, r: 0.1 } });
    k.osc('sine', 320, 0.12, { at: 0.8, vol: 0.2, to: 140 });
    k.osc('sine', 260, 0.14, { at: 1.0, vol: 0.18, to: 110 });
    return 1.2;
  }, { pri: 6, max: 2 });
}

let busy = 0;
function handAnim(food: FoodId): void {
  const pl = app?.player;
  const vm = pl?.viewmodel as unknown as { item?: string; hold(i: string): void; play(a: string): Promise<void> } | undefined;
  if (!pl || !vm || pl.mode !== 'walk') return;
  if (vm.item !== 'coin' && vm.item !== 'none') return;
  busy++;
  vm.hold(food);
  void vm.play(FOODS[food].verb).then(() => {
    busy--;
    if (busy === 0 && vm.item === food) vm.hold('coin');
  });
}

/** The meal's show: the hand lifts it (when the hands are out), a bite or a sip, and a toast with the bonus. */
function present(food: FoodId, later: boolean): void {
  try {
    ensureSfx();
    app?.audio?.play(FOODS[food].verb === 'eat' ? 'foodBite' : 'foodSip', { priority: 6 });
  } catch { /* audio is optional */ }
  try { handAnim(food); } catch { /* hands are optional */ }
  try {
    app?.ui?.toast(t(later ? 'food.toast.later' : 'food.toast', { name: t(`food.${food}.name`), fx: t(`food.${food}.desc`) }), 'good', 3.2);
  } catch { /* no UI in tests */ }
}

// ── the fridge at home ───────────────────────────────────────────────────────────────────────────────────────────────
export interface FoodHost {
  seed: number;
  selfId: number;
  night(): number;
  buffs: BuffsApi;
  homePhone?(): HomePhoneApi | null;
  // Selim's bar (the run has them all; optional so a bare host still mounts the fridge)
  bonds?(): Bonds;
  bond?(ev: BondEvent): BondChange;
  nextHot?(): { machineId: string } | null;
  debt?(): { due: number };
  canAfford?(cost: number): boolean;
  spend?(cur: 'coin', amount: number, reason: string): boolean;
  selimAnswer?(yes: boolean): void;
}

// ── Selim's bar ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** A tip at Selim's bar: this share of tonight's quota, at least one coin. */
export const TIP_SHARE = 0.03;
export const tipPrice = (due: number): number => Math.max(1, Math.round(Math.max(0, due) * TIP_SHARE));
export type BarRow = 'tip' | 'repay';
/** What the bar offers: a tip unless he stands still (out of seals), and PAY BACK while a loan is out and he can still take it. */
export function barRows(s: { owes: number; forgot: boolean; still: boolean }): BarRow[] {
  if (s.still) return [];
  return s.owes > 0 && !s.forgot ? ['tip', 'repay'] : ['tip'];
}

/**
 * Mounts the fridge station for a run: `home:interact` with station 'fridge' opens a short pick list. Ada's snack (and sometimes soup)
 * is put in on the first opening of each Night. Returns the unmount. Solo runs only (the session decides).
 */
export function mountFood(run: FoodHost): () => void {
  // the fridge is not reset here: the run clears it for a fresh run and restores it on resume (run.ts)
  let open = false;
  let disposed = false;

  const eat = (id: FoodId): void => {
    if (id === 'soup') {
      const phone = run.homePhone?.() ?? null;
      const night = run.night();
      const out = soupOutcome(phone?.harmony() ?? 0, fridge.soupDone(night));
      if (out === 'alone') { app?.ui?.toast(t('food.toast.soupAlone'), 'info', 3); return; }
      fridge.take('soup');
      fridge.markSoup(night);
      if (out === 'warm') hooksOf(phone)?.harmony(1);
      present('soup', false);
      app?.ui?.toast(t(out === 'warm' ? 'food.toast.soup' : 'food.toast.soupPlain', { name: t('food.soup.name') }), 'good', 4);
      return;
    }
    const buff = FOODS[id].buff;
    if (!buff || !fridge.take(id)) return;
    clearFoodBuffs(run.buffs, run.selfId);
    run.buffs.add(buff, { pid: run.selfId, source: { kind: 'system', id: 'food' } });
  };

  const openFridge = async (): Promise<void> => {
    if (open || disposed) return;
    open = true;
    try {
      const phone = run.homePhone?.() ?? null;
      const put = fridge.restock(run.seed, run.night(), phone?.harmony() ?? 0);
      if (put.length) app?.ui?.toast(t('food.fridge.ada'), 'info', 2.5);
      const kinds = FOOD_IDS.filter((id) => fridge.count(id) > 0);
      if (kinds.length === 0) { app?.ui?.toast(t('food.fridge.empty'), 'info', 2.5); return; }
      const labels = kinds.map((id) => {
        const n = fridge.count(id);
        return `${t(`food.${id}.name`)}${n > 1 ? ` x${n}` : ''}  -  ${t(`food.${id}.desc`)}`;
      });
      const pick = await app?.ui?.choice(t('food.fridge.title'), [...labels, t('food.fridge.close')], { timeout: 20 });
      if (disposed || pick === undefined || pick < 0 || pick >= kinds.length) return;
      eat(kinds[pick]);
    } catch { /* the UI went away mid-pick */ } finally {
      open = false;
    }
  };

  // ── Selim's bar (the food page) ──
  let barOpen = false;
  let greetNight = 0;
  let foodNight = 0;
  const say = (key: string, vars?: Record<string, string | number>): void => {
    bus.emit('floor:say', { text: t(key, vars), speaker: t('story.speaker.selim'), voice: 'bartender', source: 'bonds.selim' });
  };
  const hasFood = (): boolean => [...FOOD_BUFFS, PENDING_BUFF].some((id) => run.buffs.has(id, { pid: run.selfId }));

  const openBar = async (): Promise<void> => {
    const book = run.bonds?.();
    if (!book || !run.bond || barOpen || disposed) return;
    barOpen = true;
    try {
      const night = run.night();
      run.bond({ kind: 'talk', who: 'selim' });
      if (greetNight !== night) {
        greetNight = night;
        say(book.greeting('selim'));
        if (book.has('selim.tip')) {
          const hot = run.nextHot?.() ?? null;
          say(hot ? 'bonds.selim.tipLine' : 'bonds.selim.tipNone', hot ? { machine: machineName(hot.machineId as MachineId) } : undefined);
        }
        if (book.has('selim.pair')) say('bonds.selim.pairLine');
      }
      // a free coffee a Night at bond 2; he keeps it for later while another meal is still working
      if (foodNight !== night && book.has('selim.food') && !hasFood()) {
        foodNight = night;
        say('bonds.selim.food');
        run.buffs.add('food.coffee', { pid: run.selfId, source: { kind: 'system', id: 'food' } });
      }
      const rows = barRows(book.selim());
      if (rows.length === 0) return;
      const price = (r: BarRow): number => (r === 'tip' ? tipPrice(run.debt?.().due ?? 0) : book.selim().price);
      const labels = rows.map((r) => t(`bonds.bar.${r}`, { n: price(r) }));
      const pick = await app?.ui?.choice(t('bonds.bar.title'), [...labels, t('bonds.bar.close')], { timeout: 20 });
      if (disposed || pick === undefined || pick < 0 || pick >= rows.length) return;
      const row = rows[pick];
      const n = price(row);
      if (n > 0 && !(run.canAfford?.(n) ?? false)) { app?.ui?.toast(t('bonds.bar.broke'), 'bad', 2.5); return; }
      if (row === 'repay') {
        // the seal comes back first; the coins move only when he took it
        if (!run.bond({ kind: 'repay' }).refused && n > 0) run.spend?.('coin', n, 'bar.repay');
      } else if (run.spend?.('coin', n, 'bar.tip')) {
        if (run.bond({ kind: 'share', who: 'selim' }).deltas.length === 0) app?.ui?.toast(t('bonds.selim.thanks'), 'info', 2.5);
      }
    } catch { /* the UI went away mid-pick */ } finally {
      barOpen = false;
    }
  };
  /** His last seal at a short Dawn: the run waits on this answer (and reads silence as no). */
  const askSeal = async (): Promise<void> => {
    let yes = false;
    try { yes = (await app?.ui?.choice(t('bonds.selim.ask'), [t('bonds.selim.askYes'), t('bonds.selim.askNo')], { timeout: 15 })) === 0; } catch { /* no UI */ }
    if (!disposed) run.selimAnswer?.(yes);
  };

  const offs = [
    bus.on('home:interact', ({ station }) => { if (station === 'fridge') void openFridge(); }),
    bus.on('bar:food', () => { void openBar(); }),
    bus.on('selim:ask', () => { void askSeal(); }),
  ];
  return () => { disposed = true; for (const off of offs) off(); };
}
