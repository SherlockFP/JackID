/**
 * Special rooms (WAVE 24 plan §2): static data only. The logic (Keyring grants, grille options, the boiler gauge, lockers,
 * the Back Office, the Collector price) lives in `game/rooms.ts`; the strings in `game/rooms.strings.ts`.
 *
 * Room rules are zone-scoped ModEffects (`scope.zones`), so the run's pipeline applies them to any machine whose def zone
 * is an open room. They are active only while their room is open (`rooms.ts` `roomRules`).
 */
import type { ModEffect } from '@/game/modifiers.types';

/** The wings a Wing Key or the Manager's Key can open. `counting` is not a Keyring wing. */
export type WingId = 'midway' | 'cards' | 'laundry' | 'boiler' | 'gallery' | 'wheels' | 'counting';

export const WING_IDS: readonly WingId[] = ['midway', 'cards', 'laundry', 'boiler', 'gallery', 'wheels', 'counting'];

/** Keyring wings: the grille offers Key or BUY for these. Plan order. */
export const KEYRING_WINGS: readonly WingId[] = ['midway', 'cards', 'laundry', 'boiler', 'gallery', 'wheels'];

/** The Locksmith opens the first closed wing in this order (the Jade Room is meant to be the first room). */
export const LOCKSMITH_ORDER: readonly WingId[] = ['cards', 'laundry', 'boiler', 'midway', 'gallery', 'wheels'];

/** Stoker (Hotline) opens this wing. */
export const STOKER_WING: WingId = 'boiler';

export const KEYRING = {
  /** +1 Wing Key at each Dawn after Nights 1 … dawnNights. */
  dawnNights: 6,
  /** +1 Wing Key for beating the boss on these Nights. */
  bossNights: [3, 6, 8] as readonly number[],
  /** Manager's Key: opens the Counting Room only, and drops from the boss on this Night. */
  managerNight: 6,
  /** Keys one grille spends. */
  keyCost: 1,
  /** BUY price of a Keyring wing, as a multiple of the quota due. */
  buyQuotaMult: 1.5,
  /** The Parlour opens by itself once this Night is paid. */
  parlourNight: 3,
} as const;

/** Jade Room (`cards`): CARDS payouts ×1.10, max bet ×0.7. */
export const ROOM_RULES: readonly ModEffect[] = [
  { hook: 'payout.mult', op: 'mult', value: 1.1, scope: { zones: ['cards'] } },
  { hook: 'bet.maxMult', op: 'mult', value: 0.7, scope: { zones: ['cards'] } },
];

/** The Boiler (`boiler`): pressure P rises by `gainPerPull` each pull; payouts ×(1 + P/100), capped at `maxPayoutMult`. */
export const BOILER = {
  gainPerPull: 5,
  /** P at which the room blows and locks until the next Watch. */
  max: 100,
  /** The Vent lever resets P and costs this many pulls (the run's pull currency). */
  ventPulls: 1,
  maxPayoutMult: 2,
} as const;

/** The Wash (`laundry`): twelve numbered lockers. */
export const LOCKER = {
  count: 12,
  /** Tickets per opening. */
  ticketCost: 1,
  /** The lockers beyond this many in one Night each trigger a Dread beat. */
  dreadAfter: 3,
  dread: 8,
  /** Coins: `base + perNight × Night`. */
  coinBase: 30,
  coinPerNight: 15,
  /** Obols a blank JackID pays. */
  blankObols: 2,
} as const;

export type LockerKind = 'note' | 'charm' | 'coins' | 'blank';
export const LOCKER_TABLE: ReadonlyArray<{ k: LockerKind; w: number }> = [
  { k: 'note', w: 30 },
  { k: 'coins', w: 30 },
  { k: 'charm', w: 25 },
  { k: 'blank', w: 15 },
];

/** Back Office (`counting`): Tickets exchange for Obols. */
export const BACK_OFFICE = { tickets: 3, obols: 1 } as const;

/** Parlour Collector: buys a charm for Obols at this multiple of its sell value. */
export const COLLECTOR = { sellMult: 2 } as const;

/** Old Lin (Jade Room vendor): the pool filter applied to the Pawn shelf (`shop.ts`). Tag match is case-insensitive. */
export const LIN_POOL_TAGS: readonly string[] = ['CARDS', 'MAHJONG'];

/** Charm affinity tags Old Lin stocks: a charm whose tag or any tag is a Jade Room tag. */
export function linPoolAccepts(d: { tag?: string; tags?: readonly string[] }): boolean {
  const want = LIN_POOL_TAGS.map((t) => t.toUpperCase());
  if (d.tag && want.includes(d.tag.toUpperCase())) return true;
  return (d.tags ?? []).some((t) => want.includes(t.toUpperCase()));
}

/** Strings keys of a wing (`rooms.wing.<id>.name|desc`), in the WingDef shape. */
export function wingStrings(id: WingId): { en: { name: string; desc: string }; tr: { name: string; desc: string } } {
  const k = `rooms.wing.${id}`;
  return { en: { name: `${k}.name`, desc: `${k}.desc` }, tr: { name: `${k}.name`, desc: `${k}.desc` } };
}
