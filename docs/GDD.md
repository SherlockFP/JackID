# JackID — Game Design Document (definitive v1.0)

Role: Creative Director / Judge. Status: **binding for content** (rules, numbers, ids, layout, flow). Date: 2026-10-13.

**v1.1 integration note (Producer).** This file was reconciled with TECH_SPEC §11, ART_BIBLE §0.1 and both catalogues
v1.1: six slot classes changed (§8.6), the Devil's Table gained the Addendum 7 SHELLS mode, three charm hooks were
renamed to hooks the machines expose, saving / room-code / host-loss / settings rules follow TECH_SPEC, and the final
build plan, machine list and content tiers (Addenda 5–8) are in `docs/PLAN.md`.

**Precedence.** `docs/BRIEF.md` incl. Addenda 1–8 (fixed) > **this GDD** > machine catalogues for machine-internal rules
(`docs/machines/MACHINES_machines.md`, `docs/machines/MACHINES_tables.md`) > `docs/TECH_SPEC.md` for code shape only.
Where this GDD and a catalogue name the same machine, the **catalogue owns** that machine's rules, RTP, paytables, bet slice,
`actionCost`, hooks, milestones (tables) and juice. This GDD owns everything around the machines: the run, quotas, the
economy wrapper, the tycoon layer, charms, the Hotline, buffs, horror, story, cutscenes, music, modes, the level, menus,
HUD and meta progression.

**Name.** The game is **JackID** (logo "JACK·ID"). Any doc that still says "JACKPIT" is outdated; the repo folder `jackpit/`
is only a path. In the fiction a **JackID** is the laminated casino ID card the House clips to every guest: your name,
your photo (a blurred PSX portrait), and the amount you owe. Original IP throughout: no CloverPit names, text, symbols,
characters or art.

---

## Appendix 0 — Judging of the three pitches (placed first, as requested)

All three pitches were written before Addenda 1–4 (tycoon layer, quotas, light horror, play-with-friends infrastructure,
story + cutscenes, buffs, CC0 assets, music) and before the rename. None of them covers those addenda. Each pitch was scored
on its own merits and on how well its structure can absorb the addenda.

### A0.1 Scores (1–10)

| Criterion | FAITHFUL ("Faithful Tension") | CLOCK ("The Clock") | DESCENT ("The Descent") |
|---|---:|---:|---:|
| Fun / moment-to-moment tension | 8 | 8 | 8 |
| Clarity for a new player | 6 | 8 | 7 |
| ~30 machines each staying relevant | 9 | 7 | 6 |
| Multiplayer fit (co-op / versus, 2–8) | 8 | 5 | 6 |
| Implementability by parallel agents in a browser | 8 | 6 | 5 |
| Faithfulness to the brief (CloverPit spirit, PSX horror, start inside a jackpot) | 8 | 7 | 9 |
| **Total (of 60)** | **47** | **41** | **41** |

### A0.2 Reasoning

**FAITHFUL — winner (47).**
- *Tension 8.* The pull budget and the real-time watch clock both apply at once. Route planning across the room (punch card,
  Hot Lamp, Tilt) poses a fresh question every 20 s. The Collateral Clause produces co-op stories.
- *Clarity 6.* This is its weak spot. Suits, five punch-cell tiers, Tilt, two Lamp types, affinity, House Favour, PI, TLM and
  the dampener all arrive on Night 1. Fix grafted from DESCENT: introduce one system per Night (§2.9).
- *Machine relevance 9.* THE CIRCUIT exists for exactly this. The punch card pulls you toward variety, Tilt pushes you off
  the best machine, Lamps act as weather, affinity bends your build, and "fit" sets variance against the quota.
- *Multiplayer 8.* The design is complete: shared deposit with personal pockets, voted withdrawals, Collateral volunteers,
  ghost powers, Versus lockers, and a Free Casino with join-in-progress. Real-time watches suit P2P naturally.
- *Implementability 8.* It uses the catalogue hook names almost verbatim and one level with gated wings, which is the
  TECH_SPEC zone model. Its seconds-based clocks match `RunApi.timeLeft()`, and every system is a data table.
- *Faithfulness 8.* It is the closest to the CloverPit heartbeat: deadlines in rounds, deposit and interest, charms,
  phone bargains, trapdoor. It starts inside The Big One. Two marks off: its meta layer ("no meta currency, no stat
  bonuses") contradicts Addendum 1's prestige tree, and it has no tycoon hooks.

**CLOCK (41).**
- *Tension 8.* Each Night has a strong arc: Dusk, Bells, Witching Hour, Last Call, Dawn verdict. The Visitation stealth
  beat is the best horror idea of the three. Trading time for coins creates real decisions.
- *Clarity 8.* "Is this worth the minutes?" is the single most legible rule in any pitch.
- *Relevance 7.* Time cost per play differentiates machines, but a solved coins-per-minute table still produces one best
  machine; Grip alone has to push players to rotate.
- *Multiplayer 5.* Three clocks (the shared wall clock at cost/N, personal wristwatches, "House time"), idle drift and the
  hog rule are hard to explain and to sync.
- *Implementability 6.* It rewrites The Big One against the catalogue. pp-RTP scaling needs a sim-verified R_base per
  machine. A play-driven clock fights idle income, which Addendum 1 needs to run in real time, and fights TECH_SPEC's seconds.
- *Faithfulness 7.* The horror and menu are excellent, but replacing the spin budget with game-minutes moves away from the
  CloverPit spirit.

**DESCENT (41).**
- *Tension 8.* "New floor = new toys" pays off each quota. The 30 s Last Call sprint up the stairs is great drama.
- *Clarity 7.* Physical onboarding (one floor, four machines and one system at a time) is the best teaching device of the
  three. Lim-unit prices, Draw-Number B values and mods claw some of that clarity back.
- *Relevance 6.* Per-floor limits strand early machines. With four machines per floor, most charms point at one machine.
- *Multiplayer 6.* Vertical floors split the group; personal timecards plus a real-time wall clock repeat CLOCK's problem.
- *Implementability 5.* Eight stacked 24×24 m floors, stair towers, a moving Cage and per-floor visibility culling
  conflict with the TECH_SPEC single-pit layout. It rewrites The Big One. "Your Number" would need a Draw Number from
  all 39 machines.
- *Faithfulness 9.* It makes "seven floors below a city" literal, "you were inside the jackpot all along" is perfect, the
  elevator ending is physical, and Addendum 1 "unlock new rooms/floors" fits it natively.

### A0.3 Verdict and grafts
**Base: FAITHFUL.** Grafted ideas, by source:

| From | Idea | Where in this GDD |
|---|---|---|
| DESCENT | One new system per Night (physical onboarding) | §2.9 |
| DESCENT | Each paid quota winches the whole pit **one floor up** (B7→G) with a cinematic Ascent; the wings carry its floor themes (Boiler, Laundry, Card Room, Midway, Wheel House, Parlour) | §2.7, §6.8, §8 |
| DESCENT | The Big One's glass stays cracked from your burst-out; "you were inside it all along" | §6.6, §9.4 |
| DESCENT | Machine mods → per-instance **tycoon upgrade tracks** with visible parts | §3.7 |
| DESCENT | Jukebox songs grant watch-long buffs | §3.8, §6.9 |
| DESCENT | Fall Guy + bail → merged into the Collateral Clause (ghosts return by lift) | §7.2 |
| DESCENT | Thermal receipt flavour on the results card | §9.9 |
| CLOCK | Each Night is a night: Dusk 00:00 → Dawn 06:00 on the wall clock, Bells between watches, the **Witching Watch**, Dawn verdict | §2.2 |
| CLOCK | Dread meter 0–100 (with DESCENT's quota-pressure formula) and the **Visitation** stealth beat | §6.2–6.3 |
| CLOCK | Polite hospitality-horror voice for The House; "Wrong Number" past-guest stories | §5, §6 |
| CLOCK | Coffee and time trades → Tonics and the Time Broker call | §3.8, §5.3 |
| CLOCK | Bell-trigger charms, Night-8 thirteen-numeral clock, clock-pie on the results card, coins-per-minute ledger stat | §4, §6.4, §9.9 |

**Rejected (with reason).**
- CLOCK's play-driven game-minutes: idle income needs real time, catalogue `actionCost` is a pull count, and TECH_SPEC
  uses seconds.
- DESCENT's stacked floors and stair towers: world cost, split players, and conflict with the single-pit layout.
- "Your Number": 39 machines would each need a Draw Number.
- DESCENT's generosity gradient and Lim pricing: a second scaling axis that confuses prices.
- Both runners-up rewriting The Big One: the catalogue owns it.
- FAITHFUL's "no meta currency" rule: Addendum 1 requires prestige.

---

## 0. Conventions and glossary

**Coordinates (TECH_SPEC convention).**
- Metres; +X east, +Y up, +Z south; north = −Z. Origin = the floor centre of the hub nave at (0, 0, 0); all walkable
  floors are at y = 0.
- `rotY` ∈ {0, 90, 180, 270}: the machine front (+Z local) faces 0 → +Z (south), 90 → +X (east), 180 → −Z (north),
  270 → −X (west).
- Player yaw 0 = looking north (−Z).

**Units and notation.**
- Time is in **real seconds** unless marked "clock" (the cosmetic wall time 00:00–06:00).
- Colours are hex.
- `×N` = gross return per coin staked (stake included). `N:1` = profit odds.
- "(A)" = additive payout bonus. "(M)" = multiplicative payout factor (§3.3).

| Term | Meaning |
|---|---|
| **Night** | One deadline (the brief's "deadline"). 3–4 Watches. Ends at Dawn with a Collection. Night *n* is played at floor B(8−n) (B7…B1, then G). |
| **Watch** | One timed stretch of play inside a Night (FAITHFUL's "round"; renamed because the catalogues use "round" for a single play). Own pull budget and clock. |
| **Play** | One machine round (catalogue `MachineOutcome`, one `round` counter tick). |
| **Pull** | One unit of the per-Watch play budget. A play costs the catalogue's `actionCost` in pulls. HUD icon: brass token. |
| **Quota** | What must be deposited into the Debt Terminal by Dawn. Quota = base × modifiers + Assessment (§2.6). The sum of all base quotas is your **Debt** (shown on your JackID). |
| **Deposit** | Coins inside the Debt Terminal this Night (shared in co-op). |
| **Pocket** | Coins you carry (personal). |
| **SI** | **Stake Index** of the current Night (§3.2). It multiplies every machine's max bet (catalogue `tableLimitMult`) and every SI-priced item. |
| **Suit** | One of six machine families: REELS, CARDS, DICE, WHEELS, DROPS, CURIOS (§3.4.1). |
| **Tilt** | Per-player, per-instance, per-Watch fatigue factor that punishes camping (§3.4.3). Unrelated to the catalogue tag `tilt` (physical shove on `coinpusher` / `bingopin`). |
| **Heat** | Per-player, per-instance win-streak meter, as defined in MACHINES_tables §1.11 and extended to all 39 devices (§3.4.6). |
| **Lamp** | Hot Lamp (×1.5, no Tilt) / Cold Lamp (×0.75, punch tier-up): House-assigned per Watch. |
| **Instance** | One placed machine (`<slotId>`). Duplicates are independent instances with their own upgrades, RNG streams and owner. |
| **Pad** | An empty "FOR LEASE" slot where a new machine can be ordered (§3.7.6). |
| **Wing** | A gated room of the pit (§8). |
| **Holdings** | Depreciating value of everything bought in the tycoon layer; taxed by **Assessment** (§3.7.9). |
| **Attendant / Shill** | Mannequin staff: an Attendant earns house-side idle income; a Shill auto-plays a machine for you (§3.7.5). |
| **Tickets** | Secondary run currency (red stubs). |
| **Obols** | Permanent meta currency earned by **Descend** (prestige), Topside or falling (§11). |
| **Dread** | 0–100 horror meter (§6.2). |

---

## 1. Pitch and pillars

### 1.1 Pitch
You win a jackpot topside and wake up **inside it**: behind the cracked glass of The Big One, a slot cabinet in a casino
seven floors under the city. The glass shatters and you land in the pit. Your JackID card is clipped to your coat:
**OWED 1.34M**. A tall man with a coin slot for a face steps out of the lift, taps the Debt Terminal, and the printer
spits out tonight's quota: **80 coins by Dawn**.

JackID is a first-person PSX horror casino roguelike. Thirty-nine fully modelled gambling machines breathe in the fog.
You make three decisions over and over:
- **Play:** which machine you walk to next.
- **Pay:** how much you feed the terminal before Dawn.
- **Invest:** how much you sink into upgrading, staffing and expanding the very casino that is eating you.

Each paid quota winches the whole pit one floor up the shaft, and a new wing grinds open. Miss a quota and the floor
opens beneath you. Pay the seventh and eighth and the lift takes you Topside, or you can go back down to see how deep the
numbers go. Descend on purpose, and the House pays you in Obols for the next life. Alone, with up to seven friends against
one shared quota, or against them until one is left standing above the trapdoor.

### 1.2 Pillars
1. **Every coin has a clock.**
   - Quotas, pulls, the Watch clock, interest and Assessment put a price on every decision.
   - Nothing is free: walking costs clock seconds, a slow table costs a pull, and a coin left in the pocket earns no
     interest.
2. **The floor is a deck (THE CIRCUIT).** Suits, the punch card, Tilt, Lamps, Heat and charm affinity make *where you
   play* the strategy. Thirty-nine machines are cards, and each run opens the wings in a different order.
3. **Build the House that eats you (TYCOON).**
   - Every machine is upgradable for hundreds of levels; pads take new machines; mannequin staff earn while you play
     elsewhere.
   - The numbers run from 80 coins to trillions.
   - The House taxes what you build (Assessment), so every investment is a bet too.
4. **Touch the machine, fear the room.**
   - Diegetic, tactile PSX play: you pull levers, peel scratch cards, flick dice and feed coins into the terminal.
   - The room answers your debt: lights die as pressure rises, mannequins move when unseen, the Collector's footsteps
     come down the lift shaft before Dawn.
   - Lighting upgrades push the dark back. Unsettling, never gory.

### 1.3 Design-bar check (Addendum 3: "what decision does the player make here?")
| System | Decision, every ~20–60 s |
|---|---|
| Machines + CIRCUIT | Which machine next: Hot Lamp, open punch line, fresh Tilt, charm affinity, variance vs. quota gap |
| Bet size | Grind the quota safely, or spike for the line / Last Call |
| Terminal | Deposit now (interest, safety) vs. keep bankroll (bigger bets, upgrades) |
| Tycoon | Upgrade / staff / order a machine now (compounding, but taxed by Assessment) vs. pay the quota |
| Charms | Which build to commit to (suits, Lamps, ledger, tycoon, cursed) |
| Hotline | Accept a terrible bargain or not, under a 8 s timer while your clock runs |
| Buffs | When to drink a tonic, which jukebox song, whether to light a shrine candle |
| Horror | Hide from the Collector or keep playing during a Visitation |
| Meta | Push deeper for more Obols or Descend now |

---

## 2. Core loop and run structure

### 2.1 The loops
| Loop | Length | Beats |
|---|---|---|
| Second-to-second (seated) | 3–45 s per play | Set the bet (wheel / X / Z), commit (Space / lever / LMB), anticipation (reels 2.4 s, ball 6–9 s, cards 1–4 s), resolve, coins rattle into the tray, count-up, charm icons hop, a Tilt bulb ticks, Heat flame grows. Then: again (R), change bet, upgrade (U) or stand (E). |
| Minute-to-minute (one Watch) | 150–210 s | Bell; Lamps roll. Glance at the punch card (hold Q). Plan a 2–3 machine route (line + Hot Lamp + fresh Tilt). Play 7–10 pulls. Upgrade the machine you are camping. Deposit before Settle (interest). Sprint to the phone. Last Call (red). Closing. Settle: interest, Tickets, staff payout. |
| Night | 8–15 min | 3–4 Watches with intermissions (Pawn Window, Tonics, Bounty Board), then the **Dawn Collection**. Paid: Deadline Call favour, Wing Key, **Ascent** (pit rises one floor), Assessment printed for the next Night. |
| Run | 75–95 min to Topside | 8 Nights (B7→B1, then G "The Final Note"). Build a charm engine on 6–9 pegs and a tycoon empire on 48 instances + 27 pads (+3 in the Counting Room). Topside ending, then **Overdrawn** (endless, Night 9+). |
| Meta | across runs | **Descend** (prestige) for Obols → The Foundations tree; kits, House Edge levels, collectibles (notes, tapes, cassettes), story layers. |

### 2.2 Night anatomy
- **Wall clock.** The Night's total Watch seconds map linearly onto clock **00:00 → 06:00**; intermissions do not move it.
  - Bells sit at the Watch boundaries: 02:00 and 04:00 on 3-Watch Nights; 01:30, 03:00 and 04:30 on 4-Watch Nights.
  - **Dawn** = 06:00.
- **Witching Watch.** The Watch that begins at or contains 03:00: Watch 2 of 3, or Watch 3 of 4.
  - All payouts +5 % (A).
  - Dread +10 for its duration.
  - Colour grade multiplied by `#2A0006` at 25 %; fog far plane ×0.75.
  - The jukebox plays reversed for its first 8 s.
- Night 8's wall clock face gains a 13th numeral (cosmetic).

### 2.3 Watch timeline
| Phase | Duration | What happens |
|---|---|---|
| **Bell** | 2.0 s | One FM bell strike per Watch index (660 Hz, ratio 3.5, decay 1.2 s, 0.6 s apart). Lamps roll (N2+): beacons spin up, 0.8 s whoop. Global event roll (N4+, §3.8.4). Pulls refill. Clock starts. |
| **Play** | per schedule (§2.4) | Free movement. Machines, terminal, phone, Service Plates (upgrades) active. Pawn Window shutter is **down**. Staff income ticks every 1.0 s. |
| **Last Call** | final 20 s (30 s in the last Watch of a Night) | Clock face red sector. HUD clock `#FF3030` blinks at 2 Hz. Ambient lights tint `#FF5040` at 30 %. House: "Last call." Jukebox +3 % pitch. In the last Watch the Collector's footsteps descend the lift shaft (1 step / 0.9 s). |
| **Closing** | 10 s (15 s in the last Watch) | Starts when the clock hits 0 **or** your pulls hit 0. In MP: when every living player is at 0 pulls or has pressed Ready at the terminal. Deposits and walking are still allowed; a play already in flight finishes; no new commits. |
| **Settle** | 3 s | Machines lock (shutters clack). Tilt resets. Unused pulls → Tickets (1 each). Interest is paid (§2.6.3). The staff-income remainder for the Watch is paid (§3.7.5). Heat −30 on every instance. |
| **Intermission** (between Watches) | SP untimed · MP 45 s or all Ready | Pawn Window open (charms), Tonic machine restocked, Bounty Board readable. Start the next Watch by pulling the **BELL ROPE** beside the terminal (SP) or with all Ready (MP). |
| **Dawn Collection** | 12 s (hold Space ×3 speed after the first time) | Only after the last Watch (§2.7). |
| **Night intermission** | SP untimed · MP 90 s or all Ready | Paid: Ascent cutscene (C05), Deadline Call favour (§5.2), Wing Key (§3.7.7), overpay rewards, next quota printed with Assessment. Start the next Night by pulling the **OPEN THE FLOOR** lever on the terminal (SP) or all Ready (MP). |

### 2.4 Night schedule (base run)

| Night | Floor dial | Name | Base quota | Watches | Pulls / Watch | Clock / Watch (s) | Interest / Watch | House Favour (M) | SI | Punch card | After payment |
|---:|---|---|---:|:-:|:-:|:-:|:-:|:-:|---:|:-:|---|
| 1 | B7 | First Night | 80 | 3 | 7 | 150 | 10 % | ×1.25 | 1 | — | Wing Key 1 |
| 2 | B6 | | 300 | 3 | 7 | 150 | 9 % | ×1.15 | 3 | 3×3 | Wing Key 2 |
| 3 | B5 | | 1,150 | 3 | 8 | 165 | 8 % | ×1.07 | 10 | 3×3 | Wing Key 3 · **The Parlour opens** |
| 4 | B4 | | 4,400 | 3 | 8 | 165 | 7 % | ×1.00 | 30 | 4×4 | Wing Key 4 |
| 5 | B3 | | 17,000 | 4 | 8 | 180 | 6 % | ×1.00 | 100 | 4×4 | Wing Key 5 |
| 6 | B2 | | 65,000 | 4 | 9 | 180 | 5 % | ×1.00 | 300 | 4×4 | Wing Key 6 (all wings open) |
| 7 | B1 | | 250,000 | 4 | 9 | 195 | 4 % | ×1.00 | 1,000 | 4×4 | — |
| 8 | G | The Final Note | 1,000,000 | 4 | 10 | 210 | 3 % | ×1.00 | 3,000 | 5×5 | Lift → **Topside** |

- Totals: 28 Watches, 234 pulls. Sum of base quotas = **1,337,930** (printed as "OWED 1.34M" on your JackID at the start).
- House Favour is an M-factor on every winning payout: a soft start.
- **Overdrawn (endless), Night n ≥ 9** (after "GO BACK DOWN" at Topside; the floor dial needle points below the printed
  scale: B8, B9, …):
  - `BaseQuota(n) = 1,000,000 × 4^(n−8)`, rounded to 3 significant figures: N9 4.00M · N10 16.0M · N12 256M · N13 1.02B ·
    N16 65.5B · N18 1.05T · N21 67.1T · N23 1.07Qa.
  - `SI(n) = 3,000 × 3.5^(n−8)`, rounded to 2 significant figures.
  - 4 Watches, 10 pulls, 210 s, punch card 5×5.
  - `Interest(n) = max(1 %, 3 % − 0.5 % × (n−8))`.
  - One cumulative **Overdrawn House Rule** per Night (§11.6).

### 2.5 Start state (Debt Run, kit "Pauper", House Edge 0)

| Item | Value |
|---|---|
| Pocket | 12 ¢ (wave 85: the Night 1 House float, half the 24 quota; the House notice keeps every Night's opening hold at or under 80 % of its quota, kits and Foundations included) |
| Deposit | 0 ¢ |
| Tickets | 2 |
| Charm pegs | 6 (max 9 in-run, 10 with meta) |
| Charms | 0 |
| Open zones | Mouth, Well, Lobby (11 machine instances, all six suits; §8) |
| Pads | 7 hub pads (WELL-05/07/10/12, LOB-02/03, MOUTH-02) |
| Holdings | 0 |
| Big One JACKPOT meter | `50 × maxStake` per catalogue §2.4 |

### 2.6 The Debt Terminal

#### 2.6.1 Deposits and withdrawals
- **Deposit**: walk up and press E.
  - Keypad buttons: `10 % · 25 % · 50 % · ALL · REST` (exact remaining quota) · custom (digits + Enter).
  - Coin-stream animation 0.6 s; the counter rolls at 60 digits/s.
  - Deposits are instant and count immediately.
  - The JackID card is swiped on every deposit (0.3 s, beep 1.2 kHz).
- **Withdraw**: allowed with a **15 % House cut** (withdraw 100 → receive 85). In co-op it needs a majority vote (§7.2).

#### 2.6.2 Quota formula
`Quota(n) = round3sig( BaseQuota(n) × (1 − quotaDiscount) × coopScale × houseEdgeMult ) + Assessment(n)`
- `quotaDiscount` comes from the Friendly Auditor improvement (§3.7.8), max 15 %.
- `coopScale` (§7.2); `houseEdgeMult` (§11.5).
- `Assessment(n)` applies from Night 3: `round(0.08 × Holdings)`, where Holdings is defined in §3.7.9.
- The terminal CRT prints the breakdown: `BASE 17,000 · ASSESSMENT 1,620 (8 % OF HOLDINGS 20,250) · QUOTA 18,620`.

#### 2.6.3 Interest
At every Settle:
`interest = floor( min(deposit, 2 × quota) × rate )`

`rate` = schedule rate + charm / favour / improvement bonuses + 1 % per punch line completed this Night.
- **Activity clause**: no interest for a Watch in which you used fewer than 3 pulls. The House pays players, not savers.
- **Ceiling**: deposits above 2 × the quota earn nothing.

#### 2.6.4 Settle Early
- When `deposit ≥ quota`, the brass **SETTLE** lever unlocks. Pulling it ends the current Watch now (normal Settle) and
  runs Dawn.
- Each unplayed Watch pays **+4 Tickets**, **+1 free Pawn reroll** and **50 %** of that Watch's staff income ("the patrons
  go home early").
- Interest for unplayed Watches is forfeited.

#### 2.6.5 Overpay bonuses (checked at Dawn on `r = deposit ÷ quota`; cumulative)
| r ≥ | Reward |
|---|---|
| 1.10 | "Gratuity": +2 Tickets |
| 1.25 | +1 free Pawn reroll and buff `favoured` (Watch 1 of next Night: all payouts +10 % (A)) |
| 1.50 | Choose 1 of 3 Uncommon charms (free) |
| 2.00 | "Golden Receipt": choose 1 of 3 Rare charms; next Night's base quota −5 % |

The surplus `deposit − quota` stays in the terminal as next Night's opening deposit (it counts toward that quota and earns
its interest).

#### 2.6.6 House Limit
No single play pays more than **5 × the current quota**. The excess feeds The Big One's JACKPOT meter (bigone §2.4). One
lottery ball cannot end Night 1.

### 2.7 Dawn Collection
| t (s) | Beat |
|---:|---|
| 0.0 | Three descending bell strikes. Pit lights dim to 30 %. All machines go dark except their Tilt bulbs. Staff mannequins stand and face the Mouth. |
| 1.0 | Lift chime (sine 784 → 523 Hz, 0.4 s each). Doors open over 1.2 s. **The Collector** steps out. |
| 2.2–6.0 | He walks at 0.9 m/s to the terminal with no footsteps, only one coin clink per step. |
| 6.0–8.0 | Gloved hand on the terminal. Coins arc out of the coin slot into his coat (40 instanced coins). The counter rolls the quota down. |
| 8.0 **PAID** | Printer stamps PAID in red `#C0182A`. He touches his hat brim and returns to the lift; the doors close. Then the **Ascent** (C05, 10 s): the whole pit judders upward one floor; brick shaft walls scroll past the clerestory grilles 6 m up; the floor dial needle swings up one floor (1.5 s overshoot); lights return to full. Night intermission begins. |
| 8.0 **SHORT** | He turns his head (not his body) toward you wherever you stand (0.8 s). Lights cut to 0 except a cold spotlight `#CFE8FF` on you. Trapdoor sequence (§2.8). |

### 2.8 Fail, win and the trapdoor
- **Fail**: at Dawn `deposit < quota` and no protection fires. Protections:
  - charm `false_bottom`;
  - call H06 Insurance Man;
  - charm `rope_ladder`;
  - the co-op Collateral Clause.
- Abandoning a run counts as a fall.
- **Win**: pay Night 8, walk into the lift, press **G** on the brass panel. Topside cinematic (C08, §6.8). Choices:
  - **STAY UP**: the run ends and Obols ×1.5 are banked.
  - **GO BACK DOWN**: Overdrawn (endless).
  - **DESCEND**: prestige (§11.2).
- **No soft-lock**: if pocket < every open machine's min bet and pulls remain, the phone rings with H03 Loan Shark
  regardless of its normal trigger.
- **Trapdoor sequence**: the floor is a grid of 2 × 2 m steel plates `#3A3530` with rivets; every plate is two hinged
  halves.

| t (s) | Beat |
|---:|---|
| 0.0 | Spotlight on. House: "Short by {N}. Mind the floor." (subtitled) |
| 2.0 | A latch clanks under you (square 70 Hz 0.15 s + noise burst). Input locks. |
| 2.4 | The two half-plates under the player hinge down 90° in 0.35 s. |
| 2.4–5.5 | Fall. Camera pitches down 25°, wind rises (pink noise, band-pass sweep 400 → 1,200 Hz), pocket coins float up around you, the lit square above shrinks. The floors you climbed flash past in their light colours, newest first, 0.3 s each. |
| 5.5 | Thud (sine 40 Hz, 0.3 s). Black. Fade into **The Sump** (§9.9). |

- **Persists after a fall**: stats, achievements, collectibles, unlock progress, Obols (×0.5, §11.2), and your JackID
  added to the Sump Wall (last 50).
- **Lost**: everything in the run.

### 2.9 Onboarding: one new system per Night
| Night | Newly introduced (taught by a short scripted call or a diegetic placard) |
|---|---|
| 1 (B7) | Hub machines (11), Debt Terminal, pulls, Watch clock, interest, Tilt bulbs, Hotline (H38 Orientation), Pawn Window (from the first intermission; Common and Uncommon only), **Service Plate upgrades: Payout and Cap tracks only** |
| 2 (B6) | **Punch card**, **Hot/Cold Lamps**, first **Wing Key** choice, all six upgrade tracks, **Attendants** |
| 3 (B5) | **Tonic machine**, **Jukebox buffs**, **Bounty Board**, **House Improvements**, **Shills**, **Assessment** (explained by H34 The Landlord) |
| 4 (B4) | **The Parlour** (Devil's Table, Shell Automaton, Moth Shrine), **Machine Orders** into pads, **global events**, 4×4 card |
| 5 (B3) | Dread tier "After Hours"; Collector sightings begin; Legendary charms enter the Pawn Window |
| 6 (B2) | Visitation possible (Dread 100); all wings open after payment |
| 7 (B1) | — (the House is quiet; Night 8 preview call H10 guaranteed) |
| 8 (G) | 5×5 card; the Collector stands by the terminal all Night; thirteen-numeral clock |

Kits, meta nodes and House Keys may open wings or systems early. Teaching is always opt-in (placards readable with E;
calls can be declined).

### 2.10 Saving, resume and offline-ish progress
- **Single player** saves after every resolved play, deposit, purchase and intermission (SaveStore JSON in localStorage key `jackid:run:v1`, ≈ 40 KB; TECH_SPEC §11.11). Machine
  RNG is stream-indexed per instance (catalogue §1.5), so reloading cannot reroll anything. One run slot; CONTINUE appears
  on the jackpot menu.
- Quitting mid-Watch resumes with the Watch clock frozen at that second.
- **Offline-ish progress**: on resume, if the save was made during a Play phase and you own staff, the House credits
  "the night shift kept the lights on": staff income for `min(time away, 600 s) × 25 %` of the current rate. This happens
  once per Night and is shown as a receipt.
- **Multiplayer**: the host snapshots at every intermission (§7.6).

### 2.11 Example Watch (Night 4, Watch 2: B4, quota 4,400 + Assessment 310, SI 30)
State:
- Deposit 2,100, pocket 1,350, 8 pulls.
- Charms: Brass Thimble, Moth Lantern, Sun Dial (REELS ×3 → +25 % (A), Tilt grace +2), Circuit Breaker.
- Tycoon:
  - The Big One (`WELL-01`) at Payout L14 and Luck L3.
  - An Attendant on the roulette (`WELL-02`) at Cap L5 / staff L5, earning ≈ 20 ¢/min.

Bell: the Hot Lamp spins up red on the Craps table in the Boiler; the Cold Lamp goes blue on the Flip Booth. The card's open
line needs a DICE silver (≥5× on DICE).

Plan:
1. Big One ×2 (REELS, fresh Tilt, +25 %).
2. Walk 14 s to the Boiler; Craps ×1 (Hot ×1.5; a hardway hit punches the silver; Circuit Breaker +12 %).
3. Big One ×2.
4. Spend 1,240 ¢ on Big One Payout L14 → L16 at the Service Plate. The payout factor rises ×1.27 → ×1.30, about +9 ¢ per
   300 ¢ spin, so it pays back over the rest of the run, not tonight. It also adds 1,240 to Holdings → +99 on the next
   quota, shrinking 25 % per Night. That trade-off is the tycoon decision.
5. Deposit 900 at 0:40 left so the Watch's interest (7 % + 1 % line) counts.
6. The phone rings at 0:31 (H13 Rigged Wheel), but you decline: the pulls are better spent on your own route.

Settle: interest +210, Attendant remainder +15, 1 unused pull → 1 Ticket.

---

## 3. Economy, THE CIRCUIT and the tycoon layer

### 3.1 Currencies
| Currency | Physical form | Earned from | Spent on | Cap |
|---|---|---|---|---|
| **Coins ¢** (TR "jeton", `j`) | Brass coins `#C8A040`; the pocket is a pouch in the left-hand viewmodel (coin stack height = `log10(pocket)`, max 9 coins) | Machine payouts, punch bounties (straight into the deposit), interest, staff income, phone deals, selling charms (50 %), bounties | Bets, charms, tonics, tycoon purchases, quota, withdrawal cut, phone deals | none (JS number, formatter §3.9) |
| **Tickets** | Red paper stubs `#E8343A`, black serials | Unused pulls (1 each), punched cells (+1), Settle Early (+4 per skipped Watch), overpay, claw/pusher/lootbox prizes, bounties, some charms/calls | Pawn rerolls (1, +1 per further reroll in the same intermission), item lock (1), buy a pull (3 Tickets = +1 pull, max +2 per Watch), card cell reroll (2), jukebox song (1), some tonics, phone deals | 99 |
| **Obols** (meta) | Black lead coins with a hole `#2A2A30` | Descend ×1.0, Topside ×1.5, fall ×0.5, abandon ×0.25 (§11.2) | The Foundations tree (§11.3) | none |

No other currency exists.

### 3.2 Stake Index (SI), bets and prices
- **SI** per Night is in §2.4. It is passed to every machine as the catalogue's `tableLimitMult`.
- Effective max bet of an instance = `catalogue maxBet × SI × capMult(instance)`, snapped down to the bet ladder
  `1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, …` (×10 per decade, catalogue §1.1). Table spot and table maxima
  scale the same way (`table.limitMult`). **Min bets never scale.**
- **SI-priced items** cost `base × SI`: charms (§4), tonics (§3.8.3), phone deals quoted "× SI".
- **Tycoon prices are not SI-indexed.** They grow with level or count (§3.7); income grows with SI. That is the idle curve.
  The one exception is buying a wing early, which costs 1.5 × the current quota.

### 3.3 Payout pipeline (single choke point: `run.win()` / `econ.settle()`)
The machine reports the **base gross** `G` for total stake `B`. Base gross means after its own rules, its device hooks and
luck, but **before** `payoutMult`. Then:

```
if G <= B:                                   // loss, push or partial refund: no bonuses
    final = G + refunds                      // betRefundOnLoss / nearMissRefund on losses; buffs with "refund"
else:
    A = Σ additive bonuses                   // suit charms, affinity, Heat ≥60, Witching +5 %, jukebox, buffs/events marked (A)
    if G <= 2.0 * B: A = A * 0.5             // DAMPENER: even-money wins get half the additive bonus
    M = Π factors                            // House Favour, Hot ×1.5 / Cold ×0.75, Tilt, instance Payout track,
                                             // M-charms, buffs/events marked (M), Overheat
    final = floor(G * min(1000, (1 + A) * M))   // + dust accumulator (catalogue §1.1); 1000 = hook-stack guard
    final = min(final, 5 * currentQuota)     // HOUSE LIMIT; the excess feeds bigone's JACKPOT meter
```
- Machines must **not** apply `payoutMult` themselves. The catalogue hook `payoutMult` is this combined `(1 + A) × M`,
  exposed read-only for UI (H card live values).
- Exception: when a catalogue rule uses the factor inside its own maths (e.g. `elevator` applies it to cash-out profit and
  stake), the machine asks `econ.payoutFactor(ctx)` and reports the already-scaled gross with `meta.factorApplied = true`.
- The dampener exists so a +60 % charm stack cannot turn even-money grinders into a riskless farm.

### 3.4 THE CIRCUIT

#### 3.4.1 Suits
Every cabinet carries its suit glyph on a 0.12 m emissive enamel badge on the marquee, readable through the fog.

| Suit | Glyph (8×8 px, procedural) | Colour | Machines (39) |
|---|---|---|---|
| **REELS** | three stacked bars | `#FFB000` | bigone, bandit, pachislot, fruitmachine, scratch, lootbox |
| **CARDS** | an original notched leaf ("the Pike") | `#E8E0C8` | videopoker, blackjack, holdem, baccarat, cardwar, hilo, threecard, reddog |
| **DICE** | a die showing 5 pips | `#FF4A3A` | craps, sicbo, dicetower, coinflip, teetotum |
| **WHEELS** | 6-spoke wheel | `#38E8FF` | roulette, bigsix, cyclone, devilstable, tombola |
| **DROPS** | a ball falling into a funnel | `#DDF4FF` | pachinko, plinko, coinpusher, bingopin, keno, bingo, lottoblower |
| **CURIOS** | an open eye | `#FF2E88` | elevator, mines, claw, stacker, derby, fortuneteller, shellgame, fantan |

#### 3.4.2 Punch card (from Night 2)
- Printed by the terminal at the start of each Night (dot-matrix screech 1.5 s). Held in the left hand: hold **Q** to raise
  it to eye level. A mini version sits on the HUD.
- **Cell tiers**:
  - **Bronze**: "Win on a ◇ machine" (`G > B`).
  - **Silver**: "Win ≥ ×5 on ◇".
  - **Gold**: "Win ≥ ×20 on ◇".
  - **HOUSE** (gold-equivalent): the named feat of one named open machine (roster column "HOUSE feat", §3.5).
  - **LEDGER**: one terminal task:
    - "≥ 50 % of quota deposited at the end of Watch 1";
    - "3 separate deposits in one Watch";
    - "finish a Watch with ≥ 3 unused pulls".
- **Layouts**:

| Size | Nights | Corners | Edges | Inner | Lines (rows + cols + 2 diagonals) |
|---|---|---|---|---|---|
| 3×3 | 2–3 | 4 Bronze | 4 Silver | centre: HOUSE or LEDGER (50/50) | 8 |
| 4×4 | 4–7 | 4 Bronze | 4 Bronze + 4 Silver | 2 Gold, 1 HOUSE, 1 LEDGER | 10 |
| 5×5 | 8+ | 4 Bronze | 6 Bronze + 6 Silver | 4 Gold, 3 HOUSE, 1 Silver, LEDGER (centre) | 12 |

- **Generation** (seed stream `card`):
  - Only suits with ≥ 1 open machine appear.
  - No suit fills more than ⌈cells/4⌉ cells, and every line holds ≥ 2 suits.
  - HOUSE feats come only from open machines.
- **Rewards**:
  - Each punched cell: +1 Ticket.
  - Each completed line credits **10 % of the base quota** to the deposit and gives **+1 % interest** for the rest of this
    Night.
  - **Blackout** (all cells): +25 % of the base quota to the deposit, +5 Tickets and a free charm at the next intermission
    (Rare 80 % / Legendary 20 %).
- **One play punches at most one cell**: the highest tier first, then the cell completing the most lines.
- **Cold Lamp grading**: a win on the Cold Lamp machine is graded one tier higher (Bronze → Silver → Gold), never into
  HOUSE.
- **Reroll** one unpunched cell for 2 Tickets, max 2 per Night.
- **Feel**: the card snaps forward 0.25 s with a "chunk" (white-noise 30 ms + sine 180 Hz) and leaves a pixel hole. A
  completed line glows gold `#FFD34A`, coins visibly rain into the terminal, and the House says "Line."

#### 3.4.3 Tilt (anti-camping)
- Counted per player, per instance, per Watch, in **pulls** spent on that instance. Four amber bulbs `#FFB000` on the
  marquee show full-value pulls remaining; then a red TILT tube `#FF2020` lights and flickers faster with each extra pull.

| Pull # on this instance this Watch | 1–4 | 5 | 6 | 7+ |
|---|---|---|---|---|
| Tilt factor (M) | ×1.00 | ×0.80 | ×0.60 | ×0.40 |

- A multi-pull play takes the factor of its **last** pull.
- No Tilt on the Hot Lamp machine. Tilt resets at Settle.
- Shifts in the threshold:
  - grace: charms `worn_glove` +2, `red_thread` +3 on the first machine; favour F07 Stamina +1; improvement Velvet Stools
    +1; affinity 3+ +2; tonic Ginger +1; buff `blessing_steady_hand` +2;
  - penalty: House Edge 3 −1.
- `MachineOutcome.meta.tiltFactor` records the applied factor.

#### 3.4.4 Lamps (from Night 2)
- At every Bell the host draws from open, non-occupied-by-staff instances (seed stream `lamps`):
  - **Hot Lamps**: 1 (N2–N4) or 2 (N5+), +1 per 3 co-op players. Each is ×1.5 (M) with no Tilt, under a red rotating
    beacon `#FF3020` with a 3 m vertical beam visible through fog.
  - **Cold Lamp**: always 1. ×0.75 (M) with tier-up punch grading. Blue beacon `#3080FF`, slow pulse; a seated patron
    mannequin appears at it when you are ≥ 10 m away (CLOCK's tell).
- The same instance cannot be Hot two Watches running. Affinity 4+ doubles a suit's Hot weight.
- A newly ordered machine is never Cold on its first Watch.

#### 3.4.5 Affinity
Each charm has a tag: one suit, LEDGER, TYCOON, or none. Count tags among equipped charms:

| Same-tag charms | Effect |
|---|---|
| 2 (suit) | +10 % (A) on that suit's machines |
| 3 (suit) | +25 % (A); Tilt starts 2 pulls later |
| 4+ (suit) | +50 % (A); Tilt +2 later; Hot Lamp weight ×2 |
| LEDGER 3 / 4+ | +1 % / +2 % interest per Watch |
| TYCOON 3 / 4+ | staff income +15 % / +30 %; upgrade costs −5 % / −10 % |

#### 3.4.6 Heat (win streaks, extends MACHINES_tables §1.11 to all 39 devices)
- Per player, per instance, 0–100:
  - +15 per win, +30 per `bigwin`, −20 per loss;
  - −5 per real minute while you are not seated there;
  - −30 at every Settle; 0 at Dusk.
- **Heat ≥ 60**: status `hot:<id>`. The instance's phase lamp / marquee chase turns gold and grants **+10 % (A)** there.
- **Heat 100 = Overheat** for the next 3 plays on that instance:
  - tables: the catalogue's per-device effect;
  - machine-family devices: default `payoutMult +10 % (M)` and `luckBonus −5`.
  - Then Heat → 40.
- Heat is the reward for staying; Tilt is the cost of staying too long. Their sweet spot (4–6 pulls) is the intended
  "camp" length.

#### 3.4.7 Why machine A instead of machine B (the five forces)
| Force | Direction | Rule |
|---|---|---|
| Punch card | pull toward variety | lines pay 10 % of quota + 1 % interest |
| Tilt | push off a machine | ×0.8 / 0.6 / 0.4 after 4 pulls |
| Lamps | weather | Hot ×1.5 no Tilt; Cold ×0.75 but grades up |
| Affinity + Heat | bias from build and streak | +10…50 % (A) by suit; +10 % (A) when hot |
| Fit + Tycoon | context | variance vs. quota gap; your upgraded or staffed instances are worth more to you |

### 3.5 Machine roster (39 devices)
"Default slot" ids are §8.6. Bet column = catalogue base range (× SI). RTP, variance and actionCost come from the
catalogues and are not tuned by the economy. **Y** = idle yield for an Attendant (coins/min per SI at staff L1, §3.7.5);
"—" = not ownable by staff.

| # | id | Display name | Suit | Size | Default slot(s) | Tier | Pulls (actionCost) | Base RTP | Var | Bet (SI 1) | Role | Y | HOUSE feat (punch card) |
|--:|---|---|---|---|---|:-:|:-:|---|---|---|---|--:|---|
| 1 | `bigone` | The Big One | REELS | XL | WELL-01 | 1 | 1 | 94.7 % | M + tail | 1–100 | Engine (hero) | 0.30 | VALLEY, PEAK, HALO or FULL |
| 2 | `bandit` | One-Armed Bandit | REELS | M | WELL-04, WELL-06, GAL-07, GAL-08 | 1 | 1 | 92.0 / 93.0 % | H | 1–75 | Engine | 0.24 | a ×3 line paying ≥ 100 / credit |
| 3 | `videopoker` | Video Poker "Jacks Up / Deuces Down" | CARDS | M | CARD-04, CARD-05 | 1 | 1 | 97.30 / 99.73 % opt. | H | 1–125 | Engine / Skill | 0.15 | four of a kind or better |
| 4 | `elevator` | The Elevator (crash) — cabinet reads "SERVICE CAR" | CURIOS | XL | MID-01 | 1 | 1 | 96.0 % | player | 1–500 | Spike / Social | 0.18 | cash out ≥ ×10 |
| 5 | `scratch` | Scratch-Card Vendor | REELS | M | LOB-01 | 1 | 1 / card | 80.5–87.8 % | H | 2–50 / card | Spike / Utility (charm stamps) | 0.33 | a card prize ≥ ×50 |
| 6 | `pachislot` | Pachislot "Oni Feast" | REELS | M | GAL-01, GAL-02, GAL-03 | 2 | 1 / 3 games | 94.8–104.0 % | H | 3–75 | Engine / Skill | 0.21 | enter BIG |
| 7 | `pachinko` | Pachinko "Deep Rain" | DROPS | M | LAU-03, LAU-04, LAU-05 | 2 | 1 / 50 balls | 92.5 % | H | ball 1/2/5 | Engine | 0.23 | trigger the jackpot |
| 8 | `plinko` | Plinko Board | DROPS | M | WELL-09 | 2 | 1 / drop | 96.4–96.7 % | L / H | 1–100 × 1–5 pucks | Engine | 0.15 | land slot 0 or 12 |
| 9 | `coinpusher` | Coin Pusher "The Shelf" | DROPS | L | LAU-06 | 2 | 1 / 10 coins | ≈ 88 % + prizes | L | coin 1/5/25 | Utility / Social | 0.27 | a prize falls |
| 10 | `cyclone` | Cyclone Light Ring | WHEELS | M | MID-06 | 2 | 1 | 85 % / 93–97 % aimed | M | 1–50 | Skill | 0.23 | hit the JP lamp |
| 11 | `mines` | Mines Terminal | CURIOS | M | WELL-11 | 2 | 1 | 97.0 % | player | 1–200 | Spike | 0.14 | 8 safe tiles with ≥ 5 mines |
| 12 | `dicetower` | Dice Tower | DICE | L | BOI-03 | 2 | 1 | 88.9–94.4 % | L–H | 2–200 | Social | 0.18 | a doubles roll paying ≥ ×5 |
| 13 | `lootbox` | Mystery Capsule Vendor | REELS | M | GAL-06 | 2 | 1 | 89–92 % value | M | 10/40/150 | Utility (charms) | 0.24 | a Rare+ capsule |
| 14 | `claw` | Claw Crane | CURIOS | M | MID-03, MID-04 | 3 | 2 | ≈ 80 % / ≤ 105 % | M | 2–50 | Skill / Utility | 0.36 | deliver a capsule |
| 15 | `stacker` | Stacker | CURIOS | M | MID-05 | 3 | 2 | ≈ 70 % / ≤ 110 % | H | 1–25 | Skill | 0.36 | take the Minor or Major |
| 16 | `fruitmachine` | Fruit Machine "Nudge & Hold" | REELS | M | GAL-04, GAL-05 | 3 | 1 | 88.0 % | M | 1–20 | Engine | 0.26 | any feature |
| 17 | `bingopin` | Bingo Pinball | DROPS | L | LAU-08 | 3 | 2 | 93.5 % | H | 1–25 | Skill / Spike | 0.20 | 5 lines |
| 18 | `roulette` | Roulette "The Bone Wheel" | WHEELS | XL | WELL-02 (+WH-04 in MP) | 1 | 1 | 97.30 % | L–H | inside 1–100 / spot, table 2,000 | Grinder / Social | 0.45 | straight-up hit |
| 19 | `blackjack` | Blackjack "Twenty-One" | CARDS | L | WELL-03 | 1 | 1 | ≈ 99.7 % basic | L | 5–500 | Grinder / Skill | 0.30 | win with 5+ cards |
| 20 | `holdem` | Texas Hold'em "The Long Table" | CARDS | XL | CARD-01 | 1 | 1 / hand | skill; rake 5 % cap 3 BB | M | blinds 1/2 · 10/20 · 50/100 | Social / Skill | 0.38 (rake) | win a pot with a flush+ |
| 21 | `devilstable` | The Devil's Table (SHELLS duel + Six Chambers variant) | WHEELS | L | PAR-01 | 1 | 2 | 95.0 % | M–H | 10–50 % of wallet | Spike (signature) | — | win a SHELLS match, or COLLECT at rung ≥ 3 |
| 22 | `baccarat` | Baccarat "The Mirror Table" | CARDS | L | CARD-02 | 2 | 1 | 98.94 / 98.76 / 85.64 % | L | 10–1,000 | Grinder | 0.27 | a Tie bet hits |
| 23 | `craps` | Craps "The Bone Pit" | DICE | XL | BOI-01 | 2 | 1 / roll | 83.3–100 % | L–H | line 5–500 | Social | 0.45 | a hardway hit |
| 24 | `sicbo` | Sic Bo "The Birdcage" | DICE | L | BOI-02 | 2 | 1 | 87.5–97.2 % | L–X | 1–500 | Grinder / Spike | 0.53 | a triple with your winning bet |
| 25 | `bigsix` | Big Six "The Six-Score Wheel" | WHEELS | L | WH-01 | 2 | 1 | 90.7–96.3 % | L–H | 1–200 / symbol | Grinder | 0.42 | the EYE segment |
| 26 | `cardwar` | War Table (War / Dragon-Tiger) | CARDS | L | CARD-03 | 2 | 1 | 97.12 / 96.27 % | L | 5–500 | Grinder | 0.36 | win a war |
| 27 | `hilo` | Hi-Lo Ladder | CARDS | M | WELL-08 | 2 | 1 | 98.5–99.0 % / step | player | 5–200 | Spike | 0.23 | collect a 6-step ladder |
| 28 | `keno` | Keno Lounge | DROPS | L | LAU-02 | 2 | 1 / draw | 93.6–95.4 % | M–X | 1–100 | Spike / Social | 0.42 | 4+ hits on a 5+ spot ticket |
| 29 | `derby` | Rat Derby "The Rat Run" | CURIOS | XL | MID-02 | 2 | 1 / race | 90 % / 85 % | M–H | 1–200 / bet | Social | 0.48 | win with a ≥ ×10 runner |
| 30 | `fortuneteller` | Fortune-Teller "Mother Moth" | CURIOS | M | MOUTH-01 | 2 | 1 | 86.4 % + omens | L | 10–200 | Oracle (buffs) | — | draw The Grand Omen or The Eye |
| 31 | `coinflip` | Coin-Flip Booth | DICE | S | WELL-13, BOI-05 | 2 | 1 (rides free) | 98.0 / 96.0 % | L–H | 1–500 | Grinder / Spike | 0.21 | EDGE, or a 5-ride streak |
| 32 | `threecard` | Three Card Poker | CARDS | L | order only | 3 | 1 | 96.63 / 92.72 % | L–M | Ante 5–200 | Grinder | 0.33 | straight flush or better |
| 33 | `reddog` | Red Dog "The Kennel" | CARDS | L | order only | 3 | 1 | 97.20 % opt. | L | 5–200 | Grinder | 0.27 | trips |
| 34 | `bingo` | Bingo "Hall of Calls" | DROPS | XL | LAU-01 | 3 | 1 / game | ≈ 93 % | M | 2–50 / card × 1–4 | Social | 0.45 | X pattern or better |
| 35 | `lottoblower` | Lotto Ball Blower "The Breath" | DROPS | M | LAU-07 | 3 | 1 / draw | 86 % + 8 % jackpot | X | 5 / line × 1–20 | Spike | 0.48 | match 4+ |
| 36 | `tombola` | Tombola Raffle Drum | WHEELS | L | WH-02 | 3 | 1 / ticket | 90 % | M | 10 / ticket | Utility | 0.39 | a Grand prize ticket |
| 37 | `shellgame` | Shell Automaton "Monsieur Thimble" | CURIOS | M | PAR-02 | 3 | 2 | 57 → 170 % skill | L | 5–20 | Skill | — | Call Cheat correctly |
| 38 | `fantan` | Fan-Tan | CURIOS | L | WH-03 | 3 | 1 / count | 96.25–98.75 % | L–M | 5–500 | Grinder | 0.30 | win a single-number bet |
| 39 | `teetotum` | Put-and-Take Top | DICE | L | BOI-04 | 3 | 1 / cycle | ≈ 97.4 % (rake) | M | ante 5/20/100 | Social (PvP) | 0.33 (rake) | a take-all result |

Default placement: 48 instances of 37 types. `threecard` and `reddog` exist only through Machine Orders (§3.7.6). Every
machine without an instance is still orderable, so all 39 matter as tycoon stock.

### 3.6 Roles
| Role | Members | Use it when |
|---|---|---|
| **Engines** (charm- and upgrade-scalable, 1 pull, M–H var) | bigone, bandit, pachislot, fruitmachine, pachinko, plinko, videopoker | You have suit charms and Payout levels. This is where coins are made. |
| **Grinders** (L var, 96–99 %) | blackjack, baccarat, cardwar, roulette (outside), bigsix "1", coinflip, sicbo Big/Small, fantan, threecard, reddog | Filling Bronze cells, protecting a near-full deposit, cheap activity pulls. Weak with charms (dampener). Great with Attendants. |
| **Spikes** (X var) | lottoblower, devilstable, keno 8–10 spot, sicbo triples, hilo / mines / elevator long chains, scratch Deep End | Behind at Last Call, Gold cells, desperation. |
| **Skill** | stacker, claw, shellgame, cyclone, pachislot aim, blackjack counting, holdem, videopoker | You are good at it. Low caps keep it honest (perfect-play RTP ≤ 1.25 before charms, except shellgame's catalogue curve). |
| **Social** (multi-seat, shared draws) | craps, roulette, bingo, elevator, derby, holdem, keno, coinpusher, teetotum | Co-op and Versus gathering points: shared tension, shared Hot Lamps. |
| **Utility / Oracle** | scratch (charm stamps), lootbox, claw, coinpusher (prizes, cassettes), tombola, fortuneteller (omens = buffs) | Convert coins into charms, Tickets, buffs and collectibles. |
| **Idle earners** | high-Y devices (sicbo 0.53, derby 0.48, lottoblower 0.48, roulette / craps / bingo 0.45) | Attendant targets: house-side income. |

### 3.7 The tycoon layer (Addendum 1 — a core pillar)

#### 3.7.1 Where and when
- **Service Plate**: every instance carries a 0.12 × 0.08 m brass plate showing its Level (★ = Payout track level) as
  nixie digits.
  - Look at any instance within 2.2 m (or sit at it) and press **U**: the Upgrade Ledger panel opens (§10.3).
  - It shows 6 tracks, staff, the owner and the Shill P&L.
- **Concession Desk** (Lobby, LOB-DESK), staffed by a mannequin clerk with a brass bell. It holds:
  - the **Ledger of Leases**: every instance in the pit with level, staff, income/min and owner;
  - **Machine Orders** and **House Improvements**;
  - **wing purchases**;
  - the staff roster.
- **When**: Play phases and intermissions. Not during Closing, Settle, Collection or cutscenes. In MP the host validates
  every purchase (`tycoon.buy` intent).

#### 3.7.2 Upgrade tracks (per instance)
| Track | id | Max L | Effect | Milestones / notes | Cost base B | Growth G |
|---|---|---:|---|---|---:|---:|
| **Payout** ("Level" ★) | `payout` | 100 | Instance payout factor (M) = `(1 + 0.015·L) × 1.05[L≥10] × 1.10[L≥25] × 1.20[L≥50] × 1.35[L≥100]` → L10 ×1.21 · L25 ×1.59 · L50 ×2.43 · L100 ×4.68 | **L10 / L25 / L50 / L100 unlock device features** (§3.7.4) | 20 | 1.20 |
| **Luck** | `luck` | 10 | +1 `luckBonus` on this instance (global luck cap 30, catalogue) | L5: Heat gain +25 % here · L10: `nearMissRefund` 0.25 here | 60 | 1.90 |
| **Speed** | `speed` | 30 | Instance animation / RESOLVE / betting-timer durations ×0.97 per level (floor ×0.40; shared-table timers floor 6 s); staff rates ÷ duration factor | L15: catalogue autoplay (G) enabled where allowed · L30: watchers also see ×2 | 15 | 1.15 |
| **Cap** | `cap` | 100 | Instance `limitMult` = `1.06^L` (tables: `table.limitMult`); also scales Attendant income | L25: max bet +1 ladder step · L50: +2 · L100: +3 | 30 | 1.14 |
| **Seats / lines** | `seats` | 2 | Tables: 2 / 3 boxes (catalogue `seats`). Draw devices (keno, bingo, lottoblower, tombola, derby): +1 / +2 tickets or cards per draw. Solo cabinets: **Twin Play**, one pull plays 2 / 3 independent rounds at the same stake (stake ×2 / ×3; Tilt counts 1 pull) | Disabled on holdem, devilstable, shellgame, fortuneteller | L1 2,500 · L2 250,000 (fixed) | — |
| **Staff** | `staff` | 50 | L1 = hire an Attendant or a Shill (§3.7.5); every further level +5 % staff rate | L10 / L25 / L50: brass / silver / gold badge, +10 % rate each | hire §3.7.5; levels B 50 | 1.22 |

#### 3.7.3 Cost formula
`cost(track, L → L+1) = round3sig( B × size × tier × G^L × (1 − upgradeDiscount) )`
- `size`: S 0.6 · M 1.0 · L 1.5 · XL 2.2.
- `tier`: catalogue tier 1 → 1.0, tier 2 → 0.9, tier 3 → 0.8 (niche machines are cheaper to build up).
- `upgradeDiscount`: charms + affinity + meta, capped at 40 %.
- Worked examples (M, tier 1, Payout):

| Step | Cost |
|---|---|
| L0→1 | 20 |
| L9→10 | 103 |
| L24→25 | 1,590 |
| L49→50 | 152K |
| L99→100 | 1.38B |

  Cumulative: L25 ≈ 9.4K · L50 ≈ 910K · L100 ≈ 8.3B. A median run reaches L25–40 on two machines by Night 8; L100 is an
  Overdrawn (≈ N13) goal.
- Buy modes: **×1 / ×10 / MAX** (toggle with M in the panel; Shift+LMB = ×10, Ctrl+LMB = MAX affordable).
- Every level adds a visible part to the model (DESCENT's mods):
  - Payout L10 / 25 / 50 / 100: brass trim, gold marquee, crown topper, gilded cabinet;
  - Luck: a horseshoe per 2 levels;
  - Speed: a governor gauge;
  - Cap: a limit plate;
  - Seats: a second stool / box;
  - Staff: a mannequin.
- The **first** upgrade bought on The Big One replaces its cracked glass (cosmetic beat).

#### 3.7.4 Milestone features (machine-family devices; table devices use their catalogue "Milestones" at the Payout level)
| id | L10 | L25 | L50 | L100 |
|---|---|---|---|---|
| bigone | `bigone.jackpotFeed` 1 → 1.5 % | `bigone.extraPattern` CORNERSTONE | `bigone.wildChance` 0.02 | `bigone.extraPattern` TWIN RAILS + `bigone.holdReel` |
| bandit | `bandit.extraLine` | `bandit.shoeWild` | `bandit.thirdCoinBonus` ×2 | `bandit.symbolPayAdd[STAR]` +1,000 / credit |
| videopoker | `videopoker.hintOptimal` | `videopoker.payTableUpgrade` | `videopoker.bonusQuads` | `videopoker.royalBonus` ×2 |
| elevator | `elevator.floorBonus` +0.02 | `elevator.lateStep` | `elevator.autoInsurance` | luck +5 here |
| scratch | `scratch.xray` | `scratch.discount` 20 % | `scratch.secondChance` | `scratch.topPrizeMult` ×2 |
| pachislot | `pachislot.settingPeek` | `pachislot.slipFrames` +1 | `pachislot.settingShift` +1 | `pachislot.bonusGames` +10 |
| pachinko | `pachinko.tulipBoost` +10 % | `pachinko.holdMax` +1 | `pachinko.kakuhenRate` +10 % | `pachinko.sweetWiden` ±10 % |
| plinko | `plinko.goldenSlot` | `plinko.extraPuck` | `plinko.safetyFloor` 0.5 | `plinko.edgeMult` ×2 |
| coinpusher | `coinpusher.wallsUp` 20 coins | `coinpusher.goldCoin` 2 % | `coinpusher.prizeChance` ×1.5 | `coinpusher.trayMagnet` |
| cyclone | `cyclone.slowMo` | `cyclone.jpWindow` +1 | `cyclone.secondLight` | `cyclone.jpMult` ×2 |
| mines | `mines.scanner` | `mines.edgeBonus` | `mines.insurance` 25 % | `mines.capRaise` |
| dicetower | `dicetower.fieldBoost` | `dicetower.sevenPay` | `dicetower.parlay` | `dicetower.shooterBonus` +10 % |
| lootbox | `lootbox.pityAt` −5 | `lootbox.rerollToken` | `lootbox.discount` 20 % | `lootbox.cursedOdds` ×0 |
| claw | `claw.xray` | `claw.timer` +4 s | `claw.weakCarry` ×1.5 | `claw.magnet` ×3 |
| stacker | `stacker.saveCell` | `stacker.extraBlock` | `stacker.minorMult` ×1.5 | `stacker.majorCharm` +1 rarity |
| fruitmachine | `fruitmachine.gambleSafety` | `fruitmachine.holdOdds` ×1.2 | `fruitmachine.trailStart` 3 | luck +5 here |
| bingopin | `bingopin.freeSpace` | `bingopin.tiltGuard` | `bingopin.extraBallDiscount` 25 % | `bingopin.lineMult[5]` ×2 |

#### 3.7.5 Staff (mannequins from `quaternius-ual`, PSX-converted, `Sitting_*` / `Idle_Talking_Loop` / `Interact` clips)
**Attendant (house side).**
- The instance is opened to patrons: mannequin "guests who lost" sit at it when no human does, and step aside in 0.6 s when
  a human presses E.
- Hire cost = `300 × 3^a` (a = Attendants already hired this run): 300 · 900 · 2.7K · 8.1K · 24.3K · 72.9K · 219K · 656K ·
  1.97M · 5.9M · 17.7M · 53.1M. Max 12 (+2 with meta).
- Income: `income/min = Y × SI × 1.06^capL ÷ speedFactor × (1 + 0.05 × (staffL − 1)) × badges × (1 + bonuses) × 0.9`
  (the 0.9 is the 10 % wage).
  - `Y` from §3.5. `speedFactor` = the Speed track duration multiplier (1.0 → 0.40).
  - PvP devices (holdem, teetotum) earn rake: same formula with their Y.
  - Uses base house edge implicitly (Y), so Payout upgrades cannot inflate it.
- Paid in 1 s ticks during Play. The **remainder of the full Watch** is paid at Settle, so ending a Watch early never
  costs idle income (no stalling incentive).
- Floating `+N` coin sprites rise from staffed machines every 5 s (≤ 12 visible).
- Not staffable: devilstable, fortuneteller, shellgame ("the Devil only plays with the living").
- Example: roulette (Y 0.45) at N8 (SI 3,000), Cap L20 (×3.21), staff L20 (×1.95), brass badge (×1.10) →
  `0.45 × 3000 × 3.21 × 1.95 × 1.10 × 0.9 ≈ 8.4K/min` ≈ 29K per 3.5-min Watch ≈ **12 % of the N8 quota per Night**.
  Three to five such Attendants make idle income a major late-run source by design, without replacing gambling.
- Early Attendants earn a visible trickle (N2 roulette: ≈ 1.2 ¢/min). They pay for themselves from Night 4–5, when SI
  reaches 30–100.

**Shill (player side).**
- A gambler mannequin auto-plays the instance **for you** with headless rules calls. Each catalogue rules module exports
  `simulate()`; a `playHeadless(rng, stake, hooks)` wrapper is requested in Appendix C.
- Hire cost = `200 × 3^s`; max 8.
- Stake: fixed at **1 % of the instance max bet** (× Seats track: Twin Play doubles / triples it). Float = 20 stakes
  escrowed from your pocket; Auto-refill on/off (default on).
- Plays per minute = `0.5 × patronRate` (Appendix B) ÷ speedFactor × (1 + 0.04 × (staffL − 1)). Shills spend **no
  pulls**, punch no cells, earn no Tickets and build no Heat.
- Shills use the instance's Payout, Luck, Cap and Seats tracks and nothing else. No charms, Lamps, Tilt, Heat, House
  Favour, buffs or House Limit bonus.
- EV per minute = plays × stake × (RTP_inst − 1). It is negative until you push the instance past 100 %. The plate shows a
  running **SHILL P&L**, green or red.
  - Example: bigone at N8, RTP_inst 1.30 (Payout L20 ≈ ×1.37 on 94.7 %): `0.5 × 8 × 3,000 × 0.30 ≈ 3.6K/min` ≈ 4 % of
    the quota per Night. At RTP_inst 1.9 it is ≈ 15 %.
- Occupies the seat: solo devices are blocked; tables lose one seat. Press E on him to stand him aside for the rest of the
  Watch.
- RNG stream: `hash32(runSeed, instanceSeed, 'shill', n)`.
- **This is the tycoon gamble**: invest until RTP_inst > 1, then let the mannequins grind it.

#### 3.7.6 Machine Orders (expand the casino)
- Every empty **pad** shows a brass "FOR LEASE" stand and a floor outline in chalk `#E8E0C8`.
- Order at the Concession Desk or with E on the pad's stand.
- Orderable types:
  - any type present in an open zone;
  - `threecard` and `reddog` once the Card Room is open;
  - all 39 with the meta node *The Catalogue*.
- A slot accepts its size class or any smaller one.
- Price = `sizeBase × 2.6^o` (o = orders this run); sizeBase S 60 · M 120 · L 250 · XL 500. Example M: 120, 312, 811,
  2.1K, 5.5K, 14.3K, 37K, 96K, 251K, 652K.
- Delivery (C06b, 6 s): a ceiling hatch opens, the crate lowers on chains in 4 s, and a 2 s wrench-and-sparks montage
  follows.
- The machine is playable from the next Bell and is never Cold on its first Watch.
- Sell-back: 30 % of the price; the pad returns empty; Holdings −price.

#### 3.7.7 Wings
- **Wing Keys**: after paying Nights 1–6 you receive one free Wing Key at the lift call panel. Brass push-buttons, one per
  closed wing, each shows its suit glyphs and a 3-line machine list. Press E: the grille rattles up (3 s) and C06 plays.
  - Co-op: the team votes (20 s). With N ≥ 4 players one wing is open from Night 1; with N ≥ 6, two (host picks).
- **Buy a wing early** at the Concession Desk: `1.5 × current quota` (counts toward Holdings).
- **The Parlour** opens automatically after Night 3 is paid (C10 stinger).
- **The Counting Room** (MANAGEMENT) opens with the Manager's Key (dropped by the Night 6 boss) or Foundations F6 (WAVE24 §3). The secret ending still unlocks the meta node *The Back Office* (§6.7, §11.3).

#### 3.7.8 House Improvements (pit-wide; Concession Desk)
| id | Name | Effect per level | Max | Price for level k (k = 1…) |
|---|---|---|---:|---|
| `imp_vault_lining` | Vault Lining | +1 % interest per Watch | 5 | 300 × 8^(k−1) |
| `imp_friendly_auditor` | Friendly Auditor | −3 % base quota | 5 | 1,000 × 10^(k−1) |
| `imp_token_dispenser` | Token Dispenser | +1 pull per Watch | 3 | 800 × 40^(k−1) |
| `imp_slow_clock` | Slow Clock | +15 s per Watch | 4 | 400 × 12^(k−1) |
| `imp_charm_pegs` | Extra Pegs | +1 charm peg | 3 | 600 × 30^(k−1) |
| `imp_pawn_bell` | Pawn Bell | +1 free Pawn reroll per visit | 3 | 250 × 15^(k−1) |
| `imp_lucky_draught` | Lucky Draught (luck aura) | +1 luck on all machines | 5 | 2,000 × 12^(k−1) |
| `imp_coin_magnet` | Coin Magnet | +2 % (A) all payouts; tray coins auto-fly to you within 6 m | 5 | 1,500 × 9^(k−1) |
| `imp_brighter_bulbs` | Brighter Bulbs (lighting) | Dread −8; minimum light level +10 % | 4 | 200 × 20^(k−1) |
| `imp_velvet_stools` | Velvet Stools | Tilt grace +1 on all machines | 2 | 3,000 × 50^(k−1) |
| `imp_staff_quarters` | Staff Quarters | Attendant and Shill rate +10 % | 10 | 1,000 × 4^(k−1) |
| `imp_second_window` | Second Window | Pawn Window +1 regular slot | 2 | 1,500 × 40^(k−1) |

Pull bonuses from all sources are hard-capped at **+7 per Watch** (§3.11).

#### 3.7.9 Holdings and Assessment (the House taxes what you build)
- **Holdings** += the price of every tycoon purchase: upgrades, staff hires and levels, Machine Orders, House
  Improvements, wing purchases. Charms, tonics and deposits do **not** count.
- After every Dawn Collection: Holdings × 0.75 (depreciation 25 % per Night).
- **Assessment(n) = round(0.08 × Holdings)** at Night start, from Night 3. It is added to the quota (§2.6.2) and printed on
  the terminal.
- Effective lifetime tax ≈ 32 % of every tycoon coin. An upgrade must earn back ≈ 1.3× its price over the rest of the run,
  so late-run upgrades are taxed less.
- Overrides: the call H34 The Landlord (a 5 % payment waives the next Assessment) and charm `property_deed` (rate 8 % → 4 %).

#### 3.7.10 Data-driven generation (Haiku-owned data; no hand-written upgrade list)
- Files:
  - `src/game/data/tycoon/tracks.ts`: 6 templates (B, G, max, effect fn id, milestone table ref);
  - `src/game/data/tycoon/devices.ts`: 39 rows (size, tier, Y, patronRate, disabledTracks, milestones[4]);
  - `src/game/data/tycoon/improvements.ts`: 12 rows;
  - `src/game/data/tycoon/orders.ts`.
- Upgrade definitions are **generated** as `templates × devices × levels`: 39 types × 6 tracks × up to 100 levels ≈ 9,500
  distinct (type, track, level) entries. Across 75 placeable slots (78 with the Counting Room) there are > 35,000 purchasable instance-levels per run.
- Example generated entry (JSON, what the panel renders):

```json
{ "id": "upg.WELL-01.payout.25", "instance": "WELL-01", "device": "bigone", "track": "payout", "level": 25,
  "cost": 1590, "effects": [{ "hook": "payout.mult", "mode": "M", "value": 1.59 },
  { "hook": "bigone.extraPattern", "value": "CORNERSTONE" }], "i18n": "upg.payout.milestone.bigone.25" }
```

### 3.8 Buffs, debuffs and global events (Addendum 3)

#### 3.8.1 Rules
- Every buff is data: `{ id, kind: 'buff'|'debuff', icon (8×8 px), colour, scope: 'player'|'instance'|'team'|'pit',
  stacks, maxStacks, duration: { s?|plays?|watches?|night? }, hooks: [{ hook, mode: 'A'|'M'|'add'|'refund', value }] }`.
- Buffs fold into the same modifier pipeline as charms: `run.getModifier(hook, machineId, base, pid)` and §3.3.
  - A-bonuses add; M-factors multiply.
  - Luck adds, then is clamped to [−30, 30].
  - The same id refreshes its duration and adds a stack up to `maxStacks`.
- **HUD buff bar** (§10.1): 12×12 icons with a stack digit and a radial timer; debuffs get a red frame.
- Hover in the pause Ledger shows exact numbers.
- Host-owned in MP: `buff.add` / `buff.remove` events.

#### 3.8.2 Buff catalogue (ids are `buff.<id>`)
| id | Source | Effect | Duration | Max stacks |
|---|---|---|---|--:|
| `favoured` | Overpay ≥ 1.25 | All payouts +10 % (A) | Watch 1 of next Night | 1 |
| `hot:<id>` | Heat ≥ 60 | +10 % (A) on that instance | while Heat ≥ 60 | 1 |
| `overheat:<id>` | Heat 100 | catalogue device effect / default +10 % (M), luck −5 | 3 plays | 1 |
| `bad_run` | 5 consecutive losing plays | Whispers; luck +2 on your next play (pity), then clears | 1 play | 1 |
| `scorched` | devilstable blackout | luck −10 (catalogue) | 5 plays | 1 |
| `omen.<n>` (full id `buff.omen.<n>`, n = 0–21) | fortuneteller (22 cards, MACHINES_tables §14.3) | per catalogue (e.g. The Lantern luck +5 for 5 plays; The Debtor quota +2 %) | per card | 1 each |
| `song.<id>` | Jukebox (§6.9) | per song | rest of the current Watch | 1 (one song at a time) |
| `tonic.<id>` | Tonic machine (§3.8.3) | per tonic | per tonic | per tonic |
| `blessing_steady_hand` | Moth Shrine | Tilt grace +2 | this Watch | 1 |
| `blessing_open_purse` | Moth Shrine | +15 % (A) | next 3 wins | 3 |
| `blessing_quiet` | Moth Shrine | Dread −15 | this Watch | 1 |
| `blessing_far_sight` | Moth Shrine | next Watch's Lamps revealed now | until Bell | 1 |
| `curse_heavy_pockets` | Moth Shrine | walk / sprint −15 % | this Watch | 1 |
| `curse_sour_luck` | Moth Shrine, H31 | luck −4 | 6 plays | 2 |
| `curse_tithe` | Moth Shrine | next win −25 % (M) | 1 win | 1 |
| `curse_attention` | Moth Shrine | a Collector sighting is guaranteed this Watch; Dread +15 | this Watch | 1 |
| `static_charge` | H12 Static | +25 % (A) | next 3 plays | 3 |
| `marked` | H33 failed | luck −3 | until Dawn | 1 |
| `hungry:<id>` | charm `gluttons_bib` | your first play there each Watch pays 0 | Watch | 1 |
| `out_of_order:<id>` | charm `cracked_mirror`, H36 | instance unplayable / staff suspended | Watch | 1 |
| `aura_company` | Co-op: within 4 m of a living teammate | luck +1 per teammate in range | while in range | 3 |
| `ghost_whisper` | Co-op ghost gift | +20 % (A) | next play | 1 |
| `ghost_bless` / `ghost_curse` | Versus ghosts | +20 % (A) next play / Tilt +2 pulls on current instance | 1 play / Watch | 1 |
| `event.<id>` | Global events (§3.8.4) | per event | per event | 1 |

#### 3.8.3 The Apothecary (tonic vending machine, Lobby, from Night 3)
- Four of the eight tonics are offered per intermission (restock, seed stream `shop`).
- Max **3 tonics per Watch** per player. Bought with E + 1/2/3/4. The bottle drops with a clunk and your viewmodel drinks
  it in 1.2 s.

| id | Name | Price | Effect | Duration |
|---|---|---|---|---|
| `tonic.black_coffee` | Black Coffee | 5 × SI | +20 s on this Watch's clock (max 1 per Watch) | instant |
| `tonic.lucky_mint` | Lucky Mint | 1 Ticket | luck +3 | 5 plays |
| `tonic.cursed_candy` | Cursed Candy | free | 50 %: luck +8 for 5 plays · 50 %: luck −5 for 5 plays and Dread +10 | 5 plays |
| `tonic.jolt_cola` | Jolt Cola | 3 × SI | walk / sprint +20 %; your seated animations ×0.8 (local only) | 60 s |
| `tonic.smelling_salts` | Smelling Salts | 4 × SI | Dread −25 | 60 s |
| `tonic.brass_lozenge` | Brass Lozenge | 2 Tickets | next losing play refunds 50 % | next loss |
| `tonic.ginger_tonic` | Ginger Tonic | 6 × SI | Tilt grace +1 | this Watch |
| `tonic.gold_leaf_water` | Gold-Leaf Water | 15 × SI | next win ≥ ×5 pays ×1.5 (M) | next such win |

#### 3.8.4 Global events (host roll at Bell, seed stream `events`; from Night 4)
- Chance per Watch: 35 % (N4–N5), 50 % (N6+). Never in the last Watch of Night 8.
- The House announces each event over the PA. The quota board shows its icon.

| id | Name | Weight | Duration | Effect |
|---|---|--:|---|---|
| `happy_hour` | Happy Hour | 20 | 60 s | All payouts +20 % (A); bulbs warm `#FFC861`; the jukebox switches to swing |
| `blackout` | Blackout | 15 | 20 s | All lights off except machine screens, rail meters and phase lamps; dealer automata eyes glow `#FF2A2A`; luck +3 on plays committed in the dark; mannequins may relocate; Dread +10 |
| `full_moon` | Full Moon | 10 | whole Watch | Luck +5 for all; Dread +15; a white disc shows through the clerestory grilles; devilstable bargain also offered at k = 2 (catalogue) |
| `audit` | Audit | 12 | whole Watch | `table.limitMult` ×0.5, rake / commission +1 pp; if you deposit ≥ 25 % of quota during it, next Night's Assessment −50 % |
| `rush_hour` | Rush Hour | 15 | 60 s | Attendant income ×2; patrons fill every free seat |
| `power_surge` | Power Surge | 10 | 45 s | All machine durations ×0.67; Tilt counts only every 2nd pull |
| `cold_snap` | Cold Snap | 8 | whole Watch | +1 extra Cold Lamp; Cold Lamps pay ×1.0 (grading bonus kept) |
| `jackpot_fever` | Jackpot Fever | 5 | 60 s | `jackpotChance` ×3 on every device; bigone meter feed ×2 |
| `the_long_bell` | The Long Bell | 5 | instant | +20 s on this Watch's clock |

#### 3.8.5 The Moth Shrine (Parlour, PAR-SHRINE; from Night 4)
- Light a candle for `max(5 × SI, 5 % of pocket)`, once per Watch per player.
- 70 %: a random blessing (`blessing_*`, equal weights). 30 %: a random curse (`curse_*`, equal weights).
- Charm `votive_candle` makes it 85 / 15. The candle stays lit (one flame per candle lit this run, max 64).

### 3.9 Big numbers and formatting
- Plain JS numbers (safe to 1e308; above 2^53 the dust accumulator is skipped, per MACHINES_tables §1.1).
- Display: integers below 100,000 are shown in full with separators (EN `99,999`, TR `99.999`). Above that, 3 significant
  digits plus a suffix (`123K`, `1.23M`, `12.3B`).
- Suffixes:
  - EN: `K M B T Qa Qi Sx Sp Oc No Dc`.
  - TR: `B Mn Mr Tn Ka Kn Sk Sp Ok No Dc` (bin, milyon, milyar, trilyon, katrilyon, kentilyon…).
  - Beyond Dc: `1.23e36`.
- One formatter `fmt(n, locale)` is used everywhere (HUD, diegetic screens via canvas, chips per MACHINES_tables §1.1).

### 3.10 Sources and sinks (per Night, median player, as % of that Night's quota)
| Flow | Coins | Tickets |
|---|---|---|
| Machine net (after charms, before interest) | +20 … +100 % | — |
| Interest | +10 … +30 % | — |
| Punch lines (N2+) | +10 … +30 % | +4 … 8 |
| Staff income | 0 % (N1–N2) → +10 … +60 % (N6+) | — |
| Unused pulls / Settle Early / overpay | — | +2 … 12 |
| Charms bought (1–3) | −5 … −20 % | — |
| Tycoon investment | −10 … −40 % | — |
| Assessment (raises the quota) | +3 … +12 % of base | — |
| Rerolls, pulls bought, songs, tonics | small | −3 … −10 |

### 3.11 Anti-degenerate rules
1. **Tilt** kills camping; **Heat** rewards a 4–6 pull stay, not a 20-pull one.
2. The **dampener** halves additive bonuses on even-money wins. Bonuses never touch losses, pushes or partial refunds.
3. **Activity clause** (≥ 3 pulls) and the **interest ceiling** (2 × quota) stop "deposit and idle".
4. **Withdrawal cut 15 %** is greater than every deposit bonus (`wax_seal` 3 %), so there are no deposit/withdraw loops.
5. **Pull bonuses** are hard-capped at **+7 per Watch** from all sources combined. Ticket → pull at 3 : 1, max +2 per
   Watch.
6. **Charm sell value** is 50 % of the price paid; machine order sell-back is 30 %. Prices are SI-indexed, so early-buy
   arbitrage is impossible.
7. **House Limit** 5 × quota per play; per-play factor guard `(1 + A) × M ≤ 1,000`.
8. **Martingale guard**: ladder caps, Tilt and pulls bound any doubling chain to ≤ 4 effective steps per instance per Watch.
9. **Determinism**: stream-indexed RNG per instance. Separate streams for `shop`, `phone`, `lamps`, `card`, `events`,
   `collector`, `world`, `shill`, `bounty`. Reloads and quit-outs change nothing.
10. **Card counting** is allowed (skill), capped by blackjack's ladder and its 75 % penetration (catalogue).
11. **Staff**: Attendant income ignores Payout upgrades (base edge via Y). Shills ignore charms, Lamps, Tilt and buffs.
    Neither runs during untimed SP intermissions. Offline credit: max 600 s at 25 %, once per Night.
12. **Assessment + depreciation** tax snowballing. Holdings are visible at all times on the terminal.
13. **Versus**: no coin transfers. Rent (§7.3) is paid by the House, not by rivals. **Co-op**: transfers are free;
    shared-deposit withdrawals need a vote.
14. **Skill machines**: perfect-play RTP ≤ 1.25 before charms (catalogue mechanisms), low caps.
15. **Free Casino** never counts toward Obols, unlocks or achievements (social achievements excepted).

### 3.12 Balance targets and simulation (`tools/sim/run.mjs`, Haiku-owned)
- 100,000 headless runs per policy:
  - **Naive**: random machine, mid bets, no tycoon.
  - **Median**: greedy on card and Hot Lamp, buys suit charms, upgrades its 2 most-played machines with 25 % of surplus.
  - **Expert**: route planner, affinity builds, Settle Early.
  - **Tycoon**: invests 35–60 % of surplus, staffs one machine per Night from N2.

| Policy | N1 pass | N2 | N3 | N4 | N5 | N6 | N7 | N8 (win) |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Naive | 75 % | 45 % | 22 % | 9 % | 3 % | 1 % | < 1 % | < 0.5 % |
| Median | 88 % | 74 % | 58 % | 44 % | 33 % | 25 % | 19 % | 15 % |
| Expert | 97 % | 93 % | 87 % | 79 % | 70 % | 62 % | 56 % | 50 % |
| Tycoon | 90 % | 80 % | 68 % | 58 % | 50 % | 43 % | 38 % | 34 % |

- **Tycoon targets at Topside (Median)**:
  - 2 machines at Payout L25–40;
  - 3–5 Attendants, 2–4 Machine Orders, 4–6 improvement levels;
  - Holdings 0.5–1.5M;
  - staff income = 20–40 % of the N8 quota.
- **Overdrawn**: Payout L100 on one instance ≈ N13 (1.02B quota); quotas pass 1T at N18.
- **Knobs, in this order**: base quota table, Assessment rate, House Favour, track B/G values, line bounty %, interest
  table, charm prices, rarity odds, Y table.
- Machine RTPs are never tuned by the economy.

---

## 4. Charms

### 4.1 Rules
- **Charm Board**: a pegboard `#4A3A28` (1.6 × 1.0 m) in the Lobby beside the Pawn Window. Bought charms hang on its brass
  pegs and also show as 16×16 px icons on the HUD.
  - Pegs: start 6; +3 from House Improvements, +1 per favour F05; in-run cap **9**; meta cap 10.
  - A charm rattles on the board when it triggers.
- **Pawn Window** (the shop; the Pawnbroker's ringed hands under a grille) opens only in intermissions. Slots:
  - **4 slots** = 3 regular + 1 "under the counter" (from Night 2: Rare+ or Cursed, 50/50).
  - Reroll: 1 Ticket, then +1 per further reroll in the same intermission.
  - Lock one item for the next visit: 1 Ticket.
  - **Remove a cursed charm**: 5 Tickets.
- **Rarity odds (regular slots)**:

| Night | Common | Uncommon | Rare | Legendary |
|---|--:|--:|--:|--:|
| 1 | 75 % | 25 % | 0 % | 0 % |
| 2 | 65 % | 28 % | 7 % | 0 % |
| 3–4 | 52 % | 33 % | 15 % | 0 % |
| 5–6 | 40 % | 35 % | 21 % | 4 % |
| 7+ | 35 % | 35 % | 24 % | 6 % |

- **Price** = `base × SI`, rounded to 2 significant figures.
  - Selling pays 50 % of the price paid (70 % with `pawn_ticket`).
  - Cursed charms pay *you* a sign-on fee (negative price) and cannot be sold. They leave only through H16 The Exorcist,
    `holy_water`, or the 5-Ticket Pawn service.
- **Stacking**: duplicates are never offered. A-bonuses add; M-factors multiply (§3.3).
- **Hook namespaces**:
  - catalogue globals: `payoutMult` (A or M), `luckBonus`, `betRefundOnLoss`, `actionCostDelta`, `freePlayChance`,
    `jackpotChance`, `nearMissRefund`, `onCommit`, `onOutcome`, `onTag:<tag>`;
  - catalogue device hooks `<id>.<hook>` and table hooks `table.*`;
  - GDD economy hooks:
    - run / econ: `run.pullsAdd`, `run.clockAdd`, `econ.interestAdd`, `econ.depositBonus`, `econ.onDeposit`,
      `econ.onSettle`, `econ.onCollect`, `econ.onAscend`, `econ.quotaAdd`;
    - Circuit: `tilt.grace`, `tilt.*`, `lamp.hotMult`, `lamp.hotCount`, `lamp.coldMult`, `card.onPunch`, `card.lineBonus`,
      `card.punchExtra`, `card.suitWildcard`, `heat.gainMult`;
    - shop / phone / world: `shop.*`, `phone.*`, `bell.on`, `bet.maxStep`, `world.openWing`;
    - tycoon / buffs / horror: `tycoon.costMult`, `tycoon.staffMult`, `tycoon.orderMult`, `tycoon.assessRate`, `buff.*`,
      `dread.add`.
- **Unlock codes**:
  - `—` = available from the first run.
  - `N3` = pay Night 3 once.
  - `W` = win a run.
  - `F3` = fall 3 times.
  - `A:<id>` = an achievement (§11.7).
  - `D` = Descend once.

### 4.2 Charm table (100 charms: 22 C · 37 U · 22 R · 8 L · 11 cursed)
Price = base × SI.

| # | id | Name | Rar | Base | Tag | Effect (precise) | Hooks | Unl. |
|--:|---|---|:-:|--:|---|---|---|---|
| 1 | `brass_thimble` | Brass Thimble | C | 8 | REELS | +15 % (A) on REELS machines | payoutMult (A) | — |
| 2 | `billiard_chalk` | Billiard Chalk | C | 8 | CARDS | +15 % (A) on CARDS machines | payoutMult (A) | — |
| 3 | `loaded_pip` | Loaded Pip | C | 8 | DICE | +15 % (A) on DICE machines | payoutMult (A) | — |
| 4 | `greased_axle` | Greased Axle | C | 8 | WHEELS | +15 % (A) on WHEELS machines | payoutMult (A) | — |
| 5 | `lead_shot` | Lead Shot | C | 8 | DROPS | +15 % (A) on DROPS machines | payoutMult (A) | — |
| 6 | `glass_eye` | Glass Eye | C | 8 | CURIOS | +15 % (A) on CURIOS machines | payoutMult (A) | — |
| 7 | `piggy_tooth` | Piggy Tooth | C | 10 | LEDGER | +1 % interest per Watch | econ.interestAdd | — |
| 8 | `wax_seal` | Wax Seal | C | 6 | LEDGER | Every deposit adds a bonus of 3 % of the amount deposited | econ.depositBonus | — |
| 9 | `spare_token` | Spare Token | C | 12 | — | +1 pull per Watch | run.pullsAdd | — |
| 10 | `cracked_watch` | Cracked Pocket Watch | C | 8 | — | +20 s on every Watch clock | run.clockAdd | — |
| 11 | `stub_spike` | Stub Spike | C | 8 | — | +1 extra Ticket whenever a punch-card cell is punched | card.onPunch | N2 |
| 12 | `worn_glove` | Worn Glove | C | 10 | — | Tilt starts 2 pulls later on every machine | tilt.grace +2 | — |
| 13 | `polished_molar` | Polished Molar | C | 8 | REELS | The Big One TOOTH value 1 → 2; Bandit SHOE pays +1 per credit | bigone.symbolValueAdd[TOOTH], bandit.symbolPayAdd[SHOE] | — |
| 14 | `dealers_button` | Dealer's Button | C | 10 | CARDS | Blackjack naturals pay 2:1; Baccarat commission −5 pp | blackjack.bjPayAdd +0.5, table.rakeDelta −0.05 (baccarat) | — |
| 15 | `felt_square` | Felt Square | C | 8 | CARDS | Losing CARDS plays refund 10 % of the stake | betRefundOnLoss 0.10 | — |
| 16 | `rusty_key` | Rusty Key | C | 10 | — | 1 free Pawn reroll per intermission | shop.freeRerolls | — |
| 17 | `chipped_die` | Chipped Die | C | 8 | DICE | Coin-Flip Booth and Dice Tower: losing plays refund 15 % | betRefundOnLoss 0.15 | — |
| 18 | `tin_whistle` | Tin Whistle | C | 8 | — | Phone rings 16 s instead of 10 s; +1 Ticket per answered call | phone.ringTime, phone.onAnswer | — |
| 19 | `consolation_ribbon` | Consolation Ribbon | C | 8 | — | Plays tagged `nearmiss` refund 50 % of the stake | nearMissRefund 0.5 | — |
| 20 | `lucky_receipt` | Lucky Receipt | C | 8 | LEDGER | Wins ≥ ×10 print +1 Ticket (max 3 per Watch) | onTag:bigwin | — |
| 21 | `night_light` | Night-Light | C | 6 | — | Dread −10 while held | dread.add −10 | — |
| 22 | `receipt_roll` | Receipt Roll | C | 8 | LEDGER | Each deposit ≥ 10 % of quota prints a free PIT PENNY scratch card at the current SI (max 3 per Night) | econ.onDeposit | N2 |
| 23 | `moth_lantern` | Moth Lantern | U | 18 | REELS | The Big One gains GHOST (wild) at weight 4 | bigone.symbolWeight[GHOST] +4 | — |
| 24 | `hot_coal` | Hot Coal | U | 16 | — | Hot Lamp ×1.5 → ×2.0; +1 Hot Lamp per Watch | lamp.hotMult, lamp.hotCount | N2 |
| 25 | `snake_eye_ring` | Snake-Eye Ring | U | 18 | DICE | Each die showing 1 in a DICE result adds +0.5 × stake to that play (even on losses) | onOutcome | — |
| 26 | `counting_bead` | Counting Bead | U | 20 | CARDS | Blackjack, Baccarat, War Table and Red Dog show running and true count on a brass bead counter (Hi-Lo draws are independent, so it has no count) | table.shoeInfo | — |
| 27 | `chain_link` | Chain Link | U | 18 | — | +10 % (A) per consecutive winning play (any machine), max +50 %; any loss resets | onTag:win / loss | — |
| 28 | `apology_card` | Apology Card | U | 16 | — | After 3 consecutive losing plays, your next winning play is ×2 (M) | onTag:loss | — |
| 29 | `ledger_pen` | Ledger Pen | U | 20 | LEDGER | Each completed punch line gives +2 % interest (not +1 %) and +2 Tickets | card.lineBonus | N2 |
| 30 | `circuit_breaker` | Circuit Breaker | U | 18 | — | +12 % (A) if this play's suit differs from your previous play's suit | onCommit | — |
| 31 | `velvet_rope` | Velvet Rope | U | 20 | CURIOS | Devices with actionCost 2 (claw, stacker, devilstable, shellgame, bingopin) cost 1 pull | actionCostDelta −1 | — |
| 32 | `bent_nail` | Bent Nail | U | 18 | DROPS | luck +8 on DROPS machines | luckBonus | — |
| 33 | `tin_jockey` | Tin Jockey | U | 16 | CURIOS | Derby: solo draws, your Win pick strength +25 %; shared draws, your printed odds +15 % | derby.runnerWeight[lane], derby.oddsBonus | N3 |
| 34 | `sappers_badge` | Sapper's Badge | U | 18 | CURIOS | Once per Watch: the first mine hit on Mines or the first fall below ×2.0 on The Elevator refunds 100 % | mines.insurance, onTag:bust | — |
| 35 | `magnet_coin` | Magnet Coin | U | 20 | DROPS | Claw magnet ×3; Coin Pusher gold-coin chance +2 % | claw.magnet, coinpusher.goldCoin | — |
| 36 | `night_owl` | Night Owl | U | 16 | — | During Last Call, payouts +40 % (A) | payoutMult (A) | — |
| 37 | `spare_number` | Spare Number | U | 20 | DROPS | Keno +1 private number; Lotto Blower +1 private ball; Bingo counts +3 balls; Tombola 1 `doublePull` per Watch | keno.extraNumber, lottoblower.extraBall, bingo.ballCountAdd, tombola.doublePull | N2 |
| 38 | `false_bottom` | False Bottom | U | 22 | LEDGER | At Dawn, if short by ≤ 10 % of the quota, the shortfall is forgiven and this charm breaks | econ.onCollect | — |
| 39 | `long_thumbnail` | Long Thumbnail | U | 16 | REELS | Scratch cards cost −20 % and one zone per card glows before scratching | scratch.discount, scratch.xray | N2 |
| 40 | `metronome` | Metronome | U | 18 | WHEELS | luck +10 on timing devices (cyclone, pachislot, stacker) | luckBonus | N3 |
| 41 | `red_thread` | Red Thread | U | 16 | — | The first instance you play each Watch: Tilt grace +3 and +10 % (A) | tilt.grace, payoutMult (A) | — |
| 42 | `cold_hands` | Cold Hands | U | 16 | — | Cold Lamp ×0.75 → ×1.00 (tier-up grading kept) | lamp.coldMult | N3 |
| 43 | `croupiers_rake` | Croupier's Rake | U | 18 | WHEELS | Roulette outside bets +20 % (A); Big Six HOUSE is a push | payoutMult (A), bigsix.houseShield | — |
| 44 | `weighted_cup` | Weighted Cup | U | 18 | DICE | Sic Bo three-match +2; Craps hardways +2 | sicbo.singleTripleAdd, craps.hardwayPayAdd | N3 |
| 45 | `brass_washer` | Brass Washer | U | 20 | — | 15 % chance a play costs 0 pulls (tag `free`) | freePlayChance 0.15 | — |
| 46 | `muzzle` | Muzzle | U | 18 | REELS | The Big One curse chance ×0.5; EATEN spins refund 50 % | bigone.curseChanceMult, onTag:curse | N2 |
| 47 | `brass_alarm` | Brass Alarm Bell | U | 18 | — | Each Bell: +1 Ticket and +4 × SI coins | bell.on | — |
| 48 | `porcelain_pig` | Porcelain Pig | U | 18 | LEDGER | Each Bell: +4 % of pocket (cap 40 × SI) | bell.on | N2 |
| 49 | `bargain_coupon` | Bargain Coupon | U | 14 | — | The first charm you buy each intermission costs −30 % | shop.discountFirst | — |
| 50 | `votive_candle` | Votive Candle | U | 16 | — | Moth Shrine odds 85 / 15; while Dread ≥ 50: luck +3 | buff.shrineOdds, luckBonus | N4 |
| 51 | `dowsing_rod` | Dowsing Rod | U | 18 | CURIOS | Mines: one safe tile marked at commit; Shell Automaton palm glint +2 frames | mines.scanner, shellgame.glintFrames | N3 |
| 52 | `pawn_ticket` | Pawn Ticket | U | 12 | — | Charms sell for 70 % of the price paid | shop.sellMult | — |
| 53 | `holy_water` | Holy Water Flask | U | 20 | — | Consumable: use it on the Charm Board (E) to remove one cursed charm; then it breaks | charms.remove | F3 |
| 54 | `foremans_whistle` | Foreman's Whistle | U | 20 | TYCOON | Attendant income +25 % | tycoon.staffMult | N2 |
| 55 | `ledger_of_leases` | Ledger of Leases | U | 18 | TYCOON | Upgrade costs −10 % | tycoon.costMult | — |
| 56 | `grand_opening` | Grand Opening Ribbon | U | 16 | TYCOON | Machine Orders −25 %; each new machine is Hot (×1.5, no Tilt) for its first Watch | tycoon.orderMult, lamp.hot | N4 |
| 57 | `heat_lamp` | Heat Lamp | U | 16 | — | Heat gain ×1.5; Overheat effects ×2 | heat.gainMult | N2 |
| 58 | `tonic_belt` | Tonic Belt | U | 14 | — | +1 tonic per Watch; tonic durations ×1.5 | buff.tonicMax, buff.durationMult | N3 |
| 59 | `mirror_shard` | Mirror Shard | U | 18 | — | Each horror event (flicker burst, blackout, Collector sighting, H28 Breathing) pays 5 × SI | onDreadEvent | N4 |
| 60 | `seven_floor_key` | Seven-Floor Key | R | 45 | LEDGER | In the last Watch of each Night, interest is applied twice | econ.onSettle | N3 |
| 61 | `sun_dial` | Sun Dial | R | 50 | REELS | The Big One SUN weight +4; `jackpotChance` ×2 on REELS; Big One meter feed 1 → 2 % | bigone.symbolWeight[SUN], jackpotChance, bigone.jackpotFeed | — |
| 62 | `mirror_shoe` | Mirror Shoe | R | 45 | CARDS | +1 peek charge on every CARDS table (blackjack hole card, baccarat first card, war card, hi-lo lamp, three-card dealer card, red-dog ears); Video Poker shows the first replacement card | table.peekCharges +1, videopoker.peekCard | N4 |
| 63 | `hollow_dice` | Hollow Dice | R | 40 | DICE | Sic Bo +1 `cageShake` per roll; Craps one seven-out shield per shooter; Coin-Flip: re-flip once, the re-flip pays ×0.8 (M) | sicbo.cageShake, craps.sevenOutShield, coinflip.reflip | N3 |
| 64 | `golden_ratchet` | Golden Ratchet | R | 45 | WHEELS | After a Roulette / Big Six / Cyclone result, pay 25 % of the stake to click it one position clockwise (once per play) | GDD hook `wheel.nudge` (ModHook `x.wheel.nudge`), implemented by roulette, bigsix and cyclone (MACHINES_tables §1.6a; distinct from the catalogue's charge-based `bigsix.nudge`) | N4 |
| 65 | `glass_funnel` | Glass Funnel | R | 40 | DROPS | Plinko +1 free puck per drop; Pachinko sweet zone ±10 %; Bingo Pinball centre cell starts lit | plinko.extraPuck, pachinko.sweetWiden, bingopin.freeSpace | N4 |
| 66 | `ringmasters_whistle` | Ringmaster's Whistle | R | 45 | — | Each distinct suit you **win** on this Watch adds +15 % (A) to all payouts for the rest of the Watch (max +90 %) | onTag:win | — |
| 67 | `collectors_tag` | Collector's Tag | R | 40 | LEDGER | Each Night paid after purchase permanently adds +10 % (A) to all payouts | econ.onCollect | N4 |
| 68 | `long_shot` | Long Shot | R | 45 | — | Plays with base mult ≥ 20 pay ×2 (M) | payoutMult (M) | — |
| 69 | `coiled_cord` | Coiled Phone Cord | R | 35 | — | Random-call chance 60 % → 100 % per Watch; phone deal costs −25 % | phone.* | N2 |
| 70 | `house_keys` | House Keys | R | 50 | — | On purchase: open one closed wing of your choice (never the Parlour or Counting Room); +10 % (A) on that wing's machines | world.openWing | N5 |
| 71 | `tilt_switch` | Tilt Switch | R | 40 | — | Your most-played instance this Watch ignores Tilt; every other instance's Tilt factors become ×0.75 / ×0.55 / ×0.35 | tilt.* | A:tilted |
| 72 | `brass_knuckles` | Brass Knuckles | R | 40 | CURIOS | Stacker +1 block width rows 1–5; Claw +4 s; Shell Automaton swaps ×0.8 speed | stacker.extraBlock, claw.timer, shellgame.swapSlow | N3 |
| 73 | `high_rollers_cufflink` | High Roller's Cufflink | R | 45 | — | Every max bet is one ladder step higher | bet.maxStep +1 | N4 |
| 74 | `photo_negative` | Photo Negative | R | 45 | — | Losing plays have a 7 % chance to invert: pay ×2 the stake (tag `charm`) | onTag:loss | W |
| 75 | `tote_ticket` | Tote Ticket | R | 35 | WHEELS | Derby, Big Six and Roulette show the last 10 results; their ≥ ×10 bets pay +25 % (A) | derby.longshotBonus, payoutMult (A) | — |
| 76 | `cuckoo_feather` | Cuckoo Feather | R | 40 | — | After each Bell, your next winning play is ×2 (M) | bell.on, payoutMult (M) | N3 |
| 77 | `blueprint` | Blueprint | R | 40 | TYCOON | Each wing opened after purchase: one random instance there starts at Payout L5 and Speed L5 (not added to Holdings) | world.onWingOpen | N3 |
| 78 | `brass_plaque` | Brass Plaque | R | 40 | TYCOON | Instances at Payout ≥ L25 give you luck +2 there | luckBonus | N5 |
| 79 | `shill_contract` | Shill Contract | R | 35 | TYCOON | Shill stake 1 % → 2 % of max bet; Shill hires −50 % | tycoon.shillStake, tycoon.costMult | N4 |
| 80 | `altimeter` | Altimeter | R | 40 | — | +2 % (A) on all payouts per floor climbed this run (B6 +2 % … G +14 %; Overdrawn caps at +14 %) | payoutMult (A) | N3 |
| 81 | `elevator_token` | Elevator Token | R | 35 | LEDGER | At every Ascent, gain 5 % of pocket (max 300 × SI) | econ.onAscend | N2 |
| 82 | `crown_of_coins` | Crown of Coins | L | 100 | — | All payouts ×1.5 (M) | payoutMult (M) | N5 |
| 83 | `perpetual_ledger` | Perpetual Ledger | L | 90 | LEDGER | Pocket coins also earn interest at half the current rate (activity clause applies; no ceiling for pocket) | econ.onSettle | W |
| 84 | `engravers_plate` | Engraver's Plate | L | 100 | REELS | The Big One unlocks TWIN RAILS and CORNERSTONE; every pattern multiplier +1 | bigone.extraPattern, bigone.patternMult | N6 |
| 85 | `operators_glove` | Lift Operator's Glove | L | 100 | — | +2 pulls and +30 s per Watch; Settle Early rewards doubled | run.pullsAdd, run.clockAdd | W |
| 86 | `card_of_all_suits` | Card of All Suits | L | 110 | — | Every machine counts as every suit for punch cells and affinity | card.suitWildcard | A:full_circuit |
| 87 | `blackout_lamp` | Blackout Lamp | L | 90 | — | Each punch also punches one random orthogonally adjacent unpunched cell | card.punchExtra | A:blackout |
| 88 | `property_deed` | Property Deed | L | 95 | TYCOON | Assessment rate 8 % → 4 %; Holdings depreciate 40 % per Night instead of 25 % | tycoon.assessRate | D |
| 89 | `rope_ladder` | Rope Ladder | L | 90 | — | Once per run, when the floor opens you catch a ladder: an Overtime Watch (5 pulls, 90 s, no interest); then this charm is destroyed | econ.onCollect | N6 |
| 90 | `wet_ledger` | Wet Ledger | X | −25 | — | Interest −3 % (floor 0 %) | econ.interestAdd | F3 |
| 91 | `sand_hourglass` | Sand Hourglass | X | −20 | — | Watch clock −40 s; +2 pulls per Watch | run.clockAdd, run.pullsAdd | F3 |
| 92 | `gluttons_bib` | Glutton's Bib | X | −30 | — | All payouts ×1.25 (M). At each Bell one random open instance becomes **Hungry** (red bib decal): your first play there each Watch pays 0 | payoutMult (M), buff.hungry | F3 |
| 93 | `unblinking_eye` | The Unblinking Eye | X | 0 | — | Current quota +4 % at the end of every Watch. Silver and Gold punches also punch one adjacent cell | econ.quotaAdd, card.punchExtra | F3 |
| 94 | `moth_swarm` | Moth Swarm | X | −15 | — | Pit lights −40 %, fog far −30 %. The Big One MOTH weight +10. Lamp beacons off: the Hot machine is marked only by circling moths | dread / world.light, bigone.symbolWeight[MOTH] | F3 |
| 95 | `gold_tooth` | Gold Tooth | X | −40 | — | +20 % (A) on all payouts; every play with mult ≥ 10 costs 1 extra pull (from the next play; can reach 0) | payoutMult (A), run.pullsAdd | F3 |
| 96 | `bent_lift_key` | Bent Lift Key | X | 0 | — | Night 8 base quota −25 %; all other future base quotas +10 % | econ.quotaAdd | W |
| 97 | `pawn_ticket_13` | Pawn Ticket No. 13 | X | −50 | — | Occupies a peg. Each intermission the Pawn Window offers one item "for you" at −50 % | shop.discountSlot | F3 |
| 98 | `cracked_mirror` | Cracked Mirror | X | −30 | — | All wins ×1.4 (M). At each Bell one random open instance per zone is `out_of_order` for the Watch | payoutMult (M), buff.out_of_order | F3 |
| 99 | `glass_heart` | Glass Heart | X | −20 | — | luck +8. After 6 consecutive losing plays it shatters: −25 % of pocket and the charm is destroyed | luckBonus, onTag:loss | F3 |
| 100 | `blank_jackid` | Blank JackID | X | 0 | — | "Your name is gone." +25 % (A) on all payouts. The House can no longer address you: no random calls, Deadline Call favours are drawn at random, subtitles show "—" for your name. Needed for the secret ending (§6.7) | payoutMult (A), phone.mute | A:all_tapes |

Count: 22 Common (1–22), 37 Uncommon (23–59), 22 Rare (60–81), 8 Legendary (82–89), 11 Cursed (90–100) = **100 charms**,
all original. Launch cut (v1.0): #1–60 plus 82–86 and 90–95 (71 charms). The rest ship in v1.1 without system changes.

### 4.3 Named synergies (builds the shop is tuned to surface)
| Build | Core charms | Machines | Fantasy |
|---|---|---|---|
| **The Engine Room** | Brass Thimble + Polished Molar + Moth Lantern + Sun Dial (+ Engraver's Plate): REELS affinity 4 (+50 %) | bigone, pachislot, bandit + Payout levels on WELL-01 | Classic slot monster. Tilt grace +2 lets you feed The Big One 6 pulls a Watch. |
| **The Circuit** | Circuit Breaker + Ringmaster's Whistle + Card of All Suits + Stub Spike | one pull on each suit | Rotate the floor; +90 % by mid-Watch; the card fills itself. |
| **The Banker** | Piggy Tooth + Wax Seal + Ledger Pen + Seven-Floor Key + Perpetual Ledger (LEDGER 4: +2 %) | grinders for activity, card for lines | Win by interest; the terminal becomes the jackpot. |
| **The Landlord** | Foreman's Whistle + Ledger of Leases + Shill Contract + Property Deed (TYCOON 4: staff +30 %, costs −10 %) | high-Y tables + one Payout-L25 engine | Own the floor; let the mannequins gamble for you. |
| **Bell Ringer** | Brass Alarm + Porcelain Pig + Cuckoo Feather + Elevator Token | any | Every Bell pays: Tickets, interest-like pocket growth, a ×2 win. |
| **Card Sharp** | Counting Bead + Mirror Shoe + Dealer's Button + Billiard Chalk | blackjack, hilo, videopoker, baccarat | Real skill, low variance; pair with Long Shot via Video Poker royals. |
| **Hot Hand** | Hot Coal + Red Thread + Worn Glove + Night Owl + Heat Lamp | whatever is lit | Chase beacons; ride Overheat. |
| **Dice Rat** | Loaded Pip + Snake-Eye Ring + Hollow Dice + Weighted Cup | craps, sicbo, dicetower | Snake-Eye Ring pays on losses: dice become a slow money printer. |
| **Long Odds** | Long Shot + Photo Negative + Apology Card + Glass Eye | lottoblower, devilstable, elevator, mines | Desperate, glorious, short-lived. |
| **Dread Eater** | Votive Candle + Mirror Shard + Moth Swarm (X) + Night-Light | any, in the dark | Profit from horror; the shrine becomes a slot machine. |
| **Cursed Contract** | Glutton's Bib + Gold Tooth + Unblinking Eye + Blackout Lamp | any | Start rich, play on a knife edge (achievement `cursed_proud`). |

---

## 5. The Hotline

### 5.1 Rules
- A red rotary phone in a wood-and-glass booth: wood `#5A2A18`, handset `#C0182A`, booth lamp `#FFD34A` flashing while it
  rings. Booth at MOUTH-PHONE; a second booth at LOB-PHONE2 is active in MP with ≥ 5 players.
- **Random calls**:
  - Each Watch: 60 % chance (`coiled_cord` 100 %), at a random time in [20 %, 75 %] of the clock.
  - Rings 10 s: 6 rings, 1.0 s on / 0.7 s off, dual sine 425 + 480 Hz, AM 20 Hz.
  - Answer with E on the handset. Options are keys **1 / 2 / 3** (or click the dial digit); 8 s to choose, otherwise
    declined. E hangs up.
  - The Watch clock keeps running while you talk.
  - Max 1 random call per Watch. Each event fires at most once per Night, except H02 and H07.
- **Scripted calls** (marked S) ring on top of the random budget.
- **Deadline Call**: guaranteed in the Night intermission after every paid Night. The House offers **3 Favours; pick 1**
  (permanent for the run).
- **Missed calls**: two missed random calls in a row force H29 on the next ring.
- **Voice**: subtitled formant babble (§6.10); every line is an i18n key `phone.<id>.*`. After H11 the House uses the name
  on your JackID.
- Weights below are relative within the eligible pool. "× SI" costs use the current SI.

### 5.2 Deadline Call favours (draw 3 without replacement; non-stackable ones leave the pool once taken)
| id | Favour | Effect | Stacks |
|---|---|---|---|
| F01 | Patron | +1 pull per Watch | ×2 |
| F02 | Overflow | Unused pulls convert to 2 Tickets each (not 1) | no |
| F03 | Favoured | +1 Hot Lamp per Watch | ×2 |
| F04 | Compound | +2 % interest per Watch | ×2 |
| F05 | Extra Peg | +1 charm peg (cap 9) | ×3 |
| F06 | Discount | Pawn Window prices −15 % | ×2 |
| F07 | Stamina | Tilt starts 1 pull later on every machine | ×2 |
| F08 | Feed the Pot | Big One JACKPOT meter +10 % of the quota now; REELS +5 % (A) | no |
| F09 | Long Night | +30 s per Watch | ×2 |
| F10 | Lean Month | Next Night's base quota −10 % | one-shot, repeatable |
| F11 | Wide Card | Next Night's card is one size larger (cap 5×5) | one-shot, repeatable |
| F12 | Second Opinion | Pawn Window +1 regular slot | no |
| F13 | Pocket Change | +2 Tickets now and +1 Ticket at every Bell | no |
| F14 | Wing Key | Open one more closed wing now (if any) | repeatable |
| F15 | Zoning Variance | Your next 10 upgrade levels cost −50 % | one-shot, repeatable |
| F16 | Head Office | +1 Attendant cap and your next hire is free | ×2 |
| F17 | Amnesty | Holdings ×0.5 now (Assessment relief) | one-shot, repeatable |

### 5.3 Calls (39 events; H10, H29, H33, H34, H38, H39 are scripted or forced)
| id | snake_id | Name | Trigger (eligibility) | W | Offer | Consequence |
|---|---|---|---|--:|---|---|
| H01 | `wrong_number` | Wrong Number | any | 10 | A voice asks for "Mr. Vell". [1] "Wrong number." [2] "Speaking." | [1] +1 Ticket. [2] 50 %: +8 × SI ¢; 50 %: a random cursed charm on a free peg (if none: −8 × SI ¢). Each answer plays one of 8 past-guest stories (CLOCK). |
| H02 | `the_tip` | The Tip | any | 12 | A whisper names one open instance | That instance is Hot (×1.5, no Tilt) for 60 s, on top of the Watch's Lamps. Free. |
| H03 | `loan_shark` | Loan Shark | start of the last Watch with deposit < 50 % of quota; or soft-lock (§2.8) | 20 | [1] Take 30 % of the quota now. [2] Decline. | [1] Pocket +30 % of quota; next Night's quota + 45 % of the loan. |
| H04 | `the_fixer` | The Fixer | derby open, N3+ | 6 | [1] Pay 20 × SI: "Lane 4 runs tonight." [2] Decline. | [1] Your next derby Win pick wins; 25 % Steward Inquiry: winnings voided and the derby closed for the Watch. |
| H05 | `double_or_nothing` | Double or Nothing | N2+ | 8 | A coin spins on a desk. [1] Call it. [2] Hang up. | [1] 50 %: pocket ×2; 50 %: pocket ×0.5. |
| H06 | `insurance_man` | Insurance Man | N3+ | 6 | [1] Pay 10 % of quota. [2] Decline. | [1] This Night, a failed Collection grants one Overtime Watch (5 pulls, 90 s, no interest) instead of the trapdoor; still short → trapdoor. |
| H07 | `service_technician` | Service Technician | an instance you played reached its 7th pull | 15 | [1] Pay 2 Tickets. [2] Decline. | [1] Tilt reset on all instances this Watch. |
| H08 | `room_service` | Room Service | any | 8 | "Coffee?" [1] Pay 5 × SI. [2] Decline. | [1] +30 s this Watch. |
| H09 | `the_pawnbroker` | The Pawnbroker | own ≥ 1 charm, N2+ | 8 | Offers 120 % of the price paid for one named charm. [1] Sell. [2] Keep. | [1] Charm removed, coins to pocket. |
| H10 | `lift_operator` | Lift Operator | any; guaranteed (S) in Night 7 Watch 2 | 6 | Free information | Shows next Night's quota, card size and (Overdrawn) next House Rule; +1 Ticket. |
| H11 | `the_census` | The Census | N1–N3 | 6 | "State your name." [1] Say it. [2] Hang up. | [1] +2 Tickets; next fortuneteller reading free. The House uses your JackID name in later lines. |
| H12 | `static` | Static | N4+ | 6 | Only breathing | Lights flicker 2 s; buff `static_charge` (next 3 plays +25 % (A)). |
| H13 | `rigged_wheel` | Rigged Wheel | a WHEELS machine open | 6 | [1] Pay 15 × SI. [2] Decline. | [1] Your next WHEELS result, if ±1 position from a winning position for your bet, moves onto it. |
| H14 | `hole_punch` | Hole Punch | N2+ | 8 | [1] Pay 3 Tickets. [2] Decline. | [1] Punch any unpunched Bronze or Silver cell of your choice. |
| H15 | `reprint` | Reprint | N2+, after Watch 1 | 6 | [1] Pay 2 Tickets. [2] Decline. | [1] All unpunched cells regenerate. |
| H16 | `the_exorcist` | The Exorcist | you hold a cursed charm | 25 | [1] Pay 25 × SI. [2] Decline. | [1] Remove one cursed charm of your choice (sign-on fee not refunded). |
| H17 | `raffle_winner` | Raffle Winner | any | 5 | "Stub 4417, you've won." | Next intermission one Pawn Window item is free (red stub on it). |
| H18 | `consolidation` | Consolidation | N4+ | 5 | [1] Consolidate. [2] Decline. | [1] Current quota −20 %; next Night's quota +35 %. |
| H19 | `overtime` | Overtime | last Watch, after 50 % of its clock | 10 | [1] Pay 30 % of pocket. [2] Decline. | [1] This Night gets one extra Watch (6 pulls, 120 s, interest applies). |
| H20 | `prank_caller` | Prank Caller | N2+ | 6 | Giggling | Hang up (E) within 3 s: +1 Ticket. Otherwise all instances' Tilt +1 pull this Watch. |
| H21 | `the_house_admires` | The House Admires You | N6+, once per run | 3 | "We admire you." [1] Accept. [2] Decline. | [1] A free Legendary now (replace a peg if full); Night 8 base quota +25 %. |
| H22 | `silent_partner` | Silent Partner | Versus, N2+ | 10 | [1] Pay 10 × SI and name a rival. [2] Decline. | [1] Rival's current quota +5 % (max once per target per Night). The rival sees "A silent partner has invested in you." |
| H23 | `lucky_numbers` | Lucky Numbers | lottoblower open | 5 | The caller reads 6 numbers | If you play the Lotto Blower this Watch with exactly those numbers, 2 of them are guaranteed drawn. |
| H24 | `mother_moth_calls` | Mother Moth Calls | fortuneteller open | 5 | "I've seen something." | Your next reading: Defy Fate is free and the first card is never a curse. |
| H25 | `party_line` | Party Line | Co-op | 10 | Speaker phone; all living players vote for 10 s. [1] Accept. [2] Decline. | [1] Every living player loses 1 pull this Watch; team deposit +10 % of quota. |
| H26 | `collect_call` | Collect Call | N5+ | 6 | "Will you accept the charges?" [1] Accept (pay 10 % of pocket). [2] Decline. | [1] 40 % random Uncommon charm · 35 % +3 Tickets · 20 % +1 pull now · 5 % the Collector visits (quota +5 %). |
| H27 | `tilt_whisperer` | Tilt Whisperer | N3+ | 5 | Free | Reveals next Watch's Cold Lamp and the suit of its first Hot Lamp. |
| H28 | `breathing` | Breathing | Dread ≥ 40 | 4 | Breathing, no words, no choice | Stay on the line 20 s: +1 Ticket and Dread +10. On hang-up the jukebox stops for 10 s and every Tilt bulb in the pit blinks once. |
| H29 | `missed_you` | Missed You | forced after 2 missed calls in a row | — | "You didn't pick up." [1] Pay 2 Tickets. [2] Refuse. | [2] Current quota +3 %. |
| H30 | `time_broker` | Time Broker | N2+ | 6 | [1] Buy 30 s for 8 % of quota. [2] Sell 30 s for 6 % of quota. [3] Hang up. | [1] +30 s this Watch. [2] Pocket +6 % of quota; clock −30 s now. |
| H31 | `curse_delivery` | Curse Delivery | N2+ | 4 | "A parcel for you." [1] Sign. [2] Refuse. | [1] A random cursed charm (sign-on fee paid to you) + 3 Tickets. [2] buff `curse_sour_luck` for 6 plays. |
| H32 | `lights_out` | Lights Out | N4+ | 4 | [1] Accept. [2] Decline. | [1] A 30 s `blackout` event now; all machines +15 % (A) during it; mannequins move. |
| H33 | `the_collector_calls` | The Collector Calls (S) | start of the last Watch, N4+, deposit < 40 % of quota | — | A coin drops into a slot on the line. No words. | Deposit 10 % of the quota within 45 s → nothing. Fail → buff `marked` (luck −3 until Dawn). |
| H34 | `the_landlord` | The Landlord (S, then random) | scripted at Night 3 Watch 1; later random, Holdings ≥ 2 × quota | 6 | "Your holdings interest us." [1] Pay 5 % of Holdings now. [2] Decline. | [1] Next Night's Assessment = 0. The scripted first call also explains Assessment (4 subtitle lines). |
| H35 | `staffing_agency` | Staffing Agency | N2+, ≥ 1 staffable instance without staff | 6 | [1] "Send someone." [2] Decline. | [1] Your next hire within this Watch costs −50 % (look at an instance and press U → Hire). |
| H36 | `the_inspector` | The Inspector | N4+, own ≥ 1 Attendant | 5 | [1] Bribe 3 Tickets. [2] Refuse. | [1] Staff income +25 % this Night. [2] One random Attendant is `out_of_order` this Watch. |
| H37 | `the_contractor` | The Contractor | N3+ | 5 | [1] Pay 20 × SI. [2] Decline. | [1] Your next upgrade purchase on any track also grants the next 2 levels free (not added to Holdings). |
| H38 | `orientation` | Orientation (S) | Night 1, 20 s after control | — | 4 subtitle lines: quota, pulls, terminal, "everything here has a price". [1] "Understood." | +1 Ticket. Teaches answering (skippable later). |
| H39 | `a_guest_named_vell` | A Guest Named Vell (S) | Night 5 Watch 2 | — | Lore: a past guest leaves a message for "whoever has my old seat" (6 lines) | The note "Vell's Ledger" (N-12) appears on the Bandit at WELL-04. Free. |

### 5.4 The House's sample lines (polite hospitality horror; i18n `voice.*`, EN / TR)
| Trigger | EN | TR |
|---|---|---|
| Run start | "Good evening. You owe us. Make yourself at home." | "İyi akşamlar. Bize borçlusunuz. Kendinizi evinizde hissedin." |
| Bell | "The floor is open." | "Salon açıktır." |
| Hot Lamp | "Something's running warm." | "Bir şeyler ısınıyor." |
| Last Call | "Last call. Last call." | "Son çağrı. Son çağrı." |
| Big deposit (≥ 50 % at once) | "Prudent." | "Akıllıca." |
| `megawin` | "Look at you." | "Şu hâline bak." |
| Jackpot | "Jackpot. We'll be seeing that again." | "Büyük ikramiye. Onu yine göreceğiz." |
| Upgrade milestone | "You're settling in." | "Yerleşiyorsunuz." |
| Assessment | "We've taken note of your improvements." | "Geliştirmelerinizi not ettik." |
| Paid | "Paid in full. For now." | "Tamamı ödendi. Şimdilik." |
| Short | "Short by {N}. Mind the floor." | "{N} eksik. Zemine dikkat." |
| Max Tilt | "You're wearing it out." | "Onu yıpratıyorsunuz." |
| Night 8 Bell | "Last floor. Last chance." | "Son kat. Son şans." |
| Topside | "Going up." | "Yukarı çıkıyoruz." |

---

## 6. Horror, story and atmosphere (Addenda 1 "light horror", 2 "story + cutscenes", 4 "music")

### 6.1 Cast (all low-poly; humanoids use the CC0 mannequin GLB `quaternius-ual/UAL1_Standard.glb`, PSX-converted)
| Character | Look | Behaviour |
|---|---|---|
| **The House** | Never seen. Speaks through brass PA horns `#B08A3A` in every ceiling. | Narrates, taunts, congratulates; polite hospitality horror. Knows your name after H11. |
| **The Collector** | 2.4 m tall (mannequin ×1.4); long coat `#1A1414`; wide-brim hat; brass face plate `#C8A040` with one vertical black coin slot; cream gloves `#E8E0C8`; a pocket watch on a chain. Clips: `Walk_Formal_Loop`, `Idle_Loop`, `Interact`. Animated at 12 fps (stop-motion stiffness). | Arrives by lift at every Dawn. Never runs, never speaks, never touches you, except the Visitation (§6.3). One coin clink per step instead of footsteps. Distant sightings from Dread "Haunted". |
| **Dealers** (automata) | Porcelain mannequins `#E8DCC8`, painted smiles, hairline cracks, oxblood vests `#4A1016`. The Devil, Mother Moth and Monsieur Thimble are the catalogue's automata. | Run the tables. From Dread "Uneasy" their heads track you within 6 m with a 0.4 s lag. |
| **Patrons** ("guests who lost") | The same mannequins in 1970s suits, JackIDs pinned to their lapels with the names scratched out. | Sit at Cold Lamps, staffed machines and shared tables. They shift when unobserved (§6.4). |
| **The Pawnbroker** | Two ringed hands under a grille; the wrists vanish into shadow. | Slides charms across the counter; drums its fingers if you idle > 10 s. |
| **The Clerk** | Mannequin with sleeve garters at the Concession Desk, brass bell. | Rings the bell on every tycoon purchase; turns its head 90° toward each new pad you buy. |
| **Vell** (never seen) | A past guest heard on tapes and in notes. | The player's guide through the lore. |

### 6.2 Dread (0–100; per player in Versus, shared in co-op)
```
dread = clamp( nightBase[n] + pressure + eventDread + 3 × cursedCharmsHeld − 8 × brighterBulbsLevel − charmRelief , 0, 100 )
pressure   = 30 × clamp( nightElapsedFraction × (1 − deposit / quota) × 1.5 , 0, 1 )     // DESCENT's formula
eventDread : Witching Watch +10 · blackout +10 · full_moon +15 · missed call +5 · devilstable blackout +10 ·
             cursed candy (bad) +10 · H28 +10 · shrine curse_attention +15; decays 1 per 6 s
nightBase  : N1 0 · N2 5 · N3 12 · N4 20 · N5 30 · N6 40 · N7 50 · N8 60 · Overdrawn min(80, 60 + 2·(n−8))
```
- Dread caps at 99 before Night 6 (no Visitation).
- Dread is never shown as a bar unless *Settings → Show Dread meter* is on. By default the room itself is the readout,
  plus a screen-edge vignette of strength `0.35 × dread / 100`.

| Tier | Dread | Light level | Flicker events | Fog far × | Music | Mannequins | Collector | Ambience |
|---|---|--:|---|--:|---|---|---|---|
| Calm | 0–19 | 100 % | none | 1.0 | Zone theme, in tune | still | Dawn only | Synth crowd murmur (filtered noise + random 180–320 Hz babble), distant coin cascades |
| Uneasy | 20–39 | 90 % | 1 per 45 s, 0.2–0.6 s, one zone | 0.9 | −15 cents detune, 0.3 Hz wow | heads track (6 m, 0.4 s lag) | — | Murmur thins; occasional laugh |
| Haunted | 40–59 | 75 % | 1 per 25 s | 0.75 | −40 cents; tension stem in | head and torso turn; a dealer is missing from its post when unobserved, back when you look again | 1 distant sighting per Watch at the end of a sightline; vanishes 0.3 s after being centred in view | 50 Hz HVAC hum; lift cable creaks; **whispers** when your luck ≤ −3 or buff `bad_run` |
| Watched | 60–79 | 60 % + one zone blacked out per Watch (machines still glow) | 1 per 15 s | 0.6 | music box only over the zone bed | when you stand up from a machine, a dealer stands 3 m behind you (spawned outside every frustum) | silhouette in the lift-door window | Sub-bass heartbeat 45 Hz at Last Call if short; footsteps above the ceiling |
| Dire | 80–99 | 50 % | 1 per 10 s | 0.5 | silence + reversed jackpot jingles | patrons relocate between free seats | stands beside the terminal through the Watch | Wind from the trapdoor seams |
| **Visitation** | 100 | 10 % (machine screens stay lit) | — | 0.4 | stops; ticking only | all stand and face the Collector | **walks the floor** (§6.3) | the clock's tick doubles in volume |

**Lighting pushes the dark back.** Each Brighter Bulbs level gives Dread −8 and raises the minimum light level by +10 %
(cap 100 %). A fully lit pit (level 4) is visibly warmer and loses one tier.

### 6.3 The Visitation (stealth beat, CLOCK; max once per Night, Night 6+)
- Triggered when Dread reaches 100.
- Lights drop to 10 %. The Collector steps out of the lift and patrols 3 random open zones for 45 s at 1.4 m/s on the nav
  graph.
- Vision: cone 50°, range 9 m (halved while you crouch), blocked by machine and wall colliders. Seated players are fully
  visible.
- **Seen** for 1.5 s continuously: "Audited". −10 % pocket, current quota +3 %, a 0.6 s white-out and a clock-hand whirr
  (sine 3 kHz → 200 Hz).
- **Never seen**: +2 Tickets ("He didn't see you.").
- Afterwards Dread is set to 60.
- MP: each seen player loses 10 % of pocket; co-op team quota +1 % per seen player.
- **Calm Mode** replaces the Visitation with its footsteps only.

### 6.4 Horror behaviours (exact rules)
- **Mannequins shift when unobserved.** An actor (patron, dealer pose, or empty-seat spawn) may change only when it is:
  - (a) outside the view frustum of every player camera (MP: all players);
  - (b) ≥ 6 m from every player;
  - (c) unobserved for ≥ 2 s.
  - Allowed changes: head yaw toward the nearest player (≤ 90°); pose swap (`Sitting_Idle_Loop` ↔ `Sitting_Talking_Loop`
    ↔ standing `Idle_Loop`); relocation to another free seat in the same zone (Dread ≥ 60 only).
  - Rate per zone: Uneasy 1 change / 20 s, Haunted 1 / 10 s, Watched+ 1 / 5 s. **Never in view.**
- **The Collector's footsteps** come down the lift shaft during the last Watch's Last Call: one coin clink per 0.9 s,
  getting louder. They stop the instant the deposit ≥ quota.
- **Whispers when luck is low**: when your effective luck at your current instance is ≤ −3, or `bad_run` is active.
  - Formant-noise whisper at −24 dB, panned randomly ±60°, every 6–10 s.
  - Grey italic subtitle from a 12-line pool ("one more…", "it's warm for you…", "{NAME}…" after H11).
- **Darker rooms as pressure rises** (§6.2 `pressure` term). The quota board's bulbs dim with the same factor.
- **The PA voice** speaks at Bells, Lamps, Last Call, deposits ≥ 50 %, megawins, Assessment, Dawn.

### 6.5 Beats (trigger → effect)
1. **Wake-up**: the jackpot burst (§9.4) is warm and loud; Night 1 is deliberately cosy (Dread 0, lounge music).
2. **First Collector (C02)**: he explains the first quota without a word (§6.8).
3. **Deposit shortfall at Last Call**: floor plates under you creak (2 kHz click + 0.5 mm camera tremor) if deposit < quota.
4. **Floor dial**: if deposit < 50 % of quota in the last Watch, the needle trembles toward a nonexistent "B8".
5. **Coins in the pocket tick** like a watch (1 Hz) during the last Watch's Last Call.
6. **The Big One in a blacked-out zone**: only its reels glow; the eye-spots on MOTH symbols glint.
7. **The phone rings with nobody on it** (H28) from Dread 40.
8. **Mother Moth turns her head 180°** when The Pit card is drawn.
9. **Machines whisper the player's name** ("{NAME}… one more.") once per Night from Haunted, if H11 was answered.
10. **Jackpot at Watched+**: after the gold wave the zone's lights come back 10 % dimmer ("spent").
11. **Every new pad you buy**: the Clerk turns its head toward it, and the first patron to sit there is wearing your old
    clothes from the JackID photo (from Night 5).
12. **Night 8**: the wall clock has 13 numerals and the Collector stays by the terminal all Night.
13. **The Sump**: your previous JackIDs lie on the coin pile where you land.
14. **Topside**: the first and only time the lights go fully white `#FFF6E0`.

### 6.6 Story bible (light, told in small doses; all text ≤ 40 words per item; EN + TR via i18n)
- **The House.** Nobody built it. A wishing well under the city kept every coin ever thrown into it, and the coins kept
  the wishes. The House grew around the well and has been eating luck ever since. It is polite. It never lies. It never
  tells you everything.
- **Why you owe.** Every jackpot is a loan. You won one topside: a bar machine, 2 a.m., bells. Your JackID was printed the
  moment the bells rang, and you woke up inside the jackpot you won.
- **The JackID.** Your casino ID card is the diegetic progress bar. It shows:
  - NAME, a dithered photo, OWED, ISSUED B7, "VALID UNTIL PAID";
  - one punched hole per paid Night;
  - viewable with **J** (raise the card) and on the pause screen.
- **The Collector.** The only guest who ever paid in full. He rode the lift up, found nothing waiting for him, and came
  back down. He fed his face to a machine so the House would keep him. He collects so he can stay.
- **The guests.** Every guest who fell is still here: the mannequins. Their JackIDs are scratched blank. When you hire an
  Attendant you employ one of them. "They work for the House now. So could you."
- **Vell.** A guest who reached G and chose to Descend instead of leaving, to find out where the coins go. His tapes and
  notes are the lore spine.
- **The Counting Room** (MANAGEMENT). Where luck is counted and JackIDs are burned in the Furnace. Opened by the Manager's Key or Foundations F6 (§3.7.7).
- **Wave 24 lore** (WAVE24 §3; one line each):
  - The Well collects: coins thrown in kept the wishes, and the House is how the Well collects.
  - Your JackID is the receipt for the wish the Well granted, and the debt is that wish's price.
  - The Clerk is the first card ever printed: a blank-faced mannequin that audits. It is not a guest.
  - The Sump lies under the Pit, and the counting happens there.
  - The mannequins are guests whose names became currency. Mira is a guest who is now still.

### 6.7 Endings
| id | Ending | Requirement | Content |
|---|---|---|---|
| A | **Going Up** (elevator ending) | Pay Night 8, press G in the lift | C08: 18 s ride B1 → G; the dial counts up, coins rattle, the cable sings. The doors open on a rainy night street (wet asphalt reflections, neon `#FF2E88`, a bus stop). Walk 6 s; your JackID reads **PAID**. Final shot: behind you the lift doors close, and the dial lights **B7** again (someone new). Then choose STAY UP / GO BACK DOWN / DESCEND. |
| B1–B4 | **Descend layers** ("deeper truth") | Descend 1 / 3 / 6 / 10 times (lifetime) | C07 + layer reveal (12–20 s each): **S1 The Counting Room** (mannequins counting coins by candlelight) · **S2 The Mannequin Works** (guests being fitted with porcelain faces; one wears your JackID photo) · **S3 The Well** (the original wishing well, coins of every country, a thin voice making wishes) · **S4 The House Itself** (a heartbeat in the dark; the House speaks plainly for the first time: "You keep coming back. So do we."). Each layer unlocks a note and a Foundations branch (§11.3). |
| C | **Void the Marker** (secret) | Hold `blank_jackid`; heard all 8 tapes; pay Night 8 via Settle Early with overpay ≥ 2.00 | C09: the lift stops between B1 and G at a floor that is not on the dial ("M"). The doors open on the Counting Room Furnace. You feed your JackID into the Furnace (E). Every mannequin in the pit stands; lights go out floor by floor (seen through the shaft); credits roll in silence. Achievement `void_the_marker`; cosmetic "Ash Coin"; meta node *The Back Office* unlocked for free. |
| D | **The Sump keeps half** | Fall in Overdrawn | Standard Sump (§9.9) with the line "Deeper than most." and Obols ×0.5. |

### 6.8 Animated cutscenes (Addendum 2)
**System** (`src/game/cutscenes/`, data-driven, Opus-authored data, Sonnet-coded player):
- **Timeline file** `<id>.ts` exports:
  `{ id, duration, letterbox: true, skippable: 'never'|'after_seen'|'always', tracks: { camera, actors, lights, sfx, music, subs, fx } }`.
  - `camera`: keyframes `{ t, pos, look, fov, ease }`; `path: true` = Catmull-Rom through the keys.
  - `actors`: `{ t, actor, clip, pos, rotY, fadeIn?, fadeOut?, fps? }`; the Collector defaults to 12 fps.
  - `lights`: `{ t, target, color, intensity, dur }`.
  - `sfx` / `music`: `{ t, cue }`.
  - `subs`: `{ t, dur, key }`, i18n keys `cut.<id>.<n>`.
  - `fx`: `{ t, type: 'fade'|'shake'|'flash'|'ditherSweep'|'crt', … }`.
- **Easing**: `linear`, `inOutCubic`, `outExpo`, `step`.
- **PSX framing**: letterbox to 400×170 visible at internal resolution (black bars 27.5 px). Subtitles in VT323 16 px
  `#F2E8D0` with a 1 px black shadow at y 196.
- **Skip**: hold Space 0.8 s (a ring fills). Input is locked; pause is allowed in SP.
- **Multiplayer**:
  - The host sends `cut.play { id, t0 }`; every peer starts at `t0 + 150 ms`.
  - Holding Space casts a skip vote; more than 50 % of living humans → the host sends `cut.skip`.
  - Late joiners skip in-progress cutscenes.
  - Actors are cloned per client from the shared GLB (`SkeletonUtils.clone`).

| id | Name | Trigger | Dur. (s) | Beats | Skip |
|---|---|---|--:|---|---|
| C01 | Wake | after the menu burst (§9.4), new run | 9 | The camera lies on the floor among shards and coins, blurred. Your hand picks up the JackID (close-up: NAME, OWED 1.34M). You stand; The Big One's cracked glass hums behind you. | after seen |
| C02 | The First Quota | Night 1, after C01 | 24 | Lift chime. The Collector walks out at 12 fps and stops at the terminal. A gloved finger presses one key; the printer: "QUOTA 80 · BY DAWN". He raises one finger toward the wall clock, which starts at 00:00. He leaves. House: "Good evening. You owe us." | after seen |
| C03 | Paid | Dawn, PAID | 8 | §2.7 beats 0–8 | always (×3 speed) |
| C04 | Short | Dawn, SHORT | 7 | §2.8 trapdoor | never |
| C05 | Ascent | after PAID | 10 | Wide shot from the Mouth: the pit judders, dust falls, brick shaft walls scroll down past the 6 m clerestory grilles at 0.5 m/s, the floor dial swings up, and the House names the floor ("Floor six. Mind the drains."). A teaser glint shows the next Night's new system (§2.9). | after seen |
| C06 | Wing Unlock | Wing Key / wing bought | 8 | Grille rattles up (3 s). Machines power on 0.6 s apart (marquee blink, start-up jingle, `#FFF2CC` spotlight 1 s each). Dust sheets slide off seated patrons. | always |
| C06b | Machine Delivery | Machine Order | 6 | §3.7.6 | always |
| C07 | Descend | prestige | 22 (+ layer 12–20) | The lift goes down past B7; the dial needle bends below the scale; darkness. Obols drop one by one into a ferryman's bowl (count-up), then the layer reveal (§6.7 B). | after seen |
| C08 | Going Up | Night 8 paid + G | 40 | §6.7 A | after seen |
| C09 | Void the Marker | secret | 45 | §6.7 C | never (first time) |
| C10 | The Parlour Opens | after Night 3 paid | 9 | The velvet curtain's padlocked chain snaps; the Devil automaton lifts its head; the one bulb starts to swing (±12°, period 3.1 s). | after seen |
| C11 | The Final Note | Night 8 start | 14 | A 13th numeral fades onto the wall clock. The Collector prints the quota and does **not** leave; he stands beside the terminal. | after seen |
| C12 | Below the Bottom | Overdrawn start (Night 9) | 12 | The Topside doors close; the lift sinks past B7; the needle points below the scale. | after seen |
| C13 | Turned Heads (stinger) | Dread ≥ 40, standing up after a ≥ ×25 win | 3 | Every mannequin in view has turned to face you; the camera auto-turns 20°. | never |
| C14 | The Empty Chair (stinger) | Dread ≥ 60, you turn > 120° within 2 s | 3 | A patron's seat is empty; the patron stands 1.5 m behind you, then the lights flicker and it is back in its seat. | never |
| C15 | The Lift Opens on Nothing (stinger) | Dread ≥ 50, mid-Watch | 5 | The lift doors open on blackness; one coin rolls out and spins to a stop. | never |
| C16 | Your Name on Every Screen (stinger) | Dread ≥ 70 and H11 answered | 2 | Every machine screen in the zone shows "{NAME}" for 1.5 s. | never |
| C17 | Mirror Grin (stinger) | Dread ≥ 40, Overheat at baccarat | 3 | The mirror table shows your reflection grinning (catalogue overheat cue), framed. | never |

Stingers are capped at 1 per Watch, never during Last Call of the last Watch, and **removed by Calm Mode**.

### 6.9 Music (Addendum 4: composer-quality, procedural WebAudio)
**Engine** (`src/core/audio/music.ts`):
- Tempo-synced scheduler: 25 ms tick, 100 ms lookahead.
- Seeded per run and Night (`rng(seed, 'music', night)`): same seed gives the same arrangement; different seeds are never
  identical.
- State changes quantize to the next bar (max 1 bar wait). Crossfades 2.0 s. Music ducks −6 dB under the House voice and
  −9 dB for 1.5 s under stingers.

**Instrument patches** (all synthesized):
| Patch | Recipe |
|---|---|
| Rhodes / e-piano | FM: sine carrier, mod ratio 1:1 plus a 14:1 tine click; index envelope 3 → 0.5 over 0.4 s; tremolo 4.5 Hz 20 % |
| Upright bass | sine + triangle 2nd harmonic; pluck env A 5 ms / D 0.35 s / S 0.3; low-pass 900 Hz; 15-cent slide-in |
| Brushed drums | swish = noise band-pass 6 kHz (2-step loop); kick sine 60 → 40 Hz 0.2 s; rim = noise 5 ms + 1.7 kHz sine |
| Vibraphone | sine + partial ×3.9; motor tremolo 5.5 Hz |
| Muted trumpet | saw → band-pass 1.2 kHz Q 4 (harmon); vibrato 5 Hz ±15 cents after 0.25 s |
| Organ | drawbar sines 16' / 8' / 4'; Leslie AM 6.5 Hz |
| Detuned music box | triangle + 8th partial; decay 1.2 s; random ±18 cents per note |
| Choir pad | 3 detuned saws (±7 cents) → formant band-passes 800 / 1,150 Hz ("ah"); attack 1.5 s |
| Nylon pluck | Karplus-Strong, decay 0.996 |
| Lo-fi master | pitch LFO 0.45 Hz ±8 cents + 0.07 Hz drift ±4 cents; 12-bit crush; sample-and-hold 22.05 kHz; low-pass 7 kHz; tape hiss −42 dB |
| PSX reverb | convolver with a generated 1.8 s decaying-noise IR; predelay 25 ms; wet low-pass 6 kHz; wet 22 % |

**The House motif** (leitmotif in every cue, re-harmonised): D4 – F4 – A4 – G♯4 – A4 (quarter, quarter, quarter, eighth,
dotted half).

**Zone themes** (the base layer follows the zone you stand in, crossfading at doorways):
| Zone | Title | Style / meter | Key | BPM | Lead instruments | Progression |
|---|---|---|---|--:|---|---|
| Menu | "Inside the Jackpot" | slow ballad | D minor | 84 | music box, Rhodes, choir pad | i9 – VImaj7 – iv9 – V7♭9 (motif on music box; reel clacks on the beat) |
| Mouth / Well / Lobby | "The Lounge" | swing | F major | 92 | Rhodes, upright, brushes, vibes; muted trumpet solo every 32 bars | ii9 – V13 – Imaj9 – VI7♭9 |
| Slot Gallery | "Neon Arcade" | straight 8ths, synth | A minor | 104 | square/saw arps, Rhodes | i – VI – III – VII |
| Card Room | "Green Felt" | slow swing trio | B♭ major | 76 | piano trio, muted trumpet | I – vi – ii – V |
| Boiler | "Pipes" | hard-bop shuffle | G minor | 120 | walking bass, rim clicks, organ stabs | i7 – iv7 – ♭VII7 – i7 |
| Wheel House | "Tango Rojo" | tango | A minor | 116 | organ (bandoneón patch), staccato bass | i – iv – V7 – i |
| Laundry | "Spin Cycle" | bossa nova | E minor | 96 | nylon pluck, shaker, vibes | i9 – IV9 – ♭VImaj7 – V7♯9 |
| Midway | "Carnival of Teeth" | 6/8 waltz-march | C♯ Phrygian | 128 | music box, calliope (high organ), toy drum | i – ♭II – i – ♭VII |
| Parlour | "One Bulb" | drone | D minor | 60 | organ drone, reversed piano | i pedal |
| Counting Room | — | none | — | — | ticking only | — |

**Adaptive layers**:
- *Tension stem*: choir pad + 55 Hz sub drone. It enters at Haunted; detune follows §6.2.
- *Last Call*: hi-hat 16ths + a pitch rise of +3 %.
- *Heartbeat*: 45 Hz, when short in the last Watch's Last Call.
- *Stingers*: reversed bell + choir hit.
- *Jackpot fanfare*: the catalogue's 8-bar fanfare (C → A♭ at bar 5).
- *Collection cue*: 8 bars, the motif on vibes over organ, ending on a fermata (PAID) or a descending tritone (SHORT).
- *Trapdoor*: wind + a reversed motif.
- *Topside*: the first major-key statement of the motif (D major, full choir, 30 s).

**Jukebox** (Lobby, LOB-JUKE): 12 songs.
- Pay **1 Ticket** (E, then 1–9 / scroll); the song's buff lasts for the rest of the current Watch. One song at a time:
  a new song replaces the old one.
- In MP any player may pay; the latest song applies to everyone.
- Each song is generative with a fixed form (AABA, 32 bars) and fixed chords. Seeded per play:
  - voicings chosen per bar from 3 options;
  - 15 % ornament chance;
  - drum fills every 8 bars from 6 patterns;
  - solo instrument chosen from 2.

| # | id | Title | Style | Key | BPM | Buff (rest of Watch) | Unlock |
|--:|---|---|---|---|--:|---|---|
| 1 | `velvet_ledger` | Velvet Ledger | lounge jazz | F | 96 | CARDS +5 % (A) | start |
| 2 | `bossa_for_the_bottom` | Bossa for the Bottom | bossa | E minor | 132 | DROPS +5 % (A) | start |
| 3 | `brass_elevator` | Brass Elevator | swing | B♭ | 168 | Tilt grace +1 | start |
| 4 | `waltz_of_the_unpaid` | Waltz of the Unpaid | sad waltz 3/4 | D minor | 84 | interest +1 % this Watch | start |
| 5 | `neon_undertow` | Neon Undertow | synthwave | A minor | 104 | REELS +5 % (A) | start |
| 6 | `carnival_of_teeth` | Carnival of Teeth | creepy carnival 6/8 | C♯ Phrygian | 116 | CURIOS +5 % (A); Dread +5 | start |
| 7 | `dice_in_the_boiler` | Dice in the Boiler | hard bop | G minor | 180 | DICE +5 % (A) | cassette |
| 8 | `round_and_round` | Round and Round | tango | A minor | 120 | WHEELS +5 % (A) | cassette |
| 9 | `lullaby_for_mannequins` | Lullaby for Mannequins | music box | E♭ | 72 | Dread −10 | cassette |
| 10 | `last_orders` | Last Orders | torch song | D♭ | 76 | Last Call +10 s | cassette |
| 11 | `static_hymn` | Static Hymn | organ + choir | D Dorian | 60 | random-call chance +25 % | cassette |
| 12 | `topside_rain` | Topside Rain | lo-fi | F♯ minor | 88 | staff income +10 % | win once |

Cassettes are rare prizes that persist across runs (§11.8): `coinpusher` prize 1 / 150 drops, `claw` capsule 1 / 12
deliveries, `lootbox` Rare+ 1 / 8, `tombola` Grand prize.

### 6.10 The House's voice and the key SFX
- **Babble**: formant-synth babble (sawtooth through two band-pass formants at random syllable formants, 9 syllables / s,
  pitch 95 Hz), then a radio band-pass 300–3,000 Hz and a spring-reverb convolver.
- *Settings → House speaks: Babble / Browser speech* uses `speechSynthesis` (pitch 0.4, rate 0.85) for real words in
  EN or TR.
- Always subtitled. Dealer automata speak in tones (catalogue).

| Cue | Recipe |
|---|---|
| Bell (Watch) | FM, carrier 660 Hz, ratio 3.5, decay 1.2 s |
| Lift chime | sine 784 → 523 Hz, 0.4 s each |
| Phone ring | dual sine 425 + 480 Hz, AM 20 Hz, 1.0 s on / 0.7 s off |
| Trapdoor latch | square 70 Hz 0.15 s + noise burst |
| Fall wind | pink noise, band-pass sweep 400 → 1,200 Hz |
| Punch | white noise 30 ms + sine 180 Hz thump |
| Collector step | 3 random coin clinks (2.2–3.4 kHz, 40 ms) |
| Heartbeat | sine 45 Hz, 2 thumps per 0.9 s |
| Upgrade bought | Clerk's brass bell (FM 1,320 Hz, ratio 2.76, 0.6 s) + ratchet; milestone: 3-note rising arpeggio + "You're settling in." |
| Staff income tick | soft coin drop (3 sine partials 2.5–6 kHz, 60 ms) at −24 dB, max 2 per second pit-wide |
| CC0 layer | Kenney casino SFX (chips, cards, dice) layered with synth clicks, pitch ±8 % (`docs/ASSETS.md`) |

### 6.11 Notes, tapes and cassettes (collectibles; Addendum 3 "things to do between spins")
- **28 Notes** (paper, 128×96 canvas, VT323 typed, ≤ 40 words). n01–n14 as before, n15–n28 from WAVE24 §3. n13 and n14
  are pit tapes and count in the 28. The eight lobby cassettes below are a separate set.
  - Fixed anchors, not random spawns. Each note sits next to a world anchor. Read with E; kept in the Ledger.
  - Gating (`zone?` / `night?` in `story/notes.data.ts`): a room note is placed only while its wing is open, and only from its
    Night on. A note with neither gate is always placed (n01–n14, n27, n28). Anchors for room notes are named `<zone>.<noteId>`.
  - Room split: Jade (`cards`) n15–n16 · Wash (`laundry`) n17–n19, also the locker pool · Boiler n20–n21 · Parlour n22–n23 ·
    Counting (`counting`) n24–n26 · Mouth n27 · Sump n28.
  - Night gates: n27 from Night 1, n15 from Night 2, n19 from Night 4, n16 and n21 from Night 5, n24 from Night 6, n25 from
    Night 7, n26 from Night 8.
  - The old 24-note split (6 House Rules · 6 staff memos · 8 guest notes · 4 ledger pages) is retired with the old count.
  - Samples (EN):
    - "HOUSE RULE 4. Guests may not leave with luck they did not earn."
    - "MEMO: Do not seat new guests at the cold machine. It has been told."
    - "VELL: If you are reading this, the Bandit nearest the clock remembers me. Pull it for me."
    - "LEDGER p. 1: Paid. Paid. Paid. Paid. Short. (He underlined it twice.)"
- **8 Tapes**: cassettes on the Lobby tape deck (prop beside the jukebox), 30–45 s monologues. One per Night (N1–N8)
  appears on a fixed machine of the newly opened wing. Contents:
  - T-1 "Orientation for New Staff";
  - T-2 to T-6 Vell;
  - T-7 the Collector: 20 s of breathing, then "I paid.";
  - T-8 the House (only after Descend ≥ 3).
- **6 Music cassettes** (§6.9).

### 6.12 Rules of taste and accessibility
- No blood, gore, corpses, body horror or self-harm imagery. Falls cut to black before any landing is seen.
- **Devil's Table framing (art direction over the catalogue presentation; rules unchanged).** Both guns — the SHELLS
  double-barrel (main mode, BRIEF Addendum 7, MACHINES_tables §5A) and the Six Chambers revolver (quick variant) — sit on
  the brass swivel turntable and only ever aim at a brass **seat lantern** 0.4 m above the target's chair, never at a face.
  A live shell/chamber shatters that lantern: white 2 frames → black 1.2 s, 4 kHz tinnitus, a screen-crack overlay 2 s,
  then the seat's defibrillator box thumps (one charge lamp dies) and you wake. Losing a whole match = the Collector
  drags your chair back (no body shown).
- No jump scare louder than −6 dBFS peak; no full-screen flash above 70 % white.
- **Reduce Flashing**: strobes capped at 3 Hz and 40 % intensity; jackpot wave without strobe; blackouts become 40 % dims.
- **Calm Mode**: removes sightings, mannequin shifting, stingers C13–C17, H28 and the Visitation. Keeps the lighting mood
  and the story. Achievements stay enabled.
- Boot notice: "JackID contains simulated gambling with fictional currency. No real money can be spent or won."
- Subtitles on by default; all strings through i18n (EN / TR).

---

## 7. Modes

### 7.1 Debt Run (single player)
Everything in §2–§6. No network. Choose a kit and a House Edge level at start (§11.4–11.5). Seeded and Daily variants
(§11.9). Pause freezes everything.

### 7.2 Co-op Debt Run (2–8 players, one shared quota)
| Rule | Spec |
|---|---|
| Quota | `BaseQuota × (1 + 0.85 × (N − 1))`, N = players in the room at Night start (2: ×1.85 · 4: ×3.55 · 8: ×6.95), plus a team Assessment on team Holdings. Rescaled every Night. |
| Pockets | Personal. Each player starts with 50 ¢ and 2 Tickets. |
| Deposit | **One shared** terminal balance; anyone deposits. Withdrawals need a majority vote of living players (YES / NO keys on the terminal, 15 s). |
| Transfers | Look at a teammate: tap G = give 10 % of pocket; hold G 1 s = give 25 %. A coin pouch arcs between hands (0.5 s). Free. |
| Interest | On the shared deposit (ceiling 2 × team quota). Activity clause: ≥ 3 pulls per living player on average. LEDGER charms from several players stack, capped at +8 % team-wide. |
| Pulls / clock | Pulls per player per Watch (full schedule each). One shared clock. Closing starts at clock 0, or when every living player has 0 pulls or has pulled the terminal's Ready chain. |
| Tilt / Heat | Per player. |
| Lamps | Shared; +1 Hot Lamp per 3 players. |
| Punch card | One shared card; anyone punches. Size: N 2–3 normal; N 4–6 +1 dimension; N 7–8 5×5. Bounties go to the shared deposit. |
| Charms | Personal boards (6 pegs each). The Pawn Window serves 2 players at once; with N ≥ 4 the Cashier window (LOB-CASH) becomes a second Pawn Window. Each player sees personal stock (seed per player). |
| Phone | One booth (+LOB-PHONE2 at N ≥ 5). Whoever answers chooses; others hear it positionally with subtitles. H25 Party Line votes. Deadline Call: the team votes on the 3 Favours (each presses 1 / 2 / 3; ties random). |
| Wing Keys | Vote at the lift panel (20 s). N ≥ 4: one wing open from Night 1; N ≥ 6: two (host picks). |
| **Tycoon (shared floor)** | Every instance has one **owner**: the player who has paid the most coins into it (orders, upgrades, staff; ties → earliest). The owner's name sits on the Service Plate's nameplate in their player colour (ART_BIBLE §8.2; the same colour tints their chips, daubs and seat lamps). Anyone may buy upgrades on any instance; upgrades help whoever plays it. Staff income goes to the owner's pocket. House Improvements are team-wide (anyone pays). Holdings and Assessment are team-wide. |
| **Collateral Clause** (FAITHFUL + DESCENT's Fall Guy) | If the team is short at Dawn by ≤ 25 % of the quota, the Collector waits 10 s. Any living player may step onto the brass **X plate** (MOUTH-X). Each volunteer forgives up to 15 % of the quota. The last living player cannot volunteer. Volunteers drop through the trapdoor and become ghosts. |
| Ghosts (co-op) | Fly at 4 m/s through walls, invisible to the Collector. Once per Watch a **Whisper** gives buff `ghost_whisper` (+20 % (A) on a living player's next play). Unlimited **Ping** (ghost-glow on a machine for 5 s). Ghosts may answer the phone. A ghost's staff income goes to the shared deposit. |
| Return / bail | Ghosts ride the lift back at the next Night start after a paid Night, with 0 ¢ and their charms. Early **bail**: any player pays 15 % of the current quota at the terminal's BAIL key; the ghost returns at the next Bell. |
| Team fail | Shortfall > 25 %, or no volunteers: everyone falls. The shared Sump results show awards: Top Earner, Most Punches, Collateral, Phone Hog, **Landlord** (most staff income). |
| Late join / disconnect | A late joiner is a ghost until the next Night start, then spawns on the Mouth arc with `50 × SI` ¢, 2 Tickets and a free Common charm. On disconnect the pocket is held 300 s (TECH_SPEC §6.4) for rejoin; then host setting *Deposit* (default: 50 % auto-deposits) or *Vanish*. |

### 7.3 Versus "Last One Standing" (2–8)
| Rule | Spec |
|---|---|
| Quota | Each player owes the solo schedule (×1.0) plus a personal Assessment. Same clock and Nights for all. |
| Deposit | The terminal has 8 brass lockers; the UI shows only your own balance. Others' deposit *ratios* are on the Tab scoreboard. |
| Cards | Each player gets their own card from the same seed (fair start, diverging punches). |
| Machines | Shared. Single-seat devices are first-come (catalogue occupancy). Tables are shared. Tilt is per player, which rotates hogs naturally. |
| **Tycoon** | Ownership = first purchaser (permanent). Only the owner may upgrade or staff an instance; anyone may play it. **Rent**: the owner receives 3 % of every rival's stake on their instance, **paid by the House** (not taken from the rival). Fallen players' instances become ownerless. |
| PvP | Hold'em, teetotum, the Devil's Table duel and the coin-flip duel (catalogue). Answer to the catalogue's open question: net PvP winnings per player per Night are capped at 1 × that player's base quota; the excess goes to the House. |
| Phone | Calls are addressed: the booth's nixie display shows the target's name; only they can answer. Sabotage call H22 Silent Partner. The lowest deposit ratio at Bell gets a guaranteed H02 The Tip. |
| Leader marker | From Night 5 the highest deposit ratio wears a faint gold outline through walls (`#FFD34A`, 25 % opacity). |
| Failure | Fall → **ghost spectator**: free-fly (6 m/s noclip), follow-cam (keys 1–8), sees everyone's cards. Once per Watch: **Bless** (`ghost_bless`) or **Curse** (`ghost_curse`) a living player, never the same target twice in a row. Ghost names are shown; no anonymous griefing. |
| Ghost Call | Once per Watch the ghosts take the phone collectively: majority vote to add +5 % quota to the current leader (or nothing). |
| End | The last living player after a Dawn wins. If all remaining players fall at the same Dawn, the highest deposit ratio wins. If 2+ pay Night 8, the highest (surplus + Holdings) wins and rides the lift; others watch. Host option **Sudden Death from Night 4** (quotas ×1.5). |
| No transfers | Coins cannot be given in Versus. |

### 7.4 Free Casino (sandbox, 1–8, join in progress)
- No quota, no Watches, no pulls, no Tilt. Lamps are an optional host toggle. The wall clock shows real local time.
- All wings open, including the Parlour.
- Start pocket `1,000 × SI`. The host picks an SI preset ×1 / ×10 / ×100 / ×1,000.
- The Cashier lends `500 × SI` on request, tracked as "House Credit" on the scoreboard.
- **Tycoon fully on, no Assessment**: build your dream casino with friends. Every unlocked charm sells at its SI price;
  cursed charms are off by default.
- Host toggles: horror on / off, Dread lock 0–60, "Roaming Collector" (for fun), Lamps on / off.
- Tab ranks by net worth (pocket + Holdings). Jukebox requests, chat, emotes.
- Only social achievements count (§3.11 #15).

### 7.5 Mode comparison
| | Debt Run | Co-op | Versus | Free Casino |
|---|---|---|---|---|
| Players | 1 | 2–8 | 2–8 | 1–8 |
| Quota | solo | shared × (1 + 0.85 (N−1)) | personal | none |
| Watch clock / pulls / Tilt | yes | yes (shared clock) | yes | no |
| Tycoon | yes | shared floor, owners | owners + rent | yes, no Assessment |
| Pause | yes | no | no | no |
| Join in progress | — | as ghost until next Night | no | yes |
| Spawn | jackpot burst (Well) | lift → Mouth (or burst, room option) | lift → Mouth | lift → Mouth |
| Fail state | trapdoor | Collateral / trapdoor | ghost | none |
| Saves | every action | host snapshot each intermission | host snapshot each intermission | none |
| Obols | yes | yes (each player) | yes (winner ×1.5, others ×0.5) | no |

### 7.6 Play-with-friends infrastructure (Addendum 1)
| Feature | Spec |
|---|---|
| Room codes | 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0, 1; typed case-insensitively; e.g. `K7Q2MX`; TECH_SPEC §7.2), shown on the host's pause screen and the lift panel. |
| Invite links | `https://<host>/?join=K7Q2MX`. Opening it boots straight into the server browser with the room selected; a password, if any, is typed (never put in the URL). |
| Party lobby | The **Lift** (§9.5): players stand in the car, press the lit **B7** button to Ready, chat (T), emote. The host sees ready flags and START (≥ 2 ready, or the host alone in Free Casino). |
| Host settings | Room name (24 chars) · mode · House Edge 0–10 · max players 2–8 · password · visibility **Public / Friends-only (code or link only, hidden from the browser) / Same-browser tabs** · seed · jackpot-burst intro on/off · late join on/off · disconnect policy (Deposit / Vanish) · Free Casino options. |
| Recent players | Last 20 player names and room codes with timestamps (SaveStore key `jackid:recent:v1`, local only), shown in MULTIPLAYER → RECENT; Enter re-joins if the room is still listed. |
| Chat / emotes / pings | T chat (120 chars, 8 lines, 8 s fade; profanity filter off by default). Emotes V wave, Shift+V point, 7 cheer, 8 shrug, 9 dance (`Dance_Loop`). B ping: a 6 s marker visible to teammates (enemies in Versus see nothing). |
| Spectating | Ghosts and late joiners: free-fly or follow-cam (1–8). In Versus, spectators see all cards. |
| Proximity voice (tier 2) | WebRTC audio-only peer connections in a mesh (≤ 8, signalled through the existing host channel). Push-to-talk **Y** (or open-mic toggle). Volume full ≤ 3 m, linear to silent at 18 m. Ghosts hear ghosts; the living hear ghosts as −18 dB whispers through a band-pass. Off by default. |
| Late join | The host sends a full snapshot: run state, wallets, deposit, clock, Lamps, card, buffs, tycoon state (instances, tracks, owners, staff), every machine's `mc.snap`. |
| Host loss | No host migration in v1.0 (TECH_SPEC §6.4, §11): the room closes for everyone. Co-op / Versus hosts keep the latest intermission snapshot and can **RESUME ROOM** (same seed and roster, new code); friends rejoin by code. Free Casino host migration is a T3 item (PLAN.md). |

### 7.7 Authority and intents (GDD-level; TECH_SPEC owns code shape)
- The host owns:
  - run state, all RNG streams, Lamps, card, phone rolls, global events, the Collection, the trapdoor;
  - tycoon purchases, staff ticks, Shill plays, buffs, cutscene triggers.
- Client intents:
  - machine / terminal / phone: `mc.req`, `term.deposit`, `term.withdrawVote`, `term.settle`, `phone.answer`;
  - votes: `vote.favour` / `vote.wing` / `vote.skip`;
  - tycoon: `tycoon.buy {instance, track, n}`, `tycoon.hire {instance, kind}`, `tycoon.order {slot, device}`,
    `tycoon.improve {id}`, `tycoon.wing {zone}`;
  - shop and buffs: `shop.buy`, `tonic.buy`, `jukebox.play`, `shrine.light`;
  - social: `give`, `ping`, `emote`, `cut.skipVote`.
- Host broadcasts:
  - `run.delta` at 10 Hz (wallets, deposit, clock);
  - `tycoon.state` on change, `buff.add` / `buff.remove`, `lamp.roll`;
  - `event.start` / `event.end`, `cut.play` / `cut.skip`, `phone.ring`.

---

## 8. Level layout: the pit

### 8.1 Conventions
- Units are metres; axes and `rotY` per §0. All walkable floors are at y = 0 (no stairs). The Big One stands on a
  0.15 m dais (step-up ≤ 0.2 m is handled by the controller).
- Walls 0.3 m thick, centred on the boundary lines below. Wing doorways are 4 m wide with roll-down iron grilles `#2A2A2A`
  (3 s rattle to open).
- Player capsule: radius 0.3 m, eye height 1.62 m (crouch 1.05 m). Speeds: walk 3.0 m/s, sprint 5.2 m/s, crouch 1.5 m/s.
- Floor: a 2 × 2 m grid of riveted steel plates `#3A3530` under carpet / tile / grate textures. Every plate is a trapdoor
  (§8.9).
- Footprint: x −31…31, z −32.2…20 (62 × 52 m). Walking the nave end to end ≈ 13 s; the farthest machine is ≤ 11 s
  sprinting from the terminal.

### 8.2 Schematic (north up; not to scale; tables below are authoritative)
```
 z      x: -31            -11          0           11            31
 -32.2                      [LIFT car]
 -30   +-------------------+--------------------------+-------------------+
       |  THE MIDWAY       | THE MOUTH  fortune LIFT  | THE BOILER        |
       |  (CURIOS)        ==  TERM  PHONE  BOUNTY    ==  (DICE)           |
 -18   |  elevator derby   |------- quota board -----|  craps sicbo      |
 -16   +-------------------+                          +-------------------+
       |  THE CARD ROOM   ==        THE WELL         ==  THE SLOT GALLERY |
       |  (CARDS) holdem   |   roulette   blackjack   |  (REELS)          |
       |                   |      [ THE BIG ONE ]     |                   |
  -2   +-------------------+                          +-------------------+
       |  THE LAUNDRY     ==   ---------------------  ==  THE WHEEL HOUSE |
       |  (DROPS) bingo    |        THE LOBBY         |  (WHEELS)         |
  12   +-------------------+  jukebox  apothecary     +-------------------+
       | COUNTING ROOM  (x)|  PAWN   DESK   CASHIER  (=| THE PARLOUR       |
  20   +-------------------+--------------------------+-------------------+
   == wing grille (4 m)   (x) MANAGEMENT door, locked   (= velvet curtain + chain
```

### 8.3 Zones
| Zone | id | Footprint (x; z) | Ceiling | Opens | Floor theme (DESCENT) | Default machines |
|---|---|---|--:|---|---|---|
| The Mouth | `mouth` | −11…11; −30…−18 | 6.0 | always | hotel lobby, brass, sodium light | fortuneteller + terminal, lift, phone, bounty board |
| The Well | `well` | −11…11; −18…2 | dome 9.0 | always | the cathedral of a slot machine; clerestory grilles at y 6–7 m show the shaft | bigone, roulette, blackjack, bandit ×2, hilo, plinko, mines, coinflip |
| The Lobby | `lobby` | −11…11; 2…20 | 4.5 | always | faded velvet, couches | scratch + Pawn Window, Charm Board, Concession Desk, Cashier, jukebox, Apothecary, tape deck |
| The Midway | `midway` | −31…−11; −30…−16 | 4.0 | Wing Key | dead carnival: striped canvas, bulb strings | elevator, derby, claw ×2, stacker, cyclone |
| The Card Room | `cards` | −31…−11; −16…−2 | 3.2 | Wing Key | green felt, dark wood, brass | holdem, baccarat, cardwar, videopoker ×2 |
| The Laundry | `laundry` | −31…−11; −2…12 | 5.0 | Wing Key | white tile, drum washers, drains | bingo, keno, pachinko ×3, coinpusher, lottoblower, bingopin |
| The Boiler | `boiler` | 11…31; −30…−16 | 3.6 | Wing Key | rust, pipes, steam vents, grate floor | craps, sicbo, dicetower, teetotum, coinflip |
| The Slot Gallery | `gallery` | 11…31; −16…−2 | 4.0 | Wing Key | neon, mirrored pillars | pachislot ×3, fruitmachine ×2, lootbox, bandit ×2 |
| The Wheel House | `wheels` | 11…31; −2…12 | dome 6.0 / rim 3.5 | Wing Key | red velvet, gold, a chandelier | bigsix, tombola, fantan |
| The Parlour | `parlour` | 11…31; 12…20 | 2.6 | after Night 3 (fixed) | one bare bulb, cigarette haze | devilstable, shellgame + Moth Shrine |
| The Counting Room | `counting` | −31…−11; 12…20 | 2.8 | meta *The Back Office* / secret ending | ledgers, abacus wall, the Furnace | 3 pads only |
| Lift car | `lift` | −5.1…−2.9; −32.2…−30 | 2.6 | lobby / endings | brass walls | — |
| The Sump | `sump` | −6…6; −6…6 at y −30 | 4.0 | on fail | coins in the dark | — |

### 8.4 Connections
| Link | Opening | Gate |
|---|---|---|
| Mouth ↔ Well ↔ Lobby | open nave; brass pillars at x ±7 every 6 m | none |
| Mouth ↔ Midway | x −11, z −25…−21 | grille |
| Mouth ↔ Boiler | x 11, z −25…−21 | grille |
| Well ↔ Card Room | x −11, z −11…−7 | grille |
| Well ↔ Slot Gallery | x 11, z −11…−7 | grille |
| Lobby ↔ Laundry | x −11, z 3…7 | grille |
| Lobby ↔ Wheel House | x 11, z 3…7 | grille |
| Lobby ↔ Parlour | x 11, z 15…17 (2 m) | red velvet curtain `#6A0A14` + padlocked chain until Night 3 is paid |
| Lobby ↔ Counting Room | x −11, z 15…17 (2 m) | steel door "MANAGEMENT" |
| Mouth ↔ Lift | doors centred (−4.0, 0, −30.0), 2.0 × 2.6 m | opens at lobby, Dawn, endings |

Every wing connects directly to the nave, so any Wing Key order works. Closed wings show through their grilles: dark, with
machines under dust sheets and one marquee blinking faintly (a teaser).

### 8.5 Slot classes (TECH_SPEC sizes; a slot accepts its class or smaller)
| Class | Footprint max (W × D) | Max height | Stand area | Fits |
|---|---|--:|---|---|
| S | 0.8 × 0.8 | 2.0 | 1.0 m strip in front | coinflip (0.78 × 0.78 bell-jar booth), small props |
| M | 1.2 × 1.0 | 3.2 | 1.0 m strip in front | cabinets, booths, consoles (hilo, mines), lottoblower |
| L | 2.6 × 1.8 | 2.4 | 1.0 m ring on the player sides | tables: blackjack, baccarat, sicbo, cardwar, coinpusher, keno, devilstable, fantan, teetotum, threecard, reddog, dicetower; stalls and long cabinets: bigsix (counter + wall wheel above 1.8 m may rise to 3.1 m), tombola, bingopin |
| XL | 4.8 × 2.6 | 3.8 | 1.2 m ring on the player sides | bigone (with dais), roulette, holdem, craps, bingo, derby, elevator |

`src/world/layout.ts` maps `slotId → device id`. **Instance id = slot id.** Duplicates are independent instances.
Unregistered devices fall back to an out-of-order prop (TECH_SPEC §5.3).

### 8.6 Slot table (default layout; pads marked PAD)
"rotY" per §0: 0 = front faces south, 90 = east, 180 = north, 270 = west.

| Slot | Zone | Class | Position (x, y, z) | rotY | Default |
|---|---|---|---|--:|---|
| MOUTH-01 | mouth | M | (−8.5, 0, −29.35) | 0 | fortuneteller |
| MOUTH-02 | mouth | M | (10.35, 0, −27.8) | 270 | PAD |
| MOUTH-TERM | mouth | M | (0, 0, −29.35) | 0 | Debt Terminal (system `debt_terminal`) |
| MOUTH-PHONE | mouth | M | (4.0, 0, −29.3) | 0 | Hotline booth 1.1 × 1.1 × 2.4 (system `hotline`) |
| MOUTH-BOUNTY | mouth | wall | (8.0, 1.5, −29.84) | 0 | Bounty Board 1.6 × 1.0 (system `bounty_board`) |
| MOUTH-CLOCK | mouth | wall | (0, 4.3, −29.84) | 0 | Wall clock Ø 2.4 m |
| MOUTH-DIAL | mouth | wall | (0, 2.6, −29.84) | 0 | Floor dial B7…G (1.0 × 0.5 semicircle) |
| MOUTH-LIFTPANEL | mouth | wall | (−6.4, 1.3, −29.84) | 0 | Lift call panel (Wing Keys, Descend ▼, Topside G) |
| MOUTH-X | mouth | floor | (0, 0, −27.0) | — | Brass X plate 0.8 × 0.8 (co-op Collateral) |
| WELL-01 | well | XL | (0, 0, −4.0) on a 4.0 × 4.0 × 0.15 dais | 180 | **bigone** (cracked glass) |
| WELL-02 | well | XL | (−5.0, 0, −13.0) | 0 | roulette (croupier north) |
| WELL-03 | well | L | (5.0, 0, −13.0) | 0 | blackjack (dealer north) |
| WELL-04 | well | M | (−10.35, 0, −19.5) | 90 | bandit |
| WELL-05 | well | M | (−10.35, 0, −17.0) | 90 | PAD |
| WELL-06 | well | M | (−10.35, 0, −5.0) | 90 | bandit |
| WELL-07 | well | M | (−10.35, 0, −2.5) | 90 | PAD |
| WELL-08 | well | M | (−10.35, 0, 0.5) | 90 | hilo |
| WELL-09 | well | M | (10.35, 0, −19.5) | 270 | plinko |
| WELL-10 | well | M | (10.35, 0, −17.0) | 270 | PAD |
| WELL-11 | well | M | (10.35, 0, −5.0) | 270 | mines |
| WELL-12 | well | M | (10.35, 0, −2.5) | 270 | PAD |
| WELL-13 | well | S | (10.45, 0, 0.5) | 270 | coinflip |
| WELL-BOARD | well | hanging | (0, 6.5, −16.5) | 0 / 180 | Double-sided split-flap **Quota Board** 4.0 × 1.5 m |
| LOB-01 | lobby | M | (−10.35, 0, 9.0) | 90 | scratch |
| LOB-02 | lobby | M | (−10.35, 0, 11.5) | 90 | PAD |
| LOB-03 | lobby | S | (−10.45, 0, 13.5) | 90 | PAD |
| LOB-PAWN | lobby | wall | (−6.0, 0, 19.35) | 180 | Pawn Window, 2.0 m counter (system `charm_vendor`) |
| LOB-BOARD | lobby | wall | (−9.0, 1.4, 19.84) | 180 | Charm Board 1.6 × 1.0 |
| LOB-PHONE2 | lobby | M | (−3.0, 0, 19.3) | 180 | 2nd Hotline booth (MP, N ≥ 5) |
| LOB-DESK | lobby | wall | (0, 0, 19.2) | 180 | Concession Desk 3.0 × 1.0 + Clerk (system `concession_desk`) |
| LOB-CASH | lobby | wall | (6.0, 0, 19.35) | 180 | Cashier (system `cashier`) |
| LOB-JUKE | lobby | M | (10.35, 0, 9.0) | 270 | Jukebox (system `jukebox`) |
| LOB-TAPE | lobby | S | (10.45, 0, 10.7) | 270 | Tape deck (system `tape_deck`) |
| LOB-TONIC | lobby | M | (10.35, 0, 12.5) | 270 | The Apothecary (system `tonic_vendor`) |
| MID-01 | midway | XL | (−26.0, 0, −27.0) | 0 | elevator ("SERVICE CAR") |
| MID-02 | midway | XL | (−17.5, 0, −27.0) | 0 | derby (track long axis E–W) |
| MID-03 | midway | M | (−30.35, 0, −20.0) | 90 | claw |
| MID-04 | midway | M | (−30.35, 0, −18.4) | 90 | claw |
| MID-05 | midway | M | (−22.0, 0, −16.65) | 180 | stacker |
| MID-06 | midway | M | (−19.0, 0, −16.65) | 180 | cyclone |
| MID-07 | midway | M | (−25.0, 0, −16.65) | 180 | PAD |
| MID-08 | midway | L | (−21.0, 0, −21.5) | 0 | PAD |
| CARD-01 | cards | XL | (−24.0, 0, −9.0) | 90 | holdem (oval, 8 seats, dealer west) |
| CARD-02 | cards | L | (−16.0, 0, −14.95) | 0 | baccarat |
| CARD-03 | cards | L | (−16.0, 0, −3.05) | 180 | cardwar |
| CARD-04 | cards | M | (−30.35, 0, −14.0) | 90 | videopoker |
| CARD-05 | cards | M | (−30.35, 0, −4.0) | 90 | videopoker |
| CARD-06 | cards | M | (−21.0, 0, −15.35) | 0 | PAD |
| CARD-07 | cards | M | (−21.0, 0, −2.65) | 180 | PAD |
| CARD-08 | cards | L | (−16.0, 0, −9.0) | 270 | PAD (threecard / reddog target) |
| LAU-01 | laundry | XL | (−24.5, 0, 5.0) | 90 | bingo (caller cage west, desks east) |
| LAU-02 | laundry | L | (−20.0, 0, −0.95) | 0 | keno + wall board 3.0 × 1.8 at (−20.0, 2.8, −1.84) |
| LAU-03 | laundry | M | (−28.0, 0, 11.35) | 180 | pachinko |
| LAU-04 | laundry | M | (−26.7, 0, 11.35) | 180 | pachinko |
| LAU-05 | laundry | M | (−25.4, 0, 11.35) | 180 | pachinko |
| LAU-06 | laundry | L | (−16.0, 0, 9.0) | 180 | coinpusher (2 stations, north side) |
| LAU-07 | laundry | M | (−13.0, 0, 11.35) | 180 | lottoblower |
| LAU-08 | laundry | L | (−29.95, 0, 0.0) | 90 | bingopin |
| LAU-09 | laundry | M | (−30.35, 0, 2.5) | 90 | PAD |
| LAU-10 | laundry | L | (−18.0, 0, 4.5) | 90 | PAD |
| BOI-01 | boiler | XL | (22.0, 0, −23.0) | 0 | craps (stickman north) |
| BOI-02 | boiler | L | (14.5, 0, −28.95) | 0 | sicbo |
| BOI-03 | boiler | L | (29.95, 0, −27.0) | 270 | dicetower |
| BOI-04 | boiler | L | (14.5, 0, −17.05) | 180 | teetotum |
| BOI-05 | boiler | S | (30.45, 0, −19.0) | 270 | coinflip |
| BOI-06 | boiler | M | (30.35, 0, −23.0) | 270 | PAD |
| BOI-07 | boiler | L | (22.0, 0, −17.05) | 180 | PAD |
| GAL-01 | gallery | M | (14.5, 0, −15.35) | 0 | pachislot |
| GAL-02 | gallery | M | (16.0, 0, −15.35) | 0 | pachislot |
| GAL-03 | gallery | M | (17.5, 0, −15.35) | 0 | pachislot |
| GAL-04 | gallery | M | (20.5, 0, −15.35) | 0 | fruitmachine |
| GAL-05 | gallery | M | (22.0, 0, −15.35) | 0 | fruitmachine |
| GAL-06 | gallery | M | (25.0, 0, −15.35) | 0 | lootbox |
| GAL-07 | gallery | M | (14.5, 0, −2.65) | 180 | bandit |
| GAL-08 | gallery | M | (16.0, 0, −2.65) | 180 | bandit |
| GAL-09 | gallery | M | (17.5, 0, −2.65) | 180 | PAD |
| GAL-10 | gallery | M | (20.5, 0, −2.65) | 180 | PAD |
| GAL-11 | gallery | M | (22.0, 0, −2.65) | 180 | PAD |
| GAL-12 | gallery | S | (25.0, 0, −2.55) | 180 | PAD |
| GAL-13 | gallery | M | (20.0, 0, −8.5) | 0 | PAD (island, back to back with GAL-14) |
| GAL-14 | gallery | M | (20.0, 0, −9.5) | 180 | PAD (island) |
| GAL-15 | gallery | L | (29.95, 0, −9.0) | 270 | PAD |
| WH-01 | wheels | L | (21.0, 0, −0.95) + wheel Ø 1.8 on the wall, hub at (21.0, 2.15, −1.84) | 0 | bigsix |
| WH-02 | wheels | L | (29.95, 0, 2.0) | 270 | tombola |
| WH-03 | wheels | L | (16.0, 0, 10.95) | 180 | fantan |
| WH-04 | wheels | XL | (21.0, 0, 5.5) | 0 | PAD (MP: roulette #2) |
| WH-05 | wheels | M | (30.35, 0, 6.5) | 270 | PAD |
| WH-06 | wheels | L | (25.5, 0, 10.95) | 180 | PAD |
| PAR-01 | parlour | L | (24.0, 0, 16.0) | 270 | devilstable (player west, the Devil east) |
| PAR-02 | parlour | M | (16.0, 0, 19.35) | 180 | shellgame |
| PAR-03 | parlour | M | (16.0, 0, 12.65) | 0 | PAD |
| PAR-SHRINE | parlour | S | (28.0, 0, 12.55) | 0 | Moth Shrine (system `shrine`) |
| PAR-CHAIR | parlour | prop | (29.5, 0, 19.0) | 270 | The Collector's chair |
| CNT-01 | counting | M | (−28.0, 0, 12.65) | 0 | PAD (meta) |
| CNT-02 | counting | M | (−25.0, 0, 12.65) | 0 | PAD (meta) |
| CNT-03 | counting | L | (−20.0, 0, 18.95) | 180 | PAD (meta) |
| CNT-FURNACE | counting | prop | (−30.0, 0, 18.5) | 90 | The Furnace (secret ending) |

Totals: **48 machine instances** (37 types) + **27 pads** (+3 in the Counting Room) = 75 (78) placeable slots.
Start-open hub: 11 instances + 7 pads.

**Multiplayer "Busy floor" override** (host option, default on with ≥ 4 players):
| Pad → device | Pad → device |
|---|---|
| WELL-05 → videopoker | WELL-10 → bandit |
| WELL-12 → coinflip | LOB-02 → scratch |
| GAL-09 → bandit | GAL-10 → pachislot |
| GAL-13 → pachislot | GAL-14 → bandit |
| LAU-09 → pachinko | MID-07 → mines |
| CARD-06 → videopoker | WH-04 → roulette |
| BOI-06 → dicetower | — |

That leaves 14 pads for tycoon orders.

### 8.7 Lighting per zone (PSX vertex-lit; TECH_SPEC pool of 6 dynamic PointLights; everything else baked into vertex colours)
| Zone | Key light | Accent | Ambient | Fog colour, near / far (m) | Mood |
|---|---|---|---|---|---|
| Mouth | 2 sodium pendants `#FFB45A` | terminal amber CRT `#FFB000`, booth lamp `#FFD34A` | `#2A1A10` | `#120A06`, 6 / 28 | hotel lobby at 3 a.m. |
| Well | cone over the dais `#FFE2A0`; chandelier ring r 3 m at y 7.5, 24 bulbs `#FFB347` | marquee bulbs `#FFC861`, Big One emissive | `#1E1410` | `#0E0806`, 6 / 32 | cathedral of a slot machine |
| Lobby | brass sconces `#E8C46A` | jukebox glow `#FF8A3D`, Pawn backlight `#FFF2C0` | `#1A120C` | `#0D0A06`, 6 / 26 | faded hotel |
| Midway | bulb strings chasing `#FF4D6D` / `#FFD23F` / `#3BCEAC` at 4 Hz | black-light `#6A2CFF` (UV carpet) | `#1C0E1E` | `#120814`, 4 / 22 | dead carnival |
| Card Room | green banker lamps `#7CFF9A`, 1.2 m pools over felt | oxblood walls `#4A1016`, brass `#B08A3A` | `#0A120C` | `#06100A`, 4 / 20 | low, quiet, intimate |
| Laundry | fluorescent tubes `#A8F0FF` (1 in 6 flickers) | chrome highlights | `#0E1E26` | `#0A1418`, 6 / 26 | wet tile, drum washers |
| Boiler | bare bulbs `#FFE6B0` on cords | red neon "DICE" `#FF4A3A`, steam vents every 8–14 s | `#200808` | `#140404`, 4 / 22 | sweaty back alley |
| Slot Gallery | neon strips magenta `#FF3FA4` and cyan `#3FE0FF` | marquee chases | `#10061A` | `#08040F`, 5 / 24 | neon arcade |
| Wheel House | chandelier `#FFF0C8` | deep red `#C8102E`, gold `#E8B04A` | `#1E0808` | `#140505`, 4 / 22 | velvet and gold |
| Parlour | one bare bulb `#FFD9A0`, swinging ±12°, period 3.1 s | Devil eyes `#FF1A1A` | `#050303` | `#030202`, 2 / 10 | interrogation room |
| Counting Room | candle clusters `#FFCF7A` | furnace glow `#FF5A1A` | `#080504` | `#050302`, 2 / 12 | the back office |
| Lift | ceiling panel `#FFF2D0` | brass walls | `#2A2418` | none | safe, for 20 seconds |
| Sump | shaft light from above `#FFB45A` | coin glints | `#000000` | `#000000`, 2 / 14 | the bottom |

Dread (§6.2) and Brighter Bulbs scale every key light. Visibility: render the current zone, the nave and wings whose grille
is open and within 30 m; fog hides the rest.

### 8.8 Spawn points
| Set | Used by | Positions (x, y, z) | Facing |
|---|---|---|---|
| **Burst (solo)** | Debt Run | SP-0 (0, 0, −7.8), 1.8 m north of the dais edge (≈ 3.1 m from The Big One's glass) | north (yaw 0) |
| **Burst arc** (MP jackpot intro) | room option | r 3.8 around (0, −4), north side: (±0.50, 0, −7.77) · (±1.45, 0, −7.51) · (±2.31, 0, −7.01) · (±3.01, 0, −6.31) | north |
| **Mouth rows** | Co-op, Versus, Free Casino, late join | z −27.5 and −26.3; x ∈ {−6.25, −4.75, −3.25, −1.75} | south (yaw 180) |
| **Lift car** (pre-game lobby, Topside ride) | MP lobby | z ∈ {−31.8, −30.9}; x ∈ {−4.75, −4.25, −3.75, −3.25}; player–player collision off inside the car | south |
| **Ghost** | fallen players | rise from their trapdoor hole to y +1.0 | free |
| **Collector path** | Dawn | lift (−4.0, −31.0) → (−2.0, −29.0) → stands at (−1.0, −28.0) facing the terminal | — |

Visitation patrol nodes: one per open zone centre plus the 4 nave corners.

### 8.9 Trapdoor grid and the Sump
- Every walkable 2 × 2 m plate is a separate mesh with two hinged halves (TECH_SPEC: `walkable` boxes toggled by
  `setEnabled`).
- Excluded: the dais, the lift car, the 1 m door thresholds and machine footprints. A player standing on an excluded area
  at a failed Collection is pushed 1 m to the nearest plate first.
- **The Sump** at y −30: 12 × 12 × 4 m. A coin mound Ø 6 m × 1.2 m (3,000 instanced coins). The corkboard **Sump Wall**
  on the north wall holds the last 50 JackIDs. A rope ladder hangs in the shaft (the CLIMB AGAIN choice).

### 8.10 Wing unlocking (summary of §3.7.7)
- Wing Key after Nights 1–6 at MOUTH-LIFTPANEL. Wings can also be bought early at the Concession Desk (1.5 × quota).
- Favour F14 and charm `house_keys` open extra wings.
- The Parlour opens after Night 3 is paid.
- The Counting Room opens through meta or the secret ending.

---

## 9. Menu and intro flow

### 9.1 Boot
1. Black. Plain text (VT323, `#F2E8D0`): the simulated-gambling notice (§6.12), 2.5 s or any key.
2. Memory-card-style splash "JACK·ID — READING LEDGER…" (Press Start 2P, dithered, 1.5 s; CLOCK).
3. "PRESS ANY KEY" on a dark frame, blinking at 1 Hz. The key press unlocks the AudioContext and requests pointer lock.
   Cut to the jackpot menu.

### 9.2 The jackpot menu (inside The Big One)
**Scene.**
- The camera sits on the axis of a room-sized version of The Big One's reels.
- Three visible drums (ART §7.1 geometry: radius 0.87 m, 1.20 m wide, 12 facets of 0.45 m): left x −1.35, centre 0,
  right +1.35, axis y 0, z −2.2 in menu-local space.
- The two outer reels show at the screen edges, idle-spinning at 0.3 rad/s.
- Faces are backlit film panels `#FFE2A0` carrying catalogue Big One symbols (64×64) and menu labels (Press Start 2P on a
  256×128 canvas per face).
- A red neon **payline** `#FF2A2A` crosses at eye level; the selected row is the payline.

**Through the glass**, 1.8 m ahead (dusty, faint reflection, not yet cracked):
- the dark Well, as a low-detail fogged proxy;
- the wall clock reads **23:59** with a live second hand that loops back at :59 ("always one minute to midnight");
- every 40–90 s a tall silhouette (the Collector) crosses outside.

**Reel roles.**
- *Centre*: menu entries.
- *Left*: context (description, kit picker, House Edge, seed field, Obols, profile ledger).
- *Right*: the lever side (PULL TO PLAY, lobby players, settings values).

**Camera.** FOV 70°, mouse parallax ±6°, idle sway ±1.5° at 0.2 Hz. Motor hum 58 Hz plus a click per face. Menu music
"Inside the Jackpot" (§6.9).

**Input.**
- W/S or mouse wheel: rotate the active reel one face (0.18 s, 6° overshoot, mechanical clunk).
- A/D: move focus between reels.
- Enter/LMB: select. Esc/Backspace: back (the reel spins back).
- Hovering a visible face highlights it.

**Complex panels** use the ART §7.2 camera stations: server browser on the LEDGER CRT (left wall, cyan), settings on the
SERVICE CRT (right wall, green), credits on the MARQUEE strips, profile/mask on the HOPPER. Stats, THE FOUNDATIONS and
the kit picker render on the glass as a **lit panel**: a
256×144 canvas, PSX-dithered, amber `#FFB000` on `#140A00`. The reels dim to 30 % behind it.

### 9.3 Menu tree (labels are i18n keys `menu.*`)
| Centre reel | Next level | Left / right reel |
|---|---|---|
| PLAY | CONTINUE (if a save exists) · NEW DEBT RUN · DAILY · SEEDED | kit · House Edge 0–10 · seed entry · PULL TO PLAY |
| MULTIPLAYER | SERVER BROWSER (panel) · HOST · JOIN BY CODE · RECENT · SAME-BROWSER TABS | host form (panel) |
| FREE CASINO | SOLO · HOST · BROWSE | SI preset, options |
| THE FOUNDATIONS | meta tree (panel, §11.3) | Obols balance |
| LEDGER | STATS · ACHIEVEMENTS · COLLECTION (notes, tapes, cassettes, Charm Book, Machine Plaques) · SUMP WALL · UNLOCKS | — |
| SETTINGS | VIDEO · AUDIO · CONTROLS · GAMEPLAY · NETWORK · LANGUAGE (EN / TR) | values |
| CREDITS | scrolling strip (team, model roles, CC0 thanks: Screaming Brain Studios, PhobicPaul, Kenney, Quaternius) | — |
| QUIT | "Close the tab to leave the House." | — |

### 9.4 PLAY → JACKPOT → burst-out (solo; also the MP intro when the room option is on)
| t (s) | Event |
|---:|---|
| 0.00 | Select NEW DEBT RUN, confirm kit and House Edge. The camera turns 35° right to the interior **lever**. Prompt PULL: drag the mouse down ≥ 150 px within 0.6 s, or press Space. |
| 0.40 | Lever ratchet (18 clicks in 0.4 s). A coin sprite drops into an unseen slot (clink 2.1 kHz). |
| 0.50 | All drums ramp to 14 rad/s in 0.3 s; camera shake 0.01. |
| 1.20 → 2.20 | Drums stop left to right every 0.25 s on **SUN** (catalogue: the menu spin always lands a full screen of SUN): 6° overshoot, 0.08 s settle, a thunk per reel rising +1 semitone each. |
| 2.30 | **JACKPOT**: FM bells 880 / 1,320 Hz; backlights strobe gold `#FFD34A` at 8 Hz (3 Hz with Reduce Flashing) for 1.2 s; 120 coins pour past the camera. House: "Jackpot. Welcome home." |
| 3.10 / 3.40 / 3.70 | The glass cracks in three stages (decal grows, sharp ticks). |
| 3.80 | Outside, the wall clock strikes 00:00 (first chime). |
| 4.00 | Shatter: 64 triangle shards fly outward at 4–9 m/s with gravity. The camera dollies 5 m forward in 0.7 s (ease-out-expo); FOV 70 → 100 → 75. |
| 4.45 | One white-gold frame `#FFF0C0`. Scene swap at the same camera transform: you exit The Big One's front glass at WELL-01, which **stays cracked all run** (until its first upgrade). |
| 4.50 | The camera drops onto SP-0 (or your burst-arc slot): 0.12 m crouch dip over 0.3 s; shards tinkle; coins roll away. |
| 5.00 | **C01 Wake → C02 The First Quota** → control. Title card (VT323, centre) "NIGHT 1 · QUOTA 80 · 3 WATCHES", 2.5 s. Bell. |

- Skippable after the first time: hold Space 0.5 s to jump to 4.45. C01 and C02 skip after they have been seen.
- CONTINUE loads straight into the saved state with a 1.2 s "lights snapping on" transition.

### 9.5 Multiplayer lobby = the Lift
- Joining a room puts you in the lift car (§8.8). The floor dial descends G → B7 in a 40 s loop while you wait.
- Players stand, chat (T) and emote. **Ready** = press the brass "B7" button (it lights). The host's panel shows ready
  flags and START.
- **Start**: lights cut 0.5 s, cable judder, chime; the doors open on the Mouth and players spawn on the Mouth rows. With
  the "jackpot intro" option on, every client plays §9.4 instead and lands on the burst arc.

### 9.6 Server browser and host form (lit panel; departure-board flip digits, 8 ms per flip)
- **Transport tabs**: LOBBY (Node ws, auto-refresh 5 s) · SAME BROWSER (BroadcastChannel) · GLOBAL (Trystero / Nostr, if
  enabled in settings).
- **Columns**:

| Col | Content |
|---|---|
| 🔒 | pixel padlock if the room has a password |
| ROOM | name, 24 chars |
| HOST | host name |
| MODE | CO-OP / VERSUS / FREE |
| PLAYERS | 3/8 |
| PING | ms (green < 60, amber < 150, red ≥ 150) |
| STATE | IN LIFT / B5 · W2 (in progress) |
| NET | transport badge [LOBBY] / [TAB] / [NOSTR] |

- **Controls**:
  - W/S select · Enter join (password prompt if locked) · R refresh · H host · J join by code · click a header to sort.
  - F cycles filters: all / co-op / versus / free / has space / no password / hide in progress.
  - Default sort is ping ascending; full rooms are greyed.
- **Host form**: the settings of §7.6. It shows the co-op quota multiplier for the chosen max players. After hosting it
  shows the 6-char room code and **COPY INVITE LINK** (`?join=CODE`).

### 9.7 Pause (Esc): "The Ledger"
- A leather book overlay drawn at internal resolution (PSX-dithered); pages turn in 0.2 s.
- Entries:
  - RESUME;
  - **JACKID** (your card: name, OWED, punched holes, kit);
  - PUNCH CARD (full view);
  - CHARMS (inspect name, rarity, exact effect);
  - BUFFS (exact numbers, durations);
  - **HOLDINGS** (instances, levels, staff, income/min, Holdings, next Assessment);
  - RUN INFO (seed, kit, House Edge, quota table so far);
  - SETTINGS;
  - INVITE CODE and PLAYERS (MP; the host can mute or kick);
  - ABANDON RUN (hold 2 s → trapdoor);
  - SAVE & QUIT TO JACKPOT.
- SP freezes time. MP never pauses; a "?" floats over your avatar after 5 s.

### 9.8 Settings
| Tab | Options (defaults in bold) |
|---|---|
| Video | ART §1.14 (binding for visuals): Resolution CRUNCHY 180p / **STANDARD 225p (400×225)** / CLEAN 270p / HI 360p / OFF · Scale **FILL** / INTEGER · Vertex jitter OFF / LOW / **MEDIUM** / HIGH · Affine **on** · Colour 24 / **15** / 12-bit · Dither **on** · CRT OFF / **SUBTLE** / FULL · Fog distance 0.6–1.4 (**1.0**) · FOV (vertical) 50–80 (**62**) · Brightness 0.8–1.4 (**1.0**) · Flashes **FULL** / REDUCED (asked at first launch) · Light flicker **FULL** / REDUCED · Head-bob 0–100 % (**70**) · Screen shake 0–100 % (**100**) · UI PSX 1× / **CLEAN 2×** · Frame cap **OFF** / 30 |
| Audio | Master **80** · Music **60** · SFX **80** · Voice **80** · House speaks: **Babble** / Browser speech · Mono **off** · Proximity voice **off** · Push-to-talk **on** (Y) |
| Controls | Mouse sensitivity 0.1–5.0 (**1.0**) · Invert Y · Crouch hold / **toggle** · Rebind all keys |
| Gameplay | Language **EN** / TR · Subtitles **on** · Calm Mode **off** · Show Dread meter **off** · Diegetic-only HUD **off** · HUD scale ×1 / **×2** / ×3 · Number format **short** (1.23M) / long · Tutorial placards **on** · Skip seen cinematics **on** · Auto-deposit reminder at Last Call **on** · Confirm purchases ≥ 25 % of pocket **on** |
| Network | Player name (16 chars) · Colour / mask (8 player colours, ART_BIBLE §8.2) · Lobby server URL (**empty = same host `/lobby`**, proxied to :8787 in dev) · Preferred transport **Auto** / WebRTC / Relay / Nostr · Global lobby **off** |

### 9.9 Death and results: The Sump
- You land on the coin mound. The camera settles looking down at your **JackID**, enlarged into view.
- A thermal-receipt overlay (DESCENT) prints line by line (0.12 s per line, printer whirr):

```
  NAME                     RUN #34   SEED K7Q2-M9XD   HOUSE EDGE 2   KIT PAUPER
  FELL AT   NIGHT 4 (B4), WATCH 3 — SHORT BY 312¢
  PAID      3 of 8        TIME 31:42
  WAGERED   9,420¢        WON 8,870¢       INTEREST 1,104¢     STAFF 640¢
  BIGGEST   ×44 PLINKO BOARD (1,320¢)       HOLDINGS 2,900¢ (PEAK)
  FAVOURITE THE BIG ONE ★14 (41 pulls)      BEST ¢/MIN  ROULETTE
  CARD      5 lines · 0 blackouts           CALLS 4/6 answered
  CHARMS    [16×16 icons]                   OBOLS +5 (×0.5)
```
- **"The Night on a Clock Face"** (CLOCK): a clock dial drawn as a pie chart; each machine's share of your pulls is a
  coloured wedge.
- New unlocks are rubber-stamped onto the receipt (0.3 s thud each).
- Physical choices (look + E):
  - the rope ladder from the trapdoor = **CLIMB AGAIN** (same kit, new seed);
  - a coin labelled MENU = **BACK TO THE JACKPOT**;
  - the JackID itself = **COPY SEED**;
  - the corkboard = **SUMP WALL**;
  - the ferryman's bowl = **THE FOUNDATIONS**.
- Co-op: every teammate lands; JackIDs are laid side by side with award ribbons. Versus: ghosts watch the winner's lift ride
  on a CRT in the Sump.

### 9.10 Win: Topside
C08 (§6.7 A). Then **STAY UP** (bank Obols ×1.5, credits) · **GO BACK DOWN** (Overdrawn, C12) · **DESCEND** (prestige,
C07).

### 9.11 Stats (LEDGER → STATS; SaveStore `jackid:v1` → `stats`)
- **Lifetime**: runs, wins, best Night, best Overdrawn Night, total wagered / won, realised RTP, biggest single win
  (machine, ×, coins), longest win streak, blackouts, Collateral volunteered, times fallen, Obols earned, Descends, total
  staff income, peak Holdings, highest instance level.
- **Per machine**: pulls, wagered, won, realised RTP, best ×, coins per minute, max level reached.
- **Per charm**: times bought, win rate when held.

---

## 10. HUD and feedback

### 10.1 HUD layout
- Drawn into the 400×225 internal buffer and nearest-scaled, so it is PSX too.
- Fonts: VT323 16 px for numbers; Press Start 2P 8 px for labels; 1 px `#000000` shadow.

| Element | Anchor (internal px) | Content / style |
|---|---|---|
| Pocket | top-left (4, 4) | `¢ 1,234` `#FFD34A`; count-up 30 ticks/s on gain; red flash `#FF3030` 0.2 s on spend |
| Tickets | (4, 20) | `▣ 7` `#E8343A` |
| Staff income | (4, 34) | `+1.2K/min` `#7CFF4F` 8 px (only when you own staff) |
| Watch clock | top-centre (200, 4) | `02:31` = real time left in the Watch; Last Call `#FF3030` blinking 2 Hz; small wall time `03:40` (8 px) beneath |
| Night line | (200, 22) | `NIGHT 3 · WATCH 2/3 · B5` 8 px `#B8A890` |
| Quota | top-right (396, 4), right-aligned | `412 / 1,240` + 64×4 px bar: green `#3AFF6E` when ≥ quota, amber `#FFB45A` otherwise, red pulse in Last Call if short; below it `INT 8 %` |
| Buff bar | right edge from (396, 34) downward | up to 8 icons 12×12 with stack digit and radial timer; debuffs framed red |
| Pulls | bottom-centre (200, 212) | brass tokens 10×10 `#C8A040`; spent ones `#3A3020` |
| Charms | bottom-left (4, 205) | 16×16 icons, 2 px gap; on trigger a white flash 0.1 s and a 2 px hop |
| Mini punch card | bottom-right (396, 221) | 6×6 px cells; punched = black hole; completed line = gold |
| Crosshair | centre | 1 px dot `#F2E8D0` at 60 %; a 6 px ring over interactables; hidden when seated |
| Interact prompt | (200, 140) | `[E] THE BIG ONE ★14 · 1 PULL · BET 1–3K · TILT ●●●○ · HEAT ▲` and `[U] UPGRADE · OWNER ANA` |
| Event feed | (4, 80), max 4 lines, 6 s fade | `HOT LAMP: PLINKO BOARD` · `ANA PUNCHED DICE ◆` · `RIO HIT ×52 ON CRAPS` · `HAPPY HOUR` |
| Seated hint strip | (200, 200) | machine controls (catalogue §1.3), 8 px, auto-hides after 4 s idle |
| Phone indicator | under the clock | bell glyph + direction arrow, blinking with the ring cadence; 10 s timer arc |
| Dread vignette | screen edges | strength `0.35 × dread / 100` |

**Diegetic-only HUD** hides everything except the prompt and crosshair. Then **Q** raises the punch card and **J** raises
the JackID (pocket, quota, time left are printed on it).

### 10.2 Diegetic displays (the HUD mirrors these)
| Object | Shows |
|---|---|
| Debt Terminal CRT (amber `#FFB000` on `#140A00`, 320×240 canvas) | Night, quota breakdown (base, Assessment), deposit, interest rate (with line bonuses), Watches left, SETTLE / OPEN THE FLOOR levers, BELL ROPE, BAIL key (co-op), card printer |
| **Quota Board** (WELL-BOARD, double-sided split-flap, 4.0 × 1.5 m) | NIGHT · WATCH · TIME LEFT · QUOTA · DEPOSIT % · current Hot / Cold Lamps · global event icon. Bulbs dim with quota pressure. |
| Wall clock (Ø 2.4 m, face `#E8DDC0`) | Second hand = Watch time (one sweep per Watch); hour hand = wall time 00:00–06:00; red Last Call sector; 13 numerals on Night 8 |
| Floor dial | B7 … B1, G; Overdrawn: off-scale |
| Marquees | suit badge, 4 Tilt bulbs + TILT tube, Hot / Cold beacon, gold Heat chase, occupant name (MP) |
| Service Plate | ★ level (nixie), owner nameplate, staff badge, Shill P&L |
| Charm Board | your charms on pegs; a charm rattles when it triggers |
| Punch card (hold Q) | the full card in hand, shown at 3× |
| JackID (hold J) | name, OWED, holes per paid Night, pocket, quota, time left |
| Big One pot meter | 8-digit 7-segment on the top box (catalogue JACKPOT meter) |

### 10.3 Upgrade Ledger panel (U)
- An overlay at internal resolution, ledger-book style, 360 × 180 px.
- It opens only while you stand still or sit; moving closes it.
- **Header**: device name · instance id · ★ level · owner · staff and income/min · Shill P&L.
- **Rows** (Payout, Luck, Speed, Cap, Seats, Staff): name · level/max · effect now → next · next milestone ("L25:
  CORNERSTONE") · cost · [BUY].
- **Footer, the clarity line**: `+1,590 HOLDINGS → +127 ON NEXT ASSESSMENT`. Every purchase previews its tax.
- **Keys**:
  - W/S select · Space or LMB buy · M cycles ×1 / ×10 / MAX · Shift+LMB ×10 · Ctrl+LMB MAX;
  - H hire (Attendant / Shill) · Esc or U close.

### 10.4 Juice tiers (thresholds use the catalogue tags)
| Tier | Threshold | Feedback |
|---|---|---|
| Loss | mult = 0 | Low thunk (120 Hz, 60 ms); bet coins slide into the slot; a Tilt bulb ticks |
| Push / refund | ≤ ×1 | Soft tick; coins return to the tray |
| Win | ×1–×10 | 6–15 coins drop into the tray, chime C6, count-up; a number pop rising 12 px over 0.6 s |
| `bigwin` | ≥ ×10 | 3 s light chase, fanfare, 40 coins, 60 ms hitstop |
| `hugewin` | ≥ ×25 | 5 s, coin fountain, in-pose shake 0.004 m / 12 Hz / 0.6 s, nearby marquees pulse |
| `megawin` | ≥ ×50 | 7 s, room lights strobe gold `#FFD040` within 10 m, world toast to all players |
| `jackpot` | FULL / pot | §10.5 |
| Punch | cell | card snaps up 0.25 s, "chunk", hole; line → gold glow, coins visibly rain into the terminal, "Line." |
| Deposit | — | coin stream 0.6 s into the slot; counter rolls 60 digits/s; a beep per 10 % of quota; at 100 % a PAID-style stamp thunk |
| Charm trigger | — | HUD icon flash, Charm Board rattle, an 80 ms charm blip (pitch by rarity) |
| Lamp roll | Bell | siren whoop on Hot (300 → 900 Hz, 0.8 s); hollow chime on Cold |
| Upgrade | buy | Clerk's bell + ratchet; the part attaches with a 0.2 s scale-pop; milestone: 3-note arpeggio, gold sparkle, House line |
| Staff hired | hire | mannequin walks in from the nearest door (4 s), sits with `Sitting_Enter`; coin sprites start rising |
| Machine delivered | order | C06b crate-and-chains montage |
| Ascent | paid | C05 |

### 10.5 Jackpot sequence (FULL on The Big One, or any pot payout)
| t (s) | Beat |
|---:|---|
| 0.00 | Hitstop 120 ms. All pit lights cut to 10 % except the machine. |
| 0.12 | The marquee strobes gold at 10 Hz (3 Hz with Reduce Flashing). House: "Jackpot." |
| 0.30 | **Gold wave**: every marquee in the pit flashes gold in a radial wave from the machine at 12 m/s (the whole pit in ≈ 3 s). |
| 0.30 → 4.30 | Coin fountain: 200 instanced coins from the top box on 3–6 m/s parabolas, one floor bounce each, then settle and fade. The count-up runs. |
| 1.00 | FM bell loop 3 s; the catalogue fanfare; shake 0.03 decaying over 2 s; FOV +4°. |
| 4.50 | Lights restore over 1 s (10 % dimmer at Watched+). Remote players see the wave pass and get the toast. |

### 10.6 Controls (walking; seated controls follow the catalogues §1.3)
| Key | Action |
|---|---|
| WASD / Mouse | Move / look (pointer lock) |
| Shift | Sprint |
| C | Crouch |
| Space | Jump-step (0.35 m hop) · hold 0.5–0.8 s to skip cinematics |
| E | Interact / sit / stand / answer the phone / hang up / deposit |
| U | Upgrade Ledger for the looked-at or seated instance |
| Q (hold) | Raise the punch card and expand the charm row (walk mode; seated, hold **Tab** for the run summary with the full card, because Q is the machines' COLLECT key) |
| J (hold) | Raise your JackID |
| 1 / 2 / 3 | Phone choices; ghost Bless (1) / Curse (2); vote options |
| G | Give coins (co-op): tap 10 %, hold 25 % · at the lift panel on Topside: ride up |
| Middle mouse / Z | Ping marker (6 s, visible to teammates) |
| F | Use the held item (tonic in hand; T2 Totems) |
| B | Place / pick up a Totem (T2, Addendum 8) |
| V / Shift+V / 7 / 8 / 9 | Wave / point / cheer / shrug / dance |
| Y (hold) | Push-to-talk (proximity voice, tier 2) |
| Tab | Scoreboard (MP) / run summary (solo) |
| T | Chat (120 chars; 8 lines; 8 s fade) |
| Esc | Pause / the Ledger |
| F1 | Controls card overlay |

---

## 11. Meta progression

### 11.1 Philosophy
- Power comes mainly from inside the run.
- The meta layer (Addendum 1 prestige) adds **capped** permanent upgrades through Obols and unlocks **variety**: charms,
  kits, House Edge levels, collectibles, cosmetics, story layers.
- Design cap: a fully built Foundations tree raises the Median sim policy's win rate from 15 % to **≤ 35 %**, never more.

### 11.2 Obols and Descend
- `Obols = floor( 0.6 × cbrt(totalDeposited this run) ) × outcomeMult × (1 + 0.10 × HouseEdge) + firstTimeBonuses`.
  - **outcomeMult**: Descend 1.0 · Topside STAY UP 1.5 · Versus winner 1.5 / others 0.5 · fall 0.5 · abandon 0.25 ·
    seeded runs × 0.5.
  - **firstTimeBonuses**: first Night 5 paid +10 · first win +50 · each Descend layer reached for the first time +25.
  - Examples:

| Outcome | Deposited | Obols |
|---|---|---|
| Fall at Night 5 | ≈ 6K | 0.6 × 18.1 ≈ 10 → ×0.5 = **5** |
| Win, STAY UP | 1.34M | 66 × 1.5 = **99** (+50 first time) |
| Overdrawn Night 12, Descend | ≈ 340M | **419** |

- **Descend** (prestige): the ▼ button on the lift panel (MOUTH-LIFTPANEL) becomes available in any Night intermission once
  Night 3 is paid, and at Topside. It requires holding E for 2 s, plays C07 plus the layer reveal, ends the run and banks
  the Obols.

### 11.3 The Foundations (meta tree; 5 branches + capstone; costs in Obols)
| Branch (unlock) | Node | Effect | Max | Cost per level |
|---|---|---|--:|---|
| **The Vault** (start) | V1 Nest Egg | start pocket +10 ¢ | 5 | 5 × L |
| | V2 Lined Pockets | +1 starting Ticket | 3 | 8 × L |
| | V3 Compound | +1 % interest per Watch | 2 | 30 · 90 |
| | V4 Good Standing | overpay thresholds −0.05 | 1 | 40 |
| | V5 Ferryman's Cut | Obol gain +10 % | 5 | 25 × L |
| | V6 Pawnbroker's Friend | charm sell value 60 % (80 % with `pawn_ticket`) | 1 | 60 |
| **The Floor** (start) | F1 Union Contract | upgrade costs −5 % | 5 | 10 · 20 · 40 · 80 · 160 |
| | F2 Good Help | Attendant and Shill rates +10 % | 5 | 10 × 2^(L−1) |
| | F3 Bigger Staff Room | Attendant cap +2, Shill cap +1 | 1 | 50 |
| | F4 The Catalogue | order any of the 39 devices from Night 1 | 1 | 80 |
| | F5 Grandfathered | Assessment starts at Night 4; rate −1 pp | 1 | 120 |
| | F6 The Back Office | the Counting Room (3 pads) is open from Night 1 | 1 | 200 (free via ending C) |
| **The Hand** (Descend layer S1) | H1 Lucky Bones | luck +1 on all machines | 3 | 40 · 120 · 360 |
| | H2 Early Bird | +1 pull per Watch on Nights 1–3 | 1 | 50 |
| | H3 Steady | Tilt grace +1 | 1 | 80 |
| | H4 Warm Lamps | Hot Lamp ×1.5 → ×1.6 | 1 | 100 |
| | H5 Hole Puncher | line bounty 10 % → 12 % | 1 | 120 |
| | H6 Tenth Peg | +1 charm peg (in-run cap 10) | 1 | 250 |
| **The Lamp** (S2) | L1 Night-Light | Dread −5 | 3 | 20 × L |
| | L2 Thick Skin | Visitation penalties halved | 1 | 60 |
| | L3 Long Cord | phone ring +4 s; missed calls add no Dread | 1 | 30 |
| | L4 Second Wind | once per run, a Dawn shortfall ≤ 5 % is forgiven | 1 | 150 |
| | L5 Bright Start | every run begins with Brighter Bulbs L1 | 1 | 60 |
| | L6 Collector's Courtesy | H33 never fires; each Collector sighting gives +1 Ticket | 1 | 90 |
| **The Lift** (S3) | T1 Kit Bag | +1 random Common charm at run start | 1 | 30 |
| | T2 Wing Choice | start every run with one wing of your choice open | 1 | 120 |
| | T3 Daily Double | Daily Run Obols ×1.5 | 1 | 40 |
| | T4 Deep Pockets | +1 random Uncommon charm at run start | 1 | 100 |
| | T5 Golden Ticket | the first Pawn reroll each intermission is free | 1 | 70 |
| | T6 Cassette Hunter | cassette drop chances ×2 | 1 | 50 |
| **The Root** (S4 capstone) | R1 The House Knows You | all payouts +5 % (A) forever; the House always uses your name | 1 | 1,000 |

Maxing everything costs ≈ 4,950 Obols, about 30–50 winning runs. The panel shows Obols as black coins hung on a brass
tree.

### 11.4 Kits (choose at run start, left reel)
| Kit | Start | Unlock |
|---|---|---|
| Pauper | 50 ¢, 2 Tickets | default |
| Card Sharp | 35 ¢, Counting Bead, Card Room open from Night 1 | pay Night 3 with ≥ 40 % of winnings from CARDS |
| Dice Rat | 35 ¢, Loaded Pip, Boiler open | same rule, DICE |
| Wheelwright | 35 ¢, Greased Axle, Wheel House open | same rule, WHEELS |
| Drop Fiend | 35 ¢, Lead Shot, Laundry open | same rule, DROPS |
| Curio Collector | 35 ¢, Glass Eye, Midway open | same rule, CURIOS |
| The Regular | 40 ¢, Brass Thimble, The Big One TOOTH +1 | hit FULL once |
| The Banker | 0 ¢ pocket, 60 ¢ already deposited, Piggy Tooth | earn ≥ 2,000 ¢ interest in one run |
| The Landlord | 40 ¢, Ledger of Leases, first hire free | have 5 Attendants in one run |
| The Debtor | 100 ¢, Wet Ledger (cursed) | fall 3 times |
| The Heir | 200 ¢, Glass Heart (cursed) | win once |

### 11.5 House Edge ladder (difficulty; cumulative; unlock = win at the previous level; Obols +10 % per level)
| HE | Modifier |
|---|---|
| 1 | All base quotas +10 % |
| 2 | Pawn Window −1 regular slot |
| 3 | Tilt starts 1 pull earlier (pulls 1–3 full) |
| 4 | Interest −1 % per Watch (min 1 %) |
| 5 | The Collector roams from Night 5 (a touch costs 10 % of pocket, once per Watch) |
| 6 | −1 pull per Watch on Nights 1–4 |
| 7 | Line bounty 8 % instead of 10 % |
| 8 | Assessment rate 12 % |
| 9 | Tycoon costs +25 % |
| 10 | "The Long Night": Night 8 has 5 Watches and base quota ×1.5 |

### 11.6 Overdrawn House Rules (one more per Night ≥ 9; drawn without replacement, then "II" versions at double strength)
1. **Short Clock**: −30 s per Watch.
2. **Table Tax**: 5 % of each win goes to the Big One meter.
3. **Dim**: fog far ×0.5.
4. **Sticky Tilt**: half the Tilt (rounded down) carries into the next Watch.
5. **Two Colds**: 2 Cold Lamps.
6. **Heavy Pockets**: walk speed −15 % while pocket > quota.
7. **Silent Line**: no random calls.
8. **Tight Card**: +1 Gold cell replaces a Bronze.
9. **Closing Early**: Last Call starts at 40 s.
10. **Price Hike**: charms +30 %.
11. **Mandatory Spend**: unused pulls give 0 Tickets.
12. **The Collector's Interest**: quota +2 % per Watch.
13. **Strike**: Attendant income −30 %.
14. **Rezoning**: Assessment rate +4 pp.
15. **Power Rationing**: one random wing is closed each Night.
16. **Wage Hike**: staff wage 10 % → 25 %.

### 11.7 Achievements (36; i18n `ach.*`)
| id | Name | Condition |
|---|---|---|
| `first_night` | First Night | Pay Night 1 |
| `going_up` | Going Up | Win a Debt Run |
| `overdrawn` | Overdrawn | Pay Night 12 |
| `trillionaire` | Trillionaire | Deposit 1T in one Night |
| `blackout` | Blackout | Complete a full punch card |
| `full_circuit` | Full Circuit | Win on all six suits in one Watch |
| `floodgate` | Floodgate | Hit FULL on The Big One |
| `card_counter` | Card Counter | Win 10 blackjack hands in one run holding Counting Bead |
| `hardway_home` | Hardway Home | Make the point the hard way on craps |
| `edge_case` | Edge Case | Win an EDGE call at the Coin-Flip Booth |
| `top_floor` | Top Floor | Cash out The Elevator at ×100+ |
| `sapper` | Sapper | Clear 20 safe tiles in one Mines round with ≥ 3 mines |
| `i_saw_that` | I Saw That | Call Cheat correctly on the Shell Automaton |
| `stacked` | Stacked | Win the Stacker Major prize |
| `long_odds` | Long Odds | Win a derby bet on the longest-odds rat |
| `six_chambers` | Six Chambers | Reach the Devil's Due at the Devil's Table |
| `collateral` | Collateral | Volunteer in co-op, and your team pays the next Night |
| `last_ghost_laughing` | Last Ghost Laughing | As a ghost, Bless the eventual Versus winner 3 times |
| `cursed_proud` | Cursed and Proud | Win while holding 3 cursed charms |
| `penny_pincher` | Penny Pincher | Win without buying a charm above Common |
| `switchboard` | Switchboard | Answer 10 calls in one run |
| `do_not_answer` | Do Not Answer | Win without answering any random call |
| `tilted` | Tilted | Have 3 instances at TILT in one Watch |
| `lucky_numbers` | Lucky Numbers | Match 5+ on the Lotto Blower |
| `house_favourite` | House Favourite | Win 10 plays on Hot Lamp machines in one Watch |
| `landlord` | Landlord | Employ 5 Attendants in one run |
| `centurion` | Centurion | Bring any instance to Payout L100 |
| `empire` | Empire | Reach Holdings ≥ 1B |
| `not_seen` | Not Seen | Survive a Visitation unseen |
| `archivist` | Archivist | Read all 28 notes |
| `all_tapes` | Tapes in the Dark | Hear all 8 tapes |
| `mixtape` | Mixtape | Collect all 6 cassettes |
| `descender` | All the Way Down | Reach Descend layer S4 |
| `void_the_marker` | Void the Marker | See the secret ending |
| `full_table` | Full Table | Pay Night 8 in co-op with 8 players alive |
| `daily_bread` | Daily Bread | Finish 7 Daily Runs |

### 11.8 Collectibles, unlocks and cosmetics
- **Persistent collectibles**: 28 notes (incl. the 2 pit tapes), 8 lobby tapes, 6 cassettes (§6.11). The **Charm Book** (100 silhouettes, filled on
  first purchase). **Machine Plaques**: 100 plays on a device engrave its brass plaque in the Ledger (rules card, realised
  RTP, a cosmetic trim for that device).
- **Charm unlock batches** by the codes in §4.2 (N2–N6, W, F3, A:, D). A charm unlocked mid-run enters the pool
  immediately.
- **Daily Run** unlocks after paying Night 2. Seeded runs and Overdrawn unlock after the first win. House Edge levels follow
  §11.5.
- **Cosmetics**:
  - coin skins: Brass, Silver, Oxidised, Obsidian, Paper, Ash (5 / 15 / 30 runs, Overdrawn N10, Calm Mode win, ending C);
  - hand skins: Bare, Gloved, Ringed, Bandaged, Porcelain (achievements);
  - 6 JackID card frames; 3 menu reel skins.

### 11.9 Bounties and daily challenges (Addendum 3: "more things to do")
- **Bounty Board** (MOUTH-BOUNTY, from Night 3): 3 contracts per Night (seed stream `bounty`). Completing one pays at
  once; unfinished contracts expire at Dawn. Rewards marked "% quota" use the base quota.

| id | Contract | Reward |
|---|---|---|
| `b_bj_streak` | Win 3 blackjack hands in a row | 3 Tickets |
| `b_cross` | Hit a CROSS or better on The Big One | 10 % quota |
| `b_elevator5` | Cash out The Elevator at ≥ ×5 | 2 Tickets + 5 % quota |
| `b_four_suits` | Win on 4 different suits in one Watch | a free Uncommon charm next intermission |
| `b_point` | Make a point on craps | 3 Tickets |
| `b_mines8` | Clear 8 safe tiles in one Mines round | 5 % quota |
| `b_derby6` | Win a derby bet at ≥ ×6 | 3 Tickets |
| `b_holdem_2p` | Win a hold'em pot with two pair or better | 5 % quota |
| `b_devil2` | Survive 2 pulls at the Devil's Table and COLLECT | the under-the-counter slot shows a Rare next visit |
| `b_early_half` | Deposit 50 % of quota before Watch 2 | +2 % interest this Night |
| `b_two_punch` | Punch 2 cells in one Watch | 2 Tickets |
| `b_claw` | Deliver a claw capsule | 2 Tickets |
| `b_bigwin` | Any ×25+ win | 10 % quota |
| `b_ride5` | Win 5 coin-flip rides in a row | 4 Tickets |
| `b_natural` | Win a baccarat coup with a natural | 2 Tickets |
| `b_milestone` | Reach any upgrade milestone (L10 / 25 / 50 / 100) | 3 Tickets |
| `b_staff25` | Earn 25 % of the quota from staff this Night | 5 % quota |

- **Daily challenges** (meta): 3 per UTC day drawn from the same templates, "in any run today". Rewards 5 / 10 / 20 Obols.
  Tracked locally and on the lobby server when available.

### 11.10 Seeds and Daily Run
- **Seed**: 8 Crockford base32 characters (40 bits), shown as `K7Q2-M9XD` on pause and results.
- Independent RNG streams `hash32(seed, streamName)`:
  - `shop`, `phone`, `lamps`, `card`, `events`, `collector`, `world`, `shill`, `bounty`, `music`;
  - plus per-instance machine streams (catalogue §1.5).
- Same seed + same actions = same run.
- Seeded runs: achievements disabled except Daily ones, no leaderboards, Obols × 0.5.
- **Daily**: seed = base32(hash32("JACKID-DAILY-" + UTC YYYY-MM-DD)). Kit Pauper, House Edge 2, plus one Overdrawn House
  Rule as the "Daily Rule".
  - Only the first attempt per day scores.
  - Score = Nights paid × 1,000,000 + min(999,999, floor(final surplus ÷ SI)).
  - Board: `GET/POST /daily` on the lobby server, top 100; local fallback.

---

## 12. Risks, mitigations, and why this design is the most fun

### 12.1 Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| **39 devices** (model + logic + sound each) | scope blow-out | Catalogue tiers. The hub's 11 machines first (a complete Nights 1–3 loop); then one wing at a time. Wing Keys mean a partial roster is still a complete game. Unregistered ids fall back to out-of-order props. |
| **Balance** (39 devices × 100 charms × 6 tracks × buffs) | dominant strategies | §3.11 rules; `tools/sim` with 4 policies; pass-rate and tycoon targets (§3.12); launch cut of 71 charms; knobs in a fixed order. |
| **Tycoon swallows gambling** (idle replaces play) | the casino stops being a casino | Y values scaled to ≈ 12 % of quota per maxed Attendant; Shills at 1 % stakes and half speed; Assessment and depreciation; staff never runs in untimed intermissions; sim target: staff = 20–40 % of N8 income. |
| **Clarity overload** | new players bounce | One system per Night (§2.9); H38 Orientation; opt-in placards; the Ledger panel with exact numbers; the Holdings → Assessment preview on every purchase; Calm Mode. |
| **Tilt feels punishing or opaque** | frustration | Diegetic bulbs + prompt bulbs; H07 Service Technician; the Hot Lamp is the readable "where to go"; Heat rewards a 4–6 pull stay. |
| **Run length** (28 Watches) | session fatigue | Closing auto-starts at 0 pulls; Settle Early; save after every action; Free Casino is drop-in. |
| **Low-res legibility** (400×225) | unreadable machines | In-world glyphs ≥ 8 px at ≥ 2 internal px (catalogue §1.2); HUD ×2 default; Q card at 3×; Service Plate nixies 2× size. |
| **MP determinism** | desyncs | Outcome-first (catalogues §1.5). The host pre-rolls; clients play steered animations. Coin pusher, Shills and staff ticks run on the host only. |
| **Horror vs casino fun** | tone clash | Dread ramps by Night (cosy Night 1); lighting upgrades push it back; Calm Mode; taste rules §6.12. |
| **Gambling sensitivity** | rating, parents | Fictional currency only, no purchases, no loot boxes with real value, boot notice. |
| **Co-op griefing** | social friction | Personal pockets, voted withdrawals, ownership by contribution, voluntary Collateral, host kick. |
| **Versus kingmaking** by ghosts | unfair endings | 1 action per Watch, never the same target twice, names shown, Ghost Call by majority, rent paid by the House. |
| **CloverPit similarity** | IP risk | Original names, symbols, characters, fiction (JackID, the Collector, Mother Moth, the Sump, Watches, suits, punch card, Tilt, tycoon). Mechanics in spirit only. Director checklist pass before content lock. |
| **"The Elevator" crash game vs the real lift** | confusion | The real one is always "the Lift" in UI and voice; the crash cabinet reads "SERVICE CAR". |
| **Big numbers** | overflow, ugly UI | One formatter (§3.9); TECH_SPEC clamps raised (Appendix C). |
| **Performance** (78 slots, mannequins, music) | frame drops | Zone visibility; ≤ 6 dynamic lights; mannequin LOD (6 fps animation beyond 8 m, frozen beyond 12 m, ≤ 24 animated at once); ≤ 24 synth voices; drum loops pre-rendered with `OfflineAudioContext` at boot. |
| **Cutscene sync in MP** | divergence | Host `t0`, deterministic timelines, majority skip, late joiners skip. |

### 12.2 Why this design is the most fun
1. **It keeps the proven heartbeat.** Quota, Dawn, deposit, interest, charms, phone and trapdoor form a loop players
   already love. We gamble on the floor, not on the core.
2. **It makes 39 machines matter.** THE CIRCUIT turns every Watch into a route-planning puzzle across a 3D room; the
   tycoon layer gives every machine a second life as an asset, even the ones you rarely play.
3. **Three decisions at once, every 20 seconds.** Play (where), Pay (how much, when), Invest (what to build, knowing the
   House will tax it). Each has a visible number attached.
4. **Progress you can stand in.** The pit rises a floor per quota, a wing grinds open, your machines grow gilded, and your
   mannequins sit at your tables. The story is told by the room, then sharpened by short cutscenes.
5. **Numbers that go up forever**: from 80 coins on Night 1 to trillions in Overdrawn, with Descend pulling you back for
   one more life.
6. **Horror with a dial.** Dread is driven by your own ledger and pushed back by your own light bulbs. The Collector's
   footsteps mean exactly one thing: deposit.
7. **It scales from a 6-minute Night 1 to a 90-minute Topside to endless Overdrawn**, and from solo to 8-player drama:
   Collateral volunteers, ghost blessings, rival landlords collecting rent.
8. **It is buildable in parallel.** Every system is a table, every machine a slot, every charm a hook, every upgrade a
   generated row, every cutscene a timeline file.

### 12.3 Build order (superseded by `docs/PLAN.md` §2 milestones M0–M4; kept for intent)
| Phase | Content | Exit criterion |
|---|---|---|
| A — vertical slice | Mouth, Well, Lobby; 11 hub machines (catalogue tier 1 first); Nights 1–3; terminal, Watches, pulls, interest; Pawn Window + charms #1–40; calls H01–H12 + H38; Payout and Cap tracks; jackpot menu + burst + C01–C03; lounge music | A full Night 1–3 run is playable solo |
| B — the pit | Wings in this order: Card Room, Slot Gallery, Boiler, Wheel House, Laundry, Midway; then the Parlour. Punch card, Lamps, Heat, full tycoon, buffs, global events, Dread tiers, zone music, jukebox, notes | 8-Night run, all 37 default types |
| C — friends | Co-op, Versus, Free Casino, server browser, invite links, lift lobby, ghosts, all cutscenes, Overdrawn, Descend + Foundations, achievements, Daily | 4-tab BroadcastChannel soak + 2-machine WebRTC session pass |
| D — polish | threecard, reddog, charms #61–100, proximity voice, secret ending, cosmetics | content lock |

---

## Appendix A — id reconciliation (the catalogues are authoritative for device ids)
| Pitches / TECH_SPEC provisional | Final id |
|---|---|
| `big_one` | `bigone` |
| `video_poker` | `videopoker` |
| `dragon_tiger`, `war` | `cardwar` (War / Dragon-Tiger toggle) |
| `sic_bo` | `sicbo` |
| `big_six`, `money_wheel` | `bigsix` |
| `coin_pusher` | `coinpusher` |
| `crash_cable`, `elevator_crash` | `elevator` |
| `lotto_blower`, `lotto` | `lottoblower` |
| `scratch_vend` | `scratch` |
| `shell_game` | `shellgame` |
| `coin_flip` (TECH_SPEC reference machine folder) | `coinflip` |
| `dice_tower` | `dicetower` |
| `revolver`, `devils_table` | `devilstable` |
| `fortune_teller` | `fortuneteller` |
| `claw_crane` | `claw` |
| `hi_lo` | `hilo` |
| ART_BIBLE v1.0 ids: `peg_drop`, `light_ring`, `tower_stack`, `rat_derby`, `crash_elevator`, `money_wheel`, `scratch_vend`, `claw_crane`, `devils_table` | `plinko`, `cyclone`, `stacker`, `derby`, `elevator`, `bigsix`, `scratch`, `claw`, `devilstable` |

- System devices keep TECH_SPEC ids: `debt_terminal`, `charm_vendor` (shown as "Pawn Window"), `cashier`, `hotline`,
  `jukebox`.
- New system ids: `concession_desk`, `tonic_vendor`, `bounty_board`, `shrine`, `tape_deck`.
- Slot ids are §8.6 (they replace TECH_SPEC's reference layout v0; design docs win on ids and coordinates).

## Appendix B — Device data for the tycoon generator (`src/game/data/tycoon/devices.ts`)
`patronRate` = plays per minute at ×1 speed. Machine-family values are defined here; table values come from the catalogue
Idle profiles. Shills play at `0.5 × patronRate`. Y is in §3.5.

| id | size | tier | patronRate | id | size | tier | patronRate |
|---|---|:-:|--:|---|---|:-:|--:|
| bigone | XL | 1 | 8 | roulette | XL | 1 | 3.5 |
| bandit | M | 1 | 10 | blackjack | L | 1 | 1.4 |
| videopoker | M | 1 | 6 | holdem | XL | 1 | 1.2 (hands) |
| elevator | XL | 1 | 4 | devilstable | L | 1 | — |
| scratch | M | 1 | 6 | baccarat | L | 2 | 2.2 |
| pachislot | M | 2 | 9 | craps | XL | 2 | 4.0 |
| pachinko | M | 2 | 2 (trays) | sicbo | L | 2 | 3.0 |
| plinko | M | 2 | 8 | bigsix | L | 2 | 3.0 |
| coinpusher | L | 2 | 5 (drops) | cardwar | L | 2 | 3.5 |
| cyclone | M | 2 | 8 | hilo | M | 2 | 3.0 |
| mines | M | 2 | 6 | keno | L | 2 | 2.4 |
| dicetower | L | 2 | 4 | derby | XL | 2 | 1.3 |
| lootbox | M | 2 | 3 | fortuneteller | M | 2 | — |
| claw | M | 3 | 2 | coinflip | S | 2 | 6.0 |
| stacker | M | 3 | 3 | threecard | L | 3 | 2.2 |
| fruitmachine | M | 3 | 8 | reddog | L | 3 | 3.0 |
| bingopin | L | 3 | 3 | bingo | XL | 3 | 0.8 |
| | | | | lottoblower | M | 3 | 0.5 |
| | | | | tombola | L | 3 | 2.5 |
| | | | | shellgame | M | 3 | — |
| | | | | fantan | L | 3 | 3.0 |
| | | | | teetotum | L | 3 | 1.5 (cycles) |

Other data files implied by this GDD (Haiku-owned unless noted):
- **Run, economy and tycoon**:
  - `src/game/data/nights.ts` (§2.4), `econ.ts` (§2.6, §3.3);
  - `tycoon/tracks.ts`, `tycoon/improvements.ts`, `tycoon/orders.ts` (§3.7).
- **Run content**:
  - `charms.ts` (§4.2), `favours.ts` (§5.2), `calls.ts` (§5.3), `buffs.ts`, `tonics.ts`, `events.ts` (§3.8);
  - `bounties.ts` (§11.9), `houseRules.ts` (§11.5–11.6).
- **Meta and story**:
  - `achievements.ts` (§11.7), `foundations.ts` (§11.3), `kits.ts` (§11.4);
  - `notes.ts`, `tapes.ts` (§6.11), `songs.ts` (§6.9).
- **World and cutscenes**:
  - `src/world/layout.ts` (§8.6);
  - `src/game/cutscenes/*.ts` (§6.8, Opus-authored).
- **i18n key families**: `charm.<id>.name|desc`, `phone.<id>.*`, `favour.<id>.*`, `buff.<id>.*`, `tonic.<id>.*`,
  `event.<id>.*`, `upg.<track>.*`, `imp.<id>.*`, `bounty.<id>.*`, `ach.<id>.*`, `note.<n>`, `tape.<n>.*`, `song.<id>`,
  `cut.<id>.<n>`, `voice.*`, `menu.*`, `hud.*`, `zone.<id>`.

## Appendix C — Integration requests to the Technical Director (TECH_SPEC changes this GDD needs)
1. **Clamps**: `payout.mult` 0..100 → 0..1e9 (idle growth; the per-play guard is 1,000 on the pipeline); `luck` −10..20 →
   −30..30 (catalogue cap 30).
2. **WinTier**: align `tierFor()` with the catalogue tags (`bigwin` ≥ ×10, `hugewin` ≥ ×25, `megawin` ≥ ×50, `jackpot`).
3. **Single choke point**: payout modifiers are applied once, in `run.win()` / `econ.settle()` (§3.3). Machines report
   base gross. `econ.payoutFactor(ctx)` is exposed for machines whose rules need it.
4. **RunApi additions**:
   - run: `pulls(pid)`, `spendPulls()` (= catalogue `run.spendActions`), `tickets(pid)`, `quota()`, `watch()`, `night()`,
     `dread(pid)`;
   - buffs: `buffs(pid)`, `addBuff()`;
   - tycoon: `instanceLevel(instance, track)`, `buyUpgrade(instance, track, n)`, `hire(instance, kind)`,
     `order(slot, device)`, `improve(id)`, `holdings()`, `owner(instance)`.
   - `DebtState` is renamed or aliased to `QuotaState` with `{ base, assessment, due, paid }`.
5. **`actionCost` = pulls** (answers MACHINES_machines §19.6 #1); `tableLimitMult` = SI × instance cap (answers #2).
6. **Headless play**: every rules module also exports `playHeadless(rng, stake, hooks) → MachineOutcome` (a thin wrapper
   over `simulate`) for Shills.
7. **Layout**: §8.6 replaces the reference layout v0 (slot ids, sizes, coordinates). XL max footprint is 4.8 × 2.6 m.
8. **Time**: Watch clocks are real seconds (`timeLeft()`); the wall clock is cosmetic. Staff ticks run at 1 Hz on the
   host.
9. **Cutscene player** service (`src/game/cutscenes/player.ts`) and the `cut.*` net events (§6.8).
10. **Save schema**: add tycoon state, buffs, Holdings, collectibles and Obols (meta save `jackid.meta.v1`).
