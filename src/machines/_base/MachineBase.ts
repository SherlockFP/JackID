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
import { t as tr, type I18nVars } from '@/core/i18n';
import { SLOT_DIMS, type MachineContext, type MachineDef, type MachineEnvelope, type MachineEvent, type MachineModel, type PresentCtx } from './types';
import { juiceTier, tierTags, toWinTier, type JuiceTier } from './tiers';
import * as juice from './juice';

const FORCE_RELEASE_S = 10;

/**
 * Space / LMB (`primary`) and Enter (`confirm`) are aliases on every machine (TECH §11.6). Machines were written
 * against one of the two, so the sink folds the other onto the one the machine handles; machines that handle both
 * (the vast majority) receive each press as it came, once. Keyed by `def.id`; a subclass may override `inputAlias`.
 */
const CONFIRM_ONLY = new Set([
  'roulette', 'craps', 'keno', 'sicbo', 'bigsix', 'bingo', 'lottoblower', 'derby', 'dicetower', 'fantan', 'tombola',
]);
const PRIMARY_ONLY = new Set(['bingopin', 'coinpusher', 'pachinko', 'shellgame', 'stacker']);

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
  private _offLang: (() => void) | null = null;
  private _ray = new THREE.Raycaster();
  private _sink: MachineSink | null = null;
  private _attract: juice.AttractScript | null = null;
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
  get localSeat(): number { return this.seats.indexOf(this.ctx.net.selfId); }
  get isLocalOccupant(): boolean { return this.localSeat >= 0; }
  get src(): EcoSource { return { mid: this.id, machineId: this.def.id }; }
  get disposed(): boolean { return this._disposed; }
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
        if (e.action === 'exit') { if (e.down && !e.repeat) { self.onStandUpRequest(); self.standUp(); } return; }
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
  /** Sink → machine: fold the primary / confirm alias, then `onInput`. */
  private _route(e: MachineInputEvent): void {
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
    if (pass) this.onInput(src === to ? e : { ...e, action: to });
  }
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
  /** Why a bet failed: the stake-confirm prompt (first press on a big stake), the stake cap, or no funds. */
  private toastRefusal(amount: number): void {
    const run = this.ctx.run;
    const why = run.lastRefusal();
    if (why === 'confirm') this.toast(tr('stake.confirm', { amount, pocket: run.wallet() }), 'warn');
    else if (why === 'limit') this.toast(tr('stake.cap', { max: run.betLimits(this.def.id, this.id).max }), 'warn');
    else this.toast(tr('common.noFunds'), 'bad');
  }
  /**
   * Solo: `!busy && !roundOpen`, `run.bet()`; toast + buzzer on failure; sets `busy`. Re-seeds `this.rng` from
   * (runSeed, instance, round#) — identical after a reload because the round counter is persisted.
   */
  protected beginRound(bet: number = this.bet): boolean {
    if (this.busy || this._roundOpen) return false;
    if (!this.ctx.run.bet(bet, this.src)) {
      this.toastRefusal(bet);
      this.sfx('buzzer');
      return false;
    }
    this.busy = true;
    this._roundOpen = true;
    this._roundBet = bet;
    this.rng = createRng(hashSeed(this.ctx.runSeed, this.id, ++this._round));
    return true;
  }
  /**
   * Extra stake inside an open round (double, split, insurance, raise, extra balls …). Summed into the round's
   * `bet` so there is ONE outcome per round (catalogue §1.4). Returns false (toast + buzzer) when unaffordable.
   */
  protected addStake(amount: number): boolean {
    if (!this._roundOpen) { log.warn('machine', `${this.id} addStake without an open round`); return false; }
    if (!this.ctx.run.bet(amount, this.src)) {
      this.toastRefusal(amount);
      this.sfx('buzzer');
      return false;
    }
    this._roundBet += amount;
    return true;
  }
  /** `run.win()`; closes the round (`busy = false`); returns credited. Adds `bigwin/hugewin/megawin` tags by multiple. */
  protected settle(r: { gross: number; tier?: WinTier; tags?: string[]; silent?: boolean }): number {
    const bet = this._roundBet;
    const jt = juiceTier(r.gross, bet, r.tags);
    const tags = [...new Set([...(r.tags ?? []), ...tierTags(jt)])];
    const meta: WinMeta = { bet, tier: r.tier ?? toWinTier(jt), tags, silent: r.silent };
    this._roundOpen = false;
    const credited = this.ctx.run.win(r.gross, this.src, meta);
    this.busy = false;
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
    if (!this.isLocalOccupant) return;     // spectators / late joiners never own the stake (no phantom rounds)
    this._roundOpen = true; this._roundBet = bet; this.busy = false;
  }

  /** Bet ladder: `def.betSteps` (or doubling min→max), extended in 1-2-5 steps up to `max × bet.maxMult`. */
  protected betLadder(): number[] {
    const d = this.def;
    let base = d.betSteps ? [...d.betSteps] : (() => { const a: number[] = []; for (let b = d.minBet; b < d.maxBet; b *= 2) a.push(b); a.push(d.maxBet); return a; })();
    // the run's limit (Night 1 stake cap, SI) wins: never offer a stake the run would refuse
    const lim = Math.max(d.minBet, this.ctx.run.betLimits(d.id, this.id).max);
    base = base.filter((v) => v <= lim);
    if (!base.length) base = [d.minBet];
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
    this.ctx.audio.play(name, speaker ? { pos: speaker, ...o } : o);
  }
  protected t(key: string, vars?: I18nVars): string { return tr(`m.${this.def.id}.${key}`, vars); }
  protected hud(spec: MachineHudSpec | null): void { if (this.isLocalOccupant) this.ctx.ui.machineHud(spec); }
  protected toast(text: string, kind?: ToastKind): void { if (this.isLocalOccupant) this.ctx.ui.toast(text, kind); }
  /** Idle-animation scheduler (cosmetic RNG): `this.attractor.every('tap', 20, () => …)` in `init`, `.update(dt)` in `attract`. */
  protected get attractor(): juice.AttractScript {
    return (this._attract ??= new juice.AttractScript(this.cosmetic));
  }

  /** Tier-escalating win show (see juice.ts). Call from `present()`; fire-and-forget unless the show is short. */
  protected celebrate(tier: JuiceTier, o?: juice.CelebrateOpts): Promise<void> { return juice.celebrate(this, tier, { speed: this.speed, ...o }); }
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
    this._offLang = this.ctx.events.on('lang:changed', () => { if (!this._disposed) this.onLang(); });
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
    this.tick(dt);
    if (this.isHost) this.hostTick(dt);
  }
  /** Render step (World calls it only for visible machines). */
  _frame(dt: number, t: number): void {
    this.frame(dt, t);
    if (!this.busy && this.seats.every((s) => s === null)) this.attract(dt, t);
  }
  /** A seat was granted (`moccOk`). Local occupant gets the occupancy RNG stream. */
  _occupy(pid: PlayerId, seat: number, seed: number, local: boolean): void {
    this.seats[seat] = pid;
    if (local) {
      this._aliasHeld.clear();
      this.rng = createRng(seed);
      this._releaseRequested = false;
      this.bet = clamp(this.bet, this.def.minBet, this.def.maxBet);
      if (this.bet > this.ctx.run.wallet()) this.maxBet();
    }
    this.ctx.events.emit('player:seat', { pid, mid: this.id, seat, on: true });
    this.onOccupy(pid, seat, local);
  }
  _release(pid: PlayerId, seat: number, local: boolean): void {
    this.seats[seat] = null;
    this.onRelease(pid, seat, local);
    if (!local && !this.def.shared && !this.isLocalOccupant) this._roundOpen = false;   // never leave a ghost round
    if (local) {
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
