# JACKPIT — GDD Pitch "THE CLOCK"

Role: Game Director (Opus) · Pitch id: `clock` · Status: proposal · Date: 2026-10-13
Conforms to `docs/BRIEF.md` (fixed decisions are elaborated here, never changed). Original IP: no names,
text, symbols or characters from any existing game.

---

## 0. Glossary

| Term | Meaning |
|---|---|
| Night | One deadline. Starts at **Dusk 00:00**, ends at **Dawn** (06:00 on early nights, earlier later). |
| Budget | Game-minutes between Dusk and Dawn. Spent only by plays and a few events; walking, shopping, deposits and phone calls are free. |
| Time cost | Game-minutes a machine charges per play. Shown on its paper tag. |
| Watch | One third of a night. Watches are separated by **Bells** at 02:00 and 04:00. |
| Pocket | Coins you carry. Deposited coins leave the pocket for good. |
| Debt / Deposit | Tonight's amount owed / coins already put into the Debt Terminal. |
| Vig | Interest added to the unpaid remainder at each Bell. |
| Savings | Coins deposited beyond the debt; they carry to the next night with interest. |
| Stub | Secondary currency: paper ticket stubs (shop rerolls, phone deals, cashing). |
| Grip | Per-machine 0–100 gauge; a machine tightens (lower RTP) the more it is played. |
| Hot / Cold | One machine per watch at +10 pp RTP / one at −10 pp RTP. |
| Dread | Pit-wide 0–100 horror meter that drives events and the Collector's Visitation. |
| Luck | Player stat; L% chance that a losing outcome is rerolled once. |
| M | Night bet scale (table limits multiply by M). |
| pp | Percentage points of RTP (return-to-player). |

---

## 1. Pitch & pillars

**Pitch.** You wake on the sunken floor of JACKPIT, a casino seven storeys under the city, facing a
2.4 m wall clock that reads 00:00. You owe the House. At dawn the Collector rides the elevator down
(a tall figure in a charcoal coat, with a brass station clock where his face should be) and reads the
Debt Terminal. If the ledger is short, the floor opens. Every pull, hand, roll and scratch moves the
clock's hands: the coin flip costs half a minute, the Big One costs four, the Lottery Chapel's draws
run on bell time, and an elevator ride costs a minute per floor you dare to climb. The 32 machines
differ in **time cost, variance and EV**. Charms bend both odds and time. So every decision comes
down to one question: *is this worth the minutes?* The pit gets darker toward dawn. Lights flicker at
the bells, faceless Patrons sit at the cold machines, and the elevator indicator counts down. When
Dread peaks, the Collector walks the floor early and you hide between cabinets. You can play it solo,
pool a debt with up to 7 friends over P2P, or knock rivals through the floor in Last One Standing.

**Pillars**

1. **Every coin has a price in minutes.** The clock is the one readable resource. Each system either
   costs time, refunds time, or converts time to and from coins and Stubs. *Test:* each machine,
   charm and phone deal has a number that answers "what does it cost or save on the clock?".
2. **The night is a horror story with a deadline.** Escalation is tied to the clock (bells, witching
   hour, last call, dawn) and to Dread. The dramatic arc is the same shape every night and gets
   sharper each time. *Test:* a screenshot taken at 05:40 looks clearly different from one at 00:20.
3. **A casino you walk through.** The FPS layer matters. Hot machines shimmer gold, Patrons sit at
   Cold ones, the phone rings across the room, Grip pushes you to roam, and the Visitation is a
   stealth beat. *Test:* a player who stays in one chair does measurably worse than one who explores.

---

## 2. Core loop & run structure

### 2.1 Loops

| Scale | Real time | What the player does |
|---|---|---|
| Second-to-second | 2–10 s | In play pose: set bet (wheel), commit (Space or lever), watch the clock hand ratchet by the time cost, watch the reels, cards or balls resolve, take the payout juice. |
| Minute-to-minute | 30–120 s | Stand up (E). Read tags (time, bet range, Grip gauge, variance pips). Look for the gold shimmer (Hot) or a seated Patron (Cold). Walk to the next machine. Answer the phone if it rings (15 s window). Deposit when Vig is about to bite. |
| Watch | ~4 real min | Shop restocks, a Bell rings (Vig, Stubs, phone), Hot and Cold machines re-roll, horror tier steps up. |
| Night | 10–14 real min | Pay the debt before Dawn. Optionally ring the Night Bell early to turn leftover minutes into Stubs. Dawn: the Collector's verdict. |
| Run | 80–110 real min (8 nights) | Build a charm bracelet, adapt machine routes to the build, survive 8 deadlines, ride the elevator up. Then Endless. |
| Meta | across runs | Ledger pages (achievements) unlock charms, Coats (starting kits), Clock Faces (difficulty I–XII), cosmetics. |

### 2.2 Clock rules (authoritative)

1. Internal time is float minutes with 0.1 resolution. The wall clock shows HH:MM with a ratcheting
   minute hand and a smooth second hand that is purely cosmetic.
2. A play **charges its time cost at commit** (the moment the bet is locked). The hand ratchets over
   0.6 s with one tick sound per minute (max 12 audible ticks).
3. **Free actions:** walking, shopping, pawning, deposits, phone calls, reading tags, chat, pause.
   The clock never moves in real time in single-player (see §7 for multiplayer drift).
4. **Last-play rule:** a play may be committed while `clock < dawn`. It resolves fully even if it
   overshoots. No plays after dawn. The Elevator (crash) auto-cashes out when the clock reaches dawn.
5. **Bells** fire at 02:00 and 04:00 (more with the *Grandfather's Heart* charm). If a play crosses a
   Bell, Bell effects fire after that play resolves, in clock order.
6. **Witching Hour** runs 03:00–04:00: all machines +5 pp RTP, Dread gain ×2, red grade and thicker fog.
7. **Last Call** is 30 min before dawn. **Final Draw** (lotto) is 10 min before dawn. **Dawn** is the verdict.
8. **Night Bell (early dawn):** once the debt is fully paid, hold E for 2 s on the Terminal's brass
   bell to skip to dawn. Each full 30 unused minutes gives 1 Stub (cap 4/night).
9. Minimum time cost per play after all modifiers is 0.25 min. Exception: effects that set a play
   to exactly 0 ("free"), which are capped at 20 per night (see §3.7).

### 2.3 Night timeline (Night 1 shown; dawn shifts per §2.4)

| Clock | Event | Systems |
|---|---|---|
| 23:59→00:00 | Dusk: 12 chimes compressed into 3 s; zone lights snap on in sequence, 0.15 s apart | New debt posted, Charm Window restock, Dread reset, Hot/Cold roll, Grip reset to 0 |
| 00:00 | Night 1 only: scripted *Wake-Up Call* (H01) | Free Common charm (choice of 3) |
| 00:00–02:00 | **Watch 1** ("Lounge hour") | Jukebox lounge at 110 BPM, warm light |
| 02:00 | **Bell 1** (2 chimes) | Vig on unpaid remainder, restock, +1 Stub, Hot/Cold re-roll, guaranteed phone check |
| 02:00–04:00 | **Watch 2** | Patrons begin to appear (Dread ≥ 25) |
| 03:00–04:00 | **Witching Hour** | +5 pp all machines, Dread ×2, red grade |
| 04:00 | **Bell 2** (4 chimes) | Vig, restock, +1 Stub, Hot/Cold re-roll; elevator indicator lights "B1" |
| 04:00–dawn | **Watch 3** | Indicator steps B1→B7 evenly toward dawn; footsteps overhead |
| dawn −30 | **Last Call** | Phone H15, lights to 60%, Patrons stand |
| dawn −10 | **Final Draw** | Lotto and Tombola draw; music stops; ticking 1/s |
| dawn | **Verdict** | Machines power down (0.8 s whine), elevator ding, Collector walks to the Terminal |

### 2.4 Debt schedule

| Night | Debt (coins) | Dawn | Budget (min) | Watches | Typical plays | Vig per Bell | Bet scale M | Charm price × |
|---|---|---|---|---|---|---|---|---|
| 1 | 100 | 06:00 | 360 | 3 | 80–100 | 0% | ×1 | ×1.00 |
| 2 | 225 | 06:00 | 360 | 3 | 80–100 | 4% | ×2 | ×1.35 |
| 3 | 450 | 05:45 | 345 | 3 | 75–95 | 5% | ×3 | ×1.82 |
| 4 | 800 | 05:30 | 330 | 3 | 70–90 | 6% | ×5 | ×2.46 |
| 5 | 1,350 | 05:15 | 315 | 3 | 70–85 | 8% | ×8 | ×3.32 |
| 6 | 2,300 | 05:00 | 300 | 3 | 65–80 | 10% | ×13 | ×4.48 |
| 7 | 3,900 | 05:00 | 300 | 3 | 65–80 | 12% | ×21 | ×6.05 |
| 8 (final) | 7,200 | 05:00 | 300 | 3 | 65–80 | 15% | ×34 | ×8.17 |

Fiction: "The House sets the clocks forward." From Night 3 the sun comes earlier. Watch 3 gets
shorter, while Bells stay at 02:00 and 04:00.

**Endless (night n ≥ 9):**
- `Debt(n) = ceil50(7200 × 1.65^(n−8))` → N9 11,900, N10 19,650, N11 32,350, N12 53,400.
- `Budget(n) = max(240, 300 − 10·(n−8))` min.
- `Vig(n) = min(25%, 15% + 1%·(n−8))`.
- `M(n) = M(n−1) + M(n−2)` (Fibonacci: 55, 89, 144, 233 …).
- `PriceMult(n) = 1.35^(n−1)`.
- Each endless night adds one cumulative **House Rule**, drawn without repeats from: Grip gain ×1.5 ·
  Phone rings ×2 · Hot bonus halved · Cold machines ×2 · Witching Hour lasts 2 h · Coffee banned ·
  Charm Window shows −1 item · Vig also at 01:00/05:00 · Visitation at Dread 80 · Luck halved.

**Vig and Savings rules**
- At each Vig Bell: `debt += round(max(0, debt − deposited) × vig)`.
- At dawn, if `deposited > debt`, the surplus S carries over as credit: next night's debt −=
  `round(S × (1 + vig_tonight))`. The House pays the same rate it charges, once.
- Deposits are irrevocable. The Terminal accepts 10% / 25% / 50% / remaining / all-pocket /
  exact (typed with the wheel).

### 2.5 Start state & carry-over

- **Start:** 60 coins, 1 Stub, 6 charm slots ("bracelet links"), Luck 0, Dread 0, Coat
  perks (§11), Night 1 Wake-Up Call charm.
- **Carries across nights:** pocket, savings credit, Stubs, charms, Luck, lotto progressive pool,
  lifetime counters (for charms such as Stopped Pocketwatch).
- **Resets at dusk:** Grip (all 0), Hot/Cold, coin-pusher shelf (fresh layout plus one bubble charm),
  consumable limits (Coffee 2/night), Dread → `min(40, 10 × (n−1))`.

### 2.6 Win / fail

- **Fail:** at dawn `deposited + insurance effects < debt` → trapdoor. Single-player: run over.
- **Win:** Night 8 paid at dawn → the **Elevator Ending** (20 s cinematic, skippable): the Collector
  steps aside, the doors stay open, you ride B7→G, the doors open on a PSX sunrise (#FFB27A sky,
  dithered). The ledger reads **PAID IN FULL**. Option: **GO BACK DOWN** (Endless, same build, Night
  9) or **LEAVE** (results).
- **Endless score:** `nights survived × 1000 + floor(log10(peak pocket) × 250)`.

### 2.7 Trapdoor sequence

1. Verdict: the Collector's clock-face hands sweep to the **shortfall %** (12 o'clock = 100% short).
   He shuts the ledger (low thud) and raises a gloved hand toward the Mark.
2. Input locks for 2.5 s. The camera is pulled over 1.2 s (ease-in-out) onto **the Mark**, a
   3×3 m brass-seamed square in the Terminal Alcove ("your legs walk you there").
3. The two 1.5×3 m leaves drop open in 0.4 s. Fall lasts 2.8 s: wind noise, your coins and loose
   ledger paper falling with you, and the clock tick slowing to a stop. The screen fades to black
   on a single bell.
4. Single-player: **Basement Ledger** results (§9.6). Versus: you reappear as a ghost on your Mark
   after 3 s. Co-op: see Scapegoat rule (§7.2).

---

## 3. Economy

### 3.1 Currencies

| Currency | Symbol | Earned | Spent | Notes |
|---|---|---|---|---|
| **Coins** | ◎ | Machine payouts, phone deals, Bell charms | Bets, charms, Coffee, deposits, phone deals | Integer. HUD shows `123.4K` above 99,999. |
| **Stubs** | ✂ | 1 per Bell, Night Bell leftovers (1 per 30 min), claw and tombola prizes, money-wheel Bell segment, charms | Shop reroll (1/2/3 escalating per watch), phone deals, Cashier (1 Stub → 6×M coins), Price Fixing | Never purchasable with coins. Cap 99. |

Time is a **resource, not a currency**. It cannot be stored. Coins and Stubs can buy or sell it only
at fixed, visible rates:

| Exchange | Rate |
|---|---|
| Black Coffee (Lounge machine) | +20 min for 8% of tonight's debt (ceil5), max 2/night, +3 Dread |
| Time Broker phone (buy) | +30 min for 12% of debt |
| Time Broker phone (sell) | 10% of debt for −30 min |
| Night Bell | 30 unused min → 1 Stub |
| Scratch "TIME" panels | +10 / +20 / +30 min |
| Devil's Table loss / Visitation | −60 / −30 min |

The implied exchange rate is **about 0.4% of tonight's debt per minute**. The Ledger shows it so
players can do the maths.

### 3.2 Outcome modifier stack (exact order)

1. **Time cost:** `base × Π(multiplicative charm mods) − Σ(flat mods)`, floor 0.25 (except "free").
2. **RTP pp:** `R_eff = R_base + Hot(+10) + Cold(−10) + Witching(+5) − Grip penalty + Σ charm pp`.
   Charm pp total is capped at +60 pp.
3. A pp modifier is applied as a **payout scale** on wins: `win × R_eff / R_base`. This works the same
   for every machine, and `R_base` comes from the machine data table (sim-verified).
4. **Luck reroll:** if the play resolves as a net loss, with probability `Luck%` (cap 25) the final
   random draw that caused the loss is rerolled once (the busting card, the snapping floor, the
   losing reel stop). The reroll is final and comes from the same seeded stream.
5. **Payout multipliers** (×2 Cuckoo, ×1.5 Beloved, ×3 Hungry Purse) multiply last.
6. **Cap:** a single play pays at most 2,000× its bet.

**Grip:** +4 per play, +2 extra if the bet is ≥ 75% of max. −1 per game-minute that passes while
this machine is not being played. Penalty `0.1 pp × max(0, Grip − 30)` (max −7 pp). The gauge on
every cabinet has 5 bands: 0–30 LOOSE #3CFF6B · 31–55 #B6F03C · 56–75 #FFB000 · 76–90 #FF6A00 ·
91–100 TIGHT #FF2A2A.

**Hot / Cold:** rolled at dusk and at each Bell, never the same machine twice in a row. Fortune
teller is excluded. Hot tell: the marquee bulbs chase gold #FFD700 for 2 s every 20 real s, with a
warm 220 Hz hum within 4 m. Cold tell: frost overlay on the glass within 3 m, breath vapour within
1.5 m, and a Patron sits at it when Dread ≥ 25 and you are ≥ 10 m away.

### 3.3 Machine roster (32) — time / EV / variance bands

Bet columns are multiplied by M. Variance: **L** (SD < 1.5× bet) · **M** (1.5–4×) · **H** (4–10×) ·
**X** (> 10×). Slot codes refer to §8 (machines are swappable between slots of the same type).

| Slot | id | Name | Time / play (min) | Bet ×M | Base RTP | Var | Role & key rule |
|---|---|---|---|---|---|---|---|
| H1 | `big_one` | The Big One | 4 | 1–10 | 110% | H | Hero 5×3 pattern slot, main charm engine (§3.4) |
| S1 | `bandit` | One-Armed Bandit | 1 | 1–5 | 97% | M | 3 reels, physical lever (drag mouse down 0.25 m); cheap-time filler |
| S2 | `pachislot` | Skill-Stop Pachislot | 2 | 1–6 | 92% (random) → 108% (perfect) | M | 3 stop buttons; 120 ms "eye" window per reel at 60 fps |
| S3 | `video_poker` | Video Poker "Jacks Up" | 2 | 1–5 | 99.5% optimal | M | 9/6 table: RF 250 (800 at 5 coins), SF 50, 4K 25, FH 9, FL 6, ST 4, 3K 3, 2P 2, JJ+ 1 |
| S4 | `scratch` | Scratch-Card Vendor | 1 | 2 / 5 / 10 | 85% coins + time panels | H | 1 card in 8 shows a TIME panel (+10/+20/+30 min) |
| S5 | `mines` | Mines | 1 start + 0.5 per reveal | 1–10 | 97% | M–X | 5×5 grid, choose 1–20 mines, `mult = 0.97 × C(25,r)/C(25−m,r)` |
| S6 | `hilo` | Hi-Lo Ladder | 1 per guess | 1–10 | 98% | M | Single deck, reshuffle at 26; ladder pays `0.98/p` |
| S7 | `coin_flip` | Coin-Flip Booth | 0.5 | 1–25 | 97.5% | L | Pays 1.95×; 1 in 600 lands on edge → 100× |
| S8–S10 | (duplicates) | 2nd Bandit / 2nd Video Poker / 2nd Pachislot | as above | | | | Reduce contention in multiplayer; in SP they share Grip with the original |
| T1 | `roulette` | European Roulette | 3 | 1–20 | 97.3% | L–X | Single zero; up to 6 seats; 15 real s betting window in MP |
| T2 | `blackjack` | Blackjack | 3 (+1 per split hand) | 2–20 | 99.5% basic, ~101% counted | L | 6 decks, S17, 3:2, DAS, cut card at 75% |
| T3 | `holdem` | Hold'em Table | 6 per hand | buy-in 20–200 | skill (5% rake, cap 3×M) | H | 3 bot personalities; humans join in MP |
| T4 | `baccarat` | Baccarat | 3 | 2–25 | 98.9% (Banker) | L | Punto Banco, 5% commission, Tie 8:1 |
| T5 | `craps` | Craps | 1 per roll (~3.4 per pass decision) | 2–20 | 98.6% line, 100% odds | L–H | Pass/Don't/Come/Odds 3-4-5×/Field/Hardways; physical dice |
| T6 | `sicbo` | Sic Bo Cage | 3 | 1–15 | 97.2% (Big/Small) | L–X | Brass cage, 3 dice; triples 180:1 |
| T7 | `dragon_tiger` | Dragon & Tiger (War) | 1 | 1–20 | 96.3% | L | One card each; tie = half loss |
| T8 | `dice_tower` | Dice Tower | 2 | 1–15 | 97.2% | L–X | 3 dice tumble through a 1.6 m tower; sum ranges and triples |
| W1 | `money_wheel` | Big Six Wheel | 3 | 1–15 | 89–92% | M–H | 54 segments: 1×24, 2×15, 5×7, 10×4, 20×2, **Bell** ×1 (40:1 + 1 Stub), **Midnight** ×1 (40:1 + refunds 15 min) |
| A1 | `pachinko` | Pachinko | 3 per tray of 10 balls | 1 per ball | 95% | M | Physics balls, tulip gates, "Fever" centre (8 free balls) |
| A2 | `plinko` | Plinko Board | 2 | 1–10 | 98% | L / M / X | Risk selector: 9, 12 or 16 rows |
| A3 | `coin_pusher` | Coin Pusher | 2 per drop of 5 coins | 5 flat | 85–125% (state) | M | Persistent shelf (~400 coins at dusk), visible overhang; a bubble charm on the shelf |
| A4 | `claw` | Claw Crane | 3 | 5 flat | 80–130% (skill) | H | Prizes: coin bags 10–60×M, Stub tokens, mystery egg (4% Uncommon+ charm) |
| A5 | `cyclone` | Cyclone Ring | 1 | 2 flat | 90–110% (timing) | H | 60-light ring at 12 lights/s; jackpot light 50×, neighbours 5× |
| A6 | `stacker` | Stacker | 2 | 3 flat | 85–115% (skill) | H | 11 rows × 7; minor 5× at row 8 (take or continue), major 60× at row 11 |
| A7 | `elevator` | The Elevator (crash) | **1 per floor ridden** | 1–20 | 97% | X | `P(reach m) = 0.97/m`; floors step ×1.1; cash out any time; greed costs minutes |
| L1 | `keno` | Keno | 4 | 1–10 | 92% | H | Pick 1–10 of 80, 20 drawn |
| L2 | `bingo` | Bingo Pews | 8 per game | 2–10 per card | 94% | H | 75-ball, 1–4 cards vs 7 virtual players |
| L3 | `lotto` | Lotto Blower | 1 per ticket | 2 flat | 60% + progressive | X | Pick 5 of 30; draws at 02:00, 04:00, dawn −10; match 3: 10×, 4: 200×, 5: pool (seed 500×M, +1% of all coins lost pit-wide); 20 tickets/draw cap |
| L4 | `tombola` | Tombola Drum | 1 per ticket | 3 flat | ~90% (prize value) | H | Draws at Bells and dawn −10: 1st Uncommon+ charm, 2nd +30 min, 3rd 2 Stubs, 4th–6th 15×M; 40 virtual tickets + yours |
| L5 | `derby` | Tin Derby | 6 | 1–20 | 93% | M–H | 6 wind-up tin horses, 8 m glass track, odds 2:1–15:1, race 12 real s |
| D1 | `devils_table` | The Devil's Table | 5 | stake 10–100% of pocket (min 10×M) | 97% | X | Once per watch. See below. |
| D2 | `fortune_teller` | Madame Minuit | 10 | 5 flat | info | — | Draw 3 face-down Omens, keep 1 (see below) |
| D3 | `shell_game` | Shell Automaton | 2 | 1–15 | 66.5% guessing → ~100% expert | L | 3 cups, pays 2.1×, 12 swaps (2 under a cloth), 5% palmed |

**Devil's Table (tasteful by design).** A brass automaton holds an antique six-chamber cap pistol
aimed at a mirror. Your reflection sits in the mirror. You choose k = 1–5 loaded chambers and a stake.
Hold LMB for 1 s to pull. *Click*: you win `stake × 0.97 × 6/(6−k)` (k=1 1.16×, k=3 1.94×,
k=5 5.82×). *Bang*: the mirror crazes white, the screen goes white for 0.5 s then black for 2 s,
and "you lose an hour": clock +60 min, stake lost, Dread +10. The mirror is whole again a moment
later. No blood, no self-aim.

**Madame Minuit's Omens** (each lasts until dawn):

| Omen | Effect |
|---|---|
| Lantern | Hot machine visible from anywhere (gold column) |
| Rope | Next losing play is refunded |
| Tower | Next win ≥ 10× pays ×3; next loss ≥ 5× bet costs double |
| Hourglass | +30 min |
| Mask | Dread −30 |
| Wheel | Roulette, Big Six, Cyclone +5 pp |
| Crown | Big One Crown weight ×2 for 10 spins |
| Ledger | Tonight's debt −5% |
| Moth | Luck +5 |
| Key | Next charm purchase free (≤ Rare) |
| Moon | Blackouts ×2, +8 pp on all plays made in darkness |
| Debtor | Draw 3 → keep 2, but debt +10% |

### 3.4 The Big One (hero) rules

- 5 columns × 3 rows. Each cell rolls independently from the weighted strip.

| Symbol | Weight | Value |
|---|---|---|
| Moon | 22% | 1 |
| Key | 22% | 1 |
| Candle | 17% | 1.5 |
| Moth | 17% | 1.5 |
| Eye | 10% | 2.5 |
| Crown | 8% | 4 |
| **Midnight** (clock face at 12) | 4% | 6 |

- **Patterns** (cell `(col,row)`, row 0 = top):

| Pattern | Cells | Multiplier |
|---|---|---|
| Row-3 / Row-4 / Row-5 | adjacent in one row | ×1 / ×2 / ×4 |
| Pillar | full column | ×1.5 |
| Slant | 3 diagonal adjacent, either direction | ×1.5 |
| Wings | (0,0)(1,1)(2,2)(3,1)(4,0) | ×5 |
| Gallows | (0,2)(1,1)(2,0)(3,1)(4,2) | ×5 |
| Twelve O'Clock | middle column + middle row, 7 cells | ×8 |
| Frame | 12 border cells | ×12 |
| **Midnight Full House** | all 15 cells the same symbol | ×40 + Jackpot sequence |

- **Containment:** a pattern fully contained in a larger paying pattern of the same symbol does not
  also pay.
- **Payout** = `bet × symbolValue × patternMult ÷ HD`. HD is the House Divisor (single tuning knob,
  solved by `npm run sim` for 110% base RTP; expected 2–3). Targets: hit frequency ~32%,
  SD ~3.5× bet.
- **Midnight time refund:** each Midnight landed refunds 0.5 min of that spin. 3+ Midnights =
  **Stopped Time** (spin fully refunded, the clock hand visibly un-ratchets). 5+ Midnights also give
  +1 Stub.
- **Near-miss tease** (cosmetic only, odds unchanged): when 4/5 of a Row-5 or 11/12 of a Frame is
  showing, the last column spins 0.4 s longer with a rising tone.

### 3.5 Machine roles (how each fits)

| Band | Machines | Use |
|---|---|---|
| **Grinders** (low variance, 96–100% base, cheap time) | coin_flip, dragon_tiger, baccarat, blackjack, video_poker | Make small deposits safely; carry card or table builds |
| **Engines** (charm-scalable) | big_one, bandit, pachislot, pachinko, plinko | Where builds go exponential |
| **Skill** (RTP scales with execution, capped by Grip) | pachislot, stacker, cyclone, claw, shell_game, hilo, blackjack (count) | Reward mastery without breaking the economy |
| **Spikes** (X variance) | elevator, devils_table, lotto, keno, mines (high m), sicbo triples | Hail-Marys at 05:30 |
| **Utility** (pay in time, Stubs, charms or info) | scratch (time), money_wheel (Stubs, time), tombola (charm, time, Stubs), claw (charm), coin_pusher (bubble charm), fortune_teller (omens) | Convert coins into non-coin advantages |
| **Social** | holdem, craps, roulette, bingo, derby | Multiplayer gathering points |

The Ledger tracks **coins per game-minute** per machine, so players learn true value. Example:
blackjack at 10 coins and 99.5% is −0.017 ◎/min, while a Hot Big One at 10 coins is +0.5 ◎/min.

### 3.6 Charm Window, Cashier, Lounge

- **Charm Window** (zone Z7): 4 lit cubbies plus 1 **under-the-counter** hatch. Restocks at dusk and
  at each Bell.
  - Standard rarity weights: N1–2 C60/U30/R9/L1 · N3–5 C45/U35/R16/L4 · N6+ C35/U35/R22/L8.
  - Under-the-counter weights: U40/R35/L5/Cursed 20.
  - Reroll costs 1 / 2 / 3 Stubs (escalating within a watch).
  - 1 free **Lock** that persists through restocks.
  - Price = `base × PriceMult(n)`, rounded to 5.
- **Pawn** (Cashier window): sell a charm for 40% of **the price you paid** (never current price).
  Cursed charms cannot be pawned unless noted.
- **Cashier:** 1 Stub → 6×M coins (one-way). Shows lifetime ledger and run stats.
- **Lounge:** Black Coffee machine (§3.1), jukebox, couch (night transition "sleep").

### 3.7 Anti-degenerate-strategy rules

1. **Grip** stops "one machine all night". A machine played at max bet sits at Grip ~100 (−7 pp) after
   ~17 consecutive plays. Rotation is mandatory for skill machines.
2. **Table limits scale by M per night.** Martingale chains hit the max bet within 3–4 doublings.
3. **Free-play cap:** at most 20 zero-minute plays per night; after that "free" plays cost 0.5 min.
4. **Ticket caps:** lotto 20 per draw, tombola 15 per draw, scratch 30 per night.
5. **Devil's Table** once per watch. **Bent Minute Hand** once per night, never before a Bell
   already rung and never after dawn −30.
6. **Pawn value** is based on the price paid, so buy-low-sell-high across nights is impossible.
7. **Skill caps:** skill machines max out at about 115% base RTP before charms. The shell game uses
   blind swaps under a cloth so tracking can never exceed p≈0.5 without the Glass Eye.
8. **Coin pusher:** shove detection; any camera bump > 0.3 m/s inside its AABB triggers TILT (10 min,
   shelf −10%).
9. **Determinism:** every machine draws from its own stream `rng(seed, machineId, playIndex)`.
   Suspend-save only (save & quit at any moment, deleted on load), so nothing can be save-scummed.
10. **Co-op funnelling:** human-vs-human hold'em pots in co-op are taxed 10%; coin tosses are free
    but logged.
11. **Payout cap** 2,000× bet per play; charm pp capped at +60.
12. **Free Casino** counts toward no achievements or unlocks except social ones.

### 3.8 Tuning targets (for `npm run sim`, headless)

Baseline bot: basic strategy, bets 1/8 of pocket clamped to table limits, greedy charm buyer,
rotates on Grip ≥ 60.

| Night | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Baseline survival (conditional) | 92% | 86% | 78% | 68% | 60% | 55% | 52% | 50% |

Full-run win rate is about 5–10% for new players and 35–50% for experts. Nights last 10–14 real
min (average play ~4 game-min and ~7 real s, plus walking and shopping).

---

## 4. Charms

**Rules.** Bracelet with 6 links (7 with *Extra Link*, +1 more with a meta unlock). Rarity: C Common ·
U Uncommon · R Rare · L Legendary · X Cursed (red glow, cannot be pawned) · T Team (co-op only).
Prices are Night-1 base and scale by `PriceMult(n)`. Pool: **S** = in the starting pool,
**U** = unlocked via Ledger (§11). Effects stack unless stated.

### 4.1 Time charms

| # | id | Name | R | ◎ | Pool | Effect (exact) | Hooks |
|---|---|---|---|---|---|---|---|
| 1 | `lead_pendulum` | Lead Pendulum | U | 45 | S | All play time costs ×0.9 (multiplicative). | Clock |
| 2 | `cracked_hourglass` | Cracked Hourglass | C | 25 | S | +15 min to every night's budget (dawn later). | Clock/dusk |
| 3 | `stopped_watch` | Stopped Pocketwatch | R | 90 | S | Every 8th play (counter on the charm, persists across nights) costs 0 min. | Clock |
| 4 | `brass_alarm` | Brass Alarm Bell | U | 40 | S | Each Bell: +1 Stub and +4×M coins. | Bells, Stubs |
| 5 | `cuckoo_feather` | Cuckoo Feather | R | 75 | S | After each Bell, your next winning play pays ×2. | Bells, payout |
| 6 | `midnight_oil` | Midnight Oil Lamp | U | 45 | S | Plays committed 00:00–01:00 cost ×0.5 time. | Clock window |
| 7 | `sundial_jar` | Sundial in a Jar | U | 50 | S | Plays committed in the final 60 min before dawn: +6 pp. | Clock window |
| 8 | `bent_minute_hand` | Bent Minute Hand | R | 95 | U | Once/night: hold E 1.5 s at the wall clock to rewind 30 min; +15 Dread; not after dawn −30; rung Bells don't repeat. | Clock, Dread |
| 9 | `coffee_tin` | Coffee Tin | C | 20 | S | Plays with base cost ≥ 4 min cost 1 min less. | Long machines |
| 10 | `metronome` | Metronome | C | 30 | S | From the 3rd consecutive play on the same machine: −0.5 min per play. | Clock, Grip |
| 11 | `tin_rooster` | Tin Rooster | U | 55 | U | If ≥ 50% of the debt is deposited before Bell 1: dawn +20 min tonight. | Clock, Debt |
| 12 | `sand_vial` | Vial of Grey Sand | R | 80 | U | Night Bell converts 1 Stub per 20 unused min (instead of 30), cap 6. | Early dawn |
| 13 | `grandfathers_heart` | Grandfather's Heart | L | 260 | U | Bells also ring at 01:00, 03:00 and 05:00 (Stubs, restock, Bell charms). Vig still only at 02:00/04:00. | Bells |

### 4.2 Fortune & economy charms

| # | id | Name | R | ◎ | Pool | Effect | Hooks |
|---|---|---|---|---|---|---|---|
| 14 | `black_cat` | Black Cat Statuette | R | 85 | S | Luck +4. | Luck |
| 15 | `cricket_matchbox` | Cricket in a Matchbox | C | 20 | S | Luck +1; +1 more per 60 game-min since your last win ≥ 5× (max +4). | Luck |
| 16 | `house_key` | Key to the House | L | 240 | U | All machines +3 pp; Cold machines lose their −10 pp for you. | RTP, Cold |
| 17 | `cold_hands` | Cold Hands | U | 40 | S | Your Grip gain −50%. | Grip |
| 18 | `divining_coin` | Divining Coin | U | 45 | S | Hot machine shows a gold beam through walls (2 s every 10 s); Hot bonus +15 pp for you. | Hot |
| 19 | `lucky_receipt` | Lucky Receipt | C | 20 | S | Deposits count 105% toward the debt. | Terminal |
| 20 | `red_ledger_pen` | Red Ledger Pen | R | 90 | S | Vig against you ×0.5; savings interest ×2. | Debt |
| 21 | `porcelain_pig` | Porcelain Pig | U | 40 | S | Each Bell: +4% of pocket (cap 40×M per Bell). | Bells, pocket |
| 22 | `bookies_pencil` | Bookie's Pencil | C | 25 | S | Wins ≥ 10× bet pay +10%. | Payout |
| 23 | `ticket_punch` | Ticket Punch | U | 45 | S | Wins ≥ 10× bet print +1 Stub (max 3 per watch). | Stubs |
| 24 | `pawn_ticket` | Pawn Ticket | C | 15 | S | Charms pawn for 70% of price paid. | Pawn |
| 25 | `bent_coupon` | Bent Coupon | U | 35 | S | First charm purchase each watch −30%. | Shop |
| 26 | `velvet_card` | Velvet Card | R | 100 | U | Charm Window shows 5 cubbies; under-the-counter is Rare+ (Cursed only if you tap twice). | Shop |
| 27 | `extra_link` | Extra Link | R | 110 | S | +2 bracelet links (occupies 1, net +1). | Bracelet |

### 4.3 The Big One charms

| # | id | Name | R | ◎ | Pool | Effect | Hooks |
|---|---|---|---|---|---|---|---|
| 28 | `moon_pin` | Moon Pin | C | 20 | S | Moon value 1 → 2. | big_one |
| 29 | `key_fob` | Brass Key Fob | C | 20 | S | Key value 1 → 2. | big_one |
| 30 | `wax_seal` | Wax Seal | U | 40 | S | Candle and Moth value 1.5 → 2.5. | big_one |
| 31 | `third_eye` | Third Eye | R | 80 | S | Eye weight 10% → 16% (others scaled down proportionally). | big_one |
| 32 | `paper_crown` | Paper Crown | U | 45 | S | Crown value 4 → 6. | big_one |
| 33 | `twelfth_chime` | Twelfth Chime | L | 250 | U | Midnight is wild for all patterns (an all-Midnight pattern pays at value 6). | big_one |
| 34 | `picture_nail` | Picture Nail | U | 50 | S | Frame ×12 → ×20. | big_one |
| 35 | `cross_stitch` | Cross-Stitch Sampler | R | 85 | U | Twelve O'Clock ×8 → ×16; each hit +1 Stub. | big_one, Stubs |
| 36 | `reel_oil` | Reel Oil | C | 25 | S | Big One costs 3 min per spin (instead of 4). | big_one, Clock |
| 37 | `sticky_hold` | Sticky Hold Button | R | 75 | U | After a no-pattern spin, press H to hold one column for the next spin (that spin +1 min). | big_one |
| 38 | `echo_chamber` | Echo Chamber | L | 220 | U | Each paying spin: 20% (+1 pp per Luck) to pay all its patterns again. | big_one, Luck |

### 4.4 Machine charms

| # | id | Name | R | ◎ | Pool | Effect | Hooks |
|---|---|---|---|---|---|---|---|
| 39 | `lever_grease` | Lever Grease | C | 20 | S | Bandit: 1 → 0.5 min; +4 pp. | bandit |
| 40 | `steady_glove` | Steady Glove | U | 45 | S | Pachislot, Stacker, Cyclone: timing windows +40% wider. | skill |
| 41 | `marked_deck` | Marked Deck | R | 90 | S | Blackjack: a notch shows if the dealer hole card is ten-valued. Hi-Lo: next card's band (2–6 / 7–9 / 10–A) shown. Baccarat & Dragon-Tiger: first card of the next coup shown before betting. | card tables |
| 42 | `shoe_counter` | Shoe Counter | U | 50 | U | Blackjack & Hi-Lo show a running count dial; blackjack naturals pay 2:1 when true count ≥ +3. | blackjack, hilo |
| 43 | `loaded_die` | Loaded Die | U | 50 | S | Craps, Sic Bo, Dice Tower: one die per roll lands 6 with p 0.25 (others 0.15). | dice |
| 44 | `wheel_magnet` | Wheel Magnet | R | 85 | U | Roulette, Big Six, Cyclone: if the result is exactly one pocket/segment/light off your largest bet, 30% to slip onto it. | wheels |
| 45 | `bent_nail` | Bent Nail | C | 25 | S | Pachinko & Plinko: before each drop or launch, nudge the ball ±1 peg column once (A/D). | pachinko, plinko |
| 46 | `claw_spring` | Stiff Claw Spring | U | 40 | S | Claw grip 0.55 → 0.85 (chance per 0.5 s of lift that the prize stays). | claw |
| 47 | `pusher_shim` | Pusher Shim | C | 30 | S | Coin pusher stroke +4 cm; each drop spawns +1 bonus coin on the shelf. | coin_pusher |
| 48 | `ticker_tape` | Ticker Tape | U | 45 | S | Keno 21 of 80; Bingo +1 call; Lotto draws 6 (best 5 count); Tombola +1 winning ticket. | lottery |
| 49 | `wind_up_key` | Wind-Up Key | C | 20 | S | Tin Derby: your backed horse +8% speed. | derby |
| 50 | `safety_cable` | Safety Cable | R | 75 | U | Elevator: once per watch, a snap pays 50% × multiplier reached × stake. | elevator |
| 51 | `dowsing_rod` | Dowsing Rod | U | 50 | S | Mines: first reveal each round is safe; rod twitches over cells adjacent to ≥ 2 mines. | mines |
| 52 | `glass_eye` | Glass Eye | U | 45 | U | Shell: one blind swap removed, the palm cheat flickers for 1 frame (press C to call it: refund + 1× bet). Madame Minuit: choose from 4 omens. | shell_game, fortune_teller |
| 53 | `thumbnail_file` | Thumbnail File | C | 15 | S | Scratch cards cost 0 min (free-play cap applies); 1 panel pre-revealed. | scratch |
| 54 | `green_visor` | Green Visor | R | 80 | U | Video Poker: Full House 9 → 12, Flush 6 → 8. Hold'em: bots fold to your river raises +15%. | video_poker, holdem |
| 55 | `dealers_tip_jar` | Dealer's Tip Jar | C | 25 | S | Table games: each winning decision +1×M coin. | tables |
| 56 | `bad_penny` | Bad Penny | U | 35 | S | Coin flip pays 2.0×; after 3 straight losses the 4th flip wins. | coin_flip |

### 4.5 Dread charms

| # | id | Name | R | ◎ | Pool | Effect | Hooks |
|---|---|---|---|---|---|---|---|
| 57 | `night_light` | Night-Light | C | 20 | S | Dread gain −25%. | Dread |
| 58 | `votive_candle` | Votive Candle | U | 45 | S | While Dread ≥ 50: +4 pp all machines. | Dread |
| 59 | `mirror_shard` | Mirror Shard | R | 70 | U | Each horror event (flicker, blackout, Patron sighting, silent call) pays 5×M. | Horror events |
| 60 | `moth_in_amber` | Moth in Amber | U | 40 | U | Machine displays stay lit in blackouts; Luck +2 in darkness; lighter radius 4 → 7 m; Big One Moth value +1. | Blackouts, big_one |
| 61 | `muffled_bell` | Muffled Bell | R | 80 | U | Visitation never triggers: Dread caps at 99, and you gain 1 Stub each time it would. | Visitation |

### 4.6 Cursed charms (red glow; from phone, under-the-counter, Inheritance)

| # | id | Name | ◎ | Effect | Hooks |
|---|---|---|---|---|---|
| 62 | `signed_iou` | Signed IOU | pays +150×M | Tonight's debt +220×M. Locked until dawn, then vanishes. | Debt |
| 63 | `borrowed_time` | Borrowed Time | free | +90 min tonight; next night's budget −120 min. Vanishes at the next dusk. | Clock |
| 64 | `glass_heart` | Glass Heart | pays +20×M | +8 pp all. After 6 consecutive losing plays it shatters: −25% pocket, charm destroyed. | RTP |
| 65 | `jealous_doll` | Jealous Doll | free | The first machine played each night is **Beloved** (payout ×1.5); all others ×0.8. | Payout, Grip |
| 66 | `hungry_purse` | Hungry Purse | free | Eats 10% of pocket at each Bell and at dawn; wins ≥ 50× bet pay ×3. | Pocket, payout |
| 67 | `cracked_clockface` | Cracked Clock Face | free | Each play's time × random U[0.25, 2.0] (shown at commit); Luck +5. | Clock, Luck |
| 68 | `collectors_coin` | Collector's Coin | free | Tonight's debt −30%; at dawn the Collector takes your most expensive other charm. | Debt |
| 69 | `witching_ring` | Witching Ring | free | Witching Hour runs 02:00–05:00; Dread gain ×2 all night; blackouts last 2× longer. Can be pawned for 0 after 1 night. | Clock, Dread |

### 4.7 Team charms (co-op pool only; affect all players)

| # | id | Name | R | ◎ | Effect |
|---|---|---|---|---|---|
| 70 | `chain_letter` | Chain Letter | U | 50 | When any player wins ≥ 20×, everyone else gets +3 pp for 10 game-min. |
| 71 | `party_line` | Party Line | U | 40 | Hotline can be answered from any machine's speaker; calls offer +1 extra option. |
| 72 | `seance_kit` | Séance Kit | R | 90 | Ghost teammates +2 Haunt charges; revive cost 30% → 15% of next debt. |
| 73 | `hand_warmer` | Hand Warmer | C | 25 | Grip decays 2× faster pit-wide. |

### 4.8 Named synergies (designed on purpose)

| Build | Core charms | Why it works |
|---|---|---|
| **Bell Ringer** | Grandfather's Heart + Brass Alarm + Cuckoo Feather + Porcelain Pig | 5 Bells/night → +5 Stubs, 5 ×2 plays, 5 × 4% pocket interest |
| **Midnight Engine** | Twelfth Chime + Reel Oil + Picture Nail + Cross-Stitch + Echo Chamber | Wild Midnights make Frames and Crosses common. Midnight refunds cut time; Echo doubles hits. |
| **Night Owl** | Midnight Oil + Sundial + Cracked Hourglass + Tin Rooster | Cheap first hour, strong last hour, longer night |
| **Card Sharp** | Marked Deck + Shoe Counter + Dealer's Tip Jar + Cold Hands | Pushes 4 table games past 100%; rotate them to dodge Grip |
| **Dread Eater** | Votive Candle + Mirror Shard + Moth in Amber + Witching Ring (X) | Profit from horror; add Muffled Bell for safety |
| **Stub Mill** | Ticket Punch + Sand Vial + Velvet Card + Cross-Stitch | Reroll-heavy shop control and early Night Bells |
| **Time Thief** | Stopped Watch + Bent Minute Hand + Lead Pendulum + Borrowed Time (X) | Over 600 effective minutes in one night |
| **Arcade Rat** | Steady Glove + Claw Spring + Pusher Shim + Metronome (+ Hand Warmer in co-op) | Skill machines become charm and time engines |
| **Lucky Streak** | Black Cat + Cricket + Cracked Clock Face (X) + Echo Chamber | Luck 10+ feeds Echo's chance and rerolls losses |
| **Gambler's Ruin** | Glass Heart (X) + Jealous Doll (X) + Hungry Purse (X) + Safety Cable | Elevator-only all-in: +8 pp, ×1.5 Beloved, ×3 on 50×+ |

---

## 5. Hotline phone

**Rules.**
- Booth HB1 in the Terminal Alcove. HB2 is active in Versus or with ≥ 5 players.
- At most 1 random call per watch: 60% chance, fired at a random minute inside the watch. Scripted
  calls come on top.
- Rings for 15 real s with a two-tone ring cadence (2 s on, 4 s off). The booth lamp flashes #FF2020.
  A HUD edge arrow points to it.
- E answers within 1.5 m. Text types out at 30 chars/s, with a synthesized formant voice (the
  **Night Manager**).
- Choices on the rotary dial: **1** accept · **2** decline · **3** special. 20 real s to choose;
  timeout = decline.
- Calls cost 0 game-minutes. A missed call adds +5 Dread.
- Random-call weights are listed below; scripted calls ignore weights.

| id | Name | Trigger | Offer | Consequence |
|---|---|---|---|---|
| H01 | Wake-Up Call | Night 1 00:00 (scripted) | Choose 1 of 3 Common charms; 4-line tutorial | None |
| H02 | Hot Tip | Random w3 | 1 Stub → names this watch's Hot and Cold machines | Decline: nothing |
| H03 | Loan Shark | Bell 1 if pocket + deposited < 35% of debt | Receive 40% of debt now | Next night's debt + 1.5× the loan. Decline: +5 Dread |
| H04 | Time Broker (Buy) | Random w2 | +30 min for 12% of debt | — |
| H05 | Time Broker (Sell) | Random w2 | Receive 10% of debt | Clock +30 min at once (Bells crossed fire) |
| H06 | Double or Nothing | Once/night after a win ≥ 25× | Bet that win on the House's coin: dial 1 heads, 2 tails, 3 hang up | 50% double, 50% lose it |
| H07 | Extension | Dawn −60 if paid < 60% (once per run) | Dawn +60 min tonight | Next night's debt +30% |
| H08 | Insurance | Random w1, Night ≥ 3, 01:00–02:00 | Pay 10% of debt | If short at dawn by ≤ 25%: survive; shortfall ×1.5 carried to the next debt |
| H09 | Charm Courier | Random w2 | A random Rare (10% Legendary) at 1.5× price, left on the booth shelf | — |
| H10 | Curse Delivery | Random w2, Night ≥ 2 | Take a random Cursed charm + 2 Stubs | — |
| H11 | Wrong Number | Random w2 | No offer: a past debtor's story (8 stories) | Stay on 25–40 s → +1 Stub, +3 Dread |
| H12 | The Collector Calls | Bell 2, Night ≥ 4, paid < 40% | Deposit 10% of debt within 10 game-min | Fail: **Marked**, all your plays −5 pp until dawn |
| H13 | Maintenance | Random w2 | 2 Stubs → look at a machine and press E within 30 s | That machine: Grip 0 and +6 pp until dawn |
| H14 | Phone Quiz | Random w1 | A question about your night ("How many Bandit pulls tonight?"), answer 0–9 (9 = 9+) | Right: +1 Stub, +5×M. Wrong: +3 Dread |
| H15 | Last Call | Dawn −30, Night ≥ 2 (scripted) | One Big One spin at max bet, 0 min, House-funded | +20 Dread |
| H16 | Inheritance | 5% per night | A dead debtor's Uncommon charm, free | **Haunted:** +2 Dread per Bell; pawns for 0 |
| H17 | Bargain Bin | Random w2 | Charm Window −25% for the rest of this watch | You cannot play H1 or S-slot machines for 20 game-min |
| H18 | Silent Call | Dread ≥ 50, random w2 | Only breathing for 8 s | 20 real s blackout. Secret: up to 3 plays during it cost 0 min |
| H19 | Overtime | Debt fully paid before Bell 2 (scripted) | Ring the Night Bell now | Next night's budget +30 min and +1 Stub (on top of leftover Stubs) |
| H20 | Price Fixing | Random w1 | 1 Stub → every current Charm Window item is locked until the next Bell | — |
| H21 | Reverse Charges | Random w2 | Next 5 plays: losses refunded 50% | Each of those plays +1 min |
| H22 | Operator's Gift | On Midnight Full House (scripted) | Choose: +1 bracelet link (run) / +60 min tonight / 3 Stubs | — |
| H23 | Séance | Co-op/Versus: a ghost spends 1 Haunt charge | The ghost talks to the answerer for 15 s (text or voice) | Ghost may give a tip or lie |
| H24 | Prank Call | Versus, player-initiated at a booth: dial rival seat 1–8, costs 1 Stub | The rival's booth rings for them only | Answer within 10 s → **Static** (their next 3 plays +1 min). Ignore → +8 Dread to them |
| H25 | The Elevator Operator | Night 7, 03:00 (scripted) | Lore; 2 Stubs → names Night 8's Hot machines for Watches 1–2 | — |
| H26 | Junk Mail | Random w2, Nights 1–3 | A free Telephone Scratcher (3 panels, 1-in-4 TIME panel) on the shelf | — |
| H27 | Bad Connection | Dread ≥ 75, random w1 | The voice repeats your last 3 actions back to you | Hang up (E) within 3 s or lose 10 min |

**Night Manager sample lines** (original, polite hospitality-horror; i18n keys `phone.*`):
- "Good evening. Your table is ready. So is your balance."
- "We noticed you favour the Bandit. It noticed you, too."
- "The clocks down here are very accurate. We set them ourselves."
- "No need to hurry. Dawn always arrives on time."
- "A guest once asked for more time. We gave him all of it."

---

## 6. Horror & atmosphere

### 6.1 Dread system

- **Range:** 0–100, pit-wide (shared in co-op; per-player in Versus).
- **Gains:** +1 per 6 game-min × `(1 + 0.1(n−1))` · win ≥ 20×: +3 · Jackpot: +5 · missed call: +5 ·
  Devil's Table loss: +10 · Bent Minute Hand: +15 · Last Call accepted: +20 · Coffee: +3.
- **Reductions:** deposit ≥ 25% of debt in one go: −10 ("the House is pleased") · debt fully paid
  at a Bell: −20 · Mask omen: −30.

| Tier | Dread | Flicker /game-h | Blackout /game-h (5–12 real s) | Patrons | Other |
|---|---|---|---|---|---|
| Calm | 0–24 | 0 | 0 | 0 | Warm, lively |
| Uneasy | 25–49 | 2 | 0 | 2 | PA murmurs; clock tick audible at 40% |
| Haunted | 50–74 | 4 | 1 | 5 | Glitch text on displays ("OWE", your name); Silent Calls possible |
| Watched | 75–99 | 6 | 2 | 8 | Collector silhouette in the elevator window; footsteps overhead; 5% of losses also cost +2 min ("time slips") |
| **Visitation** | 100 | — | — | all stand | See 6.3; then Dread → 50 (max 2 per night) |

### 6.2 Clock-driven beats (every night)

| Clock | Beat |
|---|---|
| 00:00 | Lights snap on zone by zone; Night Manager greeting over the PA; jukebox lounge track (FM synth, 110 BPM) |
| 01:00 | Single soft chime; music −5% tempo |
| 02:00 | Bell: a light sweep runs out and back across the pit (1.2 s); one Patron appears in the fog |
| 03:00 | Witching Hour: 3 chimes in minor; grade desaturates 20% and multiplies by red #2A0006; fog far plane 28 → 18 m; jukebox plays reversed; second hand ticks backwards |
| 04:00 | Bell: the elevator indicator lights B1; distant footsteps above the ceiling |
| dawn −30 | Last Call: lights to 60%; Patrons stand and turn toward the Terminal |
| dawn −10 | All music stops; only ticking, 1 per real second, getting louder |
| dawn | Elevator ding (C6 bell tone, 1.4 s); the Collector steps out, walks 7 s to the Terminal; verdict |

### 6.3 The Collector & the Visitation

- **Look:** 2.3 m tall, charcoal coat #1B1B22, grey gloves, ledger under one arm. His head is a
  brass-rimmed station clock (0.6 m, cream face #EFE6C8, black hands) whose hands always point to
  your remaining debt %. He animates at 12 fps (stop-motion stiffness), never runs and never speaks.
  Each step is a clock tick.
- **Visitation (Dread 100):** lights drop to 10%. He leaves the elevator and patrols 4 random zones
  for 60 real s at 1.4 m/s.
  - Vision cone 50°, range 9 m, blocked by cabinets. Crouching halves the range. Sitting at a
    machine in play pose counts as fully visible.
  - Seen for 1.5 continuous s: white-out, clock-hand whirr, −30 game-min, −10% pocket.
  - Never seen: +2 Stubs ("He didn't see you"). The lighter (F) doubles the range at which he can
    see you.
- **Patrons:** faceless mannequin guests in 1970s suits (~120 tris). They sit only at machines
  ≥ 10 m away and always prefer the Cold machine. They vanish when you get within 6 m or look at
  them for > 2 s.

### 6.4 Night-to-night escalation

| Night | Environment change |
|---|---|
| 1–2 | Clean pit; at most 1 blackout |
| 3 | Water stains spread on the ceiling textures (texgen pass) |
| 4 | The Collector Calls (H12) is possible; footsteps begin at Bell 1 |
| 5 | Wall wallpaper pattern slowly resolves into coin-shaped eyes (0.5 px/s dither crawl) |
| 6 | The Mark's seams glow faint amber all night; the elevator indicator flickers between floors |
| 7 | The Well chandelier sways ±4°; scripted Elevator Operator call |
| 8 | Wall clock shows 13 numerals; vertex jitter on walls ×1.5 ("breathing"); the jukebox plays only the ticking |
| Endless | House Rules stack; the clock face gains a numeral each night |

**Audio palette (all WebAudio):** tick (3 kHz filtered noise click), bells (2-op FM), drone (detuned
saws at 55 Hz), PA voice (formant synth + 8 kHz bitcrush), ring (standard two-tone cadence), coin
(pitched square blips with random ±3 semitones).

**Content rules:** no gore, no blood, no self-harm imagery. Horror comes from light, sound, staging
and time loss. A **Photosensitive** setting caps flicker at 3 Hz and turns blackouts into 40% dims.

---

## 7. Modes

### 7.1 Debt Run (single-player)

Everything above. No network. Suspend-save at any time. Seeded.

### 7.2 Co-op Debt Run (2–8 players, shared debt)

| Aspect | Rule |
|---|---|
| Debt | `D_coop = ceil5(D_n × (0.9·N + 0.1))`; N = living players at dusk |
| Clock | One shared wall clock, same displayed budget. Each play advances it by `cost / N`, so the team shares a pool of `N × Budget` player-minutes. Wristwatch shows *your share used* vs fair share. |
| Hog rule | Personal minutes above `1.25 × Budget` in a night cost ×1.5 time |
| Pockets | Personal. **G** (hold, scroll amount, release) throws a coin pouch up to 6 m; anyone picks it up in 0.5 s |
| Deposits | Anyone deposits; the Terminal shows per-player contribution bars |
| Charms | Personal bracelets. Shared Charm Window stock = `min(8, 3 + N)` cubbies + under-the-counter, each item buyable once. Any player can reroll with their own Stubs. Team charms only appear in co-op. |
| Phone | HB1 (+HB2 at N ≥ 5). Offers marked **[TEAM]** affect everyone. The answerer decides, or dials **3 Hold** to start a 10 s team vote (majority; ties decline). |
| Machines | Single-seat machines lock while occupied (a red RESERVED bulb). Tables seat 4–6; seated bettors each pay `cost / N`. Grip is per machine, so crowding one tightens it. |
| Dread / Visitation | Shared. Each player seen loses `30/N` pooled min and 10% pocket |
| Dawn fail | **Scapegoat rule:** if N ≥ 3 and shortfall ≤ 20% of debt, a 15 s vote runs (volunteers first, then most votes, ties → lowest contribution). The chosen player drops, the shortfall is forgiven, and they become a **Helper Ghost**. Otherwise the whole team falls → run over. |
| Helper Ghost | 3 charges/night: **Cool Down** (−30 Grip on a machine), **Peek** (show the next card or ball of a machine to all for 10 s), **Lantern** (mark Hot for 30 s), **Séance** call. |
| Revive | Séance Candle at the Charm zone: 30% of next debt (15% with Séance Kit), dusk only; returns with 0 coins and keeps charms |
| Join / leave | Join in progress at dusk (spectate until then). On disconnect, 50% of pocket auto-deposits and the rest is held for 5 min for reconnect. |
| Authority | Host owns the clock, RNG and ledger; clients send `playRequest`, host replies with the outcome |

### 7.3 Versus "Last One Standing" (2–8)

| Aspect | Rule |
|---|---|
| Debt | Personal, `D_n × 0.85` |
| Clock | Personal wristwatch budgets. The wall clock shows **House time** = the slowest living player's watch |
| Idle drift | After the first 60 real s of a night, a watch advances +1 min per 10 real s while its player is not in a play (no turtling) |
| Dawn sync | When the first living player hits dawn, others get a **120 real s Last Call**, then their watches jump to dawn. Early finishers can still deposit, shop, chat and prank-call. |
| Verdict | Each player has a 1.4×1.4 m Mark on an arc around the Terminal (§8). The Collector judges in ascending % paid, so the closest calls come last. Fails drop one by one. |
| Coin toss | Disabled (no collusion). Charm Window shared and snipeable. |
| Ghosts | Spectate in freecam (noclip 6 m/s) or follow-cam (keys 1–8). Ghost chat is ghost-only (plus Séance). 3 Haunt charges/night: **Flicker** (a machine's display goes dark for 20 real s), **Chill** (+20 Grip), **False Ring** (a fake call to one player). **Curse Vote** at each Bell: ghosts pick 1 of 3 for all living players for the next watch: Short Fuse (+10% time costs) · Closed Window (shop shut) · Dim (lights −50%, fog 12 m) · Static (calls ×2) · Tight (Grip gain ×2). |
| Win | Last one standing. If everyone left fails on the same dawn, the highest % paid wins. If 2+ clear Night 8: highest pocket + savings. Host option: **Sudden Death from Night 4** (debts ×1.5). |
| Scoreboard (Tab) | Name · pocket · % paid · charms · status (alive/ghost) · ping |

### 7.4 Free Casino (1–8, sandbox)

- No debt and no Collector (host toggle "Roaming Collector" for fun). The clock cycles ambiently at
  1 game-min per 2 real s and still triggers Bells (restock, Hot/Cold).
- Start coins 1,000 (host: 100–100,000). Free refill to 200 when below 50, at most once per 10 real
  min. Every charm is purchasable.
- Host toggles: horror on/off, Dread lock, Grip on/off, Hot/Cold on/off, M fixed 1–34.
- Social: emotes 1–4 (wave, cheer, point, shrug) when not seated; shared jukebox queue; coin toss;
  coin leaderboard. Only social achievements count.

---

## 8. Level layout — "The Pit"

**Coordinates:** origin = centre of the Well at gallery-floor height. +X east, +Z south, Y up;
north = −Z, toward the clock. Interior X[−26, 26] × Z[−22, 28] = 52 × 50 m. Gallery floor
Y = 0; Well floor Y = −1.2. Collision is AABB per prop; a 0.4 m player radius and 1.8 m height
(1.1 m crouched).

```
 Z            X: -26          -7      0      7          26
-22  +---------------+---------------------+---------------+
     | Z7 CHARM WIN. | Z1 ALCOVE  ELV CLOCK HB| Z8 LOUNGE   |
-14  +---------------+      TERMINAL  MARK  +---------------+
     | Z3 TABLE HALL |      (Approach)      | Z2 SLOT GAL.  |
     |  T1..T8       +----------------------+  S1..S10, W1  |
     |               |  Z0 THE WELL (-1.2)  |               |
     |               |   H1 The Big One     |               |
 14  +---------------+----------------------+---------------+
     | Z5 DEVIL'S    | Z6 LOTTERY CHAPEL    | Z4 ARCADE NOOK|
 28  +---------------+----------------------+---------------+
```

### 8.1 Zones

| Zone | Bounds (X; Z) | Size (m) | Floor / ceiling | Slots & props | Lighting mood (hex, intensity) | Fog (near–far, colour) |
|---|---|---|---|---|---|---|
| **Z0 The Well** | X[−8,8]; Z[−8,8], 2 m Ring walkway around it to ±10 | 16×16 (+Ring) | −1.2 (4 steps, 0.3 rise × 0.4 run) / dome 9 m | **H1** The Big One at (0, −1.2, 2.4) facing −Z, 2.4 w × 1.6 d × 3.8 h. 8 spawn discs. | Chandelier ring r 3 m at Y 6.5, 24 bulbs #FFB347 ×1.2; floor bounce #3A1E0C | 6–28 m, #120A08 |
| **Z1 Terminal Alcove** | X[−7,7]; Z[−22,−10] | 14×12 | 0 / 5 m | Terminal 1.0×0.7×1.9 at (0,0,−21.4) facing +Z. **Wall clock** Ø 2.4 m centre (0, 3.7, −21.95). Elevator doors 2.0×2.6 at (−4.6,0,−22), floor indicator (−4.6,2.9,−21.95). **HB1** (5.2,0,−21.2), **HB2** (5.2,0,−19.0), each 1.1×1.1×2.4. **The Mark** 3×3 at (0,0,−16.0). **Versus Marks** 8 tiles 1.4×1.4 on the arc `(4.5 sinθ, −21.4 + 4.5 cosθ)`, θ = −63°…+63° in 18° steps. North approach 4 m wide from the Well's north steps. | Sodium over the clock #FF9A3C ×1.0; Terminal CRT spill #39FF88 ×0.6; at dawn the key light becomes pale #9FC4FF | 8–30 m, #0B0710 |
| **Z2 Slot Gallery** | X[10,26]; Z[−14,14] | 16×28 | 0 / 4 m | **S1–S5** wall row x = 25.2 at z = −10, −5, 0, 5, 10 facing −X. **S6–S10** island x = 17.5, same z, facing +X (aisle 6.8 m). Cabinet 1.0×0.9×2.1 + stool. **W1** money wheel Ø 2.4 on the north wall (18, 2.4, −13.9) facing +Z, counter at (18,0,−12.2). | Neon magenta #FF3FA4 and cyan #3FE0FF strips ×0.8; marquee chases | 5–24 m, #10061A |
| **Z3 Table Hall** | X[−26,−10]; Z[−14,14] | 16×28 | 0 / 4.5 m | **T1–T8** centres x ∈ {−15, −21.5}, z ∈ {−10, −3.5, 3.5, 10}; footprint ≤ 3.2×2.0, 1.2 m seat clearance | Green-shaded pool lamps #F2E3B3 ×1.1 at Y 2.6 over felt #0E5B34; periphery near-black | 4–22 m, #050A07 |
| **Z4 Arcade Nook** | X[10,26]; Z[14,28] | 16×14 | 0 / 4 m | **A1–A4** south wall z = 26.8 at x = 12.5, 16.5, 20.5, 24.5 facing −Z. **A5–A7** island z = 19.5 at x = 13.5, 18, 22.5 facing +Z. Footprint ≤ 1.8×1.6×2.4. | Saturated primaries #FF2D2D / #FFD400 / #2D7BFF, blinking ×0.9 | 5–22 m, #0A0A14 |
| **Z5 Devil's Parlour** | X[−26,−10]; Z[14,28] | 16×14 | 0 / 3.2 m (low) | Beaded curtain at (−10, 0, 21), 2 m wide. **D1** Devil's Table (−20,0,24.5) 2×2. **D2** Madame Minuit (−24.6,0,17.5) 1.6×1.2×2.4. **D3** Shell Automaton (−14.5,0,17.5) 1.8×1.2. | Single bulb deep red #B0121B ×0.7, cigarette haze particles | 2–12 m, #1A0204 |
| **Z6 Lottery Chapel** | X[−9,9]; Z[14,28] | 18×14 | 0 / 6.5 m vaulted | **L1** Keno board 6×2.5 m on the south wall (0, 3.5, 27.9) + stations at z 24.5, x = −3, −1, 1, 3. **L2** Bingo: pews at z = 16.5, 18, 19.5, 21 on both sides of a 2 m aisle; caller pulpit (0,0,22.8). **L3** Lotto blower (−6.5,0,25.5), Ø 1.4 acrylic. **L4** Tombola (6.5,0,25.5). **L5** Tin Derby glass case 8×1.4 along x = −8.3, z 15–23, bet window (−7,0,19). | Candle-warm #FFCF7A ×0.8; "stained glass" of lottery-ball colours | 6–26 m, #0E0805 |
| **Z7 Charm & Cashier** | X[−26,−7]; Z[−22,−14] | 19×8 | 0 / 3.5 m | **Charm Window** 3 m hatch with 5 cubbies at (−12,0,−21.7). **Cashier/Pawn** (−18,0,−21.7). Séance Candle stand (−22,0,−20) (co-op). | Brass #E8C46A ×0.9, cubbies backlit #FFF2C0 | 4–20 m, #0D0A04 |
| **Z8 Lounge** | X[7,26]; Z[−22,−14] | 19×8 | 0 / 3.5 m | Jukebox (24.5,0,−21.6). Couch 2.4 m (16,0,−21.0), the night-transition sleep point. **Black Coffee machine** (9.5,0,−21.6). | Dim blue #3A4A7A ×0.5, jukebox glow #FF8A3D | 4–18 m, #06081A |

**Slot types (swap contract):** H (hero 2.4×1.6) · S (cabinet ≤ 1.0×0.9) · T (table ≤ 3.2×2.0) ·
A (arcade ≤ 1.8×1.6) · L (lottery, custom anchors) · D (parlour ≤ 2×2) · W (wall-mounted Ø ≤ 2.4).
`src/world/layout.ts` exports `slots: {id, type, pos, yaw}`, and machines declare
`slotType` + `preferredSlot`. Any S machine fits any S slot.

### 8.2 Spawn points (Well floor, Y = −1.2, all yaw 0 = facing north at the clock)

| Spawn | (x, z) | Notes |
|---|---|---|
| SP / P1 (host) | (0.0, 0.0) | Burst-out point, 1.6 m in front of the Big One's glass |
| P2 | (−2.4, −1.2) | |
| P3 | (2.4, −1.2) | |
| P4 | (−4.8, −2.4) | |
| P5 | (4.8, −2.4) | |
| P6 | (−4.8, 1.8) | |
| P7 | (4.8, 1.8) | |
| P8 | (0.0, −3.6) | Minimum spacing 2.4 m |

- Ghosts spawn on their Mark at +0.5 m.
- The Collector's path: elevator (−4.6, −21.5) → (−1.5, −20.0) → stands at (0, −20.4) facing +Z.
- Visitation patrol nodes: one per zone centre plus the Ring corners.

---

## 9. Menu & intro flow

### 9.1 Boot

1. A memory-card-check style splash: "JACKPIT — READING LEDGER..." (1.5 s, Press Start 2P,
   dithered).
2. Title: **PRESS ANY KEY**. The key press also unlocks WebAudio.
3. Menu.

### 9.2 Main menu — inside the jackpot

- The camera sits inside the Big One's cabinet, 0.6 m behind the glass. Three giant reel strips
  (drum radius 1.6 m) curve around the camera. The **centre reel** carries the menu entries as lit
  symbol panels.
- Through the glass you see the dark pit, rendered low-detail and fogged. The wall clock reads
  **23:59** with a live second hand that loops back to :00 at :59 ("it is always one minute to
  midnight").
- Centre reel entries: **DEBT RUN · CO-OP · VERSUS · FREE CASINO · SERVER BROWSER · CONTINUE**
  (if a suspend save exists) **· DAILY · LEDGER** (stats/achievements/almanac) **· SETTINGS ·
  CREDITS**.
- **Input:** W/S or mouse wheel steps the reel (0.18 s ease, mechanical clack); Enter or LMB
  selects; Esc goes back.
- The payline is a red neon bar (#FF2A2A) at eye height across the glass. The **left reel** shows
  context (mode description, Coat picker, Clock Face I–XII, seed field). The **right reel** shows
  values (settings).

### 9.3 Play → jackpot → burst out (timings)

| t (s) | Beat |
|---|---|
| 0.0 | Player confirms the setup on the left reel. The camera turns 35° right to the interior **lever**; LMB-drag down 0.3 m (or press Space). |
| 0.4 | All three reels spin (blur strips, rising whine) |
| 2.0 / 2.25 / 2.5 | Reels stop one by one on **MIDNIGHT · MIDNIGHT · MIDNIGHT** |
| 2.5–3.3 | JACKPOT: gold flash #FFD24A, siren, coins rain inside the cabinet |
| 3.3 | Outside, the wall clock strikes 00:00 (first chime); the glass cracks (crack overlay, 0.3 s) |
| 3.6 | Glass shatters (64 tri shards); the camera flies out on a 1.2 s bezier to the spawn point |
| 4.8 | Lands with a 0.4 s head-bob dip; the remaining chimes compress into 2 s; control is given |

The sequence can be skipped (hold Space 0.5 s) after it has been seen once. In MP every player
bursts out together and flies to their own spawn.

### 9.4 Server browser (on the inside of the glass, flip-dot departure-board style)

- **Columns:** 🔒 · ROOM · HOST · MODE · PLAYERS (n/max) · PING · STATE (LOBBY / NIGHT n).
- **Filters:** mode, hide full, hide locked, hide started.
- **Transport tabs:** **LOBBY** (WS server; auto-refresh every 5 s) · **SAME BROWSER**
  (BroadcastChannel) · **GLOBAL** (Trystero).
- **Buttons:** JOIN · HOST · DIRECT CODE (6-char room code) · REFRESH.
- **Host panel:** room name (24 chars), mode, max players 2–8, password, Clock Face, seed,
  public/private, Free Casino options.
- **Lobby:** each player's name appears in a reel window with a ready bulb. Chat on T. The host's
  START lights once everyone is ready (or forced after 30 s).

### 9.5 Pause (Esc)

- **SP:** the game freezes. Overlay is a matchbook that opens. Options: RESUME · SETTINGS ·
  RUN LEDGER (charms, debts, clock pie) · SUSPEND & QUIT · ABANDON RUN (confirm by holding 1 s).
- **MP:** no freeze; translucent overlay. Adds INVITE CODE and, for the host only,
  KICK / BAN / END NIGHT VOTE.

### 9.6 Results / death — "The Basement Ledger"

- After the fall, a typewritten ledger page appears under one bulb. It shows: nights survived ·
  cause ("SHORT 132◎ AT DAWN, NIGHT 5") · biggest win · jackpots · coins wagered · Stubs earned ·
  charms held (icons) · **The Night on a Clock Face**, a pie chart drawn as a clock dial where each
  machine's share of game-minutes is a coloured wedge · best coins-per-minute machine · seed.
- **Buttons:** NEW RUN (same Coat) · MENU · COPY SEED.
- **Win variant:** "PAID IN FULL" in green ink + GO BACK DOWN (Endless).

### 9.7 Settings (right reel)

| Group | Options |
|---|---|
| Video | Internal res 320×180 / **400×225** / 640×360 · vertex jitter 0–2 · affine on/off · dither on/off · CRT on/off · fog distance 75–150% · FOV 60–100 (default 75) · brightness · native-res HUD text |
| Audio | Master / music / SFX / voice · subtitles |
| Controls | Sensitivity, invert Y, rebind all, head-bob on/off, hold-vs-toggle crouch |
| Gameplay | Language EN / TR · Diegetic-only HUD · show Dread meter · Photosensitive mode · skip intro · time-cost confirmation for plays ≥ 10 min |
| Network | Display name, lobby URL, preferred transport |

### 9.8 Stats (Ledger → Lifetime)

- Runs, wins, best night, total nights, deaths per night (histogram), coins wagered/won, biggest
  single win, jackpots, Visitations survived, calls answered.
- Lifetime clock pie (minutes per machine) and Almanac completion (charms 0/73, omens 0/12, Wrong
  Number stories 0/8).

---

## 10. HUD & feedback

### 10.1 On screen (virtual 400×225; VT323 16 px; Press Start 2P 8 px for numbers)

| Position | Element |
|---|---|
| Top-left (6,6) | Clock `03:41` + dawn countdown `−2:19`. When time is spent, a red "−4" floats up and fades over 0.8 s. |
| Top-centre | Debt bar `OWED 450 · PAID 210 · VIG 5% @ 04:00`. The bar fills #39FF88 and flashes at 100%. |
| Top-right | `◎ 1,234` and `✂ 3` |
| Centre | 1 px dot crosshair; interaction prompt below it, e.g. `[E] THE BIG ONE · 4 MIN · 1–10◎ · ●●●` |
| Bottom-left | Bracelet: 6–8 icons of 12×12 px with charge counters (e.g. Stopped Watch 5/8) |
| Right edge | Toasts (max 3, 3 s each): "BELL 02:00 · +1 ✂", "HOT: CRAPS" (if known); phone arrow when ringing |
| Low-health analogue | Screen-edge vignette strength = Dread/100 × 0.35 (always on; the numeric meter is optional) |

The **Diegetic-only** setting hides all but the prompt and crosshair. In that mode, **Q** raises the
left wrist so you can read the wristwatch (time, dawn countdown, co-op share).

### 10.2 Diegetic displays

- **Wall clock:** a red debt-ring arc around the rim fills with % paid.
- **Terminal CRT:** owed/paid/next-Vig countdown plus a per-player bar chart in co-op.
- **Machine paper tags:** time cost, bet range × M, variance pips ●–●●●●, Grip gauge needle.
- **Elevator indicator:** B1→B7 during Watch 3.
- **Keno and lotto boards:** next draw time.
- **Booth lamp.**
- **Charm Window cubby labels:** price, rarity colour (C #C8C8C8 · U #4FD06A · R #4FA3FF ·
  L #FFB000 · X #FF2A2A · T #C77DFF).
- **Viewmodel:** a coin stack in the right hand whose height is `log10(pocket)` (max 9 coins).

### 10.3 Juice table

| Event | Hitstop (frames @60) | Shake (amp m, dur s) | FOV kick | Particles | Light/sound |
|---|---|---|---|---|---|
| Time spent | 0 | 0 | 0 | — | Clock ratchet ticks; sepia edge flash #6B4B2A α 0.15 for 0.25 s (α 0.3 if ≥ 10 min) |
| Small win (1–4.9×) | 0 | 0 | 0 | 3–10 coins into the tray | Cabinet flash 0.2 s, coin ticks at 30 ms |
| Medium (5–19×) | 2 | 0.015, 0.25 | +1° | 12–40 coin spray | Marquee chase 1 s |
| Big (20–99×) | 4 | 0.04, 0.6 | +3° | 60–150 coin fountain | Zone lights flash gold ×3; PA: "Big win at the {machine}" |
| Jackpot (≥ 100× or Full House) | 8 | 0.10, 1.5 decay | +6° | 300 coins showering from the ceiling within r 2.5 m (3 s), ledger-paper confetti | Gold freeze-tint #FFD24A 0.3 s, all pit lights chase, siren 660/880 Hz at 4 Hz, payout counter ramps over 2.5–6 s (exp ease), wall clock hands spin one full turn (cosmetic), +5 Dread |
| Stopped Time | 3 | 0.02, 0.3 | −2° | — | Clock hand runs backwards with a reversed tick sample |
| Bell | 0 | 0.01, 0.4 | 0 | Dust from the ceiling | Chimes; desaturate/resaturate 0.4 s |
| Deposit | 0 | 0 | 0 | Coins pour into the slot | Bar fill; at 100%, a "PAID" stamp thunk |
| Loss streak ≥ 5 | — | — | — | — | Heartbeat at 55 BPM, −20% music |
| Seen by the Collector | 6 | 0.06, 0.8 | −8° | — | White-out, clock-hand whirr |

Viewmodel motion: head-bob 0.035 m at 1.8 Hz walking, 2.6 Hz sprinting. Footsteps vary by floor
(carpet, tile, wood).

---

## 11. Meta progression, achievements, seeds

### 11.1 Unlocks (no meta currency; everything comes from Ledger pages = achievements)

- **Charm pool:** 55 charms start in the pool (the 43 marked **S**, plus all Cursed and Team
  charms). The 18 marked **U** unlock in sets when listed pages are earned. Example: *First Light* → Tin Rooster, Bent Minute Hand;
  *Stopped Time* → Twelfth Chime.
- **Coats** (starting kits, picked on the left reel):

| Coat | Unlock | Kit |
|---|---|---|
| Night Porter | default | 60 ◎, 1 ✂ |
| Insomniac | Survive Night 3 | +30 min on Nights 1–3, 50 ◎ |
| Card Sharp | Win 50 blackjack hands (lifetime) | Shoe Counter, 45 ◎ |
| Tinkerer | Win any claw prize | Steady Glove; arcade machines −0.5 min |
| Widow's Veil | Fall through the floor 5 times | A Cursed charm of your choice + 120 ◎ |
| High Roller | Hit a Midnight Full House | 150 ◎; debts ×1.5; M ×1.5 |

- **Clock Faces I–XII** (difficulty; winning on Face k unlocks k+1):
  - I: dawn −15 min
  - II: Vig +2 pp
  - III: Grip gain ×1.25
  - IV: prices +15%
  - V: Visitation at Dread 85
  - VI: no Witching bonus
  - VII: Hot machine has no tell
  - VIII: Cursed weight ×2
  - IX: start −20 ◎
  - X: debts +10%
  - XI: phone deals 25% worse
  - XII: **Daylight Saving**, every night −60 min
- **Other unlocks:** Endless after the first win · Daily after reaching Night 3 · seventh bracelet
  link after winning on Face III.
- **Cosmetics:** 8 gloves, 6 coin designs, 4 Big One reel skins, 3 menu reel skins.

### 11.2 Achievements (Ledger pages)

| # | Page | Condition |
|---|---|---|
| 1 | First Light | Survive Night 1 |
| 2 | Paid in Full | Win a Debt Run |
| 3 | Early Riser | Clear a debt before Bell 1 |
| 4 | Stopped Time | 3+ Midnights in one Big One spin |
| 5 | Full House at Midnight | Midnight Full House |
| 6 | Not Seen | Survive a Visitation unseen |
| 7 | Night Owl | Ring the Night Bell with ≥ 120 min unused |
| 8 | Cutting It Close | Final deposit with < 5 min to dawn |
| 9 | Purist | Win without ever playing the Big One |
| 10 | Grand Tour | Play 25 different machines in one run |
| 11 | White Knuckles | Play a machine at Grip 100 |
| 12 | Switchboard | Answer 50 calls (lifetime) |
| 13 | Wrong Numbers | Hear all 8 Wrong Number stories |
| 14 | Hex Collector | Hold 3 Cursed charms at once |
| 15 | Top Floor | Cash out the Elevator at ≥ 20× |
| 16 | Mirror, Mirror | Win the Devil's Table with 5 chambers loaded |
| 17 | Twenty-One Tonight | Win 21 blackjack hands in one night |
| 18 | Bubble Pop | Win the coin-pusher bubble charm |
| 19 | Clockwork | Hold 5 Time charms at once |
| 20 | Scapegoat | Be sacrificed in co-op and revived |
| 21 | Last One Standing | Win a Versus match |
| 22 | Poltergeist | As a ghost, pass 3 curses in one match |
| 23 | Dawn Patrol | Reach Endless Night 12 |
| 24 | Twelve Faces | Win on Clock Face XII |
| 25 | Daily Bread | Complete 7 Daily Runs |

### 11.3 Seeds & Daily

- **Seed format:** `JP-XXXX-XXXX` (Crockford base32, 40 bits). It feeds every RNG stream: machines,
  shop, phone, Hot/Cold, Dread events, layout of the pusher shelf.
- **Daily Run:** `seed = hash(UTC date)`, fixed Coat (rotates weekly), Clock Face II. One scored
  attempt per day; replays are unscored. The score posts to the lobby server's `/daily` endpoint
  (name + score + seed checksum) when available, with a local-only fallback.
- **Weekly Long Night:** one 720-min night against a 4,000 ◎ debt with 3 random House Rules.

---

## 12. Risks & why this is the most fun pitch

### 12.1 Risks and mitigations

| Risk | Mitigation |
|---|---|
| Time cost feels like a tax | The clock is juicy (ratchet, refunds, Stopped Time). Time is also a *reward* (scratch TIME panels, wheel Midnight, Tombola, Coffee) and is always visible before committing. |
| Balancing 32 machines × 73 charms | A single data table (`R_base`, time, bet, variance) plus the universal pp payout scale; headless `npm run sim` with survival targets (§3.8); the House Divisor as the hero knob |
| Players never leave one chair | Grip, Hot/Cold rotation, phone across the room, Patron tells, Visitation stealth |
| Co-op griefing via the shared clock | `cost/N` pooling, hog rule (×1.5 time), host kick, team votes |
| Versus stalling or desync | Personal watches, idle drift, 120 s Last Call, host-authoritative clock |
| Horror fatigue or cheapness | Dread tiers start calm, beats are tied to the clock, no jump-scare faces, Photosensitive mode |
| Scope (32 machines) | Vertical slice of 10: big_one, bandit, video_poker, blackjack, roulette, coin_flip, elevator, scratch, coin_pusher, keno. The slot system means the rest drop in without touching core code. |
| Readability at 400×225 | VT323 at 16 px, native-res HUD text option, tags readable at 1.5 m |
| Gambling sensitivity | No real money, no purchases, no ads. The fiction is openly about the trap. Age advisory 16+. |

### 12.2 Why this pitch is the most fun

1. **One number to think in.** "Is this blackjack hand worth 3 minutes?" makes 32 different games
   comparable. Mastery is learning each machine's coins-per-minute, and charms change those numbers
   in visible ways.
2. **A built-in dramatic arc every night.** Calm midnight, then the witching hour, then the
   elevator counting down, then the dawn verdict. Tension rises on a schedule the player can read
   on the wall.
3. **Strong decisions:** deposit early to dodge Vig or keep the bankroll; ride the Elevator one
   more floor (one more minute); buy Coffee; sell an hour to the Time Broker; ring the Night Bell
   early for Stubs.
4. **The FPS layer matters:** spot the gold shimmer, read the Patron, run to the phone, hide from
   the Collector.
5. **Multiplayer with natural drama:** a shared clock is a commons the team must manage. Scapegoat
   votes, ghost curses and prank calls create stories without new rules.
6. **Room for broken builds** (Bell Ringer, Midnight Engine, Time Thief) under clear caps, so
   runs end in fireworks.

---

## Appendix A — Key bindings

| Key | Action |
|---|---|
| Mouse | Look (pointer lock) · LMB/RMB = machine-specific |
| W A S D | Move (walk 3.0 m/s) |
| Shift | Sprint 5.2 m/s |
| C | Crouch: 1.5 m/s, eye height 1.65 → 1.05 m; also calls the shell cheat with the Glass Eye |
| E | Interact / sit (camera glides to the play pose in 0.5 s) / stand |
| Esc | Pause / stand up |
| Space | Spin / deal / drop / pull · hold 0.5 s to skip cinematics |
| Wheel or [ ] | Bet −/+ (Shift = ×10 steps) |
| R | Repeat last bet |
| 1–5 | Card holds (video poker), phone dial, emotes (Free Casino) |
| H | Hold column (Sticky Hold) |
| Q | Raise wristwatch |
| F | Lighter (radius 4 m) |
| G | Toss coin pouch (co-op/Free Casino) |
| Tab | Scoreboard / run ledger |
| T | Chat |
| F1 | Machine rules card |

## Appendix B — Clock & charm hooks for coders (`src/game/`)

```ts
// ClockService (host-authoritative in MP)
spend(playerId: string, minutes: number, source: MachineId | EventId): void
now(): number; dawn(): number; budgetLeft(playerId?: string): number
events: 'clock:advance' | 'clock:bell'(index) | 'clock:witching'(on|off)
      | 'clock:lastcall' | 'clock:finaldraw' | 'clock:dawn'

// Machine contract additions
timeCost(ctx: PlayCtx): number          // base minutes, before charm mods
rBase: number                           // sim-verified RTP for pp scaling
variance: 'L'|'M'|'H'|'X'; slotType: 'H'|'S'|'T'|'A'|'L'|'D'|'W'

// Charm hooks (each optional, pure where possible)
onDusk, onBell(i), onPlayCommit(ctx) -> {timeMul, timeFlat, free},
onPayout(ctx) -> {ppAdd, mul}, onLoss(ctx) -> {luckAdd},
onDeposit(ctx), onDawn(ctx), onDreadEvent(kind), onShopRoll(ctx)
```

All player-facing strings go through i18n keys (`charm.<id>.name/desc`, `phone.<id>.*`,
`machine.<id>.*`, `ui.*`) in `src/i18n/en.ts` and `tr.ts`.
