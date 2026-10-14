/**
 * Boss Nights (wave 8, item 4) as pure data. Each boss becomes a NightEventDef in `game/bosses.ts`:
 * duration 'shift', exclusive 'boss', weight 0 (the random event pool never rolls it; the seed picks it).
 *
 * Night numbers are 1-based (N3 = Night 3). That matches `minShift` / `maxShift` in `buffs/events.ts`, which compares
 * them with `run.night() + 1`.
 */
import type { ModEffect } from '@/game/types';
import { SUIT_FAMILY_TAGS } from '@/game/data/charmsEngines';

/** Nights that carry a boss. On these nights the random event chance is 0. */
export const BOSS_NIGHTS: readonly number[] = [3, 6, 8];
export const BOSS_EXCLUSIVE = 'boss';
/** Reward for beating a boss: one pick of three Rare charms, plus Tickets. */
export const BOSS_REWARD = { charmRarity: 'rare', charmChoices: 3, tickets: 3 } as const;

export type BossId = 'embargo' | 'pennies' | 'frozen_ledger' | 'short_fuse' | 'lamp_night' | 'glass_night';

/** Which bosses can appear on each boss Night. */
export const BOSS_POOLS: Readonly<Record<number, readonly BossId[]>> = {
  3: ['embargo', 'pennies', 'frozen_ledger'],
  6: ['embargo', 'short_fuse', 'lamp_night'],
  8: ['glass_night'],
};

export interface BossTemplate {
  id: string;
  icon: string;
  /** `suit` is the seed-picked embargoed family (Embargo only; null for the others). */
  effects(suit: SuitFamilyOrNull): ModEffect[];
  /** `{suit}` in desc and announce is filled by the UI from the boss def's `suit`. */
  strings: { en: { name: string; desc: string; announce: string }; tr: { name: string; desc: string; announce: string } };
}
type SuitFamilyOrNull = (typeof SUIT_FAMILY_TAGS)[number] | null;

const fx = (hook: ModEffect['hook'], op: ModEffect['op'], value: number, tags?: string[]): ModEffect =>
  (tags ? { hook, op, value, scope: { tags } } : { hook, op, value });

export const BOSS_TEMPLATES: Readonly<Record<BossId, BossTemplate>> = {
  embargo: {
    id: 'boss_embargo',
    icon: 'icon.lock',
    effects: (suit) => {
      if (!suit) return [];
      const others = SUIT_FAMILY_TAGS.filter((s) => s !== suit) as string[];
      return [fx('payout.mult', 'mult', 0.4, [suit]), fx('payout.mult', 'mult', 1.15, others)];
    },
    strings: {
      en: { name: 'Embargo', desc: 'The {suit} suit pays ×0.4. Every other suit pays ×1.15.', announce: 'Embargo tonight: the {suit} suit is shut out.' },
      tr: { name: 'Ambargo', desc: '{suit} takımı ×0,4 öder. Diğer her takım ×1,15 öder.', announce: 'Bu gece ambargo: {suit} takımına kapalı.' },
    },
  },
  pennies: {
    id: 'boss_pennies',
    icon: 'icon.mint',
    effects: () => [fx('bet.maxMult', 'mult', 0.35), fx('x.run.pullsAdd', 'add', 3)],
    strings: {
      en: { name: 'Pennies Night', desc: 'Max bet ×0.35. +3 pulls every Watch.', announce: 'Pennies Night: small bets, longer hands.' },
      tr: { name: 'Bozukluk Gecesi', desc: 'Maks bahis ×0,35. Her Vardiya +3 çekiş.', announce: 'Bozukluk Gecesi: küçük bahisler, uzun eller.' },
    },
  },
  frozen_ledger: {
    id: 'boss_frozen_ledger',
    icon: 'icon.shield',
    effects: () => [fx('x.econ.interestAdd', 'add', -0.01), fx('payout.mult', 'inc', 0.25)],
    strings: {
      en: { name: 'Frozen Ledger', desc: 'Interest −1%. Payouts +25%.', announce: 'The ledger freezes tonight.' },
      tr: { name: 'Donmuş Defter', desc: 'Faiz −%1. Kazançlar +%25.', announce: 'Defter bu gece donuyor.' },
    },
  },
  short_fuse: {
    id: 'boss_short_fuse',
    icon: 'icon.bolt',
    effects: () => [fx('x.run.clockAdd', 'add', -45), fx('payout.mult', 'mult', 1.35)],
    strings: {
      en: { name: 'Short Fuse', desc: 'Clock −45 s. Payouts ×1.35.', announce: 'Short fuse: the clock runs hot.' },
      tr: { name: 'Kısa Fitil', desc: 'Saat −45 sn. Kazançlar ×1,35.', announce: 'Kısa fitil: saat hızlı işliyor.' },
    },
  },
  lamp_night: {
    id: 'boss_lamp_night',
    icon: 'icon.lamp',
    effects: () => [fx('x.lamp.coldCount', 'add', 2), fx('x.lamp.hotCount', 'add', 1), fx('x.lamp.hotMult', 'set', 2)],
    strings: {
      en: { name: 'Lamp Night', desc: '+2 Cold lamps, +1 Hot lamp. Hot multiplier 2.0.', announce: 'Lamp Night: the floor is all hot and cold.' },
      tr: { name: 'Lamba Gecesi', desc: '+2 Soğuk lamba, +1 Sıcak lamba. Sıcak çarpanı 2,0.', announce: 'Lamba Gecesi: zemin ya sıcak ya soğuk.' },
    },
  },
  glass_night: {
    id: 'boss_glass_night',
    icon: 'icon.eye',
    effects: () => [fx('payout.mult', 'mult', 1.3), fx('bet.costMult', 'mult', 1.3), fx('x.tilt.grace', 'add', -2)],
    strings: {
      en: { name: 'Glass Night', desc: 'Payouts ×1.3. Bets cost ×1.3. Tilt grace −2.', announce: 'Glass Night: everything shows, nothing forgives.' },
      tr: { name: 'Cam Gece', desc: 'Kazançlar ×1,3. Bahisler ×1,3 pahalı. Eğim ertelemesi −2.', announce: 'Cam Gece: her şey görünür, hiçbir şey affedilmez.' },
    },
  },
};
