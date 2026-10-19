// Wayfinding: the diamond's screen placement and no-progress clock (src/menu/hud/waymark.ts), the floor trail's dots
// (src/world/props/wayfinding.ts), and the floor plan, bearings and signs read from the layout (src/world/floorplan.ts, layout.ts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let W, T, F, L;
before(async () => {
  W = await load('src/menu/hud/waymark.ts');
  T = await load('src/world/props/wayfinding.ts');
  F = await load('src/world/floorplan.ts');
  L = await load('src/world/layout.ts');
});

// a 16:9 view, 90 degree vertical fov: p11 = 1, p00 = 9/16
const P00 = 9 / 16, P11 = 1, SW = 1280, SH = 720;
const PAD = { x: 40, top: 80, bottom: 40 };

test('placeMark: straight ahead lands mid-screen and counts as on screen', () => {
  const m = W.placeMark({ x: 0, y: 0, z: -10 }, P00, P11, SW, SH, PAD);
  assert.equal(m.on, true);
  assert.ok(Math.abs(m.x - SW / 2) < 1e-6 && Math.abs(m.y - SH / 2) < 1e-6);
});

test('placeMark: off to the right sticks to the right edge with the arrow turned right; behind the camera points back', () => {
  const r = W.placeMark({ x: 30, y: 0, z: -5 }, P00, P11, SW, SH, PAD);
  assert.equal(r.on, false);
  assert.ok(Math.abs(r.x - (SW - 40)) < 1e-6, `x ${r.x}`);
  assert.ok(Math.abs(r.angle - Math.PI / 2) < 1e-6, `angle ${r.angle}`);
  const b = W.placeMark({ x: 0, y: 0, z: 5 }, P00, P11, SW, SH, PAD);   // dead behind: the bottom edge, arrow down
  assert.equal(b.on, false);
  assert.ok(Math.abs(b.y - (SH - PAD.bottom)) < 1e-6 && Math.abs(Math.abs(b.angle) - Math.PI) < 1e-6, `${b.y} ${b.angle}`);
  const lb = W.placeMark({ x: -4, y: 0, z: 2 }, P00, P11, SW, SH, PAD);   // behind and to the left: the left half
  assert.ok(lb.x < SW / 2 && !lb.on);
});

test('placeMark: an edge point always sits inside the padded box', () => {
  for (const c of [{ x: 50, y: 40, z: -3 }, { x: -9, y: -9, z: 1 }, { x: 0, y: 12, z: -1 }, { x: 3, y: 0, z: 0.0005 }]) {
    const m = W.placeMark(c, P00, P11, SW, SH, PAD);
    assert.ok(m.x >= 40 - 1e-6 && m.x <= SW - 40 + 1e-6 && m.y >= PAD.top - 1e-6 && m.y <= SH - PAD.bottom + 1e-6, JSON.stringify(m));
  }
});

test('clearOfPanels: a mark under a corner panel slides out of it; an edge arrow slides down and stays on the edge; a clear mark is left alone', () => {
  const px = 3, w = 1920, h = 1080;
  const right = { x0: 1500, y0: 12, x1: 1908, y1: 400 };   // the quota stack
  const left = { x0: 12, y0: 12, x1: 260, y1: 200 };        // the wallet column
  const clear = { x: 900, y: 500, on: true, angle: 0 };
  assert.deepEqual(W.clearOfPanels(clear, [left, right], px, w, h), clear, 'clear of both: untouched');
  const under = W.clearOfPanels({ x: 1700, y: 380, on: true, angle: 0 }, [left, right], px, w, h);   // 20 px above the stack's bottom edge
  assert.ok(under.y >= right.y1 + 10 * px - 1e-6 && under.x === 1700, `slides down under the stack, ${JSON.stringify(under)}`);
  const inside = W.clearOfPanels({ x: 1520, y: 200, on: true, angle: 0 }, [left, right], px, w, h);   // near the stack's left side: out sideways
  assert.ok(inside.x <= right.x0 - 12 * px + 1e-6 && inside.y === 200, `slides out to the left, ${JSON.stringify(inside)}`);
  const edge = W.clearOfPanels({ x: w - 38, y: 150, on: false, angle: Math.PI / 2 }, [left, right], px, w, h);
  assert.ok(edge.x === w - 38 && edge.y >= right.y1 + 10 * px - 1e-6 && !edge.on && edge.angle === Math.PI / 2, `an arrow stays on the edge and keeps its turn, ${JSON.stringify(edge)}`);
  const l = W.clearOfPanels({ x: 38, y: 150, on: false, angle: -Math.PI / 2 }, [left, right], px, w, h);
  assert.ok(l.x === 38 && l.y >= left.y1 + 10 * px - 1e-6, `the left column too, ${JSON.stringify(l)}`);
  assert.ok(W.clearOfPanels({ x: 100, y: 1070, on: false, angle: 0 }, [], px, w, h).y <= h - 41, 'never below the screen');
  const sub = { x0: 600, y0: 900, x1: 1320, y1: 1000 };   // the subtitle box
  const over = W.clearOfPanels({ x: 900, y: 930, on: true, angle: 0 }, [sub], px, w, h);
  assert.ok(over.x === 900 && over.y + 7 * px + 20 <= sub.y0 + 1e-6, `a mark on the subtitle box rises above it, ${JSON.stringify(over)}`);
});

test('stall clock: 20 s without 1 m of progress latches; progress resets it; a new spot restarts it', () => {
  const s = W.createStall();
  assert.equal(s.update('bigone', 30, 0), false);
  assert.equal(s.update('bigone', 30, 19), false);
  assert.equal(s.update('bigone', 29.5, 0.5), false, 'half a metre is not progress');
  assert.equal(s.update('bigone', 29, 1), true, '20 s in, still no metre');
  assert.equal(s.update('bigone', 10, 0.1), true, 'once lost, it stays on for that spot');
  assert.equal(s.update('bell', 10, 0), false, 'a new spot restarts');
  const t2 = W.createStall();
  t2.update('a', 30, 0);
  t2.update('a', 30, 15);
  assert.equal(t2.update('a', 28, 10), false, 'two metres closer resets the clock');
  assert.equal(t2.update('a', 28, 19), false);
  assert.equal(t2.update('a', 28, 2), true);
});

test('waymarkWanted: Nights 1-2 when on; later only when stalled; never when the setting is off', () => {
  assert.equal(W.waymarkWanted(1, true, false), true);
  assert.equal(W.waymarkWanted(2, true, false), true);
  assert.equal(W.waymarkWanted(3, true, false), false);
  assert.equal(W.waymarkWanted(3, true, true), true);
  assert.equal(W.waymarkWanted(1, false, true), false);
});

test('trailDots: every step along the line, none within the trim of the end', () => {
  const d = T.trailDots([[0, 0], [0, 10]], 1, 0.6);
  assert.deepEqual(d[0], [0, 0]);
  assert.equal(d.length, 10);   // 0..9; a dot at 10 would sit on the end
  assert.ok(d.every(([, z], i) => Math.abs(z - i) < 1e-9));
  const bent = T.trailDots([[0, 0], [3, 0], [3, 3]], 1.5, 0.6);
  assert.deepEqual(bent.map(([x, z]) => [x, z]), [[0, 0], [1.5, 0], [3, 0], [3, 1.5]]);
  assert.deepEqual(T.trailDots([], 1), []);
});

test('trailPath: lift stand to the Big One runs down the central aisle and never doubles back to the wall', () => {
  const big = F.standSpot('bigone'), lift = [L.LIFT_DOOR.x, L.LIFT_DOOR.z + 1.4];
  const p = T.trailPath(lift, [big.x, big.z]);
  assert.deepEqual(p[0], lift);
  assert.deepEqual(p[p.length - 1], [big.x, big.z]);
  assert.ok(p.every(([, z]) => z >= L.LIFT_DOOR.z + 1.3), 'no point behind the start');
  for (let i = 1; i < p.length; i++) assert.ok(p[i][1] >= p[i - 1][1] - 1e-9, 'it heads south the whole way');
});

test('bearing: ahead, right, left, behind from a yaw (forward is -sin, -cos)', () => {
  // yaw 0 faces -z: +x is on the right
  assert.equal(F.bearing(0, 0, 0, 0, -10), 'ahead');
  assert.equal(F.bearing(0, 0, 0, 10, 0), 'right');
  assert.equal(F.bearing(0, 0, 0, -10, 0), 'left');
  assert.equal(F.bearing(0, 0, 0, 0, 10), 'behind');
  // turned half way round (yaw PI faces +z): the sides swap
  assert.equal(F.bearing(0, 0, Math.PI, 10, 0), 'left');
  assert.equal(F.bearing(0, 0, Math.PI, 0, 10), 'ahead');
  // quarter turn left (yaw PI/2 faces -x)
  assert.equal(F.bearing(0, 0, Math.PI / 2, -10, 0), 'ahead');
});

test('bar directions come from the layout: the machines and the bank lie north of the Bar', () => {
  const north = F.barDirections(L.BAR_POS.x, L.BAR_POS.z - 1, 0);   // facing -z
  assert.deepEqual(north, { machines: 'ahead', bank: 'ahead' });
  const east = F.barDirections(L.BAR_POS.x, L.BAR_POS.z - 1, -Math.PI / 2);   // facing +x: north is on the left
  assert.deepEqual(east, { machines: 'left', bank: 'left' });
  const big = F.slotOf('bigone'), bank = F.slotOf('debt_terminal');
  assert.ok(big && bank && bank.z < big.z, 'the terminal is north of the Big One');
});

test('floor plan: zones fit the box, the four landmarks are pinned, the player dot only appears on the pit floor', () => {
  const plan = F.floorPlan({ zoneOpen: (z) => z === 'midway', machines: [[0, -4], [5, -13]], you: { x: 0, z: 0, yaw: 0 } }, 144, 128);
  assert.ok(plan.w <= 144 && plan.h <= 128);
  for (const z of plan.zones) assert.ok(z.x >= 0 && z.y >= 0 && z.x + z.w <= plan.w + 1 && z.y + z.h <= plan.h + 1, z.id);
  assert.equal(new Set(plan.zones.map((z) => z.id)).size, plan.zones.length);
  assert.ok(!plan.zones.some((z) => ['lift', 'hollow', 'home'].includes(z.id)), 'the car, the Underneath and the apartment are not on the plan');
  assert.deepEqual(plan.pins.map((p) => p.kind).sort(), ['bank', 'bar', 'bell', 'lift']);
  assert.equal(plan.zones.find((z) => z.id === 'midway').open, true);
  assert.equal(plan.zones.find((z) => z.id === 'boiler').open, false, 'a shut wing');
  assert.equal(plan.zones.find((z) => z.id === 'well').open, true, 'an ungated zone is open');
  assert.equal(plan.dots.length, 2);
  assert.ok(plan.you);
  const away = F.floorPlan({ zoneOpen: () => true, machines: [], you: { x: 120, z: 120, yaw: 0 } }, 144, 128);
  assert.equal(away.you, null, 'the Underneath is off the plan');
  // the lift, the terminal and the Bell stand within 6 m on the north wall: their number boxes must not overlap
  for (const p of plan.pins) for (const q of plan.pins) {
    if (p !== q && Math.abs(p.y - q.y) < 2 * F.PIN_H) assert.ok(Math.abs(p.x - q.x) >= F.PIN_W, `${p.kind} / ${q.kind} overlap`);
  }
  // the lift is in the north wall and the bar in the south of the pit: the plan keeps that order
  const lift = plan.pins.find((p) => p.kind === 'lift'), bar = plan.pins.find((p) => p.kind === 'bar');
  assert.ok(lift.y < bar.y);
});

test('signs: the arrows match the layout, read as the walker of that face sees them', () => {
  const sp = (id) => L.SIGNPOSTS.find((s) => s.id === id);
  const bar = sp('sp.bar');
  const n = bar.sides.find((s) => s.face === 'N');
  assert.equal(n.key, 'go.bar');
  // face N is read walking south (+z): their right hand is -x. The bar lies at -x of the board, so the arrow is right.
  assert.ok(L.BAR_POS.x < bar.pos[0] && n.arrow === 'right');
  // every label the new boards use exists in both languages
  const keys = new Set(L.SIGNPOSTS.flatMap((s) => s.sides.map((x) => x.key)));
  for (const k of ['go.machines', 'go.bank', 'go.lift', 'go.bell', 'go.bar']) assert.ok(keys.has(k), k);
  // the lift and Bell boards hang over their own approach line (within a few metres of the target's x)
  assert.ok(Math.abs(sp('sp.lift').pos[0] - L.LIFT_DOOR.x) < 0.5);
  assert.ok(Math.abs(sp('sp.bell').pos[0] - L.BELL_POS.x) < 1.5);
  // no two boards at the same height overlap in x
  const boards = L.SIGNPOSTS.filter((s) => Math.abs(s.pos[2] - -20.6) < 0.01).sort((a, b) => a.pos[0] - b.pos[0]);
  for (let i = 1; i < boards.length; i++) assert.ok(boards[i - 1].pos[0] + boards[i - 1].w / 2 < boards[i].pos[0] - boards[i].w / 2, `${boards[i - 1].id} / ${boards[i].id}`);
});
