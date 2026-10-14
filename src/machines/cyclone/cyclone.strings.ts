/**
 * Cyclone Light Ring — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are
 * registered under `m.cyclone.` (MachineBase.t adds the prefix). `{n}` placeholders are filled by `t(key, vars)`.
 */
const en: Record<string, string> = {
  name: 'Cyclone Light Ring',
  desc: 'Stop the light on the best lamp. Forty-eight bulbs, one chase. Rarely the Eye opens and the jackpot lamp goes gold.',
  start: 'Start', stop: 'Stop', stakeLabel: 'Stake', stake: 'Stake {n}', bet: 'BET {n}', win: 'WIN {n}',
  credit: 'CREDIT', last: 'LAST', btnStart: 'START', btnStop: 'STOP',
  hintStart: 'Start', hintStop: 'Stop', hintStake: 'Stake', hintNudge: 'Nudge',
  armed: 'THE EYE OPENS', jackpot: 'JACKPOT', multLabel: '×{n}', nudge: 'NUDGE', nudged: 'NUDGED ×{n}',
  lost: 'Nothing this time', auto: 'Too slow, the ring stopped itself', busy: 'The ring is still turning',
  second: 'SECOND ×{n}', jp: 'JP',
  // seat HUD (readability standard)
  hGoal: 'Stop the light on the best lamp. Pays stake × lamp value',
  hBet: 'PLACE YOUR STAKE, THEN START', hTurn: 'LIGHT TURNING', hAuto: 'AUTO-STOP IN {n}S',
  hReveal: 'THE EYE IS OPENING', hCoast: 'LIGHT SLOWING DOWN', hNudge: 'RATCHET WINDOW · NUDGE OR TAKE IT',
  hSecs: 'CLOSES IN {n}S', hPay: 'PAYING OUT', hEyeOpen: 'EYE OPEN',
  hNStake: 'STAKE', hNJackpot: 'JACKPOT', hNLast: 'LAST LAMP', hNBalance: 'BALANCE',
  hCStart: 'START', hCStop: 'STOP', hCStake: 'STAKE', hCNudge: 'NUDGE FOR {n}', hCRules: 'RULES', hCLeave: 'LEAVE',
  hTip1: 'Set your stake with {up} and {down}, then press {start} to start the light.',
  hTip2: 'Press {start} again to stop it on the lamp you want. It pays the lamp it lands on.',
  hTip3: 'Press {help} for the full rules and payouts. Any key closes a card.',
  hR1: 'Stake {min} to {max}. The light chases clockwise around 48 lamps. Press START to start it.',
  hR2: 'Press STOP to stop the light. If you wait, it stops itself 10 to 11 seconds after the start.',
  hR3: 'Lamps pay 0, 1 or 3 times the stake in a repeating pattern. Lamp 0 is the jackpot.',
  hR4: 'The Eye opens rarely. Then the jackpot lamp pays {jp} times the stake, and only then.',
  hR5: 'With the Golden Ratchet, [{nudge}] within 3 seconds moves the result one lamp for 25% of the stake.',
  hR6: 'The stake can only change between rounds.',
};

const tr: Record<string, string> = {
  name: 'Siklon Işık Çemberi',
  desc: 'Işığı en iyi lambada durdur. Kırk sekiz ampul, tek kovalamaca. Nadiren Göz açılır ve jackpot lambası altın olur.',
  start: 'Başlat', stop: 'Dur', stakeLabel: 'Bahis', stake: 'Bahis {n}', bet: 'BAHİS {n}', win: 'KAZANÇ {n}',
  credit: 'KREDİ', last: 'SON', btnStart: 'BAŞLAT', btnStop: 'DUR',
  hintStart: 'Başlat', hintStop: 'Dur', hintStake: 'Bahis', hintNudge: 'Dürt',
  armed: 'GÖZ AÇILDI', jackpot: 'JACKPOT', multLabel: '×{n}', nudge: 'DÜRT', nudged: 'DÜRTÜLDÜ ×{n}',
  lost: 'Bu sefer olmadı', auto: 'Çok geç kaldın, çember kendi durdu', busy: 'Çember hâlâ dönüyor',
  second: 'İKİNCİ ×{n}', jp: 'JP',
  // seat HUD (readability standard)
  hGoal: 'Işığı en değerli lambada durdur. Bahis × lamba değeri öder',
  hBet: 'BAHSİNİ KOY, SONRA BAŞLAT', hTurn: 'IŞIK DÖNÜYOR', hAuto: 'OTOMATİK DURUR: {n} SN',
  hReveal: 'GÖZ AÇILIYOR', hCoast: 'IŞIK YAVAŞLIYOR', hNudge: 'CIRCIR PENCERESİ · DÜRT YA DA BIRAK',
  hSecs: '{n} SN SONRA KAPANIR', hPay: 'ÖDEME YAPILIYOR', hEyeOpen: 'GÖZ AÇIK',
  hNStake: 'BAHİS', hNJackpot: 'JACKPOT', hNLast: 'SON LAMBA', hNBalance: 'BAKİYE',
  hCStart: 'BAŞLAT', hCStop: 'DUR', hCStake: 'BAHİS', hCNudge: 'DÜRT: {n}', hCRules: 'KURALLAR', hCLeave: 'AYRIL',
  hTip1: 'Bahsini {up} ve {down} ile seç, sonra {start} ile ışığı başlat.',
  hTip2: '{start} tuşuna tekrar basınca ışık istediğin lambada durur. Durduğu lambanın değeri ödenir.',
  hTip3: '{help} ile tam kuralları ve ödemeleri gör. Her tuş kartı kapatır.',
  hR1: 'Bahis {min} ile {max} arası. Işık 48 lamba etrafında saat yönünde döner. BAŞLAT ile çalıştır.',
  hR2: 'DUR ile ışığı durdur. Beklersen başlangıçtan 10 ila 11 saniye sonra kendi durur.',
  hR3: 'Lambalar bahsin 0, 1 ya da 3 katını tekrar eden bir düzende öder. 0 numaralı lamba jackpottur.',
  hR4: 'GÖZ nadiren açılır. Açılınca jackpot lambası bahsin {jp} katını öder, yalnızca o zaman.',
  hR5: 'Altın Cırcır ile [{nudge}] 3 saniye içinde sonucu bir lamba kaydırır, bedeli bahsin %25\'i.',
  hR6: 'Bahis yalnızca turlar arasında değişir.',
};

export default { prefix: 'm.cyclone.', en, tr };

/** The same tables, typed for `def.strings` (MachineStrings). */
export const STRINGS = { en, tr };
