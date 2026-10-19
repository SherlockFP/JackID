// Wave 72: the casino refit. The ten-game roster in four readable areas, the unlock order, lit zones, signposts that point the
// way the reader walks, and the map bug fixes (slot zones, LOB-PAWN, duel.laundry, sump walls).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load, closeVite } from './_vite.mjs';

after(closeVite);
let P, L, ARCH, DECOR;
before(async () => {
  P = await load('src/game/progression.ts');
  L = await load('src/world/layout.ts');
  ARCH = await load('src/world/sys/arch.ts');
  DECOR = await load('src/world/props/decor.ts');
});

const TEN = ['bigone', 'coinflip', 'hilo', 'videopoker', 'mines', 'plinko', 'roulette', 'blackjack', 'keno', 'sonkart'];
// Wave 80: the Night Derby (Midway wing, XL) and the Cascade (Well pad) join the ten as pinned Nights 3 and 4
const CORE12 = [...TEN, 'derby', 'cascade'];
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the floor keeps twelve games, three of them free on Night 1, then about one per Night (two on the pinned Nights 3 and 4)', () => {
  assert.deepEqual([...P.CORE_MACHINES].sort(), [...CORE12].sort());
  assert.deepEqual([...P.STARTERS].sort(), ['bigone', 'coinflip', 'hilo']);
  for (const seed of [undefined, 5, 99]) {
    const per = P.scheduleFor(seed).map((s) => s.ids.length);
    assert.deepEqual(per, [3, 1, 2, 2, 1, 1, 2], `seed ${seed}`);
  }
});

test('every game stands once in the pit (Mouth, Well or Lobby): arrival, the Big One dais, the lobby, with the wings holding story tables', () => {
  const asg = L.assignment('debt');
  const slot = new Map(L.SLOTS.map((s) => [s.id, s]));
  const placed = (id) => Object.entries(asg).filter(([s, m]) => m === id && ['mouth', 'well', 'lobby'].includes(slot.get(s).zone));
  for (const id of [...TEN, 'cascade']) assert.equal(placed(id).length, 1, `${id} has exactly one pit seat`);
  assert.equal(placed('derby').length, 0, 'the XL Night Derby has no XL pit slot, so it stands in the Midway');
  assert.equal(asg['MID-02'], 'derby');
  assert.equal(asg['WELL-01'], 'bigone');
  assert.equal(asg['MOUTH-TERM'], 'debt_terminal');
  for (const s of ['LOB-PAWN', 'LOB-CASH', 'LOB-JUKE', 'LOB-TONIC']) assert.ok(asg[s], `${s} keeps its vendor`);
  // no wing duplicates beyond the four themed ones, and nothing outside the ten plus the system/story devices
  const wingCore = Object.entries(asg).filter(([s, m]) => P.isCore(m) && !['mouth', 'well', 'lobby'].includes(slot.get(s).zone));
  assert.ok(wingCore.length <= 5, `${wingCore.length} core duplicates in the wings (four themed ones plus the Midway derby)`);
});

test('the starters sit around the Big One dais, a few steps from the spawn', () => {
  const asg = L.assignment('debt');
  const pos = new Map(L.SLOTS.map((s) => [s.id, s.pos]));
  for (const id of P.STARTERS) {
    const d = Object.entries(asg).filter(([, m]) => m === id).map(([s]) => Math.hypot(pos.get(s)[0], pos.get(s)[2] + 7.8));
    assert.ok(Math.min(...d) <= 8, `${id} is ${Math.min(...d).toFixed(1)} m from the spawn`);
  }
});

test('every slot origin lies inside its own zone rectangle (WELL-04 and WELL-09 were declared well but stood in the mouth)', () => {
  const rect = new Map(L.ZONES.map((z) => [z.id, z.rect]));
  const bad = [];
  for (const s of L.SLOTS) {
    const r = rect.get(s.zone);
    if (!r) continue;   // hollow / home tables live in their own far zones
    const [x, , z] = s.pos;
    if (x < r[0] || x > r[2] || z < r[1] || z > r[3]) bad.push(`${s.id} (${x},${z}) not in ${s.zone}`);
  }
  assert.deepEqual(bad, []);
  assert.equal(L.SLOTS.find((s) => s.id === 'WELL-04').zone, 'mouth');
  assert.equal(L.SLOTS.find((s) => s.id === 'WELL-09').zone, 'mouth');
});

test('LOB-PAWN stands clear of the south wall (its panel back at z 19.85)', () => {
  const pawn = L.SLOTS.find((s) => s.id === 'LOB-PAWN');
  assert.ok(pawn.pos[2] <= 19.0 && pawn.pos[2] >= 18.9, `pawn z ${pawn.pos[2]}`);
});

test('signposts: an up arrow points the way the reader of that face is walking', () => {
  const dest = { 'go.terminal': -25, 'go.terminalPhone': -25, 'go.vendors': 19, 'go.bank': -25, 'go.lift': -25, 'go.bell': -25, 'go.machines': -4 };
  let checked = 0;
  for (const sp of L.SIGNPOSTS) {
    for (const side of sp.sides) {
      if (side.arrow !== 'up') continue;
      const key = side.key;
      const z = key === 'go.floor' ? (sp.id === 'sp.mouth' ? -9 : 10) : dest[key];
      if (z === undefined) continue;
      // face N is read by someone walking south (+z), face S by someone walking north (-z)
      if (side.face === 'N') assert.ok(z > sp.pos[2], `${sp.id} N face says ${key} but it is behind a southbound walker`);
      else assert.ok(z < sp.pos[2], `${sp.id} S face says ${key} but it is behind a northbound walker`);
      checked++;
    }
  }
  assert.ok(checked >= 6, `only ${checked} up arrows checked`);
});

test('no pit zone is near-black: every ambient colour has a clear channel, and the fallback look mirrors the layout', () => {
  const lum = (c) => Math.max((c >> 16) & 255, (c >> 8) & 255, c & 255);
  for (const z of L.ZONES) {
    if (z.id === 'hollow' || z.id === 'home' || z.id === 'street' || z.id === 'lift') continue;
    assert.ok(lum(z.ambient) >= 0x2c, `${z.id} ambient 0x${z.ambient.toString(16)} is too dark`);
    assert.ok(z.fog.far >= 18, `${z.id} fog far ${z.fog.far}`);
    const g = ARCH.GDD_ZONE_LOOK[z.id];
    assert.equal(g.ambient, z.ambient, `${z.id} fallback ambient`);
    assert.equal(g.fog.far, z.fog.far, `${z.id} fallback fog`);
  }
  assert.ok(lum(ARCH.GDD_ZONE_LOOK.sump.ambient) > 0, 'the sump is not pitch black');
});

test('the sump walls are drawn and collide on the same numbers, standing above the sump floor', () => {
  assert.equal(DECOR.SUMP_HALF, 6);
  assert.equal(DECOR.SUMP_WALL_T, 0.3);
  assert.equal(DECOR.SUMP_WALL_H, 4);
  const level = src('src/world/level.ts');
  assert.match(level, /SUMP_HALF \+ SUMP_WALL_T/);
  assert.match(level, /SUMP_POS\[1\] \+ SUMP_WALL_H/);
  const decor = src('src/world/props/decor.ts');
  assert.doesNotMatch(decor, /pos: \[0, -2, -6\.15\]/, 'the old underground wall boxes are gone');
  assert.match(decor, /pos: \[0, wy, -wc\]/);
  assert.doesNotMatch(level, /zone: 'sump'/, 'the Sump is not a zone');
});

test('duel.laundry frames Mimosa\'s table LAU-10, not the bingo cage LAU-01', () => {
  const lau10 = L.SLOTS.find((s) => s.id === 'LAU-10').pos;
  assert.equal(L.assignment('debt')['LAU-10'], 'tallytable');
  const m = src('src/world/level.ts').match(/anchors\['duel\.laundry'\] = marker\(([-\d.]+), [\d.]+, ([-\d.]+)\)/);
  assert.ok(m, 'anchor line found');
  assert.equal(Number(m[1]), lau10[0]);
  assert.equal(Number(m[2]), lau10[2]);
});

test('the layout header carries no stale slot counts', () => {
  const head = src('src/world/layout.ts').slice(0, 1400);
  assert.doesNotMatch(head, /48 machine instances/);
  assert.doesNotMatch(head, /30 pads/);
});

test('area and lift copy exists in English and Turkish with the same placeholders', async () => {
  const S = (await load('src/world/props/props.strings.ts')).default;
  const ph = (x) => (x.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of ['sign.home', 'sign.arrivals', 'sign.well', 'sign.lobby', 'sign.backOfHouse', 'lift.due', 'lift.paid']) {
    assert.ok(S.en[k] && S.tr[k], k);
    assert.equal(ph(S.en[k]), ph(S.tr[k]), k);
  }
  assert.ok(S.en['lift.due'].includes('{n}'));
});

test('the buy sub-line no longer claims a bare "Opens now" next to the OPENS NIGHT plate', async () => {
  const S = (await load('src/game/progression.strings.ts')).default;
  assert.doesNotMatch(S.en['buy.sub'], /^Opens now/);
  assert.ok(S.en['buy.sub'].includes('{n}') && S.tr['buy.sub'].includes('{n}'));
});

// ── Wave 81: the interior pass (ceiling steps closed, the lived-in nave, the clock face) ─────────────────────────────────
test('wave 81: the Mouth to Well and Well to Lobby ceiling steps are closed with a bulkhead, and no wing ceiling sits below the 3.2 m lintel', () => {
  const level = src('src/world/level.ts');
  assert.match(level, /parlour: 3\.2, counting: 3\.2/, 'wing ceilings reach the doorway lintel (no slot into the attic)');
  assert.match(level, /z: -18\.1, dir: 1, y0: CEILING\.mouth, y1: CEILING\.well/);
  assert.match(level, /z: 2\.1, dir: -1, y0: CEILING\.lobby, y1: CEILING\.well/);
  assert.match(level, /buildCeilingSteps\(/);
  assert.match(level, /buildCeilingRoses\(/);
  assert.match(level, /JACK·ID/, 'the neon the bulkhead carries stays');
});

test('wave 81: the lounge plan keeps every walking piece off machines, their standing zones, doorway lanes and the central aisle', async () => {
  const LP = await load('src/world/props/loungePlan.ts');
  const slots = L.SLOTS.filter((s) => !L.STAGE_SLOTS.includes(s.id));
  const plan = LP.planLounge(slots.map((s) => LP.slotRect(s)));
  const solid = plan.items.filter((i) => ['plant', 'chair', 'table', 'bench', 'cart', 'torch'].includes(i.k));
  assert.ok(solid.length >= 20, `only ${solid.length} walking pieces`);
  for (const i of solid) {
    const fp = [i.x - 0.3, i.z - 0.3, i.x + 0.3, i.z + 0.3];
    for (const s of slots) {
      const r = LP.slotRect(s);
      assert.ok(fp[2] <= r[0] || fp[0] >= r[2] || fp[3] <= r[1] || fp[1] >= r[3], `${i.k} at ${i.x},${i.z} stands on ${s.id}`);
    }
    assert.ok(Math.abs(i.x) > 1.4 || i.z < -30 || i.z > 20, `${i.k} at ${i.x},${i.z} is in the central aisle`);
  }
  for (const k of ['rug', 'frame', 'sconce', 'pendant', 'ropes']) assert.ok(plan.items.some((i) => i.k === k), `${k} missing`);
  // the first five minutes: the Mouth, the Well and the Lobby each carry a lamp light and a rug
  for (const z of ['mouth', 'well', 'lobby']) assert.ok(plan.lights.some((l) => l.zone === z), `${z} has no lounge light`);
  assert.ok(plan.lights.length <= 14, 'the lounge adds a handful of light hints, not a field of them');
});

test('wave 81: the wall clock face is a round dial with evenly spaced numerals, a rim deadline band and no baked XIII', () => {
  const clock = src('src/world/props/clock.ts');
  assert.match(clock, /alphaTest: 0\.5/, 'the dial is cut round');
  assert.match(clock, /Math\.PI; a <= Math\.PI \* 1\.5/, 'the deadline band runs 9 to 12 o\'clock');
  assert.doesNotMatch(clock, /'XIII', cx/, 'the XIII is a label that shows on Night 8, not baked into the face');
  assert.match(clock, /xiii\.visible = false/);
});
