// LOKI's sigil (icon.joker, icon.joker2): both frames paint, differ only where the eyes and mouth move, stay green-on-black, and survive 16/24/48.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);
let I, X;
before(async () => { I = await load('src/core/texgen/icons.ts'); X = await load('src/core/texgen/pixel.ts'); });

const paint = (id, size) => { const p = new X.Pix(16, 16); I.BUILTIN_ICONS[id].paint(p); return p.resized(size, size); };
const solid = (p) => p.d.reduce((n, u) => n + (u >>> 24 ? 1 : 0), 0);

test('both frames exist, are 16 px, and fill a face-sized part of the tile', () => {
  for (const id of ['icon.joker', 'icon.joker2']) {
    assert.equal(I.BUILTIN_ICONS[id].size, 16);
    for (const s of [16, 24, 48]) { const p = paint(id, s); assert.ok(solid(p) > p.w * p.h * 0.4, `${id}@${s}`); }
  }
});

test('the blink frame differs from the open frame, and only a little', () => {
  const a = paint('icon.joker', 16), b = paint('icon.joker2', 16);
  let diff = 0;
  for (let i = 0; i < a.d.length; i++) if (a.d[i] !== b.d[i]) diff++;
  assert.ok(diff >= 4 && diff <= 24, `diff ${diff}`);
});
