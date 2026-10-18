// Unit tests for src/core/ui/subtitles.ts (W72): typewriter timing, punctuation pauses, one blip per letter, the queue
// (FIFO, source replace, cutscene replace, cap), fit timing for cues, speed and reduced motion, and the freeze.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let S;
before(async () => { S = await load('src/core/ui/subtitles.ts'); });

/** A fresh queue with recorders for renders and blips. Speed and motion are set per test. */
function rig(opts = {}) {
  const views = [], blips = [];
  const q = S.createSubtitles({
    render: (v) => views.push(v),
    blip: (voice, ch) => blips.push([voice, ch]),
    speed: () => opts.speed ?? 'normal',
    reduceMotion: () => !!opts.reduceMotion,
  });
  return { q, views, blips, last: () => views[views.length - 1] };
}

test('readHold: 2 s for a short line, 1 s per 16 characters, capped at 7 s', () => {
  assert.equal(S.readHold('hi'), 2);
  assert.equal(S.readHold('x'.repeat(16)), 2.2);
  assert.equal(S.readHold('x'.repeat(200)), 7);
});

test('pauseAfter: sentence ends pause longer than clause marks; letters and spaces do not', () => {
  assert.equal(S.pauseAfter('.'), 0.35);
  assert.equal(S.pauseAfter('?'), 0.35);
  assert.equal(S.pauseAfter(','), 0.15);
  assert.equal(S.pauseAfter('a'), 0);
  assert.equal(S.pauseAfter(' '), 0);
});

test('typewriter: slide-in first, then one letter per 1/40 s', () => {
  const { q, last } = rig();
  q.say({ text: 'abcd' });
  assert.equal(last().phase, 'in');
  q.tick(0.2);                      // letters appear at 0.145, 0.170, 0.195, 0.220
  assert.equal(last().shown, 'abc');
  assert.equal(last().phase, 'typing');
  q.tick(0.03);
  assert.equal(last().shown, 'abcd');
  assert.equal(last().phase, 'hold');
});

test('punctuation holds the typing for a beat before the next letter', () => {
  const { q, last } = rig();
  q.say({ text: 'a.b' });           // "a" 0.145, "." 0.170, pause 0.35 s, "b" 0.545
  q.tick(0.3);
  assert.equal(last().shown, 'a.');
  q.tick(0.2);                      // age 0.5
  assert.equal(last().shown, 'a.');
  q.tick(0.05);                     // age 0.55
  assert.equal(last().shown, 'a.b');
});

test('one blip per typed letter or digit in the line voice; spaces and punctuation are not blipped', () => {
  const { q, blips } = rig();
  q.say({ text: 'a b, c2', voice: 'house' });
  q.tick(5);
  assert.deepEqual(blips.map((b) => b[1]), ['a', 'b', 'c', '2']);
  assert.ok(blips.every((b) => b[0] === 'house'));
});

test('a line without a voice types silently', () => {
  const { q, blips } = rig();
  q.say({ text: 'quiet' });
  q.tick(5);
  assert.equal(blips.length, 0);
});

test('hold after typing is readHold(text); then the out phase; then the bar is empty', () => {
  const { q, last } = rig();
  q.say({ text: 'hi' });            // typed by 0.170; hold 2 s -> out at 2.170; gone at 2.290
  q.tick(1.9);
  assert.equal(last().phase, 'hold');
  q.tick(0.25);                     // age 2.15
  assert.equal(last().phase, 'hold');
  q.tick(0.1);                      // age 2.25
  assert.equal(last().phase, 'out');
  q.tick(0.1);                      // age 2.35
  assert.equal(q.current(), null);
});

test('fit: a cue or caller duration is the whole on-screen time, typing included', () => {
  const { q, last } = rig();
  q.say({ text: 'abc', fit: 3, lane: 'cutscene' });   // out starts at 2.88, ends at 3.0
  q.tick(2.95);
  assert.ok(q.current(), 'still on screen before the cue ends');
  q.tick(0.1);                      // age 3.05
  assert.equal(q.current(), null);
  assert.equal(last(), null);
});

test('fit: long text types faster so it is fully typed inside 70% of the cue', () => {
  const { q, last } = rig();
  q.say({ text: 'x'.repeat(200), fit: 2, lane: 'cutscene' });
  q.tick(1.45);                     // 70% of 2 s is 1.4 s
  assert.equal(last().shown.length, 200);
  q.tick(0.45);                     // age 1.9: still up
  assert.ok(q.current());
  q.tick(0.15);                     // age 2.05: the cue's time is up
  assert.equal(q.current(), null);
});

test('queue: lines wait their turn, first in first out', () => {
  const { q, last } = rig();
  q.say({ text: 'one' });
  q.say({ text: 'two' });
  q.say({ text: 'three' });
  assert.equal(q.queued(), 2);
  q.tick(4);                        // "one" is over by then; "two" comes in
  assert.equal(q.current().text, 'two');
  assert.equal(last().phase, 'in');
  assert.equal(q.queued(), 1);
});

test('queue cap: at most SUB_QUEUE_MAX lines wait; extra lines are dropped', () => {
  const { q } = rig();
  q.say({ text: 'on screen' });
  for (let i = 0; i < 10; i++) q.say({ text: `wait ${i}` });
  assert.equal(q.queued(), S.SUB_QUEUE_MAX);
});

test('a source replaces the line on screen with the same source, at once', () => {
  const { q } = rig();
  q.say({ text: 'first', source: 'knock', lane: 'ambient' });
  q.say({ text: 'second', source: 'knock', lane: 'ambient' });
  assert.equal(q.current().text, 'second');
  assert.equal(q.queued(), 0);
});

test('a source replaces its own waiting line, so each source holds one line in the queue', () => {
  const { q } = rig();
  q.say({ text: 'busy' });
  q.say({ text: 'p1', source: 'mira' });
  q.say({ text: 'p2', source: 'mira' });
  assert.equal(q.queued(), 1);
  q.tick(10);
  assert.equal(q.current().text, 'p2');
});

test('a cutscene line replaces the line on screen and drops the queue (the timeline wins)', () => {
  const { q } = rig();
  q.say({ text: 'story on screen' });
  q.say({ text: 'story waiting' });
  q.say({ text: 'cue', lane: 'cutscene', fit: 2 });
  assert.equal(q.current().text, 'cue');
  assert.equal(q.queued(), 0);
});

test('clear(lane) drops that lane and lets the next waiting line in; clear() empties the bar', () => {
  const { q } = rig();
  q.say({ text: 'cue', lane: 'cutscene', fit: 9 });
  q.say({ text: 'after the cue' });
  q.clear('cutscene');
  assert.equal(q.current().text, 'after the cue');
  q.clear();
  assert.equal(q.current(), null);
  assert.equal(q.queued(), 0);
});

test('an empty text clears everything', () => {
  const { q } = rig();
  q.say({ text: 'a' });
  q.say({ text: 'b' });
  q.say({ text: '' });
  assert.equal(q.current(), null);
  assert.equal(q.queued(), 0);
});

test('instant lines show the whole text at once and make no blips', () => {
  const { q, last, blips } = rig();
  q.say({ text: 'seen', voice: 'house', instant: true, fit: 1 });
  assert.equal(last().shown, 'seen');
  q.tick(1);
  assert.equal(blips.length, 0);
});

test('finishTyping reveals the rest of a typing line once, then reports nothing to do', () => {
  const { q, last } = rig();
  q.say({ text: 'abcdef' });
  q.tick(0.2);
  assert.equal(q.finishTyping(), true);
  assert.equal(last().shown, 'abcdef');
  assert.equal(q.finishTyping(), false);
  assert.equal(rig().q.finishTyping(), false, 'nothing on screen');
});

test('speed slow types at 20 letters a second', () => {
  const { q, last } = rig({ speed: 'slow' });
  q.say({ text: 'abcd' });          // letters at 0.17, 0.22, 0.27, 0.32
  q.tick(0.25);
  assert.equal(last().shown, 'ab');
});

test('speed instant shows the line at once', () => {
  const { q, last } = rig({ speed: 'instant' });
  q.say({ text: 'now' });
  assert.equal(last().shown, 'now');
});

test('reduced motion: no slide-in, text at once, no blips', () => {
  const { q, last, blips } = rig({ reduceMotion: true });
  q.say({ text: 'still', voice: 'house' });
  assert.equal(last().phase, 'hold');
  assert.equal(last().shown, 'still');
  q.tick(0.5);
  assert.equal(blips.length, 0);
});

test('a frozen queue does not advance; it resumes where it stopped', () => {
  const { q, last } = rig();
  q.say({ text: 'paused' });
  q.tick(0.3, true);
  q.tick(60, true);
  assert.ok(q.current(), 'still on screen');
  assert.equal(last().shown, '');
  q.tick(0.2);                      // age 0.2 once running: p, a, u have appeared
  assert.equal(last().shown, 'pau');
});

test('the renderer is told when the bar empties', () => {
  const { q, last } = rig();
  q.say({ text: 'x' });
  q.tick(10);
  assert.equal(last(), null);
});
