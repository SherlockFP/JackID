/**
 * The 100 charms of GDD §4.2 as pure data (no functions: code behaviours live in `charms/behaviours.ts`).
 * Declarative effects use core ModHooks where one exists (payout.mult, luck, loss.refund, dread.add …) and
 * `x.<name>` hooks otherwise; an `x.` hook with no consumer is inert until its machine owner reads it via `run.mod`.
 * Price = base × SI (rounded by `economy.charmPrice`). Negative base = cursed (the House pays you).
 * Scopes use the GDD family tags in lower case (`reels`, `cards`, `dice`, `wheels`, `drops`, `curios`, `ledger`, `tycoon`).
 */
import type { CharmDef, CharmRarity, ModEffect, ModHook, ModOp, ModScope } from '@/game/types';
import { ENGINE_CHARM_IDS } from './charmsEngines';

const fx = (hook: ModHook, op: ModOp, value: number, scope?: ModScope): ModEffect => ({ hook, op, value, scope });
const tag = (t: string): ModScope => ({ tags: [t] });
const machines = (...ids: string[]): ModScope => ({ machines: ids });

/**
 * Suit-tag charms (the six common charms with a REELS / CARDS / DICE / WHEELS / DROPS / CURIOS family) scale with the
 * number of charms of their suit held: effect value = `SUIT_SCALE_STEP × held` (held includes the charm itself).
 * The engine (`charms/engine.ts`) applies the count; the data keeps the per-charm step here.
 */
export const SUIT_SCALE_STEP = 0.10;
export const SUIT_SCALED_CHARMS: ReadonlySet<string> = new Set<string>([
  'brass_thimble', 'billiard_chalk', 'loaded_pip', 'greased_axle', 'lead_shot', 'glass_eye',
]);

/**
 * Luck points a machine can take from charms before its headless RTP passes 98.5 % (balance pass, 5e5–1e6 rounds per
 * point; the margin covers sim noise). Machines not listed, or at 0, get no charm luck. Luck charms stack on one machine,
 * so each of the two luck charms (Metronome, Glass Heart) gets half of the machine's budget (`charmLuckFor`).
 */
export const CHARM_LUCK_CAP: Readonly<Record<string, number>> = {
  baccarat: 0, bandit: 4, bigone: 0, bigsix: 4, blackjack: 4, bingo: 8, bounty_board: 0, cardwar: 4, cashier: 0,
  charm_vendor: 0, claw: 6, coinflip: 0, craps: 0, cyclone: 20, debt_terminal: 0, derby: 8, devilstable: 0,
  dicetower: 8, elevator: 8, fortuneteller: 8, hilo: 2, hotline: 0, jukebox: 0, keno: 2, lottoblower: 0, mines: 2,
  pachinko: 4, pachislot: 2, pisti: 0, plinko: 4, roulette: 0, scratch: 8, shellgame: 8, shrine: 0, sicbo: 2,
  sonkart: 0, stacker: 4, tavla: 0, tonic_vendor: 0, videopoker: 2,
};
const LUCK_CHARMS_PER_MACHINE = 2;
/** Luck one luck charm may add to `machineId` when it asks for `points`. */
export const charmLuckFor = (machineId: string, points: number): number =>
  Math.max(0, Math.min(points, Math.floor((CHARM_LUCK_CAP[machineId] ?? 0) / LUCK_CHARMS_PER_MACHINE)));
/** One clamped luck effect per machine; machines without budget get none. */
const luckFx = (points: number, ids: readonly string[]): ModEffect[] =>
  ids.flatMap((id) => {
    const v = charmLuckFor(id, points);
    return v > 0 ? [fx('luck', 'add', v, machines(id))] : [];
  });

function charm(
  id: string, rarity: CharmRarity, price: number, family: string | null, unlock: string,
  en: [string, string], tr: [string, string], effects: ModEffect[] = [],
): CharmDef {
  return {
    id, rarity, price, icon: 'charm', tag: family ?? undefined, unlock, effects,
    strings: { en: { name: en[0], desc: en[1] }, tr: { name: tr[0], desc: tr[1] } },
  };
}

// ── Common (22) ────────────────────────────────────────────────────────────────────────────────
const COMMON: CharmDef[] = [
  charm('brass_thimble', 'common', 8, 'REELS', '', ['Brass Thimble', '+10% payouts on REELS machines per REELS charm held'], ['Pirinç Yüzük', 'MAKARA makinelerinde kazançlar, tutulan her MAKARA tılsımı için +%10'], [fx('payout.mult', 'inc', SUIT_SCALE_STEP, tag('reels'))]),
  charm('billiard_chalk', 'common', 8, 'CARDS', '', ['Billiard Chalk', '+10% payouts on CARDS machines per CARDS charm held'], ['Bilardo Tebeşiri', 'KART makinelerinde kazançlar, tutulan her KART tılsımı için +%10'], [fx('payout.mult', 'inc', SUIT_SCALE_STEP, tag('cards'))]),
  charm('loaded_pip', 'common', 8, 'DICE', '', ['Loaded Pip', '+10% payouts on DICE machines per DICE charm held'], ['Yüklü Pul', 'ZAR makinelerinde kazançlar, tutulan her ZAR tılsımı için +%10'], [fx('payout.mult', 'inc', SUIT_SCALE_STEP, tag('dice'))]),
  charm('greased_axle', 'common', 8, 'WHEELS', '', ['Greased Axle', '+10% payouts on WHEELS machines per WHEELS charm held'], ['Yağlı Aks', 'ÇARK makinelerinde kazançlar, tutulan her ÇARK tılsımı için +%10'], [fx('payout.mult', 'inc', SUIT_SCALE_STEP, tag('wheels'))]),
  charm('lead_shot', 'common', 8, 'DROPS', '', ['Lead Shot', '+10% payouts on DROPS machines per DROPS charm held'], ['Kurşun Mermi', 'BİLYE makinelerinde kazançlar, tutulan her BİLYE tılsımı için +%10'], [fx('payout.mult', 'inc', SUIT_SCALE_STEP, tag('drops'))]),
  charm('glass_eye', 'common', 8, 'CURIOS', '', ['Glass Eye', '+10% payouts on CURIOS machines per CURIOS charm held'], ['Cam Göz', 'MERAK makinelerinde kazançlar, tutulan her MERAK tılsımı için +%10'], [fx('payout.mult', 'inc', SUIT_SCALE_STEP, tag('curios'))]),
  charm('piggy_tooth', 'common', 10, 'LEDGER', '', ['Piggy Tooth', '+1% interest every Watch'], ['Kumbara Dişi', 'Her Vardiya faizi +%1'], [fx('x.econ.interestAdd', 'add', 0.01)]),
  charm('wax_seal', 'common', 6, 'LEDGER', '', ['Wax Seal', 'Every deposit gains a 3% bonus'], ['Mum Mühür', 'Her yatırıma %3 bonus'], [fx('deposit.bonus', 'add', 0.03)]),
  charm('spare_token', 'common', 12, null, '', ['Spare Token', '+1 pull every Watch'], ['Yedek Jeton', 'Her Vardiya +1 çekiş'], [fx('x.run.pullsAdd', 'add', 1)]),
  charm('cracked_watch', 'common', 8, null, '', ['Cracked Pocket Watch', '+20 s on every Watch clock'], ['Çatlak Cep Saati', 'Her Vardiya saatine +20 sn'], [fx('x.run.clockAdd', 'add', 20)]),
  charm('stub_spike', 'common', 8, null, 'N2', ['Stub Spike', '+1 Ticket per punched card cell'], ['Kör Çivi', 'Delinen her kart hücresinden +1 Bilet'], [fx('x.card.onPunch', 'add', 1)]),
  charm('worn_glove', 'common', 10, null, '', ['Worn Glove', 'Tilt starts 2 pulls later on every machine'], ['Eskimiş Eldiven', 'TİLT her makinede 2 çekiş geç başlar'], [fx('x.tilt.grace', 'add', 2)]),
  charm('polished_molar', 'common', 8, 'REELS', '', ['Polished Molar', 'The Big One TOOTH worth 2; Bandit SHOE +1 per credit'], ['Cilalı Azı Dişi', 'Büyük Vurgun DİŞ değeri 2; Tek Kollu Haydut AYAKKABI +1'], [fx('x.bigone.symbolValueAdd[TOOTH]', 'add', 1), fx('m.bandit.symbolPayAdd.SHOE', 'add', 1)]),
  charm('dealers_button', 'common', 10, 'CARDS', '', ['Dealer\'s Button', 'Blackjack naturals pay 2:1; Baccarat commission −5 pp'], ['Krupiye Düğmesi', 'Blackjack doğal eller 2:1; Bakara komisyonu −%5'], [fx('m.blackjack.bjPayAdd', 'add', 0.5), fx('x.table.rakeDelta', 'add', -0.05)]),
  charm('felt_square', 'common', 8, 'CARDS', '', ['Felt Square', 'Losing CARDS plays refund 10% of the stake'], ['Keçe Kare', 'Kaybeden KART oyunları bahsin %10\'unu iade eder'], [fx('loss.refund', 'add', 0.1, tag('cards'))]),
  charm('rusty_key', 'common', 10, null, '', ['Rusty Key', '1 free Pawn reroll per intermission'], ['Paslı Anahtar', 'Her ara evrede 1 bedava rehin yenileme'], [fx('x.shop.freeRerolls', 'add', 1)]),
  charm('chipped_die', 'common', 8, 'DICE', '', ['Chipped Die', 'Losing Coin-Flip and Dice Tower plays refund 15%'], ['Çatlak Zar', 'Kaybeden Yazı-Tura ve Zar Kulesi oyunları %15 iade'], [fx('loss.refund', 'add', 0.15, tag('dice'))]),
  charm('tin_whistle', 'common', 8, null, '', ['Tin Whistle', 'Phone rings 26 s instead of 20 s'], ['Teneke Düdük', 'Telefon 20 sn yerine 26 sn çalar'], [fx('x.phone.ringTime', 'add', 6)]),
  charm('consolation_ribbon', 'common', 8, null, '', ['Consolation Ribbon', 'Near-miss plays refund 50% of the stake'], ['Teselli Kurdelesi', 'Ucu kaçan oyunlar bahsin %50\'sini iade eder'], [fx('x.nearMissRefund', 'add', 0.5)]),
  charm('lucky_receipt', 'common', 8, 'LEDGER', '', ['Lucky Receipt', 'Wins of ×10 or more print +1 Ticket (max 3 per Watch)'], ['Şanslı Fiş', '×10 ve üstü kazanç +1 Bilet (Vardiya başına en fazla 3)'], [fx('x.onTag.bigwin', 'add', 1)]),
  charm('night_light', 'common', 6, null, '', ['Night-Light', 'Dread −10 while held'], ['Gece Lambası', 'Tutarken Korku −10'], [fx('dread.add', 'add', -10)]),
  charm('receipt_roll', 'common', 8, 'LEDGER', 'N2', ['Receipt Roll', 'Each deposit of 10%+ of quota prints a free scratch card (max 3 per Night)'], ['Fiş Rulosu', 'Kotanın %10\'undan fazla her yatırım bedava kazı kart basar (Gece başına en fazla 3)'], [fx('x.econ.onDeposit', 'add', 1)]),
];

// ── Uncommon (36) ──────────────────────────────────────────────────────────────────────────────
const UNCOMMON: CharmDef[] = [
  charm('moth_lantern', 'uncommon', 18, 'REELS', '', ['Moth Lantern', 'The Big One gains GHOST (wild) at weight 4'], ['Güve Feneri', 'Büyük Vurgun\'a HAYALET (joker) eklenir, ağırlık 4'], [fx('x.bigone.symbolWeight[GHOST]', 'add', 4)]),
  charm('hot_coal', 'uncommon', 16, null, 'N2', ['Hot Coal', 'Hot Lamp ×2.0 instead of ×1.5; +1 Hot Lamp per Watch'], ['Sıcak Kömür', 'Sıcak Lamba ×2.0 (×1.5 yerine); Vardiya başına +1 Sıcak Lamba'], [fx('x.lamp.hotMult', 'set', 2), fx('x.lamp.hotCount', 'add', 1)]),
  charm('snake_eye_ring', 'uncommon', 18, 'DICE', '', ['Snake-Eye Ring', 'Each die showing 1 adds +0.5 × stake, even on losses'], ['Yılan Göz Yüzüğü', 'ZAR sonucunda 1 gösteren her zar bahsin +0.5 katını ekler'], [fx('x.onOutcome.snakeEye', 'add', 0.5)]),
  charm('counting_bead', 'uncommon', 20, 'CARDS', '', ['Counting Bead', 'Card tables show the running count on a brass counter'], ['Sayma Boncuğu', 'Kart masaları sayım sayacını gösterir'], [fx('x.table.shoeInfo', 'add', 1)]),
  charm('chain_link', 'uncommon', 18, null, '', ['Chain Link', '+10% payouts per consecutive win, max +50%; a loss resets'], ['Zincir Halka', 'Üst üste her kazanç +%10 (en fazla +%50); kayıp sıfırlar'], []),
  charm('apology_card', 'uncommon', 16, null, '', ['Apology Card', 'After 3 losses in a row, the next win is ×2'], ['Özür Kartı', '3 üst üste kayıptan sonra ilk kazanç ×2'], [fx('x.onTag.loss', 'add', 3)]),
  charm('ledger_pen', 'uncommon', 20, 'LEDGER', 'N2', ['Ledger Pen', 'Each punch line gives +2% interest and +2 Tickets'], ['Defter Kalemi', 'Tamamlanan her çizgi +%2 faiz ve +2 Bilet'], [fx('x.card.lineBonus', 'add', 0.02)]),
  charm('circuit_breaker', 'uncommon', 18, null, '', ['Circuit Breaker', '+12% if this play\'s suit differs from the last play\'s'], ['Devre Kesici', 'Bu oyunun takımı önceki oyundan farklıysa +%12'], [fx('x.circuit.suitSwitch', 'inc', 0.12)]),
  charm('velvet_rope', 'uncommon', 20, 'CURIOS', '', ['Velvet Rope', 'Two-pull devices cost 1 pull instead'], ['Kadife İp', 'İki çekişlik cihazlar 1 çekiş tutar'], [fx('x.actionCostDelta', 'add', -1, machines('claw', 'stacker', 'devilstable', 'shellgame', 'bingopin'))]),
  charm('bent_nail', 'uncommon', 18, 'DROPS', '', ['Bent Nail', 'Luck +8 on DROPS machines'], ['Eğri Çivi', 'BİLYE makinelerinde şans +8'], [fx('luck', 'add', 8, tag('drops'))]),
  charm('tin_jockey', 'uncommon', 16, 'CURIOS', 'N3', ['Tin Jockey', 'Derby: every winning payout +15%'], ['Teneke Jokey', 'Derbi: her kazanç +%15'], [fx('m.derby.oddsBonus', 'add', 0.15)]),
  charm('sappers_badge', 'uncommon', 18, 'CURIOS', '', ['Sapper\'s Badge', 'Once per Watch, the first mine hit or fall below ×2 is refunded'], ['Lağımcı Rozeti', 'Vardiya başına bir kez ilk mayın veya ×2 altı düşüş tam iade'], [fx('m.mines.insurance', 'add', 100)]),
  charm('magnet_coin', 'uncommon', 20, 'DROPS', '', ['Magnet Coin', 'Claw magnet ×3; Coin Pusher gold chance +2%'], ['Mıknatıs Jeton', 'Pençe mıknatısı ×3; Jeton İtici altın şansı +%2'], [fx('m.claw.magnet', 'mult', 3), fx('m.coinpusher.goldCoin', 'add', 0.02)]),
  charm('night_owl', 'uncommon', 16, null, '', ['Night Owl', 'During Last Call, payouts +40%'], ['Gece Baykuşu', 'Son Çağrı sırasında kazançlar +%40'], []),
  charm('spare_number', 'uncommon', 20, 'DROPS', 'N2', ['Spare Number', 'Extra private number or ball on lottery devices'], ['Yedek Numara', 'Piyango cihazlarında +1 özel numara veya top'], [fx('m.keno.extraNumber', 'add', 1), fx('x.lottoblower.extraBall', 'add', 1)]),
  charm('long_thumbnail', 'uncommon', 16, 'REELS', 'N2', ['Long Thumbnail', 'Scratch cards cost −20%'], ['Uzun Başparmak', 'Kazı kartlar %20 ucuz'], [fx('m.scratch.discount', 'add', 20)]),
  charm('metronome', 'uncommon', 18, 'WHEELS', 'N3', ['Metronome', 'Luck +10 on timing devices'], ['Metronom', 'Zamanlama cihazlarında şans +10'], luckFx(10, ['cyclone', 'pachislot', 'stacker'])),
  charm('red_thread', 'uncommon', 16, null, '', ['Red Thread', 'First instance you play each Watch: Tilt grace +3 and +10%'], ['Kırmızı İplik', 'Vardiya\'da oynadığın ilk makine: TİLT +3 ve +%10'], [fx('x.tilt.grace', 'add', 3), fx('x.red.firstPlay', 'inc', 0.1)]),
  charm('cold_hands', 'uncommon', 16, null, 'N3', ['Cold Hands', 'Cold Lamp ×1.00 instead of ×0.75'], ['Soğuk Eller', 'Soğuk Lamba ×1.00 (×0.75 yerine)'], [fx('x.lamp.coldMult', 'set', 1)]),
  charm('croupiers_rake', 'uncommon', 18, 'WHEELS', '', ['Croupier\'s Rake', 'Roulette outside bets +20%'], ['Krupiyenin Tırmığı', 'Rulet dış bahisleri +%20'], [fx('payout.mult', 'inc', 0.2, machines('roulette'))]),
  charm('weighted_cup', 'uncommon', 18, 'DICE', 'N3', ['Weighted Cup', 'Sic Bo triple +2; Craps hardways +2'], ['Ağırlıklı Kap', 'Zar Kafesi üçlü +2; Craps hardway +2'], [fx('m.sicbo.singleTripleAdd', 'add', 2), fx('x.craps.hardwayPayAdd', 'add', 2)]),
  charm('brass_washer', 'uncommon', 20, null, '', ['Brass Washer', '15% chance a play costs 0 pulls'], ['Pirinç Pul', 'Her oyunda %15 ihtimalle 0 çekiş'], [fx('x.freePlayChance', 'add', 0.15)]),
  charm('muzzle', 'uncommon', 18, 'REELS', 'N2', ['Muzzle', 'The Big One curse chance ×0.5; EATEN spins refund 50%'], ['Ağızlık', 'Büyük Vurgun lanet şansı ×0.5; YENMİŞ dönüşler %50 iade'], [fx('x.bigone.curseChanceMult', 'mult', 0.5)]),
  charm('brass_alarm', 'uncommon', 18, null, '', ['Brass Alarm Bell', 'Each Bell: +1 Ticket and +4 × SI coins'], ['Pirinç Alarm Zili', 'Her zilde +1 Bilet ve +4 × SI jeton'], []),
  charm('porcelain_pig', 'uncommon', 18, 'LEDGER', 'N2', ['Porcelain Pig', 'Each Bell: +4% of pocket (cap 40 × SI)'], ['Porselen Domuz', 'Her zilde cebin %4\'ü (en fazla 40 × SI)'], []),
  charm('bargain_coupon', 'uncommon', 14, null, '', ['Bargain Coupon', 'The first charm you buy each intermission costs −30%'], ['Pazarlık Kuponu', 'Her ara evredeki ilk tılsım %30 indirimli'], [fx('x.shop.discountFirst', 'add', 0.3)]),
  charm('dowsing_rod', 'uncommon', 18, 'CURIOS', 'N3', ['Dowsing Rod', 'Mines marks one safe tile; Shell palm glints earlier'], ['Su Bulma Çubuğu', 'Mayında bir güvenli kare işaretlenir'], [fx('m.mines.scanner', 'add', 1)]),
  charm('pawn_ticket', 'uncommon', 12, null, '', ['Pawn Ticket', 'Charms sell for 70% of the price paid'], ['Rehin Bileti', 'Tılsımlar ödenen fiyatın %70\'ine satılır'], [fx('x.shop.sellMult', 'set', 0.7)]),
  charm('holy_water', 'uncommon', 20, null, 'F3', ['Holy Water Flask', 'Consumable: removes one cursed charm, then breaks'], ['Kutsal Su Şişesi', 'Tek kullanımlık: bir lanetli tılsımı kaldırır'], []),
  charm('foremans_whistle', 'uncommon', 20, 'TYCOON', 'N2', ['Foreman\'s Whistle', 'Attendant income +25%'], ['Ustabaşı Düdüğü', 'Görevli geliri +%25'], [fx('x.tycoon.staffMult', 'mult', 1.25)]),
  charm('ledger_of_leases', 'uncommon', 18, 'TYCOON', '', ['Ledger of Leases', 'Upgrade costs −10%'], ['Kira Defteri', 'Yükseltme maliyetleri %10 düşük'], [fx('upgrade.costMult', 'mult', 0.9)]),
  charm('grand_opening', 'uncommon', 16, 'TYCOON', 'N4', ['Grand Opening Ribbon', 'Upgrades cost −25%; new machines are Hot for one Watch'], ['Açılış Kurdelesi', 'Yükseltme maliyetleri %25 düşük; yeni makine bir Vardiya Sıcak'], [fx('upgrade.costMult', 'mult', 0.75), fx('x.lamp.hot', 'add', 1)]),
  charm('heat_lamp', 'uncommon', 16, null, 'N2', ['Heat Lamp', 'Base heat per win ×1.5; Overheat effects ×2'], ['Isı Lambası', 'Kazanç başına temel ısı ×1.5; Aşırı ısınma etkisi ×2'], [fx('heat.gain', 'mult', 1.5), fx('x.overheat.mult', 'mult', 2)]),
  charm('tonic_belt', 'uncommon', 14, null, 'N3', ['Tonic Belt', '+1 tonic per Watch; tonic durations ×1.5'], ['Tonik Kemeri', 'Vardiya başına +1 tonik; tonik süreleri ×1.5'], [fx('x.buff.tonicMax', 'add', 1), fx('x.buff.durationMult', 'mult', 1.5)]),
  charm('mirror_shard', 'uncommon', 18, null, 'N4', ['Mirror Shard', 'Each horror event pays 5 × SI'], ['Gölge Parçası', 'Her korku olayı 5 × SI öder'], [fx('x.onDreadEvent', 'add', 5)]),
];

// ── Rare (22) ──────────────────────────────────────────────────────────────────────────────────
const RARE: CharmDef[] = [
  charm('seven_floor_key', 'rare', 45, 'LEDGER', 'N3', ['Seven-Floor Key', 'In the last Watch of each Night, interest is applied twice'], ['Yedinci Kat Anahtarı', 'Her gecenin son Vardiya\'nında faiz iki kez uygulanır'], []),
  charm('sun_dial', 'rare', 50, 'REELS', '', ['Sun Dial', 'Big One SUN +4 weight; jackpot chance ×2 on REELS'], ['Güneş Saati', 'Büyük Vurgun GÜNEŞ ağırlığı +4; MAKARA\'da jackpot şansı ×2'], [fx('x.bigone.symbolWeight[SUN]', 'add', 4), fx('jackpot.mult', 'mult', 2, tag('reels')), fx('x.bigone.jackpotFeed', 'set', 0.02)]),
  charm('mirror_shoe', 'rare', 45, 'CARDS', 'N4', ['Mirror Shoe', '+1 peek charge on every CARDS table'], ['Ayna Ayakkabı', 'Her KART masasında +1 gözetleme hakkı'], [fx('x.table.peekCharges', 'add', 1, tag('cards'))]),
  charm('hollow_dice', 'rare', 40, 'DICE', 'N3', ['Hollow Dice', 'Sic Bo +1 shake; Craps one seven-out shield; Coin-Flip re-flip'], ['Boş Zarlar', 'Zar Kafesi +1 sallama; Craps bir yedi-kayıp kalkanı; Yazı-Tura tekrar atış'], [fx('x.sicbo.cageShake', 'add', 1), fx('x.craps.sevenOutShield', 'add', 1)]),
  charm('golden_ratchet', 'rare', 45, 'WHEELS', 'N4', ['Golden Ratchet', 'Pay 25% of the stake to nudge the wheel one step'], ['Altın Cırcır', 'Bahsin %25\'i karşılığında çarkı bir adım döndür'], [fx('x.wheel.nudge', 'add', 1)]),
  charm('glass_funnel', 'rare', 40, 'DROPS', 'N4', ['Glass Funnel', 'Plinko +1 free puck; Pachinko wider sweet zone'], ['Cam Huni', 'Plinko +1 bedava top; Paçinko tatlı bölgesi geniş'], [fx('x.plinko.extraPuck', 'add', 1), fx('x.pachinko.sweetWiden', 'add', 0.1), fx('m.bingopin.freeSpace', 'add', 1)]),
  charm('ringmasters_whistle', 'rare', 45, null, '', ['Ringmaster\'s Whistle', 'Each distinct suit you win adds +15% for the Watch (max +90%)'], ['Halka Ustası Düdüğü', 'Kazandığın her farklı takım Vardiya boyunca +%15 (en fazla +%90)'], [fx('x.onTag.win', 'add', 0.15)]),
  charm('collectors_tag', 'rare', 40, 'LEDGER', 'N4', ['Collector\'s Tag', 'Each paid Night permanently adds +10% to all payouts'], ['Tahsildar Etiketi', 'Ödenen her gece kalıcı olarak kazançlara +%10'], []),
  charm('long_shot', 'rare', 45, null, '', ['Long Shot', 'Plays with base multiplier 20 or more pay ×2'], ['Uzun Atış', 'Çarpanı 20 ve üstü olan oyunlar ×2 öder'], []),
  charm('coiled_cord', 'rare', 35, null, 'N2', ['Coiled Phone Cord', 'Random-call chance 100% per Watch; phone deals −25%'], ['Kıvrık Telefon Kablosu', 'Vardiya başına rastgele arama %100; telefon anlaşmaları %25 ucuz'], [fx('x.phone.callChance', 'set', 1), fx('x.phone.dealCost', 'mult', 0.75)]),
  charm('house_keys', 'rare', 50, null, 'N5', ['House Keys', 'On purchase, open one closed wing (never Parlour or Counting Room)'], ['Ev Anahtarları', 'Satın alınca kapalı bir kanat açılır (Salon ve Sayım Odası hariç)'], [fx('x.world.openWing', 'add', 1)]),
  charm('tilt_switch', 'rare', 40, null, 'A:tilted', ['Tilt Switch', 'Your most-played instance ignores Tilt; others Tilt harder'], ['Eğim Anahtarı', 'En çok oynadığın makine TİLT\'ten etkilenmez; diğerleri daha sert'], [fx('x.tilt.ignoreMostPlayed', 'set', 1)]),
  charm('brass_knuckles', 'rare', 40, 'CURIOS', 'N3', ['Brass Knuckles', 'Stacker +1 block; Claw +4 s; Shell Automaton slower'], ['Pirinç Yumruk', 'İstif Kulesi +1 blok; Pençe +4 sn; Kabuk Otomatı yavaş'], [fx('x.stacker.extraBlock', 'add', 1), fx('m.claw.timer', 'add', 4)]),
  charm('high_rollers_cufflink', 'rare', 45, null, 'N4', ['High Roller\'s Cufflink', 'Every max bet is one ladder step higher'], ['Yüksek Bahisçi Kol Düğmesi', 'Her maksimum bahis bir basamak yukarı'], [fx('bet.maxMult', 'mult', 2.5)]),
  charm('photo_negative', 'rare', 45, null, 'W', ['Photo Negative', 'Losing plays have a 7% chance to invert and pay ×2'], ['Fotoğraf Negatifi', 'Kaybeden oyunların %7\'si tersine döner ve ×2 öder'], [fx('x.onTag.loss.invert', 'add', 0.07)]),
  charm('tote_ticket', 'rare', 35, 'WHEELS', '', ['Tote Ticket', 'Derby, Big Six and Roulette show history; ×10 bets pay +25%'], ['Bahis Fişi', 'Derbi, Büyük Altı ve Rulet geçmişi gösterir; ×10 bahisler +%25'], [fx('m.derby.longshotBonus', 'add', 0.25), fx('payout.mult', 'inc', 0.25, machines('derby', 'bigsix', 'roulette'))]),
  charm('cuckoo_feather', 'rare', 40, null, 'N3', ['Cuckoo Feather', 'After each Bell, your next win is ×2'], ['Guguk Tüyü', 'Her zilden sonra ilk kazancın ×2'], []),
  charm('blueprint', 'rare', 40, 'TYCOON', 'N3', ['Blueprint', 'Each wing opened: one instance starts at Payout L5 and Speed L5'], ['Plan', 'Açılan her kanatta bir makine Ödeme L5 ve Hız L5 ile başlar'], [fx('x.world.onWingOpen', 'add', 1)]),
  charm('brass_plaque', 'rare', 40, 'TYCOON', 'N5', ['Brass Plaque', 'Instances at Payout L25+ give you luck +2 there'], ['Pirinç Plaket', 'Ödeme L25+ makinelerde şans +2'], [fx('x.plaque.luckAtPayoutL25', 'add', 2)]),
  charm('shill_contract', 'rare', 35, 'TYCOON', 'N4', ['Shill Contract', 'Shill stake 1% → 2% of max bet; shill hires −50%'], ['Ortak Sözleşmesi', 'Ortak bahsi %1 → %2; ortak kiralama %50 ucuz'], [fx('x.tycoon.shillStake', 'set', 0.02), fx('x.tycoon.shillHireMult', 'mult', 0.5)]),
  charm('altimeter', 'rare', 40, null, 'N3', ['Altimeter', '+2% on all payouts per floor climbed'], ['Altimetre', 'Çıkılan kat başına tüm kazançlarda +%2'], []),
  charm('elevator_token', 'rare', 35, 'LEDGER', 'N2', ['Elevator Token', 'At every Ascent, gain 5% of pocket (max 300 × SI)'], ['Asansör Jetonu', 'Her yükselişte cebin %5\'i (en fazla 300 × SI)'], [fx('x.econ.onAscend', 'add', 0.05)]),
];

// ── Legendary (7) ──────────────────────────────────────────────────────────────────────────────
const LEGENDARY: CharmDef[] = [
  charm('crown_of_coins', 'legendary', 100, null, 'N5', ['Crown of Coins', 'All payouts ×1.5'], ['Madeni Para Tacı', 'Tüm kazançlar ×1.5'], [fx('payout.mult', 'mult', 1.5)]),
  charm('perpetual_ledger', 'legendary', 90, 'LEDGER', 'W', ['Perpetual Ledger', 'Pocket coins also earn half-rate interest'], ['Sürekli Defter', 'Cepteki jetonlar da yarım oranda faiz kazanır'], [fx('x.econ.pocketInterest', 'add', 0.5)]),
  charm('engravers_plate', 'legendary', 100, 'REELS', 'N6', ['Engraver\'s Plate', 'The Big One unlocks TWIN RAILS and CORNERSTONE; patterns +1'], ['Mühendis Plakası', 'Büyük Vurgun İKİZ RAYLAR ve KÖŞE TAŞI açar; her desen +1'], [fx('x.bigone.extraPattern', 'add', 1), fx('x.bigone.patternMult', 'add', 1)]),
  charm('operators_glove', 'legendary', 100, null, 'W', ['Lift Operator\'s Glove', '+2 pulls and +30 s every Watch; Settle Early rewards doubled'], ['Asansör Operatörünün Eldiveni', 'Her Vardiya +2 çekiş ve +30 sn; Erken Kapanış ödülleri iki katı'], [fx('x.run.pullsAdd', 'add', 2), fx('x.run.clockAdd', 'add', 30)]),
  charm('card_of_all_suits', 'legendary', 110, null, 'A:full_circuit', ['Card of All Suits', 'Every machine counts as every suit for punch cells'], ['Tüm Takımların Kartı', 'Her makine kart hücreleri için her takım sayılır'], [fx('x.card.suitWildcard', 'set', 1)]),
  charm('blackout_lamp', 'legendary', 90, null, 'A:blackout', ['Blackout Lamp', 'Each punch also punches one adjacent cell'], ['Karartma Lambası', 'Her delme bitişik bir hücreyi de deler'], [fx('x.card.punchExtra', 'add', 1)]),
  charm('property_deed', 'legendary', 95, 'TYCOON', 'D', ['Property Deed', 'Assessment 8% → 4%; Holdings depreciate faster'], ['Mülk Senedi', 'Değerleme %8 → %4; Varlıklar daha hızlı değer kaybeder'], [fx('x.tycoon.assessRate', 'set', 0.04)]),
];

// ── Cursed (10) ────────────────────────────────────────────────────────────────────────────────
const CURSED: CharmDef[] = [
  charm('wet_ledger', 'cursed', -25, null, 'F3', ['Wet Ledger', 'Interest −3% (floor 0%)'], ['Islak Defter', 'Faiz −%3 (en az %0)'], [fx('x.econ.interestAdd', 'add', -0.03)]),
  charm('sand_hourglass', 'cursed', -20, null, 'F3', ['Sand Hourglass', 'Watch clock −40 s; +2 pulls per Watch'], ['Kum Saati', 'Vardiya saati −40 sn; Vardiya başına +2 çekiş'], [fx('x.run.clockAdd', 'add', -40), fx('x.run.pullsAdd', 'add', 2)]),
  charm('gluttons_bib', 'cursed', -30, null, 'F3', ['Glutton\'s Bib', 'All payouts ×1.25; each Bell one machine you have played turns Hungry: its next play pays no winnings'], ['Obur\'un Önlüğü', 'Tüm kazançlar ×1.25; her zilde oynadığın bir makine Aç olur: sıradaki oyunu kazanç ödemez'], [fx('payout.mult', 'mult', 1.25), fx('x.buff.hungry', 'add', 1)]),
  charm('unblinking_eye', 'cursed', 0, null, 'F3', ['The Unblinking Eye', 'Quota +4% at the end of every Watch'], ['Gözsüz Göz', 'Her Vardiya sonunda kota +%4'], [fx('x.econ.quotaEndWatch', 'mult', 1.04)]),
  charm('moth_swarm', 'cursed', -15, null, 'F3', ['Moth Swarm', 'Dread +6 while held; The Big One MOTH weight +10'], ['Güve Sürüsü', 'Tutarken Korku +6; Büyük Vurgun GÜVE ağırlığı +10'], [fx('dread.add', 'add', 6), fx('x.bigone.symbolWeight[MOTH]', 'add', 10)]),
  charm('gold_tooth', 'cursed', -40, null, 'F3', ['Gold Tooth', '+20% payouts; plays with mult ≥10 cost 1 extra pull'], ['Altın Diş', 'Kazançlar +%20; çarpanı 10+ olan oyunlar 1 ekstra çekiş'], [fx('payout.mult', 'inc', 0.2), fx('x.run.pullsAdd', 'add', -1)]),
  charm('bent_lift_key', 'cursed', 0, null, 'W', ['Bent Lift Key', 'Night 8 quota −25%; all other future quotas +10%'], ['Eğri Asansör Anahtarı', '8. gece kotası %25 düşük; diğer tüm kotalar %10 yüksek'], [fx('quota.mult', 'mult', 1.1), fx('x.quota.night8', 'mult', 0.75 / 1.1)]),
  // Night 8 also receives quota.mult (×1.1), so its own factor is divided by 1.1 to land on the GDD's net ×0.75.
  charm('pawn_ticket_13', 'cursed', -50, null, 'F3', ['Pawn Ticket No. 13', 'Occupies a peg; the Pawn Window offers one item at −50%'], ['Rehin Bileti No. 13', 'Bir çivi işgal eder; Rehin Penceresi bir ürünü %50 indirimle sunar'], [fx('x.shop.discountSlot', 'set', 0.5)]),
  charm('cracked_mirror', 'cursed', -30, null, 'F3', ['Cracked Mirror', 'All wins ×1.4; one instance per zone is out of order each Bell'], ['Çatlak Ayna', 'Tüm kazançlar ×1.4; her zilde her bölgede bir makine arızalı'], [fx('payout.mult', 'mult', 1.4), fx('x.buff.out_of_order', 'add', 1)]),
  charm('glass_heart', 'cursed', -20, null, 'F3', ['Glass Heart', 'Luck +8; after 6 losses in a row it shatters (−25% pocket)'], ['Cam Kalp', 'Şans +8; üst üste 6 kayıptan sonra kırılır (cebin %25\'i gider)'], luckFx(8, Object.keys(CHARM_LUCK_CAP))),
];

/** All 96 charms in GDD table order (false_bottom, rope_ladder and blank_jackid became boons, docs/BLESSINGS.md §1; votive_candle became shrine Favour). Behaviours (code) are merged in by `charms/behaviours.ts`. */
export const CHARM_DATA: readonly CharmDef[] = [...COMMON, ...UNCOMMON, ...RARE, ...LEGENDARY, ...CURSED];

/**
 * Launch cut (GDD §4.2): #1–60, #82–86 and #90–95 ship in v1.0. Listed by id so that reordering or inserting charms
 * never silently changes the cut. Everything else arrives in v1.1 without system changes. Keep this list in sync with CHARM_DATA.
 */
export const LAUNCH_CHARM_IDS: ReadonlySet<string> = new Set<string>([
  // Wave 7: cut as inert (no reader in src after the hook renames; keep the data): stub_spike, rusty_key, tin_whistle, receipt_roll, snake_eye_ring, apology_card, ledger_pen, consolation_ribbon, brass_washer, bargain_coupon, pawn_ticket, holy_water, tonic_belt, mirror_shard, seven_floor_key, perpetual_ledger, card_of_all_suits, unblinking_eye.
  // #1–60
  'brass_thimble', 'billiard_chalk', 'loaded_pip', 'greased_axle', 'lead_shot', 'glass_eye', 'piggy_tooth',
  'wax_seal', 'spare_token', 'cracked_watch', 'worn_glove', 'polished_molar', 'dealers_button', 'felt_square',
  'chipped_die', 'lucky_receipt', 'night_light', 'moth_lantern', 'hot_coal', 'counting_bead', 'chain_link',
  'circuit_breaker', 'velvet_rope', 'bent_nail', 'tin_jockey', 'sappers_badge', 'magnet_coin', 'night_owl',
  'spare_number', 'long_thumbnail', 'metronome', 'red_thread', 'cold_hands', 'croupiers_rake', 'weighted_cup',
  'muzzle', 'brass_alarm', 'porcelain_pig', 'dowsing_rod', 'foremans_whistle', 'ledger_of_leases', 'grand_opening',
  'heat_lamp',
  // #82–86
  'crown_of_coins', 'engravers_plate', 'operators_glove',
  // #90–95
  'wet_ledger', 'sand_hourglass', 'gluttons_bib', 'moth_swarm', 'gold_tooth',
  // Wave 8: ten engine charms (data/charmsEngines.ts)
  ...ENGINE_CHARM_IDS,
  // Wave 9 (charms-balance): 12 Rares with live readers, so the shop under-the-counter slot and the overpay/boss
  // "choose 1 of 3 Rare" always have choices. Unlocked Rares per tier: N1 3 (sun_dial, tote_ticket, long_shot),
  // N2 4 (+ coiled_cord), N3 9 (+ brass_knuckles, cuckoo_feather, altimeter, suit_ladder, last_gasp), N4+ all 15.
  'sun_dial', 'tote_ticket', 'long_shot', 'coiled_cord', 'brass_knuckles', 'cuckoo_feather', 'altimeter',
  'mirror_shoe', 'golden_ratchet', 'glass_funnel', 'high_rollers_cufflink', 'collectors_tag',
]);
