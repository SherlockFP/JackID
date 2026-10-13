/**
 * Free Casino sandbox (GDD §7.4, single player part): no quota, no clock, no Dawn. Pulls are unlimited and the wallet
 * is a generous credit so every machine can be tried.
 */
import type { ModeRules } from './types';

export const FREE_RULES: ModeRules = {
  id: 'free',
  quota: false,
  timed: false,
  nights: Infinity,
  unlimitedPulls: true,
  startWallet: 10_000,
  startTickets: 0,
  startPegs: 9,
};
