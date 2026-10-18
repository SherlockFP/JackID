**Verdict:** The four studies together are too big for "keep it simple." Each one is reasonable alone, but they change the same things (CORE_PLAN, the luck hook, the lights, the NPC material), and two of them rest on wrong facts. Ship them in this order: roster cut, re-sim, lights, one NPC look, then luck. I checked the code and docs cited below. I did not open the screenshots or run any sims.

**Cross-study conflicts**
1. **Sequencing.** The luck study's RTP gate is "RTP(0) unchanged from baseline," but HANDOFF.md:152-153 says the Big One and stacker re-sims are still open, and claw and lootbox are off-spec. The baseline is not clean yet. Re-sim the cut roster first, then measure luck against that baseline.
2. **Roster vs map.** The map refit puts the Big One hub on roulette, blackjack, plinko and coinflip, and the bench `goto:` seeds use scratch, which the roster cuts. Decide the roster before any layout work.
3. **Map darkness vs NPC black.** The map study's own shots (boiler, parlour, sump) are near-black. A near-black NPC on a near-black floor will vanish. Fix the lights before the NPC look.
4. **Client wording.** The client asked for "a black, dark shader." The NPC study adds cyan, violet, red and amber classes, which is a second design system.

**Roster study**
- Claw is cited as "≤105% expert" from HANDOFF #7. HANDOFF.md:152 says ~110–130%. The cut still holds, but fix the citation.
- Cutting pachinko conflicts with DESIGN_PILLARS.md:33, which names pachinko and plinko as the bounce-combo pair. Either cut it and change that pillar line (director call), or keep it.
- `progression.ts:54-57`: removing scratch leaves 3 starters, and 9 non-starters over Nights 2–7 at PER_NIGHT=2 leaves gaps. The comment on line 56 becomes wrong. Expect uneven nights.
- Recommended: remove machines from CORE_PLAN and FLOOR_READY only, and do not delete code. This keeps the `world.test.mjs:409-412` roster counts stable where possible.
- Target about 10–11 games: bigone, coinflip, hilo, videopoker, mines, plinko, roulette, blackjack, sonkart, keno. Mahjong has the hardest rules and goes first. Craps is the one `progression.ts:40-41` calls least readable, so ask the client about it.

**NPC study**
- Keep: a near-black diffuse, one rim (banded), and eyes.
- Cut: per-class colours, shimmer, jitter, and the feet-band Bayer fringe. Shimmer and jitter are scare effects, which pillar 5 and calm mode then have to police. The fringe adds dither complexity for no reading gain.
- Props are a gap. The Collector's coat, masks and hats use `makeProp` materials and stay coloured unless routed through the same look. "All NPCs" needs an explicit prop list.
- Exempt remote player avatars (`src/player/avatars.ts:108`). They are people, not NPCs.
- Spouse warmth is a story call. Pillar 2 wants the family to be warm, so ask the director before darkening her.
- The ART_BIBLE drift (`docs/ART_BIBLE.md:78`, `:268-300`) must be fixed before the lane starts.
- Performance is unmeasured (HANDOFF §10.4). Measure before and after.

**Map study**
- Agree with the refit (Option A) and against a rebuild. A rebuild is large and the client's "progress with what we have" argues against it.
- Lights first. They are the cheapest fix for the dark wings the shots show. Add the neon signs and the light path afterward.
- 98 slots for about 12 machines leaves about 86 "OPENS NIGHT" plates. That is the dead floor. Hide unopened pads instead of renaming them. Keep the slot ids, because anchors and tests depend on them.
- Lobby, gallery, wheels and counting were never captured. Take those shots before deciding.

**Luck study**
- Error: "bigone gets no meter effect because CHARM_LUCK_CAP is 0." That cap only limits charm contributions (`charms.ts:30-40`). The bigone reader reads `s.luck` directly (`bigone/rules.ts:470-471`), so it would respond to the meter.
- Error: the reader list omits plinko and blackjack, which both read luck (`plinko/rules.ts`, `blackjack/rules.ts`). Sonkart reads none, so the meter would do nothing there.
- Conflict: a 0..10 clamp removes negative luck. The horror director whispers at luck ≤ −3 (`horror/director.ts:220`). Either make the meter signed (about −3..+5, which fits pillar 2's "a bad night makes it colder"), or rewire the whispers to Heat or bad-run.
- Complexity: "one notch on each machine's own second-chance" is 13 different units. Instead, use one shared rule for the kept machines, for example one star = +N% on one second-chance roll, with a low cap. That is simpler and easier to sim.
- Save: `run.luck()` becomes a new run field. The study does not mention a save migration or a reset.
- Pillar 7 needs director sign-off for a new meter. The study says so; keep that gate.

**Corrected recommendations**
1. Roster: cut to about 10–11 games in CORE_PLAN and FLOOR_READY, then re-sim. Director decides craps and mahjong.
2. Map: refit only. Lights in the four story areas first, then hide unopened pads.
3. NPC: one near-black look, with rim and eyes, routed through props and avatars exempted. No classes, no shimmer, no jitter.
4. Luck: defer until after the re-sim. Then a single signed meter feeding the kept readers, with the whispers rewired or the meter signed.

**Not verified:** screenshots, sim numbers, the 98.5% RTP gate, the claim that props are uncovered, and the `psxMaterial.ts` clone path.