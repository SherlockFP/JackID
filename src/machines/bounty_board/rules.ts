/**
 * Bounty Board (`bounty_board`, system, MOUTH-BOUNTY) — pure rules, no three, kit or DOM (devices-lobby lane).
 * GDD §11.9: three contracts per Night (seed stream `bounty`), paid at once, unfinished ones expire at Dawn.
 *
 * The board only shows and signs. Offers are drawn by the game (`run.contracts.roll`), progress is counted by the game
 * from run events, and rewards are paid by `run.contracts.claim`. This file holds the catalogue of contract defs (the
 * GDD table) and the board rules: how many slips show, what accepting costs, and when a slip can be signed.
 */
import type { ContractDef, ContractState, RewardSpec } from '@/game/types';
import type { RunApi } from '@/game/types';
import type { PlayerId } from '@/core/types';
import { STRINGS } from './bounty_board.strings';

/** Slips on the board at once (GDD §11.9: three per Night). */
export const BOARD_SLOTS = 3;
/** Contracts one player may hold at the same time. */
export const MAX_ACTIVE = 3;

/** ContractDef text is inline; it is read from the strings file so the words live in one place. */
const txt = (id: string): ContractDef['strings'] => ({
  en: { title: STRINGS.en[`c.${id}.t`] ?? id, desc: STRINGS.en[`c.${id}.d`] ?? '' },
  tr: { title: STRINGS.tr[`c.${id}.t`] ?? id, desc: STRINGS.tr[`c.${id}.d`] ?? '' },
});

/** Ticket reward (coin and obol entries are zero so the record is complete). */
const tickets = (n: number): RewardSpec => ({ currencies: { coin: 0, obol: 0, ticket: n } });
const quota = (f: number): RewardSpec => ({ coins: { quotaFrac: f } });
type Where = NonNullable<ContractDef['goal']['where']>;
/** Goal filter for one machine: its id, an optional minimum win tier and optional tags. */
const machine = (machineId: string, minTier?: Where['minTier'], extra?: { tags?: string[] }): Where => ({
  machineId, ...(minTier ? { minTier } : {}), ...(extra?.tags ? { tags: extra.tags } : {}),
});

/** One contract def from the GDD table. `text` is looked up by id in the strings file (`c.<id>.t` / `c.<id>.d`). */
function def(id: string, goal: ContractDef['goal'], reward: RewardSpec, weight = 2): ContractDef {
  const s = txt(id);
  return { id, kind: 'bounty', goal, reward, scope: 'player', weight, strings: s };
}

/** The GDD §11.9 bounty catalogue, in table order. Ids are the GDD ids (`b_*`). */
export const BOUNTY_CATALOGUE: readonly ContractDef[] = [
  def('b_bj_streak', { on: 'machine:result', where: machine('blackjack', 'small'), count: 3, streak: true }, tickets(3), 3),
  def('b_cross', { on: 'machine:result', where: machine('bigone', 'medium'), count: 1 }, quota(0.1)),
  def('b_elevator5', { on: 'machine:result', where: machine('elevator', 'big'), count: 1 }, { ...quota(0.05), ...tickets(2) }),
  def('b_four_suits', { on: 'stat', where: { stat: 'suits.won.watch' }, count: 4 },
    { charm: { choose: 1, of: 1, rarity: 'uncommon' } }, 1),
  def('b_point', { on: 'machine:result', where: machine('craps', undefined, { tags: ['point'] }), count: 1 }, tickets(3)),
  def('b_mines8', { on: 'stat', where: { stat: 'mines.safe.round' }, count: 8 }, quota(0.05)),
  def('b_derby6', { on: 'machine:result', where: machine('derby', 'big'), count: 1 }, tickets(3)),
  def('b_holdem_2p', { on: 'machine:result', where: machine('holdem', undefined, { tags: ['two-pair+'] }), count: 1 }, quota(0.05)),
  def('b_devil2', { on: 'stat', where: { stat: 'devilstable.collect' }, count: 1 },
    { unlocks: ['pawn.rare_under_counter'] }, 1),
  def('b_early_half', { on: 'stat', where: { stat: 'deposit.before.watch2' }, count: 1 },
    { buffs: [{ id: 'bounty.early_interest' }] }, 1),
  def('b_two_punch', { on: 'stat', where: { stat: 'punch.cells.watch' }, count: 2 }, tickets(2)),
  def('b_claw', { on: 'machine:result', where: machine('claw'), count: 1 }, tickets(2)),
  def('b_bigwin', { on: 'machine:result', where: { minTier: 'mega' }, count: 1 }, quota(0.1), 1),
  def('b_ride5', { on: 'machine:result', where: machine('coinflip', 'small'), count: 5, streak: true }, tickets(4)),
  def('b_natural', { on: 'machine:result', where: machine('baccarat', undefined, { tags: ['natural'] }), count: 1 }, tickets(2)),
  def('b_milestone', { on: 'stat', where: { stat: 'upgrade.milestone' }, count: 1 }, tickets(3)),
  def('b_staff25', { on: 'stat', where: { stat: 'staff.share.pct' }, count: 25 }, quota(0.05)),
  def('b_bell_night', { on: 'machine:result', where: { minTier: 'big' }, count: 3 }, { totems: ['profit_bell'] }, 1),
];

export const bountyDef = (id: string): ContractDef | undefined => BOUNTY_CATALOGUE.find((d) => d.id === id);

/**
 * Registers the catalogue on the run when the game has not already done so (idempotent). Errors from an inert or
 * missing contracts API are swallowed: the board then simply shows what the game offers.
 */
export function ensureCatalogue(run: RunApi): void {
  let have: Set<string>;
  try { have = new Set(run.contracts.defs().map((d) => d.id)); } catch { return; }
  for (const d of BOUNTY_CATALOGUE) {
    if (have.has(d.id)) continue;
    try { run.contracts.register(d); } catch { /* the game owns the catalogue; keep the board readable */ }
  }
}

/** Board rows: the offered slips (up to BOARD_SLOTS), in offer order. */
export function boardSlips(run: RunApi): ContractState[] {
  return [...run.contracts.board()].slice(0, BOARD_SLOTS);
}

/** Active contracts of `pid` (their progress shows on the board's lower half). */
export function activeFor(run: RunApi, pid: PlayerId): ContractState[] {
  return [...run.contracts.active(pid)];
}

export type SignCheck = 'ok' | 'full' | 'gone' | 'notdone' | 'claimed';

/** May `pid` sign (accept) this offered slip? Checks the board and the per-player limit. */
export function canAccept(run: RunApi, pid: PlayerId, uid: string): SignCheck {
  const offered = run.contracts.board().find((c) => c.uid === uid);
  if (!offered) return 'gone';
  if (activeFor(run, pid).length >= MAX_ACTIVE) return 'full';
  return 'ok';
}

/** May `pid` cash (claim) this active slip? Only a finished one pays. */
export function canClaim(run: RunApi, pid: PlayerId, uid: string): SignCheck {
  const c = run.contracts.active(pid).find((x) => x.uid === uid);
  if (!c) return 'gone';
  if (c.status === 'claimed') return 'claimed';
  return c.status === 'done' ? 'ok' : 'notdone';
}

/** Ticket reward of a def, for the receipt line (0 when the reward is not Tickets). */
export function ticketReward(d: ContractDef | undefined): number {
  return d?.reward.currencies?.ticket ?? 0;
}

/** Progress as "2 / 3" text for the slip. Clamped to the goal. */
export function progressText(c: ContractState, goal: number): string {
  return `${Math.min(c.progress, goal)} / ${goal}`;
}
