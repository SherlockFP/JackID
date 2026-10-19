// LOKI, the borrowed voice (docs/JOKER.md §7, wave J1): the truth table and its clamp, the tell per Ink band (perfect up to Ink 5, zero errors over 1e5
// whispers), Ink costs and healing, unasked odds and kind, the hair tie and coffee, the once-a-run limits, Clerk-witnessed takeovers (never clean),
// an unasked takeover at the N8 kitchen wager, the marked deck, the pantheon's inkCost, seeded determinism, the save round trip, and the copy
// (EN+TR for every key, no "we" in a true line, a "we" in every lie, short lines, no em-dashes).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let J, W, M, T, R, S;
before(async () => {
  J = await load('src/game/joker/joker.ts');
  W = await load('src/game/joker/whispers.ts');
  M = await load('src/game/joker/marked.ts');
  T = await load('src/game/joker/takeover.ts');
  R = await load('src/core/rng.ts');
  S = (await load('src/game/joker/joker.strings.ts')).default;
});

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const rng = (...p) => R.createRng(R.hashSeed('joker.test', ...p));
const text = (lang, keys) => keys.map((k) => S[lang][k.replace(/^joker\./, '')]).join(' ');
/** A Joker on Night 1, Watch 1 with the given Trust and Ink. */
function make(seed = 7, { trust = 0, ink = 0, night = 1 } = {}) {
  const j = new J.Joker(seed);
  j.beginNight(night);
  j.beginWatch(1);
  j.trust = trust;
  j.ink = ink;
  return j;
}
let wcount = 100;
/** Whispers (a fresh Watch each time) until one is `truth` (true or false). */
function whisperUntil(j, truth, ctx = 'machine') {
  for (let i = 0; i < 2000; i++) {
    j.beginWatch(++wcount);
    const w = j.whisper({ ctx });
    if (w && w.truth === truth) return w;
  }
  throw new Error(`no ${truth ? 'true' : 'false'} whisper`);
}
/** Calls `fn` until it returns something truthy, up to `max` times. */
function until(fn, max = 4000) {
  for (let i = 0; i < max; i++) { const r = fn(i); if (r) return r; }
  throw new Error('never happened');
}
const inkEvents = (r) => r.events.filter((e) => e.name === 'joker:ink');

// ── the truth table ──────────────────────────────────────────────────────────────────────────────────────

test('the truth table: free 46..94 %, for him 10..70 % by Trust -3..+3', () => {
  const FREE = [0.46, 0.54, 0.62, 0.70, 0.78, 0.86, 0.94];
  const HIM = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70];
  for (let t = -3; t <= 3; t++) {
    near(J.truthChance(t, 'free'), FREE[t + 3], 1e-9, `free ${t}`);
    near(J.truthChance(t, 'him'), HIM[t + 3], 1e-9, `him ${t}`);
  }
});

test('an Ask is +10 points, and the chance is clamped to 5..95 % whatever the Trust', () => {
  near(J.truthChance(0, 'free', true), 0.80);
  near(J.truthChance(0, 'him', true), 0.50);
  near(J.truthChance(3, 'free', true), 0.95, 1e-9, 'clamped at the top');
  near(J.truthChance(-3, 'him', false), 0.10);
  for (let t = -12; t <= 12; t++) for (const s of ['free', 'him']) for (const a of [false, true]) {
    const p = J.truthChance(t, s, a);
    assert.ok(p >= 0.05 - 1e-12 && p <= 0.95 + 1e-12, `${s} ${t} ${a}: ${p}`);
  }
  near(J.truthChance(-12, 'him'), 0.05, 1e-12, 'floor');
});

test('the rolled frequency follows the table', () => {
  for (const [t, serves, ask] of [[0, 'him', false], [-3, 'free', false], [3, 'him', true], [1, 'free', false]]) {
    const r = rng('freq', t, serves);
    let n = 0;
    for (let i = 0; i < 20000; i++) if (J.rollWhisper(r, { trust: t, ink: 0, serves, ask }).truth) n++;
    near(n / 20000, J.truthChance(t, serves, ask), 0.015, `${serves} ${t}`);
  }
});

// ── the tell ─────────────────────────────────────────────────────────────────────────────────────────────

test('tell reliability: zero tell errors at Ink 0-5 over 1e5 whispers, in the text of both languages', () => {
  const r = rng('tell5');
  let truths = 0, lies = 0, errors = 0;
  for (let i = 0; i < 100000; i++) {
    const def = W.WHISPERS[i % W.WHISPERS.length];
    const roll = J.rollWhisper(r, { trust: (i % 7) - 3, ink: i % 6, serves: def.serves, ask: i % 5 === 0 });
    if (roll.truth) truths++; else lies++;
    if (roll.we === roll.truth) errors++;
    if (i % 25 === 0) {   // the shown text agrees with the roll (every 25th, both languages)
      const keys = W.lineKeys(def, roll.truth, roll.we, 1 + (i % 4));
      for (const lang of ['en', 'tr']) if (W.saysWe(lang, text(lang, keys)) === roll.truth) errors++;
    }
  }
  assert.ok(truths > 20000 && lies > 20000, `both kinds are rolled (${truths}/${lies})`);
  assert.equal(errors, 0);
});

test('tell reliability through the Joker: a lie always has "we" and a truth never does up to Ink 5', () => {
  const j = make(3, { trust: 0 });
  let errors = 0, lies = 0, truths = 0;
  for (let i = 0; i < 4000; i++) {
    j.beginWatch(i + 1);
    for (let k = 0; k < 3; k++) {
      j.ink = i % 6;
      const w = j.whisper({ ctx: ['machine', 'bigBet', 'duel', 'bounty', 'wager'][(i + k) % 5] });
      if (!w) continue;
      if (w.truth) truths++; else lies++;
      for (const lang of ['en', 'tr']) if (W.saysWe(lang, text(lang, w.keys)) === w.truth) errors++;
    }
  }
  assert.ok(lies > 1000 && truths > 1000);
  assert.equal(errors, 0);
});

test('Ink 6-7: a quarter of the true lines say "we"; the lies still do. Ink 8-9: half the lies drop it', () => {
  const rate = (ink, want) => {
    const r = rng('band', ink, want);
    let k = 0, n = 0;
    while (n < 8000) {
      const x = J.rollWhisper(r, { trust: 0, ink, serves: 'him' });
      if (x.truth === want) { n++; if (x.we) k++; }
    }
    return k / n;
  };
  for (const ink of [6, 7]) { near(rate(ink, true), 0.25, 0.03, `true we @${ink}`); assert.equal(rate(ink, false), 1, `lies keep it @${ink}`); }
  for (const ink of [8, 9]) { near(rate(ink, true), 0.25, 0.03, `true we @${ink}`); near(rate(ink, false), 0.5, 0.03, `lie keeps it @${ink}`); }
  assert.equal(rate(5, true), 0);
});

test('a true line that says "we" wears a bleed prefix and still shows it within 2 s (80 characters); a dropped-tell lie uses the solo line', () => {
  const def = W.whisperDef('cold');
  const bleed = W.lineKeys(def, true, true, 2);
  assert.deepEqual(bleed, ['joker.bleed.2', 'joker.w.cold.t']);
  for (const lang of ['en', 'tr']) assert.ok(W.saysWe(lang, text(lang, bleed).slice(0, 80)));
  assert.deepEqual(W.lineKeys(def, false, false), ['joker.w.cold.s']);
  assert.deepEqual(W.lineKeys(def, false, true), ['joker.w.cold.l']);
  assert.deepEqual(W.lineKeys(def, true, false), ['joker.w.cold.t']);
  assert.deepEqual(W.lineKeys(def, true, true, 9), ['joker.bleed.1', 'joker.w.cold.t'], 'the bleed index wraps');
});

test('saysWe reads whole words: we us our in English, biz in Turkish, nothing in "user" or "Bizans"', () => {
  for (const s of ['Pull again, we win.', 'It owes us.', "That's ours.", "We've seen it."]) assert.ok(W.saysWe('en', s), s);
  for (const s of ['This one is cold.', 'The user waits.', 'Bus tonight.']) assert.ok(!W.saysWe('en', s), s);
  for (const s of ['Bu el bizim.', 'Bize güven.', 'Bizi dinle.', 'Biz bitiririz.', 'Bizimle gel.']) assert.ok(W.saysWe('tr', s), s);
  for (const s of ['Bu el senin.', 'Ben olsam geçerdim.']) assert.ok(!W.saysWe('tr', s), s);
});

// ── Ink: costs, healing, Dread ───────────────────────────────────────────────────────────────────────────

test('Ink costs: an Ask +1, an asked takeover +2 (+3 at Trust -1 or lower), unasked +2, the Visit +4, the N1 tutorial 0', () => {
  let j = make();
  const w = j.whisper({ ctx: 'machine', ask: true });
  assert.equal(j.ink, 1);
  assert.deepEqual(inkEvents(w).map((e) => e.data.delta), [1]);
  j = make(); assert.equal(j.askTakeover({ where: 'machine', machineId: 'bigone', stake: 5, quota: 100 }).paid, 2); assert.equal(j.ink, 2);
  j = make(1, { trust: -1 }); assert.equal(j.askTakeover({ where: 'machine', machineId: 'bigone', stake: 5, quota: 100 }).paid, 3); assert.equal(j.ink, 3);
  j = make(1, { trust: -3 }); assert.equal(j.askTakeover({ where: 'duel', duel: 'promise', rival: 'lucan' }).paid, 3);
  j = make(); assert.equal(j.askTakeover({ where: 'machine', machineId: 'bigone', stake: 5, quota: 100, tutorial: true }).paid, 0); assert.equal(j.ink, 0);
  j = make(); assert.equal(j.askTakeover({ where: 'visit' }).paid, 4); assert.equal(j.ink, 4);
  j = make(2, { ink: 6 }); until(() => { const u = j.unasked('knock'); return u.struck; }); assert.equal(j.ink, 8, 'one unasked takeover, +2');
});

test('at Trust -1 or lower the price can be a promise instead of Ink', () => {
  const j = make(5, { trust: -2 });
  const r = j.askTakeover({ where: 'duel', duel: 'lockershuffle', rival: 'mimosa', pay: 'promise' });
  assert.equal(r.ok, true);
  assert.equal(r.paid, 0); assert.equal(r.promise, true); assert.equal(j.ink, 0);
  assert.deepEqual(j.promise, { id: 'takeover', night: 1 });
  j.beginWatch(2);
  assert.equal(j.askTakeover({ where: 'duel', duel: 'lockershuffle', rival: 'mimosa', pay: 'promise' }).why, 'promiseOpen');
  assert.equal(make(5, { trust: 1 }).askTakeover({ where: 'duel', duel: 'promise', rival: 'lucan', pay: 'promise' }).why, 'noPromise', 'only at Trust -1 or lower');
});

test('healing: sleep -2 (-1 with Ada at her sister\'s), an evening -1, soup -1 (-2 once admitted), a marked card to the Clerk -1; never below 0', () => {
  const j = make(1, { ink: 7 });
  assert.equal(j.sleep().delta, -2); assert.equal(j.ink, 5);
  assert.equal(j.sleep(true).delta, -1); assert.equal(j.ink, 4);
  assert.equal(j.adaEvening().delta, -1); assert.equal(j.ink, 3);
  assert.equal(j.soup().delta, -1); assert.equal(j.ink, 2);
  j.admit();
  assert.equal(j.soup().delta, -2); assert.equal(j.ink, 0);
  assert.equal(j.sleep().delta, 0, 'floor at 0');
  const k = make(1, { ink: 3 });
  assert.equal(k.clerkCard('mc01').heat, -1);
  assert.equal(k.ink, 2);
  assert.equal(inkEvents(make(1, { ink: 0 }).sleep()).length, 0, 'no event when nothing changes');
});

test('kept words heal 1 each, at most 2 a Night, and the cap resets the next Night', () => {
  const j = make(1, { ink: 6 });
  assert.equal(j.keptWord().delta, -1); assert.equal(j.keptWord().delta, -1); assert.equal(j.keptWord().delta, 0);
  assert.equal(j.ink, 4);
  j.beginNight(2); j.beginWatch(1);
  assert.equal(j.keptWord().delta, -1);
  assert.equal(j.ink, 3);
});

test('a promise kept at Dawn is Trust +1 and heals; broken is Trust -2; refusing is -1', () => {
  const j = make(1, { ink: 4 });
  assert.equal(j.canAskPromise(), true);
  j.promiseAnswer(true, 'derby');
  assert.equal(j.canAskPromise(), false);
  const kept = j.settlePromise(true);
  assert.equal(j.trust, 1); assert.equal(j.ink, 3); assert.ok(kept.events.some((e) => e.name === 'joker:trust'));
  j.beginNight(2);
  j.promiseAnswer(true, 'photo');
  j.settlePromise(false);
  assert.equal(j.trust, -1, '+1 then -2');
  assert.equal(j.promiseAnswer(false).delta, -1, 'refuse');
  assert.equal(j.settlePromise(true).delta, 0, 'nothing open');
  const k = make(1); k.promiseAnswer(true, 'a'); assert.equal(k.promiseAnswer(true, 'b').delta, 0); assert.equal(k.promise.id, 'a', 'one a Night');
});

test('Ink is carried by Dread: 4 points each, and the symptom bands match the table', () => {
  for (let i = 0; i <= 10; i++) assert.equal(J.inkDread(i), 4 * i);
  assert.equal(J.inkDread(-3), 0); assert.equal(J.inkDread(40), 40);
  const band = (i) => J.symptoms(i).band;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(band), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => J.symptoms(i).blackTips), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  assert.deepEqual(J.gloveOf(5), { black: 2, stained: true });
  assert.deepEqual(J.gloveOf(6), { black: 3, stained: false });
  const s = J.symptoms(8);
  assert.equal(s.hisHand, true); assert.equal(s.talksAtHome, true); assert.equal(s.unasked, 0.25); assert.equal(s.lieDropsWe, 0.5); assert.equal(s.trueWe, 0.25);
  assert.equal(J.symptoms(3).extraTip, true); assert.equal(J.symptoms(1).extraTip, false);
  assert.equal(J.symptoms(10).home, true);
  assert.equal(make(1, { ink: 4 }).dread, 16);
});

test('he talks more from Ink 2: three tips a Watch, four from Ink 2; an Ask is never limited by the budget', () => {
  const j = make(9, { ink: 0 });
  const tip = () => j.whisper({ ctx: 'machine' });
  assert.ok(tip() && tip() && tip()); assert.equal(tip(), null);
  assert.equal(j.tipsLeft, 0);
  assert.ok(j.whisper({ ctx: 'machine', ask: true }), 'an Ask still works');
  j.beginWatch(2);
  assert.equal(j.tipsLeft, 3);
  j.ink = 2; j.beginWatch(3);
  assert.equal(j.tipsLeft, 4);
});

test('the kitchen: he is silent below Ink 8, and a silent call changes nothing', () => {
  const j = make(1, { ink: 7 });
  const before = JSON.stringify(j.snapshot());
  assert.equal(j.whisper({ ctx: 'kitchen' }), null);
  assert.equal(j.whisper({ ctx: 'kitchen', ask: true }), null);
  assert.equal(JSON.stringify(j.snapshot()), before);
  j.ink = 8;
  assert.ok(j.whisper({ ctx: 'kitchen' }));
});

// ── Trust moves ──────────────────────────────────────────────────────────────────────────────────────────

test('Trust moves: dare +1, refuse -1, feed +1, clerk card -1, broken promise -2, admit -2 once; clamped to -3..+3', () => {
  const j = make();
  assert.equal(j.dare(true).delta, 1); assert.equal(j.trust, 1);
  assert.equal(j.dare(false).delta, 0, 'a second answer the same Night is not a dare');
  assert.equal(j.admit().delta, -2); assert.equal(j.admit().delta, 0, 'once a run'); assert.equal(j.trust, -1);
  for (let i = 0; i < 6; i++) j.trustMove('broke');
  assert.equal(j.trust, -3, 'floor: a fall is never capped');
  for (let n = 2; n <= 8; n++) { j.beginNight(n); j.beginWatch(1); j.trustMove('feed'); }
  assert.equal(j.trust, 3, 'ceiling, a step a Night');
  j.trustMove('feed');
  assert.equal(j.trust, 3);
  const e = j.trustMove('broke');
  assert.deepEqual(e.events.map((x) => x.name), ['joker:trust']);
  assert.deepEqual(e.events[0].data, { trust: 1, delta: -2, why: 'broke' });
});

test('dares: he offers one a Night, so a second answer the same Night changes nothing; a refusal is -1 once', () => {
  const j = make();
  assert.equal(j.canDare(), true);
  const a = j.dare(false);
  assert.deepEqual([a.asked, a.delta, j.trust], [true, -1, -1]);
  assert.equal(j.canDare(), false);
  const b = j.dare(true);
  assert.deepEqual([b.asked, b.delta, b.events.length, j.trust], [false, 0, 0, -1]);
  j.beginWatch(2);
  assert.equal(j.canDare(), false, 'a new Watch is not a new Night');
  j.beginNight(2); j.beginWatch(1);
  assert.equal(j.canDare(), true);
  assert.deepEqual([j.dare(true).delta, j.trust], [1, 0]);
});

test('Trust rises at most +1 a Night whatever you do, and falls without a cap', () => {
  const j = make();
  assert.equal(j.dare(true).delta, 1);
  assert.equal(j.trustMove('feed').delta, 0, 'a card the same Night');
  assert.equal(j.trustMove('asked').delta, 0);
  assert.equal(j.trustMove('kept').delta, 0);
  assert.equal(j.trust, 1);
  assert.equal(j.trustMove('broke').delta, -2, 'a fall is not capped'); assert.equal(j.trust, -1);
  assert.equal(j.trustMove('feed').delta, 0, 'the cap counts the gains of the Night, so a fall does not buy a second step'); assert.equal(j.trust, -1);
  j.beginNight(2); j.beginWatch(1);
  assert.equal(j.trustMove('kept').delta, 1); assert.equal(j.trust, 0);
});

test('the Dawn decay: Trust drifts 1 toward 0 unless it moved that Night; the drift is not a move', () => {
  const j = make(1, { trust: 2 });
  assert.equal(j.dawn().delta, -1); assert.equal(j.trust, 1);
  assert.deepEqual(j.dawn().events.map((e) => e.data.why), ['dawn'], 'a second Dawn on the same Night drifts again (the drift moved nothing)');
  assert.equal(j.trust, 0);
  assert.equal(j.dawn().delta, 0, 'at 0 there is nowhere to drift');
  const k = make(1, { trust: -2 });
  assert.equal(k.dawn().delta, 1); assert.equal(k.trust, -1);
  // a Night where it moved holds, up or down
  const up = make(1, { trust: 1 }); up.dare(true);
  assert.equal(up.dawn().delta, 0); assert.equal(up.trust, 2);
  const down = make(1, { trust: -1 }); down.trustMove('broke');
  assert.equal(down.dawn().delta, 0); assert.equal(down.trust, -3);
  // a capped move that changed nothing is not a move
  const flat = make(1, { trust: 3 }); flat.trustMove('feed');
  assert.equal(flat.dawn().delta, -1, 'a favour at the ceiling moved nothing');
  // a Night later with no favours, it drifts
  up.beginNight(2); up.beginWatch(1);
  assert.equal(up.dawn().delta, -1); assert.equal(up.trust, 1);
});

test('a player who does every favour is at +3 on the third Dawn, not before; one who stops drifts back', () => {
  const j = make();
  const day = (n) => { j.beginNight(n); j.beginWatch(1); j.dare(true); j.trustMove('feed'); j.trustMove('kept'); j.dawn(); return j.trust; };
  assert.deepEqual([1, 2, 3].map(day), [1, 2, 3]);
  assert.equal(j.wordReady, true, 'held at the third Dawn');
  j.beginNight(4); j.beginWatch(1); j.dawn();
  assert.equal(j.trust, 2, 'a quiet Night');
  assert.equal(j.wordReady, true, 'but the word stays earned');
});

test('catching a lie is +1 once a Night, calling a truth a liar is -1, and each whisper can be called once', () => {
  const j = make(11);
  whisperUntil(j, false);
  const a = j.callLiar();
  assert.equal(a.right, true); assert.equal(a.delta, 1);
  assert.equal(j.callLiar().right, null, 'already called');
  whisperUntil(j, false);
  const b = j.callLiar();
  assert.equal(b.right, true); assert.equal(b.delta, 0, 'a second catch the same Night adds nothing'); assert.equal(j.trust, 1);
  whisperUntil(j, true);
  const c = j.callLiar();
  assert.equal(c.right, false); assert.equal(c.delta, -1); assert.equal(j.trust, 0);
  assert.equal(make().callLiar().right, null, 'nothing to call');
  j.beginNight(2); j.beginWatch(1);
  whisperUntil(j, false);
  assert.equal(j.callLiar().delta, 1, 'the cap resets with the Night');
});

test('at Ada\'s table: breaking his ask is Trust +1, Harmony -1 and a crack; keeping it is Trust -1 and still heals Ink', () => {
  const a = make(1, { ink: 8 });
  const b = a.adaWord(true);
  assert.deepEqual([b.delta, b.harmony, b.crack, a.trust], [1, -1, true, 1]);
  const k = make(1, { ink: 8 });
  const r = k.adaWord(false);
  assert.deepEqual([r.delta, r.harmony, r.crack, k.trust, k.ink], [-1, 0, false, -1, 7]);
});

test('his hand finishes a reply to Ada once a Night, at Ink 8-9 only', () => {
  const j = make(1, { ink: 7 });
  assert.equal(j.hisHandReply(), false);
  j.ink = 8;
  assert.equal(j.hisHandReply(), true); assert.equal(j.hisHandReply(), false);
  j.beginNight(2); assert.equal(j.hisHandReply(), true);
  j.ink = 10; j.beginNight(3); assert.equal(j.hisHandReply(), false, 'home is the ending, not a reply');
});

// ── his word ─────────────────────────────────────────────────────────────────────────────────────────────

test('his word: earned at Trust +3 held at a Dawn, always true with no tell, once a run, and it holds when Trust falls', () => {
  const j = make(4, { ink: 9 });
  assert.equal(j.wordReady, false);
  assert.equal(j.whisper({ ctx: 'wager', ask: true, onHisWord: true }).onHisWord, false, 'not earned: a normal Ask');
  j.ink = 9; j.trust = 2; j.trustMove('feed');
  assert.equal(j.trust, 3); assert.equal(j.wordReady, false, 'earned by holding it at a Dawn, not by touching it');
  j.dawn();
  assert.equal(j.wordReady, true);
  j.trust = -3;
  assert.equal(j.wordReady, true, 'holds');
  for (let i = 0; i < 40; i++) {
    const k = new J.Joker(i); k.beginNight(8); k.beginWatch(1); k.ink = 8; k.trust = 3; k.dawn();
    const w = k.whisper({ ctx: 'wager', ask: true, onHisWord: true });
    assert.equal(w.truth, true); assert.equal(w.we, false); assert.equal(w.onHisWord, true);
    for (const lang of ['en', 'tr']) assert.equal(W.saysWe(lang, text(lang, w.keys)), false);
    assert.equal(k.wordReady, false, 'spent');
    assert.equal(k.whisper({ ctx: 'wager', ask: true, onHisWord: true }).onHisWord, false, 'once a run');
  }
});

// ── Change of Hands ──────────────────────────────────────────────────────────────────────────────────────

test('a machine takeover pays exactly 10 x the stake, the stake counted as at most 2.5 % of the quota (so at most a quarter of it)', () => {
  assert.equal(T.takeoverPayout(5, 1000), 50);
  assert.equal(T.takeoverPayout(25, 1000), 250, 'exactly 2.5 % of the quota');
  assert.equal(T.takeoverPayout(400, 1000), 250, 'capped at a quarter');
  assert.equal(T.takeoverPayout(0, 1000), 0);
  for (let q = 24; q <= 90000; q = Math.round(q * 1.7)) for (const s of [1, 3, 20, 500, 40000]) assert.ok(T.takeoverPayout(s, q) <= q / 4 + 1e-9, `${s}/${q}`);
  const r = T.resolveTakeover(rng('m'), { where: 'machine', asked: true, machineId: 'bigone', stake: 12, quota: 2000 });
  assert.deepEqual([r.act, r.payout, r.kind, r.tag, r.clean], ['bigWin', 120, 'help', 'joker', true]);
});

test('never the cashier, the Debt Terminal or the bell', () => {
  for (const id of ['cashier', 'debt_terminal', 'bell']) {
    assert.equal(T.machineAllowed(id), false);
    assert.equal(make().askTakeover({ where: 'machine', machineId: id, stake: 5, quota: 100 }).why, 'machine');
  }
  assert.equal(T.machineAllowed('bigone'), true);
  assert.equal(make().askTakeover({ where: 'machine', stake: 5, quota: 100 }).why, 'machine', 'a machine takeover names its machine');
  const j = make(3, { ink: 8 });
  for (let i = 0; i < 400; i++) { const u = j.unasked('bigBet', { machineId: 'cashier', stake: 5, quota: 100 }); assert.equal(u.struck, false); }
  assert.equal(j.ink, 8, 'no Ink for a hand that never moved');
});

test('limits: one asked takeover a Watch, never twice in a row at one machine, the Knock and the Visit once a run', () => {
  const j = make(2);
  const m = (id) => { j.ink = 0; return j.askTakeover({ where: 'machine', machineId: id, stake: 5, quota: 100 }); };
  assert.equal(m('bigone').ok, true);
  assert.equal(m('blackjack').why, 'cooldown');
  j.beginWatch(2);
  assert.equal(m('bigone').why, 'sameMachine');
  assert.equal(m('blackjack').ok, true);
  j.beginWatch(3);
  assert.equal(m('bigone').ok, true, 'not in a row any more');
  j.beginWatch(4);
  j.ink = 0; assert.equal(j.askTakeover({ where: 'duel', duel: 'promise', rival: 'lucan' }).ok, true);
  j.beginWatch(5);
  assert.equal(m('bigone').ok, true, 'a duel in between breaks the row');
  j.ink = 0; assert.equal(j.askTakeover({ where: 'knock' }).ok, true);
  j.beginNight(2); j.beginWatch(1); j.ink = 0;
  assert.equal(j.askTakeover({ where: 'knock' }).why, 'once');
  assert.equal(j.askTakeover({ where: 'visit' }).ok, true);
  assert.equal(j.askTakeover({ where: 'visit' }).why, 'once');
  const k = make(3, { ink: 10 });
  assert.equal(k.askTakeover({ where: 'duel', duel: 'promise' }).why, 'ended');
});

test('asking is Trust +1 once a Night (he likes being needed)', () => {
  const j = make(2);
  j.askTakeover({ where: 'duel', duel: 'promise', rival: 'lucan' });
  j.beginWatch(2); j.askTakeover({ where: 'crooked' });
  assert.equal(j.trust, 1);
  j.beginNight(2); j.beginWatch(1); j.askTakeover({ where: 'crooked' });
  assert.equal(j.trust, 2);
});

test('duels: Promise scores 1, never a kept 2, and cracks the caller\'s card; the Question shows the card; the picks are made; ŞANS ignores the tag', () => {
  const rs = (c) => T.resolveTakeover(rng('duel', c.duel), { where: 'duel', asked: true, ...c });
  const p = rs({ duel: 'promise', rival: 'lucan' });
  assert.deepEqual([p.act, p.score, p.crack, p.tag], ['winRound', 1, false, 'joker']);
  assert.equal(rs({ duel: 'promise', rival: 'lucan', breaksPromise: true }).crack, true);
  assert.equal(rs({ duel: 'lockershuffle', rival: 'mimosa' }).act, 'rightPick');
  assert.equal(rs({ duel: 'lastcount', rival: 'vell' }).act, 'rightPick');
  assert.equal(rs({ duel: 'sealedwall', rival: 'tamsin' }).act, 'winRound');
  assert.ok(['seeCard', 'called'].includes(rs({ duel: 'thequestion', rival: 'orrin' }).act));
  assert.equal(T.resolveTakeover(rng('c'), { where: 'crooked', asked: true }).act, 'seeTables');
  const k = T.resolveTakeover(rng('k'), { where: 'knock', asked: true });
  assert.deepEqual([k.act, k.heat], ['visitorLeaves', -1]);
  const v = T.resolveTakeover(rng('v'), { where: 'visit', asked: true });
  assert.deepEqual([v.act, v.quotaCarry], ['orrinStops', true]);
});

test('Orrin knows his hand: in the Question a takeover is called one time in two (the round is lost, Heat +1)', () => {
  let called = 0;
  for (let i = 0; i < 4000; i++) {
    const r = T.resolveTakeover(rng('orrin', i), { where: 'duel', asked: true, duel: 'thequestion', rival: 'orrin' });
    if (r.called) {
      called++;
      assert.deepEqual([r.act, r.score, r.heat], ['called', 0, 1]);
      assert.ok(r.lines.includes('joker.takeover.orrin'));
    } else assert.deepEqual([r.act, r.heat], ['seeCard', 0]);
  }
  near(called / 4000, 0.5, 0.03);
});

test('in front of the Clerk a takeover is a cheat: it wins, the Clerk rules, and the wager is never clean', () => {
  for (const witness of ['audit', 'kitchen', 'wager']) {
    const r = T.resolveTakeover(rng('w', witness), { where: 'duel', asked: true, duel: 'promise', rival: witness === 'kitchen' ? 'ada' : 'champion', witness });
    assert.equal(r.clean, false, witness);
    assert.equal(r.act, 'winRound'); assert.equal(r.score, 1, 'the throw still wins');
    assert.ok(r.lines.includes('joker.takeover.clerk'));
    assert.equal(r.lines.includes('joker.takeover.champion'), witness === 'wager', 'the Champion answers at the Wager only');
  }
  const free = T.resolveTakeover(rng('free'), { where: 'duel', asked: true, duel: 'promise', rival: 'lucan', witness: null });
  assert.deepEqual([free.clean, free.lines], [true, []]);
  const j = make(6, { ink: 5, night: 7 });
  const a = j.askTakeover({ where: 'duel', duel: 'promise', rival: 'lucan', witness: 'audit' });
  assert.equal(a.result.clean, false);
  assert.equal(a.events.find((e) => e.name === 'joker:takeover').data.clean, false);
});

test('an unasked takeover at the N8 kitchen wager: help and spite look the same, he plays to win, Ada goes still', () => {
  for (const trust of [-3, 0, 3]) {
    const j = make(20 + trust, { ink: 8, trust, night: 8 });
    const u = until(() => { j.beginWatch(++wcount); const x = j.unasked('kitchenWager'); if (x.struck) return x; j.ink = 8; return null; });
    assert.equal(u.struck, true);
    assert.equal(u.result.act, 'winRound', `trust ${trust}`);
    assert.equal(u.kind, 'help'); assert.equal(u.result.clean, false); assert.equal(u.result.adaStill, true);
    assert.ok(u.result.lines.includes('joker.takeover.clerk'));
    assert.equal(u.result.where, 'duel');
  }
  // at Ada's table anywhere else, spite breaks your word
  const s = make(30, { ink: 8, trust: -3 });
  const x = until(() => { s.beginWatch(++wcount); const r = s.unasked('adaThrow'); if (r.struck) return r; s.ink = 8; return null; });
  assert.equal(x.result.act, 'breakWord');
});

// ── unasked odds, kind, hair tie, coffee ─────────────────────────────────────────────────────────────────

test('unasked odds: none below Ink 6, 10 % at 6-7, 25 % at 8-9, none once he is home', () => {
  assert.deepEqual([0, 3, 5, 6, 7, 8, 9, 10].map(J.unaskedChance), [0, 0, 0, 0.1, 0.1, 0.25, 0.25, 0]);
  for (const [ink, p] of [[5, 0], [6, 0.1], [7, 0.1], [8, 0.25], [9, 0.25]]) {
    const r = rng('odds', ink);
    let n = 0;
    for (let i = 0; i < 30000; i++) if (J.rollUnasked(r, { ink, trust: 0 }).strike) n++;
    near(n / 30000, p, 0.012, `ink ${ink}`);
  }
});

test('unasked kind: Trust +1 or more helps, -1 or lower is spite, 0 is a coin flip', () => {
  for (const u of [0, 0.3, 0.99]) { assert.equal(J.unaskedKind(1, u), 'help'); assert.equal(J.unaskedKind(3, u), 'help'); assert.equal(J.unaskedKind(-1, u), 'spite'); assert.equal(J.unaskedKind(-3, u), 'spite'); }
  const r = rng('kind');
  let help = 0;
  for (let i = 0; i < 20000; i++) if (J.rollUnasked(r, { ink: 8, trust: 0 }).kind === 'help') help++;
  near(help / 20000, 0.5, 0.015);
  // through the Joker: a strike at Trust +2 helps, at Trust -2 throws the pull
  for (const [trust, kind, act] of [[2, 'help', 'bigWin'], [-2, 'spite', 'throwRound']]) {
    const j = make(41, { ink: 6, trust });
    const u = until(() => { j.beginWatch(++wcount); const x = j.unasked('bigBet', { machineId: 'bigone', stake: 10, quota: 100 }); if (x.struck) return x; return null; });
    assert.equal(u.kind, kind); assert.equal(u.result.act, act);
    assert.equal(u.result.payout, kind === 'help' ? T.takeoverPayout(10, 100) : 0);
  }
  // at Ink 5 and below the hand never moves on its own
  const q = make(42, { ink: 5 });
  for (let i = 0; i < 1000; i++) assert.equal(q.unasked('knock').struck, false);
});

test('Ada\'s hair tie: the first unasked takeover each Night slips off ("not that hand"), costs no Ink, and the next one lands', () => {
  const j = make(50, { ink: 6 });
  const slipped = until(() => { const u = j.unasked('knock', { hairTie: true }); return u.blocked === 'hairTie' ? u : null; });
  assert.deepEqual(slipped.lines, ['joker.takeover.slip']);
  assert.equal(slipped.events.length, 0); assert.equal(j.ink, 6);
  const hit = until(() => { const u = j.unasked('knock', { hairTie: true }); assert.notEqual(u.blocked, 'hairTie', 'only once a Night'); return u.struck ? u : null; });
  assert.equal(hit.struck, true); assert.equal(j.ink, 8);
  j.beginNight(2); j.ink = 6;
  const again = until(() => { const u = j.unasked('knock', { hairTie: true }); return u.blocked === 'hairTie' ? u : u.struck ? 'landed first' : null; });
  assert.notEqual(again, 'landed first', 'a new Night, a new slip');
  // without the tie nothing slips
  const k = make(51, { ink: 6 });
  for (let i = 0; i < 400; i++) assert.notEqual(k.unasked('knock').blocked, 'hairTie');
});

test('coffee blocks unasked takeovers for the next Watch only', () => {
  const j = make(60, { ink: 8 });
  j.drinkCoffee();
  assert.equal(j.coffeeOn, false, 'drunk now: it works from the next Watch');
  j.beginWatch(2);
  assert.equal(j.coffeeOn, true);
  let blocked = 0;
  for (let i = 0; i < 400; i++) { const u = j.unasked('knock'); assert.equal(u.struck, false); if (u.blocked === 'coffee') blocked++; }
  assert.ok(blocked > 50, `coffee did the blocking (${blocked})`);
  assert.equal(j.ink, 8);
  j.beginWatch(3);
  assert.equal(j.coffeeOn, false);
  until(() => j.unasked('knock').struck);
  assert.equal(j.ink, 10, 'the next Watch he is free again');
});

// ── the marked deck ──────────────────────────────────────────────────────────────────────────────────────

test('the marked deck: twelve court cards, one or two a floor, all lying out before Night 8', () => {
  assert.equal(M.MARKED_CARDS.length, 12);
  assert.equal(new Set(M.MARKED_CARDS.map((c) => c.id)).size, 12);
  assert.deepEqual([...new Set(M.MARKED_CARDS.map((c) => c.rank + c.suit))].sort(), ['jc', 'jd', 'jh', 'js', 'kc', 'kd', 'kh', 'ks', 'qc', 'qd', 'qh', 'qs']);
  const perNight = {};
  for (const c of M.MARKED_CARDS) perNight[c.night] = (perNight[c.night] ?? 0) + 1;
  for (let n = 1; n <= 7; n++) assert.ok([1, 2].includes(perNight[n]), `night ${n}: ${perNight[n]}`);
  assert.equal(perNight[8], undefined, 'nothing on the Night 8 floor');
  assert.deepEqual([...new Set(M.MARKED_CARDS.map((c) => c.spot))].sort(), ['behindMachine', 'clerkPlate', 'liftRoof', 'washLocker']);
  assert.equal(M.cardsByNight(2).length, 3); assert.equal(M.cardsByNight(7).length, 12);
});

test('feeding a marked card: Trust +1, a memory (which may lie, and then carries the tell), gifts at 3 / 6 / 9, once per card', () => {
  const j = make(70);
  const first = j.feedCard('mc01');
  assert.equal(first.action, 'feed'); assert.equal(j.trust, 1); assert.deepEqual(j.fedCards, ['mc01']);
  assert.equal(j.feedCard('mc01'), null, 'once'); assert.equal(j.clerkCard('mc01'), null, 'a card is fed or handed over, not both');
  assert.equal(j.feedCard('nope'), null);
  const gifts = [];
  for (const id of M.MARKED_CARDS.slice(1, 9).map((c) => c.id)) { const r = j.feedCard(id); if (r.gift) gifts.push([j.fedCards.length, r.gift]); }
  assert.deepEqual(gifts, [[3, 'mirror_shoe'], [6, 'photo_negative'], [9, 'card_of_all_suits']]);
  assert.deepEqual(M.giftsFor(6), ['mirror_shoe', 'photo_negative']);
  // the text: a true memory has no "we", a lie has one
  let t = 0, l = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const k = make(seed);
    const r = k.feedCard('mc07');
    if (r.truth) { t++; assert.ok(r.keys.includes('joker.card.mc07.m')); } else { l++; assert.match(r.keys[0], /^joker\.lie\.[1-4]$/); }
    for (const lang of ['en', 'tr']) assert.equal(W.saysWe(lang, text(lang, r.keys)), !r.truth, `seed ${seed}`);
  }
  assert.ok(t > 50 && l > 50, `at Trust 0 it lies about as often as it tells (${t}/${l})`);
});

test('handing a card to the Clerk: Trust -1, Heat -1, Ink -1, the Clerk\'s true record, and no tell to read', () => {
  const j = make(71, { ink: 5, trust: 2 });
  const r = j.clerkCard('mc03');
  assert.deepEqual([r.action, r.heat, j.trust, j.ink, r.truth, r.we, r.keys], ['clerk', -1, 1, 4, true, false, ['joker.card.mc03.c']]);
  assert.deepEqual(j.handedCards, ['mc03']);
});

test('a full pile of either kind (twelve) names the rest of him, before Night 8', () => {
  const fed = make(72), handed = make(73), mixed = make(74);
  const all = M.MARKED_CARDS.map((c) => c.id);
  for (const id of all.slice(0, 11)) { fed.feedCard(id); handed.clerkCard(id); }
  assert.equal(fed.namesCompere, false);
  assert.equal(fed.feedCard(all[11]).namesCompere, true);
  assert.equal(handed.clerkCard(all[11]).namesCompere, true);
  all.forEach((id, i) => (i % 2 ? mixed.feedCard(id) : mixed.clerkCard(id)));
  assert.equal(mixed.namesCompere, false, 'six and six name no one');
  assert.ok(Math.max(...M.MARKED_CARDS.map((c) => c.night)) < 8);
});

// ── the pantheon's price ─────────────────────────────────────────────────────────────────────────────────

test('inkCost(n) for the pantheon: a whole number of Ink, never negative, never past 9; a boon is refused if it would bring him home', () => {
  assert.deepEqual([0, 1, 2, 2.4, 2.5, -4, 9, 12, NaN].map(J.inkCost), [0, 1, 2, 2, 3, 0, 9, 9, 0]);
  const j = make(1, { ink: 6 });
  assert.equal(j.canPayInk(3), true);
  const ok = j.payInk(3, 'loki_grin');
  assert.deepEqual([ok.ok, ok.paid, j.ink], [true, 3, 9]);
  assert.deepEqual(ok.events.map((e) => e.data), [{ ink: 9, delta: 3, why: 'loki_grin' }]);
  const no = j.payInk(1);
  assert.deepEqual([no.ok, no.paid, j.ink, no.events.length], [false, 0, 9, 0]);
  assert.equal(j.canPayInk(0), true, 'a free boon is always fine');
});

// ── the copy ─────────────────────────────────────────────────────────────────────────────────────────────

test('the pool: about 40 lines, every context (never the phone), kitchen from Ink 8, unique ids', () => {
  assert.equal(new Set(W.WHISPERS.map((d) => d.id)).size, W.WHISPERS.length);
  const ctxs = new Set(W.WHISPERS.map((d) => d.ctx));
  for (const c of ['machine', 'bigBet', 'duel', 'crooked', 'knock', 'homePc', 'window', 'bounty', 'nightCard', 'kitchen', 'wager']) assert.ok(ctxs.has(c), c);
  assert.ok(![...ctxs].includes('phone'));
  assert.ok(W.WHISPERS.length * 2 >= 36 && W.WHISPERS.length * 2 <= 60, `${W.WHISPERS.length * 2} true+lie lines`);
  for (const d of W.WHISPERS) assert.equal(d.minInk ?? 0, d.ctx === 'kitchen' ? 8 : 0, d.id);
  assert.ok(W.WHISPERS.some((d) => d.serves === 'free') && W.WHISPERS.some((d) => d.serves === 'him'));
  const r = rng('pick');
  assert.equal(W.pickWhisper(r, 'kitchen', { ink: 7 }), null);
  assert.ok(W.pickWhisper(r, 'kitchen', { ink: 8 }));
  assert.equal(W.pickWhisper(r, 'machine', { fact: 'nope' }), null);
  assert.equal(W.pickWhisper(r, 'machine', { fact: 'cold' }).id, 'cold');
  assert.notEqual(W.pickWhisper(r, 'machine', { exclude: ['cold'] }).id, 'cold');
});

test('copy: every key in EN and TR; truths never say we, lies always do, solos never; at most 8 words; no em-dashes; Turkish diacritics', () => {
  const keys = new Set();
  for (const d of W.WHISPERS) for (const k of ['t', 'l', 's']) keys.add(`w.${d.id}.${k}`);
  for (let i = 1; i <= W.BLEED_COUNT; i++) keys.add(`bleed.${i}`);
  for (let i = 1; i <= W.CARD_LIES; i++) keys.add(`lie.${i}`);
  for (const c of M.MARKED_CARDS) { keys.add(`card.${c.id}.m`); keys.add(`card.${c.id}.c`); keys.add(`rank.${c.rank}`); keys.add(`suit.${c.suit}`); }
  for (const k of ['takeover.ask', 'takeover.clerk', 'takeover.champion', 'takeover.door', 'takeover.orrin', 'takeover.slip', 'takeover.calm', 'card.name']) keys.add(k);
  assert.deepEqual(Object.keys(S.en).sort(), Object.keys(S.tr).sort(), 'same keys in both languages');
  for (const k of keys) for (const lang of ['en', 'tr']) assert.ok(S[lang][k]?.trim(), `${lang} ${k}`);
  assert.equal(Object.keys(S.en).length, keys.size, 'no stray keys');
  const words = (s) => s.trim().split(/\s+/).length;
  for (const lang of ['en', 'tr']) {
    for (const d of W.WHISPERS) {
      const t = S[lang][`w.${d.id}.t`], l = S[lang][`w.${d.id}.l`], s = S[lang][`w.${d.id}.s`];
      assert.equal(W.saysWe(lang, t), false, `${lang} ${d.id} true line says we: ${t}`);
      assert.equal(W.saysWe(lang, l), true, `${lang} ${d.id} lie has no tell: ${l}`);
      assert.equal(W.saysWe(lang, s), false, `${lang} ${d.id} solo lie says we: ${s}`);
      for (const x of [t, l, s]) assert.ok(words(x) <= 8, `${lang} ${d.id} too long (${words(x)}): ${x}`);
      assert.ok(l.slice(0, 80) === l || W.saysWe(lang, l.slice(0, 80)), 'the tell is on screen within 2 s at 40 cps');
    }
    for (let i = 1; i <= W.BLEED_COUNT; i++) assert.equal(W.saysWe(lang, S[lang][`bleed.${i}`]), true);
    for (let i = 1; i <= W.CARD_LIES; i++) assert.equal(W.saysWe(lang, S[lang][`lie.${i}`]), true);
    for (const c of M.MARKED_CARDS) {
      assert.equal(W.saysWe(lang, S[lang][`card.${c.id}.m`]), false, `${lang} ${c.id} memory is true: no we`);
      assert.ok(words(S[lang][`card.${c.id}.m`]) <= 16 && words(S[lang][`card.${c.id}.c`]) <= 24);
    }
    for (const [k, v] of Object.entries(S[lang])) assert.ok(!/[–—]/.test(v), `${lang} ${k} has a dash`);
  }
  // Turkish: no unaccented spellings of words that need ç ğ ı ö ş ü
  const BAD = /\b(kagit|soguk|cok|soz|sozu|kapiya|haraci|odeme|baska|sirit\w*|yuksek|dusuk|gozleri|disari)\b/i;
  for (const [k, v] of Object.entries(S.tr)) assert.ok(!BAD.test(v), `tr ${k}: ${v}`);
  assert.ok(S.tr['w.cold.t'].includes('soğuk') && S.tr['w.toll.l'].includes('Haracı') && S.tr['takeover.door'].includes('Kapıya'));
  // placeholders agree
  for (const k of Object.keys(S.en)) assert.equal((S.en[k].match(/\{\w+\}/g) ?? []).sort().join(), (S.tr[k].match(/\{\w+\}/g) ?? []).sort().join(), k);
});

// ── seeded determinism and the save ──────────────────────────────────────────────────────────────────────

/** One scripted stretch of play; returns everything the Joker said and did. */
function script(j) {
  const log = [];
  for (let night = 1; night <= 4; night++) {
    j.beginNight(night);
    for (let w = 1; w <= 3; w++) {
      j.beginWatch(w);
      for (const ctx of ['machine', 'bigBet', 'duel', 'bounty']) { const x = j.whisper({ ctx }); log.push(x && [x.id, x.truth, x.we, x.keys.join('+')]); }
      log.push(j.whisper({ ctx: 'wager', ask: true })?.keys);
      if (w === 2) { const a = j.askTakeover({ where: 'machine', machineId: ['bigone', 'roulette'][night % 2], stake: 6, quota: 120 }); log.push(a.ok ? [a.result.act, a.result.payout, a.paid] : a.why); }
      const u = j.unasked('bigBet', { machineId: 'bigone', stake: 6, quota: 120 }); log.push(u.struck ? [u.kind, u.result.act] : u.blocked ?? 0);
      j.callLiar(); j.dare(w % 2 === 0);
    }
    j.feedCard(`mc0${night}`); j.sleep(night === 3); j.keptWord();
    if (night === 2) j.drinkCoffee();
  }
  log.push(j.snapshot());
  return log;
}

test('seeded determinism: the same seed and calls give the same Loki; another seed does not; unrelated calls do not shift a whisper', () => {
  assert.deepEqual(script(new J.Joker(99)), script(new J.Joker(99)));
  assert.notDeepEqual(script(new J.Joker(99)), script(new J.Joker(100)));
  const a = make(5), b = make(5);
  b.unasked('knock'); b.sleep(); b.trustMove('feed'); b.trust = 0;
  const x = a.whisper({ ctx: 'machine' }), y = b.whisper({ ctx: 'machine' });
  assert.deepEqual([x.id, x.truth, x.we, x.keys], [y.id, y.truth, y.we, y.keys]);
  const r1 = J.rollWhisper(rng('d'), { trust: 1, ink: 7, serves: 'him' }), r2 = J.rollWhisper(rng('d'), { trust: 1, ink: 7, serves: 'him' });
  assert.deepEqual(r1, r2);
  assert.deepEqual(T.resolveTakeover(rng('t'), { where: 'duel', asked: true, duel: 'thequestion' }), T.resolveTakeover(rng('t'), { where: 'duel', asked: true, duel: 'thequestion' }));
});

test('the rolls always draw the same number of values, so a replay stays in step', () => {
  const used = (fn) => { const r = rng('n'); const ref = rng('n'); fn(r); let k = 0; while (r.getState().join() !== ref.getState().join() && k < 20) { ref.next(); k++; } return k; };
  const cases = [{ trust: 3, ink: 0, serves: 'free' }, { trust: -3, ink: 9, serves: 'him', ask: true }, { trust: 0, ink: 5, serves: 'him', onHisWord: true }];
  for (const c of cases) assert.equal(used((r) => J.rollWhisper(r, c)), 2);
  assert.equal(used((r) => J.rollUnasked(r, { ink: 0, trust: 0 })), 2);
  assert.equal(used((r) => J.rollUnasked(r, { ink: 9, trust: -3 })), 2);
  assert.equal(used((r) => T.resolveTakeover(r, { where: 'machine', asked: true })), 1);
  assert.equal(used((r) => T.resolveTakeover(r, { where: 'duel', asked: false, kind: 'spite', witness: 'wager' })), 1);
});

test('save round trip: snapshot -> JSON -> restore gives the same Loki, and the two go on identically', () => {
  const a = new J.Joker(123);
  script(a);
  a.promiseAnswer(true, 'derby');
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = new J.Joker(123);
  b.restore(snap);
  assert.deepEqual(b.snapshot(), a.snapshot());
  assert.deepEqual([snap.moved, snap.gained.n >= 0], [a.snapshot().moved, true]);
  assert.deepEqual([b.trust, b.ink, b.mood, b.frame, b.coffeeOn, b.wordReady, b.fedCards, b.promise], [a.trust, a.ink, a.mood, a.frame, a.coffeeOn, a.wordReady, a.fedCards, a.promise]);
  const next = (j) => { j.beginNight(5); j.beginWatch(1); const w = j.whisper({ ctx: 'duel' }); const u = j.unasked('matchPoint', { duel: 'promise', rival: 'lucan' }); return [w && w.keys, u.struck, j.callLiar().right, j.snapshot()]; };
  assert.deepEqual(next(a), next(b));
  assert.equal(snap.v, 1);
});

test('a damaged save reads as a fresh start or is clamped, and never throws', () => {
  for (const bad of [null, undefined, 5, 'x', [], { v: 1, trust: 'hot', ink: null }]) {
    const j = new J.Joker(1);
    assert.doesNotThrow(() => j.restore(bad));
    assert.deepEqual([j.trust, j.ink, j.fedCards.length], [0, 0, 0]);
  }
  const j = new J.Joker(1);
  j.restore({ trust: 99, ink: -4, fed: ['mc01', 'zzz', 'mc01'], handed: ['mc01', 'mc02'], used: { a: 3, b: 'x' }, coffee: 7, healed: { n: 99 }, promise: { id: 5 }, tally: { we: -3 } });
  assert.deepEqual([j.trust, j.ink, j.fedCards, j.handedCards], [3, 0, ['mc01'], ['mc02']]);
  assert.equal(j.coffeeOn, false);
  assert.equal(j.promise, null);
  assert.equal(j.tally.we, 0);
  assert.equal(j.snapshot().used.b, undefined);
});

// ── tally, events, and the grin ──────────────────────────────────────────────────────────────────────────

test('the tally counts what he said with "we" and how many of those were wrong', () => {
  const j = make(80);
  for (let i = 0; i < 200; i++) { j.beginWatch(i + 1); j.whisper({ ctx: 'machine' }); j.whisper({ ctx: 'bigBet' }); }
  const t = j.tally;
  assert.equal(t.we + t.plain, 400);
  assert.equal(t.weWrong, 0, 'up to Ink 5 every "we" is a lie, so none is right');
  assert.equal(t.plainWrong, 0, 'and every plain line is true');
  assert.ok(t.we > 100 && t.plain > 100);
});

test('events carry the bus names and plain data', () => {
  const j = make(81);
  const w = j.whisper({ ctx: 'duel', ask: true });
  const names = w.events.map((e) => e.name);
  assert.deepEqual(names, ['joker:whisper', 'joker:ink']);
  const ev = w.events[0].data;
  assert.deepEqual(Object.keys(ev).sort(), ['ask', 'ctx', 'id', 'keys', 'n', 'truth', 'we']);
  const a = j.askTakeover({ where: 'crooked' });
  assert.deepEqual(a.events.map((e) => e.name), ['joker:trust', 'joker:ink', 'joker:takeover']);
  assert.doesNotThrow(() => JSON.stringify(a.events));
});

test('the grin: seven frames from Trust, sour/flat/fond, and from Ink 6 one glance in three shows the wrong frame', () => {
  assert.deepEqual([-3, -2, -1, 0, 1, 2, 3].map(J.grinFrame), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual([-2, 0, 2].map(J.moodOf), ['sour', 'flat', 'fond']);
  const r = rng('frame');
  let wrong = 0;
  for (let i = 0; i < 6000; i++) {
    const f = J.shownFrame(r, 1, 6);
    assert.ok(f >= 0 && f <= 6);
    if (f !== 4) wrong++;
    assert.equal(J.shownFrame(r, 1, 5), 4, 'true up to Ink 5');
  }
  near(wrong / 6000, 1 / 3, 0.03);
});
