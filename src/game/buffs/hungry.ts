/**
 * Hungry machines (charm `gluttons_bib`): at each Bell, while the Bib is held, one machine the player has played turns
 * Hungry (red bib decal). Its next play pays no winnings (a sub-stake return or a loss refund still settles). The buff is instance-scoped, so its `payout.mult` ×0 reaches only
 * that machine. It ends when that play's result settles (the payout was credited before `machine:result`) or at shift
 * end. The charm's `x.buff.hungry` hook is read here, so the Bib is live. Host only. The seeded rng is drawn only while
 * the Bib is held, so runs without it keep their random sequence.
 */
import type { InstanceId, MachineId, PlayerId } from '@/core/types';
import type { BuffDef, RunApi } from '@/game/types';
import type { Rng } from '@/core/rng';
import type { Buffs } from './engine';

export const HUNGRY_BUFF: BuffDef = {
  id: 'hungry', kind: 'debuff', scope: 'instance', icon: 'icon.skull', maxStacks: 1,
  duration: { kind: 'shift' }, reapply: 'refresh', tags: ['curse'],
  effects: [{ hook: 'payout.mult', op: 'mult', value: 0 }],
  strings: {
    en: { name: 'Hungry', desc: 'Its next play pays no winnings.' },
    tr: { name: 'Aç', desc: 'Sıradaki oyunu kazanç ödemez.' },
  },
};

export interface HungryHost {
  readonly selfId: PlayerId;
  readonly isHost: boolean;
  run(): RunApi;
  rng: Rng;
}

export class Hungry {
  /** Instances this run has settled a play on, with their machine id, in first-play order. */
  private readonly played = new Map<InstanceId, MachineId>();

  constructor(private readonly host: HungryHost, private readonly buffs: Buffs) {}

  /** A result settled on `mid` (its payout is already credited): that machine's Hungry state is spent. */
  onResult(mid: InstanceId, machineId: MachineId): void {
    if (!this.host.isHost) return;
    if (!this.played.has(mid)) this.played.set(mid, machineId);
    this.buffs.remove('hungry', { mid });
  }

  /** Host, at each Bell: while the Bib is held, one played machine turns Hungry. */
  onBell(): void {
    if (!this.host.isHost || this.played.size === 0) return;
    const entries = [...this.played];
    const held = this.host.run().mod('x.buff.hungry', entries[0][1], 0, { pid: this.host.selfId }) > 0;
    if (!held) return;
    const [mid] = this.host.rng.pick(entries);
    this.buffs.add('hungry', { mid });
  }
}
