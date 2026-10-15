// Wave 55 (director): MACHINE OF THE NIGHT. Each Night one open machine is the spotlight: seeded pick (never last Night's kind),
// a scoped x1.25 payout.mult source, a Ticket on every 5th play, and a `spotlight:change` event for the beam and the HUD chip.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let SP, EV, SCH;
before(async () => {
  SP = await load('src/game/spotlight.ts');
  EV = await load('src/core/events.ts');
  SCH = await load('src/game/data/schedule.ts');
});

const IDS = ['bigone', 'coinflip', 'scratch', 'craps'];

test('the pick is seeded (same seed and Night, same machine), varies across Nights, and is null on an empty floor', () => {
  assert.equal(SP.spotlightPick(7, 2, IDS, null), SP.spotlightPick(7, 2, IDS, null));
  assert.equal(SP.spotlightPick(7, 2, [], null), null);
  const seen = new Set();
  for (let n = 0; n < 50; n++) seen.add(SP.spotlightPick(7, n, IDS, null));
  assert.ok(seen.size >= 3, `expected variety over 50 Nights, got ${seen.size} kinds`);
});

test('the pick never repeats last Night\'s kind while another kind is open', () => {
  for (const last of IDS) {
    for (let n = 0; n < 30; n++) assert.notEqual(SP.spotlightPick(11, n, IDS, last), last);
  }
  assert.equal(SP.spotlightPick(11, 0, ['bigone'], 'bigone'), 'bigone', 'a lone machine stays the spotlight');
});

test('the Night open picks a machine among its instances and announces it; the x1.25 source is scoped to that kind', () => {
  const sp = new SP.Spotlight(7, () => {});
  const seen = [];
  EV.bus.on('spotlight:change', (v) => seen.push(v));
  const v = sp.begin(0, [
    { machineId: 'bigone', instance: 'i1' }, { machineId: 'bigone', instance: 'i2' }, { machineId: 'craps', instance: 'i3' },
  ]);
  assert.ok(v, 'a spotlight is picked');
  assert.equal(v.night, 1);
  assert.deepEqual(v.instances, v.machineId === 'bigone' ? ['i1', 'i2'] : ['i3']);
  assert.equal(seen.at(-1)?.machineId, v.machineId);
  const out = [];
  sp.collect({}, out);
  assert.equal(out.length, 1);
  const eff = out[0].effects[0];
  assert.deepEqual([eff.hook, eff.op, eff.value], ['payout.mult', 'mult', SCH.SPOTLIGHT_MULT]);
  assert.equal(eff.value, 1.25);
  assert.deepEqual(eff.scope, { machines: [v.machineId] });
});

test('every 5th play on the spotlight pays one Ticket; other machines do not count', () => {
  const sp = new SP.Spotlight(3, () => {});
  const v = sp.begin(4, [{ machineId: 'scratch', instance: 's1' }]);
  assert.equal(v.machineId, 'scratch');
  const paid = [];
  for (let i = 0; i < 10; i++) paid.push(sp.round('scratch'));
  assert.deepEqual(paid, [0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  assert.equal(sp.round('craps'), 0);
  assert.equal(sp.current().plays, 10);
  assert.equal(sp.current().progress, 0);
  assert.equal(SP.spotlightChip(sp.current(), 'Scratch').includes('×1.25'), true);
  assert.equal(SP.spotlightChip({ ...sp.current(), progress: 2 }, 'Scratch').includes('2/5 to a Ticket'), true);
});

test('the Dawn ends the spotlight: no source, the beam event clears, and the next Night avoids the same kind', () => {
  const sp = new SP.Spotlight(9, () => {});
  const first = sp.begin(0, IDS.map((id) => ({ machineId: id, instance: `${id}-1` })));
  sp.end();
  const out = [];
  sp.collect({}, out);
  assert.equal(out.length, 0);
  assert.equal(sp.current(), null);
  const second = sp.begin(1, IDS.map((id) => ({ machineId: id, instance: `${id}-1` })));
  assert.notEqual(second.machineId, first.machineId);
  const saved = sp.snapshot();
  const again = new SP.Spotlight(9, () => {});
  again.restore(JSON.parse(JSON.stringify(saved)));
  assert.equal(again.current().machineId, second.machineId);
});

test('the Ticket and start lines are localised text (EN and TR keys exist)', () => {
  assert.match(SP.spotlightTicketLine(), /\+1/);
  assert.match(SP.spotlightStartLine({ night: 1, machineId: 'bigone', instances: [], plays: 0, progress: 0, ticket: false }, 'Big One'), /×1\.25/);
});
