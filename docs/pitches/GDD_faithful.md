# JACKPIT — Game Design Document Pitch: **"FAITHFUL TENSION"**

Role: Game Director. Status: pitch v1.0 (competing pitch; to be merged by the director).
Source of truth: `docs/BRIEF.md` (fixed decisions are elaborated here, never changed).
Companion: `docs/machines/MACHINES_machines.md` (slot/arcade catalogue). Where both documents name the same machine, the
catalogue owns that machine's rules, RTP, bet ladder and `actionCost`. This pitch owns everything around the machines: the
run, the debt, the economy wrapper, the charms, the phone, the pit, the modes, the menus and the meta layer.
Everything here is original JACKPIT IP. No CloverPit names, text, symbols, characters or art.

---

## 0. Conventions and glossary

| Term | Meaning |
|------|---------|
| **¢ / coins** | Primary currency. Integer. Pocket coins are spendable; deposited coins sit in the Debt Terminal. |
| **Tickets** | The only secondary currency. Red paper stubs. Integer. Never converts to coins. |
| **Pull** | One unit of the per-round play budget. Every machine play costs `actionCost` pulls (catalogue term). |
| **Deadline (D)** | A debt checkpoint. Each deadline has 3–4 **rounds**. Debt is collected after the last round. |
| **Round** | One timed stretch of play with its own pull budget and wall-clock time. |
| **Intermission** | The untimed (solo) / 60 s (multiplayer) gap between rounds: shop, phone favours, wing pick. |
| **PI** | Price Index of the current deadline. Scales charm prices, phone costs and fixed bonuses. |
| **TLM** | Table-Limit Multiplier (catalogue `tableLimitMult`). Scales every machine's `maxBet`. |
| **Suit** | One of six machine families: REELS, CARDS, DICE, WHEELS, DROPS, CURIOS. |
| **Gross payout** | Coins returned by a play including the returned stake. `mult = payout / bet`. |
| **A-bonus / M-factor** | Additive payout bonus (`+15 %`) vs multiplicative factor (`×1.5`). See §3.3. |

Coordinates: metres. Origin = centre of the Hall of Reels at Mouth floor height. **+X east, +Y up, +Z south.**
North = −Z (three.js default forward). "Faces S" means the machine's front points to +Z (the player stands south of it).
Time in seconds. Colours in hex. Odds `N:1` = profit; `×N` = gross return per coin staked.

---

## 1. Pitch and pillars

### 1.1 One-paragraph pitch
You burst out of a jackpot onto the floor of a casino buried seven floors under a city. You owe The House 75 coins by the
end of the third round. The wall clock is ticking, you have seven pulls, and thirty-two machines are breathing in the dark.
JACKPIT is a first-person PSX horror roguelike about debt: deposit coins before the bell, earn interest, buy charms through a
pawn window, answer a red phone that offers terrible bargains, and climb floor by floor in a groaning elevator while the
debts grow faster than your luck. Its twist on the formula is **THE CIRCUIT**: every machine belongs to a suit, every
deadline prints a punch card that only machines of the right suit can punch, every machine *tilts* if you camp it, and your
charm build pulls you toward some suits and away from others, so choosing *which* machine to walk to is the core decision,
not just how much to bet. Miss the debt and the floor opens beneath your feet. Play it alone, with up to seven friends
against a shared debt, or against them until only one is left standing above the trapdoor.

### 1.2 Design pillars
1. **Every coin has a clock.** Deadlines, pulls, the wall clock and interest put a price on every decision. Nothing is
   free: time spent walking, a pull spent on a slow table, a coin left in the pocket instead of the terminal.
2. **The floor is a deck.** The 32 machines work like cards in a deckbuilder: suits, the punch card, Tilt, the Hot/Cold
   Lamps and charm affinity make *where you play* the strategy. Each run opens a different set of wings.
3. **Touch the machine, fear the room.** Physical, diegetic, tactile PSX play: you pull levers, peel cards, throw dice and
   feed coins into a terminal. Meanwhile the room changes as the debt grows: lights fail, mannequins turn their heads, and
   a tall man with a coin-slot face comes up in the elevator to collect. Unsettling, never gory.

### 1.3 The headline mechanic in one breath: **THE CIRCUIT**
Five forces decide "why machine A instead of machine B":

| Force | Direction | Rule (full spec §3.4) |
|-------|-----------|-----------------------|
| **Punch Card** | *pull* toward variety | Each deadline prints a 3×3 to 5×5 card of suit cells ("Win ≥5× on DICE"). Completing lines pays 10 % of the debt into your deposit and +1 % interest. |
| **Tilt** | *push* away from camping | A machine's 5th pull in a round pays ×0.80, the 6th ×0.60, the 7th and later ×0.40. Resets each round. |
| **Lamps** | *weather* | Each round one machine gets a red **Hot Lamp** (×1.5, no Tilt) and one a blue **Cold Lamp** (×0.75, but wins there count one punch tier higher). |
| **Affinity** | *bias* from your build | 2/3/4 charms of one suit give that suit +10 %/+25 %/+50 % payout (plus Tilt grace at 3+). |
| **Fit** | *context* | Machines differ in pulls, seconds, variance and bet caps. A safe low-variance table is right at 70 % of the debt; a 200,000× lottery ball is right at 20 %. |

---

## 2. Core loop and run structure

### 2.1 The three loops

| Loop | Length | Beats |
|------|--------|-------|
| **Second-to-second** (at a machine) | 3–45 s per play | Set the bet (wheel / X / Z) → commit (Space/LMB) → anticipation (reels 1.6–2.4 s, ball 6–9 s, cards 1–4 s) → resolve → coins rattle into the tray, count-up, charm icons flash, a Tilt bulb ticks → choose: again (R), change bet, or stand (E). |
| **Minute-to-minute** (one round) | 90–210 s | Bell rings and lamps roll → glance at the punch card (hold Q) → plan a 2–3 machine route that punches cells, rides the Hot Lamp and avoids Tilt → play 7–10 pulls → walk to the Debt Terminal to deposit → maybe sprint to the phone → Last Call (red, final 20 s) → Closing: interest, tickets. |
| **Run-level** | 55–75 min to Topside | 8 deadlines = 7 floors + the Final Note. After each payment: Deadline Call (choose 1 of 3 Favours), Wing Pick (open 1 new wing), a new punch card. Build a charm engine on 6–9 pegs. Topside ending, then optional Endless (deeper floors). |

### 2.2 Round anatomy (timeline)

| Phase | Duration | What happens |
|-------|----------|--------------|
| **Bell** | 2.0 s | Three bell strikes (synth FM 660 Hz, 0.6 s apart). Lamps roll: beacons spin up on the Hot and Cold Lamp machines (0.8 s whoop). Pulls refill. Clock starts. |
| **Play** | clock (table §2.3) | Free movement. Machines, terminal and phone active. Pawn Window shutter is **down** during play. |
| **Last Call** | final 20 s | Clock face red sector; HUD clock `#FF3030` blinking 2 Hz; ambient lights tint to `#FF5040` at 30 %; House voice "Last call." Jukebox pitch +3 %. |
| **Closing** | 10 s countdown starts when the clock hits 0 **or** your pulls hit 0 (multiplayer: every living player at 0 pulls or Ready) | You may still deposit and walk. A play already in flight finishes. No new commits. |
| **Settle** | 3 s | Machines lock (shutters clack). Tilt resets. Unused pulls → Tickets (1 each). Interest applied (§2.5). |
| **Collection** | 12 s (skippable after the first time, hold Space ×3 speed) | Only after the last round of a deadline. See §2.6. |
| **Intermission** | solo: untimed; MP: 60 s or all Ready | Pawn Window open. After a paid deadline: Deadline Call + Wing Pick. End by pulling the **OPEN THE FLOOR** lever on the terminal (solo) or all Ready (MP). |

### 2.3 Debt schedule

| D | Floor dial | Debt (¢) | Rounds | Pulls / round | Clock / round (s) | Interest / round | House Favour | PI | TLM | Punch card | After payment |
|---|-----------|---------:|:------:|:-------------:|:-----------------:|:----------------:|:------------:|---:|----:|:----------:|---------------|
| 1 | B7 | 75 | 3 | 7 | 150 | 10 % | ×1.20 | 1 | ×1 | 3×3 | Wing Pick #1 |
| 2 | B6 | 220 | 3 | 7 | 150 | 9 % | ×1.12 | 2 | ×1 | 3×3 | Wing Pick #2 |
| 3 | B5 | 600 | 3 | 8 | 165 | 8 % | ×1.06 | 4 | ×1 | 3×3 | Wing Pick #3 |
| 4 | B4 | 1,600 | 3 | 8 | 165 | 7 % | ×1.00 | 8 | ×2 | 4×4 | Wing Pick #4 |
| 5 | B3 | 4,500 | 4 | 8 | 180 | 6 % | ×1.00 | 16 | ×5 | 4×4 | Wing Pick #5 (all wings open) |
| 6 | B2 | 12,000 | 4 | 9 | 180 | 5 % | ×1.00 | 32 | ×10 | 4×4 | The Back Room unlocks |
| 7 | B1 | 33,000 | 4 | 9 | 195 | 4 % | ×1.00 | 64 | ×20 | 4×4 | — |
| 8 | **G — "The Final Note"** | 90,000 | 4 | 10 | 210 | 3 % | ×1.00 | 128 | ×50 | 5×5 | The Lift goes up: **Topside** (win) |

- Totals for a full run: 28 rounds, 234 pulls.
- **House Favour** is an M-factor on every winning payout. It gives a soft start: The House lets you get comfortable.
- **TLM** multiplies each machine's catalogue `maxBet`. Values snap down to the bet ladder, which extends past 1,000 as
  `2,000 / 5,000 / 10,000 / 20,000 / 50,000 / 100,000 …`.
- **Endless** (deadline n ≥ 9, after choosing "Go back down" at Topside):
  - `Debt(n) = 90,000 × 2.75^(n−8)`, rounded to 3 significant figures (D9 248,000 · D10 681,000 · D11 1,870,000).
  - Rounds 4, pulls 10, clock 210 s, card 5×5.
  - `Interest(n) = max(1 %, 3 % − 0.5 % × (n−8))`.
  - `PI(n) = 128 × 2^(n−8)`, `TLM(n) = 50 × 2.5^(n−8)` (ladder-snapped).
  - Floor dial shows `B8, B9, …` (the needle points below the printed scale).
  - One additional **House Rule** per endless deadline, cumulative (§11.5).

### 2.4 Start state (Debt Run, kit "Pauper")
Pocket **40 ¢** · Deposit **0 ¢** · Tickets **2** · Charm pegs **6** (max 9) · Charms **0** · Open zones: the Mouth and the
Hall of Reels (9 machines, all six suits present) · Progressive jackpot pot **25 × PI**.

### 2.5 Deposits, withdrawals, interest, settling early
- **Deposit**: at the Debt Terminal (E). Keypad buttons `10 % · 25 % · 50 % · ALL · custom (digits + Enter)`. A coin-stream
  animation runs 0.6 s and the counter rolls up at 60 digits/s. Deposits are instant and count immediately.
- **Withdraw**: allowed, with a **15 % House cut** (withdraw 100 → receive 85). In co-op, withdrawing needs a majority vote
  (§7.2).
- **Interest** is applied at Settle of every round:
  `interest = floor( min(deposit, 2 × currentDebt) × rate )`, where
  `rate = schedule rate + charm/favour bonuses + 1 % per punch line completed this deadline`.
  - **Activity clause**: no interest for a round in which you used fewer than 3 pulls. The House pays players, not savers.
  - **Ceiling**: deposits above 2 × the current debt earn nothing.
- **Settle Early**: when `deposit ≥ debt`, the terminal's brass **SETTLE** lever unlocks. Pulling it ends the current round
  now (normal Settle) and runs the Collection. Each unplayed round of that deadline pays **+4 Tickets** and **+1 free shop
  reroll**. Interest for unplayed rounds is forfeited.

### 2.6 Collection (end of the last round of a deadline)
| t (s) | Beat |
|------:|------|
| 0.0 | Three descending bell strikes. Pit lights dim to 30 %. All machines go dark except their Tilt bulbs. |
| 1.0 | Lift chime (two-tone 784/523 Hz). The doors open over 1.2 s. **The Collector** steps out. |
| 2.2–6.0 | He walks at 0.9 m/s to the terminal without footsteps (only a soft coin jingle per step). |
| 6.0–8.0 | Gloved hand on the terminal. Coins arc out of the coin slot into his coat (stream of 40 instanced coins). The terminal counter rolls the debt down. |
| 8.0 | **PAID**: the terminal printer stamps PAID in red `#C0182A`. He touches his hat brim, returns to the lift, the doors close, the floor-dial needle swings up one floor (1.5 s overshoot). Lights return. Wing Pick panel lights. Phone rings (Deadline Call). |
| 8.0 | **SHORT**: he turns his head (not body) toward you wherever you stand (0.8 s). Lights cut to 0 except a cold spotlight `#CFE8FF` on you. The trapdoor sequence follows (§2.7). |

Surplus deposit stays in the terminal and keeps earning interest in the next deadline. A new punch card prints
(dot-matrix screech, 1.5 s) at the start of the next deadline's first round.

### 2.7 Fail, win and the trapdoor
- **Fail**: at Collection, `deposit < debt` and no protection fires (False Bottom charm, Insurance call, Collateral in
  co-op). Abandoning a run also counts as a fall.
- **Win**: pay Deadline 8, walk into the lift, press G. Topside sequence (§9.10). Then choose: Credits / Go back down
  (Endless) / Menu.
- **No soft-lock**: if pocket < every open machine's min bet and pulls remain, the phone rings with the Loan Shark (§5.3,
  P03) regardless of its normal trigger.
- **Trapdoor sequence** (the floor is a grid of 2 × 2 m steel plates `#3A3530` with rivets; any plate can open):

| t (s) | Beat |
|------:|------|
| 0.0 | Spotlight on. House voice: "Short by {N}. Mind the floor." (subtitled) |
| 2.0 | A latch clanks under you (low square 70 Hz, 0.15 s). Input locks. |
| 2.4 | The two half-plates under the player's position hinge down 90° in 0.35 s. |
| 2.4–5.5 | Fall. The camera pitches down 25°, wind noise rises, your pocket coins float up around you, the square of light above shrinks. |
| 5.5 | Thud (40 Hz sine, 0.3 s). Black. Fade into **The Sump** results (§9.9). |

What persists after a fall: stats, achievements, unlock progress, your name tag added to the Sump wall (last 50 runs), and
the daily attempt is spent. What is lost: everything in the run.

### 2.8 Saving
- Single-player saves after **every resolved play**, every deposit and every intermission. The save is IndexedDB JSON,
  about 20 KB.
- Machine RNG is stream-indexed per instance and round (catalogue §1.5), so reloading cannot reroll anything.
- Quitting mid-round resumes exactly where you left off with the clock frozen at that second.
- One run slot. "Continue" appears on the jackpot menu.

### 2.9 Example round (D1, Round 2)
Bell. Hot Lamp spins up red on the **Plinko Board**, Cold Lamp blue on the **Flip Booth**. The card (hold Q) needs: DICE
bronze, WHEELS silver (≥5×), CURIOS bronze, REELS gold (VALLEY/PEAK on The Big One). Plan:
- 2 pulls on the Flip Booth: Cold Lamp, so a plain win grades as silver. It punches DICE.
- 3 pulls on Plinko under the Hot Lamp (×1.5, no Tilt).
- 2 pulls on The Big One, hunting the gold cell.

Deposit 30 ¢ at 1:10 left so the round's interest counts. The phone rings at 0:52 (The Tip, P02: "the Money Wheel is
warm"), but your pulls are spent. The round closes; unused pulls 0; interest +3 ¢.

---

## 3. Economy and THE CIRCUIT

### 3.1 Currencies
| Currency | Physical form | Earned from | Spent on | Cap |
|----------|---------------|-------------|----------|-----|
| **Coins ¢** | Brass coins `#C8A040`; pocket shown as a pouch in the left-hand viewmodel | Machine payouts, punch bounties (paid straight into the deposit), interest, phone deals, selling charms (50 %) | Bets, charms, debt, the withdrawal cut, phone deals | none (integer, 53-bit safe) |
| **Tickets** | Red stubs `#E8343A` with black serial numbers | Unused pulls (1 each), punched cells (+1), Settle Early (+4 per skipped round), claw/pusher prizes, some charms/calls | Shop rerolls (1, then +1 per reroll in the same intermission), shop lock (1), buying a pull (3 Tickets = +1 pull, max +2 per round), card reroll (2), phone deals | 99 |

There is no third currency.

### 3.2 Bets, PI and TLM
- Each machine's bet ladder slice comes from the catalogue (`minBet`/`maxBet`).
- Effective max bet = `maxBet × TLM(deadline)`, snapped down to the ladder. Min bet never scales.
- Charm price = `basePrice × PI × (1 + 0.15 × (D − 1))`. Example: a Common costs 8 ¢ at D1, 93 ¢ at D4 and 2,099 ¢ at D8.
- Fixed-value effects quoted as "× PI" (phone costs, cursed charm sign-on fees) use the current PI.

### 3.3 Payout pipeline (single choke point `econ.finalize`)
The machine computes the **base gross payout** `G` for bet `B`; then:

```
if G <= B:                       // loss, push or partial refund: no bonuses
    final = G (+ refund effects such as betRefundOnLoss on losses)
else:
    A = Σ additive bonuses (suit charms, affinity, streaks, Night Owl, wing bonus …)
    if G <= 2.0 * B: A = A * 0.5 // DAMPENER: even-money wins get half the additive bonus
    M = Π factors (House Favour, Hot 1.5 / Cold 0.75 Lamp, Tilt, Legendary ×1.5, Long Shot ×2 …)
    final = floor(G * (1 + A) * M)        // dust accumulator per catalogue §1.1
    final = min(final, 5 * currentDebt)   // HOUSE LIMIT; the excess feeds the progressive pot
```
The combined factor reaches the machine as `payoutMult` (catalogue hook). The dampener exists so a +60 % charm stack
cannot turn low-variance even-money tables into a riskless grind.

### 3.4 THE CIRCUIT: full rules

#### 3.4.1 Suits
| Suit | Glyph (8×8 px, procedural) | Colour | Machines (core 32) |
|------|---------------------------|--------|--------------------|
| REELS | three stacked bars | `#FFB000` | bigone, bandit, pachislot, scratch (+ stretch: fruitmachine) |
| CARDS | an original "pike" leaf with a notch | `#E8E0C8` | videopoker, blackjack, holdem, baccarat, hilo, war |
| DICE | a die showing 5 pips | `#FF4A3A` | craps, sicbo, dicetower, coinflip |
| WHEELS | 6-spoke wheel | `#38E8FF` | roulette, bigsix, cyclone, revolver, tombola |
| DROPS | a ball falling into a funnel | `#DDF4FF` | pachinko, plinko, coinpusher, keno, bingo, lotto (+ stretch: bingopin) |
| CURIOS | an open eye | `#FF2E88` | claw, stacker, mines, elevator, shellgame, derby, fortuneteller (+ stretch: lootbox) |

Every machine cabinet carries its suit glyph on a 0.12 m enamel badge on the marquee (emissive), so suits read across the
fog.

#### 3.4.2 Punch Card
- Printed by the Debt Terminal at the start of each deadline. Held in the left hand (hold **Q** to raise it to eye level;
  a mini version sits on the HUD).
- **Cell tiers**:
  - **Bronze**: "Win on a ◇ machine" (`G > B`).
  - **Silver**: "Win ≥5× bet on ◇".
  - **Gold**: "Win ≥20× bet on ◇".
  - **HOUSE** (gold-equivalent): a named feat on a named machine, taken from that machine's `goldFeat` (table §3.5).
  - **LEDGER**: a terminal task, one of:
    - "Have ≥50 % of the debt deposited at the end of Round 1"
    - "Make 3 separate deposits in one round"
    - "Finish a round with ≥3 unused pulls"
- **Layouts**:

| Size | Corners | Edge cells | Inner cells | Lines (rows + cols + 2 diagonals) |
|------|---------|-----------|-------------|-------------------------------------|
| 3×3 | 4 Bronze | 4 Silver | centre: HOUSE or LEDGER (50/50) | 8 |
| 4×4 | 4 Bronze | 8: 4 Bronze + 4 Silver | 4: 2 Gold, 1 HOUSE, 1 LEDGER | 10 |
| 5×5 | 4 Bronze | 12: 6 Bronze + 6 Silver | 9: 4 Gold, 3 HOUSE, 1 LEDGER (centre), 1 Silver | 12 |

- **Generation**:
  - Only suits with ≥1 open machine appear.
  - No suit fills more than ⌈cells/4⌉ cells, and every line contains ≥2 suits.
  - HOUSE feats come only from open machines. The seed stream is `card`.
- **Rewards**:
  - Each punched cell gives +1 Ticket.
  - Each completed line credits **10 % of the current debt** to the deposit and gives **+1 % interest** for the rest of this
    deadline.
  - **Blackout** (all cells): +25 % of the debt to the deposit, +5 Tickets, and a free charm at the next intermission
    (Rare 80 % / Legendary 20 %).
- **One play can punch at most one cell.** If several qualify, the highest tier is punched, then the one completing the
  most lines.
- **Cold Lamp grading**: a win on the Cold Lamp machine is graded one tier higher (bronze-level win → silver, silver →
  gold). It never upgrades into HOUSE.
- **Reroll**: 2 Tickets rerolls one unpunched cell (max 2 per deadline).
- Presentation: physical punch animation (the card snaps forward 0.25 s), a "chunk" (noise burst plus 180 Hz thump), and a
  pixel hole. A completed line glows gold `#FFD34A` and the voice says "Line."

#### 3.4.3 Tilt
- Counted per player, per machine instance, per round, in pulls spent. Shown on 4 amber bulbs `#FFB000` on the marquee: lit
  bulbs are full-value pulls remaining. Then a red TILT tube `#FF2020` lights and flickers faster with each extra pull.

| Pull # on this machine this round | 1–4 | 5 | 6 | 7+ |
|---|---|---|---|---|
| Tilt M-factor | ×1.00 | ×0.80 | ×0.60 | ×0.40 |

- A play's factor is the one for its **last** pull (a 2-pull claw play at pulls 4–5 takes ×0.80).
- No Tilt on the Hot Lamp machine. Tilt resets at Settle. The thresholds shift with charms (Worn Glove, Red Thread, Tilt
  Switch), favours (Stamina), affinity (3+ → +2) and House Edge 3 (−1).

#### 3.4.4 Lamps
- At Bell, the host draws from open machines (seed stream `lamps`):
  - **Hot Lamps**: 1 (D1–D4) or 2 (D5+); +1 per 3 co-op players. Each is ×1.5, has no Tilt, and gets a red rotating beacon
    `#FF3020` with a 3 m vertical beam visible through fog.
  - **Cold Lamp**: always 1. ×0.75 with tier-up punch grading; blue beacon `#3080FF`, slow pulse.
- The same machine cannot be Hot two rounds running. Affinity 4+ doubles a suit's Hot weight.

#### 3.4.5 Affinity
Each charm has a tag: one suit, LEDGER, or none. Count tags among equipped charms:

| Same-suit charms | Effect on that suit's machines |
|---|---|
| 2 | +10 % (A) |
| 3 | +25 % (A), Tilt starts 2 pulls later |
| 4+ | +50 % (A), Tilt starts 2 pulls later, Hot Lamp weight ×2 |
| LEDGER 3 / 4+ | +1 % / +2 % interest |

#### 3.4.6 Why A vs B: a worked decision (D4, R2)
Debt 1,600 ¢, deposit 900 ¢, pocket 300 ¢, 8 pulls, charms: Brass Thimble, Sun Dial, Moth Lantern (REELS ×3 → +25 %),
Circuit Breaker.
- The Big One is your engine, but Tilt caps it at 4 good pulls.
- The card's open line needs a DICE silver: the Hot Lamp is on Craps (2 pulls, ×1.5); a hardway or field 2/12 hit does it.
- Circuit Breaker gives +12 % for alternating suits, so the route is **Big One ×2 → Craps ×1 (2 pulls) → Big One ×2 →
  Pachislot ×2 (REELS, fresh Tilt)**.
- A completed line is worth 160 ¢ + 1 % interest on 900 ¢, more than two extra Big One pulls are worth at this bet.

That calculation is the game.

### 3.5 Machine roster and economic bands (core 32)
"cat." means the value is taken from the machine catalogue. Bet ranges are absolute coins at TLM ×1. Seconds are a typical
play including animation. Var = variance class (catalogue §1.1).

| # | id | Display name | Suit | Class | Pulls | ~s | Bet (TLM 1) | Base RTP | Var | Top | Skill | Seats | goldFeat (HOUSE cell) | Zone |
|---|----|--------------|------|-------|------:|---:|-------------|----------|-----|-----|-------|------:|-----------------------|------|
| 1 | bigone | The Big One | REELS | XL | 1 | 4.5 | 1–100 | 0.947 cat. | M + tail | FULL ×40 + pot | — | 1 | VALLEY or PEAK | Hall |
| 2 | bandit | One-Armed Bandit | REELS | M | 1 | 4 | 1–75 | 0.92–0.93 cat. | H | cat. | — | 1 | top line combo | Hall |
| 3 | pachislot | Pachislot "Oni Feast" | REELS | M | 1 / 3 games | 12 | 3–75 | 0.948–1.04 cat. | H | BIG bonus | aim | 1 | enter BIG | Rotunda |
| 4 | scratch | Scratch-Card Vendor | REELS | S | 1 | 8 | 2–50 / card | 0.805–0.878 cat. | H | cat. | — | 1 | ≥×50 on one card | Hall |
| 5 | videopoker | Video Poker | CARDS | M | 1 | 9 | 1–125 | 0.973 / 0.997 cat. | H | ×800 royal | holds | 1 | four of a kind | Hall |
| 6 | blackjack | Twenty-One Table | CARDS | L | 1 | 20 | 2–200 | 0.995 (basic) | L | ×2.5 (×8 split/dbl) | counting | 5 | 5-card 21 | Card Room |
| 7 | holdem | The Long Table (hold'em) | CARDS | XL | 3 | 45 | ante 5–300 | ≈1.03 vs bots, after 5 % rake (cap 3×PI) | H | pot | yes | 6 | win with a flush or better | Card Room |
| 8 | baccarat | Baccarat Rail | CARDS | L | 1 | 12 | 2–200 | 0.989 banker / 0.988 player / 0.856 tie | L | ×12 pair | — | 5 | Tie bet hits | Card Room |
| 9 | hilo | Higher / Lower | CARDS | M | 1 | 12 | 1–100 | 0.97 (0.97 × Π 1/p, cash out anytime) | player | cap ×500 | — | 1 | 6-guess chain | Card Room |
| 10 | war | War Cabinet (War / Dragon-Tiger toggle) | CARDS | M | 1 | 6 | 2–150 | 0.971 / 0.963 | L | tie 10:1 → ×11 | — | 1 | win a War | Card Room |
| 11 | craps | The Craps Trench | DICE | XL | 2 | 30 | 5–150 (+2× odds) | 0.986 pass, 0.994 with odds; props 0.83–0.94 | M | horn 30:1 → ×31 | throw (cosmetic) | 6 | hardway hit | Dice Den |
| 12 | sicbo | The Birdcage (sic bo) | DICE | L | 1 | 12 | 2–100 | 0.972 big/small … 0.838 triple | L–X | 180:1 → ×181 | — | 6 | any triple | Dice Den |
| 13 | dicetower | Dice Tower | DICE | M | 1 | 8 | 2–200 | 0.889–0.944 cat. | L–H | cat. | — | 4 | cat. top spot | Dice Den |
| 14 | coinflip | Flip Booth | DICE | S | 1 | 3 | 1–100 | 0.96 (H/T ×1.94 at p 0.495; EDGE ×96 at p 0.01) | L (edge X) | ×96 | — | 1 | 5 wins in a row | Hall |
| 15 | roulette | Single-Zero Wheel | WHEELS | XL | 1 | 18 | 1–200 total | 0.973 | L–X | ×36 | — | 6 | straight-up hit | Rotunda |
| 16 | bigsix | Money Wheel (54 segments: 1:1×26, 3:1×13, 6:1×7, 12:1×4, 25:1×2, 50:1 PIT×1, 50:1 JOKER×1) | WHEELS | W | 1 | 12 | 1–150 | 0.963 (×6 bet 0.907) | M | ×51 | — | 4 | PIT or JOKER | Hall |
| 17 | cyclone | Cyclone Light Ring | WHEELS | W | 1 | 6 | 1–50 | 0.85 random / 0.93–0.97 aimed cat. | M | cat. | timing | 1 | cat. top lamp | Rotunda |
| 18 | revolver | The Devil's Table | WHEELS | L | 1 | 15 | 1–100 | 0.97 (0.97 × Π 6/(6−k), ≤5 pulls/play) | X | cap ×500 | — | 1 | survive 3 pulls with ≥3 live | Back Room |
| 19 | tombola | Raffle Drum (pick 3 of 30, 5 drawn: 1 hit ×1 · 2 ×7 · 3 ×75) | WHEELS | M | 1 | 14 | 1–100 | 0.985 | M | ×75 | — | 1 | match 3 | Rotunda |
| 20 | pachinko | Pachinko "Deep Rain" | DROPS | M | 1 / 50 balls | 25 | ball 1/2/5 | 0.925 cat. | H | cat. | launch aim | 1 (×3 units) | trigger the feature | Drop Gallery |
| 21 | plinko | Plinko Board | DROPS | W | 1 | 6 | 1–100 × 1–5 pucks | 0.964–0.967 cat. | L/H | cat. | — | 1 | edge bin | Hall |
| 22 | coinpusher | Coin Pusher "The Shelf" | DROPS | L | 1 / 10 coins | 15 | coin 1/5/25 | ≈0.88 + prizes cat. | L | prizes | aim | 2 | a prize falls | Drop Gallery |
| 23 | keno | Keno Lounge (pick-5: 2 hits ×1, 3 ×3, 4 ×15, 5 ×400) | DROPS | L | 1 | 15 | 1–100 | 0.95–0.962 | H | ×1,000 (pick 8) | — | 3 | 4+ of pick-5 | Drop Gallery |
| 24 | bingo | Bingo Cage (40 balls of 75; line ×4, corners ×6, X ×20, frame ×40, blackout ×500) | DROPS | XL | 2 | 40 | 1–50 per card, ≤4 cards | 0.95 (sim-tuned) | H | ×500 | — | 8 | X pattern | Drop Gallery |
| 25 | lotto | Ball Blower 6/36 (2 hits refund 50 %, 3 ×5, 4 ×80, 5 ×3,000, 6 ×200,000) | DROPS | W | 1 | 20 | 1–50 | 0.96 | X | ×200,000 (House Limit applies) | — | 1 | match 4 | Drop Gallery |
| 26 | claw | Claw Crane | CURIOS | M | 2 | 20 | 2–50 | ≈0.80 avg / ≤1.10 expert cat. | M | charm capsule | yes | 1 | grab a capsule | Curio Arcade |
| 27 | stacker | Stacker | CURIOS | M | 2 | 15 | 1–25 | ≈0.70 / ≤1.10 cat. | H | cat. | yes | 1 | reach the top prize | Hall |
| 28 | mines | Mines Terminal | CURIOS | S | 1 | 12 | 1–200 | 0.97 cat. | player | cat. | — | 1 | 8 safe tiles with ≥5 mines | Curio Arcade |
| 29 | elevator | The Elevator (crash) | CURIOS | XL | 1 | 15 | 1–500 | 0.96 cat. | player | cat. | timing | 8 | cash out ≥×10 | Curio Arcade |
| 30 | shellgame | Shell Automaton (pick ×2.1; palm cheat 10 % with tell, accuse ×2) | CURIOS | M | 1 | 10 | 1–25 | 0.85 casual → 1.25 perfect | M | ×2.1 | tracking | 1 | catch the palm | Dice Den |
| 31 | derby | Tin Derby (6 runners, odds 0.8:1 … 25:1, book 104 %) | CURIOS | XL | 2 | 25 | 2–150 | 0.96 | M–H | ×26 | — | 6 | win with an 8:1+ runner | Curio Arcade |
| 32 | fortuneteller | The Teller (3 tarot cards: ×0 46 %, ×1 15 %, ×2 12 %, ×5 5 %, ×10 2 %, Omen 20 %) | CURIOS | M | 1 | 12 | fixed 5 × PI | 0.84 + Omens | M | ×10 | — | 1 | draw THE PIT | Mouth |

Stretch machines from the catalogue slot in without new systems: `fruitmachine` (REELS, M), `bingopin` (DROPS, M),
`lootbox` (CURIOS, S).

**Omens** (The Teller, 20 % of draws, equal weights):

| Omen | Effect |
|------|--------|
| THE MOTH | Next 5 WHEELS plays +50 % (A). |
| THE KEY | Next intermission: 1 free Uncommon in the Pawn Window. |
| THE SHELF | Coin Pusher shelf +30 coins at the front lip. |
| THE EYE | Reveals next round's Hot and Cold Lamps. |
| THE CROWN | Your next winning play ×2 (M). |
| THE DOOR | Removes one cursed charm. |
| THE COLLECTOR | Curse: current debt +5 %. |
| THE PIT | Gold feat: pot +10 × PI and `bigone` jackpotChance ×3 for the next spin. |

**Skill guard principle** (all skill machines): perfect-play RTP ≤ 1.25 is enforced by catalogue mechanisms (slip windows,
flag-gated top prizes, honest visible "slip" tells) and by low bet caps (≤25 at TLM 1). Skill should feel good and pay a
little, not become a farm.

### 3.6 Roles (how the floor is meant to be used)
| Role | Members | Use it when |
|------|---------|-------------|
| **Engines** (charm-scalable, M–H variance, 1 pull) | bigone, bandit, pachislot, plinko, roulette, videopoker | You have suit charms. This is where the money is made. |
| **Grinders** (L variance, ≈0.97–0.99) | blackjack, baccarat, war, coinflip, sicbo big/small | Filling Bronze cells, protecting a near-complete deposit, cheap LEDGER activity pulls. Weak with charms (dampener). |
| **Spikes** (X variance) | lotto, revolver, keno high picks, sicbo triples, hilo/mines/elevator long chains | Behind at Last Call, gold cells, desperation. |
| **Skill** | stacker, claw, shellgame, cyclone, pachislot aim, blackjack counting, holdem | You are good at it. Low caps keep it honest. |
| **Social** (multi-seat, shared draws) | craps, bingo, elevator, derby, holdem, coinpusher, roulette | Co-op and Versus: shared tension, shared Hot Lamps. |
| **Oracles** | fortuneteller | Omens, curse removal, information. |

### 3.7 Sources and sinks (per deadline, typical for a median player)
| Flow | Coins | Tickets |
|------|------:|--------:|
| Machine net (after charms, before interest) | +25 % … +120 % of debt | — |
| Interest | +10 … 30 % of debt | — |
| Punch lines (2–3 typical) | +20 … 30 % of debt | +4 … 7 (cells) |
| Unused pulls / Settle Early | — | +2 … 10 |
| Charms bought (1–3) | −10 … 25 % of debt | — |
| Shop rerolls / pull purchases | — | −2 … 8 |
| Phone deals | ± | ± |

### 3.8 Anti-degenerate rules
1. **Tilt** (§3.4.3) kills camping. Even the best machine loses about 17 % EV over 7 pulls.
2. The **dampener** halves additive bonuses on even-money wins. Grinders cannot be turned into risk-free farms.
3. **Bonuses never touch losses, pushes or partial refunds.** No push-farming.
4. **Activity clause** (≥3 pulls) and the **interest ceiling** (2 × debt) stop "deposit everything and idle".
5. **Withdrawal cut 15 %** (> the 3 % Wax Seal deposit bonus) blocks deposit/withdraw loops.
6. **Pulls are hard-capped**: Ticket→pull at 3:1, max +2 per round; charms and favours together add at most +7 pulls
   per round (Spare Token 1, Operator's Glove 2, Sand Hourglass 2, Patron ×2).
7. **Sell value 50 %** of the price paid. Buy/sell loops are impossible; price indexing (PI) prevents early-buy arbitrage.
8. **House Limit**: no single play pays more than 5 × current debt (the excess feeds the pot). One lottery ball cannot end
   the game at D1.
9. **Martingale guard**: bet ladder caps, Tilt and pulls bound any doubling chain to ≤4 effective steps per machine-round.
10. **Determinism**: stream-indexed RNG per machine instance; seeds for shop/phone/lamps/card in separate streams. Reloads
    and quit-outs change nothing.
11. **Card counting is allowed** (skill), but blackjack's spread is capped by its ladder (2–200, i.e. 1:100 at TLM 1) and
    the 6-deck shoe reshuffles at 75 % penetration.
12. **Holdem bots**: four archetypes (Rock, Calling Station, Maniac, Shark), rake 5 % capped at 3 × PI, max 3 raises per
    street. A competent human edges about +3 %.
13. **Versus**: no coin transfers between players. **Co-op**: transfers are free, but shared-deposit withdrawals need a vote.
14. **Skill machines**: perfect-play RTP ≤ 1.25 and caps ≤25 at TLM 1.

### 3.9 Balance targets and simulation
- `tools/sim/run.mjs` plays 100,000 headless runs with three bot policies:
  - **Naive**: random machine, mid bets.
  - **Median**: greedy on card + Hot Lamp, buys suit charms.
  - **Expert**: card-route planner, affinity builds, Settle Early.
- Targets (D8 pass = Topside):

| Policy | D1 pass | D2 | D3 | D4 | D5 | D6 | D7 | D8 (win) |
|--------|--------:|---:|---:|---:|---:|---:|---:|---------:|
| Naive | 70 % | 40 % | 20 % | 8 % | 3 % | 1 % | <1 % | <0.5 % |
| Median | 88 % | 72 % | 55 % | 40 % | 28 % | 20 % | 14 % | 10 % |
| Expert | 97 % | 92 % | 85 % | 75 % | 62 % | 52 % | 45 % | 38 % |

- Knobs, in this order: debt table, House Favour, line bounty %, interest table, charm prices, rarity odds.
- Machine RTPs are not tuned by the economy.

---

## 4. Charms

### 4.1 Rules
- **Charm Board**: a pegboard `#4A3A28` in the Mouth (1.6 × 1.0 m). Bought charms hang on its brass pegs and also show as
  16×16 px icons on the HUD. Start with 6 pegs; +1 via the Favour "Extra Peg"; maximum 9.
- **Pawn Window** (the shop) opens only in intermission:
  - 4 slots = 3 regular + 1 "under the counter" (Rare+ or Cursed, 50/50).
  - Reroll costs 1 Ticket, +1 per further reroll in the same intermission.
  - Lock one item for the next visit: 1 Ticket.
- **Rarity odds (regular slots)**:

| Deadline | Common | Uncommon | Rare | Legendary |
|---|---:|---:|---:|---:|
| D1–D2 | 70 % | 25 % | 5 % | 0 % |
| D3–D4 | 50 % | 33 % | 15 % | 2 % |
| D5–D6 | 40 % | 35 % | 21 % | 4 % |
| D7+ | 35 % | 35 % | 24 % | 6 % |

- **Price** = base × PI × (1 + 0.15 (D−1)). Selling pays 50 % of the price paid; cursed charms cannot be sold.
- **Stacking**: duplicates are not offered. A-bonuses add; M-factors multiply (§3.3).
- **Cursed charms** pay *you* a sign-on fee when taken (shown as negative price). They are removable only by:
  - the phone call "The Exorcist" (P16),
  - The Teller's THE DOOR omen,
  - the charm "Holy Water Flask".
- Hook names: catalogue global hooks (`payoutMult`, `luckBonus`, `betRefundOnLoss`, `actionCostDelta`, `freePlayChance`,
  `jackpotChance`, `nearMissRefund`, `onOutcome`, `onTag:<tag>`), catalogue machine hooks (`bigone.*`), and these economy
  hooks:
  - `run.pullsAdd`, `run.clockAdd`, `econ.interestAdd`, `econ.depositBonus`
  - `tilt.grace`, `lamp.hotMult`, `lamp.hotCount`, `lamp.coldMult`
  - `card.punchExtra`, `card.lineBonus`
  - `shop.*`, `phone.*`

### 4.2 Charm table (74 rows: 19 C · 25 U · 16 R · 6 L · 8 Cursed, plus 2 Endless-only cursed variants)
Price column = base price, multiplied by PI × (1 + 0.15 (D−1)). Unlock codes: `—` = available from the first run; `D3`
= pay Deadline 3 once; `W` = win a run; `F3` = fall 3 times; `A:` = achievement (§11.6); `K` = unlocked with a Kit.

| # | id | Name | Rar | Price | Tag | Effect (precise) | Hooks | Unl. |
|---|----|------|-----|------:|-----|------------------|-------|------|
| 1 | brass_thimble | Brass Thimble | C | 8 | REELS | +15 % (A) payout on REELS machines. | payoutMult | — |
| 2 | billiard_chalk | Billiard Chalk | C | 8 | CARDS | +15 % (A) payout on CARDS machines. | payoutMult | — |
| 3 | loaded_pip | Loaded Pip | C | 8 | DICE | +15 % (A) payout on DICE machines. | payoutMult | — |
| 4 | greased_axle | Greased Axle | C | 8 | WHEELS | +15 % (A) payout on WHEELS machines. | payoutMult | — |
| 5 | lead_shot | Lead Shot | C | 8 | DROPS | +15 % (A) payout on DROPS machines. | payoutMult | — |
| 6 | glass_eye | Glass Eye | C | 8 | CURIOS | +15 % (A) payout on CURIOS machines. | payoutMult | — |
| 7 | piggy_tooth | Piggy Tooth | C | 10 | LEDGER | +1 % interest per round. | econ.interestAdd | — |
| 8 | spare_token | Spare Token | C | 12 | — | +1 pull per round. | run.pullsAdd | — |
| 9 | cracked_watch | Cracked Pocket Watch | C | 8 | — | +20 s on the round clock. | run.clockAdd | — |
| 10 | stub_spike | Stub Spike | C | 8 | — | +1 extra Ticket whenever a punch-card cell is punched. | card.onPunch | — |
| 11 | worn_glove | Worn Glove | C | 10 | — | Tilt starts 2 pulls later on every machine (pulls 1–6 full value). | tilt.grace +2 | — |
| 12 | polished_molar | Polished Molar | C | 8 | REELS | The Big One: TOOTH base value +1 (1 → 2). Bandit: +5 % (A). | bigone.symbolValueAdd[TOOTH] | — |
| 13 | dealers_button | Dealer's Button | C | 10 | CARDS | Blackjack naturals pay 2:1 (instead of 3:2). Baccarat Banker commission 5 % → 0 %. | blackjack.bjPay, baccarat.commission | — |
| 14 | felt_square | Felt Square | C | 8 | CARDS | Losing CARDS plays refund 10 % of the bet. | betRefundOnLoss 0.10 | — |
| 15 | wax_seal | Wax Seal | C | 6 | LEDGER | Each deposit adds a bonus of 3 % of the amount deposited. | econ.depositBonus | — |
| 16 | rusty_key | Rusty Key | C | 10 | — | 1 free Pawn Window reroll per intermission. | shop.freeRerolls | — |
| 17 | chipped_die | Chipped Die | C | 8 | DICE | Coin Flip and Dice Tower: losing plays refund 15 % of the bet. | betRefundOnLoss 0.15 | — |
| 18 | tin_whistle | Tin Whistle | C | 8 | — | Phone rings for 16 s instead of 10 s; +1 Ticket per answered call. | phone.ringTime, phone.onAnswer | — |
| 19 | consolation_ribbon | Consolation Ribbon | C | 8 | — | Rounds tagged `nearmiss` refund 50 % of the bet. | nearMissRefund 0.5 | — |
| 20 | moth_lantern | Moth Lantern | U | 18 | REELS | The Big One: adds GHOST (wild) with weight 4. | bigone.symbolWeight[GHOST] +4 | — |
| 21 | hot_coal | Hot Coal | U | 16 | — | Hot Lamp factor ×1.5 → ×2.0; +1 extra Hot Lamp each round. | lamp.hotMult, lamp.hotCount | — |
| 22 | snake_eye_ring | Snake-Eye Ring | U | 18 | DICE | Every die showing a 1 in a DICE result adds +0.5 × bet to that play's payout (even on losing plays). | onOutcome | — |
| 23 | counting_bead | Counting Bead | U | 20 | CARDS | Blackjack/Baccarat/War/Hi-Lo show running and true count on a brass dealer-side counter; Hi-Lo shows remaining ranks. | ui.shoeInfo | — |
| 24 | chain_link | Chain Link | U | 18 | — | Win streak: +10 % (A) per consecutive winning play (any machine), max +50 %; any loss resets. | onTag:win/loss | — |
| 25 | apology_card | Apology Card | U | 16 | — | After 3 consecutive losing plays, your next winning play is ×2 (M). | onTag:loss | — |
| 26 | ledger_pen | Ledger Pen | U | 20 | LEDGER | Each completed punch line gives +2 % interest (instead of +1 %) and +2 Tickets. | card.lineBonus | D2 |
| 27 | circuit_breaker | Circuit Breaker | U | 18 | — | +12 % (A) if this play's suit differs from your previous play's suit. | onCommit | — |
| 28 | velvet_rope | Velvet Rope | U | 22 | CARDS | Machines of class L/XL cost 1 fewer pull (min 1). | actionCostDelta −1 | — |
| 29 | bent_nail | Bent Nail | U | 18 | DROPS | luckBonus +8 on DROPS machines (pachinko/plinko/coinpusher interpret per catalogue). | luckBonus | — |
| 30 | tin_jockey | Tin Jockey | U | 16 | CURIOS | Derby: your selected runner's win probability ×1.25 (renormalised; posted odds unchanged). | derby.weight | D3 |
| 31 | sappers_badge | Sapper's Badge | U | 18 | CURIOS | Once per round: the first mine hit on Mines or the first crash below ×2.0 on The Elevator refunds 100 % of the bet. | onTag:bust | — |
| 32 | magnet_coin | Magnet Coin | U | 20 | DROPS | Claw grip-strength roll +30 points (catalogue scale); Coin Pusher side-gutter losses −50 %. | claw.grip, coinpusher.sideLoss | — |
| 33 | night_owl | Night Owl | U | 16 | — | During Last Call (final 20 s) payouts +40 % (A). | payoutMult | — |
| 34 | spare_number | Spare Number | U | 20 | DROPS | Keno, Ball Blower and Raffle Drum draw +1 ball; Bingo draws +3 balls. | keno/lotto/tombola/bingo.extraDraw | D2 |
| 35 | false_bottom | False Bottom | U | 22 | LEDGER | At Collection, if short by ≤10 % of the debt, the shortfall is forgiven and this charm breaks (removed). | econ.onCollect | — |
| 36 | long_thumbnail | Long Thumbnail | U | 16 | REELS | Scratch cards cost −20 %; every card gets a bonus box (20 %: ×1–×5 bet). | scratch.price, scratch.bonusBox | D2 |
| 37 | metronome | Metronome | U | 18 | WHEELS | luckBonus +10 on timing machines (cyclone, pachislot aim window, stacker). | luckBonus | D3 |
| 38 | red_thread | Red Thread | U | 16 | — | The first machine you play each round gets Tilt grace +3 and +10 % (A). | tilt.grace, payoutMult | — |
| 39 | cold_hands | Cold Hands | U | 16 | — | Cold Lamp factor ×0.75 → ×1.00 (tier-up punch grading kept). | lamp.coldMult | D3 |
| 40 | croupiers_rake | Croupier's Rake | U | 18 | WHEELS | Roulette outside bets (red/black, odd/even, low/high, dozens, columns) +20 % (A); Money Wheel 1:1 and 3:1 segments pay +1. | roulette/bigsix.pay | — |
| 41 | weighted_cup | Weighted Cup | U | 18 | DICE | Sic Bo triples and Craps hardways pay +50 % (A). | sicbo/craps.pay | D3 |
| 42 | brass_washer | Brass Washer | U | 20 | — | 15 % chance any play costs 0 pulls (tag `free`). | freePlayChance 0.15 | — |
| 43 | muzzle | Muzzle | U | 18 | REELS | The Big One: curse (MAW) chance ×0.5; EATEN spins refund 50 % of the bet. | bigone.curseChanceMult, onTag:curse | D2 |
| 44 | seven_floor_key | Seven-Floor Key | R | 45 | LEDGER | In the last round of each deadline, interest is applied twice. | econ.onSettle | D3 |
| 45 | sun_dial | Sun Dial | R | 50 | REELS | The Big One: SUN weight +4; `jackpotChance` ×2 on REELS; 4 % (not 2 %) of REELS bets feed the pot. | bigone.symbolWeight[SUN], jackpotChance | — |
| 46 | mirror_shoe | Mirror Shoe | R | 45 | CARDS | Once per play, peek the next card (Blackjack, Hi-Lo, War, Baccarat: next card face; Video Poker: first replacement card). | ui.peek | D4 |
| 47 | hollow_dice | Hollow Dice | R | 40 | DICE | Once per play reroll one die (Craps: once per shooter sequence). Coin Flip: re-flip once; the re-flip pays ×0.8 (M). | dice.reroll | D3 |
| 48 | golden_ratchet | Golden Ratchet | R | 45 | WHEELS | After a WHEELS result, pay 25 % of your bet to click it one position clockwise (once per play; roulette pocket, wheel segment, ring lamp, revolver chamber, drum ball → next number). | wheel.nudge | D4 |
| 49 | glass_funnel | Glass Funnel | R | 40 | DROPS | Plinko: choose the direction at 2 peg rows per puck (A/D prompt at rows 4 and 8). Pachinko: start-pocket gates open for the first 3 s of each pull. | plinko.steer, pachinko.gate | D4 |
| 50 | ringmasters_whistle | Ringmaster's Whistle | R | 45 | — | Each distinct suit you **win** on this round adds +15 % (A) to all payouts for the rest of the round (max +90 %). | onTag:win | — |
| 51 | collectors_tag | Collector's Tag | R | 40 | LEDGER | Each deadline paid after purchase permanently adds +10 % (A) to all payouts. | econ.onCollect | D4 |
| 52 | long_shot | Long Shot | R | 45 | — | Plays with base `mult ≥ 20` pay ×2 (M). | payoutMult | — |
| 53 | coiled_cord | Coiled Phone Cord | R | 35 | — | Random-call chance 60 % → 100 % per round; phone deal costs −25 %. | phone.* | D2 |
| 54 | house_keys | House Keys | R | 50 | — | On purchase: open one closed wing of your choice (never the Back Room). Then +10 % (A) on that wing's machines. | world.openWing | D5 |
| 55 | tilt_switch | Tilt Switch | R | 40 | — | Your most-played machine this round ignores Tilt; every other machine's Tilt factors become ×0.75/×0.55/×0.35. | tilt.* | A:Tilted |
| 56 | brass_knuckles | Brass Knuckles | R | 40 | CURIOS | Stacker: +1 block width on rows 1–6. Claw: +4 s timer. Shell Automaton: shuffle speed −20 %. | stacker/claw/shellgame.* | D3 |
| 57 | high_rollers_cufflink | High Roller's Cufflink | R | 45 | — | Every machine's max bet is one ladder step higher. | bet.maxStep +1 | D4 |
| 58 | photo_negative | Photo Negative | R | 45 | — | Losing plays have a 7 % chance to invert: pay ×2 the bet instead (tag `charm`). | onTag:loss | W |
| 59 | tote_ticket | Tote Ticket | R | 35 | WHEELS | Derby, Money Wheel and Roulette show the last 10 results; their longest-odds bets pay +25 % (A). | ui.history, payoutMult | — |
| 60 | crown_of_coins | Crown of Coins | L | 100 | — | All payouts ×1.5 (M). | payoutMult | D5 |
| 61 | perpetual_ledger | Perpetual Ledger | L | 90 | LEDGER | Pocket coins also earn interest at half the current rate (activity clause applies; no ceiling for pocket). | econ.onSettle | W |
| 62 | engravers_plate | Engraver's Plate | L | 100 | REELS | The Big One: unlocks TWIN RAILS and CORNERSTONE; every pattern multiplier +1. | bigone.extraPattern, bigone.patternMult | D6 |
| 63 | blackout_lamp | Blackout Lamp | L | 90 | — | Each punch also punches one random orthogonally adjacent unpunched cell. | card.punchExtra | A:Blackout |
| 64 | operators_glove | Lift Operator's Glove | L | 100 | — | +2 pulls and +30 s per round; Settle Early rewards doubled. | run.* | W |
| 65 | card_of_all_suits | Card of All Suits | L | 110 | — | Every machine counts as every suit for punch cells and affinity. | card.suitWildcard | A:Full Circuit |
| 66 | holy_water | Holy Water Flask | U | 20 | — | Consumable: removes one cursed charm when you use the flask on the Charm Board (E), then breaks. | charms.remove | F3 |
| 67 | wet_ledger | Wet Ledger | **X** | −25 | — | Interest −3 % (floor 0 %). | econ.interestAdd | F3 |
| 68 | sand_hourglass | Sand Hourglass | **X** | −20 | — | Round clock −40 s; +2 pulls per round. | run.* | F3 |
| 69 | gluttons_bib | Glutton's Bib | **X** | −30 | — | All payouts ×1.25 (M). At Bell, one random open machine becomes **Hungry** (red bib decal on its marquee): your first play there each round pays 0. | payoutMult, lamp.hungry | F3 |
| 70 | unblinking_eye | The Unblinking Eye | **X** | 0 | — | Current debt +4 % at the end of every round. Silver and Gold punches also punch one adjacent cell. | econ.debtAdd, card.punchExtra | F3 |
| 71 | moth_swarm | Moth Swarm | **X** | −15 | — | Pit lights −40 %, fog far −30 %. The Big One: MOTH weight +10. Lamp beacons off; the Hot machine is marked only by circling moths. | world.light, bigone.symbolWeight | F3 |
| 72 | gold_tooth | Gold Tooth | **X** | −40 | — | +20 % (A) on all payouts; every play with `mult ≥ 10` costs you 1 extra pull (from the next play; can go to 0). | payoutMult, run.pullsAdd | F3 |
| 73 | bent_lift_key | Bent Lift Key | **X** | 0 | — | Deadline 8 debt −25 %; all other future deadlines' debts +10 %. | econ.debtTable | W |
| 74 | pawn_ticket_13 | Pawn Ticket No. 13 | **X** | −50 | — | Occupies a peg. Each intermission the Pawn Window offers one item "for you" at −50 %. | shop.discountSlot | F3 |

(Ten cursed: #67–74 plus two more drawn as "under the counter" variants of #69 and #72 at double strength in Endless, ids
`gluttons_bib_ii`, `gold_tooth_ii`.)

### 4.3 Named synergies (builds the shop is tuned to surface)
| Build | Core charms | Machines | Fantasy |
|-------|-------------|----------|---------|
| **The Engine Room** | Brass Thimble + Polished Molar + Moth Lantern + Sun Dial (+ Engraver's Plate) → REELS affinity 4 (+50 %) | bigone, pachislot, bandit | Classic slot monster. Tilt grace +2 lets you feed The Big One 6 pulls a round. |
| **The Circuit** | Circuit Breaker + Ringmaster's Whistle + Card of All Suits + Stub Spike | one pull on each suit | Rotate the floor; +90 % by mid-round; the punch card fills itself. |
| **The Banker** | Piggy Tooth + Wax Seal + Ledger Pen + Seven-Floor Key + Perpetual Ledger (LEDGER affinity 4: +2 %) | grinders for activity, card for lines | Win by interest; the terminal becomes the jackpot. |
| **Card Sharp** | Counting Bead + Mirror Shoe + Dealer's Button + Billiard Chalk + Velvet Rope | blackjack, hilo, videopoker | Real skill; low variance; dampener limits it, so pair with Long Shot via Video Poker royals. |
| **Hot Hand** | Hot Coal + Red Thread + Worn Glove + Night Owl | whatever is lit | Chase beacons around the pit. |
| **Dice Rat** | Loaded Pip + Snake-Eye Ring + Hollow Dice + Weighted Cup | craps, sicbo, dicetower | Snake-Eye Ring pays on losses: dice become a slow money printer. |
| **Long Odds** | Long Shot + Photo Negative + Apology Card + Glass Eye | lotto, revolver, elevator, mines | Desperate, glorious, short-lived. |
| **Cursed Contract** | Glutton's Bib + Gold Tooth + Unblinking Eye + Blackout Lamp | any | Start rich, play on a knife edge; achievement "Cursed and Proud". |

---

## 5. The Hotline

### 5.1 Rules
- A red rotary phone in a wood-and-glass booth (`#5A2A18` wood, `#C0182A` handset) beside the lift. Booth lamp
  `#FFD34A` flashes while ringing.
- **Random calls**: each round, chance 60 % (Coiled Cord: 100 %), at a random time in [20 %, 75 %] of the clock.
  - Rings for 10 s (6 rings, 1.0 s on / 0.7 s off, two-tone 425/480 Hz bell synth).
  - Answer: walk in, E on the handset. Options are keys **1 / 2 / 3** (or click the dial digit); 8 s to choose, otherwise
    declined. E hangs up.
  - The clock keeps running while you talk.
  - Max 1 random call per round. Each event fires at most once per deadline, except P02 and P07.
- **Deadline Call**: guaranteed, in the intermission after every paid deadline. The House offers **3 Favours; pick 1**
  (permanent for the run).
- **Missed calls**: two missed calls in a row force P29 on the next ring.
- Voice: subtitled formant babble (see §6.4); every line is an i18n key `phone.<id>.*`.

### 5.2 Deadline Call favours (draw 3 without replacement; non-stackable ones leave the pool once taken)
| id | Favour | Effect | Stacks |
|----|--------|--------|--------|
| F01 | Patron | +1 pull per round. | ×2 |
| F02 | Overflow | Unused pulls convert to 2 Tickets each (instead of 1). | no |
| F03 | Favoured | +1 Hot Lamp per round. | ×2 |
| F04 | Compound | +2 % interest per round. | ×2 |
| F05 | Extra Peg | +1 charm peg (max 9). | ×3 |
| F06 | Discount | Pawn Window prices −15 %. | ×2 |
| F07 | Stamina | Tilt starts 1 pull later on every machine. | ×2 |
| F08 | Feed the Pot | Pot +10 % of current debt now; REELS +5 % (A). | no |
| F09 | Long Night | +30 s per round. | ×2 |
| F10 | Lean Month | Next deadline's debt −10 %. | yes (one-shot) |
| F11 | Wide Card | Next deadline's card is one size larger (cap 5×5). | yes (one-shot) |
| F12 | Second Opinion | Pawn Window +1 regular slot. | no |
| F13 | Pocket Change | +2 Tickets now and +1 Ticket at every Bell. | no |
| F14 | Wing Key | Open one more closed wing now (if any). | yes |

### 5.3 Random calls (29 events)
Weights are relative within the eligible pool. ×PI costs use the current PI.

| id | Name | Trigger (eligibility) | W | Offer | Consequence |
|----|------|-----------------------|--:|-------|-------------|
| P01 | Wrong Number | any | 10 | A voice asks for "Mr. Vell". [1] "Wrong number." [2] "Speaking." | [1] +1 Ticket. [2] 50 %: +8×PI ¢ ("for the tip"); 50 %: a random cursed charm on a free peg (if none free: −8×PI ¢). |
| P02 | The Tip | any | 12 | Whisper names one open machine. | That machine is Hot (×1.5, no Tilt) for 60 s, on top of the round's lamps. Free. |
| P03 | Loan Shark | start of last round and deposit < 50 % of debt; or soft-lock (§2.7) | 20 | [1] Take a loan of 30 % of the debt. [2] Decline. | [1] +30 % of debt to pocket; next deadline's debt + 45 % of that loan amount. |
| P04 | The Fixer | derby open, D3+ | 6 | [1] Pay 20×PI: "Lane 4 runs tonight." [2] Decline. | [1] Your next derby runner wins; 25 % Steward Inquiry: winnings voided and derby closed for the round. |
| P05 | Double or Nothing | D2+ | 8 | You hear a coin spin on a desk. [1] Call it. [2] Hang up. | [1] 50 %: pocket ×2; 50 %: pocket ×0.5. |
| P06 | Insurance Man | D3+ | 6 | [1] Pay 10 % of debt. [2] Decline. | [1] This deadline, a failed Collection grants one Overtime round (5 pulls, 90 s, no interest) instead of the trapdoor; still short → trapdoor. |
| P07 | Service Technician | a machine you played reached the 7th pull | 15 | [1] Pay 2 Tickets. [2] Decline. | [1] Tilt reset on all machines this round. |
| P08 | Room Service | any | 8 | "Coffee?" [1] Pay 5×PI. [2] Decline. | [1] +30 s this round. |
| P09 | The Pawnbroker | own ≥1 charm, D2+ | 8 | Offers 120 % of the price paid for one named charm. [1] Sell. [2] Keep. | [1] Charm removed, coins to pocket. |
| P10 | Lift Operator | any | 6 | Free information. | Shows next deadline's debt, its card size and (Endless) next House Rule; +1 Ticket. |
| P11 | The Census | D1–D3 | 6 | "State your name." [1] Say it. [2] Hang up. | [1] +2 Tickets; next Teller reading free. The House uses your name in later lines. |
| P12 | Static | D4+ | 6 | Only breathing. | Lights flicker 2 s; your next 3 plays +25 % (A). |
| P13 | Rigged Wheel | a WHEELS machine open | 6 | [1] Pay 15×PI. [2] Decline. | [1] Your next WHEELS result, if adjacent (±1) to a winning position for your bet, is moved onto it. |
| P14 | Hole Punch | D2+ | 8 | [1] Pay 3 Tickets. [2] Decline. | [1] Punch any unpunched Bronze or Silver cell of your choice. |
| P15 | Reprint | after Round 1 of a deadline | 6 | [1] Pay 2 Tickets. [2] Decline. | [1] All unpunched cells regenerate. |
| P16 | The Exorcist | you hold a cursed charm | 25 | [1] Pay 25×PI. [2] Decline. | [1] Remove one cursed charm of your choice (sign-on fee not refunded). |
| P17 | Raffle Winner | any | 5 | "Stub 4417, you've won." | Next intermission one Pawn Window item is free (red stub on it). |
| P18 | Consolidation | D4+ | 5 | [1] Consolidate. [2] Decline. | [1] Current debt −20 %; next deadline's debt +35 %. |
| P19 | Overtime | last round, after 50 % of the clock | 10 | [1] Pay 30 % of pocket. [2] Decline. | [1] This deadline gets one extra round (6 pulls, 120 s, interest applies). |
| P20 | Prank Caller | D2+ | 6 | Giggling. | Hang up (E) within 3 s: +1 Ticket. Otherwise all machines' Tilt +1 pull this round. |
| P21 | The House | D6+, once per run | 3 | "We admire you." [1] Accept. [2] Decline. | [1] A free Legendary now (you pick a peg to replace if full); Deadline 8 debt +25 %. |
| P22 | Silent Partner | Versus, D2+ | 10 | [1] Pay 10×PI and name a rival. [2] Decline. | [1] Rival's current debt +5 % (max once per target per deadline). The rival sees "A silent partner has invested in you." |
| P23 | Lucky Numbers | lotto open | 5 | Caller reads 6 numbers. | If you play the Ball Blower this round with exactly those numbers, 2 of them are guaranteed drawn. |
| P24 | The Teller Calls | fortuneteller open | 5 | "I've seen something." | Next Teller reading is free and guaranteed an Omen. |
| P25 | Party Line | Co-op | 10 | Speaker phone; all living players vote 10 s. [1] Accept. [2] Decline. | [1] Every living player loses 1 pull this round; team deposit +10 % of debt. |
| P26 | Collect Call | D5+ | 6 | "Will you accept the charges?" [1] Accept (pay 10 % of pocket). [2] Decline. | [1] Roll: 40 % random Uncommon charm · 35 % +3 Tickets · 20 % +1 pull now · 5 % the Collector visits (debt +5 %). |
| P27 | Tilt Whisperer | D3+ | 5 | Free. | Reveals next round's Cold Lamp machine and the suit of its first Hot Lamp. |
| P28 | Breathing | D5+ (Dread ≥ 2) | 4 | Breathing, no words. No choice. | On hang-up the jukebox stops for 10 s and every Tilt bulb in the pit blinks once. Flavour only. |
| P29 | Missed You | forced after 2 missed calls in a row | — | "You didn't pick up." [1] Pay 2 Tickets. [2] Refuse. | [2] Current debt +3 %. |

---

## 6. Horror and atmosphere

### 6.1 Cast (all procedural low-poly, ≤600 tris each)
| Character | Look | Behaviour |
|-----------|------|-----------|
| **The House** | Never seen. Speaks through brass PA horns `#B08A3A` on the ceilings. | Narrates, taunts, congratulates. Knows your name if you told the Census. |
| **The Collector** | 2.4 m tall; long coat `#1A1414`; wide hat; a brass face plate `#C8A040` with one vertical black coin slot; cream gloves `#E8E0C8`. | Arrives by lift at every Collection. Never runs, never touches you (except House Edge 5 / Endless). Distant sightings from Dread 1. |
| **Dealers** | Porcelain mannequins `#E8DCC8` with painted smiles and hairline cracks; oxblood vests `#4A1016`. | Run the tables (cards dealt by jointed arms). From Dread 1 their heads track you with a 0.4 s lag within 6 m. |
| **The Pawnbroker** | Only two ringed hands under a grille, wrists in shadow. | Slides charms across the counter; drums fingers when you idle >10 s. |
| **The Teller** | Porcelain bust in a glass booth, veil of coins, lamp eyes `#FFD34A`. | Deals tarot; turns her head 180° on THE COLLECTOR card. |

### 6.2 Dread levels (escalation)
| Dread | When | Light level | Flicker events | Fog far ×| Jukebox | Mannequins | Collector | Ambience |
|------|------|------------:|----------------|---------:|---------|------------|-----------|----------|
| 0 Opening Night | D1–D2 | 100 % | none | 1.0 | Lounge loop 92 BPM, in tune | Still | Collection only | Synth crowd murmur (filtered noise + random 180–320 Hz babble), distant coin cascades |
| 1 Late Shift | D3–D4 | 90 % | 1 per 45 s, 0.2–0.6 s, one zone | 0.9 | −15 cents detune, 0.3 Hz wow | Heads track (6 m) | +1 distant sighting per deadline | Murmur thins; an occasional laugh |
| 2 After Hours | D5–D6 | 75 % | 1 per 25 s | 0.75 | −40 cents, tape drag; at Last Call with <50 % deposited it plays reversed | Head and torso turn; one dealer is sometimes missing from its post, back next time you look | 1 sighting per round at the end of a sightline; vanishes 0.3 s after being centred in view | No crowd; 50 Hz HVAC hum; lift cable creaks |
| 3 The Bottom | D7–D8 | 55 %, plus one zone blacked out per round (rotating; machines still glow) | 1 per 15 s | 0.6 | Stops; single music-box loop | When you stand up from a machine, a dealer stands 3 m behind you (spawned only outside the view frustum) | Stands beside the terminal through the whole last round of each deadline | Sub-bass heartbeat 45 Hz at Last Call |
| 4 Overdrawn | Endless | 45 % | 1 per 10 s | 0.5 | Silence; reversed jackpot jingles | Machines rotate to face away when unobserved, snap back when seen | Roams the pit (1.2 m/s on the nav graph). A touch costs 10 % of pocket; he then vanishes for 60 s | Wind from the trapdoor seams |

### 6.3 Beats (trigger → effect)
1. **Wake-up**: the jackpot burst (§9.4) is warm and loud; the first minutes are deliberately cosy.
2. **First Collection (D1)**: first appearance of The Collector; the camera gently auto-turns toward the lift (0.6 s,
   only once per profile).
3. **Deposit shortfall at Last Call**: floor plates under you creak (2 kHz click + 0.5 mm camera tremor) if the deposit is
   < debt.
4. **Floor dial**: when the deposit is < 50 % of debt with one round left, the lift needle trembles toward a nonexistent
   "B8".
5. **Coins in the pocket tick** like a watch (1 Hz) during Last Call.
6. **The Big One in blackout** (Dread 3 zone blackout in the Hall): only its reels glow; the eye-spots on MOTH symbols
   glint.
7. **The phone rings with nobody** (P28) at Dread ≥ 2.
8. **The Teller turns her head 180°** on THE COLLECTOR omen.
9. **Machines whisper the player's name** in subtitles ("{NAME}… one more.") once per deadline from Dread 2, if the Census
   was answered.
10. **Jackpot at Dread ≥ 3**: after the gold wave the zone's lights come back 10 % dimmer ("spent").
11. **Sump wall**: your previous runs' name tags lie on the coin pile where you land.
12. **Topside**: the first and only time the lights go fully white `#FFF6E0`.

### 6.4 The House's voice
- **Babble**: formant-synth "Animalese"-style babble (sawtooth through two band-pass formant filters at random syllable
  formants, 9 syllables/s, pitch 95 Hz), then a radio band-pass 300–3,000 Hz and a spring-reverb convolver.
- **Speech option**: Settings → "House speaks: Babble / Browser speech" uses `speechSynthesis` (pitch 0.4, rate 0.85) for
  real words in EN or TR.
- Always subtitled in VT323. Sample lines (i18n `voice.*`):

| Trigger | Line |
|---------|------|
| Run start | "Good evening. You owe us. Make yourself at home." |
| Bell | "The floor is open." |
| Hot Lamp | "Something's running warm." |
| Last Call | "Last call. Last call." |
| Big deposit (≥50 % of debt in one go) | "Prudent." |
| `megawin` | "Look at you." |
| Jackpot | "Jackpot. We'll be seeing that again." |
| Paid | "Paid in full. For now." |
| Short | "Short by {N}. Mind the floor." |
| Max Tilt | "You're wearing it out." |
| D8 Bell | "Last floor. Last chance." |
| Topside | "Going up." |

### 6.5 Rules of taste and accessibility
- No blood, gore, body horror, self-harm imagery or weapons pointed at people. The Devil's Table device aims at a seat
  lamp: a live chamber shatters the bulb over your seat (glass tinkle, darkness, bet lost).
- No jump scare louder than −6 dBFS peak, no full-screen flash above 70 % white.
- **Reduce Flashing** setting: strobes capped at 3 Hz and 40 % intensity; jackpot wave without strobe.
- **Calm Mode**: removes sightings, mannequin turning, P28 and Overdrawn stalking. Keeps the lighting mood. Achievements
  stay enabled.
- Opening card: "JACKPIT contains simulated gambling with fictional currency. No real money can be spent or won."

---

## 7. Modes

### 7.1 Debt Run (single player)
Everything in §2–§6. No network. Kit choice and House Edge level at start. Seeded and Daily variants (§11.7).

### 7.2 Co-op Debt Run (2–8 players, one shared debt)
| Rule | Spec |
|------|------|
| Debt | Solo table × `(1 + 0.8 × (N − 1))`, with N = players at run start (2: ×1.8 · 4: ×3.4 · 8: ×6.6). |
| Pockets | Personal. Each player starts with 40 ¢ and 2 Tickets. |
| Deposit | **One shared** terminal balance; anyone can deposit. Withdrawal needs a majority vote of living players (terminal shows YES/NO buttons, 15 s). |
| Transfers | Look at a teammate, tap G = give 10 % of pocket, hold G 1 s = give 25 %. A coin pouch arcs between hands (0.5 s). Free. |
| Interest | On the shared deposit (ceiling 2 × team debt). Activity clause: ≥3 pulls used per living player on average. LEDGER charms from several players stack, capped at +8 % team-wide. |
| Pulls | Per player, per round (the full schedule for each). |
| Clock | Shared. Closing starts when it hits 0 or when every living player has 0 pulls or has pulled their Ready chain at the terminal. |
| Tilt | Per player. |
| Lamps | Hot Lamps +1 per 3 players. Shared. |
| Punch card | One shared card; anyone punches. Size: N 2–3 → normal; N 4–6 → +1 dimension; N 7–8 → 5×5. Bounties to the shared deposit. |
| Charms | Personal boards (6 pegs each). The Pawn Window serves 2 players at once; with N ≥ 4 the Cashier window opens as a second Pawn Window. Each player sees personal stock (seeded per player). |
| Phone | One phone; whoever answers chooses (positional speaker audio so others hear). Party Line (P25) votes. Deadline Call: the team votes on the 3 Favours (each player presses 1/2/3; ties random). |
| Wing Pick | Vote at the lift panel (20 s). With N ≥ 4 one wing is open from D1; with N ≥ 6 two. |
| **Collateral Clause** | If the team is short at Collection by ≤ 25 % of the debt, The Collector waits 10 s. Any living player may step onto the brass **X plate** (0.8 × 0.8 m) in front of the terminal. Each volunteer forgives up to 15 % of the debt. The last living player cannot volunteer. Volunteers drop through the trapdoor and become **ghosts** until the next deadline is paid, then return by lift with 0 ¢ and their charms. |
| Ghost powers (co-op) | Fly at 4 m/s, pass through walls, invisible to The Collector. 1/round **Whisper** (+20 % (A) on a chosen living player's next play), unlimited **Ping** (ghost-glow on a machine for 5 s), and ghosts may answer the phone. |
| Team fail | Shortfall > 25 %, or no volunteers: everyone falls. Shared Sump results with awards: Top Earner, Most Punches, Collateral, Phone Hog. |

### 7.3 Versus "Last One Standing" (2–8)
| Rule | Spec |
|------|------|
| Debt | Each player owes the solo schedule (×1.0). Same clock and deadlines for all. |
| Deposit | The Debt Terminal has 8 brass lockers; the UI shows only your own balance. Others' deposit *ratios* are on the Tab scoreboard. |
| Cards | Each player gets their own card, generated from the same seed (fair start, diverging punches). |
| Machines | Shared. Single-seat machines are occupied first-come (catalogue occupancy). Tables are shared. Tilt is per player, which naturally rotates hogs. |
| Phone | Calls are addressed: the booth's nixie display shows the target's name; only they can answer. Sabotage call P22 Silent Partner. The lowest deposit-ratio player at Bell gets a guaranteed The Tip (P02). |
| Leader marker | From D5, the highest deposit ratio wears a faint gold outline visible through walls (`#FFD34A`, 25 % opacity). |
| Failure | Falls through the trapdoor and becomes a **ghost spectator**: free-fly, follow-cam, sees everyone's cards. 1/round **Bless** (+20 % (A) on a living player's next play) or **Curse** (+2 Tilt pulls on the target's current machine). Never the same target twice in a row. Ghost names are shown; no anonymous griefing. |
| Ghost Call | Once per round the ghosts collectively get the phone: majority vote to add +5 % debt to the current leader (or nothing). |
| End | Last living player after a Collection wins. If all remaining players fall at the same Collection, the highest deposit ratio wins. If any players pay D8, the highest surplus wins and rides the lift; others watch. |
| No transfers | Coins cannot be given in Versus. |

### 7.4 Free Casino (sandbox, 1–8, join in progress)
- No debt, no rounds, no pulls, no Tilt, no lamps (optional "Lamps on" host toggle). The wall clock shows real local time.
- All wings open. Each player starts with 1,000 ¢. The **Cashier window** lends 500 ¢ on request; loans are tracked as
  "House Credit" on the scoreboard.
- Host picks a TLM preset (×1 / ×5 / ×20 / ×50).
- Pawn Window sells every unlocked charm at the D1 price (cursed charms off by default).
- Tab scoreboard ranks by net worth. Jukebox takes requests (E: next track). Chat and emotes (V wave, B point).

### 7.5 Mode comparison
| | Debt Run | Co-op | Versus | Free Casino |
|-|----------|-------|--------|-------------|
| Players | 1 | 2–8 | 2–8 | 1–8 |
| Debt | solo | shared ×(1+0.8(N−1)) | personal | none |
| Clock / pulls / Tilt | yes | yes (shared clock) | yes | no |
| Pause | yes | no | no | no |
| Join in progress | — | no (rejoin your own slot after disconnect) | no | yes |
| Spawn | jackpot burst (Hall) | lift → Mouth | lift → Mouth | lift → Mouth |
| Fail state | trapdoor | Collateral / trapdoor | ghost | none |
| Saves | every play | host snapshot each intermission (resume with the same peers) | none | none |

### 7.6 Authority notes
- The host owns: run state, all RNG streams, lamps, card, phone rolls, Collection and the trapdoor.
- Clients send intents (`mc.req`, `term.deposit`, `phone.answer`, `vote.*`).
- If the host leaves: Co-op/Versus end with a host snapshot the host can reload. Free Casino migrates the host to the
  lowest-ping peer.

---

## 8. Level layout: the pit

### 8.1 Conventions
- Units are metres; see §0 for axes.
- Floor plates are 2 × 2 m; walls 0.3 m thick. Player capsule radius 0.3 m, eye height 1.62 m (crouch 1.05 m).
- Speeds: walk 3.0 m/s, sprint 5.2 m/s, crouch 1.5 m/s.
- Stairs: 0.2 m rise / 0.3 m run, 3 m wide. Wing doorways 3 m wide with roll-down iron grilles `#2A2A2A` (3 s rattle on
  open).

### 8.2 Schematic (north up; not to scale. The tables below are authoritative)
```
 z        x: -24            -10 -8          0          8  11       16        23
 -24                                                         .-----------.
 -22       +---------------+                                /    WHEEL    \
           |  CURIO ARCADE |     +======== THE MOUTH ======+|   ROTUNDA    |
 -18       |  (elevator    |     | TERM    [ LIFT ]   PHONE||   (r = 7 m)  |
           |   crash ride) |     |  X        clock        ||              |
 -13       |               +=====+  BOARD          TELLER +=+  [roulette]  |
 -11       |               |     |                        | \             /
  -8       +-------+=+-----+-----+=====railing== st ======+--'---+==+---'
           |      gate     |     |                        |  DICE DEN    |
           |   CARD ROOM   |     |     HALL OF REELS      |              |
   0       |  [long table] = st  |  (sunken, y = -1.2)    st= [craps]    |
           |               |     |    [ THE BIG ONE ]     |              |
   4       |               |     |                        +--------------+
   8       +---------------+-----+=========== st =========+
                           |          DROP GALLERY         |=c=+--------+
                           |  pachinko bank   bingo  pusher|   |  BACK  |
  16                       |                               |   |  ROOM  |
  20                       +-------------------------------+   +--------+
```

### 8.3 Zones
| Zone | id | Footprint (x × z) | Floor y | Ceiling (above floor) | Opens | Machines (default) |
|------|----|-------------------|--------:|----------------------:|-------|--------------------|
| The Mouth | `mouth` | x −8…8, z −18…−8 (16 × 10) | 0.0 | 4.5 | always | fortuneteller + system props |
| Hall of Reels | `hall` | x −8…8, z −8…8 (16 × 16) | −1.2 | 7.0 | always | bigone, bandit, videopoker, scratch, coinflip, bigsix, plinko, stacker |
| Card Room | `cards` | x −24…−8, z −8…8 (16 × 16) | 0.0 | 3.2 | Wing Pick | holdem, blackjack, baccarat, hilo, war |
| Dice Den | `dice` | x 8…22, z −8…4 (14 × 12) | 0.0 | 3.6 | Wing Pick | craps, sicbo, dicetower, shellgame |
| Wheel Rotunda | `wheels` | circle centre (16, −17), r 7 | 0.0 | 6.0 dome centre / 3.5 rim | Wing Pick | roulette, cyclone, tombola, pachislot |
| Drop Gallery | `drops` | x −10…10, z 8…20 (20 × 12) | 0.0 | 5.0 | Wing Pick | pachinko ×3, coinpusher, keno, bingo, lotto |
| Curio Arcade | `curios` | x −24…−10, z −22…−8 (14 × 14) | 0.0 | 3.0 | Wing Pick | elevator, claw, mines, derby |
| Back Room | `back` | x 10…18, z 8…16 (8 × 8) | 0.0 | 2.6 | after D6 (fixed) | revolver |
| Lift car | `lift` | x −1.1…1.1, z −20.2…−18 (2.2 × 2.2) | 0.0 | 2.6 | lobby / ending | — |
| The Sump | `sump` | x −6…6, z −6…6 (12 × 12) | −30.0 | 4.0 | on fail | — |

### 8.4 Connections and gates
| Link | Geometry | Gate |
|------|----------|------|
| Mouth ↔ Hall | stairs x −1.5…1.5, from z −8 (y 0) down to z −6.2 (y −1.2), 6 steps | none |
| Hall ↔ Card Room | stairs z −1.5…1.5, x −8 → −6.2 | grille at x −8 |
| Hall ↔ Dice Den | stairs z −1.5…1.5, x 6.2 → 8 | grille at x 8 |
| Hall ↔ Drop Gallery | stairs x −1.5…1.5, z 6.2 → 8 | grille at z 8 |
| Mouth ↔ Rotunda | corridor x 8…11.1, z −13…−11 | grille at x 8 |
| Dice Den ↔ Rotunda | corridor x 15…17, z −10…−8 | grille at z −8 (opens only if both wings are open) |
| Mouth ↔ Curio Arcade | corridor x −10…−8, z −13…−11 | grille at x −8 |
| Card Room ↔ Curio | doorway x −17…−15 at z −8 | opens only if both are open |
| Drop Gallery ↔ Back Room | doorway z 9…10.5 at x 10; red velvet curtain `#6A0A14` + padlocked chain until D7 | chain |

Every Wing Pick wing has a direct link to the Hall or the Mouth, so any pick order works. The Mouth has a brass railing
(1.0 m, `#B08A3A`) along z −8 overlooking the sunken Hall: the Hall reads as "the pit" from the moment you arrive.

### 8.5 Slot classes (generic, so machines can be swapped)
| Class | Footprint (W × D) | Max height | Seat anchors | Fits |
|-------|-------------------|-----------:|--------------|------|
| S | 0.8 × 0.8 | 2.0 | 1 (front, 0.7 m) | scratch, coinflip, mines, lootbox |
| M | 1.2 × 1.0 | 2.6 | 1 (front, 0.8 m) | upright cabinets, booths |
| W | 1.6 × 1.0 | 3.2 | 1–4 (front arc) | tall/wheel machines: bigsix, plinko, cyclone, lotto |
| L | 2.6 × 1.8 + 1.0 seat ring | 2.4 | up to 6 | tables: blackjack, baccarat, sicbo, coinpusher, keno, revolver |
| XL | 3.6 × 2.4 + 1.2 seat ring | 3.2 | up to 8 | bigone (with dais), holdem, craps, roulette, bingo, derby, elevator |

A machine declares its class. A slot accepts its class or any smaller one. The layout file `src/world/layout.ts` maps
`slotId → machineId` (duplicates allowed: the default multiplayer layout duplicates pachinko ×3, bandit ×2, videopoker ×2
into spares).

### 8.6 Slot table (default layout)
"Faces" = direction of the machine front (the player stands on that side). For tables, "dealer" = where the dealer stands.

| Slot | Zone | Class | Position (x, y, z) | Faces / dealer | Default |
|------|------|-------|--------------------|----------------|---------|
| HALL-XL-1 | hall | XL | (0, −1.2, 0) on a 4 × 4 m dais, 0.3 m high | faces N | bigone |
| HALL-W-1 | hall | W | (−5.5, −1.2, −7.2) | faces S | bigsix |
| HALL-W-2 | hall | W | (5.5, −1.2, −7.2) | faces S | plinko |
| HALL-M-1 | hall | M | (−7.3, −1.2, −4.5) | faces E | bandit |
| HALL-M-2 | hall | M | (−7.3, −1.2, 4.5) | faces E | videopoker |
| HALL-M-3 | hall | M | (7.3, −1.2, −4.5) | faces W | stacker |
| HALL-M-4 | hall | M | (7.3, −1.2, 4.5) | faces W | jukebox (prop; swappable) |
| HALL-S-1 | hall | S | (−5.0, −1.2, 7.4) | faces N | scratch |
| HALL-S-2 | hall | S | (5.0, −1.2, 7.4) | faces N | coinflip |
| MOUTH-TERM | mouth | M | (−4.0, 0, −17.4) | faces S | Debt Terminal |
| MOUTH-X | mouth | — | (−4.0, 0, −15.6) | — | Collateral plate (co-op) |
| MOUTH-LIFT | mouth | — | doors centred (0, 0, −18.0), 2.0 × 2.6 m | faces S | Lift |
| MOUTH-CLOCK | mouth | — | (0, 3.6, −17.95), Ø 1.2 m | faces S | Wall clock |
| MOUTH-DIAL | mouth | — | (0, 2.9, −17.95), 1.0 × 0.5 m semicircle | faces S | Floor dial B7…G |
| MOUTH-PHONE | mouth | M | (4.0, 0, −17.4) | faces S | Hotline booth (1.0 × 1.0 × 2.3) |
| MOUTH-PAWN | mouth | — | (−7.9, 0, −9.8), window 1.6 m wide, counter 1.0 m high | faces E | Pawn Window |
| MOUTH-BOARD | mouth | — | (−7.95, 1.3, −16.5), 1.6 × 1.0 m | faces E | Charm Board |
| MOUTH-M-1 | mouth | M | (7.3, 0, −16.0) | faces W | fortuneteller |
| MOUTH-CASH | mouth | — | (7.9, 0, −9.8) | faces W | Cashier (Free Casino) / 2nd Pawn Window (co-op N ≥ 4) |
| CARD-XL-1 | cards | XL | (−17.0, 0, 0) | dealer W | holdem |
| CARD-L-1 | cards | L | (−12.5, 0, −4.8) | dealer N | blackjack |
| CARD-L-2 | cards | L | (−12.5, 0, 4.8) | dealer S | baccarat |
| CARD-M-1 | cards | M | (−23.3, 0, −5.0) | faces E | hilo |
| CARD-M-2 | cards | M | (−23.3, 0, 5.0) | faces E | war |
| CARD-M-3 | cards | M | (−20.0, 0, 7.3) | faces N | spare |
| DICE-XL-1 | dice | XL | (15.0, 0, −2.0), long axis E–W | stickman N | craps |
| DICE-L-1 | dice | L | (11.5, 0, 2.4) | dealer S | sicbo |
| DICE-M-1 | dice | M | (21.3, 0, −5.0) | faces W | dicetower |
| DICE-M-2 | dice | M | (21.3, 0, 1.5) | faces W | shellgame |
| DICE-M-3 | dice | M | (11.0, 0, −7.3) | faces S | spare |
| WHEEL-XL-1 | wheels | XL | (16.0, 0, −17.0), wheel head east | croupier E | roulette |
| WHEEL-W-1 | wheels | W | (16.0, 0, −22.8) | faces S | cyclone |
| WHEEL-M-1 | wheels | M | (20.9, 0, −20.0) | faces centre | tombola |
| WHEEL-M-2 | wheels | M | (20.9, 0, −14.0) | faces centre | pachislot |
| WHEEL-M-3 | wheels | M | (11.1, 0, −20.0) | faces centre | spare |
| DROP-M-1/2/3 | drops | M | (−9.4, 0, 10.0) / (−9.4, 0, 11.2) / (−9.4, 0, 12.4) | faces E | pachinko ×3 |
| DROP-XL-1 | drops | XL | (−4.5, 0, 16.0), caller cage N end | caller N | bingo |
| DROP-L-1 | drops | L | (4.5, 0, 16.0) | 2 seats N + S | coinpusher |
| DROP-L-2 | drops | L | (6.5, 0, 13.0) + board on east wall (9.9, 2.8, 13.0) 3.0 × 1.8 m | faces E | keno |
| DROP-W-1 | drops | W | (0, 0, 19.2) | faces N | lotto |
| BACK-L-1 | back | L | (14.0, 0, 12.0), round table Ø 1.6 | player W, automaton E | revolver |
| BACK-PROP | back | — | (17.2, 0, 15.2) | — | The Collector's chair |
| CURIO-XL-1 | curios | XL | (−17.0, 0, −15.0), car 3.0 × 3.0 | door S | elevator (crash) |
| CURIO-XL-2 | curios | XL | (−17.0, 0, −20.4), track 3.6 × 1.6, long axis E–W | spectators S | derby |
| CURIO-M-1 | curios | M | (−23.3, 0, −11.0) | faces E | claw |
| CURIO-S-1 | curios | S | (−23.4, 0, −13.0) | faces E | mines |
| CURIO-M-2 | curios | M | (−23.3, 0, −17.0) | faces E | spare (claw ×2 in MP) |

### 8.7 Lighting mood per zone (PSX vertex-lit; ≤ 8 dynamic lights per zone, rest baked into vertex colours)
| Zone | Key light | Accent | Ambient | Fog colour, near/far (m) | Mood |
|------|-----------|--------|---------|--------------------------|------|
| Mouth | 2 sodium pendants `#FFB45A` | terminal amber CRT `#FFB000`, booth lamp `#FFD34A` | `#2A1A10` | `#120A06`, 6 / 28 | Hotel lobby at 3 a.m. |
| Hall of Reels | cone over the dais `#FFE2A0` | marquee bulbs `#FFC861`, The Big One emissive | `#1E1410` | `#0E0806`, 6 / 32 | Cathedral of a slot machine |
| Card Room | green banker lamps `#7CFF9A`, 1.2 m pools over tables | oxblood walls `#4A1016`, brass `#B08A3A` | `#0A120C` | `#06100A`, 4 / 20 | Low, quiet, intimate |
| Dice Den | bare bulbs `#FFE6B0` on cords | red neon "DICE" `#FF4A3A` | `#200808` | `#140404`, 4 / 22 | Sweaty back-alley |
| Wheel Rotunda | roulette pendant `#FFF0C8` | rim neon ring alternating `#38E8FF` / `#FF3FD0` | `#0A0614` | `#08040F`, 6 / 30 | Spinning dome, carnival |
| Drop Gallery | fluorescent tubes `#DDF4FF` (1 in 6 flickers) | chrome highlights | `#10161A` | `#0A0E10`, 8 / 34 | Pachinko parlour roar |
| Curio Arcade | neon `#FF2E88`, `#3AFF6E`, `#FFE23A` | black-light `#6A2CFF` (UV carpet pattern) | `#0C0614` | `#0A0410`, 4 / 20 | Abandoned arcade |
| Back Room | one bare bulb `#FFD9A0`, swinging ±12°, period 3.1 s | — | `#050303` | `#030202`, 2 / 10 | Interrogation room |
| Lift | ceiling panel `#FFF2D0` | brass walls | `#2A2418` | none | Safe, for 20 seconds |
| Sump | shaft from above `#FFB45A` | coin glints | `#000000` | `#000000`, 2 / 14 | The bottom |

### 8.8 Spawn points (8 players)
| Set | Used by | Positions (x, y, z) | Facing |
|-----|---------|---------------------|--------|
| **HALL arc** (r 4.0 m around The Big One, north side) | Solo burst-out uses SP-H0 (0, −1.2, −3.6). MP intro variant uses SP-H1…H8 | SP-H1 (−3.17, −1.2, −2.43) · SP-H2 (−2.44, −1.2, −3.17) · SP-H3 (−1.53, −1.2, −3.70) · SP-H4 (−0.52, −1.2, −3.97) · SP-H5 (0.52, −1.2, −3.97) · SP-H6 (1.53, −1.2, −3.70) · SP-H7 (2.44, −1.2, −3.17) · SP-H8 (3.17, −1.2, −2.43) | North (toward the stairs, lift and clock) |
| **MOUTH arc** (r 4.0 m around the lift doors) | Co-op, Versus, Free Casino, join-in-progress | SP-M1 (−3.17, 0, −15.56) · SP-M2 (−2.44, 0, −14.83) · SP-M3 (−1.53, 0, −14.30) · SP-M4 (−0.52, 0, −14.03) · SP-M5 (0.52, 0, −14.03) · SP-M6 (1.53, 0, −14.30) · SP-M7 (2.44, 0, −14.83) · SP-M8 (3.17, 0, −15.56) | South (toward the railing and the Hall) |
| **LIFT** (pre-game lobby) | MP lobby, Topside ride | 2 rows × 4: x ∈ {−0.75, −0.25, 0.25, 0.75}, z ∈ {−19.6, −18.9}; player-player collision off inside the car | South (doors) |
| **Ghost** | Fallen players | rise from their trapdoor hole to y +1.0 | camera free |

Neighbour spacing on both arcs: 1.04 m (chord of 15° at r 4 m).

### 8.9 Trapdoor grid and Sump
- Every walkable plate (2 × 2 m) is a separate mesh with two hinged halves.
- Stairs, the dais and the lift car are not trapdoors. Standing on stairs at a failed Collection: you are pushed 1 m to the
  nearest plate first.
- The Sump: a pile of 3,000 instanced coins (sculpted mound, Ø 6 m, 1.2 m high). Name tags of past runs are scattered on
  it; one wall carries a corkboard "Sump Wall" of the last 50 tags.

### 8.10 Wing Pick
After each paid deadline (D1–D5), the lift's call panel shows one brass push-button per closed wing, each with its suit
glyphs and a 3-line machine list. Press E on one: the grille rattles up (3 s). This choice is the main build steer
("I'm going dice: open the Den"). Kits and House Keys can open wings early.

---

## 9. Menu and intro flow

### 9.1 Boot
1. Black. Plain text (VT323, `#F2E8D0`): the simulated-gambling notice (§6.5), 2.5 s or any key.
2. "PRESS ANY KEY" on a dark frame. The keypress unlocks the AudioContext and requests pointer lock. Cut to the jackpot
   menu.

### 9.2 The jackpot menu (inside The Big One)
- **Scene**: the camera sits at the axis of the centre reel of a giant 5-reel bank (menu scale: drums Ø 2.4 m, 1.0 m wide,
  0.06 m gaps).
  - The reel strips are translucent backlit film (warm `#FFE2A0` backlight); symbols are the catalogue's Big One symbols at
    64×64 px.
  - In front, at eye level, is the reel window: dusty glass with a faint reflection. Through it, blurred by fog, is the dark
    pit (a low-detail proxy of the Hall). Every 40–90 s a tall silhouette crosses outside the glass.
- **Navigation = reels**:
  - Menu depth maps to reel index: level 1 on reel 3 (centre), level 2 on reel 4, level 3 on reel 5.
  - W/S or the mouse wheel rotate the active reel one face (8 faces per drum, 45°) in 0.18 s with a mechanical clunk and a
    6° overshoot.
  - A/D (or Esc/Backspace for back) move between reels. Enter/LMB selects.
  - Inactive reels idle-spin at 0.3 rad/s.
- **Camera**: FOV 70°, mouse parallax ±6°, idle sway ±1.5° at 0.2 Hz. Motor hum 58 Hz plus a click per face.
- **Complex panels** (server browser, settings, stats, credits) render on the glass itself as a "lit panel": a 256×144
  canvas texture, PSX-dithered, amber `#FFB000` on `#140A00`. The reels dim to 30 % while a panel is up.

### 9.3 Menu tree (labels are i18n keys)
| Reel 3 | Reel 4 | Reel 5 |
|--------|--------|--------|
| PLAY | CONTINUE (if a save exists) · NEW DEBT RUN · DAILY · SEEDED | Kit selector · House Edge 0–8 · Seed entry |
| MULTIPLAYER | SERVER BROWSER (panel) · HOST · JOIN BY CODE · LOCAL TABS | Host form (panel) |
| FREE CASINO | SOLO · HOST · BROWSE | — |
| LEDGER | STATS · ACHIEVEMENTS · SUMP WALL · UNLOCKS | — |
| SETTINGS | VIDEO · AUDIO · CONTROLS · GAMEPLAY · NETWORK · LANGUAGE (EN/TR) | panel |
| CREDITS | (strip scrolls) | — |
| QUIT | ("Close the tab to leave The House.") | — |

### 9.4 PLAY → JACKPOT → burst-out timeline (solo; also the MP intro on host Start)
| t (s) | Event |
|------:|-------|
| 0.00 | Select NEW DEBT RUN. A coin sprite drops from the top of the window into an unseen slot (clink, 2.1 kHz). |
| 0.50 | Lever sound. All 5 drums ramp to 14 rad/s in 0.3 s; the camera shakes 0.01. |
| 1.20 → 2.20 | Drums stop left to right every 0.25 s on SUN (the catalogue's jackpot symbol): 6° overshoot, 0.08 s settle, thunk per reel. |
| 2.30 | JACKPOT: FM bells (880/1320 Hz), backlights strobe gold `#FFD34A` at 8 Hz (3 Hz with Reduce Flashing) for 1.2 s, 120 coins pour past the camera. House voice: "Jackpot. Welcome home." |
| 3.50 | The glass cracks (crack decal grows over 0.25 s), sharp tick, shake 0.04. |
| 3.80 | Shatter: 64 triangle shards, outward 4–9 m/s, gravity. The camera dollies 5 m forward in 0.7 s (ease-out-expo); FOV 70 → 100 → 75. |
| 4.45 | One white-gold frame `#FFF0C0`. The menu scene swaps to the pit scene at the same camera transform, exiting The Big One's front glass. |
| 4.50 | The camera drops onto SP-H0 (solo) or the player's SP-H slot (MP): 0.12 m crouch dip over 0.3 s, a few shards tinkle on the floor, coins roll away. |
| 5.00 | Control given. Title card (VT323, centre): "DEADLINE 1 — 75¢ — 3 ROUNDS". Fades after 2.5 s. Bell. |

Skippable after the first time (hold Space: jumps to 4.45).

### 9.5 Multiplayer lobby = the lift
- Joining a room puts you in the lift car. The floor dial descends G → B7 in a 40 s loop while waiting. Players stand,
  chat (T), wave (V).
- **Ready** = press the lift's brass "B7" button (it lights). The host's panel shows ready flags and a START button
  (enabled when ≥2 players are ready, or the host alone in Free Casino).
- **Start**: lights cut 0.5 s, cable judder, chime, the doors open on the Mouth and players spawn at the MOUTH arc. With
  the "Jackpot intro" room option on, every client plays §9.4 instead and lands on the HALL arc.

### 9.6 Pause (Esc)
- "The Ledger": a leather book overlay at internal resolution (PSX-dithered), pages turn 0.2 s.
- Entries: RESUME · PUNCH CARD (full view) · CHARMS (inspect: name, rarity, exact effect) · RUN INFO (seed, kit, House
  Edge, deadline/debt table so far) · SETTINGS · ABANDON RUN (hold 2 s → trapdoor) · QUIT TO JACKPOT (saves).
- Solo freezes time. Multiplayer does not; a "?" floats over your avatar after 5 s.

### 9.7 Settings
| Tab | Options (defaults in bold) |
|-----|----------------------------|
| Video | Internal res 320×180 / **400×225** / 640×360 · Dither **on** · Vertex snap 0/**1**/2 · Affine warp **on** · 15-bit colour **on** · CRT scanlines **off** · Vignette **on** · Fog distance 0.6–1.4 (**1.0**) · FOV 60–100 (**75**) · Brightness · Reduce Flashing **off** · Head-bob **on** · Max FPS 30/**60**/uncapped |
| Audio | Master **80** · Music **60** · SFX **80** · Voice **80** · House speaks: **Babble** / Browser speech · Mono **off** |
| Controls | Mouse sensitivity 0.1–5.0 (**1.0**) · Invert Y · Crouch hold/**toggle** · Rebind all keys |
| Gameplay | Language **EN** / TR · Subtitles **on** · Calm Mode **off** · Skip seen cinematics **on** · HUD scale ×1/**×2**/×3 · Auto-deposit reminder at Last Call **on** |
| Network | Player name (16 chars) · Lobby server URL (**ws://localhost:8787**) · Prefer relay **off** · Global lobby (Trystero/Nostr) **off** |

### 9.8 Server browser and host form (lit panel)
- **Transport tabs**: LOBBY (Node ws) · LOCAL TABS (BroadcastChannel) · GLOBAL (Trystero, if enabled).
- **Columns**:

| Col | Content |
|-----|---------|
| 🔒 | password lock glyph (pixel) |
| ROOM | name, 24 chars |
| HOST | host name |
| MODE | CO-OP / VERSUS / FREE |
| PLAYERS | 3/8 |
| PING | ms (green < 60, amber < 150, red ≥ 150) |
| STATE | IN LIFT / B5 R2 (in progress) |

- **Controls**: W/S select · Enter join · F5 refresh (auto every 10 s) · filters (mode, hide full, hide locked, hide in
  progress) · sort by any column (click header).
- **Host form**:
  - Room name, mode, max players 2–8, password (optional), visibility Public/Unlisted.
  - House Edge 0–8 (co-op/versus), TLM preset (free), Jackpot intro on/off, seed (optional).
  - Room code shown after hosting: 6 chars, Crockford base32.

### 9.9 Death / results: The Sump
- You land on the coin mound. The camera settles looking down at your **name tag** (a laminated ID card, enlarged into
  view). It reads (VT323, i18n):

```
  NAME                    RUN #34   SEED K7Q2-M9XD   HOUSE EDGE 2
  FELL AT   DEADLINE 4 (B4), ROUND 3 — SHORT BY 312¢
  PAID      3 of 8        TIME 31:42
  WAGERED   9,420¢        WON 8,870¢       INTEREST 1,104¢
  BIGGEST   ×44 PLINKO BOARD (1,320¢)
  FAVOURITE THE BIG ONE (41 pulls)
  CARD      5 lines · 0 blackouts        CALLS 4/6 answered
  CHARMS    [16×16 icons]
```
- Four physical choices (look + E):
  - a rope ladder dropping from the trapdoor = **CLIMB AGAIN** (same kit; new seed)
  - a coin labelled MENU = **BACK TO THE JACKPOT**
  - the tag itself = **COPY SEED**
  - the corkboard = **SUMP WALL**
- Co-op: every teammate lands. Tags are laid side by side with award ribbons. Versus: ghosts watch the winner's lift ride
  on a CRT in the Sump.

### 9.10 Win: Topside
1. D8 PAID → every light goes white `#FFF6E0` for the first time. The jukebox plays a major-key jingle. The lift doors
   open by themselves.
2. Walk in, press G. Ride 18 s: the dial counts B1 → G, coins rattle in the pocket, the cable sings.
3. The doors open on a rainy night street: low-poly, wet asphalt reflections, neon `#FF2E88`, a bus stop. Walk 6 s.
4. Text: "TOPSIDE. The House thanks you for your patronage." plus the stats tag.
5. Choices: **CREDITS** · **GO BACK DOWN** (Endless: the doors close, the dial spins past B7 to B8) · **MENU**.

### 9.11 Stats (LEDGER → STATS)
- **Lifetime**: runs, wins, best deadline, best Endless floor, total wagered/won, realised RTP, biggest single win (machine,
  ×, coins), longest win streak, blackouts, Collateral volunteered, times fallen.
- **Per machine**: pulls, wagered, won, realised RTP, best ×.
- **Per charm**: times bought, win rate when held.
- Stored in IndexedDB (`jackpit.stats.v1`).

---

## 10. HUD and feedback

### 10.1 HUD layout (drawn into the 400×225 internal buffer, nearest-scaled, so it is PSX too)
Fonts: VT323 16 px for numbers, Press Start 2P 8 px for labels. Text shadow 1 px `#000000`.

| Element | Anchor (internal px) | Content / style |
|---------|---------------------|-----------------|
| Pocket | top-left (4, 4) | `¢ 1,234`, `#FFD34A`. Count-up 30 ticks/s on gain; red flash `#FF3030` 0.2 s on spend |
| Tickets | (4, 20) | `▣ 7`, `#E8343A` |
| Round clock | top-centre (200, 4) | `02:31`, `#F2E8D0`. Last Call: `#FF3030`, 2 Hz blink |
| Deadline line | (200, 20) | `D3 · ROUND 2/3`, 8 px `#B8A890` |
| Deposit vs debt | top-right (396, 4), right-aligned | `412 / 600` + 64×4 px bar: green `#3AFF6E` when ≥ debt, amber `#FFB45A` otherwise; red pulse in Last Call if short |
| Pulls | bottom-centre (200, 212) | brass token icons 10×10 `#C8A040`; spent ones `#3A3020` |
| Charms | bottom-left (4, 205) | 16×16 icons, 2 px gap. On trigger: white flash 0.1 s + 2 px hop |
| Mini punch card | bottom-right (396, 221) | 6×6 px cells; punched = black hole; completed line = gold |
| Crosshair | centre | 1 px dot `#F2E8D0` at 60 % (hidden when seated) |
| Interact prompt | (200, 140) | `[E] THE BIG ONE · 1 PULL · BET 1–100 · TILT ●●●○` |
| Event feed | (4, 80), max 4 lines, 6 s fade | `HOT LAMP: PLINKO BOARD` · `ANA PUNCHED DICE ◆` · `RIO HIT ×52 ON CRAPS` |
| Seated hint strip | (200, 200) | Machine controls (catalogue §1.3), 8 px |
| Phone ring indicator | top-centre under clock | small bell glyph + direction arrow; blinks with the ring cadence |

### 10.2 Diegetic displays (the HUD mirrors these; Settings can hide the HUD and play on these alone)
| Object | Shows |
|--------|-------|
| Debt Terminal CRT (amber `#FFB000` on `#140A00`, 320×240 canvas) | Deadline, debt, deposit, interest rate (with line bonuses), rounds left, SETTLE / OPEN THE FLOOR levers, card printer |
| Wall clock (Ø 1.2 m, face `#E8DDC0`) | Second hand = round time (one sweep = full round); red Last Call sector; hour hand points at rounds left |
| Floor dial | B7…B1, G (Endless: off-scale) |
| Marquees | Suit badge, 4 Tilt bulbs + TILT tube, Hot/Cold beacon, occupant name (MP) |
| Charm Board | Your charms on pegs; a charm rattles when it triggers |
| Punch card (hold Q) | The full card in hand |
| Pot meter | 8-digit 7-seg on The Big One's top box (catalogue JACKPOT meter) |

### 10.3 Juice tiers (aligned with catalogue §1.8)
| Tier | Threshold | Feedback |
|------|-----------|----------|
| Loss | mult = 0 | Low thunk (120 Hz, 60 ms); bet coins slide into the slot; Tilt bulb ticks |
| Push / refund | ≤ ×1 | Soft tick; coins return to the tray |
| Win | ×1–×10 | 6–15 coins drop into the tray, chime C6, count-up; number pop rising 12 px over 0.6 s |
| Bigwin | ≥ ×10 | 3 s light chase, fanfare, 40 coins, hitstop 60 ms |
| Hugewin | ≥ ×25 | 5 s, coin fountain, in-pose shake 0.004 m / 12 Hz / 0.6 s, nearby marquees pulse |
| Megawin | ≥ ×50 | 7 s, room lights strobe gold `#FFD040` within 10 m, world toast to all players |
| Jackpot | FULL / pot | Sequence §10.4 |
| Punch | cell | Card snaps up 0.25 s, "chunk", hole; line → gold glow, coins visibly rain into the terminal, voice "Line." |
| Deposit | — | Coin stream 0.6 s into the slot; counter rolls 60 digits/s; terminal beeps per 10 % of debt |
| Charm trigger | — | HUD icon flash + Charm Board rattle + charm-specific 80 ms blip (pitch by rarity) |
| Lamp roll | Bell | Siren whoop on Hot (rising 300 → 900 Hz, 0.8 s); hollow chime on Cold |

### 10.4 Jackpot sequence (FULL on The Big One, or any pot payout)
| t (s) | Beat |
|------:|------|
| 0.00 | Hitstop 120 ms. All pit lights cut to 10 % except the machine. |
| 0.12 | The marquee strobes gold at 10 Hz (3 Hz with Reduce Flashing). House: "Jackpot." |
| 0.30 | **Gold wave**: every marquee in the pit flashes gold in a radial wave from the machine at 12 m/s (the whole pit in about 3 s). |
| 0.30 → 4.30 | Coin fountain: 200 instanced coins from the top box, 3–6 m/s parabolas, one floor bounce each, settle and fade. The count-up runs. |
| 1.00 | FM bell loop 3 s. Shake 0.03 decaying over 2 s. FOV +4°. |
| 4.50 | Lights restore over 1 s (10 % dimmer at Dread ≥ 3). Remote players see the wave pass and get the toast. |

### 10.5 Key audio cues (all WebAudio-synthesized)
| Cue | Recipe |
|-----|--------|
| Bell (round) | FM, carrier 660 Hz, ratio 3.5, decay 1.2 s |
| Lift chime | sine 784 → 523 Hz, 0.4 s each |
| Phone ring | dual sine 425 + 480 Hz, AM 20 Hz, 1.0 s on / 0.7 s off |
| Trapdoor latch | square 70 Hz, 0.15 s + noise burst |
| Fall wind | pink noise, band-pass sweep 400 → 1,200 Hz |
| Punch | white-noise 30 ms + sine 180 Hz thump |
| Collector step | 3 random coin clinks (2.2–3.4 kHz, 40 ms) |
| Heartbeat | sine 45 Hz, 2 thumps per 0.9 s |

### 10.6 Controls (walking; seated controls follow catalogue §1.3)
| Key | Action |
|-----|--------|
| WASD / Mouse | Move / look (pointer lock) |
| Shift | Sprint |
| C | Crouch |
| Space | Jump-step (0.35 m hop; climbs plates, not tables) |
| E | Interact / sit / stand / answer phone / hang up |
| Q (hold) | Raise punch card + expand charm row |
| 1 / 2 / 3 | Phone choices; ghost Bless (1) / Curse (2) |
| G | Give coins (co-op): tap 10 %, hold 25 %. In the lift at Topside: ride |
| B | Ping marker (6 s, visible to teammates) |
| V | Wave emote |
| Tab | Scoreboard (MP) / run summary (solo) |
| T | Chat (120 chars; 8 lines; 8 s fade) |
| Esc | Pause / Ledger |
| F1 | Controls card overlay |

---

## 11. Meta progression

### 11.1 Philosophy
Runs are fair and power comes from inside the run. The meta layer unlocks **variety** (charms, kits, wings to start in,
difficulty, cosmetics), never permanent stat bonuses. No meta currency. Milestones only.

### 11.2 Unlocks
| Unlock | Condition |
|--------|-----------|
| 39 starting charms (all `—` in §4.2) | available |
| Charm batch D2 / D3 / D4 / D5 / D6 | pay that deadline once |
| Charm batch W (Perpetual Ledger, Operator's Glove, Photo Negative, Bent Lift Key) | win a run |
| Cursed set F3 | fall 3 times |
| Achievement charms (Tilt Switch, Blackout Lamp, Card of All Suits) | their achievement |
| Daily Run | pay D2 once |
| Seeded runs, Endless | win once (Endless also via "Go back down") |
| Wing Key option ("start with one wing open of your choice", costs 10 starting coins) | pay D5 once |
| House Edge levels 1…8 | win at the previous level |
| Coin skins: Brass, Silver, Oxidised, Obsidian, Paper | 5 / 15 / 30 runs, first Endless D10, Calm Mode win |
| Hand skins: Bare, Gloved, Ringed, Bandaged, Porcelain | achievements |
| Jukebox tracks (8 procedural songs) | cassettes found as rare Coin Pusher / Claw prizes (persist across runs) |

### 11.3 Kits (choose at run start)
| Kit | Start | Unlock |
|-----|-------|--------|
| Pauper | 40 ¢, 2 Tickets | default |
| Card Sharp | 25 ¢, Counting Bead, Card Room open from D1 | pay D3 with ≥40 % of winnings from CARDS |
| Dice Rat | 25 ¢, Loaded Pip, Dice Den open | same rule, DICE |
| Wheelwright | 25 ¢, Greased Axle, Rotunda open | same rule, WHEELS |
| Drop Fiend | 25 ¢, Lead Shot, Drop Gallery open | same rule, DROPS |
| Curio Collector | 25 ¢, Glass Eye, Curio Arcade open | same rule, CURIOS |
| The Banker | 0 ¢ pocket, 45 ¢ already deposited, Piggy Tooth | earn ≥2,000 ¢ interest in one run |
| The Debtor | 90 ¢, Wet Ledger (cursed) | fall 3 times |
| The Regular | 40 ¢, Brass Thimble, The Big One TOOTH +1 | hit FULL once |

### 11.4 House Edge ladder (difficulty; cumulative)
| HE | Modifier |
|----|----------|
| 1 | All debts +10 % |
| 2 | Pawn Window −1 regular slot |
| 3 | Tilt starts 1 pull earlier (pulls 1–3 full) |
| 4 | Interest −1 % every deadline (min 1 %) |
| 5 | The Collector roams from D5 (touch −10 % pocket) |
| 6 | −1 pull per round in D1–D4 |
| 7 | Line bounty 8 % instead of 10 % |
| 8 | "The Long Night": D8 has 5 rounds, debt ×1.5 |

### 11.5 Endless House Rules (one more per endless deadline; drawn without replacement, then "II" versions)
1. **Short Clock**: −30 s per round.
2. **Table Tax**: 5 % of each win goes to the pot.
3. **Dim**: fog far ×0.5.
4. **Sticky Tilt**: half the Tilt (rounded down) carries into the next round.
5. **Two Colds**: 2 Cold Lamps.
6. **Heavy Pockets**: walk speed −15 % while pocket > debt.
7. **Silent Line**: no random calls.
8. **Tight Card**: +1 Gold cell replaces a Bronze.
9. **Closing Early**: Last Call starts at 40 s.
10. **Price Hike**: charms +30 %.
11. **Mandatory Spend**: unused pulls give 0 Tickets.
12. **The Collector's Interest**: debt +2 % per round.

### 11.6 Achievements (25; i18n `ach.*`)
| id | Name | Condition |
|----|------|-----------|
| first_night | First Night | Pay Deadline 1 |
| topside | Topside | Win a Debt Run |
| overdrawn | Overdrawn | Pay Endless D12 (B11) |
| blackout | Blackout | Complete a full punch card |
| full_circuit | Full Circuit | Win on all six suits in one round |
| full_house | Floodgate | Hit FULL on The Big One |
| card_counter | Card Counter | Win 10 blackjack hands in one run while holding Counting Bead |
| hardway_home | Hardway Home | Make the point the hard way on craps |
| edge_case | Edge Case | Win the EDGE bet at the Flip Booth |
| top_floor | Top Floor | Cash out The Elevator at ×100+ |
| sapper | Sapper | Clear 20 safe tiles in one Mines round with ≥3 mines |
| i_saw_that | I Saw That | Catch the Shell Automaton palming the pea |
| stacked | Stacked | Win the Stacker top prize |
| long_odds | Long Odds | Win a derby with the 25:1 runner |
| six_chambers | Six Chambers | Survive 5 pulls at the Devil's Table with ≥3 live chambers |
| collateral | Collateral | Volunteer in co-op, and your team pays the next deadline |
| last_ghost | Last Ghost Laughing | As a ghost, Bless the eventual Versus winner 3 times |
| cursed_proud | Cursed and Proud | Win while holding 3 cursed charms |
| penny_pincher | Penny Pincher | Win without buying a charm above Common |
| switchboard | Switchboard | Answer 10 calls in one run |
| do_not_answer | Do Not Answer | Win without answering any random call |
| tilted | Tilted | Have 3 machines at TILT in one round |
| lucky_numbers | Lucky Numbers | Match 5 on the Ball Blower |
| house_favourite | House Favourite | Win 10 plays on Hot Lamp machines in one round |
| daily_bread | Daily Bread | Finish 7 Daily Runs |

### 11.7 Seeds and Daily Run
- **Seed**: 8 Crockford base32 characters (40 bits), shown as `K7Q2-M9XD` on pause and results.
- Independent RNG streams are derived with `hash32(seed, streamName)`:
  - `shop`, `phone`, `lamps`, `card`, `collector`, `world`
  - per machine instance (catalogue §1.5)
- Same seed + same actions = same run.
- Seeded runs disable achievements except Daily ones and are not on leaderboards.
- **Daily**: seed = base32(hash32("JACKPIT-DAILY-" + UTC YYYY-MM-DD)). Kit Pauper, House Edge 2, plus one House Rule from
  §11.5 as the "Daily Rule".
  - Only the first attempt per day scores. The lobby server records `start` and `end` by player name + browser key; local
    fallback otherwise.
  - Score = deadlines paid × 1,000,000 + min(999,999, final surplus / PI).
  - Board: `GET/POST /daily` on the lobby server, top 100, shown on the LEDGER panel.

---

## 12. Risks, and why this pitch is the most fun

### 12.1 Risks and mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| **32 machines** (model + logic + sound each) | Scope blow-out | Six suit kits in `src/machines/_base/` (ReelKit, CardTableKit, DiceKit, WheelKit, BallKit, ArcadeKit). Ship order by catalogue tier: Hall 8 first (playable D1 loop), then one wing at a time. Wing Pick means a partial roster is still a complete game. |
| **Balance** (32 RTPs × 74 charms × 14 favours × 29 calls) | Dominant strategies | §3.8 rules; `tools/sim` headless runs with the 3 policies; pass-rate targets §3.9. Haiku owns the regression sims. Launch cut can drop charms to 50 (marked by unlock column) without system changes. |
| **Tilt feels punishing or opaque** | Frustration | Diegetic bulbs + interact-prompt bulbs + a D1 tutorial phone call ("You're wearing it out — try another machine"). The Hot Lamp is the readable "where to go". |
| **Run length** (28 rounds) | Session fatigue | Closing auto-starts at 0 pulls; Settle Early; save every play; target 55–75 min. Daily is the same length, but Free Casino is drop-in. |
| **Low-res legibility** (400×225) | Unreadable machines | In-world screens use 8×8 pixel fonts at ≥2× texel size; HUD scale ×2 default; the Q card is shown at 3×; prompts in 8 px with shadow. |
| **Physics determinism in MP** | Desyncs | Outcome-first (catalogue §1.5): host pre-rolls, clients play steered animations. Only the coin pusher simulates, host-only. |
| **Horror vs casino fun** | Tone clash | Dread ramps by deadline (cosy D1–D2). Calm Mode. Rules of taste §6.5. |
| **Gambling sensitivity / rating** | Store and parent concerns | Fictional currency only, no purchases, no loot boxes with real value, boot notice, Calm Mode. |
| **Co-op griefing** (one player wastes coins) | Social friction | Pockets personal, deposit shared, withdrawals voted, Collateral is voluntary. |
| **Versus kingmaking by ghosts** | Unfair endings | 1 action per round, never the same target twice in a row, names shown, Ghost Call majority only. |
| **Similarity to CloverPit** | IP risk | Original names, symbols, characters, fiction (Collector, Teller, Pawnbroker, Sump, floors, suits, punch card, Tilt). Mechanics in spirit only. A director checklist pass before content lock. |
| **Name clash: crash machine "The Elevator" vs the real lift** | Player confusion | The real one is always "the Lift" in UI and voice; the crash machine keeps catalogue id `elevator` with a cabinet that reads "SERVICE CAR". |
| **Host leaves mid-run** | Lost co-op progress | Host snapshot each intermission; "Resume room" with the same seed and roster. |

### 12.2 Why this pitch is the most fun
1. **It keeps the proven heartbeat.** Debt → deadline → deposit → interest → charms → phone → trapdoor is a loop players
   already love. We do not gamble on the core; we gamble *on the floor*.
2. **It makes 32 machines matter instead of 1.** Without THE CIRCUIT, 31 machines are scenery and players camp the best
   EV. With punch cards, Tilt, Lamps and affinity, every round is a route-planning puzzle across a 3D room. Walking
   becomes strategy, which is exactly what an FPS casino should be about.
3. **Every decision has a clock, a coin and a cell attached.** "Two more Big One spins, or walk to the Hot craps table for
   the DICE silver that closes my line?" is a fresh, legible, high-stakes question every 20 seconds.
4. **Builds are visible in the room.** A Dice Rat lives in the Den; a Banker haunts the terminal; a Circuit player
   sprints wing to wing. In multiplayer you can *see* everyone's strategy, which makes co-op planning and Versus
   mind-games natural.
5. **Escalation is physical.** Floors climb, wings open, lights die, the Collector gets closer. The pit tells the story;
   no cutscenes needed.
6. **It scales from a 6-minute D1 to a 75-minute Topside to infinite Endless floors**, and from solo to 8-player drama
   (Collateral volunteers and ghost blessings are moments people will tell stories about).
7. **It is buildable in parallel.** Every system is a table, every machine is a slot, every charm is a hook. Sonnet can
   code from these numbers, Haiku can simulate them, and Opus can model the rooms they describe.
