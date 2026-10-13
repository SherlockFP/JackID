# JACKPIT — Game Design Document Pitch: "THE DESCENT"

Role: Game Director · Pitch id: `descent` · Status: pitch v1 · Fixed decisions come from `docs/BRIEF.md`; this document elaborates them and never overrides them.

**Conventions used throughout**

| Term | Meaning |
|---|---|
| m, s | metres; **real** seconds |
| clock min / clock h | in-game minutes/hours on the House clock (time budget, not real time) |
| **Min / Lim** | minimum bet / maximum bet ("limit") of a machine. Each floor has its own Min/Lim (section 3.2). Prices in this document are in **Lim units of the floor the Cage is docked at**, e.g. "2 Lim" = 10 coins on F7, 3,000 coins on F1 |
| RTP | return to player (payout ÷ wager over the long run) |
| Var | variance class: L (σ < 1.5 bet), M (1.5–4), H (4–10), XH (> 10) |
| ids | `snake_case`; machine ids = folder names `src/machines/<id>/` |
| coordinates | three.js world; +Y up; north = −Z; floor-local origin = centre of the Well; yaw 0 = player faces north (−Z), 90 = west, −90 = east, 180 = south |
| F7…F1, G | Floor 7 (bottom, start) … Floor 1, G = Ground ("The Foyer", surface) |

All names, symbols, text and characters below are original to JACKPIT.

---

## 1. Pitch and design pillars

**Pitch.** You wake up behind cracked glass, inside a slot machine, at the bottom of a seven-floor casino buried under a city. The machine spits you out into a freight elevator — the **Cage** — parked on Floor 7. The Cage holds the **Debt Terminal**, a ringing **Hotline** phone and **The Big One**, a 5×3 pattern slot that rides with you all the way up. You owe The House. Every night shift (22:00–06:00 on the House clock) you must feed a debt into the terminal. Pay it and the Cage grinds one floor up; a steel grille rolls open and a new floor of gambling machines powers on, one marquee at a time. Miss it and every floor tile in the pit swings open beneath you. The climb is the progression: seven debts, seven floors, then the Foyer and a revolving door with grey daylight behind it. Floors you leave behind stay open — and the deeper floors are kinder (higher RTP, tiny limits) while the upper floors are stingy (low RTP, huge limits). Charms in your pocket and mods bolted onto the machines turn that whole vertical casino into one instrument: a Pocket Abacus at the Card Room, a Lodestone at the Wheel House, an Old Haunt that lets the gentle Floor 7 coin-flip booth take Floor 2 stakes. It is a first-person, PSX-era, roguelike build-crafter you can play alone or with up to 7 friends over P2P.

**Pillar 1 — Debt is altitude.** Every coin you deposit is visible height. Progress is a place, not a number: you can stand on F2, look down the Well and see the sodium glow of F7 where you started. Each paid debt physically adds a floor (4 new machines, 1 new system). Losing is falling the whole way back down.

**Pillar 2 — The whole pit is one machine.** No machine is "best". The generosity gradient (deep floors pay better but cap low), machine Heat (section 3.7), "Your Number" draws shared by 26 machines, and charms that hook machine *families* force players to route across floors and combine machines into builds. A build is a route: "deposit early, coin-flip on F7 under Old Haunt, burst roulette on F3 with the Lodestone, ride the Cage up".

**Pillar 3 — Dread you can read.** Horror is driven by the ledger, not by random jump-scares. The fog, the flicker, the House's voice and the Collector all scale from one visible value, **Dread** (time used × money missing × floors climbed). When the lights stutter, the player knows exactly why — and what to deposit to make them stop.

---

## 2. Core loop and run structure

### 2.1 Loops

| Scale | Duration | Loop |
|---|---|---|
| Second-to-second | 2–15 real s | Walk to a machine → `E` (camera glides 0.45 s into play pose) → set bet with mouse wheel → act (`Space`/lever drag/stop buttons/card choices) → result with juice (section 10.4) → coins fly into the viewmodel hand → glance at machine Heat tube and wristwatch (`Q`). |
| Minute-to-minute | 30–120 real s | Choose which floor/machine fits your charms and remaining clock; climb or descend the stair tower (≈4.5 real s per floor); answer the Hotline within 25 real s; deposit into the Debt Terminal (interest decision); buy at the Curio/Mechanic's Bench/Pawn Window; carry a mod crate to a machine and bolt it on. |
| Shift (one deadline) | 8–12 real min | 6–10 clock hours (each play costs clock minutes) → reach the debt → **Punch Out** early for Markers, or keep gambling until 06:00 → Cage rises (12 s cinematic) → new floor unlocks → new debt printed. |
| Run | 80–100 real min to win (D1–D8), then Endless | 8 shifts: F7, F6, F5, F4, F3, F2, F1, G. Build-craft across them. Win = walk out of the Foyer. Endless = "Renovation" deadlines until the floor opens. |

### 2.2 The House clock (time budget)

- Each shift has a fixed number of **clock hours** (table 2.3). The shift always ends at **06:00**.
- **Walking, shopping, depositing and phone calls cost 0 clock minutes.** Only plays advance the clock, by the machine's `clockMin` cost (section 3.4), e.g. The Big One 4 min/spin, roulette 8 min/spin, derby 15 min/race.
- A play whose clock cost exceeds the remaining minutes is refused ("The House is closing"); cheaper machines stay playable. When the remaining minutes are below the cheapest unlocked machine's cost, the clock jumps to 06:00.
- **Last Call:** when the clock reaches 06:00, no plays are possible, but deposits are accepted for **30 real s** (the House counts down "thirty… twenty… ten…"; the Cage gate stays open). Settlement happens when Last Call ends or as soon as Vault ≥ Debt. Carrying winnings up the stairs in time is part of the game; the Service Pass lift helps.
- **Dawdle rule (single-player):** after 120 real s with no play started, the clock creeps 1 clock min per 5 real s (the House coughs, wall clocks tick audibly). Exempt while the pause menu is open. If the player's pocket is below the lowest Min of every unlocked machine and Vault < Debt, the creep becomes 1 clock min per 0.5 real s ("The House is bored").
- **Multiplayer:** see section 7 (personal timecards + real-time wall clock).
- The wall clock on every landing and the wristwatch on the viewmodel's left wrist show the same time. Optional HUD clock in settings.

### 2.3 Debt schedule

Interest is "Vault interest": credited toward the debt (section 2.5). "Req/h" = net profit per clock hour, in Lim units, a player needs with full interest and zero carry-over — the design target used for tuning.

| # | Shift floor (Cage at) | Clock | Hours | Debt (coins) | Floor Lim | Debt ÷ Lim | Interest / clock h | Max interest | Req/h (Lim) | Target pass rate (avg player) |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 | F7 The Boiler | 00:00–06:00 | 6 | **60** | 5 | 12.0 | 3.0 % | 20 % of debt | 0.60 | 85 % |
| D2 | F6 The Laundry | 22:00–06:00 | 8 | **200** | 15 | 13.3 | 2.5 % | 20 % | 1.33 | 75 % |
| D3 | F5 The Card Room | 22:00–06:00 | 8 | **550** | 40 | 13.8 | 2.0 % | 20 % | 1.38 | 65 % |
| D4 | F4 The Midway | 22:00–06:00 | 8 | **1,400** | 100 | 14.0 | 2.0 % | 20 % | 1.40 | 55 % |
| D5 | F3 The Wheel House | 22:00–06:00 | 8 | **3,800** | 250 | 15.2 | 1.5 % | 20 % | 1.52 | 45 % |
| D6 | F2 The Paddock | 22:00–06:00 | 8 | **9,500** | 600 | 15.8 | 1.5 % | 20 % | 1.58 | 38 % |
| D7 | F1 The Parlour | 21:00–06:00 | 9 | **24,000** | 1,500 | 16.0 | 1.0 % | 20 % | 1.42 | 32 % |
| D8 | G The Foyer | 20:00–06:00 | 10 | **60,000** | 4,000 | 15.0 | 1.0 % | 20 % | 1.20 | 25 % (run win) |
| E9+ | G (all floors open) | 22:00–06:00 | 8 | formula below | formula | rising | 0.5 % | 15 % | — | — |

**Endless ("Renovation") formula, deadline n ≥ 9:**
- `Debt(n) = roundTo2SigFigs(60,000 × 2.6^(n−8))` → E9 160,000 · E10 410,000 · E11 1,100,000 · E12 2,700,000.
- `Lim(n) = 4,000 × 2.5^(n−8)` applied to **every** machine on every floor (Min = Lim ÷ 5) → E9 10,000 · E10 25,000.
- Base RTP of every machine −1 % per endless deadline (floor 85 %).
- One cumulative **Renovation Rule** per endless deadline, drawn from the House Rules list (section 11.3) without repeats; one floor per deadline (F7 first, upward) gets its 4 machines swapped to their "Night" variant (a data flag each machine coder implements as one rule twist, e.g. Night roulette has a 00 pocket that pays 50:1 on Your Number).
- Endless score = deadlines paid; tiebreak total unused clock hours.

### 2.4 Start state

| Item | Value |
|---|---|
| Pocket | 30 coins |
| Markers | 0 |
| Charm slots | 6 (max 8: Charm Bracelet +1, meta unlock "Deep Pockets" +1) |
| Starter charm | First interaction with the Curio is free: choose 1 of 3 random Commons ("the first one is on the House") |
| Unlocked | F7 (4 machines) + the Cage (The Big One, Debt Terminal, Curio, Hotline, wall clock) |
| Clock | D1 starts 00:00, 6 hours |

### 2.5 Deposits, interest, punch-out, Markers

- **Debt Terminal** (in the Cage): `E` to use. Mouse wheel picks an amount in steps (1 Lim, 5 Lim, 25 % pocket, ALL); `Space` drops the coins into the brass slot. Deposits are **irreversible** and go into the **Vault**.
- **Interest:** at every full clock hour, `Vault += floor(min(Vault, Debt) × rate)`. Interest never applies to surplus above the debt. Total interest per shift capped at 20 % of the debt (Iron Piggy raises it). The terminal screen shows "NEXT INTEREST +N AT 03:00".
- **Settlement at 06:00:** if `Vault ≥ Debt`, the debt is removed from the Vault; surplus carries into the next shift's Vault (it starts the next shift already deposited). If `Vault < Debt` → **Foreclosure** (2.7).
- **Punch Out:** when `Vault ≥ Debt`, a red **PUNCH OUT** lever lights on the terminal. Pull it to end the shift immediately. Reward: **+1 Marker per full unused clock hour, +1 bonus if ≥ 3 hours unused.**
- **Markers** (the only secondary currency, brass tokens stamped with an eye). Sources: Punch Out, +1 per floor unlock, phone deals, Lucky Lamp mod, Horseshoe Magnet, coin-pusher Marker tokens, Cashier (max 2 bought per shift). Sinks: machine mods (1–3), Curio reroll (1), cursed-charm removal (3), Devil's table seat fee (1), Overclock repair (1), co-op bail (alternative to coins, 2 per ghost), Sneak Peek phone deal (2).

### 2.6 Win and fail conditions

| Condition | Result |
|---|---|
| Vault < Debt when Last Call ends (06:00 + 30 real s) | **Foreclosure** → trapdoor (2.7). Run over (SP). |
| Red chamber at the Devil's table (The Cylinder) | Immediate trapdoor for that player. |
| Glass Floor (cursed) check fails at 02:00 | Immediate trapdoor. |
| Pay D8 and walk through the Foyer revolving door (trigger box x∈[−2,2], z∈[−12.5,−11.5], y = 35) | **Win.** Results screen, then offer: "The elevator is still open. Go back down?" → Endless. |
| Endless | Continues until a foreclosure; that run is still a win, score = deadlines paid. |

### 2.7 Trapdoor sequence (Foreclosure)

| t (real s) | Event |
|---|---|
| 0.0 | Last Call ends (30 s after 06:00) with Vault < Debt. Input locked. All lights on all floors cut to black except the Cage's red beacon `#D7263D`. |
| 0.2 | Three bell tolls (one every 0.6 s). The House: "Time." (subtitle) |
| 1.6 | The Collector is visible at the Debt Terminal pulling a red handle, if the player is within line of sight; otherwise only the handle's clack is heard. |
| 2.0 | The floor tile grid under the player hinges open (2 m tiles, 0.3 s swing, chain rattle). |
| 2.3–5.8 | Fall down the Well. The camera tilts up 70° and the floors the player unlocked flash by in their lighting colours, newest to oldest, 0.45 s per floor. A low choir of slot-machine jingles plays backwards. |
| 5.8 | Black. One splash (no impact, no body). 1.0 s of dripping in the Sump. |
| 6.8 | Results receipt prints (section 9.10). |

Exceptions: **Rope Ladder** (charm) catches the player at t = 2.3; co-op **Fall Guy** vote (section 7.2); Versus/co-op players who fall become ghosts.

### 2.8 System unlock order (onboarding is physical)

| Floor unlocked by | New machines | New system / prop on that floor |
|---|---|---|
| Run start (F7) | bandit, coin_flip, hi_lo, scratch_vend (+ big_one in Cage) | Curio charm vending, Debt Terminal, Hotline, Heat tubes, interest |
| D1 paid → F6 | keno, mines, plinko, coin_pusher | **Mechanic's Bench** (machine mods, Markers become spendable) |
| D2 paid → F5 | blackjack, baccarat, video_poker, dragon_tiger | **Pawn Window** (sell charms, cursed charms, curse removal) |
| D3 paid → F4 | shell_game, stacker, claw_crane, cyclone | **Jukebox** (shift buffs); Legendary charms enter the Curio |
| D4 paid → F3 | roulette, big_six, sic_bo, dice_tower | Collector starts patrolling (dread-gated) |
| D5 paid → F2 | derby, elevator_crash, pachinko, pachislot | Shared-ride machines (crash, derby) |
| D6 paid → F1 | craps, bingo, tombola, fortune_teller | **Cashier** window (buy/sell Markers), Omens |
| D7 paid → G | holdem, lotto_blower, devils_table | Exit door (chained), the final debt |

Before a floor unlocks, its stair-tower grille is down: the player can stand on the stairs and look through the bars at the dark floor, machines under dust sheets, one marquee faintly blinking — a teaser of the next 4 machines.

---

## 3. Economy

### 3.1 Currencies

| Currency | Icon | Scope | Use |
|---|---|---|---|
| **Coins** | copper disc, HUD "◎" | per player pocket; Vault per run (co-op: shared Vault) | betting, charms, Jukebox, Cashier, debt |
| **Markers** | brass eye token, HUD "◆" | per player | mods, rerolls, curse removal, Devil's table fee, Punch Out reward |

There is no meta currency (meta progression is milestone-based, section 11).

### 3.2 Floor table (the generosity gradient)

| Floor | Name | Floor y (m) | Min | Lim | Base RTP (luck machines) |
|---|---|---|---|---|---|
| F7 | The Boiler | 0 | 1 | 5 | 104 % |
| F6 | The Laundry | 5 | 3 | 15 | 102 % |
| F5 | The Card Room | 10 | 8 | 40 | 100 % (card rules, see roster) |
| F4 | The Midway | 15 | 20 | 100 | 98 % (average skill) |
| F3 | The Wheel House | 20 | 50 | 250 | 97 % |
| F2 | The Paddock | 25 | 120 | 600 | 96 % |
| F1 | The Parlour | 30 | 300 | 1,500 | 95 % |
| G | The Foyer | 35 | 800 | 4,000 | 94 % |
| Cage | The Big One | rides | = docked floor | = docked floor | = docked floor |

Fiction: "The House lets the bottom pay. Nobody gets rich on Floor 7."

### 3.3 Bet rules

- Bet dial: 1×, 2×, 3×, 4×, 5× Min (5× Min = Lim). Mouse wheel or `[` / `]`. `R` repeats the last bet.
- Machines with special stakes (pachinko trays, scratch cards, keno spots, roulette chips) still keep total stake per play ≤ Lim.
- **House Limit:** a single play can never pay more than **500× its bet** (exceptions: Devil's table and the lotto "Deed", which pay in debt terms). Charms cannot break this.
- Limit Plate mod and Old Haunt are the only ways to raise a machine's Min/Lim.

### 3.4 Machine roster (32 machines)

Clock = clock minutes per play. Real = target real seconds per play including juice. Draw No. = the number the machine shows on its brass **Draw Number plate** each play (used by "Your Number", section 4.1); "—" = emits none.

| # | id | Display name | Floor·slot | Seats | Tags | Base RTP | Var | Clock | Real | Max win | Draw No. | Rule summary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `big_one` | The Big One | Cage | 1 (2 if ≥5 players) | SLOT | floor RTP (104→94) | H | 4 | 2.4 | 150× (base) | cells in winning patterns (1–15) | 5×3 pattern slot, 8 symbols, 9 patterns, Pit = wild, 3+ Pits = Sinkhole (3 respins). Detail below. 3 mod sockets. |
| 2 | `bandit` | Old Lever (one-armed bandit) | F7·C1 | 1 | SLOT, PHYS | 104 % | M | 3 | 3.5 | 100× | reel-2 stop (1–22) | 3 reels × 22 stops, 1 line. Pull lever (drag mouse down ≥120 px within 0.6 s, or `Space`). Symbols Blank, Bar, Double Bar, Triple Bar, Plum, Horseshoe, Star. 3 Star = 100×, 3 Horseshoe 25×, 3 Triple Bar 40×, 3 Double 20×, 3 Bar 10×, any 3 bars 5×, 3 Plum 15×, 2 Plum 3×, 1 Plum 1×. |
| 3 | `coin_flip` | Heads-or-Tails Booth | F7·C2 | 1 | COIN, RISK | 104 % | L | 2 | 2.5 | 5× (32× streak) | — | Mechanical thumb flips a 12 cm coin. Call H/T (`1`/`2`). P(H)=P(T)=0.495, P(edge)=0.01. Correct call returns 2×; edge returns 5× whatever you called. "Let it ride" (`Space` after a win) chains up to 5 flips. |
| 4 | `hi_lo` | The Ladder (Hi-Lo) | F7·C3 | 1 | CARD, RISK | 103 % (optimal) | M | 1 per guess | 1.2 | 50× cap | card rank (A=1…K=13) | 52-card shoe. Guess Higher/Lower (`1`/`2`); equal rank = push, redraw. Step multiplier = 1.01 ÷ p(correct). Cash out `Space`. |
| 5 | `scratch_vend` | Scratch-O-Matic | F7·C4 | 1 | PAPER | 104 % | H | 3 | 6 | 200× | printed lucky number (1–36) | Buy card at 1×/2×/5× Min. 3×3 panels; 3 matching amounts win that amount. Hold LMB and move to scratch (4×4 px brush on a 64×64 coating). |
| 6 | `keno` | Keno Lounge | F6·C1 | 8 (shared draw) | BALL, PAPER | 102 % | H | 6 | 10 | 500× | 20th ball if ≤36 | Pick 1–10 of 80 on a terminal; 20 balls drawn on the wall board. SP: draw on demand. MP: shared draw every 60 real s per floor. |
| 7 | `mines` | Minefield | F6·C2 | 1 | RISK | 102 % | M–XH | 1 per tile | 0.8 | 100× cap | last tile index (1–25) | 5×5 brass tiles, choose 1/3/5/10/24 mines. Multiplier after k safe tiles = 1.02 × C(25,k) ÷ C(25−m,k). Cash out `Space`. |
| 8 | `plinko` | Drop Board | F6·C3 | 1 | BALL, PHYS | 102 % | M/H/XH | 2 | 4 | 50× | bucket (1–13) | 12 rows of pins, 5 release positions, 13 buckets. Risk Low/Med/High tables all tuned to 102 %. |
| 9 | `coin_pusher` | The Shelf | F6·C4 | 2 | COIN, PHYS | 102 % | L | 1 per 3 coins | 2 | 30× (tokens) | — | Two-tier pusher, each coin = Min. `A`/`D` aim the chute, `Space` drop. Prize tokens on the shelf: Charm token (random Common), Marker token. Max 150 simulated coins. |
| 10 | `blackjack` | Blackjack | F5·T1 | 5 | CARD | 100 % (basic strategy) | M | 6 | 12 | 8× | your final total (4–21) | 6 decks, dealer stands soft 17, BJ 3:2, double any two, double after split, split to 3 hands, Five-Card Charlie pays 2:1, reshuffle at 50 % penetration. Mannequin dealer. |
| 11 | `baccarat` | Baccarat | F5·T2 | 5 | CARD | 98.9 % (Banker) | L | 5 | 10 | 9× | winning total (1–9) | Punto banco, 8 decks. Player 1:1, Banker 0.95:1, Tie 8:1. |
| 12 | `video_poker` | Jacks or Better | F5·C3 | 1 | CARD | 100.3 % (optimal) | M | 3 | 4 | 500× (House Limit; Royal) | highest rank in final hand | 9/6 paytable, Four Aces pays 40. Hold `1`–`5`, Deal/Draw `Space`. |
| 13 | `dragon_tiger` | Dragon & Tiger | F5·C4 | 1 | CARD | 100 % | L | 2 | 3 | 9× | winning card rank | Automaton deals 1 card each; higher wins 1:1; main bets push on tie; Tie side bet 8:1. |
| 14 | `shell_game` | The Shell Automaton | F4·C1 | 1 | SKILL | 98 % (avg) | M | 2 | 6 | 1.8× | — | 3 cups, 6–12 swaps (0.35 s → 0.18 s per swap). Correct cup returns 1.5×. The automaton palms the pea 25 % of rounds (tell: 2-frame wrist twitch on one swap); `Q` = Accuse before picking: palmed → returns 1.8×, otherwise lose. Adaptive speed targets 70 % player accuracy. |
| 15 | `stacker` | Stack the Floors | F4·C2 | 1 | SKILL | 98 % (avg) | H | 3 | 10 | 50× | rows reached (1–15) | 15 rows, starts 3 blocks wide, speed 6 → 22 cells/s, ±8 % random speed. Minor prize row 11 = 10× (take or continue), Major row 15 = 50×. |
| 16 | `claw_crane` | The Claw | F4·C3 | 1 | SKILL, PHYS | 98 % (avg) | H | 4 | 20 | 50× | — | 15 s timer, `WASD` move (0.5 m/s), `Space` drop. Grip 0.6, "strong grip" 0.9 on 1 in 4 games (a green lamp shows it — honest). Prizes: coin bags 2×/5×/10×, gold capsule 50×, charm capsule (random Uncommon, ~1 in 25 grabs). |
| 17 | `cyclone` | The Cyclone | F4·C4 | 1 | SKILL, WHEEL | 98 % (avg) | H | 2 | 5 | 100× | stopped lamp if ≤36 | Ring of 40 lamps, 60 lamps/s. `Space` stops. Jackpot lamp 100× (1), Major 10× (2), Minor 3× (6). Random slip 0–2 lamps. |
| 18 | `roulette` | Roulette | F3·T1 | 6 | WHEEL | 97.3 % | M–XH | 8 | 14 | 35:1 | pocket (1–36; 0 none) | European single zero, all standard inside/outside bets, chips placed on a 3D layout. |
| 19 | `big_six` | The Money Wheel | F3·T2 | 6 | WHEEL | 96 % | M–XH | 6 | 10 | 47:1 | segment label (1,3,7,15,23) | 50 segments: "1"×24 (1:1), "3"×12 (3:1), "7"×6 (7:1), "15"×3 (15:1), "23"×2 (23:1), HOUSE×2 (23:1), PIT×1 (47:1). Every spot returns exactly 96 %. Clapper flaps are physical. |
| 20 | `sic_bo` | The Birdcage | F3·C3 | 4 | DICE | 97.2 % (Big/Small) | M–XH | 6 | 7 | 180:1 | dice total (3–18) | 3 dice in an hourglass cage flipped by lever. Small/Big 1:1 (lose on triples), Any Triple 30:1, Specific Triple 180:1, totals, singles 1:1/2:1/10:1. |
| 21 | `dice_tower` | The Dice Tower | F3·C4 | 1 | DICE, PHYS | 97 % | M | 3 | 4 | 34.9× | dice sum (2–12) | 2 dice dropped through a 1.8 m baffled tower. Every bet returns 0.97 × true odds (exact sum, over/under 7, seven, doubles). |
| 22 | `derby` | Tin Rat Derby | F2·T1 | 6 (shared race) | RACE, PHYS | 96 % | H | 15 | 16 | 60× | winning rat (1–6) | 6 clockwork rats on rails, 4.5 m track, 12 s race. Odds board 2:1–12:1 with hidden form. Win, Place (top 2), Forecast (exact 1-2). |
| 23 | `elevator_crash` | The Cable | F2·T2 | 8 (shared ride) | RISK | 96 % | XH | 2 | 3–15 | 100× cap | floor(crash point) if ≤36 | A tiny elevator car rises in a 4 m glass shaft. Multiplier m(t) = e^(0.08·t). Crash point X = max(1.00, 0.96 ÷ U), U∈(0,1]. Pull the brake (`Space`) to cash out. Cable snap = loss. |
| 24 | `pachinko` | Pachinko | F2·C3 | 1 | BALL, PHYS | 96 % | H | 4 per tray | 25 | 200× | digital centre digit (1–9) | Buy tray of 25 balls (= bet). Hold LMB to launch, mouse Y sets power. Start pocket spins a 3-digit display; triple = Fever (12 rounds, tulips open). |
| 25 | `pachislot` | Pachislot | F2·C4 | 1 | SLOT, SKILL | 94 % (no skill) – 99 % (perfect) | M | 3 | 3 | 120× (BIG) | reel-1 stop (1–21) | 3 reels × 21 stops, stop buttons `1`/`2`/`3`, max slip 4 stops (190 ms). Bonus flag lamp; BIG (3 Red Flags) ≈ 120×, REG (Red-Red-Blue Bar) ≈ 40×. Symbols: Red Flag, Blue Bar, Lotus, Replay, Crow. |
| 26 | `craps` | Craps | F1·T1 | 8 | DICE | 98.6 % (pass) | M | 2 per roll | 4 | 30:1 (props) | dice sum (2–12) | Pass/Don't, Come/Don't, Odds 2×, Field (2 and 12 pay 2:1), Place 6/8 (7:6), Hardways. Shooter rotates; throw with a mouse flick (velocity sets the bounce animation; outcome is RNG). |
| 27 | `bingo` | Bingo Hall | F1·T2 | 6 (shared game) | BALL, PAPER | 95 % | H | 10 | 25 | 500× | last ball if ≤36 | 75-ball, up to 4 cards (each costs the bet). Line 2×, Four Corners 5×, X 15×, Frame 30×, Blackout ≤50 balls 300×, ≤45 balls 500×. SP call speed 0.6 s/ball. |
| 28 | `tombola` | The Raffle Drum | F1·C3 | 4 | BALL, PAPER | 95 % | H | 12 | 20 | 300× | last number if ≤36 | 90-ball drum, 3×9 tickets with 15 numbers. 1 Line 3×, 2 Lines 10×, Full House 60×, Full House within 40 numbers 300×. |
| 29 | `fortune_teller` | The Seer | F1·C4 | 1 | CARD, OMEN | 95.5 % | M | 5 | 8 | 21× | arcana number (1–21) | Porcelain automaton cuts a 22-card original arcana (0–21). High (12–21)/Low (1–10) pays 1.1:1 (0 and 11 = House), exact card 20:1. Omens: pay 1 Lim for a random shift buff (list in 3.9). |
| 30 | `holdem` | Hold'em | G·T1 | 8 (bots fill) | CARD | skill (rake 5 %, cap 1 Lim) | H | 10 per hand | 30–60 | pot | — | No-limit, buy-in 20–100 Min, blinds Min/2 & Min. Bot archetypes: Rock, Maniac, Calling Station, Shark. |
| 31 | `lotto_blower` | The Big Draw | G·T2 | 8 (shared draw) | BALL, PAPER | 94 % | XH | 20 | 20 | 500× + **the Deed** | bonus ball (1–36) | Pick 6 of 36; 6 + bonus drawn from an air blower (1 ball / 2.5 s). 2 = 0.25×, 3 = 12×, 4 = 90×, 5 = 500×, 6 = **the Deed**: Vault is set to the current debt and you win 500× bet. |
| 32 | `devils_table` | The Cylinder (Devil's table) | G·C3 | 1 | RISK | debt-based | XH (ruin) | 30 per sitting | 6 per pull | 400 % of debt | — | Seat fee 1 Marker, once per shift. A brass six-chamber drum, one red chamber, no re-spin. Each lever pull: blank = survive, red = the floor opens under you. Stand at any time: 1 pull → 15 % of current debt to Vault, 2 → 40 %, 3 → 100 %, 4 → 200 % (debt cleared + 100 % as coins), 5 → 400 %. No gun: a drum, a lever, a click. |

**The Big One — hero detail (5 columns × 3 rows, reels stop left→right 0.25 s apart, 2.0 s total).**

| Symbol | id | Weight | Value |
|---|---|---|---|
| Penny | `pen` | 20 | 2 |
| Key | `key` | 20 | 2 |
| Moth | `moth` | 16 | 3 |
| Lantern | `lamp` | 16 | 3 |
| Eye | `eye` | 12 | 5 |
| Crown | `crown` | 9 | 5 |
| Black Ace | `ace` | 5 | 8 |
| Pit (spiral hole, wild) | `pit` | 2 | 0 |

| Pattern | Cells | Multiplier |
|---|---|---|
| Rung (3 adjacent in a row) | 3 | ×1 |
| Ladder (4 in a row) | 4 | ×2 |
| Rail (5 in a row) | 5 | ×4 |
| Shaft (full column) | 3 | ×1.5 |
| Slope (3 diagonal, either direction) | 3 | ×1.5 |
| Fork (V: (0,0)(1,1)(2,2)(3,1)(4,0)) | 5 | ×5 |
| Hood (Λ: (0,2)(1,1)(2,0)(3,1)(4,2)) | 5 | ×5 |
| Cellar (top + bottom rows, same symbol) | 10 | ×10 |
| JACKPIT (all 15 same) | 15 | ×25 + flat 100× bet; replaces all other patterns |

`Win = Σ(symbolValue × patternMult) × bet × k`, k = 0.25 initial; a Monte-Carlo tuner (`npm run sim:bigone`, 10⁶ spins) solves k per floor so base RTP = docked floor RTP. Within a row only the longest horizontal counts (Rail supersedes Ladder supersedes Rung). Pit counts as any symbol; 3+ Pits anywhere = **Sinkhole**: 3 free respins at the same bet, all symbol values +1.

### 3.5 Machine roles (how each fits)

| Role | Machines | Purpose in a build |
|---|---|---|
| Grinders (L var, fast, low ceiling) | coin_flip, coin_pusher, baccarat, dragon_tiger, dice_tower | Safe top-up before 06:00; Old Haunt targets. |
| Engines (charm-scalable) | big_one, bandit, video_poker, blackjack, hi_lo | Main build targets; most charms hook these. |
| Spikes (XH) | mines (24 mines), plinko High, elevator_crash, keno 10-spot, lotto_blower, roulette straight-ups | Desperation and Your Number bursts. |
| Skill (player-dependent RTP) | stacker, claw_crane, cyclone, shell_game, pachislot, video_poker, blackjack, holdem | Mods (Steady Gyro) and practice pay off. |
| Time sinks (high clock cost, high ceiling) | derby 15, lotto 20, bingo 10, tombola 12, holdem 10, devils_table 30 | One big decision per hour; strong with Pocket Watch / Quick Crank. |
| Number feeders (frequent Draw Numbers) | roulette, keno, craps, sic_bo, dice_tower, big_one, scratch_vend | "Your Number" builds. |

### 3.6 EV per clock hour (balance target)

`EV/h (in Lim) = (RTP − 1) × betShare × 60 ÷ clockMin`, betShare = bet ÷ Lim.

- Unmodded at max bet: F7 coin_flip = (0.04 × 60 ÷ 2) = **1.2 Lim/h**; F7 big_one = 0.6 Lim/h; F6 keno = 0.2 Lim/h; F3 roulette = −0.2 Lim/h.
- Requirement column of 2.3 is 0.6–1.6 Lim/h. Therefore: D1 is passable unmodded (85 % target); from D2 a player needs ~2 synergising charms; from D4 a coherent build (3–4 charms + 2 mods) that pushes its target family to **115–135 % RTP**. Tuning rule: a complete 4-charm synergy must not exceed **160 % RTP** in simulation on its target machine at Heat 0.
- Interest is worth up to 20 % of each debt, so an "early deposit" style is a valid, readable alternative to max-variance play.

### 3.7 Heat (anti-spam, pro-routing)

- Every machine has a per-player Heat counter. +1 per play on it; −1 on every play elsewhere (min 0); reset to 0 at shift start.
- Threshold T = 30 (The Big One 45). Above T, payouts × (1 − 0.01 × (Heat − T)), max −10 %.
- Diegetic: a glass thermometer tube on every cabinet/table edge: blue `#3A7BFF` (< T−10), amber `#FFB000` (T−10…T), red `#FF2A2A` (> T) plus a louder transformer hum. HUD prompt shows "HOT −4 %".

### 3.8 Anti-degenerate-strategy rules

1. **Limits per floor** (3.2) and the 500× House Limit stop martingale and single-machine snowballs.
2. **Heat** (3.7) forces routing; Regular's Stool and Heat Sink are deliberate, costly exceptions.
3. **Clock cost per step** on ladders (hi_lo, mines) and per ride (Cable): "safe" micro-cashout strategies burn time.
4. **Interest** only on Vault ≤ Debt, capped at 20 % per shift; no withdrawals.
5. **Charm resale** is 40 % of the price actually paid (stored on the instance), so buying cheap on F7 and selling on F1 gains nothing.
6. **Card counting** only matters with Pocket Abacus or the Memory Drum mod; default shoes reshuffle at 50 %.
7. **Skill machines:** randomized speeds (±8 %), adaptive shell game, input timestamps from `performance.now()` with 1-frame tolerance; stacker/cyclone prizes capped (50×/100×).
8. **Single-player pause** freezes everything (clock, phone ring timer). Suspend-save on quit; the save is deleted on load (no save-scumming). Autosave at every shift start for crash recovery only.
9. **Versus:** no coin transfers, no shared Vault. **Free Casino** results never count for achievements, unlocks or stats.
10. **Cashier:** max 2 Markers bought per shift (3 Lim each), so coins can't flood mods.
11. **Phone deals** use their own RNG stream and fixed schedules per seed; refusing does not reroll.

### 3.9 Shops and service props

| Prop | Location | Function |
|---|---|---|
| **The Curio** (charm vending, 8-coil spiral machine) | Cage, east wall | 4 offers per shift, restocks at shift start. Reroll: 1 Marker (max 3 per shift). Rarity odds by docked floor: F7 C80/U20 · F6 C65/U30/R5 · F5 55/33/12 · F4 50/32/15/LG3 · F3 45/33/18/4 · F2 40/34/21/5 · F1 35/35/24/6 · G 30/35/28/7. |
| **Mechanic's Bench** | F6·A1 | 3 random mods per shift (Marker prices in 3.10), reroll 1 Marker. Buying a mod puts a wooden crate in the viewmodel's hands; walk to a machine and `E` on its glowing socket to install (1.5 s wrench animation). Uninstall = destroy. Repairs Overclocked machines for 1 Marker. |
| **Pawn Window** | F5·A1 | Buys charms at 40 % of paid price. Sells 1 cursed charm (it pays you) + 1 second-hand charm (random rarity, −30 % price) per shift. Removes a cursed charm for 3 Markers. |
| **Jukebox** | F4·A1 | 1 Lim per song, one buff active (60 clock min, all players in MP): "Brass Waltz" +5 % SLOT payouts · "Dust Polka" +5 % DICE and WHEEL payouts · "Cellar Blues" Heat decays −2 per foreign play · "Static" +1 Hotline call this shift. |
| **Cashier** | F1·A1 | Buy 1 Marker for 3 Lim (max 2 per shift); sell 1 Marker for 1 Lim. |
| **The Seer's Omens** | F1·C4 | 1 Lim, random of 8: Lamp (+1 clock hour), Key (next charm −50 %), Moth (Moths wild on the next 10 Big One spins), Wheel (next WHEEL win ×2), Tower (next 5 DICE rolls reroll 1s), Debtor (current debt −5 %), Collector (bad: Collector appears on your floor; +1 Marker), Pit (bad: a random machine on this floor goes Out of Order; +2 Lim coins). |

### 3.10 Machine mods (bolted onto machines; shared by all players in co-op)

Sockets: cabinets 2, tables 3, The Big One 3. Mods persist for the run. A machine's mods are visible: each adds a model part (brass plate, lamp, gauge, extra crank).

| id | Name | Markers | Effect | Limits |
|---|---|---|---|---|
| `limit_plate` | Limit Plate | 2 | Machine Min and Lim × 2.5 | 1 per machine |
| `gilded_trim` | Gilded Trim | 2 | +3 % RTP on this machine (payout × 1.03) | stack 2 |
| `quick_crank` | Quick Crank | 1 | clockMin × 0.7, rounded down, min 1 | 1 |
| `lucky_lamp` | Lucky Lamp | 2 | Win ≥ 10× bet here → +1 Marker (max 1 per shift per machine) | 1 |
| `progressive_meter` | Progressive Meter | 3 | 3 % of every bet here feeds a meter (seed 10 Lim). The machine's top outcome also pays the meter. Meter ignores the House Limit. | 1 |
| `steady_gyro` | Steady Gyro | 1 | SKILL machines: timing windows +40 ms; shell swaps −20 % speed; claw grip +0.1 | SKILL only |
| `memory_drum` | Memory Drum | 2 | CARD machines: reshuffle at 80 % instead of 50 % | CARD only |
| `number_plate` | Number Plate | 1 | This machine's Draw Number also matches Your Number at ±1 | Draw No. machines |
| `overclock` | Overclock | 2 | Payouts × 1.5; after any win ≥ 20× bet the machine breaks (smoke, sparks) for 60 clock min or until repaired (1 Marker) | 1 |
| `heat_sink` | Heat Sink | 1 | No Heat on this machine | 1 |
| `charm_socket` | Charm Socket | 3 | Insert one of your charms whose hooks include this machine: it applies here to everyone, and frees your pocket slot | 1 |
| `house_seal` | House Seal (cursed, phone only) | — | +10 % RTP here; every play costs +2 clock min; can never be removed | 1 |

---

## 4. Charms

### 4.1 Rules

- **Slots:** 6 (max 8). Charms hang on a key ring shown on the viewmodel's left wrist and in the HUD charm strip.
- **Prices:** Common 2 Lim · Uncommon 4 Lim · Rare 8 Lim · Legendary 15 Lim · Cursed pays you (shown as "+N Lim"). Lim = docked floor Lim at purchase time.
- **Rarity gating:** Rare from F6, Legendary from F4. Cursed only via Pawn Window, phone and Seer.
- **Active charms** (marked ACTIVE): used with `F` while seated at a hooked machine; recharge per shift; HUD shows "[F] Lodestone 1/1".
- **Your Number:** chosen 1–36 at shift start (only if you own Birth Certificate / Twin Tags / Fever Ticket; a reel dial on the wristwatch). When a machine's Draw Number equals Your Number, the play gains a bonus of `bet × B`, where `B = round(0.12 ÷ p, 1)` and p = that machine's probability of emitting that number (precomputed per machine and number in `src/game/data/numbers.ts`; B is printed on the brass plate). Every number is worth +12 % RTP-equivalent on every numbered machine; only frequency/variance differ. Max 1 trigger per play.
- **Hook events** (emitted by every machine through `MachineBase`): `play:start`, `play:settled {machineId, floor, tags, bet, payout, multiple, drawNumber}`, `spin:stopped`, `pattern:scored`, `card:dealt`, `hand:settled`, `dice:rolled`, `wheel:stopped`, `ball:drawn`, `ball:landed`, `ladder:step`, `ladder:bust`, `ladder:cashout`, `skill:stop`, `race:finished`, `deposit`, `clock:hour`, `shift:start`, `shift:end`, `phone:ring`, `phone:answer`, `floor:unlock`, `floor:enter`, `cage:rise`, `jackpot`, `trapdoor`.

### 4.2 Charm table (72 charms)

| # | id | Name | Rarity | Price | Effect (mechanical) | Hooks |
|---|---|---|---|---|---|---|
| 1 | `lucky_penny` | Lucky Penny | C | 2 Lim | Penny value 2→4. Old Lever: Plum payouts ×2. | big_one, bandit · `pattern:scored` |
| 2 | `skeleton_key` | Skeleton Key | C | 2 Lim | Key value 2→4. Keys orthogonally adjacent to a Pit are wild. | big_one · `spin:stopped` |
| 3 | `moth_jar` | Moth Jar | C | 2 Lim | Moth value 3→5. Each losing spin showing ≥3 Moths adds 1 Flutter; at 5 Flutter the next spin's Moths are wild (Flutter resets). | big_one |
| 4 | `oil_lantern` | Oil Lantern | C | 2 Lim | Lantern value 3→5; Lanterns in the middle row are worth double. | big_one |
| 5 | `glass_eye` | Glass Eye | U | 4 Lim | Eye value 5→8. After each spin, the HUD shows the next spin's top cell of reel 1 (pre-rolled). | big_one |
| 6 | `paper_crown` | Paper Crown | U | 4 Lim | Crown value 5→8; Crown weight 9→12. | big_one |
| 7 | `ace_in_the_sleeve` | Ace in the Sleeve | R | 8 Lim | ACTIVE 1/shift: after reels stop, within 3 s, click one cell to turn it into a Black Ace before scoring. | big_one |
| 8 | `bent_ladder` | Bent Ladder | U | 4 Lim | Rung ×1→2, Ladder ×2→4, Rail ×4→7. | big_one |
| 9 | `plumb_line` | Plumb Line | U | 4 Lim | Shaft ×1.5→4, Slope ×1.5→3. | big_one |
| 10 | `tuning_fork` | Tuning Fork | R | 8 Lim | Fork and Hood ×5→12. | big_one |
| 11 | `cellar_door` | Cellar Door | R | 8 Lim | Cellar triggers with 9 of 10 matching cells; Cellar ×10→15. | big_one |
| 12 | `deep_spiral` | Deep Spiral | U | 4 Lim | Pit weight 2→4; Sinkhole gives 5 respins instead of 3. | big_one |
| 13 | `reel_grease` | Reel Grease | C | 2 Lim | SLOT plays cost −1 clock min (Big One 4→3, Old Lever 3→2, Pachislot 3→2). | SLOT · `play:start` |
| 14 | `nudge_button` | Nudge Button | U | 4 Lim | After a losing Big One or Old Lever spin, `N` nudges one reel ±1 stop and rescores (1 per spin, +1 clock min). | big_one, bandit |
| 15 | `padlock` | Padlock | R | 8 Lim | Every 4th Big One spin, choose 1 reel to hold (it does not spin). Counter shown on the cabinet. | big_one |
| 16 | `quick_thumb` | Quick Thumb | C | 2 Lim | Pachislot max slip 190→120 ms is replaced by a 4-stop "aim assist" toward a flagged bonus; the bonus lamp lights 1 game earlier. | pachislot |
| 17 | `marked_deck` | Marked Deck | U | 4 Lim | All CARD machines: the next card's colour (red/black) is printed on its back. | CARD · `card:dealt` |
| 18 | `pocket_abacus` | Pocket Abacus | R | 8 Lim | Blackjack and baccarat show the true count (Hi-Lo system) on a bead counter by your chips. At true count ≥ +3, blackjack naturals pay 2:1. | blackjack, baccarat |
| 19 | `velvet_gloves` | Velvet Gloves | C | 2 Lim | Blackjack: late surrender allowed; your winning hands pay 1.5:1 when the dealer busts after drawing 3+ cards. | blackjack |
| 20 | `bent_deuce` | Bent Deuce | U | 4 Lim | Video poker: the 2♣ is wild; paytable unchanged. | video_poker |
| 21 | `crooked_mirror` | Crooked Mirror | C | 2 Lim | Hi-Lo: equal rank counts as correct; step multiplier × 1.03. | hi_lo · `ladder:step` |
| 22 | `dragon_scale` | Dragon Scale | U | 4 Lim | Dragon & Tiger: Tie side bet 11:1; on a tie, main bets return 110 %. | dragon_tiger |
| 23 | `bankers_pen` | Banker's Pen | C | 2 Lim | Baccarat Banker commission 5 % → 1 %. | baccarat |
| 24 | `poker_glass` | Poker Glass | U | 4 Lim | Hold'em: after the flop each bot's monocle glows weak `#3A7BFF` / medium `#FFB000` / strong `#FF2A2A` (90 % accurate). | holdem |
| 25 | `loaded_die` | Loaded Die | U | 4 Lim | DICE machines: any die showing 1 is rerolled once. | craps, sic_bo, dice_tower · `dice:rolled` |
| 26 | `snake_eyes` | Snake Eyes | C | 2 Lim | Craps and Dice Tower: a total of 2 pays your largest active bet × 5 as a bonus. | craps, dice_tower |
| 27 | `birdcage_key` | Birdcage Key | U | 4 Lim | Sic Bo: Any Triple pays 45:1; on a triple, Small/Big bets push instead of losing. | sic_bo |
| 28 | `chalk_mark` | Chalk Mark | C | 2 Lim | Roulette: when 0 hits, even-money bets return 100 %. | roulette |
| 29 | `lodestone` | Lodestone | R | 8 Lim | ACTIVE 1/shift: after a WHEEL machine stops, move the result 1 pocket/segment/lamp clockwise or counter-clockwise (`A`/`D`, 3 s window). | roulette, big_six, cyclone · `wheel:stopped` |
| 30 | `spoke_wrench` | Spoke Wrench | U | 4 Lim | Money Wheel: "23" pays 30:1, PIT 60:1; spin clock 6→4 min. | big_six |
| 31 | `dowsing_rod` | Dowsing Rod | U | 4 Lim | Keno, bingo, tombola, Big Draw: 1 extra ball is drawn for your cards only. | BALL+PAPER · `ball:drawn` |
| 32 | `coin_edge` | Coin Edge | C | 2 Lim | Scratch-O-Matic: one random panel of the next card is pre-scratched before you buy; you may skip that card for free once per card. | scratch_vend |
| 33 | `heavy_bearing` | Heavy Bearing | C | 2 Lim | Plinko and pachinko RTP +3 %; pusher coins get +10 % friction (fewer side losses). | plinko, pachinko, coin_pusher |
| 34 | `pin_bender` | Pin Bender | U | 4 Lim | Pachinko start pocket width +25 %; plinko bounce randomness −20 % (balls drift less from the release column). | pachinko, plinko · `ball:landed` |
| 35 | `safety_net` | Safety Net | U | 4 Lim | The first bust each shift on mines, hi_lo or the Cable refunds 100 % of the stake. | RISK · `ladder:bust` |
| 36 | `canary` | Canary in a Cage | R | 8 Lim | Mines: once per game, hovering a mined tile for 0.5 s makes the canary chirp. | mines |
| 37 | `brake_shoe` | Brake Shoe | U | 4 Lim | The Cable: every 3rd ride, the crash point is rolled twice and the higher is used (counter on the brake lever). | elevator_crash |
| 38 | `last_rung` | Last Rung | C | 2 Lim | Cashing out any RISK ladder at ≥ 5× adds +1× bet. | RISK · `ladder:cashout` |
| 39 | `pine_tar` | Pine Tar | C | 2 Lim | The Claw: grip 0.6→0.85, timer 15→20 s. | claw_crane |
| 40 | `spirit_level` | Spirit Level | C | 2 Lim | Stacker and Cyclone speed −15 %. | stacker, cyclone · `skill:stop` |
| 41 | `brass_shim` | Brass Shim | U | 4 Lim | The Shelf: push stroke +20 %; coins lost off the sides return 30 %. | coin_pusher |
| 42 | `cheese_rind` | Cheese Rind | C | 2 Lim | Derby: your backed rat +6 % top speed; Place payouts +25 %. | derby · `race:finished` |
| 43 | `birth_certificate` | Birth Certificate | U | 4 Lim | Unlocks Your Number (4.1). | all Draw No. machines · `play:settled` |
| 44 | `numerologist` | Numerologist's Ledger | R | 8 Lim | Each Your Number trigger: +2 % to all your payouts for the rest of the shift (max +30 %). Needs Your Number. | `play:settled`, `shift:end` |
| 45 | `twin_tags` | Twin Dog Tags | U | 4 Lim | Choose a second Your Number; its triggers pay B × 0.5. | Draw No. machines |
| 46 | `iron_piggy` | Iron Piggy | C | 2 Lim | Vault interest +1 % per clock hour; interest cap 20 % → 25 %. | `clock:hour`, `deposit` |
| 47 | `pocket_watch` | Pocket Watch | U | 4 Lim | +1 clock hour every shift (shift starts 1 h earlier). | `shift:start` |
| 48 | `address_book` | Address Book | C | 2 Lim | +1 Hotline call per shift; one declined call per shift is re-offered as a different deal 1 clock hour later. | `phone:*` |
| 49 | `cold_compress` | Cold Compress | C | 2 Lim | Heat thresholds +15 on all machines. | all |
| 50 | `regulars_stool` | Regular's Stool | R | 8 Lim | The first machine you play each shift is your Regular: no Heat, +6 % RTP. All other machines start the shift at Heat 10. | all · `shift:start` |
| 51 | `charm_bracelet` | Charm Bracelet | R | 8 Lim | +1 charm slot; occupies none. | — |
| 52 | `wishbone` | Wishbone | U | 4 Lim | ACTIVE 1/shift: within 2 s of any losing result, replay that exact play (same bet) at no clock cost. | all · `play:settled` |
| 53 | `horseshoe_magnet` | Horseshoe Magnet | R | 8 Lim | Any win ≥ 50× bet also gives +1 Marker and credits 5 % of the current debt to the Vault. | all · `jackpot` |
| 54 | `receipt_roll` | Receipt Roll | C | 2 Lim | Each deposit ≥ 1 Lim prints a receipt that is a free Scratch-O-Matic card at docked-floor Min (max 3 per shift). | `deposit` |
| 55 | `old_haunt` | Old Haunt | Legendary | 15 Lim | Machines ≥ 2 floors below the Cage use the docked floor's Min and Lim. | all · `floor:unlock` |
| 56 | `altimeter` | Altimeter | R | 8 Lim | Every machine +1.5 % RTP per floor above F7 (F6 +1.5 % … G +10.5 %). | all |
| 57 | `climbing_rope` | Climbing Rope | C | 2 Lim | Entering a different floor grants 1 Second Wind (max 3). Your next winning play consumes all: +15 % payout per stack. | `floor:enter`, `play:settled` |
| 58 | `service_pass` | Service Pass | U | 4 Lim | Unlocks the service lift door on every landing: `E` → choose floor → 2 s fade. Each lift ride grants 1 Second Wind if you own Climbing Rope. | `floor:enter` |
| 59 | `blueprint` | Blueprint | U | 4 Lim | Each newly unlocked floor: one random machine there starts with a free random mod. | `floor:unlock` |
| 60 | `rope_ladder` | Rope Ladder | Legendary | 15 Lim | Once per run, when the floor opens under you, you catch a ladder: +2 clock hours, current debt +10 %, charm destroyed. | `trapdoor` |
| 61 | `key_to_the_house` | Key to the House | Legendary | 15 Lim | JACKPIT needs 13 of 15 matching cells; its flat bonus 100× → 150× bet. | big_one |
| 62 | `foundation_stone` | Foundation Stone | Legendary | 15 Lim | All Big One symbol values +0.5 per floor the Cage has climbed above F7, rounded down (F5 +1, F3 +2, F1/G +3). | big_one · `cage:rise` |
| 63 | `elevator_token` | Elevator Token | U | 4 Lim | When the Cage rises, gain 5 % of your pocket (max 3 Lim of the new floor). | `cage:rise` |
| 64 | `hollow_coin` | Hollow Coin | Cursed | +6 Lim | All machines +6 % RTP. 10 % of every deposit vanishes (does not count). | all, `deposit` |
| 65 | `cracked_mirror` | Cracked Mirror | Cursed | +4 Lim | All wins × 1.4. At shift start, 1 random machine per unlocked floor is OUT OF ORDER (taped X) for the shift. | all, `shift:start` |
| 66 | `collectors_card` | The Collector's Card | Cursed | +5 Lim | Current and next debt −20 %. The Collector patrols your floor; any win ≥ 20× bet while he is within 6 m is halved. | `play:settled` |
| 67 | `black_candle` | Black Candle | Cursed | +3 Lim | +2 clock hours per shift. All light intensity × 0.4; fog far 24 → 10 m; mannequins move when unseen. | `shift:start` |
| 68 | `stopped_watch` | Stopped Watch | Cursed | +3 Lim | Your first 25 plays each shift cost 0 clock min; every play after that costs double. | `play:start` |
| 69 | `house_signet` | Signet of the House | Cursed | +6 Lim | Charm prices −50 %. At 2 clock hours into each shift, if Vault < 40 % of debt, the House takes your rightmost non-cursed charm. | `clock:hour` |
| 70 | `fever_ticket` | Fever Ticket | Cursed | +4 Lim | Your Number triggers pay B × 3 (unlocks Your Number). Each shift the House draws a House Number; whenever any of your plays emits it, you lose bet × B. | `play:settled` |
| 71 | `glass_floor` | Glass Floor | Cursed | +8 Lim | All remaining debts −25 %. At 02:00 each shift, if Vault < 50 % of debt, the floor opens immediately. | `clock:hour` |
| 72 | `moth_eaten_glove` | Moth-Eaten Glove | Cursed | +3 Lim | All SLOT symbol values +2; every losing SLOT play costs +1 extra clock min. | SLOT |

Cursed charms cannot be sold; removal costs 3 Markers at the Pawn Window (or phone deal P10 buys them at 0). Their pocket icon has a hairline crack and they hum faintly (−18 dB) when held.

### 4.3 Synergy builds (design targets, verified by run simulation)

| Build | Core pieces | Route / why it works | Sim target |
|---|---|---|---|
| **Copper Rain** | Lucky Penny + Skeleton Key + Bent Ladder + Reel Grease; Gilded Trim on Big One | Lowest-value, most common symbols become 4s and horizontals ×2/×4/×7 → frequent mid wins, 3 min spins. Classic slot build; stays in the Cage. | Big One 125–135 % at F7–F5 |
| **Night Shift Numbers** | Birth Certificate + Twin Dog Tags + Numerologist's Ledger + Dowsing Rod; Number Plate on roulette and keno | Route F6 keno → F3 roulette/dice; frequent triggers stack Numerologist to +30 %, which then boosts everything else. | +25–35 % across all machines by mid-shift |
| **Basement Dweller** | Old Haunt + Cold Compress + Climbing Rope + Heavy Bearing | Play F7/F6 machines (104/102 %) at upper limits, rotate among 8 cabinets to dodge Heat. The anti-climb build: Pillar 1 inverted. | 112–118 % at F2-level stakes |
| **Card Sharp** | Marked Deck + Pocket Abacus + Velvet Gloves + Banker's Pen; Memory Drum on blackjack | Counting + colour reads; switch between blackjack and baccarat on count. | Blackjack 106–110 % |
| **Ladder Climber** | Safety Net + Canary in a Cage + Last Rung + Crooked Mirror; Quick Crank on mines | Push risk ladders to 5×+; one bust per shift is free. | 115 % on RISK machines |
| **Clockwork** | Reel Grease + Pocket Watch + Stopped Watch (cursed) + Quick Crank mods | More plays per shift; multiplies any other edge. | +40–60 % plays per shift |
| **Altitude Sickness** | Altimeter + Foundation Stone + Service Pass + Climbing Rope | Weak at F7, monstrous from F3; rewards climbing fast and punching out. | Big One 140–160 % at F2+ |
| **The Banker** | Iron Piggy + Elevator Token + Receipt Roll + Overtime phone deal | Deposit early, live on interest and free scratch cards. Low variance, low ceiling. | Effective debt −25 % |
| **Wheel of Debt** | Lodestone + Chalk Mark + Spoke Wrench + Birth Certificate | Straight-up on Your Number; Lodestone converts one near-miss per shift into a 35:1 + B hit. | Roulette 105–115 % |
| **Cursed Engine** | Hollow Coin + Cracked Mirror + Glass Floor + Signet of the House | Huge payouts and −25 % debts, but deposit tax, Out-of-Order machines and a hard 02:00 50 % check force front-loaded deposits. | 150 %+ with high ruin risk |

Known anti-synergies (intentional): Regular's Stool vs Climbing Rope; Stopped Watch vs Moth-Eaten Glove; Glass Floor vs any slow-start build.

---

## 5. The Hotline

### 5.1 Rules

- The Hotline is a black rotary phone on the Cage's north-west post; an **extension wall phone** hangs on every landing at (−2.2, −8.0) facing east. All ring together; the first pickup (`E`) takes the call.
- Calls per shift: 1 guaranteed (random time between clock hour 1 and hours−2) + 50 % chance of a second; triggered calls fire in addition; max 3 per shift (4 with Address Book; +1 with Jukebox "Static"). Min 60 clock min between calls.
- **Ring window: 25 real s** (6 rings, paused by SP pause). The ring is spatialized from the nearest phone; HUD shows a pulsing handset icon with an arrow.
- During the call, the handset LCD shows the offer (VT323, typewriter 30 chars/s); the House's voice speaks it. Choose with keypad `1` / `2` (`3` where listed). Calls cost 0 clock min unless stated.
- **Ignoring:** a call simply ends, unless stated. Ignoring 2 calls in a row guarantees P20 "Breathing" as the next call.
- Phone RNG uses its own seeded stream (`rng.phone`).

### 5.2 Phone events (27)

| id | Name | Trigger | Offer | Consequence |
|---|---|---|---|---|
| P01 | First Night | D1, clock 01:00 after ≥3 plays | 1: choose 1 of 2 free Common charms · 2: take 2 Lim coins | Tutorial call; the House introduces itself. |
| P02 | The Advance | At shift midpoint, Vault < 25 % of debt | 1: +3 Lim coins now, current debt +4 Lim · 2: decline | Net −1 Lim but liquidity now. |
| P03 | Ten More Minutes | 90 clock min left, Vault < 80 % of debt | 1: +60 clock min, next debt +15 % · 2: decline | Shown on terminal as "EXTENDED". |
| P04 | Heads, You Owe Less | D3+, 10 % per call slot | 1: the House flips its coin (audible): heads → current debt −35 %, tails → +35 % · 2: decline | Pure variance on the debt itself. |
| P05 | Wrong Number | Any shift, 8 % | 1: hang up · 2: stay on the line (costs 30 clock min) | Option 2: +1 Marker and a lore receipt spawns on a random unlocked floor (glowing). |
| P06 | The Mechanic Calls | First call after F6 unlocks | 1: free mod (choose 1 of 2), delivered as a crate in the Cage · 2: take 1 Marker | Teaches mods. |
| P07 | Hot Tip | D2+ | 1: pay 1 Lim: the House names a machine on a non-current floor running +15 % RTP for the next 60 clock min (HUD marker) · 2: decline | Forces a physical trip. |
| P08 | Fixed Race | F2 unlocked | 1: pay 2 Lim: the next derby winner is named (true 85 %) · 2: decline | If wrong, 1 Lim refunded: "The rat was unwell." |
| P09 | Trade-In | Own ≥ 4 charms | 1: lose a random non-cursed charm, gain a random charm one rarity higher (Legendary stays Legendary) · 2: decline | |
| P10 | The House Collects | Own a Rare+ or a cursed charm | 1: sell your highest-rarity charm for 2.5× its paid price, straight into the Vault · 2: hand over one cursed charm for free (removes it) · 3: decline | |
| P11 | A Gift | D3+ | 1: take a random cursed charm and double its coin payout · 2: decline | |
| P12 | Bad Luck, Kid | You lost ≥ 10 Lim in one play | 1: pay 1 Marker: refund 50 % of that loss · 2: decline | |
| P13 | Early Bird | Vault ≥ debt before 40 % of shift used | 1: punch out now with +2 extra Markers and next debt −10 % · 2: keep playing | |
| P14 | Lights Out | D4+ | 1: 60 clock min of darkness (only machine lamps lit, fog far 8 m), all machines +12 % RTP meanwhile · 2: decline | Mannequins move during darkness (cosmetic). |
| P15 | Feeling Lucky? | No Big One win ≥ Ladder in the last 25 spins | 1: pay 2 Lim: one of your next 10 Big One spins is guaranteed Ladder or better · 2: decline | |
| P16 | Number Station | Own Birth Certificate, Twin Tags or Fever Ticket | No choice: a voice reads 5 numbers; the 3rd becomes a bonus Your Number for this shift (full B) | Ignoring loses it. |
| P17 | Maintenance | D5+ | 1: pay 1 Marker to keep the stairs open · 2: accept: stair towers lock for 90 clock min, receive 2 Lim coins | Ignore = accept. Service Pass still works. |
| P18 | A Chair Pulled Out | ≤ 60 clock min left, Vault < 60 % of debt, F7–F1 | 1: the Cylinder (Devil's table) wheels into the Cage for this shift, no seat fee · 2: decline | The desperate route before the Foyer. |
| P19 | Overtime | Vault ≥ debt with ≥ 2 clock h left | 1: sign: coins deposited beyond the debt this shift count × 1.25 toward the next debt · 2: decline | |
| P20 | Breathing | D6+ 5 %, or after 2 ignored calls | No offer. Stay on the line 20 real s → +1 Marker, and the Collector appears on your floor for the rest of the shift | Hanging up: nothing. Horror beat. |
| P21 | Refinance | Shift start, D4+ (rings at clock hour 0.5) | 1: current debt −40 %; that 40 % × 1.25 is added to the next debt · 2: decline | Not offered on D8. |
| P22 | Sneak Peek | Right after a floor unlock (not G) | 1: pay 2 Markers: the next floor's grille opens now; its machines are playable this shift at their own limits · 2: decline | The Cage stays docked; only the stairs reach it. |
| P23 | Clearance | D2+ | 1: Curio prices −40 % this shift, Vault interest 0 % this shift · 2: decline | |
| P24 | Collector's Wager | D3+ | 1: name a machine; if your next play there wins ≥ 5× bet → +3 Markers, else −1 Marker · 2: decline | |
| P25 | Party Line | Co-op only, once per shift | All living players' phones ring; 10 s vote (`1`/`2`): A) +2 clock h for everyone, shared debt +15 % · B) decline | Majority; tie = decline. |
| P26 | Bounty | Versus only, D2+ | 1: pay 2 Lim: choose a rival; their current debt +8% (the rival is told who) · 2: decline | Max 1 bounty per rival per shift. |
| P27 | Ghost Call | MP, any ghost, 1 per ghost per shift | A ghost picks a living player and a 3-word preset ("LEFT FLOOR HOT", "TRUST NOBODY", "SPIN THE BIG ONE", "DEPOSIT NOW", "HE IS HERE", …) | The living player hears it as a whisper with subtitles. Free. |

---

## 6. Horror and atmosphere

### 6.1 Dread (one number drives the mood)

```
shiftPressure = clamp( (clockUsed / clockTotal) × (1 − Vault / Debt) × 1.5 , 0, 1 )
runProgress   = min(1, deadlineIndex / 8)
dread         = clamp( 0.55 × shiftPressure + 0.45 × runProgress , 0, 1 )
```

| Effect | Mapping |
|---|---|
| Fog far distance | lerp(24 m, 12 m, dread) (per-floor base in 8.4) |
| Light flicker | per light per second: 0.002 + 0.03 × dread² (100–300 ms dropouts) |
| Music | detune −40 × dread cents; tempo +10 % above 0.6 |
| Mannequin head-tracking | when dread > 0.35, at 15°/s, freezes when within 25° of view centre |
| Collector sighting | chance per clock hour = max(0, dread − 0.4) × 0.5 (from D4 unless cursed) |
| Heartbeat (synth, 55 BPM → 90 BPM) | dread > 0.8 |
| Red beacon in Cage | last clock hour if Vault < Debt |

Dread is never shown as a bar; the HUD only shows the ledger. The mood is the readout.

### 6.2 Cast (no gore, no blood, no violence on screen)

- **The House** — never seen. Voice synthesized in WebAudio: formant synthesis, base pitch 70 Hz, ring-mod 30 Hz, low-pass 2.4 kHz, 8-bit/11 kHz bitcrush. Every line is subtitled. Sample lines (EN; TR via i18n): "Good evening, tenant. The night shift begins." · "You are sixty coins from the stairs." · "Floor six. Mind the drains." · "The machines like you. I like you less." · "Six o'clock comes for everyone." · "Paid in full. Going up." · "Time."
- **The Collector** — 2.2 m tall, grey overcoat to the ankles, wide-brim hat, a blank brass faceplate with a single coin-slot; carries a ledger. Walks at 0.9 m/s, never runs, never chases, never enters the Cage. Vanishes if the player comes within 4 m or after 3 real s out of sight. Sound: two slow steps + key jangle every 1.4 s. Gameplay: he touches one machine per sighting; it gets a chalk X and −5 % RTP for 30 clock min. At the end of the run he steps aside from the Foyer door and tips his hat.
- **Attendants** — porcelain-faced mannequin dealers with jointed wooden hands (blackjack, baccarat, roulette, craps, Money Wheel, Seer). They deal with jerky 12 fps animation. Head-tracking per 6.1.
- **The Sump** — black water below F7, 30 m under it; dripping, a distant slot jingle muffled underwater. Never shown lit.

### 6.3 Escalation by deadline

| Deadline | Floor | New beat |
|---|---|---|
| D1 | F7 | Mains hum (50 Hz + 100 Hz), pipes knock every 20–40 s, the House's greeting. A coat-check mannequin in F7·A1 stands still facing the wall. |
| D2 | F6 | One fluorescent tube dead and buzzing. Washing drums turn by themselves; a drum stops the instant it enters view. |
| D3 | F5 | Dealers' heads track you (dread-gated). A chair at the blackjack table is pulled out when you return to the floor. |
| D4 | F4 | Midway music box plays a detuned waltz when dread > 0.5. First Collector silhouette: at the bottom of the Well, looking up. |
| D5 | F3 | Chandelier sways with no draught. The roulette ball keeps rolling 2 s after the result is paid. Collector patrols begin. |
| D6 | F2 | The House says your profile name once. The tin rats twitch on the track when the hall lights dip. Footsteps on the floor above (the Cage). |
| D7 | F1 | Wallpaper pattern swaps when unobserved. The Seer turns to face the Cage and says one line. Lights on F7–F5 go out one by one; the Well below is black. |
| D8 | G | Silence; no music. Grey daylight under the revolving door. The Collector stands by the chained door holding the key. Paying the debt: he unlocks it. |

### 6.4 Intra-shift beats (clock-based, every shift)

| Clock left | Beat |
|---|---|
| 2 h | Music layer 2 (sub-bass drone) fades in. |
| 1 h | If Vault < Debt: Cage red beacon rotates (0.5 rev/s), the House: "One hour." |
| 30 min | Wall clocks tick audibly (1 tick per clock min advanced); flicker floor raised to 0.01. |
| 10 min | Bell tolls once per clock minute advanced. |
| 0 | Settlement or Foreclosure (2.7). |

On payment in full at any time: lights snap to 100 %, a brass bell, all mannequins face forward, dread's shiftPressure → 0.

### 6.5 Taste rules

No blood, gore, corpses, self-harm imagery, weapons pointed at anyone. The Cylinder is a drum and a lever. Falls cut to black before any landing. Strobes ≤ 6 Hz (≤ 3 Hz in photosensitivity mode). Scares are reveals and sounds, never full-screen jump images.

### 6.6 Audio palette (all WebAudio-synthesized)

Reel ticks: filtered noise bursts 2 ms at 1.8 kHz. Bells: FM (carrier 880 Hz, mod ratio 3.5, index decay 0.8 s). Coins: 3 random sine partials 2.5–6 kHz, 60 ms decay. Lever: ratchet = 18 clicks in 0.4 s. Elevator: 40 Hz motor + chain clank every 0.3 s. Footsteps per floor material (metal grate F7, wet tile F6, carpet F5/F3/F1, wood F4/F2, marble G).

---

## 7. Modes

### 7.1 Debt Run (single-player)

Everything in sections 2–6. No network. Suspend-save. Seed shown on pause and results.

### 7.2 Co-op Debt Run (2–8 players, shared debt)

| Topic | Rule |
|---|---|
| Debt | Shared. `Debt_coop = Debt_solo × (0.6 + 0.4 × N)` → N=2 ×1.4, 3 ×1.8, 4 ×2.2, 5 ×2.6, 6 ×3.0, 7 ×3.4, 8 ×3.8. Rescaled only at shift start. |
| Money | Each player has a personal pocket. `G` drops a coin bag (wheel picks amount: 1 Lim steps / ALL) that anyone can pick up (`E`). |
| Deposits | One shared Vault. The Debt Terminal has 2 coin slots and shows contributions per player (bars in player colours). Interest as SP. |
| Clock | Each player has a personal **timecard** = the shift's clock hours; plays consume only your own timecard (shown on your wristwatch). The **wall clock** is a real-time cap: the shift maps 22:00–06:00 onto `12 + N` real minutes (max 18). The shift ends when the wall clock reaches 06:00 or all timecards are empty (then wall clocks fast-forward to 06:00 in 5 s). The 30 s Last Call (2.2) then applies to everyone. |
| Dawdle | Not used (the wall clock is the pressure). |
| Machines | Cabinets are 1 seat (2 with mods/charms as noted); tables are multi-seat (see roster). Shared draws (keno, bingo, Cable, derby, Big Draw) run on host timers per floor every 45–90 real s. A seated player locks a cabinet; others see "OCCUPIED — <name>". |
| Charms | Personal. Curio stock is shared: 4 + ⌈N/2⌉ offers, first come first served. |
| Mods | Bought with personal Markers, installed on shared machines; installer's colour on the plate. |
| Phone | Rings for everybody; first pickup decides (others hear the call through their nearest phone with subtitles). +⌊N/3⌋ calls per shift. P25 Party Line votes. |
| Punch Out | Requires Vault ≥ Debt and a hold-vote: every living player pulls their own lever on the terminal within 20 real s (or host forces). Markers per player = unused hours on **their** timecard. |
| Cage rise | Players inside the Cage ride up; others take the stairs. 20 real s "LAST CALL" warning before the gate closes. |
| **Fall Guy** (foreclosure) | If ≥ 3 players are alive, the House offers a 10 s vote: drop one volunteer/elected player (default nominee: lowest total deposit this shift) to get +2 clock hours (wall clock extended by the matching real time, and +2 h on every living timecard) and −25 % on the current debt. Majority required; otherwise everyone falls. |
| Ghosts and bail | Fallen players become ghosts (see 7.3). At the next successful settlement the team may pay **bail** per ghost = 15 % of the next debt (or 2 Markers from any player). The ghost respawns in the Cage with 2 Lim and their charms. |
| Late join | Joins as a ghost until the next shift start, then spawns in the Cage with 2 Lim of the docked floor, a free Common charm and 0 Markers. |
| Disconnect | Host setting: pocket auto-deposits into the Vault (default) or vanishes. Host migration is out of scope; host leaving ends the session (suspend-save offered to host). |

### 7.3 Versus — Last One Standing (2–8 players)

| Topic | Rule |
|---|---|
| Debt | Each player has their own solo-scale debt, own Vault (the terminal holds a card slot per player) and own interest. |
| Clock | Same as co-op: personal timecards + real-time wall clock (`12 + N` real min). |
| Money | No transfers, no coin bags. Charms personal; mods anyone can buy and they help everyone who uses that machine (sabotage by occupation is legal). |
| Interaction | P26 Bounty, P27 Ghost Call, racing for the Curio stock, occupying the best machine. |
| Settlement | Every player who is short at 06:00 falls. Survivors continue; the Cage rises. |
| Ghosts | Free-fly camera (noclip inside the pit, 4 m/s, `Space`/`C` up/down), see everyone's Vault/Debt as floating ledger tags, cannot touch machines. Each ghost: 1 Ghost Call per shift, and a **Ghost Ledger**: bet 0–100 ghost chips per shift on which living player survives the deadline (cosmetic leaderboard). Ghosts chat only with ghosts; living players see ghost chat as unreadable whispers. |
| Win | Last player standing. If all remaining players fall on the same deadline, the highest Vault ÷ Debt ratio wins. If 2+ pay D8, play continues into Endless until one remains; hard cap at E11, then highest surplus. |

### 7.4 Free Casino (1–8 players, sandbox)

- All floors unlocked and lit; the Cage parks at G. Spawn in the Cage.
- Start pocket 500 coins. When pocket < 5, the Cashier refills +200 (once per 3 real min).
- Per-floor limits still apply (climbing still matters for stakes).
- Charms: equip freely from your discovered collection (max 8); no prices. Mods: free, 1 per machine per player session.
- No debt, no foreclosure, no Collector, no Heat; ambient horror at dread 0.2 fixed. Jukebox and Seer fortunes work. Host toggles: House voice on/off, lights 25–100 %.
- Nothing counts toward unlocks/achievements/stats (separate "Free Casino" stats page).

### 7.5 Network notes for designers

Host is authoritative for every RNG roll (seeded streams per system), clocks, Vaults, occupancy and shared draws. Clients send intents (`sit`, `bet`, `action`, `deposit`, `answerPhone`, `buy`). Machine animations are deterministic from the host's result packet so every client sees the same reels/ball. Single-player runs the same code path with a local loopback "host".

---

## 8. Level layout of the pit

### 8.1 Overview

A vertical shaft: 7 stacked floors + the Foyer, all 24 × 24 m, stacked every 5.0 m (4.5 m clear ceiling + 0.5 m slab). The central **Well** (8 × 8 m void) runs from the Foyer down into the Sump. The **Cage** (6 × 6 m freight elevator) docks inside the Well at the highest unlocked floor. A **stair tower** in the NE corner connects every floor. Floors below the Cage remain open; floors above are behind grilles.

```
 y=35  G  The Foyer        (Well capped by marble floor; Cage rises through it on D7 paid)
 y=30  F1 The Parlour
 y=25  F2 The Paddock
 y=20  F3 The Wheel House
 y=15  F4 The Midway
 y=10  F5 The Card Room
 y= 5  F6 The Laundry
 y= 0  F7 The Boiler       (start; Cage docked here)
 y=-30 The Sump (black water, fall target)
```

### 8.2 Floor shell (identical for F7–F1; local coordinates, origin = Well centre)

```
 z=-12 +------------------------------------------------+
       | A1 (NW)  |  C1      | LAND |      C2  | STAIRS |
       | 5x5      |  3x3     | ING  |      3x3 | (NE)   |
 z=-7  |----------+          | 4 m  |          +--------|
       |          |          |      |          |        |
       |  T2      +----------+GATE--+----------+  C3    |
       |  5x7     |                            |  3x3   |
       |  (west   |        THE WELL            |        |
       |  band)   |        8x8 void            |  C4    |
       |          |      (Cage 6x6 docks)      |  3x3   |
 z=+4  |          +----------------------------+        |
 z=+7  |----------+                            +--------|
       | A2 (SW)  |        T1  7x5 (south band)| A3 (SE)|
       | 5x5      |                            | 5x5    |
 z=+12 +------------------------------------------------+
     x=-12      x=-7                         x=+7     x=+12
```

- Walls 0.3 m thick, ceiling 4.5 m, floor tiles 2 × 2 m (each tile is a hinged trapdoor visual).
- Well railing 1.1 m high at |x| = 4 or |z| = 4, with a 3 m gate gap on the north edge (x ∈ [−1.5, 1.5], z = −4). A 3 × 1 m drawbridge plate drops when the Cage docks.
- **Landing walkway:** x ∈ [−2, 2], z ∈ [−12, −4]. Floor number painted on the north wall, 1.5 m tall, centred at (x 0, y 2.2, z −11.85). Wall clock above it at y = 3.4. Extension phone on a 0.4 × 0.4 m pillar at (x −2.4, z −8.0), handset at y 1.4, facing east. Floor sign/marquee with the floor name over the walkway at y = 3.8.
- Service lift door (Service Pass) in the north wall at (x 1.5, z −11.85), 1.0 × 2.1 m, facing south; shut and unlit without the charm.

### 8.3 Generic slots (machines declare a footprint class; the level places them into compatible slots)

| Slot | Centre (x, z) | Size (w × d) | Player yaw | Class | Notes |
|---|---|---|---|---|---|
| C1 | (−4.5, −9.0) | 3 × 3 | 0 (north) | CAB | Machine back to north wall |
| C2 | (4.5, −9.0) | 3 × 3 | 0 | CAB | |
| C3 | (9.5, −3.0) | 3 × 3 | −90 (east) | CAB | Machine back to east wall |
| C4 | (9.5, 3.0) | 3 × 3 | −90 | CAB | |
| T1 | (0, 8.5) | 7 × 5 | 180 (south) | TBL | Dealer/track on the south side |
| T2 | (−8.5, 0) | 5 × 7 | 90 (west) | TBL | Dealer/wheel on the west side |
| A1 | (−9.5, −9.5) | 5 × 5 | — | AMN | Service prop per floor |
| A2 | (−9.5, 9.5) | 5 × 5 | — | AMN / C5 in Free Casino & Endless | |
| A3 | (9.5, 9.5) | 5 × 5 | — | AMN / C6 in Free Casino & Endless | |

Footprint classes: **CAB** machine body ≤ 2.4 m wide × 2.0 m deep × 3.0 m tall, with a 1 m player zone in front; play-pose camera 0.75 m from the machine face at eye height 1.25 m (seated) or 1.6 m (standing). **TBL** ≤ 6.0 × 4.0 m including dealer area; seats on an arc of radius 1.6 m. **AMN** 5 × 5 m props. Slot ids are global strings, e.g. `F5.T1`.

### 8.4 Floor assignments and lighting

| Floor | Theme | C1 | C2 | C3 | C4 | T1 | T2 | A1 | A2 / A3 | Key light | Ambient | Fog colour, near→far | Signature |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F7 The Boiler | rust, pipes, steam, metal grate | bandit | coin_flip | hi_lo | scratch_vend | boiler (prop) | pallet store (prop) | coat-check + mannequin | pipe banks | sodium `#FF9A3C` | `#2B1B10` | `#120B06`, 4→22 m | steam vent puffs every 8–14 s |
| F6 The Laundry | white tile, drum washers, drains | keno (+ wall board) | mines | plinko | coin_pusher | washer row (prop) | linen carts (prop) | Mechanic's Bench | drains, mops | fluorescent `#A8F0FF` | `#0E1E26` | `#0A1418`, 4→24 m | tube flicker, dripping |
| F5 The Card Room | green felt, dark wood, brass | lounge chairs (prop) | lounge chairs (prop) | video_poker | dragon_tiger | blackjack | baccarat | Pawn Window | humidor, bar shelf | lamp `#FFE2A8` over felt `#1F5E3A` | `#18120A` | `#0D0906`, 3→20 m | cones of light over tables only |
| F4 The Midway | striped canvas, bulb strings | shell_game | stacker | claw_crane | cyclone | dead carousel (prop) | ticket booth (prop) | Jukebox | prize shelves | chase bulbs `#FF4D6D` `#FFD23F` `#3BCEAC` `#6A4CFF` at 4 Hz | `#1C0E1E` | `#120814`, 4→22 m | bulb chase, music box |
| F3 The Wheel House | red velvet, gold, chandeliers | velvet rope (prop) | cigar stand (prop) | sic_bo | dice_tower | roulette | big_six (3 m wheel on west wall) | chandelier lounge | mirrors | deep red `#C8102E` + gold `#E8B04A` | `#1E0808` | `#140505`, 3→20 m | chandelier sway, mirror reflections (cube-cam off; fake planar) |
| F2 The Paddock | stable boards, tote board, neon | feed room (prop) | tote board (prop) | pachinko | pachislot | derby (4.5 × 2.4 track) | elevator_crash (shaft through a ceiling hole) | lore room | hay bales (fake) | neon `#8CFF6B` + race strobe `#FFFFFF` | `#0C160C` | `#081008`, 4→22 m | race strobes, tote flips |
| F1 The Parlour | wallpaper, gaslight, occult | fireplace (prop) | piano (prop) | tombola | fortune_teller | craps | bingo (caller + 6 desks) | Cashier | clocks wall | gaslight `#FFD9A0`, Seer `#7A4CC2` | `#16100C` | `#0F0B08`, 3→18 m | wallpaper swap, ticking clocks |

The Big One is fixed in the Cage. Unused C/T slots on a floor hold the listed props; in Endless and Free Casino, A2/A3 become C5/C6 and host duplicate cabinets.

### 8.5 The Cage (6 × 6 m, x, z ∈ [−3, 3], floor flush with the landing when docked)

| Element | Position | Notes |
|---|---|---|
| The Big One | south wall, centre (0, 2.4), facing north | 1.6 w × 2.3 h × 0.9 d m. Its screen is cracked from your intro burst for the whole run. |
| Debt Terminal | west wall, (−2.6, 0), facing east | 0.9 w × 1.8 h; brass coin slot, green phosphor screen, red PUNCH OUT lever, thermal printer |
| The Curio | east wall, (2.6, 0), facing west | 1.1 w × 2.0 h glass-front spiral vending machine |
| Hotline phone | NW post (x −2.7, z −2.7), handset at y 1.3 | black rotary phone in a wire cage |
| Clock + floor dial | above the gate, (0, 2.8, −3) | brass needle shows floor 7→G |
| Gate | north face x ∈ [−1.5, 1.5] | scissor gate, 1.2 s open/close |
| Lighting | bare bulb `#FFF2CC` at (0, 3.0, 0); red beacon `#D7263D` on roof | |
| Walls/roof | chain-link mesh 2.6 m, roof at 3.2 m | |

Cage rise (after settlement): gate closes 1.2 s → chain clank 1.5 s → rise 5 m in 8 s (1 s of darkness passing the slab) → arrival thud with 2-px shake → drawbridge drops → the new floor's grilles roll up 2 s → its 4 machines power on 0.6 s apart (marquee blink, start-up jingle, ceiling spotlight `#FFF2CC` for 3 s each) → the House names the floor → the terminal prints the new debt → the Curio restocks with a clunk → wall clocks spin to the new start time. Total ≈ 18 s; skippable after 4 s by holding `Space`.

### 8.6 Stair tower (NE corner, x ∈ [7, 12], z ∈ [−12, −7])

Door on the west face at x = 7, z ∈ [−10.2, −9.0]. Switchback stair per floor: two flights of 2.5 m rise, 14 risers × 0.179 m, treads 0.30 m (flight length 4.2 m), width 1.2 m, half-landing 2.6 × 1.2 m. Collision as 31° ramps. Green exit sign `#3CFF7A`. Locked floors: a steel roll grille at the floor's stair door — see-through bars, the dark floor visible with machines under dust sheets. Travel time per floor ≈ 4.5 s sprinting.

### 8.7 The Foyer (G, y = 35) and the Sump

- Same 24 × 24 m shell, marble floor `#D8D4CC`, gold trim `#C9A227`, too clean. The Well is capped with a marble ring; the Cage rises into a 6 × 6 m pit in the centre.
- Slots: T1 holdem (oval table 4.5 × 2.6 m, 8 seats), T2 lotto_blower (stage with a 1.2 m acrylic blower + ticket desk), C3 devils_table (round table 1.6 m Ø, one chair), C4 concierge desk with a locked "MANAGEMENT" door (never opens), A1 cloakroom.
- Exit: revolving door at (0, −12), 3 m wide, chained until D8 is paid. Grey daylight `#C9D3DA` leaks under it; light fog `#3A4046`, 6→30 m.
- **The Sump:** below F7 at y = −30. Fog `#000000`, 1→10 m. Only reached by falling.

### 8.8 Spawn points (Cage on F7, y = 0; all yaw 0 = facing the gate)

| Player | (x, z) | | Player | (x, z) |
|---|---|---|---|---|
| P1 (host / SP) | (0.0, 1.0) | | P5 | (1.6, −0.6) |
| P2 | (−1.2, 0.6) | | P6 | (−0.6, −1.2) |
| P3 | (1.2, 0.6) | | P7 | (0.6, −1.2) |
| P4 | (−1.6, −0.6) | | P8 | (0.0, −2.2) |

Player capsule radius 0.3 m, height 1.75 m. Bail respawn = P1 on the docked floor. Free Casino uses the same offsets at y = 35. Late joiners use the first free spawn on the docked floor.

### 8.9 Performance budget

Per floor ≤ 25k triangles, ≤ 6 real-time point lights (rest is vertex-colour baked), ≤ 12 textures of 16–64 px. Render the player's floor ±1 plus the Well interior (each floor is a `THREE.Group` toggled by a floor-visibility system). Fog hides more than ~4 floors through the Well.

---

## 9. Menu and intro flow

### 9.1 Boot

Black → "JACKPIT" in Press Start 2P, dithered, 1.2 s → "PRESS ANY KEY" blinking 1 Hz (unlocks WebAudio) → cut into the Jackpot Chamber.

### 9.2 The Jackpot Chamber (the main menu, a 3D PSX scene)

You are inside a giant slot cabinet, the size of a room: interior 5.0 m wide × 3.6 m tall × 3.6 m deep. Three reels (rings of backlit acrylic panels), 3.2 m diameter, 1.5 m wide, rotate around a common horizontal axis at y = 1.8 m; the **camera sits on that axis**, so the strips curve around it (panels above, ahead, below). Centre reel x = 0, left x = −1.65, right x = +1.65. Each reel carries 8 panels of 1.25 m pitch. The **payline** is straight ahead: a red lamp strip `#FF2A2A` across all three reels marks the selected row. Beyond the panels, 1.8 m ahead, is the curved **glass**; through it you see the Cage on F7, dim and fogged, the phone, the terminal — the game waiting. Coins rattle in the hopper below. Mouse movement adds ±6° parallax.

| Reel | Role |
|---|---|
| Centre | Menu entries (current list) |
| Left | Context: description of the highlighted entry, profile ledger (runs, best floor, wins) |
| Right | The Lever side: confirm states ("PULL TO PLAY"), lobby players, version/news |

### 9.3 Navigation

`W`/`S` or mouse wheel rotate the centre reel one panel (0.18 s ease-out with 4° overshoot, tick sound); mouse hover over a visible panel highlights it; `Enter`/`E`/left click selects; `Esc`/`Backspace` = back (reel spins back). Controller-free for v1.

### 9.4 Menu tree

```
PLAY ............ DEBT RUN (new) · CONTINUE (if suspend-save) · SEED RUN (type seed) · DAILY RUN · BACK
MULTIPLAYER ..... SERVER BROWSER · HOST A TABLE · JOIN BY CODE · BACK
FREE CASINO ..... SOLO · HOST · BACK
LEDGER .......... STATS · CHARM BOOK · MACHINE PLAQUES · ACHIEVEMENTS · UNLOCKS
SETTINGS ........ GRAPHICS · AUDIO · CONTROLS · GAMEPLAY · NETWORK · LANGUAGE (EN / TR)
CREDITS
```

Starting a Debt Run asks for a **Contract** (starting loadout, 11.2) and **House Rules** level (after the first win) on the left reel, then "PULL TO PLAY" on the right reel.

### 9.5 Play → burst out (timeline, real seconds)

| t | Event |
|---|---|
| 0.0 | Player pulls the giant lever on the right (drag mouse down ≥ 150 px, or `Space`). Lever ratchet sound. |
| 0.3 | All three reels spin (blurred panels, pitch-rising whirr). |
| 2.0 / 2.35 / 2.7 | Reels stop left → right, each on a gold **JACKPIT** panel; one bell per stop. |
| 2.8 | Payline strobes 6 Hz (3 Hz photosafe); siren sweep 400→900 Hz; coins pour from the ceiling hopper (120 instanced coins). |
| 3.1 / 3.4 / 3.7 | Glass cracks in three stages (decal + crack sound). |
| 4.0 | The centre panels split apart; camera dollies 3 m forward in 0.7 s, FOV 75 → 95; glass shatters into 40 PSX triangles. |
| 4.7 | Scale cut: the camera exits The Big One's screen in the Cage (you were inside it all along); tumble 0.5 s (roll 6° settling), lands at eye height 1.62 m facing the gate. |
| 5.2 | FOV 95 → 75 over 0.3 s. Control enabled. The House: "Good evening, tenant." The Curio blinks "FIRST ONE FREE". |

First run: unskippable. Later: hold `Space` 0.5 s to skip to 4.7. Multiplayer: all players burst out in spawn order, 0.2 s apart.

### 9.6 Server browser ("The Departures Board")

The glass becomes a phosphor-green split-flap board (each character flips with an 8 ms clack). Columns: LOCK (pixel padlock icon) · ROOM (20 chars) · HOST · MODE (DEBT CO-OP / VERSUS / FREE) · PLAYERS (3/8) · PING (ms) · STATUS (LOBBY / IN PIT F5) · TRANSPORT badge ([LOBBY] WebSocket server, [NOSTR] global P2P, [TAB] same-browser).
Controls: `W`/`S` select, `Enter` join (password prompt if locked), `F` cycle filter (All / Co-op / Versus / Free / Has space / No password), `R` refresh (auto every 5 s), `H` host, `J` join by 6-char code, `Esc` back. Sorted by ping ascending; full rooms greyed.

**Host a table** form (left reel panels): Room name (default "<name>'s table"), Mode, Max players 2–8, Password (optional), Visibility (Public / Code only / Same browser), House Rules 0–10, Seed (blank = random), Late join Y/N, Disconnect policy (Deposit / Vanish). Shows the co-op debt multiplier for the current max players.

### 9.7 Lobby (pre-game)

Still inside the Jackpot Chamber. Each player appears as a lit panel on the right reel (name, colour swatch, ping, READY lamp). `R` toggles ready, `T` chat (shown on the left reel). Host sees START when everyone is ready (or forces after 10 s). START → 9.5 sequence for everyone.

### 9.8 Pause

`Esc` (when not seated). SP: the world freezes and greys; a crumpled thermal receipt slides up from the bottom with: RESUME · RUN SHEET (debt table, Vault, charms, mods, Your Number, seed) · SETTINGS · SAVE & QUIT TO MENU · ABANDON RUN (confirm by holding `E` 1 s). MP: the game does not pause; the receipt adds INVITE CODE, PLAYERS (host: mute/kick), LEAVE.

### 9.9 Settings

| Tab | Options (defaults bold) |
|---|---|
| Graphics | Internal resolution 320×180 / **400×225** / 640×360 · Vertex jitter 0 / **1** / 2 · Affine warping **on** · 15-bit dither **on** · CRT scanlines/vignette **off** · Fog **on** · Max FPS 30 / **60** / uncapped · Photosensitivity mode **off** |
| Audio | Master **80** · Music **60** · SFX **80** · House voice **80** · Subtitles **on** |
| Controls | Mouse sensitivity 0.1–5 (**1.0**) · Invert Y **off** · FOV 60–100 (**75**) · Head-bob 0–100 % (**100**) · Screen shake 0–100 % (**100**) · Key rebinding |
| Gameplay | Language **EN** / TR · HUD clock **off** · Intro skip **off** · Tutorial hints **on** |
| Network | Display name · Colour (8 swatches) · Lobby server URL (**ws://localhost:8787**) · Preferred transport **Auto** / WebRTC / Relay / Nostr |

### 9.10 Results / death screen ("Foreclosure Notice")

After the fall (2.7) a thermal printer prints a receipt line by line (0.12 s per line, printer whirr): run seed, contract, floor reached, deadlines paid, cause ("FORECLOSED 06:00 — SHORT 1,240" / "THE CYLINDER — CHAMBER 4" / "GLASS FLOOR"), total wagered, total won, biggest win (machine, ×bet), most-played machine, Your Number hits, charms held (icons), mods installed, Markers earned, real time. Then new unlocks are rubber-stamped onto it (0.3 s thud each). Buttons: AGAIN (same seed) · NEW RUN · MENU · COPY SEED.

### 9.11 Win screen ("Paid in Full")

Walking through the revolving door → white-grey fog street, distant traffic hum, 6 s of walking control → fade → receipt stamped **PAID IN FULL** with the same stats → "The elevator is still open. Go back down?" YES (Endless, from the Foyer with all floors open) / NO (menu).

### 9.12 Stats (Ledger)

Lifetime: runs, wins, best floor, best endless deadline, coins wagered/won, best single win, favourite machine, total clock hours played, foreclosures by cause. Per-machine table: plays, wagered, realized RTP, biggest win. Charm Book: 72 slots, silhouettes for undiscovered charms. Free Casino has its own page.

---

## 10. HUD and feedback

### 10.1 HUD (HTML overlay rendered in pixel fonts at integer scale of the 400×225 frame)

| Element | Position | Content |
|---|---|---|
| Crosshair | centre | 2×2 px dot; becomes a 6 px ring over interactables |
| Interaction prompt | centre, 24 px below crosshair | "[E] PLAY — THE BIG ONE · BET 1–5 · HOT −2 %" / "OCCUPIED — Ayşe" |
| Pocket | bottom-left | "◎ 1,240" (VT323), rolling counter 0.4 s on change |
| Markers | bottom-left, under pocket | "◆ 3" |
| Vault strip | top-centre, only in the last 2 clock h or when Q held | "VAULT 4,100 / 9,500" + 120 px bar |
| Floor | top-left | "F6" in a small elevator-dial icon |
| Charm strip | bottom-right | 6–8 icons 16×16; active charms show charge pips; cursed have a crack |
| Phone | top-right | pulsing handset + direction arrow while ringing, with a 25 s ring timer arc |
| Seated panel | bottom-centre (only while seated) | bet dial, last win, machine Heat, Draw Number and B value, machine controls hint |
| Chat / killfeed | left middle | chat lines (8 s fade); events like "Ayşe hit a CELLAR ×15 on F7" |
| Tab (hold) | full overlay | MP scoreboard (name, pocket, deposited, charms, ping) + run sheet |

### 10.2 Diegetic displays

Wristwatch on the left hand (`Q` raises it 0.25 s): clock hands + small LCD "VAULT 72 % · 2h40 LEFT". Wall clocks on every landing. Debt Terminal green screen (debt, Vault, next interest, contributors). Cage floor dial. Each machine's Heat tube and Draw Number plate. Curio LCD price tags. Hotline LCD. Tote board on F2. Keno/bingo wall boards. The Big One's cracked screen.

### 10.3 Controls

| Key | Action |
|---|---|
| Mouse | look (pointer lock) |
| `W` `A` `S` `D` | move: walk 3.2 m/s, sprint 5.6 m/s, crouch 1.6 m/s |
| `Shift` / `C` | sprint / crouch (eye height 1.62 → 1.0 m) |
| `E` | interact / sit / stand up / install mod / pick up |
| `Esc` | stand up / pause |
| `Space` | primary machine action (spin, deal, drop, stop, cash out) |
| Wheel or `[` `]` | bet down/up; amount in terminal and coin bag |
| `1`–`5` | machine options (holds, choices, keypad) |
| `R` | repeat last bet (seated) / ready (lobby) |
| `F` | use active charm |
| `N` | nudge (Nudge Button) |
| `Q` (hold) | raise wristwatch |
| `G` | drop coin bag (co-op, Free Casino) |
| `Tab` (hold) | scoreboard / run sheet |
| `T` | chat |
| `F1` | controls card |

No jump. Head-bob 0.035 m vertical / 0.02 m lateral at 1.8 Hz walking, 2.6 Hz sprinting. Footsteps every 0.55 s walking / 0.38 s sprinting. Camera glide into play pose 0.45 s ease-in-out, out 0.3 s.

### 10.4 Juice tiers (by payout ÷ bet)

| Tier | Range | Hit-stop | Shake (internal px, 30 Hz, exp. decay) | Coins (instanced, max 120 active) | Light | Sound | Text |
|---|---|---|---|---|---|---|---|
| Tick | < 2× | — | — | 1–3 pop into hand | machine lamp blink | coin clink | "+12" floats 0.6 s |
| Nice | 2–9.99× | — | 1 px, 0.15 s | 8–20 spill to tray | marquee flash ×2 | 2-note chime | "+180" gold |
| Big | 10–49.99× | 0.08 s | 2 px, 0.4 s | 30–60 shower | floor lights pulse `#FFC83D` ×2 | 3 bells, the House chuckles | "BIG" stencil on marquee |
| JACKPIT | ≥ 50× | 0.25 s | 3 px, 0.8 s + FOV 75→68→75 over 0.5 s | 120-coin geyser arcing onto the floor, auto-collected after 2 s | all floor lights strobe `#FFC83D`/`#FFFFFF` 6 Hz (3 Hz photosafe) for 2.5 s; red beacon spins | siren 400→900 Hz, bell cascade, crowd of machine jingles | "JACKPIT" scrolls on every marquee on that floor; other players see a gold beam up the Well |

Coin count shown = `min(120, ceil(log2(payout ÷ Min + 1) × 12))`. Losses: soft thunk, reels/ball settle; no shake. Near-miss (Big One: 4 of 5 Rail cells / Cellar 8 of 10): 0.3 s slow-down on the last reel, rising tone, "SO CLOSE" whisper (max once per 10 spins).

### 10.5 Other feedback

- **Deposit:** coins pour into the slot (0.6 s), terminal counter rolls 0.8 s, interest preview updates. Debt paid: green lamp, brass bell, all lights snap to 100 %, the House: "Paid in full."
- **Heat:** tube colour + hum; prompt shows the penalty.
- **Your Number:** the brass plate flips, a typewriter "ding", "YOUR NUMBER +4.4×" in amber.
- **Charm trigger:** the charm's HUD icon bounces 2 px and the charm on the wrist jingles (one 3-partial sine).
- **Floor unlock:** see 8.5.
- **Phone:** bell ring 2 s on / 2 s off; nearer phones louder.

---

## 11. Meta progression, achievements, seeds

### 11.1 Milestone unlocks (no meta currency)

| Milestone | Unlock |
|---|---|
| First foreclosure | Ledger (stats), Seed Runs |
| Pay D1 first time | Charms 13–16 enter the pool |
| Pay D2 | Contract "Card Sharp"; charms 17–24 (card) enter the pool |
| Pay D3 | Daily Run; charms 25–30 |
| Pay D4 | Legendary charms Old Haunt (55) and Key to the House (61) enter the pool; Contract "Numbers Runner" |
| Pay D5 | Charms 31–42 complete; machine "Night" variants visible in the Machine Plaques |
| Pay D6 | Contract "Basement Lease" |
| Pay D7 | Rope Ladder and Foundation Stone enter the pool |
| Win (D8) | Endless; House Rules 1; Contract "The Heir"; meta perk "Deep Pockets" (+1 charm slot) after 3 wins |
| Each House Rules level won | next level |
| 100 plays on a machine | its brass plaque in the Ledger (rules card + realized RTP) and a cosmetic trim for that machine |
| First JACKPIT | gold trim for The Big One |
| Win a Versus match | cosmetic "Bellhop cap" avatar hat |
| Reach E10 | cosmetic "Gilded Cage" |

Base pool at first launch: charms 1–12, 43–54, 56–59, 63–72 (the rest unlock above). A charm unlocked mid-run enters the pool immediately, including for the current run.

### 11.2 Contracts (starting loadouts)

| Contract | Start | Unlock |
|---|---|---|
| Standard | 30 coins, choose 1 of 3 Commons | default |
| Card Sharp | 20 coins, Marked Deck + Banker's Pen | pay D2 |
| Numbers Runner | 25 coins, Birth Certificate | pay D4 |
| Basement Lease | 20 coins, Climbing Rope + Service Pass | pay D6 |
| The Heir | 100 coins, Glass Floor (cursed) | win once |
| Daily | fixed: Standard + 1 House Rule of the day | — |

### 11.3 House Rules ("Overdrawn" levels, cumulative)

1 Debts +10 % · 2 Start pocket 30→20 · 3 Charm prices +25 % · 4 Heat thresholds −10 · 5 Interest cap 20 % → 10 % · 6 Phone deal costs +50 % · 7 −1 charm slot · 8 Collector patrols from D2 · 9 −1 clock hour per shift · 10 Base RTP −2 % on all floors.

### 11.4 Achievements (30)

| id | Name | Condition |
|---|---|---|
| A01 | Night Shift | Pay D1 |
| A02 | Going Up | Reach F5 |
| A03 | Halfway House | Reach F3 |
| A04 | Daylight | Win a Debt Run |
| A05 | Overdrawn | Win at House Rules 5 |
| A06 | Owned | Win at House Rules 10 |
| A07 | JACKPIT | Hit a JACKPIT on The Big One |
| A08 | Down the Cellar | Score a Cellar pattern |
| A09 | Early Bird | Punch out with ≥ 4 clock hours unused |
| A10 | Compound | Earn 20 % interest in one shift |
| A11 | Basement Dweller | Pay D6 having played only F7/F6 machines (and the Cage) in that shift |
| A12 | Grand Tour | Play all 4 machines of every unlocked floor in one shift (≥ F3 unlocked) |
| A13 | Number Cruncher | 10 Your Number triggers in one shift |
| A14 | Six Chambers | Stand after 5 pulls at the Cylinder |
| A15 | The Deed | Win the Deed at the Big Draw |
| A16 | Counting Sheep | Win a blackjack hand at true count ≥ +5 |
| A17 | Royal Debt | Royal flush at video poker |
| A18 | Rat Race | Win a derby Forecast |
| A19 | Snapped | Cash out the Cable at ≥ 50× |
| A20 | Sweep | Clear a 3-mine Minefield entirely |
| A21 | Steady Hands | Stacker Major prize |
| A22 | Caught You | Accuse the Shell Automaton correctly 3 times in one shift |
| A23 | Full Ring | 8 charms equipped |
| A24 | Cursed Fortune | Win a run holding 3 cursed charms |
| A25 | Fall Guy | Be voted the Fall Guy and get bailed out |
| A26 | Last One Standing | Win a Versus match |
| A27 | Full Table | Pay D8 in co-op with 8 players alive |
| A28 | Hang Up | Ignore 10 calls in one run and still win |
| A29 | Renovated | Reach E12 |
| A30 | Every Machine | Play all 32 machines across your lifetime |

### 11.5 Seeds and Daily Run

- Seed format: `JP-XXXX-XXXX` (Crockford base32, 40 bits). Seeds feed independent RNG streams derived by hashing `seed + streamName`: `rng.machine.<id>`, `rng.shop`, `rng.phone`, `rng.horror`, `rng.mods`, `rng.numbers`. Same seed → same Curio offers, Mechanic offers and phone schedule per shift regardless of how the player bets; machine outcomes depend on play order.
- Daily Run: seed = hash(UTC date `YYYY-MM-DD`); Standard contract; one House Rule of the day (from 1–6). First attempt is ranked; retries are unranked practice. Score = deadlines paid, tiebreak = total unused clock hours, then total interest earned. Local leaderboard always; optional POST to the lobby server `/daily` (name + score + seed + run hash).

---

## 12. Risks, mitigations, and why this pitch is the most fun

### 12.1 Risks

| Risk | Mitigation |
|---|---|
| Scope: 32 machines + 8 floors | Floors are the milestone plan: vertical slice = Cage + F7 (5 machines) + F6 (4). Each later floor ships as a self-contained 4-machine package in `src/machines/<id>/`, auto-registered; an unfinished machine's slot falls back to a prop. |
| Walking feels like dead time | Walking costs 0 clock minutes; stair tower 4.5 s per floor; Service Pass lift; Hot Tip/Party Line give walking a purpose; floors are only 24 m wide. |
| Balance complexity (charms × machines × floors) | All numbers in data tables (`src/game/data/`); per-machine Monte-Carlo sims (10⁶ plays) for RTP; a headless run simulator with scripted bot strategies checks pass rates against table 2.3 and the 160 % synergy ceiling. |
| Heat feels punitive | Generous thresholds (30/45), visible tube, two counters (Cold Compress, Heat Sink), and Regular's Stool for one-machine players. |
| Multi-floor rendering cost | Floor groups culled to current ±1, ≤ 25k tris per floor, baked vertex lighting, PSX low resolution. |
| Co-op contention for The Big One | Second Big One cabinet in the Cage at ≥ 5 players; shared draws; table seats; 4 + N/2 Curio offers. |
| Real-time co-op clock vs turn-based SP clock confuses players | Wristwatch always shows your timecard; wall clock = shift; tutorial call P01 explains in co-op. |
| Horror vs gambling tone clash | Dread is ledger-driven and readable; Free Casino caps dread at 0.2; photosensitivity mode. |
| Too similar to the inspiration | Different spine (vertical physical progression, floor limits, generosity gradient, Heat, Your Number, mods, Cage, Cylinder, Fall Guy). All names/symbols/text original; review checklist before content lock. |

### 12.2 Why "The Descent" is the most fun pitch

1. **Progress you can stand on.** Every debt paid is a new room with 4 new machines and a new system, revealed by a grinding elevator ride. Players remember "the night we reached the Wheel House", not "level 5".
2. **Every floor stays relevant.** The generosity gradient makes the lowest floors the best edge and the highest floors the biggest stakes, so routing up and down the shaft *is* the strategy — and charms like Old Haunt and Altimeter flip that logic in opposite directions.
3. **Builds span the whole casino.** Your Number, family-hooked charms and machine mods make a roulette wheel on F3 matter to a keno board on F6. Ten distinct named builds exist on day one.
4. **It is the best multiplayer pit.** Shared debt with personal timecards, a Debt Terminal you must run up to before the real-time wall clock hits 06:00, Party Line votes, the Fall Guy, ghosts bailing back in — vertical space creates chases, splits and reunions that a single-room casino cannot.
5. **The fall is the story.** Losing replays your climb floor by floor in its own colours; winning is a revolving door and grey daylight. Both endings are physical, and both make you want to pull the lever again.

---

### Appendix — data files this pitch implies

`src/game/data/floors.ts` (3.2, 8.4) · `debts.ts` (2.3) · `machines.ts` (3.4 roster metadata: tags, slot class, clockMin, RTP target, Draw Number source) · `numbers.ts` (B values per machine per number) · `charms.ts` (4.2) · `mods.ts` (3.10) · `phone.ts` (5.2) · `omens.ts` (3.9) · `houseRules.ts` (11.3) · `achievements.ts` (11.4) · `slots.ts` (8.3) · i18n keys `charm.<id>.name|desc`, `phone.<id>.offer|opt1|opt2`, `floor.<id>.name`, `house.line.<n>`.
