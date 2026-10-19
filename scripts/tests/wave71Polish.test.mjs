// Wave 71 polish (strings): the Collector's receipt keys exist in both languages, the Turkish HUD leftovers are gone (SPOT:, SONRAKİ V,
// the garbled interest line) and the Night plan and bank strings keep their shape.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const RESULTS = await load('src/menu/hud/results.strings.ts');
const PLAN = await load('src/menu/hud/plan.strings.ts');
const SPOT = await load('src/game/spotlight.strings.ts');
const BANK = await load('src/game/bank.strings.ts');

test('the Collector receipt has its title, subtitle, stamp and three figures in EN and TR', () => {
  for (const lang of ['en', 'tr']) {
    for (const k of ['shot.title', 'shot.sub', 'shot.stamp', 'shot.debt', 'shot.nights']) {
      assert.ok(RESULTS.default[lang][k], `${lang} ${k}`);
    }
  }
  assert.equal(RESULTS.default.en['shot.title'], 'SETTLED BY THE COLLECTOR');
  assert.equal(RESULTS.default.tr['shot.title'], 'TAHSİLDAR HESABI KAPATTI');
});

test('the Turkish Night plan speaks of Nöbet, not the V abbreviation', () => {
  const tr = PLAN.default.tr;
  assert.equal(tr.next, 'SONRAKİ NÖBET {w}/{n}');
  assert.ok(!/\bV\{w\}/.test(tr.ends), 'ends still uses V');
  assert.ok(tr.ends.startsWith('NÖBET {w}/{n}'));
});

test('the Turkish spotlight chip says SPOTLIGHT, not SPOT', () => {
  const tr = SPOT.default.tr;
  for (const k of ['chip', 'chip.one', 'chip.other']) {
    assert.ok(tr[k].startsWith('SPOTLIGHT: '), k);
    assert.ok(!/\bSPOT:/.test(tr[k]), k);
  }
});

test('the Turkish bank interest line is one uppercase form in every variant', () => {
  const tr = BANK.default.tr;
  for (const k of ['interest', 'interest.short', 'interest.none']) {
    assert.ok(tr[k].startsWith('BANKA +'), k);
    assert.ok(tr[k].includes('FAİZ (%{pct})'), k);
    assert.ok(!tr[k].includes('faiz'), k);
    assert.ok(!tr[k].includes('+%'), k);
  }
});
