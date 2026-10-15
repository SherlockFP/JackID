/**
 * Keno lamp bank moved to the shared kit (`@/kit/lamps`) so bigone and keno both import it from kit, not from another
 * machine folder (TECH_SPEC 1.1 rule 3). Re-exported here so keno's existing imports keep working.
 */
export { buildLampBank } from '@/kit/lamps';
export type { LampSpec, GlowSpec, LampBank } from '@/kit/lamps';
