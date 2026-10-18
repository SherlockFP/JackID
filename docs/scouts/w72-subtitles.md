## Subtitle and dialogue audit (read-only, Wave 71 at 4a1fee5)

**Verdict:** there is no subtitle system. There is one bottom bar that holds one line, shows it with a fixed timer, and replaces it instantly. Animated speech lives in three other places that do not share code: the manga dialogue box (typewriter with per-character blips), the cutscene and horror path (text appears at once, blips are a pre-planned utterance), and the spouse and visitor path in Evening. Nothing queues, nothing types in sync with the text, and the subtitle setting is checked in four different ways.

### Current pipeline (what exists)

- **Bar.** `ui.subtitle(text, speaker, dur)` at `src/core/ui/ui.ts:747-757`. It sets `.who` and `.txt` and toggles `.on`. A new call replaces the old line at once (`subGen` guards the old timer). Expiry is `window.setTimeout(dur*1000)` (ui.ts:756), so it is wall-clock, not sim or pause-aware. No queue, no typewriter. Subtitles scale with `textScale` (ui.ts:211) and `uiScale`.
- **Bar CSS.** `src/core/ui/ui.css:293-332`. A dark box with no frame, amber Press Start 8px speaker label, VT323 16px body, `opacity` with `steps(2,end)` at 0.12 s. Position is `bottom: lb*bar-h + 10u`, with overrides for `.mh-on`, `.seated` and `.hl-sheet` (ui.css:302, 324-332).
- **Interface.** `src/core/ui/types.ts:52` (`UIOverlay.subtitle`). The horror director takes it as `HorrorDirector` (`src/game/horror/director.ts:40-41`).
- **Cutscene cues.** `SubtitleCue` at `src/core/cutscene/types.ts:85-93` has `t, dur, key, vars, speaker, voice, mood`. `showSubtitle` at `src/core/cutscene/effects.ts:134-140` calls `ui.subtitle` with `dur`, and also calls `audio.voice.speak` when `voice` is set and not seeking. The player fires it at `player.ts:262`, clears it on release at `player.ts:421`, and implements the tap-to-next-line skip at `player.ts:355-369` (online it is disabled, `player.ts:360`).
- **Manga dialogue (separate surface).** `src/core/ui/manga/dialogue.ts:14-60` draws a bottom-third box with portrait, plate, and a typewriter at 40 cps (`mangaPanel.ts:127-154`). Each new character is voiced by a `MutationObserver` calling `audio.blip` (dialogue.ts:33-41). E/Space/click finishes or dismisses. `enqueue()` (mangaPanel.ts:58-73) serialises presentations. While a line is on screen, `sayLine(true)` sets `body.mg-say` (mangaPanel.ts:203-206), and `manga.css:416` hides `.px-subtitle` with `visibility:hidden`. A subtitle that fires during that window is hidden and its timer still runs, so the line is lost.
- **Voices.** `audio.blip(speaker, ch)` (audio.ts:442-450) is rate-limited to 14 per 100 ms. `audio.voice.speak(o)` (audio.ts:418-440) plans the whole line up front and holds the music duck. Blip voices are in `src/core/audio/blip.ts:31-61`: house, collector, bartender, mira, oracle, spouse, lord_ash, lord_ledgers, lord_mirrors, dealer, mannequin, plus stable voices for other ids.
- **Settings.** `subtitles` is a boolean (`src/core/settings.ts:20, 55`), with a toggle at `settingsScreen.ts:216`. There is no speed or typewriter option, and no reduced-motion option tied to subtitles.

### Call sites to migrate

Bottom bar, direct `ui.subtitle` calls:
1. `src/core/cutscene/effects.ts:134-140` (`showSubtitle`). Feeds every cutscene cue. Cue data is in 13 files under `src/game/story/cutscenes/` (intro, descend, audit, quota_explain, quota_fail, quota_met, quota_met, locker, wing_unlock, wing_key, stinger_turn, stinger_tape, ending_elevator, mafia_visit), plus `src/game/story/duels/scenes.ts:39-120` and the dev scene `src/core/debug.ts:205`.
2. `src/core/cutscene/player.ts:421`. Clears on release. Should become `subtitles.clear('cutscene')`.
3. `src/game/horror/director.ts:158, 277, 292-299` (`speak()`, House PA and mannequin whispers). Wired through `src/game/ingame/session.ts:247-253`, which also calls `holdClockFor('horror', dur)`.
4. `src/game/home/evening.ts:128-134` (`say()`). Used by spouse talk at `evening.ts:366-367` (also `audio.voice.speak` at line 367), the sleep note at 200, the dream at 213, the peephole hint at 406 and the window line at 418. `say()` falls back to a toast when subtitles are off, which no other caller does.
5. `src/game/home/evening.ts:260-265` (`caption()`). Used for knock captions at `evening.ts:291` and through `KnockIO.caption` (`src/game/home/knock.ts:144-145, 213-270`). Strings are in `knock.strings.ts`.
6. `src/game/ingame/roomsHost.ts:156-165`. Mira's wrong-number call, fixed `LINE_S = 3.2` at line 23, with `holdClockFor('miraCall', ...)`. Data is in `src/game/story/calls.ts`.
7. `src/machines/hotline/index.ts:288` (`answerPhoneKey`). Caller line, fixed 6 s, no voice. The comment at line 19 says subtitles belong to the hotline's own overlay, but the code calls the shared bar. This is unverified and needs a check.

Manga presentation (not the bar, but the same job):
8. `src/core/ui/manga/dialogue.ts` (used by `lordstable/index.ts:380, 396`, `tallytable/index.ts:476-477, 548`, and the duel scenes through `manga.dialogue`).
9. `src/core/ui/manga/mangaPanel.ts:171-197` (`cutin` with `lineKey`) and `mangaPanel.ts:203` (`sayLine`) and `manga.css:413-416` (`body.mg-say .px-subtitle`).

Other surfaces to decide on:
10. `src/game/story/notes.ts:221-300`. Cassette subtitles in a 3D placard (VFD green). A separate surface; reuse the timing helper, keep the rendering.
11. `src/core/audio/types.ts:110-116` and `synth.ts:341` (the comment says "callers show subtitles separately"). The contract to update.

Timing that exists today, all different:
- cutscene: authored `dur` per cue, e.g. `quota_explain` 3.0 s.
- evening: `lineSeconds` 2.2-6 s, 1.2 + 0.05/char (`evening.ts:60-62`).
- horror: `1.5 + 0.06*len`, clamped 2-8 s (`director.ts:296`).
- hotline: 6 s. Knock: 3 s. Mira call: 3.2 s per line.
- manga: typed at 40 cps, held until click.

### Observed in the bench (evidence)

Run: `node scripts/qa/bench.mjs --run "auto:night;home:lift;state;home:talk;wait:1500;shot:spouse-talk" --seed 3`. The JSON reported `failed: 2`, so I cannot confirm every step ran as written. The screenshot still shows the spouse line live:
`C:\Users\Admin\AppData\Local\Temp\claude\C--Users-Admin-Documents-JackID\48c49d04-016b-4c0d-ac70-780ba1fcc555\scratchpad\subs\spouse-talk.png`

In it, the subtitle block sits at the bottom centre and overlaps the seat HUD "PULLS" label and the "NIGHT CARD · HIGH TABLE" banner, so the "SPOUSE" plate is partly covered. This is the lane collision the bottom-stack rules are meant to prevent. Caveat: the Night Card state in this run may be bench-specific.

### Proposed design (one system)

**Module.** `src/core/subtitle/` with `subtitle.ts` (queue and lanes), `typewriter.ts` (shared with manga), and `timing.ts`. `ui.subtitle` becomes a thin wrapper during migration.

**API sketch:**
```ts
type Lane = 'cutscene' | 'story' | 'ambient' | 'sys';
interface SubLine {
  text: string;              // already t()'d at the call site
  speaker?: string;          // translated label, '' = narration
  voice?: VoiceSpeaker;      // blips in this voice; absent = silent
  mood?: Mood;
  lane: Lane;
  typeFor?: number;          // s budget for typing (cutscene passes cue.dur)
  hold?: number;             // s after typing; default readHold(text)
  tag?: string;              // replace-by-tag (knock captions)
  holdClock?: string;        // reason for holdClockFor, if the line must hold the Watch
}
subtitles.say(line): Promise<void>        // resolves when dismissed
subtitles.clear(lane?): void
subtitles.suspend(owner) / resume(owner)  // pause the queue, never drop
subtitles.advance(): boolean              // finish typing, then next line
```

**Typewriter and blips.** One source of truth: a timer per revealed character calls `audio.blip(speaker, ch)`. This replaces the manga MutationObserver and the pre-planned `voice.speak` for on-screen lines, so text and blips stay in sync. Blips still play when subtitles are off (voice is a separate setting from text). Audio is optional: typing must not depend on the audio context.

**Timing.** Typing: `len / cps`, with cps about 28 by default and per-voice cps from `BLIP_VOICES`. Reading hold: `clamp(1.2 + len/16, 2, 7)` s after typing. Cutscene lines are the exception: the cue timeline is authoritative, so cps is raised to `max(base, len / (dur*0.7))` to fit the cue, and the line is cut by the next cue rather than delayed.

**Queue rules.**
- `cutscene` lane: replace (the timeline wins, so a new cue cuts the old line).
- `story` lane (Mira call, spouse talk, Notary lines): FIFO, max 4 queued, extra dropped with a log.
- `ambient` lane (knock captions, window, peephole): replace by `tag`, and held back while a `story` or `cutscene` line is up.
- `sys` lane: toasts only, unchanged.

**Looks.** Keep the PSX bar and its VT323 and Press Start fonts. Add a brass inset frame (the `.px-tut` language) and an optional 28-32 px speaker thumbnail from `portraitSrc` for named characters. Enter and exit: `opacity` steps(2) plus 4 px translate over 120 ms. Calm or reduced motion: opacity only, no translate. Typewriter has an off or instant mode when the player asks (new setting, or reuse Calm).

**Lanes and offsets.** Replace the `mh-on`, `seated`, `hl-sheet` and `mg-say` rules with one `data-lane` attribute set by the owner. Manga and hotline suspend the queue, not hide it.

**Settings.** Keep `subtitles` (text on or off). Add `subtitleSpeed` (instant, normal, slow). Voice blips follow the existing `vol.voice`. Text-off rule: story lines that carry news fall back to a toast (the Evening already does this); cutscene and horror lines go silent in text but keep their blips.

**Clock.** Move the `holdClockFor` call into `subtitles.say` through `holdClock`, so no caller forgets it. Use `app.timers.ui` instead of raw `window.setTimeout`, so pause behaves.

### Risks

1. **Cutscene timing.** Typing time cannot push the timeline. Cue `dur` becomes the typing budget, and cps is raised to fit. Authored dur values were not written for typing, so check each cue (13 files) in the bench.
2. **Seek and late join.** `showSubtitle(seek=true)` shows the remaining time with no typing; the new path must reveal instantly on seek.
3. **Skip.** Cutscene tap-to-next-line (player.ts:355-369) and manga E/Space both map to `advance()`. Online skip stays a vote and must not advance locally (player.ts:360).
4. **Lost lines.** Today a line fired while manga or the hotline sheet is up is hidden and its timer keeps running, so it is lost. `suspend` must queue instead.
5. **Mix change.** Per-character blips do not duck music; `voice.speak` does (audio.ts:429). Moving PA and cutscene lines to per-char blips needs an explicit duck call or the score gets louder under the House.
6. **Localisation.** TR runs about 15-25% longer, so timing must use translated length (already true, since `t()` runs first) and `max-width: 70vw` must wrap. Check VT323 glyph coverage for TR characters.
7. **Subtitle setting.** Four different behaviours today (bar silent, evening toast, caption silent, horror silent with voice still playing). Unify to one rule (section above).
8. **Rate limit.** `audio.blip` allows 14 per 100 ms. Typing at 40 cps is inside that; a burst from two speakers in one frame is not.
9. **Voice budget.** `speak()` opens a pooled voice per line (32 pool). Per-char blips use short voices and are cheaper, but check the pool under a long cutscene.
10. **Ownership.** The manga box and the bar draw the same speech, so they must share the typewriter and blip code or drift apart again.
11. **Tests.** `planBlips` is already pure and testable (blip.ts:94). The queue, lanes and timing can be pure functions too.

### Suggested order

1. Extract `typewriter.ts` and `timing.ts`; make manga dialogue use them (no visible change, tests pass).
2. Build the queue and lanes; route `ui.subtitle` through it with `lane: 'story'`.
3. Migrate cutscenes (`effects.ts`, `player.ts`) with `typeFor = dur`, then horror, Evening, Mira, hotline.
4. Remove `mg-say` and the `.mh-on` and `.seated` offsets in favour of `data-lane`.
5. Add the settings and the bench anchors, then screenshot per lane.

No project files were edited and no git writes were run. The screenshot is under the scratchpad path above.