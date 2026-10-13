// Unit tests for src/core/i18n.ts (TECH_SPEC §2.11, §9.3): prefixing, interpolation, plurals and fallback.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);
let registerStrings, setLang, t, has;
before(async () => {
  ({ registerStrings, setLang, t, has } = await load('src/core/i18n.ts'));
  registerStrings('qa.', {
    en: { hi: 'Hello {name}', only: 'English only', 'coins.one': '{n} coin', 'coins.other': '{n} coins' },
    tr: { hi: 'Merhaba {name}', 'coins.one': 'BIRLIK', 'coins.other': '{n} jeton' },
  });
});

test('registerStrings() prefixes keys and t() interpolates {vars} per language', () => {
  setLang('en');
  assert.equal(t('qa.hi', { name: 'Ada' }), 'Hello Ada');
  setLang('tr');
  assert.equal(t('qa.hi', { name: 'Ada' }), 'Merhaba Ada');
});

test('plurals: English picks .one for n = 1, Turkish always uses .other', () => {
  setLang('en');
  assert.equal(t('qa.coins', { n: 1 }), '1 coin');
  assert.equal(t('qa.coins', { n: 2 }), '2 coins');
  setLang('tr');
  assert.equal(t('qa.coins', { n: 1 }), '1 jeton');
});

test('a key missing in tr falls back to en', () => {
  setLang('tr');
  assert.equal(t('qa.only'), 'English only');
});

test('an unknown key comes back as the key itself', () => {
  setLang('en');
  assert.equal(t('qa.nope'), 'qa.nope');
});

test('has() reflects registered keys', () => {
  assert.equal(has('qa.hi'), true);
  assert.equal(has('qa.absent'), false);
});
