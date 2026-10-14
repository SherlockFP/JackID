// Wave 27: the progressive floor. Unlock schedule (game/progression.ts), the core layout (world/layout.ts) and a pure
// footprint lint of the main pit (Mouth, Well, Lobby): no overlaps, no blocked doorway lanes, aisles stay open.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);
let P, L, TYPES, I18N;
before(async () => {
  P = await load('src/game/progression.ts');
  L = await load('src/world/layout.ts');
  TYPES = await load('src/core/types.ts');
  I18N = await load('src/core/i18n.ts');
});

const CORE = ['bigone', 'coinflip', 'hilo', 'scratch', 'blackjack', 'roulette', 'plinko', 'mines', 'videopoker', 'bandit',
  'cyclone', 'mahjong', 'sonkart', 'pachinko', 'keno', 'craps'];
// def.slotSize of the core machines (src/machines/<id>/index.ts)
const SIZE = { bigone: 'XL', roulette: 'XL', craps: 'XL', blackjack: 'L', sonkart: 'L', keno: 'L', hilo: 'M', scratch: 'M', plinko: 'M',
  mines: 'M', videopoker: 'M', cyclone: 'M', mahjong: 'M', pachinko: 'M', coinflip: 'S', bandit: 'S' };
const RANK = { S: 0, M: 1, L: 2, XL: 3 };
const TIER_RANK = { SIMPLE: 0, CLASSIC: 1, TABLE: 2, HEAVY: 3 };

// ── schedule ─────────────────────────────────────────────────────────────────────────────────────────
test('the core set is the director list of 16 and every machine unlocks exactly once', () => {
  assert.deepEqual([...P.CORE_MACHINES].sort(), [...CORE].sort());
  for (const seed of [undefined, 1, 7, 12345, 99999]) {
    const all = P.scheduleFor(seed).flatMap((s) => [...s.ids]);
    assert.equal(all.length, 16, `seed ${seed}`);
    assert.deepEqual([...new Set(all)].sort(), [...CORE].sort(), `seed ${seed}`);
  }
});

test('Night 1 opens exactly the four starters; Nights 2 to 7 open two each; Night 8 opens nothing and everything is on', () => {
  for (const seed of [undefined, 3, 42]) {
    assert.deepEqual([...P.unlockedFor(1, seed)].sort(), ['bigone', 'coinflip', 'hilo', 'scratch']);
    for (let n = 2; n <= 7; n++) assert.equal(P.opensOn(n, seed).length, 2, `Night ${n}`);
    assert.equal(P.opensOn(8, seed).length, 0);
    assert.equal(P.unlockedFor(8, seed).length, 16);
    assert.equal(P.nextOpening(7, seed), null);
    assert.equal(P.nextOpening(1, seed).night, 2);
  }
});

test('unlockedFor is cumulative and monotonic, and Night < 1 reads as Night 1', () => {
  let prev = [];
  for (let n = 1; n <= 9; n++) {
    const now = P.unlockedFor(n);
    assert.ok(prev.every((id) => now.includes(id)), `Night ${n} dropped a machine`);
    assert.ok(now.length >= prev.length);
    prev = now;
  }
  assert.deepEqual(P.unlockedFor(0), P.unlockedFor(1));
  assert.deepEqual(P.unlockedFor(-5), P.unlockedFor(1));
});

test('simple to complex: a tier never opens before an easier one, whatever the seed', () => {
  for (const seed of [undefined, 1, 2, 3, 77, 4096, 2 ** 31]) {
    const order = P.scheduleFor(seed).flatMap((s) => [...s.ids]);
    const ranks = order.map((id) => TIER_RANK[P.tierOf(id)]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `seed ${seed}: ${order.join()}`);
  }
  // the canonical order ends on craps (the least readable core machine)
  const canon = P.scheduleFor().flatMap((s) => [...s.ids]);
  assert.equal(canon.at(-1), 'craps');
  assert.equal(canon.slice(0, 4).join(), 'bigone,coinflip,hilo,scratch');
});

test('the schedule is seeded: same seed, same schedule; other seeds reorder inside tiers', () => {
  const key = (seed) => JSON.stringify(P.scheduleFor(seed));
  assert.equal(key(555), key(555));
  assert.equal(key(undefined), key(0));
  const seen = new Set();
  for (let s = 1; s <= 30; s++) seen.add(key(s));
  assert.ok(seen.size >= 8, `only ${seen.size} distinct schedules in 30 seeds`);
});

test('isNew is true only on the Night a machine opened (never Night 1) and newOn lists them', () => {
  for (const seed of [undefined, 9]) {
    for (let n = 1; n <= 8; n++) {
      for (const id of CORE) {
        assert.equal(P.isNew(id, n, seed), n >= 2 && P.unlockNightOf(id, seed) === n, `${id} Night ${n}`);
      }
      assert.deepEqual([...P.newOn(n, seed)].sort(), CORE.filter((id) => P.isNew(id, n, seed)).sort());
    }
  }
  assert.equal(P.isNew('craps', 3), false);
  assert.equal(P.isNew('bigone', 1), false);
});

test('locks: covered until its Night, always-open devices never lock, the Free Casino shows everything', () => {
  assert.equal(P.isLockedFor('plinko', 1, 'debt'), true);
  assert.equal(P.isLockedFor('plinko', 2, 'debt'), false);
  assert.equal(P.isLockedFor('bigone', 1, 'debt'), false);
  assert.equal(P.isLockedFor('craps', 6, 'coop'), true);
  assert.equal(P.isLockedFor('craps', 7, 'coop'), false);
  for (const id of ['debt_terminal', 'hotline', 'cashier', 'charm_vendor', 'jukebox', 'tonic_vendor', 'bounty_board', 'shrine', 'tallytable', 'devilstable']) {
    assert.equal(P.isLockedFor(id, 1, 'debt'), false, id);
  }
  for (const id of CORE) assert.equal(P.isLockedFor(id, 1, 'free'), false, id);
  assert.equal(P.isLockedFor('claw', 1, 'free'), false);
  assert.equal(P.isFreeOnly('claw'), true);
  assert.equal(P.inMode('claw', 'debt'), false);
  assert.equal(P.inMode('claw', 'free'), true);
  assert.equal(P.inMode('bigone', 'debt'), true);
  // a run seed moves the Night but the lock always agrees with unlockNightOf
  for (const id of CORE) {
    const n = P.unlockNightOf(id, 11);
    assert.equal(P.isLockedFor(id, n - 1, 'debt', 11), n > 1, id);
    assert.equal(P.isLockedFor(id, n, 'debt', 11), false, id);
  }
});

test('effectiveNight: the Dawn after a paid Night already opens the next one', () => {
  assert.equal(P.effectiveNight(1, false), 1);
  assert.equal(P.effectiveNight(1, true), 2);
  assert.equal(P.effectiveNight(8, true, true), 8);
  assert.equal(P.effectiveNight(4, true), 5);
});

test('copy: the NEW toast and the OPENS plate read in both languages', async () => {
  const mod = (await load('src/game/progression.strings.ts')).default;
  assert.deepEqual(Object.keys(mod.en).sort(), Object.keys(mod.tr).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(mod.en)) assert.equal(ph(mod.en[k]), ph(mod.tr[k]), k);
  I18N.registerStrings(mod.prefix, { en: mod.en, tr: mod.tr });
  I18N.setLang('en');
  assert.equal(P.newOnFloorText(1), null);
  const names = { plinko: 'Plinko', mines: 'Mines', bandit: 'Bandit', videopoker: 'Video Poker' };
  const txt = P.newOnFloorText(2, undefined, (id) => names[id] ?? id);
  assert.match(txt, /^NEW ON THE FLOOR: /);
  assert.equal(P.opensText('plinko'), 'OPENS NIGHT 2');
  I18N.setLang('tr');
  assert.equal(P.opensText('plinko'), 'GECE 2 AÇILIR');
  assert.match(P.newOnFloorText(2, undefined, (id) => id), /^SALONDA YENİ: /);
  I18N.setLang('en');
});

// ── layout: assignment ───────────────────────────────────────────────────────────────────────────────
test('a Debt Run is built from core machines and always-open devices only; every core machine stands in the main pit', () => {
  const asg = L.assignment('debt');
  for (const [slot, id] of Object.entries(asg)) {
    assert.ok(P.isCore(id) || P.ALWAYS_OPEN.has(id), `${slot}: ${id} is Free-Casino-only`);
  }
  const slot = new Map(L.SLOTS.map((s) => [s.id, s]));
  for (const id of CORE) {
    const inPit = Object.entries(asg).filter(([s, m]) => m === id && ['mouth', 'well', 'lobby'].includes(slot.get(s).zone));
    assert.ok(inPit.length >= 1, `${id} is hidden in a wing`);
  }
  // machines fit their slot
  for (const [s, id] of Object.entries(asg)) {
    if (!(id in SIZE)) continue;
    assert.ok(RANK[SIZE[id]] <= RANK[slot.get(s).size], `${id} (${SIZE[id]}) does not fit ${s} (${slot.get(s).size})`);
  }
  for (const mode of ['coop', 'versus']) assert.deepEqual(L.assignment(mode), asg, mode);
});

test('busy floor keeps the core-only rule, and the Free Casino keeps every machine of the old floor', () => {
  const busy = L.assignment('debt', { busyFloor: true });
  for (const id of Object.values(busy)) assert.ok(P.isCore(id) || P.ALWAYS_OPEN.has(id), id);
  const free = L.assignment('free');
  const ids = new Set(Object.values(free));
  for (const id of ['claw', 'pachislot', 'fruitmachine', 'baccarat', 'bingo', 'derby', 'tombola', 'shellgame', 'fortuneteller', 'threecard', 'tavla', 'pisti', 'lootbox', 'stacker', 'elevator']) {
    assert.ok(ids.has(id), `${id} missing from the Free Casino`);
  }
  for (const id of CORE) assert.ok(ids.has(id), `${id} missing from the Free Casino`);
  assert.deepEqual(L.ASSIGN.free, L.FREE_ASSIGN);
});

test('the duel tables, shrine and Parlour devices survive the rework', () => {
  const asg = L.assignment('debt');
  for (const s of ['PAR-05', 'CARD-08', 'BOI-07', 'LAU-10', 'CNT-03']) assert.equal(asg[s], 'tallytable', s);
  assert.equal(asg['PAR-SHRINE'], 'shrine');
  assert.equal(asg['MOUTH-TERM'], 'debt_terminal');
  assert.equal(asg['MOUTH-PHONE'], 'hotline');
});

test('the Pit Deck shuffle is a Free Casino feature: any other mode keeps the fixed floor', () => {
  const cat = [['videopoker', 'M', 'CARDS', 'SWINGY'], ['scratch', 'M', 'REELS', 'SWINGY'], ['cyclone', 'M', 'WHEELS', 'STEADY'],
    ['pachinko', 'M', 'DROPS', 'WILD'], ['pachislot', 'M', 'REELS', 'WILD'], ['fortuneteller', 'M', 'CURIOS', 'STEADY'],
    ['hilo', 'M', 'CARDS', 'WILD'], ['bandit', 'S', 'REELS', 'WILD']]
    .map(([id, slotSize, suit, volatility]) => ({ id, slotSize, tier: 1, seats: 1, suit, volatility }));
  const fixed = Object.fromEntries(L.ROSTER_PADS.map((p) => [p, L.DEFAULT_ASSIGN[p]]));
  for (let seed = 1; seed <= 20; seed++) assert.deepEqual(L.rosterFor(seed, cat, 'debt'), fixed);
  assert.notDeepEqual(L.rosterFor(5, cat, 'free'), fixed);
});

// ── layout: footprint lint of the main pit ───────────────────────────────────────────────────────────
const PIT = new Set(['mouth', 'well', 'lobby']);
// wall-mounted counters and the terminal bank (flush to a wall by design)
const WALL_MOUNTED = new Set(['MOUTH-TERM', 'MOUTH-PHONE', 'LOB-PAWN', 'LOB-PHONE2', 'LOB-DESK', 'LOB-CASH']);
const HALL = { x0: -10.85, x1: 10.85, z0: -29.85, z1: 19.85 };
const COLUMNS = [-27, -21, -15, -9, -3, 3, 9, 15].flatMap((z) => [-7, 7].map((x) => ({ x0: x - 0.45, x1: x + 0.45, z0: z - 0.45, z1: z + 0.45, name: `column(${x},${z})` })));
const HOLE = { x0: -1.3, x1: 1.3, z0: 10.7, z1: 13.3, name: 'trapdoor' };   // 2 x 2 plate + a 0.3 m lip
const DOORS = [[-25, -21], [-11, -7], [3, 7], [15, 17]];
const FRONT = { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] };

function rects(slot) {
  const d = TYPES.SLOT_DIMS[slot.size];
  const sw = slot.rotY % 180 === 0;
  const hw = (sw ? d.w : d.d) / 2, hd = (sw ? d.d : d.w) / 2;
  const [x, , z] = slot.pos;
  const body = { x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd, name: slot.id };
  const [fx, fz] = FRONT[slot.rotY];
  const stand = {
    x0: Math.min(body.x0, body.x0 + fx * d.stand), x1: Math.max(body.x1, body.x1 + fx * d.stand),
    z0: Math.min(body.z0, body.z0 + fz * d.stand), z1: Math.max(body.z1, body.z1 + fz * d.stand), name: `${slot.id}.stand`,
  };
  if (fx > 0) { stand.x0 = body.x1; stand.x1 = body.x1 + d.stand; }
  if (fx < 0) { stand.x1 = body.x0; stand.x0 = body.x0 - d.stand; }
  if (fz > 0) { stand.z0 = body.z1; stand.z1 = body.z1 + d.stand; }
  if (fz < 0) { stand.z1 = body.z0; stand.z0 = body.z0 - d.stand; }
  return { body, stand };
}
const hit = (a, b, eps = 0.02) => a.x0 < b.x1 - eps && a.x1 > b.x0 + eps && a.z0 < b.z1 - eps && a.z1 > b.z0 + eps;

test('pit lint: footprints stay inside the hall and clear of columns, the trapdoor and each other', () => {
  const pit = L.SLOTS.filter((s) => PIT.has(s.zone) && s.y === undefined && !WALL_MOUNTED.has(s.id));
  const bad = [];
  const R = pit.map((s) => ({ s, ...rects(s) }));
  for (const { s, body } of R) {
    if (body.x0 < HALL.x0 - 0.02 || body.x1 > HALL.x1 + 0.02 || body.z0 < HALL.z0 - 0.02 || body.z1 > HALL.z1 + 0.02) bad.push(`${s.id} leaves the hall`);
    for (const c of COLUMNS) if (hit(body, c)) bad.push(`${s.id} overlaps ${c.name}`);
    if (hit(body, HOLE)) bad.push(`${s.id} overlaps the trapdoor`);
  }
  for (let i = 0; i < R.length; i++) {
    for (let j = i + 1; j < R.length; j++) if (hit(R[i].body, R[j].body)) bad.push(`${R[i].s.id} overlaps ${R[j].s.id}`);
  }
  assert.deepEqual(bad, []);
});

test('pit lint: the stand zone of every machine is free of other machines, columns and the trapdoor', () => {
  const pit = L.SLOTS.filter((s) => PIT.has(s.zone) && s.y === undefined && !WALL_MOUNTED.has(s.id));
  const R = pit.map((s) => ({ s, ...rects(s) }));
  const bad = [];
  for (const a of R) {
    for (const b of R) if (a !== b && hit(a.stand, b.body)) bad.push(`${a.s.id} stand blocked by ${b.s.id}`);
    for (const c of COLUMNS) if (hit(a.stand, c)) bad.push(`${a.s.id} stand blocked by ${c.name}`);
    if (hit(a.stand, HOLE)) bad.push(`${a.s.id} stand over the trapdoor`);
  }
  assert.deepEqual(bad, []);
});

test('pit lint: doorway lanes (3 m deep) and the central aisle stay open; the spawn arc is clear', () => {
  const pit = L.SLOTS.filter((s) => PIT.has(s.zone) && s.y === undefined && !WALL_MOUNTED.has(s.id));
  const R = pit.map((s) => ({ s, ...rects(s) }));
  const bad = [];
  for (const [z0, z1] of DOORS) {
    for (const side of [-1, 1]) {
      const lane = side < 0 ? { x0: -10.85, x1: -7.85, z0, z1, name: `lane W ${z0}` } : { x0: 7.85, x1: 10.85, z0, z1, name: `lane E ${z0}` };
      for (const r of R) if (hit(lane, r.body) || hit(lane, r.stand)) bad.push(`${r.s.id} blocks ${lane.name}`);
    }
  }
  const aisle = { x0: -1.4, x1: 1.4, z0: -29, z1: 19, name: 'aisle' };
  for (const r of R) if (r.s.id !== 'WELL-01' && hit(aisle, r.body)) bad.push(`${r.s.id} is in the central aisle`);
  const spawn = [[0, -7.8], [0.5, -7.77], [-0.5, -7.77], [1.45, -7.51], [-1.45, -7.51], [2.31, -7.01], [-2.31, -7.01], [3.01, -6.31], [-3.01, -6.31]];
  for (const [x, z] of spawn) {
    const p = { x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 };
    for (const r of R) if (hit(p, r.body) || hit(p, r.stand)) bad.push(`spawn (${x},${z}) inside ${r.s.id}`);
  }
  assert.deepEqual(bad, []);
});

test('pit lint: the starters sit within 8 m of the spawn, the whole core within the pit', () => {
  const asg = L.assignment('debt');
  const pos = new Map(L.SLOTS.map((s) => [s.id, s.pos]));
  for (const id of P.STARTERS) {
    const near = Object.entries(asg).filter(([, m]) => m === id).map(([s]) => Math.hypot(pos.get(s)[0] - 0, pos.get(s)[2] + 7.8));
    assert.ok(Math.min(...near) <= 8, `${id} is ${Math.min(...near).toFixed(1)} m from the spawn`);
  }
  // signposts reference real, placed data
  assert.ok(Array.isArray(L.SIGNPOSTS) && L.SIGNPOSTS.length >= 4);
  for (const sp of L.SIGNPOSTS) {
    assert.ok(sp.pos.length === 3 && sp.sides.length >= 1, sp.id);
    for (const side of sp.sides) assert.ok(['left', 'right', 'up', 'down'].includes(side.arrow), `${sp.id} arrow`);
  }
});
