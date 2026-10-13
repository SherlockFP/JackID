/** Fixture: a machine folder that follows the contract. */
import { MachineBase } from '../_base/MachineBase';
import type { Lang } from '@/core/types';

export const def = {
  id: 'coinflip',
  slotSize: 'S',
  strings: {
    en: { name: 'Coin Flip', desc: 'Heads or tails.' },
    tr: { name: 'Yazı Tura', desc: 'Yazı mı tura mı.' },
  },
};

export const playHeadless = (): number => 0;

export default class CoinFlip extends MachineBase {
  lang: Lang = 'en';
}
