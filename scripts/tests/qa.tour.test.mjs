// QA bench: the PNG brightness check that tells a black shot from a drawn one, and the tour's fixed shot list (no duplicates, and
// every checkpoint the tour takes is in the list, so tour.json can name each one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngStats, parseRunSteps } from '../qa/bench.mjs';
import { TOUR_SHOTS } from '../qa/tour.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A PNG of rows (arrays of RGB or RGBA bytes), every row with its own filter type (the same bytes the encoder would write). */
function png(w, h, ct, rows) {
  const bpp = ct === 6 ? 4 : 3;
  const raw = [];
  let prev = new Array(w * bpp).fill(0);
  rows.forEach(({ filter, px }) => {
    raw.push(filter);
    for (let x = 0; x < w * bpp; x++) {
      const a = x >= bpp ? px[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const pred = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1
        : filter === 4 ? (() => { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })() : 0;
      raw.push((px[x] - pred) & 255);
    }
    prev = px;
  });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);   // the CRC is not read
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ct;
  return Buffer.concat([Buffer.alloc(8), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
}

test('pngStats reads a black frame as 0 and a bright one by its mean, through every filter type', () => {
  const dark = png(8, 4, 6, Array.from({ length: 4 }, () => ({ filter: 0, px: new Array(32).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 0)) })));
  assert.equal(pngStats(dark).mean, 0);
  for (const filter of [0, 1, 2, 3, 4]) {
    const grey = png(8, 8, 2, Array.from({ length: 8 }, () => ({ filter, px: new Array(24).fill(100) })));
    const s = pngStats(grey);
    assert.deepEqual([s.w, s.h, Math.round(s.mean)], [8, 8, 100], `filter ${filter}`);
  }
});

test('the tour shot list has no duplicate, and every shot the tour takes is in it', () => {
  assert.equal(new Set(TOUR_SHOTS).size, TOUR_SHOTS.length);
  assert.ok(TOUR_SHOTS.length >= 30 && TOUR_SHOTS.length <= 40, `${TOUR_SHOTS.length} shots`);
  const src = readFileSync(join(HERE, '..', 'qa', 'tour.mjs'), 'utf8');
  const used = [...src.matchAll(/snap\('([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const name of used) assert.ok(TOUR_SHOTS.includes(name), `snap("${name}") is not in TOUR_SHOTS`);
  for (const name of TOUR_SHOTS) assert.ok(used.includes(name) || /walk-/.test(name), `"${name}" is never taken`);
});

test('the run steps the tour uses parse', () => {
  for (const s of ['goto:bigone', 'goto:debt_terminal', 'goto:cashier', 'goto:coinflip', 'stand', 'lever', 'phone:open', 'station:computer', 'home:sleep', 'walk:home']) {
    assert.equal(parseRunSteps(s).length, 1, s);
  }
});
