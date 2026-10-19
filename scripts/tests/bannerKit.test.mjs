// Banner helpers (src/core/ui/bannerKit.ts): the size a banner takes in the centre column, and the toast a banner becomes while seated.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let K;
before(async () => { K = await load('src/core/ui/bannerKit.ts'); });

const COL = 300 * 3;          // the column at 1080p: 46 % of 1920 is 883, 300 UI px of 3 is 900: the smaller one rules

test('fitBannerSize: the wanted size when it fits one row, then 16, then 8 (which may wrap)', () => {
  assert.equal(K.fitBannerSize('GECE 2', 24, COL, 3), 24);                         // 6 letters x 72 px
  assert.equal(K.fitBannerSize('SON ÇAĞRI', 24, COL, 3), 24);                      // 9 letters + a word gap: 691 px
  assert.equal(K.fitBannerSize('ZİL: 2:30 SONRA', 24, COL, 3), 16);                // 16.2 em: 1166 px at 24, 777 at 16
  assert.equal(K.fitBannerSize('+7 ÇEKİŞ · YENİ VARDİYA', 16, COL, 3), 8);         // 24.8 em x 48 = 1190 px > 900: steps down to 8
  assert.equal(K.fitBannerSize('SPOTLIGHT: YAZI-TURA KABİNİ ×1,25 ÖDER, HER 5. OYUNDA BİR BİLET', 16, COL, 3), 8);
  assert.equal(K.fitBannerSize('HELLO', 8, COL, 3), 8, 'never above the wanted size');
  assert.equal(K.fitBannerSize('X'.repeat(200), 24, COL, 3), 8, 'a very long line is 8 and wraps');
});

test('fitBannerSize: a narrow window shrinks the size, the same line fits at a larger one when the column is wide', () => {
  const line = 'LAST CALL!!';
  assert.equal(K.fitBannerSize(line, 24, 1400, 3), 24);
  assert.equal(K.fitBannerSize(line, 24, 400, 3), 8);
});

test('bannerToastKind: red = bad, gold = money, violet = curse, cyan = sys, green = good, the rest info', () => {
  assert.equal(K.bannerToastKind('#c52129'), 'bad');
  assert.equal(K.bannerToastKind('#ff7a5a'), 'bad');
  assert.equal(K.bannerToastKind('#ffd34a'), 'money');
  assert.equal(K.bannerToastKind('#efd67b'), 'money');
  assert.equal(K.bannerToastKind('#c9a0ff'), 'curse');
  assert.equal(K.bannerToastKind('#9fe8ff'), 'sys');
  assert.equal(K.bannerToastKind('#9cff9c'), 'good');
  assert.equal(K.bannerToastKind('#e6dec5'), 'info');
  assert.equal(K.bannerToastKind(undefined), 'info');
  assert.equal(K.bannerToastKind('red'), 'info', 'a non-hex colour is info');
});
