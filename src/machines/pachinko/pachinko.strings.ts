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
  goal: 'Land balls in the sweet zone and hit three matching digits to open the attacker.',
  stReady: 'READY TO FIRE', stReadySub: 'Find the sweet zone on the handle', stFire: 'FIRING',
  stAttOpen: 'ATTACKER OPEN', stAttSub: 'Round {n}/10 - balls go in the pocket', stAttClosed: 'ATTACKER CLOSED',
  stKaku: 'KAKUHEN', stKakuSub: 'The right shot stays on', stLeave: 'FINISHING THE ATTACKER',
  nBall: 'BALL', nPower: 'POWER', nTray: 'TRAY', nHolds: 'HOLDS', nBalance: 'BALANCE',
  cFire: 'FIRE', cPower: 'POWER', cSnap: 'RIGHT-SHOT', cBall: 'BALL VALUE', cRules: 'RULES', cLeave: 'LEAVE',
  tip1: 'Hold {fire} to fire balls. Set the power with {power}.',
  tip2: 'Keep the power in the SWEET zone to win the most.',
  tip3: 'Three matching digits open the attacker. {help} for the rules.',
  rule1: 'Hold {fire} to shoot about 1.6 balls a second. Each ball costs the ball value.',
  rule2: 'The handle sets the power. The sweet zone pays best and a FOUL zone pays nothing.',
  rule3: 'The start pocket spins the digits. Three matching digits open the attacker.',
  rule4: 'The attacker runs up to 10 rounds. A kakuhen keeps the right shot on until the next jackpot.',
  rule5: 'Leaving during the attacker fires the remaining balls automatically, for up to 60 seconds.',
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
  goal: 'Tatlı bölgeye vur, üç aynı rakamı yakala ve saldırgan kapıyı aç.',
  stReady: 'ATEŞE HAZIR', stReadySub: 'Koldaki tatlı bölgeyi bul', stFire: 'ATEŞLENİYOR',
  stAttOpen: 'SALDIRGAN AÇIK', stAttSub: 'Tur {n}/10 - bilyeler deliğe girer', stAttClosed: 'SALDIRGAN KAPALI',
  stKaku: 'KAKUHEN', stKakuSub: 'Sağ vuruş açık kalır', stLeave: 'SALDIRGAN BİTİRİLİYOR',
  nBall: 'BİLYE', nPower: 'GÜÇ', nTray: 'TEPSİ', nHolds: 'BEKLEYEN', nBalance: 'BAKİYE',
  cFire: 'ATEŞLE', cPower: 'GÜÇ', cSnap: 'SAĞ VURUŞ', cBall: 'BİLYE DEĞERİ', cRules: 'KURALLAR', cLeave: 'AYRIL',
  tip1: '{fire} basılı tut, bilye at. Gücü {power} ile ayarla.',
  tip2: 'En çok kazanmak için gücü TATLI bölgede tut.',
  tip3: 'Üç aynı rakam saldırgan kapıyı açar. Kurallar için {help}.',
  rule1: '{fire} basılı tutunca saniyede yaklaşık 1,6 bilye atılır. Her bilye bilye değeri kadar tutar.',
  rule2: 'Kol gücü belirler. Tatlı bölge en çok öder, FAUL bölgesi hiçbir şey ödemez.',
  rule3: 'Başlangıç deliği rakamları döndürür. Üç aynı rakam saldırgan kapıyı açar.',
  rule4: 'Saldırgan en fazla 10 tur sürer. Kakuhen, bir sonraki jackpot’a kadar sağ vuruşu açık tutar.',
  rule5: 'Saldırgan sürerken çıkarsan kalan bilyeler 60 saniyeye kadar otomatik atılır.',
  infoTitle: 'PAÇİNKO KURALLARI',
  infoBody: 'Ateşi basılı tutarak saniyede 1,6 bilye at. Kol gücü belirler: yüzde 58-74 tatlı bölgedir. Başlangıç deliği slotu döndürür, üç aynı rakam saldırgan kapıyı açar. Tek üçlü kakuhen demektir.',
};

export default { prefix: 'm.pachinko.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
