// THE ENDINGS (STORY wave A5, src/game/story/endings.ts): every routing branch, the priority order, "the kept pair beats everything except the
// run-enders that come before the Wager", bonds that never gate an ending, Loki's variants (docs/STORY_BIBLE.md §9), Ada's end, the save
// record and its tolerant reader, and the nine cutscene files (three full scenes, six cards): ids, line counts, timing, hooks, anchors, and
// EN+TR copy with no dashes.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let E, B, CH, STR, TABLES, HOME, CARD, ALL;
const SCENES = {};
before(async () => {
  E = await load('src/game/story/endings.ts');
  B = await load('src/game/bonds.ts');
  CH = await load('src/game/story/chapter.ts');
  ALL = [...B.BOND_IDS];
  CARD = await load('src/game/story/cutscenes/endingCard.ts');
  HOME = (await load('src/game/home/contract.ts')).HOME_ANCHORS;
  STR = (await load('src/game/story/endings.strings.ts')).default;
  const mods = [STR, (await load('src/game/story/story.strings.ts')).default, (await load('src/game/home/evening.strings.ts')).default];
  TABLES = { en: new Map(), tr: new Map() };
  for (const m of mods) for (const lang of ['en', 'tr']) for (const [k, v] of Object.entries(m[lang])) TABLES[lang].set(m.prefix + k, v);
  for (const id of E.ENDING_IDS) SCENES[id] = (await load(`src/game/story/cutscenes/ending_${id}.cutscene.ts`)).default;
});

const F = (o = {}) => ({ ...E.freshFacts(), ...o });
const route = (o) => E.routeEnding(F(o));
const CLEAN = { night: 8, paid: true, kitchen: 'win', wager: 'win' };
const PAIRED = { night: 8, paid: true, kitchen: 'pair', pairs: 3, wager: 'win' };

// ── routing ──────────────────────────────────────────────────────────────────────────────────────────

test('the nine endings are the bible\'s, in its table order', () => {
  assert.deepEqual([...E.ENDING_IDS], ['kept_pair', 'cold_kitchen', 'alone', 'chair', 'kept', 'paid_in_full', 'he_came_home', 'descend', 'fall']);
  assert.deepEqual([...E.FULL_ENDINGS], ['kept_pair', 'cold_kitchen', 'kept']);
  assert.equal(E.endingScene('kept_pair'), 'ending_kept_pair');
});

test('every routing branch', () => {
  const rows = [
    ['Ink 10', { cameHome: true, night: 6 }, 'he_came_home'],
    ['the Night 7 deal signed', { deal: 1, night: 7 }, 'paid_in_full'],
    ['the deal refused is no deal', { deal: 2, night: 7 }, null],
    ['a missed quota', { fell: true, night: 3, seals: 0 }, 'fall'],
    ['the kitchen wager lost', { kitchen: 'lose', night: 8 }, 'kept'],
    ['the Wager lost after a kitchen win', { ...CLEAN, wager: 'lose' }, 'chair'],
    ['the Wager lost after a kitchen draw', { ...PAIRED, wager: 'lose' }, 'chair'],
    ['kitchen draw, Wager won clean', PAIRED, 'kept_pair'],
    ['kitchen win, Wager won clean', CLEAN, 'cold_kitchen'],
    ['a clean win with no kitchen on record', { night: 8, paid: true, wager: 'win' }, 'cold_kitchen'],
    ['kitchen draw, a crack at the Wager', { ...PAIRED, cracks: 1 }, 'alone'],
    ['kitchen draw, his hand at the Wager', { ...PAIRED, lokiHand: true }, 'alone'],
    ['kitchen win, a crack at the Wager', { ...CLEAN, cracks: 2 }, 'alone'],
    ['kitchen win, his hand at the Wager', { ...CLEAN, lokiHand: true }, 'alone'],
    ['DESCEND before Night 8', { descended: true, night: 3 }, 'descend'],
    ['DESCEND after a dirty win', { ...CLEAN, cracks: 1, descended: true }, 'descend'],
    ['DESCEND after a clean win: the card burned, so there is no card to take down', { ...CLEAN, descended: true }, 'cold_kitchen'],
    ['Night 8 paid and no Wager played (the old topside)', { night: 8, paid: true }, 'alone'],
    ['a quit', {}, null],
    ['Night 8 reached and nothing settled', { night: 8 }, null],
  ];
  for (const [name, o, want] of rows) assert.equal(route(o), want, name);
});

test('the priority order is the documented one, and each rule beats every later rule', () => {
  assert.deepEqual([...E.PRIORITY], ['he_came_home', 'paid_in_full', 'fall', 'kept', 'chair', 'kept_pair', 'cold_kitchen', 'descend', 'alone']);
  assert.deepEqual([...E.PRIORITY].sort(), [...E.ENDING_IDS].sort(), 'every ending is routable, once');
  const witness = {
    he_came_home: { cameHome: true }, paid_in_full: { deal: 1 }, fall: { fell: true }, kept: { kitchen: 'lose' }, chair: { wager: 'lose' },
    kept_pair: { kitchen: 'pair', wager: 'win' }, cold_kitchen: { kitchen: 'win', wager: 'win' }, descend: { descended: true }, alone: { paid: true },
  };
  for (const [id, o] of Object.entries(witness)) assert.equal(route(o), id, `${id} alone`);
  for (let i = 0; i < E.PRIORITY.length; i++) {
    for (let j = i + 1; j < E.PRIORITY.length; j++) {
      const a = E.PRIORITY[i], b = E.PRIORITY[j];
      assert.equal(route({ ...witness[b], ...witness[a] }), a, `${a} beats ${b}`);
    }
  }
});

test('the kept pair beats everything except the run-enders that come before the Wager', () => {
  const night = [1, 5, 8], flag = [false, true], harmony = [0, 2, 5], trust = [-3, 0, 3], seals = [0, 3];
  const waiting = [[], ALL, ['selim']], deal = [0, 2];
  let n = 0;
  for (const nt of night) for (const paid of flag) for (const descended of flag) for (const h of harmony) for (const tr of trust)
    for (const s of seals) for (const word of flag) for (const visitUsed of flag) for (const w of waiting) for (const d of deal) {
      const f = F({ ...PAIRED, night: nt, paid, descended, harmony: h, trust: tr, seals: s, wordAtMatchPoint: word, visitUsed, waiting: w, deal: d });
      assert.equal(E.routeEnding(f), 'kept_pair', JSON.stringify(f));
      n++;
    }
  assert.equal(n, 3 * 2 * 2 * 3 * 3 * 2 * 2 * 2 * 3 * 2);
  // the stated exceptions: each ends the run before the Wager can be won
  assert.equal(route({ ...PAIRED, cameHome: true }), 'he_came_home');
  assert.equal(route({ ...PAIRED, deal: 1 }), 'paid_in_full');
  assert.equal(route({ ...PAIRED, fell: true }), 'fall');
  // and the three ways the Wager itself is not clean
  assert.equal(route({ ...PAIRED, cracks: 1 }), 'alone');
  assert.equal(route({ ...PAIRED, lokiHand: true }), 'alone');
  assert.equal(route({ ...PAIRED, wager: 'lose' }), 'chair');
});

test('bonds never gate an ending: any set of friends routes the same', () => {
  const bases = [PAIRED, CLEAN, { ...PAIRED, cracks: 1 }, { ...CLEAN, wager: 'lose' }, { kitchen: 'lose', night: 8 }, { deal: 1 }, { fell: true }, { descended: true }, {}];
  for (const base of bases) {
    const want = route(base);
    for (let mask = 0; mask < 1 << ALL.length; mask++) {
      const waiting = ALL.filter((_, i) => mask & (1 << i));
      assert.equal(route({ ...base, waiting }), want, `${want} with ${waiting}`);
    }
  }
});

// ── the save record ───────────────────────────────────────────────────────────────────────────────────

test('only a clean Wager win burns the card', () => {
  const rec = (o) => E.endingRecord(F(o));
  assert.equal(rec(PAIRED).burned, true);
  assert.equal(rec(CLEAN).burned, true);
  for (const o of [{ ...PAIRED, cracks: 1 }, { kitchen: 'lose' }, { ...CLEAN, wager: 'lose' }, { deal: 1 }, { cameHome: true }, { fell: true }, { descended: true }, { paid: true }]) {
    assert.equal(rec(o).burned, false, JSON.stringify(o));
  }
  assert.equal(rec({}), null, 'a run without an ending has no record');
});

test('who waits for you: KEPT PAIR the bond-3 friends, COLD KITCHEN and THE CHAIR Selim, the rest nobody', () => {
  const rec = (o, waiting) => E.endingRecord(F({ ...o, waiting })).waiting;
  assert.deepEqual(rec(PAIRED, ALL), ALL);
  assert.deepEqual(rec(PAIRED, ['mira', 'vell']), ['mira', 'vell']);
  assert.deepEqual(rec(CLEAN, ALL), ['selim']);
  assert.deepEqual(rec(CLEAN, ['mira']), []);
  assert.deepEqual(rec({ ...CLEAN, wager: 'lose' }, ALL), ['selim']);
  for (const o of [{ paid: true }, { kitchen: 'lose' }, { deal: 1 }, { cameHome: true }, { fell: true }, { descended: true }]) assert.deepEqual(rec(o, ALL), [], JSON.stringify(o));
});

test('Loki\'s variants (STORY_BIBLE §9 "His part in each ending")', () => {
  const rec = (o) => E.endingRecord(F(o));
  // burned with the card, unless his word was spent at match point: then the fire cannot take him
  for (const base of [PAIRED, CLEAN]) {
    assert.deepEqual([rec(base).loki, rec(base).lokiLine], ['burns', 'story.end.loki.burn']);
    assert.deepEqual([rec({ ...base, wordAtMatchPoint: true }).loki, rec({ ...base, wordAtMatchPoint: true }).lokiLine], ['stays', 'story.end.loki.stay']);
  }
  // his word spent elsewhere changes nothing; it only counts at match point
  assert.equal(rec({ ...PAIRED, trust: 3 }).loki, 'burns');
  // a dirty win: he rides up
  assert.deepEqual([rec({ ...PAIRED, cracks: 1, wordAtMatchPoint: true }).loki, rec({ ...PAIRED, lokiHand: true }).lokiLine], ['rides', 'story.end.loki.rides']);
  // the lost Wager: he goes home to the rest of him, and Ink 10: he wins. Neither has a line.
  assert.deepEqual([rec({ ...CLEAN, wager: 'lose' }).loki, rec({ ...CLEAN, wager: 'lose' }).lokiLine], ['home', '']);
  assert.deepEqual([rec({ cameHome: true }).loki, rec({ cameHome: true }).lokiLine], ['wins', '']);
  // the two trades he likes
  assert.equal(rec({ kitchen: 'lose' }).loki, 'likes');
  assert.equal(rec({ deal: 1 }).loki, 'likes');
  assert.equal(rec({ kitchen: 'lose' }).lokiLine, 'story.end.loki.likes');
  // the Visit: he offers once if he has not used it, and his last words are "Shame. Good hands."; else he is silent
  assert.deepEqual([rec({ fell: true }).loki, rec({ fell: true }).lokiLine], ['offers', 'story.end.loki.shame']);
  assert.deepEqual([rec({ fell: true, visitUsed: true }).loki, rec({ fell: true, visitUsed: true }).lokiLine], ['silent', 'story.end.loki.hush']);
  // DESCEND: he comes along, half his Trust carries over, the Ink starts clean
  assert.deepEqual([rec({ descended: true }).loki, rec({ descended: true }).lokiLine], ['comes', 'story.end.loki.comes']);
  for (const [trust, half] of [[3, 1], [2, 1], [1, 0], [0, 0], [-1, 0], [-2, -1], [-3, -1], [9, 1], [-9, -1]]) {
    const carry = rec({ descended: true, trust }).carry;
    assert.ok(Object.is(carry.trust, half), `trust ${trust} carries ${half}`);
    assert.equal(carry.ink, 0);
  }
  assert.equal(rec(PAIRED).carry, null);
});

test('every Loki line the record can name exists in EN and TR, and his two bible lines read as written', () => {
  for (const key of Object.values(E.LOKI_LINE).filter(Boolean)) {
    for (const lang of ['en', 'tr']) assert.ok(TABLES[lang].get(key), `${lang} ${key}`);
  }
  assert.equal(STR.en['loki.stay'], "Looks like I'm staying. I'll keep quiet in the kitchen.");
  assert.equal(STR.tr['loki.stay'], 'Demek kalıyorum. Mutfakta sesimi çıkarmam.');
  assert.equal(STR.en['loki.burn'], 'Next card.');
});

test('Ada\'s end', () => {
  const ada = (o) => E.endingRecord(F(o)).ada;
  assert.equal(ada(PAIRED), 'beside');
  assert.equal(ada(CLEAN), 'still');
  assert.equal(ada({ ...PAIRED, cracks: 1 }), 'rides', 'ALONE after a draw: she rides up holding your gloved hand');
  assert.equal(ada({ ...CLEAN, cracks: 1 }), 'still');
  assert.equal(ada({ paid: true }), 'home', 'ALONE with no kitchen on record: she is at home');
  assert.equal(ada({ ...CLEAN, wager: 'lose' }), null, 'the bible does not say where she is in THE CHAIR');
  assert.equal(ada({ kitchen: 'lose' }), 'gone');
  assert.equal(ada({ deal: 1 }), 'taken');
  assert.equal(ada({ cameHome: true }), 'table');
  assert.equal(ada({ descended: true }), 'waits');
  // FALL: from Night 5, if she is home, she opens the door herself
  assert.equal(ada({ fell: true, night: 4, harmony: 3 }), null);
  assert.equal(ada({ fell: true, night: 5, harmony: 0 }), null, 'Harmony 0 from Night 5: she is on the floor');
  assert.equal(ada({ fell: true, night: 5, harmony: 1 }), 'door');
  assert.equal(ada({ fell: true, night: 8, harmony: 5 }), 'door');
});

test('the record clamps what it stores and survives a JSON round trip; the reader repairs damage', () => {
  const r = E.endingRecord(F({ ...PAIRED, night: 99, seals: -4, pairs: 1e9, waiting: ['mira', 'selim'] }));
  assert.deepEqual([r.v, r.id, r.night, r.seals, r.pairs], [1, 'kept_pair', 8, 0, 99]);
  for (const id of E.ENDING_IDS) {
    const facts = { kept_pair: PAIRED, cold_kitchen: CLEAN, alone: { paid: true }, chair: { wager: 'lose' }, kept: { kitchen: 'lose' }, paid_in_full: { deal: 1 }, he_came_home: { cameHome: true }, descend: { descended: true, trust: -3 }, fall: { fell: true, night: 6 } }[id];
    const rec = E.endingRecord(F({ ...facts, waiting: ALL }));
    assert.equal(rec.id, id);
    assert.deepEqual(E.readEnding(JSON.parse(JSON.stringify(rec))), rec, id);
  }
  for (const bad of [undefined, null, 7, 'x', [], {}, { id: 'nope' }, { id: 5 }]) assert.equal(E.readEnding(bad), null);
  const damaged = E.readEnding({ id: 'descend', night: 12, burned: true, ada: 'flying', loki: 'x', waiting: ['mira', 'zed', 'mira'], seals: 7, pairs: -1, carry: { trust: 5, ink: 9 } });
  assert.deepEqual(damaged, { v: 1, id: 'descend', night: 8, burned: false, ada: null, loki: 'silent', lokiLine: 'story.end.loki.hush', waiting: ['mira'], seals: 0, pairs: 0, carry: { trust: 0, ink: 0 } });
});

// ── the scenes ───────────────────────────────────────────────────────────────────────────────────────

const subs = (def) => def.tracks.filter((t) => t.kind === 'subtitle').flatMap((t) => t.cues);
const hooks = (def) => def.tracks.filter((t) => t.kind === 'hook').flatMap((t) => t.cues.map((c) => c.hook));
const has = (lang, key) => typeof TABLES[lang].get(key) === 'string' && TABLES[lang].get(key).length > 0;

test('every ending has a cutscene file under its id: three full scenes of 8 to 14 lines, six cards of 2 to 3 lines and a title', () => {
  for (const id of E.ENDING_IDS) {
    const def = SCENES[id];
    assert.equal(def.id, E.endingScene(id), id);
    assert.equal(def.kind, 'ending');
    assert.notEqual(def.skippable, false, 'an ending can be skipped');
    const cues = subs(def);
    assert.equal(cues.at(-1).key, E.endingTitleKey(id), `${id} ends on its name`);
    if (E.FULL_ENDINGS.includes(id)) assert.ok(cues.length >= 8 && cues.length <= 14, `${id}: ${cues.length} cues`);
    else assert.ok(cues.length - 1 >= 2 && cues.length - 1 <= 3, `${id}: ${cues.length - 1} lines`);
  }
  assert.deepEqual([...CARD.CARD_IDS].sort(), E.ENDING_IDS.filter((id) => !E.FULL_ENDINGS.includes(id)).sort(), 'the cards are the six others');
  assert.equal(new Set(E.ENDING_IDS.map((id) => SCENES[id].id)).size, 9);
});

test('the scenes\' lines fit their duration, never overlap, and exist in EN and TR with their speakers', () => {
  for (const id of E.ENDING_IDS) {
    const def = SCENES[id];
    let end = 0;
    for (const c of subs(def)) {
      assert.ok(c.t >= end - 1e-9, `${id}: "${c.key}" starts at ${c.t} before the last line ends at ${end}`);
      end = c.t + c.dur;
      for (const lang of ['en', 'tr']) {
        assert.ok(has(lang, c.key), `${id} ${lang} ${c.key}`);
        if (c.speaker) assert.ok(has(lang, c.speaker), `${id} ${lang} speaker ${c.speaker}`);
      }
    }
    assert.ok(end <= def.duration, `${id}: the last line ends at ${end}, the scene at ${def.duration}`);
  }
});

test('the scenes use only hooks, anchors and actors that exist', () => {
  const okHooks = new Set([...Object.values(E.ENDING_HOOK), 'home.doorOpen']);
  const okAnchors = new Set([...Object.values(HOME), 'stage.compere', 'elevator', 'quotaBoard']);
  for (const id of E.ENDING_IDS) {
    const def = SCENES[id];
    for (const h of hooks(def)) assert.ok(okHooks.has(h), `${id}: hook ${h}`);
    const json = JSON.stringify(def.tracks);
    for (const m of json.matchAll(/"anchor":"([^"]+)"/g)) assert.ok(okAnchors.has(m[1]), `${id}: anchor ${m[1]}`);
    const declared = new Set(Object.keys(def.actors ?? {}));
    for (const m of json.matchAll(/"actor":"([^"]+)"/g)) assert.ok(declared.has(m[1]), `${id}: actor ${m[1]} is not declared`);
  }
  // the play notes are true: the burn hook is in the two clean endings, the flat is dressed in the three that end at home
  assert.ok(hooks(SCENES.kept_pair).includes('ending.burn') && hooks(SCENES.cold_kitchen).includes('ending.burn'));
  for (const id of ['kept_pair', 'cold_kitchen', 'kept']) assert.ok(hooks(SCENES[id]).includes('ending.home'), id);
});

test('a scene with a {loki} line says so in both languages, and the record names a line for it', () => {
  const withVar = E.ENDING_IDS.filter((id) => subs(SCENES[id]).some((c) => c.key === 'story.end.loki'));
  assert.deepEqual(withVar.sort(), ['cold_kitchen', 'fall', 'kept_pair']);
  assert.equal(STR.en.loki, '{loki}');
  assert.equal(STR.tr.loki, '{loki}');
  for (const id of withVar) {
    const facts = { kept_pair: PAIRED, cold_kitchen: CLEAN, fall: { fell: true } }[id];
    for (const o of [{}, { wordAtMatchPoint: true }, { visitUsed: true }]) assert.ok(E.endingRecord(F({ ...facts, ...o })).lokiLine, `${id} always names a line`);
  }
});

test('the copy: same keys in EN and TR, same placeholders, no empty value, no dashes, every name as the bible has it', () => {
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.tr).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const [k, v] of Object.entries(STR.en)) {
    assert.ok(v.length > 0 && STR.tr[k].length > 0, k);
    assert.equal(ph(v), ph(STR.tr[k]), `${k} placeholders`);
    for (const s of [v, STR.tr[k]]) {
      assert.ok(!/[–—]/.test(s), `${k}: no em or en dash`);
      assert.ok(!/clover|chest/i.test(s), `${k}: original IP`);
    }
  }
  assert.deepEqual(E.ENDING_IDS.map((id) => STR.en[`${id}.title`]), ['KEPT PAIR', 'COLD KITCHEN', 'ALONE', 'THE CHAIR', 'KEPT', 'PAID IN FULL', 'HE CAME HOME', 'DESCEND', 'FALL']);
  assert.equal(STR.tr['kept_pair.title'], 'SÖZ SÖZE');
  assert.equal(STR.tr['cold_kitchen.title'], 'SOĞUK MUTFAK');
  assert.equal(STR.tr['kept.title'], 'SAKLI');
  assert.equal(STR.tr['paid_in_full.title'], 'TAMAMI ÖDENDİ');
  assert.equal(STR.en['kept_pair.9'], 'Ha. There you are.');
  assert.equal(STR.tr['kept_pair.9'], 'Hah. İşte buradasın.');
  assert.equal(STR.en['he_came_home.3'], 'Sit down. I beat you once.');
});

// ── the wiring (A5): a real run fills the facts, routes, saves the record, and keeps the facts through a resume ─────────────────

test('each ending has a witness that routes to it, and its scene id resolves to a cutscene file', () => {
  for (const id of E.ENDING_IDS) {
    const rec = E.endingRecord(F(E.ENDING_WITNESS[id]));
    assert.equal(rec?.id, id, `${id} witness`);
    assert.equal(SCENES[rec.id].id, E.endingScene(rec.id), `${id}: the scene played is the file's`);
  }
});

describe('the run', () => {
  let RUN, EV;
  before(async () => {
    RUN = await load('src/game/run.ts');
    EV = await load('src/core/events.ts');
    (await load('src/machines/_base/registry.ts')).load();
  });
  const paidDawn = (run) => { run.debtPaid = run.quota.due; run.syncQuota(); run.phase = 'collection'; run.dawn(); };
  const at = (night, seed) => { const run = RUN.createRun({ seed, mode: 'debt', home: true }); run.index = night - 1; return run; };
  const game = (wager, pairs = 0, you = 0) => ({ left: false, wager, pairs, cracks: { you, ada: 0 } });
  /** Plays the N8 kitchen wager in the Evening that opens Night 8, then Night 8 paid and the Burning Wager (won clean by default). */
  function finale(kitchen, seed, wager = { wager: 'win', cracks: 0 }) {
    const run = at(7, seed);
    run.kitchenDone(game(kitchen, kitchen === 'pair' ? 3 : 0));
    run.index = 7;
    paidDawn(run);
    assert.equal(run.topsideOpen, true);
    assert.equal(run.wagerDue(), true, 'the paid Night 8 Dawn opens the Burning Wager');
    const ends = [];
    const off = EV.bus.on('run:end', ({ summary }) => ends.push(summary));
    run.burningWager(wager);
    off();
    run.dispose();
    return { rec: run.endingRecord(), summary: ends[0] };
  }

  test('a drawn kitchen wager (three kept pairs) then Night 8: KEPT PAIR, and the summary keeps its own tag', () => {
    const { rec, summary } = finale('pair', 9101);
    assert.equal(rec.id, 'kept_pair');
    assert.equal(rec.pairs, 3);
    assert.equal(rec.ada, 'beside');
    assert.equal(summary.endingId, 'kept_pair');
    assert.equal(summary.ending, 'elevator', 'results and Obols still read the run tag');
  });

  test('Ada beaten at the wager then Night 8: COLD KITCHEN; no wager at all: ALONE', () => {
    assert.equal(finale('win', 9102).rec.id, 'cold_kitchen');
    const run = at(8, 9103);
    paidDawn(run);
    run.stayUp();
    assert.equal(run.endingRecord().id, 'alone', 'no kitchen on record: the lift does not stand in for the Wager');
    run.dispose();
  });

  test('the lift no longer stands in for the Wager: a kitchen on record and STAY UP is ALONE; a cracked win is ALONE; a loss is THE CHAIR', () => {
    const run = at(7, 9109);
    run.kitchenDone(game('pair', 3));
    run.index = 7;
    paidDawn(run);
    run.stayUp();
    assert.equal(run.endingRecord().id, 'alone');
    run.dispose();
    assert.equal(finale('pair', 9110, { wager: 'win', cracks: 1 }).rec.id, 'alone');
    const chair = finale('win', 9111, { wager: 'lose', cracks: 0 });
    assert.equal(chair.rec.id, 'chair');
    assert.equal(chair.summary.ending, 'chair');
  });

  test('losing to Ada ends the run on the spot: KEPT', () => {
    const run = at(7, 9104);
    run.kitchenDone(game('lose'));
    assert.equal(run.over, true);
    assert.equal(run.endingRecord().id, 'kept');
    assert.equal(run.endingRecord().ada, 'gone');
    run.dispose();
  });

  test('a crack at an ordinary table is a broken word; a left game counts for nothing', () => {
    const run = at(3, 9105);
    run.kitchenDone({ ...game(null), left: true, cracks: { you: 2, ada: 0 } });
    assert.equal(run.chapterRecord().broken, false);
    run.kitchenDone(game(null, 0, 1));
    assert.equal(run.chapterRecord().broken, true);
    assert.equal(run.chapterRecord().kitchen, null, 'an ordinary game is not the wager');
    run.dispose();
  });

  test('the Night 7 deal signed ends the run at that Dawn: PAID IN FULL', () => {
    const run = at(7, 9106);
    run.chapterRecord().deal = 1;
    paidDawn(run);
    assert.equal(run.over, true);
    assert.equal(run.endingRecord().id, 'paid_in_full');
    run.dispose();
  });

  test('a quit reaches no ending', () => {
    const run = at(8, 9107);
    run.chapterRecord().deal = 1;
    run.quit();
    assert.equal(run.endingRecord(), null);
    run.dispose();
  });

  test('the facts survive a save mid-run: kitchen, pairs, hints and the broken word', () => {
    const run = at(7, 9108);
    EV.bus.emit('phone:story', { callId: 1, id: 'mira_n7', speaker: 'story.speaker.mira', lines: [] });
    run.kitchenDone(game(null, 0, 1));
    run.kitchenDone(game('pair', 3));
    const facts = run.endingFacts();
    assert.equal(run.chapterRecord().hints, 1 << CH.PAIR_HINTS.indexOf('mira'));
    assert.equal(CH.hintsHeard(run.chapterRecord()), 1);
    const snap = JSON.parse(JSON.stringify(run.snapshot()));
    const store = { data: { resume: snap }, update(fn) { fn(this.data); }, flush() {} };
    const back = RUN.resumeRun(store, { home: true });
    assert.deepEqual(back.endingFacts(), facts);
    assert.deepEqual(back.chapterRecord(), run.chapterRecord());
    back.dispose();
    run.dispose();
  });
});
