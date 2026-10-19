# JackID: The Joker (lead designer, 2026-10-19)

Client brief: "We should have a Joker who helps us, like Sukuna in Jujutsu Kaisen. He helps us, but not everything he says should be believable, and we have to keep our relationship with him good. A core mechanic." Added later: "If we use the Joker too much, we go mad." Added 2026-10-19: the bad one inside us is part of the man we must beat later; he lost once, part of his memory went into us, and we were a random person.

Read with docs/STORY_BIBLE.md §9 (who he is, his arc, the endings). This doc is the mechanic. Original IP: only the spirit (a charming, malevolent thing that shares your head, lends power on its own terms, lies when it suits him, wants something). No names, powers, lines or designs from any other work: no mouths on hands or faces, no eaten relics, no "domain".

## 1. Loki

**Loki, the Joker.** The voice in your head is the cut-out memory of the House's old champion: every table he read, his hands, his jokes. Ada beat him once, on the night your card was printed. The House cut his table out of him and filed it on the next card printed, yours (Rule 4). The rest of him, with his name and the memory of losing, is the Compere.
- **Name:** "Loki" is borrowed, an old trickster's name he wears like a stolen coat. He will not give his real one, because he doesn't have it: it stayed with the rest of him. Ask, and he deflects with a joke ("Names are expensive here, ortak.").
- **Look:** no body. He shows only in glass (the lift mirror, machine screens, the peephole lens, the photo frame, the home PC) as an upside-down second head under your reflection, like the bottom half of a court card: the flat face from the champion's old poster, a phosphor-green rim, a grin.
- **Voice:** fast, flattering, gossipy. He calls you "ortak" (partner) and says "sen".
- **Wants:** a name to ride up on. The lift takes up only the first name, and yours is the nearest.
- **Fears:** the rest of him (being swallowed back into a loser), and Ada, the one hand he can't read.
- **Secret:** he doesn't remember losing. The loss stayed with the body.

## 2. Two numbers

Trust is the one new number (director sign-off, pillar 7). Madness reuses Dread.

### 2.1 Trust (Güven): −3..+3, starts at 0

A signed scale, because he can be a friend or an enemy and the sign is his mood (sour, flat, fond). Harmony and Heat are one-sided pressure meters and can't say that. Seven steps, so each move is felt and maps to one frame of his grin. Small, so a broken promise (−2) hurts.

| Move | Trust |
|---|---|
| Take a dare (his machine at his stake, raise when he says raise, ride the rig once more) | +1, once a Night |
| Feed him a marked card | +1 |
| Keep a promise you made him (checked at Dawn) | +1 |
| Catch him lying: press C within 3 s of a whisper that was a lie | +1, once a Night |
| Ask him to take over (he likes being needed) | +1, once a Night |
| Call him a liar when he told the truth | −1 |
| Refuse a dare or a promise | −1 |
| Hand a marked card to the Clerk | −1 |
| Break a promise to him | −2 |
| Admit him to Ada (N5, once) | −2 |

Trust gains cap at +1 a Night, whatever you do; it falls without limit. At a Dawn Trust decays 1 toward 0 unless it moved that Night, so a favour you stop feeding is forgotten.

Ignoring a plain tip costs nothing: only dares and promises are requests. His promises are small and run until Dawn ("Play the derby for me tomorrow." "Leave the photo at home."). He asks one a Night at most, at the Evening, through the window glass. At Ada's table he is silent until Ink 8: she beat him, and he can't read her. After that he may ask you to break your word to her: breaking it gives Trust +1, Harmony −1 and a crack; keeping it costs Trust −1, and the kept word still heals Ink.

### 2.2 Ink (Mürekkep): his memory taking over, carried by Dread

Ink is how much of his memory has written over yours. The madness is not noise: it is a stranger's ten thousand nights getting louder than your own life.

**Choice: madness reuses Dread** (`horror/dread.ts`), with no sanity bar.
- Dread already measures how wrong the world feels (light grade, flicker, PA babble, mannequins, whispers), and it already has a Calm path.
- The low-luck whisper pool (`horror.whisper.*`, "one more…") becomes his voice, so an existing system gets a speaker.
- It meets pillar 5: dread comes from the player's own state, and leaning on him is player state.
- Heat is the Collector's, Harmony is Ada's, and ŞANS is earned luck: none of them fits.

Dread is rebuilt every frame and resets each Night, but madness must last until you sleep it off. So the Joker module stores one integer, **Ink 0..10**, and Dread reads it as a new input, the way it reads cursed charms: `dread += 4 × ink`. Ink is never shown as a number. You see it on the glove: each of the right hand's five fingertips stains at an odd Ink and goes black at an even one. You feel it in the Dread grade.

| Raises Ink | | Heals Ink | |
|---|---|---|---|
| Ask a whisper | +1 | Sleep at home | −2 (−1 if Ada is at her sister's) |
| Ask a takeover | +2 (+3 at Trust ≤ −1) | An evening of kept words at Ada's table | −1 |
| Unasked takeover | +2 | Soup with Ada | −1 (−2 once you've admitted him) |
| Sending the Collector away | +4 | Any kept word (a kept-word duel win, a promise to Loki kept at Dawn) | −1 each, max 2 a Night |
| N1 tutorial takeover | 0 | A marked card to the Clerk | −1 |

A kept word is the one thing he can't write over, because he never kept one; sleep and Ada are yours, and his memory has nothing to say there. Keeping a promise *to him* heals too: being honest with him is safe, and leaning on him is not.

| Ink | Black tips | Symptoms |
|---|---|---|
| 0-1 | 0 | Clean. |
| 2-3 | 1 | He talks more: one extra tip a Watch. |
| 4-5 | 2 | **BLEED.** His head sits silent in every glass. In one NPC subtitle in five, a word turns into his, in green ("guest" becomes "partner"). Your inner line sometimes ends in his voice. |
| 6-7 | 3 | **THE HUD LIES.** The pocket count-up overshoots by up to 5 % and snaps back within 1 s. The card's grin shows a wrong frame one glance in three. Rims flicker green, vertex snap coarsens, reflections lag. A quarter of his true lines say "we". Unasked takeovers: 10 %. |
| 8-9 | 4 | **HIS HAND.** Once a Night he finishes a reply of yours to Ada in his words, and its Harmony move drops by 1. Ada's amber rim looks green. He talks at home and starts to remember her kitchen as his. Half his lies drop "we". Unasked takeovers: 25 %. |
| 10 | 5 | **HE CAME HOME** (the bible's ending). |

Pacing target: one takeover and a couple of asks a Night, with sleep and Ada, nets about +0.5 Ink a Night. That reaches BLEED by N8, but never the end. A takeover every Watch nets +4 a Night, and the end comes around Night 4.

### 2.3 How they meet

| | Ink 0-5 | Ink 6-9 |
|---|---|---|
| **Trust ≤ −1** | A liar you can read. | Sabotage: unasked takeovers throw your rounds. |
| **Trust 0** | A coin you learn to read. | Unasked takeovers help or hurt, 50/50. |
| **Trust ≥ +1** | The best state: honest and readable. | **The trap:** rare, unreadable lies, and takeovers that come on their own and win. Every win is a fingertip. He wins by being nice. |

The safe road to high Trust goes through promises, cards and catching his lies. The fast road goes through takeovers, and it ends at his ending.

### 2.4 Marked cards

The champion's old marked deck is twelve court cards with his grin scratched in, scattered the night he lost: one or two on each floor (behind machines, in the Wash lockers, on the lift roof, under a Clerk's plate). They are notes (`story/notes.ts`), not a currency, and each is a choice:
- **Feed him:** Trust +1 and a piece of his story in his words, a memory he had lost the thread of. It may lie, and a lie carries the tell.
- **Hand it to the Clerk:** Trust −1, Heat −1, Ink −1, and the Clerk's true record of the same night.

Fed cards unlock his gifts. These are existing charms, given free with his grin on them, and they count as cursed for Dread: Mirror Shoe at 3, Photo Negative at 6, Card of All Suits at 9. Either full pile names the rest of him (the Compere) before N8. No story clue waits on the cards: the Wager shows it anyway.

## 3. Whispers

**Kinds:**
- **Tip:** he offers it, and it is free.
- **Ask:** you hold the card key (proposed: Q) at what you're looking at. Ink +1, and +10 points of truth.
- **Dare:** a yes-or-no request (Trust ±1).
- **Promise:** a dare that runs until Dawn.

**When he talks** (one tip per moment, about three a Watch at Ink 0):
- **Machines:** as you walk up, before a bet of a quarter of your pocket or more, and after a near miss.
- **Duels:** before a throw or an answer. He predicts; your inner line explains people and never lies.
- **Crooked Table:** he names a table.
- **The Knock:** from the peephole.
- **Home PC:** on the ventures screen. Venture Dawns are seeded, so a true tip is real knowledge.
- **Dawn:** which Night Card to keep.
- **Never on the phone,** which is Mira's.

**Truth model.** A true whisper is one of his memories: he has stood at this machine, read this rival, built this rig. A lie is a plan. A whisper is either *free* (a lie gains him nothing) or *for him* (a lie pushes you toward risk, toward needing him, away from Ada, or toward a broken word). The roll is `hashSeed(seed, night, watch, 'joker', n)`. The formula: `p = 0.70 + 0.08 × trust` for a free whisper, `0.40 + 0.10 × trust` for one that serves him, +0.10 for an Ask, clamped to 0.05..0.95.

| Trust | −3 | −2 | −1 | 0 | +1 | +2 | +3 |
|---|---|---|---|---|---|---|---|
| Free | 46 % | 54 % | 62 % | 70 % | 78 % | 86 % | 94 % |
| For him | 10 % | 20 % | 30 % | 40 % | 50 % | 60 % | 70 % |

**The tell: he can't lie alone.** Every lie has "we", "us" or "our" in it (TR: *biz, bize, bizi, bizim*, always written out). True lines use I and you: they are his own memories. His lies are his plans, and every plan he has is the two of you as one. Lines are at most eight words at 40 cps, so the word is on screen within 2 seconds. Ink is what spoils the tell: up to Ink 5 it is perfect, at 6-7 a quarter of true lines say "we", and at 8-9 half his lies drop it. **Trust decides how often he lies. Ink decides whether you can tell.**

**How you learn it:**
- **MATH:** the Tally Sheet's Loki page logs every whisper that resolves: "He said 'we' 4 times. 4 were wrong."
- **TELL:** your inner line notices his second "we" lie.
- **Mira:** her N5 call says it outright.

| # | Where | True? | TR | EN |
|---|---|---|---|---|
| 1 | machine | true | Bu makine bu gece soğuk. Ben olsam geçerdim. | This one's cold tonight. I'd walk past. |
| 2 | machine | lie | Bu makine bizi seviyor. Bir daha çek. | This machine likes us. Pull again. |
| 3 | big bet | lie | Hepsini koy. Bu el bizim. | Put it all in. This hand is ours. |
| 4 | big bet | true | Yarısını koy. Gerisi yarın lazım. | Bet half. You'll need the rest tomorrow. |
| 5 | Crooked Table | true | Ortadaki masa. O kirazı ben koydum. | The middle table. I put that cherry there. |
| 6 | Crooked Table | lie | Soldaki hileli. Bize güven, çağır. | The left one's crooked. Trust us. Call it. |
| 7 | Lucan | true | Saatine bakmadı. Bu atışı bilmiyor. | He didn't check his watch. He's guessing. |
| 8 | Lucan | lie | Kağıda bozacak. Makas at, bizimdir. | He'll break to paper. Throw scissors, it's ours. |
| 9 | the Collector | true | Kartı yüksek. O çentiği ben açtım. | His card is high. I cut that nick myself. |
| 10 | Ada's table | lie | Bu sözü boz. Bize kızmaz. | Break this one. She won't mind us. |
| 11 | the Knock | true | Sadece dinliyor. Işığı kapat, kıpırdama. | He's only listening. Lights off. Don't move. |
| 12 | the Knock | lie | Zinciri aç. Bizimle konuşmak istiyor. | Take the chain off. He wants a word with us. |
| 13 | home PC | true | Taksi yarın boş döner. Bu akşam sat. | The taxi pays nothing tomorrow. Sell it tonight. |
| 14 | home PC | lie | Bir fırın daha al. Bize para basar. | Buy one more bakery. It'll print money for us. |
| 15 | Night Card | lie | Riskli kartı al. Biz bu geceyi kaldırırız. | Take the risky card. We can carry tonight. |
| 16 | N8 kitchen (Ink 8+) | true | Kazan. Kendisi istedi. | Win. She asked for it. |
| 17 | Burning Wager | true | Sustuğunda bozar. Ben öyle yapardım. | When he goes quiet, he breaks. I did. |
| 18 | Burning Wager | lie | Bu sefer tutacak. Bizi dinle, makas at. | He'll keep it this time. Listen to us, throw scissors. |

## 4. Change of Hands (El Değiştirme)

This is his old skill: the champion's hands, as he remembers them. He says "Elini ver." (Give me your hand.) The glove slides off your right hand, and the hand under it is his: long, ink-black fingers. The screen becomes a court card: a thin border with J pips, colours cut down to felt green, card red and black, and the bottom third showing the same view upside down. Then a card riffle, silence, his act, and the glove goes back on, 2.5 s in all. In any reflection your eyes are white.

| Where | What he does (one act) |
|---|---|
| Machine | That pull is a BIG WIN: exactly 10× the stake. For this pull the stake counts as at most 2.5 % of the Night's quota, so a takeover is worth a quarter of the quota at most. Never a jackpot, never on the bell, the Debt Terminal or the cashier. |
| Duel | He wins one throw or round, once a duel. In Promise it scores 1, never a kept 2; if you were the caller and your promised hand wasn't the winner, your card cracks. In the Question you see the other card. In Locker Shuffle and the Last Count he makes the right pick. At the N8 kitchen wager he plays to win, and a win there makes Ada go still. |
| Crooked Table | He sees through it: every tell channel fills for all three tables. You still have to call. |
| The Knock | "Let me get the door." The visitor leaves without a toll, and Heat −1. Once a run. |
| The Visit | When a missed quota brings the Collector in, Orrin stops in the hall with his rim gone green, still until Dawn. You live, the missed coins go onto tomorrow's quota, and Ink +4. Once a run. |

**Price and limits:**
- **Price:** Ink (§2.2). At Trust ≤ −1 he wants Ink +3 or a promise, your pick.
- **Cooldown:** one asked takeover a Watch, never twice in a row at one machine.
- **In front of the Clerk** (the N7 Audit, the N8 kitchen and the Burning Wager), a takeover is a cheat under Rule 2. The throw wins, the Clerk says "That is not your hand," and the wager can't be clean. At the Wager the Champion answers: "That hand is mine." **He can win you any game. He can't win you a clean one.**
- **Orrin knows his hand:** he watched it for years. In the N6 Question, a takeover is called one time in two (you lose the round, Heat +1).

**Unasked takeovers** start at Ink 6. They can strike at key moments: a bet of a quarter of your pocket or more, a duel's match point, a Crooked Table call, the Knock, or a throw at Ada's table. The chance is 10 % at Ink 6-7 and 25 % at 8-9.
- **Trust +1 or more:** he helps.
- **Trust 0:** a coin flip between help and spite.
- **Trust −1 or lower:** spite. He throws the round, calls the wrong table, breaks your word to Ada, or takes the chain off.
- **At the N8 kitchen wager,** help and spite look the same: either way he plays to win.

Each one costs Ink +2. Two counters:
- **Ada's hair tie,** worn on your wrist as the keepsake: the first unasked takeover each Night slips off ("not that hand").
- **Coffee:** blocks them for the next Watch.

**His word.** His word is earned when Trust +3 is held at a Dawn: then he offers one true answer. It is said over the card, so Rule 1 binds him. Once a run, an Ask made "on his word" is always true and carries no tell. It holds even if Trust falls later, and he will try to make you spend it early. Spent at the Burning Wager's match point, it is the first word he has ever kept: he tells the truth against the rest of himself, and when the card burns the fire can't take him (STORY_BIBLE §9).

## 5. Integration

- **ŞANS stars:** he never moves one, and a round won by his hand earns none (the luck meter ignores rounds tagged `joker`). Stars stay home's (pillar 2).
- **Rock, Paper, Promise:** he isn't seated, so he can't promise at the table, but you can promise him. A takeover never keeps your word, and it never makes a kept pair. At the N8 Burning Wager he whispers about the Champion's habits, which are his own (bible §5a, §9).
- **Home:** he speaks only through glass, never in the kitchen until Ink 8.
- **Night Cards:** he always recommends one, and recommending the risk card serves him.
- **House Director:** he read these files for the House when he was its champion, and he reads yours (docs/HOUSE_DIRECTOR.md §2).
- **Bonds:** he never moves one (bible §10). He gossips about your friends, and a "we" line about one is a lie.
- **Already covered above:** Heat (§2.4, §4), Harmony and food (§2.2), charms (§2.4), the Crooked Table and investments (§3).

## 6. UI, presentation, Calm Mode

- **His lines:** the bottom subtitle bar, source `joker`. Phosphor-green text, a speaker plate shaped like a card corner (an upside-down J and Loki), 40 cps, a card-riffle blip. Your inner line stays italic, bottom left, with no plate. Two voices, and one of them lies.
- **Trust readout:** the corner of your card sits next to the ŞANS stars. Its grin moves when he talks, and its width shows Trust in seven frames, from bared teeth to a wide grin.
  - It is a face, not a number, because reading faces is the House's whole game.
  - From Ink 6 it shows a wrong frame one glance in three.
  - The journal shows the true frame at every Dawn.
- **Reflection:** his upside-down head under yours in any glass or screen in view while he speaks.
- **Toasts:** "He liked that." "He'll remember that." No numbers.
- **Calm Mode** keeps every rule and softens the rest:
  - no warp, rim flicker, flash or hitstop
  - Change of Hands shows only the card border
  - HUD lies are tinted green
  - reflections fade in
  - an unasked takeover gets a 1 s plate first ("Loki takes the hand")
  - HE CAME HOME plays without a jolt
- **reduceFlashing:** the grin is a frame swap, never a light flash.

## 7. Implementation plan

**New files:**
- `src/game/joker/joker.ts`: pure, seeded rules. Trust, Ink, the truth and unasked rolls, his word, the limits, and the save under `resume.ext.joker`.
- `joker/whispers.ts` and `joker.strings.ts`: context, true key, lie key, free or for him.
- `joker/marked.ts`, `joker/takeover.ts`.
- `src/core/ui/manga/joker.ts` and `.css`: the plate, the card chip, the bleed.
- `src/world/reflection.ts`: the head in glass.
- `story/cutscenes/grin.cutscene.ts`: HE CAME HOME.

**Touched files:**
- **Run and Dread:** `run.ts`; `ingame/session.ts` and `horror/dread.ts` (a `jokerInk` input); `horror/director.ts` (the whisper pool becomes his from Ink 2).
- **Floor and duels:** `watchEvents.ts`, `events/crookedTable.ts`, `duels/promise/rules.ts` and `flow.ts`, `duels/thequestion`.
- **Home:** `home/evening.ts`, `knock.ts`, `phone.ts`, `food.ts`, `keepsake.ts`.
- **Meters and charms:** `luck.ts`, `data/charms.ts`.
- **Story:** `story/chapter.ts` (arc `joker`), `calls.ts`, `audit.cutscene.ts`, `reveal_n8`, `ending_elevator`.
- **Hands:** `player/viewmodel.ts` (glove tips, the glove-off pose).

**Bus events:** `joker:trust`, `joker:ink`, `joker:whisper`, `joker:takeover`.

Found while reading: `session.ts` reads `dread.add` only as relief (`Math.max(0, -mod)`), so positive `dread.add` effects (cursed candy, moth swarm, the `draft` event) are dropped today. Ink gets its own input, and this gap should be fixed on its own.

**Waves** (4-5 lanes each):
- **J1:** the rules, copy, marked-card data, tests and sim, with no UI.
- **J2 (voice):** the plate, card chip, tips, asks, dares, C to catch a lie, the Tally page.
- **J3 (hand):** Change of Hands, the glove tips, Ink into Dread, the symptom tiers, unasked takeovers, the hair tie, coffee, Calm.
- **J4 (home and story):** the kitchen rule, window promises, the Knock and Visit, healing, card placement, gifts, Mira N5, Orrin N6, the Clerk N7.
- **J5:** HE CAME HOME (it now ends at Ada's table), the N8 reveal (the Compere), his whispers at the Wager, ending variants, his word and the "he stays" variant, balance.

**Tests** (`scripts/tests/joker.test.mjs`) cover the truth table and clamp, tell reliability per Ink band, Ink costs and healing, unasked odds and kind, the hair tie and coffee, the once-a-run limits, Clerk-witnessed takeovers (never clean), an unasked takeover at the N8 kitchen wager, seeded determinism and a save round-trip.

**Balance check** (`scripts/sim/joker.mjs`, 1000 seeds × 8 Nights on the existing run sim):

| Bot | Plays | Target |
|---|---|---|
| abstain | never uses him | HE CAME HOME 0 %; quota pass rate within 1 point of today |
| measured | one takeover a Night, asks at key moments | HE CAME HOME under 5 %; pass rate about +10 points; Ink ≤ 6 in 97 % of runs |
| leaner | a takeover every Watch | HE CAME HOME in 70 %+ of runs by Night 6 |
| believer | follows every whisper | coins no better than abstain |
| reader | follows only lines without "we", calls the rest | coins 5-10 % above abstain; Trust +3 held at a Dawn by N6, without a takeover, in about 40 % of runs |

Also check zero tell errors at Ink ≤ 5 over 10⁵ whispers.
