/**
 * URL parameters read once at startup (TD-owned). Contract: TECH_SPEC §1.3 step 10, §10.4, BRIEF ADDENDUM 1
 * (invite links). Anyone may import `bootParams`; nobody mutates it.
 *
 *  ?bench=<machineId>   single-machine test room         ?seed=<n>      force the run seed
 *  ?room=<CODE>|?join=  deep-link: join this room        ?net=<kind>    force transport: tab | relay | webrtc | p2p
 *  ?debug=1             dev overlay/console              ?skipmenu=1    straight into a Debt Run
 *  ?lang=tr|en          language override
 */
import type { Lang, MachineId } from './types';

export interface BootParams {
  bench?: MachineId;
  room?: string;
  seed?: number;
  net?: 'tab' | 'relay' | 'webrtc' | 'p2p';
  debug: boolean;
  skipMenu: boolean;
  lang?: Lang;
}

export function parseBootParams(search: string): BootParams {
  const q = new URLSearchParams(search);
  const seed = q.get('seed');
  const net = q.get('net');
  const lang = q.get('lang');
  const room = (q.get('room') ?? q.get('join') ?? '').trim().toUpperCase();
  const bench = q.get('bench')?.trim();
  return {
    bench: bench && /^[a-z][a-z0-9_]*$/.test(bench) ? bench : undefined,
    room: /^[A-Z0-9]{4,8}$/.test(room) ? room : undefined,
    seed: seed !== null && /^\d+$/.test(seed) ? Number(seed) >>> 0 : undefined,
    net: net === 'tab' || net === 'relay' || net === 'webrtc' || net === 'p2p' ? net : undefined,
    debug: q.get('debug') === '1',
    skipMenu: q.get('skipmenu') === '1',
    lang: lang === 'tr' || lang === 'en' ? lang : undefined,
  };
}

export const bootParams: BootParams = parseBootParams(typeof location !== 'undefined' ? location.search : '');
