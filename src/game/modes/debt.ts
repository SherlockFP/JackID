/**
 * Debt Run, single player (GDD §2, §7.1): eight printed Nights, then Overdrawn (endless). Kit "Pauper", House Edge 0.
 */
import type { ModeRules } from './types';
import { START } from '@/game/data/schedule';

export const DEBT_RULES: ModeRules = {
  id: 'debt',
  quota: true,
  timed: true,
  nights: Infinity,
  unlimitedPulls: false,
  startWallet: START.pocket,
  startTickets: START.tickets,
  startPegs: START.pegs,
};
