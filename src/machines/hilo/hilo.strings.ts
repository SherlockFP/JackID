/**
 * Hi-Lo Ladder — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.hilo.` (`prefix`).
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

const STRINGS: MachineStrings = {
  en: {
    name: 'Hi-Lo Ladder',
    desc: 'Guess higher or lower each card. Climb, or collect before you bust.',
    marquee: 'HI-LO LADDER',
    higher: 'Higher', lower: 'Lower', skip: 'Skip', collect: 'Collect', deal: 'Deal',
    runLabel: 'Run', stepsLabel: 'Steps',
    same: 'SAME!', refund: 'REFUND',
    noSkips: 'No skips left.', noGuess: 'That guess is certain. Pick the other side.',
    needStep: 'Make one correct guess before you collect.',

    // ── seat HUD (readability standard) ──
    goal: 'Guess the next card: higher or lower. Collect before a bust.',
    rule1: 'A card is face up. Guess whether the next card is higher or lower. A tie is a win.',
    rule2: 'Each right guess multiplies the run. The rung lamps show how high you climbed.',
    rule3: 'A guess that cannot lose is not offered.',
    rule4: 'SKIP swaps the card for a new one. You get one skip per round, so pick your moment.',
    rule5: 'COLLECT pays the bet times the run, after at least one right guess. A bust loses the bet.',
    rule6: 'Leaving the seat collects a live ladder, or refunds the bet when no guess was made.',
    stBet: 'PLACE YOUR BET', stBetSub: 'Press [{deal}] to deal', stBusy: 'CARD IN PLAY…',
    stGuess: 'HIGHER OR LOWER?', stGuessSub: 'A tie counts as a win',
    stClimb: 'KEEP CLIMBING?', stClimbSub: 'Collect now for {n}',
    nCard: 'CARD', nBet: 'BET', nRun: 'RUN', nSteps: 'STEPS', nCollect: 'COLLECT',
    nSkips: 'SKIPS LEFT', nBalance: 'BALANCE',
    cDeal: 'DEAL', cBet: 'BET', cHigher: 'HIGHER', cLower: 'LOWER', cSkip: 'SKIP', cCollect: 'COLLECT',
    cRules: 'RULES', cLeave: 'LEAVE',
    cHigherOdds: 'HIGHER {p}% · x{m} = {c}', cLowerOdds: 'LOWER {p}% · x{m} = {c}',
    nearMiss: 'ONE RANK OFF!',
  },
  tr: {
    name: 'Yüksek-Alçak Merdiveni',
    desc: 'Her kartta yüksek mi alçak mı? Tırman, batmadan kazancı al.',
    marquee: 'YÜKSEK-ALÇAK',
    higher: 'Yüksek', lower: 'Alçak', skip: 'Atla', collect: 'Al', deal: 'Dağıt',
    runLabel: 'Çarpan', stepsLabel: 'Adım',
    same: 'AYNI!', refund: 'İADE',
    noSkips: 'Atlama hakkın kalmadı.', noGuess: 'Bu tahmin kesin. Diğer tarafı seç.',
    needStep: 'Almadan önce bir doğru tahmin yap.',

    // ── seat HUD (readability standard) ──
    goal: 'Sıradaki kartı tahmin et: yüksek mi alçak mı. Batmadan kazancı al.',
    rule1: 'Kart açık gelir. Sıradaki kartın yüksek mi alçak mı olacağını tahmin et. Eşitlik kazandırır.',
    rule2: 'Her doğru tahmin çarpanı büyütür. Merdiven lambaları ne kadar tırmandığını gösterir.',
    rule3: 'Kaybetme ihtimali olmayan bir tahmin sunulmaz.',
    rule4: 'ATLA kartı yenisiyle değiştirir. Turda bir atlama hakkın var, zamanını iyi seç.',
    rule5: 'AL, bahsi çarpanla çarpıp öder. En az bir doğru tahmin şarttır. Batarsan bahis kaybolur.',
    rule6: 'Masadan kalkarsan canlı merdiven alınır; hiç tahmin yapılmadıysa bahis iade edilir.',
    stBet: 'BAHSİNİ YAP', stBetSub: '[{deal}] ile kartı dağıt', stBusy: 'KART ÇEVRİLİYOR…',
    stGuess: 'YÜKSEK Mİ ALÇAK MI?', stGuessSub: 'Eşitlik kazandırır',
    stClimb: 'TIRMANMAYA DEVAM?', stClimbSub: 'Şimdi al: {n}',
    nCard: 'KART', nBet: 'BAHİS', nRun: 'ÇARPAN', nSteps: 'ADIM', nCollect: 'ALINACAK',
    nSkips: 'KALAN ATLAMA', nBalance: 'BAKİYE',
    cDeal: 'DAĞIT', cBet: 'BAHİS', cHigher: 'YÜKSEK', cLower: 'ALÇAK', cSkip: 'ATLA', cCollect: 'AL',
    cRules: 'KURALLAR', cLeave: 'ÇIK',
    cHigherOdds: 'YÜKSEK {p}% · x{m} = {c}', cLowerOdds: 'ALÇAK {p}% · x{m} = {c}',
    nearMiss: 'BİR KADEM FARK!',
  },
};

export default { prefix: 'm.hilo.', en: STRINGS.en, tr: STRINGS.tr };
