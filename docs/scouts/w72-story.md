## Story and adventure audit (source-based, no bench run)

I did not run the bench. The request said not much is needed, and the findings below come from source reading, with file:line evidence. No project files were edited and no git writes were made.

### What exists now

| Night | Story beats in code |
|---|---|
| 1 | Intro cutscene (`story/index.ts` intro hook). Notes n01, n02, n03, n07, n27 and n28 are ungated. |
| 2 | Mira wrong-number call, `calls.ts:20`. Tamsin duel window opens (`duels/rivals.ts:73`, nights 2-8). Note n15 in the Jade room. Knock visitors start (`home/knock.ts:5`). |
| 3 | Lucan boss (`rivals.ts:99`). Parlour opens by itself after N3. |
| 4 | Mimosa (`rivals.ts:112`). Note n19 in the Wash. |
| 5 | Kuro (`rivals.ts:86`). Mira's second call, `calls.ts:24`. Notes n16 and n21. |
| 6 | Orrin boss (`rivals.ts:125`). Note n24 in the Counting room. |
| 7 | The Audit: Clerk taxes the largest holding, fired on the second Watch (`story/index.ts` run:window hook, `cutscenes/audit.cutscene.ts`). Notes n25. |
| 8 | Vell boss (`rivals.ts:140`). Note n26. |

Endings, all in `story/index.ts` (run:end hook):
- Fall: `quota_fail`.
- Collector's visit at home (`summary.ending === 'shot'`): `mafia_visit`.
- Topside (escaped, not descend): `ending_elevator`.
- Descend (`tycoon:prestige`): `descend`.

Other pieces: 28 notes with EN and TR text (`story.strings.ts`, `notes.data.ts`), Hollow Door with three Dark Lords and roulette (`world/hollow/config.ts:11`, `hollow.strings.ts`), tycoon milestones that play `wing_unlock` (`story/index.ts`), and Home (`home/contract.ts`, `home/phone.ts`, `home/knock.ts`, `home/evening.ts`).

### Audit findings (ranked by impact)

1. **The story flags are written and never read.** `story/index.ts:104-106` sets `descendLook`, `wingSeen` and `keyTurned`. `storyFlags()` has no caller outside `story/index.ts`. `descend.cutscene.ts:23` fires `story.pick`, and nothing branches on the answer. The hooks are a dead end.
2. **Nothing connects the characters.** Mira has two subtitle-only calls (`calls.ts:18-28`, emitted from `hotline.ts:590-593` on Watch 0). They change no state, offer no choice and have no follow-up. Note n04 calls her "one of the still ones", and no other system mentions her.
3. **The Lords are roulette tables with no story.** The Hollow Door has toasts only (`hollow.strings.ts`: `lord.chosen`). There is no intro or outcome scene for Ash, Ledgers or Mirrors. The only clue is the Sump note n28, which tells the player to knock three times.
4. **Mysteries are planted and never paid off.** n24 says "The Clerk is the first card ever printed." `descend.cutscene.ts` (descend.3) says the card has a second name written in small print. n04 says "they took my name for the card." Only the Audit touches the Clerk, and it is a tax.
5. **The Collector is a threat with no arc.** Heat (0 to 6) moves knock and phone replies (`home/contract.ts`), and the only payoff is `mafia_visit` on a solo missed quota. There is no Collector beat on Nights 2 to 7 and no choice that avoids the visit. I did not trace whether Heat or Harmony reach the casino floor.
6. **Rivals have three-beat arcs inside one duel, not across Nights.** Each rival has intro, won and lost cutscenes (`duels/cutscenes/*`). `rivals.ts` has a `reveal` line, but no cross-Night thread connects them.
7. **Exploration rewards are flavour.** Notes are one-shot reads in the journal (`story/notes.ts:176`). Wing keys open rooms (`wing_key`, `wingState`), but nothing a wing reveals changes a later Night.
8. **Goals beyond the quota are missing.** Hollow Door and the endings are the only long-term targets. No Night has a question the player wants answered.

Mahjong and TALLY cheats were not audited in depth.

### Player judgement

The story is a set of well-written beats, not a spine. The player has a quota, eight Nights of rivals and a Collector who appears at the end. No Night asks a question that the next Night answers. The notes hint at a mystery (the second name, the Clerk, Mira), but the player's actions never advance it.

### Proposed design: THE SECOND NAME

**One identity.** The House wants your money, the family wants you home, and the mob wants a debt paid. The central mystery is the card: whose second name is written under yours? The answer is the Night 8 twist, and it reuses the existing name currency from `descend.cutscene.ts`.

**Structure.** Each Night is a chapter with one title card, one character beat and one note gated by Night. The chapter state lives in a single progression record, replacing the three unread flags.

**Three-beat arcs (reuse `calls.ts`, `hotline.ts`, `knock.ts`, cutscene defs):**
- **Mira** (wrong number): N2 wrong number (exists). N5 she names the Wash (exists). N8 she asks the player to decline Vell's table, which is a Night Card choice. Her name is the second name.
- **The Collector** (Heat): N2 warning call at Heat 1. N5 door knock at Heat 3 (existing visitor). N7 a deal on the phone that trades the Night's coins for a Heat drop (a new Night Card, not a new currency).
- **The Clerk** (the Audit): N7 Audit (exists). N8 the Clerk's ledger opens the Counting room's final note (n26) and reveals the second name.
- **Spouse** (Harmony): one Evening beat each on N2, N5 and N8, using `phone.ts` threads.

**Quests that change the casino (reuse wings and notes):**
- **Wash ledger:** collect n17, n18 and n19 to unlock a Wash locker that grants one Night Card choice.
- **Parlour curtain:** collect n09, n22 and n23 to open the Parlour a Night earlier.
- **Counting:** collect n24 to n26 to shorten the Audit tax by a set amount.
- **Hollow Door:** the Lords' table opens only after the Mira beat. Each Lord gets an intro and outcome scene using `duels/` scene defs.

**Persistence.** Chapter state goes into the run's `resume` save (`run.ts` save update) and the cross-run `meta` (the descend name currency), so the second name carries between runs.

### Files to touch
- `src/game/story/index.ts`: replace the unread `flags` with a chapter record, and wire the chapter hooks to the run:window and run:end events.
- `src/game/story/calls.ts` and `calls.strings.ts`: add Collector and Mira N8 calls, with `call.*` keys in EN and TR.
- `src/game/story/notes.data.ts` and `story.strings.ts`: new Night-gated notes for the quest chains.
- `src/game/story/cutscenes/*.cutscene.ts`: chapter cards and the Lords' intro and outcome scenes.
- `src/game/story/duels/rivals.ts` and `rivals.strings.ts`: cross-Night reveal lines.
- `src/game/hotline.ts` (around line 590) and `src/game/ingame/roomsHost.ts` (around line 157): the phone story lines for the new calls.
- `src/game/home/phone.ts`, `phone.strings.ts`, `knock.ts` and `evening.ts`: Collector deal and spouse beats.
- `src/world/hollow/config.ts` and `hollow.strings.ts`: gate the Lords' table on the Mira beat.
- `src/game/run.ts` (save update near line 2270): persist chapter state.
- `src/game/tycoon/index.ts` (milestones): use tycoon features as quest rewards.

No new currency, meter or shop is added. The Collector deal is a Night Card, the name is the existing descend currency, and the quests use wings and notes that already exist. This fits the design pillars: one identity, every choice has a face, and no mechanic without a fiction.