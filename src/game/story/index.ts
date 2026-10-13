/**
 * Story runtime (STORY lane): notes and tapes in the pit, the journal, and the cutscene triggers hooked into run events.
 *
 * Wiring: `inGameState` calls {@link startStory} after `startDebtSession()` and keeps the disposer for `exit()`.
 * Endings and falls end the run at once, so the Results hand-off must wait on {@link holdForStory} (see the report).
 * Online, only the host starts scenes; peers wait for the net layer to relay them through {@link playStory}.
 */
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { log } from '@/core/log';
import type { CutsceneId, CutscenePlayOpts, CutsceneResult } from '@/core/cutscene/types';
import type { InGameParams } from '@/core/states';
import type { World } from '@/world/types';
import { placeNotes, resetNotes, openJournal, notesFound } from './notes';

export { openJournal, notesFound };

/** Flags written by cutscene hooks (per run; not persisted). */
const flags = { descendLook: false, wingSeen: false };
/** Read-only view of the hook flags (the next lore beat may branch on them). */
export function storyFlags(): Readonly<typeof flags> { return flags; }
/** Cutscene ids played this page session (the intro plays once). */
const playedThisSession = new Set<CutsceneId>();
/** Last scene handed to the cutscene queue; the Results hand-off waits on it. */
let tail: Promise<CutsceneResult> = Promise.resolve('done');

/** Play a story scene. Online only the host starts it (peers resolve as aborted until the net relays it). */
export function playStory(id: CutsceneId, o: CutscenePlayOpts = {}): Promise<CutsceneResult> {
  if (app.net.online && !app.net.isHost) return Promise.resolve('aborted');
  if (!app.cutscene.has(id)) { log.warn('story', `unknown scene "${id}"`); return Promise.resolve('aborted'); }
  playedThisSession.add(id);
  const p = app.cutscene.play(id, o);
  tail = p;
  return p;
}

/** Resolves when every queued story scene has finished (the run-end hand-off waits on this). */
export function holdForStory(): Promise<void> {
  return tail.then((): void => undefined, (): void => undefined);
}

/**
 * Start the story for one Debt Run. Returns the disposer for the state's `exit()`.
 * `world` is the session world (its `ready` promise gates the intro and the note placement).
 */
export function startStory(world: World, params: InGameParams): () => void {
  let live = true;
  const offs: Array<() => void> = [];
  const once = new Set<string>();
  flags.descendLook = false;
  flags.wingSeen = false;
  resetNotes();

  const fire = (key: string, id: CutsceneId): void => {
    if (!live || once.has(key)) return;
    once.add(key);
    void playStory(id);
  };

  offs.push(app.cutscene.registerHook('story.pick', (_args, ctx) => { flags.descendLook = ctx.vars.pick === 0; }));
  offs.push(app.cutscene.registerHook('story.unlock', () => { flags.wingSeen = true; }));

  offs.push(bus.on('quota:met', () => { if (live) void playStory('quota_met'); }));
  offs.push(bus.on('run:end', ({ summary }) => {
    if (!live) return;
    if (summary.result === 'fell') void playStory('quota_fail');
    else if (summary.result === 'escaped' && summary.ending !== 'descend') void playStory('ending_elevator');
  }));
  offs.push(bus.on('tycoon:prestige', () => { if (live) void playStory('descend'); }));
  offs.push(bus.on('tycoon:milestone', ({ feature }) => {
    if (feature) fire(`wing:${feature}`, 'wing_unlock');
  }));
  offs.push(bus.on('dread:change', ({ value }) => {
    if (value >= 0.5) fire('dread:turn', 'stinger_turn');
    if (value >= 0.8) fire('dread:tape', 'stinger_tape');
  }));

  // the intro (waking in the pit) and the notes need the built world; a new run (not a resume) shows the intro once
  const ready = (world as World & { ready?: Promise<void> }).ready ?? Promise.resolve();
  void ready.then(() => {
    if (!live) return;
    offs.push(placeNotes(world));
    if (!params.resume && !params.bench && !playedThisSession.has('intro')) void playStory('intro');
  }, (e: unknown) => log.error('story', 'world not ready; notes skipped', e));

  return () => {
    live = false;
    for (const off of offs) off();
    offs.length = 0;
    resetNotes();
  };
}
