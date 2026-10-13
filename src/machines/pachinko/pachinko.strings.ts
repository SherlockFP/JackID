/**
 * Pachinko "Deep Rain" — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are
 * registered under `m.pachinko.` (MachineBase.t adds the prefix). `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Pachinko "Deep Rain"',
  desc: 'Fire steel balls through the rain. Find the sweet spot on the handle. A jackpot opens the attacker.',
  fire: 'Fire', snap: 'Right-shot', power: 'POWER {n}%', ball: 'BALL {n}', ballValue: 'Ball value',
  zFoul: 'FOUL', zLow: 'LEFT-LOW', zSweet: 'SWEET', zHigh: 'LEFT-HIGH', zRight: 'RIGHT',
  mNormal: 'NORMAL', mKaku: 'KAKUHEN', mRight: 'RIGHT-SHOT', mAtt: 'ATTACKER {n}/10', mClose: 'CLOSE',
  hold: 'HOLD {n}', full: 'FULL', holdsLabel: 'Holds',
  reachN: 'REACH', reachS: 'SUPER REACH', reachP: 'THE DRAIN', jackpot: 'JACKPOT', kakuOn: 'KAKUHEN',
  blockWin: 'BLOCK +{n}', chainWin: 'CHAIN +{n}', tray: 'TRAY {n}', balls: 'BALLS {n}',
  attackerOpen: 'ATTACKER OPEN', kakuStart: 'KAKUHEN', noFire: 'No balls left', busy: 'Balls in flight',
  leaving: 'Finishing the attacker...', returned: 'Returned',
  hintFire: 'Fire', hintPower: 'Power', hintSnap: 'Right-shot', hintBall: 'Ball value', hintInfo: 'Info', hintLeave: 'Leave',
  potLabel: 'Tray', modeLabel: 'Mode', sweet: 'SWEET ZONE', sweetHint: 'Sweet zone pays best',
  infoTitle: 'PACHINKO RULES',
  infoBody: 'Hold fire to shoot 1.6 balls a second. The handle sets the power: 58-74 percent is the sweet zone. Start pocket spins the slot, three matching digits win the attacker. Odd triple means kakuhen.',
};

const tr: Record<string, string> = {
  name: 'Paçinko «Derin Yağmur»',
  desc: 'Çelik bilyeleri yağmurdan fırlat. Koldaki tatlı noktayı bul. Jackpot saldırgan kapıyı açar.',
  fire: 'Ateşle', snap: 'Sağ vuruş', power: 'GÜÇ %{n}', ball: 'BİLYE {n}', ballValue: 'Bilye değeri',
  zFoul: 'FAUL', zLow: 'SOL-ALT', zSweet: 'TATLI', zHigh: 'SOL-ÜST', zRight: 'SAĞ',
  mNormal: 'NORMAL', mKaku: 'KAKUHEN', mRight: 'SAĞ VURUŞ', mAtt: 'SALDIRGAN {n}/10', mClose: 'KAPALI',
  hold: 'TUT {n}', full: 'DOLU', holdsLabel: 'Bekleyen',
  reachN: 'REACH', reachS: 'SÜPER REACH', reachP: 'DRENAJ', jackpot: 'JACKPOT', kakuOn: 'KAKUHEN',
  blockWin: 'BLOK +{n}', chainWin: 'ZİNCİR +{n}', tray: 'TEPSİ {n}', balls: 'BİLYELER {n}',
  attackerOpen: 'SALDIRGAN AÇIK', kakuStart: 'KAKUHEN', noFire: 'Bilye kalmadı', busy: 'Bilyeler yolda',
  leaving: 'Saldırgan bitiriliyor...', returned: 'İade',
  hintFire: 'Ateşle', hintPower: 'Güç', hintSnap: 'Sağ vuruş', hintBall: 'Bilye değeri', hintInfo: 'Bilgi', hintLeave: 'Ayrıl',
  potLabel: 'Tepsi', modeLabel: 'Mod', sweet: 'TATLI BÖLGE', sweetHint: 'Tatlı bölge en çok öder',
  infoTitle: 'PAÇİNKO KURALLARI',
  infoBody: 'Ateşi basılı tutarak saniyede 1,6 bilye at. Kol gücü belirler: yüzde 58-74 tatlı bölgedir. Başlangıç deliği slotu döndürür, üç aynı rakam saldırgan kapıyı açar. Tek üçlü kakuhen demektir.',
};

export default { prefix: 'm.pachinko.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
