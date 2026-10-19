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
import { FIRST_UNLOCK_NIGHT, isLockedFor, effectiveNight,isProgressive, tierOf, nightQuota, buyPrice, ghostWager, houseCut, expectedCut, machineName } from './progression';
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
  ratePercent, type ObolOutcome, type OvershootMarkTier,
} from './data/schedule';
import {
  COLD_MULT, Circuit, HOT_MULT, lampEligible, lampView as lampViewOf, rollLamps, tiltBulbs, tiltFactor, tiltStep,
  type CircuitSave, type CircuitView, type LampCandidate, type LampView, type TiltView,
} from './circuit';
import {
  PAYOUT_GUARD, RESCUE_MAX_PER_NIGHT, STAKE_CONFIRM_SEC, bettingLadder, charmPrice, holdAtOpen, houseFloatTopUp, night1StakeCap, settlePayout, snapDown,
  stakeNeedsConfirm, type PayoutResult, type RescueLoan,
} from './economy';
import { clearClockHolds, clockHeld, holdClock, releaseClock, tickClockHold } from './clockHold';
import { createRescue, rescueTerms, brokeSteps, type BrokeHelp, type RescueLine } from './rescue';
import { bankBalance, churnOf, interestBase, interestNext, previewWithdraw, pullsToQualify, sealCoins, tierReached, withdrawable, type BankInput, type WithdrawPreview } from './bank';
import { bestBetFloor, depositRoom, pocketDead, watchFloat } from './float';
import { Charms, PEG_CAP_RUN, allCharmDefs, choiceOffer, charmDef } from './charms/engine';
import { Pawn, sellRefund, type PawnSnapshot } from './shop';
import { StampBook, setActiveStampBook, type StampSnapshot } from './stamps';
import { scopeTags } from './suits';
import { paceOf, oddsLine, type OddsLine } from './pace';
import { profileOf } from './data/machineProfiles';
import { MachineMods, type ModsSnapshot } from './machineMods';
import { bossFor, type BossNight } from './bosses';
import { applyKit, kitById } from './data/kits';
import { DAILY_STAKE, dailyBetter, dailyKit, dailySeed, dayKey, isDayKey, type DailyBest } from './daily';
import { clampStake, isStakeClear, recordStakeClear, stakeBossFor, stakeEffects, type StakeEffects } from './stakes';
import { BOSS_REWARD, BOSS_TEMPLATES } from './data/bosses';
import { SOUL_MARKS_PER_RUN, type DuelEndReport, type DuelRunHooks } from './duels/stakes';
import { isSealMemory, nextMemory } from './sealMemories';
import { bossRivalFor, rivalById, type RivalId } from './story/duels/rivals';
import { rivalTermsFor, termsVars } from './story/duels/terms';
import { presentationIdle } from './duels/runlink';
import { registerStrings, t } from '@/core/i18n';
import { playableMode, rulesFor, type ModeRules } from './modes';
import { createTycoon, type Tycoon } from './tycoon';
import { createBuffSystem, type BuffSystem } from './buffs';
import { createItemSystem, type ItemSystem } from './items';
import { createHotline, type Hotline, type HotlineSave } from './hotline';
import { createPhone, hooksOf, DEAL_NIGHT, HARMONY_START } from './home/phone';
import { createLuckMeter, type LuckMeter } from './luck';
import { createKeepsakes, type KeepsakeId, type KeepsakeOutcome, type KeepsakeSave, type Keepsakes } from './keepsake';
import { createGhostSeat, type GhostMatch, type GhostSave, type GhostSeat, type GhostSeatInfo } from './ghostSeat';
import keepsakeStrings from './keepsake.strings';
import ghostStrings from './ghostSeat.strings';
import computerStrings from './home/computer.strings';
import { cloneChapter, freshChapter, hearHint, readChapter, type ChapterRecord } from './story/chapter';
import { endingRecord, freshFacts, type EndingFacts, type EndingRecord } from './story/endings';
import type { FlowResult } from './duels/promise/flow';
import type { HomePhoneApi, HomeSave, HomeStage } from './home/contract';
import {
  DOOR_FIRST_NIGHT, PHONE_HOUR, PHONE_MINUTE, initDoor, reveal as doorReveal, ring as doorRing, answer as doorAnswer, enter as doorEnter,
  pickLord, leave as doorLeave, finish as doorFinish, dawn as doorDawn, type DoorState, type DoorTrigger, type DuelEnd, type DoorStatus,
} from './hollow/rules';
import type { LordId } from './hollow/rules';
import {
  LOCKER, announcePressure, announceLocker, backOffice, bindWingSource, boilerNextWatch, boilerPull, boilerVent, bossKeys,
  collectorPrice, dawnKeys, managerKeyDrop, openLocker as rollLocker, restoreRooms, roomsProvider, roomsStart,
  ledgerOffer, ledgerPick, ledgerRead, type LockerOpen, type LockerResult, type RoomsState,
} from './rooms';
import type { LedgerFind } from './story/quests';
import pullsStrings from './pulls.strings';
import bankStrings from './bank.strings';
import runStrings from './run.strings';
import { houseMoodProvider } from './houseMood';
import { LOKI_SWAP_INK, Pantheon, boonDef, type GodId, type OfferTier, type PantheonOfferView, type PantheonSave } from './pantheon';
import pantheonStrings from './pantheon.strings';
import { WatchTithe, type TitheResult, type TitheSave, type TitheView } from './checkpoints';
import checkpointStrings from './checkpoints.strings';
import { Spotlight, isSpotlightEligible, spotlightStartLine, type SpotlightSave, type SpotlightView } from './spotlight';
import { WatchEvents, type WatchEventSave } from './watchEvents';
import { INK_HAND, Joker, type AskWhy, type JokerEvent, shownFrame, grinFrame } from './joker/joker';
import { takeoverPayout } from './joker/takeover';
import type { WhisperCtx } from './joker/whispers';
import { HABIT_AFTER, sheetFromOutcome, sheetFromTells, type CallResult, type CrookedTell } from './events/crookedTable';
import { Bonds, bondOfRival, type BondChange, type BondEvent, type BondsSave } from './bonds';
import { isCheated } from './cheats';
import type { FloorAward, WatchFloor } from './events/types';
import type { EventBannerShow } from './buffs/banner';
import { createHomeEconomy, type EconSave, type HomeEconomy } from './economy/homeEconomy';
import { DEADBOLT_TOLL_BACK } from './economy/market';
import { FRIDGE_MAX, addToFridge, fridgeOf, fridgeRestore, fridgeSnapshot, type FridgeSave } from './food';
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
/**
 * The Dawn receipt: one snapshot taken in `dawn()` before the books reset, so the receipt never reads a reset or a later Night.
 * `due` is the quota the paid Night closed against (tithes included), `paid` the bank's balance at Dawn (the same number the Debt
 * Terminal shows, interest included), `interest` the part of that balance the bank paid as interest, `tithe` the quota the
 * missed Watch tithes added to that Night.
 */
export interface DawnReceipt {
  night: number; due: number; paid: number; interest: number; tithe: number;
  /** A short Dawn that cost a name seal: the memory it took and the seals left (docs/BLESSINGS.md §1). Absent on a Night paid in full. */
  memory?: string; seals?: number;
}
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
/** A saved receipt, or null: older saves have none, and a damaged one is dropped rather than shown. */
function restoredDawnReceipt(d: DawnReceipt | undefined): DawnReceipt | null {
  if (!d || !isCount(d.night) || !isCount(d.due) || !isCount(d.paid) || !isCount(d.interest) || !isCount(d.tithe)) return null;
  const sealed = isSealMemory(d.memory) && isCount(d.seals) ? { memory: d.memory, seals: Math.floor(d.seals) } : {};
  return { night: Math.floor(d.night), due: Math.floor(d.due), paid: Math.floor(d.paid), interest: Math.floor(d.interest), tithe: Math.floor(d.tithe), ...sealed };
}
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
  /** The overpay principal (pocket coins put in this Night, interest left out): the figure the overpay tiers read (decision D1). */
  principal?: number;
  /** The SEAL holds the coins above the quota until Dawn: WITHDRAW is refused, and BREAK SEAL takes them out (see `DebtRun.breakSeal`). */
  sealed?: boolean;
  /** Coins the seal holds (0 when not sealed). */
  sealCoins?: number;
  /** Tonight's seal was broken at the terminal: the overpay tiers are forfeit for this Night. */
  sealBroken?: boolean;
}
/** OVERSHOOT (the NIGHT PLAN line): the overpay principal against the overpay tiers, read live in a Watch. See `DebtRun.overshootView()`. */
export interface OvershootView {
  /** The overpay principal (pocket coins put in this Night, interest and quota credit left out). Not the bank balance: the tiers read it. */
  balance: number;
  /** Tonight's quota. */
  due: number;
  /** The highest tier the balance has reached (`OVERSHOOT_TIERS` id), null when none. */
  tier: string | null;
  /** Index into `OVERSHOOT_TIERS` of that tier, -1 when none. */
  reached: number;
  /** The next tier above the balance: its id, the first whole coin count that reaches it (`target`) and the coins still to go (`gap`). Null when every tier is reached or there is no quota. */
  next: { id: string; target: number; gap: number } | null;
}
/** The Collector's rescue loan: the call rang (`'ring'`), the loan was taken (`'taken'`) or the call ended unanswered (`'lapsed'`). */
export interface RunRescueEvent { pid: PlayerId; state: 'ring' | 'taken' | 'lapsed'; coins: number; quota: number; due: number }
declare module '@/net/protocol' {
  interface RunSummary {
    /** THE ENDINGS (story A5): the ending reached (`EndingId`). `ending` keeps the run's own tag, which results and Obols read. */
    endingId?: string;
  }
}
declare module '@/core/events' {
  interface GameEvents {
    'run:wintier': RunWinTierEvent;
    'run:stakeConfirm': RunStakeConfirmEvent;
    'run:rescue': RunRescueEvent;
    /** The Hollow Door opened for this run (the world shows the doorway). */
    'hollow:open': { reason: 'crack' | 'phone333' | 'seam' };
  }
}

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

/** Bell strike length (GDD §2.3). */
const BELL_SEC = 2;
declare module '@/core/events' {
  interface GameEvents {
    /** THE PROLOGUE (wave 72): `done` when the lift has landed and Night 1 Watch 1 is about to open (the intro plays from here). */
    'home:prologue': { state: 'done' };
  }
}

/** Settle length (GDD §2.3). Wave 42 (director decision 2): 1.5 s. Deposits and WITHDRAW stay open through it (the bank is
 *  settled at its start, so a coin moved now earns from the next Watch on); the lever comes back when it ends. */
const SETTLE_SEC = 1.5;
/** Dawn Collection length (GDD §2.7). */
const COLLECTION_SEC = 12;
/** Seconds a short Dawn waits for the player to answer Selim's last-seal question (`selim:ask`) before it reads as no. */
const SELIM_ASK_SEC = 20;
/**
 * The Home stages in sim seconds (docs/WAVE69_HOME.md). The run owns the clock of every stage, so a headless run walks the whole
 * Evening on its own; the controller (src/game/home/evening.ts) reads the same numbers to time its fades, sounds and teleports.
 *  - `ride`: the lift up, inside the car (the ride down plays the same beats: evening.ts CAR_RIDE). Dark by `dark` (ding), into the car at
 *    `teleport`, faded in at `fadeIn` with the floor dial rising B7 to G, the arrival ding and out to the street door at the end; the Evening starts then.
 *  - `evening`: the walk in the apartment. At zero the player falls asleep on their own, so nothing can soft-lock.
 *  - `sleep`: bedCreak and the fade to black; the next Night opens at the end.
 *  - `doomed`: the old short ride home (`doomed.ride`: dark, ding, teleport to the flat, no car), then the lights flicker (`flickerAt` to `flickerEnd`), three knocks and the end (`end`).
 */
export const HOME_TIMING = {
  ride: 4.6, dark: 0.8, teleport: 1.0, fadeIn: 1.4,
  evening: 120,
  sleep: 1.8,
  doomed: { ride: 2.6, flickerAt: 2.6, flickerEnd: 4.2, knocks: [4.7, 5.6, 6.5] as readonly number[], end: 8.0 },
} as const;
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
/** LOKI: a lie call counts this long after his line starts (JOKER §2.1 says 3 s; his line of up to 8 words types in about 1 s). */
const JOKER_CALL_S = 4;

declare module '@/core/events' {
  interface GameEvents {
    /** Wing Keys granted (Dawn, a boss, the Manager's Key): the host shows a toast. */
    'room:keys': { n: number; why: 'dawn' | 'boss' | 'manager' };
    /** The Boiler blew at P 100 and is shut until the next Watch. */
    'room:blown': { zone: string };
    /** Soul Marks changed (wave 25 duels): `left` on the card, `lost` when one was just taken, `blank` at 0. */
    'duel:marks': { left: number; lost: boolean; blank: boolean };
    /** A duel is settled and its closing scene is done (the demo ends its run on Lucan's, game/demoEnd.ts). */
    'duel:end': { rivalId: string; night: number };
    /** Back Office exchange done: Tickets in, Obols out. */
    'room:backoffice': { tickets: number; obols: number };
    /** The Settle paid interest into the bank: `amount` coins at `pct` whole percent (the coin sound and the toast). */
    'run:interest': { pid: PlayerId; amount: number; pct: number };
    /** THE PANTHEON (docs/BLESSINGS.md §2): the Dawn offer opened (`offer`), a boon kept (`picked`, the offer may stay open for a
     *  second pick), the timer or the lever took the leftmost (`auto`), or Loki swapped a card (`swap`). `ids` are the boons taken. */
    'run:boon': { pid: PlayerId; state: 'offer' | 'picked' | 'auto' | 'swap'; ids: string[] };
    /** Watch tithe (wave 58): a quota Watch's Settle. `met` pays `tickets`; `missed` adds `shortfall` to tonight's quota. */
    'run:tithe': { pid: PlayerId; state: 'met' | 'missed'; watch: number; target: number; earned: number; shortfall: number; tickets: number };
    /** A Night starts (its first Watch begins): the grand casino props take the Night's light show from this. `night` is 1-based. */
    'night:begin': { night: number };
    /** A Watch starts (the Bell rings it in): 1-based `night` and `watch`. The story's Watch beats read this (never `run:window`, which
     *  also fires at the end of a Dawn). */
    'watch:begin': { night: number; watch: number };
    /** LOKI dares you (once a Night, at a seat): the voice asks, and the answer comes back through `jokerDare`. */
    'joker:dare': { night: number };
    /** The player called his last line a lie: `right` = it was one (the sound answers; the Trust move comes in `joker:trust`). */
    'joker:call': { right: boolean };
    /** BONDS: a short Dawn and Selim has one seal left: the bar asks the player, the answer goes to `selimAnswer`. */
    'selim:ask': { night: number };
  }
}
/** One of the biggest wins of the run (the jackpot wall reads the four largest): the machine kind and the credited coins. */
export interface GrandWin { machineId: MachineId; amount: number }
/** The four biggest wins the jackpot wall shows. */
const GRAND_WIN_MAX = 4;
/** Restores the grand wins from a save: whole positive amounts only, largest first, at most GRAND_WIN_MAX. */
function restoredGrandWins(v: unknown): GrandWin[] {
  if (!Array.isArray(v)) return [];
  const out: GrandWin[] = [];
  for (const x of v) {
    const w = x as Partial<GrandWin> | null;
    if (!w || typeof w.machineId !== 'string' || typeof w.amount !== 'number' || !Number.isFinite(w.amount) || w.amount <= 0) continue;
    out.push({ machineId: w.machineId as MachineId, amount: Math.floor(w.amount) });
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, GRAND_WIN_MAX);
}
/** `lastRefusal()` after a first press on a stake above half the pocket (see `RunStakeConfirmEvent`). Not in `RefusalReason` yet. */
export const STAKE_CONFIRM_REASON: RefusalReason = 'confirm';

/** Pull grant toasts (`pulls.grant`, `pulls.r.*`). Registered here too so headless tests see them without the main.ts glob. */
registerStrings(pullsStrings.prefix, { en: pullsStrings.en, tr: pullsStrings.tr });
registerStrings(bankStrings.prefix, { en: bankStrings.en, tr: bankStrings.tr });
registerStrings(pantheonStrings.prefix, { en: pantheonStrings.en, tr: pantheonStrings.tr });
registerStrings(checkpointStrings.prefix, { en: checkpointStrings.en, tr: checkpointStrings.tr });
registerStrings(runStrings.prefix, { en: runStrings.en, tr: runStrings.tr });
registerStrings(keepsakeStrings.prefix, { en: keepsakeStrings.en, tr: keepsakeStrings.tr });
registerStrings(ghostStrings.prefix, { en: ghostStrings.en, tr: ghostStrings.tr });
registerStrings(computerStrings.prefix, { en: computerStrings.en, tr: computerStrings.tr });   // the Dawn and deadbolt banners

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

// ── persistence ──────────────────────────────────────────────────────────────────────────────────────
/** Run-private state that the shared `RunSnapshot` shape does not carry. Stored under `resume.ext` (JSON-safe). */
export interface RunExt {
  v: 1;
  index: number; watch: number; watches: number; overtimeIdx: number;
  phase: ShiftPhase; phaseLeft: number; nightDone: boolean; topside: boolean; metFired: boolean;
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
  /** Machine mods installed per instance (Ledger MODS tab). Optional: older saves have none. */
  machineMods?: ModsSnapshot;
  /** Rounds opened per machine id (the Pawn's most-played machine). Optional. */
  plays?: Record<string, number>;
  /** Legacy (pre-wave 8 reroll counter), ignored. */
  pawnRerolls?: number;
  discount: number; nextDiscount: number; elapsed: number; maxWallet: number; biggest: number; rounds: number;
  rng: [number, number, number, number];
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
  /** THE LUCK METER (wave 73): its saved stars. Optional: older saves have none. */
  luck?: unknown;
  /** THE KEEPSAKE STAKE (wave 75): owned, lost and carried keepsakes, the staked Night, rounds in play. Optional: older saves have none. */
  keepsake?: KeepsakeSave;
  /** THE GHOST SEAT (wave 75): tonight's tally and the copy's seat. Optional: older saves have none. */
  ghost?: GhostSave;
  /** THE SECOND NAME (wave 73): the chapter record (title cards, arcs, reveal, deal). Optional: older saves have none. */
  chapter?: ChapterRecord;
  /** BONDS (docs/STORY_BIBLE.md §10): the 0..3 bonds, Selim's loans, the once-a-run perks spent. Optional: older saves have none. */
  bonds?: BondsSave;
  /** Deposits made this Watch (every one keeps the float). Optional: older saves have none. */
  watchDep?: number;
  /** The Watch's float, fixed when it was first read. Optional: older saves recompute it. */
  watchFloat?: number;
  /** Bank (wave 27): non-cash quota credit, and this Watch's withdrawn / deposited coins (the churn rule). Optional: older saves have none. */
  bank?: { granted: number; wd: number; dep: number; interest?: number; broken?: boolean };
  /** Special rooms (wave 24): Wing Keys, the Manager's Key, the Boiler / locker state and the run's bonus Obols. Optional: older saves have none. */
  wingKeys?: number;
  managerKey?: boolean;
  rooms?: RoomsState;
  bonusObols?: number;
  /** Wave 25 duels: Soul Marks on the card, the one in play, the Night whose boss duel was won, rivals whose Pledge charm is taken. Optional: older saves have none. */
  soulMarks?: number;
  markEscrow?: number;
  /** The memories the lost seals took, most recent last (the Dawn receipt prints them; a restored seal gives the last back). Optional: older saves have none. */
  lostMemories?: string[];
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
  /** THE PANTHEON: the open boon offer, the boons kept, Favour. Optional. Older saves' `nightCards`, `starter` and `overpays` are dropped. */
  pantheon?: PantheonSave;
  /** LOKI (docs/JOKER.md): Trust, Ink and his limits (`Joker.snapshot`), and whether his lift-mirror line was said. Optional. */
  joker?: unknown;
  lokiMet?: boolean;
  /** Per-Watch floor event (wave 43): the live event and its time left. Optional: a save between Watches has none. */
  watchEvent?: WatchEventSave | null;
  /** THE EVENING (wave 69): the Home stage, the lights and chain, and the phone's slice. Optional: older saves and online runs have none. */
  home?: HomeSave;
  /** Machine of the Night (wave 55): this Night's spotlight and the kind spotlit last Night. Optional: older saves have none. */
  spotlight?: SpotlightSave;
  /** Watch tithe (wave 58): this Watch's net winnings and the tithe's quota adds. Optional: older saves have none. */
  tithe?: TitheSave;
  /** The Dawn receipt of the last paid Night (the Night Cards panel reads it). Optional: older saves have none. */
  dawnBook?: DawnReceipt;
  /** The four biggest wins of the run (the jackpot wall). Optional: older saves have none. */
  grandWins?: GrandWin[];
  /** THE HOME COMPUTER (wave 77): ventures held, home upgrades, the fridge, the last Dawn's pay. Optional: older saves and runs without the Home layer have none. */
  econ?: EconSave;
  /** FOOD (wave 77): the fridge at home (src/game/food.ts). Optional: older saves and runs without the Home layer have none. */
  fridge?: FridgeSave;
}
/** Contracts persisted under `ext.contracts`. `base` holds the stat value at signing, for stat goals. */
interface ContractsSave { night: number; seq: number; list: ContractState[]; base: Record<string, number> }
export interface RunSave extends RunSnapshot { ext: RunExt }

function isRunSave(s: RunSnapshot): s is RunSave {
  const e = (s as { ext?: unknown }).ext;
  return typeof e === 'object' && e !== null && (e as { v?: unknown }).v === 1;
}

// ── public surface ───────────────────────────────────────────────────────────────────────────────────
export interface RunOpts {
  seed: number;
  /** Default 'debt'. 'free' = Free Casino sandbox. 'coop' / 'versus' are refused until M3. */
  mode?: GameMode;
  cfg?: Partial<RunConfig>;
  /** When set, every resolved action is written to `save.data.resume` (the store debounces the disk write). */
  save?: SaveStore;
  /** Event banners (night events) for the HUD. Optional: without it events still run, silently. */
  banner?: EventBannerShow;
  /**
   * THE EVENING (wave 69): this run has the Home layer (the lift home after a paid Night, the phone, the doomed ride after a missed
   * quota). The session sets it for a solo Debt Run; an online run leaves it off and keeps the old lever and the trapdoor. Off by default.
   */
  home?: boolean;
  /**
   * THE PROLOGUE (wave 72): a fresh run with the Home layer opens in the apartment (the spouse, the call, the lift down) before Night 1
   * Watch 1. Only a presentation that plays it (the session's Evening) sets it: a headless run with `home` and no `prologue` goes
   * straight to the floor, as before. A resumed save never has one.
   */
  prologue?: boolean;
}

/** What the world exposes to the run (machines and slot positions). Attached once the pit exists. */
export interface RunWorldLink {
  machines(): ReadonlyArray<{ instance: InstanceId; machineId: MachineId; size?: SlotSize }>;
  instancePos(mid: InstanceId): V3 | undefined;
  /** True for machines in closed wings / locked tiers (no Lamps there). */
  locked?(instance: InstanceId): boolean;
  /** The Lobby crate spot (CRATE DROP lands here), when the world has one. */
  lobbyCrate?(): { x: number; z: number } | undefined;
}

/** Run control surface on top of `RunApi` (HUD, intermission UI, frame loop). */
export interface DebtRun extends RunApi {
  /** True from Dawn paying the Night until OPEN THE FLOOR. */
  readonly nightPaid: boolean;
  /** True from a sealed Dawn (a short quota paid with a name seal) until OPEN THE FLOOR: it counts as paid for flow, but must read SEALED. */
  readonly nightSealed: boolean;
  /** The Night summary's books (float, interest, tickets) for the Night in progress. */
  nightLedger(): Readonly<NightLedger>;
  /** The Dawn receipt of the last paid Night (a copy), or null before the first paid Dawn. Taken in `dawn()`, before the reset. */
  dawnReceipt(): DawnReceipt | null;
  /** The live interest rate of this Night in whole percent (schedule + bonuses): the Terminal and the tutorial show it. */
  interestPct(): number;
  /** Advance the run by `dt` sim seconds. Call from the fixed step. */
  tick(dt: number): void;
  /** Write any coalesced save now. Call on page hide / unload (`tick` also flushes within SAVE_SOON_SEC). */
  flush(): void;
  /** THE PANTHEON: the open boon offer at a paid Dawn (cards, picks left, seconds left, Loki's swap), or null. OPEN THE FLOOR settles it. */
  boonOffer(): PantheonOfferView | null;
  /** Keep one boon of the open offer for the rest of the run. False when closed or the id is not on offer. */
  pickBoon(id: string): boolean;
  /** Loki's swap (Night 3+, once an offer): card `index` becomes one of his. Costs Ink. False when refused (or past his cap). */
  swapBoon(index: number): boolean;
  // ── LOKI (docs/JOKER.md §3, wave J2): the voice ──
  /** Ask him about what is in front of you (Ink +1). False when there is nothing to ask about or he has nothing to say. */
  jokerAsk(): boolean;
  /** Call his last line a lie (within a few seconds of it). False when there is nothing to call. */
  jokerCall(): boolean;
  /** Answer tonight's dare. */
  jokerDare(accept: boolean): void;
  /** The session reports a place he talks about: a Crooked Table under foot (`id` the table), or null when the player left it. */
  jokerMoment(ctx: 'crooked' | null, id?: string): void;
  /** The card chip: the grin frame shown (0..6) and whether it lies (Ink 6+, one glance in three). */
  jokerGrin(): { frame: number; lie: boolean };
  /** His Ink 0..10 (Dread reads `inkDread` of it). */
  jokerInk(): number;
  /** His true Trust (−3..3, no lie): how near his apparition stands (game/joker/apparition.ts). */
  jokerTrust(): number;
  /** THE BURNING WAGER: he whispers about the Champion's habit `fact` before a throw (free, true or a lie by his rules); `word` spends his
   *  word (true, no tell). False when he says nothing. */
  jokerWager(fact: string, word?: boolean): boolean;
  /** His word is earned and not spent (JOKER §4). */
  jokerWordReady(): boolean;
  /** Give him the hand at this seat for its next round (JOKER §4): null when he took it, else why not. Costs Ink. */
  jokerTakeover(): AskWhy | 'seat' | null;
  /** The offer panel is on screen: OPEN THE FLOOR waits for a pick (or the panel's timer) instead of taking the leftmost. */
  setBoonGate(on: boolean): void;
  /** Freeze or run the offer's countdown (the panel holds it while a card is hovered or focused). */
  holdBoonTimer(on: boolean): void;
  /** The boons kept this run, in the order taken. */
  boons(): readonly string[];
  /** A god's Favour, 0..3. */
  boonFavour(god: GodId): number;
  /** Intermission → Bell (the BELL ROPE). */
  startWatch(): boolean;
  /**
   * The floor lever of a paid Night. With the Home layer on (solo Debt Run, not Night 8) it TAKES THE LIFT: stage `ride`, then the
   * Evening; the bed opens the next Night. Otherwise it opens the next Night at once (the old lever). From the Evening it sleeps.
   * Refused while the Topside choice is open.
   */
  openFloor(): boolean;
  // ── THE EVENING (wave 69, src/game/home): a sub-state of the intermission, never a phase ──
  /** The Home layer is on for this run (a solo Debt Run asked for it). Online runs and tests without `home` are off. */
  readonly homeOn: boolean;
  /** Where the run stands at home: `ride` (lift up), `evening`, `sleep`, `doomed` (a missed quota), or null (on the casino floor). */
  homeStage(): HomeStage | null;
  /** THE HOME COMPUTER (wave 77): ventures, market and the run goal (src/game/economy). Null without the Home layer. */
  homeEconomy(): HomeEconomy | null;
  /** Stage, sim seconds left in it, and the lights and chain of the apartment (the controller and the save read it). */
  homeState(): { stage: HomeStage | null; left: number; lights: boolean; chain: boolean };
  /** The floor lever would take the lift now (paid Night, Home layer on, not Night 8): the terminal reads it for its label. */
  homeLiftReady(): boolean;
  /** The bed: the Evening ends, the screen goes dark and the next Night opens at the end of the stage. False outside the Evening. */
  homeSleep(): boolean;
  /** THE WALK HOME: while held, the Evening's clock waits (the player is still on the street). Not saved: a resume lands at the door. */
  homeHold(on: boolean): void;
  /** THE PROLOGUE (wave 72): a fresh solo run starts in the apartment, before Night 1 Watch 1. True until the lift lands. */
  prologueOn(): boolean;
  /** The prologue's lift has landed on the casino floor: the prologue ends and Night 1 Watch 1 begins. False when it is not on. */
  finishPrologue(): boolean;
  /** Writes the save now (a visit's verdict at home must not wait for the coalescing timer). */
  homeSaveNow(): void;
  /** The controller reports the apartment's lights and chain so a save keeps them. */
  homeFlags(f: { lights?: boolean; chain?: boolean }): void;
  /** THE KEEPSAKE STAKE (wave 75): the keepsakes the player owns, the House kept, and the one carried tonight. */
  keepsakeOwned(): KeepsakeId[];
  keepsakeLost(): KeepsakeId[];
  keepsakeCarried(): KeepsakeId | null;
  /** The Evening's carry choice (home, the Evening only): one keepsake to the casino, or null. False when refused. */
  keepsakeCarry(id: KeepsakeId | null): boolean;
  /** Stakes the carried keepsake on the next bet at this seat (play only, once a Night). False when refused. */
  keepsakeStake(mid: InstanceId): boolean;
  keepsakeStakeCancel(): void;
  keepsakePending(mid: InstanceId): KeepsakeId | null;
  /** The Debt Terminal's buy-back price for a lost keepsake, or null. */
  keepsakeBuyPrice(id: KeepsakeId): number | null;
  /** Buys a lost keepsake back for coins. */
  keepsakeBuyBack(id: KeepsakeId): boolean;
  /** True when a keepsake is carried tonight and no stake has been made with it this Night (the seat hint reads it). */
  keepsakeFreeTonight(): boolean;
  /** THE GHOST SEAT (wave 75): the copy's seat tonight (machine kind, seat, pools, stars), or null. */
  ghostSeatInfo(): GhostSeatInfo | null;
  /** BONDS (§10): the friends' book (levels, unlocks, greetings, Selim's loans). Read it; move it only through `bond`. */
  bonds(): Bonds;
  /** BONDS: one event in tonight's printed Night: the toasts, the `bond:change` events and the save. */
  bond(ev: BondEvent): BondChange;
  /** THE SECOND NAME: the live chapter record (the finale's facts live in it, so a resume keeps them). */
  chapterRecord(): ChapterRecord;
  /**
   * THE ENDINGS (story A5): a game at Ada's table is over. A crack is a word to her broken (she stops saying "me too" at the wager);
   * the N8 kitchen wager (`r.wager` set) is recorded, and a lost wager ends the run (KEPT). A left game counts for nothing.
   */
  kitchenDone(r: Pick<FlowResult, 'left' | 'wager' | 'pairs' | 'cracks'>): void;
  /** THE ENDINGS: the Burning Wager is over and the run ends on it (story/wager.ts, the Champion's table on the stage). */
  burningWager(r: { wager: 'win' | 'lose'; cracks: number; lokiHand?: boolean; word?: boolean }): void;
  /**
   * THE BURNING WAGER: Night 8 is paid and the Wager is still to play (a solo story run). The session opens it while this holds.
   * Restart rule: the match itself is not saved, so a resume opens it again from 0:0 (seeded, the same match).
   */
  wagerDue(): boolean;
  /** THE ENDINGS: the facts the run would end on now (`end`: how it is ending). The tests and the dev preview read them. */
  endingFacts(end?: { result: RunSummary['result']; ending?: string }): EndingFacts;
  /** THE ENDINGS: the ending this run reached, set when it ends (null before, and for a quit or a run with no ending). */
  endingRecord(): EndingRecord | null;
  /** The Hot Lamp the next Bell will roll (the hotline's lamp deal and Selim's tip), or null. */
  nextHot(): { mid: string; machineId: string } | null;
  /** Selim's last seal at a short Dawn: the player's answer to `selim:ask` (no answer in time reads as no). */
  selimAnswer(yes: boolean): void;
  /** THE GRAND CASINO (wave 75): the four biggest wins of this run, largest first. */
  grandWins(): readonly GrandWin[];
  /**
   * FLOOR EVENTS (wave 75): the floor press. A LAST CALL DARE to take when it is open, else a STAGE AUCTION bid at the next legal
   * price. True when something was taken or bid.
   */
  floorAct(): boolean;
  /** FLOOR EVENTS: the CRATE DROP press (`pressed` is the interact key this step) at the player's floor position. True when it opened. */
  floorCrate(pos: { x: number; z: number } | null, pressed: boolean): boolean;
  /** THE CROOKED TABLE: the three tables and what can be read at each now (null when the event is not live). */
  crookedView(): { tables: { mid: MachineId; tells: CrookedTell[] }[]; intro: boolean } | null;
  /** THE CROOKED TABLE: true when `machineId` is one of the three marked tables right now. */
  isCrookedTable(machineId: MachineId): boolean;
  /** THE CROOKED TABLE: call the cheat at the table `machineId` (key C). A right call refunds and gives a luck star; a wrong one costs a fee. */
  floorCall(machineId: MachineId): boolean;
  /** Pay the rest of the Night now (SETTLE lever). Needs `deposit ≥ quota`. */
  settleEarly(): boolean;
  /**
   * BELL (Debt Terminal, decision 1): end the Watch now, in play or Last Call. The unused pulls keep the usual settle rebate.
   * Always allowed while playing, so a Watch is never stuck. False when the phase does not allow it.
   */
  ringBell(): boolean;
  /** The bank in numbers (Debt Terminal DEPOSIT / WITHDRAW / QUOTA screens). */
  bank(): BankView;
  /** Watch tithe (wave 58): this Watch's target, net winnings so far, met and the shortfall (`on` false outside a tithe Watch). */
  watchTithe(): TitheView;
  /** NEXT NIGHT: the exact quota of the Night after the paid one (null while a Night runs). */
  nextQuotaPreview(): NextQuotaPreview | null;
  /** What `withdraw(amount)` would do, without doing it (what the player gives up). */
  withdrawPreview(amount: number): WithdrawPreview;
  /**
   * WITHDRAW: take up to `amount` coins from the bank back to the pocket (any time before the Watch is settled). Returns the coins
   * moved (0 = refused). Withdrawn coins stop counting toward the quota and stop earning interest.
   */
  withdraw(amount: number): number;
  /**
   * BREAK SEAL (decision D2): take the coins the seal holds (above the quota) back to the pocket. It forfeits tonight's overshoot
   * rewards. Returns the coins moved (0 = refused: no seal, or not a WITHDRAW window).
   */
  breakSeal?(): number;
  /** A thief at the door (wave 71, the Picker): takes one owned charm away for nothing. Refuses a legendary or cursed charm. */
  loseCharm?(id: string): boolean;
  /** The broke-start help: the ordered ways out when the pocket cannot cover the cheapest bet (null while the pocket can play). */
  brokeHelp(): BrokeHelp | null;
  /** Buy +1 pull for 3 Tickets (max +2 per Watch). */
  buyPull(): boolean;
  /** Pawn Window stock keeper (wave 8): stock, locks, rerolls, swap. The charm vendor reads it. */
  readonly pawn: Pawn;
  /** Symbol Stamps (Big One upgrades bought at the Pawn). */
  readonly stamps: StampBook;
  /** Machine mods (the Ledger's MODS tab): two sockets per owned machine, installed for the run. */
  readonly machineMods: MachineMods;
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
  // ── special rooms (wave 24) ──
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
  /** THE WASH LEDGER (quest 1): a ledger page was read. `fresh` on a new page, `completed` on the last one. */
  readLedgerNote(noteId: string): LedgerFind;
  /** The ledger locker's three charm choices (none until the ledger is whole and unclaimed). */
  ledgerOffer(): string[];
  /** Takes the ledger charm `charmId` (one of `ledgerOffer`). False when refused or the peg board is full. */
  ledgerClaim(charmId: string): boolean;
  /** The Collector buys a charm for Obols at 2x its sell value. False when it is not held, cursed or the run is not in a Watch gap. */
  collectorBuy(charmId: string): boolean;
  // ── tycoon (wave 28): buy a covered machine, collect its house cut ──
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
export function resumeRun(save: SaveStore, extra: { banner?: EventBannerShow; home?: boolean } = {}): DebtRun | null {
  const snap = save.data.resume;
  if (!snap || !isRunSave(snap)) return null;
  return new Run({ seed: snap.seed, mode: snap.mode, cfg: snap.cfg, save, banner: extra.banner, home: extra.home }, snap);
}

// ── inert sub-APIs (owned by other packages; warns once when touched) ─────────────────────────────────
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

// ── modifier pipeline (the reference fold from modifiers.types) ─────────────────────────────────────
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

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────
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
  readonly machineMods: MachineMods;
  private readonly tycoonSys: Tycoon;
  private readonly buffSys: BuffSystem;
  private readonly itemSys: ItemSystem;
  private readonly hotline: Hotline;
  private readonly rescue: RescueLine;
  private worldLink: RunWorldLink | null = null;
  /** THE GRAND CASINO: the four biggest wins of the run, largest first (saved as `ext.grandWins`). */
  private grandWinList: GrandWin[] = [];
  private readonly pools = new Map<string, JackpotPool>();
  private readonly poolListeners = new Set<(p: JackpotPool) => void>();
  private readonly counters = new Map<string, number>();
  private readonly currencies = new Map<string, number>();
  wingKeys = 0;
  managerKey = false;
  /** Soul Marks on the JackID card (3 per run), the one on the table, the Night of a won boss duel, rivals whose Pledge charm is taken. */
  private soulMarkCount = SOUL_MARKS_PER_RUN;
  private markEscrow = 0;
  private lostMemories: string[] = [];
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
  get nightSealed(): boolean { return this.nightDone && !!this.dawnBook?.memory; }
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
  /**
   * Interest the bank has earned this Night (each Settle adds it). The overpay principal is the bank minus the quota credit minus
   * this (`principalNow`): the tiers are earned by play, not by interest (decision D1). Reset at Dawn.
   */
  private nightInterest = 0;
  /** BREAK SEAL (decision D2): tonight's seal was broken at the terminal, which forfeits the overpay tiers for this Night. Reset at Dawn. */
  private sealBroken = false;
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
  /** Rescue loans (wave 13): quota added tonight, calls used tonight, seconds until the line may ring again. */
  private loanQuota = 0;
  /** Watch tithe (wave 58): per-Watch net winnings against 12 % of the Night quota; missed tithes add to tonight's quota. */
  private readonly tithe = new WatchTithe();
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
  /** The Dawn receipt of the last paid Night: written once by `dawn()`, before its books reset, and read by the Night Cards panel. */
  private dawnBook: DawnReceipt | null = null;
  /** Multiplies the Obols this run banks at its end (a taken run: ×1.5). */
  private obolMult = 1;
  /** The House refused the loan tonight or earlier (a rescue call lapsed unanswered): the red seam can open with an empty pocket. */
  private hollowRefused = false;

  // THE EVENING (wave 69): the Home stage (a flag on the intermission, or on the Dawn collection while the doom walks in), its
  // clock, the apartment's lights and chain, and the phone. All null / default when the Home layer is off.
  readonly homeOn: boolean;
  private hStage: HomeStage | null = null;
  private hLeft = 0;
  private hHold = false;
  private hLights = true;
  private hChain = false;
  private readonly hPhone: HomePhoneApi | null;
  /** THE HOME COMPUTER (wave 77): created with the Home layer, saved in `ext.econ`. */
  private readonly homeEcon: HomeEconomy | null;
  /** The computer UI's disposer (a browser run mounts it lazily; tests and the bench have no DOM). */
  private computerUiOff: (() => void) | null = null;
  /** THE LUCK METER (wave 73): stars from the run's own events; its bonus joins the luck hook base. */
  private readonly luckMeter: LuckMeter;
  /** THE KEEPSAKE STAKE (wave 75): the keepsake box (owned, lost, carried, staked). Saved in `resume.ext.keepsake`. */
  private readonly keepsakes: Keepsakes = createKeepsakes();
  /** THE GHOST SEAT (wave 75): the copy at the machine lost most last Night. Saved in `resume.ext.ghost`. */
  private readonly ghostSeat: GhostSeat = createGhostSeat();
  /** THE SECOND NAME (wave 73): the chapter record, saved in `resume.ext.chapter`. */
  private chapterRec: ChapterRecord = freshChapter();
  /** THE ENDINGS: the record `endRun` routed (story/endings.ts). */
  private endRec: EndingRecord | null = null;
  /** BONDS (§10): pure rules in bonds.ts, saved in `resume.ext.bonds`; every move goes through `bond()`. */
  private readonly bondBook: Bonds;
  /** Selim's last seal waits on the player at a short Dawn ('ask'), then carries the answer into the re-run `dawn()`. */
  private selimAsk: 'ask' | 'yes' | 'no' | null = null;
  private selimAskLeft = 0;
  /** THE PROLOGUE (wave 72): true from a fresh start until the lift lands on the floor. Not saved (a resume skips it). */
  private prologue = false;

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
      this.tithe.played(0, a);
      return true;
    },
    credit: (amount, _src, reason: GambleReason) => {
      const a = Math.floor(amount);
      if (!(a > 0) || this.ended) return 0;
      this.earn('coin', a, `gamble:${reason}`);
      this.stats.paid = (this.stats.paid ?? 0) + a;
      this.tithe.played(a, 0);
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
  /** THE PANTHEON (docs/BLESSINGS.md §2): the Dawn boon offer and the boons kept for the run. Provider registered in the constructor. */
  private readonly pantheon: Pantheon;
  /** The offer panel is on screen: the lever waits for a pick (headless runs settle at the lever). */
  private boonGate = false;
  /** LOKI (docs/JOKER.md): his pure rules, saved in `ext.joker`. The run calls beginNight / beginWatch / dawn and emits his events. */
  private readonly jokerSys: Joker;
  /** Where he may be asked right now (the last place he spoke about), or null. */
  private jokerHere: { ctx: WhisperCtx; fact?: string } | null = null;
  /** The moments he already spoke about this Watch (`ctx:id`): one moment, one tip. */
  private readonly jokerSaid = new Set<string>();
  /** Run seconds of his last line (a lie call counts within JOKER_CALL_S of it). */
  private jokerLast = Number.NEGATIVE_INFINITY;
  /** The grin frame on the card chip, re-rolled each time he moves (one glance). */
  private grin = { frame: 3, lie: false };
  private grinN = 0;
  /** His lift-mirror line was said this run. */
  private lokiMet = false;
  /** THE CHANGE OF HANDS (JOKER §4, wave J3): the floor seat his hand can take, and the seat his hand is on for its next round. */
  private jokerMid: InstanceId | null = null;
  private lokiHand: { mid: InstanceId; help: boolean } | null = null;
  /** Per-Watch floor event (wave 43): rolled at each Bell, ticked on the Watch clock, saved mid-Watch. */
  private readonly watchEv: WatchEvents;
  /** The Crooked Table's Tally Sheet lines already sent for the live event (a line goes out once per wording). */
  private readonly crookedSheetSent = new Set<string>();
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
    this.homeOn = opts.home === true && this.rules.quota && this.rules.timed;
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
        if (isWitchingWatch(this.watches, this.watch)) {
          effs.push({ hook: 'payout.mult', op: 'inc', value: 0.05 });
          effs.push({ hook: 'dread.add', op: 'add', value: 10 });
        }
        if (effs.length) out.push({ kind: 'house', id: `night:${this.index + 1}`, owner: 0, effects: effs });
      },
    });
    // HOUSE MOOD (wave 46): the Night's payout mood on every floor machine, in the same quota Watches as the house provider above.
    this.modsImpl.register(houseMoodProvider({ index: () => this.index, active: () => this.rules.quota && this.inWatch() }));

    this.circuit = this.makeCircuitView();
    this.modsImpl.register(this.makeCircuitProvider());
    this.watchEv = new WatchEvents({
      isHot: (m) => this.circ.isHot(m), touch: () => this.modsImpl.touch(), floor: () => this.floorFacts(),
      // the omens read the pantheon (created just below; these run only once a Watch is live)
      favour: (g) => this.pantheon.favour(g),
      fx: (k) => this.pantheon.fx(k),
      mod: (h, base) => this.mod(h as ModHook, RUN_MACHINE, base),   // the omens read only `x.crooked.*` hooks
    });
    this.modsImpl.register(this.watchEv);
    // A boon kept or spent changes the mods, and the luck meter re-reads its x.luck.* numbers (it never reads mods inside collect).
    this.pantheon = new Pantheon(this.seed, () => { this.modsImpl.touch(); this.luckMeter?.retune(); });
    this.jokerSys = new Joker(this.seed);
    this.jokerSys.beginNight(1);
    this.bondBook = new Bonds(this.seed);
    this.modsImpl.register(this.pantheon);
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
    // machine mods (Ledger MODS tab): two sockets per owned machine; the run owns the save and the wallet
    this.machineMods = new MachineMods({
      quota: () => this.quota.due, wallet: () => this.coins, open: () => this.tradeOpen(),
      owns: (i) => this.tycoonSys.owned(i)?.machineId ?? null,
      spend: (c, why) => this.spend('coin', c, why), touch: () => this.modsImpl.touch(),
    });
    this.modsImpl.register(this.machineMods);
    this.machineMods.onChange(() => this.persistSoon());
    // special rooms: the open rooms' rules and the Boiler's pressure payout are one zone-scoped provider; the wing state reads the run
    this.modsImpl.register(roomsProvider({ opened: () => this.tycoonSys.state().zones, rooms: () => this.rooms }));
    bindWingSource({
      opened: () => this.tycoonSys.state().zones,
      keys: () => (this.night() < FIRST_UNLOCK_NIGHT ? 0 : this.wingKeys),   // Night 1: every grille reads closed (the Dawn key waits for Night 2)
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
      now: () => Math.round(this.elapsed * 1000),   // the run's sim clock (ms): a wall-clock read would make a seeded run differ
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
        previewNextHot: () => this.nextHot(),
        bondHas: (id) => this.bondBook.has(id),
      },
    });
    this.rescue = createRescue({
      selfId: this.selfId,
      now: () => Math.round(this.elapsed * 1000),   // the run's sim clock (ms), as the hotline above
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
        this.jokerSeat(p.on ? p.mid : null);
      }),
      // LOKI talks through the window glass at home (never the phone, never the kitchen before Ink 8: J4)
      bus.on('home:interact', ({ station }) => {
        if (station === 'window') this.jokerTip('window', `window:${this.index}`);
        // from Ink 8 he talks in the kitchen too, and remembers it as his (JOKER §2.2)
        if ((station === 'spouse' || station === 'fridge') && this.jokerSys.ink >= INK_HAND) this.jokerTip('kitchen', `kitchen:${this.index}`);
      }),
      // coffee blocks his unasked hand for the next Watch (JOKER §4)
      bus.on('buff:add', ({ owner, buff }) => { if (buff.id === 'food.coffee' && owner === `p:${this.selfId}`) { this.jokerSys.drinkCoffee(); this.persistSoon(); } }),
      // BONDS: picking up Mira's wrong number is showing up: it raises her bond once a Night (a 'talk' never would, and her N7 call needs bond 2)
      bus.on('phone:story', ({ id }) => {
        if (id.startsWith('mira')) this.bond({ kind: 'show', who: 'mira' });
        if (id === 'mira_n7') hearHint(this.chapterRec, 'mira');   // the kept pair, said outright (calls.ts gates it on mira.pair)
      }),
      // Selim's kept-pair line at the bar (food.ts says it under the generic 'bonds.selim' source, so the text tells it apart)
      bus.on('floor:say', ({ source, text }) => { if (source === 'bonds.selim' && text === t('bonds.selim.pairLine')) hearHint(this.chapterRec, 'selim'); }),
      bus.on('machine:result', (p) => { if (p.pid === this.selfId) this.advanceContracts('machine:result', p); }),
      bus.on('machine:round', (p) => { if (p.pid === this.selfId) { this.advanceContracts('machine:round', p); this.boilerRound(p.machineId); } }),
      bus.on('room:opened', () => { this.modsImpl.touch(); this.persistSoon(); this.notify(); }),
      // the shrine (wave C): a candle lit at a statue raises that god's Favour
      bus.on('shrine:favour', (e) => { if (e.pid === this.selfId) { this.pantheon.addFavour(e.god); this.persistSoon(); this.notify(); } }),
      bus.on('run:deposit', (p) => { if (p.pid === this.selfId) this.advanceContracts('run:deposit', { machineId: '', amount: p.amount }); }),
      bus.on('jackpot:win', (p) => { if (p.pid === this.selfId) this.advanceContracts('machine:jackpot', p); }),
      // a cutscene (the Collector speaks in them) holds the Watch clock
      bus.on('cutscene:start', () => { holdClock('cutscene', 180); }),
      bus.on('cutscene:end', () => { releaseClock('cutscene'); }),
    );
    this.jackpots = this.makeJackpotsApi();
    // THE EVENING: the phone belongs to the Home layer (solo only); an online run has none (`homePhone()` is null).
    this.hPhone = this.homeOn ? createPhone(this) : null;
    this.homeEcon = this.homeOn ? this.makeHomeEconomy() : null;
    this.luckMeter = createLuckMeter({
      x: (hook, base) => this.mod(hook, RUN_MACHINE, base),
      fx: (key) => this.pantheon.fx(key),
    }, () => this.modsImpl.touch());
    this.modsImpl.register(this.luckMeter.provider());
    // THE PROLOGUE (wave 72): a fresh Home-layer run opens in the apartment; a resumed save skips it (its Night is already on).
    this.prologue = this.homeOn && opts.prologue === true && resume === null;
    // a fresh run starts with an empty fridge; a resumed one gets its saved fridge in restore()
    if (this.homeOn && resume === null) fridgeRestore(undefined);

    if (resume) {
      this.restore(resume);
    } else {
      this.recomputeQuota();
      this.enter(this.rules.timed ? 'intermission' : 'play', 0);
      this.applyStartKit();
      this.applyMetaStart();
      // Night 1 opens with what the kit and the Foundations gave: the House notice floors its quota on it (a rich start raises the quota, never pays it)
      if (this.quotaMode) { this.houseWealth = this.coins + this.debtPaid; this.recomputeQuota(); this.persist(); }
    }
    this.prepareBoss();
  }

  // ── identity and time words ───────────────────────────────────────────────────────────────────────
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

  // ── wallet, pulls, bets ───────────────────────────────────────────────────────────────────────────
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
    const minBet = def.minBet;
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
    // FLOOR EVENTS: SINGLE LIGHT leaves one machine lit; every other machine refuses a play while it runs
    if (!this.watchEv.allowsPlay(src.machineId)) return this.refuse('floorEvent');
    const q: ModQuery = { pid: this.selfId, instance: src.mid };
    const lim = this.betLimits(src.machineId, src.mid);
    if (amount < lim.min || amount > lim.max) return this.refuse('limit');
    // THE KEEPSAKE STAKE (wave 75): an armed keepsake is the round's whole stake, so no coins and no coin-only confirm
    const ks = this.openRounds.has(src.mid) ? null : this.keepsakes.pending(src.mid, this.night());
    if (!ks && !this.confirmStake(amount, src, lim.min)) return this.refuse(STAKE_CONFIRM_REASON);
    const cost = ks ? 0 : Math.ceil(amount * this.mod('bet.costMult', src.machineId, 1, q));
    const base = o?.pulls ?? registry.get(src.machineId)?.def.actionCost ?? 1;
    const pullCost = Math.max(0, Math.round(this.mod('x.actionCostDelta', src.machineId, base, q)));
    if (!this.rules.unlimitedPulls && this.pullCount < pullCost) return this.refuse('pulls');
    if (cost > this.coins) { this.clearStakeArm(); return this.refuse('funds'); }
    this.refusal = null;
    this.clearStakeArm();
    if (ks) this.keepsakes.open(src.mid, this.night());

    if (!this.rules.unlimitedPulls) this.pullCount -= pullCost;
    this.watchPulls += pullCost;
    this.coins -= cost;
    this.stats.wagered = (this.stats.wagered ?? 0) + cost;
    this.tithe.played(0, cost);
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
    // a bet of a quarter of the pocket or more is a key moment: from Ink 6 his hand may take it unasked
    if (!ks && cost * 4 >= this.coins + cost) this.jokerUnasked(src.mid, src.machineId, amount);
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
    // LOKI'S HAND: the round pays 10 x the stake (capped by the quota) or nothing when he throws it; tagged 'joker', no stars
    const hand = !meta.raw && this.lokiHand?.mid === src.mid ? this.lokiHand : null;
    if (hand) { this.lokiHand = null; meta = { ...meta, tier: hand.help ? 'big' : 'none', tags: [...(meta.tags ?? []), 'joker'] }; }
    const paid = this.creditOf(gross, src, meta);
    const credited = hand ? (hand.help ? takeoverPayout(meta.bet, this.quota.due) : 0) : paid.credited;
    const pr = hand ? null : paid.pr;
    // FLOOR EVENTS: a resolved round (raw buy-ins and cash-outs are not rounds). After the payout, so the dare and the lamp apply to it.
    if (!meta.raw) {
      // net = what the round left in the pocket against the bet (the Crooked Table's refund counts the net losses at a table)
      this.watchEv.onPull(src.mid, gross > meta.bet, credited - meta.bet, src.machineId);
      if (credited > meta.bet) this.noteGrandWin(src.machineId, credited);
    }
    // THE KEEPSAKE STAKE and THE GHOST SEAT (wave 75): the round's result is the credited amount against the bet
    const ks = this.keepsakes.settle(src.mid, credited > meta.bet);
    if (ks) this.keepsakeSettled(ks);
    const gh = hand ? null : this.ghostSeat.round(this.night(), src.machineId, src.mid, meta.bet, credited);
    if (gh) this.ghostMatched(gh);
    if (pr && pr.excess > 0) this.feedJackpot('net', pr.excess);
    this.coins += credited;
    this.maxWallet = Math.max(this.maxWallet, this.coins);
    this.stats.paid = (this.stats.paid ?? 0) + credited;
    this.tithe.played(credited, 0);
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

  // ── modifiers ─────────────────────────────────────────────────────────────────────────────────────
  getModifier(hook: ModHook, machineId: MachineId, base: number, pid?: PlayerId): number { return this.mods.mod(hook, machineId, base, { pid }); }
  mod(hook: ModHook, machineId: MachineId, base: number, q?: ModQuery): number { return this.mods.mod(hook, machineId, base, q); }
  explain(hook: ModHook, machineId: MachineId, base: number, q?: ModQuery): ModBreakdown { return this.mods.explain(hook, machineId, base, q); }
  /** The luck hook base is 0: ŞANS (wave 73 re-tune) pays through `payout.mult` (1 % a star), not luck. */
  luck(machineId: MachineId, pid?: PlayerId): number { return this.mods.mod('luck', machineId, 0, { pid }); }
  /** THE LUCK METER (wave 73): the stars (−2..5) behind the payout bonus. */
  luckStars(): number { return this.luckMeter.stars(); }

  // ── THE KEEPSAKE STAKE and THE GHOST SEAT (wave 75) ───────────────────────────────────────────────
  /** A keepsake round ended. A win brings the keepsake back (the luck meter takes its star); a loss gives it to the House. */
  private keepsakeSettled(ks: KeepsakeOutcome): void {
    const name = t(`keepsake.${ks.id}.name`);
    bus.emit('keepsake:stake', { state: ks.state, id: ks.id, mid: ks.mid, star: ks.star });
    if (ks.state === 'won') { this.banner?.(t('keepsake.won', { name }), { hold: 3, size: 8 }); return; }
    if (ks.harmony !== 0) hooksOf(this.hPhone)?.harmony(ks.harmony);
    this.banner?.(`${t('keepsake.lost', { name })} ${t('keepsake.lost.spouse')}`, { color: '#ff8080', hold: 4, size: 8 });
  }
  /** The copy matched one of the player's rounds: one ŞANS star (the luck meter listens for `ghost:match`). */
  private ghostMatched(g: GhostMatch): void {
    bus.emit('ghost:match', { side: g.side, machineId: g.machineId, mid: g.mid, star: g.star });
    this.banner?.(t(g.side === 'lost' ? 'ghost.match.lost' : 'ghost.match.won'), { hold: 3, size: 8 });
  }
  /** The keepsakes the player owns: at home or on the table. */
  keepsakeOwned(): KeepsakeId[] { return this.keepsakes.owned(); }
  /** The keepsakes the House kept (the Debt Terminal sells them back). */
  keepsakeLost(): KeepsakeId[] { return this.keepsakes.lost(); }
  /** The keepsake carried to the casino tonight, or null. */
  keepsakeCarried(): KeepsakeId | null { return this.keepsakes.carried(); }
  /** The Evening's carry choice (Home only, before the lift): one keepsake to the casino, or none. False when refused. */
  keepsakeCarry(id: KeepsakeId | null): boolean {
    if (this.homeStage() !== 'evening' || this.ended) return false;
    if (!this.keepsakes.carry(id)) return false;
    bus.emit('keepsake:carry', { id });
    this.persistSoon();
    return true;
  }
  /** Arms the carried keepsake for the next bet at `mid`. Play only; one keepsake stake per Night. False when refused. */
  keepsakeStake(mid: InstanceId): boolean {
    if (!this.canPlay() || this.ended) return false;
    const id = this.keepsakes.carried();
    if (!this.keepsakes.arm(mid, this.night())) return false;
    if (id) this.banner?.(t('keepsake.stake.set', { name: t(`keepsake.${id}.full`) }), { hold: 3, size: 8 });
    return true;
  }
  /** A keepsake is carried tonight and no stake has used it yet this Night (the seat hint reads it). */
  keepsakeFreeTonight(): boolean { return this.keepsakes.carried() !== null && !this.keepsakes.stakedThisNight(this.night()); }
  /** Drops a waiting keepsake stake (no coins, nothing lost). */
  keepsakeStakeCancel(): void { this.keepsakes.disarm(); }
  /** The keepsake the next bet at `mid` stakes, or null. The seat HUD can poll this. */
  keepsakePending(mid: InstanceId): KeepsakeId | null { return this.keepsakes.pending(mid, this.night()); }
  /** The Debt Terminal's buy-back price for a lost keepsake, or null when it is not lost. */
  keepsakeBuyPrice(id: KeepsakeId): number | null { return this.keepsakes.buyBackPrice(id); }
  /** Buys a lost keepsake back for its price in coins. False when it is not lost, or the pocket is short. */
  keepsakeBuyBack(id: KeepsakeId): boolean {
    const price = this.keepsakes.buyBackPrice(id);
    if (price === null || this.ended) return false;
    const name = t(`keepsake.${id}.name`);
    if (!this.spend('coin', price, `keepsake:buy:${id}`)) {
      this.banner?.(t('keepsake.buy.short', { name }), { hold: 3, size: 8 });
      return false;
    }
    this.keepsakes.buyBack(id);
    this.banner?.(t('keepsake.buy.ok', { name }), { hold: 3, size: 8 });
    this.notify();
    this.persistSoon();
    return true;
  }
  /** The copy's seat for this Night (the machine kind, the seat, the pools), or null. */
  ghostSeatInfo(): ReturnType<GhostSeat['seat']> { return this.ghostSeat.seat(); }

  bonds(): Bonds { return this.bondBook; }
  bond(ev: BondEvent): BondChange {
    const night = this.night();
    const ch = this.bondBook.apply(night, ev);
    for (const d of ch.deltas) {
      bus.emit('bond:change', { who: d.who, from: d.from, to: d.to, why: d.why, night });
      bus.emit('floor:note', { text: t(d.line), tone: d.to > d.from ? 'good' : 'bad' });
    }
    if (ch.line) bus.emit('floor:note', { text: t(ch.line, { thing: t(`bonds.selim.thing.${ch.thing ?? 0}`) }), tone: 'info' });
    if (ch.deltas.length > 0 || ch.line) this.persist();
    return ch;
  }

  nextHot(): { mid: string; machineId: string } | null {
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
  }

  selimAnswer(yes: boolean): void {
    if (this.selimAsk !== 'ask' || this.ended) return;
    this.selimAsk = yes ? 'yes' : 'no';
    this.dawn();
  }

  // ── THE GRAND CASINO (wave 75): the four biggest wins, shown on the jackpot wall ───────────────────
  grandWins(): readonly GrandWin[] { return this.grandWinList; }
  private noteGrandWin(machineId: MachineId, amount: number): void {
    const list = [...this.grandWinList, { machineId, amount: Math.floor(amount) }].sort((a, b) => b.amount - a.amount);
    this.grandWinList = list.slice(0, GRAND_WIN_MAX);
  }

  // ── FLOOR EVENTS (wave 75): the run feeds the events its floor facts and applies what they hand back ──
  /** The floor facts the events read: the machine kinds open on the floor, the Night's spotlight kind, the Lobby crate spot. */
  private floorFacts(): WatchFloor {
    const link = this.worldLink;
    const open = (link?.machines() ?? []).filter((m) => !link?.locked?.(m.instance));
    return {
      machines: [...new Set(open.map((m) => m.machineId))],
      spotlight: this.spotlight.current()?.machineId ?? null,
      lobby: link?.lobbyCrate?.() ?? null,
    };
  }
  floorAct(): boolean {
    if (this.ended || !this.canPlay()) return false;
    if (this.watchEv.view()?.canAccept) {
      const took = this.watchEv.acceptDare();
      if (took) this.notify();
      return took;
    }
    return this.floorBid();
  }
  /** A STAGE AUCTION bid at the next legal price. The charge comes out of the pocket. */
  private floorBid(): boolean {
    const amount = this.watchEv.auctionNext();
    if (amount === null) return false;
    const r = this.watchEv.bidAuction(amount, this.coins);
    if (r.ok === false) {
      if (r.why === 'pocket') {
        bus.emit('floor:note', { text: t('event.watch.stage_auction.note.pocket', { next: amount }), tone: 'bad' });
        this.refuse('funds');
      }
      return false;
    }
    bus.emit('floor:note', { text: t('event.watch.stage_auction.note.bid', { b: amount, step: r.charge }), tone: 'good' });
    this.refusal = null;
    this.coins -= r.charge;
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -r.charge, reason: 'auction' });
    this.notify();
    this.persistSoon();
    return true;
  }
  floorCrate(pos: { x: number; z: number } | null, pressed: boolean): boolean {
    if (this.ended || !this.canPlay()) return false;
    return this.watchEv.openCrate(pos, pressed) !== null;
  }
  /** THE CROOKED TABLE: the three tables and what can be read at each now (null when the event is not live). */
  crookedView(): { tables: { mid: MachineId; tells: CrookedTell[] }[]; intro: boolean } | null { return this.watchEv.crookedView(); }
  /** True when `machineId` is one of the Crooked Table's three marked tables right now (the C prompt shows only there). */
  isCrookedTable(machineId: MachineId): boolean { return this.watchEv.isCrookedTable(machineId); }
  /**
   * The player calls the cheat at the table `machineId` (key C). A right call refunds double the loss there (capped at 25% of the
   * quota), +1 luck star, Heat -1; a wrong one costs a fee of 5% of the quota and Heat +1. True when the call was made.
   */
  floorCall(machineId: MachineId): boolean {
    if (this.ended || !this.canPlay()) return false;
    const r = this.watchEv.callCheat(machineId, this.quota.due);
    if (!r) return false;
    this.applyCrooked();
    return true;
  }
  /** Applies the Crooked Table's outcomes (refund, fee, luck, Heat, toasts, the Clerk's line) and feeds the Tally Sheet. */
  private applyCrooked(): void {
    const view = this.watchEv.crookedView();
    if (view) {
      // the TALLY-channel lines and their lesson (the maths belongs on the Sheet); each line goes out once per wording
      for (const l of sheetFromTells(view.tables)) {
        const k = JSON.stringify(l);
        if (this.crookedSheetSent.has(k)) continue;
        this.crookedSheetSent.add(k);
        bus.emit('crooked:sheet', l);
      }
    } else if (this.crookedSheetSent.size > 0) this.crookedSheetSent.clear();
    // BONDS: Tamsin's tables open (showing up for her floor event)
    if (view && this.crookedSheetSent.size === 0) this.bond({ kind: 'show', who: 'tamsin' });
    const P = 'event.watch.crooked_table.';
    for (const o of this.watchEv.takeCrooked()) {
      for (const l of sheetFromOutcome(o)) bus.emit('crooked:sheet', l);
      if (o.kind === 'heat') {
        hooksOf(this.hPhone)?.heat(o.heat, 'crooked');
        bus.emit('floor:note', { text: t(P + 'note.heatUp'), tone: 'bad' });
      } else if (o.kind === 'expired') {
        bus.emit('floor:note', { text: t(P + 'note.expired'), tone: 'info' });
        // a cheat you could not prove, left uncalled, is Tamsin defended (bonds §10)
        if (o.rigPlays < HABIT_AFTER) this.bond({ kind: 'defend', who: 'tamsin' });
      } else {
        this.crookedCall(o);
      }
    }
  }
  private crookedCall(o: CallResult): void {
    const P = 'event.watch.crooked_table.';
    const tn = o.table + 1;
    if (o.right) {
      if (o.refund > 0) this.earn('coin', o.refund, 'crooked.refund');
      bus.emit('floor:note', { text: t(o.refund > 0 ? P + 'note.right' : P + 'note.right0', { t: tn, refund: o.refund }), tone: 'good' });
      bus.emit('floor:luck', { star: o.luck, why: 'crooked' });
    } else {
      const fine = Math.min(o.fine, Math.floor(this.coins));
      if (fine > 0) this.spend('coin', fine, 'crooked.fine');
      bus.emit('floor:note', { text: t(P + 'note.wrong', { t: tn, fine }), tone: 'bad' });
      this.bond({ kind: 'betray', who: 'tamsin' });   // a false accusation at her tables
    }
    hooksOf(this.hPhone)?.heat(o.heat, 'crooked');
    bus.emit('floor:say', { text: t(P + (o.right ? 'clerk.right' : 'clerk.wrong')), speaker: t(P + 'clerk.speaker'), voice: 'clerk', source: 'crooked.clerk' });
    this.notify();
    this.persistSoon();
  }
  /** Applies what the floor events handed back since the last frame: Tickets, tonics, charms, Watch clock time, and the banners. */
  private applyFloorOutcomes(): void {
    for (const o of this.watchEv.takeOutcomes()) {
      if (o.kind === 'raise') {
        this.banner?.(t('event.watch.stage_auction.raised', { n: o.price }), { hold: 2.5, size: 8 });
      } else if (o.kind === 'dare') {
        this.banner?.(t(`event.watch.last_call_dare.${o.result}`), { hold: 3, size: 8 });
      } else if (o.kind === 'crate') {
        this.floorAward(o.reward);
        this.banner?.(this.floorAwardText(o.reward), { hold: 2.5, size: 8 });
      } else if (o.won && o.award) {
        bus.emit('floor:note', { text: t('event.watch.stage_auction.note.won', { b: o.spent }), tone: 'good' });
        this.floorAward(o.award);
        this.banner?.(`${t('event.watch.stage_auction.won')} ${this.floorAwardText(o.award)}`, { hold: 3, size: 8 });
      } else {
        if (o.consolation) this.floorAward(o.consolation);
        bus.emit('floor:note', { text: t(o.spent > 0 ? 'event.watch.stage_auction.note.lost' : 'event.watch.stage_auction.note.none', { b: o.spent }), tone: 'bad' });
        this.banner?.(t(o.spent > 0 ? 'event.watch.stage_auction.lost' : 'event.watch.stage_auction.none'), { hold: 3, size: 8 });
      }
    }
  }
  private floorAward(a: FloorAward): void {
    switch (a.kind) {
      case 'ticket': this.earn('ticket', a.n, 'floor'); break;
      case 'tonic': this.buffSys.buffs.add(a.id, { pid: this.selfId, source: { kind: 'system', id: 'floor' } }); break;
      case 'time': this.clock.extend(a.s); break;
      case 'charm': this.floorCharm(); break;
    }
    this.notify();
  }
  /** A charm from the Common pool that the player does not hold yet. With no free peg (or nothing new), a Ticket instead. */
  private floorCharm(): void {
    const pool = this.charmPool('common').filter((c) => !this.charmBox.has(this.selfId, c.id));
    const pick = pool.length > 0 ? this.rng.fork(`floor.charm.${this.index}.${this.watch}`).pick(pool) : null;
    if (pick && this.charmBox.add(this.selfId, pick.id, this.pegs())) return;
    this.earn('ticket', 1, 'floor');
  }
  private floorAwardText(a: FloorAward): string {
    switch (a.kind) {
      case 'ticket': return a.n === 1 ? t('event.watch.crate_drop.got.ticket') : t('event.watch.stage_auction.award.ticket', { n: a.n });
      case 'tonic': return t('event.watch.stage_auction.award.tonic');
      case 'time': return t('event.watch.stage_auction.award.time', { n: a.s });
      case 'charm': return t('event.watch.crate_drop.got.charm');
    }
  }
  /** THE SECOND NAME (wave 73): the live chapter record (story code reads it and marks beats through `chapter.ts`). */
  chapterRecord(): ChapterRecord { return this.chapterRec; }

  // ── THE ENDINGS (story A5, docs/STORY_BIBLE.md "A5 wiring plan") ───────────────────────────────────────
  kitchenDone(r: Pick<FlowResult, 'left' | 'wager' | 'pairs' | 'cracks'>): void {
    if (this.ended || r.left) return;
    const c = this.chapterRec;
    if (r.cracks.you > 0) c.broken = true;
    if (r.wager) {
      c.kitchen = r.wager;
      c.pairs = Math.max(0, Math.trunc(r.pairs));
    }
    this.persistSoon();
    if (r.wager === 'lose') this.endRun('lost', 'kept');   // KEPT: you stay
  }

  burningWager(r: { wager: 'win' | 'lose'; cracks: number; lokiHand?: boolean; word?: boolean }): void {
    if (this.ended) return;
    const c = this.chapterRec;
    c.wager = r.wager;
    c.cracks = Math.max(0, Math.trunc(r.cracks));
    c.lokiHand = r.lokiHand === true;
    c.word = r.word === true;
    if (r.wager === 'win') this.endRun('escaped', 'elevator');
    else this.endRun('lost', 'chair');
  }

  wagerDue(): boolean { return this.homeOn && this.topside && !this.ended && this.chapterRec.wager === null; }

  endingFacts(end?: { result: RunSummary['result']; ending?: string }): EndingFacts {
    const c = this.chapterRec;
    const f: EndingFacts = {
      ...freshFacts(),
      night: nightDef(this.index).no, paid: this.topside, fell: end?.result === 'fell', seals: this.soulMarkCount,
      descended: end?.ending === 'descend', deal: c.deal, kitchen: c.kitchen, pairs: c.pairs,
      wager: c.wager, cracks: c.cracks, lokiHand: c.lokiHand, wordAtMatchPoint: c.word,
      cameHome: this.jokerSys.cameHome, trust: this.jokerSys.trust, visitUsed: this.jokerSys.snapshot().used.visit === 1,
      harmony: this.hPhone?.harmony() ?? HARMONY_START, waiting: this.bondBook.floor(),
    };
    return f;
  }

  endingRecord(): EndingRecord | null { return this.endRec; }

  /** PAID IN FULL: the Night 7 deal was signed, so the run ends at that Dawn (or, answered in the Evening, before Night 8 opens). */
  private dealEnds(): boolean {
    if (this.ended || !this.quotaMode || nightDef(this.index).no !== DEAL_NIGHT || this.chapterRec.deal !== 1) return false;
    this.endRun('lost', 'paid');
    return true;
  }
  charms(pid?: PlayerId): readonly CharmState[] { return this.charmBox.list(pid ?? this.selfId); }
  loseCharm(id: string): boolean {
    // THE HOME COMPUTER (wave 77): with the deadbolt in, a Picker at the door cannot reach a charm
    if (this.hStage === 'evening' && this.homeEcon?.has('deadbolt')) {
      this.banner?.(t('pc.deadbolt.held'), { hold: 3, size: 8 });
      return false;
    }
    const def = charmDef(id);
    if (!def || def.rarity === 'legendary' || def.rarity === 'cursed') return false;
    if (!this.charmBox.remove(this.selfId, id)) return false;
    this.notify();
    this.persist();
    return true;
  }

  // ── pools and info ──────────────────────────────────────────────────────────────────────────────────
  jackpot(pool: string): number { return this.pools.get(pool)?.value ?? 0; }
  jackpotAdd(pool: string, amount: number): void { this.feedJackpot(pool, amount); }
  jackpotClaim(pool: string, src: EcoSource): number { return this.claimJackpot(pool, src); }

  debt(_pid?: PlayerId): DebtState {
    return { index: this.index, due: this.quota.due, paid: this.debtPaid, deadlineAt: 0, floor: this.index + 1, total: BASE_RUN_NIGHTS };
  }
  timeLeft(): number { return this.canPlay() || this.phase === 'closing' ? this.clock.remaining : 0; }
  isLocked(machineId: MachineId): boolean { if (this.owned.has(machineId) || this.mod('x.cheat.openAll', RUN_MACHINE, 0) > 0) return false; return isLockedFor(machineId, effectiveNight(this.night(), this.nightPaid, this.topside), this.mode, this.seed); }
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
  /** The player's own phone (spouse and Collector threads). Null when the Home layer is off (online, tests). */
  homePhone(): HomePhoneApi | null { return this.hPhone; }
  homeEconomy(): HomeEconomy | null { return this.homeEcon; }

  /**
   * THE HOME COMPUTER (wave 77): the economy's port onto the run (the pocket, the Heat, the Pawn's free rerolls), and the computer
   * UI on the apartment desk. The UI module is DOM-only, so a browser run imports it lazily; Node tests and the bench skip it.
   */
  private makeHomeEconomy(): HomeEconomy {
    const econ = createHomeEconomy({
      seed: this.seed,
      night: () => this.night(),
      nightsPaid: () => this.stats.nightsPaid ?? 0,
      wallet: () => this.coins,
      spend: (n, why) => {
        if (this.ended || !this.spend('coin', n, why)) return false;
        this.persistSoon();
        return true;
      },
      earn: (n, why) => { this.earn('coin', n, why); this.persistSoon(); },
      heat: () => this.hPhone?.heat() ?? 0,
      addFreeReroll: (n) => { this.freeRerolls += n; this.notify(); },
      fridgeRoom: () => Math.max(0, FRIDGE_MAX - fridgeOf().items().length),
      deliver: (food) => addToFridge(food),
      open: () => this.hStage === 'evening' && !this.prologue && !this.ended,
    });
    if (typeof document !== 'undefined') {
      void import('./home/computer.ui').then((m) => {
        if (this.computerUiOff === null && !this.disposedUi) this.computerUiOff = m.mountComputerUi(this);
      }).catch((e: unknown) => { log.warnOnce('run:computerUi', 'run', `computer UI failed to load: ${String(e)}`); });
    }
    return econ;
  }
  private disposedUi = false;

  /** The Night summary's books for the Night in progress (float, interest, tickets). A copy: the caller cannot change them. */
  nightLedger(): Readonly<NightLedger> { return { ...this.ledger }; }

  /** The Dawn receipt of the last paid Night (a copy), or null before the first paid Dawn. */
  dawnReceipt(): DawnReceipt | null { return this.dawnBook ? { ...this.dawnBook } : null; }

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
    // THE HOME COMPUTER (wave 77): the deadbolt gives half of a knock's toll back (the visitor got less through the door)
    if (cur === 'coin' && reason === 'knock.toll' && this.homeEcon?.has('deadbolt')) {
      const back = Math.floor(amount * DEADBOLT_TOLL_BACK);
      if (back > 0) {
        this.earn('coin', back, 'econ:deadbolt');
        this.banner?.(t('pc.deadbolt.toll', { n: back }), { hold: 3, size: 8 });
      }
    }
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

  // ── DebtRun controls ──────────────────────────────────────────────────────────────────────────────
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
    if (this.clockAcc >= 1) {
      this.clockAcc -= 1;
      this.emit('run:clock', { remaining: this.clock.remaining });
    }
    this.buffSys.tick(dt);
    this.hotline.tick(dt);
    this.rescue.tick(dt);
    this.hPhone?.tick(dt);   // the phone's own gate keeps its messages to the Watches (any phase may tick it)
    this.tickSafety(dt);
    tickClockHold(dt);
    this.itemSys.tick(dt);
    if (this.duelAfter.length) this.tickDuelAfter(dt);
    // THE PANTHEON: the Dawn offer's 20 s timer runs in intermission too (OPEN THE FLOOR settles it early with the leftmost).
    const auto = this.pantheon.tick(dt);
    if (auto) this.boonsTaken(auto, 'auto');
    if (this.phase === 'play' || this.phase === 'lastCall') this.tycoonSys.tick(dt);
    if (!this.rules.timed) return;
    this.applyFloorOutcomes();
    this.applyCrooked();
    if (this.hStage !== null) this.tickHome(dt);
    if (this.ended) return;   // the doom ended the run
    switch (this.phase) {
      case 'bell':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.startPlay();
        break;
      case 'play':
      case 'lastCall':
        if (!clockHeld()) { this.clock.tick(dt); this.watchEv.tick(dt); }   // tutorial steps 1-3, Collector lines and cutscenes hold the Watch clock (and its floor event)
        this.watchEv.watchLeft(this.clock.remaining);   // a LAST CALL DARE arms in the last 20 s of the Watch clock
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
        if (this.hStage === 'doomed') break;   // a missed quota: the doom walks on its own clock (tickHome)
        if (this.selimAsk === 'ask') {        // Selim's last seal: the Dawn waits on the answer, and silence is a no
          this.selimAskLeft -= dt;
          if (this.selimAskLeft <= 0) this.selimAnswer(false);
          break;
        }
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.dawn();
        break;
      default:
        break;
    }
  }

  startWatch(): boolean {
    if (this.prologue) return false;   // the prologue holds the clock: Watch 1 starts when the lift lands (finishPrologue)
    if (this.ended || !this.quotaMode || this.topside || this.nightDone) return this.refuse('noWatch');
    if (this.phase !== 'intermission') return this.refuse(this.phaseRefusal());
    this.refusal = null;
    const nd = nightDef(this.index);
    const isOvertime = this.watch === this.overtimeIdx;
    this.ensureBoss(); // before the clock and pull mods are read below
    // the Watch's floor event (wave 43) rolls before the clock and pull mods are read (cold_snap and the clock/pull effects)
    this.watchEv.begin(this.rng, this.index + 1, this.watch, !!this.bossToday());
    this.jokerSys.beginWatch(this.watch + 1);
    this.jokerSaid.clear();
    this.jokerHere = null;
    this.lokiHand = null;
    if (this.watch === 0) {
      bus.emit('night:begin', { night: this.index + 1 });   // the first Watch of a Night: the grand light show
      // the ghost's table is news of the floor: said when the Night's first Watch opens, not at home on waking (over a home scene)
      const gs = this.ghostSeat.seat();
      if (gs && gs.night === this.index + 1 && gs.machineId) this.banner?.(t('ghost.seat', { machine: machineName(gs.machineId as MachineId) }), { hold: 4, size: 8 });
    }
    bus.emit('watch:begin', { night: this.index + 1, watch: this.watch + 1 });
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
    this.tithe.begin(nd.no, isOvertime);   // Watch tithe (wave 58): this Watch's target is 12 % of the Night quota, from Night 3
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
    if (this.prologue) return false;
    if (this.ended || !this.quotaMode || this.topside) return this.refuse('noWatch');
    if (this.hStage === 'doomed') return this.refuse('noWatch');
    if (this.phase !== 'intermission') return this.refuse(this.phaseRefusal());
    if (!this.nightDone) return this.refuse('nightUnpaid');
    // THE EVENING: the lever at home is the bed (the fade, then the next Night); mid-lift or mid-sleep it waits.
    if (this.hStage === 'evening') return this.homeSleep();
    if (this.hStage !== null) return this.refuse('noWatch');
    // THE PANTHEON: with the panel on screen the lever waits for a pick (the panel's own timer still auto-picks, so nothing
    // soft-locks). Headless runs and tests have no panel: there an open offer is settled by its leftmost cards.
    if (this.boonGate && this.pantheon.pending()) return this.refuse('nightCard');
    this.refusal = null;
    this.settleBoons();
    // The Home layer takes the lever for the lift (solo Debt Run, not Night 8); every other run opens the next Night at once.
    if (this.homeLiftReady()) { this.setHome('ride', HOME_TIMING.ride); return true; }
    this.beginNight();
    return true;
  }

  /** The next Night begins (the old OPEN THE FLOOR body): the lever without the Home layer, and the end of the bed's sleep. */
  private beginNight(): void {
    if (this.dealEnds()) return;
    this.settleBoons();   // a no-op after openFloor settled the offer; the sleep arrives here with it closed
    // Ascent: the pit rises one floor. The Elevator Token pays 5 % of the pocket (max 300 × SI).
    if (this.charmBox.has(this.selfId, 'elevator_token')) {
      const gain = Math.min(Math.floor(this.coins * 0.05), 300 * nightDef(this.index).si);
      if (gain > 0) this.earn('coin', gain, 'charm:elevator_token');
    }
    this.index += 1;
    this.jokerSys.beginNight(this.index + 1);
    // BONDS: a betrayed Collector leans a little harder every Night
    if (this.bondBook.against().includes('collector')) hooksOf(this.hPhone)?.heat(1, 'grudge');
    // THE HOME COMPUTER (wave 77): the Evening's limits reset, and the framed photo gives its ŞANS star
    this.homeEcon?.newNight(this.index + 1);
    // THE KEEPSAKE STAKE and THE GHOST SEAT (wave 75): a new Night drops a waiting stake; the copy sits where last Night's losses were
    this.keepsakes.newNight();
    const seat = this.ghostSeat.beginNight(this.index + 1);
    bus.emit('ghost:seat', seat ? { night: seat.night, machineId: seat.machineId, mid: seat.mid } : { night: this.index + 1, machineId: null, mid: null });
    this.ledger = { night: this.index + 1, float: 0, interest: 0, tickets: 0, cut: 0, carried: 0 };   // a new Night's books start empty (before its float)
    const nd = nightDef(this.index);
    this.watches = Math.max(1, nd.watches + this.pantheon.fx('watchAdd'));   // Short Night (ash_short) drops a Watch
    this.watch = 0;
    this.overtimeIdx = -1;
    this.nightDone = false;
    this.metFired = false;
    this.skipRest = 0;
    this.discount = this.nextDiscount;
    this.nextDiscount = 0;
    this.quota.claimed = [];
    this.loanQuota = 0; this.rescuesUsed = 0; this.rescueCool = 0;
    this.tithe.newNight();
    this.shiftState.index = this.index;
    this.shiftState.floor = this.index + 1;
    this.shiftState.stake = nd.si;
    this.shiftState.segment = { index: 0, count: this.watches };
    // Cooked Books (ledg_books, once): this Night's quota has no wealth floor
    if (this.mod('x.house.noticeOff', RUN_MACHINE, 0) > 0) { this.houseWealth = 0; this.pantheon.spend('ledg_books'); }
    this.houseFloat();
    this.recomputeQuota();
    this.prepareBoss();
    // Machine of the Night (wave 55): one open floor kind is this Night's spotlight; the banner names it.
    const spot = this.spotlight.begin(this.index, (this.worldLink?.machines() ?? [])
      .filter((m) => !this.worldLink?.locked?.(m.instance) && isSpotlightEligible(m.machineId, registry.get(m.machineId)?.def.category))
      .map((m) => ({ machineId: m.machineId, instance: m.instance })));
    if (spot) this.banner?.(spotlightStartLine(spot, machineName(spot.machineId)), { color: '#ffd34a', hold: 4, size: 16 });
    this.enter('intermission', 0);
    this.persist();
  }

  // ── THE EVENING (wave 69): the lift home, the apartment, the bed, and the doomed ride ───────────────────
  homeStage(): HomeStage | null { return this.hStage; }
  homeState(): { stage: HomeStage | null; left: number; lights: boolean; chain: boolean } {
    return { stage: this.hStage, left: this.hLeft, lights: this.hLights, chain: this.hChain };
  }
  homeFlags(f: { lights?: boolean; chain?: boolean }): void {
    if (typeof f.lights === 'boolean') this.hLights = f.lights;
    if (typeof f.chain === 'boolean') this.hChain = f.chain;
    this.persistSoon();
  }

  /** The lever would take the lift: Home layer on, a paid Night (not the Topside Night 8), the floor lever idle, the run alive. */
  homeLiftReady(): boolean {
    return this.homeOn && this.quotaMode && !this.ended && !this.topside && this.hStage === null
      && this.phase === 'intermission' && this.nightDone && this.index + 1 !== BASE_RUN_NIGHTS;
  }

  homeSleep(): boolean {
    if (this.ended || this.hStage !== 'evening') return false;
    this.setHome('sleep', HOME_TIMING.sleep);
    return true;
  }

  homeHold(on: boolean): void { this.hHold = on && this.hStage === 'evening'; }

  prologueOn(): boolean { return this.prologue; }

  finishPrologue(): boolean {
    if (!this.prologue) return false;
    this.prologue = false;
    this.emit('home:prologue', { state: 'done' });
    this.notify();
    // the lift has landed: Night 1 Watch 1 opens now, on the floor (the bell and the clock start here, not before)
    if (this.startWatch()) this.banner?.(t('ingame.night', { n: this.night() }), { hold: 3, size: 16 });
    this.persist();
    return true;
  }

  homeSaveNow(): void { this.persist(); }

  /** Moves the Home stage, tells the world (`home:stage`) and saves. `null` = back on the casino floor. */
  private setHome(stage: HomeStage | null, left: number): void {
    this.hStage = stage;
    this.hLeft = left;
    if (stage !== 'evening') this.hHold = false;
    this.emit('home:stage', { stage });
    this.notify();
    this.persist();
  }

  /** The Home clock: the ride arrives, the Evening falls asleep on its own, the bed opens the next Night, the doom ends the run. */
  private tickHome(dt: number): void {
    if (this.hHold) return;   // the walk home: the Evening starts at the door
    this.hLeft -= dt;
    if (this.hLeft > 0) return;
    switch (this.hStage) {
      case 'ride':
        // arrival: the apartment is lit and the chain is off, then the phone looks at the Evening (spouse present or not, requests)
        this.hLights = true; this.hChain = false;
        this.hPhone?.onEvening();
        this.setHome('evening', HOME_TIMING.evening);
        break;
      case 'evening':
        this.setHome('sleep', HOME_TIMING.sleep);   // the auto-sleep: nothing at home can soft-lock the run
        break;
      case 'sleep':
        this.hStage = null; this.hLeft = 0;
        this.beginNight();
        this.emit('home:stage', { stage: null });
        this.lokiIntro();
        break;
      case 'doomed':
        this.fall('shot');
        break;
      default:
        break;
    }
  }

  /** A missed quota in a Home-layer run: the ride home happens anyway, and the Collector's men are waiting (see `tickHome`). */
  private startDoomed(): void {
    this.hLights = true; this.hChain = false;
    this.setHome('doomed', HOME_TIMING.doomed.end);
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

  // ── the bank (wave 27): WITHDRAW and the numbers the Debt Terminal shows ─────────────────────────────
  /**
   * The Pawn (charms and the STAMPS tab) is open between Watches and during the Closing window (director decision 1: the
   * player can still shop while the Watch ends). Not in Bell, play, Settle or Dawn.
   */
  private shopOpen(): boolean {
    return (this.phase === 'intermission' || this.phase === 'closing') && !this.ended;
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

  /**
   * THE SEAL (Overshoot depth, decision D2): while the bank holds more than tonight's quota, the coins above the quota cannot leave
   * until Dawn. A WITHDRAW that asks for them is refused as a whole ('locked'). They keep earning interest at each Settle, and
   * BREAK SEAL (`breakSeal`) takes them out at the price of tonight's overpay tiers (`sealBroken`). Deposits still go in.
   */
  overshootLocked(): boolean {
    return this.quotaMode && !this.nightDone && !this.sealBroken && this.sealHeld() > 0;
  }

  /** The coins the seal holds now: the bank above tonight's quota that a WITHDRAW could take (`bank.ts` sealCoins). */
  private sealHeld(): number {
    return sealCoins({ debtPaid: this.debtPaid, granted: this.bankGranted, due: this.quota.due });
  }

  /** The seal is on and a WITHDRAW window is open (the terminal shows it and BREAK SEAL works). */
  private sealedNow(): boolean {
    return this.withdrawOpen() && this.overshootLocked();
  }

  /** The coins WITHDRAW may take now: none while the Watch is shut or the overshoot is locked. */
  private bankWithdrawable(): number {
    return this.withdrawOpen() && !this.overshootLocked() ? withdrawable(this.bankInput()) : 0;
  }

  /**
   * The overpay principal (decision D1): the bank minus the quota credit that never was cash minus the interest earned this Night.
   * Pocket coins put in count, and interest does not, so the tiers are earned by play. Withdrawals take principal first (`takeOut`).
   */
  private principalNow(): number {
    const balance = Math.max(0, Math.floor(this.debtPaid));
    return Math.min(balance, Math.max(0, balance - Math.floor(this.bankGranted) - Math.floor(this.nightInterest)));
  }

  private bankInput(): BankInput {
    return {
      debtPaid: this.debtPaid, granted: this.bankGranted, due: this.quota.due, rate: this.liveRate(),
      watchPulls: this.watchPulls, churn: churnOf(this.watchWd, this.watchDepCoins),
    };
  }

  watchTithe(): TitheView {
    return this.tithe.view();
  }

  bank(): BankView {
    const i = this.bankInput();
    const due = Math.max(0, Math.floor(this.quota.due));
    return {
      balance: bankBalance(i),
      withdrawable: this.bankWithdrawable(),
      pocket: Math.floor(this.coins),
      due,
      // A paid Night owes nothing: after Dawn the books are reset (debtPaid 0) but the quota still reads the paid Night.
      left: this.nightDone ? 0 : Math.max(0, due - Math.floor(this.debtPaid)),
      ratePct: ratePercent(i.rate),
      interestNext: interestNext(i),
      interestAt: (balance: number) => interestFor(interestBase(balance, i.churn), due, i.rate),
      pullsToQualify: this.phase === 'intermission' || this.phase === 'bell' ? pullsToQualify(0) : pullsToQualify(this.watchPulls),
      interestCap: Math.floor(2 * due * Math.max(0, i.rate)),
      open: this.withdrawOpen(),
      settleLeft: this.phase === 'settle' ? Math.max(0, this.phaseLeft) : 0,
      pullsLeft: Number.isFinite(this.pullCount) ? this.pullCount : 0,
      minBet: this.cheapestBet(),
      principal: this.principalNow(),
      sealed: this.sealedNow(),
      sealCoins: this.sealedNow() ? this.sealHeld() : 0,
      sealBroken: this.sealBroken,
    };
  }

  /**
   * OVERSHOOT view: the overpay principal against the overpay tiers (the same comparison the Dawn grant uses, `principal ÷ due`).
   * `target` is the first whole coin count at a tier's ratio, so the HUD reads "principal/target" and the coins to go. Null once a
   * broken seal has forfeited the tiers for the Night (there is no overshoot left to chase).
   */
  overshootView(): OvershootView | null {
    if (this.sealBroken) return null;
    const due = Math.max(0, Math.floor(this.quota.due));
    const balance = this.principalNow();
    const id = tierReached(balance, due);
    const reached = id === null ? -1 : OVERSHOOT_TIERS.findIndex((t) => t.id === id);
    const nextTier = OVERSHOOT_TIERS[reached + 1];
    if (due <= 0 || !nextTier) return { balance, due, tier: id, reached, next: null };
    let target = Math.ceil(due * nextTier.ratio);
    while (target / due < nextTier.ratio) target++;
    while (target > 0 && (target - 1) / due >= nextTier.ratio) target--;
    return { balance, due, tier: id, reached, next: { id: nextTier.id, target, gap: Math.max(0, target - balance) } };
  }

  withdrawPreview(amount: number): WithdrawPreview {
    const i = { ...this.bankInput(), principal: this.sealBroken ? 0 : this.principalNow() };
    const open = this.withdrawOpen() && !this.overshootLocked();
    return previewWithdraw(open ? i : { ...i, granted: Number.MAX_SAFE_INTEGER }, amount);
  }

  withdraw(amount: number): number {
    if (!this.withdrawOpen()) return 0;
    const want = Math.floor(Number.isFinite(amount) ? amount : 0);
    // The seal refuses the whole ask: 'locked' has its own line on the terminal. BREAK SEAL is the way to take the overpay out.
    if (want > 0 && this.overshootLocked()) { this.refuse('locked'); return 0; }
    return this.takeOut(want);
  }

  /**
   * BREAK SEAL (decision D2): the coins above the quota go back to the pocket now, and tonight's overpay tiers are forfeit
   * (`sealBroken`), so the Watch can always act. Returns the coins moved (0 = refused: no seal to break).
   */
  breakSeal(): number {
    if (!this.withdrawOpen()) return 0;
    const held = this.sealHeld();
    if (!this.overshootLocked() || held <= 0) { this.refuse('noSeal'); return 0; }
    this.sealBroken = true;
    hooksOf(this.hPhone)?.heat(1, 'seal');   // wave 71: breaking the seal heats the Collector
    return this.takeOut(held);
  }

  /** Moves up to `want` coins from the bank to the pocket (what the bank can give back): the one place a WITHDRAW lands. */
  private takeOut(want: number): number {
    const amt = Math.min(want, withdrawable(this.bankInput()));
    if (amt <= 0) return 0;
    this.refusal = null;
    // principal first, then the interest it earned: a coin taken out of the bank stops being principal before it stops being interest
    const fromInterest = Math.max(0, amt - this.principalNow());
    this.nightInterest = Math.max(0, this.nightInterest - fromInterest);
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
        // a sealed bank still has a way out: BREAK SEAL takes the coins above the quota (the terminal's second press)
        bank: this.sealedNow() ? this.sealHeld() : this.bankWithdrawable(),
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
    this.hPhone?.dispose();
    this.disposedUi = true;
    this.computerUiOff?.();
    this.computerUiOff = null;
    this.luckMeter.dispose();
    clearClockHolds();
    this.buffSys.dispose();
    this.itemSys.dispose();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  // ── phases ─────────────────────────────────────────────────────────────────────────────────────────
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
          this.nightInterest += interest;      // not overpay principal (decision D1)
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
    // Watch tithe (wave 58): before the quota is read again, so a missed tithe's shortfall is part of tonight's quota.
    const tithe = this.tithe.settle();
    if (tithe) this.settleTithe(tithe, this.watch);
    this.syncQuota();
    this.checkMet();
    this.emit('quota:update', { quota: this.quota });
    this.persist();
  }

  /**
   * Watch tithe (wave 58): the Settle's outcome. Met pays its Ticket. Missed adds the shortfall to tonight's quota, and the quota
   * met flag is read again so a Night already paid is short by the shortfall (the Night is not lost, only the pocket must pay it).
   */
  private settleTithe(r: TitheResult, watch: number): void {
    if (r.shortfall > 0) {
      this.quota.due += r.shortfall;
      this.metFired = this.debtPaid >= this.quota.due;
    }
    if (r.tickets > 0) this.earn('ticket', r.tickets, 'tithe');
    this.emit('run:tithe', { pid: this.selfId, state: r.state, watch, target: r.target, earned: r.earned, shortfall: r.shortfall, tickets: r.tickets });
    // The HUD shows the met / missed toast from `run:tithe` (menu/hud.ts); no second banner here.
  }

  // ── tycoon: owned machines (wave 28) ─────────────────────────────────────────────────────────────────
  /** Base quota the prices and cuts scale with: tonight's, or the next Night's once tonight is paid. */
  private priceQuota(): number { return nightQuota(this.index + (this.nightDone && !this.topside ? 1 : 0)); }

  buyPriceOf(machineId: MachineId): number {
    if (this.ended || !isProgressive(this.mode) || this.owned.has(machineId) || !tierOf(machineId)) return 0;
    if (this.night() < FIRST_UNLOCK_NIGHT) return 0;   // Night 1 is the three starters only: the tarps just say when they open
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
      if (this.index === 1 && this.watch === 1) this.godsBeat();
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
    this.releaseMarkEscrow();   // a Mark still on the table is on the card again before the card is read for a seal
    const due = this.quota.due;
    let paid = this.debtPaid >= due;
    // Rounding Error (ledg_round): a shortfall of up to 5 % is written off, at each Dawn
    if (!paid && due - this.debtPaid <= this.pantheon.fx('writeOffPct') * due) {
      this.debtPaid = due;
      paid = true;
    }
    // Overtime (ash_overtime, the Ash Rite, once a run): a short Dawn first plays one more Watch, before a seal is taken
    if (!paid && this.pantheon.fx('overtime') > 0) {
      this.pantheon.spend('ash_overtime');
      this.overtimeIdx = this.watches;
      this.watches += 1;
      this.watch = this.overtimeIdx;
      this.enter('intermission', 0);
      this.persist();
      return;
    }
    // THE NAME SEALS (docs/BLESSINGS.md §1): a short Dawn with 2+ seals costs one seal, not the run. The last seal never pays a miss, and
    // neither does the last Night (a miss must not walk the card out of the door).
    // SELIM (bonds §10): at bond 2+ a seal of his name covers a short quota first. His last seal asks (it makes him still).
    if (!paid && !this.topside && this.bondBook.has('selim.cover') && this.bondBook.selim().seals > 0) {
      if (this.bondBook.selim().seals === 1 && this.selimAsk === null) {
        this.selimAsk = 'ask';
        this.selimAskLeft = SELIM_ASK_SEC;
        bus.emit('selim:ask', { night: this.night() });
        return;   // tick holds the Dawn; selimAnswer runs it again
      }
      const ok = this.selimAsk !== 'no' && !this.bond({ kind: 'lend', coins: Math.ceil(due - this.debtPaid) }).refused;
      if (ok) { this.debtPaid = due; paid = true; }
    }
    this.selimAsk = null;
    const sealed = !paid && this.soulMarkCount >= 2 && !this.topside && nightDef(this.index).no < BASE_RUN_NIGHTS;
    if (!paid && !sealed) {
      if (this.bondBook.useOnce('collector.visit')) {
        // THE VISIT (Collector at bond 3): once a run he holds the door, and the miss is written off for one more Dawn
        bus.emit('floor:note', { text: t('bonds.collector.visit'), tone: 'good' });
        this.debtPaid = due;
        paid = true;
      } else {
        // THE EVENING: a solo Home-layer run takes the ride home first (the Collector's men are at the door); the trapdoor is for the rest
        if (this.homeOn) { this.startDoomed(); return; }
        this.fall();
        return;
      }
    }
    const memory = sealed ? this.takeSeal() : undefined;
    this.jokerOut(this.jokerSys.dawn());   // after the Dawn checks (J4 settles his promise here first)
    // The Dawn receipt, read once before anything resets: the quota, the deposits that paid it, the interest on them and the tithes
    // the Night's missed Watches added. The Night Cards panel reads this snapshot only (never the live books after the reset below).
    const bankAtDawn = Math.max(0, Math.floor(this.debtPaid));
    const interestAtDawn = Math.max(0, Math.floor(this.nightInterest));
    this.dawnBook = {
      night: nightDef(this.index).no, due: Math.max(0, Math.floor(due)), paid: bankAtDawn,
      interest: interestAtDawn, tithe: Math.max(0, Math.floor(this.tithe.addedQuota())),
      ...(memory ? { memory, seals: this.soulMarkCount } : {}),
    };
    // After the receipt is booked: a `quota:sealed` listener (the sealed receipt panel) reads `dawnReceipt()` while it is emitted.
    if (memory) this.emit('quota:sealed', { index: this.index, left: this.soulMarkCount, memory });
    // HOUSE TAKES NOTICE (wave 47, every Night since wave 85): what the next Night will open with floors its quota, so no hold pays it.
    this.houseWealth = this.holdNext(due);

    // The tiers read the overpay principal (decision D1), and a broken seal forfeits them all for the Night (decision D2).
    const ratio = due > 0 ? this.principalNow() / due : 1;
    for (const tier of OVERSHOOT_TIERS) {
      if (!this.sealBroken && ratio >= tier.ratio && !this.quota.claimed.some((c) => c.id === tier.id)) {
        const claim: OvershootClaim = { id: tier.id, at: Math.round(this.elapsed * 1000) };
        this.quota.claimed.push(claim);
        this.grantTier(tier);
        this.emit('quota:overshoot', { tier: tier.id, pid: this.selfId });
      }
    }
    this.houseNotice();   // after the overshoot grants: a golden overpay may set the next Night's discount
    this.finishBoss(!sealed);
    this.grantKeys();
    // The surplus above the quota (overpays and the interest on them, all of it banked until now) returns to the pocket at Dawn,
    // so Night N+1 starts with the cash. It is the Night summary's "carried" figure.
    const surplus = Math.max(0, this.debtPaid - due);
    this.debtPaid = 0;
    this.bankGranted = 0;
    this.nightInterest = 0;
    this.sealBroken = false;
    if (surplus > 0) {
      this.ledger.carried += surplus;
      this.earn('coin', surplus, 'dawn:surplus');
    }
    this.payVentures(nightDef(this.index).no);
    this.stats.nightsPaid = (this.stats.nightsPaid ?? 0) + 1;
    this.syncQuota();
    this.nightDone = true;
    this.bond({ kind: 'dawn' });   // neglect, and Selim's unpaid loans come due. On Night 8 this is the call right before the Burning Wager
    if (nightDef(this.index).no === BASE_RUN_NIGHTS) this.topside = true;
    if (this.dealEnds()) return;
    this.spotlight.end();   // Machine of the Night: the Night is over, the spotlight and its x1.25 end
    // THE PANTHEON: every paid Dawn with a Night after it (from Night 1 on) opens the boon offer. A sealed Dawn has none.
    if (!sealed && !this.topside) {
      if (this.pantheon.fx('starEachDawn') > 0) bus.emit('floor:luck', { star: 1, why: 'well' });   // The Well Answers
      const opts = { tier: this.offerTier(), sealsMissing: this.soulMarkCount + this.markEscrow < SOUL_MARKS_PER_RUN };
      if (this.pantheon.open(this.index + 1, opts)) this.emit('run:boon', { pid: this.selfId, state: 'offer', ids: [] });
    }
    this.enter('intermission', 0);
    this.emit('quota:update', { quota: this.quota });
    this.persist();
  }

  /**
   * What the next Night opens with, as the House notice reads it: the pocket plus this Dawn's surplus, at least the House float.
   * THE HOME COMPUTER (wave 77): the House notices the ventures too (their sell value), so they are no hiding place for coins.
   */
  private holdNext(due: number): number {
    return holdAtOpen(this.index + 1, this.coins + Math.max(0, this.debtPaid - due)) + (this.homeEcon?.worth() ?? 0);
  }

  /** THE OWNERS (docs/BLESSINGS.md §4): Night 2's first Mola, at the bar, Selim and Loki name the gods. Subtitles only. */
  private godsBeat(): void {
    const say = (n: number, who: 'selim' | 'loki', voice: string): void => {
      bus.emit('floor:say', { text: t(`story.gods.${n}`), speaker: t(`story.speaker.${who}`), voice, source: `pantheon.beat.${n}` });
    };
    say(1, 'selim', 'bartender');
    say(2, 'selim', 'bartender');
    say(3, 'loki', 'loki');
  }

  /** The overpay tier this Dawn reached shapes the offer (docs/BLESSINGS.md §2.1): 1.5x shows 4 cards, 2x keeps 2, 3x holds a Rite. */
  private offerTier(): OfferTier {
    const has = (id: string): boolean => this.quota.claimed.some((c) => c.id === id);
    return has('seal') ? 'seal' : has('golden') ? 'golden' : has('uncommon') ? 'uncommon' : 'base';
  }

  /** Boons were taken (a pick, the timer or the lever): the Rites that act at once act, the UI hears it, the save keeps it. */
  private boonsTaken(ids: readonly string[], state: 'picked' | 'auto'): void {
    for (const id of ids) {
      const fx = boonDef(id)?.fx;
      if (fx?.starNow) bus.emit('floor:luck', { star: fx.starNow, why: 'well' });   // First Penny: a star now
      if (fx?.sealAdd) { this.restoreSoulMark(); this.pantheon.spend(id); }        // Your Name Back
      // Loki's boons cost Ink once, when kept. shortcut: an auto-pick past his cap keeps the boon unpaid; skip it in settle() if players find it
      const ink = boonDef(id)?.ink ?? 0;
      if (ink > 0) this.jokerOut(this.jokerSys.payInk(ink, id));
    }
    this.emit('run:boon', { pid: this.selfId, state, ids: [...ids] });
    this.notify();
    this.persist();
  }

  /** Closes an open offer with its leftmost cards (the lever and the bed never wait on a headless offer). */
  private settleBoons(): void {
    const ids = this.pantheon.settle();
    if (ids && ids.length > 0) this.boonsTaken(ids, 'auto');
  }

  /** A short Dawn takes one name seal and the memory with it. `dawn()` then emits `quota:sealed` (the HUD cracks the seal) once the receipt prints the line. */
  private takeSeal(): string {
    this.soulMarkCount -= 1;
    const memory = this.forget();
    this.marksChanged(false);
    return memory;
  }

  /**
   * HOUSE TAKES NOTICE (wave 47, schedule.ts): the next Night's quota read with this Dawn's wealth (`houseWealth`, set by dawn()).
   * The toast names the quota only when the notice raised it above the plain ladder.
   */
  private houseNotice(): void {
    if (nightDef(this.index).no >= BASE_RUN_NIGHTS) return;   // no base Night follows the last one
    if (this.mod('x.house.noticeOff', RUN_MACHINE, 0) > 0) return;   // Cooked Books: the next quota has no wealth floor
    const opts = { discount: this.nextDiscount, holdings: this.tycoonSys.holdings(), assessRate: this.mod('x.tycoon.assessRate', RUN_MACHINE, 0.08) };
    const plain = quotaFor(this.index + 1, opts);
    const noticed = quotaFor(this.index + 1, { ...opts, wealth: this.houseWealth });
    if (noticed > plain) this.banner?.(t('run.house.notice', { n: Math.round(noticed) }), { color: '#ff7a5a', hold: 4, size: 16 });
  }

  /** The quota was missed. Without an `ending` it is the trapdoor; `'shot'` is the Collector's visit at home (the story plays `mafia_visit`). */
  private fall(ending?: string): void {
    this.living = false;
    this.syncQuota();   // the quota the receipt reads is the bank's, as of this Dawn (wave 42, bug a)
    this.emit('quota:failed', { index: this.index });
    if (ending === undefined) this.emit('player:fall', { pid: this.selfId });
    this.endRun('fell', ending);
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
    // read before the run:end emit: the achievements handler clears the mark there. A cheated run writes no bests or history.
    const cheated = !!this.save && isCheated(this.save, this.seed);
    // THE ENDINGS: routed before anything resets (a quit or an abandoned run reaches none)
    this.endRec = this.quotaMode && result !== 'quit' && result !== 'abandoned' ? endingRecord(this.endingFacts({ result, ending })) : null;
    this.ended = true;
    this.rescue.hangUp();
    this.clock.stop();
    this.watchEv.end();
    this.enter('over', 0);
    if (!cheated && this.quotaMode && (result === 'escaped' || (result as string) === 'won')) this.tycoonSys.recordWin(this.index + 1);
    const bonus = this.currencies.get('obol') ?? 0;   // Obols from Wash lockers and the Back Office (wave 24)
    const stake = this.stakeFx();
    const obols = this.quotaMode ? Math.round(this.runObols(result, ending) * this.obolMult * stake.obolMult) + (ending === 'descend' ? 0 : bonus) : undefined;
    const nightNo = this.index + 1;
    const day = this.dailyDayOf();
    const kit = this.config.kit ?? 'pauper';
    const cleared = !cheated && this.quotaMode && isStakeClear(result, nightNo);
    const summary: RunSummary = {
      mode: this.mode, seed: this.seed, result, floor: this.index + 1, deadlines: this.index + 1, maxWallet: this.maxWallet,
      rounds: this.rounds, biggestWin: this.biggest, durationSec: Math.round(this.elapsed),
      players: [{ id: this.selfId, name: '', placement: 1, wallet: this.coins }],
      stats: { ...this.stats },
      ...(ending ? { ending } : {}),
      ...(this.endRec ? { endingId: this.endRec.id } : {}),
      ...(obols !== undefined ? { obols } : {}),
      // Stakes and the daily tag: the receipt reads them (results.ts); RunSummary has no fields for them yet.
      ...(this.quotaMode ? { stake: stake.stake } : {}),
      ...(day !== null ? { daily: { date: day, night: nightNo } } : {}),
      post: this.postMortem(),
    };
    this.emit('run:end', { summary });
    if (this.save) {
      // Descend banked its Obols (and the descent count) in the tycoon's prestige; every other ending banks them here.
      const banked = cheated ? null : ending === 'descend' ? (bonus > 0 ? this.bankObols(bonus) : null) : this.bankObols(obols ?? 0);
      this.save.update((d) => {
        d.resume = null;
        if (!cheated) d.history = [...d.history, summary].slice(-20);
        // the endings seen: a "you've seen these endings" list reads `codex['ending:<id>']`
        if (this.endRec && !cheated) d.codex[`ending:${this.endRec.id}`] = (d.codex[`ending:${this.endRec.id}`] ?? 0) + 1;
        if (banked) d.meta = banked;
        if (cleared) d.stakeCleared = recordStakeClear(d.stakeCleared, kit, stake.stake);
        if (day !== null && !cheated) {
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
    // a story loss (KEPT, PAID IN FULL, THE CHAIR) pays as a fall
    const outcome: ObolOutcome = ending === 'descend' ? 'descend' : result === 'fell' || result === 'lost' ? 'fell' : result === 'escaped' ? 'topside' : 'quit';
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

  // ── THE CIRCUIT: Tilt and Lamps (GDD §3.4) ──────────────────────────────────────────────────────────
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
    const hot = Math.max(0, hotLampCount(this.night()) + Math.round(this.mod('x.lamp.hotCount', RUN_MACHINE, 0)));
    const cold = coldLampCount(this.night(), Math.round(this.mod('x.lamp.coldCount', RUN_MACHINE, 0)) + this.stakeFx().coldLamps);
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

  // ── quota and debt ─────────────────────────────────────────────────────────────────────────────────
  private recomputeQuota(): void {
    if (!this.quotaMode) { this.quota.due = 0; this.syncQuota(); return; }
    const nd = nightDef(this.index);
    const holdings = this.tycoonSys.holdings();
    const rate = this.mod('x.tycoon.assessRate', RUN_MACHINE, 0.08);
    const p = {
      discount: this.discount, holdings, rate, wealth: this.houseWealth, loan: this.loanQuota,
      mult: this.mod('quota.mult', RUN_MACHINE, 1), add: this.mod('quota.add', RUN_MACHINE, 0), night8: this.mod('x.quota.night8', RUN_MACHINE, 1),
    };
    const due = this.dueOf(this.index, { ...p, tithe: this.tithe.addedQuota() });
    // The Watch tithe's basis: the Night quota without the rescue loans and the tithes (12 % of it is each Watch's target).
    this.tithe.setNightQuota(this.dueOf(this.index, { ...p, loan: 0, tithe: 0 }));
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
  private dueOf(index: number, p: { discount: number; holdings: number; rate: number; wealth: number; loan: number; mult: number; add: number; night8: number; tithe: number }): number {
    let due = quotaFor(index, { discount: p.discount, holdings: p.holdings, assessRate: p.rate, wealth: p.wealth });
    due = Math.round(due * p.mult * this.stakeFx().quotaMult);   // stake 2 (×1.08) rides with the quota mods
    due = Math.max(0, Math.round(due + p.add + p.loan));
    if (index === BASE_RUN_NIGHTS - 1) due = Math.round(due * p.night8);
    due = Math.round(due + p.tithe);   // the shortfalls of the missed Watch tithes (added as they are, after the multipliers)
    if (index < this.forgiveUntil) due = 0;   // a Lord's writ forgave this Night (Hollow Door)
    return due;
  }

  /**
   * NEXT NIGHT (wave 55): the exact quota of the Night after the paid one, as recomputeQuota will read it when that Night opens:
   * the ladder with the next discount, Assessment and the House notice, and the quota multipliers (charms, boons). In the Dawn collection the Night is still unpaid, so the numbers
   * are projected from the wealth the Dawn will read (`projected`); from the Dawn's payment on they are read as the run holds them.
   * `k` is the step from tonight's quota. Null while a Night is running, after the last base Night, or once the run has ended.
   */
  nextQuotaPreview(): NextQuotaPreview | null {
    if (!this.quotaMode || this.ended || this.topside || nightDef(this.index).no >= BASE_RUN_NIGHTS) return null;
    const dawnNow = this.phase === 'collection' && !this.nightDone;
    if (!this.nightDone && !dawnNow) return null;
    const idx = this.index + 1;
    // The Dawn's own reads: the wealth it floors the quota with, and the discount its overshoot tiers would add (before the reset).
    let discount = this.nextDiscount;
    let wealth = this.houseWealth;
    if (dawnNow) {
      wealth = this.holdNext(this.quota.due);
      const ratio = this.quota.due > 0 ? this.principalNow() / this.quota.due : 1;
      for (const tier of OVERSHOOT_TIERS) {
        if (!this.sealBroken && ratio >= tier.ratio && !this.quota.claimed.some((c) => c.id === tier.id)) discount += tier.reward.nextQuotaDiscount ?? 0;
      }
      discount = Math.min(0.15, discount);
    }
    if (this.mod('x.house.noticeOff', RUN_MACHINE, 0) > 0) wealth = 0;   // Cooked Books: no wealth floor on the next quota
    const mult = this.mod('quota.mult', RUN_MACHINE, 1);
    const holdings = this.tycoonSys.holdings();
    const rate = this.mod('x.tycoon.assessRate', RUN_MACHINE, 0.08);
    const due = this.dueOf(idx, {
      discount, holdings, rate, wealth, loan: 0,
      mult, add: this.mod('quota.add', RUN_MACHINE, 0), night8: this.mod('x.quota.night8', RUN_MACHINE, 1), tithe: 0,
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

  /**
   * An overpay tier's payout (Overshoot depth). HOUSE ENVY (`restoreMark`) puts one lost Soul Mark back on the card while the
   * card is short (lost = not on the card and not on the table); with the card full, its reward pays instead.
   */
  private grantTier(tier: OvershootMarkTier): void {
    if (tier.restoreMark && this.soulMarkCount + this.markEscrow < SOUL_MARKS_PER_RUN) {
      this.soulMarkCount += 1;
      this.remember();
      this.marksChanged(false);
      return;
    }
    // Noticed (1.25x): +1 Favour with the god of the last boon kept; before any boon it pays its old reward
    const god = tier.id === 'favoured' ? this.pantheon.lastGod() : null;
    if (god && god !== 'loki') { this.pantheon.addFavour(god); return; }
    this.grant(tier.reward);
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
        // shortcut: a "choose 1 of N" charm (boss, slips) is granted as the first seeded card that fits, since the pick panel went
        // with the overpay queue (docs/BLESSINGS.md §2.1); give it a panel again if playtests miss the choice.
        const rarity = Array.isArray(offer.rarity) ? offer.rarity[0] : offer.rarity;
        const owned = (id: string): boolean => this.charmBox.has(this.selfId, id);
        for (const d of choiceOffer(this.rng.fork(`charm:${this.index}:${rarity}`), rarity, offer.of, owned, this.index)) {
          if (this.charmBox.add(this.selfId, d.id, this.pegs())) break;
        }
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

  // ── stake safety and the rescue call (wave 13) ─────────────────────────────────────────────────────
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

  // ── the Hollow Door (src/game/hollow/rules.ts): the rules decide, the world shows it (`hollow:open`) ──────────────────
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
    this.remember();
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

  // ── shift API ──────────────────────────────────────────────────────────────────────────────────────
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

  // ── jackpots ───────────────────────────────────────────────────────────────────────────────────────
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
    this.tithe.played(paid, 0);   // a jackpot is a win in play (the Watch tithe counts it)
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

  // ── wave 8: Pawn Window, boss Nights, starting kits, Tell Sheet ───────────────────────────────────────
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

  /** THE HOME COMPUTER (wave 77): the ventures pay at a paid Dawn (seeded), with one banner for the total and any freeze. */
  private payVentures(night: number): void {
    const econ = this.homeEcon;
    if (!econ) return;
    const r = econ.dawn(night);
    if (r.lines.length === 0) return;
    const text = r.frozen > 0 ? t('pc.dawn.frozen', { n: r.total, k: r.frozen }) : t('pc.dawn.paid', { n: r.total });
    this.banner?.(text, { color: r.frozen > 0 ? '#ff9a6a' : '#9cff9c', hold: 4, size: 8 });
  }

  // ── special rooms (wave 24, docs/WAVE24_PLAN.md section 2) ─────────────────────────────────────────
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

  // ── wave 25: the Tally Bench (docs/WAVE25_TALLY.md) ────────────────────────────────────────────────
  private marksChanged(lost: boolean): void {
    const left = this.soulMarkCount;
    bus.emit('duel:marks', { left, lost, blank: left === 0 && this.markEscrow === 0 });
    this.persist();
    this.notify();
  }

  /** One Mark goes on the table. False when it would be the card's last seal: a duel never takes the last one (docs/BLESSINGS.md §1). */
  private stakeMark(): boolean {
    if (this.soulMarkCount < 2) return false;
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

  /** The Mark on the table is gone, and it takes a memory. BLANK (0 seals) only comes from a Dawn: a duel stakes 2+ seals, so one stays. */
  private loseMark(): void {
    if (this.markEscrow > 0) this.markEscrow -= 1;
    const memory = this.forget();   // before the banner: `?.` skips its arguments when there is no banner (headless)
    this.banner?.(t(`run.mem.${memory}.lost`), { color: '#c9a0ff', hold: 4, size: 8 });
    this.marksChanged(true);
  }

  /** A seal is lost: it takes one memory the card still has (seeded). Returns its id. */
  private forget(): string {
    const id = nextMemory(this.lostMemories, this.seed, this.index);
    this.lostMemories.push(id);
    return id;
  }

  /** A seal comes back with the last memory it took. */
  private remember(): void {
    const id = this.lostMemories.pop();
    if (id) this.banner?.(t(`run.mem.${id}.back`), { color: '#c9a0ff', hold: 4, size: 8 });
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
    const who = bondOfRival(e.rivalId);
    if (who) this.bond({ kind: 'show', who });
    // Lucan at bond 2 says the kept-pair line once, at a later sitting
    const pair = e.rivalId === 'lucan' && this.bondBook.useOnce('lucan.pair');
    // LOKI reads the rival once the intro is off screen (he only knows the hands he sat across: Lucan's watch, Orrin's card)
    const tip = (): void => {
      if (pair) hearHint(this.chapterRec, 'lucan');
      if (pair) bus.emit('floor:say', { text: t('story.duel.rival.lucan.hint.pair'), speaker: t('story.duel.rival.lucan.name'), voice: 'dealer', source: 'bonds.lucan.pair' });
      this.jokerTip('duel', `duel:${e.rivalId}`, e.rivalId === 'lucan' ? 'watch' : e.rivalId === 'orrin' ? 'card' : '-');
    };
    if (!rivalById(e.rivalId as RivalId)) { tip(); return; }
    return playDuelScene(e.rivalId as RivalId, 'intro', this.seed, e.night).finally(tip);
  }

  /** A duel is settled: boss rewards, the Audit tax, then the rival's closing scene once the reveal is off screen. */
  private duelEnded(r: DuelEndReport): void {
    const rival = rivalById(r.rivalId as RivalId);
    const who = bondOfRival(r.rivalId);
    // shortcut: every win reads clean (DuelEndReport has no Loki-hand flag until the takeover, docs/JOKER.md J3); send 'loki' for those then
    if (who && r.won) this.bond({ kind: 'clean', who });
    // a wrong call (Lucan's MIRROR, the Collector's MARKED DECK, any table) is a false accusation
    if (who && r.calledCorrect === false) this.bond({ kind: 'betray', who });
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
    const over = (): void => { bus.emit('duel:end', { rivalId: r.rivalId, night: r.night }); };
    if (r.rivalId === 'vell' && r.calledCorrect === true) {
      // Vell's thrown match, called out: the Bench rules the count void and the lift opens for him (his 'won' scene is replaced)
      this.endingPathId = 'vell_release';
      this.afterDuel(() => { void import('./story/duels/ending').then((m) => m.playVellRelease()).then((): void => undefined, (): void => undefined); }, true);
    } else if (rival && !r.drew) {
      const beat = r.won ? 'won' : 'lost';
      this.afterDuel(() => { void playDuelScene(r.rivalId as RivalId, beat, this.seed, r.night).then(over); }, true);
    } else this.afterDuel(over);
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

  readLedgerNote(noteId: string): LedgerFind {
    const r = ledgerRead(this.rooms, noteId);
    if (r.fresh) { this.rooms = r.state; this.persistSoon(); this.notify(); }
    if (r.completed) this.bond({ kind: 'help', who: 'mimosa' });   // the Wash ledger is Mimosa's errand
    return r;
  }

  ledgerOffer(): string[] { return ledgerOffer(this.rooms, this.seed, this.lockerCharms()); }

  ledgerClaim(charmId: string): boolean {
    const r = ledgerPick(this.rooms, charmId, this.seed, this.lockerCharms());
    if (!r.ok || !this.grantCharm(charmId)) return false;
    this.rooms = r.state;
    this.persistSoon();
    return true;
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
  private finishBoss(reward = true): void {
    const boss = this.bossToday();
    if (!boss) return;
    this.buffSys.nightEvents.end(boss.id);
    if (!reward) return;   // a boss Night paid with a seal ends, but pays nothing
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

  // ── save and resume ────────────────────────────────────────────────────────────────────────────────
  snapshot(): RunSave {
    const pid = this.selfId;
    const ext: RunExt = {
      owned: [...this.owned], allIn: this.allInWatch,
      v: 1, index: this.index, watch: this.watch, watches: this.watches, overtimeIdx: this.overtimeIdx,
      phase: this.phase, phaseLeft: this.phaseLeft, nightDone: this.nightDone, topside: this.topside,
      metFired: this.metFired,
      clock: this.clock.snapshot(), clockLen: this.clockLen, lastCallSec: this.lastCallSec,
      pulls: this.pullCount, pullsMax: this.pullsMax, watchPulls: this.watchPulls, boughtThisWatch: this.boughtThisWatch,
      tickets: this.tickets, debtPaid: this.debtPaid, ledger: { ...this.ledger }, dreadPts: this.dreadPts,
      freeRerolls: this.freeRerolls, skipRest: this.skipRest,
      pawn: this.pawn.snapshot(), stamps: this.stamps.snapshot(), machineMods: this.machineMods.snapshot(), plays: Object.fromEntries(this.plays),
      discount: this.discount, nextDiscount: this.nextDiscount, elapsed: this.elapsed,
      maxWallet: this.maxWallet, biggest: this.biggest, rounds: this.rounds,
      rng: this.rng.getState(),
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
      bank:{ granted: this.bankGranted, wd: this.watchWd, dep: this.watchDepCoins, interest: this.nightInterest, broken: this.sealBroken },
      wingKeys: this.wingKeys, managerKey: this.managerKey, rooms: { ...this.rooms, lockers: [...this.rooms.lockers] }, bonusObols: this.currencies.get('obol') ?? 0,
      soulMarks: this.soulMarkCount, markEscrow: this.markEscrow, bossDuel: this.bossDuelNight, pledged: [...this.pledged],
      ...(this.lostMemories.length > 0 ? { lostMemories: [...this.lostMemories] } : {}),
      ...(this.endingPathId ? { endingPath: this.endingPathId } : {}),
      hollow: { ...this.hollow }, forgiveUntil: this.forgiveUntil, houseWealth: this.houseWealth, obolMult: this.obolMult, hollowRefused: this.hollowRefused,
      ...(this.pantheon.snapshot() ? { pantheon: this.pantheon.snapshot() as PantheonSave } : {}),
      joker: this.jokerSys.snapshot(), ...(this.lokiMet ? { lokiMet: true } : {}),
      ...(this.watchEv.snapshot() ? { watchEvent: this.watchEv.snapshot() } : {}),
      ...(this.spotlight.snapshot() ? { spotlight: this.spotlight.snapshot() as SpotlightSave } : {}),
      ...(this.tithe.snapshot() ? { tithe: this.tithe.snapshot() as TitheSave } : {}),
      ...(this.dawnBook ? { dawnBook: { ...this.dawnBook } } : {}),
      ...(this.grandWinList.length > 0 ? { grandWins: this.grandWinList.map((w) => ({ ...w })) } : {}),
      ...(this.hPhone ? { home: this.homeSave(this.hPhone) } : {}),
      ...(this.homeEcon ? { econ: this.homeEcon.snapshot(), fridge: fridgeSnapshot() } : {}),
      luck: this.luckMeter.snapshot(), keepsake: this.keepsakes.snapshot(), ghost: this.ghostSeat.snapshot(), chapter: cloneChapter(this.chapterRec),
      bonds: this.bondBook.snapshot(),
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

  /** The Home slice of the save: the stage and its clock, the lights and chain, and the phone's own slice (`RunExt.home`). */
  private homeSave(phone: HomePhoneApi): HomeSave {
    const p = phone.snapshot();
    return { stage: this.hStage, left: Math.max(0, this.hLeft), lights: this.hLights, chain: this.hChain, ...(p ? { phone: p } : {}) };
  }

  /**
   * Restores the Home layer from a save. A reload cannot resume a lift or a sleep, so a ride, an Evening and a sleep all come back as
   * the Evening at the front door (the controller teleports the player to `home.spawn`); a Night that was left on the floor stays there.
   * The doom comes back whole: the ride home, the lights and the knocks play again and then end the run.
   */
  private restoreHome(h: HomeSave | undefined): void {
    this.hPhone?.restore(h?.phone);
    this.hLights = h?.lights !== false;
    this.hChain = h?.chain === true;
    this.hStage = null; this.hLeft = 0;
    const st = h?.stage ?? null;
    if (st === 'doomed' && this.phase === 'collection' && !this.nightDone) {
      this.hStage = 'doomed';
      this.hLeft = HOME_TIMING.doomed.end;
    } else if ((st === 'evening' || st === 'ride' || st === 'sleep') && this.phase === 'intermission' && this.nightDone && !this.topside) {
      const saved = Number.isFinite(h?.left) ? (h?.left ?? 0) : HOME_TIMING.evening;
      // a sleep that was cut off finishes soon; a ride starts the Evening from the top; an Evening keeps its clock (at least a breath)
      const left = st === 'sleep' ? 3 : st === 'ride' ? HOME_TIMING.evening : saved;
      this.hStage = 'evening';
      this.hLeft = Math.min(HOME_TIMING.evening, Math.max(5, left));
    }
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
    // the store writes what the persist just set (page hide: the run's last write must reach storage before the page goes)
    this.save?.flush();
  }

  grantCharm(charmId: string): boolean {
    if (!charmDef(charmId)) return false;
    if (!this.charmBox.add(this.selfId, charmId, this.pegs())) return false;
    this.notify();
    this.persist();
    return true;
  }

  // ─ LOKI (docs/JOKER.md §3, wave J2): the voice. His rules are pure (joker/); the run times them, emits them and saves them ─
  /** Emits his events on the bus, re-reads the grin and saves. */
  private jokerOut(o: { events: readonly JokerEvent[] }): void {
    if (o.events.length === 0) return;
    for (const e of o.events) bus.emit(e.name, e.data as never);
    this.rollGrin();
    this.persistSoon();
    this.notify();
    if (this.jokerSys.cameHome && !this.ended) this.endRun('lost', 'came_home');   // Ink 10: HE CAME HOME (JOKER §2.2)
  }

  /** One glance at the card: the true frame, or from Ink 6 one glance in three a wrong one (seeded per glance). */
  private rollGrin(): void {
    const j = this.jokerSys;
    const frame = shownFrame(createRng(hashSeed(this.seed, 'joker.grin', this.grinN++)), j.trust, j.ink);
    this.grin = { frame, lie: frame !== grinFrame(j.trust) };
  }

  /** He speaks (a tip, or an Ask). False when he has nothing to say. */
  private jokerSpeak(req: { ctx: WhisperCtx; fact?: string; ask?: boolean; onHisWord?: boolean; free?: boolean }): boolean {
    if (this.ended || this.night() < 2 || this.mod('x.cheat.lokiQuiet', RUN_MACHINE, 0) > 0) return false;   // he introduces himself on the Night 2 lift: Night 1 is the coach's, not his
    const w = this.jokerSys.whisper(req);
    if (!w) return false;
    this.jokerLast = this.elapsed;
    this.jokerOut(w);
    return true;
  }

  /** A moment he talks about (JOKER §3): askable from now on, and one tip per moment a Watch (his tips per Watch still cap it). */
  private jokerTip(ctx: WhisperCtx, key: string, fact?: string): void {
    this.jokerHere = { ctx, fact };
    if (this.jokerSaid.has(key)) return;
    this.jokerSaid.add(key);
    this.jokerSpeak({ ctx, fact });
  }

  /** Seated: the bounty board, or a floor machine (cold, or a near miss); and once a Night his dare. Never the cashier, the terminal or the bell. */
  private jokerSeat(mid: InstanceId | null): void {
    this.jokerMid = null;
    if (mid === null) { if (this.jokerHere?.ctx !== 'crooked') this.jokerHere = null; return; }
    const machineId = this.worldLink?.machines().find((m) => m.instance === mid)?.machineId ?? this.circ.machineOf(mid);
    if (machineId === 'bounty_board') { this.jokerTip('bounty', `bounty:${mid}`); return; }
    const cat = machineId ? registry.get(machineId)?.def.category : undefined;
    if (cat === undefined || cat === 'system' || cat === 'party') return;   // the cashier, the Debt Terminal, the bell are not his
    this.jokerMid = mid;
    this.jokerTip('machine', `seat:${mid}`, this.circ.isCold(mid) ? 'cold' : 'near');
    if (this.night() >= 2 && this.inWatch() && this.jokerSys.canDare() && this.mod('x.cheat.lokiQuiet', RUN_MACHINE, 0) <= 0) this.emit('joker:dare', { night: this.night() });
  }

  jokerMoment(ctx: 'crooked' | null, id = ''): void {
    if (ctx === null) { if (this.jokerHere?.ctx === 'crooked') this.jokerHere = null; return; }
    this.jokerTip(ctx, `${ctx}:${id}`, 'thumb');
  }

  jokerAsk(): boolean { return !!this.jokerHere && this.jokerSpeak({ ...this.jokerHere, ask: true }); }

  jokerCall(): boolean {
    if (this.elapsed - this.jokerLast > JOKER_CALL_S) return false;
    const r = this.jokerSys.callLiar();
    if (r.right !== null) bus.emit('joker:call', { right: r.right });
    this.jokerOut(r);
    return r.right !== null;
  }

  jokerDare(accept: boolean): void {
    // shortcut: taking the dare counts at once, not when the pull is made; check the follow-through when J3 wires his stakes
    this.jokerOut(this.jokerSys.dare(accept));
  }

  jokerGrin(): { frame: number; lie: boolean } { return this.grin; }
  jokerInk(): number { return this.jokerSys.ink; }
  jokerTrust(): number { return this.jokerSys.trust; }
  jokerWager(fact: string, word = false): boolean { return this.jokerSpeak({ ctx: 'wager', fact, free: true, onHisWord: word }); }
  jokerWordReady(): boolean { return this.jokerSys.wordReady; }

  // ─ LOKI'S HAND (docs/JOKER.md §4, wave J3): the Change of Hands at a floor machine. The next round there is his ─
  jokerTakeover(): AskWhy | 'seat' | null {
    const mid = this.jokerMid;
    // a staked keepsake keeps its own round: his hand would make its star his
    if (this.ended || !this.quotaMode || this.night() < 2 || mid === null || this.lokiHand || !this.canPlay() || this.keepsakes.pending(mid, this.night())) return 'seat';
    const machineId = this.worldLink?.machines().find((m) => m.instance === mid)?.machineId ?? this.circ.machineOf(mid) ?? '';
    const stake = this.lastBet.get(mid) ?? this.betLimits(machineId as MachineId, mid).min;
    const r = this.jokerSys.askTakeover({ where: 'machine', machineId, stake, quota: this.quota.due });
    if (r.ok === false) return r.why;
    this.lokiHand = { mid, help: true };
    this.jokerOut(r);
    return null;
  }

  /** A key moment at a machine: his roll for an unasked hand (Ink 6+). Ada's hair tie (the carried 'ring') slips the first one a Night. */
  private jokerUnasked(mid: InstanceId, machineId: string, stake: number): void {
    if (this.ended || this.night() < 2 || this.lokiHand) return;
    const r = this.jokerSys.unasked('bigBet', { machineId, stake, quota: this.quota.due, hairTie: this.keepsakes.carried() === 'ring' });
    if (r.struck === true) this.lokiHand = { mid, help: r.kind === 'help' };
    else for (const k of r.lines) bus.emit('floor:say', { text: t(k), speaker: t('story.speaker.loki'), voice: 'loki', source: 'joker' });
    this.jokerOut(r);
  }

  /** His first line, once a run: the first ride down after the prologue, in the lift mirror. */
  private lokiIntro(): void {
    if (this.lokiMet) return;
    this.lokiMet = true;
    bus.emit('floor:say', { text: t('joker.ui.intro'), speaker: t('story.speaker.loki'), voice: 'loki', source: 'joker' });
    this.persistSoon();
  }

  // ─ THE PANTHEON (docs/BLESSINGS.md §2): the Dawn offer, the boons kept for the run ─
  boonOffer(): PantheonOfferView | null { return this.pantheon.offerView(); }

  setBoonGate(on: boolean): void { this.boonGate = on; }

  holdBoonTimer(on: boolean): void { this.pantheon.held = on; }

  pickBoon(id: string): boolean {
    if (!this.jokerSys.canPayInk(boonDef(id)?.ink ?? 0)) return false;   // his boon would bring him home
    if (!this.pantheon.pick(id)) return false;
    this.boonsTaken([id], 'picked');
    return true;
  }

  swapBoon(index: number): boolean {
    if (!this.jokerSys.canPayInk(this.pantheon.fx('freeSwap') > 0 ? 0 : LOKI_SWAP_INK)) return false;
    const ink = this.pantheon.swap(index);
    if (ink === null) return false;
    this.jokerOut(this.jokerSys.payInk(ink, 'swap'));
    this.emit('run:boon', { pid: this.selfId, state: 'swap', ids: [] });
    this.persist();
    return true;
  }

  boons(): readonly string[] { return this.pantheon.list(); }
  boonFavour(god: GodId): number { return this.pantheon.favour(god); }

  /** Machine of the Night (wave 55): this Night's spotlight for the HUD chip, or null. */
  spotlightView(): SpotlightView | null { return this.spotlight.current(); }

  /** The Settle's interest, said as a bank note: the amount (with the coin sound, `run:interest`), the rate, or why it paid nothing. */
  private interestNote(pid: PlayerId, earned: number, pct: number, shortBy: number): void {
    if (earned > 0) {
      this.bankNote('bank.interest', { n: earned, pct });
      this.emit('run:interest', { pid, amount: earned, pct });
    } else if (shortBy > 0) this.bankNote('bank.interest.short', { pct, k: shortBy });
    else this.bankNote('bank.interest.none', { pct });
  }

  /** Launch charm pool of one rarity (lootbox and claw prizes read it through `Reflect`). Unlock-gated charms are left out. */
  charmPool(rarity: string): Array<{ id: string; price: number; maxStacks?: number }> {
    return allCharmDefs()
      .filter((d) => d.rarity === rarity && !d.unlock)
      .map((d) => ({ id: d.id, price: Math.abs(d.price), maxStacks: d.maxStacks }));
  }

  // ── bounty board (ContractsApi, GDD §11.9) ──────────────────────────────────────────────────────
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
    this.metFired = e.metFired;
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
    this.machineMods.restore(e.machineMods);
    this.plays.clear();
    for (const [id, n] of Object.entries(e.plays ?? {})) this.plays.set(id, n);
    this.discount = e.discount; this.nextDiscount = e.nextDiscount; this.elapsed = e.elapsed;
    this.maxWallet = e.maxWallet; this.biggest = e.biggest; this.rounds = e.rounds;
    this.rng.setState(e.rng);
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
    // Older saves' Night Card, Starter Draft and overpay picks are dropped: only `pantheon` is read (docs/BLESSINGS.md §6, B1).
    this.pantheon.restore(e.pantheon);
    // an older save (no slice, or the old `lokiDread`) starts him fresh on this Night
    if (e.joker) this.jokerSys.restore(e.joker); else this.jokerSys.beginNight(this.index + 1);
    this.lokiMet = e.lokiMet === true;
    this.rollGrin();
    this.watchEv.restore(e.watchEvent);
    this.spotlight.restore(e.spotlight);
    this.tithe.restore(e.tithe);
    this.dawnBook = restoredDawnReceipt(e.dawnBook);
    this.grandWinList = restoredGrandWins(e.grandWins);
    this.luckMeter.restore(e.luck);
    this.keepsakes.restore(e.keepsake);
    this.ghostSeat.restore(e.ghost);
    this.bondBook.restore(e.bonds);
    this.chapterRec = readChapter(e.chapter);
    if (this.homeOn) this.restoreHome(e.home);
    this.homeEcon?.restore(e.econ);
    if (this.homeOn) fridgeRestore(e.fridge);
    this.loanQuota = Math.max(0, e.rescue?.quota ?? 0); this.rescuesUsed = Math.max(0, e.rescue?.used ?? 0);
    this.watchDeposits = Math.max(0, e.watchDep ?? 0);
    this.watchFloatSnap = typeof e.watchFloat === 'number' && Number.isFinite(e.watchFloat) ? Math.max(0, Math.floor(e.watchFloat)) : null;
    this.bankGranted = Math.max(0, Math.floor(e.bank?.granted ?? 0));
    this.watchWd = Math.max(0, Math.floor(e.bank?.wd ?? 0)); this.watchDepCoins = Math.max(0, Math.floor(e.bank?.dep ?? 0));
    // older saves have no interest split: their whole bank reads as principal (the pre-D1 rule)
    this.nightInterest = Math.max(0, Math.floor(e.bank?.interest ?? 0));
    this.sealBroken = e.bank?.broken === true;
    this.wingKeys = Math.max(0, Math.floor(e.wingKeys ?? 0)); this.managerKey = e.managerKey === true;
    this.rooms = restoreRooms(e.rooms);
    if ((e.bonusObols ?? 0) > 0) this.currencies.set('obol', e.bonusObols ?? 0);
    this.soulMarkCount = Math.min(SOUL_MARKS_PER_RUN, Math.max(0, Math.floor(e.soulMarks ?? SOUL_MARKS_PER_RUN)));
    this.markEscrow = Math.min(SOUL_MARKS_PER_RUN, Math.max(0, Math.floor(e.markEscrow ?? 0)));
    this.lostMemories = (e.lostMemories ?? []).filter(isSealMemory).slice(0, SOUL_MARKS_PER_RUN);
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
