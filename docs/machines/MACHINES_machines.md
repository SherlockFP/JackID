# JackID — Machine Catalogue (Gambling Systems Design, "machines" family)

Owner: Lead Gambling Systems Designer (machines). Status: v1.1 (Producer-reconciled), ready for modelers (Opus) and coders (Sonnet).

> **v1.1 integration overrides (binding; details in TECH_SPEC §11 and docs/PLAN.md).** This catalogue still owns every
> rule, weight, paytable, RTP, hook name and juice recipe below. Code shape follows TECH_SPEC: "host" = the *authority*
> (local occupant for solo devices, host for tables); `mc.*` messages map to the protocol per TECH §11.4; hook names map
> to `ModHook` per TECH §11.3 (`payoutMult`→`payout.mult`, `luckBonus`→`luck`, `<id>.<hook>`→`m.<id>.<hook>`); instance
> ids are GDD slot ids (`WELL-01`); i18n keys are `m.<id>.*`; the module contract is TECH §3 (`export const def` +
> default class, `buildModel(kit, opts)` in `model.ts`), not `defineMachine`. Visual dimensions follow ART_BIBLE §5 and
> the final footprints in PLAN.md §4.2 (cabinet sizes quoted below are superseded where they differ). Seated keys follow
> TECH §11.6 (Q = collect, B = max bet, Tab = run summary). Open items §19.6 are answered by GDD v1.1 (actionCost = pulls;
> `tableLimitMult` = Stake Index × Cap track).
Scope: the 15 slot/arcade-family devices the brief names, plus 2 additions (`fruitmachine`, `bingopin`). Table games
(roulette, blackjack, hold'em, baccarat, craps, sic bo, Big Six, keno, bingo, derby, hi-lo, war, lotto, shell game, coin-flip,
revolver, fortune-teller, tombola) belong to other catalogues and are NOT specified here.

Everything below is original JackID IP. Symbol names, pattern names, card names and fiction are ours. Real-world rule sets
(video poker, pachinko, pachislot, crash and mines formulas) are public game mechanics adapted for the game.

All RTP figures marked "(sim)" were produced by Monte-Carlo or exact enumeration while writing this document
(Node scripts, 1–4 M rounds). Haiku should re-run them from the tables here as a regression check (`tools/sim/*.mjs`).

---

## 0. Index

| # | id | EN name | TR name | Tier | MP model | Bet range (coins) | actionCost | Base RTP | Variance |
|---|----|---------|---------|------|----------|-------------------|-----------|----------|----------|
| 1 | `bigone` | The Big One | Büyük Vurgun | 1 | solo-occupant (+ lobby-shared jackpot meter) | 1–100 / spin | 1 per spin | 94.7 % | MEDIUM (+ jackpot tail) |
| 2 | `bandit` | One-Armed Bandit | Tek Kollu Haydut | 1 | solo-occupant | 1–3 credits × {1,5,25} = 1–75 | 1 per pull | 92.0 % (1–2 cr) / 93.0 % (3 cr) | HIGH |
| 3 | `videopoker` | Video Poker "Jacks Up / Deuces Down" | Video Poker | 1 | solo-occupant | 1–5 credits × {1,5,25} = 1–125 | 1 per hand | 97.30 % (JoB 8/5) / 99.73 % (Deuces) optimal | HIGH |
| 4 | `elevator` | The Elevator (crash) | Asansör | 1 | shared-table, 8 riders | 1–500 | 1 per ride | 96.0 % (any strategy) | player-chosen |
| 5 | `scratch` | Scratch-Card Vendor | Kazı Kazan Otomatı | 1 | solo-occupant | 2 / 5 / 10 / 20 / 50 per card | 1 per card | 80.5–87.8 % | HIGH |
| 6 | `pachislot` | Pachislot "Oni Feast" | Paçislot "Oni Ziyafeti" | 2 | solo-occupant | 3 medals × {1,2,5,10,25} = 3–75 | 1 per 3 games | 94.8–104.0 % (setting 1–6, perfect aim) | HIGH |
| 7 | `pachinko` | Pachinko "Deep Rain" | Paçinko "Derin Yağmur" | 2 | solo-occupant | ball = {1,2,5}; buy 50 / 250 balls | 1 per 50 normal-mode balls | 92.5 % (sweet zone) | HIGH |
| 8 | `plinko` | Plinko Board | Plinko Çivi Tahtası | 2 | solo-occupant | 1–100 per puck, 1–5 pucks | 1 per drop | 96.4 / 96.7 / 96.4 % | LOW / LOW / HIGH |
| 9 | `coinpusher` | Coin Pusher "The Shelf" | Jeton İtici "Raf" | 2 | shared-table, 2 stations | coin = {1,5,25} | 1 per 10 coins dropped | ≈ 88 % (governed) | LOW |
| 10 | `cyclone` | Cyclone Light Ring | Siklon Işık Çemberi | 2 | solo-occupant | 1–50 | 1 per play | 85 % random / ≈ 93–97 % aimed | MEDIUM |
| 11 | `mines` | Mines Terminal | Mayın Tarlası Terminali | 2 | solo-occupant | 1–200 | 1 per round | 97.0 % (any strategy) | player-chosen |
| 12 | `dicetower` | Dice Tower | Zar Kulesi | 2 | shared-table, 4 bettors | 2–200 (even) per spot | 1 per drop | 88.9–94.4 % per bet | LOW–HIGH |
| 13 | `lootbox` | Mystery Capsule Vendor | Sürpriz Kapsül Otomatı | 2 | solo-occupant | 10 / 40 / 150 per capsule | 1 per capsule | 89–92 % value | MEDIUM |
| 14 | `claw` | Claw Crane | Pençe Vinç | 3 | solo-occupant | 2–50 | 2 per play | ≈ 80 % avg / ≤ 105 % expert | MEDIUM |
| 15 | `stacker` | Stacker | İstif Kulesi | 3 | solo-occupant | 1–25 | 2 per play | ≈ 70 % avg / ≤ 110 % expert | HIGH |
| 16 | `fruitmachine` | Fruit Machine "Nudge & Hold" (addition) | Meyve Makinesi "Dürt & Tut" | 3 | solo-occupant | 1–20 | 1 per spin | 88.0 % exact (compensated) | MEDIUM |
| 17 | `bingopin` | Bingo Pinball (addition) | Tombala Langırtı | 3 | solo-occupant | 1–25 | 2 per game (extra balls 0) | 93.5 % (5 balls); extras 80 % | HIGH |

Tier meaning: **1** = hero/must ship in the first playable; **2** = core (ship in v1.0); **3** = nice-to-have (stretch).

---

## 1. Shared conventions (all machines)

### 1.1 Currency and number rules
- Currency: **coins** (EN "coins", symbol `¢`; TR "jeton", symbol `j`; TECH §11.9). Integers only in the wallet.
- Payout math is done in float, then floored to integer coins. The floored remainder goes into a per-player, per-machine-instance
  **dust** accumulator; when dust ≥ 1.0 the integer part is added to the next payout (tag `dust`). This removes rounding bias.
- Global **bet ladder**: `1, 2, 5, 10, 20, 50, 100, 200, 500, 1000`. Each machine declares `minBet`/`maxBet` as ladder values.
  The economy can scale the cap with a run-level `tableLimitMult` (GDD). A machine never accepts a bet outside its ladder slice.
- Multipliers are written `×N` = total returned per 1 coin staked (stake included). `N:1` odds notation (table bets only) =
  profit; total returned = N+1.
- **Variance classes** (σ = standard deviation of one round's payout, in units of the bet):
  LOW σ < 1.5 · MEDIUM 1.5–4 · HIGH 4–12 · EXTREME > 12.

### 1.2 Common betting UI (diegetic first)
- Every machine has three red 7-segment LED windows (texture `#FF3020` on `#200404`): **CREDIT** (player wallet), **BET**,
  **WIN**. In multiplayer the CREDIT window shows the occupant's wallet to everyone (public information — it is a casino).
- Bet changes step along the ladder slice; at max the BET window blinks twice and a dull "tock" plays. Bet cannot change
  while a round is committed.
- **Insufficient coins**: the CREDIT window flashes `----` 3× at 4 Hz, buzzer (square 110 Hz, 0.25 s), nothing is debited.
- **Out of actions** (run limiting resource exhausted): all lamps dim to 30 %, screen shows `CLOSED` / `KAPALI`, buzzer.
- Overlay (screen-space, VT323 font, 2× pixel scale) only for: control hints strip (bottom, auto-hides after 4 s idle),
  wallet + actions-left mini HUD (top-left), and the **H** paytable card when a diegetic paytable would be unreadable at the
  400×225 internal resolution. Overlay never shows information the diegetic UI does not also show (except the help card).
- Readability rule for modelers: diegetic text uses ≥ 8 px glyphs on canvas textures of 128×64 or 256×128 px, and each
  machine's **play pose** puts the main screen at 0.40–0.60 m from the camera with FOV 50–60° so glyphs land ≥ 2 internal px tall.

### 1.3 Common controls (play pose)
Walk up within 2.2 m (tables 2.8 m; TECH §11.10), look at the machine's interaction volume, press **E** → camera glides into
the play pose in 0.60 s (ease-in-out cubic; stand-up glide 0.45 s). Movement keys are released for machine use while seated.

| Input | Action (all machines unless the machine overrides) |
|-------|---------------------------------------------------|
| Mouse move | Moves the **diegetic cursor** (ART §10.5 glove pointer) across the machine's interaction plane; per TECH §2.6 the pointer lock is released while seated and re-requested on stand-up. |
| LMB | Press the diegetic button/card/cell under the cursor (raycast). |
| RMB (hold) | Free-look inside the pose: ±30° yaw, ±20° pitch; release recentres in 0.25 s. |
| Space | **Primary action** (Spin / Deal / Draw / Drop / Stop / Fire / Cash out — per machine). |
| Mouse wheel ↑/↓, X / Z | Bet + / − one ladder step. |
| B | Max bet (sets BET to the machine's max affordable value; does not start a round). |
| 1–9 | Machine-specific buttons (holds, reel stops, risk levels, tiers, cells). |
| R | Repeat last round's full bet configuration (multi-spot machines) and commit. |
| G | Autoplay menu (only where allowed): 5 / 10 / 25 rounds; stops on any win ≥ ×10, on curse/jackpot, or when wallet < bet. |
| F | Fast mode toggle: local animation speed ×2 (cosmetic; remote watchers keep ×1). |
| H | Help/paytable overlay card (EN/TR). |
| E | Stand up. If a round is in flight, stand-up is queued until it resolves; double-tap E (< 0.4 s) leaves at once — the round still resolves on the host and pays. |
| Esc | Pause menu (single-player pauses the machine timeline; multiplayer never pauses). |
| Tab / T | Scoreboard / chat (unchanged while seated). |

Gamepad is out of scope for v1.

### 1.4 Round lifecycle and how a machine reports to the economy
Every machine implements the same five-phase lifecycle on the **host** (in single-player the local game is the host):

1. **request** — client sends `mc.req {i, act, args}` (e.g. `act:"spin"`).
2. **validate** — host checks occupancy, phase, bet ladder, `econ.canAfford(p, bet)`, `run.actionsLeft(p) ≥ actionCost`.
   Failure → `mc.reject {i, p, code}` with `code ∈ {NO_COINS, NO_ACTIONS, BUSY, BAD_BET, NOT_OCCUPANT, CLOSED}`.
3. **commit** — host calls `econ.debit(p, bet, ctx)` and `run.spendActions(p, actionCost)`, increments the instance's
   `round` counter, **pre-rolls the entire outcome** with the machine RNG (see 1.5) and broadcasts the machine's start event.
4. **present** — every client (including the host) plays the same deterministic animation from the event payload.
5. **settle** — host calls `econ.settle(outcome)` at the moment the animation reaches the payout beat (host timeline), then
   broadcasts `mc.outcome`. The wallet number in the CREDIT window counts up from that moment.

```ts
// src/machines/_base/types.ts
export interface MachineOutcome {
  machine: string;          // 'bigone'
  instance: string;         // GDD slot id, e.g. 'WELL-01' (TECH §11.1)
  player: string;           // PlayerId
  round: number;            // per-instance monotonic counter
  bet: number;              // total coins debited for this round (incl. extra balls, additional stakes)
  payout: number;           // total coins credited (gross, includes returned stake)
  net: number;              // payout - bet
  mult: number;             // payout / bet (0 when bet = 0)
  actionCost: number;       // limiting-resource units spent
  tags: string[];           // vocabulary below
  items?: { kind: 'charm' | 'consumable' | 'ticket'; id: string; rarity?: string }[];
  meta?: Record<string, number | string | boolean>; // machine-specific detail (pattern list, crash point …)
  durationMs: number;       // commit → settle on host timeline
}
```
**Tag vocabulary** (charms and stats listen to these): `win`, `loss`, `push`, `bigwin` (mult ≥ 10), `hugewin` (≥ 25),
`megawin` (≥ 50), `jackpot`, `curse`, `nearmiss`, `bonus`, `feature`, `skill`, `cashout`, `bust`, `charm`, `tilt`, `void`,
`dust`, `free` (no stake taken, e.g. replay), plus machine-prefixed tags like `bigone:pattern:VALLEY`, `elevator:roof`.

Rounds that span several decisions (mines, elevator, video poker double-up, bingo extra balls) stay **one outcome**: extra
stakes are appended with `econ.debit` under the same `round` and summed into `bet`.

### 1.5 RNG, determinism and fairness
- PRNG: `sfc32`, seeded per round with `hash32(runSeed, instanceSeed, round, salt)` (`hash32` = Murmur3 fmix on the
  concatenated u32s). Same seed → bit-identical outcome on every client. `Math.random()` is forbidden in machine logic
  (allowed only for purely cosmetic particles that never affect payloads).
- **Outcome-first**: every result is decided at commit (or at the decision point for multi-step games) and the animation is
  steered to it. Physics-flavoured machines (pachinko, plinko, bingopin, dice tower, claw) generate a *steered path* from the
  seed and the pre-decided target; clients never simulate free physics for outcomes. The only true emergent simulation is
  `coinpusher`, which runs on the host only.
- **Commit–reveal (shared tables + optional everywhere)**: at bet-lock the host broadcasts `fair = sha256(serverSeed ‖ round)`;
  after settlement it reveals `serverSeed`. Clients verify and show a small green "✓ FAIR" lamp (red "✗" + chat warning on
  mismatch). Mandatory on `elevator`, `dicetower`; optional debug toggle elsewhere.
- Probabilities in this document are exact model probabilities; implementations must draw them as specified (weights as
  integers out of the stated total) so the Haiku regression sims match.

### 1.6 Charm hook interface
Charms (GDD) modify machines only through named hooks: `charms.mod(hook, ctx, baseValue) → value` and
`charms.emit(event, ctx)`. Hook name rules: global hooks have no prefix; machine hooks are `<id>.<hook>`.

Global hooks every machine must honour:

| Hook | Type | Meaning |
|------|------|---------|
| `payoutMult` | float × | Multiplies final gross payout of a winning round (not pushes/refunds). |
| `luckBonus` | int points | Generic luck; each machine defines its interpretation (listed per machine). 0 by default, cap 30. |
| `betRefundOnLoss` | 0–1 | Fraction of stake refunded on a `loss` round (tag `refund`). |
| `actionCostDelta` | int | Added to the machine's actionCost (min 0). |
| `freePlayChance` | 0–1 | Chance the round's actionCost is refunded (tag `free`). |
| `jackpotChance` | float × | Multiplies any jackpot/feature-trigger probability marked ★ in the machine spec. |
| `nearMissRefund` | 0–1 | Fraction of stake returned on rounds tagged `nearmiss`. |
| events `onCommit`, `onOutcome`, `onTag:<tag>` | event | For trigger-style charms. |

### 1.7 Networking envelope (all machines)
Host-authoritative star topology (brief). Machine messages ride the reliable ordered DataChannel; positions etc. are elsewhere.

| Event | Dir | Payload | Notes |
|-------|-----|---------|-------|
| `mc.occupy` | c→h, h→all | `{i, p}` | Host grants first requester; others get `mc.reject BUSY`. |
| `mc.release` | h→all | `{i, p, reason:'stand'|'disconnect'|'timeout'}` | Idle timeout 90 s with no input while seated. |
| `mc.req` | c→h | `{i, act, args}` | Every input that matters. |
| `mc.reject` | h→c | `{i, p, code}` | |
| `mc.bet` | h→all | `{i, p, bet, opts}` | UI echo, throttled 10 Hz, so watchers see the BET window move. |
| `mc.outcome` | h→all | `MachineOutcome` | Final settlement. |
| `mc.snap` | h→c | `{i, phase, round, occupant, state}` | Late-join / re-sync; `state` is machine-specific. |
| `<id>.<event>` | h→all | per machine | Start/step events carrying the pre-rolled outcome. All carry `{i, r, t}` (instance, round, host time ms). |

Clients schedule animation at `t + clockOffset`; if an event arrives > 300 ms late the client fast-forwards the timeline to
catch up. Watchers farther than 12 m receive only `mc.outcome` (no step events) and freeze the machine screen at 2 fps.

### 1.8 Juice standards
- **Sound** (WebAudio, all synthesized): master bus → per-machine bus (gain 0.8) → PSX "lo-fi" stage (22.05 kHz sample-and-hold
  decimation + 8-bit-ish waveshaper, mix 35 %) → room reverb (convolver from a generated 1.2 s noise burst, wet 18 %).
  Machine sounds are positional (`PannerNode`, HRTF off, inverse distance, refDistance 1.5 m, rolloff 1.2).
- **Win tiers** shared by all machines: `win` < ×10 → chime + count-up; `bigwin` ≥ ×10 → 3 s light chase + fanfare;
  `hugewin` ≥ ×25 → 5 s + coin-fountain particles; `megawin` ≥ ×50 → 7 s + room lights strobe gold `#FFD040` for nearby
  players (≤ 10 m) + world event toast "*<name> hit ×N on <machine>*"; `jackpot` → machine-specific 8–12 s sequence, every
  player in the pit hears a distant bell (−18 dB, unpositioned).
- Count-up: 30 coin-ticks/s rising in pitch (square 660→1320 Hz across the count), capped at 2.5 s; Space skips.
- Lights: PSX look — use emissive materials + additive "light card" sprites; no `THREE.Light` inside machines — declare ≤ 2 light anchors (`anchors.light`, `anchors.light2`) that the World's 6-light pool picks up (TECH §11.7); formerly "at most 2 real `PointLight`s per machine"
  (one key, one win flash). Win flash light: intensity 0 → 2.5 → 0 over 0.4 s.
- Camera: win shake only in pose and only ≥ `hugewin` (amplitude 0.004 m, 12 Hz, 0.6 s).

### 1.9 Anti-exploit baseline (applies to every machine)
- Clients never compute outcomes; requests are validated on the host by phase and round id (`args.r` must equal the host's
  expected next round; duplicates dropped → no double commits on lag-spam).
- Outcome is fixed at commit; leaving, disconnecting, alt-tabbing or the host migrating never changes it. If the occupant
  disconnects, the host settles the round to the player's wallet record anyway.
- Rate limit: max 8 `mc.req`/s per player per machine; excess dropped silently.
- No machine accepts a bet change, hold, or stop outside the phase that allows it.
- Save-scumming (single-player): the run save stores `round` counters and RNG seeds per instance; reloading replays the same
  sequence.

---

## 2. The Big One — `bigone` · TR "Büyük Vurgun" · Tier 1 (HERO)

**Fantasy.** The oxblood monster in the middle of the pit: a 5×3 pattern-paying slot that eats the unlucky. It is the
machine the main-menu camera sits inside (menu reels use these exact symbol textures; the menu "PLAY" spin always lands a
full screen of SUN).

**Cabinet (for the modeler).** Footprint 1.60 W × 1.10 D m, height 2.60 m. Body oxblood `#3A0D12`, brass trim `#C8A040`,
black rubber base `#141010`. Reel window 1.10 × 0.66 m (five reels 0.20 m wide, gaps 0.025 m, cell height 0.22 m) behind
glass tinted `#9FD8FF` at 12 % opacity. Top box 1.40 × 0.70 m: JACKPOT 7-seg meter (8 digits) + **HUNGER gauge** (semicircular
needle dial, 0–5 %). Left side panel: diegetic **pattern plate** (engraved brass, 0.40 × 0.90 m) showing all patterns. Right side:
lever 0.75 m long with a red ball knob `#B0101C`, pivot at 1.15 m height. Button deck at 0.95 m: BET−, BET+, MAX, AUTO, SPIN
(big, 0.09 m, amber `#FFB000`). 24 marquee bulbs `#FFD36A` around the top box. A grille "mouth" under the reels where coins
spill (payout tray 0.50 × 0.12 m).

### 2.1 Symbols
Reel cells are independent (virtual reels). Weights out of 100.

| Symbol | Look (canvas pixel art, 32×32) | Base value | Weight |
|--------|-------------------------------|-----------:|-------:|
| MOTH | grey moth `#B8B0A0`, two eye-spots `#3A2A20` | 1 | 19 |
| TOOTH | ivory molar `#F2EAD0`, dark root `#6A5040` | 1 | 19 |
| KEY | rusty key `#A0522D` | 2 | 17 |
| CANDLE | wax `#E8D8B0`, flame `#FFB000` (2-frame flicker) | 2 | 17 |
| RING | gold band `#E8B830`, red gem `#C0182A` | 3 | 11 |
| CROWN | gold `#FFD040`, teal gems `#20B0A0` | 4 | 10 |
| SUN | face with rays `#FFC000` on `#FF7A00` | 7 | 7 |
| MAW (curse) | lipless mouth `#5A0008`, teeth `#E8E0C8` | — (dead cell) | event only |
| GHOST (wild, charm-only) | pale sheet `#A0F0FF` | 0 (substitutes) | 0 unless a charm adds it |

E[value] of a random cell = 2.28.

### 2.2 Patterns
Grid coordinates: rows r0 (top), r1, r2; columns c0…c4; cell index = r·5 + c. A pattern instance pays when all its cells hold
the same symbol (GHOST matches anything; a pattern made only of GHOSTs pays as SUN). MAW cells never match.

| Pattern | Shape | Instances | Mult | Freq. (sim, base, paid) |
|---------|-------|----------:|-----:|------------------------|
| TREY | 3 horizontal contiguous | 9 | ×1 | 1 in 5.6 spins |
| QUAD | 4 horizontal contiguous | 6 | ×2 | 1 in 45 |
| RAIL | full row of 5 | 3 | ×5 | 1 in 423 |
| PILLAR | full column of 3 | 5 | ×1 | 1 in 7.9 |
| SLASH | 3-cell diagonal (↘ or ↗) | 6 | ×1 | 1 in 6.6 |
| VALLEY | V: (0,0)(1,1)(2,2)(1,3)(0,4) | 1 | ×5 | 1 in 1 290 |
| PEAK | Λ: (2,0)(1,1)(0,2)(1,3)(2,4) | 1 | ×5 | 1 in 1 266 |
| CROSS | plus sign centred on (1,c), c = 1..3 | 3 | ×7 | 1 in 421 |
| PENTACLE | 4 corners + centre (1,2) | 1 | ×10 | 1 in 1 217 |
| HALO | 8-cell ring around (1,c), c = 1..3 | 3 | ×15 | 1 in 78 400 |
| CLUSTER (bonus) | 4-connected group of ≥ 7 same symbol | — | ×(n − 5) | 1 in 159 (n=7: 218, 8: 755, 9: 3 170, 10: 14 000) |
| FULL (jackpot) | all 15 cells same | 1 | ×40 + JACKPOT meter | event 1 in 4 000 (★) |
| *TWIN RAILS* (locked) | two full rows same symbol | 3 | ×12 | charm-unlocked only |
| *CORNERSTONE* (locked) | 4 corners same symbol | 1 | ×3 | charm-unlocked only |

```
VALLEY      PEAK        CROSS(c=2)  PENTACLE    HALO(c=1)
X . . . X   . . X . .   . . X . .   X . . . X   X X X . .
. X . X .   . X . X .   . X X X .   . . X . .   X . X . .
. . X . .   X . . . X   . . X . .   X . . . X   X X X . .
```

**Payout formula.** `win = stake × Σ_paid ( value(sym) × patternMult ) × payoutMult`, floored with dust.
**Absorption rule:** a pattern instance is not paid if its cell set is a strict subset of another *paid-eligible* instance of
the same symbol (RAIL absorbs its QUADs/TREYs; QUAD absorbs its TREYs; VALLEY absorbs the SLASH it contains; CROSS absorbs its
PILLAR and middle TREY; HALO absorbs its edge TREYs and PILLARs). CLUSTER never absorbs and is never absorbed (it is a bonus on
top). FULL absorbs everything including CLUSTER.

### 2.3 Spin generation (exact order — RNG draws in this order)
1. **Curse roll ★-exempt:** `pCurse = min(0.05, 0.015 + 0.0025·k) × mod('bigone.curseChanceMult')`, k = spins since the last
   curse this deadline (resets each deadline). If hit → **EATEN**: generate a normal grid (steps 3–6), then overwrite the middle row
   cells c..c+2 (c uniform 0..2) with MAW. Payout 0. Skip step 2.
2. **Fill roll ★:** `pFill = 1/4000 × jackpotChance`. If hit → choose symbol by weights (after bans/weight hooks), all 15 cells =
   symbol → FULL. Skip 3–6.
3. **Base grid:** 15 independent draws, row-major, from the weight table (after `symbolWeight`/`symbolBan` hooks).
4. **GHOST injection:** each cell independently becomes GHOST with `bigone.wildChance` (default 0).
5. **Coalesce (luck) pass:** for each cell row-major, with probability `min(0.30, 0.01 × luckBonus)` copy the symbol of a uniformly
   chosen 4-neighbour (using the grid as already modified).
6. **Teaser MAW:** with p = 0.06 replace one uniformly random cell with MAW; then with p = 0.35 a second one (max 2, so a teaser
   can never form the curse trio). Teasers are dead cells and may break patterns.
7. Evaluate patterns + clusters; apply absorption; compute payout.

### 2.4 RTP and variance (sim, 4 M spins, luck 0)
- Lines + clusters (incl. teaser losses): **92.6 %** of stake; hit frequency **39.2 %**; σ ≈ 1.77 stake.
- × (1 − average curse 2.6 % over a 10-spin deadline) → 90.2 %.
- FULL fixed prize: 40 × 2.28 / 4000 → **2.3 %**.
- JACKPOT meter (seed 50 × maxStake, feed 1 % of every stake, played at max stake) → **2.25 %**.
- **Total base RTP ≈ 94.7 %**, house edge ≈ 5.3 %. Variance class **MEDIUM** with a jackpot tail.
- Win distribution (lines only): ≥ ×5 1 in 33 · ≥ ×10 1 in 167 · ≥ ×25 1 in 3 980 · ≥ ×50 1 in ~100 000 (FULL excluded).
- **Luck scaling (the roguelike engine):** lines-RTP 92.6 % at luck 0 → 121 % at luck 5 → 153 % at luck 10 → 229 % at luck 20
  (hit frequency 39 → 46 → 52 → 63 %). Economy designers: luck is the main power curve of the hero machine.

**JACKPOT meter.** Coins, per instance, persisted in the run save. Seed `50 × maxStake` (current ladder cap). Every stake adds 1 %.
FULL pays `meter × stake / maxStake`; the unpaid fraction stays in the meter. After a full payout the meter reseeds.
In multiplayer the meter is lobby-shared and host-owned (everyone feeds it; whoever fills takes it).

### 2.5 Bets and cost
- Stake per spin: ladder `1 … 100` (min 1, max 100 before `tableLimitMult`). No lines to choose — all patterns always active.
- actionCost: **1 per spin**. Autoplay allowed (G).

### 2.6 Charm hooks (`bigone.*` + globals)
`luckBonus` (coalesce +1 %/pt) · `payoutMult` · `jackpotChance` (pFill ×) · `bigone.symbolValueAdd[SYM]` (int) ·
`bigone.symbolValueMult` (float, all symbols) · `bigone.symbolWeight[SYM]` (int add) · `bigone.symbolBan[SYM]` (weight → 0; at least
3 symbols must remain) · `bigone.patternMult[PATTERN]` (float add) · `bigone.extraPattern` (unlock TWIN RAILS / CORNERSTONE) ·
`bigone.wildChance` (0–0.2) · `bigone.curseChanceMult` · `bigone.curseWard` (charges; converts an EATEN spin into a normal spin,
consuming 1) · `bigone.jackpotFeed` (meter feed %, default 1) · `bigone.respin` (chance after a losing spin to respin reels 4–5
free) · `bigone.holdReel` (allows holding one reel between spins, keys 1–5, max 1 consecutive) · events `bigone.onPattern
{pattern, sym, cells}`, `bigone.onCurse`, `bigone.onFill {sym}`.

### 2.7 Controls (play pose: camera 0.55 m in front of the reel window, eye height 1.35 m, FOV 55°)
Space or LMB on SPIN = spin · **drag the lever** (LMB on knob, drag down ≥ 60 % of travel within 0.6 s) = spin (identical outcome
odds; the lever is theatre) · wheel/Z/X = stake · B = max · G = autoplay · 1–5 = hold reel (charm only) · H = pattern card ·
F = fast · E = stand.

### 2.8 State machine (host timeline, ×1 speed)
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| ATTRACT | no occupant | ∞ | bulbs chase 6 Hz, reels idle-drift; `mc.occupy` → READY |
| READY | occupant seated | ∞ | spin request validated → COMMIT; stand → ATTRACT |
| COMMIT | debit + roll | 0.05 s | → SPIN_UP |
| SPIN_UP | reels accelerate (stagger 0.08 s per reel) | 0.15 s | → SPINNING |
| SPINNING | full speed 14 cells/s | until stop times | → STOPPING |
| STOPPING | reel n stops at t = 1.00 + 0.25·n s (n = 0..4), 0.12 s overshoot-bounce | — | → TEASE or EVAL |
| TEASE | after reel 3 stops, if a ×5+ pattern, CLUSTER ≥ 8, or FULL is still possible: reel 4 slows, +1.4 s | 1.4 s | → EVAL |
| EVAL | highlight each paid pattern 0.35 s (max 8 individually, then "+N" 0.5 s); Space skips | ≤ 3.3 s | → PAYOUT / EATEN / JACKPOT |
| PAYOUT | settle; WIN count-up | 0.4–2.5 s | → READY (or BIGWIN) |
| BIGWIN | tier sequence (1.8) | 3 / 5 / 7 s | → READY |
| EATEN | curse sequence | 3.2 s | → READY |
| JACKPOT | fill sequence (skippable after 3 s) | 9 s | → PAYOUT |
Typical spin (no win) 2.4 s; with win 3.0–4.5 s. Fast mode halves every duration.

### 2.9 UI
Diegetic: reels, CREDIT/BET/WIN LEDs, JACKPOT meter, HUNGER gauge (needle = current pCurse on a 0–5 % scale, red zone > 3 %),
pattern plate (lit segment flashes when that pattern pays), AUTO lamp, "LAST 10" strip of tiny lamps above the reels (green = win,
dark = loss, red = curse). Overlay: control hints, H card with pattern diagrams and current symbol values (values change with
charms — the brass plate shows base values, the H card shows live ones), floating "+N" text over the winning pattern cells
(screen-space, 1 s).

### 2.10 Multiplayer — solo-occupant, watchers replay
| Event | Payload |
|-------|---------|
| `bigone.spin` | `{i, r, t, p, stake, grid:int8[15], pre:int8[15]?, curse:bool, curseCol, fill:bool, fillSym, teaser:int8[], coalesced:int8[], tease:bool, hold:int}` (`pre` = grid before coalesce, sent only when luck > 0, so watchers see cells "jump") |
| `bigone.eval` | `{i, r, pays:[{pat, sym, cells:int8[], amount}], clusters:[{sym, n, cells}], total}` |
| `bigone.meter` | `{i, value}` — broadcast on every change ≥ 1 coin, max 4 Hz |
| `bigone.jackpot` | `{i, r, p, sym, amount, meterBefore}` — world-wide toast + bell |
| `mc.outcome` | tags e.g. `['win','bigone:pattern:CROSS','bigwin']` |
Late joiner `mc.snap.state = {grid, meter, hungerK, last10}`.

### 2.11 Juice
- **Sound.** Spin start: lever ratchet = 6 noise clicks (bandpass 2.4 kHz, 4 ms each, 45 ms apart) + motor hum (saw 55 Hz → lowpass
  300 Hz, slow 0.15 s fade-in). Spin loop: hum + "strip flutter" (noise, bandpass 800 Hz, AM at 14 Hz = cells/s). Reel stop: thunk =
  sine 95 → 45 Hz over 90 ms + click; each successive stop +1 semitone. Tease: hum pitch rises 1 octave over 1.4 s, heartbeat kick
  (sine 50 Hz, 2 beats/s). Pattern highlight: triangle bell, pitch by pattern rank (TREY C5, QUAD E5, RAIL G5, CROSS B5, PENTACLE D6,
  HALO F#6), 0.25 s decay. Cluster: 3-note arpeggio ascending per extra cell. Curse: all tones stop; low "swallow" = sine 70 → 30 Hz
  over 1.2 s + pink-noise breath, then a wet bite (noise burst 30 ms, lowpass 600 Hz) and a reversed bell. Jackpot: 8-bar synth
  fanfare (square lead + triangle bass, 140 bpm, C major → Ab major key change at bar 5) over continuous coin-drop ticks.
- **Animation.** Reel overshoot-bounce 0.12 s; paid cells pulse scale 1.0 → 1.12 → 1.0 (0.35 s) with a 1-px gold outline; coalesced
  cells (luck) do a quick vertical flip (0.15 s) when they change. Curse: middle-row MAWs open their mouths (2-frame sprite), glass
  gets a crack decal (alpha 0.6 for 3 s), cabinet "breathes" (scale.z 1.0 → 1.015, 2 cycles). Fill: reels spin up again backwards
  for 1 s, then all 15 cells snap to the symbol simultaneously; top box flips open (hinged lid rotates 25°) and pours coins (60
  particles, low-poly 6-sided discs).
- **Light.** Bulbs: idle chase 6 Hz; win → all on + 2 Hz blink for the count-up; tease → bulbs go red `#FF2020` and chase at 12 Hz;
  curse → everything off for 0.6 s, then a single red key light `#8B0000` from inside the cabinet at 2.5 intensity fading 3 s;
  jackpot → gold strobe 8 Hz for 2 s, then rainbow chase (hue rotate 90°/s) for 7 s.
- **Big-win sequence.** ≥ ×10: "BIG" stamp slams onto the reel glass (pixel text 48 px, overshoot), 3 s. ≥ ×25: "HUGE" + coin
  fountain from the mouth grille. ≥ ×50: "MONSTROUS" + whole pit lights flicker gold, the HUNGER needle swings to zero (cosmetic).

### 2.12 Edge cases and anti-exploit
- Bans/weights can never leave < 3 symbols with weight > 0 (hook clamps). Luck coalesce capped at 30 %/cell.
- Curse roll happens before fill roll, so a `curseWard` must be consumed before a fill can occur on that spin (ward converts the
  spin into a fresh roll of steps 2–7, one ward per spin).
- `holdReel` keeps one column's 3 cells for the next spin (step 3 skips those cells; steps 4–6 still apply to them normally).
  A hold cannot be used two spins in a row, and a held spin cannot trigger FULL from the fill roll (fill roll is skipped).
- Jackpot meter race: two FULLs on the same host tick are impossible (host serialises instances); the second instance's FULL pays
  from the reseeded meter.
- Stake is fixed per spin; bet keys during SPINNING are ignored (no buffer).
- Autoplay stops on: any `bigwin`, `curse`, `jackpot`, wallet < stake, actions < 1, any damage/trapdoor event, or player input.
- Disconnect during EVAL: settle proceeds on host timeline; watchers still see the replay.
- Teaser MAW never forms a trio by construction (so only the curse roll can EAT a spin; the HUNGER gauge stays honest).

---

## 3. One-Armed Bandit — `bandit` · TR "Tek Kollu Haydut" · Tier 1

**Fantasy.** A 1950s-style chrome three-reeler bolted to a pillar: real stepped reels, real lever, one pay line, and a wicked
near-miss habit.

**Cabinet.** 0.55 W × 0.50 D × 0.80 H m on a 0.70 m pedestal (top at 1.50 m). Chrome `#B8BCC4`, enamel face `#1E4D7A`, cream
reel strips `#F0E6CC`, red pay-line bar `#D02020`. Reel window 0.36 × 0.14 m (three windows 0.10 m wide, one visible stop
above/below the line, partially shadowed). Lever on the right: 0.45 m arm, chrome, black ball knob 0.06 m. Coin slot top-right,
payout cup at the bottom (0.16 m bowl). Award glass above the reels (paytable printed, 0.40 × 0.20 m).

### 3.1 Rules
1. Choose denomination `V` cycles {1, 5, 25} coins per credit; choose credits 1–3 (wheel/Z/X).
2. Pull the lever (or Space). Three physical reels of **22 stops** spin and stop left → right.
3. Only the centre line pays. 3rd-credit bonus on the top award only.
4. Results come from **64-stop virtual reels** mapped onto the 22 physical stops (classic weighted mapping), giving the
   probabilities below and the authentic near-miss (blank stops next to STAR are heavily weighted on reel 3).

### 3.2 Symbols and reel strips (per stop: `symbol:virtualWeight`; reel 1 and reel 2 identical, reel 2 rotated by +7 stops)
Reel 1/2 (virtual total 64): `STAR:2, b:3, PLUM:5, b:2, BAR:4, b:2, ORANGE:5, b:2, 3BAR:3, b:1, SHOE:4, b:1, MELON:6, b:1,
PLUM:5, b:1, 2BAR:5, b:1, ORANGE:4, b:1, BAR:3, b:3`
Reel 3 (virtual total 64): `STAR:1, b:4, PLUM:5, b:2, BAR:4, b:2, ORANGE:4, b:2, 3BAR:3, b:1, SHOE:4, b:1, MELON:5, b:1,
PLUM:5, b:1, 2BAR:4, b:2, ORANGE:4, b:2, BAR:3, b:4`
Symbol totals — R1/R2: BLANK 18, PLUM 10, ORANGE 9, MELON 6, BAR 7, 2BAR 5, 3BAR 3, SHOE 4, STAR 2. R3: BLANK 22, PLUM 10,
ORANGE 8, MELON 5, BAR 7, 2BAR 4, 3BAR 3, SHOE 4, STAR 1.
Art (32×32 strip cells): PLUM `#5B2A86`, ORANGE `#FF8C1A`, MELON `#2E8B3A` with red flesh, BAR black on cream, SHOE (horseshoe)
`#8A8F98`, STAR red `#E01818` five-point with white rim. Blank = cream with faint pinstripe.

### 3.3 Paytable (per credit, centre line) and exact odds (enumeration)
| Combination | Pays / credit | Probability | RTP share |
|-------------|--------------:|------------:|----------:|
| STAR STAR STAR | 1 000 (3 credits: **5 000 total**) | 1 in 65 536 | 1.53 % (+1.02 % at 3 cr) |
| 3BAR ×3 | 200 | 1 in 9 709 | 2.06 % |
| 2BAR ×3 | 100 | 1 in 2 621 | 3.81 % |
| BAR ×3 | 50 | 1 in 764 | 6.54 % |
| MELON ×3 | 100 | 1 in 1 456 | 6.87 % |
| ORANGE ×3 | 30 | 1 in 405 | 7.42 % |
| PLUM ×3 | 20 | 1 in 262 | 7.63 % |
| ANY BAR mix ×3 | 15 | 1 in 98 | 15.34 % |
| SHOE ×3 | 50 | 1 in 4 096 | 1.22 % |
| any 2 SHOE | 6 | 1 in 91 | 6.59 % |
| any 1 SHOE | 2 | 1 in 6.1 | 32.96 % |
| **Total** | | hit 19.5 % | **91.96 %** (1–2 cr) / **92.98 %** (3 cr) |
Variance: σ ≈ 6.3 per credit → **HIGH**.

### 3.4 RNG model
At commit: three independent integer draws 0..63 → virtual stop → physical stop index. Lucky Nudge (luck) applied after.
**Lucky Nudge:** if the result is a loss, with p = min(0.30, 0.01 × luckBonus) evaluate the 6 single-stop nudges (each reel ±1
physical stop) and apply the best paying one (ties → rightmost reel, downward). Tag `nearmiss` when two reels show STAR on the
line and the third shows STAR directly above/below it (exact: 56 / 262 144 ≈ 1 in 4 700 pulls; 57 % of those on reel 3).

### 3.5 Bets and cost
Bet = credits (1–3) × denomination (1/5/25) → 1–75 coins. actionCost **1 per pull**. Autoplay allowed.

### 3.6 Charm hooks
`luckBonus` (Lucky Nudge %) · `payoutMult` · `jackpotChance` (on a non-STAR result, extra chance `(mult − 1)/65 536` to force STAR
×3) · `bandit.symbolPayAdd[SYM]` · `bandit.shoeWild` (SHOE substitutes for fruits in 3-of-a-kind) · `bandit.thirdCoinBonus` (float ×
on the 3-credit top-award bonus) · `bandit.thumpLuck` (each thump within 10 s gives +2 temporary luck, see 3.7) · `bandit.extraLine`
(enables top and bottom lines at +1 credit each, same paytable; a 5-credit max then) · event `bandit.onNudge`.

### 3.7 Controls (pose: camera 0.45 m from the reel glass, eye 1.25 m, FOV 55°, slightly right so the lever is in view)
- **Lever:** LMB on knob, drag mouse down; lever angle follows mouse Y (0–55°). Releasing at ≥ 45° trips the reels; below 45°
  it springs back with no pull. Space = automatic pull animation (0.45 s).
- Wheel/Z/X credits · V denomination · B max (3 credits) · G autoplay · K **thump** the cabinet (cosmetic jiggle; 3 thumps in 10 s
  → TILT: 8 s lock, alarm bell; thumps never change odds unless the `thumpLuck` charm is owned) · H paytable · E stand.

### 3.8 State machine
| State | Duration | Notes |
|-------|---------:|-------|
| READY | ∞ | lever free |
| LEVER | player-driven | ≥ 45° on release → COMMIT, else READY |
| COMMIT | 0.05 s | debit, roll |
| SPIN | reels stop at 1.20 / 1.60 / 2.00 s after commit | mechanical stepped stop: 3-frame over-rotation then click back |
| NUDGE | 0.35 s (only if Lucky Nudge) | reel clunks one stop with a solenoid sound |
| PAY | 0.3–2.5 s | coin-drop hopper: 1 visible coin per credit won, max 40 visuals, rest as count-up |
| TILT | 8 s | blocks input |
Pull to result ≈ 2.1 s.

### 3.9 UI
Diegetic: reels, award glass, three LED windows on the belly glass, "COIN ACCEPTED" lamp, TILT lamp. Overlay: hints, H card.

### 3.10 Multiplayer — solo-occupant
`bandit.lever {i, angle}` (cosmetic, unreliable, 15 Hz while dragging) · `bandit.pull {i, r, t, p, credits, denom, stops:[u8,u8,u8],
nudge:{reel, dir}|null, combo, pay}` · `bandit.tilt {i, until}` · `mc.outcome`.

### 3.11 Juice
- Sound: lever = ratchet (8 noise clicks, bandpass 3 kHz, 30 ms apart) then spring "boing" (sine 220 Hz with 30 Hz vibrato, 0.3 s
  decay); reels = whirring gear (saw 40 Hz + noise AM 22 Hz); each stop = heavy clack (noise burst 15 ms lowpass 1.5 kHz + sine 120 Hz
  60 ms). Win = mechanical bell (2 detuned sines 1 760/1 790 Hz, 1.2 s decay) rung once per 10 credits (max 8 rings). Coins = metal
  tinks (sine 3–4.2 kHz random, 40 ms) into the cup. Jackpot = continuous bell 6 s + hopper rattle.
- Animation: lever spring-back with 2 damped oscillations; jackpot: the award-glass lamp behind STAR flashes and the cup overflows
  (coins spill onto the floor as pickup-able cosmetic props for 30 s).
- Light: line bar glows `#FF4040` on win; 6 Hz red/white chase on the top light for ≥ ×10.

### 3.12 Edge cases
- A lever drag that starts while reels are spinning is ignored (lever locked by a visible latch).
- TILT is cosmetic + lockout only; it never voids a round already committed.
- `extraLine` raises max credits to 5 (credits 4–5 activate the top and bottom lines). The top-award bonus then requires 5 credits
  (without the charm: 3 credits).
- Nudge never creates STAR ×3 (jackpot cannot come from a nudge).

---

## 4. Video Poker "Jacks Up / Deuces Down" — `videopoker` · TR "Video Poker" · Tier 1

**Fantasy.** A slanted bar-top CRT cabinet sunk into a sticky bar counter. Two games on one machine.

**Cabinet.** Bar-top unit 0.55 W × 0.45 D × 0.30 H m, set into a bar 1.05 m high. CRT 0.36 × 0.27 m (4:3), bezel black `#101010`,
brass rim `#B08830`. CRT background `#0B1E8C`, text `#FFE45C`, card faces white `#F4F4F0`, red suits `#D01818`. Physical button row
under the glass: HOLD 1–5 (white), BET ONE, BET MAX, DEAL/DRAW (red), DOUBLE (yellow), COLLECT (green). Canvas 256×192 px.

### 4.1 Rules
1. Choose game (`G` toggles at READY — videopoker has no autoplay; Q is the global COLLECT key): **Jacks Up** (Jacks or Better) or **Deuces Down** (Deuces Wild).
2. Choose denomination (`V`: 1/5/25 coins) and credits 1–5 (Z/X/wheel; B = 5 credits and deal).
3. DEAL: five cards from a freshly shuffled 52-card deck.
4. HOLD any subset (keys 1–5 / click cards). DRAW: unheld cards replaced by the next cards of the same shuffled deck.
5. Final hand paid per the active paytable × credits.
6. After any win: COLLECT (C / Space) or DOUBLE (D) — see 4.4.

### 4.2 Paytables (pays per credit; royal at 5 credits = 800 per credit)
| Jacks Up (8/5) | 1–4 cr | 5 cr | | Deuces Down | 1–4 cr | 5 cr |
|----------------|-------:|-----:|-|-------------|-------:|-----:|
| Royal flush | 250 | 4 000 | | Natural royal | 250 | 4 000 |
| Straight flush | 50 | 250 | | Four deuces | 200 | 1 000 |
| Four of a kind | 25 | 125 | | Wild royal | 25 | 125 |
| Full house | 8 | 40 | | Five of a kind | 16 | 80 |
| Flush | 5 | 25 | | Straight flush | 10 | 50 |
| Straight | 4 | 20 | | Four of a kind | 4 | 20 |
| Three of a kind | 3 | 15 | | Full house | 4 | 20 |
| Two pair | 2 | 10 | | Flush | 3 | 15 |
| Jacks or better | 1 | 5 | | Straight | 2 | 10 |
| | | | | Three of a kind | 1 | 5 |
Optimal-strategy return (published figures): Jacks Up 8/5 **97.30 %** (hit ≈ 45.5 %, σ ≈ 4.4, royal ≈ 1 in 40 400);
Deuces Down (NSUD-type table) **99.73 %** (hit ≈ 45 %, σ ≈ 5.1, four deuces ≈ 1 in 4 900, natural royal ≈ 1 in 45 000).
Casual play ≈ 94–95 %. Haiku regression: exact optimal-hold enumeration (see 4.6) must reproduce these to ±0.02 %.

### 4.3 RNG model
At DEAL commit: Fisher–Yates shuffle of 52 cards with the round PRNG; deal = deck[0..4]; replacement cards = deck[5..9] in order
(card i of the hand, if discarded, takes the next unused deck card left-to-right). The whole deck order is fixed at commit.

### 4.4 Double-up (optional, after a win)
Dealer card face up + 4 face-down cards from a fresh shuffle. Pick one (1–4 / click). Rank compare (2 low … A high, suits ignored;
in Deuces Down deuces are low here). Higher → win doubled; equal → push (may try again, counts as a step); lower → win lost
(tag `bust`). Up to 5 doubles per hand; cap: win ≤ 4 000 credits. Fair (100 % RTP) — adds variance only. Auto-collect after 15 s idle.

### 4.5 Bets and cost
1–5 credits × {1,5,25} → 1–125 coins. actionCost **1 per hand**; double-up free. Autoplay not allowed (decision game).

### 4.6 Charm hooks
`luckBonus` ("Second Look": per point 1 % (cap 30 %) chance that a losing final hand re-draws its replaced cards once from the
remaining deck — keep the better) · `payoutMult` · `videopoker.payTableUpgrade` (Jacks Up → 9/6, 99.54 %; Deuces Down → full-pay
25/15/9/5/3/2/2/1 with four deuces 200, 100.76 %) · `videopoker.hintOptimal` (HOLD lamps blink on the EV-optimal hold: computed by
exact enumeration of all 32 holds in a Web Worker, ≈ 2.6 M hand evaluations, < 0.5 s) · `videopoker.royalBonus` (× on royal) ·
`videopoker.doubleTieWins` · `videopoker.peekCard` (shows the first replacement card face-down-translucent before DRAW) ·
`videopoker.bonusQuads` (four aces/8s pay ×2).

### 4.7 Controls (pose: camera 0.50 m from CRT, looking down 25°, FOV 50°)
1–5 hold toggles · Space/Enter deal/draw · D double · C collect · Z/X/wheel credits · V denomination · G game · Q collect · B bet max + deal ·
H paytable (also always visible in the top third of the CRT) · E stand.

### 4.8 State machine
| State | Duration | Notes |
|-------|---------:|-------|
| READY | ∞ | bet/game/denom editable |
| DEAL | 5 × 0.12 s card flips | commit at start |
| HOLD | ∞ (player) | holds toggle; "HELD" label over card |
| DRAW | unheld cards flip, 0.15 s each | |
| EVAL | 0.5 s | winning hand row on paytable blinks 3 Hz |
| WIN_DECIDE | ≤ 15 s | collect or double |
| DOUBLE_PICK | ∞ (player) | dealer card flips 0.2 s; pick → reveal 0.3 s → result 0.6 s |
| PAYOUT | count-up | → READY |

### 4.9 UI
Diegetic: whole CRT (paytable, cards, HELD, CREDIT/BET/WIN, game name) + physical button lamps. Overlay: hints only.

### 4.10 Multiplayer — solo-occupant
`videopoker.deal {i, r, t, p, game, credits, denom, hand:[u8×5]}` (cards 0–51) · `videopoker.hold {i, r, mask:u5}` (sent at DRAW) ·
`videopoker.draw {i, r, final:[u8×5], rank, pay}` · `videopoker.double {i, r, step, dealer:u8, pick:u8, cards:[u8×4], result}` ·
`mc.outcome`. The shuffled deck never leaves the host (clients only learn dealt cards), so a modified client cannot peek.

### 4.11 Juice
Card flip: short noise "thwip" (highpass 3 kHz, 25 ms) + 1-frame white flash; HOLD toggle: blip square 1 kHz 30 ms; winning hand
tone: square arpeggio (rank-based, royal = 12-note run). Royal: CRT does a 1 s horizontal roll glitch, then gold card backs rain;
room bell. Double-up: heartbeat sine 55 Hz during pick; win = rising major third, loss = descending tritone + CRT brightness dips 40 %.
Lights: button lamps pulse on the next sensible action (DEAL after bet, DRAW after holds).

### 4.12 Edge cases
- Bet locked from DEAL until PAYOUT. Hold mask sent once with DRAW (no per-toggle network).
- A draw request with a stale round id is dropped. Disconnect during HOLD: after 90 s idle the host draws with the current mask
  (no holds if none) and collects (never doubles).
- Deuces Down hand ranking: wild cards evaluated to the best paying category (natural royal > four deuces > wild royal > 5K …).

---

## 5. The Elevator (crash) — `elevator` · TR "Asansör" · Tier 1

**Fantasy.** A rusted freight lift whose cable frays a little more every ride. The car climbs from B7 toward the surface; step
off before the cable snaps. Everybody rides together.

**v1.1 set (binding, fits XL 4.8 × 2.6 × 3.8, slot MID-01):** a glass-fronted *miniature* shaft cabinet 1.60 W × 1.00 D ×
3.70 H at the back of the footprint (ART §5.19 look: brass cage car 0.30 × 0.30 × 0.40 on a frayed 8-segment cable, painted
log-scale marks, floor dial, nixie multiplier) plus **8 rider stations** in a shallow arc in front (strap post 1.90 m with a
hand-strap, a strap lamp amber / green / red, a brass STEP-OFF lever 0.25 m and a name plate). Riders stand at their
station; the car in the shaft carries everyone's fate. The original walk-in car text below is retained for flavour only.

**Cabinet / set (v1.0, superseded).** Car interior 2.40 W × 2.40 D × 2.80 H m, open-grille cage `#4A4038` with diamond mesh, 8 ceiling hand-straps
(leather `#5A3A22`, each with a small lamp: amber = riding, green = stepped off, red = fell). Front wall: brass **floor dial**
(0.60 m diameter, needle; scale B7 → G logarithmic), big odometer **multiplier** display (nixie-style digits `#FF7A20`, 4 digits
"×2.47"), STEP-OFF lever per strap (brass 0.25 m). Outside the car: history board (20 slots) and a betting kiosk on the landing.
Shaft 3.0 × 3.0 m, visible 9 m tall (fake infinite with fog `#100808`).

### 5.1 Rules
1. **BOARDING (8.0 s):** doors open; step in, press E on a free strap to take a seat; choose stake (wheel/Z/X) and optional
   AUTO STEP-OFF target (1–9 presets: 1.5, 2, 3, 5, 10, 20, 50, 100, 250; Shift+wheel fine ±0.05). Press Space to confirm bet.
2. **DOORS (1.5 s):** bets lock; host broadcasts the fairness hash.
3. **RIDE:** multiplier `m(t) = e^(0.07·t)` (t seconds since departure; ×2 at 9.9 s, ×5 at 23.0 s, ×10 at 32.9 s, ×100 at 65.8 s).
   Press Space (or pull your STEP-OFF lever) to cash out at the current multiplier; auto target cashes out exactly at the target.
4. **SNAP:** at the crash point the cable snaps; everyone still riding loses their stake. **ROOF:** if m reaches 250.00 the car hits
   the surface; all riders are paid ×250 (daylight flash).
5. **AFTERMATH (4.0 s):** winch drags the car back to B7, history board updates, next round.

### 5.2 Payout / RNG model (exact)
`U` = 52-bit uniform in (0,1]. `crash = min(250.00, max(1.00, floor(100 × 0.96 / U) / 100))`.
P(crash ≥ m) = 0.96 / m for 1.01 ≤ m ≤ 250 → **RTP = 96.0 % for every cash-out target** (house edge 4 %). P(instant snap at
×1.00) = 4.95 %. Median crash ×1.92. Minimum cash-out ×1.01. Snap time `tSnap = ln(crash)/0.07`. Ride max 78.9 s.
Variance is the player's choice: target ×2 → σ ≈ 1.0; ×10 → σ ≈ 3.0; ×100 → σ ≈ 9.8.

### 5.3 Bets and cost
Stake 1–500 (ladder). One stake per player per ride. actionCost **1 per ride joined** (watching from the landing is free).

### 5.4 Charm hooks
`luckBonus` ("Safety Net": per point 1 % (cap 30 %) chance, when you fall, to get 50 % of the stake back, tag `refund`) · `payoutMult`
(applies to cash-out profit and stake) · `elevator.autoInsurance` (once per deadline: a fall at ≥ ×1.5 is converted into a cash-out at
×1.0) · `elevator.lateStep` (+50 ms latency grace) · `elevator.floorBonus` (+0.02× per floor passed, paid only on cash-out) · events
`elevator.onFall`, `elevator.onRoof`.

### 5.5 Controls (seated pose = standing at strap; camera free-look allowed ±60° yaw so you can watch other riders)
Space or LMB on lever = STEP OFF · wheel/Z/X stake (boarding only) · 1–9 auto target · Shift+wheel fine target · H rules · E leave
strap (boarding only; during RIDE E = step off).

### 5.6 State machine (shared, host timeline)
| Phase | Duration | Per-seat state |
|-------|---------:|----------------|
| BOARDING | 8.0 s | `{p, seat, stake, auto, status:'boarding'}` |
| DOORS | 1.5 s | stakes debited; status `riding` |
| RIDE | until tSnap (or 78.9 s) | status `riding` → `out {mult}` |
| SNAP / ROOF | 2.0 s | riding → `fell` (SNAP) or `out ×250` (ROOF) |
| AFTERMATH | 4.0 s | outcomes settled at SNAP/ROOF time |
Round length ≈ 15.5 s + ride. If no human is seated at DOORS, the round still runs (bots ride) but is cosmetic only.

### 5.7 UI
Diegetic: odometer, floor dial, strap lamps, each player's name plate above their strap with stake and cash-out multiplier,
history board, BOARDING countdown on a flip-clock above the doors. Overlay: your stake/target/potential win line under the
crosshair (`2.47× → 247c`), hints.

### 5.8 Multiplayer — shared-table (8 seats) + bots
Bots ("debtors", 0–4, fill seats so that seated humans + bots ≤ 6; none if ≥ 6 humans): grey silhouettes with random names; cash-out
targets drawn `target = 0.96/U'` clipped 1.1–50; purely cosmetic, no wallet.
| Event | Payload |
|-------|---------|
| `elevator.phase` | `{i, r, t, phase, endsAt}` |
| `elevator.seat` | `{i, r, p, seat, stake, auto}` (also for bots, `bot:true`) |
| `elevator.lock` | `{i, r, fair:sha256hex}` |
| `elevator.go` | `{i, r, t0}` — clients compute m(t) locally from t0 |
| `elevator.out` | `{i, r, p, mult, payout, auto}` |
| `elevator.snap` | `{i, r, crash, tSnap, seed}` (seed reveals fairness) / `elevator.roof {i, r}` |
| `mc.outcome` | per human rider |
**Cash-out timing:** client sends `elevator.req {act:'out', r, tc}`; host accepts at `m(max(tRecv − min(rtt/2, 150 ms + lateStep), tLastAccepted))`
if that time < tSnap; otherwise rejected (`fell`). Clients never know the crash point before `elevator.snap`.

### 5.9 Juice
- Sound: cable creak loop (filtered noise, resonant bandpass 300–900 Hz sweeping with m, rate ∝ log m); floor pass = soft "ding"
  (sine 1 318 Hz, 0.4 s) each floor; motor whine (saw, pitch 80 Hz × √m, max 400 Hz). Cash-out = latch clack + rising chime
  pitched by multiplier. SNAP = Karplus-Strong pluck at 70 Hz (twang) + metal shriek (saw 2.4 kHz detuned pair, 0.5 s) + wind
  rush (noise, lowpass sweeping 300 → 3 kHz over 1.2 s) + impact (sine 45 Hz 0.3 s + noise burst).
- Animation: car shakes 0.002 m at 6 Hz rising to 0.008 m at ×50; strands of cable visibly unravel (cable mesh gets 1 extra frayed
  wire per ×2). On SNAP: car drops 3 m in 0.6 s, fallen players' cameras pitch down + black 0.4 s; cashed-out riders' avatars hang
  from their straps' safety hooks (unaffected).
- Light: car light `#FFE0A0` flickers with probability growing with m (2 %/s at ×1 → 20 %/s at ×50); ROOF = white daylight flood
  `#FFFFFF` intensity 4 for 1.5 s + bird chirps (FM sine bursts 3–5 kHz).

### 5.10 Edge cases
- Disconnect while riding: auto target honoured; with no auto target the stake rides to the snap (no "disconnect = cash-out").
- Joining during DOORS is refused (BUSY). Max 1 bet per player per round. Bots never affect any human payout.
- Host migration mid-ride (if implemented by net layer): the round is voided and stakes refunded (tag `void`).
- Fairness lamp must be green before the next BOARDING ends, else chat warns all players.

---

## 6. Scratch-Card Vendor — `scratch` · TR "Kazı Kazan Otomatı" · Tier 1

**Fantasy.** A buzzing vending machine full of lurid cards, with a little lit scratching desk and a chained coin for scratching.

**Cabinet.** Vendor 0.90 W × 0.70 D × 1.80 H m, enamel mustard `#C9A227` with black stripes `#151515`, glass front showing 5
card rows (sample cards), selector buttons 1–5, coin slot, card slot. Attached desk at 0.95 m: 0.50 × 0.35 m, green felt
`#1F5A3A`, lamp with warm light `#FFE6B0`, chained scratching coin (brass, 0.03 m). Cards in world: 0.10 × 0.15 m; canvas 128×192 px.

### 6.1 Card catalogue (price in coins; prize = multiple of price; weights out of 1 000 000)
**1 · PIT PENNY — 2c** ("Match three amounts"). 3×3 grid of amounts.
| Prize | 1× | 2× | 3× | 5× | 20× | 100× | 500× | lose |
|---|---|---|---|---|---|---|---|---|
| Weight | 250 000 | 125 000 | 25 000 | 25 000 | 4 000 | 200 | 10 | 570 790 |
RTP **80.5 %**, win 1 in 2.33.

**2 · LUCKY LADDER — 5c** (7 rungs revealed bottom→top; FOOT = climb, SNAP = stop; prize by highest rung reached).
| Reached rung | 2 → 1× | 3 → 2× | 4 → 4× | 5 → 10× | 6 → 50× | 7 (TOP) → 250× | lose (rung 0–1) |
|---|---|---|---|---|---|---|---|
| Weight | 250 000 | 125 000 | 40 000 | 10 000 | 1 000 | 40 | 573 960 |
RTP **82.0 %**, win 1 in 2.35.

**3 · HOUSE vs YOU — 10c** (HOUSE number 1–20; five YOUR numbers each with a prize label; every YOUR > HOUSE wins its label).
| Total prize | 1× | 2× | 4× | 10× | 50× | 250× | lose |
|---|---|---|---|---|---|---|---|
| Weight | 222 222 | 111 111 | 40 000 | 16 667 | 1 000 | 50 | 608 950 |
RTP **83.4 %**, win 1 in 2.56.

**4 · BLOOD MOON — 20c** (12 cells of MOON/BAT/OWL/SKULL; 3+ MOONs win the prize box; a BLOOD MOON cell = instant win).
| Prize | 1× | 2× | 5× | 10× | 50× | 1000× | lose |
|---|---|---|---|---|---|---|---|
| Weight | 200 000 | 100 000 | 50 000 | 10 000 | 1 250 | 40 | 638 710 |
RTP **85.3 %**, win 1 in 2.77.

**5 · THE DEEP END — 50c** (two independent windows: PRIZE × DEPTH).
PRIZE weights /1 000 000: 1× 180 000 · 2× 80 000 · 5× 30 000 · 20× 6 000 · 100× 400 · SUNK 703 600.
DEPTH weights /1 000: ×1 850 · ×2 100 · ×5 40 · ×10 10. RTP 0.65 × 1.35 = **87.8 %**, win 1 in 3.37, max 1 000×.

**Charm spot (all cards):** an extra independent roll puts a charm stamp on the card: PIT PENNY 1/200 common · LADDER 1/120 common ·
HOUSE 1/100 common · BLOOD MOON 1/60 uncommon · DEEP END 1/40 (90 % uncommon / 10 % rare). Not counted in coin RTP.
Variance: all cards **HIGH** (σ ≈ 5–30 × price, driven by the top prize).

### 6.2 Face generation (deterministic from the outcome)
- PIT PENNY: amounts set {2,4,6,10,40,200,1000}. Winner = exactly 3 cells of the prize amount, no other amount ≥ 3. Loser = no
  triple; 35 % of losers show 2 × of one of the two top amounts (near-miss, tag `nearmiss`).
- LUCKY LADDER: rungs 1..k = FOOT, rung k+1 = SNAP (k from the table; losers k = 0 (40 %) or 1 (60 %)).
- HOUSE vs YOU: decompose the prize into 1–3 winning labels from {1,2,4,10,50,250}× (prefer fewest cells); non-winning YOUR numbers
  ≤ HOUSE; 30 % of losers contain a tie (YOUR = HOUSE, ties lose — printed rule).
- BLOOD MOON: winners show exactly 3 MOONs (or a BLOOD MOON instead for 30 % of wins ≥ 10×); losers ≤ 2 MOONs (40 % exactly 2).
- DEEP END: PRIZE window shows amount or "SUNK"; DEPTH window always shows a value.

### 6.3 Scratching
LMB-drag the coin over the foil; brush = jagged 6 px-radius stamp on the 128×192 mask every 2 px of travel. A zone counts as
revealed at ≥ 55 % pixels cleared. Space = "scratch all" (auto-scratch sweep, 1.2 s). Card settles when all zones are revealed.
Pose: camera 0.28 m above the desk, looking down 70°, FOV 50°. Keys 1–5 select card type; wheel/Z/X quantity 1–5 per vend.

### 6.4 Bets, cost, RNG
Price fixed per card; up to 5 cards per vend, each card = 1 actionCost. Outcome rolled per card at vend (weight table → layout
generator with the same round PRNG). Cards are settled independently (one `mc.outcome` per card, round id per card).

### 6.5 Charm hooks
`luckBonus` (per point 0.5 % (cap 15 %) chance a losing card is upgraded to the lowest prize — face generated accordingly) ·
`payoutMult` · `scratch.topPrizeMult` (× top-prize weight) · `scratch.extraCharmSpot` (× charm-spot chance) · `scratch.secondChance`
(losing cards go to a "2nd chance" bin; every 10 → one free PIT PENNY) · `scratch.discount` (price −N %, floor 1c) · `scratch.xray`
(one zone per card glows faintly before scratching).

### 6.6 State machine
READY → (select + pay) VEND (coin clunk 0.3 s, card slides out 0.8 s per card) → SCRATCH (player) → REVEAL (all zones done → prize
stamp 0.5 s) → SETTLE → next card or READY. Leaving with unscratched cards: auto-scratch and settle at stand-up (2 s).

### 6.7 UI
Diegetic: vendor glass, card faces, desk lamp, prize stamp. Overlay: hints, H card shows the five prize tables (EN/TR).

### 6.8 Multiplayer — solo-occupant
`scratch.vend {i, r, t, p, cardType, face:<compact face data>, charm}` (face is public; outcome is fixed anyway) · `scratch.zone {i, r, zone}`
reliable · `scratch.stroke {i, r, pts:[u8 x, u8 y]…}` cosmetic, unreliable, 15 Hz (watchers see foil vanish) · `mc.outcome` per card.

### 6.9 Juice
Scratch sound: pink noise through a resonant bandpass (Q 6) whose centre follows stroke speed (600 Hz → 3.5 kHz) + 10 ms grain
clicks every 4 px. Silver flakes: 2×2 px particles falling to the desk (persist 20 s, max 300). Zone reveal: soft "tick". Win stamp:
rubber-stamp thump + ink splash sprite; ≥ 50× → desk lamp flickers gold, vendor marquee chases 8 Hz, fanfare. Near-miss: a slow
descending kazoo-ish saw (0.4 s) — the pit laughs at you.

### 6.10 Edge cases
- Over-scratching outside zones is allowed (just cosmetic). Card faces are generated so that no losing card ever contains a
  readable winning combination (validator asserts at generation in dev builds).
- Vend of N cards needs N actions and N × price coins up front; partial vend never happens.
- `luckBonus` upgrades are decided at vend (before face generation) — the face is always consistent.

---

## 7. Pachislot "Oni Feast" — `pachislot` · TR "Paçislot «Oni Ziyafeti»" · Tier 2

**Fantasy.** A row of loud Japanese-style skill-stop slots on a low counter with stools. Every cabinet has a hidden **setting**
(1–6) — finding a good one is the meta-game.

**Cabinet.** 0.52 W × 0.45 D × 0.95 H m on a 0.75 m counter (top at 1.70 m), stool seat 0.65 m. Body black `#111111`, magenta
trim `#E0218A`, gold `#F2C14E`. LCD 0.30 × 0.22 m above the reels (canvas 160×120). Reel window 0.30 × 0.15 m, three reels,
3 visible rows. Under the reels: start lever (short stick on the left, push down), MAX BET button, three STOP buttons (0.035 m,
lit blue `#30A0FF` when active). Medal tray at the bottom. **Oni lamp**: a carved demon mask at the bottom-left whose eyes light red
`#FF1010` when a bonus flag is held (shown after the 3rd reel stops — the classic "announcement" style).

### 7.1 Rules
1. Bet is always 3 medals per game (5 lines: 3 rows + 2 diagonals). Medal value `V` ∈ {1,2,5,10,25} coins.
2. Pull the lever (Space): an internal lottery picks this game's **flag** (role permitted to align), reels spin at 28 stops/s.
3. Press STOP for each reel (J / K / L or 1 / 2 / 3, any order). Each reel stops within **0–4 stops of slip** after the press.
4. Reel control slides each reel (within the 4-stop slip) to align the flagged role if possible, and never aligns an unflagged role.
5. Small-role flags not aligned are **lost**. BIG/REG flags are **carried** until aligned.
6. Minimum game cycle 4.1 s from lever to lever (authentic pacing).

### 7.2 Symbols and strips (21 stops each, index: symbol)
| Stops | Left reel | Centre reel | Right reel |
|-------|-----------|-------------|------------|
| 0 | ONI | ONI | ONI |
| 1, 5, 9, 13, 17 | KOI | KOI | KOI |
| 3, 7, 11, 15, 19 | REPLAY | REPLAY | REPLAY |
| 2, 6, 10, 14, 18 | LANTERN | 2 → LANTERN; 6, 10, 14, 18 → BLANK | LANTERN |
| 4 | FAN | BLANK | BLANK |
| 8 | BLANK | BLANK | BAR |
| 12 | BLANK | LANTERN | BLANK |
| 16 | FAN | BLANK | BLANK |
| 20 | BLANK | BLANK | BLANK |
KOI and REPLAY have a maximum gap of 5 stops on all reels, so every 5-stop slip window contains one → always catchable. LANTERN is auto-catchable on L/R but appears only twice on the
centre reel (aim needed). FAN (left reel only) appears twice (aim needed). ONI once per reel, BAR once (right) → bonuses need aim.
Art: ONI red demon mask `#C01020`; KOI orange-white carp `#FF7A1A`; REPLAY blue "↻" `#2060FF`; LANTERN paper `#FFCC66`; FAN purple
`#8040C0`; BAR gold `#F2C14E` on black.

### 7.3 Roles, lottery (per game, out of 65 536) and payouts
| Role | Line | Pays (medals) | Weight /65 536 | Prob. |
|------|------|--------------:|---------------:|-------|
| REPLAY | REPLAY ×3 | free next game (3) | 8 978 | 1/7.3 |
| KOI | KOI ×3 | 8 | 9 930 | 1/6.6 |
| LANTERN | LANTERN ×3 | 12 | 683 | 1/96 (aim on centre) |
| FAN | FAN on left reel, any line | 2 | 1 638 | 1/40 (aim on left) |
| BIG | ONI ONI ONI | → BIG bonus | S1 228 · S2 234 · S3 243 · S4 252 · S5 262 · S6 273 | 1/287 … 1/240 |
| REG | ONI ONI BAR | → REG bonus | S1 144 · S2 156 · S3 170 · S4 199 · S5 218 · S6 252 | 1/455 … 1/260 |
| MISS | — | 0 | remainder | |
**BIG "Oni Feast":** 24 games, each 3 in / 13 out (auto-aligned TRIBUTE) → +240 net. **REG "Lantern Parade":** 8 games, 3 in / 14 out → +88.
While a bonus flag is carried, the small-role lottery continues; BIG/REG are not redrawn.

**Settings (rolled per instance at run start):** S1 40 % · S2 20 % · S3 15 % · S4 12 % · S5 8 % · S6 5 %.
| Setting | Combined bonus | RTP perfect aim | RTP random presses |
|---------|---------------|----------------:|-------------------:|
| 1 | 1/176 | 94.8 % | 92.0 % |
| 2 | 1/168 | 95.9 % | 93.2 % |
| 3 | 1/159 | 97.5 % | 94.7 % |
| 4 | 1/145 | 99.6 % | 96.9 % |
| 5 | 1/136 | 101.5 % | 98.8 % |
| 6 | 1/125 | 104.0 % | 101.3 % |
Variance **HIGH** (bonus-driven). Setting hints: after each bonus the LCD end-screen shows a coloured oni; **purple** appears only on
S4–S6 (20 % per bonus), **gold** only on S6 (5 % per bonus); otherwise white/blue.

### 7.4 Reel control (host)
On a STOP press at stop index `p` (index under the centre row at press time): candidates `s ∈ {p, p+1, …, p+4}` (mod 21). Score each:
+1000 if it keeps the flagged role alignable on an active line given reels already stopped; −10 000 if it would align any unflagged
role; −s_offset (prefer smaller slip). Pick the max; ties → smaller slip. During MISS games the controller also avoids "visible
2-of-a-kind ONI on a line" 50 % of the time (tease control is allowed to show it the other 50 %).

### 7.5 Bets and cost
3 medals × V → 3–75 coins per game. actionCost **1 per 3 normal games** (charged on games 1, 4, 7 …); bonus games free.
Replay games cost 0 coins but count toward the 3-game action counter.

### 7.6 Charm hooks
`luckBonus` (BIG and REG weights × (1 + 0.02·L), cap ×1.6) · `payoutMult` · `jackpotChance` (× BIG weight) ·
`pachislot.settingPeek` (LCD shows the setting digit for 3 s on sit-down) · `pachislot.settingShift` (+1 setting until deadline end,
max 6) · `pachislot.slipFrames` (+1 max slip → easier aim) · `pachislot.bonusGames` (+N BIG games) · `pachislot.replayValue`
(replay also pays N medals) · `pachislot.autoAim` (FAN/LANTERN become auto-catch) · events `pachislot.onBonus {type}`.

### 7.7 Controls (pose: camera 0.45 m from reels, eye 1.20 m seated, FOV 55°)
Space = lever · J/K/L or 1/2/3 = stop left/centre/right · LMB on stop buttons · V medal value (between games) · B max bet (always 3) ·
H paytable · E stand. No autoplay (skill game).

### 7.8 State machine
| State | Duration | Notes |
|-------|---------:|-------|
| READY | ∞ (≥ 4.1 s since last lever) | |
| SPIN | until 3 stops (auto-stop after 30 s: random presses) | stop buttons lit |
| STOP_n | 0.05–0.15 s slide per reel | |
| RESULT | 0.4 s | pay count / replay lamp |
| ANNOUNCE | 1.2 s (if bonus flag first set) | oni eyes ignite after the 3rd stop |
| BIG / REG | 24 / 8 games, 2.5 s each (no stop needed; auto) | LCD feast animation |
| BONUS_END | 3 s | coloured oni hint |

### 7.9 UI
Diegetic: reels, LCD (game count, credit in medals, bonus counters, settings hint art), oni lamp, stop-button lamps. Overlay: hints;
H card with role table (not setting odds).

### 7.10 Multiplayer — solo-occupant
`pachislot.start {i, r, t, p, v}` (flag NOT sent) · client `mc.req {act:'stop', reel, press, tc}` (press index from local timeline;
host accepts if within ±6 stops of its own estimate, else uses its own) · `pachislot.stop {i, r, reel, press, final}` ·
`pachislot.result {i, r, role, medals}` · `pachislot.announce {i, r}` · `pachislot.bonus {i, r, type, game, medals}` ·
`pachislot.bonusEnd {i, r, hintColour}` · `mc.outcome` (one per game; bonus games bundled into one outcome tagged `bonus`).

### 7.11 Juice
Lever: spring "chunk" (noise 20 ms + sine 140 Hz); reel spin: high whir (square 1.2 kHz at −30 dB + flutter AM 28 Hz); stop press:
crisp "pik" (sine 2 kHz 15 ms) + reel thud; KOI pay: medal waterfall clinks 8 × 60 ms. Announcement: all sound cuts for 0.3 s, then a
taiko hit (sine 60 Hz pitch-drop + noise slap) and the oni eyes flare. BIG: 24-game taiko/shamisen loop (plucked Karplus-Strong at
pentatonic D minor, 150 bpm), LCD shows an oni eating koi. REG: softer flute (sine + breath noise). Light: reel backlights flash
in role colour; BIG → cabinet top lamp rotates red beacon (spinning light card, 1.5 rev/s).

### 7.12 Edge cases
- Setting is per instance and per run (save), identical for all players in multiplayer (host-rolled).
- Holding a BIG flag and standing up: flag persists on the machine (next occupant can collect it — authentic "hyena" behaviour, tag
  `scavenge` for them).
- Auto-stop after 30 s uses random press indices (prevents AFK stalls).
- Reel control must be deterministic (host and SP identical); unit test: no unflagged role ever aligns across 10 M simulated presses.

---

## 8. Pachinko "Deep Rain" — `pachinko` · TR "Paçinko «Derin Yağmur»" · Tier 2

**Fantasy.** Vertical pinball rain: hundreds of steel balls cascade through brass nails toward a single start pocket, feeding a
digital slot that can open the attacker gate and flood you with balls.

**Cabinet.** 0.55 W × 0.30 D × 0.95 H m, wall-mounted in rows at 0.80 m bottom. Playfield 0.48 × 0.48 m under glass, art "night rain
over a city" `#1A2A5A`/`#2B6CB0`, ~250 nails `#D9D9D9` (rendered as instanced 0.002 m pins), central LCD 0.20 × 0.15 m (canvas 160×120)
in a gold frame `#E8C060`; start pocket ("mouth") 0.025 m wide under the LCD; electric chu-lip below it (pink `#FF4FA0` flaps); two
tulips left/right `#FF4FA0`; side pockets (2); attacker (rectangular flap 0.08 × 0.02 m, `#FFD000`) bottom-right; out-hole bottom
centre. Handle bottom-right (chrome dial 0.07 m), upper tray (visual buffer of balls), lower tray. Balls: 0.011 m steel `#C8CCD0`.

### 8.1 Rules
1. Each fired ball costs ball value `V` ∈ {1, 2, 5} coins (wallet debited in 1 s batches). Returned balls credit V each.
2. Hold Space/LMB to fire at **1.6 balls/s**. Handle strength 0–100 % sets the zone.
3. Balls end in a sink: OUT, SIDE (+5 balls), TULIP (+7), START (+3 and a digital-slot spin if < 4 spins are held), E-CHU (+3, start),
   ATTACKER (+14).
4. Digital slot (3 LCD reels, digits 1–9): **JACKPOT** = triple. Normal probability 1/199 per spin ★; in KAKUHEN 1/40.
5. Jackpot → **ATTACKER**: 10 rounds; each round the gate opens until 9 balls enter or 25 s pass; switch to RIGHT-SHOT (≥ 88 %).
6. After a jackpot, 50 % → KAKUHEN (1/40 + electric chu-lip support, right-shot) until the next jackpot; 50 % → back to normal.
   Odd triple shown (1,3,5,7,9) = kakuhen; even triple = normal (decided at the jackpot roll).

### 8.2 Sink probabilities per fired ball
| Zone (handle) | OUT | SIDE (+5) | TULIP (+7) | START (+3, spin) | E-CHU (+3, spin) | ATTACKER (+14) |
|---------------|----:|----------:|-----------:|-----------------:|-----------------:|---------------:|
| < 40 % FOUL | ball returns to tray immediately (no cost, no sink) | | | | | |
| 40–58 % LEFT-LOW | 90.5 % | 5.5 % | 2.0 % | 2.0 % | — | — |
| **58–74 % LEFT-SWEET** | 89.5 % | 4.0 % | 3.0 %* | 3.5 % | — | — |
| 74–88 % LEFT-HIGH | 92.0 % | 3.0 % | 2.5 % | 2.5 % | — | — |
| ≥ 88 % RIGHT, normal | 99.7 % | — | — | 0.3 % | — | — |
| ≥ 88 % RIGHT, kakuhen | 65 % | — | — | — | 35 % | — |
| ≥ 88 % RIGHT, attacker open | 5 % | — | — | — | — | 95 % |
| < 88 % (LEFT), attacker open | as LEFT row, but ATTACKER 8 % taken from OUT | | | | | |
*Tulip Markov: closed catch 1.8 %, open catch 9.0 %; a catch toggles the tulip (closed→open→closed). Steady-state catch = 3.0 %.

### 8.3 Digital slot, reach table and timing
Spin durations: no reach 5.0 s (2.0 s when ≥ 3 spins are held; always 2.0 s in kakuhen). Reach frequency on losing spins 1/12.
| Reach type | Share of jackpot spins | Share of losing reach spins | Jackpot trust | Duration |
|------------|-----------------------:|----------------------------:|--------------:|---------:|
| NORMAL REACH | 10 % | 85 % | 0.7 % | 12 s |
| SUPER REACH "Flood" | 50 % | 14 % | 17.8 % | 25 s |
| PREMIUM "The Drain" | 40 % | 1 % | 70.8 % | 35 s |
Holds: max 4 (shown as 4 small lamps under the LCD).

### 8.4 RTP (sweet zone, perfect right-shot in bonus)
Pocket returns 0.20 + 0.21 + 0.105 = 0.515 balls/ball. Jackpot: 10 × 9 × 14 = 1 260 out for ≈ 95 fired → +1 165 net; chain length
E = 2 jackpots per first hit (50 % kakuhen) → +2 330 per first hit; first hit per ball = 0.035 / 199 = 1/5 686 → 0.410.
**RTP ≈ 92.5 %** (LEFT-LOW ≈ 71 %, LEFT-HIGH ≈ 69 %, RIGHT in normal mode ≈ 4 % — finding the sweet zone is the skill).
Variance **HIGH**.

### 8.5 Cost
Coins: V per ball. actionCost **1 per 50 balls fired in normal mode** (attacker and kakuhen firing free). The machine reports
one `mc.outcome` per 50-ball normal block (bet = 50 V, payout = balls returned during that block × V) and one per jackpot chain
(bet = balls fired during the chain × V, payout = returns × V, tags `jackpot`, `bonus`).

### 8.6 Charm hooks
`luckBonus` (+0.1 % absolute START chance per point in the sweet zone, cap +3 %) · `jackpotChance` (× 1/199) · `payoutMult` (on
jackpot-chain payouts only) · `pachinko.kakuhenRate` (+ % absolute, cap 80 %) · `pachinko.attackerPay` (+N balls per attacker entry) ·
`pachinko.tulipBoost` (open-catch +%) · `pachinko.holdMax` (+1 hold) · `pachinko.sweetWiden` (sweet zone ±N %) · events
`pachinko.onReach {type}`, `pachinko.onJackpot {kakuhen}`.

### 8.7 Controls (pose: camera 0.50 m from glass, centred on LCD, FOV 58°)
Hold Space or LMB = fire · wheel ±2 % strength per notch · A/D = ±25 %/s · Shift held = snap to RIGHT-SHOT (90 %) · V ball value (only
when no balls in flight) · H info · E stand (in-flight balls resolve and are paid).

### 8.8 State machine (machine mode × firing)
Modes: NORMAL → (jackpot) ATTACKER (round k = 1..10: OPEN ≤ 25 s → CLOSE 2 s "V" animation) → KAKUHEN or NORMAL.
Digital slot sub-machine: IDLE → SPIN (5.0/2.0 s) → [REACH (12/25/35 s)] → RESULT (1 s) → next hold or IDLE.
Ball sub-system: each fired ball: LAUNCH (rail 0.35 s) → FIELD (path 1.6–2.4 s) → SINK.
Fire is allowed in every mode; the attacker never opens without a jackpot.

### 8.9 Ball paths (outcome-first, physics-lite)
Host rolls the sink at launch (table 8.2 for the current zone/mode/tulip state). The board is a **lane graph**: ~60 nodes (pin
clusters) in 9 levels; each sink has a set of entry nodes. Path generator (seeded `u16`): random walk from the zone's entry node,
rejecting moves that make the target sink unreachable (precomputed reachability bitsets). Clients animate parabolic hops between node
positions (0.15–0.25 s per hop, apex 0.01–0.03 m), with 2–3 extra "rattle" pin taps. No physics engine.

### 8.10 UI
Diegetic: LCD (slot, holds, round counter, mode banner "KAKUHEN" / "RIGHT-SHOT →" arrow), ball count digits on the tray (net balls
this session), tulip state, attacker flap. Overlay: strength meter ring around the crosshair (zones coloured), hints.

### 8.11 Multiplayer — solo-occupant
`pachinko.ball {i, b, t, zone, sink, s:u16}` (b = ball sequence; one per ball, ~1.6/s) · `pachinko.spin {i, n, t, digits:[3],
reach, jackpot, kakuhen}` · `pachinko.mode {i, mode, round}` · `pachinko.tray {i, net}` (1 Hz) · `mc.outcome` per block/chain.
Watchers > 12 m: only `pachinko.mode` and outcomes; the field shows a looping "rain" particle instead of real balls.

### 8.12 Juice
Ball firing: soft "tik" per ball (noise 3 ms, highpass 5 kHz) + continuous ball-rattle bed (granular: 20 grains/s of 2–5 kHz sine
pings, gain ∝ balls in flight). Pocket entries: SIDE = "pon" (sine 880 Hz), TULIP = flap clack + "pon-pon", START = bright chime +
LCD flash. Reach: music ducks, heartbeat, rising choir pad (3 detuned saws through formant bandpasses at 700/1 200 Hz). Jackpot:
fanfare + rain sound turns into a roaring waterfall loop; attacker entries = 14 rapid ticks each. Lights: playfield LEDs (light cards)
pulse blue `#40A0FF` in rain ripples; reach → red; jackpot → rainbow chase 10 Hz; kakuhen → steady violet `#A040FF` glow.

### 8.13 Edge cases
- Holds beyond 4: START still pays +3 but no spin (lamp blinks "FULL").
- Leaving during ATTACKER/KAKUHEN: the machine finishes rounds in auto-right-shot on the host for up to 60 s and credits the player;
  remaining kakuhen state stays on the machine (next occupant inherits it — tag `scavenge`).
- Strength changes apply to balls launched after the change (in-flight balls keep their roll).

---

## 9. Plinko Board — `plinko` · TR "Plinko Çivi Tahtası" · Tier 2

**Fantasy.** A tall lacquered board of brass pegs; drop pucks, watch them clatter into slots with brutal edge multipliers.

**Cabinet.** Upright 1.20 W × 0.30 D × 1.90 H m. Back panel black `#0E0E14` with gold leaf border; 12 peg rows (row k has k+2 pegs),
spacing 0.08 m horizontal × 0.09 m vertical, pegs brass `#D4AF37` 0.012 m; puck 0.045 m translucent red acrylic `#FF3355`; 13 slots
0.08 m wide at the bottom with LED multiplier labels coloured by value (≥ 10 `#FF2020`, ≥ 2 `#FF9020`, ≥ 1 `#FFE040`, < 1 `#808080`).
Top: funnel + 5 decorative insert holes (any hole funnels to the centre peg). Physical risk switch LOW/MID/HIGH.

### 9.1 Rules
1. Choose risk (1/2/3), stake per puck, number of pucks (1–5).
2. Space drops the pucks 0.30 s apart. Each puck takes 12 left/right bounces and lands in slot k = number of rights (0–12).
3. Each puck pays stake × multiplier of its slot.

### 9.2 Multiplier tables (slot 0 … 12, symmetric) and probabilities (binomial n = 12)
Slot probabilities /4 096: 1, 12, 66, 220, 495, 792, 924, 792, 495, 220, 66, 12, 1.
| Risk | Slots 0/12 | 1/11 | 2/10 | 3/9 | 4/8 | 5/7 | 6 | RTP | σ |
|------|-----:|-----:|-----:|----:|----:|----:|---:|----:|---:|
| LOW | 8 | 3 | 1.5 | 1.2 | 1.1 | 1.0 | 0.5 | **96.4 %** | 0.34 (LOW) |
| MID | 24 | 8 | 3 | 1.5 | 1.2 | 0.7 | 0.4 | **96.7 %** | 0.92 (LOW) |
| HIGH | 170 | 24 | 8 | 2 | 0.6 | 0.2 | 0.2 | **96.4 %** | 4.4 (HIGH) |
Edge slot (0 or 12): 1 in 2 048 per puck.

### 9.3 RNG, cost, bets
Per puck: 12 independent bits P(right) = 0.5 → `bits:u16`. Stake 1–100 per puck; 1–5 pucks per drop; actionCost **1 per drop**.
Autoplay allowed.

### 9.4 Charm hooks
`luckBonus` ("Rubber Pegs": per point 1 % per row (cap 20 %) that the puck repeats its previous direction — widens the spread) ·
`payoutMult` · `plinko.goldenSlot` (one random slot per drop shows ×2, revealed before the drop) · `plinko.extraPuck` (+1 free puck) ·
`plinko.edgeMult` (× on slots 0/12) · `plinko.safetyFloor` (multipliers < 1 raised to N) · event `plinko.onEdge`.

### 9.5 Controls (pose: camera 1.6 m back, centred at board mid-height 1.1 m, FOV 60°)
Space drop · 1/2/3 risk · wheel/Z/X stake · [ / ] pucks −/+ · LMB on hole = cosmetic insert position · G autoplay · H · E.

### 9.6 State machine
READY → COMMIT → DROPPING (n pucks, 0.30 s apart) → each puck FALLING (12 hops × 0.20 s + 0.20 s settle = 2.6 s) → LANDED (label
flash 0.4 s, settle per puck) → READY when all landed (≈ 2.6 + 0.3·(n − 1) s). Risk/stake locked until READY.

### 9.7 UI
Diegetic: slot LEDs, risk switch, CREDIT/BET/WIN on the base, "last 12 slots" lamp row. Overlay: hints, H card with tables.

### 9.8 Multiplayer — solo-occupant
`plinko.drop {i, r, t, p, risk, stake, pucks:[{bits:u16, delayMs, golden?}]}` · `mc.outcome` (one per drop, `meta.slots`).

### 9.9 Juice
Peg hit: sine ping, pitch by row descending a C-major pentatonic (row 1 = C7 … row 12 = C5), 30 ms decay, ±10 cents jitter; puck
rattle wobble ±3° rotation. Landing: wooden thud + label flash; edge slot on HIGH: board-wide light chase `#FF2020` 10 Hz, siren
(saw 600↔1 200 Hz at 2 Hz) 3 s, coins burst from the slot. Pegs light up (emissive pulse 0.15 s) when hit.

### 9.10 Edge cases
Insert hole is cosmetic (outcome fixed by bits). Leaving mid-drop: all pucks resolve and settle. `extraPuck` uses the same stake
but is free (not debited).

---

## 10. Coin Pusher "The Shelf" — `coinpusher` · TR "Jeton İtici «Raf»" · Tier 2

**Fantasy.** A two-station glass box where a sliding shelf shoves a precarious hill of coins and charm capsules toward the edge.
Your neighbour's coins can fall into your tray.

**Cabinet.** 1.40 W × 1.20 D × 1.90 H m. Lacquer red `#9E1B32`, chrome `#C0C4CA`, playfield mirror-steel `#8C949C`. Playfield shelf
1.00 W × 0.50 D m at 1.00 m height; pusher block 1.00 × 0.20 × 0.04 m, sinusoidal stroke 0.12 m, period 2.4 s. Front drop edge split
at the centre into two trays (left/right station). Side gutters 0.025 m. Back wall: a rotating **lucky gate** (slot 0.05 m wide on a
wheel turning 0.25 rev/s) under a 3-reel bonus marquee. Each station: a coin chute that slides across its half (0.48 m travel).
Coins 0.026 m diameter, brass `#C9A227`; gold coins `#FFD040`.

### 10.1 Rules
1. Each instance has a fixed denomination D ∈ {1, 5, 25} (set by world placement; one machine per tier in the level).
2. Aim your chute (mouse X or A/D), press Space to drop a coin (max 3 coins/s). The coin lands on the pusher top or the shelf.
3. Coins pushed over the front edge fall into the tray of the half they cross → credited to the player seated at that station.
   Coins over the side gutters are lost to the house.
4. A coin passing through the lucky gate spins the bonus reels (outcomes below).
5. Prize capsules (charms) on the shelf are won when they fall into your tray.

### 10.2 Bonus reels (on gate entry; probability of gate entry ≈ 6 % of drops aimed at centre, ≈ 1 % otherwise)
| Result | Prob. | Effect |
|--------|------:|--------|
| SHOWER S | 50 % | 10 house coins dropped across the shelf |
| SHOWER L | 25 % | 30 house coins |
| WALLS | 15 % | side walls rise 20 s (no gutter loss) |
| PRIZE | 8 % | one charm capsule (70 % common, 25 % uncommon, 5 % rare) dropped on the shelf |
| JACKPOT ★ | 2 % | 100 house coins + golden plate (pays 50 D when it falls) |

### 10.3 Simulation (host only, physics-lite)
2D discs on the shelf plane with integer `layer` 0–2: 60 Hz fixed step; circle–circle separation (r = 0.013 m), pusher as a moving
AABB that pushes along +z; velocity damping ×0.90 per step; a coin compressed with > 3 neighbours and pusher contact climbs one
layer with p = 0.15/step; unsupported upper coins drop to layer 0. Coins with z beyond the front edge fall (payout); x beyond the
sides fall (house). Cap 260 coins (excess: oldest back-row coin removed, house). Max 6 prize items. At each deadline start the shelf
is restocked with house coins up to 180.

### 10.4 RTP and governor
Emergent; target **88 % ± 3 %** per 400-coin window. Governor (host) adjusts within limits every 50 coins: side-gutter effective width
0.015–0.035 m and SHOWER sizes ×0.8–×1.2, toward the target. Variance **LOW** per coin; outcomes are slow and lumpy (avalanches).

### 10.5 Bets and cost
1 coin = D per drop. actionCost **1 per 10 coins dropped** (charged on coins 1, 11, 21 …). One `mc.outcome` per 10-coin block
(bet 10 D, payout = coins credited to your tray from the block's first drop until 10 s after its last drop).

### 10.6 Charm hooks
`luckBonus` (+1 % absolute gate chance per point, cap +15 %) · `payoutMult` (on tray credits) · `coinpusher.goldCoin` (chance a dropped
coin is gold = 5 D when it falls into any tray) · `coinpusher.wallsUp` (walls for the first N coins each deadline) · `coinpusher.showerSize`
· `coinpusher.prizeChance` · `coinpusher.trayMagnet` (coins falling within 0.05 m of the centre split go to you) · event `coinpusher.onPrize`.

### 10.7 Controls (pose: camera 0.70 m above-front of the shelf, pitch −35°, FOV 60°, offset to your station)
Mouse X / A-D aim chute · Space or LMB drop (hold = 3/s) · K thump (shelf impulse: all coins +0.002–0.004 m forward; 2nd thump within
20 s → TILT: alarm, station locked 30 s, the 10 front-most coins are slid back 0.05 m) · H · E.

### 10.8 State machine
Machine: always RUNNING (pusher moves even when empty). Station: EMPTY → SEATED → (drop) ACTIVE (block open) → SEATED; TILT 30 s.
Bonus reels: IDLE → SPIN 2.0 s → RESULT 1.0 s → effect.

### 10.9 Multiplayer — shared-table (2 stations, host-authoritative)
Per-station state: `{p, chuteX, blockCount, blockBet, blockPay, tiltUntil}`. Unattended tray holds up to 50 coins; sitting down collects
them (tag `scavenge`).
| Event | Payload |
|-------|---------|
| `coinpusher.drop` | `{i, st, p, x, t, gold}` |
| `coinpusher.snap` | `{i, t, phase, coins:[u16 x, u16 z, u8 layer]×n, items:[…]}` 4 Hz, only to players within 12 m (≈ 5 KB/s) |
| `coinpusher.fall` | `{i, st:'L'|'R'|'G', n, gold, items[]}` |
| `coinpusher.bonus` | `{i, t, reels:[3], result}` |
| `coinpusher.tilt` | `{i, st, until}` |
Clients interpolate between snapshots (100 ms buffer) and spawn falling-coin visuals from `fall`.

### 10.10 Juice
Coin drop: metallic tink (sine 3.1 kHz + 4.6 kHz, 60 ms) then a clatter; pusher: low grinding loop (noise lowpass 250 Hz, AM at
1/2.4 Hz); avalanche: cascade of 6–40 tinks over 0.5 s + tray rattle. Gate: reels whirr, bell on result. Lights: marquee chase 4 Hz;
WALLS = blue edge glow `#3080FF`; JACKPOT = gold strobe + plate spins on the shelf. Tilt: klaxon (square 440↔370 Hz, 1 s).

### 10.11 Edge cases
- Determinism: only the host simulates; clients never decide falls. Snapshot loss → keep extrapolating ≤ 0.5 s then freeze.
- Item that falls into a tray with no seated player: stays in that tray (visible) until someone sits.
- Thump spam across both stations is rate-limited per station; TILT never confiscates credited coins.

---

## 11. Cyclone Light Ring — `cyclone` · TR "Siklon Işık Çemberi" · Tier 2

**Fantasy.** A towering arcade ring of 48 bulbs; a single light races around it and you slam STOP. Rarely, **the Eye opens**: the
jackpot bulb arms and the whole pit hears the siren.

**Cabinet.** v1.1: 1.00 W × 0.85 D × 2.10 H m (ART §5.24 body, fits M); ring radius 0.42 m (centre y 1.30) with 48 lamps (0.045 m domes) — the 48-lamp layout below is mandatory (aim-proof period 6). Front: lamp colours by value: 0 = dim red
`#401010`, ×1 = amber `#FFA020`, ×3 = green `#30E060`, JACKPOT (top, index 0) = gold `#FFD040` when armed / dark grey `#303030` when not.
Centre: round LED display (multiplier won). Big red STOP mushroom button (0.12 m) on a pedestal at 1.0 m. Body midnight blue `#101838`
with chrome ribs. Top beacon (rotating siren lamp) for the armed state.

### 11.1 Rules
1. Insert stake (commit). The light starts chasing clockwise at 40–52 lamps/s (smoothly varying per lap, seeded).
2. If the **Eye opens** (JACKPOT armed) the JP lamp turns gold before the chase starts.
3. Press STOP within 10 s (auto-stop at a random moment after 10 s). The light **coasts k extra lamps** (k uniform 0–5) while
   decelerating, then stops. The lamp it stops on pays stake × value.

### 11.2 Layout and payouts
Index 0 = JACKPOT; for i = 1…47 value = `[0,1,0,3,0,1][i mod 6]` → 16 × ×1, 8 × ×3, 23 × 0, 1 × JACKPOT.
JACKPOT armed ★: p = 1/30 at commit; pays **×25**; when unarmed the JP lamp is 0.
Every 6 consecutive lamps sum to 5 (period 6 = coast range), so aiming can't beat the base 0.833 — **aiming only matters for the armed
jackpot** (1 in 6 when aimed into the right window).
RTP (sim, 48-lamp model): random presses **85.1 %**; aimed at the armed JP ≈ **96–98 %**. Variance **MEDIUM** (σ ≈ 1.6 random; JP adds tail).

### 11.3 RNG and cost
At commit: armed (1/30 × jackpotChance), lap-speed seed, coast k (0–5). The press lamp is player-determined. Stake 1–50.
actionCost **1 per play**. Autoplay not allowed.

### 11.4 Charm hooks
`luckBonus` (+1 % absolute arm chance per point, cap +20 %) · `jackpotChance` · `payoutMult` · `cyclone.jpMult` (× JP value) ·
`cyclone.jpWindow` (on **armed** plays only, coast k is drawn from 0…(5 − N), min 0…2 → aimed JP chance 1/(6 − N); unarmed plays keep
0–5 so the period-6 layout stays aim-proof) · `cyclone.slowMo` (speed × 0.8) · `cyclone.secondLight` (a 2nd light 24 lamps behind; pays
the better of two) · event `cyclone.onArmed`.

### 11.5 Controls (pose: camera 1.8 m from ring, centre height 1.6 m, FOV 60°; STOP button visible bottom)
Space or LMB on STOP · wheel/Z/X stake · H · E.

### 11.6 State machine
READY → COMMIT (armed reveal 0.8 s if armed) → CHASE (≤ 10 s) → COAST (0.6 + 0.12·k s) → LAND (0.5 s blink) → PAY → READY.

### 11.7 UI
Diegetic: ring, centre display, beacon, STOP lamp. Overlay: hints; H card with layout explanation.

### 11.8 Multiplayer — solo-occupant
`cyclone.start {i, r, t, p, stake, armed, speedSeed}` · client `mc.req {act:'stop', lamp, tc}` (host accepts if within ±3 lamps of its own
estimate for the RTT-adjusted time, else uses its own) · `cyclone.land {i, r, press, k, lamp, value, pay}` · `mc.outcome`.
Clients reproduce the chase from `t` + `speedSeed`. `cyclone.start` with `armed:true` also triggers the pit-wide siren.

### 11.9 Juice
Chase: tick per lamp (square 1.8 kHz, 4 ms) at the chase rate, forming a buzz; coast: ticks slow down with falling pitch. Landing:
0 = flat "bonk" (sine 150 Hz), ×1 = coin chime, ×3 = triad arpeggio, JP = siren + fanfare 6 s, ring strobes all-gold, beacon spins.
Armed: siren wail (saw 500↔900 Hz at 0.8 Hz) for 1.5 s, beacon red, the JP lamp "breathes" (2 Hz). Light: the chasing lamp leaves a
3-lamp fading trail (intensity 1.0/0.5/0.25).

### 11.10 Edge cases
- Pressing STOP during COMMIT reveal is buffered (executed at chase start).
- Auto-stop moment is seeded (no information leak). A press after auto-stop is ignored.

---

## 12. Mines Terminal — `mines` · TR "Mayın Tarlası Terminali" · Tier 2

**Fantasy.** A green-phosphor military terminal: a 5×5 field, you choose how many mines are buried, then probe tile by tile.

**Cabinet.** Pedestal 0.50 W × 0.45 D × 1.20 H m, olive drab `#4B5320` steel with stencilled numbers, 14" CRT 0.30 × 0.23 m (canvas
160×120), phosphor `#33FF66` on `#001A08`, scanlines strong. Keyboard tray with chunky keys; red guarded CASH OUT switch.

### 12.1 Rules
1. Set stake and mine count m (1–24; presets 1 = 1, 2 = 3, 3 = 5, 4 = 10, 5 = 24; `[`/`]` ±1). Press Space to arm (commit).
2. Reveal tiles one at a time. Safe → the multiplier rises. Mine → round lost.
3. Cash out at any time after ≥ 1 safe reveal (C / Enter / CASH OUT switch). All safe tiles revealed or multiplier ≥ ×1000 → auto cash out.

### 12.2 Payout (exact)
After k safe reveals with m mines: `mult(k) = 0.97 × C(25, k) / C(25 − m, k)`, capped at ×1000. **RTP 97.0 % for every stopping
strategy** (below the cap). Examples:
| m \ k | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 |
|------|---|---|---|---|---|---|---|---|---|
| 1 | 1.01 | 1.05 | 1.10 | 1.15 | 1.21 | 1.28 | 1.43 | 1.62 | 1.87 |
| 3 | 1.10 | 1.26 | 1.45 | 1.68 | 1.96 | 2.30 | 3.28 | 4.90 | 7.80 |
| 5 | 1.21 | 1.53 | 1.96 | 2.53 | 3.32 | 4.43 | 8.33 | 17.16 | 40.04 |
| 10 | 1.62 | 2.77 | 4.90 | 8.99 | 17.16 | 34.32 | 163.0 | 1000 (cap) | — |
| 24 | 24.25 | — | | | | | | | |
Variance: player-chosen (m = 1, k = 3 → σ ≈ 0.4; m = 10, k = 5 → σ ≈ 4).

### 12.3 RNG
At commit: Fisher–Yates over 25 indices; first m = mines. Layout hash broadcast at commit; layout + seed revealed at round end
(commit–reveal on by default — mines is the most "is it rigged?" game).

### 12.4 Bets and cost
Stake 1–200. actionCost **1 per round**. Autoplay not allowed. Key P = pick a random unrevealed tile.

### 12.5 Charm hooks
`luckBonus` ("Defuse": per point 1 % (cap 30 %) that the first mine you hit in a round is defused — shown, round continues, no
multiplier step for that pick; remaining mine count decreases) · `payoutMult` · `mines.scanner` (one random safe tile is marked at commit)
· `mines.edgeBonus` (+0.05× per revealed corner tile) · `mines.insurance` (bust refunds N % of stake) · `mines.capRaise` (cap ×2000) ·
event `mines.onBust`.

### 12.6 Controls (pose: camera 0.45 m from CRT, FOV 50°)
Arrows/WASD move selector · Space reveal · LMB click tile · Q, C or Enter cash out · P random tile · [ ] mines · 1–5 presets · wheel/Z/X stake
· H · E (E during a round = cash out if k ≥ 1, else queued until bust/cash-out is decided by the player — stand-up never forfeits).

### 12.7 State machine
READY → ARMED (commit; grid "drops in" 0.4 s) → PICK (∞) → REVEAL (0.25 s flip) → [SAFE → PICK | MINE → BOOM 1.5 s → SHOW_ALL 0.8 s → READY]
→ CASHOUT (count-up) → SHOW_ALL → READY. Idle 90 s in PICK with k ≥ 1 → auto cash out; with k = 0 → refund stake (tag `void`).

### 12.8 UI
Diegetic: whole CRT (grid, current multiplier, next multiplier, mines left, stake, potential win). Overlay: hints.

### 12.9 Multiplayer — solo-occupant
`mines.start {i, r, t, p, stake, m, fair}` · `mines.pick {i, r, cell, safe, mult, defused?}` · `mines.end {i, r, result:'cash'|'bust'|'void',
mult, layout:u32, seed}` · `mc.outcome`. Watchers see picks live.

### 12.10 Juice
Selector move: tiny blip (square 2 kHz, 8 ms). Reveal safe: "ping" rising one semitone per safe tile (C5 upward); tension drone (two sines
55/55.8 Hz beating) grows louder as mult rises. Mine: CRT whiteout 0.1 s, explosion (noise burst, lowpass sweep 4 kHz → 200 Hz over 0.8 s,
+ sine 40 Hz thump), camera shake 0.006 m, CRT stays "burnt" (dim ghost image) for 2 s. Cash out: register "ka-ching" (sines 2.1 + 3.2 kHz
+ metallic noise), green flood of the grid.

### 12.11 Edge cases
- Picking a revealed tile is ignored. Max one pending pick (no double-click race).
- Cap reached mid-pick → auto cash out at ×1000. Defuse can trigger only once per round.

---

## 13. Dice Tower — `dicetower` · TR "Zar Kulesi" · Tier 2

**Fantasy.** A tall walnut tower on a purple felt table. The shooter drops two dice in the top; they rattle down through hidden
baffles (visible through slit windows) and tumble into the tray. Everyone around the table bets on the same roll.

**Cabinet.** v1.1 (slot class **L**, BOI-03): round table 1.30 m diameter, 0.90 m high, felt `#3B1E54` with gold print `#E8C060`;
4 betting stations on the front semicircle (stools at ±25° and ±70° from +Z, radius 0.85 m from the table centre, all inside the
2.40 × 1.80 footprint); the tower sits at the back edge (ART §5.32 deco-skyscraper styling).
Tower 0.35 W × 0.35 D × 1.10 H m, walnut `#3E2414` with brass bands `#B08830`, 4 internal baffles visible through four 0.02 m slit
windows, tray 0.40 × 0.30 m at the base. Dice 0.035 m translucent red `#D0102A`, white pips. Chips: low-poly discs coloured by value.

### 13.1 Rules
1. **BETTING (10 s):** place chips on up to 4 spots (multiples of 2 coins, 2–200 per spot).
2. **DROP:** the current shooter (rotates each roll among seated players) presses Space to drop the dice (auto-drop after 6 s).
3. Dice tumble 2.4 s; the total and pair status resolve all bets. **RESULT (3 s)**, then next round.

### 13.2 Bets, payouts, exact RTP
| Spot | Wins on | Pays | RTP |
|------|---------|------|----:|
| UNDER 7 | 2–6 (on 7: half stake returned) | 1:1 | 91.7 % |
| OVER 7 | 8–12 (on 7: half stake returned) | 1:1 | 91.7 % |
| LUCKY 7 | 7 | 9:2 | 91.7 % |
| DOUBLES | any pair | 9:2 | 91.7 % |
| FIELD | 2,3,4,9,10,11,12 (2 and 12 pay double) | 1:1 / 2:1 | 94.4 % |
| CORNERS | 2 or 12 | 15:1 | 88.9 % |
| EXACT 2 / 12 | that total | 31:1 | 88.9 % |
| EXACT 3 / 11 | that total | 15:1 | 88.9 % |
| EXACT 4 / 10 | that total | 10:1 | 91.7 % |
| EXACT 5 / 9 | that total | 7:1 | 88.9 % |
| EXACT 6 / 8 | that total | 11:2 | 90.3 % |
Variance: UNDER/OVER/FIELD LOW (σ ≈ 1.0); 7/DOUBLES MEDIUM (σ ≈ 2.0); CORNERS/EXACT HIGH (σ ≈ 3.7–5.4).

### 13.3 RNG and fairness
At DROP: two dice d1, d2 ∈ 1–6 (sfc32), commit–reveal mandatory (hash at end of BETTING, seed at RESULT). The tumble animation is a
seeded kinematic path through the 4 baffles (keyframed bounces, 0.25–0.45 s apart) ending in the tray; the die meshes are then
**face-remapped**: the last 0.3 s rotates each die so the pre-rolled face is up (slerp to the nearest orientation with that face up).

### 13.4 Cost
actionCost **1 per drop** for every player with at least one chip on the felt (watching is free). One `mc.outcome` per player per roll
(bet = sum of their chips).

### 13.5 Charm hooks
`luckBonus` ("Lucky Chip": per point 1 % (cap 30 %) chance a losing spot is refunded, per player) · `payoutMult` · `dicetower.fieldBoost`
(12 pays 3:1 on FIELD) · `dicetower.sevenPay` (+1:2 on LUCKY 7) · `dicetower.parlay` (wins on a spot ride automatically up to 3 rolls, each
ride +5 %) · `dicetower.shooterBonus` (+N % on your wins when you are the shooter) · event `dicetower.onDoubles`.
(Luck never re-rolls dice — the dice are shared.)

### 13.6 Controls (seated pose: camera 0.75 m from the felt edge, pitch −40°, FOV 60°, tower in view)
LMB on a spot = place one chip of the selected value (RMB on spot = remove) · wheel/Z/X chip value (2, 4, 10, 20, 50, 100, 200) · R =
repeat last bets · Backspace = clear my bets · Space = drop (when shooter) · H · E.

### 13.7 State machine (shared)
| Phase | Duration | Per-seat state |
|-------|---------:|----------------|
| BETTING | 10 s (ends early if all seated players press Space "ready") | `{p, seat, bets:{spot:amount}, ready}` |
| LOCK | 0.5 s | hash broadcast; bets debited |
| DROP | ≤ 6 s waiting for shooter + 2.4 s tumble | `shooter` = next seat with a player |
| RESULT | 3 s | `{wins:{spot:payout}}` |
Empty table → IDLE (tower ticks quietly). Bots: in single-player, 1–2 cosmetic "regulars" place visible fake bets (no wallet) for life.

### 13.8 UI
Diegetic: felt print, chips (stacks tinted in each seated player's colour, ART §8.2; patrons grey `#9C9484`), brass result board on the
tower base showing the total in mechanical flip digits, history pegs (last 12 totals). Overlay: my total bet / last win, hints.

### 13.9 Multiplayer — shared-table (4 seats)
`dicetower.phase {i, r, t, phase, endsAt, shooter}` · `dicetower.bet {i, r, p, spot, amount}` (per chip, reliable) · `dicetower.clear {i, r, p}`
· `dicetower.lock {i, r, fair}` · `dicetower.drop {i, r, t, shooter, d:[d1,d2], path:u32}` · `dicetower.result {i, r, total, pair, wins:[{p,
spot, payout}], seed}` · `mc.outcome` per player.

### 13.10 Juice
Drop: dice clack into the funnel; each baffle bounce = wood knock (noise burst bandpass 900 Hz + sine 220 Hz, 40 ms) audibly descending
through the tower (pan follows height); tray landing: double rattle (6 rapid knocks). Result: croupier bell (sine 2.6 kHz, 0.8 s). Win: chip
stack clatter; DOUBLES → tower slit windows glow orange `#FF8020` for 2 s; snake eyes/boxcars → a tiny skull pops out of the tower top on a
spring (cuckoo-clock style) with a laugh (formant-filtered noise bursts).

### 13.11 Edge cases
- Chips placed after LOCK are rejected and returned. Disconnected shooter → auto-drop after 6 s.
- A player who stands during DROP still gets their bets settled. Bets in odd amounts are impossible (chip values are even).

---

## 14. Mystery Capsule Vendor — `lootbox` · TR "Sürpriz Kapsül Otomatı" · Tier 2

**Fantasy.** A tall gumball-style dome stuffed with plastic capsules. Three crank slots: TIN, BRASS, GILDED. Twist the capsule open
yourself.

**Cabinet.** Glass dome 0.60 m diameter on a red cast-iron stand `#8E1B1B`, total height 1.90 m, footprint 0.80 × 0.80 m. Three crank
handles (chrome) on a front plate, each above a coin slot with an enamel badge: TIN `#9AA0A6`, BRASS `#C9A227`, GILDED `#FFD040`.
Capsules 0.06 m spheres split in two halves (top translucent colour, bottom white). Exit chute with a flap.

### 14.1 Rules
1. Choose tier (1/2/3) and pay the price; turn the crank (Space or drag the crank in a circle).
2. A capsule rolls into the chute; it auto-moves to your hands (viewmodel). Twist to open (hold LMB and drag in a circle, or Space).
3. Content is granted on open.

### 14.2 Content tables (reference shop prices for value-RTP: Common 15c, Uncommon 40c, Rare 120c, Legendary 400c, Cursed 120c)
| Tier (price) | DUD (trinket) | COINS | COMMON | UNCOMMON | RARE | LEGENDARY | CURSED | Value RTP |
|--------------|--------------:|-------|-------:|---------:|-----:|----------:|-------:|----------:|
| TIN (10c) | 32.4 % | 40 %: 3c (20) · 6c (12) · 15c (6) · 40c (2) | 22 % | 5 % | 0.6 % | — | — | 90.4 % |
| BRASS (40c) | 10.25 % | 35 %: 10c (15) · 25c (12) · 60c (6) · 150c (2) | 25 % | 20 % | 7 % | 0.75 % | 2 % | 91.6 % |
| GILDED (150c) | — | 30 %: 50c (11) · 100c (10) · 250c (6) · 750c (3) | — | 32 % | 25 % | 8 % | 5 % | 89.2 % |
Coin-only RTP: TIN 30 %, BRASS 28 %, GILDED 35 % — the machine is a charm source, not a money engine. Variance **MEDIUM**.
- **Duplicate protection:** a non-stackable charm you already own converts to 50 % of its reference price in coins (tag `dupe`).
- **Pity:** per player, the 10th BRASS/GILDED open without a RARE+ (Rare/Legendary/Cursed) is forced RARE+ (proportional redraw).
- **DUD** trinkets are flavour items (bottle cap, glass eye, a tooth…) worth 1c when sold at the pawn window.

### 14.3 RNG, bets, cost
Tier draw at crank commit; charm id drawn from the GDD's charm pool of that rarity (excluding banned/maxed). Price fixed per tier (×
`tableLimitMult` does not apply). actionCost **1 per capsule**.

### 14.4 Charm hooks
`luckBonus` (per point 1 % absolute moved from the lowest tier present (DUD, else COINS) to the next rarity up, cap 20 %) · `payoutMult` (coins
only) · `lootbox.pityAt` (−N to the pity threshold, min 5) · `lootbox.rerollToken` (re-open a capsule's result once) · `lootbox.cursedOdds` (×) ·
`lootbox.discount` · event `lootbox.onRarity {rarity}`.

### 14.5 Controls (pose: camera 0.70 m from the dome, eye 1.45 m, FOV 55°)
1/2/3 tier · Space or crank-drag = buy · hold LMB + circular drag / Space = open capsule · H (shows tables) · E (unopened capsule auto-opens on
stand-up).

### 14.6 State machine
READY → PAY (coin clunk 0.3 s) → CRANK (0.9 s; 3 ratchet clicks) → ROLL (capsule spirals down 1.2 s) → IN_HAND → SHAKE (N shakes, 0.35 s each;
N = 1 common/dud/coins, 2 uncommon, 3 rare+, legendary adds a fake-out pause 0.6 s before the 4th) → OPEN (pop 0.3 s) → REVEAL (item floats
1.5 s with a rarity beam) → READY.

### 14.7 UI
Diegetic: dome, badges, capsule colour hints (capsule top colour is random cosmetic — NOT rarity), item model and its rarity beam. Overlay: item
name/description card (EN/TR) for 3 s, hints.

### 14.8 Multiplayer — solo-occupant
`lootbox.vend {i, r, t, p, tier, capColour}` · `lootbox.open {i, r, content:{kind, id?, rarity?, coins?, dupe?}}` (sent at open time so watchers
share the suspense) · `mc.outcome` (items[] filled).

### 14.9 Juice
Crank: 3 heavy ratchet clicks (noise bursts bandpass 1.2 kHz) + internal capsule avalanche (granular plastic knocks 500–1 500 Hz). Roll:
spiralling rattle panned around the dome. Shake: dull plastic rattle; each extra shake higher pitch. Open: pop (sine 600 → 200 Hz, 40 ms +
noise). Rarity stingers: Common = single soft chime; Uncommon = two-note; Rare = 4-note arpeggio + sparkle (high noise ticks); Legendary =
choir chord (3 detuned saws, formants) + gold beam `#FFC020` + 2 s pit-wide bell; Cursed = reversed cymbal swell + purple-black beam
`#6010A0`, lights in 6 m radius dim to 40 % for 1.5 s. Beam = vertical additive light card 0.15 × 2.5 m. Dud = slide-whistle down.

### 14.10 Edge cases
- Charm pool empty for a rarity (all owned/maxed) → convert to coins at 100 % reference price.
- Pity counter persists across deadlines within a run, resets per run. Charm grant happens on open, never on vend.

---

## 15. Claw Crane — `claw` · TR "Pençe Vinç" · Tier 3

**Fantasy.** A candy-pink claw machine whose pile hides coin sacks, charm capsules and one golden egg. The claw is weak... usually.

**Cabinet.** 0.90 W × 0.90 D × 2.00 H m. Glass box 0.80 × 0.80 × 0.80 m on a 1.00 m base. Candy pink `#FF5FA2`, mint trim `#7FFFD4`,
interior light `#FFF0F8`. Three-prong chrome claw on a gantry (cable 0.005 m). Prize chute front-left: 0.20 × 0.20 m hole with a plexi
guard 0.06 m high. Joystick (red ball top) + DROP button on the control panel at 1.00 m. Prize pile: 2 layers on a tilted floor.

### 15.1 Rules
1. Pay stake → 15 s timer starts. Move the gantry (WASD/arrows, 0.25 m/s, normalised diagonals). Space drops (or timer → auto drop).
2. Claw descends (1.2 s), closes (0.6 s), lifts (1.0 s), travels to the chute (1.5 s), opens (0.4 s).
3. A prize delivered down the chute is won.

### 15.2 Prizes (pile of 20, restocked each deadline: 8 S, 5 M, 2 L, 3 common capsules, 1 rare capsule, 1 egg)
| Prize | Value | Grabbability g | Notes |
|-------|-------|---------------:|-------|
| COIN SACK S | ×5 stake | 1.00 | burlap `#A0784A` |
| COIN SACK M | ×8 stake | 0.65 | |
| COIN SACK L | ×20 stake | 0.25 | heavy, slumps |
| CHARM CAPSULE (common) | 1 common charm | 0.90 | clear sphere with the charm model inside |
| CHARM CAPSULE (rare) | 1 rare charm | 0.60 | gold-tinted sphere |
| GOLDEN EGG ★ | ×35 stake | 0.35 | delivered **only** with a strong grip |
Sack values scale with the stake of the play that wins them (shown on the sack tag as "×5").

### 15.3 Grab model (outcome partly skill)
- Strong grip ★: rolled at commit, p = 0.10 (hidden until the claw closes).
- Alignment `a = clamp(1 − d / 0.05 m, 0, 1)`, d = horizontal distance from claw centre to the grab point of the nearest top-layer prize.
- Lift: p = √a × g. Carry survival: strong 0.98 (lift) × 0.95 (travel) = 0.93; weak 0.35 × 0.40 = 0.14. Failed lifts nudge the prize
  (dx, dz ∈ ±0.03 m, seeded) — a prize can tumble into the chute by itself (p = 0.03 if within 0.08 m of the chute).
- RTP (coins only; ≈ g × value ≈ 5 per prize class by design): average player (√a ≈ 0.75) **≈ 80 %**, good (√a ≈ 0.9) ≈ 98 %, perfect
  ≤ 105 %. Charms are extra. Variance **MEDIUM**.

### 15.4 Bets and cost
Stake 2–50. actionCost **2 per play**. No autoplay.

### 15.5 Charm hooks
`luckBonus` (+1.5 % strong-grip per point, cap +30 %) · `jackpotChance` (× strong-grip chance) · `payoutMult` · `claw.weakCarry` (× weak carry
survival, cap 0.5) · `claw.timer` (+N s) · `claw.xray` (claw lamp shows strong grip before you drop) · `claw.magnet` (+0.01 m alignment
radius per stack) · event `claw.onDeliver {prize}`.

### 15.6 Controls (pose: camera 0.55 m from front glass, eye 1.50 m, FOV 60°)
WASD/arrows move · Space drop · RMB hold = side-peek (camera orbits 70° to the right side of the box to judge depth, 0.3 s) · wheel/Z/X stake
(READY only) · H · E.

### 15.7 State machine
READY → COMMIT → MOVE (≤ 15 s) → DESCEND 1.2 → CLOSE 0.6 → LIFT 1.0 (weak: drop-check at 0.6 s) → TRAVEL 1.5 (weak: drop-check at 0.8 s) →
RELEASE 0.4 → [WIN: prize slides out 0.8 s] → RETURN 1.0 → READY. Total ≈ 6–21 s.

### 15.8 Multiplayer — solo-occupant
Host integrates gantry movement from input bits. `claw.start {i, r, t, p, stake}` · `claw.pos {i, x, z}` (unreliable 20 Hz) · `claw.drop {i, r, x, z}` ·
`claw.grab {i, r, prize|null, a, lift, strong, dropAt:'lift'|'travel'|null, shift:{id, dx, dz}|null}` · `claw.deliver {i, r, prize}` ·
`claw.restock {i, pile:[{id, kind, x, z, layer, rotY}]}` · `mc.outcome`.

### 15.9 Juice
Music: tinny 8-bit waltz loop (square lead 3/4, 132 bpm) that speeds up ×1.25 in the last 5 s; timer beeps last 3 s. Gantry motor whine
(saw 300 Hz, pitch with speed). Descend: cable winch (noise bandpass 1.5 kHz, AM 30 Hz). Close: servo "zzt". Drop of a prize: soft plush
thump + sad trombone (saw glide 300 → 180 Hz). Delivery: chime fanfare, prize light `#FFFF80` flashes in the chute, sacks burst into coins.
Golden egg: the cabinet plays a lullaby chime and every interior lamp turns gold.

### 15.10 Edge cases
Gantry clamps to the box (0.05 m margin); the chute area cannot be grabbed from. Timer auto-drop always happens. Leaving during MOVE →
immediate drop at the current position.

---

## 16. Stacker — `stacker` · TR "İstif Kulesi" · Tier 3

**Fantasy.** A tall black tower of red lamp blocks; stack the moving bar to the MINOR line and decide whether to climb to the MAJOR.

**Cabinet.** 1.00 W × 0.80 D × 2.30 H m. Grid 7 columns × 15 rows of 0.10 m square lamps (lit `#FF2A2A`, off `#2A0505`), MINOR band at row
10 (amber `#FFB020` strip), MAJOR band at row 15 (gold `#FFD040`). Black body `#0A0A0A` with white neon edges `#F0F0FF`. Prize window above
the grid showing the MAJOR charm on a turntable. STOP button 0.15 m.

### 16.1 Rules
1. Pay stake. Row 1: a 3-block bar bounces left↔right. Space stops it.
2. Each next row's bar has the width of the stack top (capped: rows 1–5 ≤ 3, rows 6–10 ≤ 2, rows 11–15 ≤ 1). Overhanging blocks fall.
3. No overlap → game over (0).
4. Row 10 complete → **MINOR**: TAKE ×2.5 or CLIMB (5 s decision; default TAKE).
5. Row 15 complete → **MAJOR**: ×25 + a rare charm capsule.

### 16.2 Speed and RNG
Row r speed = 5.0 + 0.6·(r − 1) cells/s (row 1: 5.0, row 10: 10.4, row 15: 13.4). From row 8: each traverse speed × (1 ± 0.20) and an edge
dwell 0–120 ms (seeded at commit — reaction beats rhythm). Start side alternates. The stop cell is computed by the host from the deterministic
motion function at the RTT-adjusted press time (client timestamp accepted if within ±1 cell).

### 16.3 RTP
Skill game: target **≈ 70 % average player, ≤ 110 % expert** (TAKE at MINOR ≈ 0.35–0.65 of plays; MAJOR from MINOR ≈ 8–15 %). Telemetry-tune
via the speed table only. Variance **HIGH**.

### 16.4 Bets and cost
Stake 1–25 (deliberately low cap: skill machine). actionCost **2 per play**.

### 16.5 Charm hooks
`luckBonus` (speed −2 % per point, cap −20 %) · `payoutMult` · `stacker.extraBlock` (+1 width rows 1–5) · `stacker.saveCell` (once per play,
the first falling overhang cell is caught) · `stacker.minorMult` · `stacker.majorCharm` (rarity +1) · event `stacker.onMinor`.

### 16.6 Controls (pose: camera 2.0 m from grid, centred at row 8, FOV 60°; camera tilts up 0.3° per row reached)
Space or LMB STOP · Q/Space at MINOR = TAKE · C = CLIMB · wheel/Z/X stake · H · E (at MINOR = TAKE).

### 16.7 State machine
READY → COMMIT → ROW_r MOVING → STOPPED (fall anim 0.3 s per falling block) → ROW_r+1 … → [MINOR_DECIDE 5 s] → … → WIN / LOSE (1.5 s) → READY.

### 16.8 Multiplayer — solo-occupant
`stacker.start {i, r, t, p, stake, seed}` · `stacker.row {i, r, row, cellStart, width, kept:[cols], fell:[cols]}` · `stacker.decide {i, r, choice}` ·
`stacker.end {i, r, row, prize}` · `mc.outcome`.

### 16.9 Juice
Moving bar: tick per cell step (square 1 kHz, 5 ms). Stop: chunk (sine 180 Hz 60 ms). Falling block: descending whistle (sine 1.2 kHz → 300 Hz,
0.3 s) + smash. Each successful row raises a background drone a semitone. MINOR: lamp band strobes amber, voice-like "ding-dong" (two sines
880/660). MAJOR: whole grid fills top-down in gold, fireworks particles above the cabinet, pit-wide bell.

### 16.10 Edge cases
Press before the bar appears is ignored. Leaving mid-game: forfeits (0) — except at MINOR, where leaving = TAKE.

---

## 17. Fruit Machine "Nudge & Hold" — `fruitmachine` · TR "Meyve Makinesi «Dürt & Tut»" · Tier 3 (addition)

**Why add it.** The British pub fruit machine is a distinct real device: player-controlled HOLDs and NUDGEs, a feature trail and a
HI/LO gamble — all run by a **compensator** (the machine keeps a ledger and pays out when it is "in the black"). Different decisions
from the bandit, and a lovely "the machine is lying to you" vibe.

**Cabinet.** 0.70 W × 0.60 D × 1.80 H m. Body glossy green `#0F6B3A` with gold `#E8C060` lettering, top glass with the 6-square STEP trail
and a HI/LO number display (1–12), three reels 0.10 m wide, buttons: HOLD/NUDGE 1–3 (yellow), START (green), COLLECT (red), HI, LO.

### 17.1 Rules
1. Stake 1–20; START spins 3 reels (20 stops each, 1 line).
2. **HOLD:** when the HOLD lamp lights after a non-winning spin, hold any 1–2 reels for the next spin (keys 1–3).
3. **NUDGE:** when nudges are awarded (1–5), each press of 1–3 moves that reel down one stop; unused nudges are lost on START.
4. **STEP symbol** (reel 3) on the line advances the trail one square: [NUDGES ×2, CASH ×3, HOLD, CASH ×6, NUDGES ×4, CASH ×15]
   (cash = × stake, paid immediately; trail resets after the last square).
5. **HI/LO gamble** after any win: a number 1–12 shows; press HI or LO for the next number; correct → climb the cash ladder
   (2, 4, 8, 15, 25, 50, 100 × stake: the win moves to the next rung above it); equal → push; wrong → lose. COLLECT at any time.

### 17.2 Symbols, strips and pays (3 on the line, × stake)
| Symbol | Pays | Reel 1 | Reel 2 | Reel 3 |
|--------|-----:|------:|------:|------:|
| PEAR `#B8D040` | 4 | 5 | 5 | 4 |
| GRAPES `#6A2C8E` | 6 | 4 | 4 | 3 |
| STRAWBERRY `#E0203A` | 8 | 3 | 3 | 3 |
| MELON `#3A9A3A` | 12 | 3 | 3 | 2 |
| BAR | 20 | 2 | 2 | 2 |
| DOUBLE STAR `#FFD040` | 50 | 2 | 2 | 2 |
| MONEY BAG `#8A6A30` | 100 | 1 | 1 | 1 |
| STEP (arrow) | trail | — | — | 3 |
Natural (uncompensated) line return = 22.3 %; the rest of the return comes from features released by the compensator.

### 17.3 Compensator (exact 88 % RTP)
Per instance: bank `B` (coins, persisted per run). Each stake adds 0.88 × stake to B; every payout subtracts. Float `F = 10 × stake`.
- **Spin result:** draw natural stops; if its win > B + F, redraw (max 8), else force the nearest losing stop set.
- **Feature release:** after a losing spin, feature chance `pf = clamp(0.03 × (B/stake − 10), 0, 0.6)`; feature type by weights HOLD 40 /
  NUDGE 35 / STEP+1 25. Released HOLDs/NUDGEs are chosen so a win ≤ B + F is reachable (the machine "knows" the next stops it will use).
- **Trail squares** whose cash exceeds B + F are skipped (the lamp flickers "NO").
- **HI/LO:** next number drawn honestly; if honest success would climb above B + F, the number is redrawn as a loss.
Long-run RTP = 88.0 % exactly (|B| bounded by F and the release rate). Variance **MEDIUM**. Players can "read" a full machine
by its feature frequency — intended.

### 17.4 Cost and hooks
actionCost **1 per spin** (holds/nudges/gamble free). Hooks: `luckBonus` (float F + 1 × stake per point, cap +20) · `payoutMult` (applied after
the compensator; the bank is charged the full amount) · `fruitmachine.holdOdds` (pf ×) · `fruitmachine.gambleSafety` (one free push per gamble)
· `fruitmachine.trailStart` (start trail at square N) · event `fruitmachine.onFeature {type}`.

### 17.5 Controls (pose: 0.50 m from reels, FOV 55°)
Space START · 1/2/3 HOLD or NUDGE · C or Q COLLECT · W = HI, S = LO (also LMB on buttons) · wheel/Z/X stake · H · E.

### 17.6 State machine
READY → SPIN (stops at 1.0/1.3/1.6 s) → EVAL → [FEATURE (HOLD_SELECT ∞ / NUDGE_SELECT ∞ / TRAIL 0.8 s per square)] → [WIN → GAMBLE_OFFER
(≤ 10 s, auto-collect) → GAMBLE_STEP (0.8 s reveal) …] → PAYOUT → READY.

### 17.7 Multiplayer — solo-occupant
`fruitmachine.spin {i, r, t, p, stake, held:[b,b,b], stops:[3], win}` · `fruitmachine.feature {i, r, type, n}` · `fruitmachine.nudge {i, r, reel,
stops:[3]}` · `fruitmachine.trail {i, r, pos, square, paid}` · `fruitmachine.gamble {i, r, shown, pick, next, rung}` · `mc.outcome` per spin
(gamble and trail folded in). The bank value is never sent.

### 17.8 Juice
Pub sounds: chunky reel spin (saw 60 Hz + clatter), each feature lamp has its own jingle (square-wave 4-note "beep-boop" motifs); nudges = solenoid
clunk; HI/LO = number-flip click + tension tick; climbing rungs = rising arpeggio; lose = "wah-wah" (square with LFO-filtered glide). Lights: trail
squares chase when STEP lands; HOLD buttons blink 3 Hz when available.

### 17.9 Edge cases
Holds are never offered twice in a row or after a win. Nudges can't wrap the reel past a "hold" lock. Bank persists per instance; a new run
starts B at +5 × max stake (fresh machines are slightly generous).

---

## 18. Bingo Pinball — `bingopin` · TR "Tombala Langırtı" · Tier 3 (addition)

**Why add it.** The mid-century "bingo pinball" is a real gambling device: no flippers — you plunge 5 balls into 25 numbered holes and
light lines on a scrambled card on the backglass, then buy extra balls at a price the machine calculates. Distinct physical play + a great
backglass.

**Cabinet.** (slot class **L** in v1.1, LAU-08 at (−29.95, 0, 0.0)) 0.75 W × 1.40 D m playfield cabinet on chrome legs (playfield 0.85 m high at the front, inclined 6.5°), backbox to 1.90 m.
Woodgrain `#5A3A22`, chrome trim, playfield ivory `#F0E8D0` with 25 holes (0.03 m, staggered 5 × 5, numbered row-major 1–25 top → bottom),
bumper posts (rubber rings `#E02020`). Backglass deep teal `#0E5E5E` with a 5×5 card of gold numbers `#FFD040` (scrambled per instance at
run start); lit numbers glow `#FFF6A0`. Plunger bottom-right, ball lift button, EXTRA BALL lamp, TILT lamp.

### 18.1 Rules
1. Stake 1–25 per game. 5 balls. Hold Space to pull the plunger (0–100 % over 1.0 s), release to launch.
2. Each ball ends in a hole (1 ball per hole). The matching number lights on the backglass card.
3. While a ball is rolling (its last 0.8 s), A/D nudges the table left/right: 35 % chance it hops into the adjacent free hole on that
   side. Nudge n in a game has a TILT chance of 10 % × n; TILT ends the game with no pay.
4. After ball 5: EXTRA BALL offer at price `ceil(1.25 × EV₆)` (EV₆ = exact expected marginal win of one more ball at MEDIUM power given
   the lit holes). Up to 3 extra balls, each re-priced. COLLECT (C) ends the game.
5. Every line (5 rows, 5 columns, 2 diagonals) on the card pays: 3 lit = ×1, 4 lit = ×20, 5 lit = ×250 (lines pay independently).

### 18.2 RNG and RTP
Hole drawn at launch from free holes with power-zone weights: SOFT (< 35 %) holes 16–25 × 1.8; MEDIUM (35–75 %) uniform; HARD (> 75 %) holes
1–10 × 1.8. Path steered through a lane graph (as pachinko). Probabilities (uniform, 5 balls; sim 600 k): ≥ one 3-line 1 in 2.4 (expected
0.43 three-lines), 4-line 1 in 44, 5-line 1 in 4 400 (12 / C(25,5)). **RTP ≈ 93.5 % for 5 balls**; extra balls are priced at 80 % RTP;
blended ≈ 91 %. Planning soft/hard shots against the scrambled card adds ≈ +1–3 %. Variance **HIGH** (σ ≈ 5).

### 18.3 Cost and hooks
actionCost **2 per game** (extra balls 0; they cost coins). Hooks: `luckBonus` (+2 % nudge success per point, cap +30 %) · `payoutMult` ·
`bingopin.freeSpace` (centre card cell starts lit) · `bingopin.extraBallDiscount` (price × (1 − N)) · `bingopin.lineMult[3|4|5]` ·
`bingopin.tiltGuard` (first TILT per game ignored) · event `bingopin.onLine {n}`.

### 18.4 Controls (pose: camera above the front of the playfield, 0.60 m up, pitch −35°, backglass visible at the top of the frame, FOV 62°)
Hold/release Space plunger · A/D nudge · Space at offer = buy extra ball · C collect · wheel/Z/X stake · H · E.

### 18.5 State machine
READY → COMMIT → [PLUNGE (player) → ROLL (1.8–2.6 s; nudge window last 0.8 s) → SETTLE (0.3 s, backglass number lights)] × 5 → OFFER (≤ 10 s,
auto-collect) → [EXTRA ×≤ 3] → PAYOUT (lines flash one by one 0.4 s) → READY. TILT → 2 s lockout → READY.

### 18.6 Multiplayer — solo-occupant
`bingopin.start {i, r, t, p, stake}` · `bingopin.launch {i, r, ball, power, hole, path:u16}` · `bingopin.nudge {i, r, ball, dir, moved, tilt}` ·
`bingopin.offer {i, r, price}` · `bingopin.end {i, r, lit:u32, lines:[{line, n}], pay}` · `mc.outcome` (bet includes bought extra balls).
The card layout is part of `mc.snap.state`.

### 18.7 Juice
Plunger spring creak (noise bandpass sweeping with pull) and release "thwack"; ball roll = filtered rumble (brown noise lowpass 400 Hz,
gain ∝ speed); bumper hits = electromechanical "clack-ding" (relay click + bell 2.3 kHz). Ball settling into a hole: hollow "tok". Backglass
relays chatter (rapid clicks) when lighting numbers; lines = score-reel clatter + bell per ×. Extra-ball offer: backglass light pulses
amber, a ratchet "price wheel" spins. TILT: loud buzzer + every lamp dies.

### 18.8 Edge cases
Ball launched with < 5 % power rolls back (free relaunch). If every hole is full (impossible within 8 balls) the game ends. Leaving: remaining
balls auto-launch at MEDIUM, no extra balls bought.

---

## 19. Implementation notes (for Sonnet coders / Opus modelers)

### 19.1 Folder contract (per machine) — SUPERSEDED by TECH_SPEC §3 + §11.5/§11.8 and PLAN.md §5

Final: `model.ts` (Opus modeler: `buildModel(kit, opts)` + exported `<Id>Parts` type), `index.ts` (Sonnet coder: `export const def`,
`export default class`, `export const playHeadless`), optional `data.ts` / `rules.ts` / `sfx.ts` (coder-owned). Part names follow
TECH §11.8 and the per-machine brief in PLAN.md; the v1.0 text below is kept for reference.
```
src/machines/<id>/
  model.ts    // export function buildModel(ctx): MachineModel  — procedural geometry, canvas textures, named nodes
  index.ts    // export default defineMachine({ id, tier, nameKey, footprint, pose, build: buildModel, createLogic })
  data.ts     // tables from this doc (weights, paytables) — Haiku-owned, pure data
  sfx.ts      // synth recipes (optional; may live in index.ts)
```
`defineMachine` (in `src/machines/_base`) is auto-registered via `import.meta.glob('./*/index.ts', { eager: true })`.
Named model nodes the logic expects (modelers must provide): `screen` (canvas-texture mesh), `ledCredit`, `ledBet`, `ledWin`,
`interact` (invisible AABB for E), `poseAnchor` (Object3D: camera position + lookAt child), `lightKey`, `lightWin`, plus machine
specifics (`reel0..4`, `lever`, `claw`, `ring`, `tower`, …).

### 19.2 Shared helpers in `src/machines/_base/` (build once, used everywhere)
`MachineBase` (occupancy, pose glide, lifecycle 1.4, net envelope 1.7, idle timeout) · `TableBase` (seats, phases, bots, commit–reveal) ·
`LedWindow` (7-segment canvas) · `CanvasScreen` (pixel font, 2 fps far-LOD) · `VirtualReels` (blurred strip + final-cell swap) ·
`SteeredPath` (lane-graph path generator: pachinko, plinko, bingopin, dice tower) · `Deck` (52-card shuffle/eval incl. wild evaluator) ·
`WeightedTable` (integer weights → draw) · `Dust` (rounding accumulator) · `CountUp` · `LightCard` (additive glow sprite) · `Sfx` kit
(`click`, `thunk`, `chime`, `bell`, `siren`, `fanfare`, `coinTicks`, `ratchet`, `heartbeat`, `noiseBurst`) · `FairCommit` (sha256 via
`crypto.subtle`).

### 19.3 Suggested pit population — SUPERSEDED by GDD §8.6 (instance id = slot id)
bigone ×1 (centre, under the dome) · bandit ×4 · videopoker ×3 (bar) · elevator ×1 (shaft by the east wall) · scratch ×1 · pachislot ×6 (one
row) · pachinko ×6 (one row) · plinko ×1 · coinpusher ×3 (D = 1/5/25) · cyclone ×1 · mines ×2 · dicetower ×1 · lootbox ×1 · claw ×2 ·
stacker ×1 · fruitmachine ×2 · bingopin ×2. Every instance id = `<id>#<slot>`; per-instance seeds/settings persist in the run save.

### 19.4 i18n keys — use `m.<id>.*` and `common.*` (TECH §11.9); the names below map 1:1
`machine.<id>.name`, `machine.<id>.help.<n>`, `machine.<id>.btn.<name>`, `machine.<id>.sym.<SYM>`, `machine.<id>.msg.<code>`,
shared `machine.common.{credit,bet,win,insertCoin,closed,tilt,bigWin,hugeWin,megaWin,jackpot,fair,notFair}`. Diegetic screens render
the active language (TR strings must fit the same canvas widths — Haiku checks length ≤ EN length × 1.3 or provides an abbreviation).

### 19.5 Regression sims (Haiku, `tools/sim/`)
| Sim | Expected | Tolerance |
|-----|----------|-----------|
| bigone lines+clusters, luck 0, 4 M spins | 92.6 %, hit 39.2 % | ± 0.3 % |
| bigone luck 10 | 153 % | ± 1 % |
| bandit exact enumeration | 91.96 % / 92.98 % | exact |
| videopoker optimal (JoB 8/5, Deuces NSUD) | 97.30 % / 99.73 % | ± 0.02 % |
| elevator 10 M rounds × targets {1.5, 2, 10, 100} | 96.0 % | ± 0.3 % |
| scratch tables | 80.5 / 82.0 / 83.4 / 85.3 / 87.8 % | exact |
| pachislot S1/S6 perfect aim | 94.8 / 104.0 % | ± 0.5 % |
| pachinko sweet zone | 92.5 % | ± 1 % |
| plinko L/M/H | 96.4 / 96.7 / 96.4 % | exact |
| cyclone random | 85.1 % | ± 0.5 % |
| mines (any strategy, below cap) | 97.0 % | ± 0.2 % |
| dicetower per spot | table 13.2 | exact |
| lootbox value | 90.4 / 91.6 / 89.2 % | exact |
| fruitmachine compensator 1 M spins | 88.0 % | ± 0.1 % |
| bingopin 5 balls | 93.5 % | ± 0.5 % |
| pachislot reel control: unflagged role aligned | 0 in 10 M | exact |

### 19.6 Open items handed to the GDD / economy designer — RESOLVED in GDD v1.1: (1) actionCost = pulls (GDD §2.4); (2)
`tableLimitMult` = Stake Index × Cap track (GDD §3.2); (3) charms GDD §4.2; (4) scavenge inheritance: allowed in SP, Co-op and
Free Casino, disabled in Versus; (5) pachinko exchange tax 0 %.
1. Mapping of `actionCost` to the run's limiting resource (spins per deadline, clock minutes, or both).
2. `tableLimitMult` progression per deadline (how fast max bets grow).
3. Charm catalogue: which hooks above get charms, values, rarities, prices (reference prices in 14.2 are placeholders).
4. Whether pachinko/pachislot "scavenge" inheritance is allowed in Versus mode (recommended: yes in Free Casino/Co-op, no in Versus).
5. Exchange tax on pachinko balls (currently 0 %).

