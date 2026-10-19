/**
 * MachineBase (base-machines WP). Contract: TECH_SPEC §3.3 + §11.4/§11.5 amendments + v1 extensions (private
 * events for hidden information, per-recipient snapshots, tycoon speed/feature hooks, juice helpers).
 *
 * ── Golden rules for subclasses ───────────────────────────────────────────────────────────────────────
 *  1. Logic decides, `present()` applies. Outcome logic (RNG, rules) runs only on the authority (the local
 *     occupant for solo machines, the host for tables), packs the FULL outcome into an event and calls
 *     `emit`. All persistent machine state is mutated only inside `present()` so every peer converges.
 *  2. Events are small JSON (≤ 1 KB). Kinds starting with `_` are reserved for the base classes.
 *  3. `present()` = world feedback for everyone; `settle()` / `run.win()` = wallet + personal UI of the winner.
 *  4. Randomness: `this.rng` (outcomes) / `this.cosmetic` (visual noise). Never `Math.random()`.
 *  5. Never `setTimeout`: use `this.wait` / `this.anim` (they honour the Speed upgrade and freeze with SP pause).
 *  6. `present()` must tolerate `pc.fast` and must not assume the local player is the occupant.
 *  7. Your round must always reach `settle()` (try/finally). Release while `busy` is deferred (honoured as soon as
 *     `busy` clears, forced after 10 s). Credit FIRST, present after: pass the wallet step as `emit`'s `credit`
 *     so it runs before the presentation is queued (`const p = this.emit(ev, () => this.settle(..)); await p;`).
 *     A reload mid-show then never loses coins. Awaiting `emit` and settling afterwards is a contract violation.
 *     `anim`/`wait`/`nearMiss`/`celebrate`/`pourCoins` all honour the Speed upgrade.
 *  8. No module-level mutable state; no imports from other machine folders.
 *  9. Hidden information (cards, tiles, shells): publish redacted public events, send secrets with
 *     `emitPrivate`, and return per-recipient data from `getSnapshot(forPid)`. NEVER put secrets in a public event.
 * 10. Text you draw yourself (screens, HUD strip) is repainted in `onLang()`; kit `{ key }` labels redraw on their own.
 *
 * ── Round life-cycle (solo machines) ──────────────────────────────────────────────────────────────────
 *   beginRound(bet)  charges the stake, `busy = true`, re-seeds `this.rng` from (runSeed, instance, round#) so a
 *                    reload / re-sit never re-rolls (TECH §11.4). Extra stakes inside the round: `addStake`.
 *   emit(event)      outcome → every peer's `present()`; resolves when the local presentation finished.
 *   settle({gross})  pays out, `busy = false`, adds the catalogue tier tags (`bigwin`…`megawin`).
 *   Practice (coach.ts): on a scripted solo machine the profile's first plays are free. `beginRound` / `addStake` /
 *                    `settle` then never touch the run, and the round draws from its own seeded stream (the round counter,
 *                    and so every paid round's stream, is untouched). Machines need no code for it.
 *   Ladder games (coin-flip rides, hi-lo) keep the round OPEN between decisions: set `busy = false` while the
 *   player decides (release stays possible; the machine settles in `onRelease`) — `roundOpen` stays true.
 *
 * ── Input / sink ──────────────────────────────────────────────────────────────────────────────────────
 * World & PLAYER hand `machine.sink` (not the machine) to `input.setMachineSink`: the sink turns the `exit`
 * action into `standUp()` (deferred while busy) and forwards everything else to `onInput`. Subclasses never
 * see `exit`. `requestStandUp()` is the public entry for pause-menu "STAND UP".
 *
 * ── Integration surface for World / Session / PLAYER (underscore members; machines never call these) ──
 *   _build()                          once after `new`: createModel in try/catch (→ `kit.outOfOrder`), dev lint
 *   (then World adds `root` to the slot group, registers colliders / interact box, calls `init()`, `setLocked`)
 *   _step(dt)  fixed 60 Hz            bookkeeping + `tick` + (host) `hostTick`;  TableBase also drains queued actions
 *   _frame(dt, t) render rate         only while visible; runs `frame` and (idle, unoccupied) `attract`
 *   _occupy(pid, seat, seed, local)   a seat was granted (`moccOk`); `local` ⇒ occupancy RNG, onOccupy, HUD ownership
 *   _release(pid, seat, local)        seat freed (`mrelOk`); clears the local HUD, warns if a stake was left open
 *   _receive(env)                     a remote `MachineEnvelope` (public, or private addressed to us) → queued `present`
 *   _snapshot(forPid?) / _restore(snap, from?)   late join / save: `{ r: round#, q: event cursor, s: machine state, tm: table timer }`
 *   TableBase: _receiveAction(pid, seat, rid, a) (`tact` on the host), _setBot(seat, name|null, level) (`mbot`)
 *   `sink` → `input.setMachineSink(m.sink)` while seated;  `requestStandUp()` → pause-menu "STAND UP".
 *
 * ── Class-field caveat (useDefineForClassFields) ─────────────────────────────────────────────────────
 * Subclass field initializers run AFTER this constructor, so the constructor never calls overridable
 * methods; setup goes in `init()`. Subclasses must NOT redeclare base fields (`model`, `seats`, `bet` …).
 */
import * as THREE from 'three';
import type { InstanceId, Json, PlayerId } from '@/core/types';
import type { PlayOpts, SfxName } from '@/core/audio/types';
import type { MachineHudSpec, ToastKind } from '@/core/ui/types';
import type { MachineAction, MachineInputEvent, MachinePointerEvent, MachineSink } from '@/core/input/types';
import { REPEATABLE_MACHINE_ACTIONS } from '@/core/keymap';
import type { Ease } from '@/core/tween';
import type { Kit } from '@/kit/types';
import type { EcoSource, ModHook, WinMeta, WinTier } from '@/game/types';
import { createRng, hashSeed, randomSeed, type Rng } from '@/core/rng';
import { disposeObject3D } from '@/core/dispose';
import { log } from '@/core/log';
import { clamp } from '@/core/math';
import { t as tr, fmtCoins, registerStrings, type I18nVars } from '@/core/i18n';
import { SLOT_DIMS, type MachineContext, type MachineDef, type MachineEnvelope, type MachineEvent, type MachineModel, type PresentCtx } from './types';
import { juiceTier, streakPitch, tierTags, toWinTier, type JuiceTier } from './tiers';
import * as juice from './juice';
import { RiskLayer } from './riskLayer';
import { Coach } from './coach';
import { GambleUi } from '@/game/gambleUi';
import { HS_MULT, gamblesLive } from '@/game/gamble';
import { BIG_CONFIRM_SEC, presetOf, stakeKeyOwned, stakePresetAmounts, STAKE_PRESET_ACTION, STAKE_PRESET_KEYS, type StakePresetKey, type StakePresetRow } from './stakePresets';

const FORCE_RELEASE_S = 10;
/** How often the seated machine re-checks its smart-stake presets (cheap: the HUD is written only on change). */
const STAKE_POLL_S = 0.25;

/**
 * Space / LMB (`primary`) and Enter (`confirm`) are aliases on every machine (TECH §11.6). Machines were written
 * against one of the two, so the sink folds the other onto the one the machine handles; machines that handle both
 * (the vast majority) receive each press as it came, once. Keyed by `def.id`; a subclass may override `inputAlias`.
 */
const CONFIRM_ONLY = new Set([
  'roulette', 'craps', 'keno', 'sicbo', 'bigsix', 'bingo', 'lottoblower', 'derby', 'dicetower', 'fantan', 'tombola',
]);
const PRIMARY_ONLY = new Set(['bingopin', 'coinpusher', 'pachinko', 'shellgame', 'stacker']);

/** Machines that already queue their own primary presses while busy (plinko `queueDrop`): the base must not queue too. */
const QUEUES_OWN = new Set(['plinko']);

/** Spin cues a win streak lifts (`streakPitch`): the thunk and the reels of a machine on a run sound hotter. */
const SPIN_CUES = new Set(['lever', 'button', 'reelStart', 'reelStop', 'coinInsert']);

/** Cue strings for the press queue (`ui.ctl.*`, same prefix as the controls lane). */
registerStrings('ui.', {
  en: { 'ctl.queued': 'Press queued', 'ctl.queueFull': 'Already queued' },
  tr: { 'ctl.queued': 'Basış sıraya alındı', 'ctl.queueFull': 'Zaten sırada' },
});

/** Argument of `buildModel(kit, o)` (TECH §11.5): deterministic per-instance variation. */
export interface ModelOpts { seed: number; variant: 0 | 1 | 2 | 3; lod?: 0 | 1 }

/** Wire / save form of a machine: base bookkeeping around the machine's own snapshot `s`. */
/** Snapshot envelope. `owner` = explicit occupant pid (DECISIONS G); null when unoccupied. Old saves may lack it. */
export interface MachineSnap<S extends Json = Json> { r: number; q: number; s: S | null; owner?: PlayerId | null; tm?: { until: number; label: string } | null }

/** Cosmetic non-player on a seat (DECISIONS C27): staff, shill or patron. Never affects outcomes or the wallet. */
export type NpcKind = 'staff' | 'shill' | 'patron';

export abstract class MachineBase<P extends object = Record<string, THREE.Object3D>,
                                  E extends MachineEvent = MachineEvent,
                                  S extends Json = Json> implements MachineSink {
  readonly ctx: MachineContext;
  readonly def: MachineDef;
  readonly id: InstanceId;
  model: MachineModel<P>;
  readonly seats: (PlayerId | null)[];     // length def.seats; bots occupy with negative ids
  busy = false;                           // an animation / resolution is in progress (blocks release)
  locked = false;
  bet: number;                            // selected bet (local UI), starts at def.minBet
  rng: Rng;                               // outcome stream; re-seeded per round while the local player occupies
  readonly hostRng: Rng;                  // table stream; meaningful on host only
  readonly worldRng: Rng;                 // identical on all peers
  readonly cosmetic: Rng;                 // unsynced visuals
  visible = false;                        // maintained by World

  // ── internals (underscore = called by World/Session/TableBase only) ──
  private _seqOut = 0;
  private _lastSeq = new Map<PlayerId, number>();
  private _pending = 0;
  private _chain: Promise<void> = Promise.resolve();
  private _roundBet = 0;
  private _round = 0;
  private _roundOpen = false;
  private _releaseRequested = false;
  private _releaseWait = 0;
  private _lockObj: THREE.Object3D | null = null;
  private _tracked: Array<{ dispose(): void }> = [];
  private _disposed = false;
  private _riskL: RiskLayer | null = null;
  /** Stake multiplier of the open round (HIGH STAKES = 5, else 1); the machine only ever sees its own nominal numbers. */
  private _hsMult = 1;
  /** Smart stakes (stakePresets.ts): seconds left for BIG's second press (0 = not armed), the last published state, the poll clock. */
  private _stakeBigArm = 0;
  private _stakeSig = '';
  private _stakeT = 0;
  private _offLang: (() => void) | null = null;
  /** True once `onWatchClosed` ran for the current close (re-armed when gambles go live again). */
  private _watchWrapped = false;
  private _ray = new THREE.Raycaster();
  private _sink: MachineSink | null = null;
  private _attract: juice.AttractScript | null = null;
  /** Win streak of the local occupant (see `settle`): reset on a loss, on a new occupant and on stand-up. */
  private _streak = 0;
  /** Default idle show (`idleShow`): the glint scheduler, built once from the parts that have a marquee or bulbs. */
  private _idle: juice.AttractScript | null = null;
  private _idleChecked = false;
  /** The latest `anticipate` call: only its own music fall-back runs (a newer call replaces it). */
  private _antTok = 0;
  /** The seat coach (coach.ts) of the local seat, while it has steps or free plays left; TableBase feeds it too. */
  protected _coach: Coach | null = null;
  private _coachBet = 0;
  private _coachSig = '';
  /** Active `_timer` (see TableBase.countdown): host-ms deadline + label. */
  protected timerState: { until: number; label: string } | null = null;

  constructor(ctx: MachineContext) {
    this.ctx = ctx;
    this.def = ctx.def;
    this.id = ctx.instanceId;
    this.seats = new Array<PlayerId | null>(ctx.def.seats).fill(null);
    this.bet = ctx.def.minBet;
    this.rng = createRng(hashSeed(ctx.runSeed, ctx.instanceId, 0));
    this.hostRng = createRng(hashSeed(ctx.runSeed, ctx.instanceId, 'table'));
    this.worldRng = createRng(hashSeed(ctx.runSeed, ctx.instanceId, 'init'));
    this.cosmetic = createRng(randomSeed());
  }

  // ── override points ──────────────────────────────────────────────────────────────────────────────
  protected abstract createModel(kit: Kit): MachineModel<P>;   // usually `return buildModel(kit, this.modelOpts)`
  init(): void {}
  tick(_dt: number): void {}              // fixed 60 Hz, every peer — keep ≤ 0.05 ms when idle
  hostTick(_dt: number): void {}          // fixed 60 Hz, host only (tables, shared timers)
  frame(_dt: number, _t: number): void {} // render rate, only when visible — visual-only
  attract(_dt: number, _t: number): void {} // render rate, visible && unoccupied && !busy
  onOccupy(_pid: PlayerId, _seat: number, _local: boolean): void {}
  onRelease(_pid: PlayerId, _seat: number, _local: boolean): void {}
  onInput(_e: MachineInputEvent): void {} // local occupant only, delivered at step start (never `exit`, see `sink`)
  onPointer(_e: MachinePointerEvent): void {} // local occupant only, pose.mouse === 'pick'
  /** The language changed: repaint diegetic screens and the HUD strip (kit `{ key }` texts re-draw themselves). */
  onLang(): void {}
  /**
   * The Watch closed (`gamblesLive` went false: the floor stopped taking plays) and the seated local player has nothing in flight
   * (`!busy`): finish what is pending and stay seated. A ladder collects (or refunds), a chase or double-up is taken: nothing may
   * keep paying into Dawn. Runs once per close, as soon as the machine is idle; a machine with nothing pending leaves it empty.
   */
  protected onWatchClosed(): void {}

  // ── cosmetic NPCs and headless replay (DECISIONS C27) ──
  private _npc: { seat: number; kind: NpcKind } | null = null;
  /** Put a cosmetic staff / shill / patron on `seat`. Visual only: no wallet, no outcome, no seat grant. */
  npcOccupy(seat: number, kind: NpcKind): void { this._npc = { seat, kind }; }
  npcRelease(): void { this._npc = null; }
  get npc(): { seat: number; kind: NpcKind } | null { return this._npc; }
  /**
   * Cosmetic replay of a headless round (`def.headless`) on this device: runs `present()` as a fast, non-local
   * event so NPCs and shills show the result without touching the wallet or the round counter.
   */
  presentHeadless(result: E): void {
    const pc: PresentCtx = { local: false, pid: 0, seq: 0, fast: true, priv: false, t: this.ctx.net.hostTime() };
    void this.present(result, pc);
  }
  abstract present(ev: E, pc: PresentCtx): void | Promise<void>;   // ALL peers incl. emitter
  /**
   * State for late joiners / saves. `forPid` is the recipient: hidden-information machines MUST redact
   * everything that player may not see (and return `undefined`-free JSON). `forPid === undefined` = full state (host save).
   * Stateless machines return null.
   */
  getSnapshot(_forPid?: PlayerId): S | null { return null; }
  applySnapshot(_s: S): void {}
  /** Default: add/remove the chain-and-padlock overlay. */
  setLocked(on: boolean): void {
    this.locked = on;
    if (on && !this._lockObj) {
      this._lockObj = this.ctx.kit.lockOverlay(this.def.slotSize);
      this.model.root.add(this._lockObj);
    } else if (!on && this._lockObj) {
      this._lockObj.removeFromParent();
      disposeObject3D(this._lockObj, { detach: false });
      this._lockObj = null;
    }
  }
  debugForce?(arg: string): void;         // bench "force outcome" field
  /** Call `super.dispose()` if overridden. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._offLang?.(); this._offLang = null;
    this._riskL?.dispose(); this._riskL = null;
    try { this.model?.dispose?.(); } catch (e) { log.error('machine', this.id, e); }
    for (const d of this._tracked.splice(0)) { try { d.dispose(); } catch (e) { log.error('machine', this.id, e); } }
    if (this.model?.root) disposeObject3D(this.model.root, { skipShared: true });
  }

  // ── helpers (final) ──────────────────────────────────────────────────────────────────────────────
  get parts(): P { return this.model.parts; }
  get root(): THREE.Group { return this.model.root; }
  get isHost(): boolean { return this.ctx.net.isHost; }
  get selfId(): PlayerId { return this.ctx.net.selfId; }
  get occupant(): PlayerId | null { return this.seats[0] ?? null; }
  /** Wins in a row for the local occupant (0 for everyone else). Read by `juice.celebrate` for the streak show. */
  get winStreak(): number { return this.isLocalOccupant ? this._streak : 0; }
  get localSeat(): number { return this.seats.indexOf(this.ctx.net.selfId); }
  get isLocalOccupant(): boolean { return this.localSeat >= 0; }
  get src(): EcoSource { return { mid: this.id, machineId: this.def.id }; }
  get disposed(): boolean { return this._disposed; }
  /** Gambles are live (`gamblesLive` over the run's phase): false from the Watch's close (`closing`) to the next Watch. */
  get gamblesLive(): boolean { return gamblesLive(this.ctx.run.shift?.phase); }
  /** Per-instance counter of rounds begun here; persisted through `_snapshot`. */
  get roundNo(): number { return this._round; }
  /** A stake is on the table and no `settle` happened yet (true also while a ladder waits for the player). */
  get roundOpen(): boolean { return this._roundOpen; }
  /** Stake of the current round including `addStake`s (valid while `roundOpen`). */
  protected get roundBet(): number { return this._roundBet; }
  /** `buildModel(kit, this.modelOpts)`: stable per-instance seed + colourway 0..3 (TECH §11.5). */
  protected get modelOpts(): ModelOpts {
    const h = hashSeed(this.id);
    return { seed: h, variant: (h % 4) as 0 | 1 | 2 | 3 };
  }
  /** `MachineSink.mouse`: tables/solo with `pose.mouse === 'pick'` receive pointer events. */
  get mouse(): 'primary' | 'pick' {
    const seat = Math.max(0, this.localSeat);
    return (this.model.seats?.[seat]?.pose ?? this.model.playPose)?.mouse ?? 'primary';
  }
  /**
   * The object to give `input.setMachineSink(...)`: handles the reserved `exit` action (stand up, deferred
   * while busy) and forwards everything else to `onInput` / `onPointer`.
   */
  get sink(): MachineSink {
    if (this._sink) return this._sink;
    const self = this;
    this._sink = {
      get mouse() { return self.mouse; },
      onInput(e) {
        if (e.action === 'exit') { if (e.down && !e.repeat) { self._riskL?.onExit(); self.onStandUpRequest(); self.standUp(); } return; }
        if (e.down && e.repeat && !REPEATABLE_MACHINE_ACTIONS.has(e.action)) return;   // auto-repeat: bet ladder / cursor only
        self._route(e);
      },
      onPointer(e) { self.onPointer(e); },
    };
    return this._sink;
  }
  /**
   * Which of `primary` / `confirm` this machine actually handles when it handles only one (the sink folds the other
   * onto it); `null` = handles both (or treats them differently, e.g. mines): events pass unchanged.
   */
  protected get inputAlias(): 'primary' | 'confirm' | null {
    const id = this.def.id;
    return CONFIRM_ONLY.has(id) ? 'confirm' : PRIMARY_ONLY.has(id) ? 'primary' : null;
  }
  /** primary ↔ confirm held sources per folded press, so Space + Enter together fire the machine once. */
  private _aliasHeld = new Set<MachineAction>();
  /** The one queued main-action press (see `_queuePress`), and whether its key is still down. */
  private _pend: MachineInputEvent | null = null;
  private _pendHeld = false;
  /** Sink → machine: fold the primary / confirm alias, then `onInput`. */
  private _route(e: MachineInputEvent): void {
    if (e.down && !e.repeat) this._coach?.press(e.action);
    if (this._riskL?.route(e as MachineInputEvent & { code?: string; mods?: { shift?: boolean } })) return;   // risk layer keys (G / Shift+H / K / ladder)
    // smart stakes: 7 SAFE, 8 BOLD, 9 BIG (stakePresets.ts). A digit the machine keeps for itself is passed on below.
    const preset = presetOf(e.action);
    if (preset !== null && this.def.minBet > 0 && !stakeKeyOwned(this.def.id, e.action)) {
      if (e.down && !e.repeat) this.pressPreset(preset);
      return;
    }
    const to = this.inputAlias;
    if (to === null || (e.action !== 'primary' && e.action !== 'confirm')) { this.onInput(e); return; }
    const src = e.action;
    const held = this._aliasHeld;
    let pass: boolean;
    if (e.down) {
      if (e.repeat) pass = held.size === 1 && held.has(src);
      else { pass = held.size === 0; held.add(src); }
    } else {
      held.delete(src);
      pass = held.size === 0;
    }
    if (!pass) return;
    const ev = src === to ? e : { ...e, action: to };
    if (this._queuePress(ev)) return;
    this.onInput(ev);
  }
  /**
   * Press queue (QA/UX): a press of the machine's main action while a round is still animating (`busy`) is kept as
   * ONE pending press and replayed when the machine is ready again. Extra presses during the wait are dropped
   * (toast cue). Machines that queue their own presses (`QUEUES_OWN`) or override `queuesPrimary` skip this.
   * Returns true when the event was swallowed (queued, dropped, or the up of a queued press).
   */
  private _queuePress(ev: MachineInputEvent): boolean {
    const main = this.inputAlias ?? 'primary';
    if (ev.action !== main) return false;
    if (!ev.down) {
      if (this._pend === null) return false;
      this._pendHeld = false;                  // released while queued: the replay will send the up too
      return true;
    }
    if (ev.repeat) return this._pend !== null;   // auto-repeat never queues (the sink already filters it)
    if (!this.busy && this._pend === null) return false;
    if (!this.queuesPrimary) return false;
    if (this._pend !== null) { this.toast(tr('ui.ctl.queueFull'), 'info'); return true; }   // one pending press only
    this._pend = { ...ev, repeat: false };
    this._pendHeld = true;
    this.toast(tr('ui.ctl.queued'), 'info');
    return true;
  }
  /** Replays the queued press once the machine is no longer busy (called at the start of `_step`). */
  private _firePending(): void {
    const p = this._pend;
    if (p === null || this.busy) return;
    this._pend = null;
    if (!this.isLocalOccupant || this._releaseRequested) { this._pendHeld = false; return; }
    this.onInput({ ...p, down: true });
    if (!this._pendHeld) this.onInput({ ...p, down: false });   // already released: send the matching up
    this._pendHeld = false;
  }
  /** Opt-out per machine: return false where a primary press during a round must NOT be queued. */
  protected get queuesPrimary(): boolean { return !QUEUES_OWN.has(this.def.id); }
  /**
   * Public "STAND UP" (pause menu, world.standUp): same as pressing E — deferred while busy.
   * Runs `onStandUpRequest` first, so autoplay is cancelled at once even when the release waits for the round.
   */
  requestStandUp(): void { this.onStandUpRequest(); this.standUp(); }
  /** Hook: the player asked to stand up (E or pause menu). Cancel autoplay / hold-over state here; the release may still wait for `busy`. */
  protected onStandUpRequest(): void {}
  /** Seconds left on the table countdown (0 if none). */
  protected get timerLeft(): number {
    return this.timerState ? Math.max(0, (this.timerState.until - this.ctx.net.hostTime()) / 1000) : 0;
  }

  /**
   * Stamp → present locally (queued) → network; resolves when the local present finished.
   * `credit` (DECISIONS G, settle-before-present): the wallet step of this event (`settle(...)`, `run.win`). It runs
   * synchronously, after the authority check and BEFORE the event is queued, so a reload or a stalled show can never
   * lose the payout. Use it instead of `await emit(); settle()`: `const shown = this.emit(ev, () => this.settle(r)); await shown;`.
   */
  protected emit(ev: E, credit?: () => void): Promise<void> {
    const ok = this.def.shared ? this.isHost : this.isLocalOccupant;
    if (!ok || this._disposed) { log.warn('machine', `${this.id} illegal emit ${ev.k}`); return Promise.resolve(); }
    credit?.();
    const env: MachineEnvelope = { mid: this.id, seq: ++this._seqOut, pid: this.selfId, ev, t: this.ctx.net.hostTime() };
    this.ctx.net.sendEvent(env);            // client → host (host validates & forwards) | host → all clients
    return this._enqueue(env, true);
  }

  /**
   * HOST ONLY. Send `ev` to exactly one player (their own hand/tiles/peek) — never forwarded, never stored.
   * `present()` receives it with `pc.priv === true`. Sending to a bot is a no-op; to the host itself, local.
   */
  protected emitPrivate(to: PlayerId, ev: E): Promise<void> {
    if (!this.isHost) { log.warn('machine', `${this.id} emitPrivate from a non-host`); return Promise.resolve(); }
    const env: MachineEnvelope = { mid: this.id, seq: ++this._seqOut, pid: this.selfId, ev, to, t: this.ctx.net.hostTime() };
    if (to < 0) return Promise.resolve();
    if (to === this.selfId) return this._enqueue(env, true);
    this.ctx.net.sendPrivate(to, env);
    return Promise.resolve();
  }

  /** Called by World for remote envelopes (public or private addressed to us). */
  _receive(env: MachineEnvelope): void {
    if (this._disposed) return;
    if (env.to === undefined) {                       // private envelopes use the host's separate counter
      if (env.seq <= (this._lastSeq.get(env.pid) ?? 0)) return;     // duplicate
      this._lastSeq.set(env.pid, env.seq);
    }
    void this._enqueue(env, false);
  }

  private _enqueue(env: MachineEnvelope, local: boolean): Promise<void> {
    const pc: PresentCtx = {
      local, pid: env.pid, seq: env.seq, fast: this._pending > 4,
      priv: env.to !== undefined, t: env.t ?? this.ctx.net.hostTime(),
    };
    this._pending++;
    this._chain = this._chain.then(async () => {
      try {
        const ev = env.ev as E;
        if (typeof ev?.k === 'string' && ev.k.startsWith('_')) this._presentBase(ev, pc);
        else await this.present(ev, pc);
      } catch (e) { log.error('machine', this.id, e); } finally { this._pending--; }
    });
    return this._chain;
  }

  /** Reserved `_`-events (TableBase: `_timer`). */
  protected _presentBase(ev: MachineEvent, _pc: PresentCtx): void {
    if (ev.k === '_timer') this.timerState = { until: Number(ev.until), label: String(ev.label ?? '') };
    else if (ev.k === '_timerEnd') this.timerState = null;
  }

  // ── snapshots ──
  /** World / Session call this instead of `getSnapshot` so the round counter and event cursor travel along. */
  _snapshot(forPid?: PlayerId): MachineSnap<S> {
    return { r: this._round, q: this._seqOut, s: this.getSnapshot(forPid), owner: this.occupant, tm: this.timerState };
  }
  /** Inverse of `_snapshot`. `from` = the emitting peer (host) whose events with `seq ≤ q` are already baked in. */
  _restore(snap: MachineSnap<S>, from?: PlayerId): void {
    this._round = snap.r;
    this.timerState = snap.tm ?? null;
    if (from !== undefined) this._lastSeq.set(from, Math.max(snap.q, this._lastSeq.get(from) ?? 0));
    if (snap.s !== null && snap.s !== undefined) this.applySnapshot(snap.s);
  }

  // ── economy ──
  /**
   * Why a bet failed (`run.lastRefusal()`): no pulls left this Vardiya, the stake-confirm prompt (first press on a big
   * stake), the stake limit (above the cap, or below the minimum), the floor closed, or not enough coins.
   */
  private toastRefusal(amount: number): void {
    const run = this.ctx.run;
    const why = run.lastRefusal();
    if (why === 'confirm') this.toast(tr('stake.confirm', { amount, pocket: run.wallet() }), 'warn');
    else if (why === 'pulls') this.toast(tr('stake.pulls'), 'warn');
    else if (why === 'phase') this.toast(tr('stake.phase'), 'warn');
    else if (why === 'limit') {
      // Below the floor: HIGH TABLE (a raised minimum) names its own minimum; otherwise the machine minimum. Above: the Night's cap.
      const lim = run.betLimits(this.def.id, this.id);
      if (amount < lim.min && lim.min > this.def.minBet) this.toast(tr('stake.highMin', { min: fmtCoins(lim.min) }), 'warn');
      else if (amount < lim.min) this.toast(tr('stake.minBet', { min: fmtCoins(this.def.minBet), pocket: fmtCoins(run.wallet()) }), 'warn');
      else this.toast(tr('stake.cap', { max: fmtCoins(lim.max) }), 'warn');
    }
    else this.toast(tr('common.noFunds'), 'bad');
  }
  /**
   * Solo: `!busy && !roundOpen`, `run.bet()`; toast + buzzer on failure; sets `busy`. Re-seeds `this.rng` from
   * (runSeed, instance, round#) — identical after a reload because the round counter is persisted.
   */
  protected beginRound(bet: number = this.bet): boolean {
    if (this.busy || this._roundOpen || this._riskL?.ladderOpen) return false;
    const coach = this._coach;
    if (coach?.practice && this.gamblesLive) {             // a free practice play: no run.bet, its own seeded stream
      this._hsMult = 1;
      this.busy = true;
      this._roundOpen = true;
      this._roundBet = bet;
      this.rng = createRng(hashSeed(this.ctx.runSeed, this.id, 'practice', coach.practiceUsed));
      coach.round(true);
      return true;
    }
    // the current bet outruns the pocket: step it down first (toasted); with no affordable stake there is no round
    if (bet === this.bet && this.costOf(bet) > this.ctx.run.wallet()) {
      if (!this.fitBet()) { this.sfx('buzzer'); return false; }
      bet = this.bet;
    }
    const hs = this._riskL ? this._riskL.hsBegin(bet, this.costOf(bet)) : 1;     // HIGH STAKES: takes the extra x4 first
    if (hs === 0 || !this.ctx.run.bet(bet, this.src)) {
      if (hs > 1) this._riskL?.hsUndo(bet);
      if (hs !== 0) this.toastRefusal(bet);
      this.sfx('buzzer');
      return false;
    }
    this._hsMult = hs;
    this.busy = true;
    this._roundOpen = true;
    this._roundBet = bet;
    this.rng = createRng(hashSeed(this.ctx.runSeed, this.id, ++this._round));
    coach?.round(false);
    return true;
  }
  /**
   * Extra stake inside an open round (double, split, insurance, raise, extra balls …). Summed into the round's
   * `bet` so there is ONE outcome per round (catalogue §1.4). Returns false (toast + buzzer) when unaffordable.
   */
  protected addStake(amount: number): boolean {
    if (!this._roundOpen) { log.warn('machine', `${this.id} addStake without an open round`); return false; }
    if (this._coach?.practiceRound) { this._roundBet += amount; return true; }   // practice: the extra stake is free too
    const extra = this._hsMult > 1 ? (this._hsMult - 1) * amount : 0;           // HIGH STAKES: the extra stake rides along
    if (extra > 0 && this.ctx.run.wallet() < this.costOf(amount) + extra) { this.sfx('buzzer'); return false; }
    if (extra > 0 && this._riskL && this._riskL.hsBegin(amount, this.costOf(amount)) === 0) { this.sfx('buzzer'); return false; }
    if (!this.ctx.run.bet(amount, this.src)) {
      if (extra > 0) this._riskL?.hsUndo(amount);
      this.toastRefusal(amount);
      this.sfx('buzzer');
      return false;
    }
    this._roundBet += amount;
    return true;
  }
  /** `run.win()`; closes the round (`busy = false`); returns credited. Adds `bigwin/hugewin/megawin` tags by multiple. */
  protected settle(r: { gross: number; tier?: WinTier; tags?: string[]; silent?: boolean }): number {
    if (this._coach?.practiceRound) {                      // practice: nothing is paid, counted or offered
      this._roundOpen = false;
      this.busy = false;
      this._coach.result(r.gross, this._roundBet);
      if (this._releaseRequested) this.standUp();
      return 0;
    }
    const mult = this._hsMult;
    const nominal = this._roundBet;
    const gross = mult > 1 && this._riskL ? this._riskL.hsPay(r.gross, nominal, mult) : r.gross;   // HIGH STAKES: x5 and a fatter tail
    const bet = nominal * mult;
    const jt = juiceTier(gross, bet, r.tags);
    const tags = [...new Set([...(r.tags ?? []), ...tierTags(jt), ...(mult > 1 ? ['highstakes'] : [])])];
    const meta: WinMeta = { bet, tier: r.tier ?? toWinTier(jt), tags, silent: r.silent };
    this._roundOpen = false;
    this._hsMult = 1;
    const credited = this.ctx.run.win(gross, this.src, meta);
    if (this.isLocalOccupant) this._coach?.result(gross, bet);
    // win streak (presentation only): a win extends it, a loss ends it, a push leaves it as it was
    if (this.isLocalOccupant) { if (gross > bet) this._streak++; else if (gross < bet) this._streak = 0; }
    this.busy = false;
    this.offerGamble(credited);
    if (this.isLocalOccupant) this.fitBet();          // a lost round can leave the pocket under the current bet
    if (this._releaseRequested) this.standUp();
    return credited;
  }

  /**
   * Ladder games: re-open an unsettled round restored by `applySnapshot` (a pot still at risk after a reload or
   * a late-join restore), so the player can ride or collect it. No-op unless the local player sits here, so
   * call it from `applySnapshot` AND from `onOccupy(local)` (the owner may be seated after the restore).
   * Never call while a round is being resolved.
   */
  protected resumeRound(bet: number): void {
    if (!this.isLocalOccupant) return;
    this._hsMult = 1;     // spectators / late joiners never own the stake (no phantom rounds)
    this._roundOpen = true; this._roundBet = bet; this.busy = false;
  }

  /** Bet ladder: `def.betSteps` (or doubling min→max), extended in 1-2-5 steps up to `max × bet.maxMult`. */
  protected betLadder(): number[] {
    const d = this.def;
    let base = d.betSteps ? [...d.betSteps] : (() => { const a: number[] = []; for (let b = d.minBet; b < d.maxBet; b *= 2) a.push(b); a.push(d.maxBet); return a; })();
    // the run's limit (Night 1 stake cap, SI) wins: never offer a stake the run would refuse
    const limits = this.ctx.run.betLimits(d.id, this.id);
    const lim = Math.max(d.minBet, limits.max);
    // ...and never one below the run's minimum (HIGH TABLE doubles it): the run would refuse it as 'limit'
    const floor = Math.min(lim, Math.max(d.minBet, limits.min ?? d.minBet));
    base = base.filter((v) => v <= lim && v >= floor);
    if (!base.length) base = [floor];
    const cap = Math.min(lim, Math.floor(d.maxBet * this.mod('bet.maxMult', 1)));
    let last = base[base.length - 1];
    for (let e = Math.pow(10, Math.floor(Math.log10(Math.max(1, last)))); last < cap && e < 1e15; e *= 10) {
      for (const m of [1, 2, 5]) { const v = m * e; if (v > last && v <= cap) { base.push(v); last = v; } }
    }
    return base;
  }
  protected stepBet(dir: 1 | -1): void {
    const ladder = this.betLadder();
    let i = ladder.findIndex((v) => v >= this.bet);
    if (i < 0) i = ladder.length - 1;
    i = clamp(i + dir, 0, ladder.length - 1);
    const next = ladder[i];
    // stepping down is always allowed; stepping up needs the coins (the minimum bet is always selectable)
    if (dir < 0 || next <= this.ctx.run.wallet() || next <= this.def.minBet) this.bet = next;
  }
  protected maxBet(): void {
    const w = this.ctx.run.wallet();
    const ok = this.betLadder().filter((v) => v <= w);
    this.bet = ok.length ? ok[ok.length - 1] : this.def.minBet;
  }
  // ── smart stakes (stakePresets.ts): 7 SAFE (~5 % of the pocket), 8 BOLD (~15 %), 9 BIG (~30 %, second press) ──
  /** The three preset stakes for the pocket now: the bet ladder (the run's cap included), High Stakes aware. */
  protected stakePresets(): Record<StakePresetKey, number> {
    return stakePresetAmounts({
      pocket: this.ctx.run.wallet(), min: this.def.minBet, ladder: this.betLadder(),
      costOf: (v) => this.costOf(v), hsMult: this._riskL?.highStakes ? HS_MULT : 1,
    });
  }
  /** A preset key was pressed: SAFE and BOLD set at once; BIG asks for a second press (the high-stake confirm). */
  private pressPreset(key: StakePresetKey): void {
    if (!this.isLocalOccupant || this.busy || this.roundOpen || this._riskL?.ladderOpen) return;   // a stake is on the table: the next round takes the new one
    const amount = this.stakePresets()[key];
    if (key === 'big' && this.bet !== amount && this._stakeBigArm <= 0) {
      this._stakeBigArm = BIG_CONFIRM_SEC;
      this.ctx.events.emit('stake:confirm', { need: true });
      this.sfx('click');
      this.toast(tr('stakePreset.armBig', { key: this.ctx.input.keyLabel(`m.${STAKE_PRESET_ACTION.big}`), amount: fmtCoins(amount) }), 'warn');
      this.publishStakes();
      return;
    }
    this.disarmBig();
    this.bet = amount;
    this.sfx('click');
    this.toast(tr('stakePreset.set', { name: tr(`stakePreset.${key}`), amount: fmtCoins(amount) }), 'info');
    this.publishStakes();
  }
  private disarmBig(): void {
    if (this._stakeBigArm <= 0) return;
    this._stakeBigArm = 0;
    this.ctx.events.emit('stake:confirm', { need: false });
  }
  /** Publishes the presets to the seat HUD (`stake:presets`) when they changed. `on: false` clears them (stand-up). */
  private publishStakes(on = true): void {
    const amounts = on && this.def.minBet > 0 && this.isLocalOccupant ? this.stakePresets() : null;
    const pocket = this.ctx.run.wallet();
    const hs = this._riskL?.highStakes ?? false;
    const armed = this._stakeBigArm > 0 ? 'big' : null;
    const sig = amounts === null ? 'off' : `${this.bet}|${pocket}|${hs}|${armed}|${amounts.safe}|${amounts.bold}|${amounts.big}`;
    if (sig === this._stakeSig) return;
    this._stakeSig = sig;
    if (amounts === null) { this.ctx.events.emit('stake:presets', { mid: this.id, on: false, bet: this.bet, pocket, hs, active: null, armed: null, rows: [] }); return; }
    const rows: StakePresetRow[] = STAKE_PRESET_KEYS.map((key) => {
      const action = STAKE_PRESET_ACTION[key];
      return { key, amount: amounts[key], keyLabel: stakeKeyOwned(this.def.id, action) ? '' : this.ctx.input.keyLabel(`m.${action}`) };
    });
    const active = STAKE_PRESET_KEYS.find((k) => amounts[k] === this.bet) ?? null;
    this.ctx.events.emit('stake:presets', { mid: this.id, on: true, bet: this.bet, pocket, hs, active, armed, rows, pullCost: this.def.actionCost ?? 1 });
  }
  /** Feeds the coach what it polls (the stake, the DOUBLE OR NOTHING offer, the show queue) and publishes its box. */
  private coachStep(dt: number): void {
    const c = this._coach!;
    if (this.bet !== this._coachBet) { this._coachBet = this.bet; c.bet(); }
    c.offer(this._riskL?.offerLive ?? false);
    c.tick(dt, this._pending === 0);
    this.publishCoach();
  }
  /** `coach:view` for the seat HUD, on change only (null when there is no coach). */
  private publishCoach(force = false): void {
    const v = this._coach && this.isLocalOccupant ? this._coach.view() : null;
    const sig = v ? `${v.keys.join(' ')}|${v.line}|${v.why}|${v.tone}|${v.tag}` : '';
    if (sig === this._coachSig && !force) return;
    this._coachSig = sig;
    this.ctx.events.emit('coach:view', { view: v });
  }
  /** Coins the run charges for a stake of `amount` (`bet.costMult`, the same fold `run.bet()` applies). */
  protected costOf(amount: number): number { return Math.ceil(amount * this.mod('bet.costMult', 1)); }
  /**
   * The pocket cannot cover the current bet: step it down to the highest ladder step it pays for, and toast the new
   * stake. When not even the minimum is affordable, the bet sits on the minimum and the toast reads "Min bet X — pocket Y".
   * Returns true when the current bet is affordable (nothing to do, or it was just lowered).
   */
  protected fitBet(): boolean {
    const w = this.ctx.run.wallet();
    if (this.costOf(this.bet) <= w) return true;
    const min = this.def.minBet;
    const ok = this.betLadder().filter((v) => v >= min && this.costOf(v) <= w);
    if (!ok.length) {
      this.bet = min;
      this.toast(tr('stake.minBet', { min: fmtCoins(min), pocket: fmtCoins(w) }), 'bad');
      return false;
    }
    this.bet = ok[ok.length - 1];
    this.toast(tr('stake.clamped', { bet: fmtCoins(this.bet), pocket: fmtCoins(w) }), 'warn');
    return true;
  }
  /** Fold `base` through every modifier source (charms, upgrades, buffs, totems …) in the context of THIS instance. */
  protected mod(hook: ModHook, base: number): number {
    return this.ctx.run.mod(hook, this.def.id, base, { instance: this.id });
  }
  protected luck(): number { return this.mod('luck', 0); }
  /** Milestone feature flag from the tycoon layer (e.g. 'bandit.extraLine'). */
  protected feature(name: string): boolean { return this.ctx.run.tycoon.hasFeature(this.id, name); }
  /** Animation-time multiplier from the Speed upgrade (<1 = faster). */
  protected get speed(): number { return this.mod('speed.mult', 1); }

  // ── time ──
  protected anim(dur: number, fn: (k: number) => void, ease?: Ease): Promise<void> {
    return this.ctx.tweens.run(dur * this.speed, fn, { ease }).promise;
  }
  protected wait(sec: number): Promise<void> { return this.ctx.timers.wait(sec * this.speed); }

  // ── feedback ──
  protected sfx(name: SfxName | string, o?: PlayOpts): void {
    const speaker = this.model?.anchors?.speaker;
    const hot = SPIN_CUES.has(name) ? streakPitch(this.winStreak) : 0;     // a win streak lifts the spin cues (local occupant only)
    const opts = hot > 0 ? { ...o, pitch: (o?.pitch ?? 0) + hot } : o;
    this.ctx.audio.play(name, speaker ? { pos: speaker, ...opts } : opts);
  }
  /** The reels' whirr loop for a spin (see juice.whirr): `stopped(done, total)` per landing reel, `end()` after the last. */
  protected whirr(vol?: number): juice.Whirr { return juice.whirr(this, vol); }
  protected t(key: string, vars?: I18nVars): string { return tr(`m.${this.def.id}.${key}`, vars); }
  protected hud(spec: MachineHudSpec | null): void { if (this.isLocalOccupant) this.ctx.ui.machineHud(spec); }
  protected toast(text: string, kind?: ToastKind): void { if (this.isLocalOccupant) this.ctx.ui.toast(text, kind); }
  /** Idle-animation scheduler (cosmetic RNG): `this.attractor.every('tap', 20, () => …)` in `init`, `.update(dt)` in `attract`. */
  protected get attractor(): juice.AttractScript {
    return (this._attract ??= new juice.AttractScript(this.cosmetic));
  }

  /** Tier-escalating win show (see juice.ts). Call from `present()`; fire-and-forget unless the show is short. */
  protected celebrate(tier: JuiceTier, o?: juice.CelebrateOpts): Promise<void> { return juice.celebrate(this, tier, { speed: this.speed, ...o }); }
  /**
   * Music tension before a show: the intensity rises to `level` now and falls back after `sec` (scaled by Speed).
   * Local player only; a newer call replaces the older fall-back. The fall-back goes to 0 (the music API has no
   * intensity getter, so the previous value cannot be restored).
   */
  protected anticipate(sec: number, level = 0.8): void {
    if (!this.isLocalOccupant || this._disposed || !(sec > 0)) return;
    const music = this.ctx.audio.music;
    const tok = ++this._antTok;
    music.setIntensity(clamp(level, 0, 1), 0.4);
    void this.wait(sec).then(() => { if (!this._disposed && tok === this._antTok) music.setIntensity(0, 1.5); });
  }
  /** Small readable loss feedback + sound. */
  protected commiserate(o?: { amount?: number; at?: THREE.Object3D }): void { juice.loss(this, o); }
  /** Held-breath tease before a "nearly won" loss; awaitable. */
  protected nearMiss(o: juice.NearMissOpts = {}): Promise<void> { return juice.nearMiss(this, { ...o, dur: (o.dur ?? 0.9) * this.speed }); }
  /** Pour coins into the tray with an optional count-up; awaitable. */
  protected pourCoins(amount: number, o?: juice.PourOpts): Promise<void> { return juice.pourCoins(this, amount, { speed: this.speed, ...o }); }

  protected pick(targets: THREE.Object3D[]): THREE.Intersection | null {
    this._ray.setFromCamera(this.ctx.input.pointerNdc, this.ctx.camera);
    return this._ray.intersectObjects(targets, true)[0] ?? null;
  }
  /** Request release; deferred while `busy` (forced after 10 s). */
  /** The local risk layer (DOUBLE OR NOTHING, HIGH STAKES, ALL-IN SHOT); created with the local seat. */
  protected get risk(): RiskLayer {
    if (this._riskL) return this._riskL;
    const self = this;
    return (this._riskL = new RiskLayer({
      id: this.id, src: this.src, runSeed: this.ctx.runSeed, shared: !!this.def.shared,
      get isLocalOccupant() { return self.isLocalOccupant; },
      get roundOpen() { return self._roundOpen; },
      get gamblesLive() { return self.gamblesLive; },
      get busy() { return self.busy; }, set busy(v: boolean) { self.busy = v; },
      run: this.ctx.run,
      wait: (s) => this.wait(s),
      toast: (text, kind) => this.toast(text, kind),
      sfx: (n) => this.sfx(n),
      fx: (kind, step, pot) => this.ctx.events.emit('gamble:fx', { kind: kind as never, mid: this.id, step, pot }),
      ui: () => new GambleUi(this.ctx.ui.root),
    }, this.ctx.run));
  }
  /** A win was credited to the local player: offers DOUBLE OR NOTHING (tables call it from `paySeat`). */
  protected offerGamble(credited: number): void {
    if (this._riskL && credited > 0 && this.isLocalOccupant) this._riskL.offerWin(credited);
  }
  protected standUp(): void {
    if (this.busy) {
      if (!this._releaseRequested) this.toast(tr('ui.ctl.standAfterRound'), 'info');   // once per request, not silently ignored
      this._releaseRequested = true;
      return;
    }
    this._releaseRequested = false;
    this._releaseWait = 0;
    const seat = this.localSeat;
    if (seat >= 0) this.ctx.net.requestRelease(this.id, seat);
  }
  protected track<T extends { dispose(): void }>(d: T): T { this._tracked.push(d); return d; }

  // ── lifecycle, called by World ──────────────────────────────────────────────────────────────────
  /** Build the model (try/catch → out-of-order placeholder). Never call from the constructor. */
  _build(): void {
    const kit = this.ctx.kit;
    try {
      this.model = this.createModel(kit);
      for (const o of Object.values(this.model.upgradeVisuals ?? {})) o.visible = false;   // shown by the world per milestone
    } catch (e) {
      log.error('machine', `${this.id} (${this.def.id}) createModel failed`, e);
      const root = kit.outOfOrder(this.def.slotSize);
      const d = SLOT_DIMS[this.def.slotSize];
      this.model = {
        root: root as THREE.Group, parts: {} as P,
        playPose: { pos: new THREE.Vector3(0, 1.5, d.d / 2 + 0.8), look: new THREE.Vector3(0, 1.2, 0) },
        colliders: [{ min: [-d.w / 2, 0, -d.d / 2], max: [d.w / 2, d.h, d.d / 2] }],
        interact: { min: [-d.w / 2, 0, -d.d / 2], max: [d.w / 2, d.h, d.d / 2 + 0.1] },
        anchors: { speaker: root },
      };
      return;
    }
    this._offLang = this.ctx.events.on('lang:changed', () => { if (!this._disposed) { this._riskL?.onLang(); this.onLang(); } });
    if (import.meta.env.DEV) {
      try { this._validateModel(); } catch (e) { log.warn('machine', `${this.id}: model lint failed`, e); }
    }
  }

  /** Dev-only contract lint of a freshly built model: footprint, stand strip, required anchors, seats. */
  private _validateModel(): void {
    const m = this.model, d = SLOT_DIMS[this.def.slotSize], id = `${this.def.id}`;
    const b = new THREE.Box3().setFromObject(m.root);
    const eps = 0.03;
    if (b.min.x < -d.w / 2 - eps || b.max.x > d.w / 2 + eps || b.min.z < -d.d / 2 - eps || b.max.z > d.d / 2 + eps || b.max.y > d.h + eps) {
      log.warn('machine', `${id}: model exceeds ${this.def.slotSize} footprint ${d.w}×${d.d}×${d.h} m (box ${b.min.toArray().map((v) => v.toFixed(2))} → ${b.max.toArray().map((v) => v.toFixed(2))})`);
    }
    if (!m.anchors.speaker) log.warn('machine', `${id}: anchors.speaker is required`);
    if (m.colliders.some((c) => c.tag !== 'walkable' && c.max[2] > d.d / 2 + eps && c.max[1] > 0.3)) log.warn('machine', `${id}: a collider reaches into the stand strip in front of the machine`);
    if (m.seats && m.seats.length !== this.def.seats) log.warn('machine', `${id}: model.seats (${m.seats.length}) !== def.seats (${this.def.seats})`);
    if (this.def.seats > 1 && !m.seats) log.warn('machine', `${id}: tables must provide model.seats`);
  }

  /** Fixed step: bookkeeping + `tick` (+ `hostTick` on the host). */
  _step(dt: number): void {
    if (this._releaseRequested) {
      if (!this.busy) this.standUp();                       // a stand-up pressed mid-round is honoured once idle
      else if ((this._releaseWait += dt) > FORCE_RELEASE_S) { log.warn('machine', `${this.id} forced release while busy`); this.busy = false; this.standUp(); }
    }
    this._riskL?.step(dt);
    if (this.isLocalOccupant) {
      if (this.gamblesLive) this._watchWrapped = false;
      else if (!this._watchWrapped && !this.busy) { this._watchWrapped = true; this.onWatchClosed(); }
    }
    if (this._stakeBigArm > 0 && (this._stakeBigArm -= dt) <= 0) this.disarmBig();
    if (this.isLocalOccupant && this.def.minBet > 0 && (this._stakeT -= dt) <= 0) { this._stakeT = STAKE_POLL_S; this.publishStakes(); }   // Z / X, wallet and high-stakes changes reach the HUD
    if (this._coach && this.isLocalOccupant) this.coachStep(dt);
    this._firePending();                                    // a press queued during a round goes now that it is idle
    this.tick(dt);
    if (this.isHost) this.hostTick(dt);
  }
  /** Render step (World calls it only for visible machines). */
  _frame(dt: number, t: number): void {
    this.frame(dt, t);
    this._riskL?.frame();
    if (!this.busy && this.seats.every((s) => s === null)) { this.idleShow(dt); this.attract(dt, t); }
  }
  /**
   * Default idle show (unoccupied, visible): a 1.5 s glint on the marquee and bulb chains about every 12 s. The parts
   * are found once by duck-typing `model.parts`; a machine with neither schedules nothing.
   */
  private idleShow(dt: number): void {
    if (!this._idleChecked) {
      this._idleChecked = true;
      const roots: THREE.Object3D[] = [];
      const parts = Object.values((this.model?.parts ?? {}) as object) as Array<{ root?: THREE.Object3D; chase?: unknown; pattern?: unknown } | null>;
      for (const p of parts) if (p?.root && (typeof p.chase === 'function' || typeof p.pattern === 'function')) roots.push(p.root);
      if (roots.length) this._idle = new juice.AttractScript(this.cosmetic).every('glint', juice.IDLE_GLINT_S, () => juice.idleGlint(this, roots), { jitter: 3, first: 6 });
    }
    this._idle?.update(dt);
  }
  /** A seat was granted (`moccOk`). Local occupant gets the occupancy RNG stream. */
  _occupy(pid: PlayerId, seat: number, seed: number, local: boolean): void {
    this.seats[seat] = pid;
    if (local) {
      this._aliasHeld.clear();
      this._pend = null; this._pendHeld = false;
      this._watchWrapped = false;                           // a seat taken after the close (a restored ladder) is wrapped up too
      this._streak = 0;
      this.rng = createRng(seed);
      this._releaseRequested = false;
      this.bet = clamp(this.bet, this.def.minBet, this.def.maxBet);
      if (this.def.minBet > 0) { this._stakeBigArm = 0; this._stakeSig = ''; this.bet = this.stakePresets().safe; }   // smart stakes: every sit starts on SAFE
      this.fitBet();
      this.publishStakes();
      void this.risk;                                       // the risk layer lives with the local seat
      const coach = this.def.coach?.length ? new Coach(this.def.id, this.def.coach, !this.def.shared) : null;
      this._coach = coach && (!coach.done || coach.practice) ? coach : null;
      this._coachBet = this.bet;
      this.publishCoach(true);
    }
    this.ctx.events.emit('player:seat', { pid, mid: this.id, seat, on: true });
    this.onOccupy(pid, seat, local);
  }
  _release(pid: PlayerId, seat: number, local: boolean): void {
    this.seats[seat] = null;
    this.onRelease(pid, seat, local);
    if (!local && !this.def.shared && !this.isLocalOccupant) this._roundOpen = false;   // never leave a ghost round
    if (local) {
      this._riskL?.onRelease();
      this._hsMult = 1;
      this._streak = 0;
      this._pend = null; this._pendHeld = false;
      this.disarmBig();
      this._stakeSig = '';
      this.publishStakes(false);
      this._coach = null;
      this.publishCoach(true);
      this.ctx.ui.machineHud(null);
      this._releaseRequested = false;
      if (this._roundOpen) {            // a machine must settle in onRelease; never strand a stake silently
        log.warn('machine', `${this.id}: released with an open round (stake of ${this._roundBet} lost) — settle in onRelease`);
        this._roundOpen = false; this.busy = false;
      }
    }
    this.ctx.events.emit('player:seat', { pid, mid: this.id, seat, on: false });
  }
}
