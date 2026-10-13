/**
 * Fan-Tan — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; the keys are
 * registered under `m.fantan.` (MachineBase.t adds the prefix). `{n}` / `{s}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Fan-Tan (Button Count)',
  desc: 'Old Lacquer scoops a heap of brass buttons under the bowl, then counts them out in fours. Back the side that is left over.',
  ready: 'Ready', spin: 'Ready', clear: 'Clear', rebet: 'Repeat', scoop: 'Scoop',
  side: 'Side {n}', kwok: 'Pair {s}', odd: 'ODD', even: 'EVEN', ssh: 'ALL BUT {n}', nim: 'NIM {s}',
  sOpen: 'Back a side', sOpenShared: 'Bets close in {n}s', sLock: 'No more bets', sScoop: 'Old Lacquer scoops the heap',
  sLift: 'The bowl lifts', sCount: 'Counting in fours', sReveal: 'The remainder is {n}', sPay: 'Paying out', sSweep: 'Sweeping the table',
  sWait: 'Waiting for players', dealer: 'Old Lacquer',
  win: 'WIN {n}', lose: 'Lost {n}', push: 'PUSH {n}', left: 'LEFT {n}', gold: 'GOLDEN BUTTON: DOUBLE',
  stopped: 'Left over: {n}', pot: 'TABLE {n}', potLabel: 'Table', last: 'LAST 12', commission: 'Commission {n} %',
  noChips: 'Back a spot first', badSpot: 'That spot is not on the cloth', busy: 'The count is under way',
  limit: 'Limit {n}', noFunds: 'Not enough coins for this bet',
  peekEven: 'The heap is an even number', peekOdd: 'The heap is an odd number',
  nimHint: 'Drag from the winning side to the push side',
  hintQuick: 'Quick bet', fair: 'FAIR', bell: 'NO MORE BETS', gong: 'GONG',
  milestone: 'Milestone: {n}',
};

const tr: Record<string, string> = {
  name: 'Fan-Tan (Düğme Sayma)',
  desc: 'Eski Vernik bir avuç pirinç düğmeyi kasenin altından alır, sonra dörder dörder sayar. Geriye kalan tarafa bahis koy.',
  ready: 'Hazır', spin: 'Hazır', clear: 'Temizle', rebet: 'Tekrarla', scoop: 'Topla',
  side: '{n}. yüz', kwok: 'Çift {s}', odd: 'TEK', even: 'ÇİFT', ssh: '{n} HARİÇ', nim: 'NİM {s}',
  sOpen: 'Bir yüze bahis koy', sOpenShared: 'Bahisler {n} sn sonra kapanır', sLock: 'Artık bahis yok', sScoop: 'Eski Vernik yığını topluyor',
  sLift: 'Kase kalkıyor', sCount: 'Dörderli sayılıyor', sReveal: 'Kalan {n}', sPay: 'Ödeme yapılıyor', sSweep: 'Masa temizleniyor',
  sWait: 'Oyuncular bekleniyor', dealer: 'Eski Vernik',
  win: 'KAZANÇ {n}', lose: 'Kayıp {n}', push: 'İADE {n}', left: 'KALAN {n}', gold: 'ALTIN DÜĞME: ÇİFT ÖDEME',
  stopped: 'Kalan: {n}', pot: 'MASA {n}', potLabel: 'Masa', last: 'SON 12', commission: 'Komisyon %{n}',
  noChips: 'Önce bir yere bahis koy', badSpot: 'Bu alan masada yok', busy: 'Sayım sürüyor',
  limit: 'Limit {n}', noFunds: 'Bu bahis için yeterli jeton yok',
  peekEven: 'Yığın çift sayıda', peekOdd: 'Yığın tek sayıda',
  nimHint: 'Kazanan yüzden iade yüzüne sürükle',
  hintQuick: 'Hızlı bahis', fair: 'ADİL', bell: 'ARTIK BAHİS YOK', gong: 'GONG',
  milestone: 'Kilometre taşı: {n}',
};

export default { prefix: 'm.fantan.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
