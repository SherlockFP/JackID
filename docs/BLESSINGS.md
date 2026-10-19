# JackID: Seals, the Owners and their Favours (lead designer, 2026-10-19)

Client asks: **can** (lives), **tanrılara lütuflar** (boons from gods), **doğa üstü şeyler** (the supernatural).
Director's rule: the game already has too much. Nothing here is a new meter or a new currency (pillar 7). Every piece below
is an existing system renamed, merged or given a meaning. Read with docs/STORY_BIBLE.md §2, §4, §9 and docs/HOUSE_DIRECTOR.md.

**The three answers in one line each.**
- **Lives are the name seals** the card already has (Soul Marks, 3 a run). A missed Dawn costs one seal, not the run.
- **The gods are the House's owners**: the Well and the Three Seats (Ash, Ledgers, Mirrors), with Loki as the borrowed god.
  Their boons are the ONE free pick of the game. They replace the Night Cards, the Starter Draft, the overpay charm picks and
  the shrine's random blessings and curses.
- **The supernatural is the horror director with a reason**: each omen is an existing beat that now means one thing and asks one thing.

---

## 1. CAN: the name seals (Ad Mühürleri)

**Fiction (already in the bible, §2).** Three name seals per card. When you can't pay in coins, the House takes a piece of
your name. At zero the card reads BLANK and you go still. Nothing to invent: the code has it as Soul Marks
(`run.soulMarkCount`, `SOUL_MARKS_PER_RUN = 3`, saved, `duel:marks` event, drawn as wax seals by `paintSeals` in
`src/game/ingame/panels.ts`). Today only duels spend them.

**The rule.**
| Dawn | What happens |
|---|---|
| Quota paid | As now. |
| Quota short, 2 or 3 seals left | The House takes one seal instead of the run. The Night counts as paid (the bank is kept by the House, the pocket stays). No overpay tiers, no boon offer this Dawn, ŞANS −2 (the existing `quota:failed` move, sent as a new `quota:sealed` so nothing else reads it as a fall). |
| Quota short, 1 seal left | The last seal goes, the card reads BLANK: FALL / THE VISIT as now (`fall()`, `startDoomed()` at home). |

So a run survives two missed Dawns. The third ends it.

**The price is memory.** Each lost seal prints one line on the Dawn receipt, from the part of you that is yours (§9: the
quiet life before Night 0). A restored seal gives the line back. This is the same price Selim pays for his seals (§3), so
the player learns it once.

| Seal | Receipt line EN | TR |
|---|---|---|
| 1st lost | Forgotten: the name of your street. | Unutuldu: sokağının adı. |
| 2nd lost | Forgotten: the song your father whistled. | Unutuldu: babanın ıslıkla çaldığı şarkı. |
| last | Forgotten: your name. | Unutuldu: adın. |
| restored | You remember your street. | Sokağını hatırladın. |

At home (solo Home layer) a short miss is a polite knock, not the goons: the Collector at the door, hat in hand, takes the
seal. Collector: "Thank you. Only a little of you." / "Teşekkür ederim. Sizden yalnızca biraz." (reuse `knock.ts` and the
first shots of `mafia_visit`; the last seal keeps the full `mafia_visit`).

**What restores one** (no new source; at most one restore a Night):
1. **HOUSE ENVY**, the 4× overpay tier (`schedule.ts` `restoreMark`, already live).
2. **The Hollow Door**: a right call at the Lord of Mirrors' table (`hollow/rules.ts` `restoreSoulMark`, already live).
3. **Your Name Back**, the Lord of Mirrors' Rite (§2).
4. Later, with the bonds lane (§10): Selim at bond 2 puts his own seal on a short quota once. You lose nothing; he forgets something.

**Duels.** The Soul Mark stake tier stays, on the same seals, but the Clerk won't take your last one: the tier needs 2+
seals (`tallytable/index.ts` refuses it). So BLANK only ever comes from a Dawn, and the cursed `blank_jackid` charm goes.

**HUD.** One element: three 7×7 wax seals (the `paintSeals` art) right of the quota line in `src/menu/hud.ts`. Lit = kept,
empty ring = lost. They pulse red during Last Call of the final Watch while the bank is short. No number, no label (tooltip:
"Name seals / Ad mühürleri").

**Replaces.**
| Old | Fate |
|---|---|
| `false_bottom` (forgives ≤10 % once; cut as inert, still read in `dawn()`) | Becomes the Ledgers boon *Rounding Error*. Charm row deleted. |
| `rope_ladder` (one Overtime Watch; not in the launch list) | Becomes the Ash Rite *Overtime*. The `overtimeIdx` code stays, the charm row goes. |
| `blank_jackid` cursed charm | Deleted. BLANK = the run ends. |
| The trapdoor on the first miss | Now only on the last seal. |

---

## 2. THE OWNERS: the pantheon (Sahipler)

**Fiction.** The Three Seats own the House and the House is built on the Well (§2). Old guests pray to them, the Clerk calls
them owners. A boon is a favour, and in the House a favour is a debt: the Clerk writes it on the back of your card, beside
your two names. Loki is not a god. He wears one's name (§9), and he can slip his own card into the deck.

| God | EN / TR | Domain | Sigil (reel, card, statue) | Hooks it owns |
|---|---|---|---|---|
| The Well | The Well / Kuyu | luck, wishes | a ring of water | ŞANS stars, lamps, jackpots |
| Lord of Ledgers | Lord of Ledgers / Defter Lordu | money, greed | a coin with a slot | interest, deposits, quota, the Pawn |
| Lord of Ash | Lord of Ash / Kül Lordu | time, endings | a burnt match | clock, Last Call, Tilt, dread, the trapdoor |
| Lord of Mirrors | Lord of Mirrors / Ayna Lordu | faces, names, reads | an oval glass, no face | tickets, refunds, duels, Heat, seals |
| Loki | The Borrowed God / Ödünç Tanrı | tricks | a green grin | double-edged boons paid in dread (Ink later) |

The TR Lord names are the ones `hollow.strings.ts` already uses.

### 2.1 One reward system

| Today | After |
|---|---|
| Starter Draft (N1 Mola, 1 of 3 charms) | **Cut.** N1 has nothing new. Engine charms stay in the Pawn. |
| Night Cards (Dawn, 1 of 2, one Night) | **Reskinned into the boon offer.** Same module, seeded offer, save slot, timeout and `fx` switches. |
| Overpay tiers 1.5×/2×/3× (pick a charm) | **Feed the boon offer** (below). The `overpays` queue and its UI go. |
| Shrine candle (70 % blessing / 30 % curse buff) | **Steers the offer**: a candle raises one god's Favour. The 8 buffs go. |
| House Favour (`nightDef().favour`, a 2nd payout curve) | **Merged into House Mood.** One curve, and the word "favour" is free. |
| Pawn (charms for coins), boss Pledge charm, tonics, food | Unchanged: the Pawn *sells*, the gods *give*. |

**The offer.** At each paid Dawn the card turns over and shows **3 boons**, from 3 different gods when possible. Pick 1.
Boons last the run (not one Night). Seeded by run seed and Night, like the Night Cards. The 20 s timer takes the leftmost.
The House Director keeps its job and now weights gods instead of cards: Risk ≤ −1 → Ledgers, Debt scrape or borrow → Ash,
Law caller → Mirrors, Lean ≥ 2 → Loki prompts a swap.

**Overpay tiers now pay into the offer:**
| Tier | Was | Now |
|---|---|---|
| gratuity 1.1× | 2 Tickets | same |
| favoured 1.25× | `favoured` buff | renamed **Noticed**: +1 Favour with the god of your last boon |
| uncommon 1.5× | charm, 1 of 3 | the offer shows **4** cards |
| golden 2× | rare charm, 1 of 3, −5 % next quota | pick **2** of the offer, −5 % stays |
| seal 3× | 5 Tickets + legendary 1 of 2 | 5 Tickets + one card is a **Rite** (or a duo if no god is at Favour 3) |
| envy 4× | restore a seal | same |
Before the pantheon opens (N1 Dawn) the 1.5×/2×/3× tiers pay 3 Tickets each.

**Loki's swap** (from N3): on the offer, [R] lets him swap one card for one of his. Costs Dread +8 for the next Night (Ink +1
once docs/JOKER.md ships). Once per offer.

### 2.2 Favour (Teveccüh), 0..3 per god

- +1 for each of the god's boons you keep. +1 for a candle lit at its statue (shrine, N3+, the existing price, once a Watch).
- **2:** the god's omen can fire (§3). **3:** its statue weeps, and the next paid Dawn offers its **Rite** in one slot (from N5).
- **A Rite costs Heat +1.** Line under the card: "A favour is a debt. The Collector keeps the other copy." / "İyilik de borçtur. Öbür nüshası Tahsildar'da."
- Favour never decays. Loki has no Favour and no statue.
- **Duo boons** (from N5): when you hold 2+ boons from each of two gods, one slot may show their duo. Max one per offer, two per run.
- **Cap:** all boon `payout.mult` together ≤ ×1.35 (same idea as the stamp build cap); a sim pins it.

### 2.3 Boon rows

`NEW` = a hook with no reader yet (one line where named). Everything else already has a reader.

**The Well (Kuyu)**
| id | EN / TR | Effect | Numbers | Hook |
|---|---|---|---|---|
| well_penny | First Penny / İlk Kuruş | a star now; stars pay more | +1 star; 1.5 % a star (was 1 %) | `floor:luck`; NEW `x.luck.perStar` in `luck.ts` |
| well_soft | Soft Landing / Yumuşak İniş | bad news costs fewer stars | a missed Dawn or tithe −1 star less | NEW `x.luck.failSoft` in `luck.ts` |
| well_warm | Warm Water / Ilık Su | HOT lamps pay more | ×1.3 | `x.lamp.hotMult` |
| well_lamps | Two Lamps / İki Lamba | one more HOT lamp a Watch | +1 lamp, quota ×1.05 | `x.lamp.hotCount`, `quota.mult` (was `lamp_festival`) |
| well_wish | Small Wish / Küçük Dilek | jackpots are bigger | ×1.5 | `jackpot.mult` |
| **well_answer** (Rite) | The Well Answers / Kuyu Cevap Verir | more stars, and one every Dawn | star cap 5 → 7; +1 star a paid Dawn | NEW `x.luck.max` in `luck.ts`; `floor:luck` at Dawn |

**Lord of Ledgers (Defter Lordu)**
| id | EN / TR | Effect | Numbers | Hook |
|---|---|---|---|---|
| ledg_compound | Compound / Bileşik Faiz | more interest | +3 % a Watch | `x.econ.interestAdd` |
| ledg_count | Honest Count / Dürüst Sayım | deposits grow | +5 % | `deposit.bonus` |
| ledg_double | Double or Nothing / Ya Hep Ya Hiç | win more, owe more | payout ×1.2, quota ×1.12 | `payout.mult`, `quota.mult` (was `double_down`) |
| ledg_round | Rounding Error / Yuvarlama Hatası | a small shortfall is written off | ≤5 % at Dawn, once a Night | `run.dawn()` (the `false_bottom` branch) |
| ledg_pawn | A Friend at the Pawn / Rehincide Dost | cheaper charms, more stock | −20 %, +1 slot | `shop.discount`, `x.pawn.slots` (was `charm_fair`) |
| **ledg_books** (Rite) | Cooked Books / Pişmiş Defter | the House stops noticing your wealth | no wealth floor on the next quota | NEW `x.house.noticeOff` in `houseNotice()` |

**Lord of Ash (Kül Lordu)**
| id | EN / TR | Effect | Numbers | Hook |
|---|---|---|---|---|
| ash_minute | Borrowed Minute / Ödünç Dakika | longer Watches | +20 s | `x.run.clockAdd` |
| ash_lastcall | Long Last Call / Uzun Son Çağrı | longer Last Call | +10 s | `x.run.lastCallAdd` |
| ash_hand | Steady Hand / Titremeyen El | Tilt comes later | +3 pulls | `x.tilt.grace` (was `grace`) |
| ash_cold | Cold Ash / Soğuk Kül | the floor feels calmer | Dread −15 | `dread.add` |
| ash_short | Short Night / Kısa Gece | one Watch fewer, smaller quota | −1 Watch, quota ×0.8 | `quota.mult`, `fx.watchAdd` (was `rush_night`) |
| **ash_overtime** (Rite) | Overtime / Fazla Mesai | a short Dawn first plays one more Watch | once a run, before a seal is taken | `run.dawn()` (the `rope_ladder` branch) |

**Lord of Mirrors (Ayna Lordu)**
| id | EN / TR | Effect | Numbers | Hook |
|---|---|---|---|---|
| mir_print | Lucky Print / Şanslı Baskı | big wins print Tickets | ×10+ win → +1 Ticket, max 3 a Watch | `x.onTag.bigwin` |
| mir_back | Second Look / İkinci Bakış | losses give a little back | 5 % refund | `loss.refund` |
| mir_tell | The Tell / Açık Verme | rivals show their tell sooner | one turn early | NEW `x.duel.tellEarly` in `duels/engine.ts` |
| mir_face | Borrowed Face / Ödünç Yüz | the Collector misses you once | first Heat gain a Night ignored | NEW read in `home/phone.ts` heat move |
| mir_clear | Clear Glass / Temiz Cam | catching a cheat pays a star more | +1 star on a right Crooked Table call | NEW `x.crooked.starAdd` in `events/crookedTable.ts` |
| **mir_name** (Rite) | Your Name Back / Adın Geri | a lost seal comes back | +1 seal; offered only with a seal missing | `run.restoreSoulMark()` |

**Loki, the Borrowed God (Ödünç Tanrı)** (swap only)
| id | EN / TR | Effect | Numbers | Hook |
|---|---|---|---|---|
| loki_tip | His Tip / Onun Tüyosu | pays well, feels wrong | payout ×1.15, Dread +8 | `payout.mult`, `dread.add` |
| loki_raise | Raise / Arttır | bigger bets, no safety | max bet ×2, refunds set to 0 | `bet.maxMult`, `loss.refund` set 0 |
| loki_grin | The Grin / Sırıtış | more pulls, more dread | +2 pulls a Watch, Dread +10 | `x.run.pullsAdd`, `dread.add` |
| loki_coat | Stolen Coat / Çalıntı Palto | his swap is free from now on | — | pantheon rule |

**Duos** (all six pairs exist as data; only two can ever be taken)
| id | Gods | EN / TR | Effect | Hook |
|---|---|---|---|---|
| duo_wishcoin | Well + Ledgers | Wishing Coin / Dilek Parası | each star adds +1 % to deposits | NEW provider in `luck.ts` on `deposit.bonus` |
| duo_stillwater | Well + Ash | Still Water / Durgun Su | a missed Dawn costs no stars | `luck.ts` (`quota:sealed` move = 0) |
| duo_moon | Well + Mirrors | Moon in the Well / Kuyudaki Ay | the Sigil omen can fire twice a Night | omen weight |
| duo_latefee | Ledgers + Ash | Late Fee / Gecikme Faizi | deposits in Last Call +10 % | NEW `x.deposit.lastCall` in the deposit path |
| duo_twobooks | Ledgers + Mirrors | Two Sets of Books / Çift Defter | Crooked Table wagers pay ×1.5 | `events/crookedTable.ts` |
| duo_stillface | Ash + Mirrors | Still Face / Donuk Yüz | at Dread 60+ payouts ×1.1 | NEW `x.payout.atDread` in the payout fold |

Night Cards with no home (`quiet_night`, `lean_night`, `high_table`, `bankers_night`, `payday_night`) are cut.

---

## 3. THE SUPERNATURAL: omens (Alametler)

Six omens. Each is an existing beat, fires only from the player's state (pillar 5), is muted to a visual in Calm mode, and
reads as one instruction.

| Omen | Fires when | Built from | Means | Do |
|---|---|---|---|---|
| **The Weeping Statue** / Ağlayan Heykel | a god reaches Favour 3 | the shrine statue model + wax-drip particles, a dread flicker | its Rite is in your next paid Dawn offer | play safe: a missed Dawn has no offer |
| **The Sigil on the Reel** / Makaradaki Mühür | Well Favour 2+, once a Night | `single_light` floor event; the lit machine's screen shows the ring | that machine's HOT lamp is ×2 for 3 pulls | walk there now; it ends at 3 pulls or the Bell |
| **The Lights Die** / Işıklar Ölüyor | Dread "watched"+ **and** the bank is behind pace (N3+) | the director's blackout bursts, now zone by zone toward you | Ash is counting: on this pace a seal goes at Dawn | deposit what you have; with Ash Favour 2+ deposits in the dark get +10 % |
| **The Till Rings** / Kasa Çalıyor | Ledgers Favour 2+ (weight ×2) | the `cashier_bonus` floor event, the cashier bell rings by itself | deposits +10 % while it lasts | bank now |
| **The Late Reflection** / Geç Kalan Yansıma | Mirrors Favour 2+ and a `crooked_table` event starts | glass lag (JOKER's reflection lag) + the mannequins' `patronShift` | someone at a table is cheating right now | find the table and press [C] |
| **The 3:33 Call** / 03.33 Araması | as now (`hollow/rules.ts`, N2+) | the Hollow Door phone | the owners will sit with you once this run: a win forgives the quota, a right Mirror call returns a seal | answer it when a seal or the quota is at risk |

The random blackout is gone: a blackout now always means the Lights Die. Flicker stays cosmetic.

**Lines** (subtitle or banner; nobody explains the rule out loud, the HUD chip does):
| Omen | Who | EN | TR |
|---|---|---|---|
| Weeping Statue | banner | The statue is weeping. | Heykel ağlıyor. |
| Sigil | Loki | That ring's not a symbol, ortak. | O halka sembol değil, ortak. |
| Lights Die | Loki | Ash is counting. Bank something. | Kül sayıyor. Bir şey yatır. |
| Till Rings | Compere | The till rang by itself, friends! | Kasa kendi kendine çaldı, dostlar! |
| Late Reflection | Loki | Your glass is late. Somebody's cheating. | Camın gecikiyor. Biri hile yapıyor. |

Loki's omen lines are true, so none has "we" in it (his tell, §9).

---

## 4. Night gating

| Night | What is new |
|---|---|
| N1 | Three seals on the HUD. Nothing else. No Starter Draft, no offer. |
| N2 | **The beat** (below) and the first offer at the first Mola, then one every paid Dawn. Gods: Well, Ledgers, Ash. The Till Rings. The 3:33 Call (as now). |
| N3 | The Parlour opens (`parlourNight: 3`): shrine candles raise Favour. Loki's swap. The Sigil. The Lights Die. |
| N4 | The Lord of Mirrors joins (the poster Night, faces). The Late Reflection. |
| N5 | Duos. Rites from this Dawn on; the Weeping Statue. |
| N6 | Nothing new: the Collector's Night carries it. |
| N7 | The Audit: the Clerk reads your favours aloud (one line). |
| N8 | The Burning Wager is a clean wager: no boon applies at the Clerk's table. The last offer is N7's Dawn. |

**The N2 beat** (first Mola, at the bar; the back of the card shows four pressed sigils):
| Who | EN | TR |
|---|---|---|
| Selim | See the marks on your card? The owners. Old guests pray to them. | Kartındaki işaretleri gördün mü? Sahipler. Eski müşteriler onlara dua eder. |
| Selim | Pick one, kardeş. They keep count either way. | Birini seç, kardeş. Nasılsa sayıyorlar. |
| Loki (glass) | Gods? I sat with two of them. Lousy tippers. | Tanrı mı? İkisiyle oturdum. Bahşişleri berbat. |

**N7 (the Audit):** Clerk: "{n} owners were kind to you. Kindness is written down here too." / "{n} sahip size iyi davrandı. Burada iyilik de deftere yazılır." At 0: "No one was kind to you. Unusual." / "Kimse size iyi davranmadı. Alışılmadık."

---

## 5. Copy rules

- Short, spoken, concrete. A boon's card line is its effect in numbers ("+20 s every Watch"), never praise ("Embrace the flow of time").
- God names are titles, not chants. Nobody says "blessing" on the floor: guests say "favour", the Clerk says "debt".
- TR uses ı, İ, ğ, ş, ç, ö, ü; the Clerk and the Collector say "siz", Selim and Loki say "sen". The Mark stays silent.
- New keys live in `pantheon.strings.ts` (EN and TR in the same file, matched keys), the seal lines in `run.strings.ts`.

---

## 6. Implementation plan

Two lanes per wave at most. A lane owns its files; anything else is a request to the other lane. Every wave ends green on
`scripts/tests/index.js` (run by the integrator, not on this PC today).

**Wave A: seals as lives**
| Lane | Owns | Work |
|---|---|---|
| A1 run | `src/game/run.ts`, `src/game/luck.ts`, `src/core/events.ts`, `src/game/data/charms.ts`, `src/machines/tallytable/index.ts` | `dawn()`: short + seals ≥2 → take a seal, settle as paid, emit `quota:sealed`, skip tiers and offer; ≤1 → `fall()` as now. Keep `ledg_round` / `ash_overtime` branches behind boon checks (charm checks go). Delete `false_bottom`, `rope_ladder`, `blank_jackid` rows and the BLANK charm path in `loseMark()`. Soul Mark tier needs 2+. Luck −2 on `quota:sealed`. Test: `scripts/tests/seals.test.mjs` (two misses survive, third ends, restore caps at 3, save round-trip). |
| A2 face | `src/menu/hud.ts`, `src/game/run.strings.ts`, `src/game/story/index.ts`, `src/game/story/cutscenes/` | HUD seal strip (reuse `paintSeals` art). Receipt memory lines. Home miss with seals: knock + Collector line; last seal: `mafia_visit` as now. |

**Wave B: the owners**
| Lane | Owns | Work |
|---|---|---|
| B1 rules | `src/game/nightCards.ts` → `src/game/pantheon.ts` (+ `pantheon.strings.ts`), `src/game/run.ts`, `src/game/data/schedule.ts`, `src/game/luck.ts` | Offer of 3 (4 / pick 2 from tiers), run-long kept list, Favour, Rites, duos, Loki swap, House Director god weights, save migration (an old kept Night Card is dropped). Overshoot tier rewards per §2.1; remove the `overpays` queue. NEW readers: `x.luck.*`, `x.house.noticeOff`. Test: `pantheon.test.mjs` (seeded offer, distinct gods, gating by Night, payout cap). |
| B2 face | `src/game/nightCards.ui.ts` → `pantheon.ui.ts`, `nightCards.css`, `src/game/ingame/session.ts`, `src/game/draft*.ts/.css`, story N2 beat strings | Card turns over to three god cards (sigil, Favour pips, [R] swap). Mount in session; delete the Starter Draft files and their mount. N2 beat and N7 Clerk line. |

**Wave C: shrine and omens**
| Lane | Owns | Work |
|---|---|---|
| C1 shrine | `src/machines/shrine/*`, `src/game/data/buffs.ts` | Candle → pick a statue → Favour +1. Delete the 4 blessing and 4 curse buffs, `votive_candle`, the 70/30 roll. Weeping wax on Favour 3. |
| C2 omens | `src/game/horror/director.ts`, `src/game/watchEvents.ts`, `src/game/events/crookedTable.ts`, `src/game/duels/engine.ts`, `src/game/home/phone.ts` | Blackout only as the Lights Die; Sigil via `single_light`; Till Rings weight; Late Reflection on `crooked_table` start. NEW readers `x.crooked.starAdd`, `x.duel.tellEarly`, Borrowed Face. Calm mode = visual only. |

**Wave D: merge and balance**
| Lane | Owns | Work |
|---|---|---|
| D1 balance | `src/game/houseMood.ts`, `src/game/data/schedule.ts` (favour column), `scripts/sim/*` | Fold House Favour into House Mood (one curve, same totals). Headless sims: best boon build stays under the payout cap; a no-boon run still clears N8 at the current rate. |
| D2 docs | `docs/HOUSE_DIRECTOR.md`, `docs/STORY_BIBLE.md`, `docs/ASSETS.md` | Night Card table → god weights; §4 lines for N2/N7; statue and sigil assets. |

**Cut list.**
| Delete | Replaced by |
|---|---|
| `src/game/draft.ts`, `draft.ui.ts`, `draft.css`, `draft.strings.ts` | the first offer on N2 |
| Night Card data rows (10) and the 2-card panel | boon rows; the panel becomes the 3-card offer |
| Overpay charm picks (`overpays`, `pickOverpay`, `OVERPAY_TIMEOUT_SEC` and their UI) | 4 cards / pick 2 / a Rite |
| Shrine blessings and curses (8 buffs), the 70/30 roll, `votive_candle` | Favour |
| `false_bottom`, `rope_ladder`, `blank_jackid` | `ledg_round`, `ash_overtime`, the seal rule |
| The random blackout | the Lights Die |
| House Favour (`nightDef().favour`) | House Mood |

**Kept untouched:** the Pawn and its charms, stamps, machine mods, tonics, food, keepsakes, bonds, the boss Pledge charm.

---

## 7. Open questions for the client

1. **Two free misses, or one?** Three seals means the third miss ends the run. If that feels soft, start the card at 2 seals and let HOUSE ENVY or the Mirrors' Rite add the third.
2. **Night 1 without a pick.** Cutting the Starter Draft makes N1 plainer (only the seals are new). Is that fine, or should the first offer come at N1's Dawn instead of N2's first Mola?
3. **Should Loki's boons cost madness?** Today they cost Dread. Once the Joker's Ink ships, should they cost Ink (lasting until you sleep) instead?

**Client answers (2026-10-19):**
1. Three seals (two free misses).
2. The first boon offer comes at Night 1's Dawn, after a paid Night 1.
3. Loki's boons cost madness (the Joker's Ink) once that system ships; until then they cost Dread.
