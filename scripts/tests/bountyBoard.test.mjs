// Bounty Board presentation tests (src/machines/bounty_board): the board hangs in front of the Mouth wall, every slip shows a
// reward, an empty row says the right thing, and the slip text fits the paper in both languages (px5 metrics, no canvas).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(async () => { I.setLang('en'); await closeVite(); });

let R, S, PL, F, I, LAY, ITEMS;
before(async () => {
  R = await load('src/machines/bounty_board/rules.ts');
  S = (await load('src/machines/bounty_board/bounty_board.strings.ts')).default;
  PL = await load('src/machines/_base/placard3d.ts');
  F = await load('src/core/texgen/font.ts');
  I = await load('src/core/i18n.ts');
  LAY = await load('src/world/layout.ts');
  ITEMS = await load('src/game/items/data.ts');
  I.registerStrings(S.prefix, { en: S.en, tr: S.tr });
});

test('the board hangs on the Mouth wall face, not inside the wall', () => {
  // level.ts: the north wall runs along z = -30, 0.3 m thick, so its room-side face is at z = -29.85. The seated view was only
  // wall texture while the board's back sat 0.2 m deeper than this.
  const WALL_FACE = -30 + 0.3 / 2;
  const slot = LAY.SLOTS.find((s) => s.id === 'MOUTH-BOUNTY');
  assert.equal(slot.rotY, 0, 'the model faces +Z; a rotated slot would hang it the wrong way');
  assert.ok(slot.pos[2] + R.BOARD_BACK_Z >= WALL_FACE - 1e-6, `board back at ${slot.pos[2] + R.BOARD_BACK_Z}, wall face at ${WALL_FACE}`);
  assert.ok(slot.pos[2] + R.BOARD_BACK_Z <= WALL_FACE + 0.05, 'and not floating off the wall');
});

test('every catalogue contract names a reward on its slip', () => {
  for (const d of R.BOUNTY_CATALOGUE) assert.notEqual(R.rewardOf(d).kind, 'none', d.id);
  const by = (id) => R.rewardOf(R.bountyDef(id));
  assert.deepEqual(by('b_point'), { kind: 'tickets', n: 3 });
  assert.deepEqual(by('b_elevator5'), { kind: 'tickets', n: 2 });      // Tickets win over the quota share on the same slip
  assert.deepEqual(by('b_cross'), { kind: 'quota', n: 10 });
  assert.deepEqual(by('b_bell_night'), { kind: 'totem', id: 'profit_bell' });
  assert.equal(by('b_four_suits').kind, 'charm');
  assert.equal(by('b_devil2').kind, 'unlock');
  assert.equal(by('b_early_half').kind, 'buff');
  assert.equal(R.rewardOf(undefined).kind, 'none');
});

test('an empty offer row says "no new slips" only when the whole board is empty', () => {
  assert.equal(R.emptyWhy(0, 0), 'none');
  assert.equal(R.emptyWhy(2, 0), 'none');
  assert.equal(R.emptyWhy(1, 2), 'blank');                              // one offer left, rows 2-3 are just empty spots
  assert.equal(R.emptyWhy(3, 0), 'blank');                              // a signed row never claims "no new slips"
  assert.equal(R.emptyWhy(4, 3), 'blank');
});

for (const lang of ['en', 'tr']) {
  test(`slip text fits the paper (${lang})`, () => {
    I.setLang(lang);
    const key = (k, v) => I.upper(I.t(`m.bounty_board.${k}`, v));
    const width = (s) => F.px5Width(s, R.SLIP_SCALE);
    for (const d of R.BOUNTY_CATALOGUE) {
      const rows = PL.wrapPx5(S[lang][`c.${d.id}.t`], R.SLIP_TEXT_W, R.SLIP_SCALE);
      assert.ok(rows.length <= 2, `${d.id}: title needs ${rows.length} lines: ${rows.join(' | ')}`);
    }
    const lines = [
      ...[2, 3, 4].map((n) => key('tickets', { n })), ...[5, 10].map((n) => key('quota', { n })),
      key('r_charm'), key('r_unlock'), key('r_buff'), key('h_cash'),
      I.upper(ITEMS.TOTEM_DATA.find((x) => x.id === 'profit_bell').strings[lang].name),
      '25 / 25',
    ];
    for (const s of lines) assert.ok(width(s) <= R.SLIP_TEXT_W, `"${s}" is ${width(s)} texels, the slip has ${R.SLIP_TEXT_W}`);
  });
}

test('plurals: one signed slip left reads singular in English, the count otherwise', () => {
  I.setLang('en');
  assert.equal(I.t('m.bounty_board.note_signed', { n: 1 }), 'No new slips tonight. Finish the one you signed.');
  assert.equal(I.t('m.bounty_board.note_signed', { n: 3 }), 'No new slips tonight. Finish the 3 you signed.');
  assert.equal(I.t('m.bounty_board.tickets', { n: 1 }), '1 TICKET');
  assert.equal(I.t('m.bounty_board.tickets', { n: 3 }), '3 TICKETS');
  I.setLang('tr');
  assert.equal(I.t('m.bounty_board.note_signed', { n: 3 }), 'Bu gece yeni pusula yok. İmzaladığın 3 pusulayı bitir.');
});

test('the board only offers contracts a player can finish on the current floor', async () => {
  const prog = await load('src/game/progression.ts');
  const core = prog.CORE_MACHINES;
  const ready = [...LAY.FLOOR_READY].sort();
  assert.deepEqual([...core].sort(), ready, 'progression and FLOOR_READY agree');
  assert.equal(R.bountyDef('b_derby6').minShift, prog.PINNED_NIGHT.derby);
  for (const id of core) assert.ok(R.playable({ goal: { on: 'machine:result', where: { machineId: id }, count: 1 } }), `${id} is on the floor`);
  assert.ok(!R.playable({ goal: { on: 'machine:result', where: { machineId: 'craps' }, count: 1 } }));
  const ok = R.BOUNTY_CATALOGUE.filter(R.playable).map((d) => d.id).sort();
  assert.deepEqual(ok, ['b_bell_night', 'b_bigwin', 'b_bj_streak', 'b_cross', 'b_derby6', 'b_ride5']);
  for (const id of ['b_elevator5', 'b_point', 'b_claw', 'b_natural', 'b_holdem_2p']) assert.ok(!ok.includes(id), `${id} needs a cut machine`);
  for (const d of R.BOUNTY_CATALOGUE.filter(R.playable)) assert.ok(!d.goal.where?.machineId || core.includes(d.goal.where.machineId), d.id);
  assert.ok(ok.length >= R.BOARD_SLOTS, 'enough left to fill the board');
  assert.equal(R.bountyDef('b_derby6').minShift, 3, 'the derby opens on Night 3');
  // ensureCatalogue registers only those
  const reg = [];
  R.ensureCatalogue({ contracts: { defs: () => [], register: (d) => { reg.push(d.id); return () => {}; } } });
  assert.deepEqual(reg.sort(), ok);
});
