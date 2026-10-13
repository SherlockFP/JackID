/**
 * Claw Crane — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts (default export
 * `{ prefix, en, tr }`); keys resolve as `m.claw.<key>`. `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Claw Crane',
  desc: 'A candy-pink grabber. The pile hides coin sacks, charm capsules and one golden egg. The claw is weak... usually.',
  marquee: 'CLAW CRANE',
  stake: 'Stake {n}', credit: 'CREDIT', timer: 'TIME', ready: 'READY', moving: 'MOVE', drop: 'DROP',
  sReady: 'Pick a stake, then move', sMove: 'Steer the claw', sDescend: 'Dropping', sClose: 'Gripping',
  sLift: 'Lifting', sTravel: 'Carrying', sRelease: 'Releasing', sReturn: 'Returning', sEmpty: 'Pile empty',
  hMove: 'Move', hDrop: 'Drop', hStake: 'Stake', hPlay: 'Play', sStake: 'STAKE', hPeek: 'Side-peek', hHelp: 'Help',
  hint: 'WASD / arrows move · Space drop · RMB side-peek · wheel / Z X stake · H help · E drop and leave',
  help: 'Move the claw over a prize and drop it. Close on the prize and it may lift, then it has to survive the trip to the chute. A strong grip rarely slips. Every 15 seconds the claw lets you move, so take your time.',
  sSack: 'x{n} SACK', sCap: 'CHARM', sEgg: 'GOLDEN',
  won: 'WON {n}', lost: 'Nothing this time', tumble: 'TUMBLED IN', grip: 'GRIP STRONG', grip2: 'GRIP WEAK',
  charmCommon: 'Common charm', charmRare: 'Rare charm', egg: 'Golden egg', sack: 'Coin sack ×{n}',
  eggWin: 'THE GOLDEN EGG', xrayOn: 'Strong grip', xrayOff: 'Weak grip',
  noFunds: 'Not enough coins for this stake', empty: 'The pile is empty. It restocks at the next Night.',
  busy: 'The claw is still moving', low: 'Need {n} actions', moved: 'Stake {n}', timeUp: 'Time up',
  lastCall: 'LAST CALL', fair: 'FAIR',
  // vocal and fx text
  dollWatch: 'The doll is watching', nope: 'NO',
};

const tr: Record<string, string> = {
  name: 'Pençe Vinç',
  desc: 'Şeker pembesi bir kapıcı. Yığın kese paralarını, tılsım kapsüllerini ve tek bir altın yumurtayı saklar. Pençe zayıftır... çoğu zaman.',
  marquee: 'PENÇE VİNÇ',
  stake: 'Bahis {n}', credit: 'KREDİ', timer: 'SÜRE', ready: 'HAZIR', moving: 'HAREKET', drop: 'BIRAK',
  sReady: 'Bahsi seç, sonra pençeyi oynat', sMove: 'Pençeyi yönlendir', sDescend: 'İniyor', sClose: 'Kavrıyor',
  sLift: 'Kaldırıyor', sTravel: 'Taşıyor', sRelease: 'Bırakıyor', sReturn: 'Dönüyor', sEmpty: 'Yığın boş',
  hMove: 'Hareket', hDrop: 'Bırak', hStake: 'Bahis', hPlay: 'Oyna', sStake: 'BAHİS', hPeek: 'Yan bakış', hHelp: 'Yardım',
  hint: 'WASD / oklar hareket · Boşluk bırak · sağ tık yan bakış · tekerlek / Z X bahis · H yardım · E bırak ve kalk',
  help: 'Pençeyi bir ödülün üstüne getir ve bırak. Ödülü kavrarsa kalkabilir, sonra kutuya kadar taşıması gerekir. Güçlü kavrama nadiren kaçırır. Her 15 saniyede pençeyi hareket ettirebilirsin, acele etme.',
  sSack: '×{n} KESE', sCap: 'TILSIM', sEgg: 'ALTIN',
  won: 'KAZANÇ {n}', lost: 'Bu sefer bir şey yok', tumble: 'KENDİLİĞİNDEN DÜŞTÜ', grip: 'KAVRAMA GÜÇLÜ', grip2: 'KAVRAMA ZAYIF',
  charmCommon: 'Sıradan tılsım', charmRare: 'Nadir tılsım', egg: 'Altın yumurta', sack: 'Kese ×{n}',
  eggWin: 'ALTIN YUMURTA', xrayOn: 'Güçlü kavrama', xrayOff: 'Zayıf kavrama',
  noFunds: 'Bu bahis için yeterli jeton yok', empty: 'Yığın boş. Bir sonraki Gece yenilenir.',
  busy: 'Pençe hâlâ hareket ediyor', low: '{n} eylem gerekli', moved: 'Bahis {n}', timeUp: 'Süre doldu',
  lastCall: 'SON ÇAĞRI', fair: 'ADİL',
  dollWatch: 'Bebek izliyor', nope: 'HAYIR',
};

export default { prefix: 'm.claw.', en, tr };
