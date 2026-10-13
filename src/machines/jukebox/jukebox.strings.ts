/**
 * Jukebox — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered under
 * `m.jukebox.` (MachineBase.t adds the prefix). Song titles are the music engine's own `jukebox.<id>` keys.
 */
import type { MachineStrings } from '@/machines/_base/types';

const en: Record<string, string> = {
  h_pick: 'PICK', h_play: 'PLAY', h_stop: 'STOP', h_leave: 'LEAVE',
  goal: "Pick a song for one ticket. It plays for the rest of the Watch, one song at a time.",
  stPlaying: "NOW PLAYING",
  stPick: "PICK A SONG",
  stPickSub: "One ticket per song",
  stFunds: "NOT ENOUGH TICKETS",
  stFundsSub: "A song costs {n} ticket",
  stLocked: "THIS SONG IS LOCKED",
  stLockedSub: "Pick another track",
  nTickets: "TICKETS",
  nPrice: "PRICE",
  nNow: "ON NOW",
  nSelected: "SELECTED",
  cMove: "MOVE",
  cPick: "PICK",
  cPlay: "PLAY",
  cStop: "STOP",
  cRules: "RULES",
  cLeave: "LEAVE",
  rule1: "Each song costs one ticket. It plays for the rest of the Watch, and a new song replaces the old one.",
  rule2: "Locked songs unlock later in the run. Pressing the playing song again is the same as STOP.",
  rule3: "Keys: arrows move the cursor, 1-9 jump to a song, PRIMARY plays it, SECONDARY stops the music.",
  tip1: "Pick a song and play it for one ticket. One song plays at a time.",
  tip2: "[{move}] PICK A SONG  ·  [{play}] PLAY (1 TICKET)",
  tip3: "[{stop}] STOP THE MUSIC  ·  [{help}] RULES",
  s_tickets: 'TICKETS', s_song: 'ON NOW', s_cost: 'PRICE',
  ledger: 'JUKEBOX', off: 'SILENCE', none: 'NOTHING HERE',
  funds: 'NOT ENOUGH TICKETS', locked: 'LOCKED',
};

const tr: Record<string, string> = {
  h_pick: 'SEÇ', h_play: 'ÇAL', h_stop: 'DURDUR', h_leave: 'AYRIL',
  goal: "Bir bilete bir şarkı seç. Watch'ın kalanında çalar, aynı anda tek şarkı.",
  stPlaying: "ŞU AN ÇALIYOR",
  stPick: "BİR ŞARKI SEÇ",
  stPickSub: "Şarkı başına bir bilet",
  stFunds: "BİLET YETMİYOR",
  stFundsSub: "Bir şarkı {n} bilet",
  stLocked: "BU ŞARKI KİLİTLİ",
  stLockedSub: "Başka bir parça seç",
  nTickets: "BİLET",
  nPrice: "ÜCRET",
  nNow: "ŞU AN",
  nSelected: "SEÇİLEN",
  cMove: "GEZ",
  cPick: "SEÇ",
  cPlay: "ÇAL",
  cStop: "DURDUR",
  cRules: "KURALLAR",
  cLeave: "AYRIL",
  rule1: "Her şarkı bir bilet tutar. Watch'ın kalanında çalar, yeni şarkı eskisinin yerini alır.",
  rule2: "Kilitli şarkılar koşu ilerledikçe açılır. Çalan şarkıya tekrar basmak DURDUR ile aynıdır.",
  rule3: "Tuşlar: oklar imleci gezdirir, 1-9 bir şarkıya atlar, BİRİNCİL çalar, İKİNCİL müziği durdurur.",
  tip1: "Bir şarkı seç ve bir bilete çal. Aynı anda tek şarkı çalar.",
  tip2: "[{move}] ŞARKI SEÇ  ·  [{play}] ÇAL (1 BİLET)",
  tip3: "[{stop}] MÜZİĞİ DURDUR  ·  [{help}] KURALLAR",
  s_tickets: 'BİLET', s_song: 'ŞU AN', s_cost: 'ÜCRET',
  ledger: 'JUKEBOX', off: 'SESSİZLİK', none: 'BURADA BİR ŞEY YOK',
  funds: 'BİLET YETMİYOR', locked: 'KİLİTLİ',
};

export const STRINGS: MachineStrings = { en, tr };
export default { prefix: 'm.jukebox.', en, tr };
