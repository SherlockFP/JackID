/**
 * The ten engine charms of wave 8 (item 3) as pure data, in the same CharmDef shape as `data/charms.ts`. Behaviours
 * (triggers and per-instant effects) live in `charms/engines.ts`. The integrator merges `CHARM_ENGINE_DATA` into the
 * catalogue with a spread and adds `ENGINE_CHARM_IDS` to `LAUNCH_CHARM_IDS`.
 *
 * Each charm carries exactly one archetype in `tags`. Rarity letters from the plan: R = rare, U = uncommon, L = legendary.
 * Only declarative effects live here; anything that changes with state (rungs, pressure, charge, wicks …) is dynamic.
 */
import type { CharmDef, CharmRarity, ModEffect } from '@/game/types';

export const ENGINE_ARCHETYPES = ['rotation', 'hot', 'clutch', 'banker', 'whale', 'copycat'] as const;
export type EngineArchetype = (typeof ENGINE_ARCHETYPES)[number];

/** The six suit families (machine tags). `wheel` on roulette is normalised to `wheels` by the suit stub in engines.ts. */
export const SUIT_FAMILY_TAGS = ['reels', 'cards', 'dice', 'wheels', 'drops', 'curios'] as const;
export type SuitFamily = (typeof SUIT_FAMILY_TAGS)[number];

const fx = (hook: ModEffect['hook'], op: ModEffect['op'], value: number): ModEffect => ({ hook, op, value });

function engine(
  id: string, rarity: CharmRarity, price: number, unlock: string, archetype: EngineArchetype,
  en: [string, string], tr: [string, string], effects: ModEffect[] = [],
): CharmDef {
  return {
    id, rarity, price, icon: 'charm', unlock, tags: [archetype], effects,
    strings: { en: { name: en[0], desc: en[1] }, tr: { name: tr[0], desc: tr[1] } },
  };
}

export const CHARM_ENGINE_DATA: readonly CharmDef[] = [
  engine('suit_ladder', 'rare', 42, 'N3', 'rotation',
    ['Suit Ladder', 'A play on a different suit than the last one gains +1 Rung (max 6). Wins pay ×(1 + 0.12 per Rung). Two plays in a row on the same suit cost 3 Rungs.'],
    ['Takım Merdiveni', 'Son oyunundan farklı bir takımda oynamak +1 Basamak kazandırır (en fazla 6). Kazançlar Basamak başına ×(1 + 0,12) öder. Üst üste aynı takımda iki oyun 3 Basamağa mal olur.']),
  engine('pressure_valve', 'uncommon', 20, 'N2', 'clutch',
    ['Pressure Valve', 'Each loss stores +1 Pressure (max 8). The next win pays ×(1 + 0.10 per Pressure), then Pressure resets.'],
    ['Basınç Valfi', 'Her kayıp +1 Basınç biriktirir (en fazla 8). Sonraki kazanç Basınç başına ×(1 + 0,10) öder, sonra Basınç sıfırlanır.']),
  engine('capacitor', 'rare', 42, 'N4', 'hot',
    ['Capacitor', 'A play on a Cold or tilted machine adds +1 charge (max 6). The next win on a Hot machine pays ×(1 + 0.25 per charge), then the charge resets.'],
    ['Kondansatör', 'Soğuk ya da eğimli bir makinede oynamak +1 şarj ekler (en fazla 6). Sıcak bir makinedeki sonraki kazanç şarj başına ×(1 + 0,25) öder, sonra şarj sıfırlanır.']),
  engine('lampwick', 'uncommon', 22, 'N3', 'hot',
    ['Lampwick', 'Each win on a Hot machine adds a wick (max 6, until Dawn). Each wick adds +0.08 to the Hot multiplier.'],
    ['Kandil Fitili', 'Sıcak bir makinedeki her kazanç bir fitil ekler (en fazla 6, Şafağa kadar). Her fitil Sıcak çarpanına +0,08 ekler.']),
  engine('ticket_press', 'uncommon', 18, 'N2', 'banker',
    ['Ticket Press', 'A win of ×5 or more prints +1 Ticket. Payouts get +2% per 3 Tickets held (max +20%).'],
    ['Bilet Presi', '×5 ve üzeri bir kazanç +1 Bilet basar. Elindeki her 3 Bilet için kazançlara +%2 (en fazla +%20).']),
  engine('last_gasp', 'rare', 40, 'N3', 'clutch',
    ['Last Gasp', 'During the last Watch\'s Last Call, while the quota is unmet: payouts ×1.4.'],
    ['Son Nefes', 'Son Watch\'ın Son Çağrısı sırasında, kota tutmadığı sürece: kazançlar ×1,4.']),
  engine('understudy', 'legendary', 95, 'N5', 'copycat',
    ['The Understudy', 'Copies the effects of your most expensive charm that is not Legendary or Cursed. Does not copy triggers.'],
    ['Dublör', 'Legendary ya da Lanetli olmayan en pahalı tılsımının etkilerini kopyalar. Tetikleyicileri kopyalamaz.']),
  engine('false_ceiling', 'legendary', 100, 'N6', 'whale',
    ['False Ceiling', 'House Limit ×2.4 (from 5× to 12× the quota). Dread +10 while held.'],
    ['Sahte Tavan', 'Ev Limiti ×2,4 (kotanın 5 katından 12 katına). Tutarken Korku +10.'],
    [fx('x.house.limitMult', 'mult', 2.4), fx('dread.add', 'add', 10)]),
  engine('gilded_chip', 'uncommon', 20, 'N2', 'whale',
    ['Gilded Chip', 'At max bet: payouts ×1.25. Below half of max bet: payouts ×0.9.'],
    ['Yaldızlı Fiş', 'Maksimum bahiste: kazançlar ×1,25. Maksimum bahsin yarısının altında: kazançlar ×0,9.']),
  engine('snowball_ledger', 'uncommon', 20, 'N2', 'banker',
    ['Snowball Ledger', 'Each Watch settled with at least 25% of the quota deposited adds +1% interest (max +3%, resets at Dawn).'],
    ['Kartopu Defteri', 'Kotanın en az %25\'i yatırılmış her Watch kapanışı +%1 faiz ekler (en fazla +%3, Şafakta sıfırlanır).']),
];

/** Ids of the ten engine charms, for `LAUNCH_CHARM_IDS` (the integrator adds them there). */
export const ENGINE_CHARM_IDS: ReadonlySet<string> = new Set(CHARM_ENGINE_DATA.map((d) => d.id));
