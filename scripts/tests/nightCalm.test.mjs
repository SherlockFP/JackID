// Night 1 is calm and the banner layer sits in its top band. Covers: no nightly event rolls on printed Night 1 (it starts on
// Night 2), the printed Night number is what the pool filter reads, event banners hold shorter, and the banner CSS clears the
// HUD top bar. Pure engine tests (no DOM). Not registered in scripts/tests/index.js (the director registers it).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, load, closeVite } from './_vite.mjs';

after(closeVite);

let NightEvents;
let FIRST_EVENT_NIGHT;
let bridgeEventBanners;
let bus;
before(async () => {
  ({ NightEvents, FIRST_EVENT_NIGHT } = await load('src/game/buffs/events.ts'));
  ({ bridgeEventBanners } = await load('src/game/buffs/banner.ts'));
  ({ bus } = await load('src/core/events.ts'));
});

/** A deterministic host: the chance always hits, the weighted pick takes the first candidate, the clock is fixed. */
function host(printedNight) {
  let rolls = 0;
  return {
    host: {
      selfId: 0,
      isHost: true,
      run: () => ({ night: () => printedNight }),
      rng: {
        chance: () => { rolls++; return true; },
        weighted: (items) => items[0],
        int: () => 1,
        float: () => 0,
      },
      now: () => 0,
      touch: () => {},
    },
    rolls: () => rolls,
  };
}

function eventsWith(printedNight) {
  const h = host(printedNight);
  const ne = new NightEvents(h.host);
  ne.register({ id: 'happy_hour', icon: 'icon.star', weight: 3, duration: 90, effects: [], exclusive: 'mood', world: {},
    strings: { en: { name: 'a', desc: 'b', announce: 'c' }, tr: { name: 'a', desc: 'b', announce: 'c' } } });
  ne.register({ id: 'late_only', icon: 'icon.star', weight: 3, duration: 90, effects: [], exclusive: 'late', world: {},
    minShift: 3, strings: { en: { name: 'a', desc: 'b', announce: 'c' }, tr: { name: 'a', desc: 'b', announce: 'c' } } });
  return { ne, h };
}

test('the first event Night is printed Night 2', () => {
  assert.equal(FIRST_EVENT_NIGHT, 2);
});

test('printed Night 1 never starts a nightly event, even when the chance always hits', () => {
  const { ne, h } = eventsWith(1);
  for (let i = 0; i < 20; i++) assert.equal(ne.roll(), null);
  assert.equal(ne.active().length, 0);
  assert.equal(h.rolls(), 0, 'Night 1 does not even spend a chance roll');
});

test('printed Night 2 can start an event', () => {
  const { ne } = eventsWith(2);
  assert.equal(ne.roll(), 'happy_hour');
  assert.ok(ne.isActive('happy_hour'));
});

test('minShift reads the printed Night: a Night-3 event is not offered on Night 2', () => {
  const { ne } = eventsWith(2);
  ne.setChance(1);
  assert.notEqual(ne.roll(), 'late_only');
});

test('a non-host never rolls', () => {
  const h = host(4);
  h.host.isHost = false;
  const ne = new NightEvents(h.host);
  ne.register({ id: 'x', icon: 'i', weight: 1, duration: 10, effects: [], exclusive: '', world: {},
    strings: { en: { name: 'a', desc: 'b', announce: 'c' }, tr: { name: 'a', desc: 'b', announce: 'c' } } });
  assert.equal(ne.roll(), null);
});

test('event banners hold shorter: start under 2.5 s, end under 1.5 s', () => {
  const shown = [];
  const off = bridgeEventBanners(() => ({ world: { lightColor: 0xffb060 } }), (text, o) => shown.push(o));
  try {
    bus.emit('event:start', { id: 'happy_hour' });
    bus.emit('event:end', { id: 'happy_hour' });
  } finally {
    off();
  }
  assert.equal(shown.length, 2);
  assert.ok(shown[0].hold <= 2.5, `start hold ${shown[0].hold}`);
  assert.ok(shown[1].hold <= 1.5, `end hold ${shown[1].hold}`);
});

test('the banner layer sits in the top band under the HUD bar, not at 22 % or 44 %', () => {
  const css = readFileSync(join(ROOT, 'src/core/ui/ui.css'), 'utf8');
  const rule = css.match(/\.px-bw\.t-banner\s*\{([^}]*)\}/);
  assert.ok(rule, 'a .px-bw.t-banner rule exists');
  assert.match(rule[1], /var\(--hud-top-h/, 'the band starts under the HUD top bar');
  assert.doesNotMatch(rule[1], /44%|22%/);
  const ts = readFileSync(join(ROOT, 'src/core/ui/ui.ts'), 'utf8');
  assert.doesNotMatch(ts, /wrap\.style\.top\s*=\s*'22%'/, 'no inline 22 % top left in runBanner');
});
