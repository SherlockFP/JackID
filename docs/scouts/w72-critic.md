**Fan critic, seeds 7211 and 7212 (lang=tr). Read-only, no project files or git writes touched.**

Runs: 7211 debt run through Night 1 Dawn, Evening, Night 3 floor; 7212 debt run from the starter draft, which ended in a Night 1 miss; 7211 re-run through the lift to the Evening; one bigone bench sit. All headless, fixed clock. Shots are in `C:\Users\Admin\AppData\Local\Temp\claude\C--Users-Admin-Documents-JackID\48c49d04-016b-4c0d-ac70-780ba1fcc555\scratchpad\`:
- `critic-7211\dawn.png`, `critic-7211\night2.png`, `critic-7211\home-peep.png` (Night 3 floor)
- `critic-7211b\ride.png`, `critic-7211b\evening.png`, `critic-7211b\peep.png`
- `critic-7212\floor0.png`, `critic-7212\machine.png`, `critic-7212\dawn2.png`
- `critic-bench\bigone-round1.png`

Logs: `critic-7211.err`, `critic-7212.err`, `critic-7211b.err`.

**What is fun**
- The Evening apartment (`critic-7211b\evening.png`) is the strongest frame. Rain on the window, one warm lamp, the spouse's line "Sonunda evdesin. Konuş, telefona bak, kapıyı kilitle" and the Dawn receipt (`peep.png`) make the home layer feel like a different place from the floor. This supports Pillar 2.
- The Night 3 floor HUD (`home-peep.png`) reads well: "EKSİK 72" in red, a SPOTLIGHT line, "ŞAFAK 0/72" and "CEP 32 · YATIR" in the corner. The shortfall is felt.
- The Night Card choice has real stakes in plain Turkish: "Kota 36 → 41 · her kazançta +10 jeton" (`dawn.png`). The EV and quota preview lines make the decision clear.
- The bigone reels (`bigone-round1.png`) look chunky and PSX-right, with a readable payout strip.

**What is boring**
- The bot's Night is 99 s to 133 s of sim time (`critic-7211.err`, `critic-7212.err`: `auto:night ok (131433 ms)`). That is about 135 bets of the same coinflip/hilo/scratch loop, with no visible decision for most of it. A human will feel this as a grind unless the bet loop has more choice per press.
- Night 1 is slow to start. The starter draft is a full modal over a dim floor for its first 24 s (`floor0.png`, `machine.png`: "24 sn sonra otomatik seçim"). The first thing the player sees is a menu, not the House.

**What looks bad or confuses**
- The Night Card row shows only card 2 in all three shots (`dawn.png`, `night2.png`, `dawn2.png`). The left half of the row is blank for the whole 20 s. Card 1 may be stuck in the deal animation, or the row may be mis-laid out. I did not confirm which; check `src/game/nightCards.ui.ts` around the `cards.forEach` deal animation (about lines 160–175).
- The spouse is `kit.mannequin(...)` (`src/world/home/index.ts:90`). It reads as a dummy or a horror actor, which undercuts "a family that is waiting" in the one-line identity (`docs/DESIGN_PILLARS.md`).
- Toasts collide with the spouse speech box at the Evening: "BANKAYA 3 YATIRILDI · CEP 20" and the Dawn receipt sit on top of "Sonunda evdesin…" (`evening.png`, `peep.png`). The subtitle "EŞİM" line is also partly hidden.
- Glyph legibility: "Kota 36" renders as "3G" in the Night Card receipt (`dawn.png`). The HUD corner text (`home-peep.png`: "SONRAKİ ÖDEME ×1,16 · HAVA +3% · GÖZDE +7%…") is too small for 1280x720.
- The floating "BANKA +8 FAİZ (%55)" text sits over the mannequin in the lift/run-over scene (`dawn2.png`, `wake.png`). It reads as noise on a dark screen.
- The Night 1 cliff: seed 7212 ended with the bank at 23 of 24 (`critic-7212.err`, "night 1: quota 24 … bank 23 (not met)"). The run went straight to over with no near-miss framing. This is the kind of loss Pillar 4 asks to be framed.

**Eight changes that would most raise fun and the wish to keep playing (ranked)**
1. Verify and fix the Night Card row so both offers always show, with a visible deal (`src/game/nightCards.ui.ts`, deal loop). Two choices is the core Dawn decision.
2. Open the first Night on the floor. Let the player see the House for 2–3 s, then reveal the starter draft as a card on the table or a bell, not a full modal (`src/game/draft.ui.ts`, `src/game/draft.strings.ts:23`).
3. Replace the mannequin spouse with a readable person: a seated silhouette with a head-tilt or idle breath, and a reaction to lights and chain (`src/world/home/index.ts:90`, `src/world/home/room.ts`). This is the single biggest warmth lever.
4. Frame the miss as a near miss. At 23 of 24, show "1 coin short" and a last-chance beat before the mob line, not a straight run over (`src/game/run.ts` quota fail path; not verified line by line).
5. Move the Dawn and bank toasts off the spouse subtitle area at home (`src/menu/` toast layer; the Evening box positions).
6. Enlarge the key HUD numbers (KOTA, EKSİK, ŞAFAK) and fold the minor modifier line into a tooltip (`src/menu/hud.strings.ts:73-85`, the HUD layout).
7. Cut the Night 1 "ESC'ye basılı tut" tracker and the second instruction line at home; keep one prompt per beat.
8. Fix the glyph read for digits in the receipt and card text (the "6" looks like "G"), and shorten the floating interest text so it does not sit on a scene (`src/game/nightCards.ui.ts` receipt rows; `src/game/econ.strings.ts:12`).

**Cuts I would make:** the bot-visible bet loop repetition (lower bets per Watch or add a choice on each), and the duplicate stat blocks, since the Night Card receipt and the Dawn summary both show due/paid/interest.

Caveat: the bot plays a fixed policy. These are fan impressions from its screenshots, not a human playtest, and the code references are from grep, not full reads.