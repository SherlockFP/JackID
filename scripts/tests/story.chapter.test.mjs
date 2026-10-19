// Tests for THE SECOND NAME (wave 73): the chapter record (src/game/story/chapter.ts) and its save round trip, the Night title
// cards and the reveal (their i18n keys in EN and TR, and the cutscene files), and the luck meter (src/game/luck.ts) that the run
// reads into its luck base. The chapter record is pure data, so the tests drive it directly, the way the run and the story do.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let CH, LUCK, EV, STRINGS, CALLS, CALLS_STR, PHONE_STR;
before(async () => {
  CH = await load('src/game/story/chapter.ts');
  LUCK = await load('src/game/luck.ts');
  EV = await load('src/core/events.ts');
  STRINGS = (await load('src/game/story/chapter.strings.ts')).default;
  CALLS = await load('src/game/story/calls.ts');
  CALLS_STR = (await load('src/game/story/calls.strings.ts')).default;
  PHONE_STR = (await load('src/game/home/phone.strings.ts')).default;
});

const NIGHTS = [1, 2, 3, 4, 5, 6, 7, 8];

test('a fresh chapter record starts with no cards, no beats, no reveal and no deal', () => {
  const c = CH.freshChapter();
  assert.equal(c.v, 1);
  assert.deepEqual(c.cards, []);
  assert.deepEqual(c.arcs, { mira: 0, collector: 0, spouse: 0, clerk: 0 });
  assert.equal(c.revealed, false);
  assert.equal(c.deal, 0);
});

test('readChapter reads nothing, garbage and a damaged record as a fresh record (older saves stay valid)', () => {
  for (const bad of [undefined, null, 7, 'x', [], {}]) {
    assert.deepEqual(CH.readChapter(bad), CH.freshChapter());
  }
  const damaged = CH.readChapter({ cards: [0, 9, 3, 3, 'x', 1.5], arcs: { mira: 9, collector: -1, spouse: 2, clerk: 'z' }, revealed: 'yes', deal: 5 });
  assert.deepEqual(damaged.cards, [3]);
  assert.deepEqual(damaged.arcs, { mira: 0, collector: 0, spouse: 2, clerk: 0 }, 'out-of-range beats read as none');
  assert.equal(damaged.revealed, false);
  assert.equal(damaged.deal, 0);
});

test('Night title cards play once each, in order, and only for the chapter spine (Nights 1 to 8)', () => {
  const c = CH.freshChapter();
  assert.equal(CH.markCard(c, 1), true);
  assert.equal(CH.markCard(c, 1), false, 'a card never replays');
  assert.equal(CH.markCard(c, 0), false);
  assert.equal(CH.markCard(c, 9), false);
  CH.markCard(c, 3); CH.markCard(c, 2);
  assert.deepEqual(c.cards, [1, 2, 3]);
});

test('every Night has a title card whose title and line exist in EN and TR', () => {
  for (const n of NIGHTS) {
    const k = CH.chapterKeys(n);
    assert.ok(k, `keys for Night ${n}`);
    for (const lang of ['en', 'tr']) {
      const table = STRINGS[lang];
      assert.ok(typeof table[k.title.replace('story.', '')] === 'string' && table[k.title.replace('story.', '')].length > 0, `${lang} title ${n}`);
      assert.ok(typeof table[k.line.replace('story.', '')] === 'string' && table[k.line.replace('story.', '')].length > 0, `${lang} line ${n}`);
    }
  }
  assert.equal(CH.chapterKeys(0), null);
  assert.equal(CH.chapterKeys(9), null);
});

test('the Night 8 title is THE SECOND NAME, and the chapter ends on Night 8', () => {
  assert.equal(CH.CHAPTER_LAST_NIGHT, 8);
  assert.equal(STRINGS.en['chapter.n8.title'], 'THE SECOND NAME');
  assert.equal(STRINGS.en['chapter.n1.title'], 'THE FIRST NAME');
});

test('arcs move forward only, one beat at a time, and cap at three beats', () => {
  const c = CH.freshChapter();
  assert.equal(CH.advanceArc(c, 'mira', 1), true);
  assert.equal(CH.advanceArc(c, 'mira', 1), false, 'the same beat is not a move');
  assert.equal(CH.advanceArc(c, 'mira', 0), false, 'beats never go back');
  assert.equal(CH.advanceArc(c, 'mira', 2), true);
  assert.equal(CH.advanceArc(c, 'mira', 7), true);
  assert.equal(c.arcs.mira, 3, 'the arc caps at three beats');
  assert.equal(c.arcs.collector, 0, 'other arcs are untouched');
});

test('the three-beat arcs line up with the Nights of the spine', () => {
  // Mira: N2, N5, N8 (the calls), in the table the hotline reads
  assert.equal(CALLS.MIRA_BEAT.mira_n2, 1);
  assert.equal(CALLS.MIRA_BEAT.mira_n5, 2);
  assert.equal(CALLS.MIRA_BEAT.mira_n8, 3);
  assert.equal(CALLS.storyCallFor(8).id, 'mira_n8');
  {
    for (const k of CALLS.storyCallFor(8).lines) {
      const key = k.replace('story.', '');
      assert.ok(typeof CALLS_STR.en[key] === 'string' && typeof CALLS_STR.tr[key] === 'string', `call line ${key}`);
    }
  }
  // Spouse card messages: N2, N5, N8 (beats 1, 2, 3)
  assert.deepEqual({ ...CH.SPOUSE_CARD_BEAT }, { 2: 1, 5: 2, 8: 3 });
  for (const id of ['card2', 'card5', 'card8']) {
    assert.ok(typeof PHONE_STR.en[`sp.${id}.t`] === 'string' && typeof PHONE_STR.tr[`sp.${id}.t`] === 'string', `card ${id}`);
    for (const r of ['r0', 'r1', 'r2']) assert.ok(PHONE_STR.en[`sp.${id}.${r}`] && PHONE_STR.tr[`sp.${id}.${r}`], `card ${id} ${r}`);
  }
  // Collector deal and warning texts
  for (const key of ['co.warn.n2', 'co.deal.t', 'co.deal.r0', 'co.deal.r1']) {
    assert.ok(PHONE_STR.en[key] && PHONE_STR.tr[key], key);
  }
});

test('the chapter record round trips through a save (copy, restore, same progress)', () => {
  const c = CH.freshChapter();
  for (const n of [1, 2, 5]) CH.markCard(c, n);
  CH.advanceArc(c, 'mira', 2); CH.advanceArc(c, 'spouse', 2); CH.advanceArc(c, 'clerk', 1);
  c.deal = 1;
  const saved = JSON.parse(JSON.stringify(CH.cloneChapter(c)));
  const back = CH.readChapter(saved);
  assert.deepEqual(back, c);
  // a copy is detached: changing the copy leaves the original alone
  const copy = CH.cloneChapter(c);
  CH.markCard(copy, 8);
  assert.deepEqual(c.cards, [1, 2, 5]);
  // progress continues from the restored record
  assert.equal(CH.markCard(back, 2), false, 'a restored run does not replay the Night 2 card');
  assert.equal(CH.advanceArc(back, 'mira', 3), true);
});

test('the Night 8 reveal plays once: the reveal flag is the guard, and the reveal text names the champion the second name beat', () => {
  const c = CH.freshChapter();
  assert.equal(c.revealed, false);
  c.revealed = true;
  const back = CH.readChapter(JSON.parse(JSON.stringify(c)));
  assert.equal(back.revealed, true);
  for (const k of ['reveal.1', 'reveal.2', 'reveal.3', 'reveal.4']) {
    assert.ok(STRINGS.en[k] && STRINGS.tr[k], k);
  }
  assert.match(STRINGS.en['reveal.2'], /champion/);
  assert.match(STRINGS.tr['reveal.2'], /şampiyon/);
});

test('each chapter card scene file exists and names its own Night', async () => {
  for (const n of NIGHTS) {
    const mod = await load(`src/game/story/cutscenes/chapter_n${n}.cutscene.ts`);
    assert.equal(mod.default.id, `chapter_n${n}`);
    const subs = mod.default.tracks.find((t) => t.kind === 'subtitle').cues.map((c) => c.key);
    assert.deepEqual(subs, [`story.chapter.n${n}.title`, `story.chapter.n${n}.line`]);
  }
  const reveal = await load('src/game/story/cutscenes/reveal_n8.cutscene.ts');
  assert.equal(reveal.default.id, 'reveal_n8');
});

// ── the luck meter ──────────────────────────────────────────────────────────────────────────────

test('the luck meter starts at zero stars and adds no payout bonus', () => {
  const m = LUCK.createLuckMeter({});
  assert.equal(m.stars(), 0);
  assert.equal(m.payoutMult(), 1);
  m.dispose();
});

test('the luck meter moves on the run events and stays between -2 and 5 stars', () => {
  const m = LUCK.createLuckMeter({});
  for (let i = 0; i < 9; i++) EV.bus.emit('quota:met', { index: i, ratio: 1 });
  assert.equal(m.stars(), 5, 'capped at five stars');
  assert.equal(m.payoutMult(), 1.05, '5 stars pay +5 %');
  EV.bus.emit('quota:failed', { index: 9 });
  assert.equal(m.stars(), 3);
  for (let i = 0; i < 5; i++) EV.bus.emit('quota:failed', { index: i });
  assert.equal(m.stars(), -2, 'floored at minus two stars');
  assert.equal(m.payoutMult(), 0.98, '-2 stars pay -2 %');
  m.dispose();
});

test('Collector heat moves the meter: a gain costs a star, a cool-off gives one back', () => {
  const m = LUCK.createLuckMeter({});
  EV.bus.emit('home:heat', { delta: 1, heat: 1, why: 'tithe' });
  assert.equal(m.stars(), -1);
  EV.bus.emit('home:heat', { delta: -1, heat: 0, why: 'quiet' });
  assert.equal(m.stars(), 0);
  m.dispose();
});

test('the luck meter saves and restores its stars; a damaged slice reads as zero', () => {
  const a = LUCK.createLuckMeter({});
  EV.bus.emit('quota:met', { index: 0, ratio: 1 });
  EV.bus.emit('quota:met', { index: 1, ratio: 1 });
  const saved = JSON.parse(JSON.stringify(a.snapshot()));
  const b = LUCK.createLuckMeter({});
  b.restore(saved);
  assert.equal(b.stars(), 2);
  assert.equal(b.payoutMult(), 1.02, '2 stars pay +2 %');
  b.restore('nonsense');
  assert.equal(b.stars(), 0);
  b.restore({ stars: 99 });
  assert.equal(b.stars(), 5);
  a.dispose();
  b.dispose();
});

test('a disposed luck meter stops listening to the bus', () => {
  const m = LUCK.createLuckMeter({});
  m.dispose();
  EV.bus.emit('quota:met', { index: 0, ratio: 1 });
  assert.equal(m.stars(), 0);
});
