/**
 * Wire protocol — TD-FROZEN. Implementation: NET-SESSION (`session.ts`, `codec.ts`). Contract: TECH_SPEC §6.5.
 *
 * JSON text, one message per send, discriminated by `t`. `PROTO` mismatches are denied (`deny version`).
 * Unreliable channel: only `pt`, `pts`. Messages over 15 000 chars on `rel` are split into `frag` parts
 * (8 000 chars each) by `codec.ts`. Direction legend: C→H client to host · H→C host to one client ·
 * H→* host to everyone (host applies locally, never loops back to itself).
 *
 * v1 additions (after the spec): hidden-information tables (`mpriv`, `mbot`), spectator bets, cutscene
 * sync, buffs/totems/collateral/tycoon/events/contracts/jackpot sync, emotes + pings, voice signalling.
 * Anything small and incremental rides on `rdelta`; the heavy sub-states have their own replace-style
 * messages (`buffD`, `totemD`, `collD`, …) so a missed packet self-heals on the next one (+ `rsnap` every 5 s).
 *
 * Hidden information rule: the host NEVER sends secret data (shell order, other players' hands, undrawn
 * cards) in a public event or snapshot. Public events carry redacted facts; secrets go out as `mpriv`
 * to exactly the player entitled to see them, and `msnap` is built per recipient (`getSnapshot(forPid)`).
 */
import type { GameMode, Hex, InstanceId, Json, Lang, MachineId, PlayerId, V3 } from '@/core/types';
import type {
  ActiveEvent, BodyPart, BuffOwnerKey, BuffState, CharmState, CollateralState, ContractState, CurrencyId,
  DebtState, QuotaState, RunWindow, ShiftState, TotemState, TycoonNoReason, TycoonRequest, TycoonState,
  WinTier,
} from '@/game/types';
import type { MachineEnvelope } from '@/machines/_base/types';

export const PROTO = 1;

export interface PlayerInfo {
  id: PlayerId; cid: string; name: string; color: Hex; host: boolean; ready: boolean;
  state: 'lobby' | 'alive' | 'ghost' | 'away'; ping: number;
  /** Chosen character (start perk), '' = default. */
  char?: string;
}
export interface RoomInfo {
  id: string; name: string; host: string; mode: GameMode; players: number; max: number; locked: boolean;
  started: boolean; lateJoin: boolean; version: number; via: 'server' | 'tab' | 'p2p'; ping?: number; salt?: string;
  /** Visible only to people on the host's recent-players list (invite links still work). */
  friendsOnly?: boolean;
}
export interface RunConfig {
  startWallet: number; deadlines: number; difficulty: 'easy' | 'normal' | 'hard'; friendlyGive: boolean;
  // ── optional (host fills defaults; absent in old saves) ──
  /** Real-time shift timer (default true online, false offline). */
  realtimeShift?: boolean;
  /** Length of the play window in seconds (default 360). */
  shiftSeconds?: number;
  /** Co-op shared bank (default true in coop). */
  sharedBank?: boolean;
  /** Difficulty-ladder rung (0 = base). */
  stake?: number;
  modifiers?: string[];
  /** Daily-seed run (seed derived from the date). */
  daily?: boolean;
  /** Randomise the machine line-up on every floor visit (tycoon-owned machines stay). */
  randomLineup?: boolean;
  /** Body-part economy enabled. */
  collateral?: boolean;
  /** Fill empty party-table seats with mannequin bots (default true). */
  botFill?: boolean;
  botLevel?: 1 | 2 | 3;
}
export interface PhoneCallState { id: number; script: string; target: PlayerId /* 0 = anyone */; ringingSince: number; answeredBy: PlayerId | null; step: number; options: string[] /* i18n keys */ }

export interface RunSnapshot {
  mode: GameMode; seed: number; window: RunWindow;
  debts: Record<number, DebtState>;
  wallets: Record<number, number>;
  charms: Record<number, CharmState[]>;
  alive: Record<number, boolean>;
  jackpots: Record<string, number>;
  tier: number;
  phone: PhoneCallState | null;
  stats: Record<string, number>;
  // ── v1 extensions (optional so v0 saves still load) ──
  cfg?: RunConfig;
  shift?: ShiftState;
  /** Mirror of `shift.quota` for cheap deltas (`rdelta`). */
  quota?: QuotaState;
  /** Secondary currencies: currency → player → amount. */
  currencies?: Record<string, Record<number, number>>;
  buffs?: Record<BuffOwnerKey, BuffState[]>;
  tycoon?: TycoonState;
  totems?: TotemState[];
  collateral?: Record<number, CollateralState>;
  events?: ActiveEvent[];
  contracts?: ContractState[];
  /** Dread meter 0..1. */
  dread?: number;
}
export interface RunSummary {
  mode: GameMode; seed: number;
  result: 'escaped' | 'fell' | 'quit' | 'abandoned' | 'won' | 'lost';
  floor: number; deadlines: number; maxWallet: number; rounds: number; biggestWin: number; durationSec: number;
  players: Array<{ id: PlayerId; name: string; placement: number; wallet: number }>;
  // ── v1 extensions ──
  ending?: string;                     // 'elevator' | 'descend' | 'secret' | 'mannequin' …
  obols?: number;                      // meta currency earned
  stats?: Record<string, number>;
  /** The run adds a posed mannequin of this player to the Hall of Losers. */
  hall?: boolean;
}

/**
 * Extensible protocol (DECISIONS C30). Feature folders add their messages by declaration merging:
 *   declare module '@/net/protocol' { interface MsgMap { foo: { t: 'foo'; ... } } }
 * `Msg` is the core union plus every `MsgMap` entry. The generic `intent` message carries feature requests.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MsgMap {}

type CoreMsg =
  // ── session ──────────────────────────────────────────── (dir)
  | { t: 'hello'; v: number; cid: string; name: string; color: Hex; lang: Lang; pass?: string; char?: string }   // C→H
  | { t: 'welcome'; you: PlayerId; room: RoomInfo; players: PlayerInfo[]; phase: 'lobby' | 'ingame'; hostTime: number;
      occ: Array<[mid: InstanceId, seat: number, pid: PlayerId]> }                                         // H→C
  | { t: 'deny'; reason: 'full' | 'password' | 'version' | 'started' | 'kicked' }                         // H→C
  | { t: 'pjoin'; p: PlayerInfo }                                                                          // H→*
  | { t: 'pupd'; id: PlayerId; patch: Partial<PlayerInfo> }                                                // H→*
  | { t: 'pleave'; id: PlayerId; reason: 'left' | 'timeout' | 'kicked' }                                   // H→*
  | { t: 'kick'; reason?: string }                                                                         // H→C (then disconnect)
  | { t: 'ping'; a: number }                                                                               // both, 1 Hz
  | { t: 'pong'; a: number; b: number }                                                                    // reply; b = responder clock
  | { t: 'close'; reason: 'hostLeft' | 'hostQuit' | 'error' }                                              // H→*
  // ── lobby ──
  | { t: 'ready'; r: boolean }                                                                             // C→H
  | { t: 'prof'; name?: string; color?: Hex; char?: string }                                               // C→H (name/colour/character change)
  | { t: 'lcfg'; mode: GameMode; max: number; lateJoin: boolean; cfg: RunConfig }                          // H→*
  | { t: 'start'; mode: GameMode; seed: number; cfg: RunConfig; at: number }                               // H→*
  | { t: 'end'; summary: RunSummary }                                                                      // H→*
  | { t: 'toLobby' }                                                                                       // H→*
  // ── movement (unreliable) ──
  | { t: 'pt'; s: number; p: V3; r: [yaw: number, pitch: number]; f: number }                              // C→H 20 Hz
  | { t: 'pts'; s: number; a: Array<[PlayerId, number, number, number, number, number, number]> }          // H→* 20 Hz [id,x,y,z,yaw,pitch,f]
  // ── chat & social ──
  | { t: 'chat'; from?: PlayerId; text: string }                                                           // C→H, H→* (from set by host)
  | { t: 'sys'; key: string; vars?: Record<string, string | number> }                                      // H→* system line (i18n)
  | { t: 'emote'; id: string; from?: PlayerId }                                                            // C→H, H→* (host stamps `from`)
  | { t: 'mark'; kind: string; pos: V3; from?: PlayerId }                                                  // C→H, H→* world ping
  | { t: 'vsig'; to: PlayerId; from?: PlayerId; data: Json }                                               // C→H→C proximity-voice WebRTC signalling
  // ── machines ──
  | { t: 'mocc'; mid: InstanceId; seat: number }                                                           // C→H request
  | { t: 'moccOk'; mid: InstanceId; seat: number; pid: PlayerId; seed: number; occ: number }               // H→* grant
  | { t: 'moccNo'; mid: InstanceId; reason: 'busy' | 'locked' | 'ghost' | 'seated' | 'noseat' }            // H→C
  | { t: 'mrel'; mid: InstanceId; seat: number }                                                           // C→H
  | { t: 'mrelOk'; mid: InstanceId; seat: number; pid: PlayerId }                                          // H→*
  | { t: 'mev'; e: MachineEnvelope }                                                                       // C→H (solo occupant) / H→* (forward or table)
  | { t: 'tact'; mid: InstanceId; seat: number; rid: number; a: Json }                                     // C→H table action
  | { t: 'tnak'; mid: InstanceId; rid: number; reason: string }                                            // H→C (i18n key)
  | { t: 'msnap'; mid: InstanceId; snap: Json; seq: number }                                               // H→C late join (built per recipient)
  // ── party tables / hidden information ──
  | { t: 'mevp'; e: MachineEnvelope }                                                                      // H→C private envelope, one recipient (`MachineNet.sendPrivate`, §11.4; `e.to` set)
  | { t: 'mpriv'; mid: InstanceId; to: PlayerId; seq: number; ev: Json }                                   // H→C private event: own cards/tiles/shells (legacy form of mevp)
  | { t: 'mbot'; mid: InstanceId; seat: number; name: string | null; level?: number }                      // H→* bot sits (name) / leaves (null)
  | { t: 'sbet'; mid: InstanceId; target: PlayerId; amt: number; rid: number }                             // C→H spectator side bet on a seated player
  // ── run / economy ──
  | { t: 'rsnap'; run: RunSnapshot }                                                                       // H→* on join, phase change, every 5 s
  | { t: 'rdelta'; d: Partial<RunSnapshot> }                                                               // H→* small changes
  | { t: 'eco'; op: 'bet' | 'win' | 'deposit' | 'give' | 'buy' | 'jpAdd' | 'jpClaim' | 'spend'; amt: number; rid: number;
      mid?: InstanceId; machineId?: MachineId; to?: PlayerId; item?: string; meta?: Json; cur?: CurrencyId }  // C→H request
  | { t: 'ecoD'; pid: PlayerId; w: number; d: number; why: string; rid?: number; tier?: WinTier; mid?: InstanceId; cur?: CurrencyId } // H→* authoritative (`cur` set = secondary currency)
  | { t: 'ecoNo'; rid: number; reason: 'funds' | 'invalid' | 'phase'; w: number }                          // H→C rejection
  | { t: 'charmD'; pid: PlayerId; charms: CharmState[] }                                                   // H→*
  | { t: 'jp'; pool: string; v: number }                                                                   // H→* jackpot pool value
  | { t: 'jpWin'; pool: string; pid: PlayerId; amount: number; mid: InstanceId; machineId: MachineId }     // H→* announce → pit-wide celebration
  // ── tycoon ──
  | { t: 'tyc'; rid: number; req: TycoonRequest }                                                          // C→H purchase / order / hire / prestige …
  | { t: 'tycNo'; rid: number; reason: TycoonNoReason }                                                    // H→C
  | { t: 'tycD'; d: TycoonDelta }                                                                          // H→* authoritative delta (merge semantics in TycoonDelta)
  // ── buffs / totems / collateral ──
  | { t: 'buffD'; owner: BuffOwnerKey; buffs: BuffState[] }                                                // H→* replace one owner's list
  | { t: 'totemD'; totems: TotemState[] }                                                                  // H→* replace the whole list
  | { t: 'totemReq'; op: 'place' | 'pickup' | 'discard' | 'use'; uid: string; pos?: V3; rotY?: number }   // C→H
  | { t: 'collD'; pid: PlayerId; s: CollateralState }                                                      // H→*
  | { t: 'collReq'; op: 'pawn' | 'buyBack' | 'carry' | 'drop'; part?: BodyPart; target?: PlayerId }       // C→H
  // ── events / contracts ──
  | { t: 'evt'; events: ActiveEvent[] }                                                                    // H→* nightly/global events (replace)
  | { t: 'contracts'; list: ContractState[] }                                                              // H→* board + active (replace)
  | { t: 'contractReq'; op: 'accept' | 'abandon' | 'claim'; uid: string }                                  // C→H
  // ── phone ──
  | { t: 'phone'; call: PhoneCallState | null }                                                            // H→* (null = hang up)
  | { t: 'phoneAns'; id: number; choice: number }                                                          // C→H (choice −1 = pick up)
  // ── votes ──
  | { t: 'vote'; id: number; kind: 'kick' | 'restart' | 'skip' | 'endless' | 'cutscene'; target?: PlayerId; ends: number; yes: number; no: number; need: number } // H→*
  | { t: 'voteCast'; id: number; yes: boolean }                                                            // C→H
  | { t: 'voteEnd'; id: number; passed: boolean }                                                          // H→*
  // ── cutscenes (host decides, everyone plays in sync; skip = vote kind 'cutscene') ──
  | { t: 'cut'; id: string; at: number; seed: number; vars?: Record<string, string | number> }             // H→* start at host time `at`; late peers seek
  | { t: 'cutGate'; id: string; gate: string; value: number }                                              // H→* a gate resolved (choice index / 1)
  | { t: 'cutEnd'; id: string; result: 'done' | 'skipped' }                                                // H→*
  // ── fate ──
  | { t: 'fall'; pid: PlayerId }                                                                           // H→* (pid 0 = whole team)
  | { t: 'ascend'; pid: PlayerId }                                                                         // H→*
  // ── transport utility ──
  | { t: 'frag'; id: number; i: number; n: number; d: string }
  // ── generic feature request (C30): C→H, host answers with a reply keyed by `rid` ──
  | { t: 'intent'; k: string; d: Json; rid: number };

export type Msg = CoreMsg | MsgMap[keyof MsgMap];

export type MsgType = Msg['t'];

/**
 * Tycoon delta: merge semantics so a purchase costs a few bytes.
 * `levels` entries overwrite; `machines` entries overwrite, `null` deletes; the rest replace.
 */
export interface TycoonDelta {
  levels?: Record<string, number>;
  machines?: Record<InstanceId, TycoonState['machines'][InstanceId] | null>;
  staff?: TycoonState['staff'];
  zones?: TycoonState['zones'];
  floor?: number; holdings?: number; orders?: number; idleEarned?: number;
}

/** Messages sent on the unreliable channel; everything else is reliable. */
export const UNRELIABLE: ReadonlySet<MsgType> = new Set<MsgType>(['pt', 'pts']);

/**
 * Per-message-type host rate limits (messages/second; excess dropped, 3 violations/10 s → kick).
 * Types not listed share a 60/s per-peer budget.
 */
export const RATE_LIMITS: Partial<Record<MsgType, number>> = {
  pt: 30, chat: 4, eco: 20, mev: 30, tact: 10, mocc: 4, mrel: 4, voteCast: 2,
  tyc: 8, totemReq: 6, collReq: 4, contractReq: 4, emote: 3, mark: 3, vsig: 20, sbet: 4,
};
