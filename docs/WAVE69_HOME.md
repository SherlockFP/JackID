# Wave 69: THE EVENING, part 1 (Home layer foundation)

Director spec, 2026-10-15. Read `docs/DESIGN_PILLARS.md` first.
The contract is `src/game/home/contract.ts` (types, anchors, events, sound names). Code against it. Do not change it without
director sign-off: lanes build in parallel against it.

## Player-facing loop
1. A Night is paid at Dawn. The Night Card pick and the Mola (Pawn window) run as now.
2. The intermission lever now reads **TAKE THE LIFT / ASANSÖRE BİN** (solo debt runs only).
   - Pressing it starts stage `ride`: input locks, the screen fades to dark (`app.ui.fade`), `liftDing` plays, and the player
     teleports to `home.spawn`. The screen fades back in and stage `evening` begins.
     (Since the street walk: the ride lasts `HOME_TIMING.ride` = 4.6 s and shows the car, the same beats as the ride down: dark, the
     teleport into the car, the floor dial rising B7 to G, the arrival ding, then out at the casino's street door.)
   - Online runs and Night 8 topside keep the old lever (`openFloor`).
3. **The Evening** is a free walk in the apartment with these stations, each an E prompt that emits `home:interact`:
   - **bed**: sleep. Stage `sleep`: fade out, `bedCreak`, then `run.openFloor()` opens the next Night. The player teleports
     back to the casino floor (the intermission spawn / the `elevator.door` anchor) and the screen fades in. The Night
     banner shows as today.
   - **spouse**: talk. Lines come from `phone.talk()` and print typewriter-style, with the existing blip voice and a new
     speaker id `spouse`.
   - **phone** (the wall phone): opens the phone UI on the home threads. The phone UI itself listens for this station; the
     flow does not handle it.
   - **switch**: toggles the ceiling light (`lightSwitch`).
   - **chain**: toggles the door chain (`chainRattle`).
   - **peephole**: a short look through the door (camera to `home.peephole`, a narrow fisheye vignette, 2 s). In wave 69 the
     hall is empty. Wave 70 adds visitors.
   - **door**: closed in wave 69; the prompt reads "Locked for the night".
   - Auto-sleep after 120 sim-seconds, so nothing soft-locks. The QA bot uses `home:sleep`.
4. **The phone** works anywhere: casino floor and home. It has a key (default `KeyT`, rebindable, labelled TELEFON/PHONE).
   - Messages arrive during Watches only (`play` phase): a buzz plus a `phone`-kind toast, and an unread dot on a small
     phone chip.
   - Opening the phone shows the hands holding it (`viewmodel.hold('phone')`, where available) and the threads EŞİM/SPOUSE
     and TAHSİLDAR/THE COLLECTOR.
   - Replies are 2–3 options, chosen with digit keys while the phone is open. Never while a hotline board is up (key
     conflict).
5. **Harmony (spouse, 0..5, start 3)**:
   - **Spouse messages:** at most one per Night (Watch 1 or 2, seeded), with a reply. Examples: "When are you coming home?",
     "The rent is due, send 10?", "Our daughter's school trip, can we afford it?", "I dreamed of you winning".
   - **Replies:** cost or gain Harmony and sometimes coins (send money = spend).
   - **Quota margin:** a Night paid with ≥ 25 % margin gives +1 Harmony; paid under 5 % gives −1.
   - **The Evening:** talking gives a line for the current Harmony. At Harmony ≥ 4, the first talk each Evening gives a
     **BLESSING**: buff `blessed`, luck +2 for the next Night's first Watch (duration `shifts` n=1, clamped per machine as
     in charm `luckFx`). This is the first "luck from home" (pillar 2).
   - **Harmony 0:** the spouse is not home that Evening (`setSpouse(false)`) and the bed shows a note. The note line is a
     string; no 3D note is needed.
6. **Heat (the Collector, 0..6, start 0)**:
   - **Collector messages:** from Watch 2, when the Night's quota is behind schedule (left > 50 % of due at Watch 2, or
     > 25 % at the last Watch). Lines escalate: courtesy → reminder → final notice → "we are on our way".
   - **Replies:** "I'll pay" (0) or "I need time" (+1 Heat).
   - **Thin margins:** a Night paid under 5 % margin adds +1 Heat. A quiet Evening (Heat unchanged that Night) gives −1.
   - **Display:** Heat is shown on the phone's Collector thread header. Wave 70 adds visitors driven by Heat.
7. **A missed quota (solo, not online)**:
   - The existing outs still come first: `false_bottom`, `rope_ladder`.
   - Otherwise stage `doomed`: the ride home happens anyway (no lever), the player arrives at `home.spawn`, the lights
     flicker, a `knock` plays three times, then the run ends with `endRun('fell', 'shot')`.
   - `story/index.ts` routes `run:end` with `summary.ending === 'shot'` to the new cutscene `mafia_visit` (not
     `quota_fail`): the door swings open (`doorTo`), a goon (mannequin dressing `plain` with a pistol prop) steps in from
     `home.hall` to the door, `gunShot`, flash, fade, results. Not skippable.
   - Online runs keep the trapdoor (`fell` with no ending).
8. **Gloves**: the first-person hands wear dark leather gloves with a cuff ring at the wrist. Use a master-palette leather
   (P16 RUST_DEEP 0x4A2110 or P12 OXBLOOD 0x5A1019), not darker than P16, so dim rooms still show them. Add a settings toggle
   GLOVES/ELDİVEN (default on).

## Determinism, saves, rules
- **Sim time only:** no `performance.now`, `Date.now` or `setTimeout` in game code; use `app.timers` or the run tick.
  Seeded rolls use `hashSeed(seed, night, watch, 'msg.<thread>')`.
- **Saves:** new save data is optional `RunExt.home: HomeSave` (older saves have none). Restore must put the player back
  correctly: an `evening` stage restores at `home.spawn`, and a `ride` restores as `evening`.
- **Strings:** EN + TR in `*.strings.ts`. Plural keys need `.one` and `.other`. No prose literals outside `t()`.
- **Calm mode:** no flicker or knock jump. The doomed sequence still plays, but without flashes when reduce-flashing is on.
- **Tests:** add test files under `scripts/tests/` and do NOT edit `scripts/tests/index.js`. Report the file name and the
  director registers it.
- **QA bot** (`scripts/qa/bench.mjs`): `auto:night` must pass through the Evening automatically (take the lift, sleep). Add
  explicit steps `home:lift`, `home:sleep`, `home:talk`, `phone:open`, `phone:reply:<n>`. Keep runs byte-identical across
  two invocations.

## Lanes (exclusive file ownership)
| Lane | Owns | Builds |
|---|---|---|
| gloves | `src/player/viewmodel.ts`, `src/player/local.ts` (glove colour apply only), `src/core/settings.ts`, `src/core/ui/settingsScreen.ts`, `src/core/ui/settingsScreen.strings.ts`, `src/world/bench.ts` (stub only) | §8 |
| world | `src/world/home/**`, `src/world/level.ts` (registration next to the Hollow), `src/world/world.ts` (expose `home`), `src/world/layout.ts` (a `home` zone if needed) | the apartment, the stations and `HomeRoomApi` |
| flow | `src/game/home/evening.ts` (new), `src/game/home/evening.strings.ts` (new), `src/game/run.ts`, `src/game/ingame/panels.ts`, `src/game/ingame/session.ts`, `src/game/types.ts`, `src/game/benchRun.ts`, `scripts/qa/bench.mjs`, `scripts/qa/README.md` | §2, §3, §7 flow, saves, phone create/tick/save, `run.homePhone()`, bot steps |
| phone | `src/game/home/phone.ts`, `src/game/home/phone.strings.ts`, `src/game/home/phone.ui.ts`, `src/game/home/phone.css`, `src/core/keymap.ts`, `src/core/keymap.strings.ts`, `src/core/ui/manga/**` (spouse portrait), `src/core/audio/blip.ts` (spouse voice), `src/game/data/buffs.ts` | §4, §5, §6, buff `blessed`, and the dead overshoot reward fix: add the missing buff `favoured` (`x.pawn.freeRerolls` +1 for 1 shift) |
| scene | `src/game/story/cutscenes/mafia_visit.cutscene.ts` (new), `src/game/story/index.ts`, `src/game/story/story.strings.ts`, `src/game/horror/**` (the dread-unit fix: emit 0..1) | §7 scene, plus the bug that `dread:change` mixes 0..100 and 0..1 |
| audio | `src/core/audio/sfx.ts`, `src/core/audio/music/**` | the sounds in `HOME_SFX` and the `apartment` ambience, plus the juice sounds in the juice lanes' spec |
