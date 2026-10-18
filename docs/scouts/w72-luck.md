**Scope:** read-only study. I read `docs/DESIGN_PILLARS.md` in full and grepped `HANDOFF.md`, `ART_BIBLE.md` and `scripts/qa/README.md` for luck. I did not run any sims or bench runs, so every RTP number below is a plan to verify, not a result.

## 1. Current luck: 12+ sources, 18+ readers, no visible readout

**Sources (all add to the one `luck` hook):**
- Hook and clamp: `src/game/modifiers.types.ts:31`, clamp `def 0, -30..30` at `:79`.
- Base read: `src/game/run.ts:1385`, `src/machines/_base/MachineBase.ts:637`.
- Buffs: `src/game/data/buffs.ts:33` (Lucky Mint +2), `:45` (Cursed Candy +6 with dread), `:78-86` (Blessed +2 via the charm budget, Restless −1), `:111` (Friendly Glow), `:142` (Lucky Moon +3).
- Hotline: `src/game/hotline.ts:174-176` (+3 for a shift), `:341`.
- Items: `src/game/items/data.ts:22-24` (Lucky Idol +1 in a ring).
- Charms: `src/game/data/charms.ts:26-45` (`CHARM_LUCK_CAP`, `luckFx`), with luck on Bent Nail `:95`, Metronome `:103`, Brass Plaque `:145`, Glass Heart `:175`, and Votive Candle `:113`.
- Machine mod: `src/game/machineMods.ts:7` (Lucky Latch +2, max bet ×0.8).
- Tycoon: `src/game/data/upgrades.ts:133-139` (per-machine luck track, 10 levels), `:219` (imp_lucky_draught, +1 per level).
- Meta: `src/game/data/upgrades.ts:338` (Foundations H1, +1 per level, `requires bestShift:2`).

**Readers, and the unit each one uses:**
- `bandit/rules.ts:33,181-182`: nudge chance 0.4 % per point, cap 4 %.
- `bigone/rules.ts:470-471`: coalesce 1 % per point, cap 30 %.
- `elevator/rules.ts:63`: refund 1 % per point, capped.
- `dicetower/rules.ts:129`: 1 % per point, capped.
- `teetotum/rules.ts:207-209`: luck/100.
- `videopoker/rules.ts:144-145`, `claw/rules.ts:119-120`: second look and strong drop, each with its own step and cap.
- `baccarat/rules.ts:187-199`, `bigsix/index.ts:295`, `roulette/index.ts:359`, `fantan/index.ts:339`, `craps/index.ts:407`, `cardwar/index.ts:334`, `bingo/index.ts:228`: solo-only reroll with p = luck/100. Multiplayer gets zero.
- Also read by `pachislot`, `cyclone`, `mines`, `scratch`, `stacker`, `lootbox`, `keno`, `hilo`, `fortuneteller`, `shellgame`, `tombola`, `coinflip`, and `coinpusher`.
- `horror/director.ts:30-31,219`: whispers at luck ≤ −3.

**Problems:**
- No luck readout was found in `src/game/ingame` or `src/core/ui`. The player cannot see their luck.
- One point means a different thing on every machine (0.4 %, 1 %, a 1 % reroll on losing spins, and so on).
- Luck sits on at least 13 unrelated systems. Pillar 7 (`DESIGN_PILLARS.md:33-35`) asks to extend, not add. Pillar 3 and "Not allowed" (`:37`) rule out a luck card that no one gave you.

## 2. Proposal: ŞANS, one meter, 0-10 stars

**Storage and hook.** Add `run.luckStars` (0..10). `run.luck()` (`run.ts:1385`) returns it as the base of the existing `luck` hook. Set the hook clamp in `modifiers.types.ts:79` to `0..10`. Keep `MachineBase.luck()` unchanged. The meter becomes the only source of the `luck` value.

**Persistence.**
- Run scope: stars carry across Nights and Watches within a run. Reset on a new run.
- Meta: Foundations H1 (`upgrades.ts:338`) changes to "starting ŞANS +1 per level, max 3".

**Earned and lost, each tied to home, play or story:**
- Gain +1 (max one per Night): quota met before last call (play); a good dream at Dawn (home, Harmony ≥ 4); a story beat (about three per run).
- Lose −1 (max one per Night): the quota missed or the mob visits; a knock taken by the Leaner or Picker (`home/knock.ts:93`); a restless dream.
- Cut the stacking consumables and the multiplayer friend bonus. Turn Cursed Candy into +2 stars with its dread cost. Hotline deal = +1 star.

**Per-machine readout.** Each star means one notch on each machine's own second-chance event. Each reader defines one notch and a ceiling at 10 stars. The existing caps in `CHARM_LUCK_CAP` (`charms.ts:30-35`) become the ceiling. A uniform percent is not possible without rewriting each reader.

**Remove.** All luck from charms (`luckFx`), Lucky Idol, Lucky Latch (keep its max-bet trade), Friendly Glow, Lucky Moon (keep payouts, drop luck), the tycoon luck track, imp_lucky_draught, and the Blessed and Restless buffs. Keep the Cold dread-linked buffs.

**HUD.** Show ŞANS as 10 pips on the Evening HUD card (per commit `3af3bff`) and on the floor HUD next to Heat.

**Solo-only rule.** Keep the existing rule: luck only applies in solo. Multiplayer tables pay no luck, as they do now.

## 3. RTP safety plan

1. **Per-machine balance.** For every kept machine, run headless at minBet with 5e5–1e6 rounds each at stars 0, 2, 5 and 10. Use `scripts/sim-profiles.mjs` and the 200k-play method in `data/machineProfiles.ts:2`. Gate: RTP(10) ≤ 98.5 %, RTP(0) unchanged from baseline, monotone in stars.
2. **Tests.** Add to `scripts/tests/charmReaders.test.mjs` and `machineMods.test.mjs`: each reader is monotone and clamped at 10. Add a regression: charms and consumables never add to the `luck` hook.
3. **Run-level check.** `scripts/sim/run.mjs` with the meter starting at 0 and the typical gain rates. Baseline reach from the file header (human, 2000 runs, seed 20261013): 94 / 82 / 60 / 44 / 37 / 28 / 24 / 16 %. Keep the new curve within about 5 points, or tune gains.
4. **Risk.** Reroll readers (solo baccarat, bigsix, roulette, fantan, craps) at 10 stars reroll up to 10 % of losing rounds. Those need the largest RTP budget. Cap them lower in the reader if the sim fails.

## 4. Open decisions for the director

- Pillar 7 requires sign-off for any new meter. ŞANS reuses the existing `luck` hook, but it is still a new visible meter.
- The kept roster is not yet fixed. Any machine with `CHARM_LUCK_CAP` 0 (bigone, baccarat, craps, roulette, and others) gets no meter effect unless its reader is added.