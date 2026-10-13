/**
 * Jukebox — UI and in-world strings (EN + TR). Loaded by the `*.strings.ts` glob in main.ts; keys are registered under
 * `m.jukebox.` (MachineBase.t adds the prefix). Song titles are the music engine's own `jukebox.<id>` keys.
 */
import type { MachineStrings } from '@/machines/_base/types';

const en: Record<string, string> = {
  h_pick: 'PICK', h_play: 'PLAY', h_stop: 'STOP', h_leave: 'LEAVE',
  s_tickets: 'TICKETS', s_song: 'ON NOW', s_cost: 'PRICE',
  ledger: 'JUKEBOX', off: 'SILENCE', none: 'NOTHING HERE',
  funds: 'NOT ENOUGH TICKETS', locked: 'LOCKED',
};

const tr: Record<string, string> = {
  h_pick: 'SEÇ', h_play: 'ÇAL', h_stop: 'DURDUR', h_leave: 'AYRIL',
  s_tickets: 'BİLET', s_song: 'ŞU AN', s_cost: 'ÜCRET',
  ledger: 'JUKEBOX', off: 'SESSİZLİK', none: 'BURADA BİR ŞEY YOK',
  funds: 'BİLET YETMİYOR', locked: 'KİLİTLİ',
};

export const STRINGS: MachineStrings = { en, tr };
export default { prefix: 'm.jukebox.', en, tr };
