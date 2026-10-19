# JackID: The House Director (lead designer, 2026-10-19)

Client brief: "The AI should offer us different games, chances and things based on what we do."

**In the fiction, the House reads you and the Clerk writes it down.** Every guest has a file in the Clerk's book. At every Dawn the House reads yours and sets the next Night for you. It is neither kind nor cruel: it wants you to keep coming back.
- It tempts the careful.
- It gives the greedy rope.
- It moves the guest who is stuck.
- It throws a coin to the one who is drowning.

Loki read these files for the House when he was its champion, and he reads yours (docs/JOKER.md). Most of the lines below are the Compere's: he reads you the way he once read guests at his table, which is a quiet clue to who he is (docs/STORY_BIBLE.md §9).

## 1. The file

The file has six small axes. It updates once, at Dawn, from counters the run already has (bus events), using integer maths. Each axis blends tonight into the file: `new = (old + tonight) / 2`, with a half rounded toward tonight. Night 1 starts neutral, and **a neutral file gives exactly today's rolls.**

| Axis | Range | How tonight is read |
|---|---|---|
| Risk | −2..+2 | Median stake as a share of the pocket: under 5 % is −2, under 10 % −1, under 20 % 0, under 35 % +1, and 35 % or more +2. Add +1 for any push: a dare taken, a risk Night Card kept, a keepsake staked, or three rides on a rig. |
| Machines | favourite, avoided | Favourite: the most plays over the last two Nights. Avoided: open machine kinds with no play in two Nights. |
| Lean | 0..3 | The Ink you took on from Loki tonight: none is 0, 1-2 is 1, 3-4 is 2, 5 or more is 3. |
| Ada | −2..+2 | +1 for a kitchen game, +1 for soup or a talk, +1 if Harmony rose; −1 for each ignored message, −1 if Harmony fell. |
| Law | caller, rider, guesser, none | Caller: a right call and no ride. Rider: three rides, or a takeover in a duel. Guesser: wrong calls only. |
| Debt | early, steady, scrape, borrow | Early: the quota met before the last Watch. Scrape: paid with a margin under 5 %. Borrow: a rescue loan, "I need time", or Loki's door rescue. Otherwise steady. This axis takes only the latest Night. |

## 2. What it sets for the Night

### Watch events

These multiply the weights in `WATCH_EVENTS`, between ×0.5 and ×3. Boss Nights are not touched.

| File | Change | Line |
|---|---|---|
| Risk ≤ −1 | `high_roller` ×3, `last_call_dare` ×2, `stage_auction` ×2 | Compere: "For our careful guest, the limit doubles tonight!" |
| Risk ≥ +1 | `crooked_table` ×2, `wheel_spin` ×2, `cashier_bonus` ×0.5 | Compere: "A guest who likes it hot!" |
| One machine has half or more of your plays | `tilt_switch` ×3 | Compere: "The House is bored of one seat." |
| Lean ≥ 2 | `single_light` ×2, and Loki talks the lit machine up | Loki |
| Debt scrape | `cashier_bonus` ×2, `dealers_break` ×1.5 | Compere: "The cashier is feeling generous." |
| Debt early | `stage_auction` ×2 | Compere: "Money in the room!" |
| Law caller | the hard Crooked Table from N4 instead of N6 | Tamsin: "You see. Let's see how well." |
| Law guesser | the beginner Crooked Table again, until a right call | Tamsin |

### Night Cards

The offer is still one safe card and one risk card. The file only chooses which ones.

| File | Offer | Line on the card |
|---|---|---|
| Risk ≤ −1 | The risk card is the tempting one: `high_table` or `double_down`. | "The House noticed you play it safe." |
| Risk ≥ +1 | The safe card is the most protective (`grace`, `charm_fair`), and the risk card is `lean_night`, a test of restraint. | |
| Debt scrape | The safe card is `rush_night` or `quiet_night`. | |
| Debt borrow | The safe card is `bankers_night`. | |

### The spotlight

Pick one of the avoided machines (a seeded pick among them). If none is avoided, pick the least played. Never pick the favourite or last Night's spotlight. The chip says: "You haven't sat here yet."

### Rivals and side games

This touches optional content only. Story duels and clues never move.
- **Caller:** Tamsin's Sealed Wall every Night from N2, one stake tier higher.
- **Lean ≥ 2:** Ask the Compere ×3, a liar's game for a guest who listens to one.
- **Borrow:** hotline loan bargains ×2.
- **Early:** hotline charm bargains ×2.
- **Bonds:** a friend at bond 0 for two Nights gets one more chance: their event comes once more, with a line ("Selim saved you a coffee."). After that, nothing (docs/STORY_BIBLE.md §10).

### Home events

At most one per Evening. Never on N1, and never on an Evening the story uses. Ada lives across the hall until N5 and with you after it (docs/STORY_BIBLE.md §3), so each event has two forms.

| File | Before N5 (across the hall) | From N5 (at home) |
|---|---|---|
| Ada ≤ −1 two Nights running | Her door stays shut when you pass, with a note on it: "Not tonight." Knocking uses up the Evening's PC time and gives Harmony +1. | **The cold plate:** dinner under a plate and a note, "Ate without you." Sitting with her uses up the Evening's PC time and gives Harmony +1. |
| Ada ≥ +2 | **The drawing,** slid under your door: you at work, without a face. +1 ŞANS star at the next Night, once a run. | The same drawing, on the fridge. |
| Lean ≥ 2 | She stops you in the hall: "You were smiling at the lift door." A pot of soup is on your step (Ink −1). | **The window:** "You were smiling at the window." She offers soup (Ink −1). |
| Risk ≥ +1 and Harmony ≤ 2 | That Night's message from Ada is `worry`. | The same. |
| Debt borrow | The Collector's "O." note comes under the door one Night early. Text only: the Knock still rolls from Heat. | The same, and Ada reads it first. |

### What Loki tempts you with

| File | Loki |
|---|---|
| Risk ≤ −1 | He dares you to go big: "Put it all in. This hand is ours." |
| Risk ≥ +1 | He asks you to stake a keepsake and to ride the rig once more. |
| Ada ≥ +1 | He aims at her: the kitchen ask, the promise "Leave the hair tie at home." |
| Ada ≤ −1 | He flatters, with a lie that serves him: "She's fine. We're fine." |
| Law caller | More of his Crooked Table lines serve him. |
| Lean ≥ 2 | His free tips are 10 points less honest for each Lean above 1, because he knows you'll take them. He offers a takeover every Watch. |
| Debt borrow | He offers the door rescue in advance: "I can make Orrin go away." |
| Favourite machine runs cold | He talks it up, with a lie that serves him. |

## 3. Fairness rules

1. **It only reweights and picks among existing content.** It never changes a machine's odds, a quota, a price, a Heat roll, a Knock roll or a story beat.
2. **It is bounded.** Each weight stays between ×0.5 and ×3. Boss Nights, N1 and story Evenings are untouched.
3. **It is deterministic.** The file changes once, at Dawn, from saved counters, and every pick is a pure function of the seed, the Night and the file. The same seed and the same play give the same Night, so bench replays still hold.
4. **It is readable.** Every changed offer says why in one line, in a voice: the Compere, Tamsin, Selim, Loki, Ada or the spotlight chip.
5. **It is visible.** At the N7 Audit the Clerk reads your file aloud ("Bets small. Avoids the wheel. Answers his wife."). From then on it is a journal page.
6. **It is not a punisher.** It tempts and it varies, but it never makes you lose.

## 4. Where it plugs in

**New files:**
- `src/game/house/file.ts`: the fold, saved under `resume.ext.houseFile`.
- `src/game/house/director.ts`: pure rules that return weights, picks and lines.
- `src/game/house/file.strings.ts`: the lines, prefix `file.`.

| File | Change |
|---|---|
| `watchEvents.ts` | `rollWatchEvent(rng, night, blocked, avoid, weightOf?)`: an optional weight function that defaults to 1. |
| `nightCards.ts` | `nightCardOffer(seed, night, prefer?)`: the same seeded shuffle, then a stable pick that prefers the file's ids within each side. The safe/risk pair rule stays. |
| `spotlight.ts` | `spotlightPick(seed, night, ids, last, prefer?)`. |
| `home/phone.ts` | The director may set Ada's message pick and the timing of the Collector's note. |
| `home/evening.ts` | One home event per Evening, in its before-N5 or from-N5 form. |
| `game/bonds.ts` | Read only: the friend-at-0 event. |
| `story/duels/rivals.ts` | `rivalsForNight(night, { file })`. |
| `events/compere.ts`, `hotline.ts` | Weights. |
| `story/chapter.ts`, `audit.cutscene.ts`, `story/notes.ts` | The file read at N7, and the journal page. |
| `joker/joker.ts` | Temptations and the Lean truth penalty. |

## 5. Tests and waves

**Tests:**
- **Fold:** fixed event logs give the expected file.
- **Neutral file:** gives today's rolls exactly, so the existing tests, `floorWiring` included, keep passing.
- **Determinism:** the same seed and file give the same offers.
- **Invariants:** one safe and one risk card, nothing on boss Nights, weights in bounds.
- **Statistics over 500 seeds:** a cautious file sees `high_roller` at least twice as often as neutral, and an avoided machine is spotlit on 90 % or more of the Nights where one exists.
- **Bots** (`scripts/sim`): a cautious bot and a reckless bot each see a different mix of Nights, and neither one's quota pass rate moves more than 3 points from neutral. The director varies the Nights; it doesn't rig them.

**Waves:**
- **H1:** the file, the director and the tests, with no UI. It can run after J2.
- **H2:** the lines, the home events and the Audit page.
