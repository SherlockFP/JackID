# Wave 8 plan: engines, a real shop, boss Nights and visible odds

Director-approved. It comes from genre research on Balatro, CloverPit, Luck be a Landlord, Peglin, Slay the Spire and Buckshot Roulette.

The principles behind it:
- A charm has one effect and at most one condition, and its power is conditional.
- Scaling charms are capped.
- The shop must reliably supply builds.
- Boss restrictions force the player to rethink.
- The odds of reaching the quota are visible.
- Every run should feel different.

## Blockers found in the code (fix first)

- **Suit-scoped charms mostly never fire.** `run.ts` passes `def.tags` into `scopeMatches`, but machines don't carry suit tags. Only bandit has `'reels'`, and roulette has `'wheel'` instead of `'wheels'`.
- **The Pawn Window is not wired.**
  - `charm_vendor` reads `run.pawn` through `Reflect.get`, but nothing defines it.
  - `pawnOffers()` recomputes stock on every call, so buying reshuffles the other slots.
  - There is no lock.
- **Random lineups and kits do nothing.** `RunConfig.randomLineup` is never read, and kits exist only in GDD §11.4.

## Items

### 1. Suit table (S)
- Add `src/game/suits.ts` with `SUIT_OF` (from GDD §3.4.1), `suitOf()` and `suitMachines()`.
- At `run.ts` (scope tags) and `benchRun.ts`, append `suitOf(id)` to the scope tags: `tags: [...def.tags, suitOf(id)]`.
- Test that every gambling machine has exactly one suit.

### 2. Pawn Window (M)
- Add `src/game/shop.ts`, a `Pawn` class exposed as `run.pawn`.
- Stock is generated once per intermission with the stream `pawn:${index}:${watch}`.
- Rerolls replace only slots that are unlocked and unsold. Buying never reshuffles.
- Stock persists in the save.
- Locking a slot costs 1 Ticket and the lock carries over.
- Reroll costs 1 Ticket, then 1 more each time. Free rerolls are used first.
- From Night 2 there is an under-the-counter slot: 50% Rare/Legendary, 50% Cursed.
- Tests:
  - buying doesn't reshuffle
  - the lock persists
  - stock is deterministic per seed

### 3. Ten engine charms (M)
Charm data goes in `src/game/data/charmsEngines.ts`; behaviours go in `src/game/charms/engines.ts`. Both are merged in with a spread, and every id is added to `LAUNCH_CHARM_IDS`.

Engine changes:
- Change the type to `DynamicEffects(live, q?)`.
- `win()` passes `q.ctx.betFrac`.
- M effects use the op `'mult'`; A effects use `'inc'`.

| id | Name (EN / TR) | Rarity, price, unlock | Effect | Max |
|---|---|---|---|---|
| `suit_ladder` | Suit Ladder / Takım Merdiveni | R, 42, N3 | A play on a different suit than the last one gives +1 Rung (max 6). Wins pay ×(1+0.12·rungs). Two plays in a row on the same suit cost 3 Rungs. | ×1.72 |
| `pressure_valve` | Pressure Valve / Basınç Valfi | U, 20, N2 | A loss stores +1 Pressure (max 8). The next win pays ×(1+0.10·P), then Pressure resets. | ×1.8 |
| `capacitor` | Capacitor / Kondansatör | R, 42, N4 | A play on a Cold or tilted machine adds +1 charge (max 6). The next win on a Hot machine pays ×(1+0.25·c), then charge resets. | ×2.5 |
| `lampwick` | Lampwick / Kandil Fitili | U, 22, N3 | Each win on a Hot machine adds +1 wick (max 6, until Dawn). Each wick adds +0.08 to `x.lamp.hotMult`. | — |
| `ticket_press` | Ticket Press / Bilet Presi | U, 18, N2 | A win of ×5 or more gives +1 Ticket. Payouts get +2% per 3 Tickets held. | +20% |
| `last_gasp` | Last Gasp / Son Nefes | R, 40, N3 | During the last Watch's Last Call, while the quota is unmet: ×1.4. | — |
| `understudy` | The Understudy / Dublör | L, 95, N5 | Copies the effects of your most expensive charm that is not Legendary and not Cursed. Does not copy `on` triggers. | — |
| `false_ceiling` | False Ceiling / Sahte Tavan | L, 100, N6 | `x.house.limitMult` ×2.4 (House Limit goes from 5× to 12× the quota) and Dread +10. Needs a new reader in `win()`. | — |
| `gilded_chip` | Gilded Chip / Yaldızlı Fiş | U, 20, N2 | At max bet: ×1.25. Below half of max bet: ×0.9. | — |
| `snowball_ledger` | Snowball Ledger / Kartopu Defteri | U, 20, N2 | Each Watch settled with at least 25% of the quota deposited adds +1% interest (max +3%, resets at Dawn). | — |

Each charm is tagged with one of these archetypes:
- rotation
- hot
- clutch
- banker
- whale
- copycat

Tests: assert each charm's maximum multiplier.

### 4. Boss Nights (M)
- Bosses are `NightEventDef` entries with `duration: 'shift'` and `exclusive: 'boss'`.
- They appear on Nights 3, 6 and 8. On those Nights the chance of random events is 0.
- The boss is picked by seed.
- The boss MUST trigger before `startWatch()` reads the clock and pull mods.
- It is announced on the previous Dawn card.
- The reward is a choice of 1 of 3 Rare charms, plus 3 Tickets.

| Boss (EN / TR) | Effect | Nights |
|---|---|---|
| Embargo / Ambargo | The embargoed suit ×0.4, the others ×1.15 | N3, N6 |
| Pennies / Bozukluk Gecesi | Max bet ×0.35, +3 pulls | N3 |
| Frozen Ledger / Donmuş Defter | Interest −1, payouts +0.25 | N3 |
| Short Fuse / Kısa Fitil | Clock −45 s, payouts ×1.35 | N6 |
| Lamp Night / Lamba Gecesi | +2 Cold lamps, +1 Hot lamp, Hot multiplier 2.0 | N6 |
| Glass Night / Cam Gece | Payouts ×1.3, bet cost ×1.3, tilt grace −2 | N8 |

### 5. Tell Sheet: odds visibility (M)
- `scripts/sim-profiles.mjs` runs each machine headless 200,000 times and writes `src/game/data/machineProfiles.ts`. For each machine it records:
  - hit rate
  - P(≥×2), P(≥×5), P(≥×10), P(≥×25), P(≥×100)
  - σ
  - RTP
  - class: STEADY, SWINGY or WILD
- `src/game/pace.ts` (pure) computes need = (due − paid − pocket) / pullsLeft.
- The quota board shows `NEED x / PULL · n PULLS`.
- The seat HUD shows `HIT 1 in 3.1 · ×10+ 1 in 24 · SWINGY · NEED ×6 → 1 in 14`.

### 6. Starting kits (M)
- Data goes in `src/game/data/kits.ts`. Add `RunConfig.kit`.
- Kits are unlocked with Obols: Pauper is free, then 30 / 60 / 60 / 90 / 120.
- The kit picker lives in `src/menu/kitPicker.ts`.

| Kit | Start |
|---|---|
| Pauper | 50¢, 2 Tickets |
| Rotator | 35¢, Suit Ladder |
| Hot Hand | 40¢, Lampwick and Cold Hands |
| Clutch | 30¢, Last Gasp and Night Owl |
| Banker | 20¢, 40¢ pre-deposited, Piggy Tooth and Wax Seal |
| Heir | 200¢, Glass Heart (cursed) |

### 7. Shop decisions (M, after item 2)
- **Shelf bias:** one slot gets ×3 weight toward the archetype or suit you hold most. Add a `bias` option to `rollPawnWindow`.
- **FIT badge:** shows `FIT n`, plus a payout preview for your most-played machine, e.g. "×1.62 → ×1.88".
- **Swap when pegs are full:** if all pegs are full, buying asks which charm to replace. The replaced charm sells back for 50%.

### 8. Pit Deck (M)
- `rosterFor(seed)` in `world/layout.ts` reassigns the flexible pads `WELL-04, 06, 07, 08, 09, 11, 13` and `LOB-01`, using tier-1 solo machines that pass `fits()`.
- These stay fixed: `bigone`, `roulette`, `blackjack`, `coinflip`, the vendors and the terminals.
- At least 4 of the 6 suits must be present, plus one steady machine and one wild machine.
- `session.ts` passes `assign` when `randomLineup` is set. `randomLineup` defaults to true for runs.

### 9. Engine juice (S/M)
- `charm:proc` carries `{tier, label}`.
- Each proc plays a rising-pitch tick (1 + 0.06·tier) and shows gold pop text such as "×1.48".
- `CharmDef.badge(data)` shows a live counter on the HUD icon.
