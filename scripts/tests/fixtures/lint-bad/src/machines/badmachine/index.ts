/** Fixture: a machine with a wrong id, a missing desc, and forbidden imports. */
import { MachineBase } from '../_base/MachineBase';
import { label } from '../../menu/menuState';
import { ui } from '../../world/world';
import type { CoinFlip } from '../coinflip/index';

export const def = {
  id: 'wrongid',
  slotSize: 'S',
  strings: {
    en: { name: 'Bad' },
    tr: { name: 'Kötü', desc: 'Açıklama' },
  },
};

export default class Bad extends MachineBase {
  readonly parts = [label, ui] as const;
  readonly other: CoinFlip | null = null;
}
