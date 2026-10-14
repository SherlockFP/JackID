# Wave 25: "TALLY", an anime duel layer inspired by Usogui

This layer borrows Usogui's tone and structure, but it is original IP. Do not copy any Usogui names, characters, organizations or plot. It extends the lore in docs/WAVE24_PLAN.md and must not contradict it.

## Premise

**The Tally Bench** (TR: Hesap Kürsüsü) is a neutral order of masked **Notaries**, each with a wax seal and a wooden gavel.
- The Well hired them.
- Any wager spoken aloud and sealed is enforced, down to the last coin and the last name.
- They cannot lie or take sides. Every cheat in the Pit is therefore a trick of the rules, never of the referee.

**The player** is called a "Mark": a debtor in a cheap suit with no reputation, who actually reads tables the way others read faces.

**Rivals** are guests who pawned part of their name to the Bench and kept gambling to win it back.
- The House fields them as its champions.
- A rival who beats you takes one of your Marks.
- A rival you beat is released to the lift, and you take their Pledge.

**The Clerk** is the Bench's only unmasked witness, and the one thing the Bench cannot rule against.

## Rivals

Each rival is a PSX mannequin with 1-2 tinted accessory meshes, one accent colour, and a canvas portrait.

| id | Rival | When / where | Look | Game | Catchphrase (EN / TR) |
|---|---|---|---|---|---|
| tamsin | Tamsin Veil, "The Quiet Hand" | N2+ side duel, Jade | White gloves, silver bob, jade accent, closed-eye smile; courteous, apologises before winning | Sealed Wall (mahjong) | "Forgive me. It was already mine." / "Affet beni. Zaten benimdi." |
| kuro | Kuro Brandt, "Brass Saint" | N5 side duel, Boiler | Huge, soot-streaked, brass-orange accent, chest gauge; preacher who laughs under pressure | Steam Count (dice) | "Pressure makes honest men." / "Basınç adamı dürüst yapar." |
| lucan | Lucan Morrow, "Seventh Chamber" | **N3 boss**, Parlour | Ringmaster coat, cracked pocket watch, one pupil too wide, red accent; smiling predator | Ghost Shell (devilstable 1v1) | "I never lie to a man holding a gun." / "Elinde silah olan adama yalan söylemem." |
| mimosa | Mimosa Teague, "Lost & Found" | N4 side duel, Wash | Oversized coat, one shoe, yellow accent; cheerful and unsettling | Locker Shuffle (shellgame; phase 2) | "Everything is lost until somebody looks." / "Her şey, biri bakana kadar kayıptır." |
| orrin | Orrin Pale, "The Collector" | **N6 boss**, Parlour chair | Grey tailcoat, Manager's Key on a chain, hollow eyes, gold accent; tired and exact | The Question (phase 2) | "A debt is someone who waits." / "Borç, seni bekleyen birisidir." |
| vell | Vell | **N8 boss**, Counting | Rain coat, tape reels, greyscale | The Last Count (hilo; phase 2; he throws the match) | "I counted every coin. One is yours." / "Her parayı saydım. Biri senin." |

**Boss nights.** The boss modifier on N3, N6 and N8 becomes the **Rival's Terms**, which the rival announces at the start. Winning a boss duel pays BOSS_REWARD plus a Wing Key. Orrin also drops the Manager's Key.

## Duel system

**Machine.** A new machine, `tallytable` (TableBase, 2 seats: the player and the rival bot), runs a `DuelRules` module from `src/game/duels/<game>/`.

**The cheat plan.**
- Seeded with `hashSeed(runSeed,'duel',rivalId,night)`.
- Held by the host only. It never appears in snapshots or public events, and reaches clients only in the final `reveal` event.

**Flow.**
1. **SEAL:** the Notary reads the terms and the player picks a stake tier.
2. **ROUNDS:** each round emits `clue` events.
3. **CALL:** the window is always open. Press `C` plus a target. The player gets one call per duel.
4. **RULING.**
5. **REVEAL.**

**Stake tiers.** The player puts up one of three:
- **Coins:** S ≈ 6% of the Night quota.
- **Pledge:** 3 Tickets or 1 Obol.
- **Soul Mark:** a new counter, 3 per run, shown as seals on the JackID card.

The rival always puts up its Pledge: a themed Rare charm plus 2 Obols.

**Losing a Mark.**
- Each lost Mark adds Dread +0.1.
- At 0 Marks the JackID reads BLANK and grants the `blank_jackid` state. This is a path toward the void ending, not a game over.
- In Calm or Free modes, only the Coins tier is allowed.

**Clues.** Every cheat shows three independent clues, each at least once before the cheat pays out:
- **Tell:** a portrait micro-animation and a line.
- **Table:** a visible oddity in 3D.
- **Math:** a mismatch you can check in the log or on the Tally Sheet.

**Calls.**
- A correct call voids the cheat, and the rival pays 3×S.
- A wrong call, or a call made before the cheat's round, gets the player fined 1 stake unit, and the cheat proceeds.

### A. Sealed Wall (Tamsin; reuses mahjong tiles and rules)

**Rules.**
- Each side holds 7 hidden tiles from a shared wall of 120.
- On your turn, draw from the wall or take the opponent's last discard, then discard one tile.
- The first complete 8-tile hand (2 melds + 1 pair) wins.
- If nobody wins after 6 turns each, the nearer hand takes half the pot.
- Pot = 2S minus a 5% rake.

**The cheat ("the Fifth").** On one hidden turn between 3 and 5, Tamsin discards or melds a 5th copy of a tile from her sleeve.

**Clues.**
- Tell: she says "Forgive me" the turn before.
- Table: a cuff glint, and her left hand leaves the felt.
- Math: the Tally Sheet (toggle with T) shows 5 of a kind.

**Call.** Select the tile in the discard river, then press C.

**Reveal.** The sleeve opens and the fifth tile falls out.

**EV.** About 0.75 for a naive player, about 1.5 for a perfect detective.

### B. Ghost Shell (Lucan; devilstable rules, 1v1, no items)

**Rules.**
- First to 2 round wins.
- Before each load, he announces "N live, M blank" aloud, and the animation places the shells one at a time.

**The cheat ("the Ghost").** In round 2 or 3 he loads one shell more than he announced, and the extra shell is live.

**Clues.**
- Tell: he loads without breathing, eyes on you.
- Table: the animation shows N+1 shells, and the tray beads show a spare glint.
- Math: the chamber still clicks after the announced count has run out.

**Call.** Press C, then "GHOST", before the announced count is exhausted.
- Correct: the round replays with an honest load, Lucan loses 1 charge, and he pays 3×S.
- Wrong: the player loses 1 charge.

**Winnings.** The winner takes 2S minus the rake. Lucan is the N3 boss, so the boss reward also applies.

### C. Steam Count (Kuro; dice)

**Rules.**
- First to 3 of 5 rounds.
- A shared gauge starts at 0, and the players alternate turns.
- On your turn, either roll 2d6 and add the sum to the gauge, or VENT to bank gauge × S/10 in coins.
- Any roll that takes the gauge past 99 blows it, and the roller loses the round.

**The cheat ("Lead Die").** From a hidden round onward, whenever the gauge is above 70, Kuro's rolls always total ≤ 5.

**Clues.**
- Tell: steam hisses from his cup.
- Table: the gauge needle shudders whenever he rolls.
- Math: three or more low sums in a row above 70 (about 3% likely if he were honest).

**Call.** Press C, then "LOADED DICE".

**Reveal.** The left die cracks open and shows lead.

**EV.** About 0.8 naive, about 1.4 detective.

## Anime presentation (`src/core/ui/manga/**`, DOM/CSS over the canvas)

- **Cut-in panel** (`mangaPanel.ts`):
  - Skewed `clip-path` panel with an ink border.
  - Halftone from a radial gradient tiled at 6px.
  - Speed lines from `repeating-conic-gradient` with a radial mask.
  - The portrait slides in over 0.25s.
- **Portrait** (`portrait.ts`):
  - Procedural canvas, 256×384, built from a spec: hair preset, eyes, mouth, accessory, palette (ink, paper, one accent).
  - Five expressions: calm, smirk, shock, rage, hollow.
  - Hatch shading with a halftone mask.
  - Cached per rival and expression.
  - Prototype two portraits before making all six.
- **Menace glyphs** (`glyph.ts`):
  - Show "ゴ ゴ ゴ" in a JP font stack, falling back to "GO GO GO" if the font is missing. TR shows "GÜM GÜM GÜM".
  - Huge, tilted, gentle shake.
  - Used on SEAL, on a long pause, and on a call.
- **Dialogue box** (`dialogue.ts`):
  - Sits in the bottom third with the portrait on the left or right and a speaker plate.
  - Typewriter text at 40 cps. E or Space skips.
- **Reveal** (`reveal.ts`):
  1. Hitstop freeze with desaturation.
  2. The event log rewinds and rings each clue.
  3. A 3-panel strip appears: WHAT YOU SAW / WHAT HAPPENED / WHY.
  4. A stamp reads "RULED: CHEAT" or "RULED: FAIR".
- **Cutscene hooks:** register `manga.cutin`, `manga.glyph` and `manga.reveal` with `app.cutscene.registerHook`.
- **Comfort settings:**
  - Calm mode: glyphs fade without shaking, no jitter, no hitstop.
  - reduceFlashing: static speed lines, no flashes, at most 3 visual changes per second.
  - A Skip button is always shown.

## Arc

| Night | Beat |
|---|---|
| N1 | A Notary seals your debt, and the Bench is named. |
| N2 | The Jade Room. Mira's call. Tamsin, optional. |
| N3 | **Lucan.** |
| N4 | Mimosa. A Bench seal sits in a locker. |
| N5 | Kuro. Mira's second call. |
| N6 | **Orrin.** First sight of the Clerk. |
| N7 | The Audit: the Clerk taxes a duel prize. |
| N8 | **Vell.** The lift choice. |

## Dialogue (EN / TR)

1. **Notary:** "Sealed is sealed. The Bench does not care who is afraid." / "Mühür mühürdür. Kürsü kimin korktuğuyla ilgilenmez."
2. **You:** "They call me a mark. Marks are the ones who read the table." / "Bana kurban diyorlar. Kurban, masayı okuyandır."
3. **Tamsin:** "Forgive me. It was already mine." / "Affet beni. Zaten benimdi."
4. **Tamsin, reveal:** "Four of each. You counted four. The fifth was in my sleeve before you sat." / "Her taştan dört. Sen dördü saydın. Beşincisi sen oturmadan kolumdaydı."
5. **Kuro:** "Pressure makes honest men. Watch your needle." / "Basınç adamı dürüst yapar. İbreni izle."
6. **Lucan:** "Three live, five blank. Say it with me. I never lie to a man holding a gun." / "Üç dolu, beş boş. Benimle söyle. Elinde silah olan adama yalan söylemem."
7. **You, call:** "Nine. I counted nine going in." / "Dokuz. Girerken dokuz saydım."
8. **Notary, ruling:** "The Bench rules: CHEAT. The wager is voided against the offender." / "Kürsü hükmeder: HİLE. Bahis kusurlu tarafa karşı iptal edilmiştir."
9. **Notary, wrong call:** "Accusation unproven. The Bench fines the accuser." / "İddia ispatsız. Kürsü suçlayanı cezalandırır."
10. **Mimosa:** "Everything is lost until somebody looks. Look carefully, hm?" / "Her şey, biri bakana kadar kayıptır. Dikkatli bak, olur mu?"
11. **Orrin:** "I paid in full and the lift was empty. A debt is someone who waits." / "Tamamını ödedim, asansör boştu. Borç, seni bekleyen birisidir."
12. **Clerk:** "Nothing in the ledger is surprising. That is what the ledger is for." / "Defterde şaşırtıcı hiçbir şey yok. Defter bunun için var."
13. **Vell:** "I counted every coin in the Well. One of them is yours. I came down to hand it back." / "Kuyu'daki her parayı saydım. Biri senin. Sana geri vermeye indim."
14. **Vell, end:** "Call me a cheat. It is the only way the Bench lets me lose." / "Bana hileci de. Kürsü beni ancak böyle kaybettirir."

## Lanes

Each lane owns its files exclusively. The integrator works last.

| Lane | Owns | Acceptance |
|---|---|---|
| A, Duel engine | `src/game/duels/engine.ts`, `types.ts`, `plan.ts`, `src/machines/tallytable/**` | - Same seed, same plan.<br>- The plan is never in snapshots or public events.<br>- Works solo and as the MP host. |
| B, Duel games | `src/game/duels/{sealedwall,ghostshell,steamcount}/**`, strings, `scripts/tests/duels.test.mjs` | - A detective bot calls correctly 100% of the time with 0 false calls.<br>- Naive EV is between 0.70 and 0.90.<br>- At least 2 clue channels appear before each payout. |
| C, Manga UI | `src/core/ui/manga/**` | - A bench shows the portraits.<br>- Calm and reduceFlashing visibly disable motion.<br>- i18n parity. |
| D, Story and rivals | `src/game/story/duels/**` (RivalDefs, dialogue, duel cutscenes, spawns by Night) | - The arc plays with no dead end.<br>- Side duels are optional. |
| E, Integrator | `run.ts`, `types.ts`, `save.ts`, `protocol.ts`, `layout.ts`, `suits.ts`, tests index | - Soul Marks: save, HUD seals, `blank_jackid` at 0.<br>- Boss duel wins pay BOSS_REWARD plus Keys.<br>- Boss modifiers are announced as the Rival's Terms. |

**Phase 2:** Mimosa, Orrin, and Vell's thrown-match ending, all on the same engine.

**Gate for every lane:**
- `npm run typecheck`, `npm test`, `npm run check` and `npm run build` all pass.
- Bench screenshots of each duel and of the reveal sequence.
