# Wave 24 plan: Mahjong, special rooms, lore

Director-approved.

## Findings

These shape the rest of the plan:

- **Wings can never open in a run.**
  - `WING_DEFS` in `data/upgrades.ts` uses the zones `tables/arcade/lottery/parlour/services`.
  - The layout uses `midway/cards/laundry/boiler/gallery/wheels/parlour/counting`, so only `parlour` matches.
  - Nothing calls `tycoon.unlockZone`, and nothing grants Wing Keys.
- **Zone-scoped mods already exist.** `ModEffect.scope.zones` (`modifiers.types.ts`) lets each room rule be plain data.
- **Mira and Vell are different people.** Mira is a guest who became a still one. Vell is the one who descends (the tape spine).

## 1. Mahjong: "Little Wall" (`mahjong`)

Name: "Mahjong: Little Wall" (TR: "Mahjong: Küçük Duvar").

**Format**
- Solo game on `MachineBase`, like `hilo`.
- A 1-player draw-and-discard hand against the wall.
- About 25 s per round.

**Tiles**
- 120 tiles.
- Three suits, 1–9, four copies of each:
  - COINS (discs)
  - STICKS (bars)
  - MARKS (numeral glyphs)
- Dragons: RED, GREEN and WHITE, four copies each.
- Each suit has its own colour and shape.
- Drawn in `src/machines/mahjong/tiles.ts`, following `bigone/symbols.ts`.

**Rules**
1. Pay the stake S. The whole wall is shuffled from the seed each round, with a fixed draw count.
2. The player gets 7 face-up tiles and 6 turns (shown as brass beads).
3. Each turn the House flips an UPCARD. The player either:
   - TAKEs it, or
   - DRAWs the next unseen tile, and the upcard dies.
4. Then the player DISCARDs one tile.
5. Any 8-tile hand of 2 melds plus a pair is a MAHJONG and wins automatically.
   - A meld is a triplet, or a run of 3 in one suit with no wraparound. Dragons can only form triplets.
6. If the hand is not a win after turn 6 but is one tile from winning (Near Hand, waits glow), it pays ×0.4.

**Pays**

| Win on turn | Pays |
|---|---|
| 1–3 | ×12 |
| 4 | ×8 |
| 5 | ×5 |
| 6 | ×3 |

These bonuses stack on a win, capped at ×60 (`maxPayoutMult`):
- Pure suit: ×2.5
- Dragon triplet: ×1.5
- All triplets: ×1.5
- All runs: ×1.3

**RTP**

| Bot | RTP |
|---|---|
| Greedy (takes the upcard only if it beats its own draw heuristic) | ~0.945, win rate 10% |
| Always draw | 0.46 |
| Always take | 0.30 |

- The game ships a first-sit hint ring that marks the suggested discard and the waits. H toggles it.
- `playHeadless` uses the greedy bot.
- Tests assert each bot's RTP stays in band.

**Betting and controls**
- Bet: 5, 10, 25, 50 or 100.
- Controls:
  - ←/→: move the cursor
  - T: take
  - D: draw
  - Space: discard
  - Z/X: change the bet
  - H: hint

**Seat view**
- A low lacquered table.
- The rack sits in the lower third, the upcard in the centre under a lamp.
- The wall is shown and shrinks as tiles are drawn. Beads sit on the top rail.
- Winning tiles glow green and lay flat, with a coin pour (`juice` tiers).

**Wiring**
- `SUIT_OF.mahjong = 'CARDS'`.
- Tags: `['solo','tiles','skill']`.
- Tier 2, slot M.
- Hooks:
  - `m.mahjong.turnsAdd`
  - `m.mahjong.peek`
  - `m.mahjong.nearPay`
- Add it to `FLOOR_READY` only after the bench seat-view screenshot passes.

## 2. Special rooms and the Keyring

### Keyring (ship first)
1. Rewrite `WING_DEFS` to the real zones: `midway, cards, laundry, boiler, gallery, wheels`.
   - `parlour` opens automatically after Night 3 is paid.
   - `counting` is separate.
2. `run.wingKeys`:
   - +1 at each Dawn on Nights 1–6.
   - +1 for beating the boss on Night 3, 6 or 8.
3. Pressing E on a closed grille offers two choices:
   - "Spend KEY (n)"
   - "BUY 1.5×quota"
   - Both go through the networked `{op:'zone'}` request with an optional `key:true` flag.
4. Other ways in:
   - Hotline "Locksmith" deal: opens a wing now for +15 Dread.
   - The `house_keys` charm.
   - The Manager's Key, which only opens the Counting Room and drops from the Night 6 boss.
5. Tease for closed wings:
   - Each grille gets a brass plate showing the wing name and "SEALED", or "KEY READY" with an amber padlock.
   - The room's marquee blinks behind the bars.
   - A music-box cue and a toast point the player to the nearest grille.

### Rooms
Each room has one zone-scoped buff plus a package of props, a vendor and lore.

| Room (zone) | Opens by | Contents | Look | Rule / risk |
|---|---|---|---|---|
| Jade Room (`cards`) | Key; meant to be the first room | Mahjong ×2 (CARD-01, CARD-06), baccarat, cardwar, videopoker. Old Lin the Tile Reader: reuses `charm_vendor` with a CARDS/Mahjong pool filter in `shop.ts`. | Jade lacquer, paper lanterns, tile-wall frieze, green fog | CARDS pay ×1.10, but max bet ×0.7. Lin sells a wall-peek for the Watch for 1 Ticket. |
| The Wash (`laundry`) | Key | bingo, keno, pachinko, coinpusher; 12 numbered lockers | White tile, drum washers, drains | Opening a locker costs 1 Ticket and gives a seeded result: a note, a charm, coins, or "a blank JackID" (cursed, pays Obols). More than 3 lockers in a Night triggers a Dread beat. |
| The Boiler (`boiler`) | Key, or the Hotline "Stoker" deal | craps, sicbo, dicetower, teetotum; Pressure gauge | Rust, steam, grate floor | Pressure P rises with each pull in the room; payouts ×(1+P/100), up to ×2. At P 100 the room blows and locks for the Watch. The Vent lever resets P and costs 1 pull. |
| The Parlour (existing) | Automatically after Night 3 | Devil's Table, shell game, shrine; the Collector's Chair (Nights 3–7) | One bulb, haze | The Collector buys a charm for Obols at 2× its sell value. He asks one question (reuses `story.pick`); a wrong answer costs 1 Ticket. |
| Counting Room (`counting`) | Manager's Key, or Foundations F6 | Ledger Wall (tape replay), Furnace prop, Back Office (3 Tickets → 1 Obol) | Ledgers, abacus wall, candles | Night 7, Watch 2 brings The Audit: the Clerk taxes your largest holding. It rewards the truth tapes and the void-ending path. |

`midway`, `gallery` and `wheels` open with a Key and keep their normal contents. They only get the tease plate.

## 3. Lore

### Backstory
- **The Well.** Coins thrown into a wishing well kept the wishes. The House is how the Well collects.
- **Your JackID.** It is the receipt for a wish the Well granted: your jackpot. The debt is the price of that wish.
- **The Collector.** He paid in full and rode the lift up. Nobody was waiting, so he came back for what did wait. He holds the Manager's Key.
- **The Clerk** (new). The first card ever printed: a blank-faced mannequin who audits.
- **The Pit.** The Sump lies under the Pit, and the counting happens there.
- **The mannequins.** They are guests whose names became currency.
- **Mira.** A guest who is now still.
- **Vell.** A guest who descended to follow the coins.

### Night arc

| Night | What happens |
|---|---|
| N1 | Orientation note n27, the first Key, the grille tease. |
| N2 | Mira's wrong-number call (reuses `speaker.mira`). First Jade note. |
| N3 | Boss; the Parlour opens; the Collector's Chair appears; ledger page 2. |
| N4 | Vell's tape in the Wash; the lockers. |
| N5 | Mira's second call: "the Clerk is counting". The Boiler's pipes run to the Well. |
| N6 | Boss; the Manager's Key drops; first sight of the Clerk. |
| N7 | The Audit; the Counting Room truth (n25); ledger page 3. |
| N8 | Final Note: the lift choice. The void ending is foreshadowed by n26. |

- Story beats fire through hooks in `story/index.ts`.
- Three new cutscenes play once each: `wing_key`, `locker` and `audit`.

### New notes (n15–n28)
- Add a `zone?` or `night?` gate. `placeNotes` skips notes whose room is closed.
- Text: [EN / TR]

| Note | Room | Text |
|---|---|---|
| n15 | Jade | Four of every tile in the wall. The House keeps a fifth in the drawer. It never needs to play it. / Duvarda her taştan dört var. Kasa beşincisini çekmecede tutar. Oynamaya hiç gerek duymaz. |
| n16 | Jade | Old Lin reads hands for a ticket. She quit reading faces after Night 4. "Same face every time." / Yaşlı Lin bir bilete el okur. 4. Geceden sonra yüz okumayı bıraktı. "Hep aynı yüz." |
| n17 | Wash | Coat, one shoe, a lighter that works. Unclaimed in thirty days, the owner is kept too. / Palto, tek ayakkabı, çalışan bir çakmak. Otuz günde alınmazsa sahibi de saklanır. |
| n18 | Wash, Mira | They took my name. They left my handwriting. I write small, where the Clerk won't look. / Adımı aldılar, yazımı bıraktılar. Küçük yazıyorum, Katip'in bakmadığı yere. |
| n19 | Wash | Found in the drum, still warm: a winning ticket issued to nobody. Do not cash it. It cashes you. / Tamburda, hâlâ sıcak: kimseye kesilmemiş kazanan bilet. Bozdurmayın. O sizi bozdurur. |
| n20 | Boiler | PRESSURE 96. Vell always vented at 99. "The House respects a flinch. Not a greed." / BASINÇ 96. Vell hep 99'da boşalttı. "Kasa ürkeni sayar. Açgözlüyü değil." |
| n21 | Boiler | Every pipe in the Boiler runs toward the Well. Something down there is being kept warm. / Kazan'daki her boru Kuyu'ya gidiyor. Aşağıdaki bir şey sıcak tutuluyor. |
| n22 | Parlour | A guest paid and wept. I wrote "Paid." Why is not a column. / Bir misafir ödedi ve ağladı. "Ödendi" yazdım. Neden diye bir sütun yok. |
| n23 | Parlour | I rode the lift. Daylight was as promised. Nobody waited. I came back for what did. / Asansöre bindim. Gün ışığı sözdeki gibiydi. Kimse beklemiyordu. Beni bekleyene döndüm. |
| n24 | Counting | The Clerk is not a guest. The Clerk is the first card ever printed. Do not ask what it says. / Katip misafir değildir. Katip basılan ilk karttır. Üzerinde ne yazdığını sormayın. |
| n25 | Counting, Vell | Every coin in the Well is a wish someone paid for. Your jackpot was one. The card is the receipt. The House is how the Well collects. / Kuyu'daki her bozuk para birinin bedelini ödediği bir dilek. Jackpotun da biriydi. Kart makbuz. Kasa, Kuyu'nun tahsil etme biçimi. |
| n26 | Counting | BURNED THIS YEAR: 0. Not for lack of wanting. Nobody arrives with the card still in hand. / BU YIL YAKILAN: 0. İstek yokluğundan değil. Kimse kartı elinde tutarak buraya varamıyor. |
| n27 | Mouth | You will feel lucky. This is the first symptom. / Şanslı hissedeceksiniz. Bu ilk belirtidir. |
| n28 | Sump | Throw one coin back. Wish for something you can afford. It is the only rule that works. / Bir bozuk parayı geri atın. Karşılayabileceğiniz bir şey dileyin. İşe yarayan tek kural bu. |

## Lanes

Each lane owns its files exclusively.

| Lane | Owns | Depends on |
|---|---|---|
| A, Mahjong | `src/machines/mahjong/**` and its test | Nothing |
| B, Rooms + Keyring | `src/game/rooms*.ts`, `src/game/data/rooms.ts`, `WING_DEFS`, `doZone` key flag | Integrator state |
| C, World | `src/world/**`: plates, padlock, lockers, gauge, chair, furnace, dressing, lights, note anchors | B's key flag |
| D, Lore | `src/game/story/**` (notes, strings, 3 cutscenes); Mira call data in the hotline data and strings | C's anchors |
| E, Integrator (runs last) | The only lane that edits `run.ts`, `types.ts`, `save.ts`, `protocol.ts`, `tycoon.types.ts`, `layout.ts` (`FLOOR_READY`/`CARD-01`), `suits.ts` and the tests index | Everything above |

Every lane must pass the final gate:
- `npm run typecheck`
- `npm test`
- `npm run check`
- `npm run build`
- Bench screenshots: one for Mahjong, one for each opened room.
