/**
 * Story runtime (STORY lane): notes and tapes in the pit, the journal, and the cutscene triggers hooked into run events.
 *
 * Wiring: `inGameState` calls {@link startStory} after `startDebtSession()` and keeps the disposer for `exit()`.
 * Endings and falls end the run at once, so the Results hand-off must wait on {@link holdForStory} (see the report).
 * Online, only the host starts scenes; peers wait for the net layer to relay them through {@link playStory}.
 *
 * Wings: the note gate reads `wingState` from the rooms lane (the integrator binds its source with `bindWingSource`), and the
 * Night from the run's `shift:phase` / `run:window` events. The `room:opened` and `room:locker` events start `wing_key` and
 * `locker` (once per run each); the Night 7 Watch 2 starts `audit`. Notes re-place themselves on those events.
 */
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { log } from '@/core/log';
import type { CutsceneId, CutscenePlayOpts, CutsceneResult } from '@/core/cutscene/types';
import type { InGameParams } from '@/core/states';
import type { World } from '@/world/types';
import { wingState } from '@/game/rooms';
import { placeNotes, placedNoteIds, resetNotes, openJournal, notesFound } from './notes';
import type { NoteGate } from './notes.data';
import { advanceArc, markCard, type ChapterRecord } from './chapter';
import { MIRA_BEAT } from './calls';
import { ENDING_HOOK, ENDING_WITNESS, endingRecord, endingScene, freshFacts, isEnding, type EndingRecord } from './endings';
import type { DebtRun } from '@/game/run';

export { openJournal, notesFound };
export { STORY_CALLS, storyCallFor, type StoryCall } from './calls';

/**
 * THE SECOND NAME (wave 73): the chapter record lives in the run (saved with it, see chapter.ts). The story reads it here and
 * moves its arcs; the title cards and the Night 8 reveal are played from the run's events below.
 */
function chapterRec(): ChapterRecord | null { return app.run?.chapterRecord?.() ?? null; }
/** The Night's title card, once per run (chapter.ts marks it). */
function chapterOpens(night: number): void {
  const c = chapterRec();
  if (c && markCard(c, night)) void playStory(`chapter_n${night}`);
}
/** The Night 8 reveal, once per run: the second watch of the last chapter. */
function chapterReveal(): void {
  const c = chapterRec();
  if (!c || c.revealed) return;
  c.revealed = true;
  advanceArc(c, 'clerk', 2);
  void playStory('reveal_n8');
}
/** Cutscene ids played this page session (the intro plays once). */
const playedThisSession = new Set<CutsceneId>();
/** Last scene handed to the cutscene queue; the Results hand-off waits on it. */
let tail: Promise<CutsceneResult> = Promise.resolve('done');

// ── the live run: set by startStory, cleared by its disposer ────────────────────────────────────────
let activeWorld: World | null = null;
let activeGate: NoteGate | null = null;
let notesOff: (() => void) | null = null;
let notesKey = '';
/** The printed Night (1-based) as the run last reported it. */
let nightNow = 1;

/** The note gate a run uses unless one is passed in: wings from the rooms lane, the Night from the run events. */
function defaultGate(): NoteGate {
  return { zoneOpen: (zone: string): boolean => wingState(zone) === 'open', night: (): number => nightNow };
}

/** Play a story scene. Online only the host starts it (peers resolve as aborted until the net relays it). */
export function playStory(id: CutsceneId, o: CutscenePlayOpts = {}): Promise<CutsceneResult> {
  if (app.net.online && !app.net.isHost) return Promise.resolve('aborted');
  if (!app.cutscene.has(id)) { log.warn('story', `unknown scene "${id}"`); return Promise.resolve('aborted'); }
  playedThisSession.add(id);
  const p = app.cutscene.play(id, o);
  tail = p;
  return p;
}

/** THE ENDINGS (A5): the routed ending's scene, with Loki's last line as the `{loki}` var. */
export function playEnding(rec: EndingRecord): Promise<CutsceneResult> {
  return playStory(endingScene(rec.id), { vars: { loki: rec.lokiLine ? t(rec.lokiLine) : '' } });
}

/** DEV / QA (bench step `ending:<id>`): plays an ending as a run that reached it would. Aborted for an unknown id. */
export function previewEnding(id: string): Promise<CutsceneResult> {
  const rec = isEnding(id) ? endingRecord({ ...freshFacts(), ...ENDING_WITNESS[id] }) : null;
  return rec ? playEnding(rec) : Promise.resolve('aborted');
}

/** Resolves when every queued story scene has finished (the run-end hand-off waits on this). */
export function holdForStory(): Promise<void> {
  return tail.then((): void => undefined, (): void => undefined);
}

/**
 * Re-place the notes against the live gate: notes of a wing that just opened appear, and a note whose Night has come
 * shows up. Does nothing when the placed set has not changed, so it is cheap to call often.
 */
export function refreshStoryNotes(): void {
  if (!activeWorld) return;
  const key = placedNoteIds(activeGate).join(',');
  if (notesOff && key === notesKey) return;
  notesOff?.();
  notesOff = placeNotes(activeWorld, activeGate);
  notesKey = key;
}

/** Tell the story the printed Night (1-based): call it after a restore, where no Night event has fired yet. */
export function storyNight(night: number): void {
  nightNow = night;
  refreshStoryNotes();
}

/**
 * Start the story for one Debt Run. Returns the disposer for the state's `exit()`.
 * `world` is the session world (its `ready` promise gates the intro and the note placement).
 * `gate` overrides the default note gate (the rooms lane's wings and the run's Night); tests pass their own.
 */
export function startStory(world: World, params: InGameParams, gate: NoteGate | null = null): () => void {
  let live = true;
  const offs: Array<() => void> = [];
  const once = new Set<string>();
  let watchNight = -1, watches = 0;
  nightNow = 1;
  activeGate = gate ?? defaultGate();
  resetNotes();

  const fire = (key: string, id: CutsceneId): void => {
    if (!live || once.has(key)) return;
    once.add(key);
    void playStory(id);
  };

  // the Collector's visit (cutscenes/mafia_visit): the front door swings open at its cue; a seek jumps straight to open
  offs.push(app.cutscene.registerHook('home.doorOpen', (_args, ctx) => { void app.world?.home?.doorTo(1, ctx.seeking ? 0 : 0.8); }));
  // THE ENDINGS: the flat is dressed (`ada`: 'seat' / 'still' at the table, 'gone' down in your place); the card leaves your hand
  offs.push(app.cutscene.registerHook(ENDING_HOOK.home, (args) => {
    const ada = args && typeof args === 'object' && !Array.isArray(args) ? args.ada : null;
    app.world?.home?.setSpouse(ada !== 'gone', 'home');
  }));
  // shortcut: the burn only empties the hand (the scene's flash and flicker carry it); a burning card prop waits for the viewmodel lane
  offs.push(app.cutscene.registerHook(ENDING_HOOK.burn, () => { app.player?.viewmodel.hold('none'); }));

  offs.push(bus.on('quota:met', () => { if (live) void playStory('quota_met'); }));
  offs.push(bus.on('run:end', ({ summary }) => {
    if (!live) return;
    const rec = (app.run as Partial<Pick<DebtRun, 'endingRecord'>> | null)?.endingRecord?.() ?? null;
    // a missed quota at home (solo) ends with the Collector's visit, not the trapdoor (WAVE69 §7)
    if (summary.ending === 'shot') void playStory('mafia_visit');
    else if (summary.result === 'fell') void playStory('quota_fail');
    // KEPT PAIR and COLD KITCHEN carry their own lift
    else if (summary.result === 'escaped' && summary.ending !== 'descend' && !rec?.burned) void playStory('ending_elevator');
    // THE ENDINGS (A5): the routed ending follows the scene above; the Results hand-off waits for both (holdForStory)
    if (rec) void playEnding(rec);
  }));
  offs.push(bus.on('tycoon:prestige', () => { if (live) void playStory('descend'); }));
  offs.push(bus.on('tycoon:milestone', ({ feature }) => {
    if (feature) fire(`wing:${feature}`, 'wing_unlock');
  }));
  offs.push(bus.on('dread:change', ({ value }) => {
    if (value >= 0.5) fire('dread:turn', 'stinger_turn');
    if (value >= 0.8) fire('dread:tape', 'stinger_tape');
  }));
  // a wing opens by key (the Parlour opens by itself after Night 3, with its own scene); the first key turn plays wing_key
  offs.push(bus.on('room:opened', ({ zone }) => {
    if (!live) return;
    if (zone !== 'parlour') fire('room:key', 'wing_key');
    refreshStoryNotes();
  }));
  // the first locker of the run: its contents are a note, a charm, coins or a blank JackID
  offs.push(bus.on('room:locker', () => fire('locker', 'locker')));
  // Night arc: the Audit lands on the second Watch of Night 7 (WAVE24 §3). A Watch is a `watch` window; they count per Night.
  offs.push(bus.on('shift:phase', ({ index }) => {
    if (!live) return;
    nightNow = index + 1;
    refreshStoryNotes();
  }));
  offs.push(bus.on('run:window', ({ window, night }) => {
    if (!live) return;
    nightNow = night;
    if (night !== watchNight) { watchNight = night; watches = 0; }
    if (window === 'watch') {
      watches++;
      // THE SECOND NAME: each Night opens with its title card on the first Watch
      if (watches === 1) {
        chapterOpens(night);
        // the Collector's arc: the knock of Night 5 is its second beat (the knock itself is the visitor lane's)
        if (night === 5) { const c = chapterRec(); if (c) advanceArc(c, 'collector', 2); }
      }
      if (night === 7 && watches === 2) {
        fire('audit', 'audit');
        const c = chapterRec();
        if (c) advanceArc(c, 'clerk', 1);
      }
      if (night === 8 && watches === 2) chapterReveal();
    }
    refreshStoryNotes();
  }));

  // Mira's thread: each of her calls moves her arc (N2, N5, N8). The call itself is played by the hotline.
  offs.push(bus.on('phone:story', ({ id }) => {
    const beat = MIRA_BEAT[id];
    const c = chapterRec();
    if (live && c && beat) advanceArc(c, 'mira', beat);
  }));

  // the intro (waking in the pit) and the notes need the built world; a new run (not a resume) shows the intro once
  const ready = (world as World & { ready?: Promise<void> }).ready ?? Promise.resolve();
  // THE PROLOGUE (wave 72): a fresh run starts in the apartment, so the intro waits for the lift to land (`home:prologue`)
  const introWaits = (): boolean => app.run?.prologueOn?.() === true;
  void ready.then(() => {
    if (!live) return;
    activeWorld = world;
    refreshStoryNotes();
    if (!params.resume && !params.bench && !playedThisSession.has('intro') && !introWaits()) void playStory('intro');
  }, (e: unknown) => log.error('story', 'world not ready; notes skipped', e));
  offs.push(bus.on('home:prologue', () => {
    if (live && !params.resume && !params.bench && !playedThisSession.has('intro')) void playStory('intro');
  }));

  return () => {
    live = false;
    for (const off of offs) off();
    offs.length = 0;
    notesOff?.();
    notesOff = null;
    notesKey = '';
    activeWorld = null;
    activeGate = null;
    resetNotes();
  };
}
