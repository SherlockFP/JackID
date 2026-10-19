// Sound coverage (wave 88): every player interaction answers with a sound. Two checks: the table below (interaction -> sfx
// names, written from the audit) must name only recipes that exist, and every literal sound name the source plays must exist
// too, so a typo is a failed test and not a silent control. Plus the wall bump / jump events of the controller.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load, closeVite, ROOT } from './_vite.mjs';

after(closeVite);

/** interaction id -> the sound names it plays (src site in the comment). */
const TABLE = {
  'ui.hover': ['hover'], 'ui.click': ['click'], 'ui.primary': ['confirm'], 'ui.back': ['back'], 'ui.error': ['error'],
  'ui.toggle': ['click', 'hover'], 'ui.sliderTick': ['hover'], 'ui.tab': ['click'], 'ui.open': ['popUp'], 'ui.close': ['back'],
  'toast.info': ['msgBlip'], 'toast.good': ['countDing'], 'toast.bad': ['error'], 'toast.warn': ['error'], 'toast.sys': ['popUp'],
  'toast.money': ['coinClink'], 'toast.curse': ['whisper'],
  'pause.open': ['popUp'], 'pause.close': ['back'], 'journal.page': ['cardFlip'], 'ledger.open': ['popUp'], 'ledger.close': ['back'],
  'phone.open': ['phoneOpen'], 'phone.close': ['phoneClose'], 'phone.in': ['phoneBuzz'], 'phone.send': ['msgBlip'],
  'home.fridge': ['cabinet', 'foodBite', 'foodSip'], 'home.computer': ['click'], 'home.bed': ['bedCreak'], 'home.window': ['windGust'],
  'home.door': ['lockTurn', 'doorOpen', 'doorClose', 'doorCreakOpen', 'doorCreakClose'], 'home.peephole': ['drawer'],
  'home.switch': ['lightSwitch'], 'home.chain': ['chainRattle'], 'home.lift': ['liftDing'],
  'lift.doors': ['liftDoor'], 'lift.buttons': ['click'], 'bell.ring': ['bell'], 'bell.refuse': ['buzzer'],
  'terminal.keys': ['click', 'button'], 'terminal.deposit': ['coinShower', 'coinsHandle', 'cashHandle', 'stamp'],
  'shrine.candle': ['click', 'button'], 'shrine.statue': ['hover', 'boonPick'], 'bounty.sign': ['stamp'],
  'cashier.cashIn': ['cashRegister'], 'pawn.sell': ['sellItem', 'cashHandle'], 'bar.page': ['hover'], 'bar.tip': ['coinDrop'], 'bar.repay': ['cashRegister'],
  'vitrine.glass': ['powerUp', 'liftDoor', 'unlock'], 'seat.sit': ['seat'], 'seat.stand': ['seat'],
  'pickup.scrounge': ['ratSqueak'], 'pickup.totem': ['totemPlace'], 'drink.tonic': ['foodSip'], 'rooms.locker': ['doorOpenMetal'],
  'rooms.vent': ['lever', 'windGust'], 'rooms.ledger': ['cardFlip'], 'rooms.key': ['lockTurn'], 'rooms.buy': ['purchase'], 'rooms.collector': ['buzzer', 'cashHandle'],
  'coin.flick': ['coinTrickFlick'], 'coin.catch': ['coinTrickCatch'], 'coin.clink': ['coinTrickClink'],
  'boon.offer': ['boonOffer'], 'boon.hover': ['hover'], 'boon.pick': ['boonPick'], 'seal.crack': ['porcelainCrack'],
  'loki.line': ['cardFlip'], 'loki.ask': ['coinDrop'], 'loki.callRight': ['win1'], 'loki.callWrong': ['buzzer'],
  'loki.dareAccept': ['sparkle'], 'loki.dareRefuse': ['back'], 'loki.liked': ['sparkle'], 'loki.remember': ['whisper'],
  'coach.step': ['quotaTick'], 'quota.met': ['stamp'], 'lastCall': ['clockAlarm'], 'night.tick10': ['clockTick'],
  'player.step': ['footstep', 'footstepWet'], 'player.land': ['thud'], 'player.bump': ['thud'],
};

let S;
before(async () => { S = await load('src/core/audio/sfx.ts'); });

test('every interaction in the table maps to an existing sound', () => {
  for (const [id, names] of Object.entries(TABLE)) {
    assert.ok(names.length > 0, id);
    for (const n of names) assert.ok(S.SFX_DEFS.has(n), `${id}: no sfx recipe "${n}"`);
  }
});

const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
};

test('every sound name the source plays by literal exists', () => {
  const re = /\b(?:uiSfx|sfx|sfxAt|snd|audio\??\.play)\(\s*'([A-Za-z0-9]+)'/g;
  const bad = [];
  for (const f of walk(join(ROOT, 'src'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(re)) if (!S.SFX_DEFS.has(m[1])) bad.push(`${f.slice(ROOT.length)}: ${m[1]}`);
  }
  assert.deepEqual(bad, []);
});

test('controller: a fast wall hit bumps once per gap, a slow one does not, a jump announces itself', async () => {
  const C = await load('src/player/controller.ts');
  const ev = { bumps: [], jumps: 0 };
  const ctrl = new C.FpsController({ footstep() {}, land() {}, fallBegin() {}, fallOut() {}, jump() { ev.jumps++; }, bump(s) { ev.bumps.push(s); } });
  // a wall at x = 0: the body never moves, and every step reports an X hit
  const wall = { moveAndSlide() { return { hitX: true, hitZ: false, grounded: true }; }, floorAt: () => 0, raycast: () => null };
  const step = (o = {}) => ctrl.step(1 / 60, { moveX: 0, moveZ: 0, sprint: false, crouchToggle: false, jump: false, frozen: false, pitch: 0, ...o }, wall);
  ctrl.vel.x = 3; step();
  assert.equal(ev.bumps.length, 1);
  ctrl.vel.x = 3; step();                                   // inside the gap: silent
  assert.equal(ev.bumps.length, 1);
  for (let i = 0; i < 40; i++) { ctrl.vel.x = 0; step(); }  // the gap passes, a crawl against the wall stays silent
  ctrl.vel.x = 0.5; step();
  assert.equal(ev.bumps.length, 1);
  ctrl.vel.x = 3; step();
  assert.equal(ev.bumps.length, 2);
  step({ jump: true });
  assert.equal(ev.jumps, 1);
});
