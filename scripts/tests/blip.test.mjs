// Unit tests for src/core/audio/blip.ts: one blip per letter or digit, pauses at punctuation, deterministic plans,
// stable per-speaker voices. The renderers need an AudioContext, so they are exercised in the browser, not here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let blip, createRng;
before(async () => {
  blip = await load('src/core/audio/blip.ts');
  ({ createRng } = await load('src/core/rng.ts'));
});

const plan = (text, speaker = 'house', seed = 7, mood) =>
  blip.planBlips(text, blip.blipVoiceFor(speaker), { mood, rng: createRng(seed) });

test('every fixed voice is in a playable range', () => {
  for (const [name, v] of Object.entries(blip.BLIP_VOICES)) {
    assert.ok(v.f0 >= 80 && v.f0 <= 1200, `${name} f0`);
    assert.ok(v.cps >= 10 && v.cps <= 50, `${name} cps`);
    assert.ok(v.vol > 0 && v.vol <= 0.6, `${name} vol`);
    assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(v.wave), `${name} wave`);
  }
});

test('one blip per letter or digit; spaces and punctuation are silent', () => {
  assert.equal(plan('Hi, you 2!').events.length, 6);
  assert.equal(plan('... ?!').events.length, 0);
  assert.equal(plan('').events.length, 0);
  assert.equal(plan('').duration, 0);
});

test('plans are deterministic for a seed and vary across seeds', () => {
  assert.deepEqual(plan('the notary is watching').events, plan('the notary is watching').events);
  assert.notDeepEqual(plan('the notary is watching', 'house', 1).events, plan('the notary is watching', 'house', 2).events);
});

test('event times rise, end inside the duration, and punctuation adds a pause', () => {
  const p = plan('ab.cd');
  for (let i = 1; i < p.events.length; i++) assert.ok(p.events[i].t > p.events[i - 1].t);
  assert.ok(p.duration > p.events[p.events.length - 1].t);
  const gapAfterStop = p.events[2].t - p.events[1].t;
  const gapPlain = p.events[1].t - p.events[0].t;
  assert.ok(gapAfterStop > gapPlain + 0.2, 'the full stop is a real pause');
});

test('pitch stays inside the speaker span and the mood shifts it', () => {
  const v = blip.blipVoiceFor('collector');
  const ceiling = (21 * v.span) / 12 + 3;
  for (const e of plan('a long low sentence for the collector to growl', 'collector').events) {
    assert.ok(e.semis >= -3 && e.semis <= ceiling, `semis ${e.semis}`);
  }
  const calm = plan('aaaa', 'house', 3, 'calm').events[0].semis;
  const cheery = plan('aaaa', 'house', 3, 'cheery').events[0].semis;
  assert.ok(cheery > calm, 'cheery sits higher');
  assert.ok(plan('aaaa', 'house', 3, 'whisper').events[0].vol < plan('aaaa', 'house', 3, 'angry').events[0].vol);
});

test('charEvent is pure per character and marks vowels', () => {
  const v = blip.blipVoiceFor('mira');
  assert.equal(blip.charEvent(v, ' '), null);
  assert.equal(blip.charEvent(v, '.'), null);
  assert.deepEqual(blip.charEvent(v, 'k'), blip.charEvent(v, 'k'));
  assert.equal(blip.charEvent(v, 'a').vowel, true);
  assert.equal(blip.charEvent(v, 'k').vowel, false);
  assert.equal(blip.charEvent(v, 'ı').vowel, true, 'dotless i counts as a vowel');
});

test('unknown speakers get a stable voice of their own', () => {
  assert.deepEqual(blip.blipVoiceFor('notary'), blip.blipVoiceFor('notary'));
  assert.notEqual(blip.blipVoiceFor('notary').f0, blip.blipVoiceFor('clerk').f0);
  assert.equal(blip.blipVoiceFor('house'), blip.BLIP_VOICES.house);
});
