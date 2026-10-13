/**
 * Coin Pusher "The Shelf" — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.coinpusher.` by the registry;
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

export const STRINGS: MachineStrings = {
  en: {
    name: 'Coin Pusher "The Shelf"',
    desc: 'A glass box of coins on a sliding shelf. Drop your coins, feed the lucky gate, and hope the avalanche reaches your tray.',
    marquee: 'THE SHELF',
    hintDrop: 'Drop', hintAim: 'Aim', hintThump: 'Thump', hintInfo: 'Info', hintLeave: 'Leave',
    block: 'BLOCK {n}/10', blockPay: 'BLOCK +{n}', tray: 'TRAY {n}', shelf: 'SHELF {n}',
    ledCredit: 'CREDIT {n}', ledBet: 'BET {n}', ledWin: 'WIN {n}',
    sS: 'SHOWER S', sL: 'SHOWER L', sW: 'WALLS UP', sP: 'PRIZE CAPSULE', sJ: 'JACKPOT',
    prizeCommon: 'Charm capsule (common)', prizeUncommon: 'Charm capsule (uncommon)', prizeRare: 'Charm capsule (rare)',
    plate: 'GOLDEN PLATE', lucky: 'LUCKY GATE', gold: 'GOLD COIN',
    tilt: 'TILT! Station locked {n}s', tilted: 'Station tilted, wait', tiltTimer: 'TILT {n}s',
    noFunds: 'Not enough coins for a block', scav: 'Tray collected +{n}', wallsTimer: 'WALLS {n}s',
    infoTitle: 'COIN PUSHER RULES',
    infoBody: 'Hold Space or click to drop coins (3 a second). A and D aim the chute. Ten coins make a block; its wins pay out when the block closes. Coins that cross your half land in your tray. Gutter coins are lost to the house. The lucky gate spins the bonus reels. F thumps the shelf: two thumps within 20 seconds tilt the station for 30 seconds.',
  },
  tr: {
    name: 'Jeton İtici «Raf»',
    desc: 'Kayan rafta bir yığın jetonun olduğu camlı kutu. Jetonlarını bırak, şanslı kapıyı besle ve çığın tepsine ulaşmasını umut et.',
    marquee: 'RAF',
    hintDrop: 'Bırak', hintAim: 'Nişan', hintThump: 'Vur', hintInfo: 'Bilgi', hintLeave: 'Ayrıl',
    block: 'BLOK {n}/10', blockPay: 'BLOK +{n}', tray: 'TEPSİ {n}', shelf: 'RAF {n}',
    ledCredit: 'KREDİ {n}', ledBet: 'BAHİS {n}', ledWin: 'KAZANÇ {n}',
    sS: 'YAĞMUR S', sL: 'YAĞMUR L', sW: 'DUVARLAR YUKARI', sP: 'ÖDÜL KAPSÜLÜ', sJ: 'JACKPOT',
    prizeCommon: 'Tılsım kapsülü (sıradan)', prizeUncommon: 'Tılsım kapsülü (nadir)', prizeRare: 'Tılsım kapsülü (efsanevi)',
    plate: 'ALTIN PLAKA', lucky: 'ŞANS KAPISI', gold: 'ALTIN JETON',
    tilt: 'SARSINTI! İstasyon {n}s kilitli', tilted: 'İstasyon sarsıldı, bekle', tiltTimer: 'SARSINTI {n}s',
    noFunds: 'Blok için yeterli jeton yok', scav: 'Tepsi toplandı +{n}', wallsTimer: 'DUVARLAR {n}s',
    infoTitle: 'JETON İTİCİ KURALLARI',
    infoBody: 'Jeton bırakmak için Boşluk tuşunu basılı tut ya da tıkla (saniyede 3). A ve D oluğu hizalar. On jeton bir blok yapar; kazançlar blok kapanınca ödenir. Senin yarına düşen jetonlar tepsine gelir. Kenar oluklarındaki jetonlar eve kalır. Şans kapısı bonus makaralarını çevirir. F rafı sarsar: 20 saniye içinde iki sarsıntı istasyonu 30 saniye kilitler.',
  },
};
