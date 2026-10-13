/**
 * Nudge & Hold fruit machine — UI and in-world strings (EN + TR). Keys are auto-prefixed `m.fruitmachine.` by the registry.
 * `{n}` placeholders are filled by `MachineBase.t(key, vars)`.
 *
 * Keys starting with `lab` are painted onto the top-glass canvas with the px5 bitmap font, which has no Turkish glyphs,
 * so those stay ASCII in both languages.
 */
import type { MachineStrings } from '@/machines/_base/types';

export const STRINGS: MachineStrings = {
  en: {
    name: 'Fruit Machine "Nudge & Hold"',
    desc: 'Three reels, one line. Hold a pair, nudge a near miss, climb the trail, then gamble the win if you dare.',
    marquee: 'NUDGE & HOLD',
    start: 'Start', hold: 'Hold {n}', nudge: 'Nudge {n}', collect: 'Collect', hi: 'Hi', lo: 'Lo',
    stake: 'Stake {n}', max: 'Max', help: 'Pays', leave: 'Leave',
    win: 'WIN {n}', lose: 'No win', push: 'Push', gamble: 'Gamble {n}?', gambleWon: 'Climb! {n}',
    gambleLost: 'Lost', gambleSafe: 'Safety push', nudged: 'Nudged!', nudgeNo: 'NO',
    holdLit: 'HOLD available', holdSet: 'Holding {n}', feat: 'FEATURE', featHold: 'HOLD', featNudge: 'NUDGE',
    featStep: 'STEP +1', square: 'Square {n}/6', squareNo: 'NO', trailHit: 'TRAIL {n}', cashSkip: 'NO CASH',
    left: '{n} nudges', lost: 'Unused nudges lost', feastNo: 'Refused',
    ready: 'READY', lastRow: 'Line', payRows: 'PAYS',
    sq_NUDGE: 'NUDGES', sq_CASH: 'CASH', sq_HOLD: 'HOLD',
    lab_trail: 'TRAIL', lab_hold: 'HOLD', lab_nudge: 'NUDGE', lab_ladder: 'LADDER', lab_ready: 'READY',
    lab_nudges: 'NUDGES', lab_no: 'NO', lab_push: 'PUSH', lab_win: 'WIN', lab_lose: 'LOSE',
    sym_PEAR: 'Pear', sym_GRAPES: 'Grapes', sym_STRAW: 'Strawberry', sym_MELON: 'Melon', sym_BAR: 'Bar',
    sym_STAR: 'Double star', sym_BAG: 'Money bag', sym_STEP: 'Step',
    tblTitle: 'PAYS (x stake)', tblLine: '{s}  x{m}',
    card0: 'PEAR x4  GRAPES x6', card1: 'STRAW x8  MELON x12', card2: 'BAR x20  STAR x50', card3: 'BAG x100',
  },
  tr: {
    name: 'Meyve Makinesi "Dürt & Tut"',
    desc: 'Üç makara, tek hat. Çifti tut, kıl payını dürt, izi tırmandır, kazancını dilersen riske at.',
    marquee: 'DÜRT & TUT',
    start: 'Başlat', hold: 'Tut {n}', nudge: 'Dürt {n}', collect: 'Topla', hi: 'Yüksek', lo: 'Alçak',
    stake: 'Bahis {n}', max: 'Azami', help: 'Ödemeler', leave: 'Çık',
    win: 'KAZANÇ {n}', lose: 'Kazanç yok', push: 'Berabere', gamble: 'Riske at {n}?', gambleWon: 'Tırmandı! {n}',
    gambleLost: 'Kaybettin', gambleSafe: 'Emniyet beraberliği', nudged: 'Dürtüldü!', nudgeNo: 'YOK',
    holdLit: 'TUT hazır', holdSet: 'Tutuluyor {n}', feat: 'ÖZELLİK', featHold: 'TUT', featNudge: 'DÜRT',
    featStep: 'ADIM +1', square: 'Kare {n}/6', squareNo: 'YOK', trailHit: 'İZ {n}', cashSkip: 'NAKİT YOK',
    left: '{n} dürtme', lost: 'Kullanılmayan dürtmeler gitti', feastNo: 'Reddedildi',
    ready: 'HAZIR', lastRow: 'Hat', payRows: 'ÖDEMELER',
    sq_NUDGE: 'DÜRT', sq_CASH: 'NAKİT', sq_HOLD: 'TUT',
    lab_trail: 'IZ', lab_hold: 'TUT', lab_nudge: 'DURT', lab_ladder: 'MERDIVEN', lab_ready: 'HAZIR',
    lab_nudges: 'DURT', lab_no: 'YOK', lab_push: 'BERABERE', lab_win: 'KAZANC', lab_lose: 'KAYIP',
    sym_PEAR: 'Armut', sym_GRAPES: 'Üzüm', sym_STRAW: 'Çilek', sym_MELON: 'Kavun', sym_BAR: 'Bar',
    sym_STAR: 'Çift yıldız', sym_BAG: 'Para çantası', sym_STEP: 'Adım',
    tblTitle: 'ÖDEMELER (x bahis)', tblLine: '{s}  x{m}',
    card0: 'ARMUT x4  UZUM x6', card1: 'CILEK x8  KAVUN x12', card2: 'BAR x20  CIFT YILDIZ x50', card3: 'PARA CANTASI x100',
  },
};
