# JackID — Table, Draw & Automaton Catalogue (Gambling Systems Design, "tables" family)

Owner: Lead Gambling Systems Designer (tables). Status: v1.1 (Producer-reconciled), ready for modelers (Opus) and coders (Sonnet).

> **v1.1 integration overrides (binding; details in TECH_SPEC §11 and docs/PLAN.md).** Rules, odds, paytables, hooks and juice
> below stay authoritative. Code shape follows TECH_SPEC: shared devices extend `TableBase` (not `defineTable`); "host" = the
> table authority; `mc.*` / `mc.sit` / `mc.phase` … map to the protocol per TECH §11.4 (private data via `sendPrivate`);
> hook names map to `ModHook` per TECH §11.3; the per-instance track named `auto` below is the GDD **`staff`** track; seat
> colours are the players' colours (ART §8.2); i18n keys are `m.<id>.*`. Physical sizes follow ART §5 and PLAN.md §4.2
> (v1.1 class changes: bigsix L, hilo M, tombola L, dicetower L; coinflip booth shrinks to 0.78 × 0.78 × 2.00 to fit S).
> **The Devil's Table now has two modes**: SHELLS (§5A, BRIEF Addendum 7, the main mode) and SIX CHAMBERS (§5, quick variant).
> New cross-device hooks the GDD charms need are listed in §1.6a.
Scope: 22 table / draw / automaton devices: the 19 named in the brief plus 3 additions (`fantan`, `reddog`, `teetotum`).
Slots, pachinko, plinko, pusher, crane, crash, mines, dice tower, scratch cards etc. live in `MACHINES_machines.md`. This
document **reuses that catalogue's shared conventions** (currency, ladder, `MachineOutcome`, tag vocabulary, global hooks,
`mc.*` envelope, juice tiers, RNG) and only adds what tables need: seats, chips, betting phases, hidden information, PvP.

Everything is original JackID IP. Real-world rule sets (roulette, blackjack, hold'em, baccarat, craps, sic bo, keno, etc.)
are public game mechanics adapted for the game. All automaton characters, omen cards, rat names and fiction are ours.
RTP figures marked **(exact)** were computed by enumeration/closed form while writing this document (Node scripts);
**(sim)** = Monte-Carlo (1 M rounds); **(ref)** = standard published value for the stated rules (verify with `simulate()`).

---

## 0. Index

| # | id | EN name | TR name | Tier | MP model | Stake range (coins, base) | actionCost | Base RTP | Variance |
|---|----|---------|---------|------|----------|---------------------------|-----------|----------|----------|
| 1 | `roulette` | Roulette (European) "The Bone Wheel" | Rulet (Avrupa) "Kemik Çark" | 1 | shared-table, 6 seats | inside 1–100 / spot, outside 5–500, table 2,000 | 1 / spin | 97.30 % (98.65 % even-money, la partage) | LOW–HIGH (player-chosen) |
| 2 | `blackjack` | Blackjack "Twenty-One" | Blackjack (Yirmi Bir) | 1 | shared-table, 5 seats | main 5–500, side 1–50 | 1 / round | ≈ 99.7 % basic strategy; counting > 100 % | LOW |
| 3 | `holdem` | Texas Hold'em "The Long Table" | Texas Hold'em Poker "Uzun Masa" | 1 | shared-table PvP, 8 seats, bots | blinds 1/2 · 10/20 · 50/100 | 1 / hand | skill; rake 5 % cap 3 BB | MEDIUM |
| 4 | `devilstable` | The Devil's Table (revolver roulette) | Şeytanın Masası (Rus Ruleti) | 1 | solo-occupant + 2-seat PvP duel | max(20, 10 % wallet) – 50 % wallet | 2 / game | 95.0 % any strategy | MEDIUM–HIGH |
| 5 | `baccarat` | Baccarat (Punto Banco) "The Mirror Table" | Bakara (Punto Banco) "Aynalı Masa" | 2 | shared-table, 7 seats | Player/Banker 10–1,000; Tie/Pairs 1–100 | 1 / coup | 98.94 / 98.76 / 85.64 % | LOW |
| 6 | `craps` | Craps "The Bone Pit" | Craps Zar Masası "Kemik Çukuru" | 2 | shared-table, 8 rail spots, rotating shooter | line 5–500, props 1–100 | 1 / roll with new coins | 83.3–100 % per bet | LOW–HIGH |
| 7 | `sicbo` | Sic Bo & Chuck-a-Luck "The Birdcage" | Zar Kafesi (Sic Bo) | 2 | shared-table, 8 spots | 1–500 by bet type, table 2,000 | 1 / roll | 87.5–97.2 % per bet | LOW–EXTREME |
| 8 | `bigsix` | Big Six Money Wheel "The Six-Score Wheel" | Büyük Altı Para Çarkı | 2 | shared-table, 8 spots | 1–200 / symbol, table 1,000 | 1 / spin | 90.7–96.3 % per symbol | LOW–HIGH |
| 9 | `cardwar` | War Table (Casino War / Dragon-Tiger) | Savaş Masası (Kart Savaşı / Ejder-Kaplan) | 2 | shared-table, 6 seats (War) / 8 spots (DT) | 5–500, side 1–50 | 1 / round | 97.12 % War · 96.27 % DT | LOW (sides MEDIUM) |
| 10 | `hilo` | Hi-Lo Ladder | Yüksek-Alçak Merdiveni | 2 | solo-occupant | 5–200 | 1 / round | 98.5–99.0 % per step | player-chosen |
| 11 | `keno` | Keno Lounge | Keno Salonu | 2 | shared-draw, unlimited tickets | 1–100 / draw | 1 / draw | 93.6–95.4 % (exact) | MEDIUM–EXTREME |
| 12 | `derby` | Mechanical Rat Derby "The Rat Run" | Mekanik Fare Derbisi | 2 | shared-draw, unlimited bettors | 1–200 / bet, 1,000 / race | 1 / race | 90 % win/place · 85 % exotics | MEDIUM–HIGH |
| 13 | `fortuneteller` | Fortune-Teller "Mother Moth" (omen gamble) | Falcı Otomatı "Güve Ana" | 2 | solo-occupant | 10–200 | 1 / reading | 86.4 % coins (exact) + omen buffs | LOW |
| 14 | `coinflip` | Coin-Flip Booth | Yazı-Tura Kabini | 2 | solo-occupant + 2-player duel | 1–500 | 1 / flip (rides free) | 98.0 % call · 96.0 % edge | LOW–HIGH |
| 15 | `threecard` | Three Card Poker | Üç Kart Poker | 3 | shared-table, 6 seats | Ante 5–200, Pair Plus 1–100 | 1 / hand | 96.63 % ante · 92.72 % Pair Plus (ref) | LOW–MEDIUM |
| 16 | `reddog` | Red Dog "The Kennel" (acey-deucey) | Kırmızı Köpek (Arası) "Kulübe" | 3 | shared-draw, 6 seats | 5–200 (+raise) | 1 / hand | 97.20 % optimal (exact) | LOW |
| 17 | `bingo` | Bingo "Hall of Calls" | Tombala Salonu (Bingo) | 3 | shared-draw, 8 players + patrons | 2–50 / card, 1–4 cards | 1 / game | ≈ 93 % (sim) | MEDIUM |
| 18 | `lottoblower` | Lotto Ball Blower "The Breath" | Loto Küresi "Nefes" | 3 | shared-draw, unlimited | 5 / line, 1–20 lines | 1 / draw | 86.0 % fixed + 8 % to jackpot (exact) | EXTREME |
| 19 | `tombola` | Tombola Raffle Drum | Piyango Tamburu | 3 | solo-occupant, shared drum | 10 / ticket | 1 / ticket | 90 % per full drum (exact) | MEDIUM |
| 20 | `shellgame` | Shell-Game Automaton "Monsieur Thimble" | Bardak Oyunu Otomatı "Mösyö Yüksük" | 3 | solo-occupant | 5–20 | 2 / game | skill: 57 % random → 170 % perfect at Heat 0 | LOW |
| 21 | `fantan` | Fan-Tan (addition) | Fan-Tan (Düğme Sayma) | 3 | shared-table, 6 seats | 5–500 | 1 / count | 96.25–98.75 % (exact) | LOW–MEDIUM |
| 22 | `teetotum` | Put-and-Take Top (addition) | Al-Ver Topacı | 3 | shared-table PvP, 6 seats, bots | ante 5 / 20 / 100 | 1 / pot cycle | ≈ 97.4 % (sim; rake) | MEDIUM |

Tier: **1** = hero, first playable · **2** = core, v1.0 · **3** = nice-to-have, stretch (same meaning as the machines catalogue).
Stakes are base values; the economy multiplies all limits by the run-level `tableLimitMult` (GDD) and the per-instance
cap upgrade (§1.13).

---

## 1. Shared conventions (table family)

### 1.1 Numbers, currency, chips
- Currency, bet ladder (`1, 2, 5, 10, 20, 50, 100, 200, 500, 1000`, continuing ×10 per decade for tycoon growth), `×N` /
  `N:1` notation, float-then-floor payouts with the per-player per-instance **dust** accumulator, and variance classes
  (LOW σ < 1.5 · MEDIUM 1.5–4 · HIGH 4–12 · EXTREME > 12, σ per unit stake per round) are **identical to
  MACHINES_machines.md §1.1**.
- Big numbers: wallet values may exceed 2^53 late in a run (tycoon layer). Rules modules work in plain JS numbers; above 1e15
  coins the dust accumulator is skipped (`Math.floor` only). All displays use the shared K/M/B/T/Qa/Qi formatter.
- RTP = E[gross payout] / stake. "Pays 17:1" returns 18 per 1 staked.
- Cards: `int c = rank*4 + suit`, rank 0..12 = 2..A, suit 0 ♣ 1 ♦ 2 ♥ 3 ♠; hidden card = −1. Dice: ints 1–6.
- **Bet spot ids** are strings `"<type>:<args>"`: `straight:17`, `split:17-20`, `pass`, `place:6`, `total:9`, `win:3`,
  `exacta:3-5`. Every device publishes its spot list + per-spot `min/max/pays` in `rules.spots()` (used by UI, sim and H card).
- **Chips** (8-sided cylinder Ø 0.040 × 0.0035 m, 16×16 px texture: body + 6 edge stripes + centre value). The rack shows
  7 denominations `{1, 5, 10, 50, 100, 500, 1000} × 10^k`, where `k = max(0, floor(log10(tableMax)) − 3)`; labels use the
  K/M/B formatter. Stacks > 20 chips auto colour-up (0.25 s merge).

| Chip | Body | Stripes / centre | 
|------|------|------------------|
| 1 | bone `#E8E0C8` | `#2B2B2B` |
| 5 | red `#A8262E` | `#F2E8D0` |
| 10 | blue `#2C4C9C` | `#F2E8D0` |
| 50 | green `#2E7D3B` | `#F2E8D0` |
| 100 | black `#151515` | gold `#C9A227` |
| 500 | violet `#5B2A86` | `#E8C547` |
| 1000 | brass plaque 0.060 × 0.036 × 0.006 m `#D4AF37` | engraved `#3A2A10` |

- **Seat colours** (shared tables; tint the chip rim, seat lamp and rail meter frame so every bet is attributable): **v1.1 —
  a human seat uses that player's colour** (ART §8.2: `#C52129`, `#E69431`, `#FFCE5A`, `#8CA53A`, `#63E6DE`, `#3163C5`, `#FF42A5`,
  `#E6DEC5`); patrons/bots use GROUT `#9C9484`. The v1.0 per-seat palette S1 `#C8102E` · S2 `#F2C14E` · S3 `#2A9D8F` · S4 `#8E44AD`
  · S5 `#E76F51` · S6 `#4A90D9` · S7 `#9BC53D` · S8 `#E8E0C8` is used only in the bench (no profiles).
- **Felt palette**: green `#1F5A3A`, oxblood `#4A0E12`, teal `#1B4D4A`, navy `#1C2A4A`, black `#121212`; printed lines
  `#E8E0C8` at 70 %. UI accents: hover/gold `#FFC83D`, win `#7CFF4F`, loss `#FF3B30`, push `#E8D35A`, pending amber
  `#FFB000`, curse violet `#7A2A9A`, luck brass `#D9A441`.

### 1.2 Common betting UI (diegetic first)
- **Rail meter** (per seat; one per solo device): the machines catalogue's three 7-segment windows CREDIT / BET / WIN
  (`#FF3020` on `#200404`, 64×16 px each) set into the table rail in front of the seat, framed in the seat colour.
  Pending (not yet locked) BET blinks at 1 Hz; locked BET is steady.
- **Hand cursor**: a low-poly viewmodel hand holding the selected chip moves on the device's interaction plane (felt or
  button deck). Hovered spot: 1-texel outline `#FFC83D` + overlay tooltip (VT323): `SPLIT 17/20 · pays 17:1 · max 100 · yours 20`.
- **Chip rack** (overlay, bottom-centre): 7 chips; selected chip raised 4 px; unaffordable chips dimmed `#7A7262`.
- **Limits**: placement above a spot max clamps to the max, the spot flashes `#FF3B30` 0.3 s, dull "tock" (machines §1.2).
  Insufficient coins → CREDIT window `----` ×3 + buzzer (same as machines).
- **Phase lamp** on each table (brass-caged bulb): green = betting open, amber = last 5 s (blinks 2 Hz), red = locked.
- **History boards** (diegetic, per device): last results as lamps/flip digits; readable from the play pose.
- **H card**: rules + live paytable (live values include charm/upgrade modifiers; the engraved table shows base values).
- Overlay never shows information the diegetic UI hides (hole cards of others, shoe order, chambers…).

### 1.3 Common controls (play pose)
Inherit MACHINES_machines.md §1.3 (E to sit, 0.45 s glide, Space primary, wheel/Z/X step, B max, 1–9 device buttons, G autoplay
where allowed, F fast, H help, E stand, Esc pause menu whose first entry is STAND UP, Tab/T). Table additions and overrides:

| Input | Action (all tables unless the device overrides) |
|-------|-----------------------------------------------|
| Mouse move | Hand cursor on the felt; camera parallax ±6° yaw / ±4° pitch follows the cursor. |
| LMB | Place 1 chip of the selected denomination on the hovered spot / press hovered button / grab hovered object. |
| Shift + LMB | Place 5 chips. |
| Ctrl + LMB / B | Place the spot maximum (≤ spot max, ≤ wallet). |
| RMB tap (< 0.2 s) | Remove the top chip from the hovered spot. |
| RMB hold (≥ 0.2 s) | Free-look (±30° yaw, ±20° pitch), as in the machines catalogue. |
| Shift + RMB tap | Clear the hovered spot. |
| Wheel / Z / X | Previous / next chip denomination. |
| Backspace | Clear all pending (unlocked) bets. |
| D | Double every pending bet (if affordable; else as far as possible in spot order). |
| R | Repeat last round's layout **and** commit (solo) / mark Ready (shared). |
| Space | Primary: SPIN / DEAL / ROLL / DRAW / READY (shared tables: Ready = "I'm done betting"). |
| Q | Collect / cash out (ladder devices: hilo, devilstable, coinflip ride). |
| V | Cycle cameras: play pose → device detail cam (wheel, dice, track) → wide spectator cam. Disabled where it would help skill (shellgame shuffle). |
| F | Fast mode ×2 — **solo-occupant devices only**; shared tables run on one host timeline. |
| G | Autoplay = auto-repeat layout each round (roulette, bigsix, sicbo, keno, baccarat, fantan, coinflip without rides). Stops on any `bigwin`, wallet < layout, actions < 1, or input. Never on decision games. |

Standing up during a decision applies the device's **safe default** (Stand / Fold / Check / Collect / Decline). The round still
settles on the host.

### 1.4 Round lifecycle (TableBase) and economy reporting
Tables add a betting phase in front of the machines catalogue's request → validate → commit → present → settle cycle:

`IDLE → OPEN (betting) → LOCK (= commit) → RESOLVE (= present) → SETTLE → OPEN | IDLE`

- **OPEN**: chips are pending; nothing is debited. Shared tables: OPEN lasts the device's betting timer (default 15 s) and ends
  early when every seated human who has ≥ 1 pending chip pressed Ready (Space). The last 5 s tick at 1 Hz (tick sound, amber lamp).
- **LOCK**: host validates every seat's layout, calls `econ.debit(p, total, ctx)` and `run.spendActions(p, actionCost)` per
  seat, then **pre-rolls the outcome** (or uses the already-shuffled shoe). Bell "no more bets" (FM bell, carrier 660 Hz,
  ratio 2.76, index 3→0 over 1.4 s) + dealer gesture, 0.6–0.8 s.
- **RESOLVE**: every client plays the same animation from host payloads.
- **SETTLE**: per seat `econ.settle(outcome)` with the shared `MachineOutcome` (machines §1.4). Extra stakes inside a round
  (double, split, insurance, raise, war, defy, extra balls) are appended with `econ.debit` under the same `round` and summed into
  `bet` — **one outcome per seat per round**.
- Table-specific `MachineOutcome.meta` keys: `seat` (int, −1 for solo devices), `spots` (JSON string of `[spotId, stake, payout][]`),
  `luckMode` (`none|reroll|refund`), plus the device keys listed in each section.
- Hold'em and teetotum buy-ins/cash-outs are wallet transfers (`econ.transfer(p, ±n, 'holdem:buyin')`), not outcomes; every hand
  still emits one outcome (bet = chips committed to the pot, payout = chips won).

**Tags** — machines vocabulary (`win`, `loss`, `push`, `bigwin` ≥ ×10, `hugewin` ≥ ×25, `megawin` ≥ ×50, `jackpot`, `curse`,
`nearmiss`, `bonus`, `feature`, `skill`, `cashout`, `bust`, `charm`, `tilt`, `void`, `dust`, `free`, `<id>:*`) plus the table
family tags: `table` (always) · `pvp` (another human's coins were in the same pot) · `refund` (luck/charm refund happened) ·
`lucky` (a luck reroll fired) · `blackout` (Devil's Table) · `streak:N` (N ≥ 2 consecutive wins on this instance, for bounties
and Heat) · `comeback` (win after ≥ 3 losses) · `insured` · `split` · `double`. `mult` for tier tags is the **round's** gross
multiple (payout / bet).

### 1.5 RNG, hidden information, fairness, luck
- PRNG `sfc32`, seeded per round with `hash32(runSeed, instanceSeed, round, salt)` (machines §1.5). Card devices shuffle with
  Fisher–Yates on the host at shoe start (`salt = 'shoe'`).
- **Outcome-first**: results are fixed at LOCK (or at shoe shuffle) and animations are steered to them.
- **Dice face-remap** (craps, sicbo; shared with `dicetower`): the host picks the faces, the client plays one of 64 pre-baked
  trajectories (recorded at boot by a tiny deterministic rigid-body sim, seeded) and pre-rotates each die mesh so the resting
  up-face equals the result. Payload `{traj:0..63, faces:[…]}`.
- **Hidden information policy**: hole cards, shoe order, burn cards, live chambers, pearl position, bead count and omen deck order
  never leave the host before their reveal. Exceptions are **unicast** to the owning client only (own hole cards, peek charms).
- **Commit–reveal is ON for every shared-table device in this catalogue**: at LOCK (or at shoe shuffle) the host broadcasts
  `mc.fair {i, r, hash: sha256(serverSeed ‖ round)}` and reveals `serverSeed` after SETTLE (end of shoe for card games). Clients
  verify and light the brass "✓ FAIR" lamp on the table rail (red "✗" + chat warning on mismatch).
- **Luck** (global stat, `luckBonus` points, cap 30, matching the GDD definition "L % chance a losing outcome is rerolled once").
  Per device the interpretation is one of:
  - **Reroll mode** — used when exactly one human has stakes on this draw (all solo devices; shared tables in single-player).
    If the drawn outcome gives that player net < 0, with probability `L/100` the host redraws once; the second draw stands.
    Negative L (curses) mirrors it: a net > 0 outcome is redrawn with probability `|L|/100`. For a binary bet with win chance p:
    p' = p + (1 − p)·(L/100)·p. Tag `lucky`.
  - **Refund mode** — ≥ 2 humans have stakes on the same draw: no redraw. A losing seat with L > 0 gets 50 % of its lost stake
    back with probability L/100 ("lucky bounce", tag `refund`); a winning seat with L < 0 loses 25 % of its net win with
    probability |L|/100 ("cursed skim", tag `curse`).
  - **Fate draws** — decision games list exactly which draws may be rerolled (blackjack bust cards, hi-lo next card, …).
  - A fired reroll is never shown as a redraw (exception: the Devil's Table misfire). The HUD shows a 0.4 s brass horseshoe
    glint `#D9A441` and a soft "ting" (sine 2.6 kHz, 0.3 s).

### 1.6 Charm hooks
Global hooks from machines §1.6 apply unchanged: `payoutMult` (gross, winning rounds), `luckBonus`, `betRefundOnLoss`,
`actionCostDelta`, `freePlayChance`, `jackpotChance`, `nearMissRefund`, events `onCommit`, `onOutcome`, `onTag:<tag>`.
Device hooks are named `<id>.<hook>`. **Table-family hooks** (`table.*`) are honoured by every device in this catalogue:

| Hook | Type | Meaning |
|------|------|---------|
| `table.limitMult` | float × | Multiplies all spot/table maxima on this instance. |
| `table.freeChip` | coins | House-funded chip placed on the player's first spot each round (not debited; on a win only the net is paid). |
| `table.rakeDelta` | float (pp) | Added to commission / rake / "less 5 %" rates (negative = cheaper). Floor 0. |
| `table.peekCharges` | int | Generic peek charges per round; each device defines what one charge reveals (listed per device). |
| `table.timerMult` | float × | Multiplies this player's decision timers (shared tables). |
| `table.pushToWin` | 0–1 | Chance that a `push` result pays 1:1 instead (cards devices). |

Hook evaluation order per round: `table.freeChip → table.limitMult → [draw + luck + device hooks] → payoutMult →
betRefundOnLoss / nearMissRefund → onOutcome`.

### 1.6a Cross-device hooks required by GDD charms (v1.1)

| Hook (`ModHook`) | Implemented by | Meaning |
|---|---|---|
| `table.shoeInfo` (`x.table.shoeInfo`, bool) | blackjack, baccarat, cardwar, reddog | Charm *Counting Bead*: a brass bead counter on the owner's rail shows the Hi-Lo running count and true count of the current shoe (owner-only UI; values computed from public cards). |
| `wheel.nudge` (`x.wheel.nudge`, bool) | roulette, bigsix, cyclone | Charm *Golden Ratchet*: after the result, a 3 s prompt `[N] NUDGE` lets the owner pay 25 % of their round stake to move the result **one position clockwise** (roulette: next pocket in wheel order; bigsix: next segment; cyclone: next lamp). Once per round. On shared tables the nudge applies to the owner's bets only (ghost dolly / ghost flapper shown to them, the shared result is unchanged for others). Tag `charm`. |
| `coinflip.reflip` (charges) | coinflip | Charm *Hollow Dice*: after a losing flip, re-flip once; a winning re-flip pays ×0.8 of its normal payout (M). |

### 1.7 Networking (adds to machines §1.7)
Common events `mc.occupy / mc.release / mc.req / mc.reject / mc.bet / mc.outcome / mc.snap` are reused. Table additions:

| Event | Dir | Payload | Notes |
|-------|-----|---------|-------|
| `mc.sit` | c→h, h→all | `{i, p, seat}` | Seat request / grant. Patrons (bots) use `p = 'bot:<name>'`. |
| `mc.unsit` | h→all | `{i, p, seat, reason:'stand'\|'disconnect'\|'idle'\|'broke'}` | Idle = 2 rounds without bets (shared). |
| `mc.phase` | h→all | `{i, r, t, phase, dur}` | Every state change of the device machine; `dur` ms (0 = open-ended). |
| `mc.bet` | h→all | `{i, p, bet, opts:{seat, spots:[[spotId, amount]]}}` | Pending chips preview, ≤ 8 Hz per seat. |
| `mc.ready` | c→h, h→all | `{i, seat}` | Ends OPEN early when all betting humans are ready. |
| `mc.lock` | h→all | `{i, r, seat, total}` | Escrow confirmed per seat. |
| `mc.fair` / `mc.fairReveal` | h→all | `{i, r, hash}` / `{i, r, seed}` | Commit–reveal (§1.5). |

Device events are `<id>.<event>` and always carry `{i, r, t}` (instance, round, host ms); the tables below list only the extra
fields. Reject codes add `BAD_PHASE`, `OVER_LIMIT`, `SEAT_TAKEN`, `NOT_SEATED`, `NOT_YOUR_TURN`.
- **solo-occupant**: one player owns the device; watchers replay the same events. Clients with RTT > 150 ms play a 0.25 s
  wind-up on intent (lever, thumb, hand) to hide latency.
- **shared-table**: host runs one timeline for all seats; seats hold humans or **patrons** (mannequin bots, "players who lost",
  per the story addendum). In single-player, patrons are cosmetic unless the game needs opponents (`holdem`, `teetotum`).
- **shared-draw**: no seats; any number of players hold tickets/bets on one host-scheduled draw.
- Animation sync: visual starts are scheduled at `t = now + 150 ms`. Watchers > 12 m get only `mc.phase` + `mc.outcome`.
- Disconnect: the host keeps escrowed bets in play, applies safe defaults, settles to the host-side wallet, frees the seat after
  the round. Host loss ends the session; unresolved escrows are refunded in the post-session summary.

### 1.8 Juice (adds to machines §1.8)
Win tiers, count-up, light budget (≤ 2 real PointLights per device), camera-shake rule (≥ `hugewin` only) and the audio chain are
inherited. Table-specific shared recipes in `src/machines/_base/tableJuice.ts`:
- *chip click*: sine 3.2 kHz 8 ms + highpassed noise 6 ms, ±10 % pitch random; *chip stack slide*: pink noise 80 ms, lowpass 1.2 kHz;
  *chip cascade* (payout): 6–20 clicks at 25 ms spacing, pitch rising 2 semitones overall.
- *card fwip*: white noise 40 ms, highpass 2 kHz, gain envelope 0→1→0 in 10/30 ms; *card flip*: noise 15 ms + sine 300 Hz 20 ms thump.
- *dealer automaton servo*: saw 140→180 Hz, lowpass 900 Hz, 0.3 s; *dealer voice*: 2-formant vowel synth (F1/F2 bandpass on a
  110 Hz pulse), pitched −5 semitones, 1–3 syllables; numbers are spoken as tones, not words (i18n-safe).
- *no-more-bets bell* (see §1.4); *timer tick* square 1.2 kHz 12 ms.
- *Patron reactions*: on a W3+ at a shared table, patron mannequins turn their heads toward the winner (0.6 s, with a dry
  servo creak) — the light-horror beat for every big win.

### 1.9 Anti-exploit baseline (adds to machines §1.9)
1. No bet edits after LOCK; spot validation per intent (phase, spot exists, min/max, wallet, seat owner).
2. Hidden information never leaves the host (§1.5); bots never read hidden information (enforced by giving the bot module only
   its seat view object).
3. Decision timers are host-side; client timers are cosmetic.
4. Rebet/double never exceed wallet: the host trims from the last spot backwards and sends the trimmed layout in `mc.bet`.
5. One seat per player per device; one shared-table device per player at a time (sitting elsewhere first `mc.unsit`s).
6. Save-scum guard (single-player): run saved at every LOCK and SETTLE with the RNG cursor and shoe state.
7. Every rules module exports `simulate(n, strategy)`; CI regression: measured RTP within ±0.3 pp of this document after
   10^7 rounds (10^6 for holdem, bingo, derby).
8. Per-round payout cap = 1,000 × table max (guards against hook-stacking bugs; excess logged, not paid).

### 1.10 Tycoon tracks, staff and ownership (ADDENDUM 1 mapping)
Every table instance exposes the brief's generic per-machine upgrade tracks; the GDD owns cost curves, this catalogue owns what
each level does on a table:

| Track | Effect on a table instance |
|-------|----------------------------|
| `payout` | +`payoutMult` on this instance (GDD curve). |
| `luck` | +`luckBonus` points on this instance only. |
| `speed` | All RESOLVE/SETTLE durations ×0.97 per level, floor ×0.40; shared-table betting timers shrink the same way (floor 6 s). |
| `cap` | `table.limitMult` +X per level (GDD curve); chip rack auto-rescales (§1.1). |
| `seats` | Extra "boxes": the player may occupy 2/3 betting positions (blackjack boxes, baccarat second seat, derby second ticket …). |
| `staff` (v1.0 name `auto`) | Unlocks staff: a **mannequin gambler** auto-plays with the device's stated safe strategy, or a **mannequin dealer** opens the table to patrons (below). |
| milestones | Levels 10 / 25 / 50 / 100 unlock the device features listed in each section ("Milestones"). |

**Ownership / house side** (when a player owns a table in the tycoon layer): patrons play it at the device's
`patronRate` (rounds/min at ×1 speed) with an average stake of `patronStake` × table max; the owner earns the patrons' house
edge as idle income: `income/min = patronRate × patronStake × tableMax × houseEdge × (1 + ownerBonus)`. Each device lists
`patronRate · patronStake · houseEdge` in its **Idle profile** line. PvP devices (holdem, teetotum) earn rake instead.

### 1.11 Buffs, Heat and global events (ADDENDUM 3 mapping)
- **Heat** (per player per instance, 0–100): +15 per win, +30 per `bigwin`, −20 per loss, decays 5/min idle. Heat ≥ 60 lights the
  table's phase lamp gold and grants the buff system's `hot:<id>` status; ≥ 100 = **Overheat** for 3 rounds (device effect listed
  per section, default: `payoutMult +10 %`, `luckBonus −5`). Tags `streak:N` feed bounties.
- **Global events** reach tables through hooks only: *Happy Hour* → `payoutMult`; *Blackout* → device lamps off except rail meters
  and the phase lamp (games stay playable; dealer automata keep working in the dark — their eyes glow `#FF2A2A`); *Full Moon* →
  `luckBonus`; *Audit* → `table.limitMult 0.5` and commission/rake +1 pp. Device-specific reactions are listed where interesting.
- Omen/blessing/curse effects from `fortuneteller` and `devilstable` are emitted as buff ids `buff.<name>` (stack/duration owned by
  the buff system).

### 1.12 Module shape (for coders) — SUPERSEDED by TECH_SPEC §3.4 `TableBase` + §11.5; the fields below map to `def` / class members
```ts
// src/machines/<id>/index.ts  (auto-registered via import.meta.glob)
export default defineTable({
  id: 'roulette', tier: 1, mp: 'shared-table', seats: 6, actionCost: 1,
  model: () => import('./model'),              // procedural three.js model (model.ts)
  rules,                                       // pure: init / spots / legal / apply / settle / simulate
  hooks: ['roulette.pocketWeight', /* … */],   // device hook names from this document
  events: ['roulette.spin', /* … */],
  poses: { play: { pos:[0,1.18,0.62], look:[0,0.78,0], fov:58 }, detail: { … } },
  safeDefault: 'none',                          // or 'stand' | 'fold' | 'collect' …
  idle: { patronRate: 3.5, patronStake: 0.08, houseEdge: 0.027 },
});
```
Pose numbers in sections are **relative to the device origin** (floor centre of the footprint, +Z toward the player seat).

---

## 2. Roulette (European) — `roulette` · TR "Rulet (Avrupa)" · Tier 1 (HERO)

### 2.1 Fantasy, body, pose
"The Bone Wheel": a single-zero wheel of black lacquer with bone-white frets, run by **the Rake**, a brass croupier arm on a rail
(no head, one long hand with a dolly and a rake). Table 2.60 × 1.30 m (v1.1, ART §5.5; v1.0 said 2.80 × 1.40), felt height 0.78 m, green felt `#1F5A3A`; wheel bowl
Ø 0.80 m at the −X end (rim 0.86 m high), 8 diamond deflectors, 37 pockets. Pocket colours: red `#9E1B22`, black `#141414`,
zero `#1E6B3A`; pocket numbers on a 256×32 px ring texture. Layout grid (12 × 3 + 0) at +X, racetrack strip along the far edge.
6 seats along +Z (stools, rail meter each). 37-bulb rim ring `#FFB347` on the wheel. History pillar (12 flip-digit tiles) at the
wheel end.
- Play pose (seat 3): camera (0.20, 1.22, 0.95), look (0.30, 0.78, 0.00), FOV 58°. Detail cam (V): (−1.00, 1.60, 0.25) looking
  straight down at the wheel, FOV 50°.
- **Decision**: where to spread risk — safe even-money grind (LOW) vs straight-up shots (HIGH) vs racetrack sectors; whether to
  chase the "hot" numbers the history pillar shows (pure superstition — the wheel is fair, charms are not).

### 2.2 Rules
1. OPEN: players place chips on the layout or racetrack (solo: unlimited time; shared: 20 s).
2. LOCK: the Rake raises its hand, bell "no more bets". Host draws the pocket.
3. The wheel spins counter-clockwise; the ball is launched clockwise on the track, decays, drops, hits deflectors, settles.
4. The Rake places the glass dolly on the winning number, rakes losing chips, pays winners next to their bets.
5. **La partage** (house rule, always on): if 0 wins, every even-money bet returns half its stake.

### 2.3 Bets and payouts
| Bet | Spot id | Numbers | Pays | P(win) | RTP (exact) |
|-----|---------|--------:|-----:|-------:|----:|
| Straight | `straight:n` | 1 | 35:1 | 1/37 | 97.30 % |
| Split | `split:a-b` | 2 | 17:1 | 2/37 | 97.30 % |
| Street | `street:r` (r = 1..12) | 3 | 11:1 | 3/37 | 97.30 % |
| Trio | `trio:0-1-2`, `trio:0-2-3` | 3 | 11:1 | 3/37 | 97.30 % |
| Corner | `corner:a` (top-left number) | 4 | 8:1 | 4/37 | 97.30 % |
| First Four | `first4` (0-1-2-3) | 4 | 8:1 | 4/37 | 97.30 % |
| Six Line | `line:r` (r = 1..11) | 6 | 5:1 | 6/37 | 97.30 % |
| Column | `col:1..3` | 12 | 2:1 | 12/37 | 97.30 % |
| Dozen | `doz:1..3` | 12 | 2:1 | 12/37 | 97.30 % |
| Red / Black / Odd / Even / 1–18 / 19–36 | `red` `black` `odd` `even` `low` `high` | 18 | 1:1, half back on 0 | 18/37 | 98.65 % |

**Racetrack call bets** (macros that place several chips of the selected denomination; each chip is an ordinary bet above):

| Call | TR | Chips | Placement |
|------|----|------:|-----------|
| Neighbours of Zero | Sıfır Komşuları | 9 | trio 0-2-3 ×2, splits 4/7, 12/15, 18/21, 19/22, 32/35, corner 25-26-28-29 ×2 |
| Third of the Wheel | Çarkın Üçte Biri | 6 | splits 5/8, 10/11, 13/16, 23/24, 27/30, 33/36 |
| The Orphans | Yetimler | 5 | straight 1, splits 6/9, 14/17, 17/20, 31/34 |
| Zero Game | Sıfır Oyunu | 4 | splits 0/3, 12/15, 32/35, straight 26 |
| Neighbours n±k | Komşular | 2k+1 | straight on n and k wheel-neighbours each side, k = 1..3 |

Wheel order (clockwise from 0): `0 32 15 19 4 21 2 25 17 34 6 27 13 36 11 30 8 23 10 5 24 16 33 1 20 14 31 9 22 18 29 7 28 12 35 3 26`.

### 2.4 RNG, RTP, variance
- Pocket = weighted draw over 37 integer weights (base 100 each; hooks add). Drawn at LOCK.
- Luck: shared table with ≥ 2 humans → refund mode; otherwise reroll mode on the whole layout's net.
- σ per unit: straight 5.84 (HIGH), dozen 1.39, even-money 0.99 (LOW). The table is LOW–HIGH by player choice.
- **Near miss**: the ball settles in a wheel neighbour (±1 pocket) of a pocket you hold a straight-up on, and you lost the
  straight → tag `nearmiss` (feeds `nearMissRefund`).

### 2.5 Charm hooks (`roulette.*` + globals + `table.*`)
`roulette.pocketWeight[n]` (int add, base 100) · `roulette.colorWeight[red|black]` (int add to all 18 pockets) ·
`roulette.zeroShield` (bool: every bet loses only half on 0) · `roulette.straightPayAdd` (int: 35:1 → (35+k):1) ·
`roulette.neighbourPay` (bool: a straight-up also pays 1:1 when the ball lands ±1 pocket on the wheel) · `roulette.extraBall`
(charges: next spin launches 2 balls; pockets drawn independently; every bet settles once per ball, stake debited once) ·
`roulette.ghostChip` (int coins: a free straight-up of this size on a random number each spin) · `roulette.goldenPocketPay`
(int add to the Golden Pocket payout, milestone L25). `table.peekCharges`: one charge shows, during OPEN, which **dozen** the host
has pre-rolled for this spin (the pocket is pre-rolled at OPEN start when a peek is held; bets still lock normally).

### 2.6 Cost
Inside bets 1–100 per spot, outside 5–500 per spot, table max 2,000 per player per spin (× `tableLimitMult` × cap track).
actionCost **1 per spin** (charged at LOCK only if the player has ≥ 1 chip down). Autoplay (G) allowed.

### 2.7 Controls
Common table controls (§1.3) plus: **1** toggle racetrack panel (camera tilts 8° to the far edge) · **2 / 3 / 4 / 5** place Neighbours
of Zero / Third / Orphans / Zero Game at the selected chip · **N** cycle neighbour width k = 1→2→3 (LMB on a racetrack number places
n±k) · **Space** spin (solo) / Ready (shared) · **V** wheel cam · **G** autoplay.

### 2.8 State machine (host timeline, ×1 speed)
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| IDLE | no seated players | ∞ | wheel drifts 4°/s, bulbs chase 3 Hz; `mc.sit` → OPEN |
| OPEN | betting | solo ∞ / shared 20 s (early on all-Ready) | → LOCK (needs ≥ 1 chip; shared timer with no chips restarts OPEN) |
| LOCK | bell, Rake hand up, pocket drawn | 0.8 s | → LAUNCH |
| LAUNCH | wheel to 1.2 rev/s, ball released at 3.0 rev/s | 0.6 s | → ORBIT |
| ORBIT | ball decays ω(t)=ω₀e^(−0.18t); rim bulbs chase the ball | 5.5–7.5 s (seeded) | → DROP |
| DROP | ball leaves track, 2–5 deflector/pocket bounces | 1.2–2.4 s | → SETTLE |
| SETTLE | ball rides pocket, wheel decelerates | 0.6 s | → ANNOUNCE |
| ANNOUNCE | number tone, pillar flips, dolly placed | 1.5 s | → PAYOUT |
| PAYOUT | per winning spot 0.08 s chip push (max 2.5 s), count-up | 0.4–2.5 s | → CLEAR (or tier sequence) |
| CLEAR | Rake sweeps losers, dolly lifted | 0.8 s | → OPEN |

Typical round 13–17 s (solo with F: ×0.5 on LAUNCH…SETTLE).
**Ball path solving**: host sends pocket + seeded parameters; client integrates the ball angle analytically and picks the wheel
phase θ₀ so that the target pocket is under the ball at SETTLE; bounce offsets (±1..±6 pockets, converging to 0) are pre-rolled.

### 2.9 UI
Diegetic: chips on felt, rim ring, dolly, history pillar (last 12: digit tile coloured by pocket colour), "hot/cold" brass board
(milestone L10), Golden Pocket lamp (L25), rail meters, phase lamp, ✓ FAIR lamp. Overlay: chip rack, tooltip with pays/max/yours,
racetrack hint labels, count-up.

### 2.10 Multiplayer — shared-table, 6 seats
Per-seat state: `{p, spots: Map<spotId, amount>, ready, lastLayout, heat}`. OPEN 20 s, early close on all-Ready. Patrons (cosmetic
in SP) bet 1–3 random outside chips. One draw for all → refund-mode luck when ≥ 2 humans have chips down.

| Event | Extra payload |
|-------|---------------|
| `roulette.spin` | `{pocket, orbitMs, dropMs, wheelPhase, ballPhase, bounces:int8[], extra?:{pocket, orbitMs, dropMs, bounces}}` |
| `roulette.result` | `{pocket, color:'r'\|'b'\|'g', seats:[{seat, payout, net}]}` |
| `roulette.golden` | `{pocket, pays}` (at OPEN start, milestone L25) |
| `roulette.peek` | `{dozen}` (unicast to the charm owner) |

Late join `mc.snap.state = {history:int8[100], phase, spots per seat, golden}`.

### 2.11 Juice
- **Sound**: ball roll = looping noise through bandpass (Q 6) whose centre glides 3.0 → 1.6 kHz as ω falls, AM at the ball's rev
  rate; deflector hit = square 1.2 kHz 12 ms ±15 % pitch; pocket clatter = 4–7 decaying clicks over 0.5 s; wheel bearing hum = sine
  48 Hz at −30 dB. ANNOUNCE tone: red = A4, black = E4, zero = C5+E5+G5 chord (triangle).
- **Animation**: the Rake's arm lifts (0.4 s) at LOCK, sweeps a 1.2 m arc at CLEAR; dolly drop with a 2-frame bounce; winning
  chips are pushed in a stack next to the bet.
- **Light**: rim bulbs chase the ball; at SETTLE the winning pocket's bulb blinks 6 Hz in its colour; **zero**: every table lamp in
  the room flickers green `#1E6B3A` for 0.5 s (the House winks).
- **Big win**: straight-up hit ≥ 20 coins → the Rake raps the wheel rim 3× (wood knocks) and all 37 bulbs strobe gold `#FFD040`
  for the tier duration; patrons turn their heads (§1.8).

### 2.12 Edge cases & anti-exploit
- Chips placed after LOCK bounce back (`BAD_PHASE`). Racetrack macros are expanded by the host (client sends the macro id); chips
  that would exceed a limit are dropped from the end of the macro.
- `extraBall` with refund-mode luck: luck applies per ball. Two balls in the same pocket = both settle.
- The pocket travels in `roulette.spin`; safe because bets are locked. A **peek** pre-roll stays host-side; only the dozen is unicast.
- The ball can never "jump the wheel" (no void spins).

### 2.13 Tycoon
Milestones: **L10** hot/cold board (last 100 spins) · **L25** Golden Pocket: one random pocket per spin, straight-ups on it pay 40:1
(RTP 110.8 % on that one spot, max 100 per spin) · **L50** every 10th spin launches a free second ball · **L100** zero pays even-money
bets as a push and straight-up 0 pays 70:1. Staff gambler: repeats a fixed outside layout (red + dozen 2). Idle profile:
`patronRate 3.5 · patronStake 0.08 · houseEdge 0.027`. Overheat: rim bulbs turn red, `payoutMult +10 %`, `luckBonus −5`.

---

## 3. Blackjack — `blackjack` · TR "Blackjack (Yirmi Bir)" · Tier 1 (HERO)

### 3.1 Fantasy, body, pose
A coffin-shaped half-moon table (2.20 × 1.10 m, felt height 0.78 m, black felt `#121212` with gold print `#C9A227`), five betting
boxes, dealt by **the Undertaker's Hands**: two jointed porcelain hands on brass rods rising from a shoe-box, no body. A 2-deck
wooden shoe at dealer-left with a visible red cut card, a glass discard tray at dealer-right (cards stack visibly — counting is a
feature). Each box: main circle Ø 0.11 m, Twin Souls circle Ø 0.06 m, 5 brass push-buttons on the rail (HIT/STAND/DBL/SPLIT/SURR).
- Play pose (box 3): camera (0.00, 1.20, 0.80), look (0.00, 0.78, −0.10), FOV 60°. Detail cam: over the dealer's hands.
- **Decision**: every hand — hit/stand/double/split/surrender/insurance; across the shoe — bet sizing vs the count while the
  mannequin pit boss watches.

### 3.2 Rules (JackID house rules)
1. 2 decks (104 cards); cut card at 65 % penetration (68 cards dealt) → reshuffle after that round; if fewer than 20 cards remain
   at round start, reshuffle first.
2. OPEN: main bet (and optional Twin Souls) per box. A player holds 1 box (2–3 with the `seats` track).
3. Deal order: box 1→5 face up, dealer up-card, box 1→5 second card, dealer hole card face down.
4. Dealer up-card Ace → INSURANCE offered (≤ half the main bet, pays 2:1); a player blackjack may take **Even money** (1:1 now).
5. Dealer up-card Ace or ten-value → dealer **peeks**; dealer blackjack ends the round (insurance pays; player blackjacks push).
6. Player turns in box order: **Hit**; **Stand**; **Double** (any first two cards, exactly one more card); **Split** (equal rank or any
   two ten-values; up to 3 splits = 4 hands; split Aces get one card each, no re-split of Aces, A+10 after a split = 21 not blackjack;
   double after split allowed); **Surrender** (late, first two cards only, half back).
7. Dealer reveals and draws to 17; **stands on all 17s (S17)**.
8. Higher total ≤ 21 wins 1:1; blackjack pays 3:2; ties push; a player bust loses even if the dealer busts later.

### 3.3 Bets and payouts
| Bet | Pays | Probability / note | RTP |
|-----|-----:|----------|----:|
| Main | 1:1 · blackjack 3:2 | — | ≈ 99.7 % basic strategy (ref, 2 decks S17 DAS LS; verify by sim) |
| Insurance | 2:1 | P(dealer BJ \| Ace up) = 32/103 off the top | 93.20 % (exact, off the top) |
| Even money | 1:1 on a player BJ vs Ace | equivalent to insurance | — |
| Twin Souls — mixed pair (same rank, other colour) | 8:1 | 4/103 | |
| Twin Souls — coloured pair (same colour, other suit) | 15:1 | 2/103 | |
| Twin Souls — perfect pair (same rank and suit) | 30:1 | 1/103 | **96.12 % total (exact)** |

Counting: with the Hi-Lo count, true count ≥ +2 gives the player ≈ +0.5–1.0 % edge (ref). Intended skill expression.

### 3.4 RNG, RTP, variance
- Shoe shuffled at shoe start (Fisher–Yates, `salt='shoe'`); commit hash of the full order broadcast at shuffle, revealed at shoe end.
- **Fate draws** (luck): (a) a Hit/Double card that would bust the player → with probability L/100 the card is quietly returned to a
  random position in the remaining shoe and the next card is dealt (tag `lucky`); (b) dealer blackjack at peek while you have no
  blackjack → same, **only if you are the only human with a bet this round** (otherwise refund mode on the round result).
- σ ≈ 1.15 per hand (LOW).

### 3.5 Charm hooks (`blackjack.*`)
`blackjack.peekNext` (charges: next shoe card shown as a translucent ghost card for 2 s) · `blackjack.bjPayAdd` (float: 1.5 → 1.5+x;
0.5 = 2:1) · `blackjack.fiveCardCharlie` (bool: 5 cards ≤ 21 win 1:1 at once) · `blackjack.dealerBustBonus` (float: extra net
multiplier on wins where the dealer busts) · `blackjack.bustShield` (charges: one bust per round becomes "stand on the previous
total") · `blackjack.doubleAny` (bool: double on 3+ cards) · `blackjack.splitMaxAdd` (int) · `blackjack.earlySurrender` (bool:
surrender before the peek) · `blackjack.twinPayAdd` (int added to all Twin Souls pays) · `blackjack.insuranceFree` (bool: insurance
costs nothing and pays 1:1 of half the main bet) · `table.peekCharges` = reveal the dealer hole card to the owner (unicast) ·
`table.pushToWin`.

### 3.6 Cost
Main 5–500, Twin Souls 1–50, insurance ≤ ½ main. actionCost **1 per round** (splits/doubles/extra boxes add none). No autoplay.

### 3.7 Controls
**1** Hit · **2** Stand · **3** Double · **4** Split · **5** Surrender · **6** take Insurance / Even money · **7** decline · **Space** Deal
(solo) / Ready (shared) · LMB on rail buttons does the same · hold **RMB** over your cards = lift the corners (cosmetic squeeze, replaces
free-look here) · **H** rules card (the charm/milestone "Cheat Card" highlights the basic-strategy button in gold).

### 3.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| IDLE | no players | ∞ | hands tap the shoe idly |
| OPEN | betting | solo ∞ / shared 15 s | → DEAL |
| DEAL | 2·(boxes+1) cards, 0.35 s each | 2.1–4.2 s | Ace up → INSURANCE; ten up → PEEK; else → TURNS |
| INSURANCE | offer | solo ∞ / shared 8 s (default decline) | → PEEK |
| PEEK | hand tilts the hole card | 1.0 s | dealer BJ → DEALER (reveal only); else → TURNS |
| TURNS | per box, per hand | solo ∞ / shared 15 s per decision (default Stand) | → DEALER |
| DEALER | hole flip 0.6 s, each draw 0.7 s | 0.6–3.5 s | → SETTLE |
| SETTLE | per hand 0.3 s chip movement + count-up | 0.3–2.5 s | cut card passed → SHUFFLE; else → OPEN |
| SHUFFLE | riffle ×3, new commit hash | 3.5 s | → OPEN |

### 3.9 UI
Diegetic: cards (32×48 px faces, 8 px corner index), chips, rail buttons lit only when legal (dim `#3A3A3A` otherwise), each hand's
total on a brass flip-tile (soft totals as "7/17"), the shoe's remaining stack, discard tray, insurance line, rail meters.
Overlay: legal-action key hints, insurance prompt, count-up.

### 3.10 Multiplayer — shared-table, 5 boxes
Per-seat: `{p, boxes:[{main, twin, insurance, hands:[{cards:int8[], bet, doubled, fromSplitAces, done, result}], active}], heat}`.
Patrons fill empty boxes in SP (play basic strategy; they only change card order).

| Event | Extra payload |
|-------|---------------|
| `blackjack.deal` | `{to:'box'\|'dealer', box, hand, card}` (dealer hole card sent as −1) |
| `blackjack.insurance` | `{open:bool, timeoutMs}` / `{box, amount}` |
| `blackjack.peek` | `{dealerBJ:bool}` |
| `blackjack.turn` | `{box, hand, timeoutMs, legal:string[]}` |
| `blackjack.act` | `{box, hand, action:'hit'\|'stand'\|'double'\|'split'\|'surrender'}` (host echo of the intent) |
| `blackjack.card` | `{box, hand, card}` |
| `blackjack.split` | `{box, from, newHand, cards:[int,int]}` |
| `blackjack.reveal` / `blackjack.dealerDraw` | `{card}` |
| `blackjack.settle` | `{box, hands:[{bet, payout, result:'win'\|'bj'\|'push'\|'loss'\|'bust'\|'surr'}]}` |
| `blackjack.shuffle` | `{penetration:0.65}` (+ `mc.fair`) |
| `blackjack.ghost` / `blackjack.hole` | `{card}` unicast (`peekNext` / `table.peekCharges`) |

### 3.11 Juice
- **Sound**: card fwip per deal; flip snap; chip clicks; porcelain-hand servo; blackjack = two-note brass stab (square Bb3+F4, 0.25 s)
  and the felt's embroidered sigil glows gold 1.5 s; bust = cards shake (3 px, 20 Hz, 0.2 s), darken to `#3A3A3A`, low "dunk"
  (sine 90 → 60 Hz); dealer bust = the porcelain hands drop limp onto the felt (0.3 s) and slowly rise again (1.2 s).
- **Light**: one green-shaded pendant; when 4+ hands win in one round the pendant swings 8°.
- **Big win**: split-and-double sweeps (≥ ×10) and perfect pairs trigger the shared tiers; the pit-boss mannequin claps twice (wood clacks).

### 3.12 Edge cases & anti-exploit
- Double/split buttons disabled when unaffordable. Leaving or disconnecting = Stand on all remaining hands.
- **Pit boss** (real-world counter-measure): if within one shoe the player's max bet ≥ 12 × their min bet **and** shoe profit ≥ 20 × table
  min, each later round in that shoe has a 50 % chance of an early reshuffle (H card: "The House prefers a fresh deck."). A spread ≤ 1:12
  is never punished.
- Hole card and shoe order never leave the host (except unicast peeks). Patrons get only their own cards.
- Split Aces + ten = 21 (not blackjack); Five-Card Charlie (if active) is checked before the dealer turn.

### 3.13 Tycoon
Milestones: **L10** shoe gauge (brass dial: decks remaining) · **L25** Five-Card Charlie on this table · **L50** suited blackjack pays 2:1 ·
**L100** the Undertaker's Hands tap the felt when the hole card is ten-valued (70 % reliable tell). Staff gambler: basic strategy, flat
bet. Idle profile: `patronRate 1.4 · patronStake 0.06 · houseEdge 0.020` (patrons play sloppily). Overheat: the hands tremble;
`blackjack.bjPayAdd +0.25` for 3 rounds.

---

## 4. Texas Hold'em — `holdem` · TR "Texas Hold'em Poker" · Tier 1 (HERO, multiplayer showcase)

### 4.1 Fantasy, body, pose
"The Long Table": an oval table 3.00 × 1.60 m, navy felt `#1C2A4A`, 8 seats; a tall faceless dealer mannequin in a waistcoat at the
head. Pendant lamp with a cone of warm light `#FFB347`; the room beyond is darker. Pot ring Ø 0.40 m in brass. Bots are **patrons**:
dressed mannequins that turn their heads toward the acting seat.
- Play pose (any seat): camera 0.55 m above the felt at the seat edge, looking at the table centre, FOV 62°. Detail cam: top-down board.
- **Decision**: classic poker — fold/call/raise sizing against personalities and humans; when to sit, top up or cash out.

### 4.2 Rules
No-Limit Texas Hold'em, 2–8 players, standard ranks (royal flush > straight flush > quads > full house > flush > straight > trips >
two pair > pair > high card; A plays high or low in straights; suits never rank).
1. **Tables**: Low 1/2 (buy-in 80–200), Mid 10/20 (800–2,000), High 50/100 (4,000–10,000) — buy-in 40–100 BB; top up to 100 BB between
   hands. Heads-up: the button posts the small blind.
2. Hand: blinds → 2 hole cards each → preflop betting (left of BB first) → burn + flop (3) → betting → burn + turn → betting → burn +
   river → betting → showdown (last aggressor shows first; others may muck).
3. Min raise = last raise size; an all-in for less creates side pots; the odd chip goes to the first winner left of the button.
4. **Rake**: 5 % of each pot that sees a flop, cap 3 BB ("no flop, no drop").
5. **The Ledger** (bad-beat jackpot): 20 % of each rake feeds a pit-wide pool (seed 100 BB of the High table). Paid when quads or
   better loses at showdown with both hole cards playing: 50 % loser, 25 % winner, 25 % split among the others dealt in.

Reference 7-card frequencies (juice thresholds): royal 0.0032 %, straight flush 0.0279 %, quads 0.168 %, full house 2.60 %, flush 3.03 %,
straight 4.62 %, trips 4.83 %, two pair 23.5 %, pair 43.8 %, high card 17.4 %.

### 4.3 Bets
Fold, Check, Call, Bet/Raise (any size ≥ min, ≤ stack), All-in.

### 4.4 RNG, RTP, variance, bots
- One shuffle per hand (Fisher–Yates; commit hash at deal, reveal after the hand).
- RTP: zero-sum between seats minus rake (≈ 1.5–3 % of money wagered at Low). Tuning target: a novice loses ≈ 2 BB/100 hands vs
  default bots; a solid player wins ≈ +5 BB/100.
- **Luck** only in pots where every remaining opponent is a bot. Fate draw: when the player is all-in and behind (host computes exact
  equity), the next turn or river card is rerolled once with probability L/100. Never with a human in the pot.
- **Bots** (never see hidden cards): preflop plays the top VPIP % of the 169 starting hands by Chen score; postflop = Monte-Carlo
  equity (300 runouts vs each live opponent's range = their VPIP percentile); call if equity > pot odds + `margin`; raise if equity >
  `raiseT` or on a bluff roll; sizing ½ / ¾ / 1× pot, all-in when SPR < 1.5. Think time 0.8–3.5 s (longer when pot > 20 BB). Each bot
  shows a tell that is 70 % reliable.

| Bot | VPIP | PFR | Aggr. | Bluff | margin | raiseT | Tell |
|-----|-----:|----:|------:|------:|-------:|-------:|------|
| Brother Ledger (tight-passive) | 16 % | 8 % | 1.0 | 3 % | 0.06 | 0.72 | adjusts cuffs when strong |
| Mrs. Varnish (loose-aggressive) | 38 % | 28 % | 3.5 | 18 % | 0.00 | 0.55 | head tilts when bluffing |
| The Tallyman (tight-aggressive) | 20 % | 16 % | 2.8 | 10 % | 0.03 | 0.60 | taps 3 fingers when strong |
| Grinning Pell (maniac) | 55 % | 40 % | 4.0 | 30 % | −0.05 | 0.45 | jaw clicks when bluffing |
| Old Wick (calling station) | 45 % | 6 % | 0.6 | 2 % | −0.08 | 0.85 | stares at the pot when weak |
| The Widow Quill (balanced) | 24 % | 19 % | 2.2 | 12 % | 0.02 | 0.62 | veil sways when strong; adapts VPIP ±6 % to the table |

- Variance σ ≈ 2–3 BB per hand (MEDIUM).

### 4.5 Charm hooks (`holdem.*`)
`holdem.extraHoleCard` (bool: Pineapple — dealt 3, discard 1 before preflop action) · `holdem.tellReader` (bool: bot tells get a 1-px gold
outline when they fire) · `holdem.badBeatShareAdd` (float) · `holdem.botTilt` (0–1: a bot that loses a pot > 30 BB widens VPIP +15 % for
5 hands with this probability) · `holdem.seeBurn` (bool: burn cards shown to the owner after each street) · `holdem.timeBankAdd` (s) ·
`table.rakeDelta` · `table.peekCharges` = reveal the next board card to the owner — **only when no other human is in the hand**.

### 4.6 Cost
Blinds as above; buy-in/cash-out are wallet transfers. actionCost **1 per hand dealt in**. Sitting out costs nothing.

### 4.7 Controls
**1** Fold · **2** Check/Call · **3** Bet/Raise (enters sizing) · **4** All-in (hold 0.6 s) · sizing: **wheel** ±1 BB, **Shift+wheel** ±5 BB,
**Z** ½ pot, **X** ¾ pot, **C** pot, **Space** confirm, **Backspace** cancel · **5** show/muck toggle when winning uncalled · **6** sit out
next hand · **7** top up to 100 BB · hold **RMB** over hole cards = peek (cards stay face-down to others; option "always show") · **V** board cam.

### 4.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| WAIT | < 2 seated (humans + bots) | ∞ | → BLINDS |
| BLINDS | post SB/BB | 0.6 s | → DEAL_HOLE |
| DEAL_HOLE | 2 cards per seat, 0.25 s each | 1.0–4.0 s | → BET(preflop) |
| BET(street) | acting seat | human 20 s + time bank (30 s, +5 s/hand refill); bot 0.8–3.5 s; SP: no timer (option) | → next street / RUNOUT / SHOWDOWN / AWARD |
| FLOP / TURN / RIVER | burn + deal | 1.2 / 0.6 / 0.6 s | → BET |
| RUNOUT | all-in, no more action: hands face up, each remaining street 1.5 s | 1.5–4.5 s | → SHOWDOWN |
| SHOWDOWN | reveal in order, best-5 highlighted | 1.0 s per hand | → AWARD |
| AWARD | chip push per pot (side pots one by one), rake to slot | 1.5–4.0 s | → CLEANUP |
| CLEANUP | cards swept, button moves | 1.0 s | → BLINDS |

Timeout default: check if free, else fold.

### 4.9 UI
Diegetic: chip stacks per seat, pot ring, board, dealer button (brass disc), rail meters (CREDIT = stack, BET = current street bet), the
acting seat's lamp blinks, The Ledger 7-seg meter on the dealer's chest. Overlay: legal actions, call amount, raise slider, optional pot
odds, time-bank ring around the crosshair.

### 4.10 Multiplayer — shared-table PvP, 8 seats, bots fill
Per-seat: `{p|bot, stack, hole:int8[2] (host only), inHand, committed, allIn, sittingOut, timeBankMs}`.

| Event | Extra payload |
|-------|---------------|
| `holdem.hand` | `{handNo, button, sb, bb, seats:int8[]}` |
| `holdem.blind` | `{seat, amount}` |
| `holdem.hole` | `{seat, cards}` unicast to the owner; broadcast `{seat, cards:null}` |
| `holdem.turn` | `{seat, toCall, minRaise, maxRaise, timeoutMs, bankMs}` |
| `holdem.act` | `{seat, action:'fold'\|'check'\|'call'\|'bet'\|'raise'\|'allin', amount}` |
| `holdem.board` | `{street:'flop'\|'turn'\|'river', cards}` |
| `holdem.pots` | `{pots:[{amount, eligible:int8[]}]}` |
| `holdem.show` / `holdem.muck` | `{seat, cards, rank, best5}` / `{seat}` |
| `holdem.award` | `{pots:[{winners:int8[], amount, rake}], ledger?:{amount, loser, winner}}` |
| `holdem.stack` | `{seat, stack}` (buy-in, top-up, cash-out) |
| `holdem.tell` | `{seat, kind}` (cosmetic, broadcast) |
| `holdem.burn` | `{cards}` unicast (`seeBurn`) |

### 4.11 Juice
- **Sound**: chip-push cascades, card fwips, dealer servo; **all-in heartbeat** = sine 55 Hz double thump, 70 bpm rising to 110 bpm by
  the river; showdown reveal = card snap + one low tone (sine + 2nd harmonic) per hand, pitch by hand rank.
- **Light**: when a pot exceeds 50 BB the pendant narrows its cone (spot angle 60° → 35°): "the room leans in"; patrons turn to the pot.
- **Big win**: pot ≥ 100 BB → shared tier sequence + the pendant swings; a Ledger hit → W5-style jackpot sequence pit-wide.

### 4.12 Edge cases & anti-exploit
- Disconnect = sitting out (auto check/fold); the stack returns to the wallet at hand end. Join only between hands.
- Muck never reveals cards; folded hole cards never leave the host. Bots receive only their seat view.
- Collusion between friends cannot be prevented in a P2P friend game; in Versus the GDD may cap per-deadline PvP transfers.
- Atomic intents (no string bets). Minimum 2 seats (bots count).

### 4.13 Tycoon
Milestones: **L10** pot-odds readout on the owner's rail meter · **L25** two extra "fish" bots (VPIP 60 %, aggression 0.5) · **L50** rake
−1 pp for the owner · **L100** the owner receives 10 % of every Ledger hit at this table. Staff gambler: plays "The Tallyman" profile at
Low stakes. Idle profile (owner = house): rake income at `patronRate 1.2 hands/min`, 5 % cap 3 BB. Overheat ("on a heater"): bots fold
10 % more often to your raises for 3 hands.

---

## 5. The Devil's Table (revolver roulette) — `devilstable` · TR "Şeytanın Masası (Rus Ruleti)" · Tier 1 (signature)

> **v1.1:** this section is the **SIX CHAMBERS** quick variant (selectable on the table's mode plaque). The main mode is
> **SHELLS**, §5A. Both share the table, the Devil, the turntable rig and the stake band.

### 5.1 Fantasy, body, pose
In the deepest corner, a small round table Ø 1.00 m (felt height 0.74 m, oxblood `#4A0E12`) with two high-backed chairs. Opposite you
sits **the Devil**: a 2.1 m horned mannequin automaton in a pinstripe suit, hinged jaw, red glass eyes `#FF1A1A`. On the table, a
brass-and-bone six-chamber revolver mounted on a **swivel turntable**, so the barrel can face either seat. One flickering bulb
`#FF7A2A`. Tone: dread, not gore — a hit cuts to black with ringing ears; no blood, no wounds, no body shown.
- Play pose: seated, camera (0.00, 1.15, 0.55), look at the revolver (0, 0.80, 0); free-look widened to ±25° yaw to stare the Devil down.
- **Decision**: stake size, how many slugs, when to collect, whether to take the Devil's bargain.

### 5.2 Rules — solo "Six Chambers"
1. Stake S: min max(20, 10 % of wallet) ("the Devil does not play for pennies"), max 50 % of wallet, cap 5,000 (× limits).
2. Load **k ∈ {1, 2, 3}** brass slugs. The Devil loads them, spins the cylinder **once** (no re-spins), turns the barrel to you.
3. **PULL** (hold LMB 1.2 s): empty chamber → click, you climb one rung; live chamber → BANG: you lose S and **black out**.
4. After each survived pull: **COLLECT** (S × rung multiplier) or PULL again.
5. After 6 − k survived pulls all remaining chambers are live: the game ends automatically — the Devil turns the barrel on himself
   ("the rest are mine"), BANG, he bursts into moths and reassembles; you collect the top rung (tag `devilstable:due`).
6. **Blackout** (on BANG): stake lost; screen black 4.0 s; you wake on the floor beside the table (3.0 s get-up); buff
   `buff.scorched` = luck −10 for your next 5 plays on any device. Tags `loss`, `blackout`. The GDD may add a `blackoutPenalty`.
7. **The Devil's Bargain**: when k = 3, with probability 0.30 (max once per deadline) the Devil slides a sealed envelope before the spin.
   Accept → you receive one random **cursed charm** (curse pool) and he guarantees that the **first pull is empty** (ladder unchanged).

### 5.3 Ladder (gross × S; floored to 2 decimals)
| Rung (survived pulls) | k = 1: survival / × | k = 2: survival / × | k = 3: survival / × |
|---:|---|---|---|
| 1 | 83.3 % / **×1.14** | 66.7 % / **×1.42** | 50.0 % / **×1.90** |
| 2 | 66.7 % / **×1.42** | 40.0 % / **×2.37** | 20.0 % / **×4.75** |
| 3 | 50.0 % / **×1.90** | 20.0 % / **×4.75** | 5.0 % / **×19.00** (auto-end, Devil's Due) |
| 4 | 33.3 % / **×2.85** | 6.67 % / **×14.25** (auto-end) | — |
| 5 | 16.7 % / **×5.70** (auto-end) | — | — |

Survival after n pulls = C(6−n, k) / C(6, k) (exact). Every rung returns 0.95 × S in expectation, so **any stopping strategy has RTP
≈ 95.0 %** (94.7–95.0 % after flooring). With the bargain (k = 3) survival is conditioned on chamber 1 empty → RTP 190 % for that game;
the price is a cursed charm. Variance: k=1 collecting at rung 1 σ 0.43 (LOW); k=3 to rung 3 σ 4.14 (HIGH).

### 5.4 Duel (PvP; Versus and Free Casino, two humans)
Both stake S (matched), pot 2S, 5 % rake to the House. k = 1, one spin, alternate turns, first puller decided by a coin toss on the table.
Your turn: **PULL** (barrel swivels to you) or **YIELD** (forfeit the pot). No collecting. The first player shot loses the pot, blacks out
and gets `buff.scorched`; the survivor collects 1.9 S. With no yields the first puller loses with probability 1/2 (chambers 1, 3, 5) —
fair. Turn timer 20 s (timeout = PULL). Spectators gather at the rope line.

### 5.5 RNG and luck
- At SPIN the host picks k distinct live chambers uniformly from 6; the pull sequence is then deterministic.
- **Luck = misfire** (the one visible luck effect in this catalogue): when a pull hits a live chamber, with probability L/100 the slug
  misfires (dud click + puff of grey smoke, the Devil frowns); that chamber counts as empty and the rung is gained. Max 1 misfire per
  game. In a duel each puller uses their own L. Tag `lucky`. Negative L adds nothing (the Devil needs no help).

### 5.6 Charm hooks (`devilstable.*`)
`devilstable.misfireAdd` (float added to L/100, cap 0.5) · `devilstable.misfireCapAdd` (int) · `devilstable.ladderMult` (float × all rungs) ·
`devilstable.peekChamber` (charges: the next chamber glows faint red if live, 0.5 s, owner only) · `devilstable.bargainChanceAdd` ·
`devilstable.blackoutWard` (charges: skip the blackout penalty; stake still lost) · `table.peekCharges` = one `peekChamber` ·
`payoutMult` applies to COLLECT and Devil's Due.

### 5.7 Cost
Stake per 5.2. actionCost **2 per game**. No autoplay; no fast mode during PULL (the 1.2 s squeeze is the moment).

### 5.8 Controls
Setup: **wheel/Z/X** stake step (ladder values inside the allowed band), **1 / 2 / 3** slugs, **Space** confirm · bargain: **1** accept,
**2** refuse · play: **hold LMB or hold Space 1.2 s** = pull (release early = lower the gun, no pull) · **Q** collect · duel: hold LMB = pull,
hold **2** 1 s = yield (v1.1: Y is push-to-talk) · **E** stand = collect if a rung is held; before the spin = full refund.

### 5.9 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| IDLE | empty chair | ∞ | the Devil drums his fingers (4 Hz clacks); eyes track the nearest player |
| STAKE | seated | ∞ | Space → LOAD |
| LOAD | slugs inserted one by one (brass glint) | 1.0 s × k | → BARGAIN (if offered) or SPIN |
| BARGAIN | envelope slides | ≤ 10 s (default refuse) | → SPIN |
| SPIN | cylinder whirr, clicks decelerate | 1.6 s | → AIM |
| AIM | swivel turns the barrel to the puller | 0.8 s | → READY |
| READY | await | ∞ (duel 20 s) | hold → PULL; Q → COLLECT |
| PULL | hammer cocks at hold start, fires at 1.2 s | 1.2 s | → CLICK / MISFIRE / BANG |
| CLICK | dry click, exhale, rung pip lights | 0.6 s | → READY or DEVILS_DUE |
| MISFIRE | dud + smoke, the Devil frowns | 1.4 s | → READY |
| BANG | 1 frame white, then black | 0.15 s | → BLACKOUT |
| BLACKOUT | black screen, tinnitus | 4.0 s | → WAKE |
| WAKE | camera on the floor, gets up | 3.0 s | → STAKE |
| COLLECT | the Devil slides black coins across | 2.0 s | → STAKE |
| DEVILS_DUE | barrel turns to the Devil, BANG, moth burst & reform | 5.0 s | → COLLECT |

### 5.10 UI
Diegetic: six red pips in the table edge (lit = survived rung), the cylinder (chambers visible, slugs not), a brass plaque with the
ladder for the chosen k and the current rung lit, rail meter (CREDIT / BET = S / WIN = current collect value). Overlay: `COLLECT ×1.90 = 950`
hint, hold-to-pull ring (fills over 1.2 s).

### 5.11 Multiplayer
Solo-occupant (watchers behind a rope line 2.5 m away) + duel (2 seats, host-authoritative).

| Event | Extra payload |
|-------|---------------|
| `devilstable.stake` | `{p, S, k}` |
| `devilstable.bargain` | `{offered:bool}` → `{accept:bool, curseId?}` (curse revealed after accepting) |
| `devilstable.spin` | `{cylAngle}` (live chambers are never sent) |
| `devilstable.pull` | `{p, n}` (start of the 1.2 s squeeze) |
| `devilstable.click` / `devilstable.misfire` / `devilstable.bang` | `{p, n}` |
| `devilstable.collect` | `{p, rung, payout}` |
| `devilstable.due` | `{p, payout}` |
| `devilstable.duel` | `{turnSeat, timeoutMs}` / `{yieldSeat}` |
| `devilstable.peek` | `{live:bool}` unicast |

### 5.12 Juice
- **Sound**: heartbeat sine 50 Hz thumps at 60 + 15 × rung bpm; cylinder spin = ratchet clicks (noise, bandpass 2.2 kHz) slowing down;
  cocking = two-stage metallic clack; CLICK = dry click + the Devil's jaw laugh (3 descending noise bursts 600 / 450 / 300 Hz);
  BANG = 80 ms full-band noise + 40 Hz sub boom, then the master bus ducks to −40 dB and a 4 kHz sine tinnitus fades over 4 s. Whispers
  (formant-filtered noise, −24 dB, circling the listener) start when you choose k = 3.
- **Light**: the bulb flickers (noise-driven intensity 0.3–1.0); at rung ≥ 3 the room darkens 30 %; BANG = one white frame then black,
  return through a 1.5 s dithered fade.
- **Big win**: Devil's Due → ~200 moth sprites swirl and rebuild the Devil (3 s), shared tier by multiple; the pit PA plays a distorted
  chuckle.

### 5.13 Edge cases & anti-exploit
- Live chambers stay on the host; `peekChamber` is unicast.
- Stand-up / disconnect in READY with ≥ 1 rung = auto-COLLECT; before SPIN = full stake refund (actionCost not refunded).
- Duel disconnect = YIELD after 30 s. Duel stakes are escrowed for both seats at SPIN.
- The stake band is evaluated at STAKE from the wallet at that moment. Cooldown: after a Devil's Due the Devil "rests" 60 s.

### 5.14 Tycoon
Not ownable, no staff ("the Devil only plays with the living"). Player-side upgrade milestones: **L10** one `peekChamber` charge per game ·
**L25** rungs 4+ pay +10 % · **L50** misfire cap 2 · **L100** Devil's Due pays ×2 the top rung. Overheat: the Devil leans in (eyes
brighter); bargain chance ×2. Global event *Full Moon*: the bargain is also offered for k = 2.

---


## 5A. The Devil's Table — SHELLS mode (main mode, BRIEF Addendum 7) — `devilstable` · Tier 1

Original presentation in the spirit of a shell-duel: no third-party names, art or characters. Same table, Devil automaton,
turntable rig and stake band as §5; the rig swaps the revolver for a **double-barrel coach gun** (brass receiver, walnut stock,
two 0.45 m barrels) when SHELLS is selected on the mode plaque (default mode).

### 5A.1 Body additions (modeler)
- **Shell tray** (0.30 × 0.10 m, brass) at the table centre: each load is displayed face-up for 2.0 s — LIVE shells = oxblood
  hull `#5A1019` with a brass cap `#C59C42`, BLANK = grey hull `#5A525A` with a dull cap `#4A3A19` — then swept into the tube
  magazine behind a leather flap (order hidden).
- **Defibrillator box** per seat (0.22 × 0.14 × 0.10, black lacquer, two paddles on coiled cords): 6 charge lamps (lit = charge,
  `#5AFF7B`; spent `#082919`), a needle gauge, a thump plate. Seats: the player (+Z), the Devil (−Z), and two side stools (±X)
  used only in 3–4 player PvP.
- **Item tray** per seat: 4 × 2 felt pockets (8 slots) in front of the defib box; items are small props from `kit.prop()`.
- **Seat lanterns**: one brass lantern 0.4 m above each chair (`anchors.seatLantern0..3`); the gun only ever aims at a lantern.

### 5A.2 Match structure
A match is **best of 3 rounds** vs the Devil (solo), or **last seat standing per round, best of 3** among 2–4 humans (PvP).

| Round | Charges per seat | Shells per load | Items dealt per seat per load |
|---:|---:|---|---:|
| 1 | 2 | 2–4 | 0 |
| 2 | 4 | 3–6 | 2 |
| 3 | 6 | 4–8 | 4 |

- Load size n is uniform in the range (round RNG). Live count = ⌊n/2⌋ or ⌈n/2⌉ (50/50), always ≥ 1 live and ≥ 1 blank. The tray
  shows the counts ("3 LIVE · 2 BLANK"), then the order is shuffled (Fisher–Yates) and hidden.
- Turn order: the round's first shooter alternates (round 1: player / first seat clockwise from the host's seat in PvP).
- **Your turn** (20 s; timeout = shoot self): use any number of items, then **aim** at a seat lantern (look at it; the turntable
  follows) and **hold LMB 0.8 s** to fire (release early = lower the gun). Targets: yourself or any opponent with charges.
  - LIVE at a target → target −1 charge (−2 with Hacksaw); turn passes clockwise.
  - BLANK at **yourself** → you keep the turn. BLANK at an opponent → turn passes.
  - Magazine empty → new load (counts shown, new items dealt; overflow beyond 8 is discarded).
- Charges 0 → that seat is out of the round (blackout presentation, GDD §6.12). Last seat with charges wins the round.
- Solo: the Devil must lose 2 rounds for you to win the match; you lose the match by losing 2 rounds.

### 5A.3 Items (draw weights out of 120 per item drawn)
| Item | Weight | Effect |
|---|---:|---|
| Loupe | 16 | See the chambered shell (private). |
| Bitter Tonic | 14 | Rack the gun: the chambered shell is ejected and shown to all. |
| Cuffs | 10 | Chosen opponent skips their next turn (cannot be used on the same seat two turns running). |
| Lucky Mint | 14 | +1 charge (capped at the round maximum). |
| Hacksaw | 10 | Your next LIVE hit this turn deals 2. |
| Burner Phone | 12 | A whisper tells you the type of shell #k for a random k ≥ 2 still in the magazine (private). |
| Inverter | 10 | Flip the chambered shell LIVE ↔ BLANK (nobody is told). |
| Adrenaline | 8 | Take one item from an opponent's tray and use it at once (not another Adrenaline). |
| Expired Pills | 12 | 50 %: +2 charges (capped); 50 %: −1 charge (cannot knock you out below 1). |
| Loaded Chip | 6 | If you win this match your gross is doubled (×1.9 → ×3.8 solo; PvP: your pot share ×2 paid by the House). Max 1 per match. |
| Mirror | 4 | The next LIVE shot **you fire at yourself** is redirected to the next seat clockwise. Consumed when it triggers. |
| Collector's Coin | 4 | Discard the rest of the current load unseen and reload now. Max 1 per round per seat. |

### 5A.4 Wager, payouts, RTP
- Solo stake S in [max(20, 10 % of wallet), 50 % of wallet], cap 5,000 × limits (as §5.2); escrowed at match start.
- Solo win → gross **1.9 × S** (Loaded Chip 3.8 × S); loss → 0 + `buff.scorched` (luck −10 for 5 plays) + Dread +10.
  **Double or nothing**: after a win you may ride the whole gross into a new match (max 3 rides; rides cost no pulls).
- Target RTP 95.0 %: the Devil AI below is tuned (simulate(): 10^6 matches vs the reference "basic" bot) to win 50.0 % ± 1 %;
  Loaded Chip raises the bot's RTP to ≈ 98 %.
- PvP (2–4 humans, Versus / Free Casino / Co-op Free play): every seat stakes the same S (first seated sets it); pot = N·S; rake
  5 %; the match winner takes 0.95 · N · S. PvP net winnings count toward the GDD §7.3 cap.
- actionCost **2 per match** (rides free). Not staffable (GDD §3.7.5). Heat / Overheat as §5.14.

### 5A.5 The Devil AI (host-side; sees only public info + its own items)
1. If it holds a Loupe / Burner Phone and the chambered shell is unknown → use it.
2. Known LIVE → Hacksaw if held, shoot the opponent with the fewest charges (ties: the human). Known BLANK → Inverter if held
   and the opponent has ≤ 2 charges then shoot the opponent; otherwise shoot itself.
3. Unknown: p = live / remaining. p ≥ 0.67 → Hacksaw + shoot opponent; 0.5 ≤ p < 0.67 → shoot opponent; p < 0.5 → shoot self.
4. Lucky Mint when charges ≤ max − 1; Cuffs when p ≥ 0.5 and the opponent holds ≥ 1 Hacksaw/Inverter; Bitter Tonic when
   p = 0.5 exactly; Expired Pills only when charges ≥ 2; Adrenaline steals the opponent's Loupe or Hacksaw first.
5. Bluff: 10 % of decisions pick a random legal action (never on the last shell of a load). Think time 1.2–2.6 s (15 fps tells:
   jaw click when it holds a known LIVE, 70 % reliable).

### 5A.6 Luck, hidden information, fairness
- Luck = **misfire** (as §5.5): a LIVE shot at you misfires with probability min(0.30, L/100) → counts as BLANK, turn passes;
  max 1 misfire per round per seat. Tag `lucky`.
- Shell order never leaves the host; Loupe / Burner Phone results are private events (`sendPrivate`). Commit–reveal per load
  (`fair` hash of the shuffled order at load, reveal after the load is spent).

### 5A.7 Controls (seated, play pose camera (0.00, 1.15, 0.75) looking at the gun, FOV 55°)
Wheel / Z / X stake (before the match) · Space confirm · **1–8** use the item in tray slot n (then click a target seat if it needs
one) · look at a lantern + **hold LMB 0.8 s** = fire · RMB = lower the gun · **Q** = collect after a won match (decline the ride) ·
**R** = ride (double or nothing) · H rules card · E stand (before the match = full refund; during a match = forfeit, counts as a
loss; PvP = the seat auto-shoots itself on each turn until out).

### 5A.8 State machine
IDLE → STAKE → LOAD (tray reveal 2.0 s, shuffle 0.8 s, items dealt 0.3 s each) → TURN (≤ 20 s) → [ITEM (0.6–1.2 s each)] →
AIM (turntable 0.5 s) → FIRE (hold 0.8 s) → CLICK (0.6 s) | BANG (white 2 frames → black 1.2 s → crack overlay, defib thump 0.8 s)
| MISFIRE (1.4 s) → TURN … → ROUND_END (2.0 s, lanterns relit) → … → MATCH_END (Devil pays black coins 2.0 s) → RIDE_OR_COLLECT.
Slow-motion ×0.5 on the last shell of every load (≤ 1.5 s real time).

### 5A.9 Events (TableBase; `k` names)
`mode {mode}` · `stake {seat, S}` · `load {round, n, live, items:[[seat, itemIds[]]]}` (counts and dealt items public, order
hidden) · `turn {seat, timeoutMs}` · `item {seat, item, target?}` (+ private `itemResult {shell?|k?}` to the user) · `aim {seat,
target}` · `shot {seat, target, live, dmg, misfire}` · `charges {seat, n}` · `roundEnd {winner}` · `matchEnd {winner, payout}` ·
`fair {hash}` / `fairReveal {order, seed}`.

### 5A.10 Juice
Shell loading: brass clacks (noise bursts bandpass 1.2 kHz, 25 ms) one per shell; rack = two-stage metallic clack; aim =
turntable servo whine 0.5 s; hammer = dry click; BANG = 80 ms full-band noise + 40 Hz sub boom, master bus ducks to −40 dB,
4 kHz tinnitus fading over 4 s; lantern shatter = glass tinkle + 24 shard particles; defib thump = sine 50 Hz 0.15 s + needle
swing; misfire = dud puff (grey smoke) + the Devil frowns; the heartbeat (sine 50 Hz at 60 + 15 × shells-left-ratio bpm) runs
under every turn; item uses each have a 3-note music-box sting. Win = the Devil bursts into moths and reassembles (as §5.12).
Patron mannequins at the rope line turn their heads on every BANG.

### 5A.11 Tycoon / milestones (player-side, as §5.14)
L10 one free Loupe per match · L25 match win pays ×2.0 instead of ×1.9 · L50 misfire cap 2 per round · L100 your first BANG per
match is always a misfire. Bounty `b_devil2` and achievement `six_chambers` stay attached to the SIX CHAMBERS variant; the HOUSE
punch feat is "win a SHELLS match, or COLLECT at rung ≥ 3".

---

## 6. Baccarat (Punto Banco) — `baccarat` · TR "Bakara (Punto Banco)" · Tier 2

### 6.1 Fantasy, body, pose
"The Mirror Table": a kidney table 2.60 × 1.30 m, teal felt `#1B4D4A`, 7 seats, an 8-deck shoe, and a tilted **mirror panel** 2.0 × 1.0 m
hung with its centre at y 2.05 m, tilted 35° toward the seats (v1.1: must stay ≤ 2.4 m, L class). The dealer, "the Banker", is a seated mannequin in a top hat with a long wooden paddle. Light-horror beat:
on 1 coup in 40 the mirror shows a figure standing behind the player for 0.5 s (nothing is there when you turn).
- Play pose (seat 4): camera (0.00, 1.18, 0.75), look (0.00, 0.78, −0.15), FOV 60°. Detail cam (V): looking **up into the mirror**.
- **Decision**: Player vs Banker vs Tie; pair side bets; reading roadmaps (pure superstition); the squeeze ritual.

### 6.2 Rules
1. 8 decks; at shoe start the first card is shown and that many cards are burned (ten/face = 10). Cut card 14 cards from the end: the
   coup in progress is the last of the shoe.
2. OPEN: bet Player, Banker, Tie and/or pairs. LOCK.
3. Deal Player–Banker–Player–Banker face down. The largest bettor on each side squeezes that side's cards (solo: you squeeze the side you
   backed; Player first if both).
4. Values: A = 1, 2–9 face value, 10/J/Q/K = 0; hand total = sum mod 10.
5. **Natural**: Player or Banker at 8 or 9 → both stand.
6. **Player**: 0–5 draws a third card; 6–7 stands.
7. **Banker**: if Player stood → Banker draws on 0–5, stands on 6–7. If Player drew a third card valued t:
   Banker 0–2 draws · 3 draws unless t = 8 · 4 draws if t ∈ 2–7 · 5 draws if t ∈ 4–7 · 6 draws if t ∈ 6–7 · 7 stands.
8. Higher total wins; equal = Tie (Player/Banker bets push).

### 6.3 Bets and payouts (8 decks; P(Banker) 45.86 %, P(Player) 44.62 %, P(Tie) 9.52 %)
| Bet | Spot id | Pays | RTP |
|-----|---------|-----:|----:|
| Banker | `banker` | 1:1 less 5 % commission (charged on the win, per coup) | 98.94 % (ref) |
| Player | `player` | 1:1 | 98.76 % (ref) |
| Tie | `tie` | 8:1 | 85.64 % (ref) |
| Player Pair (first two Player cards same rank) | `ppair` | 11:1 | 89.64 % (exact, P = 31/415) |
| Banker Pair | `bpair` | 11:1 | 89.64 % (exact) |

### 6.4 RNG, luck, variance
- Shoe shuffled at shoe start (`salt='shoe'`; commit at shuffle, reveal at shoe end).
- Luck: solo → reroll the whole coup (its 4–6 cards are reinserted at random positions in the remaining shoe and a new coup is dealt;
  invisible). Shared with ≥ 2 humans → refund mode.
- σ ≈ 0.95 (Banker/Player, LOW); Tie σ 2.64 (MEDIUM).

### 6.5 Charm hooks (`baccarat.*`)
`baccarat.naturalBonus` (float: wins with a natural pay +x net) · `baccarat.tiePayAdd` (int) · `baccarat.pairPayAdd` (int) ·
`baccarat.tieSweetener` (bool: on a Tie, Player/Banker bets get +10 % instead of a plain push) · `baccarat.squeezeLuck` (int: squeezing for
≥ 3.0 s before the reveal grants +x luck for this coup — rewards the ritual) · `table.rakeDelta` (commission) · `table.peekCharges` =
reveal the next coup's first Player card during OPEN (owner only).

### 6.6 Cost
Player/Banker 10–1,000; Tie and pairs 1–100. actionCost **1 per coup**. Autoplay (G) allowed (fixed side, no squeeze).

### 6.7 Controls
LMB on spots · **1 / 2 / 3** quick-bet Player / Banker / Tie with the selected chip · squeeze: **hold LMB on a card and drag down** (bend
progress 0 → 1; release at > 0.8 = flip) · **Space** reveal all / Ready · **V** mirror cam.

### 6.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| OPEN | betting | solo ∞ / shared 15 s | → LOCK |
| LOCK | bell, paddle raised | 0.6 s | → DEAL |
| DEAL | 4 cards face down, 0.35 s each, slid by paddle | 1.4 s | → SQUEEZE |
| SQUEEZE | squeezers bend cards (Player side, then Banker) | ≤ 6 s per side (shared) / ∞ solo; Space skips | → REVEAL |
| REVEAL | remaining cards flip, totals on flip-tiles | 0.8 s | → THIRD or RESULT |
| THIRD | Player then Banker third card per rules | 0.8 s each | → RESULT |
| RESULT | winner lamp, roadmap updates | 1.5 s | → PAYOUT |
| PAYOUT | paddle pays; commission chips to the box | ≤ 2.5 s | → OPEN (or SHUFFLE at shoe end, 5.0 s) |

### 6.9 UI
Diegetic: roadmap backboard (Bead Plate 6×12 lamps + Big Road 6×24 lamps; red = Banker `#C8102E`, blue = Player `#2C4C9C`, green
tie slash), totals on brass flip-tiles, commission box, shoe level, rail meters. Overlay: squeeze hint ("drag down"), payout tooltip.

### 6.10 Multiplayer — shared-table, 7 seats
Per-seat `{p, spots, squeezeSide?, heat}`; squeezer = largest bettor per side (ties → lower seat).

| Event | Extra payload |
|-------|---------------|
| `baccarat.deal` | `{squeezers:{P:seat\|-1, B:seat\|-1}}` (cards face down, values not sent) |
| `baccarat.squeeze` | `{side:'P'\|'B', idx, bend:0..1}` (from the squeezer, relayed ≤ 8 Hz) |
| `baccarat.reveal` | `{side, idx, card}` |
| `baccarat.third` | `{side, card}` |
| `baccarat.result` | `{p:int, b:int, winner:'P'\|'B'\|'T', pairs:{p:bool, b:bool}, natural:bool, seats:[{seat, payout, commission}]}` |
| `baccarat.road` | `{bead:int8[]}` (on join and shoe start) |
| `baccarat.shoe` | `{remaining, lastCoup:bool}` |
| `baccarat.peek` | `{card}` unicast |

### 6.11 Juice
- **Sound**: squeeze = paper creak (bandpassed noise 1–3 kHz with crackle density rising with bend); reveal snap; paddle slide (lowpassed
  noise 0.4 s); natural 9 = gong (sine 98 + 196 Hz, 3 s decay) and the mirror flashes white for 2 frames; tie = two music-box notes.
- **Light**: a winner lamp above each side (Player blue, Banker red) glows 1.5 s.
- **Big win**: pair or tie wins ≥ ×10 → shared tiers; the Banker tips his hat (0.6 s).

### 6.12 Edge cases & anti-exploit
- Card values are sent only at reveal (squeeze stays suspenseful; a hacked client gains nothing — bets are locked).
- Squeezer disconnect / timeout → auto-reveal. Commission is applied per winning coup and floored with dust.
- Shoe end mid-OPEN: the shuffle happens after the last coup's PAYOUT, never mid-coup.

### 6.13 Tycoon
Milestones: **L10** derived roads (3 extra cosmetic roadmaps) · **L25** commission 4 % · **L50** "Lucky Six": a Banker win with a total of 6
pays 1:1 without commission · **L100** Tie pays 9:1. Staff gambler: flat Banker. Idle profile: `patronRate 2.2 · patronStake 0.05 ·
houseEdge 0.012`. Overheat: the mirror shows your reflection grinning; `payoutMult +10 %`.

---

## 7. Craps — `craps` · TR "Craps Zar Masası" · Tier 2

### 7.1 Fantasy, body, pose
"The Bone Pit": a sunken table 3.60 × 1.50 m with 0.30 m walls, inner walls lined with rubber pyramid diamonds, black felt `#121212`
with bone-white print, 8 rail spots. The stickman, "the Hook", is a thin mannequin with a hooked stick at the centre. Dice: translucent
red `#B0101C` (α 0.85) cubes 0.019 m with white pips; puck black "OFF" / white "ON". Six small flame lamps on the rail (Furnace bet).
- Play pose (rail spot): camera (x, 1.30, 0.95) looking at the table centre, FOV 60°; as shooter the camera moves to the near end and
  lowers 0.10 m. Detail cam: tracking the dice.
- **Decision**: lowest-edge line + odds vs. juicy props; press / take down; ride a hot shooter; Don't-side contrarian play.

### 7.2 Rules
1. **Come-out roll**: 7 or 11 → Pass wins / Don't Pass loses; 2, 3, 12 → Pass loses / Don't Pass wins on 2–3, **pushes on 12 (bar 12)**;
   4, 5, 6, 8, 9, 10 → that number becomes the **point** (puck ON).
2. **Point phase**: roll until the point (Pass wins) or a 7 (seven-out: Pass loses, Don't Pass wins; dice pass to the next shooter).
3. Come / Don't Come work like Pass / Don't Pass but start on any point-phase roll.
4. Place/Buy/Hardway bets are "off" on the come-out by default (toggle with key 2); one-roll props settle every roll.

### 7.3 Bets and payouts (RTP exact unless noted)
| Bet | Spot id | Pays | RTP |
|-----|---------|-----:|----:|
| Pass Line / Come | `pass` / `come` | 1:1 | 98.59 % |
| Don't Pass / Don't Come (bar 12) | `dpass` / `dcome` | 1:1 | 98.64 % |
| Odds behind Pass/Come (max 3× on 4/10, 4× on 5/9, 5× on 6/8) | `odds:<n>` | 4/10 2:1 · 5/9 3:2 · 6/8 6:5 | 100.00 % |
| Lay odds behind Don't (max 6×) | `lay:<n>` | 4/10 1:2 · 5/9 2:3 · 6/8 5:6 | 100.00 % |
| Place 6 / 8 | `place:6` | 7:6 | 98.48 % |
| Place 5 / 9 | `place:5` | 7:5 | 96.00 % |
| Place 4 / 10 | `place:4` | 9:5 | 93.33 % |
| Buy 4 / 10 (5 % commission on win only) | `buy:4` | 2:1 less 5 % of bet | 98.33 % |
| Field (one roll: 2,3,4,9,10,11,12) | `field` | 1:1; 2 pays 2:1; 12 pays 3:1 | 97.22 % |
| Big 6 / Big 8 | `big:6` | 1:1 | 90.91 % |
| Hard 6 / Hard 8 | `hard:6` | 9:1 | 90.91 % |
| Hard 4 / Hard 10 | `hard:4` | 7:1 | 88.89 % |
| Any Seven (one roll) | `any7` | 4:1 | 83.33 % |
| Any Craps (2, 3, 12) | `anycraps` | 7:1 | 88.89 % |
| Snake Eyes (2) / Boxcars (12) | `p:2` / `p:12` | 30:1 | 86.11 % |
| Ace-Deuce (3) / Yo (11) | `p:3` / `p:11` | 15:1 | 88.89 % |
| Horn (4 units over 2, 3, 11, 12) | `horn` | per number above | 87.50 % |
| Craps & Eleven | `ce` | craps 3:1 / 11 7:1 | 88.89 % |
| Furnace Bet (side, per shooter): distinct points made 4 / 5 / 6 | `furnace` | 24:1 / 249:1 / 999:1 | ≈ 79.2 % (ref) |

### 7.4 RNG, luck, variance
- Two dice, integer face weights base 100 each (hooks add); face-remap animation (§1.5). Rolled at THROW release.
- Luck: solo → reroll the roll if the bets **resolved on this roll** net < 0 for the player; shared with ≥ 2 humans → refund on resolved
  losing bets. (Contract bets riding over many rolls are judged only when they resolve.)
- σ: Pass 1.00 (LOW), Hard 4 2.51 (MEDIUM), Snake Eyes 5.09 (HIGH).

### 7.5 Charm hooks (`craps.*`)
`craps.dieWeight[d][face]` (int add; d = 0/1) · `craps.sevenOutShield` (charges: one seven-out per shooter becomes a "no roll" re-throw) ·
`craps.oddsMaxAdd` (int ×) · `craps.hardwayPayAdd` (int) · `craps.fieldTwelveAdd` (int added to 12's 3:1) · `craps.furnaceMult` (float) ·
`craps.pointBonus` (coins paid to the shooter on every point made) · `table.peekCharges` = show the **parity** (odd/even) of the next roll
during OPEN (owner only).

### 7.6 Cost
Line / Come / Place / Buy 5–500; odds per caps; props 1–100; Furnace 1–20. actionCost **1 per roll on which the player commits new
coins** (rolls riding only already-working bets are free). No autoplay.

### 7.7 Controls
Shooter: **hold LMB on the dice** (picks both, rattle loop), **flick the mouse forward and release** (flick speed selects the trajectory
bucket: soft / medium / hard — cosmetic) · **Space** auto-throw. Everyone: LMB on layout · **1** max odds behind all line/come bets ·
**2** toggle place/buy/hardways working on come-out · **3** press the last winning place bet (double it from winnings) · **4** take down
place/buy bets · **5** Horn with the selected chip · **6** take down odds.

### 7.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| COMEOUT_OPEN | puck OFF | solo ∞ / shared 12 s | → THROW |
| THROW | the Hook pushes dice to the shooter | shooter ≤ 10 s (auto-throw) | release → ROLL |
| ROLL | dice trajectory | 1.6–2.6 s | → CALL |
| CALL | the Hook calls (tone), points at the total | 1.0 s | → SETTLE |
| SETTLE | chips paid/taken per resolved bet | 0.6–2.5 s | point set → POINT_OPEN; seven-out → SEVEN_OUT; else → COMEOUT_OPEN |
| POINT_OPEN | puck ON at point | solo ∞ / shared 8 s | → THROW |
| SEVEN_OUT | lights flicker red, dice pass | 2.0 s | → COMEOUT_OPEN |
| NO_ROLL | a die leaves the table (cosmetic, 1/60 throws) | 1.5 s | → THROW (same shooter, bets unchanged) |

### 7.9 UI
Diegetic: puck, lit point boxes, "LAST 10" roll strip (7-seg pairs), Furnace flame lamps on the rail, chips, rail meters. Overlay: shooter
flick hint, bet tooltips with "working/off" state.

### 7.10 Multiplayer — shared-table, 8 rail spots
Per-seat `{p, spots (with working flag), oddsBySpot, furnacePoints:Set, isShooter}`. Shooter rotation: after a seven-out the dice go clockwise
to the next seat with a Pass or Don't Pass bet ≥ table min; SP: you always shoot. Patrons bet Pass + Field cosmetically.

| Event | Extra payload |
|-------|---------------|
| `craps.shooter` | `{seat}` |
| `craps.throw` | `{seat, faces:[d1,d2], traj, noRoll:bool}` |
| `craps.call` | `{total, hard:bool, phase:'comeout'\|'point', point}` |
| `craps.puck` | `{on:bool, point}` |
| `craps.settle` | `{seat, spots:[[spotId, payout]]}` |
| `craps.furnace` | `{seat, points:int8[]}` |
| `craps.peek` | `{odd:bool}` unicast |

### 7.11 Juice
- **Sound**: dice rattle in hand (clicks through bandpass 2–4 kHz at random 8–16 Hz), table thock (sine 140 Hz 30 ms + noise), wall
  rubber "tok"s, Hook call tones (seven = descending minor third, yo = two bright tones, point made = ascending fifth), chip cascades.
- **Light**: each point made lights one Furnace flame `#FF6A00`; 4+ flames = the rail glows; seven-out = room lights flicker `#8B0000`
  0.6 s + bass drop 60 → 30 Hz.
- **Big win**: Furnace 5/6 points → W4/jackpot sequence; hardway hits with big presses → shared tiers; patrons applaud (wood clacks).

### 7.12 Edge cases & anti-exploit
- Contract bets (Pass/Come once a point is set) cannot be removed; odds, place, buy can. Removal intents for contract bets → `BAD_BET`.
- Faces are fixed at release; flick speed is cosmetic. The shooter cannot re-throw except NO_ROLL.
- Shooter disconnect → next shooter; their bets keep working.

### 7.13 Tycoon
Milestones: **L10** "Hot Rail": every point made gives +2 luck to everyone at the table for the rest of that shooter's turn · **L25** odds
max 10× · **L50** Field 12 pays 4:1 (field RTP 100 %) · **L100** Furnace pays double. Staff gambler: Pass + 2× odds. Idle profile:
`patronRate 4.0 rolls/min · patronStake 0.05 · houseEdge 0.030`. Overheat: "hot dice" (dice glow `#FF6A00`); hardways +2 for 3 rolls.

---

## 8. Sic Bo & Chuck-a-Luck — `sicbo` · TR "Zar Kafesi (Sic Bo)" · Tier 2

### 8.1 Fantasy, body, pose
"The Birdcage": a brass hourglass cage (0.45 m tall, bulbs Ø 0.30 m) on a crank pedestal holding three ivory dice (0.050 m, red pips).
In front, a lit-panel layout 2.40 × 1.20 m (milk-glass panels lit from below; each bet area is a lamp). 8 standing spots.
- Play pose: camera (0.00, 1.30, 0.90), look (0.00, 0.85, 0.00), FOV 60°. Detail cam: cage close-up.
- **Decision**: the layout hides wildly different edges — find the good bets (totals 7/14 and 8/13, two-dice combos, small/big) or chase triples.

### 8.2 Rules
OPEN → bets on the layout → the cage is cranked (flipped 180° twice) → three dice settle → bets settle. "Chuck-a-luck" is the single-die
bet on this layout (the cage is the classic chuck-a-luck birdcage).

### 8.3 Bets and payouts (JackID paytable; RTP exact over 216 outcomes)
| Bet | Spot id | Wins when | Pays | P | RTP |
|-----|---------|-----------|-----:|--:|----:|
| Small / Big | `small` / `big` | total 4–10 / 11–17, not a triple | 1:1 | 105/216 | 97.22 % |
| Odd / Even | `odd` / `even` | total odd / even, not a triple | 1:1 | 105/216 | 97.22 % |
| Total 4 or 17 | `total:4` | | 62:1 | 3/216 | 87.50 % |
| Total 5 or 16 | `total:5` | | 33:1 | 6/216 | 94.44 % |
| Total 6 or 15 | `total:6` | | 19:1 | 10/216 | 92.59 % |
| Total 7 or 14 | `total:7` | | 13:1 | 15/216 | 97.22 % |
| Total 8 or 13 | `total:8` | | 9:1 | 21/216 | 97.22 % |
| Total 9 or 12 | `total:9` | | 7:1 | 25/216 | 92.59 % |
| Total 10 or 11 | `total:10` | | 6:1 | 27/216 | 87.50 % |
| Single die N (chuck-a-luck) | `single:N` | N on 1 / 2 / 3 dice | 1:1 / 2:1 / 12:1 | 75 / 15 / 1 of 216 | 96.30 % |
| Specific double | `double:N` | ≥ 2 dice show N | 11:1 | 16/216 | 88.89 % |
| Specific triple | `triple:N` | all three show N | 200:1 | 1/216 | 93.06 % |
| Any triple | `anytriple` | any triple | 33:1 | 6/216 | 94.44 % |
| Two-dice combo (15 pairs) | `combo:a-b` | both a and b appear | 6:1 | 30/216 | 97.22 % |

### 8.4 RNG, luck, variance
- Three dice, shared integer face weights (base 100). Face-remap animation. Rolled at LOCK.
- Luck: standard reroll (solo) / refund (≥ 2 humans).
- σ: small/big 1.00 (LOW), total 4 7.37 (HIGH), specific triple 13.64 (EXTREME).

### 8.5 Charm hooks (`sicbo.*`)
`sicbo.dieWeight[face]` (int add, all three dice) · `sicbo.singleTripleAdd` (int added to the 12:1 three-match) · `sicbo.totalPayAdd[t]`
(int) · `sicbo.tripleShield` (bool: Small/Big/Odd/Even push instead of losing on a triple) · `sicbo.cageShake` (charges: after seeing the
result, re-flip once; the second result stands — visible) · `table.peekCharges` = show one die's face during OPEN (pre-rolled at OPEN start).

### 8.6 Cost
Small/Big/Odd/Even 5–500; totals, combos, doubles, singles 1–100; triples 1–20; table 2,000. actionCost **1 per roll**. Autoplay allowed.

### 8.7 Controls
LMB on panels · **1–6** quick-bet single die N · **Space** Ready / flip (solo) · solo crank: **LMB-drag a half circle on the crank** (theatre;
speed cosmetic) · **7** cage-shake (if charged) · **V** cage cam.

### 8.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| OPEN | betting | solo ∞ / shared 15 s | → LOCK |
| LOCK | bell | 0.6 s | → FLIP |
| FLIP | cage rotates 180° twice on the crank | 1.4 s | → TUMBLE |
| TUMBLE | dice bounce inside the bulb | 1.8 s | → SETTLE |
| SETTLE | dice rest, faces lit | 0.6 s | → LIGHTS |
| LIGHTS | every winning panel lights | 1.5 s | → PAYOUT (or SHAKE window 3 s if `cageShake`) |
| PAYOUT | chip push | ≤ 2.5 s | → OPEN |

### 8.9 UI
Diegetic: lit layout (winning panels `#FFC83D`), history board of the last 20 rolls as die-face lamps, rail meters. Overlay: tooltips with
probability and pays.

### 8.10 Multiplayer — shared-table, 8 spots
Per-seat `{p, spots, heat}`; the cranker is the largest bettor (solo: you).

| Event | Extra payload |
|-------|---------------|
| `sicbo.flip` | `{faces:[a,b,c], traj, cranker:seat}` |
| `sicbo.result` | `{faces, total, triple:bool, seats:[{seat, payout}]}` |
| `sicbo.reflip` | `{seat, faces, traj}` (`cageShake`, settles only that seat's bets) |
| `sicbo.peek` | `{die:0..2, face}` unicast |

### 8.11 Juice
- **Sound**: dice in a brass cage = noise impulses through a bank of resonant bandpass filters (2.1 / 3.4 / 5.6 kHz, Q 18); FM bell
  (880 Hz) on each flip; panel lights "tick" on.
- **Light**: triples strobe the whole layout red/gold 4 Hz; a specific-triple hit → W4/W5 sequence and a "TRIPLE" brass stamp drops onto the table.

### 8.12 Edge cases & anti-exploit
- With `cageShake` in shared play, the re-flip is private to the owner's bets (others keep the first result) — shown as a ghost cage.
- Pre-rolled peek dice stay host-side; only the one face is unicast.

### 8.13 Tycoon
Milestones: **L10** history heat-map lamps · **L25** specific double pays 12:1 (96.30 %) · **L50** any triple pays 36:1 · **L100** one free
`cageShake` every 5 rolls. Idle profile: `patronRate 3.0 · patronStake 0.05 · houseEdge 0.070` (patrons love totals and triples).
Overheat: dice glow; single-die three-match pays 20:1 for 3 rolls.

---

## 9. Big Six Money Wheel — `bigsix` · TR "Büyük Altı Para Çarkı" · Tier 2

### 9.1 Fantasy, body, pose
"The Six-Score Wheel": (v1.1: L slot WH-01; the wheel is **wall-mounted** Ø 1.80 m with its hub at y 2.15 m above a betting counter 2.40 × 0.60 × 0.95 m; ART §5.11 styling) a vertical wheel Ø 2.00 m in a 2.60 m tall frame, 54 segments, 54 brass pegs, a leather flapper at 12 o'clock. The
hub is a painted **eye** whose lid can open/close. 54 marquee bulbs `#FFD36A` around the rim. In front, a glass-topped betting counter
2.40 × 0.60 m with 6 lit symbol spots. 8 standing spots. A pull-handle on the frame's right side.
- Play pose: camera (0.00, 1.45, 1.60), look (0.00, 1.60, 0.00), FOV 58°. Detail cam: flapper close-up.
- **Decision**: which symbol: near-even LOW bets, EYE long shots, or the sucker "6".

### 9.2 Rules
Bet on symbols → spin (pull the handle or Space) → the flapper stops on a segment → that symbol pays; others lose. **HOUSE** segment:
every bet loses and the eye closes.

### 9.3 Segments and payouts (54 segments, uniform)
| Symbol | Segments | Pays | RTP (exact) | σ |
|--------|---------:|-----:|----:|--:|
| 1 | 26 | 1:1 | 96.30 % | 1.00 |
| 3 | 13 | 3:1 | 96.30 % | 1.71 |
| 6 | 7 | 6:1 | 90.74 % | 2.35 |
| 12 | 4 | 12:1 | 96.30 % | 3.40 |
| 25 | 2 | 25:1 | 96.30 % | 4.91 |
| EYE | 1 | 50:1 | 94.44 % | 6.88 |
| HOUSE | 1 | — (all lose) | — | — |

Segment order (clockwise from the top, index 0 = EYE):
`EYE 1 3 1 6 1 3 12 1 1 3 1 6 1 25 3 1 1 3 6 1 12 1 3 1 1 3 HOUSE 6 1 1 3 1 12 1 6 3 1 1 3 1 25 6 1 3 1 1 12 3 1 6 1 3 1`.
Segment colours: 1 `#E8E0C8`, 3 `#2C4C9C`, 6 `#2E7D3B`, 12 `#A8262E`, 25 `#5B2A86`, EYE gold `#D4AF37`, HOUSE black `#111111`.

### 9.4 RNG, luck
Segment = weighted draw over 54 integer weights (base 100). Luck: standard reroll / refund. Near miss: the flapper stops on a segment
adjacent to EYE or 25 that you bet on → `nearmiss`.

### 9.5 Charm hooks (`bigsix.*`)
`bigsix.segmentWeight[symbol]` (int add to every segment of that symbol) · `bigsix.houseShield` (bool: HOUSE = push) · `bigsix.eyePayAdd` ·
`bigsix.nudge` (charges: if the flapper stops one peg from a segment you bet on, 50 % chance it creeps one more peg — visible slow creep) ·
`table.peekCharges` = tells you during OPEN whether the next result is a "1" (owner only).

### 9.6 Cost
1–200 per symbol, table 1,000. actionCost **1 per spin**. Autoplay allowed.

### 9.7 Controls
LMB on spots · **1–6** quick-bet 1 / 3 / 6 / 12 / 25 / EYE · **Space** spin (solo) / Ready · solo: **LMB-drag the handle down** (drag speed sets a
cosmetic spin length 6–11 s; outcome unaffected) · **V** flapper cam.

### 9.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| OPEN | betting | solo ∞ / shared 15 s | → LOCK |
| LOCK | bell, handle clunk | 0.6 s | → SPIN |
| SPIN | ω decays exponentially; peg clacks | 6–11 s | → STOP |
| STOP | flapper wobble back ≤ ½ peg | 1.0 s | → ANNOUNCE |
| ANNOUNCE | segment bulbs flash; eye opens (EYE) / closes (HOUSE) | 1.5 s | → PAYOUT |
| PAYOUT | chip push | ≤ 2.5 s | → OPEN |

### 9.9 UI
Diegetic: wheel, marquee bulbs, lit counter spots, last-12 result strip (symbol lamps), rail meters. Overlay: tooltips.

### 9.10 Multiplayer — shared-table, 8 spots

| Event | Extra payload |
|-------|---------------|
| `bigsix.spin` | `{seg:0..53, turns, durMs, wobble}` |
| `bigsix.result` | `{seg, symbol, seats:[{seat, payout}]}` |
| `bigsix.peek` | `{isOne:bool}` unicast |

### 9.11 Juice
- **Sound**: flapper clack = 15 ms noise burst, bandpass 1.8 kHz, one per peg passed (rate follows ω); the last 5 clacks are spaced out
  (tension); EYE = choir pad (detuned saws, lowpass 1.2 kHz) while the eye opens; HOUSE = all bulbs black out 1.2 s + 41 Hz drone + the
  eyelid slams.
- **Light**: bulbs chase at the wheel's speed; winning segment bulbs blink 4 Hz.
- **Big win**: EYE hit → W4; the eye looks at the winner (pupil tracks them for 5 s).

### 9.12 Edge cases & anti-exploit
- `nudge` is resolved on the host at LOCK (the creep is part of the payload); no client timing matters.
- The handle drag never changes the segment; pulling during SPIN is ignored.

### 9.13 Tycoon
Milestones: **L10** multiplier peg: each spin one random segment shows a ×2 lamp (pays double if hit) · **L25** HOUSE becomes a push ·
**L50** EYE pays 60:1 · **L100** second flapper at 6 o'clock — bets settle on both pointers. Idle profile: `patronRate 3.0 · patronStake
0.06 · houseEdge 0.045`. Overheat: bulbs red; "6" pays 7:1 for 3 spins.

---

## 10. War Table (Casino War / Dragon-Tiger) — `cardwar` · TR "Savaş Masası (Kart Savaşı / Ejder-Kaplan)" · Tier 2

### 10.1 Fantasy, body, pose
A long lacquer table 2.40 × 1.10 m (red lacquer `#7A1418`, black felt panels), two carved wooden heads on brackets above it — a dragon (left)
and a tiger (right) with glass eyes. The dealer, "the Twin", is a two-faced mannequin (one face each side of the head; it turns to the side
it deals). One model, two rule-sets: each placed instance has `variant: 'war' | 'dragontiger'` (the world places one of each).
- Play pose: camera (0.00, 1.20, 0.85), look (0.00, 0.78, −0.10), FOV 60°.
- **Decision**: War — on a tie, go to war (double down) or surrender. Dragon-Tiger — side, tie long shots, big/small.

### 10.2 Rules
**A) Casino War** (6 decks, A high): bet; one card to each seat and one to the dealer; higher card wins 1:1. On a tie the player chooses
**Go to War** (add a raise equal to the bet; dealer burns 3 cards, deals one card to the player and one to itself; player card ≥ dealer
card → raise wins 1:1 and the original pushes; else both lose) or **Surrender** (lose half the bet).
**B) Dragon-Tiger** (8 decks, **A low, K high**): one card to Dragon, one to Tiger; higher wins; equal rank = tie.

### 10.3 Bets and payouts
| Variant | Bet | Pays | RTP |
|---------|-----|-----:|----:|
| War | Main | 1:1 (tie → war/surrender) | 97.12 % always war · 96.30 % always surrender (ref) |
| War | Tie (side) | 10:1 | 81.35 % (exact, P = 23/311) |
| DT | Dragon / Tiger | 1:1; on a tie half back | 96.27 % (exact) |
| DT | Tie | 11:1 | 89.64 % (exact, P = 31/415) |
| DT | Suited Tie | 50:1 | 86.02 % (exact, P = 7/415) |
| DT | Dragon Big (8–K) / Dragon Small (A–6), same for Tiger; a 7 loses | 1:1 | 92.31 % (exact) |
| DT | Dragon Odd / Even (rank value), same for Tiger; a 7 loses | 1:1 | 92.31 % (exact) |

### 10.4 RNG, luck, variance
- Shoe shuffled at shoe start; cut card at 80 % penetration.
- War: each seat's card is that seat's **fate draw** (reroll mode per seat: if it would lose, reroll once with probability L/100); the dealer
  card is shared → refund mode if ≥ 2 humans. DT: shared draw → standard reroll/refund.
- σ: main bets ≈ 1.0 (LOW); War tie 2.88, DT tie 3.15 (MEDIUM), suited tie 6.57 (HIGH).

### 10.5 Charm hooks (`cardwar.*`)
`cardwar.warBonus` (bool: winning a war also pays the original 1:1) · `cardwar.surrenderRefundAdd` (float added to 0.5) · `cardwar.tiePayAdd` ·
`cardwar.dtTieRefund` (bool: on a DT tie Dragon/Tiger bets push in full) · `cardwar.suitedTiePayAdd` · `table.peekCharges` = War: see the
dealer's war card before choosing war/surrender · DT: see the Dragon card's colour during OPEN.

### 10.6 Cost
Main 5–500; ties and sides 1–50. actionCost **1 per round** (a war adds none). Autoplay for DT only.

### 10.7 Controls
War: **1** go to war · **2** surrender · **Space** deal/Ready. DT: **1 / 2 / 3** quick-bet Dragon / Tiger / Tie · LMB spots · **Space** Ready.

### 10.8 State machine
War:
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| OPEN | betting | solo ∞ / shared 15 s | → DEAL |
| DEAL | one card per seat + dealer, 0.35 s each | 0.7–2.5 s | → COMPARE |
| COMPARE | flip & compare | 1.0 s | ties → TIE_DECISION; else → SETTLE |
| TIE_DECISION | war or surrender | solo ∞ / shared 10 s (default surrender) | → WAR / SETTLE |
| WAR | drums; burn 3, deal 2 per warring seat | 2.0–3.5 s | → SETTLE |
| SETTLE | chips | ≤ 2.0 s | → OPEN |
Dragon-Tiger: OPEN (solo ∞ / shared 12 s) → LOCK 0.6 s → DEAL (2 cards face down, 0.7 s) → REVEAL (Dragon 0.8 s, 0.5 s pause, Tiger 0.8 s)
→ SETTLE (≤ 2.0 s) → OPEN.

### 10.9 UI
Diegetic: cards, the two carved heads (their eyes are the winner lamps), a 7-seg history strip (D/T/tie lamps), rail meters. Overlay: war /
surrender prompt with the raise amount.

### 10.10 Multiplayer — shared-table (War 6 seats · DT 8 spots)

| Event | Extra payload |
|-------|---------------|
| `cardwar.deal` | `{to:'seat'\|'dealer', seat, card}` |
| `cardwar.tie` | `{seats:int8[], timeoutMs}` |
| `cardwar.choice` | `{seat, choice:'war'\|'surrender'}` |
| `cardwar.war` | `{burn:3, cards:[{seat, card}], dealer}` |
| `cardwar.dt` | `{dragon, tiger}` |
| `cardwar.result` | `{seats:[{seat, payout, result}]}` |
| `cardwar.peek` | `{card}` or `{red:bool}` unicast |

### 10.11 Juice
- **Sound**: WAR = taiko-like drums (sine 60 Hz with fast pitch drop + noise slap, 4 hits); the winning head roars (saw 70–90 Hz + noise,
  lowpass sweep 400 → 1500 Hz, 0.8 s); tie = cymbal clash (noise burst, highpass 4 kHz, 1.2 s decay) as both heads lunge.
- **Light**: the winning head's eyes glow `#FF2A3C` for 1.5 s; suited tie → both heads' eyes gold + W4.

### 10.12 Edge cases & anti-exploit
- A war raise must be affordable; if not, the only legal choice is surrender (button lit alone).
- DT ties pay half back on Dragon/Tiger before Tie/Suited Tie payouts (order is cosmetic; amounts are independent).

### 10.13 Tycoon
Milestones: **L10** War bonus (win a war → original also pays 1:1) · **L25** DT Tie pays 12:1 · **L50** surrender returns 60 % · **L100** DT ties
refund Dragon/Tiger in full. Staff gambler: Main + always war. Idle profile: `patronRate 3.5 · patronStake 0.06 · houseEdge 0.035`.
Overheat: the heads breathe smoke; ties pay +2 for 3 rounds.

---

## 11. Hi-Lo Ladder — `hilo` · TR "Yüksek-Alçak Merdiveni" · Tier 2

### 11.1 Fantasy, body, pose
"The Ladder of Cards": an upright cabinet 0.90 W × 0.60 D × 2.30 H m (v1.1: M slot WELL-08; this cabinet replaces ART §5.21's table version). Face: a giant **split-flap card display** (two flap cards 0.30 × 0.42 m:
CURRENT and, after a guess, NEXT), a 12-rung lamp ladder up the right side (top rung "×100+"), four brass buttons HIGHER / LOWER / SKIP /
COLLECT, each with a small 7-seg window above showing its live multiplier. Cabinet in tarnished green enamel `#2F4A3A`, brass `#C8A040`.
- Play pose: camera (0.00, 1.40, 0.55), look (0.00, 1.35, 0.00), FOV 55°.
- **Decision**: every step — higher or lower, skip, or collect. Pure press-your-luck with visible odds.

### 11.2 Rules
1. Stake S, Space: a card is drawn (infinite deck: rank uniform A=1 … K=13, suit cosmetic).
2. Guess **HIGHER-OR-SAME** or **LOWER-OR-SAME** than the current card, or **SKIP** (draw a new current card; max 3 skips per round, free).
   A guess with probability 1 is disabled (Higher on A, Lower on K) — the button stays dark.
3. Correct → running multiplier ×= the step multiplier; the new card becomes current. Wrong → bust, stake lost.
4. After any correct guess: **COLLECT** = S × running multiplier. Auto-collect when the running multiplier reaches ×1,000.

### 11.3 Step multipliers (m = floor(0.99 / p, 2 decimals); p exact)
| Current rank | Higher-or-same p | × | Lower-or-same p | × |
|---|---:|---:|---:|---:|
| A | 1 (disabled) | — | 1/13 | ×12.87 |
| 2 | 12/13 | ×1.07 | 2/13 | ×6.43 |
| 3 | 11/13 | ×1.17 | 3/13 | ×4.29 |
| 4 | 10/13 | ×1.28 | 4/13 | ×3.21 |
| 5 | 9/13 | ×1.43 | 5/13 | ×2.57 |
| 6 | 8/13 | ×1.60 | 6/13 | ×2.14 |
| 7 | 7/13 | ×1.83 | 7/13 | ×1.83 |
| 8 | 6/13 | ×2.14 | 8/13 | ×1.60 |
| 9 | 5/13 | ×2.57 | 9/13 | ×1.43 |
| 10 | 4/13 | ×3.21 | 10/13 | ×1.28 |
| J | 3/13 | ×4.29 | 11/13 | ×1.17 |
| Q | 2/13 | ×6.43 | 12/13 | ×1.07 |
| K | 1/13 | ×12.87 | 1 (disabled) | — |
Per-step RTP 98.46–99.00 % (exact). A round of n steps returns ≈ 0.99ⁿ; typical play (2–4 steps) ≈ 96–98 %. Variance player-chosen:
one 50/50 step σ 0.91 (LOW), one ×12.87 step σ 3.43 (MEDIUM), deep ladders HIGH–EXTREME.

### 11.4 RNG, luck
Each card is an independent draw (rank weights base 100 each). **Fate draw**: the card that would bust you is redrawn once with
probability L/100 (invisible, tag `lucky`). **Near miss**: bust by exactly one rank → `nearmiss`.

### 11.5 Charm hooks (`hilo.*`)
`hilo.skipAdd` (int) · `hilo.stepRtpAdd` (float added to 0.99, cap 1.02) · `hilo.safetyNet` (charges: the first bust in a round refunds
50 % of the current collect value) · `hilo.sameBonus` (float: exact-rank hits multiply the step by 1 + x) · `hilo.startMult` (float: the
ladder starts at ×(1 + x)) · `table.peekCharges` = a lamp tells whether the next rank is ≥ 7 (owner only).

### 11.6 Cost
5–200. actionCost **1 per round** (any number of steps). No autoplay; F fast allowed.

### 11.7 Controls
**1 / W / mouse wheel up** Higher · **2 / S / wheel down** Lower · **3** Skip · **Q** Collect · **Space** Deal · LMB on the brass buttons.
(Wheel is reassigned from chip size while a round is live.)

### 11.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| STAKE | idle | ∞ | Space → DEAL |
| DEAL | flaps clatter to the first card | 0.6 s | → GUESS |
| GUESS | await | ∞ | guess → REVEAL; skip → SKIP; Q → COLLECT |
| SKIP | current card flaps to a new one | 0.6 s | → GUESS |
| REVEAL | NEXT flaps cascade, 0.4 s hold before the last flap | 0.9 s | correct → STEP; wrong → BUST |
| STEP | a rung lamp climbs, NEXT slides into CURRENT | 0.4 s | → GUESS (or COLLECT at ×1,000) |
| BUST | flaps go blank, lamps fall | 1.5 s | → STAKE |
| COLLECT | coins pour into the tray | 1.5 s | → STAKE |

### 11.9 UI
Diegetic: flap cards, multiplier windows above HIGHER/LOWER, the ladder (one lamp per step; the top lamp lights at ×100+), rail meter
(WIN = current collect value). Overlay: optional probability % under each multiplier (setting, default on).

### 11.10 Multiplayer — solo-occupant

| Event | Extra payload |
|-------|---------------|
| `hilo.start` | `{p, S}` |
| `hilo.card` | `{rank, suit, slot:'cur'\|'next'}` |
| `hilo.guess` | `{dir:'hi'\|'lo'}` |
| `hilo.step` | `{ok:bool, mult}` |
| `hilo.skip` | `{rank, suit, left}` |
| `hilo.collect` / `hilo.bust` | `{payout}` / `{rank, suit}` |

### 11.11 Juice
- **Sound**: split-flap clatter (noise ticks 40 Hz decelerating to 8 Hz); each rung climbed plays a tone +2 semitones above the last
  (from C4); at ≥ ×10 a detuned saw chorus pad fades in; at ≥ ×50 a heartbeat (sine 50 Hz). Bust = flaps flip to blank with a descending
  power-down sweep 800 → 40 Hz while rung lamps fall one by one (0.05 s each).
- **Light**: ladder lamps `#FFC83D`; at ×100+ the cabinet marquee strobes 6 Hz.
- **Big win**: collecting ≥ ×10 / ×25 / ×50 → shared tiers.

### 11.12 Edge cases & anti-exploit
- Cards are generated at reveal time on the host (each draw is independent, so there is nothing to peek ahead).
- Disconnect / stand-up in GUESS with ≥ 1 step = auto-collect; with 0 steps = stake refunded.

### 11.13 Tycoon
Milestones: **L10** 4 skips · **L25** step RTP 0.995 · **L50** "Ace bridge": ties on A or K always count as wins · **L100** +5 % on collects ≥ ×10.
Staff gambler: collects at ≥ ×2. Idle profile: `patronRate 3.0 · patronStake 0.10 · houseEdge 0.025`. Overheat: lamps gold; step RTP +1 pp
for 3 rounds.

---

## 12. Keno Lounge — `keno` · TR "Keno Salonu" · Tier 2

### 12.1 Fantasy, body, pose
A lounge corner: four writing desks with brass-framed CRT **ticket writers** (0.30 m screens, 8×10 number grids, light pen on a cord), and a
wall board 3.00 × 1.50 m with 80 numbered lamps (8 rows × 10). The draw is electrical: a **relay brain** cabinet beside the board clacks as
it "thinks" each number. (Lotto owns the physical balls; keno owns relays and lamps.)
- Play pose (a desk): camera (0.00, 1.20, 0.50) at the CRT, FOV 55°; V = board cam.
- **Decision**: how many spots (1–10) — frequent small wins vs. a 1-in-8.9-million dream; multi-draw commitment.

### 12.2 Rules
Pick 1–10 numbers from 1–80 (or Quick Pick), stake per draw, choose 1 / 5 / 10 / 20 consecutive draws. 20 numbers are drawn; the ticket
pays by (spots, hits). Up to 4 tickets per draw (more with the `seats` track).

### 12.3 Paytable (gross × stake; P = hypergeometric over C(80,20); exact)
| Spots | Pays (hits → ×) | P(any win) | RTP | σ |
|---:|---|---:|---:|---:|
| 1 | 1 → ×3.8 | 25.00 % | 95.00 % | 1.65 |
| 2 | 2 → ×10 · 1 → ×0.9 | 43.99 % | 94.30 % | 2.33 |
| 3 | 3 → ×44 · 2 → ×2.4 | 15.26 % | 94.35 % | 5.17 |
| 4 | 4 → ×120 · 3 → ×6 · 2 → ×1.5 | 25.89 % | 94.60 % | 6.73 |
| 5 | 5 → ×600 · 4 → ×25 · 3 → ×3 | 9.67 % | 94.11 % | 15.48 |
| 6 | 6 → ×2,000 · 5 → ×100 · 4 → ×8.5 · 3 → ×1 | 16.16 % | 93.99 % | 23.41 |
| 7 | 7 → ×7,000 · 6 → ×250 · 5 → ×25 · 4 → ×4 · 3 → ×1 | 23.66 % | 95.36 % | 35.31 |
| 8 | 8 → ×25,000 · 7 → ×1,500 · 6 → ×90 · 5 → ×12 · 4 → ×2 | 10.23 % | 94.50 % | ≈ 55.7 |
| 9 | 9 → ×50,000 · 8 → ×5,000 · 7 → ×300 · 6 → ×40 · 5 → ×7 · 4 → ×1 | 15.31 % | 94.78 % | 51.85 |
| 10 | 10 → ×200,000 · 9 → ×10,000 · 8 → ×1,000 · 7 → ×150 · 6 → ×20 · 5 → ×3 · **0 → ×2** | 11.05 % | 93.62 % | 72.64 |
Top-prize odds: 5/5 1 in 1,551 · 7/7 1 in 40,979 · 8/8 1 in 230,115 · 10/10 1 in 8,911,711. `jackpot` tag = top prize on 7+ spots.

### 12.4 RNG, luck
20 numbers drawn without replacement (integer weights base 100 per number). Luck: reroll the whole draw (solo) / refund (≥ 2 humans on
the draw). Near miss: one hit short of the top prize on 6+ spots → `nearmiss`.

### 12.5 Charm hooks (`keno.*`)
`keno.extraNumber` (int: a 21st/22nd number is drawn publicly but counts only for the charm owner's tickets) · `keno.spotWeight[n]` (int add;
**solo draws only**, ignored when another human holds a ticket on the draw) · `keno.payAdd[spots][hits]` (float) · `keno.zeroHitPay` (float:
0 hits pays this on 8+ spots) · `keno.quickPickLuck` (int luck for Quick-Pick tickets) · `table.peekCharges` = reveal 1 of the 20 numbers
before the ticket locks (the draw is pre-rolled when a peek is held).

### 12.6 Cost
1–100 per ticket per draw. actionCost **1 per draw participated** (not per ticket; a 20-draw ticket costs 20, charged per draw).
Autoplay = multi-draw.

### 12.7 Controls
LMB toggles numbers on the CRT · **1** Quick Pick (fills to the current spot count) · **2** cycle spot count 1–10 · **3** draws ×1/5/10/20 ·
**4** next ticket slot · **Backspace** clear · **Space** play (solo: draw now; shared: submit for the next draw) · **V** board cam.

### 12.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| TICKET | editing | solo ∞ / shared: until the lounge's next close | → LOCK |
| LOCK | relays arm (clunk) | 0.5 s | → DRAW |
| DRAW | 20 numbers, one per 0.45 s (F: 0.20 s solo) | 9.0 s | → TALLY |
| TALLY | hit numbers stamp on tickets | 1.0 s | → PAYOUT |
| PAYOUT | count-up | ≤ 2.5 s | multi-draw → LOCK after 1.5 s; else → TICKET |
Shared cadence: one lounge draw every 25 s while any ticket is live (sales close 3 s before LOCK).

### 12.9 UI
Diegetic: CRT ticket (picked numbers inverted, hits stamped red `#FF3B30`), wall board lamps, relay brain lamps, a "DRAW #" 7-seg, rail
meter per desk. Overlay: paytable for the selected spot count, hit counter.

### 12.10 Multiplayer — shared-draw
Per-player `{tickets:[{slot, picks:int8[], stake, drawsLeft}]}`.

| Event | Extra payload |
|-------|---------------|
| `keno.ticket` | `{p, slot, picks:int8[], stake, draws}` |
| `keno.close` | `{drawNo, t}` |
| `keno.draw` | `{drawNo, numbers:int8[20], stepMs, extra?:{p, numbers:int8[]}}` |
| `keno.result` | `{p, slot, hits, payout}` |
| `keno.peek` | `{n}` unicast |

### 12.11 Juice
- **Sound**: per number a relay clack (square 60 Hz burst 8 ms + noise) then a lamp "bloop" (sine 440 → 880 Hz, 40 ms); a hit on your ticket
  adds a brighter ding stepping up a pentatonic scale per hit; 0-hit pay on 10 spots = a sarcastic kazoo-like square wobble.
- **Light**: board lamps `#FFB347`; your hits blink 4 Hz; 6+ hits on 8+ spots → W3; top prize → the whole board chases (W5).

### 12.12 Edge cases & anti-exploit
- Tickets cannot change after LOCK; multi-draw tickets keep the same picks. Leaving keeps multi-draw tickets running (settled to the wallet).
- `spotWeight` is ignored on shared draws so one player's charm never biases another's numbers.

### 12.13 Tycoon
Milestones: **L10** hot/cold number lamps · **L25** 0 hits on 8–9 spots pays ×1 · **L50** one free extra number for the owner every draw ·
**L100** 10/10 pays ×400,000. Staff gambler: Quick-Pick 4 spots. Idle profile: `patronRate 2.4 · patronStake 0.05 · houseEdge 0.055`.
Overheat: board lamps go red; `keno.extraNumber +1` for 3 draws.

---

## 13. Mechanical Rat Derby — `derby` · TR "Mekanik Fare Derbisi" · Tier 2

### 13.1 Fantasy, body, pose
"The Rat Run": a glass-topped track 4.00 × 1.20 m on legs (track height 0.90 m), six slot lanes with clockwork tin rats (0.12 m long), a
starting gate with a bell, a finish line with a flash-camera, and a split-flap **tote board** above (odds per rat and bet type). Betting
console along the rail: 6 rat buttons × bet-type buttons. Cosmetic variant "horses" for a later floor uses the same rules.
Rats (original): 1 **Gutter Saint** `#C0392B` · 2 **Brass Tooth** `#D4AC0D` · 3 **Little Arson** `#E67E22` · 4 **Widow's Pet** `#8E44AD` ·
5 **Drainpipe** `#2E86C1` · 6 **The Accountant** `#27AE60`.
- Play pose: camera (0.00, 1.50, 1.30) looking down the track, FOV 60°. V = follow cam on the leader.
- **Decision**: favourite vs long shot; win vs place vs exotic; reading form (cosmetic history) vs odds (real).

### 13.2 Rules
1. ODDS: each race the six strengths `{0.6, 1.0, 1.4, 2.0, 2.8, 4.0}` are shuffled among the rats; the tote board shows the resulting odds.
2. OPEN: bet **Win** (1st), **Place** (1st or 2nd), **Exacta** (1st and 2nd in order), **Quinella** (1st and 2nd any order).
3. RACE: the finishing order is sampled by Plackett–Luce: winner with probability sᵢ/Σs, removed, repeat for 2nd, etc.
4. Bets pay the decimal odds (gross ×) printed at LOCK.

### 13.3 Odds (pays) — margin 10 % on Win/Place, 15 % on exotics
odds = floor(margin / p, 1 decimal), minimum ×1.1, where margin = 0.90 (Win/Place) or 0.85 (Exacta/Quinella).

| Strength | P(win) | Win × | P(place) | Place × |
|---:|---:|---:|---:|---:|
| 0.6 | 5.08 % | ×17.7 | 11.5 % | ×7.8 |
| 1.0 | 8.47 % | ×10.6 | 18.8 % | ×4.7 |
| 1.4 | 11.86 % | ×7.5 | 25.8 % | ×3.4 |
| 2.0 | 16.95 % | ×5.3 | 35.7 % | ×2.5 |
| 2.8 | 23.73 % | ×3.7 | 47.4 % | ×1.8 |
| 4.0 | 33.90 % | ×2.6 | 60.9 % | ×1.4 |
Exacta examples: 4.0 then 2.8 p = 12.17 % → ×6.9; 0.6 then 1.0 p = 0.454 % → ×187.0. RTP: Win/Place ≈ 90 %, exotics ≈ 85 %.
σ: favourite win 1.23 (LOW), longest shot win 3.9 (MEDIUM), weakest exacta 12.6 (EXTREME).

### 13.4 RNG, luck
Order sampled at LOCK. Luck: reroll the race order (solo) / refund (≥ 2 humans). Race animation: 14.0 s; finishing times: winner
12.8–13.6 s, gaps 0.08–0.60 s; positions keyframed every 0.5 s (28 frames) from a noisy speed profile time-warped to hit those finish
times (lead changes guaranteed ≥ 1 per race). **Photo finish** when the 1–2 gap < 0.10 s. Near miss: your Win pick finishes 2nd by
< 0.10 s → `nearmiss`.

### 13.5 Charm hooks (`derby.*`)
`derby.runnerWeight[lane]` (float add to strength; solo draws only) · `derby.oddsBonus` (float: +x % to the owner's printed odds) ·
`derby.deadHeat` (bool: losing a photo finish with your Win pick = dead heat, paid at half odds) · `derby.longshotBonus` (float: odds ≥ ×10
pay +x %) · `derby.exactaInsurance` (bool: exacta in reverse order refunds the stake) · `table.peekCharges` = reveal which rat finishes **last**.

### 13.6 Cost
1–200 per bet, 1,000 per race. actionCost **1 per race** with ≥ 1 bet. No autoplay.

### 13.7 Controls
**1–6** pick rat · **Shift+1–6** second pick (exotics) · **7** Win · **8** Place · **9** Exacta · **0** Quinella · LMB on console buttons ·
**Space** place bet with the selected chip / Ready · **V** follow cam.

### 13.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| ODDS | tote board flips | 1.5 s | → OPEN |
| OPEN | betting | solo ∞ / shared 20 s | → LOCK |
| LOCK | gate bell rings once | 0.6 s | → GATES |
| GATES | rats wound, gate drops | 0.8 s | → RACE |
| RACE | keyframed run | 14.0 s | → PHOTO (if photo) / RESULT |
| PHOTO | flash, freeze-frame, the board blinks "PHOTO" | 1.0 s | → RESULT |
| RESULT | board shows 1-2-3 | 2.0 s | → PAYOUT |
| PAYOUT | count-up | ≤ 2.5 s | → RESET |
| RESET | rats ratchet back to the gate | 3.0 s | → ODDS |
Shared cadence ≈ 46 s per race; SP starts on demand.

### 13.9 UI
Diegetic: tote board (win odds per rat, place odds, last 10 winners), betting console lamps, rail meter. Overlay: exotic odds grid
(6 × 6 / 15 pairs) via H, bet slip list.

### 13.10 Multiplayer — shared-draw (unlimited bettors along the rail)

| Event | Extra payload |
|-------|---------------|
| `derby.odds` | `{raceNo, win:float[6], place:float[6], exacta:float[30], quinella:float[15]}` |
| `derby.bet` | `{p, type:'win'\|'place'\|'exacta'\|'quinella', picks:int8[], amount}` |
| `derby.race` | `{raceNo, frames:float[28][6], order:int8[6], photo:bool}` |
| `derby.result` | `{order, payouts:[{p, amount}]}` |
| `derby.peek` | `{last:int}` unicast |

### 13.11 Juice
- **Sound**: each rat's clockwork whirr (saw 60 Hz × speed, lowpass 1 kHz, panned to its lane); start bell (FM); tote flaps; overtakes →
  squeak (sine chirp 2 → 3 kHz, 60 ms); finish = chequered lamp chase + bell; photo = shutter click + white flash; long-shot win (≥ ×10) → W3.
- **Light**: lane strips light in each rat's colour as it leads; winner's lane strobes 3 s.

### 13.12 Edge cases & anti-exploit
- Odds are fixed at LOCK (no pari-mutuel drift). The race order is in `derby.race`; safe because bets are locked.
- `runnerWeight` is ignored on shared draws; odds printed for everyone are computed from unmodified strengths.

### 13.13 Tycoon
Milestones: **L10** 7th runner "The Albino" `#E8E0C8` (strength 0.6–4.0 random each race) · **L25** Win/Place margin 0.92 · **L50** Trifecta
unlocked (margin 0.85) · **L100** the owner names a rat; it gets +10 % strength (odds update honestly). Idle profile: `patronRate 1.3 ·
patronStake 0.05 · houseEdge 0.11`. Overheat: your picks' rats run with sparks; `derby.oddsBonus +10 %` for 3 races.

---

## 14. Fortune-Teller Automaton (omen gamble) — `fortuneteller` · TR "Falcı Otomatı 'Güve Ana'" · Tier 2

### 14.1 Fantasy, body, pose
"Mother Moth": a glass booth 1.00 × 0.80 × 2.20 m; inside, a veiled automaton with folded moth wings and porcelain hands, a crystal ball that
lights from within, a brass card slot that deals onto a velvet shelf. Coin slot and three brass veil-buttons on the booth front.
- Play pose: camera (0.00, 1.40, 0.60), look at the shelf (0.00, 1.05, 0.10), FOV 55°.
- **Decision**: which veil; whether to **Defy Fate** (pay again to escape a curse or chase a better omen). The teller is the game's bridge
  between gambling and the buff system: half of her value is in blessings and curses.

### 14.2 Rules — "Three Veils"
1. Stake S. The teller shuffles the 22-card **Omen deck** and lays three face-down cards (Past · Present · Future, names cosmetic).
2. Pick one; it is revealed: pays S × coin multiplier and applies its omen.
3. **Defy Fate** (once, within 6 s): pay another S to void the revealed card (coins and omen) and pick one of the remaining two (final).
4. The unpicked cards are then revealed ("what might have been").

### 14.3 Omen deck (22 cards; buff ids `buff.omen.<id>`, plays = rounds on any device)
| # | Omen (EN) | TR | Coin × | Omen effect |
|--:|-----------|----|------:|-------------|
| 0 | The Pit | Çukur | 0 | CURSE: luck −10 for 5 plays |
| 1 | The Moth | Güve | 0 | — |
| 2 | The Debtor | Borçlu | 0 | CURSE: current quota/debt +2 % |
| 3 | The Cracked Bell | Çatlak Çan | 0 | CURSE: your next win's net is halved |
| 4 | The Empty Purse | Boş Kese | 0 | — |
| 5 | The Drowned Lamp | Boğulmuş Lamba | 0 | — |
| 6 | The Rat King | Fare Kral | 0 | BLESSING: your next losing bet (≤ 100 coins × limits) is refunded |
| 7 | The Lantern | Fener | 0 | BLESSING: luck +5 for 5 plays |
| 8 | The Mirror | Ayna | 0 | repeats your previous omen's effect (none → nothing) |
| 9 | The Hollow Coin | Kof Sikke | 0.5 | — |
| 10 | The Staircase | Merdiven | 0.5 | BLESSING: luck +3 for 10 plays |
| 11 | The Key | Anahtar | 0.5 | BLESSING: next charm purchase −30 % |
| 12 | The Clock | Saat | 0.5 | BLESSING: refund 1 actionCost |
| 13 | The Twins | İkizler | 1 | BLESSING: next win's net ×1.5 |
| 14 | The Lamb | Kuzu | 1 | BLESSING: next loss refunded 50 % |
| 15 | The Wheel | Çark | 1 | — |
| 16 | The Gambler | Kumarbaz | 1 | — |
| 17 | The Furnace | Fırın | 1.5 | CURSE: luck −5 for 3 plays |
| 18 | The Crown | Taç | 1.5 | — |
| 19 | The Hanged Croupier | Asılı Krupiye | 2 | CURSE: luck −10 for 3 plays |
| 20 | The Eye | Göz | 3 | BLESSING: luck +10 for 5 plays |
| 21 | The Grand Omen | Büyük Kehanet | 5 | BLESSING: a random common charm, free |
Coin RTP = 19 / 22 = **86.36 % (exact)**, σ 1.19 (LOW). 7 blessings, 5 curses, 10 neutral (+ Mirror). The GDD values blessings; at
default tuning the reading is ≈ break-even including omens.

### 14.4 RNG, luck
Deck shuffled per reading on the host; the 3 face-down cards are the first 3. Luck (reroll mode): if the picked card has coin < 1 **or** is
a curse, with probability L/100 it is swapped (invisibly) with a random non-curse card from the 19 undealt cards. Near miss: The Grand Omen
was one of the two unpicked cards → `nearmiss`.

### 14.5 Charm hooks (`fortuneteller.*`)
`fortuneteller.omenWeight[id]` (int add; base 1 card each — implemented as duplicates in the deck) · `fortuneteller.defyCostMult` (float ×) ·
`fortuneteller.seeVeil` (charges: one of the three is shown before you pick) · `fortuneteller.curseImmunity` (charges: a curse is ignored) ·
`fortuneteller.omenDurationMult` (float ×) · `fortuneteller.grandOmenRarity` (upgrades the free charm's rarity) · `table.peekCharges` =
`seeVeil`.

### 14.6 Cost
10–200 per reading; Defy costs S again (same round, no extra actionCost). actionCost **1 per reading**. No autoplay.

### 14.7 Controls
**1 / 2 / 3** or LMB on a card = pick · **4** Defy Fate · **Space** insert coin / start · **H** omen almanac (all 22 cards, EN/TR).

### 14.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| SLEEP | idle; wings twitch every 6–12 s | ∞ | Space → AWAKEN |
| AWAKEN | eyes open, crystal glows | 1.5 s | → SHUFFLE |
| SHUFFLE | hands flutter | 1.8 s | → DEAL |
| DEAL | three cards slide out | 3 × 0.5 s | → PICK |
| PICK | await | ∞ | → REVEAL |
| REVEAL | card flips, omen name on the card, chime/curse sting | 1.2 s | → DEFY_WINDOW |
| DEFY_WINDOW | prompt | 6 s (or 1 to continue) | 4 → PICK2; else → APPLY |
| PICK2 | pick one of two | ∞ | → REVEAL2 (1.2 s) → APPLY |
| APPLY | coins + buff applied | 1.0 s | → OTHERS |
| OTHERS | remaining cards flip | 1.5 s | → SLEEP |

### 14.9 UI
Diegetic: cards (48×64 px omen art per card on canvas), crystal ball colour = omen type (gold blessing `#FFC83D`, violet curse `#7A2A9A`,
grey neutral), rail meter. Overlay: omen text card (EN/TR) with duration, buff icon fly-in to the HUD.

### 14.10 Multiplayer — solo-occupant (watchers see the cards)

| Event | Extra payload |
|-------|---------------|
| `fortuneteller.start` | `{p, S}` |
| `fortuneteller.pick` | `{slot}` |
| `fortuneteller.reveal` | `{slot, omen}` |
| `fortuneteller.defy` | `{slot2}` |
| `fortuneteller.apply` | `{omen, coins, buff}` |
| `fortuneteller.others` | `{slots:[[slot, omen]]}` |
| `fortuneteller.veil` | `{slot, omen}` unicast (`seeVeil`) |

### 14.11 Juice
- **Sound**: theremin-like sine with 5.5 Hz vibrato improvising during the shuffle; wing flutter (noise AM at 18 Hz); reveal = whispered
  sting (noise through two formant bandpasses); curse = reverse cymbal + screen tint `#3B0A45` for 0.6 s; blessing = glass chime cluster.
- **Light**: crystal ball pulses at 0.5 Hz while waiting; Grand Omen floods the booth white and the wings spread (W3 + charm reveal).

### 14.12 Edge cases & anti-exploit
- Deck order never leaves the host; only revealed cards are sent. `seeVeil` is unicast.
- Mirror after Mirror = nothing. Debt-type curses in Free Casino mode convert to luck −5 for 5 plays.
- Leaving during PICK = auto-pick slot 1; during DEFY_WINDOW = no defy.

### 14.13 Tycoon
Milestones: **L10** Defy costs 0.75 S · **L25** almanac shows remaining-deck odds · **L50** curses last half as long · **L100** The Grand Omen
gives an uncommon charm. Staff: none (omens are personal). Overheat: the teller hums; blessing durations ×1.5 for 3 readings.

---

## 15. Coin-Flip Booth — `coinflip` · TR "Yazı-Tura Kabini" · Tier 2

### 15.1 Fantasy, body, pose
A glass booth (v1.1: 0.78 × 0.78 × 2.00 m to fit the S slots; ART §5.28 bell-jar styling) phone-booth style, with a mechanical **thumb** on a lever and a giant brass coin Ø 0.12 m: faces
**CROWN** (Taç) and **SKULL** (Kafatası). The coin lands on a felt pad with a narrow edge groove. 10 neon segments `#2AF0FF` around the
booth frame count ride streaks.
- Play pose: camera (0.00, 1.45, 0.50), look at the pad (0.00, 1.00, 0.00), FOV 55°.
- **Decision**: call, ride or collect — the simplest double-or-nothing in the pit — and the 1-in-50 edge.

### 15.2 Rules
1. Stake S, call CROWN, SKULL or EDGE.
2. The thumb flips the coin: P(CROWN) = P(SKULL) = 0.49, P(EDGE) = 0.02.
3. CROWN/SKULL calls pay 1:1; EDGE pays 47:1; an EDGE result loses CROWN/SKULL calls.
4. **Ride**: after a win you may re-stake the whole payout on a new call (up to 10 rides) or **Collect**.
5. **Duel "Call It"** (two humans): both stake S; the caller calls; the coin decides; the winner takes 2S; an EDGE result sends both stakes
   to the House.

### 15.3 Payouts
| Call | Pays | P | RTP (exact) | σ |
|------|-----:|--:|----:|--:|
| CROWN / SKULL | 1:1 | 0.49 | 98.00 % | 1.00 |
| EDGE | 47:1 | 0.02 | 96.00 % | 6.72 |
| Ride n times | 2^(n+1) × S | 0.49^(n+1) | 0.98^(n+1) | grows |
10 consecutive wins (1,024 × S: first flip + 9 rides) tags `streak:10` and lights all neon ("Golden Thumb", cosmetic + bounty hook).

### 15.4 RNG, luck
One weighted draw per flip (CROWN 49 / SKULL 49 / EDGE 2). Luck: reroll a losing flip with probability L/100 (in a duel: no luck — both are
human). Near miss: the coin teeters on its edge for 0.8 s and falls to the losing face → `nearmiss` (cosmetic teeter on 10 % of losses).

### 15.5 Charm hooks (`coinflip.*`)
`coinflip.edgeWeightAdd` (int added to EDGE's 2, taken evenly from the faces) · `coinflip.edgePayAdd` (int) · `coinflip.faceWeight[crown|skull]`
(int add) · `coinflip.rideCapAdd` (int) · `coinflip.streakBonus` (float: +x × S paid at streak 5 and 10) · `coinflip.reflip` (charges, §1.6a) · `table.peekCharges` = the thumb
twitches if the next flip is CROWN (owner only, 80 % reliable).

### 15.6 Cost
1–500. actionCost **1 per new stake** (rides are free). Autoplay (G) for single flips only, no rides.

### 15.7 Controls
**1** CROWN · **2** SKULL · **3** EDGE · **Space** flip (or **LMB-drag up** on the lever) · **R** ride (same call as before) / **1–3 then Space**
ride with a new call · **Q** collect.

### 15.8 State machine
| State | Enter | Duration | Exit → |
|-------|-------|---------:|--------|
| STAKE | idle | ∞ | call + Space → WIND |
| WIND | thumb cocks | 0.4 s | → FLIP |
| FLIP | airtime, 6–12 rotations | 1.1–1.6 s | → LAND |
| LAND | thud + wobble (edge: 1.2 s teeter) | 0.5–1.2 s | → RESULT |
| RESULT | face lamp | 0.8 s | win → RIDE_OR_COLLECT; loss → STAKE |
| RIDE_OR_COLLECT | neon segment lights | ∞ (duel: n/a) | R → WIND; Q → COLLECT |
| COLLECT | coins pour | 1.2 s | → STAKE |

### 15.9 UI
Diegetic: coin, pad, neon streak segments, CROWN/SKULL/EDGE lamps above the pad, rail meter (WIN = ride value). Overlay: ride/collect hint
with the current value.

### 15.10 Multiplayer — solo-occupant + duel (2 sides of the booth)

| Event | Extra payload |
|-------|---------------|
| `coinflip.call` | `{p, side:'crown'\|'skull'\|'edge', S, ride:int}` |
| `coinflip.flip` | `{result, spins, airMs, wobbleSeed, teeter:bool}` |
| `coinflip.collect` | `{p, payout}` |
| `coinflip.duel` | `{caller, other, S}` |

### 15.11 Juice
- **Sound**: thumb "tink" (sine 3.2 kHz + 5.1 kHz partial, 0.6 s decay); coin whirr (bandpass noise AM at the rotation rate); land = felt
  thud + metallic ring (sine 1.9 kHz, 0.8 s); edge = long teetering ring, then a gong heard pit-wide (−18 dB).
- **Light**: each ride win lights one neon segment and raises the booth's hum pitch; streak 10 → W4 and the neon cycles gold.

### 15.12 Edge cases & anti-exploit
- Ride value is escrowed on the host between flips; disconnect during RIDE_OR_COLLECT = collect.
- Duel stakes escrowed for both; an EDGE in a duel is a loss for both (tag `pvp`, House keeps 2S).

### 15.13 Tycoon
Milestones: **L10** EDGE pays 50:1 · **L25** ride cap 15 · **L50** streak 5 pays +1 × S bonus · **L100** CROWN pays 1.05:1. Staff gambler: single
CROWN flips. Idle profile: `patronRate 6.0 · patronStake 0.08 · houseEdge 0.020`. Overheat: the neon turns red; EDGE weight ×2 for 3 flips.

---

## 16. Three Card Poker — `threecard` · TR "Üç Kart Poker" · Tier 3

### 16.1 Fantasy, body, pose
A half-moon table 1.80 × 0.90 m, green felt `#1F5A3A`, 6 seats (Ante, Play, Pair Plus circles each). The dealer, "the Shuffler", is a
mannequin whose torso is a mechanical card shuffler (a brass box with a whirring slot). One deck, reshuffled every hand. An engraved
placard "Q · 6 · 4" sits in front of the dealer (lights only with milestone L10).
- Play pose: camera (0.00, 1.18, 0.70), FOV 60°.
- **Decision**: Play or Fold each hand (optimal: play Q-6-4 or better); whether to add Pair Plus.

### 16.2 Rules
1. Ante (and/or Pair Plus). Each seat and the dealer get 3 cards; the dealer's are face down.
2. Each player **Plays** (adds a Play bet equal to the Ante) or **Folds** (loses the Ante; Pair Plus still settles).
3. Dealer qualifies with **Q-high or better**. Not qualified → Ante pays 1:1, Play pushes. Qualified → higher hand wins Ante and Play 1:1;
   lower loses both; tie pushes.
4. Ante Bonus pays on your hand regardless of the dealer (if you played); Pair Plus pays on your hand regardless of anything.
Ranks (3-card): straight flush > three of a kind > straight > flush > pair > high card; A-2-3 is a straight; A-K-Q is the top straight.
Hand odds (of 22,100): SF 48 (0.217 %), trips 52 (0.235 %), straight 720 (3.258 %), flush 1,096 (4.959 %), pair 3,744 (16.94 %), high card 16,440 (74.39 %).

### 16.3 Payouts
| Bet | Pays | RTP |
|-----|------|----:|
| Ante / Play | 1:1 (rules above) | 96.63 % per Ante (house edge 3.37 %, ref; 2.01 % per total bet) |
| Ante Bonus | straight 1:1 · trips 4:1 · straight flush 5:1 | included above |
| Pair Plus | pair 1:1 · flush 3:1 · straight 6:1 · trips 30:1 · straight flush 40:1 | 92.72 % (ref) |

### 16.4 RNG, luck, variance
Single-deck shuffle per hand (commit at deal). Fate draw (solo): if the round's net < 0 the **dealer's three cards** are redrawn from the
remaining 49 once with probability L/100. Shared dealer hand with ≥ 2 humans → refund mode. σ: Ante+Play ≈ 1.6 per ante (MEDIUM), Pair Plus 2.9.

### 16.5 Charm hooks (`threecard.*`)
`threecard.pairPlusAdd[rank]` (int) · `threecard.anteBonusMult` (float) · `threecard.swapOne` (charges: swap one of your cards for the next deck
card before deciding) · `threecard.miniRoyal` (bool: suited A-K-Q pays 100:1 on Pair Plus) · `table.peekCharges` = one dealer card turned face
up for the owner (unicast).

### 16.6 Cost / 16.7 Controls
Ante 5–200, Pair Plus 1–100. actionCost **1 per hand**. No autoplay. Controls: **1** Play · **2** Fold · **3** swap (if charged) · **Space**
Deal/Ready · LMB on circles.

### 16.8 State machine
| State | Duration | Exit → |
|-------|---------:|--------|
| OPEN | solo ∞ / shared 15 s | → DEAL |
| DEAL (3 per seat + 3 dealer, 0.25 s each; shuffler whirr) | 1.5–5.3 s | → DECIDE |
| DECIDE | solo ∞ / shared 12 s (default Fold) | → REVEAL |
| REVEAL (dealer cards flip; QUALIFIES / NO QUALIFY lamp) | 0.9 s | → SETTLE |
| SETTLE (Ante, Play, Bonus, Pair Plus in that order) | ≤ 2.5 s | → OPEN |

### 16.9 UI / 16.10 Multiplayer — shared-table, 6 seats
Diegetic: cards, qualify lamp, Q-6-4 placard, rail meters. Overlay: hand rank label ("FLUSH"), play/fold hints.

| Event | Extra payload |
|-------|---------------|
| `threecard.deal` | `{seat, cards}` unicast to owner; broadcast `{seat, cards:null}` |
| `threecard.decide` | `{timeoutMs}` |
| `threecard.act` | `{seat, choice:'play'\|'fold'}` |
| `threecard.reveal` | `{dealer:int8[3], qualifies:bool, shown:[{seat, cards}]}` (folded hands stay hidden) |
| `threecard.result` | `{seats:[{seat, ante, play, bonus, pairPlus}]}` |
| `threecard.peek` | `{card}` unicast |

### 16.11 Juice
Shuffler whirr (saw 90 Hz + clicks 30 Hz), cards fan out on deal; straight flush → W4 with the Shuffler's box lid popping open in gold light;
"NO QUALIFY" → the Shuffler's head droops (servo whine down).

### 16.12 Edge cases & anti-exploit
Folded hands are never revealed. Pair Plus without Ante is allowed (no decision needed; settles at REVEAL). Disconnect = Fold.

### 16.13 Tycoon
Milestones: **L10** the Q-6-4 placard lights when your hand beats it · **L25** Pair Plus straight pays 7:1 · **L50** Ante Bonus trips 5:1 ·
**L100** mini-royal 100:1. Idle profile: `patronRate 2.2 · patronStake 0.05 · houseEdge 0.035`.

---

## 17. Red Dog (acey-deucey) — `reddog` · TR "Kırmızı Köpek (Arası)" · Tier 3

### 17.1 Fantasy, body, pose
"The Kennel": a table 1.80 × 0.90 m, burgundy felt `#5A1A1E`, 6 seats. The dealer is a dog-headed automaton in a waistcoat with a hinged
jaw; a brass spread bar with lamps 1–11 above the card spot. 6-deck shoe.
- Play pose: camera (0.00, 1.18, 0.70), FOV 60°.
- **Decision**: raise or not once the spread is known (optimal: raise on spread ≥ 7).

### 17.2 Rules (6 decks, ranks 2…A, A high)
1. Bet. Two cards are dealt face up (one shared hand for the whole table).
2. **Consecutive** ranks → push. **Pair** → a third card: three of a kind pays 11:1, otherwise push.
3. Otherwise the **spread** = number of ranks strictly between; the dog barks it. Each player may **Raise** up to their original bet.
4. Third card: strictly inside the spread → win at the spread's pay on the whole wager; otherwise lose.

### 17.3 Payouts
| Result | Pays |
|--------|-----:|
| Spread 1 | 5:1 |
| Spread 2 | 4:1 |
| Spread 3 | 2:1 |
| Spread 4–11 | 1:1 |
| Consecutive | push |
| Pair → trips | 11:1 |
| Pair → no trips | push |
RTP (exact, 6 decks): **97.20 %** raising on spread ≥ 7; 92.03 % never raising. σ ≈ 1.2 (LOW).

### 17.4 RNG, luck
Shared hand → refund mode with ≥ 2 humans; solo fate draw = the third card when it misses (reroll once, probability L/100).

### 17.5 Charm hooks (`reddog.*`)
`reddog.spreadPayAdd[spread]` (int) · `reddog.raiseMax` (float: raise up to x × original) · `reddog.pairWin` (bool: pair without trips pays 1:1) ·
`reddog.tripsPayAdd` · `table.peekCharges` = before deciding, the dog's ears tell whether the third card is above or below 8 (owner only).

### 17.6 Cost / 17.7 Controls
5–200 + raise. actionCost **1 per hand**. Controls: **1** Raise (full) · **Shift+1** raise half · **2** no raise · **Space** Ready/Deal.

### 17.8 State machine
OPEN (solo ∞ / shared 12 s) → DEAL two cards (0.8 s) → SPREAD (dog barks the count, 0.25 s per bark, max 11) → RAISE_WINDOW (solo ∞ / shared
8 s, default no raise; skipped on consecutive/pair) → THIRD (0.9 s with a 0.4 s hover) → SETTLE (≤ 2.0 s) → OPEN.

### 17.9 UI / 17.10 Multiplayer — shared-draw, 6 seats
Diegetic: spread bar lamps (lit range), cards, pay label lamp ("5:1"), rail meters. Overlay: raise prompt with win chance % (setting).

| Event | Extra payload |
|-------|---------------|
| `reddog.two` | `{c1, c2, spread, pays}` |
| `reddog.raise` | `{seat, amount}` |
| `reddog.third` | `{card}` |
| `reddog.result` | `{seats:[{seat, payout}]}` |
| `reddog.peek` | `{high:bool}` unicast |

### 17.11 Juice
The dog barks the spread (noise burst, bandpass 600 Hz, pitch glide down, one bark per rank); tail wags on wins (tail bone on a servo);
trips → howl (sine glide 400 → 700 → 500 Hz with 6 Hz vibrato) + W3; push → a short whimper and a shrug.

### 17.12 Edge cases & anti-exploit
Raises are collected simultaneously at the end of RAISE_WINDOW (no one sees others' raises before deciding). Unaffordable raise → button dim.

### 17.13 Tycoon
Milestones: **L10** spread bar shows win % · **L25** spread 1 pays 6:1 · **L50** raise up to 2× · **L100** trips pays 15:1. Idle profile:
`patronRate 3.0 · patronStake 0.05 · houseEdge 0.05` (patrons never raise).

---

## 18. Bingo — `bingo` · TR "Tombala Salonu (Bingo)" · Tier 3

### 18.1 Fantasy, body, pose
"Hall of Calls": a caller's booth with **the Caller** — a mannequin in a cardigan with a hinged jaw, cranking a wire ball cage (Ø 0.40 m,
75 wooden balls) — a flash board 2.00 × 1.00 m with 75 lamps in B·I·N·G·O columns, and 8 daub desks, each holding up to 4 cards (5×5,
B 1–15, I 16–30, N 31–45 with free centre, G 46–60, O 61–75).
- Play pose (desk): camera (0.00, 1.15, 0.45) over the cards, FOV 60°; V = caller cam.
- **Decision**: how many cards; after the main draw, whether to **buy extra balls** at the posted price.

### 18.2 Rules
1. Buy 1–4 cards at stake S each (cards generated by the host).
2. 40 balls are called (1.4 s each). Every card is evaluated for its **single best** completed pattern.
3. **Extra balls** (up to 8): offered only when one of your cards is one number away from a better pattern than it holds. Price per ball =
   ceil(1.15 × EV gain of that ball for your cards), min 1 coin (host enumerates the remaining 35 balls exactly). Buying stops at your decline.
4. Patterns: **Line** (any row, column or diagonal; free centre counts), **Corners**, **Double Line**, **Triple Line**, **X** (both
   diagonals), **Frame** (outer 16 cells).

### 18.3 Paytable (× card stake; probabilities of the best pattern at ball 40, sim 1 M cards)
| Pattern | Pays | P |
|---------|-----:|--:|
| Frame | ×250 | 0.0005 % (≈ 1 in 200,000) — `jackpot` |
| X | ×30 | 0.461 % |
| Triple Line | ×10 | 2.48 % |
| Double Line | ×2.5 | 9.65 % |
| Corners | ×1.5 | 4.90 % |
| Line | ×0.8 | 29.05 % |
| nothing | 0 | 53.5 % |
Base RTP **93.4 % (sim)**, σ 2.6 (MEDIUM). Extra balls return 1/1.15 ≈ 87 % of their price.

### 18.4 RNG, luck
All 75 balls are ordered at LOCK (host); extra balls are simply the next ones. Luck: shared → refund on losing cards; solo → reroll the
40-ball draw once with probability L/100 if the game's net < 0. Near miss: a card finishes "1 TO GO" for X or Frame → `nearmiss`.

### 18.5 Charm hooks (`bingo.*`)
`bingo.freeDaub` (charges per card: after ball 40, daub any one number) · `bingo.extraBallDiscount` (float) · `bingo.patternPayAdd[pattern]` ·
`bingo.cardSlotsAdd` (int) · `bingo.secondFree` (bool: a random second free cell per card) · `bingo.ballCountAdd` (int: the owner's cards also
count the next N balls as base balls, privately) · `table.peekCharges` = see the next extra ball before deciding to buy it.

### 18.6 Cost / 18.7 Controls
Card 2–50, 1–4 cards. actionCost **1 per game**. Controls: **1–4** zoom card · LMB on a cell = manual daub (option; auto-daub is default) ·
**Space** buy/Ready · **5** buy the offered extra ball · **Backspace** decline extras · **V** caller cam.

### 18.8 State machine
| State | Duration | Exit → |
|-------|---------:|--------|
| BUY | solo ∞ / shared 15 s | → LOCK |
| LOCK (cage spins up) | 0.8 s | → CALL |
| CALL (40 balls × 1.4 s; solo F: 0.7 s) | 56 s | → EXTRA or AWARD |
| EXTRA (per ball: OFFER ≤ 6 s → BALL 1.4 s; ≤ 8 balls) | ≤ 59 s | → AWARD |
| AWARD (patterns flash, payouts) | 2.0 s | → BUY |
Shared cadence ≈ 75–130 s per game; SP on demand.

### 18.9 UI / 18.10 Multiplayer — shared-draw, 8 desks + patrons
Diegetic: flash board, daubed cards (daub colour = seat colour), a "1 TO GO" amber blink `#FFB000`, ball count 7-seg, rail meter. Overlay:
extra-ball offer card (price, which pattern it can complete), pattern legend.

| Event | Extra payload |
|-------|---------------|
| `bingo.cards` | `{p, cards:[{id, grid:int8[25]}]}` |
| `bingo.call` | `{idx, n}` |
| `bingo.pattern` | `{p, cardId, pattern}` (broadcast shout) |
| `bingo.offer` | `{p, idx, price, target}` unicast |
| `bingo.buy` | `{p, idx}` |
| `bingo.extra` | `{idx, n}` (public; applies only to buyers) |
| `bingo.award` | `{p, cards:[{id, pattern, payout}]}` |
| `bingo.peek` | `{n}` unicast |

### 18.11 Juice
Cage tumble (noise impulses through a comb filter, rate = crank speed), ball pop (sine 400 Hz 20 ms + wood click), the Caller's jaw opens and
plays a two-tone call (column pitch B–O = C4 D4 E4 G4 A4, then the number's tone); daub thump (sine 120 Hz 30 ms); pattern = party horn
(square glide) + paper-dot confetti; Frame = W5 and the Caller stands up for the first time.

### 18.12 Edge cases & anti-exploit
Ball order stays host-side; offers are computed from public info + your cards only. Extra-ball decisions are private and simultaneous.
Manual-daub mode never loses a prize (the host evaluates real calls); it is cosmetic engagement.

### 18.13 Tycoon
Milestones: **L10** "1 TO GO" helper on all cards · **L25** 5 cards · **L50** 41 base balls · **L100** Frame pays ×500. Idle profile:
`patronRate 0.8 games/min · patronStake 0.05 × 3 cards · houseEdge 0.07`.

---

## 19. Lotto Ball Blower — `lottoblower` · TR "Loto Küresi 'Nefes'" · Tier 3

### 19.1 Fantasy, body, pose
"The Breath of the House": a 1.20 m acrylic sphere holding 30 white balls (Ø 0.050 m, black numbers) tumbled by air, a transparent tube that
lifts drawn balls into a display rack, and a small 0.50 m sphere with 8 red **Moon** balls. A 10-digit 7-seg jackpot counter tops the frame.
A ticket kiosk (CRT + lever) stands beside it.
- Play pose (kiosk): camera (0.00, 1.30, 0.50), FOV 55°; V = sphere cam.
- **Decision**: how many lines, which numbers (pure superstition), when to chase the progressive.

### 19.2 Rules
Pick 5 numbers from 1–30 and 1 Moon from 1–8 per line (Quick Pick available). Line price 5 coins (× limits). Draw: 5 main balls, then 1 Moon.
Prize by (main matches, Moon match).

### 19.3 Paytable (× line price; probabilities exact)
| Match | P | Pays |
|-------|--:|-----:|
| 5 + Moon | 1 in 1,140,048 | **JACKPOT** (progressive) |
| 5 | 1 in 162,864 | ×5,000 |
| 4 + Moon | 1 in 9,120 | ×500 |
| 4 | 1 in 1,303 | ×80 |
| 3 + Moon | 1 in 380 | ×40 |
| 3 | 1 in 54.3 | ×8 |
| 2 + Moon | 1 in 49.6 | ×8 |
| 2 | 1 in 7.1 | ×1 |
| 1 + Moon | 1 in 18.0 | ×2 |
| 0 + Moon | 1 in 21.5 | ×1 |
Fixed RTP **85.97 % (exact)**; 8 % of every line feeds the jackpot (seed 20,000 lines). Long-run RTP ≈ 94 %. Variance EXTREME.

### 19.4 RNG, luck
Main draw without replacement from 30 (weights base 100), Moon from 8. Luck: shared draw → refund per losing line batch; solo → reroll the draw
once with probability L/100 if the ticket's net < 0. Near miss: 4 main + wrong Moon → `nearmiss`.

### 19.5 Charm hooks (`lottoblower.*`)
`lottoblower.extraBall` (int: N more main balls are drawn publicly but count only for the owner's lines) · `lottoblower.moonWeight[n]` (solo only) ·
`lottoblower.jackpotShare` (float: extra jackpot share on a win) · `lottoblower.freeLine` (int lines per draw) · `table.peekCharges` = reveal the
Moon ball before sales close.

### 19.6 Cost / 19.7 Controls
5 per line, 1–20 lines per draw. actionCost **1 per draw participated**. Controls: LMB numbers on the CRT · **1** Quick-Pick line · **2** add line ·
**3** quick ×5 / ×10 / ×20 lines · **Space** buy (MP) / **DRAW lever** (SP: Space or LMB-drag the lever down).

### 19.8 State machine
| State | Duration | Exit → |
|-------|---------:|--------|
| SALES | SP until the lever; MP until close | → CLOSE / BLOW |
| CLOSE (MP warning, HUD countdown pit-wide) | 10 s | → BLOW |
| BLOW (air spin-up) | 3.0 s | → DRAW |
| DRAW ×5 (valve opens, ball rises the tube, turns to show its number) | 5 × 3.0 s | → MOON |
| MOON (small sphere blows, one ball) | 5.0 s | → RESULTS |
| RESULTS (winners board, count-ups) | 5.0 s | → SALES |
MP cadence: one draw every 120 s (host setting 60–300 s).

### 19.9 UI / 19.10 Multiplayer — shared-draw
Diegetic: sphere, rack of drawn balls, jackpot counter, winners board (flip text: name, tier), kiosk CRT ticket. Overlay: your lines with
matches highlighted.

| Event | Extra payload |
|-------|---------------|
| `lottoblower.buy` | `{p, lines:[[n1,n2,n3,n4,n5,moon]]}` |
| `lottoblower.pool` | `{jackpot}` (on every sale, ≤ 4 Hz) |
| `lottoblower.close` | `{drawNo, t}` |
| `lottoblower.draw` | `{drawNo, main:int8[5], moon, extra?:{p, main:int8[]}, pathSeed}` |
| `lottoblower.result` | `{jackpot, winners:[{p, line, tier, payout}]}` |
| `lottoblower.peek` | `{moon}` unicast |

### 19.11 Juice
Blower = continuous lowpassed noise (600 Hz, slow LFO) + random ball-on-acrylic clicks (Q 20 at 4.5 kHz); valve thunk; tube whoosh (rising
bandpass sweep 300 → 2,000 Hz); a glockenspiel ding per matched number on your lines; jackpot = two-tone siren (square 440/660 Hz alternating
2 Hz), the sphere floods gold, W5 pit-wide.

### 19.12 Edge cases & anti-exploit
Lines can't change after close. Jackpot split equally among simultaneous winners. Disconnected players' lines still settle.

### 19.13 Tycoon
Milestones: **L10** Moon 1 of 7 · **L25** 3 matches pays ×10 · **L50** two Moon balls drawn (either matches) · **L100** jackpot seed ×5.
Idle profile: `patronRate 0.5 draws/min (10 lines each) · houseEdge 0.06`.

---

## 20. Tombola Raffle Drum — `tombola` · TR "Piyango Tamburu" · Tier 3

### 20.1 Fantasy, body, pose
A fairground stall 2.00 × 0.80 m (v1.1: L slot WH-02; drum per ART §5.31, hexagonal wire) with a hand-cranked wire drum (Ø 0.60 × 0.50 m) full of folded paper tickets, and a prize shelf behind with 20
lit cubbies labelled 00, 05, 10 … 95. Kept by **the Ticket Widow**, a hand puppet in black lace who pops up from behind the counter.
- Play pose: camera (0.00, 1.35, 0.60), FOV 60°.
- **Decision**: read the drum — remaining tickets vs remaining prizes (the EV is live and visible); when to buy, when to wait for a restock.

### 20.2 Rules
1. The drum holds 100 tickets numbered 00–99 (drawn without replacement). Ticket price P = 10 coins (× limits).
2. Pay, crank (≥ 1 full turn), reach in, pull, unfold. Ending in 0 or 5 → win the prize in that cubby (the cubby empties).
3. **Restock** when ≤ 30 tickets remain or all 20 prizes are gone: new 100 tickets, new prize shelf.
4. Prize shelf per restock (randomly assigned to cubbies, visible): 10 × 2P coins · 5 × 3P coins · 3 × 6P (coins or a consumable of equal
   value) · 1 × 12P (a common charm or 12P coins, player's choice) · 1 × 25P **Grand** (an uncommon charm or 25P coins).

### 20.3 RTP and variance
Full drum: prizes 90P over 100 tickets → **90.0 % (exact)**; restocking at 30 tickets left keeps the expectation at 90 % (prizes are uniformly
spread). The **live** EV = remaining prize value / remaining tickets and can exceed 100 % late in a drum — intentional drum-reading skill.
σ ≈ 2.97 per ticket (MEDIUM).

### 20.4 RNG, luck
Uniform among remaining tickets (host). Luck: reroll mode — a blank ticket is slipped back and another pulled with probability L/100.

### 20.5 Charm hooks (`tombola.*`)
`tombola.priceMult` (float) · `tombola.doublePull` (charges: pull 2 tickets, keep the better, the other returns) · `tombola.prizeMult` (float on
coin prizes) · `tombola.restockAt` (int: restock threshold, default 30) · `table.peekCharges` = "feel" the pulled ticket before unfolding: a blank
may be dropped back once and another pulled.

### 20.6 Cost / 20.7 Controls
P per ticket. actionCost **1 per ticket**. Controls: **LMB-drag circles on the crank** (Space = auto-crank) · **LMB** on the hatch = pull ·
**drag up** = unfold · **1 / 2** choose the prize option · **4** feel (peek).

### 20.8 State machine
PAY (∞) → CRANK (≥ 1 turn, ~1.5 s) → PULL (0.6 s) → UNFOLD (0.8 s) → PRIZE (1.5 s; choice ≤ 10 s) | BLANK (0.8 s) → PAY. RESTOCK (6.0 s: the Widow
refills the drum and the shelf) whenever triggered.

### 20.9 UI / 20.10 Multiplayer — solo-occupant on a shared drum
Diegetic: drum (visible paper volume), "TICKETS LEFT" 7-seg, lit cubbies (prize icon on a 32×32 canvas), rail meter, queue lamp. Overlay: prize
choice card. One puller at a time; others queue and watch; the drum state is shared.

| Event | Extra payload |
|-------|---------------|
| `tombola.pay` | `{p}` |
| `tombola.crank` | `{p, angle}` (cosmetic, ≤ 8 Hz) |
| `tombola.pull` | `{p, ticket}` |
| `tombola.prize` | `{p, cubby, prize}` |
| `tombola.restock` | `{shelf:[{cubby, prize}], tickets:100}` |
| `tombola.state` | `{remaining, shelf}` (join/snap) |

### 20.11 Juice
Drum squeak (sine chirps 1.1–1.3 kHz modulated by crank speed) + paper tumble (noise bursts); unfold crinkle; win = handbell (FM) + cubby flash +
the Widow claps; blank = the Widow shakes her head ("tch-tch", two clicks); Grand = W3 and the Widow throws paper confetti.

### 20.12 Edge cases & anti-exploit
The drum order is host-side; `tombola.state` sends only counts and the shelf. Disconnect after PULL = the ticket is unfolded and settled automatically.

### 20.13 Tycoon
Milestones: **L10** live EV gauge on the stall · **L25** restock at 20 left · **L50** a 21st prize cubby (number 50 doubled) · **L100** Grand rarity +1.
Idle profile: `patronRate 2.5 tickets/min · houseEdge 0.10`.

---

## 21. Shell-Game Automaton — `shellgame` · TR "Bardak Oyunu Otomatı 'Mösyö Yüksük'" · Tier 3

### 21.1 Fantasy, body, pose
"Monsieur Thimble": a waist-up automaton in a glass booth (1.00 × 0.70 × 2.00 m) — waxed moustache, striped vest, white gloves — with three
brass thimble-cups and a red pearl on a green felt shelf. Coin slot on the front.
- Play pose: camera (0.00, 1.30, 0.55), look at the felt (0.00, 1.00, 0.00), FOV 55°. **V is disabled during the shuffle** (fixed view for fairness).
- **Decision**: track the pearl, or call the cheat; when to walk away before the Heat makes him palm more.

### 21.2 Rules
1. Stake S (5–20). The pearl is shown under the middle cup (1.0 s), the cups cover it, then they are shuffled (swaps & speed by **Heat**).
2. Pick a cup within 8 s: pearl under it → pays 1:1. Or **Call Cheat**: if the pearl was palmed (not under any cup) → pays 3:1; otherwise lose.
3. **Heat h** = your current consecutive wins here (0–5). Walking away > 30 s or any loss resets it. After 5 consecutive wins the automaton
   **jams** ("OUT OF ORDER") until the next deadline.

| Heat | Swaps | Swap time | Palm chance c |
|---:|---:|---:|---:|
| 0 | 6 | 0.50 s | 0.15 |
| 1 | 8 | 0.42 s | 0.25 |
| 2 | 10 | 0.36 s | 0.35 |
| 3 | 12 | 0.30 s | 0.45 |
| 4 | 14 | 0.26 s | 0.55 |
| 5 | 16 | 0.22 s | 0.65 |

### 21.3 RTP and variance (skill machine)
Random guess: (1 − c)/3 × 2 → **56.7 %** at Heat 0. Perfect tracker: (1 − c) × 2 → 170 / 150 / 130 / 110 / 90 / 70 % at Heat 0–5. A palm is
visible as a 2-frame (0.067 s) sleeve glint `#FFF4C0`; a player who also catches every glint and calls it adds c × 4. Bounded by the 20-coin cap,
actionCost 2, the Heat curve and the jam. σ ≈ 1.0 (LOW).

### 21.4 RNG, luck
Host rolls palm (bool, with the swap index where it happens) and the swap list at LOCK. Luck lowers the palm chance: c' = c × (1 − L/100).

### 21.5 Charm hooks (`shellgame.*`)
`shellgame.swapSlow` (float × swap time) · `shellgame.glintFrames` (int, default 2) · `shellgame.cheatPayAdd` (int) · `shellgame.heatCap` (int: cap
Heat for difficulty) · `shellgame.secondGuess` (charges: after a wrong cup, lift one more; a hit pays 0.5:1) · `table.peekCharges` = the pearl's cup
glows for 0.3 s after the shuffle (owner only).

### 21.6 Cost / 21.7 Controls
5–20. actionCost **2 per game**. Controls: **1 / 2 / 3** or LMB on a cup = pick · **4** Call Cheat · **Space** insert coin.

### 21.8 State machine
INSERT (∞) → SHOW (1.0 s) → COVER (0.5 s) → SHUFFLE (swaps × swap time: 3.0–3.5 s) → PICK (8 s; timeout = loss) → REVEAL (1.0 s; palm: the
automaton opens his glove with the pearl) → PAY (1.0 s) → INSERT; JAMMED after the 5th straight win.

### 21.9 UI / 21.10 Multiplayer — solo-occupant
Diegetic: cups, pearl, a Heat gauge (5 brass bulbs on the booth top), rail meter. Overlay: pick timer ring.
**Streamed swaps** in MP (default): the host sends each swap just before it animates, so no client knows the final cup early; the palm event is sent
only at the glint frame.

| Event | Extra payload |
|-------|---------------|
| `shellgame.start` | `{p, S, heat}` |
| `shellgame.swap` | `{k, a, b, durMs}` (one per swap, sent 0.9 × durMs ahead) |
| `shellgame.palm` | `{k}` (at the glint frame) |
| `shellgame.pick` | `{cup \| 'cheat'}` |
| `shellgame.reveal` | `{pearlCup:-1..2, win:bool}` |
| `shellgame.jam` | `{}` |

### 21.11 Juice
Cups scrape on felt (lowpassed noise 300–900 Hz); clockwork tick 12 Hz during the shuffle, faster with Heat; a music-box loop speeds up with Heat;
reveal = pearl "ting" (sine 2.6 kHz); palm reveal = the automaton laughs (formant "ha-ha", pitched down) and wags a finger; correct cheat call = alarm
bell, the automaton freezes, sparks from the neck, pays out (W2–W3).

### 21.12 Edge cases & anti-exploit
Single-player renders from the full shuffle (only cheats yourself). MP streams swaps (above). The camera is locked during SHUFFLE. Leaving during
PICK = loss (the stake was already in the cup game).

### 21.13 Tycoon
Milestones: **L10** Heat decays 1 per minute instead of resetting · **L25** stake cap 50 · **L50** cheat call pays 4:1 · **L100** jam after 7 wins
instead of 5. Idle: not ownable for patrons (skill machine); staff gambler guesses at random (≈ 57 %, not recommended — the tooltip says so).

---

## 22. Fan-Tan — `fantan` · TR "Fan-Tan (Düğme Sayma)" · Tier 3 (addition)

### 22.1 Fantasy, body, pose
A low black-lacquer table 1.60 × 1.60 m (felt height 0.70 m) with a painted square in the centre whose sides are numbered 1–4, a heap of 200
brass buttons, a brass inverted bowl and a bone wand. The croupier, "Old Lacquer", is a kneeling automaton. 6 seats on cushions.
- Play pose: camera (0.00, 1.05, 0.75), FOV 60°.
- **Decision**: Fan (1 side) vs Kwok (2) vs Ssh (3) vs Nim (win/push) — choosing between edge and variance; a meditative suspense game.

### 22.2 Rules
1. SCOOP: the croupier scoops a random heap of N buttons under the bowl (N hidden).
2. OPEN: bets on the square. LOCK. The bowl is lifted.
3. COUNT: the wand removes buttons 4 at a time until 1–4 remain. The remainder r (1–4) wins.
4. All winning bets pay **less 5 % commission on the winnings**.

### 22.3 Bets and payouts (RTP exact)
| Bet | Spot id | Wins | Pays (before commission) | RTP |
|-----|---------|------|-----:|----:|
| Fan | `fan:n` | r = n | 3:1 | 96.25 % |
| Nim | `nim:n/m` | r = n wins, r = m pushes | 2:1 | 97.50 % |
| Kwok | `kwok:a-b` (adjacent sides 1-2, 2-3, 3-4, 4-1) | r ∈ {a, b} | 1:1 | 97.50 % |
| Odd / Even | `odd` (1, 3) / `even` (2, 4) | | 1:1 | 97.50 % |
| Ssh | `ssh:abc` (three sides) | r ∈ {a, b, c} | 1:3 | 98.75 % |
σ: Fan 1.67 (MEDIUM), Ssh 0.57 (LOW).

### 22.4 RNG, luck
Host draws r uniform 1–4 and k uniform 0–19; N = 40 + 4k + r (N uniform over 41–120, r = ((N − 1) mod 4) + 1). N is sent only at LIFT. Luck:
standard reroll / refund.

### 22.5 Charm hooks (`fantan.*`)
`fantan.sideWeight[n]` (int add; solo only) · `fantan.nimPushPays` (float: Nim push side pays x:1) · `fantan.goldenButton` (bool: milestone/charm,
see 22.13) · `table.rakeDelta` (commission) · `table.peekCharges` = N's parity before LOCK.

### 22.6 Cost / 22.7 Controls
5–500 per spot. actionCost **1 per count**. Autoplay allowed. Controls: LMB on the square (sides, corners = Kwok, edges between = Nim drag from
win side to push side) · **1–4** quick Fan · **Space** Ready.

### 22.8 State machine
SCOOP (2.0 s) → OPEN (solo ∞ / shared 15 s) → LOCK (0.6 s) → LIFT (1.0 s) → COUNT (groups of 4 every 0.35 s; after 10 groups 0.20 s; the last 12
buttons at 0.60 s per group; 5–9 s) → REVEAL (1.0 s, final buttons glow) → PAYOUT (≤ 2.0 s) → SWEEP (1.0 s) → SCOOP.

### 22.9 UI / 22.10 Multiplayer — shared-table, 6 seats
Diegetic: the square with chips, the counted groups lined up in rows of 4 (players can count along), a 7-seg history of the last 12 results, rail
meters.

| Event | Extra payload |
|-------|---------------|
| `fantan.scoop` | `{}` |
| `fantan.lift` | `{n, layoutSeed}` |
| `fantan.count` | `{stepMs:int16[]}` |
| `fantan.result` | `{r, seats:[{seat, payout, commission}]}` |
| `fantan.peek` | `{even:bool}` unicast |

### 22.11 Juice
Brass buttons clink (metallic clicks 3–6 kHz, random), wand tap per group (wood tick 900 Hz), a gong at REVEAL (sine 98 + 147 Hz, 4 s decay),
heartbeat during the last 12 buttons.

### 22.12 Edge cases & anti-exploit
N is never sent before LIFT, and bets are locked before LIFT, so counting buttons on screen gives nothing early. Commission floors with dust.

### 22.13 Tycoon
Milestones: **L10** commission 4 % · **L25** Nim push side pays 0.5:1 · **L50** Golden Button: one gold button is in the heap; if it is among the
final remainder, winning bets pay double · **L100** commission 0 %. Idle profile: `patronRate 3.0 · patronStake 0.06 · houseEdge 0.03`.

---

## 23. Put-and-Take Top — `teetotum` · TR "Al-Ver Topacı" · Tier 3 (addition)

### 23.1 Fantasy, body, pose
A round baize table Ø 1.40 m with 6 seats and a brass pot bowl; in the centre a 0.18 m brass **eight-sided spinning top** whose faces carry
language-free pictograms (arrow into the bowl = put, arrow out = take): **+1**, **+2**, **ALL+** (everyone puts 1), **−1**, **−2**, **½**, **ALL**,
**∅**. Bots are patrons with jerky wooden hands.
- Play pose: seated, camera (0.00, 1.15, 0.55), FOV 60°.
- **Decision**: stay in or sit out the next cycle (pot vs stack), and **Double** your spin (doubles your put/take amounts) when the pot is fat.

### 23.2 Rules
1. Table ante A ∈ {5, 20, 100}. At the start of a **pot cycle** every seated player antes A into the pot.
2. Turns go clockwise. On your turn spin the top; the face up when it falls:
   +1 put A · +2 put 2A · ALL+ every player puts A · −1 take A · −2 take 2A · ½ take floor(pot/2) · ALL take the whole pot (cycle ends) · ∅ nothing.
3. Before spinning you may declare **Double**: +1/+2/−1/−2 amounts are doubled for this spin (½, ALL, ALL+, ∅ unchanged).
4. A take larger than the pot takes what is there; an empty pot ends the cycle. A player who cannot afford a put sits out until the next cycle.
5. After 20 spins in one cycle, the pot is split equally among seated players.
6. Rake: 5 % of every ALL take and of the final split.

### 23.3 RTP and variance
Zero-sum between seats minus rake: **≈ 97.4 % (sim, 4 players, 400 k cycles)**. σ ≈ 2–3 antes per cycle (MEDIUM).

### 23.4 RNG, luck
Each spin: uniform 1/8 per face (weights base 100). Luck applies only against bots: a losing face (+1, +2, ALL+) on your spin is respun once
with probability L/100 when no other human is seated.

### 23.5 Charm hooks (`teetotum.*`)
`teetotum.faceWeight[face]` (int add; only when no other human is seated) · `teetotum.takeBonus` (float: +x % on your takes, paid by the House) ·
`teetotum.putShield` (charges: negate one put per cycle) · `table.rakeDelta` · `table.peekCharges` = the top wobbles toward a take face before your
spin if your next spin will be a take (80 % reliable) — helps decide Double.

### 23.6 Cost / 23.7 Controls
Ante A per cycle (puts during the cycle are part of the same round). actionCost **1 per pot cycle**. Controls: **hold LMB on the stem and flick**
(spin speed cosmetic) or **Space** auto-spin · **D** declare Double · **1** sit out next cycle · **Q** leave after this cycle.

### 23.8 State machine
ANTE (1.5 s chip toss) → TURN (8 s; auto-spin at timeout) → SPIN (2.5–5.0 s; spin, precession, fall) → APPLY (1.0 s chip moves) → next TURN … →
CYCLE_END (2.0 s) → ANTE.

### 23.9 UI / 23.10 Multiplayer — shared-table PvP, 6 seats, bots fill
Diegetic: pot bowl (chip pile), the top, each seat's stack on the rail meter, turn lamp. Overlay: face legend, Double hint.
Per-seat `{p|bot, stack, inCycle, doubled}`.

| Event | Extra payload |
|-------|---------------|
| `teetotum.ante` | `{seats:int8[], pot}` |
| `teetotum.turn` | `{seat, timeoutMs}` |
| `teetotum.double` | `{seat}` |
| `teetotum.spin` | `{seat, face, durMs, precessSeed}` |
| `teetotum.apply` | `{seat, face, moves:[{seat, delta}], pot}` |
| `teetotum.end` | `{rake, split:bool}` |

### 23.11 Juice
The top hums (sine 220 Hz + harmonics, frequency ∝ spin rate, wobble AM as it precesses), then a rattle whose click rate climbs to 30 Hz as it
falls (Euler's-disk effect) and stops dead; ALL = brass trumpet stab + chip avalanche into the winner's stack; ALL+ = every patron groans (low
formant).

### 23.12 Edge cases & anti-exploit
Outcomes fixed when the spin starts (flick is cosmetic). Disconnect = auto-spin, no Double. A player with stack < A at ANTE is sat out.

### 23.13 Tycoon
Milestones: **L10** ante 500 table · **L25** rake 4 % · **L50** "Golden face": one face per cycle glows and pays double · **L100** the owner earns
the rake of all teetotum tables. Idle profile (owner = house): rake income `patronRate 1.5 cycles/min`.

---

## 24. Appendices

### 24.1 Shared code modules this catalogue needs (`src/machines/_base/`)
| Module | Used by | Contents |
|--------|---------|----------|
| `TableBase.ts` | all | seats, OPEN/LOCK/RESOLVE/SETTLE, timers, Ready, rebet/double, chips on felt, rail meters, patrons |
| `cards.ts` | blackjack, holdem, baccarat, cardwar, threecard, reddog | deck/shoe (n decks, cut card, burn), card meshes (32×48 px), evaluators: blackjack totals, baccarat, 5/7-card poker, 3-card poker |
| `dice.ts` | craps, sicbo (+ `dicetower`) | 64 pre-baked trajectories, face-remap |
| `wheel.ts` | roulette, bigsix | decaying spin with target solve (ball/flapper), peg/deflector events |
| `draw.ts` | keno, bingo, lottoblower, tombola, fantan | without-replacement draws, schedules (shared cadence), ticket models |
| `fair.ts` | all shared | sha256 commit–reveal, FAIR lamp |
| `tableJuice.ts` | all | chip/card/dealer sounds, patron head-turns |
| `bots/` | holdem, teetotum, patrons | personalities, Monte-Carlo equity (holdem) |

### 24.2 i18n keys — v1.1: prefix `m.<id>.` (e.g. `m.fortuneteller.omen.0.name`, `m.holdem.bot.wick`, `m.derby.rat.1`), TECH §11.9
`machine.<id>.name`, `machine.<id>.desc`, `machine.<id>.spot.<spotType>`, `machine.<id>.state.<STATE>`, `machine.<id>.help.<n>`,
`omen.<n>.name`, `omen.<n>.desc`, `bot.<name>`, `rat.<n>`. All EN/TR names in this document are the initial values for `en.ts` / `tr.ts`.
Dealer automata "speak" in tones, never words (no VO localisation needed).

### 24.3 Build order (Sonnet coders, parallel-friendly)
1. `TableBase`, `cards`, `wheel`, `fair`, `tableJuice` → 2. tier 1: `roulette`, `blackjack`, `devilstable`, then `holdem` (needs bots) →
3. tier 2 in any order (`dice` before craps/sicbo; `draw` before keno/derby) → 4. tier 3. Each device ships with `simulate()` and passes the
RTP regression in §1.9.

### 24.4 Open questions for the GDD — RESOLVED in GDD v1.1: actionCost = pulls; blackout penalty = stake + `buff.scorched` +
Dread +10 (GDD §6.2); Versus PvP net winnings capped at 1 × base quota per Night (GDD §7.3); start-unlocked devices = the hub
slots of GDD §8.6 (the Parlour opens after Night 3).
- Mapping of `actionCost` units to the run's limiting resource (e.g. game-minutes in the "Clock" pitch).
- Blackout penalty on the Devil's Table beyond stake loss and `buff.scorched` (time skip? quota interest?).
- PvP transfer caps for Versus (hold'em, duels, teetotum).
- Which devices start unlocked on the first floor (suggestion: roulette, blackjack, coinflip, hilo, bigsix, fortuneteller; the Devil's Table
  appears behind a locked door that opens after the first quota).
