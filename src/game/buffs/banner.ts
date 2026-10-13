/**
 * Event banners (BRIEF ADDENDUM 3/5). DOM-free by design (TECH_SPEC §9.2: DOM lives in core/ui): this file turns
 * `event:start` / `event:end` into banner requests and hands them to a `show` callback, which the run wires to the
 * UI layer (`ui.banner(text, opts)` from core/ui). Text is i18n: `event.<id>.announce`, `buff.banner.ended`.
 */
import type { Unsub } from '@/core/types';
import type { NightEventDef } from '@/game/types';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';

/** Mirrors core/ui `BannerOpts` (kept structural so this file does not import the UI). */
export interface EventBannerOpts { color?: string; hold?: number; size?: 8 | 16 | 24 }
export type EventBannerShow = (text: string, o: EventBannerOpts) => void;

const DEFAULT_COLOR = '#ffd060';
const HOLD_S = 3.5;
const ENDED_HOLD_S = 2;
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Subscribes to the bus and forwards event banners to `show`. Returns the teardown. */
export function bridgeEventBanners(lookup: (id: string) => NightEventDef | undefined, show: EventBannerShow): Unsub {
  const offStart = bus.on('event:start', ({ id }) => {
    const color = lookup(id)?.world?.lightColor;
    show(t(`event.${id}.announce`), { color: color !== undefined ? hex(color) : DEFAULT_COLOR, hold: HOLD_S, size: 16 });
  });
  const offEnd = bus.on('event:end', ({ id }) => {
    show(t('buff.banner.ended', { name: t(`event.${id}.name`) }), { color: '#9a9a9a', hold: ENDED_HOLD_S, size: 8 });
  });
  return () => { offStart(); offEnd(); };
}
