/**
 * MACHINE OF THE NIGHT (wave 55, mid-Night variety). At the Night's open one floor machine is the SPOTLIGHT: it pays x1.25
 * (its own `payout.mult` source, scoped to that machine kind) and every 5th play on it in the Night awards +1 Ticket.
 *
 * The pick is a seeded draw (`hashSeed('spotlight', seed, night)`) over the eligible open machine kinds, never the machine that
 * was the spotlight last Night. Pure except for the provider's state: `begin` / `round` / `end` are the run's calls, and every
 * change is announced on the bus as `spotlight:change` (the world's gold beam and the HUD chip listen; payload null = none).
 */
import { bus } from '@/core/events';
import { lang, registerStrings, t } from '@/core/i18n';
import { createRng, hashSeed } from '@/core/rng';
import type { InstanceId, MachineId } from '@/core/types';
import type { ModProvider, ModQuery, ModSource, ModSourceKind } from '@/game/types';
import { SPOTLIGHT_MULT, SPOTLIGHT_TICKET_EVERY, SPOTLIGHT_TICKETS } from './data/schedule';
import spotlightStrings from './spotlight.strings';

registerStrings(spotlightStrings.prefix, { en: spotlightStrings.en, tr: spotlightStrings.tr });

declare module '@/core/events' {
  interface GameEvents {
    'spotlight:change': SpotlightView | null;
  }
}

/** One floor machine a Night may spotlight: its kind and the instance the player can walk to. */
export interface SpotlightCandidate { machineId: MachineId; instance: InstanceId }

/** The spotlight as the world and the HUD read it. `progress` is plays toward the next Ticket (0..4); `ticket` is true on the play that paid one. */
export interface SpotlightView {
  /** Printed Night (1-based). */
  night: number;
  machineId: MachineId;
  /** Floor instances of that kind (the beam lights these). */
  instances: InstanceId[];
  /** Plays on the spotlight machine this Night. */
  plays: number;
  progress: number;
  ticket: boolean;
}

/** The Night's spotlight state (the provider's own; the views are copies of it). */
export interface SpotlightState { night: number; machineId: MachineId; instances: InstanceId[]; plays: number }

/** The run's save entry for the spotlight. */
export interface SpotlightSave { cur: SpotlightState | null; last: MachineId | null }

/** Machines that can never be the spotlight: the machine room's system devices, party machines and the duel tables behind doors. */
export function isSpotlightEligible(machineId: MachineId, category: string | undefined): boolean {
  if (category === undefined || category === 'system' || category === 'party') return false;
  return machineId !== 'lordstable' && machineId !== 'tallytable';
}

/**
 * The seeded pick for `night` (0-based) over the given machine kinds. Pure: the same seed, Night and kinds always give the same
 * machine. Never `last` when another kind is open. Null when there is nothing to pick.
 */
export function spotlightPick(seed: number, night: number, machineIds: readonly MachineId[], last: MachineId | null = null): MachineId | null {
  const uniq = [...new Set(machineIds)].sort();
  const pool = uniq.length > 1 && last !== null ? uniq.filter((id) => id !== last) : uniq;
  if (pool.length === 0) return null;
  return createRng(hashSeed('spotlight', seed, night)).pick(pool);
}

/**
 * The HUD chip line: "SPOTLIGHT: Big One ×1.25 · 3 plays to a Ticket" (TR "SPOT: Big One ×1,25 · Bilete 3 oyun").
 * `left` = plays still to go to the next Ticket (every - progress). `name` is the machine's display name.
 */
export function spotlightChip(v: SpotlightView, name: string): string {
  const left = SPOTLIGHT_TICKET_EVERY - v.progress;
  return t('spotlight.chip', { name, mult: spotlightMultText(), left, n: left });
}

/** The Night-open banner: "SPOTLIGHT: Big One ×1.25 pays, a Ticket every 5th play". */
export function spotlightStartLine(v: SpotlightView, name: string): string {
  return t('spotlight.start', { name, mult: spotlightMultText(), every: SPOTLIGHT_TICKET_EVERY });
}

/** The Ticket callout line for a paid spotlight Ticket. */
export function spotlightTicketLine(tickets: number = SPOTLIGHT_TICKETS): string {
  return t('spotlight.ticket', { tickets });
}

/** The multiplier as printed: "×1.25" in English, "×1,25" in Turkish. */
function spotlightMultText(): string {
  const m = SPOTLIGHT_MULT.toFixed(2);
  return `×${lang() === 'tr' ? m.replace('.', ',') : m}`;
}

export class Spotlight implements ModProvider {
  readonly kind: ModSourceKind = 'event';
  private cur: SpotlightState | null = null;
  /** The machine kind spotlit last Night (the next pick avoids it). */
  private last: MachineId | null = null;

  constructor(
    private readonly seed: number,
    private readonly touch: () => void,
  ) {}

  /**
   * Night open: picks this Night's spotlight among the candidates (instances of the eligible kinds on the floor) and announces it.
   * Returns the view, or null when no machine is open (then nothing is spotlit).
   */
  begin(night: number, candidates: readonly SpotlightCandidate[]): SpotlightView | null {
    const pick = spotlightPick(this.seed, night, candidates.map((c) => c.machineId), this.last);
    this.cur = null;
    if (pick !== null) {
      this.last = pick;
      this.cur = {
        night: night + 1,
        machineId: pick,
        instances: candidates.filter((c) => c.machineId === pick).map((c) => c.instance),
        plays: 0,
      };
    }
    this.touch();
    const v = this.current();
    bus.emit('spotlight:change', v);
    return v;
  }

  /**
   * One counted play (a new round) on a machine: when it is the spotlight, counts it and returns the Tickets it pays (0 or
   * SPOTLIGHT_TICKETS on every SPOTLIGHT_TICKET_EVERY-th play). The caller credits them.
   */
  round(machineId: MachineId): number {
    const c = this.cur;
    if (!c || c.machineId !== machineId) return 0;
    c.plays += 1;
    const ticket = c.plays % SPOTLIGHT_TICKET_EVERY === 0;
    bus.emit('spotlight:change', this.view(ticket));
    return ticket ? SPOTLIGHT_TICKETS : 0;
  }

  /** The Night is over (the Dawn): the spotlight, its multiplier and its beam end. */
  end(): void {
    if (!this.cur) return;
    this.cur = null;
    this.touch();
    bus.emit('spotlight:change', null);
  }

  /** The spotlight in force, or null. */
  current(): SpotlightView | null { return this.view(false); }

  /** Provider: the spotlight machine's own x1.25 `payout.mult`, scoped to that kind, while the Night runs. */
  collect(_q: ModQuery, out: ModSource[]): void {
    const c = this.cur;
    if (!c) return;
    out.push({
      kind: 'event',
      id: `spotlight:${c.machineId}`,
      owner: 0,
      effects: [{ hook: 'payout.mult', op: 'mult', value: SPOTLIGHT_MULT, scope: { machines: [c.machineId] }, label: 'spotlight.payout' }],
    });
  }

  /** Save shape: the Night's spotlight (or null) and the kind spotlit last Night. A reload keeps the spotlight and its count. */
  snapshot(): SpotlightSave | null {
    if (!this.cur && this.last === null) return null;
    const c = this.cur;
    return { cur: c ? { ...c, instances: [...c.instances] } : null, last: this.last };
  }

  restore(s: SpotlightSave | null | undefined): void {
    this.cur = null;
    this.last = null;
    if (!s || typeof s !== 'object') return;
    if (typeof s.last === 'string') this.last = s.last;
    const c = s.cur;
    if (c && typeof c.machineId === 'string' && c.machineId !== '' && Number.isFinite(c.night) && c.night > 0) {
      this.cur = {
        night: c.night,
        machineId: c.machineId,
        instances: Array.isArray(c.instances) ? c.instances.filter((i): i is InstanceId => typeof i === 'string') : [],
        plays: Number.isFinite(c.plays) ? Math.max(0, Math.floor(c.plays)) : 0,
      };
    }
    this.touch();
  }

  private view(ticket: boolean): SpotlightView | null {
    const c = this.cur;
    if (!c) return null;
    return {
      night: c.night,
      machineId: c.machineId,
      instances: [...c.instances],
      plays: c.plays,
      progress: c.plays % SPOTLIGHT_TICKET_EVERY,
      ticket,
    };
  }
}
