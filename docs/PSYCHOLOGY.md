# JackID: Player psychology and retention

Research pass, 2026-10-19. Read with docs/DESIGN_PILLARS.md, docs/STORY_BIBLE.md and docs/PLAYTEST_2026-10-16.md. Sources are listed at the end.

## Scope notes

- docs/JOKER.md does not exist, and the story bible has no Joker character. The only "joker" in the code is the wild card in src/machines/_base/cards.ts. Section 2 uses the House's voices (the Compere, Tamsin, Lucan, the Collector) as the manipulators. If the director wants a Joker, the bible needs a page for him first. The rules below apply to him unchanged.
- "ŞANS stars" and the luck meter are two readings of one idea. Checklist item 4 covers this.
- The evidence is uneven. Many studies are small lab tests, or they are known only from secondary summaries. Contested findings are marked as such.

## 1. Fifteen engagement techniques

Each technique must leave the player knowing more, or feeling better about a choice, than before. None depends on hidden odds, real time or money.

**1. One honest progress number.** People speed up as they near a goal (Kivetz et al. 2006). A head start of credited steps also raises persistence (Nunes and Drèze 2006). *JackID:* the quota is the mob's deadline, so show it in one place. The playtest found "QUOTA 16/24 SHORT 8" beside "DAWN 24/24". Give Night 1 two credited steps, with a reason in the fiction. *Tune:* never credit a step that the ledger cannot later show.

**2. Variable rewards with an honest table.** Rewards that arrive after an unpredictable number of actions keep responding steady (Ferster and Skinner 1957). *JackID:* vary the size and timing of payouts and surprises, but keep the odds fixed and visible. Floor machines already have RTP below 1 (src/game/houseMood.ts). The House wins on average, and the player can read that.

**3. Near misses only where skill is real.** In one fMRI study, near misses felt less pleasant than full misses but raised the wish to play again. That effect appeared only when players felt in control of the gamble (Clark et al. 2009). The authors also say a near miss carries information only in skill tasks. *JackID:* use near misses in skill events, such as bounce combos and Crooked Table clues. Label chance misses plainly. The reel near-miss tag in src/machines/bandit/rules.ts (line 154) is cosmetic. Keep it off pure-chance results, or say what actually happened.

**4. Losses that sting, then a way back.** Losses weigh more than equal gains (Kahneman and Tversky 1979). The size of that effect is contested (Collins, on Yechiam 2018). *JackID:* a missed quota is the real loss, with the mob at the door. Limit it to one real loss per Night, always with a clear next step: the Collector's offer, or a quiet night at home. A loss with no way back teaches quitting.

**5. Invested things with a story.** People keep going on what they have already paid into, partly to avoid looking wasteful (Arkes and Blumer 1985). *JackID:* keepsakes, seals, the Tally Sheet and home ventures are investments the player wants to pay off. *Tune:* show what was put in on the Dawn receipt. Never make walking away cost more than the next Night.

**6. A plan that closes the open loop.** Unfinished goals keep intruding on thought, and making a concrete plan reduces that intrusion (Masicampo and Baumeister 2011). The original Zeigarnik finding is conditional, so do not rest the design on it. *JackID:* one objective line with a waypoint for Nights 1 to 3, as the 2026-10-18 direction asks. It keeps the loop open for curiosity and calms the worry.

**7. Information gaps the player can close.** Curiosity needs some prior knowledge, and a gap works when it is neither too wide nor too narrow (Loewenstein 1994). *JackID:* the second name on the card, the blank lines on the Tally Sheet, and the "line under your name, too small to read" from N2. *Tune:* open at most two gaps per Night, and close one before opening the next.

**8. Cliffhangers that get answered.** Cliffhangers raise arousal and the wish for the next part. A 2023 lab study found no gain in enjoyment or in intent to keep watching (Wirz et al. 2023; Buffalo release on Schibler and Green). *JackID:* each Night ends on a question, and the next Night answers it. *Tune:* an unanswered cliffhanger is a broken promise. Pair each one with a payoff that stands on its own.

**9. Competence the player can see.** Feeling capable and self-directed predicts enjoyment and later play (Ryan, Rigby and Przybylski 2006). *JackID:* Crooked Table clues teach the player to read tables, and kept words raise the luck meter. *Tune:* show one visible skill gain each Night on the Tally Sheet, tied to a specific deed.

**10. Choices with a face and a cost.** A choice feels meaningful only when it is both impactful and informed (Johnson, Game Developer). Too many options can stop people from choosing (Iyengar and Lepper 2000), but a later replication did not find this effect (Scheibehenne, reported secondhand). *JackID:* every choice names who offers it: House, Family or Mob (pillar 3). *Tune:* two or three options per screen, each with its cost stated, and jargon explained the first time it appears.

**11. A bond with the people at home.** Viewers form one-sided bonds with figures on screen, called parasocial relationships (Horton and Wohl 1956; Hartmann and Goldhoorn 2011). Relatedness is one of the three needs in self-determination theory (Ryan et al. 2006). *JackID:* Ada's kitchen-table game, Harmony and the phone. *Tune:* Ada can miss the player inside the fiction. No message may imply a real-time obligation or real-world harm.

**12. A stopping point that feels complete.** GameFlow describes enjoyment through eight elements, including clear goals and feedback (Sweetser and Wyeth 2005). Civilization's "one more turn" is the familiar example of a short unit that invites the next one. Meier's own account is in his Game Developer article, which I did not read. *JackID:* each Night is one complete unit that ends in a Dawn ledger. *Tune:* the next Night is one press away, and the Dawn receipt is a clean place to stop.

**13. Juice that scales.** Feedback that is felt before it is read makes wins feel bigger (Jonasson and Purho, 2012). Critics say too much polish can cut immersion (Kelly, GDC Europe 2014). *JackID:* the WIN, BIG WIN, HUGE, JACKPOT ladder (pillar 4). *Tune:* escalate in steps, keep losses quick and quiet, and let Calm mode mute the big hits.

**14. Meta-progression that adds questions.** Hades keeps its story across deaths, so each run adds to the last (Kasavin and Korb, GDC 2021). Praise for Slay the Spire unlocks as onboarding is opinion, not data. *JackID:* the Tally Sheet and the second name survive a lost Night. Unlocks should open a question, not only raise a number. The DESCEND ending already works this way.

**15. Peak and end.** Memory of an experience rests mainly on its most intense moment and its end, not its length (Fredrickson and Kahneman 1993; a 2022 meta-analysis of 174 effects, Alaybek et al.). *JackID:* end each Night on the strongest beat, such as the knock or the coin, then go home to the quiet of Dawn. *Tune:* design the last ten seconds of each Night first.

## 2. In-fiction manipulation

The characters may lie, bluff and toy with hope. Three rules keep it fair.

- **Lie in the story, never in the HUD.** Quota, odds and Heat numbers are always true.
- **Every lie can be checked later.** The Tally Sheet counts the pulls, and the Clerk records every wager. The Clerk cannot lie, so it is the fixed point the player can trust.
- **A lie needs a visible purpose.** In a CHI 2024 study, players accepted deliberate falsehoods that had a narrative or gameplay reason. Accidental ones felt meaningless (Xiao et al. 2024).

Tension follows build and release. Game designers argue horror needs a build-up before the release (Game Developer, "The Balancing Act of Tension in Horror Game Design"). A study of P.T. found players learn the mechanics, and the scares wear off (Graja, Lopes and Chanel 2020). Do not repeat a scare. Vary its timing or escalate it.

**The Compere: false hope.** He announces that the House is thinking before a white throw. Use this only before a real threat, never as a fake reassurance. His tell is that his lies end in "the honest truth" (STORY_BIBLE.md).

**The House and the gambler's fallacy.** A House voice says the fourth cherry "is due". Tversky and Kahneman (1971) described this error: a fair machine has no memory and does not correct streaks. Never make the line true in secret. The Tally Sheet shows the real count, so the player can catch it.

**Tamsin: an apology before the win.** She says "kusura bakmayın" just before a cheat (STORY_BIBLE.md). A courteous cheat is an early reading puzzle, and it is fair play.

**Lucan: trust, then one cash-in.** He builds trust and breaks it at match point. The watch glass shows the careful player what he is doing. The break has to be readable afterwards, or it only feels cruel.

**The Collector: a sunk-cost offer as a story choice.** Each offer states its price. His late truth ("I paid all of it. The lift took me up. Only me.") changes the meaning of earlier calls. There is no hidden clock.

**Ada: a companion who keeps a secret.** She withholds the second name for a reason, and her warmth is the cover. Her lies concern her own history, never the game's numbers. The reason comes out in the N7 flashback.

## 3. Dark patterns to avoid

- **Real money, now or later.** It turns a game of chance into a bill. As press coverage reports it, the UK Gambling Commission's stance on loot boxes turns on whether items can be cashed out (current position unverified). Keep the loop closed.
- **Real-time countdowns outside play.** The FTC's 2022 staff report on dark patterns covers fake urgency from countdown timers, as law-firm summaries describe it. A daily run should have no countdown.
- **Deceptive odds.** Hidden house edges and misleading percentages plant false beliefs (Zagal, Björk and Lewis 2013; FTC 2022).
- **Punishing breaks.** Lost progress, or a mob visit triggered by leaving the game, teaches anxiety. "Impaired control" is the first criterion of gaming disorder in ICD-11, in force since 2022. The code already caps away income at 600 seconds, at 25 percent (src/game/tycoon/index.ts). Keep that, and add no real-time penalty.
- **Notification spam.** Messages from the Collector or Ada outside play exploit fear of missing out. That fear links to lower mood and heavier social media use (Przybylski et al. 2013, correlational). No push or notification code exists in src today. Keep it that way.
- **Guilt for absence.** Ada never says she is sad that you stopped playing. Parasocial bonds are real, so handle them with care.

## 4. Ten changes, in priority order

1. **One honest progress number.** Fix the QUOTA, SHORT and DAWN conflict in src/menu/hud.ts and src/game/bank.ts. Items 2 and 3 depend on it.
2. **Start at home.** The 2026-10-18 live-build report (director memory) said the home layer was never found. Make the prologue the apartment, and show a HOME lift in the casino (src/game/home/evening.ts, docs/WAVE69_HOME.md).
3. **Two credited steps on Night 1.** Endowed progress in src/game/data/schedule.ts, with the reason given in the prologue.
4. **One luck meter.** The stars in src/game/luck.ts (from -2 to 5) and the ŞANS buffs in src/game/data/buffs.ts describe one idea. The Crooked Table pays "+1 luck star" in code and "+1 ŞANS" in the bible. Merge them, with the director's sign-off. Also rename the machine heat (src/game/buffs/streaks.ts, 0 to 100), so "Heat" means one thing: the Collector's 0 to 6 meter.
5. **One objective line with a waypoint for Nights 1 to 3.** src/game/story/quests.ts.
6. **Honest near misses.** Limit the nearmiss tag to skill events (src/machines/bandit/rules.ts), and check its sound cue (src/core/audio/sfx.ts).
7. **Cliffhanger tracker.** Each Night lists its open question and the Night that answers it (src/game/story/chapter.ts, src/game/story/notes.ts).
8. **Checkable lies.** Every in-fiction claim about odds or counts gets a Tally Sheet line (src/game/events/crookedTable.ts, src/game/story/notes.ts).
9. **Tests for "no real-time punishment".** Cover the 600-second cap (src/game/tycoon/index.ts) and the daily run with no countdown or streak penalty (src/game/daily.ts), in scripts/tests/index.js.
10. **Local-only measurement.** Log Nights started, quits, and quits at Dawn in scripts/qa/bench.mjs and scripts/sim/run.mjs. No telemetry, and nothing leaves the machine.

## Sources

Web sources read from search results or pages, or checked by abstract:

- Ferster and Skinner (1957), summary: https://www.simplypsychology.org/schedules-of-reinforcement.html
- Clark et al. (2009), Neuron: https://pmc.ncbi.nlm.nih.gov/articles/PMC2658737/
- Kahneman and Tversky (1979), Econometrica: https://www.econometricsociety.org/publications/econometrica/1979/03/01/prospect-theory-analysis-decision-under-risk
- Loss aversion critique (Collins): https://www.jasoncollins.blog/posts/kahneman-and-tverskys-debatable-loss-aversion-assumption
- Arkes and Blumer (1985), OBHDP: https://cognition.aau.at/bg/BA/Arkes%20%26%20Blumer%201985.pdf
- Masicampo and Baumeister (2011), JPSP: https://doi.org/10.1037/a0024192
- Ryan, Rigby and Przybylski (2006), Motivation and Emotion: https://pure.ewha.ac.kr/en/publications/the-motivational-pull-of-video-games-a-self-determination-theory-/
- Kivetz et al. (2006), JMR: https://business.columbia.edu/sites/default/files-efs/pubfiles/1200/goalgradient.pdf
- Nunes and Drèze (2006), JCR: https://ideas.repec.org/a/oup/jconrs/v32y2006i4p504-512.html
- Cliffhanger studies (Schibler and Green; Wirz et al.): https://www.buffalo.edu/news/releases/2023/06/hahn-cliffhangers.html
- Johnson, "Designing interesting decisions": https://www.gamedeveloper.com/design/designing-interesting-decisions-in-games-and-when-not-to-
- Kelly, "Don't Juice It or Lose It" critique: https://gamedeveloper.com/design/video-indies-resist-the-urge-to-juice-it-or-lose-it-
- Kasavin and Korb, GDC 2021, "Breathing Life into Greek Myth": https://gdcvault.com/play/1026975/Breathing-Life-into-Greek-Myth
- Xiao et al., CHI 2024, "Lies, Deceit, and Hallucinations": https://www.robertxiao.ca/research/lies-deceit-and-hallucinations/
- Horror tension design article: https://www.gamedeveloper.com/design/the-balancing-act-of-tension-in-horror-game-design
- Zagal, Björk and Lewis (2013), FDG, "Dark Patterns in the Design of Games": https://research.chalmers.se/en/publication/177148
- FTC 2022 staff report, law-firm summary (Hunton): https://www.huntonprivacyblog.com/2022/09/27/ftc-releases-report-on-dark-patterns/
- UK Gambling Commission on loot boxes, as press coverage reports it: https://bit-tech.net/news/gambling-commission-says-loot-boxes-arent-within-its-purview/1
- Przybylski et al. (2013), Computers in Human Behavior: https://centaur.reading.ac.uk/34846/
- Meier, "Just one more turn" (not read; for his own account): https://www.gamedeveloper.com/game-platforms/just-one-more-turn---game-development-tips-and-tricks-from-the-creator-of-civilization-sid-meier-

Cited from memory or bibliographic records only, with no page checked: Loewenstein (1994), Psychological Bulletin 116(1); Tversky and Kahneman (1971), Psychological Bulletin 76(2); Horton and Wohl (1956); Hartmann and Goldhoorn (2011), Journal of Communication, DOI 10.1111/j.1460-2466.2011.01595.x; Fredrickson and Kahneman (1993); Alaybek et al. (2022), OBHDP; Iyengar and Lepper (2000), JPSP 79; Yechiam (2018); Sweetser and Wyeth (2005), ACM Computers in Entertainment 3(3); Jonasson and Purho (2012); Graja, Lopes and Chanel (2020); WHO ICD-11 (adopted 2019).
