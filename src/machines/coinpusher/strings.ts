/**
 * Coin Pusher "The Shelf" — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.coinpusher.` by the registry;
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 */
import type { MachineStrings } from '@/machines/_base/types';

export const STRINGS: MachineStrings = {
  en: {
    name: 'Coin Pusher "The Shelf"',
    desc: 'A glass box of coins on a sliding shelf. Feed the lucky gate, hope for an avalanche.',
    marquee: 'THE SHELF',
    hintDrop: 'Drop', hintAim: 'Aim', hintThump: 'Thump', hintInfo: 'Info', hintLeave: 'Leave',
    block: 'BLOCK {n}/10', blockPay: 'BLOCK +{n}', tray: 'TRAY {n}', shelf: 'SHELF {n}',
    ledCredit: 'CREDIT {n}', ledBet: 'BET {n}', ledWin: 'WIN {n}',
    sS: 'SHOWER S', sL: 'SHOWER L', sW: 'WALLS UP', sP: 'PRIZE CAPSULE', sJ: 'JACKPOT',
    prizeCommon: 'Charm capsule (common)', prizeUncommon: 'Charm capsule (uncommon)', prizeRare: 'Charm capsule (rare)',
    plate: 'GOLDEN PLATE', lucky: 'LUCKY GATE', gold: 'GOLD COIN',
    tilt: 'TILT! Tray {lost} lost, station locked {n}s', tilted: 'Station tilted, wait', tiltTimer: 'TILT {n}s',
    ledThump: 'THUMP', heat: 'HEAT {n}/{m}', tiltRisk: 'NEXT THUMP: TILT',
    noFunds: 'Not enough coins for a block', scav: 'Tray collected +{n}', wallsTimer: 'WALLS {n}s',
    trayRisk: 'TRAY AT RISK: {n}', noTray: 'Tray is empty, nothing to risk',
    infoTitle: 'COIN PUSHER RULES',
    infoBody: 'Hold Space or click to drop coins. A and D aim. F thumps the shelf and fills HEAT. A third quick thump trips TILT: tray lost, station locked 30 s. The lucky gate spins bonus reels.',
  },
  tr: {
    name: 'Jeton İtici «Raf»',
    desc: 'Kayan rafta camlı jeton kutusu. Şans kapısını besle, çığı bekle.',
    marquee: 'RAF',
    hintDrop: 'Bırak', hintAim: 'Nişan', hintThump: 'Vur', hintInfo: 'Bilgi', hintLeave: 'Ayrıl',
    block: 'BLOK {n}/10', blockPay: 'BLOK +{n}', tray: 'TEPSİ {n}', shelf: 'RAF {n}',
    ledCredit: 'KREDİ {n}', ledBet: 'BAHİS {n}', ledWin: 'KAZANÇ {n}',
    sS: 'YAĞMUR S', sL: 'YAĞMUR L', sW: 'DUVARLAR YUKARI', sP: 'ÖDÜL KAPSÜLÜ', sJ: 'JACKPOT',
    prizeCommon: 'Tılsım kapsülü (sıradan)', prizeUncommon: 'Tılsım kapsülü (nadir)', prizeRare: 'Tılsım kapsülü (efsanevi)',
    plate: 'ALTIN PLAKA', lucky: 'ŞANS KAPISI', gold: 'ALTIN JETON',
    tilt: 'SARSINTI! Tepsi {lost} kaybetti, istasyon {n}s kilitli', tilted: 'İstasyon sarsıldı, bekle', tiltTimer: 'SARSINTI {n}s',
    ledThump: 'VUR', heat: 'ISI {n}/{m}', tiltRisk: 'SONRAKİ VUR: SARSINTI',
    noFunds: 'Blok için yeterli jeton yok', scav: 'Tepsi toplandı +{n}', wallsTimer: 'DUVARLAR {n}s',
    trayRisk: 'RİSKTEKİ TEPSİ: {n}', noTray: 'Tepsi boş, riske atılacak bir şey yok',
    infoTitle: 'JETON İTİCİ KURALLARI',
    infoBody: 'Boşluk ya da tık: jeton bırak. A ve D nişan alır. F rafı sarsar, ISI dolar. Kısa sürede üçüncü vuruş SARSINTI: tepsi gider, istasyon 30 sn kilitli. Şans kapısı bonus makaralarını çevirir.',
  },
};
