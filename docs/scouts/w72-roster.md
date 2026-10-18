KEEP list (12): bigone, coinflip, hilo, videopoker, mines, plinko, roulette, craps, blackjack, sonkart, keno, mahjong. CUT list: 32 machines, below. Only 3 machines were benched (bandit, plinko, mines), so the other ratings come from code size, docs and existing tests, not play. Treat them as a first pass.

**Method and sources**
- Quota run: `src/game/progression.ts:43-48` (CORE_PLAN, 16 machines). FLOOR_READY: `src/world/layout.ts:329-344`.
- Roster: 44 gambling machines in `src/machines`, after the system-device exclusions. Category and tier come from each `index.ts`.
- Known issues: `docs/HANDOFF.md:144-157`. Pillars: `docs/DESIGN_PILLARS.md` (pillar 4 is juice, pillar 7 is one mechanic with many readings).
- Bench shots (`--sit` for mines), all in `C:\Users\Admin\AppData\Local\Temp\claude\C--Users-Admin-Documents-JackID\48c49d04-016b-4c0d-ac70-780ba1fcc555\scratchpad\shots\`:
  - `bandit-round1-3.png`: cabinet is small and dark against the brick wall, and the bench panel covers the right side. Weak readability.
  - `plinko-round1-2.png`: board, pegs, slots and puck path are all legible, with a clear title.
  - `mines-round1-2.png`: "REVEAL A SAFE TILE" banner, ladder display, and a HUD with stake, mines, ladder and next-safe %. Very clear.
- Machine-specific tests exist only for bigone, mahjong and sonkart (`scripts/tests/`). The rest rely on the shared suites (reels, cards, duels, juice).

**KEEP (12), with the verb each one owns**

| Machine | Verb | Why keep | Still needed to be "very good" |
|---|---|---|---|
| bigone | spin (marquee) | Reference machine, tier 1, fixed in the roster, 2497 lines, has tests | Re-sim after W13–14 (HANDOFF #7), SFX listen-test (#6) |
| coinflip | flip | Simplest rules, 827 lines, fixed | Enough juice to carry the "flip" feel alone, win/lose tells |
| hilo | card decision + ladder | Easy rules, pure decision with a streak | Make the streak climb visible as the ladder, tie it to Heat |
| videopoker | card decision (hold) | Real decisions (hold strategy), tier 1 | Show the optimal-hold hint for beginners, win ladder |
| mines | push-your-luck ladder, pick/reveal | Best bench shot: readable HUD, ladder, cash-out | Ladder steps need a bigger escalation juice, bust moment |
| plinko | physics drop | Readable, 3 risk variants, golden slot | Bounce combo per peg (pillar 4 / Peglin reading), a near-miss frame on the last bounce |
| roulette | wheel (table) | Tier 1, fixed | Missing `playHeadless` (HANDOFF #9), no machine tests |
| craps | dice (table vs house) | Core, floor-ready, 1511 lines, dice verb | Table complexity: needs a one-line "what to bet" hint for a new player |
| blackjack | table vs dealer | Fixed, tier 1, the standard table verb | Clarity is fine; watch the pace of dealer turns |
| sonkart | party/duel table | Only party table in core; 2141 lines, has tests | Not benched in this pass (existing screenshot `sonkart_info_1280x720.png` not reviewed). Verify rules clarity and that it is a real decision |
| keno | pick numbers (lottery) | Simplest pick verb in core, rules are instant | Pick/reveal tension: stagger the draw reveal, add a big-hit juice |
| mahjong | match/tile | Distinct verb, has a dedicated test, floor-ready | Rules are the hardest to explain. Needs a 10-second tutorial hint |

**CUT (32), with the reason**
- Spin duplicates of bigone: **bandit** (weak bench view, HIGH variance), **pachislot** (slot, 3 games per action), **fruitmachine** (88% RTP, headless vs live gap, HANDOFF #7), **lootbox** (open pity issue, HANDOFF #7, it is a vendor, not a spin).
- Wheel duplicate of roulette: **cyclone** (85% random, aimed is the real game, duplicate).
- Physics duplicates of plinko: **pachinko** (sweet-zone skill is hard to read, 92.5% RTP; fold its bounce combo into plinko instead), **coinpusher**, **bingopin**, **claw** (≈80% avg / ≤105% expert, HANDOFF #7; a skill game that is hard to read).
- Dice duplicates of craps: **dicetower**, **sicbo**.
- Card duplicates of blackjack and videopoker: **baccarat**, **threecard**, **reddog**, **cardwar**.
- Lottery duplicates of keno: **bingo**, **tombola**, **lottoblower**, **scratch** (pure luck reveal, 80–88% RTP, no decision).
- Oddity/other duplicates: **shellgame**, **derby**, **bigsix**, **teetotum**, **fantan**, **stacker** (HIGH variance, ≈70% avg, HANDOFF #7 re-sim).
- Party duplicates of sonkart: **tavla**, **pisti** (tier 1, floor-ready, but a second party table adds nothing).
- Not a gamble: **elevator** (crash ride, not floor-ready, Home layer story), **fortuneteller** (oddity, not in core, story hook, keep for the story layer).
- Story duels, not counted in the roster: **devilstable**, **lordstable**, **tallytable**. They are ALWAYS_OPEN in `progression.ts:66-69`. Decide them with the story layer, not here.

**Open points for the director**
- Pillar 7 (one mechanic, many readings): fold pachinko's bounce combo and bandit's lever feel into plinko and bigone, instead of keeping them as separate machines.
- The 12 keeps cover 10 distinct verbs. Keno and mahjong are the two extras, and each can be cut to 10 if the client wants fewer games.
- Cut machines are still in the code. Removing them from the roster means `CORE_PLAN` and `FLOOR_READY` changes, not file deletions.