/**
 * Run (GAME-RUN): the single-player Debt Run behind `RunApi` (GDD §2, §3.3, §7.1). Replaces `BenchRun` in the real game.
 *
 * Owns: the Night / Watch / Dawn state machine (Bell → Play → Last Call → Closing → Settle → Intermission → Dawn
 * Collection), pulls, the real-time Watch clock, the wallet and the Debt Terminal (deposits, quota, interest, overpay),
 * the payout choke point, the House Limit, the trapdoor, the mod() pipeline (charms + house Favour/Witching), the network
 * jackpot pool and save/resume after every resolved action.
 *
 * Time: `tick(dt)` advances everything in SIM seconds; call it from the fixed step. Nothing here reads wall time.
 * Indices: `shift.index` / `debt.index` are 0-based; `night()` is the printed 1-based Night number.
 */
import type { GambleRunPort, GambleReason } from './gamble';
import { isLockedFor, effectiveNight, isProgressive, tierOf, nightQuota, buyPrice, ghostWager, houseCut, expectedCut, machineName } from './progression';
import type {
  ActiveRule, BetLimits, BetOpts, BuffsApi, CharmDef, CharmState, CollateralApi, ContractDef, ContractGoal, ContractsApi, ContractState, CurrencyId,
  DebtState, EcoSource, JackpotPool, JackpotsApi, ModBreakdown, ModBreakdownStep, ModEffect, ModHook, ModProvider, ModQuery,
  DepositRefusal, ModSource, ModifierApi, NightEventsApi, OvershootClaim, QuotaState, RefusalReason, RewardSpec, RunApi, RunWindow,
  ShiftApi, ShiftPhase, ShiftRuleDef, ShiftState, TotemState, TotemsApi, TycoonApi, WinMeta, WinTier,
} from '@/game/types';
import type { MetaState } from '@/game/types';
import type { BuffSave } from './buffs/engine';
import { foldEffects, modHookMeta, scopeMatches, stackedValue, WIN_TIERS } from '@/game/types';
import type { GameMode, InstanceId, MachineId, PlayerId, SlotSize, Unsub, V3, ZoneId } from '@/core/types';
import type { PhoneCallState, RunConfig, RunSnapshot, RunSummary } from '@/net/protocol';
import type { CutscenePlayOpts, CutsceneResult } from '@/core/cutscene/types';
import type { GameEvents } from '@/core/events';
import { bus } from '@/core/events';
import { createRng, hashSeed, type Rng } from '@/core/rng';
import { log } from '@/core/log';
import type { SaveStore } from '@/core/save';
import * as registry from '@/machines/_base/registry';
import { WatchClock, type ClockSnapshot } from './clock';
import {
  ACTIVITY_MIN_PULLS, BASE_RUN_NIGHTS, LAMP_FIRST_NIGHT, NETWORK_FEED, OVERSHOOT_TIERS, START, TICKET_CAP,
  assessmentFor, closingSeconds, coldLampCount, hotLampCount, interestFor, interestRate, isWitchingWatch, lastCallSeconds, nightDef, obolsFor, quotaFor,
  ratePercent, type ObolOutcome,
} from './data/schedule';
import {
  COLD_MULT, Circuit, HOT_MULT, lampEligible, lampView as lampViewOf, rollLamps, tiltBulbs, tiltFactor, tiltStep,
  type CircuitSave, type CircuitView, type LampCandidate, type LampView, type TiltView,
} from './circuit';
import {
  PAYOUT_GUARD, RESCUE_MAX_PER_NIGHT, STAKE_CONFIRM_SEC, bettingLadder, charmPrice, houseFloatTopUp, night1StakeCap, settlePayout, snapDown,
  stakeNeedsConfirm, type PayoutResult, type RescueLoan,
} from './economy';
import { clearClockHolds, clockHeld, holdClock, releaseClock, tickClockHold } from './clockHold';
import { createRescue, rescueTerms, brokeSteps, type BrokeHelp, type RescueLine } from './rescue';
import { bankBalance, churnOf, interestBase, interestNext, previewWithdraw, pullsToQualify, withdrawable, type BankInput, type WithdrawPreview } from './bank';
import { bestBetFloor, depositRoom, pocketDead, watchFloat } from './float';
import { Charms, PEG_CAP_RUN, allCharmDefs, choiceOffer, charmDef } from './charms/engine';
import { Pawn, sellRefund, type PawnSnapshot } from './shop';
import { StampBook, setActiveStampBook, type StampSnapshot } from './stamps';
import { scopeTags } from './suits';
import { paceOf, oddsLine, type OddsLine } from './pace';
import { profileOf } from './data/machineProfiles';
import { bossFor, type BossNight } from './bosses';
import { applyKit, kitById } from './data/kits';
import { DAILY_STAKE, dailyBetter, dailyKit, dailySeed, dayKey, isDayKey, type DailyBest } from './daily';
import { clampStake, isStakeClear, recordStakeClear, stakeBossFor, stakeEffects, type StakeEffects } from './stakes';
import { BOSS_REWARD, BOSS_TEMPLATES } from './data/bosses';
import { SOUL_MARKS_PER_RUN, type DuelEndReport, type DuelRunHooks } from './duels/stakes';
import { bossRivalFor, rivalById, type RivalId } from './story/duels/rivals';
import { rivalTermsFor, termsVars } from './story/duels/terms';
import { presentationIdle } from './duels/runlink';
import { registerStrings, t } from '@/core/i18n';
import { playableMode, rulesFor, type ModeRules } from './modes';
import { createTycoon, type Tycoon } from './tycoon';
import { createBuffSystem, type BuffSystem } from './buffs';
import { createItemSystem, type ItemSystem } from './items';
import { createHotline, type Hotline, type HotlineSave } from './hotline';
import {
  DOOR_FIRST_NIGHT, PHONE_HOUR, PHONE_MINUTE, initDoor, reveal as doorReveal, ring as doorRing, answer as doorAnswer, enter as doorEnter,
  pickLord, leave as doorLeave, finish as doorFinish, dawn as doorDawn, type DoorState, type DoorTrigger, type DuelEnd, type DoorStatus,
} from './hollow/rules';
import type { LordId } from './hollow/rules';
import {
  LOCKER, announcePressure, announceLocker, backOffice, bindWingSource, boilerNextWatch, boilerPull, boilerVent, bossKeys,
  collectorPrice, dawnKeys, managerKeyDrop, openLocker as rollLocker, restoreRooms, roomsProvider, roomsStart,
  type LockerOpen, type LockerResult, type RoomsState,
} from './rooms';
import pullsStrings from './pulls.strings';
import bankStrings from './bank.strings';
import draftStrings from './draft.strings';
import runStrings from './run.strings';
import { STARTER_TIMEOUT_SEC, starterOffer } from './draft';
import { houseMoodProvider } from './houseMood';
import { NightCards, type NightCardDef, type NightCardSave } from './nightCards';
import nightCardStrings from './nightCards.strings';
import { Spotlight, isSpotlightEligible, spotlightStartLine, type SpotlightSave, type SpotlightView } from './spotlight';
import { WatchEvents, type WatchEventSave } from './watchEvents';
import type { EventBannerShow } from './buffs/banner';
import type { IdleReport, TycoonState } from '@/game/types';

/**
 * Win-tier juice event (DECISIONS §F): emitted by `win()` for every paid play above the stake, after settle. `credited`
 * is what the wallet got; `capped` means the House Limit (5 × quota) clipped it and `excess` went to the jackpot pool.
 * `factor` is the effective payout factor and `dampened` means the even-money rule halved the bonuses.
 */
export interface RunWinTierEvent {
  pid: PlayerId; mid: InstanceId; machineId: MachineId; tier: WinTier;
  bet: number; gross: number; credited: number; factor: number; dampened: boolean; capped: boolean; excess: number;
}
/**
 * Stake safety (wave 13): a stake above half the pocket needs a second press. `state: 'ask'` is the first press (refused, armed for
 * `seconds`); `'clear'` means the arm lapsed, was confirmed, or the player changed the stake. The seat HUD shows "PRESS AGAIN".
 */
export interface RunStakeConfirmEvent {
  pid: PlayerId; mid: InstanceId; machineId: MachineId; state: 'ask' | 'clear';
  amount: number; pocket: number; seconds: number;
}
/**
 * The Night summary's books (wave 19, the "NIGHT N PAID" toast): what the Night added up to. `float` is the House float granted at
 * the Night's start, `interest` the interest the Settles added to the bank (not the deposits), `tickets` the Tickets it earned.
 * `carried` is the surplus above the quota that Dawn returned to the pocket (director wave 41: the surplus stays in the bank until
 * Dawn). The pocket delta of a Night is `carried + float + cut`; interest reaches the pocket only through `carried`.
 */
export interface NightLedger { night: number; float: number; interest: number; tickets: number; /** House cut from owned machines (Wave 28). */ cut: number; carried: number }
/** Every reason a run action refuses, as `lastRefusal()` names it: the full `RefusalReason` union (types.ts). */
export type RunRefusal = RefusalReason;
export type { DepositRefusal } from '@/game/types';
/** The bank as the Debt Terminal shows it (wave 27). */
/** NEXT NIGHT (wave 55): the exact quota of the Night after the paid one; see `DebtRun.nextQuotaPreview`. */
export interface NextQuotaPreview {
  /** The Night's number (1-based). */
  night: number;
  /** Its exact quota, the number the run will read when that Night opens. */
  due: number;
  /** The step from tonight's quota (due ÷ tonight's, one decimal). */
  k: number;
  /** True in the Dawn collection, before the payment: the numbers are projected from the Dawn's wealth. */
  projected: boolean;
}

export interface BankView {
  /** Coins counted toward tonight's quota. */
  balance: number;
  /** Part of the balance a WITHDRAW can take. */
  withdrawable: number;
  pocket: number;
  due: number;
  /** Quota still owed (0 = met). */
  left: number;
  /** Live interest per Settle, whole percent. */
  ratePct: number;
  /** Interest the next Settle pays on the balance (0 when churned or no rate). */
  interestNext: number;
  /** Interest a Settle would pay on a bank of `balance` coins (the terminal's "with this deposit" line). */
  interestAt(balance: number): number;
  /** Pulls still to make this Watch for that interest to count (0 = it counts). */
  pullsToQualify: number;
  /** Interest is capped at 2 x the quota: the most the bank can earn per Settle. */
  interestCap: number;
  /** True while a WITHDRAW is allowed (not in Dawn, and not once the Night is paid). Open through Closing and Settle. */
  open: boolean;
  /** Seconds left of the Settle (the HUD countdown until the lever returns); 0 outside Settle. */
  settleLeft?: number;
  /** Pulls left in this Watch. */
  pullsLeft: number;
  /** The cheapest bet on the floor. */
  minBet: number;
}
/** The Collector's rescue loan: the call rang (`'ring'`), the loan was taken (`'taken'`) or the call ended unanswered (`'lapsed'`). */
export interface RunRescueEvent { pid: PlayerId; state: 'ring' | 'taken' | 'lapsed'; coins: number; quota: number; due: number }
declare module '@/core/events' {
  interface GameEvents {
    'run:wintier': RunWinTierEvent;
    'run:stakeConfirm': RunStakeConfirmEvent;
    'run:rescue': RunRescueEvent;
    /** The Hollow Door opened for this run (the world shows the doorway). */
    'hollow:open': { reason: 'crack' | 'phone333' | 'seam' };
  }
}

/** Seconds of sim time an overpay choice waits for the player before the first candidate is taken automatically. */
const OVERPAY_TIMEOUT_SEC = 30;
/** Hot-path saves (every win) are coalesced: at most one serialise per this many sim seconds. */
const SAVE_SOON_SEC = 2;

/**
 * The Hollow Door restored from a save. A reload cannot resume a doorway, the Underneath or a duel (the world starts sealed),
 * so those statuses close; a ringing call stays ringing (the hotline restores the call itself).
 */
function restoredDoor(h: DoorState | undefined): DoorState {
  if (!h || typeof h !== 'object') return initDoor();
  const keep: readonly DoorStatus[] = ['hidden', 'ringing', 'used', 'closed'];
  const status: DoorStatus = keep.includes(h.status) ? h.status : 'closed';
  return { ...initDoor(), status, trigger: h.trigger ?? null, phoneSpent: h.phoneSpent === true, lord: h.lord ?? null, ended: h.ended ?? null };
}

/** The starter offer restored from a save. An open offer keeps its timer (it runs down in the Bell, so a resumed run never sticks). */
function restoredStarter(s: StarterState | undefined): StarterState | null {
  if (!s || typeof s !== 'object' || !Array.isArray(s.ids)) return null;
  const ids = s.ids.filter((id): id is string => typeof id === 'string');
  return { ids, open: s.open === true && ids.length > 0, left: Number.isFinite(s.left) ? Math.max(0, s.left) : STARTER_TIMEOUT_SEC };
}

/** A pending overpay choice (GDD §2.6.5): take one of `candidates`, or it auto-picks when `left` reaches 0. */
export interface OverpayOffer { rarity: CharmDef['rarity']; candidates: CharmDef[]; left: number }
/** Queue entry: `ids` are the candidate charm ids, frozen when the offer was rolled (so a save restores the same choice). */
interface PendingOverpay { rarity: CharmDef['rarity']; ids: string[]; left: number }
/** The Starter Draft (draft wave): the three charm ids on offer, whether the card panel is still open, and the timer (sim s). */
interface StarterState { ids: string[]; open: boolean; left: number }

/** Bell strike length (GDD §2.3). */
const BELL_SEC = 2;
/** Settle length (GDD §2.3). Wave 42 (director decision 2): 1.5 s. Deposits and WITHDRAW stay open through it (the bank is
 *  settled at its start, so a coin moved now earns from the next Watch on); the lever comes back when it ends. */
const SETTLE_SEC = 1.5;
/** Dawn Collection length (GDD §2.7). */
const COLLECTION_SEC = 12;
/** Overtime Watch from the Rope Ladder (GDD §4.2 #89). */
const OVERTIME_PULLS = 5;
const OVERTIME_SEC = 90;
/** Buy-a-pull: 3 Tickets for +1 pull, at most +2 per Watch (GDD §3.1). */
const PULL_PRICE_TICKETS = 3;
const PULLS_BOUGHT_MAX = 2;
/** Plays a rival's scene through the story player. Loaded on demand: the story layer imports the run's world, not the other way round. */
function playDuelScene(rival: RivalId, beat: 'intro' | 'won' | 'lost', seed: number, night: number): Promise<void> {
  return import('./story/duels/play').then(
    (m): Promise<unknown> => m.playRivalScene(rival, beat, { seed, night }),
  ).then((): void => undefined, (): void => undefined);
}
/** The rival's themed Rare charm (the Pledge): jade Tamsin, brass Kuro, red Lucan, then the phase 2 rivals. */
const DUEL_PLEDGE: Readonly<Record<string, string>> = {
  tamsin: 'mirror_shoe', kuro: 'brass_knuckles', lucan: 'ringmasters_whistle', mimosa: 'cuckoo_feather', orrin: 'seven_floor_key', vell: 'collectors_tag',
};
/** Night 7, The Audit: the Clerk takes this share of a coin prize won at a duel. */
const AUDIT_NIGHT = 7;
const AUDIT_TAX = 0.2;
/** Machine id used for run-level modifier queries (no machine). */
const RUN_MACHINE = 'run';

declare module '@/core/events' {
  interface GameEvents {
    /** Wing Keys granted (Dawn, a boss, the Manager's Key): the host shows a toast. */
    'room:keys': { n: number; why: 'dawn' | 'boss' | 'manager' };
    /** The Boiler blew at P 100 and is shut until the next Watch. */
    'room:blown': { zone: string };
    /** Soul Marks changed (wave 25 duels): `left` on the card, `lost` when one was just taken, `blank` at 0. */
    'duel:marks': { left: number; lost: boolean; blank: boolean };
    /** Back Office exchange done: Tickets in, Obols out. */
    'room:backoffice': { tickets: number; obols: number };
    /** Starter Draft (draft wave): the player took a starting charm (`picked`) or the timer did (`auto`). Closes the card panel. */
    'run:draft': { pid: PlayerId; state: 'picked' | 'auto'; charm: string };
    /** The Settle paid interest into the bank: `amount` coins at `pct` whole percent (the coin sound and the toast). */
    'run:interest': { pid: PlayerId; amount: number; pct: number };
    /** Night Cards (director): the Dawn offer opened (`offer`), a card kept (`picked`) or auto-picked (`auto`), and the Night that
     *  starts with its card (`started`). `card` is the card id, or null for `offer`. */
    'run:nightcard': { pid: PlayerId; state: 'offer' | 'picked' | 'auto' | 'started'; card: string | null };
  }
}
/** `lastRefusal()` after a first press on a stake above half the pocket (see `RunStakeConfirmEvent`). Not in `RefusalReason` yet. */
export const STAKE_CONFIRM_REASON: RefusalReason = 'confirm';

/** Pull grant toasts (`pulls.grant`, `pulls.r.*`). Registered here too so headless tests see them without the main.ts glob. */
registerStrings(pullsStrings.prefix, { en: pullsStrings.en, tr: pullsStrings.tr });
registerStrings(bankStrings.prefix, { en: bankStrings.en, tr: bankStrings.tr });
registerStrings(draftStrings.prefix, { en: draftStrings.en, tr: draftStrings.tr });
registerStrings(nightCardStrings.prefix, { en: nightCardStrings.en, tr: nightCardStrings.tr });
registerStrings(runStrings.prefix, { en: runStrings.en, tr: runStrings.tr });

let bossStringsDone = false;
/** Boss names and texts to `event.<id>.name|desc|announce` (the banner and HUD read them like any Night event). Once. */
function registerBossStrings(): void {
  if (bossStringsDone) return;
  bossStringsDone = true;
  for (const b of Object.values(BOSS_TEMPLATES)) registerStrings(`event.${b.id}.`, { en: b.strings.en, tr: b.strings.tr });
}
/** Red Thread (GDD §4.2 #41): its Tilt grace is for the first instance played in a Watch only. */
const RED_THREAD_GRACE = 3;
/** Bounty board: offers per Night and slips one player may hold (GDD §11.9: three per Night). */
const BOARD_OFFERS = 3;
const CONTRACT_MAX_ACTIVE = 3;

/** The fields a contract goal reads from a run event (`machine:result`, `machine:round`, `run:deposit`, `jackpot:win`). */
interface ContractEv {
  machineId: string; tier?: WinTier; tags?: readonly string[];
  bet?: number; gross?: number; credited?: number; amount?: number;
}
/** True when an event passes a goal's `where` filter. */
function contractMatches(w: NonNullable<ContractGoal['where']>, ev: ContractEv): boolean {
  if (w.machineId !== undefined && ev.machineId !== w.machineId) return false;
  if (w.minTier !== undefined && (ev.tier === undefined || WIN_TIERS.indexOf(ev.tier) < WIN_TIERS.indexOf(w.minTier))) return false;
  if (w.tags && !w.tags.every((t) => ev.tags?.includes(t) === true)) return false;
  if (w.minBet !== undefined && (ev.bet ?? 0) < w.minBet) return false;
  if (w.minGross !== undefined && (ev.gross ?? 0) < w.minGross) return false;
  return true;
}

// ─â”€ persistence ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
/** Run-private state that the shared `RunSnapshot` shape does not carry. Stored under `resume.ext` (JSON-safe). */
export interface RunExt {
  v: 1;
  index: number; watch: number; watches: number; overtimeIdx: number;
  phase: ShiftPhase; phaseLeft: number; nightDone: boolean; topside: boolean; metFired: boolean; ropeUsed: boolean;
  clock: ClockSnapshot; clockLen: number; lastCallSec: number;
  pulls: number; pullsMax: number; watchPulls: number; boughtThisWatch: number;
  tickets: number; debtPaid: number; dreadPts: number;
  /** Legacy (before wave 41): surplus above the quota already returned to the pocket early. Restored by taking it off `debtPaid`. */
  released?: number;
  /** The Night summary's books (see `NightLedger`). Optional: older saves have none. */
  ledger?: NightLedger;
  freeRerolls: number; skipRest: number;
  /** Pawn Window stock (wave 8). Optional: older saves have none. */
  pawn?: PawnSnapshot;
  /** Symbol Stamps owned and the board (Pawn STAMPS tab). Optional: older saves have none. */
  stamps?: StampSnapshot;
  /** Rounds opened per machine id (the Pawn's most-played machine). Optional. */
  plays?: Record<string, number>;
  /** Legacy (pre-wave 8 reroll counter), ignored. */
  pawnRerolls?: number;
  discount: number; nextDiscount: number; elapsed: number; maxWallet: number; biggest: number; rounds: number;
  rng: [number, number, number, number];
  /** Pending overpay choices (optional: older v1 saves have none). */
  overpays?: PendingOverpay[];
  /** Tycoon layer state (owned machines, levels, staff). Optional: older saves have none. */
  tycoon?: Partial<TycoonState>;
  /** Host ms wall clock at save time; resume credits the time away to the tycoon (idle income). */
  savedAt?: number;
  /** Active buffs and tonics per owner key. Optional: older saves have none. */
  buffs?: BuffSave;
  /** Owned totems (carried and placed). Optional: older saves have none. */
  totems?: TotemState[];
  /** Bounty board: offers, signed and finished slips, stat baselines. Optional: older saves have none. */
  contracts?: ContractsSave;
  /** THE CIRCUIT: Tilt counters and Lamps of the Watch in progress. Optional: older saves have none. */
  circuit?: CircuitSave;
  /** The hotline: ring schedule and the live call. Optional: older saves have none. */
  hotline?: HotlineSave;
  /** Machines bought with coins (tycoon). Optional: older saves have none. */
  owned?: MachineId[];
  /** Watch id of the last All-In Shot (risk layer). Optional: older saves have none. */
  allIn?: number;
  /** Rescue loans taken tonight: quota added and calls used. Optional: older saves have none. */
  rescue?: { quota: number; used: number };
  /** Deposits made this Watch (every one keeps the float). Optional: older saves have none. */
  watchDep?: number;
  /** The Watch's float, fixed when it was first read. Optional: older saves recompute it. */
  watchFloat?: number;
  /** Bank (wave 27): non-cash quota credit, and this Watch's withdrawn / deposited coins (the churn rule). Optional: older saves have none. */
  bank?: { granted: number; wd: number; dep: number };
  /** Special rooms (wave 24): Wing Keys, the Manager's Key, the Boiler / locker state and the run's bonus Obols. Optional: older saves have none. */
  wingKeys?: number;
  managerKey?: boolean;
  rooms?: RoomsState;
  bonusObols?: number;
  /** Wave 25 duels: Soul Marks on the card, the one in play, the Night whose boss duel was won, rivals whose Pledge charm is taken. Optional: older saves have none. */
  soulMarks?: number;
  markEscrow?: number;
  bossDuel?: number;
  pledged?: string[];
  /** The ending path reached this run (wave 25 phase 2: `vell_release`), if any. */
  endingPath?: string;
  /** The Hollow Door (once per run), the quota forgiven through this Night index (exclusive), the Obols multiplier, and the House refusal. Optional: older saves have none. */
  hollow?: DoorState;
  forgiveUntil?: number;
  /** HOUSE TAKES NOTICE: the wealth read at the last paid Dawn. Optional: older saves have none (0). */
  houseWealth?: number;
  obolMult?: number;
  hollowRefused?: boolean;
  /** Starter Draft (draft wave): the offer and whether it is still open. Optional: older saves have none. */
  starter?: StarterState;
  /** Night Cards (director): the open Dawn offer and the card kept for the next Night. Optional: older saves have none. */
  nightCards?: NightCardSave;
  /** Per-Watch floor event (wave 43): the live event and its time left. Optional: a save between Watches has none. */
  watchEvent?: WatchEventSave | null;
  /** Machine of the Night (wave 55): this Night's spotlight and the kind spotlit last Night. Optional: older saves have none. */
  spotlight?: SpotlightSave;
}
/** Contracts persisted under `ext.contracts`. `base` holds the stat value at signing, for stat goals. */
interface ContractsSave { night: number; seq: number; list: ContractState[]; base: Record<string, number> }
export interface RunSave extends RunSnapshot { ext: RunExt }

function isRunSave(s: RunSnapshot): s is RunSave {
  const e = (s as { ext?: unknown }).ext;
  return typeof e === 'object' && e !== null && (e as { v?: unknown }).v === 1;
}

// ─â”€ public surface ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
export interface RunOpts {
  seed: number;
  /** Default 'debt'. 'free' = Free Casino sandbox. 'coop' / 'versus' are refused until M3. */
  mode?: GameMode;
  cfg?: Partial<RunConfig>;
  /** When set, every resolved action is written to `save.data.resume` (the store debounces the disk write). */
  save?: SaveStore;
  /** Event banners (night events) for the HUD. Optional: without it events still run, silently. */
  banner?: EventBannerShow;
}

/** What the world exposes to the run (machines and slot positions). Attached once the pit exists. */
export interface RunWorldLink {
  machines(): ReadonlyArray<{ instance: InstanceId; machineId: MachineId; size?: SlotSize }>;
  instancePos(mid: InstanceId): V3 | undefined;
  /** True for machines in closed wings / locked tiers (no Lamps there). */
  locked?(instance: InstanceId): boolean;
}

/** Run control surface on top of `RunApi` (HUD, intermission UI, frame loop). */
export interface DebtRun extends RunApi {
  /** True from Dawn paying the Night until OPEN THE FLOOR. */
  readonly nightPaid: boolean;
  /** The Night summary's books (float, interest, tickets) for the Night in progress. */
  nightLedger(): Readonly<NightLedger>;
  /** The live interest rate of this Night in whole percent (schedule + bonuses): the Terminal and the tutorial show it. */
  interestPct(): number;
  /** Advance the run by `dt` sim seconds. Call from the fixed step. */
  tick(dt: number): void;
  /** Write any coalesced save now. Call on page hide / unload (`tick` also flushes within SAVE_SOON_SEC). */
  flush(): void;
  /** Overpay choice at the head of the queue (null when none). The UI shows `candidates` and calls `pickOverpay`. */
  overpayOffer(): OverpayOffer | null;
  /** Take one candidate of the head offer. False when there is no such offer, or the charm has no free peg. */
  pickOverpay(charmId: string): boolean;
  /** Take the first candidate that fits and drop the offer (the timeout fallback; also used by `tick`). */
  autoPickOverpay(): boolean;
  /**
   * Starter Draft (draft wave, run start): open the three-charm offer before the first Bell. Only a fresh Night 1 Watch 1
   * (before its Bell) opens it, once per run. False when it is already open or done, or the run is not a Debt Run.
   */
  openStarterDraft(): boolean;
  /** The open starter offer: its three charms and the timer (sim s, runs down in the Bell only). Null when closed. */
  starterDraft(): { candidates: CharmDef[]; left: number } | null;
  /** Take one starter charm: closes the offer and lets the Bell strike. False when closed or the id is not on offer. */
  pickStarter(charmId: string): boolean;
  /** Night Cards: the open Dawn offer (two cards, seconds left), or null. OPEN THE FLOOR settles it with its first card. */
  nightCardOffer(): { candidates: NightCardDef[]; left: number; night: number } | null;
  /** Keep one card of the open offer for the next Night. False when closed or the id is not on offer. */
  pickNightCard(cardId: string): boolean;
  /** The Night Card panel is on screen: OPEN THE FLOOR waits for a pick (or the panel's timer) instead of taking card 1. */
  setNightCardGate(on: boolean): void;
  /** The card kept for the Night in progress, or null. */
  nightCard(): NightCardDef | null;
  /** Intermission → Bell (the BELL ROPE). */
  startWatch(): boolean;
  /** Night intermission → next Night (OPEN THE FLOOR). Refused while the Topside choice is open. */
  openFloor(): boolean;
  /** Pay the rest of the Night now (SETTLE lever). Needs `deposit ≥ quota`. */
  settleEarly(): boolean;
  /**
   * BELL (Debt Terminal, decision 1): end the Watch now, in play or Last Call. The unused pulls keep the usual settle rebate.
   * Always allowed while playing, so a Watch is never stuck. False when the phase does not allow it.
   */
  ringBell(): boolean;
  /** The bank in numbers (Debt Terminal DEPOSIT / WITHDRAW / QUOTA screens). */
  bank(): BankView;
  /** NEXT NIGHT: the exact quota of the Night after the paid one (null while a Night runs). `extraMult` previews a card (1 = none). */
  nextQuotaPreview(extraMult?: number): NextQuotaPreview | null;
  /** What `withdraw(amount)` would do, without doing it (what the player gives up). */
  withdrawPreview(amount: number): WithdrawPreview;
  /**
   * WITHDRAW: take up to `amount` coins from the bank back to the pocket (any time before the Watch is settled). Returns the coins
   * moved (0 = refused). Withdrawn coins stop counting toward the quota and stop earning interest.
   */
  withdraw(amount: number): number;
  /** The broke-start help: the ordered ways out when the pocket cannot cover the cheapest bet (null while the pocket can play). */
  brokeHelp(): BrokeHelp | null;
  /** Buy +1 pull for 3 Tickets (max +2 per Watch). */
  buyPull(): boolean;
  /** Pawn Window stock keeper (wave 8): stock, locks, rerolls, swap. The charm vendor reads it. */
  readonly pawn: Pawn;
  /** Symbol Stamps (Big One upgrades bought at the Pawn). */
  readonly stamps: StampBook;
  /** Sell a charm for 50 % (70 % with Pawn Ticket). Cursed charms cannot be sold. */
  sellCharm(id: string): boolean;
  /** Topside: STAY UP ends the run as a win. */
  stayUp(): boolean;
  /** Topside: GO BACK DOWN continues into Overdrawn. */
  goBackDown(): boolean;
  /** Abandon the run. */
  quit(): boolean;
  /** Connect the pit (owned machines, slot positions for totems). Null detaches. */
  attachWorld(link: RunWorldLink | null): void;
  /** Idle income credited on resume, read once (null when none). */
  takeIdleReport(): IdleReport | null;
  /** Unhook the buff and totem systems. Call when the session ends. */
  dispose(): void;
  readonly over: boolean;
  readonly topsideOpen: boolean;
  readonly rules: ModeRules;
  // ─â”€ special rooms (wave 24) ─â”€
  /** Wing Keys in hand (a grille spends one). Replicated to clients in the run snapshot. */
  readonly wingKeys: number;
  /** The Manager's Key (opens the Counting Room only). */
  readonly managerKey: boolean;
  /** Boiler pressure and the locker tally. */
  readonly rooms: Readonly<RoomsState>;
  /** The Vent lever: P back to 0 for 1 pull (3 Tickets when no pull is left to give). False when refused. */
  ventBoiler(): boolean;
  /** Opens Wash locker `n` (1–12): 1 Ticket, a seeded result. Null when refused (the refusal is on `lastRefusal` / the return). */
  openLocker(n: number): LockerOpen | null;
  /** Back Office: every 3 Tickets become 1 Obol. Returns what was exchanged. */
  backOffice(): { tickets: number; obols: number };
  /** The Collector buys a charm for Obols at 2x its sell value. False when it is not held, cursed or the run is not in a Watch gap. */
  collectorBuy(charmId: string): boolean;
  // ─â”€ tycoon (wave 28): buy a covered machine, collect its house cut ─â”€
  /** Coins to buy this covered machine now (0 = not for sale: open, owned, free-only or not a progressive run). */
  buyPriceOf(machineId: MachineId): number;
  /** BUY a covered machine with coins: it opens for the rest of the run and pays a house cut each Watch. False when refused or short. */
  buyMachine(machineId: MachineId): boolean;
  /** True for a machine bought this run. */
  owns(machineId: MachineId): boolean;
  /** The EMPIRE chip: machines owned, the average cut per Watch at tonight's quota, and what the floor paid so far tonight. */
  empire(): { count: number; perWatch: number; tonight: number; owned: readonly MachineId[] };
}

/** A fresh run. */
export function createRun(opts: RunOpts): DebtRun {
  return new Run(opts, null);
}

/** Continue the saved run, if the save holds a resumable run; otherwise null. The Watch clock resumes frozen. */
export function resumeRun(save: SaveStore, extra: { banner?: EventBannerShow } = {}): DebtRun | null {
  const snap = save.data.resume;
  if (!snap || !isRunSave(snap)) return null;
  return new Run({ seed: snap.seed, mode: snap.mode, cfg: snap.cfg, save, banner: extra.banner }, snap);
}

// ─â”€ inert sub-APIs (owned by other packages; warns once when touched) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
function inert<T extends object>(name: string, impl: Partial<T>): T {
  return new Proxy(impl, {
    get(target, prop, recv) {
      if (prop in target) return Reflect.get(target, prop, recv);
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return (): undefined => {
        log.warnOnce(`run:${name}.${String(prop)}`, 'run', `${name}.${String(prop)}() is not implemented yet`);
        return undefined;
      };
    },
  }) as T;
}

const noop: Unsub = () => {};

// ─â”€ modifier pipeline (the reference fold from modifiers.types) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
class Mods implements ModifierApi {
  revision = 0;
  private readonly providers = new Set<ModProvider>();
  constructor(private readonly run: () => Run) {}

  register(p: ModProvider): () => void {
    this.providers.add(p);
    this.touch();
    return () => { this.providers.delete(p); this.touch(); };
  }
  touch(): void { this.revision++; }

  private sources(q: ModQuery): ModSource[] {
    const out: ModSource[] = [];
    for (const p of this.providers) p.collect(q, out);
    return out;
  }
  private matching(hook: ModHook, machineId: MachineId, q: ModQuery, sources: ModSource[]): Array<{ src: ModSource; eff: ModEffect; value: number }> {
    const r = this.run();
    const def = registry.get(machineId)?.def;
    const m = {
      machineId, category: def?.category, tags: scopeTags(machineId, def?.tags), zone: def?.zone, instance: q.instance,
      mode: r.mode, pid: q.pid ?? r.selfId, pos: q.pos,
    };
    const out: Array<{ src: ModSource; eff: ModEffect; value: number }> = [];
    for (const src of sources) {
      for (const eff of src.effects) {
        if (eff.hook === hook && scopeMatches(eff.scope, m)) out.push({ src, eff, value: stackedValue(eff, src.stacks ?? 1) });
      }
    }
    return out;
  }
  private modify(hook: ModHook, machineId: MachineId, v: number, q: ModQuery, sources: ModSource[]): number {
    let out = v;
    for (const s of sources) if (s.modify) out = s.modify(hook, machineId, out, q);
    return out;
  }

  mod(hook: ModHook, machineId: MachineId, base: number, q: ModQuery = {}): number {
    const sources = this.sources(q);
    const effs = this.matching(hook, machineId, q, sources).map((m) => ({ op: m.eff.op, value: m.value, priority: m.eff.priority }));
    return this.modify(hook, machineId, foldEffects(hook, base, effs), q, sources);
  }

  explain(hook: ModHook, machineId: MachineId, base: number, q: ModQuery = {}): ModBreakdown {
    const sources = this.sources(q);
    const list = this.matching(hook, machineId, q, sources);
    const steps: ModBreakdownStep[] = [];
    let before = foldEffects(hook, base, []);
    const acc: Array<{ op: ModEffect['op']; value: number; priority?: number }> = [];
    for (const m of list) {
      acc.push({ op: m.eff.op, value: m.value, priority: m.eff.priority });
      const after = foldEffects(hook, base, acc);
      steps.push({ source: { kind: m.src.kind, id: m.src.id, owner: m.src.owner }, op: m.eff.op, value: m.value, stacks: m.src.stacks ?? 1, before, after });
      before = after;
    }
    const result = this.modify(hook, machineId, before, q, sources);
    const meta = modHookMeta(hook);
    return { hook, machineId, base, result, clamped: result <= meta.min || result >= meta.max, steps };
  }
}

// ─â”€ the run ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
class Run implements DebtRun {
  readonly mode: GameMode;
  readonly seed: number;
  readonly selfId: PlayerId = 1;
  readonly config: Readonly<RunConfig>;
  readonly rules: ModeRules;
  readonly mods: ModifierApi;
  readonly charmBox: Charms;
  readonly shift: ShiftApi;
  readonly tycoon: TycoonApi;
  readonly buffs: BuffsApi;
  readonly totems: TotemsApi;
  readonly pawn: Pawn;
  readonly stamps: StampBook;
  readonly collateral: CollateralApi;
  readonly nightEvents: NightEventsApi;
  readonly contracts: ContractsApi;
  readonly jackpots: JackpotsApi;
  /** THE CIRCUIT (Tilt bulbs and Lamps), read by the HUD, the seat HUD and the world beacons. */
  readonly circuit: CircuitView;

  private readonly rng: Rng;
  private readonly circ = new Circuit();
  /** The instance the local player sits at (from `player:seat`), for the seat HUD's Tilt bulbs. */
  private seatedMid: InstanceId | null = null;
  private readonly save: SaveStore | null;
  private readonly modsImpl: Mods;
  private readonly tycoonSys: Tycoon;
  private readonly buffSys: BuffSystem;
  private readonly itemSys: ItemSystem;
  private readonly hotline: Hotline;
  private readonly rescue: RescueLine;
  private worldLink: RunWorldLink | null = null;
  private readonly pools = new Map<string, JackpotPool>();
  private readonly poolListeners = new Set<(p: JackpotPool) => void>();
  private readonly counters = new Map<string, number>();
  private readonly currencies = new Map<string, number>();
  wingKeys = 0;
  managerKey = false;
  /** Soul Marks on the JackID card (3 per run), the one on the table, the Night of a won boss duel, rivals whose Pledge charm is taken. */
  private soulMarkCount = SOUL_MARKS_PER_RUN;
  private markEscrow = 0;
  private bossDuelNight = 0;
  private readonly pledged = new Set<string>();
  /** The ending path reached this run (`vell_release` once Vell's thrown match is called out), or null. */
  private endingPathId: string | null = null;
  /** The ending path reached this run (`vell_release` once Vell's thrown match is called out), or null. */
  get endingPath(): string | null { return this.endingPathId; }
  /** Duel follow-ups (reward, scene) that wait until the cut-ins and the reveal are off screen. Ticked by `tick`. */
  private duelAfter: Array<{ wait: number; left: number; fn: () => void }> = [];
  /** The Tally Bench's run-side counters and hooks (see `DuelRunHooks`): Soul Marks, the rival's Pledge, encounters, boss rewards. */
  readonly duel: DuelRunHooks = {
    soulMarks: () => this.soulMarkCount,
    stakeSoulMark: () => this.stakeMark(),
    returnSoulMark: () => this.returnMark(),
    loseSoulMark: () => this.loseMark(),
    grantPledge: (rivalId) => this.takePledge(rivalId),
    coinsOnly: () => this.mode === 'free' || this.save?.data.settings.calm === true,
    encounter: (instanceId) => this.duelEncounter(instanceId),
    onDuelStart: (e) => this.duelStarting(e),
    onDuelEnd: (r) => this.duelEnded(r),
  };
  rooms: RoomsState = roomsStart();
  private readonly ruleDefs = new Map<string, ShiftRuleDef>();
  private readonly openRounds = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly activeRules: ActiveRule[] = [];

  // shift and quota
  private index = 0;
  private watch = 0;
  private watches = 3;
  private overtimeIdx = -1;
  private phase: ShiftPhase = 'intermission';
  private phaseLeft = 0;
  private nightDone = false;
  get nightPaid(): boolean { return this.nightDone; }
  private topside = false;
  private metFired = false;
  private skipRest = 0;
  private discount = 0;
  private nextDiscount = 0;
  private readonly clock = new WatchClock();
  private clockLen = 0;
  private lastCallSec = 0;
  private shiftState: ShiftState;
  private quota: QuotaState;

  // money, pulls, debt
  private coins = START.pocket;
  private tickets = START.tickets;
  /**
   * The bank: total deposited this Night (interest and overpay included). Quota, ratio, overshoot and interest all read this.
   * Director wave 41: nothing leaves it before Dawn, so the surplus above the quota keeps earning until then.
   */
  private debtPaid = 0;
  private pullCount = 0;
  private pullsMax = 0;
  private watchPulls = 0;
  /** Debt Terminal deposits made this Watch: every one keeps the float in the pocket (see `float.ts`). */
  private watchDeposits = 0;
  /** The float of this Watch, computed once (`depositFloor`) and reset at Watch start. Null until the first read. */
  private watchFloatSnap: number | null = null;
  /** Bank (wave 27): quota credit that never was pocket cash (cannot be withdrawn), and this Watch's coin flow for the churn rule. */
  private bankGranted = 0;
  private watchWd = 0;
  private watchDepCoins = 0;
  private boughtThisWatch = 0;
  private freeRerolls = 0;
  private pawnRev = 0;
  private stampRev = 0;
  private readonly lastBet = new Map<string, number>();
  private oddsKey = '';
  private baseEventChance = 0.35;
  private readonly plays = new Map<string, number>();
  private readonly banner: EventBannerShow | undefined;
  private ropeUsed = false;
  /** Rescue loans (wave 13): quota added tonight, calls used tonight, seconds until the line may ring again. */
  private loanQuota = 0;
  private rescuesUsed = 0;
  private rescueCool = 0;
  private rescueScan = 0;
  /** A stake above half the pocket waits here for its second press. */
  private stakeArm: { mid: string; machineId: string; amount: number; left: number } | null = null;
  private dreadPts = 0;
  /** The Hollow Door's state for this run (src/game/hollow/rules.ts). Saved in `ext.hollow`. */
  private hollow: DoorState = initDoor();
  /** Quota forgiven by a Lord's writ: Nights with an index below this owe nothing (-1 = none). */
  private forgiveUntil = -1;
  /** HOUSE TAKES NOTICE: the wealth read at the last paid Dawn (pocket + bank). Floors the quota of the Night that Dawn opens. */
  private houseWealth = 0;
  /** Multiplies the Obols this run banks at its end (a taken run: ×1.5). */
  private obolMult = 1;
  /** The House refused the loan tonight or earlier (a rescue call lapsed unanswered): the red seam can open with an empty pocket. */
  private hollowRefused = false;

  // status
  private living = true;
  private ended = false;
  private refusal: RunRefusal | null = null;
  private elapsed = 0;
  private clockAcc = 0;
  private stats: Record<string, number> = { rounds: 0, wagered: 0, paid: 0, biggest: 0, wins: 0, nightsPaid: 0, interest: 0, deposited: 0 };
  /** The Night summary's books; reset when the Night opens (`openFloor`), booked by the float, the Settles and the Tickets. */
  /** Watch id the All-In Shot was last fired in (-1 = never): once per Watch, saved so a reload cannot give a second shot. */
  private allInWatch = -1;
  /**
   * The risk layer's port (`gamblePortOf(run)`, src/game/gamble.ts): Double-or-Nothing ladder, High Stakes surcharge and the
   * All-In Shot move coins raw: no pull cost, stake limit, confirm or modifiers. A debit counts as wagered, a credit as paid.
   */
  readonly gamble: GambleRunPort = {
    watchId: () => this.index * 16 + this.watch,
    allInUsed: () => this.allInWatch === this.index * 16 + this.watch,
    markAllIn: () => { this.allInWatch = this.index * 16 + this.watch; this.persistSoon(); },
    debit: (amount, _src, reason: GambleReason) => {
      const a = Math.floor(amount);
      if (!(a > 0) || this.ended || !this.spend('coin', a, `gamble:${reason}`)) return false;
      this.stats.wagered = (this.stats.wagered ?? 0) + a;
      return true;
    },
    credit: (amount, _src, reason: GambleReason) => {
      const a = Math.floor(amount);
      if (!(a > 0) || this.ended) return 0;
      this.earn('coin', a, `gamble:${reason}`);
      this.stats.paid = (this.stats.paid ?? 0) + a;
      this.biggest = Math.max(this.biggest, a);
      return a;
    },
  };
  /** Machines bought with coins (tycoon): never covered again, paid a house cut at each Watch settle. */
  private owned = new Set<MachineId>();
  private ledger: NightLedger = { night: 1, float: 0, interest: 0, tickets: 0, cut: 0, carried: 0 };
  private maxWallet = START.pocket;
  private biggest = 0;
  private bestMachine: string | null = null;
  private rounds = 0;
  private dirty = false;
  private sinceFlush = 0;
  private overpays: PendingOverpay[] = [];
  /** Starter Draft (draft wave): null until `openStarterDraft`. Holds the Bell while open. */
  private starter: StarterState | null = null;
  /** Night Cards (director): the Dawn offer and the card kept for the next Night. Provider registered in the constructor. */
  private readonly nightCards: NightCards;
  /** Per-Watch floor event (wave 43): rolled at each Bell, ticked on the Watch clock, saved mid-Watch. */
  private readonly watchEv: WatchEvents;
  /** Machine of the Night (wave 55): one floor kind per Night pays x1.25 and drops a Ticket every 5th play. */
  private readonly spotlight: Spotlight;
  // bounty board (ContractsApi): defs registered by the device catalogue, offers and slips for this run
  private readonly contractDefs = new Map<string, ContractDef>();
  private contractList: ContractState[] = [];
  private contractNight = -1;
  private contractSeq = 0;
  private contractBase = new Map<string, number>();
  private readonly unsubs: Unsub[] = [];

  constructor(opts: RunOpts, resume: RunSave | null) {
    this.mode = playableMode(opts.mode);
    this.rules = rulesFor(this.mode);
    // Daily run (daily.ts): the seed, kit and stake come from the UTC day, whatever the menu passed. A resumed run keeps its day.
    const cfgDay = (opts.cfg as { dailyDay?: unknown } | undefined)?.dailyDay;
    const dayOfRun = opts.cfg?.daily === true && this.rules.quota ? (isDayKey(cfgDay) ? cfgDay : dayKey()) : null;
    const seed = dayOfRun !== null ? dailySeed(dayOfRun) : opts.seed;
    this.seed = seed;
    this.save = opts.save ?? null;
    this.banner = opts.banner;
    this.rng = createRng(seed);
    this.config = {
      startWallet: this.rules.startWallet, deadlines: BASE_RUN_NIGHTS, difficulty: 'normal', friendlyGive: false,
      realtimeShift: this.rules.timed, shiftSeconds: nightDef(0).clock, sharedBank: false, modifiers: [],
      daily: false, randomLineup: true, collateral: false, botFill: false, ...opts.cfg,
      stake: clampStake(opts.cfg?.stake),
      ...(dayOfRun !== null ? { daily: true, dailyDay: dayOfRun, kit: dailyKit(dayOfRun), stake: DAILY_STAKE } : {}),
    };

    const nd = nightDef(0);
    this.shiftState = {
      index: 0, floor: 1, phase: 'intermission', startedAt: 0, endsAt: 0, duration: nd.clock, lastCallSec: lastCallSeconds(false),
      segment: { index: 0, count: nd.watches }, stake: nd.si, clock: 0, rules: this.activeRules,
      quota: { due: 0, base: 0, assessment: 0, deposited: 0, perPlayer: {}, met: false, overshoot: 0, ratio: 0, claimed: [] },
    };
    this.quota = this.shiftState.quota;
    this.watches = nd.watches;
    this.pullsMax = this.rules.unlimitedPulls ? Number.POSITIVE_INFINITY : 0;
    this.pullCount = this.pullsMax;

    this.modsImpl = new Mods(() => this);
    this.mods = this.modsImpl;
    this.charmBox = new Charms({ selfId: this.selfId, run: () => this, rng: this.rng, touch: () => this.modsImpl.touch() });
    this.modsImpl.register(this.charmBox);
    this.modsImpl.register({
      kind: 'house',
      collect: (_q, out) => {
        if (!this.rules.quota || !this.inWatch()) return;
        const effs: ModEffect[] = [];
        const favour = nightDef(this.index).favour;
        if (favour !== 1) effs.push({ hook: 'payout.mult', op: 'mult', value: favour });
        if (isWitchingWatch(this.watches, this.watch)) {
          effs.push({ hook: 'payout.mult', op: 'inc', value: 0.05 });
          effs.push({ hook: 'dread.add', op: 'add', value: 10 });
        }
        if (effs.length) out.push({ kind: 'house', id: `night:${this.index + 1}`, owner: 0, effects: effs });
      },
    });
    // HOUSE MOOD (wave 46): the Night's payout mood on every floor machine, in the same quota Watches as House Favour.
    this.modsImpl.register(houseMoodProvider({ index: () => this.index, active: () => this.rules.quota && this.inWatch() }));

    this.circuit = this.makeCircuitView();
    this.modsImpl.register(this.makeCircuitProvider());
    this.watchEv = new WatchEvents({ isHot: (m) => this.circ.isHot(m), touch: () => this.modsImpl.touch() });
    this.modsImpl.register(this.watchEv);
    this.nightCards = new NightCards(() => this.index, this.seed, () => this.modsImpl.touch());
    this.modsImpl.register(this.nightCards);
    this.spotlight = new Spotlight(this.seed, () => this.modsImpl.touch());
    this.modsImpl.register(this.spotlight);

    this.pools.set('net', { id: 'net', value: START.jackpotSeed, seed: START.jackpotSeed, feed: NETWORK_FEED, drip: 0, scope: 'network', lastWin: null });

    this.shift = this.makeShiftApi();
    // tycoon, buffs, night events and totems (BRIEF addenda 1–3, 8). Each registers its providers on `mods`.
    this.tycoonSys = createTycoon({
      run: () => this,
      seed,
      isHost: () => true,
      machines: () => this.worldLink?.machines() ?? [],
      tradeOpen: () => this.tradeOpen(),
      quotaDue: () => this.quota.due,
      shiftIndex: () => this.index,
      deposited: () => this.stats.deposited ?? 0,
      save: opts.save,
      onDescend: () => { this.endRun('escaped', 'descend'); },
      now: () => Math.round(this.elapsed * 1000),
      keys: {
        takeKeys: (n) => { if (this.wingKeys < n) return false; this.wingKeys -= n; this.persistSoon(); return true; },
        takeManagerKey: () => { if (!this.managerKey) return false; this.managerKey = false; this.persistSoon(); return true; },
      },
    });
    this.modsImpl.register(this.tycoonSys.provider);
    // special rooms: the open rooms' rules and the Boiler's pressure payout are one zone-scoped provider; the wing state reads the run
    this.modsImpl.register(roomsProvider({ opened: () => this.tycoonSys.state().zones, rooms: () => this.rooms }));
    bindWingSource({
      opened: () => this.tycoonSys.state().zones,
      keys: () => this.wingKeys,
      managerKey: () => this.managerKey || ((this.tycoonSys.prestige.state().nodes?.F6 ?? 0) > 0),
    });
    this.tycoon = this.tycoonSys;
    this.tycoonSys.onChange(() => { this.persistSoon(); this.notify(); });

    this.buffSys = createBuffSystem({
      selfId: this.selfId,
      isHost: true,
      rng: createRng(hashSeed('buffs', seed)),
      run: () => this,
      now: () => Math.round(this.elapsed * 1000),
      // buffs change outside the boundary actions (timers, auras, round spends): mark the save dirty, `tick` writes it
      touch: () => { this.modsImpl.touch(); this.persistSoon(); },
      players: () => [this.selfId],
    }, this.modsImpl, { banner: opts.banner });
    this.buffs = this.buffSys.buffs;
    this.hotline = createHotline(this, {
      now: () => performance.now(),   // = net.hostTime() offline and on the host (the run only lives on the host)
      host: {
        wingClosed: (z) => !this.tycoonSys.state().zones.includes(z),
        openWing: (z) => this.tycoonSys.grantZone(z),
        addPulls: (n) => {
          if (!Number.isFinite(this.pullCount)) return;
          this.pullCount = Math.max(0, this.pullCount + n);
          this.emit('pulls:change', { pid: this.selfId, pulls: this.pullCount });
          this.pullToast(n, 'phone');
          this.notify(); this.persist();
        },
        creditQuota: (c) => {
          if (!this.quotaMode || c <= 0) return;
          this.bankGranted += c;
          this.debtPaid += c;
          this.stats.deposited = (this.stats.deposited ?? 0) + c;
          this.syncQuota();
          this.emit('run:deposit', { pid: this.selfId, amount: c, paid: this.debtPaid, due: this.quota.due });
          // Wave 42 (decision 4): a phone credit moves no coin, so it says so: it went into the bank and cannot be withdrawn.
          this.bankNote('bank.credit', { n: Math.floor(c) });
          this.checkMet();
          this.emit('quota:update', { quota: this.quota });
          this.persist();
        },
        hollowCanRing: () => this.hollowCanRing(),
        hollowRing: () => this.hollowRing(),
        hollowAnswer: (c) => this.hollowAnswer(c),
        previewNextHot: () => {
          if (!this.quotaMode) return null;
          const last = this.watch + 1 >= this.watches;
          const idx = last ? this.index + 1 : this.index;
          const wt = last ? 0 : this.watch + 1;
          if (idx + 1 < LAMP_FIRST_NIGHT) return null;
          const hot = rollLamps(createRng(hashSeed('lamps', this.seed, idx, wt)), this.lampCandidates(), {
            hot: Math.max(0, hotLampCount(idx + 1) + Math.round(this.mod('x.lamp.hotCount', RUN_MACHINE, 0))),
            cold: 0,
            prevHot: this.circ.hot(),
          }).hot[0];
          const c = hot === undefined ? undefined : this.lampCandidates().find((m) => m.mid === hot);
          return c ? { mid: c.mid, machineId: c.machineId } : null;
        },
      },
    });
    this.rescue = createRescue({
      selfId: this.selfId,
      now: () => performance.now(),
      ringSeconds: () => Math.max(20, Math.round(this.mod('x.phone.ringTime', 'hotline', 10))),   // a broke player has to stand up and walk to the booth
      take: (loan) => this.takeRescue(loan),
    });
    this.nightEvents = this.buffSys.nightEvents;
    this.baseEventChance = this.buffSys.nightEvents.chance();

    this.itemSys = createItemSystem({
      selfId: this.selfId,
      isHost: true,
      rng: createRng(hashSeed('totems', seed)),
      run: () => this,
      now: () => Math.round(this.elapsed * 1000),
      allied: (a, b) => a === b,
      touch: () => { this.modsImpl.touch(); this.persistSoon(); },
      instancePos: (mid) => this.worldLink?.instancePos(mid),
    }, this.modsImpl);
    this.totems = this.itemSys.totems;

    this.pawn = this.makePawn();
    this.stamps = this.makeStamps();
    this.modsImpl.register(this.stamps);
    setActiveStampBook(this.stamps);
    this.collateral = inert<CollateralApi>('collateral', {});
    this.contracts = this.makeContractsApi();
    this.unsubs.push(
      bus.on('player:seat', (p) => {
        if (p.pid !== this.selfId) return;
        this.seatedMid = p.on ? p.mid : null;
        this.oddsKey = '';
        if (p.on) { this.emitTilt(p.mid); this.refreshOdds(true); }
      }),
      bus.on('machine:result', (p) => { if (p.pid === this.selfId) this.advanceContracts('machine:result', p); }),
      bus.on('machine:round', (p) => { if (p.pid === this.selfId) { this.advanceContracts('machine:round', p); this.boilerRound(p.machineId); } }),
      bus.on('room:opened', () => { this.modsImpl.touch(); this.persistSoon(); this.notify(); }),
      bus.on('run:deposit', (p) => { if (p.pid === this.selfId) this.advanceContracts('run:deposit', { machineId: '', amount: p.amount }); }),
      bus.on('jackpot:win', (p) => { if (p.pid === this.selfId) this.advanceContracts('machine:jackpot', p); }),
      // a cutscene (the Collector speaks in them) holds the Watch clock
      bus.on('cutscene:start', () => { holdClock('cutscene', 180); }),
      bus.on('cutscene:end', () => { releaseClock('cutscene'); }),
    );
    this.jackpots = this.makeJackpotsApi();

    if (resume) {
      this.restore(resume);
    } else {
      this.recomputeQuota();
      this.enter(this.rules.timed ? 'intermission' : 'play', 0);
      this.applyStartKit();
      this.applyMetaStart();
    }
    this.prepareBoss();
  }

  // ─â”€ identity and time words ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  get over(): boolean { return this.ended; }
  get topsideOpen(): boolean { return this.topside; }
  private get quotaMode(): boolean { return this.rules.quota; }

  night(): number { return this.index + 1; }
  window(): RunWindow { return this.phase === 'collection' ? 'dawn' : 'watch'; }
  private inWatch(): boolean {
    return this.phase === 'bell' || this.phase === 'play' || this.phase === 'lastCall' || this.phase === 'closing' || this.phase === 'settle';
  }
  private canPlay(): boolean { return this.phase === 'play' || this.phase === 'lastCall'; }
  private isLastWatch(): boolean { return this.watch === this.watches - 1; }

  // ─â”€ wallet, pulls, bets ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  wallet(_pid?: PlayerId): number { return this.coins; }
  canAfford(cost: number, _pid?: PlayerId): boolean { return this.coins >= cost; }
  pulls(_pid?: PlayerId): number { return this.pullCount; }
  /** The reason of the last refused action (cleared by the next accepted one). Every run refusal is a `RefusalReason`. */
  lastRefusal(): RefusalReason | null { return this.refusal; }

  betLimits(machineId: MachineId, instanceId: InstanceId): BetLimits {
    const def = registry.get(machineId)?.def;
    if (!def) return { min: 0, max: Number.POSITIVE_INFINITY, ladder: [] };
    const si = this.quotaMode ? nightDef(this.index).si : 1;
    const capMult = this.mod('bet.maxMult', machineId, 1, { instance: instanceId });
    let ceiling = def.maxBet * si * capMult;
    // Night 1 stake safety: one wrong press cannot end the run, so the top stake is a third of the starting pocket.
    if (this.quotaMode && this.index === 0) ceiling = Math.min(ceiling, Math.max(def.minBet, night1StakeCap(START.pocket)));
    // Night Cards: HIGH TABLE doubles the floor (never above the ceiling, so the ladder keeps one stake).
    const minBet = Math.min(def.minBet * this.nightCards.fx().minBetMult, Math.max(def.minBet, ceiling));
    const ladder = (def.betSteps ?? bettingLadder(minBet, ceiling)).filter((v) => v >= minBet && v <= ceiling);
    const max = snapDown(ceiling, ladder) || minBet;
    return { min: minBet, max, ladder };
  }

  payoutFactor(machineId: MachineId, instanceId: InstanceId): number {
    const br = this.mods.explain('payout.mult', machineId, 1, { pid: this.selfId, instance: instanceId });
    return Math.min(PAYOUT_GUARD, br.result);
  }

  bet(amount: number, src: EcoSource, o?: BetOpts): boolean {
    if (!this.canPlay()) return this.refuse('phase');
    if (this.boilerShut(src.machineId)) return this.refuse('locked');
    const q: ModQuery = { pid: this.selfId, instance: src.mid };
    const lim = this.betLimits(src.machineId, src.mid);
    if (amount < lim.min || amount > lim.max) return this.refuse('limit');
    if (!this.confirmStake(amount, src, lim.min)) return this.refuse(STAKE_CONFIRM_REASON);
    const cost = Math.ceil(amount * this.mod('bet.costMult', src.machineId, 1, q));
    const base = o?.pulls ?? registry.get(src.machineId)?.def.actionCost ?? 1;
    const pullCost = Math.max(0, Math.round(this.mod('x.actionCostDelta', src.machineId, base, q)));
    if (!this.rules.unlimitedPulls && this.pullCount < pullCost) return this.refuse('pulls');
    if (cost > this.coins) { this.clearStakeArm(); return this.refuse('funds'); }
    this.refusal = null;
    this.clearStakeArm();

    if (!this.rules.unlimitedPulls) this.pullCount -= pullCost;
    this.watchPulls += pullCost;
    if (pullCost > 0) this.watchEv.onPull(src.mid);
    this.coins -= cost;
    this.stats.wagered = (this.stats.wagered ?? 0) + cost;
    if (this.quotaMode) this.feedJackpot('net', Math.floor(amount * NETWORK_FEED));
    this.lastBet.set(src.mid, amount);
    if (!this.openRounds.has(src.mid)) {
      this.openRounds.add(src.mid);
      this.rounds++;
      this.stats.rounds = this.rounds;
      this.plays.set(src.machineId, (this.plays.get(src.machineId) ?? 0) + 1);
      this.countTilt(src.mid, src.machineId, pullCost);
      this.emit('machine:round', { mid: src.mid, machineId: src.machineId, pid: this.selfId, bet: amount });
      const tk = this.spotlight.round(src.machineId);   // Machine of the Night: every 5th play on the spotlight pays a Ticket
      if (tk > 0) this.earn('ticket', tk, 'spotlight');
    }
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -cost, reason: `bet:${src.machineId}` });
    if (!this.rules.unlimitedPulls) {
      this.emit('pulls:change', { pid: this.selfId, pulls: this.pullCount });
      if (pullCost > 0 && this.pullCount <= 0) this.enter('closing', closingSeconds(this.isLastWatch()));
    }
    this.notify();
    this.refreshOdds();
    return true;
  }

  /**
   * What a paid play credits for this gross, after House Favour, modifiers, Tilt/Lamp factors and the House Limit. Pure: nothing is
   * paid or fed. `win()` uses it; machines call `previewCredit` for the WIN callout so it shows the net amount, not the gross.
   */
  private creditOf(gross: number, src: EcoSource, meta: Pick<WinMeta, 'bet' | 'raw' | 'factorApplied'>): { credited: number; pr: PayoutResult | null } {
    // betFrac (bet / max bet) lets Gilded Chip read the stake; Capacitor scopes through `instance`.
    const maxBet = this.betLimits(src.machineId, src.mid).max;
    const q: ModQuery = { pid: this.selfId, instance: src.mid, ctx: { betFrac: Number.isFinite(maxBet) && maxBet > 0 ? meta.bet / maxBet : 0 } };
    if (meta.raw) return { credited: Math.max(0, Math.floor(gross)), pr: null };
    if (gross <= 0) return { credited: Math.floor(meta.bet * this.mod('loss.refund', src.machineId, 0, q)), pr: null };
    // Split the fold into A (additive bonuses, halved by the dampener) and M (the rest). `factorApplied` = the machine
    // already scaled the gross (elevator), so no factor and no flat are applied again.
    let A = 0;
    let M = 1;
    if (!meta.factorApplied) {
      const br = this.mods.explain('payout.mult', src.machineId, 1, q);
      for (const s of br.steps) if (s.op === 'inc') A += s.value;
      M = br.result / (1 + A);
    }
    const flat = meta.factorApplied ? 0 : this.mod('payout.flat', src.machineId, 0, q);
    const limitMult = this.mod('x.house.limitMult', src.machineId, 1, q);
    const r = settlePayout({ gross, bet: meta.bet, A, M, flat, quota: this.quotaMode ? this.quota.due : 0, limitMult });
    return { credited: r.credited, pr: r };
  }

  /** The amount `win()` would credit for this gross (WIN callouts show this, never the pre-favour gross). Pays nothing. */
  previewCredit(gross: number, src: EcoSource, meta: Pick<WinMeta, 'bet' | 'raw' | 'factorApplied'>): number {
    return this.creditOf(gross, src, meta).credited;
  }

  win(gross: number, src: EcoSource, meta: WinMeta): number {
    this.openRounds.delete(src.mid);
    const { credited, pr } = this.creditOf(gross, src, meta);
    if (pr && pr.excess > 0) this.feedJackpot('net', pr.excess);
    this.coins += credited;
    this.maxWallet = Math.max(this.maxWallet, this.coins);
    this.stats.paid = (this.stats.paid ?? 0) + credited;
    if (credited > this.biggest) this.bestMachine = src.machineId;
    this.biggest = Math.max(this.biggest, credited);
    this.stats.biggest = this.biggest;
    if (credited > meta.bet) this.stats.wins = (this.stats.wins ?? 0) + 1;
    this.emit('machine:result', {
      mid: src.mid, machineId: src.machineId, pid: this.selfId, bet: meta.bet, gross, credited, tier: meta.tier, tags: meta.tags ?? [],
    });
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: credited, reason: `win:${src.machineId}` });
    if (pr && gross > meta.bet && !meta.silent) {
      this.emit('run:wintier', {
        pid: this.selfId, mid: src.mid, machineId: src.machineId, tier: meta.tier, bet: meta.bet, gross, credited,
        factor: pr.factor, dampened: pr.dampened, capped: pr.capped, excess: pr.excess,
      });
    }
    this.notify();
    this.persistSoon();
    this.refreshOdds();
    this.checkRescue();
    return credited;
  }

  /** The cheapest bet on the floor (any machine that takes a stake); the pocket must cover it to keep playing. */
  cheapestBet(): number {
    if (this.minBetCache > 0) return this.minBetCache;
    let min = Number.POSITIVE_INFINITY;
    for (const m of registry.all()) {
      const b = m.def.minBet;
      if (b > 0 && b < min) min = b;
    }
    if (!Number.isFinite(min)) return 1;
    this.minBetCache = min;
    return bestBetFloor(min);
  }
  private minBetCache = 0;

  /**
   * Coins every Debt Terminal deposit of this Watch leaves in the pocket: 2 × the cheapest bet, computed once per Watch (cached
   * until the next Watch starts). It does not follow the pocket down, so the terminal's "keeps N" is the number that holds.
   */
  depositFloor(): number {
    if (this.watchFloatSnap === null) this.watchFloatSnap = watchFloat(this.cheapestBet());
    return this.watchFloatSnap;
  }

  /**
   * Why a deposit of `amount` would be refused, or null when it goes through (director decision 3). Order: not a quota Watch,
   * the Watch is closed (Dawn, the run is over), the Night is paid (Dawn until OPEN THE FLOOR), nothing to deposit, and
   * the float (`depositFloor`, lifted only by a confirmed ALL). A deposit after the quota is met is accepted (decision 2).
   * Closing and Settle stay open (wave 42, decision 2): the bank was settled at the start of Settle, so a coin put in then
   * earns from the next Watch on.
   */
  depositRefusal(amount: number, confirmAll = false): DepositRefusal | null {
    if (!this.quotaMode || this.topside) return 'notQuota';
    if (this.ended || this.phase === 'collection') return 'closed';
    if (this.nightDone) return 'nightPaid';
    const amt = Math.min(Math.floor(Number.isFinite(amount) ? amount : 0), this.coins);
    if (amt <= 0) return 'nothing';
    if (!confirmAll && amt > depositRoom(this.coins, this.depositFloor())) return 'float';
    return null;
  }

  /**
   * Debt Terminal deposit. No deposit of a Watch may take the pocket below `depositFloor()` unless `confirmAll`
   * (the player confirmed ALL). Refused (false) otherwise; the terminal clamps to the room before it asks.
   */
  deposit(amount: number, confirmAll = false): boolean {
    const why = this.depositRefusal(amount, confirmAll);
    if (why !== null) return this.refuse(why);
    this.refusal = null;
    const amt = Math.min(Math.floor(amount), this.coins);
    this.watchDeposits += 1;
    this.watchDepCoins += amt;
    this.coins -= amt;
    const credit = Math.floor(amt * (1 + this.mod('deposit.bonus', RUN_MACHINE, 0)));
    this.bankGranted += Math.max(0, credit - amt);
    this.debtPaid += credit;
    this.stats.deposited = (this.stats.deposited ?? 0) + credit;
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -amt, reason: 'deposit' });
    this.syncQuota();
    this.emit('run:deposit', { pid: this.selfId, amount: credit, paid: this.debtPaid, due: this.quota.due });
    // Wave 42 (decision 4): every move into the bank is named, so a pocket that falls and a bank that rises read as one transfer.
    this.bankNote('bank.deposit', { n: credit, p: Math.floor(this.coins) });
    this.checkMet();
    this.emit('quota:update', { quota: this.quota });
    this.persist();
    this.checkRescue();
    return true;
  }

  give(_to: PlayerId, _amount: number): boolean { return false; }

  buyCharm(charmId: string, price: number): boolean {
    if (this.ended) return false;
    if (this.quotaMode && !this.shopOpen()) return this.refuse('shopShut');
    if (!charmDef(charmId)) return false;
    if (price > 0 && this.coins < price) return this.refuse('funds');
    if (!this.charmBox.add(this.selfId, charmId, this.pegs())) return this.refuse('limit');
    this.refusal = null;
    this.coins -= price;
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -price, reason: `charm:${charmId}` });
    this.notify();
    this.persist();
    return true;
  }

  /** What a charm sells for: 50 % (70 % with a Pawn Ticket), raised by `x.charm.sellValue` (Foundations V6). Cursed charms: 0. */
  private sellValue(id: string): number {
    const def = charmDef(id);
    if (!def || def.rarity === 'cursed') return 0;
    return sellRefund(charmPrice(def, this.shiftState.stake), this.mod('x.charm.sellValue', RUN_MACHINE, 0.5), this.charmBox.has(this.selfId, 'pawn_ticket'));
  }

  sellCharm(id: string): boolean {
    const def = charmDef(id);
    if (!def || def.rarity === 'cursed') return false;
    if (this.quotaMode && this.phase !== 'intermission') return false;
    const got = this.sellValue(id);
    if (!this.charmBox.remove(this.selfId, id)) return false;
    this.coins += got;
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: got, reason: `sell:${id}` });
    this.notify();
    this.persist();
    return true;
  }

  hostBet(pid: PlayerId, amount: number, src: EcoSource): boolean { return pid === this.selfId && this.bet(amount, src); }
  hostWin(pid: PlayerId, gross: number, src: EcoSource, meta: WinMeta): number { return pid === this.selfId ? this.win(gross, src, meta) : 0; }

  // ─â”€ modifiers ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  getModifier(hook: ModHook, machineId: MachineId, base: number, pid?: PlayerId): number { return this.mods.mod(hook, machineId, base, { pid }); }
  mod(hook: ModHook, machineId: MachineId, base: number, q?: ModQuery): number { return this.mods.mod(hook, machineId, base, q); }
  explain(hook: ModHook, machineId: MachineId, base: number, q?: ModQuery): ModBreakdown { return this.mods.explain(hook, machineId, base, q); }
  luck(machineId: MachineId, pid?: PlayerId): number { return this.mods.mod('luck', machineId, 0, { pid }); }
  charms(pid?: PlayerId): readonly CharmState[] { return this.charmBox.list(pid ?? this.selfId); }

  // ─â”€ pools and info ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
  jackpot(pool: string): number { return this.pools.get(pool)?.value ?? 0; }
  jackpotAdd(pool: string, amount: number): void { this.feedJackpot(pool, amount); }
  jackpotClaim(pool: string, src: EcoSource): number { return this.claimJackpot(pool, src); }

  debt(_pid?: PlayerId): DebtState {
    return { index: this.index, due: this.quota.due, paid: this.debtPaid, deadlineAt: 0, floor: this.index + 1, total: BASE_RUN_NIGHTS };
  }
  timeLeft(): number { return this.canPlay() || this.phase === 'closing' ? this.clock.remaining : 0; }
  isLocked(machineId: MachineId): boolean { if (this.owned.has(machineId)) return false; return isLockedFor(machineId, effectiveNight(this.night(), this.nightPaid, this.topside), this.mode, this.seed); }
  alive(_pid?: PlayerId): boolean { return this.living; }
  stat(key: string, add = 0): number {
    const v = (this.counters.get(key) ?? 0) + add;
    if (add) {
      this.counters.set(key, v);
      this.syncStatContracts(key);
    }
    return v;
  }
  phone(): PhoneCallState | null { return this.rescue.phone() ?? this.hotline.phone(); }
  answerPhone(choice: number): void { if (!this.rescue.answer(choice)) this.hotline.answer(choice); }

  /** The Night summary's books for the Night in progress (float, interest, tickets). A copy: the caller cannot change them. */
  nightLedger(): Readonly<NightLedger> { return { ...this.ledger }; }

  /** The live interest rate of this Night, whole percent: the schedule rate plus `x.econ.interestAdd` (what Settle pays). */
  interestPct(): number { return ratePercent(this.liveRate()); }

  /** Settle's rate: schedule rate + `x.econ.interestAdd` bonuses, floored at 0. One source for Settle, the rescue and the text. */
  private liveRate(): number { return interestRate(nightDef(this.index).interest, this.mod('x.econ.interestAdd', RUN_MACHINE, 0) + this.stakeFx().interestAdd); }

  balance(cur: CurrencyId, _pid?: PlayerId): number {
    if (cur === 'coin') return this.coins;
    if (cur === 'ticket') return this.tickets;
    return this.currencies.get(cur) ?? 0;
  }
  earn(cur: CurrencyId, amount: number, _reason: string, _pid?: PlayerId): void {
    if (amount <= 0) return;
    if (cur === 'coin') {
      this.coins += Math.floor(amount);
      this.maxWallet = Math.max(this.maxWallet, this.coins);
      this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: Math.floor(amount), reason: _reason });
    } else if (cur === 'ticket') {
      const before = this.tickets;
      this.tickets = Math.min(TICKET_CAP, this.tickets + Math.floor(amount));
      this.ledger.tickets += this.tickets - before;
    } else {
      this.currencies.set(cur, (this.currencies.get(cur) ?? 0) + amount);
    }
    this.notify();
  }
  spend(cur: CurrencyId, amount: number, reason: string, pid?: PlayerId): boolean {
    if (this.balance(cur, pid) < amount) return false;
    if (cur === 'coin') this.coins -= amount;
    else if (cur === 'ticket') this.tickets -= amount;
    else this.currencies.set(cur, this.balance(cur, pid) - amount);
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -amount, reason });
    this.notify();
    return true;
  }
  dread(): number {
    const add = this.mod('dread.add', RUN_MACHINE, 0);
    return Math.min(1, Math.max(0, (this.dreadPts + add) / 100));
  }
  addDread(delta: number, _reason?: string): void {
    this.dreadPts = Math.min(100, Math.max(0, this.dreadPts + delta));
    this.emit('dread:change', { value: this.dread() });
  }
  playCutscene(_id: string, _o?: CutscenePlayOpts): Promise<CutsceneResult> {
    log.warnOnce('run:playCutscene', 'run', 'playCutscene belongs to the cutscene player; resolving as aborted');
    return Promise.resolve('aborted');
  }

  // ─â”€ DebtRun controls ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
  tick(dt: number): void {
    if (this.ended || dt <= 0) return;
    this.elapsed += dt;
    this.clockAcc += dt;
    if (this.dirty) {
      this.sinceFlush += dt;
      if (this.sinceFlush >= SAVE_SOON_SEC) this.persist();
    }
    if (this.pawn.rev !== this.pawnRev) { this.pawnRev = this.pawn.rev; this.persistSoon(); }
    if (this.stamps.rev !== this.stampRev) { this.stampRev = this.stamps.rev; this.persistSoon(); }
    const head = this.overpays[0];
    if (head) {
      head.left -= dt;
      if (head.left <= 0) this.autoPickOverpay();
    }
    if (this.clockAcc >= 1) {
      this.clockAcc -= 1;
      this.emit('run:clock', { remaining: this.clock.remaining });
    }
    this.buffSys.tick(dt);
    this.hotline.tick(dt);
    this.rescue.tick(dt);
    this.tickSafety(dt);
    tickClockHold(dt);
    this.itemSys.tick(dt);
    if (this.duelAfter.length) this.tickDuelAfter(dt);
    // Night Cards: the Dawn offer's 20 s timer runs in intermission too (OPEN THE FLOOR settles it early with the first card).
    const autoCard = this.nightCards.tick(dt);
    if (autoCard) { this.emit('run:nightcard', { pid: this.selfId, state: 'auto', card: autoCard }); this.notify(); this.persist(); }
    if (this.phase === 'play' || this.phase === 'lastCall') this.tycoonSys.tick(dt);
    if (!this.rules.timed) return;
    switch (this.phase) {
      case 'bell':
        if (this.tickStarter(dt)) break;   // the Starter Draft holds the Bell until a charm is taken (or its timer runs out)
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.startPlay();
        break;
      case 'play':
      case 'lastCall':
        if (!clockHeld()) { this.clock.tick(dt); this.watchEv.tick(dt); }   // tutorial steps 1-3, Collector lines and cutscenes hold the Watch clock (and its floor event)
        if (this.clock.remaining <= 0) this.enter('closing', closingSeconds(this.isLastWatch()));
        else if (this.phase === 'play' && this.clock.remaining <= this.lastCallSec) this.enter('lastCall', 0);
        break;
      case 'closing':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.settleWatch();
        break;
      case 'settle':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.afterSettle();
        break;
      case 'collection':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.dawn();
        break;
      default:
        break;
    }
  }

  startWatch(): boolean {
    if (this.ended || !this.quotaMode || this.topside || this.nightDone) return this.refuse('noWatch');
    if (this.phase !== 'intermission') return this.refuse(this.phaseRefusal());
    this.refusal = null;
    const nd = nightDef(this.index);
    const isOvertime = this.watch === this.overtimeIdx;
    this.ensureBoss(); // before the clock and pull mods are read below
    // the Watch's floor event (wave 43) rolls before the clock and pull mods are read (cold_snap and the clock/pull effects)
    this.watchEv.begin(this.rng, this.index + 1, this.watch, !!this.bossToday() || this.nightCards.fx().noFloorEvents);
    this.coolBoiler();
    this.boughtThisWatch = 0;
    this.clockLen = isOvertime ? OVERTIME_SEC : Math.max(10, Math.round(this.mod('x.run.clockAdd', RUN_MACHINE, nd.clock)));
    // Last Call: the base length (20 s, 30 s in the last Watch) plus `x.run.lastCallAdd` (Clutch set: +6 s)
    this.lastCallSec = Math.max(0, Math.round(this.mod('x.run.lastCallAdd', RUN_MACHINE, lastCallSeconds(this.isLastWatch()))));
    this.pullsMax = isOvertime ? OVERTIME_PULLS : Math.max(1, Math.round(this.mod('x.run.pullsAdd', RUN_MACHINE, nd.pulls)));
    this.pullCount = this.pullsMax;
    this.pullToast(this.pullsMax, 'watch');
    this.watchPulls = 0;
    this.watchDeposits = 0;
    this.watchFloatSnap = null;                 // the new Watch's float is read afresh (once) on its first deposit or screen
    this.watchWd = 0; this.watchDepCoins = 0;
    this.shiftState.duration = this.clockLen;
    this.shiftState.lastCallSec = this.lastCallSec;
    this.shiftState.segment = { index: this.watch, count: this.watches };
    this.emit('pulls:change', { pid: this.selfId, pulls: this.pullCount });
    this.emit('run:deadline', { index: this.index, due: this.quota.due, seconds: this.clockLen });
    this.enter('bell', BELL_SEC);
    this.rollLamps();
    this.buffSys.onBell();
    this.persist();
    this.refreshOdds();
    return true;
  }

  openFloor(): boolean {
    if (this.ended || !this.quotaMode || this.topside) return this.refuse('noWatch');
    if (this.phase !== 'intermission') return this.refuse(this.phaseRefusal());
    if (!this.nightDone) return this.refuse('nightUnpaid');
    // Night Cards: with the panel on screen the lever waits for a pick (the panel's own timer still auto-picks, so nothing
    // soft-locks). Headless runs and tests have no panel: there an open offer is settled by its first card.
    if (this.nightCardGate && this.nightCardOffer()) return this.refuse('nightCard');
    this.refusal = null;
    const settled = this.nightCards.settle();
    if (settled) this.emit('run:nightcard', { pid: this.selfId, state: 'auto', card: settled });
    // Ascent: the pit rises one floor. The Elevator Token pays 5 % of the pocket (max 300 × SI).
    if (this.charmBox.has(this.selfId, 'elevator_token')) {
      const gain = Math.min(Math.floor(this.coins * 0.05), 300 * nightDef(this.index).si);
      if (gain > 0) this.earn('coin', gain, 'charm:elevator_token');
    }
    this.index += 1;
    this.ledger = { night: this.index + 1, float: 0, interest: 0, tickets: 0, cut: 0, carried: 0 };   // a new Night's books start empty (before its float)
    const nd = nightDef(this.index);
    this.watches = Math.max(1, nd.watches + this.nightCards.fx().watchAdd);   // Night Cards: RUSH NIGHT drops a Watch
    this.watch = 0;
    this.overtimeIdx = -1;
    this.nightDone = false;
    this.metFired = false;
    this.skipRest = 0;
    this.discount = this.nextDiscount;
    this.nextDiscount = 0;
    this.quota.claimed = [];
    this.loanQuota = 0; this.rescuesUsed = 0; this.rescueCool = 0;
    this.shiftState.index = this.index;
    this.shiftState.floor = this.index + 1;
    this.shiftState.stake = nd.si;
    this.shiftState.segment = { index: 0, count: this.watches };
    this.houseFloat();
    this.recomputeQuota();
    this.prepareBoss();
    const keptCard = this.nightCards.started();   // Night Cards: the card kept at the Dawn before this Night, if any
    if (keptCard) {
      this.banner?.(t('nightcard.started', { name: t(`nightcard.${keptCard.id}.name`) }), { color: '#ff7a5a', hold: 4, size: 16 });
      this.emit('run:nightcard', { pid: this.selfId, state: 'started', card: keptCard.id });
    }
    // Machine of the Night (wave 55): one open floor kind is this Night's spotlight; the banner names it.
    const spot = this.spotlight.begin(this.index, (this.worldLink?.machines() ?? [])
      .filter((m) => !this.worldLink?.locked?.(m.instance) && isSpotlightEligible(m.machineId, registry.get(m.machineId)?.def.category))
      .map((m) => ({ machineId: m.machineId, instance: m.instance })));
    if (spot) this.banner?.(spotlightStartLine(spot, machineName(spot.machineId)), { color: '#ffd34a', hold: 4, size: 16 });
    this.enter('intermission', 0);
    this.persist();
    return true;
  }

  /**
   * The House float (director's decision): at the start of every Night the pocket is topped up to F(n) = 12 + 6n when it is
   * below that. It is free and never part of the quota. Booked as `house:float`, so the Night summary's "carried over" (which
   * counts only `dawn:surplus`) leaves it out; `inGameState.ts` shows the toast.
   */
  private houseFloat(): void {
    const top = houseFloatTopUp(this.coins, this.index);
    if (top > 0) { this.earn('coin', top, 'house:float'); this.ledger.float += Math.floor(top); }
  }

  ringBell(): boolean {
    if (this.ended || !this.quotaMode) return this.refuse('noWatch');
    if (!this.canPlay()) return this.refuse(this.phaseRefusal());
    this.refusal = null;
    this.enter('closing', closingSeconds(this.isLastWatch()));
    this.persist();
    return true;
  }

  settleEarly(): boolean {
    if (this.ended || !this.quotaMode) return this.refuse('noWatch');
    if (!this.canPlay()) return this.refuse(this.phaseRefusal());
    if (this.debtPaid < this.quota.due) return this.refuse('quotaShort');
    this.refusal = null;
    const skip = Math.max(0, this.watches - this.watch - 1);
    if (skip > 0) {
      const before = this.tickets;
      this.tickets = Math.min(TICKET_CAP, this.tickets + 4 * skip);
      this.ledger.tickets += this.tickets - before;
      this.freeRerolls += skip;
    }
    this.skipRest = skip;
    this.settleWatch();
    return true;
  }

  // ─â”€ the bank (wave 27): WITHDRAW and the numbers the Debt Terminal shows ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  /**
   * The Pawn (charms and the STAMPS tab) is open between Watches and during the Closing window (director decision 1: the
   * player can still shop while the Watch ends). Not in Bell, play, Settle or Dawn.
   */
  private shopOpen(): boolean {
    return (this.phase === 'intermission' || this.phase === 'closing') && !this.ended && !this.nightCards.fx().pawnClosed;
  }

  /**
   * A withdraw is allowed from Intermission to the end of Settle: Bell, play, Last Call, Closing and Settle (wave 42,
   * decision 2). Never Dawn, the Topside choice, or a paid Night.
   */
  private withdrawOpen(): boolean {
    if (this.ended || !this.quotaMode || this.nightDone || this.topside) return false;
    return this.phase === 'intermission' || this.phase === 'bell' || this.phase === 'play' || this.phase === 'lastCall'
      || this.phase === 'closing' || this.phase === 'settle';
  }

  private bankInput(): BankInput {
    return {
      debtPaid: this.debtPaid, granted: this.bankGranted, due: this.quota.due, rate: this.liveRate(),
      watchPulls: this.watchPulls, churn: churnOf(this.watchWd, this.watchDepCoins),
    };
  }

  bank(): BankView {
    const i = this.bankInput();
    const due = Math.max(0, Math.floor(this.quota.due));
    return {
      balance: bankBalance(i),
      withdrawable: this.withdrawOpen() ? withdrawable(i) : 0,
      pocket: Math.floor(this.coins),
      due,
      left: Math.max(0, due - Math.floor(this.debtPaid)),
      ratePct: ratePercent(i.rate),
      interestNext: interestNext(i),
      interestAt: (balance: number) => interestFor(interestBase(balance, i.churn), due, i.rate),
      pullsToQualify: this.phase === 'intermission' || this.phase === 'bell' ? pullsToQualify(0) : pullsToQualify(this.watchPulls),
      interestCap: Math.floor(2 * due * Math.max(0, i.rate)),
      open: this.withdrawOpen(),
      settleLeft: this.phase === 'settle' ? Math.max(0, this.phaseLeft) : 0,
      pullsLeft: Number.isFinite(this.pullCount) ? this.pullCount : 0,
      minBet: this.cheapestBet(),
    };
  }

  withdrawPreview(amount: number): WithdrawPreview {
    const i = this.bankInput();
    return previewWithdraw(this.withdrawOpen() ? i : { ...i, granted: Number.MAX_SAFE_INTEGER }, amount);
  }

  withdraw(amount: number): number {
    if (!this.withdrawOpen()) return 0;
    const amt = Math.min(Math.floor(Number.isFinite(amount) ? amount : 0), withdrawable(this.bankInput()));
    if (amt <= 0) return 0;
    this.refusal = null;
    this.debtPaid = bankBalance(this.bankInput()) - amt;
    this.watchWd += amt;
    this.stats.deposited = Math.max(0, (this.stats.deposited ?? 0) - amt);
    this.coins += amt;
    this.maxWallet = Math.max(this.maxWallet, this.coins);
    this.metFired = this.quota.due > 0 && this.debtPaid >= this.quota.due;
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: amt, reason: 'withdraw' });
    this.syncQuota();
    this.emit('quota:update', { quota: this.quota });
    // the Collector's call is only for an empty pocket: once the player can play again, hang up
    if (this.rescue.active() && !pocketDead(this.coins, this.cheapestBet())) this.rescue.hangUp();
    this.notify();
    this.persist();
    return amt;
  }

  brokeHelp(): BrokeHelp | null {
    if (!this.quotaMode || this.ended || this.nightDone) return null;
    const playing = this.canPlay() && this.pullCount > 0;
    const between = this.phase === 'intermission' || this.phase === 'bell';
    if (!playing && !between) return null;
    const minBet = this.cheapestBet();
    if (!pocketDead(this.coins, minBet)) return null;
    const si = Math.max(1, nightDef(this.index).si);
    const due = this.quota.due;
    const ringing = this.rescue.active() || this.hotline.phone() !== null;
    const loan = this.rescuesUsed < RESCUE_MAX_PER_NIGHT && due > 0 ? rescueTerms(due) : null;
    return {
      pocket: Math.floor(this.coins), minBet, pullsLeft: between ? nightDef(this.index).pulls : this.pullCount,
      steps: brokeSteps({
        bank: this.withdrawOpen() ? withdrawable(this.bankInput()) : 0,
        tickets: this.tickets, ticketCoins: 5 * si,
        phoneRinging: ringing, loan: loan ?? undefined,
        bell: playing,
      }),
    };
  }

  buyPull(): boolean {
    if (this.ended || this.rules.unlimitedPulls || !this.canPlay()) return false;
    if (this.boughtThisWatch >= PULLS_BOUGHT_MAX) return false;
    if (this.tickets < PULL_PRICE_TICKETS) return this.refuse('funds');
    this.tickets -= PULL_PRICE_TICKETS;
    this.boughtThisWatch += 1;
    this.pullCount += 1;
    this.emit('pulls:change', { pid: this.selfId, pulls: this.pullCount });
    this.pullToast(1, 'bought');
    this.notify();
    this.persist();
    return true;
  }

  stayUp(): boolean {
    if (!this.topside || this.ended) return false;
    this.endRun('escaped', 'elevator');
    return true;
  }
  goBackDown(): boolean {
    if (!this.topside || this.ended) return false;
    this.topside = false;
    this.persist();
    return true;
  }
  quit(): boolean {
    if (this.ended) return false;
    this.endRun('quit');
    return true;
  }

  attachWorld(link: RunWorldLink | null): void {
    this.worldLink = link;
    // a resumed Watch already has Lamps: tell the beacons once the pit exists
    if (link && (this.circ.hot().length > 0 || this.circ.cold().length > 0)) this.emitLamps();
  }
  takeIdleReport(): IdleReport | null { return this.tycoonSys.takeIdleReport(); }
  dispose(): void {
    this.unsubs.splice(0).forEach((u) => u());
    setActiveStampBook(null);
    bindWingSource(null);
    this.hotline.dispose();
    this.rescue.dispose();
    clearClockHolds();
    this.buffSys.dispose();
    this.itemSys.dispose();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  // ─â”€ phases ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  private enter(phase: ShiftPhase, left: number): void {
    const before = this.window();
    this.phase = phase;
    this.phaseLeft = left;
    this.shiftState.phase = phase;
    this.shiftState.clock = this.clock.progress;
    this.emit('shift:phase', { phase, index: this.index });
    const after = this.window();
    if (before !== after) this.emit('run:window', { window: after, night: this.night() });
    // Dawn closes an unentered Hollow Door (and a ringing 3:33 call): the door is spent for the run.
    if (after === 'dawn' && before !== 'dawn') this.hollow = doorDawn(this.hollow);
    this.notify();
  }

  private startPlay(): void {
    this.clock.start(this.clockLen);
    this.shiftState.startedAt = this.elapsed;
    this.shiftState.endsAt = this.elapsed + this.clockLen;
    this.enter('play', 0);
  }

  private settleWatch(): void {
    this.clock.stop();
    this.watchEv.end();
    const nd = nightDef(this.index);
    const lastWatch = this.isLastWatch();
    const overtime = this.watch === this.overtimeIdx;
    const pid = this.selfId;
    this.enter('settle', SETTLE_SEC);
    this.settleCircuit();
    if (this.quotaMode) {
      const rate = this.liveRate();
      const active = !overtime && this.watchPulls >= ACTIVITY_MIN_PULLS;
      let earned = 0;
      if (active && rate > 0) {
        // coins that left the bank and came back this same Watch earn nothing (the churn rule, bank.ts)
        const base = interestBase(this.debtPaid, churnOf(this.watchWd, this.watchDepCoins));
        let interest = interestFor(base, this.quota.due, rate);
        if (lastWatch && this.charmBox.has(pid, 'seven_floor_key')) interest += interestFor(base + interest, this.quota.due, rate);
        earned = interest;
        if (interest > 0) {
          this.debtPaid += interest;
          this.stats.interest = (this.stats.interest ?? 0) + interest;
          this.ledger.interest += interest;
          this.emit('run:deposit', { pid, amount: interest, paid: this.debtPaid, due: this.quota.due });
        }
      }
      // Draft wave: every Settle says what the bank did (the interest, the rate, or why it paid nothing).
      if (rate > 0) this.interestNote(pid, earned, ratePercent(rate), overtime ? 0 : Math.max(0, ACTIVITY_MIN_PULLS - this.watchPulls));
      if (active && rate > 0 && this.charmBox.has(pid, 'perpetual_ledger')) {
        const pocket = Math.floor(this.coins * rate * 0.5);
        if (pocket > 0) this.earn('coin', pocket, 'charm:perpetual_ledger');
      }
    }
    this.payHouseCut(overtime);
    if (!this.rules.unlimitedPulls && this.pullCount > 0) {
      if (this.watchPulls >= ACTIVITY_MIN_PULLS) this.earn('ticket', this.pullCount, 'settle:unused-pulls');
      this.pullCount = 0;
      this.emit('pulls:change', { pid, pulls: 0 });
    }
    this.syncQuota();
    this.checkMet();
    this.emit('quota:update', { quota: this.quota });
    this.persist();
  }

  // ─â”€ tycoon: owned machines (wave 28) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  /** Base quota the prices and cuts scale with: tonight's, or the next Night's once tonight is paid. */
  private priceQuota(): number { return nightQuota(this.index + (this.nightDone && !this.topside ? 1 : 0)); }

  buyPriceOf(machineId: MachineId): number {
    if (this.ended || !isProgressive(this.mode) || this.owned.has(machineId) || !tierOf(machineId)) return 0;
    if (!isLockedFor(machineId, effectiveNight(this.night(), this.nightPaid, this.topside), this.mode, this.seed)) return 0;
    return buyPrice(machineId, this.priceQuota());
  }
  buyMachine(machineId: MachineId): boolean {
    const price = this.buyPriceOf(machineId);
    if (price <= 0 || this.phase === 'collection' || !this.spend('coin', price, `buy:${machineId}`)) return false;
    this.owned.add(machineId);
    this.stat('tycoon.bought', 1);
    this.banner?.(t('prog.bought', { name: machineName(machineId), cut: expectedCut(machineId, this.priceQuota()) }), { color: '#ffd34a', hold: 3, size: 8 });
    this.persistSoon();
    this.notify();
    return true;
  }
  owns(machineId: MachineId): boolean { return this.owned.has(machineId); }
  empire(): { count: number; perWatch: number; tonight: number; owned: readonly MachineId[] } {
    const q = this.priceQuota();
    let per = 0;
    for (const id of this.owned) per += expectedCut(id, q);
    return { count: this.owned.size, perWatch: per, tonight: this.ledger.cut, owned: [...this.owned] };
  }
  /** Watch settle: every owned machine pays its house cut (a share of what the ghost players wagered on it + the flat trickle). */
  private payHouseCut(overtime: boolean): void {
    if (!this.quotaMode || this.owned.size === 0 || overtime) return;
    const q = nightQuota(this.index);
    let total = 0;
    for (const id of this.owned) total += houseCut(id, q, ghostWager(id, q, this.seed, this.index, this.watch));
    if (total <= 0) return;
    this.earn('coin', total, 'house:cut');
    this.ledger.cut += total;
    this.banner?.(t('prog.cut', { n: total, total: this.ledger.cut }), { color: '#ffd34a', hold: 3, size: 8 });
  }

  private afterSettle(): void {
    if (this.skipRest === 0 && this.watch + 1 < this.watches) {
      this.watch += 1;
      this.enter('intermission', 0);
    } else {
      this.skipRest = 0;
      this.tycoonSys.onDawn();
      this.enter('collection', COLLECTION_SEC);
      this.announceNextBoss();
    }
    this.persist();
  }

  /** Dawn Collection: the quota is settled. Paid → overpay rewards, the surplus goes back to the pocket. Short → protections or the trapdoor. */
  private dawn(): void {
    this.expireContracts();
    const due = this.quota.due;
    let paid = this.debtPaid >= due;
    if (!paid && this.charmBox.has(this.selfId, 'false_bottom') && due - this.debtPaid <= 0.1 * due) {
      this.charmBox.remove(this.selfId, 'false_bottom');
      this.debtPaid = due;
      paid = true;
    }
    if (!paid && !this.ropeUsed && this.charmBox.has(this.selfId, 'rope_ladder')) {
      this.charmBox.remove(this.selfId, 'rope_ladder');
      this.ropeUsed = true;
      this.overtimeIdx = this.watches;
      this.watches += 1;
      this.watch = this.overtimeIdx;
      this.enter('intermission', 0);
      this.persist();
      return;
    }
    if (!paid) { this.fall(); return; }
    // HOUSE TAKES NOTICE (wave 47): the wealth of this Dawn (pocket + bank, before the surplus returns) floors the next quota.
    const wealth = this.coins + this.debtPaid;
    this.houseWealth = wealth;

    const ratio = due > 0 ? this.debtPaid / due : 1;
    for (const tier of OVERSHOOT_TIERS) {
      if (ratio >= tier.ratio && !this.quota.claimed.some((c) => c.id === tier.id)) {
        const claim: OvershootClaim = { id: tier.id, at: Math.round(this.elapsed * 1000) };
        this.quota.claimed.push(claim);
        this.grant(tier.reward);
        this.emit('quota:overshoot', { tier: tier.id, pid: this.selfId });
      }
    }
    this.houseNotice();   // after the overshoot grants: a golden overpay may set the next Night's discount
    this.finishBoss();
    this.grantKeys();
    this.releaseMarkEscrow();
    // The surplus above the quota (overpays and the interest on them, all of it banked until now) returns to the pocket at Dawn,
    // so Night N+1 starts with the cash. It is the Night summary's "carried" figure.
    const surplus = Math.max(0, this.debtPaid - due);
    this.debtPaid = 0;
    this.bankGranted = 0;
    if (surplus > 0) {
      this.ledger.carried += surplus;
      this.earn('coin', surplus, 'dawn:surplus');
    }
    this.stats.nightsPaid = (this.stats.nightsPaid ?? 0) + 1;
    this.syncQuota();
    this.nightDone = true;
    if (nightDef(this.index).no === BASE_RUN_NIGHTS) this.topside = true;
    this.spotlight.end();   // Machine of the Night: the Night is over, the spotlight and its x1.25 end
    // Night Cards: every paid Dawn with a Night after it (from Night 1 on) opens the two-card offer for that Night.
    if (!this.topside && this.nightCards.openOffer(this.index + 1)) this.emit('run:nightcard', { pid: this.selfId, state: 'offer', card: null });
    this.enter('intermission', 0);
    this.emit('quota:update', { quota: this.quota });
    this.persist();
  }

  /**
   * HOUSE TAKES NOTICE (wave 47, schedule.ts): the next Night's quota read with this Dawn's wealth (`houseWealth`, set by dawn()).
   * The toast names the quota only when the notice raised it above the plain ladder.
   */
  private houseNotice(): void {
    if (nightDef(this.index).no >= BASE_RUN_NIGHTS) return;   // no base Night follows the last one
    const opts = { discount: this.nextDiscount, holdings: this.tycoonSys.holdings(), assessRate: this.mod('x.tycoon.assessRate', RUN_MACHINE, 0.08) };
    const plain = quotaFor(this.index + 1, opts);
    const noticed = quotaFor(this.index + 1, { ...opts, wealth: this.houseWealth });
    if (noticed > plain) this.banner?.(t('run.house.notice', { n: Math.round(noticed) }), { color: '#ff7a5a', hold: 4, size: 16 });
  }

  private fall(): void {
    this.living = false;
    this.syncQuota();   // the quota the receipt reads is the bank's, as of this Dawn (wave 42, bug a)
    this.emit('quota:failed', { index: this.index });
    this.emit('player:fall', { pid: this.selfId });
    this.endRun('fell');
  }

  private postMortem(): NonNullable<RunSummary['post']> {
    // Wave 42 (bug a): "short" is the BANK against the quota, read here from the run's own books, never the pocket. A run that
    // fell at Dawn must print how far the bank was from the quota, not a "quota met" line.
    this.syncQuota();
    const due = Math.max(0, Math.floor(this.quota.due));
    let topCharm: string | null = null;
    let best = 0;
    for (const s of this.charmBox.list(this.selfId)) {          // owned order: ties go to the earliest
      const n = this.charmBox.procs.get(s.id) ?? 0;
      if (n > best) { best = n; topCharm = s.id; }
    }
    return {
      short: Math.max(0, due - Math.floor(this.debtPaid)),
      pullsLeft: Number.isFinite(this.pullCount) ? this.pullCount : 0,
      bestMachine: this.bestMachine,
      topCharm,
    };
  }

  private endRun(result: RunSummary['result'], ending?: string): void {
    this.ended = true;
    this.rescue.hangUp();
    this.clock.stop();
    this.watchEv.end();
    this.enter('over', 0);
    if (this.quotaMode && (result === 'escaped' || (result as string) === 'won')) this.tycoonSys.recordWin(this.index + 1);
    const bonus = this.currencies.get('obol') ?? 0;   // Obols from Wash lockers and the Back Office (wave 24)
    const stake = this.stakeFx();
    const obols = this.quotaMode ? Math.round(this.runObols(result, ending) * this.obolMult * stake.obolMult) + (ending === 'descend' ? 0 : bonus) : undefined;
    const nightNo = this.index + 1;
    const day = this.dailyDayOf();
    const kit = this.config.kit ?? 'pauper';
    const cleared = this.quotaMode && isStakeClear(result, nightNo);
    const summary: RunSummary = {
      mode: this.mode, seed: this.seed, result, floor: this.index + 1, deadlines: this.index + 1, maxWallet: this.maxWallet,
      rounds: this.rounds, biggestWin: this.biggest, durationSec: Math.round(this.elapsed),
      players: [{ id: this.selfId, name: '', placement: 1, wallet: this.coins }],
      stats: { ...this.stats },
      ...(ending ? { ending } : {}),
      ...(obols !== undefined ? { obols } : {}),
      // Stakes and the daily tag: the receipt reads them (results.ts); RunSummary has no fields for them yet.
      ...(this.quotaMode ? { stake: stake.stake } : {}),
      ...(day !== null ? { daily: { date: day, night: nightNo } } : {}),
      post: this.postMortem(),
    };
    this.emit('run:end', { summary });
    if (this.save) {
      // Descend banked its Obols (and the descent count) in the tycoon's prestige; every other ending banks them here.
      const banked = ending === 'descend' ? (bonus > 0 ? this.bankObols(bonus) : null) : this.bankObols(obols ?? 0);
      this.save.update((d) => {
        d.resume = null;
        d.history = [...d.history, summary].slice(-20);
        if (banked) d.meta = banked;
        if (cleared) d.stakeCleared = recordStakeClear(d.stakeCleared, kit, stake.stake);
        if (day !== null) {
          const rec: DailyBest = { date: day, seed: this.seed, kit, night: nightNo, obols: obols ?? 0, result };
          if (dailyBetter(d.dailyBest?.[day], rec)) d.dailyBest = { ...(d.dailyBest ?? {}), [day]: rec };
        }
      });
      this.save.flush();
    }
    this.notify();
  }

  /**
   * Obols for this ending (GDD §11.2): a fall pays ×0.5, Descend ×1.0, Topside STAY UP ×1.5, abandoning ×0.25, on the
   * run's total deposited (so it grows with every Night paid) and the Foundations gain.
   */
  private runObols(result: RunSummary['result'], ending?: string): number {
    const outcome: ObolOutcome = ending === 'descend' ? 'descend' : result === 'fell' ? 'fell' : result === 'escaped' ? 'topside' : 'quit';
    const prestige = this.tycoonSys.prestige;
    if (outcome === 'descend') return prestige.preview().obols;
    return obolsFor({ deposited: this.stats.deposited ?? 0, outcome, gain: prestige.preview().multiplier });
  }

  /** Adds Obols to the tycoon's meta (so a later `persistMeta` keeps them) and returns the copy for the save. */
  private bankObols(obols: number): MetaState {
    const meta = this.tycoonSys.prestige.state() as MetaState;
    meta.obols += Math.max(0, obols);
    meta.bestShift = Math.max(meta.bestShift, this.index);
    return { ...meta, nodes: { ...meta.nodes }, unlocked: [...meta.unlocked] };
  }

  // ─â”€ THE CIRCUIT: Tilt and Lamps (GDD §3.4) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
  /** The Circuit only applies inside a timed quota Watch (not in the Free Casino, not between Watches). */
  private circuitLive(): boolean { return this.quotaMode && this.rules.timed && this.inWatch(); }

  private tiltGrace(machineId: MachineId, mid: InstanceId, q: ModQuery): number {
    let g = this.mod('x.tilt.grace', machineId, 0, q) + this.stakeFx().tiltGrace;
    const first = this.circ.firstPlayed();
    if (first !== null && first !== mid) {
      g -= RED_THREAD_GRACE * (this.charmBox.list(this.selfId).find((c) => c.id === 'red_thread')?.stacks ?? 0);
    }
    return Math.round(g);
  }

  /** Tilt state of one instance now (shared by the payout fold and the views). */
  private tiltOf(machineId: MachineId, mid: InstanceId, q: ModQuery): TiltView {
    const plays = this.circ.playsOf(mid);
    const hot = this.circ.isHot(mid);
    const cold = this.circ.isCold(mid);
    // Tilt Switch: the most played instance ignores Tilt, every other one tilts harder
    const switchOn = this.mod('x.tilt.ignoreMostPlayed', machineId, 0, q) > 0;
    const ignored = hot || (switchOn && this.circ.mostPlayed() === mid);
    const grace = this.tiltGrace(machineId, mid, q);
    const step = ignored ? 0 : tiltStep(plays, grace);
    return {
      plays, hot, cold, step,
      lit: ignored ? 4 : tiltBulbs(plays, grace),
      factor: ignored ? 1 : tiltFactor(plays, grace, switchOn),
      lamp: hot ? this.hotMult(machineId, q) : cold ? this.coldMult(machineId, q) : 1,
    };
  }

  /** Hot Lamp factor: Hot Coal sets it to ×2.0, Warm Lamps (Foundations H4) scale it. */
  private hotMult(machineId: MachineId, q: ModQuery): number {
    let scale = 1;
    for (const s of this.explain('x.lamp.hot', machineId, 1, q).steps) if (s.op === 'mult') scale *= s.value;
    return this.mod('x.lamp.hotMult', machineId, HOT_MULT, q) * scale;
  }

  /** Cold Lamp factor: Cold Hands sets it to ×1.00. */
  private coldMult(machineId: MachineId, q: ModQuery): number {
    return this.mod('x.lamp.coldMult', machineId, COLD_MULT, q);
  }

  /** Lamp and Tilt factor (M) for one play. Hot ×1.5 ignores Tilt; Cold ×0.75 still tilts. */
  private circuitFactor(machineId: MachineId, q: ModQuery): number {
    const mid = q.instance;
    if (mid === undefined || (q.pid !== undefined && q.pid !== this.selfId) || !this.circuitLive()) return 1;
    const v = this.tiltOf(machineId, mid, q);
    return v.lamp * v.factor;
  }

  /** The Circuit's mod source: `payout.mult` ×(Lamp × Tilt) through `modify`, plus Red Thread's +10 % (A) on the first instance. */
  private makeCircuitProvider(): ModProvider {
    const base: ModSource = {
      kind: 'house', id: 'circuit', owner: 0, effects: [],
      modify: (hook, machineId, value, q) => (hook === 'payout.mult' ? value * this.circuitFactor(machineId, q) : value),
    };
    return {
      kind: 'house',
      collect: (q, out) => {
        if (q.instance === undefined || !this.circuitLive()) return;
        out.push(base);
        if (q.instance !== this.circ.firstPlayed()) return;
        const owned: ModSource[] = [];
        this.charmBox.collect(q, owned);
        const effs: ModEffect[] = [];
        for (const s of owned) {
          for (const e of s.effects) {
            if (e.hook === 'x.red.firstPlay') effs.push({ hook: 'payout.mult', op: e.op, value: stackedValue(e, s.stacks ?? 1) });
          }
        }
        if (effs.length) out.push({ kind: 'house', id: 'circuit:first', owner: 0, effects: effs });
      },
    };
  }

  private makeCircuitView(): CircuitView {
    return {
      active: () => this.circuitLive(),
      tilt: (mid) => {
        const machineId = this.tiltMachine(mid);
        return machineId === null ? null : this.tiltOf(machineId, mid, { pid: this.selfId, instance: mid });
      },
      lamps: () => this.lampView(),
    };
  }

  private lampView(): LampView {
    return lampViewOf(this.circ.hot(), this.circ.cold(), (mid) => this.circ.machineOf(mid), this.circ.pocketShort());
  }

  private emitLamps(): void {
    bus.emit('circuit:lamps', { ...this.lampView(), night: this.night(), watch: this.watch + 1 });
    if (this.seatedMid !== null) this.emitTilt(this.seatedMid);
  }

  /** The machine id of an instance whose Tilt is tracked right now: a floor machine (not system or party) in a live Watch, else null. */
  private tiltMachine(mid: InstanceId): MachineId | null {
    if (!this.circuitLive()) return null;
    const id = this.circ.machineOf(mid) || this.worldLink?.machines().find((m) => m.instance === mid)?.machineId || '';
    const cat = id ? registry.get(id)?.def.category : undefined;
    return cat === undefined || cat === 'system' || cat === 'party' ? null : id;
  }

  /** Tells the seat HUD the Tilt state of an instance (null = no Tilt there). */
  private emitTilt(mid: InstanceId): void {
    const machineId = this.tiltMachine(mid);
    const tilt = machineId === null ? null : this.tiltOf(machineId, mid, { pid: this.selfId, instance: mid });
    bus.emit('circuit:tilt', { pid: this.selfId, mid, machineId: machineId ?? '', tilt });
  }

  /** A round opened on `mid`: the pulls it cost count toward Tilt (a free action does not tilt). */
  private countTilt(mid: InstanceId, machineId: MachineId, pulls: number): void {
    if (!this.circuitLive() || pulls <= 0) return;
    this.circ.note(mid, machineId);
    this.circ.addPlays(mid, pulls);
    this.emitTilt(mid);
  }

  /** Bell: seeded Lamp roll (stream `lamps`). Lamps start at Night 2; Night 1 only has Tilt. */
  /** The machines on the floor with their suit tags, for the Pawn's first-shop synergy guarantee. */
  private floorMachines(): { machineId: string; tags: readonly string[]; category?: string }[] {
    const out: { machineId: string; tags: readonly string[]; category?: string }[] = [];
    for (const m of this.worldLink?.machines() ?? []) {
      const def = registry.get(m.machineId)?.def;
      if (!def || def.category === 'system' || def.category === 'party') continue;
      out.push({ machineId: m.machineId, tags: [...(scopeTags(m.machineId, def.tags) ?? [])], category: def.category });
    }
    return out;
  }

  /** Machines that may take a Lamp at the current pocket (readable, minimum stake within `LAMP_MAX_MIN_BET_SHARE` of it). */
  private lampCandidates(pocket: number = this.coins): LampCandidate[] {
    const cands: LampCandidate[] = [];
    for (const m of this.worldLink?.machines() ?? []) {
      if (this.worldLink?.locked?.(m.instance)) continue;
      const def = registry.get(m.machineId)?.def;
      const cat = def?.category;
      if (cat === undefined || cat === 'system' || cat === 'party') continue;
      // The duel tables (Hollow Door lords, TALLY rivals) live behind doors and story beats: a Lamp there is unreachable.
      if (m.machineId === 'lordstable' || m.machineId === 'tallytable') continue;
      if (this.tycoonSys.staffAt(m.instance).length > 0) continue;        // staffed machines never take a Lamp
      const c: LampCandidate = { mid: m.instance, machineId: m.machineId, minBet: def?.minBet ?? 0 };
      if (lampEligible(c, pocket)) cands.push(c);
    }
    return cands;
  }

  private rollLamps(): void {
    if (!this.quotaMode) return;
    const cands = this.lampCandidates();
    const rng = createRng(hashSeed('lamps', this.seed, this.index, this.watch));
    const lamps = this.night() >= LAMP_FIRST_NIGHT;
    const lampFx = this.nightCards.fx();   // Night Cards: LAMP FESTIVAL sets 2 HOT and no COLD for its Night
    const hot = Math.max(0, (lampFx.hotLamps ?? hotLampCount(this.night())) + Math.round(this.mod('x.lamp.hotCount', RUN_MACHINE, 0)));
    const cold = lampFx.noColdLamps ? 0 : coldLampCount(this.night(), Math.round(this.mod('x.lamp.coldCount', RUN_MACHINE, 0)) + this.stakeFx().coldLamps);
    // No candidate can take a Lamp at this pocket, though some readable machine would: the banner says the pocket is too low.
    const pocketShort = lamps && hot + cold > 0 && cands.length === 0 && this.lampCandidates(Number.POSITIVE_INFINITY).length > 0;
    this.circ.startWatch(rng, cands, {
      lamps, hot, cold,
      newIsHot: this.mod('x.lamp.hot', RUN_MACHINE, 0) > 0,                // Grand Opening Ribbon: machines new this Watch are Hot
      pocketShort,
    });
    this.emitLamps();
  }

  /** Settle: Tilt resets, the Lamps go dark. */
  private settleCircuit(): void {
    this.circ.settle();
    this.emitLamps();
  }

  // ─â”€ quota and debt ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  private recomputeQuota(): void {
    if (!this.quotaMode) { this.quota.due = 0; this.syncQuota(); return; }
    const nd = nightDef(this.index);
    const holdings = this.tycoonSys.holdings();
    const rate = this.mod('x.tycoon.assessRate', RUN_MACHINE, 0.08);
    const due = this.dueOf(this.index, {
      discount: this.discount, holdings, rate, wealth: this.houseWealth, loan: this.loanQuota,
      mult: this.mod('quota.mult', RUN_MACHINE, 1), add: this.mod('quota.add', RUN_MACHINE, 0), night8: this.mod('x.quota.night8', RUN_MACHINE, 1),
    });
    this.quota.base = nd.base;
    this.quota.assessment = assessmentFor(this.index, holdings, rate);
    this.quota.due = due;
    this.metFired = false;
    this.syncQuota();
  }

  /**
   * The one quota formula (recomputeQuota and nextQuotaPreview share it): the ladder with the discount, Assessment and House
   * notice (`quotaFor`), × the quota multiplier and the stake, + the quota adds and any rescue loans, the Night 8 multiplier,
   * and 0 for a Night a Lord's writ forgave.
   */
  private dueOf(index: number, p: { discount: number; holdings: number; rate: number; wealth: number; loan: number; mult: number; add: number; night8: number }): number {
    let due = quotaFor(index, { discount: p.discount, holdings: p.holdings, assessRate: p.rate, wealth: p.wealth });
    due = Math.round(due * p.mult * this.stakeFx().quotaMult);   // stake 2 (×1.08) rides with the quota mods
    due = Math.max(0, Math.round(due + p.add + p.loan));
    if (index === BASE_RUN_NIGHTS - 1) due = Math.round(due * p.night8);
    if (index < this.forgiveUntil) due = 0;   // a Lord's writ forgave this Night (Hollow Door)
    return due;
  }

  /**
   * NEXT NIGHT (wave 55): the exact quota of the Night after the paid one, as recomputeQuota will read it when that Night opens:
   * the ladder with the next discount, Assessment and the House notice, the quota multipliers of the charms, and the card kept for
   * that Night. `extraMult` previews a card not yet kept (1 = none). In the Dawn collection the Night is still unpaid, so the numbers
   * are projected from the wealth the Dawn will read (`projected`); from the Dawn's payment on they are read as the run holds them.
   * `k` is the step from tonight's quota. Null while a Night is running, after the last base Night, or once the run has ended.
   */
  nextQuotaPreview(extraMult = 1): NextQuotaPreview | null {
    if (!this.quotaMode || this.ended || this.topside || nightDef(this.index).no >= BASE_RUN_NIGHTS) return null;
    const dawnNow = this.phase === 'collection' && !this.nightDone;
    if (!this.nightDone && !dawnNow) return null;
    const idx = this.index + 1;
    // The Dawn's own reads: the wealth it floors the quota with, and the discount its overshoot tiers would add (before the reset).
    let discount = this.nextDiscount;
    let wealth = this.houseWealth;
    if (dawnNow) {
      wealth = this.coins + this.debtPaid;
      const ratio = this.quota.due > 0 ? this.debtPaid / this.quota.due : 1;
      for (const tier of OVERSHOOT_TIERS) {
        if (ratio >= tier.ratio && !this.quota.claimed.some((c) => c.id === tier.id)) discount += tier.reward.nextQuotaDiscount ?? 0;
      }
      discount = Math.min(0.15, discount);
    }
    // Multipliers: every quota.mult of the mod pipeline except the paid Night's card (it ends with its Night), plus the card kept for
    // the next Night and the previewed one. The fold is the pipeline's own (foldEffects), so the clamp matches.
    const common = this.explain('quota.mult', RUN_MACHINE, 1).steps
      .filter((s) => !s.source.id.startsWith('nightcard.'))
      .map((s) => ({ op: s.op, value: s.value }));
    const kept = this.nightCards.keptFor(idx);
    const keptEffs = (kept?.effects ?? []).filter((e) => e.hook === 'quota.mult').map((e) => ({ op: e.op, value: e.value }));
    const mult = foldEffects('quota.mult', 1, [...common, ...keptEffs, { op: 'mult', value: extraMult }]);
    const holdings = this.tycoonSys.holdings();
    const rate = this.mod('x.tycoon.assessRate', RUN_MACHINE, 0.08);
    const due = this.dueOf(idx, {
      discount, holdings, rate, wealth, loan: 0,
      mult, add: this.mod('quota.add', RUN_MACHINE, 0), night8: this.mod('x.quota.night8', RUN_MACHINE, 1),
    });
    const tonight = this.quota.due;
    const k = tonight > 0 ? Math.round((due / tonight) * 10) / 10 : 1;
    return { night: nightDef(idx).no, due, k, projected: dawnNow };
  }

  private syncQuota(): void {
    const q = this.quota;
    q.deposited = this.debtPaid;
    q.perPlayer = { [this.selfId]: this.debtPaid };
    q.met = this.debtPaid >= q.due;
    q.overshoot = Math.max(0, this.debtPaid - q.due);
    q.ratio = q.due > 0 ? this.debtPaid / q.due : 0;
  }

  private checkMet(): void {
    if (this.metFired || !this.quotaMode || this.quota.due <= 0 || this.debtPaid < this.quota.due) return;
    this.metFired = true;
    this.emit('quota:met', { index: this.index, ratio: this.debtPaid / this.quota.due });
  }

  private grant(reward: RewardSpec): void {
    if (reward.currencies) {
      for (const [cur, n] of Object.entries(reward.currencies)) if (n > 0) this.earn(cur, n, reward.text ?? 'overshoot');
    }
    if (reward.buffs) {
      for (const b of reward.buffs) {
        this.buffSys.buffs.add(b.id, { pid: this.selfId, stacks: b.stacks, durationScale: b.durationScale, source: { kind: 'system', id: 'reward' } });
      }
    }
    if (reward.totems) {
      for (const id of reward.totems) {
        // a full hand (one hand totem at a time) loses the reward; the receipt line is the bounty text
        if (!this.itemSys.totems.grant(this.selfId, id)) log.warnOnce(`reward:totem:${id}`, 'run', `totem reward "${id}" not granted (hand full or unknown)`);
      }
    }
    if (reward.nextQuotaDiscount) this.nextDiscount = Math.min(0.15, this.nextDiscount + reward.nextQuotaDiscount);
    if (reward.charm) {
      const offer = reward.charm;
      if ('id' in offer) {
        this.charmBox.add(this.selfId, offer.id, this.pegs());
      } else {
        // "Choose 1 of 3": roll the candidates now, queue them, and let the UI call pickOverpay (auto-pick on timeout).
        const rarity = Array.isArray(offer.rarity) ? offer.rarity[0] : offer.rarity;
        const cands = choiceOffer(this.rng.fork(`overpay:${this.index}:${this.overpays.length}:${rarity}`), rarity, offer.of, (id) => this.charmBox.has(this.selfId, id), this.index);
        if (cands.length) this.overpays.push({ rarity, ids: cands.map((d) => d.id), left: OVERPAY_TIMEOUT_SEC });
      }
    }
    this.notify();
  }

  private pegs(): number {
    return Math.min(PEG_CAP_RUN, START.pegs + Math.max(0, Math.round(this.mod('x.pegs.add', RUN_MACHINE, 0))));
  }

  /** Tycoon trade is shut during Closing, Settle, Dawn Collection and after the run (GDD §3.7.1). */
  private tradeOpen(): boolean {
    return !(this.phase === 'closing' || this.phase === 'settle' || this.phase === 'collection' || this.phase === 'over');
  }

  // ─â”€ stake safety and the rescue call (wave 13) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  /** First press of a stake above half the pocket arms it and returns false; the same stake again within the window returns true. */
  private confirmStake(amount: number, src: EcoSource, minBet: number): boolean {
    if (!this.quotaMode || this.openRounds.has(src.mid)) return true;
    const arm = this.stakeArm;
    if (!stakeNeedsConfirm(amount, this.coins, minBet)) return true;
    if (arm && arm.mid === src.mid && arm.amount === amount && arm.left > 0) return true;
    this.clearStakeArm();
    this.stakeArm = { mid: src.mid, machineId: src.machineId, amount, left: STAKE_CONFIRM_SEC };
    this.emit('run:stakeConfirm', { pid: this.selfId, mid: src.mid, machineId: src.machineId, state: 'ask', amount, pocket: this.coins, seconds: STAKE_CONFIRM_SEC });
    return false;
  }
  private clearStakeArm(): void {
    const a = this.stakeArm;
    if (!a) return;
    this.stakeArm = null;
    this.emit('run:stakeConfirm', { pid: this.selfId, mid: a.mid, machineId: a.machineId, state: 'clear', amount: a.amount, pocket: this.coins, seconds: 0 });
  }
  /** The stake waiting for its second press at `mid`, with the seconds left, or null. The seat HUD can poll this. */
  pendingStake(mid: InstanceId): { amount: number; left: number } | null {
    const a = this.stakeArm;
    return a && a.mid === mid && a.left > 0 ? { amount: a.amount, left: a.left } : null;
  }

  private rescueWasLive = false;
  private rescueTook = false;
  /** Called from `tick`: arm timeout, rescue-call upkeep and the rescue scan (twice a second). */
  private tickSafety(dt: number): void {
    const a = this.stakeArm;
    if (a) { a.left -= dt; if (a.left <= 0) this.clearStakeArm(); }
    if (!this.quotaMode || this.ended) return;
    if (this.rescueCool > 0) this.rescueCool -= dt;
    if (this.rescue.active() && !this.canPlay()) this.rescue.hangUp();
    if (this.rescueWasLive && !this.rescue.active()) {
      if (!this.rescueTook) { this.rescueCool = 20; this.hollowRefused = true; this.emit('run:rescue', { pid: this.selfId, state: 'lapsed', coins: 0, quota: 0, due: this.quota.due }); }
      this.rescueTook = false;
    }
    this.rescueWasLive = this.rescue.active();
    this.rescueScan += dt;
    if (this.rescueScan >= 0.5) { this.rescueScan = 0; this.checkRescue(); this.checkHollowLoan(); }
  }

  /** The red seam: the pocket is empty and the House refuses the loan (the loans are used up, or the call went unanswered). */
  private checkHollowLoan(): void {
    if (!this.quotaMode || this.ended || !this.canPlay() || this.openRounds.size > 0 || this.hollow.status !== 'hidden') return;
    if (!this.hollowRefused && this.rescuesUsed < RESCUE_MAX_PER_NIGHT) return;
    if (!pocketDead(this.coins, this.cheapestBet()) || this.rescue.active()) return;
    if (this.quota.due <= 0 || this.debtPaid >= this.quota.due) return;
    this.hollowTrigger('loan');
  }

  /** Pocket at 0, Watches left, quota unmet and interest alone will not cover it: the phone rings with the Collector's loan. */
  private checkRescue(): void {
    if (!this.quotaMode || this.ended || !this.canPlay() || !pocketDead(this.coins, this.cheapestBet()) || this.openRounds.size > 0) return;
    if (this.rescue.active() || this.hotline.phone() !== null || this.rescueCool > 0 || this.rescuesUsed >= RESCUE_MAX_PER_NIGHT) return;
    const due = this.quota.due;
    if (due <= 0 || this.debtPaid >= due) return;
    if (this.isLastWatch() && (this.phase === 'lastCall' || this.clock.remaining <= this.lastCallSec)) return;
    const rate = this.liveRate();
    let d = this.debtPaid;
    // An empty pocket cannot make the pulls the activity clause asks for, so only a Watch that already has them still pays interest.
    // Later Watches cannot be counted on either: the pocket stays empty, so they would forfeit as well.
    if (this.watchPulls >= ACTIVITY_MIN_PULLS) d += interestFor(d, due, rate);
    if (d >= due) return;
    const loan = rescueTerms(due);
    if (this.rescue.ring(loan)) this.emit('run:rescue', { pid: this.selfId, state: 'ring', coins: loan.coins, quota: loan.quota, due });
  }

  private takeRescue(loan: RescueLoan): void {
    this.rescueTook = true;
    this.rescuesUsed += 1;
    this.rescueCool = 15;
    this.loanQuota += loan.quota;
    this.stats['rescue.loans'] = (this.stats['rescue.loans'] ?? 0) + 1;
    this.earn('coin', loan.coins, 'rescue');
    this.recomputeQuota();
    this.emit('run:rescue', { pid: this.selfId, state: 'taken', coins: loan.coins, quota: loan.quota, due: this.quota.due });
    this.emit('quota:update', { quota: this.quota });
    this.persist();
  }

  private refuse(reason: RunRefusal): false {
    this.refusal = reason;
    this.notify();
    return false;
  }

  /** Why the lever, the Bell or the settle cannot act in this phase (`lastRefusal()` names it). */
  private phaseRefusal(): RunRefusal {
    switch (this.phase) {
      case 'play': case 'lastCall': return 'watchRunning';
      case 'closing': return 'watchEnding';
      case 'bell': return 'belling';
      case 'settle': return 'settling';
      default: return 'noWatch';
    }
  }

  private notify(): void { this.listeners.forEach((fn) => fn()); }

  // ─â”€ the Hollow Door (src/game/hollow/rules.ts): the rules decide, the world shows it (`hollow:open`) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
  /** Opens the door for a trigger when the rules allow it. Returns true when the door changed. */
  hollowTrigger(trigger: DoorTrigger): boolean {
    if (this.ended || !this.quotaMode) return false;
    return this.setDoor(doorReveal(this.hollow, trigger));
  }
  hollowCanRing(): boolean {
    return !this.ended && this.quotaMode && this.night() >= DOOR_FIRST_NIGHT && this.hollow.status === 'hidden' && !this.hollow.phoneSpent;
  }
  hollowRing(): boolean { return !this.ended && this.setDoor(doorRing(this.hollow, { hour: PHONE_HOUR, minute: PHONE_MINUTE }, false)); }
  hollowAnswer(choice: 'godown' | 'hangup'): boolean { return this.setDoor(doorAnswer(this.hollow, choice)); }
  hollowEnter(): void { this.setDoor(doorEnter(this.hollow)); }
  hollowPick(lord: LordId): void { this.setDoor(pickLord(this.hollow, lord)); }
  hollowLeave(): void {
    let next = this.hollow.status === 'duel' ? doorFinish(this.hollow, 'left') : doorLeave(this.hollow);
    if (next.status === 'open' || next.status === 'ringing') next = doorDawn(next);   // an unused doorway that timed out
    this.setDoor(next);
  }
  hollowFinish(ended: DuelEnd): void { if (this.hollow.status === 'duel') this.setDoor(doorFinish(this.hollow, ended)); }

  /** Stores the door's next state. A new doorway emits `hollow:open` (the world builds it) and counts as seen. */
  private setDoor(next: DoorState): boolean {
    if (next === this.hollow) return false;
    const opened = next.status === 'open' && this.hollow.status !== 'open';
    this.hollow = next;
    if (opened) {
      this.emit('hollow:open', { reason: next.trigger === 'knock' ? 'crack' : next.trigger === 'phone' ? 'phone333' : 'seam' });
      this.save?.update((d) => { d.hollowSeen = (d.hollowSeen ?? 0) + 1; });
    }
    this.persist();
    return true;
  }

  // Run effects of a Lord's duel (applyEffects in src/game/hollow/rules.ts)
  forgiveQuota(nights: number): void {
    if (!this.quotaMode || this.ended) return;
    this.forgiveUntil = Math.max(this.forgiveUntil, this.index + Math.max(1, Math.floor(nights)));
    this.recomputeQuota();
    this.checkMet();
    this.emit('quota:update', { quota: this.quota });
    this.toast(nights > 1 ? 'hollowrun.forgiven.2' : 'hollowrun.forgiven.1');
    this.persist();
  }
  takeRun(): void {
    if (this.ended) return;
    this.toast('hollowrun.taken');
    this.living = false;
    this.endRun('fell', 'taken');   // a taken run ends below; its Obols are banked ×obolMult
  }
  restoreSoulMark(): void {
    if (this.ended) return;
    this.soulMarkCount = Math.min(SOUL_MARKS_PER_RUN, this.soulMarkCount + 1);
    this.marksChanged(false);
    this.toast('hollowrun.soulRestored');
  }
  hollowBankObols(mult: number): void {
    this.obolMult *= Math.max(0, mult);
    this.toast('hollowrun.banked');
    this.persist();
  }
  private toast(key: string): void { this.banner?.(t(key), { color: '#c9a0ff', hold: 3, size: 8 }); }
  /** A bank movement the player should read (deposit, phone credit): the same banner as the pulls, in the bank's gold. */
  private bankNote(key: string, vars: Record<string, number>): void { this.banner?.(t(key, vars), { color: '#e8d27a', hold: 3, size: 8 }); }
  /** Every pull grant says what it was: "+N pulls · reason" (wave 38). Losses and unknown counts stay silent. */
  private pullToast(n: number, reason: 'phone' | 'bought' | 'watch'): void {
    if (!this.banner || !Number.isFinite(n) || n <= 0) return;
    this.banner(t('pulls.grant', { n: Math.floor(n), reason: t(`pulls.r.${reason}`) }), { color: '#9fe8ff', hold: 3, size: 8 });
  }

  /** Emit on the bus, then let owned charms react to the same event. */
  private emit<K extends keyof GameEvents>(key: K, payload: GameEvents[K]): void {
    bus.emit(key, payload);
    this.charmBox.dispatch(key, payload);
    this.modsImpl.touch(); // charm `on` handlers write their data bags
  }

  // ─â”€ shift API ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
  private makeShiftApi(): ShiftApi {
    const run = this;
    return {
      state: () => run.shiftState,
      get phase() { return run.phase; },
      timeLeft: () => run.timeLeft(),
      quota: () => run.quota,
      quotaFor: (i: number) => quotaFor(i, { discount: run.discount, holdings: run.tycoonSys.holdings(), assessRate: run.mod('x.tycoon.assessRate', RUN_MACHINE, 0.08) }),
      overshootTiers: () => OVERSHOOT_TIERS,
      extend: (sec: number) => { run.clock.extend(sec); run.persist(); },
      settleEarly: () => run.settleEarly(),
      rules: () => run.activeRules,
      registerRule: (def: ShiftRuleDef): Unsub => {
        run.ruleDefs.set(def.id, def);
        return () => { run.ruleDefs.delete(def.id); };
      },
      ruleDef: (id: string) => run.ruleDefs.get(id),
    };
  }

  // ─â”€ jackpots ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  private makeJackpotsApi(): JackpotsApi {
    const run = this;
    return {
      list: () => [...run.pools.values()],
      get: (id: string) => run.pools.get(id),
      value: (id: string) => run.pools.get(id)?.value ?? 0,
      chance: (_machineId: MachineId, _bet: number, tier: WinTier) => (WIN_TIERS.indexOf(tier) >= WIN_TIERS.indexOf('huge') ? 0.05 : 0.002),
      add: (id: string, amount: number) => run.feedJackpot(id, amount),
      claim: (id: string, src: EcoSource) => run.claimJackpot(id, src),
      onChange: (fn: (p: JackpotPool) => void): Unsub => {
        run.poolListeners.add(fn);
        return () => { run.poolListeners.delete(fn); };
      },
    };
  }

  private feedJackpot(id: string, amount: number): void {
    const p = this.pools.get(id);
    if (!p || amount <= 0) return;
    p.value += amount;
    this.poolChanged(p);
  }

  private claimJackpot(id: string, src: EcoSource): number {
    const p = this.pools.get(id);
    if (!p) return 0;
    const paid = Math.floor(p.value * this.mod('jackpot.mult', src.machineId, 1));
    p.lastWin = { pid: this.selfId, amount: paid, at: Math.round(this.elapsed * 1000), mid: src.mid, machineId: src.machineId };
    p.value = p.seed;
    this.coins += paid;
    this.emit('jackpot:win', { pool: id, pid: this.selfId, amount: paid, mid: src.mid, machineId: src.machineId });
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: paid, reason: `jackpot:${id}` });
    this.poolChanged(p);
    this.persist();
    return paid;
  }

  private poolChanged(p: JackpotPool): void {
    this.emit('jackpot:change', { pool: p.id, value: p.value });
    this.poolListeners.forEach((fn) => fn(p));
    this.notify();
  }

  // ─â”€ wave 8: Pawn Window, boss Nights, starting kits, Tell Sheet ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  private makePawn(): Pawn {
    return new Pawn({
      selfId: this.selfId,
      rng: () => this.rng,
      // After the Night is paid (Dawn, before OPEN THE FLOOR) the shelf already shows the NEXT Night's stock, priced at today's SI;
      // opening the floor keeps it (same key), so the Pawn restocks on every Night rollover instead of repeating the last Watch's shelf.
      night: () => (this.nightDone && !this.topside ? this.index + 1 : this.index),
      watch: () => (this.nightDone && !this.topside ? 0 : this.watch),
      floor: () => this.floorMachines(),
      open: () => this.shopOpen(),
      // Stake 1 (×1.10): the Pawn scales its price by SI, so the stake rides on SI (the shelf's 60 % quota ceiling still caps Commons).
      si: () => nightDef(this.index).si * this.stakeFx().pawnPriceMult,
      quota: () => nightQuota(this.nightDone && !this.topside ? this.index + 1 : this.index),
      held: () => this.charmBox.list(this.selfId).map((s) => s.id),
      canTake: (id) => {
        const s = this.charmBox.find(this.selfId, id);
        return !s || (s.stacks ?? 1) < (charmDef(id)?.maxStacks ?? 1);
      },
      pegsFree: () => this.pegs() - this.charmBox.pegsUsed(this.selfId),
      wallet: () => this.coins,
      tickets: () => this.tickets,
      rerollSurcharge: () => this.stakeFx().rerollTickets,
      spendTickets: (n, why) => {
        // Stake 4: each paid Pawn reroll costs one Ticket more (the shelf's rerollCost label adds it via rerollSurcharge).
        const cost = n + (why === 'pawn:reroll' ? this.stakeFx().rerollTickets : 0);
        if (cost < 0 || this.tickets < cost) return false;
        this.tickets -= cost;
        this.notify();
        this.persistSoon();
        return true;
      },
      mod: (hook, base) => this.mod(hook, RUN_MACHINE, base),
      freeRerolls: () => this.freeRerolls,
      useFreeReroll: () => {
        if (this.freeRerolls <= 0) return false;
        this.freeRerolls -= 1;
        this.notify();
        return true;
      },
      buyCharm: (id, price) => this.buyCharm(id, price),
      sellCharm: (id) => this.sellCharm(id),
      sellValue: (id) => this.sellValue(id),
      removeCurse: (id) => {
        const ok = this.charmBox.remove(this.selfId, id);
        if (ok) { this.notify(); this.persist(); }
        return ok;
      },
      discount: () => Math.min(0.9, Math.max(0, this.mod('shop.discount', RUN_MACHINE, 0))),
      discountSlot: () => Math.min(0.9, Math.max(0, this.mod('x.shop.discountSlot', RUN_MACHINE, 0))),
      meta: (code) => {
        const d = this.save?.data;
        if (!d) return false;
        if (code.startsWith('A:')) return d.achievements.includes(code.slice(2));
        return d.meta.unlocked.includes(code);
      },
      mostPlayed: () => {
        let best = '';
        let n = 0;
        for (const [id, c] of this.plays) if (c > n || (c === n && best !== '' && id < best)) { best = id; n = c; }
        if (!best) return null;
        const def = registry.get(best)?.def;
        return { machineId: best, tags: [...(scopeTags(best, def?.tags) ?? [])], category: def?.category };
      },
      explain: (machineId) => this.explain('payout.mult', machineId, 1, { pid: this.selfId }),
    });
  }

  /** Symbol Stamps (Pawn STAMPS tab): the same Night / Watch offset as the Pawn, priced off the Night's base quota. */
  private makeStamps(): StampBook {
    return new StampBook({
      rng: () => this.rng,
      night: () => (this.nightDone && !this.topside ? this.index + 1 : this.index),
      watch: () => (this.nightDone && !this.topside ? 0 : this.watch),
      open: () => this.shopOpen(),
      baseQuota: () => nightDef(this.nightDone && !this.topside ? this.index + 1 : this.index).base,
      quota: () => nightQuota(this.nightDone && !this.topside ? this.index + 1 : this.index),
      wallet: () => this.coins,
      tickets: () => this.tickets,
      spend: (c, reason) => {
        if (c < 0 || this.coins < c) return false;
        this.coins -= c;
        this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -c, reason });
        this.notify();
        this.persistSoon();
        return true;
      },
      spendTickets: (n) => {
        if (n < 0 || this.tickets < n) return false;
        this.tickets -= n;
        this.notify();
        this.persistSoon();
        return true;
      },
      touch: () => this.modsImpl.touch(),
      patternUnlocked: (id) => {
        if (id !== 'TWIN_RAILS' && id !== 'CORNERSTONE') return true;
        return this.mod('x.bigone.extraPattern', 'bigone', 0) >= 1 || this.tycoonSys.hasFeature('bigone', 'bigone.extraPattern.' + id);
      },
    });
  }

  /** Foundations V1 / V2: start pocket and start Tickets, added on top of the base or the kit. Debt run only. */
  private applyMetaStart(): void {
    if (!this.quotaMode) return;
    const pocket = Math.max(0, Math.round(this.mod('x.start.pocket', RUN_MACHINE, START.pocket)) - START.pocket);
    const tickets = Math.max(0, Math.round(this.mod('x.start.tickets', RUN_MACHINE, START.tickets)) - START.tickets);
    if (pocket <= 0 && tickets <= 0) return;
    this.coins += pocket;
    this.maxWallet = Math.max(this.maxWallet, this.coins);
    this.tickets = Math.min(TICKET_CAP, this.tickets + tickets);
    this.persist();
  }

  /** Kit from `RunConfig.kit` (debt run start): wallet, Tickets, charms and the pre-deposit toward the first quota. */
  private applyStartKit(): void {
    const kit = this.quotaMode && this.config.kit ? kitById(this.config.kit) : undefined;
    if (!kit) return;
    this.coins = kit.coins;
    this.maxWallet = kit.coins;
    this.tickets = 0;
    const got = applyKit(this, kit, this.selfId);
    if (got && got.predeposit > 0) {
      this.debtPaid += got.predeposit;
      this.bankGranted += got.predeposit;
      this.stats.deposited = (this.stats.deposited ?? 0) + got.predeposit;
    }
    this.syncQuota();
    this.persist();
  }

  /** The Night's boss (null off boss Nights and outside the debt run). */
  private bossToday(): BossNight | null {
    return this.quotaMode ? this.bossOn(this.night()) : null;
  }

  /** The boss of a Night (1-based): the seed's boss, or the stake-6 boss on Night 5. */
  private bossOn(night: number): BossNight | null {
    return bossFor(this.seed, night) ?? stakeBossFor(this.seed, night, this.stakeLevel());
  }

  /** The stake this run plays (cfg.stake, clamped). */
  private stakeLevel(): number { return clampStake(this.config.stake); }

  /** Effects of this run's stake (stakes.ts). Read at every place a stake changes a number. */
  private stakeFx(): StakeEffects { return stakeEffects(this.stakeLevel()); }

  /** The UTC day of a daily run, or null. Kept in the config, so a resumed daily run keeps its day. */
  private dailyDayOf(): string | null {
    const c = this.config as RunConfig & { dailyDay?: unknown };
    return c.daily && isDayKey(c.dailyDay) ? c.dailyDay : null;
  }

  /** Registers the Night's boss and zeroes the random event chance on boss Nights. */
  private prepareBoss(): void {
    const boss = this.bossToday();
    this.buffSys.nightEvents.setChance(boss ? 0 : this.baseEventChance);
    if (!boss) return;
    registerBossStrings();
    this.buffSys.nightEvents.register(boss);
    if (this.inWatch()) this.ensureBoss();
    this.openBossVenue();
  }

  /** Boss active for this Watch. Must run before `startWatch` reads the clock and pull mods. */
  private ensureBoss(): void {
    const boss = this.bossToday();
    if (!boss) return;
    registerBossStrings();
    const ne = this.buffSys.nightEvents;
    ne.setChance(0);
    ne.register(boss);
    if (!ne.isActive(boss.id)) ne.trigger(boss.id);
  }

  // ─â”€ special rooms (wave 24, docs/WAVE24_PLAN.md section 2) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  /** Dawn after a paid Night: Wing Keys (Nights 1-6, bosses 3/6/8), the Manager's Key (Night 6 boss), and the Parlour after Night 3. */
  private grantKeys(): void {
    const night = this.night();
    const beaten = this.bossToday() !== null;
    const dawn = dawnKeys(night);
    const boss = bossKeys(night, beaten);
    if (dawn + boss > 0) {
      this.wingKeys += dawn + boss;
      bus.emit('room:keys', { n: dawn + boss, why: boss > 0 ? 'boss' : 'dawn' });
    }
    if (managerKeyDrop(night, beaten) && !this.managerKey) {
      this.managerKey = true;
      bus.emit('room:keys', { n: 1, why: 'manager' });
    }
    this.tycoonSys.onNightPaid(night);
    this.modsImpl.touch();
  }

  // ─â”€ wave 25: the Tally Bench (docs/WAVE25_TALLY.md) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
  private marksChanged(lost: boolean): void {
    const left = this.soulMarkCount;
    bus.emit('duel:marks', { left, lost, blank: left === 0 && this.markEscrow === 0 });
    this.persist();
    this.notify();
  }

  /** One Mark goes on the table. False when the card has none left. */
  private stakeMark(): boolean {
    if (this.soulMarkCount <= 0) return false;
    this.soulMarkCount -= 1;
    this.markEscrow += 1;
    this.marksChanged(false);
    return true;
  }

  /** The Mark on the table comes back (the duel was won or drawn). */
  private returnMark(): void {
    if (this.markEscrow <= 0) return;
    this.markEscrow -= 1;
    this.soulMarkCount = Math.min(SOUL_MARKS_PER_RUN, this.soulMarkCount + 1);
    this.marksChanged(false);
  }

  /** The Mark on the table is gone. At 0 the JackID reads BLANK: the cursed `blank_jackid` charm, a road to the void ending. */
  private loseMark(): void {
    if (this.markEscrow > 0) this.markEscrow -= 1;
    if (this.soulMarkCount === 0 && this.markEscrow === 0) {
      // a full peg board does not stop the BLANK card: the cursed charm takes one extra peg
      if (!this.charmBox.has(this.selfId, 'blank_jackid')) this.charmBox.add(this.selfId, 'blank_jackid', this.pegs() + 1);
    }
    this.marksChanged(true);
  }

  /** A Mark that is still on the table at Dawn (the duel never finished) goes back to the card. */
  private releaseMarkEscrow(): void {
    while (this.markEscrow > 0) this.returnMark();
  }

  /** The rival's themed Rare charm, once per rival per run; a second win (or a full board) pays an Obol instead. */
  private takePledge(rivalId: string): void {
    const theme = DUEL_PLEDGE[rivalId];
    if (theme && !this.pledged.has(rivalId) && !this.charmBox.has(this.selfId, theme) && this.grantCharm(theme)) {
      this.pledged.add(rivalId);
      this.banner?.(t('duelrun.pledge', { charm: t(`charm.${theme}.name`) }), { color: '#ffd060', hold: 4, size: 8 });
    } else this.earn('obol', 1, 'duel.pledge');
    this.persistSoon();
  }

  /** Which rival a table seats: the Parlour's table is Lucan (boss Night 3) or Orrin (boss Night 6), the Jade Room's Tamsin, the Boiler's Kuro, the Wash's Mimosa, the Counting Room's Vell (boss Night 8). */
  private duelEncounter(instanceId: string): { rivalId: string; night: number; boss: boolean } | null {
    const zone = instanceId.startsWith('PAR') ? 'parlour' : instanceId.startsWith('CARD') ? 'cards' : instanceId.startsWith('BOI') ? 'boiler'
      : instanceId.startsWith('LAU') ? 'laundry' : instanceId.startsWith('CNT') ? 'counting' : '';
    const night = this.night();
    if (zone === 'parlour') {
      // N3 Lucan, N6 Orrin (boss duels); any other Night the Parlour table seats Lucan as a side duel
      const bossRival = bossRivalFor(night);
      const rivalId = night === 6 && bossRival?.id === 'orrin' ? 'orrin' : 'lucan';
      return { rivalId, night, boss: this.quotaMode && bossRival?.id === rivalId };
    }
    if (zone === 'laundry') return { rivalId: 'mimosa', night, boss: false };
    if (zone === 'counting') return { rivalId: 'vell', night, boss: this.quotaMode && bossRivalFor(night)?.id === 'vell' };
    if (zone === 'cards') return { rivalId: 'tamsin', night, boss: false };
    if (zone === 'boiler') return { rivalId: 'kuro', night, boss: false };
    return null;
  }

  /** The Parlour opens when its boss rival arrives (Night 3), so the boss duel is never behind a closed grille. */
  private openBossVenue(): void {
    if (!this.quotaMode) return;
    const rival = bossRivalFor(this.night());
    if (rival && !this.tycoonSys.state().zones.includes(rival.zone as ZoneId)) this.tycoonSys.grantZone(rival.zone as ZoneId);
  }

  /** A duel opens (first sitting of the Night): the rival's intro scene, with the Rival's Terms on a boss Night. */
  private duelStarting(e: { rivalId: string; night: number; boss: boolean }): Promise<void> | void {
    if (!rivalById(e.rivalId as RivalId)) return;
    return playDuelScene(e.rivalId as RivalId, 'intro', this.seed, e.night);
  }

  /** A duel is settled: boss rewards, the Audit tax, then the rival's closing scene once the reveal is off screen. */
  private duelEnded(r: DuelEndReport): void {
    const rival = rivalById(r.rivalId as RivalId);
    if (r.boss && r.won && this.bossDuelNight !== r.night) {
      this.bossDuelNight = r.night;
      this.wingKeys += 1;
      bus.emit('room:keys', { n: 1, why: 'boss' });
      this.afterDuel(() => this.grant({
        currencies: { coin: 0, obol: 0, ticket: BOSS_REWARD.tickets },
        charm: { choose: 1, of: BOSS_REWARD.charmChoices, rarity: BOSS_REWARD.charmRarity }, text: 'boss',
      }));
      if (rival?.drops?.includes('manager_key') && !this.managerKey) {
        this.managerKey = true;
        bus.emit('room:keys', { n: 1, why: 'manager' });
      }
    }
    // N7 The Audit: the Clerk taxes a coin prize
    if (r.won && r.tier === 'coins' && r.net > 0 && this.night() === AUDIT_NIGHT) {
      const tax = Math.min(Math.floor(r.net * AUDIT_TAX), Math.floor(this.coins));
      if (tax >= 1 && this.spend('coin', tax, 'duel.audit')) this.afterDuel(() => this.banner?.(t('duelrun.tax', { n: String(tax) }), { color: '#d0d0d0', hold: 5, size: 8 }));
    }
    if (r.rivalId === 'vell' && r.calledCorrect === true) {
      // Vell's thrown match, called out: the Bench rules the count void and the lift opens for him (his 'won' scene is replaced)
      this.endingPathId = 'vell_release';
      this.afterDuel(() => { void import('./story/duels/ending').then((m) => m.playVellRelease()).then((): void => undefined, (): void => undefined); }, true);
    } else if (rival && !r.drew) {
      const beat = r.won ? 'won' : 'lost';
      this.afterDuel(() => { void playDuelScene(r.rivalId as RivalId, beat, this.seed, r.night); }, true);
    }
    this.persist();
    this.notify();
  }

  /** Runs `fn` once the duel presentation is off screen (a short beat after the settle, then idle). */
  private afterDuel(fn: () => void, scene = false): void {
    this.duelAfter.push({ wait: scene ? 1.5 : 1, left: 90, fn });
  }

  private tickDuelAfter(dt: number): void {
    const q = this.duelAfter;
    for (const it of q.slice()) {
      it.wait -= dt;
      it.left -= dt;
      if ((it.wait <= 0 && presentationIdle()) || it.left <= 0) {
        q.splice(q.indexOf(it), 1);
        try { it.fn(); } catch { /* a follow-up never stops the run */ }
        break;                                  // one at a time, so a scene never overlaps the next reward
      }
    }
  }

  private isBoiler(machineId: MachineId): boolean { return registry.get(machineId)?.def.zone === 'boiler'; }
  /** The Boiler blew: its machines take no bets until the next Watch. */
  private boilerShut(machineId: MachineId): boolean { return this.rooms.blown && this.quotaMode && this.isBoiler(machineId); }

  /** A round opened at a Boiler machine: pressure +5; at 100 the room blows. */
  private boilerRound(machineId: MachineId): void {
    if (!this.quotaMode || !this.isBoiler(machineId) || !this.tycoonSys.state().zones.includes('boiler')) return;
    const r = boilerPull(this.rooms);
    if (!r.ok) return;
    this.rooms = r.state;
    this.modsImpl.touch();
    announcePressure(this.rooms.p);
    if (r.blew) bus.emit('room:blown', { zone: 'boiler' });
    this.persistSoon();
    this.notify();
  }

  /** A new Watch: the Boiler cools and unlocks. */
  private coolBoiler(): void {
    if (this.rooms.p === 0 && !this.rooms.blown) return;
    this.rooms = boilerNextWatch(this.rooms);
    this.modsImpl.touch();
    announcePressure(0);
  }

  ventBoiler(): boolean {
    if (!this.tycoonSys.state().zones.includes('boiler') || !this.canPlay()) return false;
    const v = boilerVent(this.rooms);
    if (!v.ok) return false;
    if (!this.rules.unlimitedPulls) {
      if (this.pullCount >= v.pulls) {
        this.pullCount -= v.pulls;
        this.watchPulls += v.pulls;
        this.emit('pulls:change', { pid: this.selfId, pulls: this.pullCount });
        if (this.pullCount <= 0) this.enter('closing', closingSeconds(this.isLastWatch()));
      } else if (this.tickets >= PULL_PRICE_TICKETS) {
        this.tickets -= PULL_PRICE_TICKETS;
      } else return this.refuse('pulls');
    }
    this.rooms = v.state;
    this.modsImpl.touch();
    announcePressure(0);
    this.persistSoon();
    this.notify();
    return true;
  }

  /** Charms a Wash locker may hold: common and uncommon, unlocked by the Night, not held. */
  private lockerCharms(): string[] {
    const held = new Set(this.charmBox.list(this.selfId).map((c) => c.id));
    const night = this.night();
    const reached = (unlock: string | undefined): boolean => {
      if (!unlock) return true;
      const m = /^N(\d+)$/.exec(unlock);
      return m ? night >= Number(m[1]) : false;
    };
    return allCharmDefs()
      .filter((d) => (d.rarity === 'common' || d.rarity === 'uncommon') && d.price >= 0 && !held.has(d.id) && reached(d.unlock))
      .map((d) => d.id);
  }

  openLocker(n: number): LockerOpen {
    const fail = (reason: NonNullable<LockerOpen['reason']>): LockerOpen => ({ ok: false, reason, state: this.rooms, tickets: this.tickets, dread: 0 });
    if (this.ended || !this.tycoonSys.state().zones.includes('laundry')) return fail('range');
    const o = rollLocker(this.rooms, n, { seed: this.seed, night: this.night(), tickets: this.tickets, charms: this.lockerCharms() });
    this.rooms = o.state;
    if (!o.ok || !o.result) return o;
    this.tickets = o.tickets;
    let result: LockerResult = o.result;
    if (result.k === 'coins') this.earn('coin', result.n, 'locker');
    else if (result.k === 'blank') this.earn('obol', result.obols, 'locker');
    else if (result.k === 'charm' && !this.grantCharm(result.id)) {
      // a full peg board turns the charm into coins rather than losing the Ticket
      result = { k: 'coins', n: LOCKER.coinBase + LOCKER.coinPerNight * this.night() };
      this.earn('coin', result.n, 'locker');
    }
    if (o.dread > 0) this.addDread(o.dread, 'locker');
    announceLocker(n, result);
    this.persistSoon();
    this.notify();
    return { ...o, result };
  }

  backOffice(): { tickets: number; obols: number } {
    const b = backOffice(this.tickets);
    const spent = this.tickets - b.tickets;
    if (b.obols <= 0 || spent <= 0 || !this.spend('ticket', spent, 'backoffice')) return { tickets: 0, obols: 0 };
    this.earn('obol', b.obols, 'backoffice');
    bus.emit('room:backoffice', { tickets: spent, obols: b.obols });
    this.persistSoon();
    return { tickets: spent, obols: b.obols };
  }

  collectorBuy(charmId: string): boolean {
    if (this.ended || !this.tycoonSys.state().zones.includes('parlour') || this.night() < 3 || this.night() > 7) return false;
    if (!this.charmBox.has(this.selfId, charmId) || charmDef(charmId)?.rarity === 'cursed') return false;
    const price = collectorPrice(this.sellValue(charmId));
    if (!this.sellCharm(charmId)) return false;
    this.earn('obol', price, 'collector');
    return true;
  }

  /** Night paid on a boss Night: the boss ends; reward = choose 1 of 3 Rare charms + 3 Tickets. */
  private finishBoss(): void {
    const boss = this.bossToday();
    if (!boss) return;
    this.buffSys.nightEvents.end(boss.id);
    this.grant({ currencies: { coin: 0, obol: 0, ticket: BOSS_REWARD.tickets }, charm: { choose: 1, of: BOSS_REWARD.charmChoices, rarity: BOSS_REWARD.charmRarity }, text: 'boss' });
  }

  /** Dawn card: names tomorrow's boss (if the Night was paid and a boss follows). */
  private announceNextBoss(): void {
    if (!this.banner || !this.quotaMode || this.debtPaid < this.quota.due) return;
    const next = this.bossOn(this.night() + 1);
    if (!next) return;
    registerBossStrings();
    const p = { suit: (next.suit ?? '').toUpperCase(), name: t(`event.${next.id}.name`) };
    this.banner(t('boss.dawn.next', p), { color: '#ff7a5a', hold: 5, size: 16 });
    const terms = bossRivalFor(this.night() + 1) ? rivalTermsFor(this.seed, this.night() + 1) : null;
    // a rival's boss Night: the modifier is announced as the Rival's Terms, in the rival's name
    if (terms) this.banner(t('story.duel.terms.intro', termsVars(terms)), { color: '#ffd060', hold: 5, size: 8 });
    else this.banner(t(`event.${next.id}.announce`, p), { color: '#ffd060', hold: 5, size: 8 });
  }

  /** Tell Sheet: sends the seat HUD the odds line of the seat the player is in (only when it changed). */
  private refreshOdds(force = false): void {
    const mid = this.seatedMid;
    if (mid === null) return;
    const machineId = this.circ.machineOf(mid) || this.worldLink?.machines().find((m) => m.instance === mid)?.machineId || '';
    const def = machineId ? registry.get(machineId)?.def : undefined;
    let line: OddsLine | null = null;
    if (def && def.category !== 'system' && def.category !== 'party') {
      const bet = this.lastBet.get(mid) ?? this.betLimits(machineId, mid).min;
      const pace = this.quotaMode
        ? paceOf({ due: this.quota.due, deposited: this.debtPaid, pocket: this.coins, pullsLeft: Number.isFinite(this.pullCount) ? this.pullCount : 0 })
        : null;
      line = oddsLine(profileOf(machineId), pace, def.actionCost ?? 1, bet);
    }
    const key = JSON.stringify(line);
    if (key === this.oddsKey && !force) return;
    this.oddsKey = key;
    bus.emit('seat:odds', { pid: this.selfId, mid, line });
  }

  // ─â”€ save and resume ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
  snapshot(): RunSave {
    const pid = this.selfId;
    const ext: RunExt = {
      owned: [...this.owned], allIn: this.allInWatch,
      v: 1, index: this.index, watch: this.watch, watches: this.watches, overtimeIdx: this.overtimeIdx,
      phase: this.phase, phaseLeft: this.phaseLeft, nightDone: this.nightDone, topside: this.topside,
      metFired: this.metFired, ropeUsed: this.ropeUsed,
      clock: this.clock.snapshot(), clockLen: this.clockLen, lastCallSec: this.lastCallSec,
      pulls: this.pullCount, pullsMax: this.pullsMax, watchPulls: this.watchPulls, boughtThisWatch: this.boughtThisWatch,
      tickets: this.tickets, debtPaid: this.debtPaid, ledger: { ...this.ledger }, dreadPts: this.dreadPts,
      freeRerolls: this.freeRerolls, skipRest: this.skipRest,
      pawn: this.pawn.snapshot(), stamps: this.stamps.snapshot(), plays: Object.fromEntries(this.plays),
      discount: this.discount, nextDiscount: this.nextDiscount, elapsed: this.elapsed,
      maxWallet: this.maxWallet, biggest: this.biggest, rounds: this.rounds,
      rng: this.rng.getState(),
      overpays: this.overpays.map((o) => ({ rarity: o.rarity, ids: [...o.ids], left: o.left })),
      tycoon: JSON.parse(JSON.stringify(this.tycoonSys.state())) as Partial<TycoonState>,
      savedAt: Date.now(),
      buffs: this.buffSys.buffs.snapshot(),
      totems: this.itemSys.totems.snapshot(),
      contracts: {
        night: this.contractNight, seq: this.contractSeq, list: this.contractList.map((c) => ({ ...c })),
        base: Object.fromEntries(this.contractBase),
      },
      circuit: this.circ.snapshot(),
      hotline: this.hotline.snapshot(),
      rescue: { quota: this.loanQuota, used: this.rescuesUsed },
      watchDep: this.watchDeposits,
      watchFloat: this.watchFloatSnap ?? undefined,
      bank:{ granted: this.bankGranted, wd: this.watchWd, dep: this.watchDepCoins },
      wingKeys: this.wingKeys, managerKey: this.managerKey, rooms: { ...this.rooms, lockers: [...this.rooms.lockers] }, bonusObols: this.currencies.get('obol') ?? 0,
      soulMarks: this.soulMarkCount, markEscrow: this.markEscrow, bossDuel: this.bossDuelNight, pledged: [...this.pledged],
      ...(this.endingPathId ? { endingPath: this.endingPathId } : {}),
      hollow: { ...this.hollow }, forgiveUntil: this.forgiveUntil, houseWealth: this.houseWealth, obolMult: this.obolMult, hollowRefused: this.hollowRefused,
      ...(this.starter ? { starter: { ids: [...this.starter.ids], open: this.starter.open, left: this.starter.left } } : {}),
      ...(this.nightCards.snapshot() ? { nightCards: this.nightCards.snapshot() as NightCardSave } : {}),
      ...(this.watchEv.snapshot() ? { watchEvent: this.watchEv.snapshot() } : {}),
      ...(this.spotlight.snapshot() ? { spotlight: this.spotlight.snapshot() as SpotlightSave } : {}),
    };
    return {
      mode: this.mode, seed: this.seed, window: this.window(),
      debts: { [pid]: this.debt(pid) }, wallets: { [pid]: this.coins }, charms: this.charmBox.snapshot(),
      alive: { [pid]: this.living }, jackpots: { net: this.jackpot('net') },
      tier: this.index + 1, phone: this.phone(), stats: { ...this.stats },
      cfg: { ...this.config }, shift: { ...this.shiftState, rules: [...this.activeRules] },
      quota: { ...this.quota, perPlayer: { ...this.quota.perPlayer }, claimed: [...this.quota.claimed] },
      currencies: { ticket: { [pid]: this.tickets } }, dread: this.dread(),
      wingKeys: this.wingKeys, managerKey: this.managerKey, boiler: { p: this.rooms.p, blown: this.rooms.blown },
      ext,
    };
  }

  /** Boundary save (phase, deposit, purchase, quota, jackpot …): serialises now and clears the coalescing state. */
  private persist(): void {
    this.dirty = false;
    this.sinceFlush = 0;
    if (!this.save || this.ended) return;
    const snap = this.snapshot();
    this.save.update((d) => { d.resume = snap; });
  }

  /** Hot-path save (every win): only marks the run dirty. `tick` or `flush()` writes it, at most every SAVE_SOON_SEC. */
  private persistSoon(): void {
    if (this.save && !this.ended) this.dirty = true;
  }

  flush(): void {
    if (this.dirty) this.persist();
  }

  // ─â”€ overpay choice (GDD §2.6.5) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  overpayOffer(): OverpayOffer | null {
    const head = this.overpays[0];
    if (!head) return null;
    const candidates = head.ids.map((id) => charmDef(id)).filter((d): d is CharmDef => d !== undefined);
    return { rarity: head.rarity, candidates, left: head.left };
  }

  grantCharm(charmId: string): boolean {
    if (!charmDef(charmId)) return false;
    if (!this.charmBox.add(this.selfId, charmId, this.pegs())) return false;
    this.notify();
    this.persist();
    return true;
  }

  pickOverpay(charmId: string): boolean {
    const head = this.overpays[0];
    if (!head || !head.ids.includes(charmId)) return false;
    if (!this.charmBox.add(this.selfId, charmId, this.pegs())) return this.refuse('limit');
    this.overpays.shift();
    this.notify();
    this.persist();
    return true;
  }

  autoPickOverpay(): boolean {
    const head = this.overpays.shift();
    if (!head) return false;
    let took = false;
    for (const id of head.ids) {
      if (this.charmBox.add(this.selfId, id, this.pegs())) { took = true; break; }
    }
    this.notify();
    this.persist();
    return took;
  }

  // ─â”€ starter draft (draft wave) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
  openStarterDraft(): boolean {
    if (this.ended || !this.rules.timed || !this.quotaMode || this.starter) return false;
    // The session starts Watch 1 on load, so the offer opens at Night 1 before the first pull, in the intermission or in play.
    if (this.index !== 0 || this.watch > 1 || this.watchPulls > 0 || this.nightDone) return false;
    if (this.phase !== 'intermission' && this.phase !== 'play') return false;
    const ids = starterOffer(this.seed, (id) => this.charmBox.has(this.selfId, id));
    if (ids.length === 0) return false;
    this.starter = { ids, open: true, left: STARTER_TIMEOUT_SEC };
    this.notify();
    this.persist();
    return true;
  }

  starterDraft(): { candidates: CharmDef[]; left: number } | null {
    const s = this.starter;
    if (!s?.open) return null;
    return { candidates: s.ids.map((id) => charmDef(id)).filter((d): d is CharmDef => d !== undefined), left: s.left };
  }

  pickStarter(charmId: string): boolean {
    return this.takeStarter(charmId, 'picked');
  }

  // ─ Night Cards (director): the Dawn offer, the card kept for the next Night ─
  nightCardOffer(): { candidates: NightCardDef[]; left: number; night: number } | null { return this.nightCards.offerView(); }

  private nightCardGate = false;
  setNightCardGate(on: boolean): void { this.nightCardGate = on; }

  pickNightCard(cardId: string): boolean {
    if (!this.nightCards.pick(cardId)) return false;
    this.emit('run:nightcard', { pid: this.selfId, state: 'picked', card: cardId });
    this.notify();
    this.persist();
    return true;
  }

  nightCard(): NightCardDef | null { return this.nightCards.current(); }

  /** Machine of the Night (wave 55): this Night's spotlight for the HUD chip, or null. */
  spotlightView(): SpotlightView | null { return this.spotlight.current(); }

  /** Takes one starter charm (the player's pick, or the timer's first card that fits). Closes the offer. */
  private takeStarter(charmId: string, state: 'picked' | 'auto'): boolean {
    const s = this.starter;
    if (!s?.open || !s.ids.includes(charmId)) return false;
    if (!this.charmBox.add(this.selfId, charmId, this.pegs())) return state === 'picked' ? this.refuse('limit') : false;
    s.open = false;
    this.emit('run:draft', { pid: this.selfId, state, charm: charmId });
    this.notify();
    this.persist();
    return true;
  }

  /** The Bell waits for the starter draft: true while it is open. Its timer runs down here and takes the first card that fits. */
  private tickStarter(dt: number): boolean {
    const s = this.starter;
    if (!s?.open) return false;
    s.left -= dt;
    if (s.left > 0) return true;
    for (const id of s.ids) if (this.takeStarter(id, 'auto')) break;
    if (this.starter?.open) this.starter.open = false;
    return false;
  }

  /** The Settle's interest, said as a bank note: the amount (with the coin sound, `run:interest`), the rate, or why it paid nothing. */
  private interestNote(pid: PlayerId, earned: number, pct: number, shortBy: number): void {
    if (earned > 0) {
      this.bankNote('draft.interest', { n: earned, pct });
      this.emit('run:interest', { pid, amount: earned, pct });
    } else if (shortBy > 0) this.bankNote('draft.interest.short', { pct, k: shortBy });
    else this.bankNote('draft.interest.none', { pct });
  }

  /** Launch charm pool of one rarity (lootbox and claw prizes read it through `Reflect`). Unlock-gated charms are left out. */
  charmPool(rarity: string): Array<{ id: string; price: number; maxStacks?: number }> {
    return allCharmDefs()
      .filter((d) => d.rarity === rarity && !d.unlock)
      .map((d) => ({ id: d.id, price: Math.abs(d.price), maxStacks: d.maxStacks }));
  }

  // ─â”€ bounty board (ContractsApi, GDD §11.9) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
  private makeContractsApi(): ContractsApi {
    return {
      register: (def) => {
        this.contractDefs.set(def.id, def);
        return () => { if (this.contractDefs.get(def.id) === def) this.contractDefs.delete(def.id); };
      },
      defs: () => [...this.contractDefs.values()],
      board: () => {
        this.ensureOffers();
        return this.contractList.filter((c) => c.status === 'offered');
      },
      active: (pid) => {
        const who = pid ?? this.selfId;
        return this.contractList.filter((c) => c.owner === who && (c.status === 'active' || c.status === 'done'));
      },
      accept: (uid) => this.acceptContract(uid),
      abandon: (uid) => this.abandonContract(uid),
      claim: (uid) => this.claimContract(uid),
      roll: (n) => { this.rollContracts(n); this.notify(); },
    };
  }

  /** Draws the Night's offers once, the first time the board is read with defs registered. */
  private ensureOffers(): void {
    if (this.contractNight === this.index || this.contractDefs.size === 0 || this.ended) return;
    this.rollContracts(BOARD_OFFERS);
  }

  /** Replaces the unsigned offers with `n` weighted draws (no repeats, none the player already holds). */
  private rollContracts(n: number): void {
    this.contractList = this.contractList.filter((c) => c.status !== 'offered');
    const held = new Set(this.contractList.filter((c) => c.owner === this.selfId).map((c) => c.def));
    const r = this.rng.fork(`bounty:${this.index}:${++this.contractSeq}`);
    const pool = [...this.contractDefs.values()].filter((d) => !held.has(d.id) && (d.minShift ?? 0) <= this.index + 1);
    for (let i = 0; i < n && pool.length > 0; i++) {
      const total = pool.reduce((s, d) => s + (d.weight ?? 2), 0);
      let x = r.next() * total;
      let k = 0;
      while (k < pool.length - 1 && x >= (pool[k].weight ?? 2)) { x -= pool[k].weight ?? 2; k++; }
      const [d] = pool.splice(k, 1);
      this.contractList.push({
        uid: `k${this.index + 1}-${++this.contractSeq}`, def: d.id, owner: 0, status: 'offered', progress: 0, target: d.goal.count, streak: 0,
      });
    }
    this.contractNight = this.index;
    this.persistSoon();
  }

  private statGoal(c: ContractState): string | undefined {
    const d = this.contractDefs.get(c.def);
    return d?.goal.on === 'stat' ? d.goal.where?.stat : undefined;
  }

  private acceptContract(uid: string): boolean {
    const c = this.contractList.find((x) => x.uid === uid && x.status === 'offered');
    if (!c || this.ended) return false;
    const held = this.contractList.filter((x) => x.owner === this.selfId && (x.status === 'active' || x.status === 'done')).length;
    if (held >= CONTRACT_MAX_ACTIVE) return false;
    c.status = 'active';
    c.owner = this.selfId;
    const key = this.statGoal(c);
    if (key !== undefined) this.contractBase.set(c.uid, this.stat(key));
    this.persist();
    this.notify();
    return true;
  }

  private abandonContract(uid: string): boolean {
    const c = this.contractList.find((x) => x.uid === uid && x.owner === this.selfId && x.status === 'active');
    if (!c) return false;
    this.dropContract(c);
    this.persist();
    this.notify();
    return true;
  }

  /** Pays a finished slip: coins (absolute or quota fraction), then the grant bundle (tickets, buffs, totems, charm). */
  private claimContract(uid: string): boolean {
    const c = this.contractList.find((x) => x.uid === uid && x.owner === this.selfId && x.status === 'done');
    const d = c ? this.contractDefs.get(c.def) : undefined;
    if (!c || !d) return false;
    const rw = d.reward;
    if (rw.coins !== undefined) {
      const amt = typeof rw.coins === 'number' ? rw.coins : Math.round(this.quota.due * rw.coins.quotaFrac);
      this.earn('coin', amt, `contract:${d.id}`);
    }
    this.grant(rw);
    this.dropContract(c);
    this.persist();
    this.notify();
    return true;
  }

  private dropContract(c: ContractState): void {
    this.contractList = this.contractList.filter((x) => x !== c);
    this.contractBase.delete(c.uid);
  }

  /** Dawn: unsigned offers and unfinished slips expire (GDD §11.9). Finished slips stay until they are cashed. */
  private expireContracts(): void {
    for (const c of this.contractList) if (c.status === 'offered' || c.status === 'active') this.contractBase.delete(c.uid);
    this.contractList = this.contractList.filter((c) => c.status !== 'offered' && c.status !== 'active');
  }

  /** Counts run events toward signed slips whose goal is an event (not a stat). */
  private advanceContracts(on: ContractGoal['on'], ev: ContractEv): void {
    let changed = false;
    for (const c of this.contractList) {
      if (c.status !== 'active' || c.owner !== this.selfId) continue;
      const d = this.contractDefs.get(c.def);
      if (!d || d.goal.on !== on || d.goal.where?.stat !== undefined) continue;
      const w = d.goal.where ?? {};
      if (!contractMatches(w, ev)) {
        // a streak breaks on a non-matching result from the same machine
        if (d.goal.streak && w.machineId !== undefined && ev.machineId === w.machineId && c.progress > 0) {
          c.progress = 0;
          changed = true;
        }
        continue;
      }
      c.progress += d.goal.sum ? Math.max(0, ev[d.goal.sum] ?? 0) : 1;
      if (d.goal.streak) c.streak = c.progress;
      if (c.progress >= c.target) c.status = 'done';
      changed = true;
    }
    if (changed) { this.persistSoon(); this.notify(); }
  }

  /** Stat goals read the run counter minus the value at signing. */
  private syncStatContracts(key: string): void {
    let changed = false;
    for (const c of this.contractList) {
      if (c.status !== 'active' || c.owner !== this.selfId || this.statGoal(c) !== key) continue;
      const p = Math.max(0, this.stat(key) - (this.contractBase.get(c.uid) ?? 0));
      if (p === c.progress) continue;
      c.progress = p;
      if (p >= c.target) c.status = 'done';
      changed = true;
    }
    if (changed) { this.persistSoon(); this.notify(); }
  }

  private restore(s: RunSave): void {
    const e = s.ext;
    this.index = e.index; this.watch = e.watch; this.watches = e.watches; this.overtimeIdx = e.overtimeIdx;
    this.phase = e.phase; this.phaseLeft = e.phaseLeft; this.nightDone = e.nightDone; this.topside = e.topside;
    this.metFired = e.metFired; this.ropeUsed = e.ropeUsed;
    this.clock.restore(e.clock); this.clockLen = e.clockLen; this.lastCallSec = e.lastCallSec;
    this.pullCount = this.rules.unlimitedPulls ? Number.POSITIVE_INFINITY : e.pulls;
    this.pullsMax = e.pullsMax; this.watchPulls = e.watchPulls; this.boughtThisWatch = e.boughtThisWatch;
    // Legacy saves (before wave 41) kept the surplus that went back early in `released` on top of the bank: it already sits in the
    // pocket, so it comes off the bank here and Dawn returns only the rest.
    this.debtPaid = Math.max(0, e.debtPaid - Math.max(0, e.released ?? 0));
    this.tickets = e.tickets; this.dreadPts = e.dreadPts;
    this.owned = new Set(e.owned ?? []);
    this.allInWatch = e.allIn ?? -1;
    if (e.ledger) this.ledger = { cut: 0, carried: 0, ...e.ledger };
    this.freeRerolls = e.freeRerolls; this.skipRest = e.skipRest;
    if (e.pawn) this.pawn.restore(e.pawn);
    if (e.stamps) this.stamps.restore(e.stamps);
    this.plays.clear();
    for (const [id, n] of Object.entries(e.plays ?? {})) this.plays.set(id, n);
    this.discount = e.discount; this.nextDiscount = e.nextDiscount; this.elapsed = e.elapsed;
    this.maxWallet = e.maxWallet; this.biggest = e.biggest; this.rounds = e.rounds;
    this.rng.setState(e.rng);
    this.overpays = (e.overpays ?? []).map((o) => ({ rarity: o.rarity, ids: [...o.ids], left: o.left }));
    this.coins = s.wallets[this.selfId] ?? this.rules.startWallet;
    this.charmBox.restore(this.selfId, s.charms[this.selfId] ?? []);
    this.living = s.alive[this.selfId] ?? true;
    this.stats = { ...this.stats, ...s.stats };
    this.shiftState = { ...(s.shift ?? this.shiftState), rules: this.activeRules };
    const q = s.quota ?? this.shiftState.quota;
    this.quota = { ...q, perPlayer: { ...q.perPlayer }, claimed: [...q.claimed] };
    this.shiftState.quota = this.quota;
    this.shiftState.phase = this.phase;
    const pool = this.pools.get('net');
    if (pool) pool.value = s.jackpots['net'] ?? pool.seed;
    this.syncQuota();
    if (e.tycoon) this.tycoonSys.restore(e.tycoon);
    this.buffSys.buffs.restore(e.buffs);
    this.hotline.restore(e.hotline);
    this.hollow = restoredDoor(e.hollow);
    this.forgiveUntil = typeof e.forgiveUntil === 'number' ? e.forgiveUntil : -1;
    this.houseWealth = typeof e.houseWealth === 'number' && e.houseWealth > 0 ? e.houseWealth : 0;
    this.obolMult = typeof e.obolMult === 'number' && e.obolMult > 0 ? e.obolMult : 1;
    this.hollowRefused = e.hollowRefused === true;
    this.starter = restoredStarter(e.starter);
    this.nightCards.restore(e.nightCards);
    this.watchEv.restore(e.watchEvent);
    this.spotlight.restore(e.spotlight);
    this.loanQuota = Math.max(0, e.rescue?.quota ?? 0); this.rescuesUsed = Math.max(0, e.rescue?.used ?? 0);
    this.watchDeposits = Math.max(0, e.watchDep ?? 0);
    this.watchFloatSnap = typeof e.watchFloat === 'number' && Number.isFinite(e.watchFloat) ? Math.max(0, Math.floor(e.watchFloat)) : null;
    this.bankGranted = Math.max(0, Math.floor(e.bank?.granted ?? 0));
    this.watchWd = Math.max(0, Math.floor(e.bank?.wd ?? 0)); this.watchDepCoins = Math.max(0, Math.floor(e.bank?.dep ?? 0));
    this.wingKeys = Math.max(0, Math.floor(e.wingKeys ?? 0)); this.managerKey = e.managerKey === true;
    this.rooms = restoreRooms(e.rooms);
    if ((e.bonusObols ?? 0) > 0) this.currencies.set('obol', e.bonusObols ?? 0);
    this.soulMarkCount = Math.min(SOUL_MARKS_PER_RUN, Math.max(0, Math.floor(e.soulMarks ?? SOUL_MARKS_PER_RUN)));
    this.markEscrow = Math.min(SOUL_MARKS_PER_RUN, Math.max(0, Math.floor(e.markEscrow ?? 0)));
    this.bossDuelNight = Math.max(0, Math.floor(e.bossDuel ?? 0));
    this.endingPathId = typeof e.endingPath === 'string' ? e.endingPath : null;
    this.pledged.clear();
    for (const id of e.pledged ?? []) if (typeof id === 'string') this.pledged.add(id);
    this.itemSys.totems.restore(e.totems);
    if (e.contracts) {
      this.contractNight = e.contracts.night;
      this.contractSeq = e.contracts.seq;
      this.contractList = e.contracts.list.map((c) => ({ ...c }));
      this.contractBase = new Map(Object.entries(e.contracts.base));
    }
    this.circ.restore(e.circuit);
    if (typeof e.savedAt === 'number') this.tycoonSys.catchUp(Math.max(0, (Date.now() - e.savedAt) / 1000));
    this.ended = !this.living || this.phase === 'over';
  }
}
