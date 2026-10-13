/**
 * Bench debug panel (base-machines WP) for `/?bench=<id>` — TECH_SPEC §10.4. Opened by `Bench` through
 * {@link openBenchPanel}; the panel's sections are
 *
 *  stats    renderer calls / tris / textures / programs / CPU ms, fps and frame ms (sampled every 0.25 s)
 *  wallet   reset to 10 000 or +1 000, round stats and RTP from `BenchRun`
 *  machine  seed (reseeds every RNG stream), rebuild ×1 / ×10 leak check, force outcome (`debugForce`),
 *           snapshot round-trip, mirror peer (late-join view), bot seat (tables)
 *  mods     luck and payout sliders plus one field per `def.modHooks` key (charm test values, add-op)
 *  sim      headless Sim: 100 000 rounds through `def.headless` with the CURRENT modifiers (wallet untouched)
 *  view     PSX pipeline toggle
 *
 * The panel is a plain element appended to the UI overlay root, NOT a `ui.panel`: registered panels make the
 * UI blocking (input mode 'ui'), which would stop the player walking while tuning the machine. Developer tool:
 * labels are English and every literal line carries `i18n-ok` (exempt from the literal scan).
 */
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import type { ModEffect, ModHook } from '@/game/types';
import { simulate } from '@/game/benchRun';
import type { Bench } from './bench';

const PANEL_CSS = [
  'position:absolute', 'right:12px', 'top:12px', 'width:300px', 'max-height:calc(100vh - 24px)', 'overflow:auto',
  'pointer-events:auto', 'background:rgba(10,8,16,.9)', 'color:#e9e1cf', 'border:1px solid #8c6b29', 'padding:8px 10px',
  'font:12px/1.4 monospace', 'z-index:50', 'box-sizing:border-box',
].join(';');
const H_CSS = 'margin:9px 0 3px;color:#e0b84a;font-weight:bold;letter-spacing:.06em';
const BTN_CSS = 'font:inherit;color:inherit;background:#2a2236;border:1px solid #6a5a3a;padding:1px 6px;cursor:pointer';
const IN_CSS = 'font:inherit;color:inherit;background:#15111d;border:1px solid #4a3e2a;padding:1px 4px;width:64px';
const OUT_CSS = 'color:#7dff7a;white-space:pre-wrap;margin:2px 0;min-height:1em';
const SIM_ROUNDS = 100_000;

type Kid = Node | string | false | null | undefined;
function make<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (css) n.style.cssText = css;
  for (const k of kids) if (k !== false && k !== null && k !== undefined) n.append(k);
  return n;
}
const txt = (s: string, css = ''): HTMLSpanElement => make('span', css, s);
const row = (...kids: Kid[]): HTMLDivElement => make('div', 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:3px 0', ...kids);
const head = (s: string): HTMLDivElement => make('div', H_CSS, s);
function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = make('button', BTN_CSS, label);
  b.addEventListener('click', onClick);
  return b;
}
function input(type: string, value: string, css = IN_CSS): HTMLInputElement {
  const i = make('input', css);
  i.type = type;
  i.value = value;
  return i;
}

/** Opens the panel for `bench`; returns the close function (also called by `Bench.dispose`). */
export function openBenchPanel(bench: Bench): () => void {
  const unsub: Array<() => void> = [];
  const { run, def } = bench;
  const out = (s: string): HTMLDivElement => make('div', OUT_CSS, s);

  // ── stats ──
  const statsEl = make('div', 'white-space:pre;color:#c9c0ad', '');
  let acc = 0, frames = 0;
  unsub.push(bench.onFrame((dt) => {
    acc += dt; frames++;
    if (acc < 0.25) return;
    const info = app.renderer.info();
    statsEl.textContent =
      `calls ${info.calls}  tris ${info.tris}\n` +                                          // i18n-ok
      `tex ${info.textures}  geo ${info.geometries}  prog ${info.programs}\n` +              // i18n-ok
      `cpu ${info.cpuMs.toFixed(2)} ms  frame ${((acc / frames) * 1000).toFixed(1)} ms  fps ${(frames / acc).toFixed(0)}`; // i18n-ok
    acc = 0; frames = 0;
  }));

  // ── wallet & round stats ──
  const walletEl = txt('');
  const statEl = make('div', 'white-space:pre;color:#c9c0ad', '');
  const refreshWallet = (): void => {
    walletEl.textContent = `wallet ${run.wallet().toLocaleString('en-US')}`;   // i18n-ok
    const s = run.stats;
    statEl.textContent =
      `rounds ${s.rounds}  wins ${s.wins}  biggest ${s.biggest}\n` +                        // i18n-ok
      `wagered ${s.wagered}  paid ${s.paid}  RTP ${(run.rtp() * 100).toFixed(1)} %`;       // i18n-ok
  };
  unsub.push(run.onChange(refreshWallet));
  refreshWallet();

  // ── machine ──
  const seedIn = input('number', String(bench.seed), 'font:inherit;color:inherit;background:#15111d;border:1px solid #4a3e2a;padding:1px 4px;width:90px');
  const rebuildOut = out('');
  const forceSel = make('select', IN_CSS);
  for (const v of ['random', 'win', 'loss', 'near']) {
    const o = make('option', '', v);
    o.value = v;
    forceSel.append(o);
  }
  const forceOut = out('');
  const snapOut = out('');
  const mirrorChk = input('checkbox', '');
  mirrorChk.checked = bench.mirror !== null;
  mirrorChk.addEventListener('change', () => bench.setMirror(mirrorChk.checked));

  const machineRows: Kid[] = [
    row(txt('seed'), seedIn, btn('apply', () => bench.reseed(Number(seedIn.value) >>> 0))),
    row(
      btn('rebuild', () => { bench.rebuild(); rebuildOut.textContent = 'rebuilt'; }),        // i18n-ok
      btn('rebuild ×10', () => {                                                              // i18n-ok
        const r = bench.rebuildStress(10);
        rebuildOut.textContent = `${r.ok ? 'OK' : 'LEAK'}: +${r.geometries} geometries, +${r.textures} textures`; // i18n-ok
      }),
    ),
    rebuildOut,
    row(
      txt('force'),                                                                          // i18n-ok
      forceSel,
      btn('apply', () => {                                                                   // i18n-ok
        const m = bench.main?.m;
        if (!m?.debugForce) { forceOut.textContent = 'not supported by this machine'; return; } // i18n-ok
        m.debugForce(forceSel.value);
        forceOut.textContent = `next outcome: ${forceSel.value}`;                            // i18n-ok
      }),
    ),
    forceOut,
    row(btn('snapshot round-trip', () => {                                                   // i18n-ok
      const r = bench.snapshotRoundTrip();
      snapOut.textContent = r.ok ? `round-trip OK (${r.bytes} bytes)` : 'MISMATCH';          // i18n-ok
    })),
    snapOut,
    row(txt('mirror peer'), mirrorChk),                                                      // i18n-ok
    def.seats > 1 ? row(btn('add bot', () => bench.addBot())) : false,                       // i18n-ok
  ];

  // ── modifiers ──
  const setEff = (key: string, e: ModEffect | null): void => run.setEffect(key, e);
  const luckIn = input('range', '0');
  luckIn.min = '-30'; luckIn.max = '30'; luckIn.step = '1';
  luckIn.style.width = '150px';
  const luckOut = txt('0');
  luckIn.addEventListener('input', () => {
    const v = Number(luckIn.value);
    luckOut.textContent = String(v);
    setEff('luck', v ? { hook: 'luck' as ModHook, op: 'add', value: v } : null);
  });
  const payIn = input('range', '1');
  payIn.min = '0.5'; payIn.max = '2'; payIn.step = '0.05';
  payIn.style.width = '150px';
  const payOut = txt('×1.00');
  payIn.addEventListener('input', () => {
    const v = Number(payIn.value);
    payOut.textContent = `×${v.toFixed(2)}`;                                                  // i18n-ok
    setEff('payout', Math.abs(v - 1) < 1e-9 ? null : { hook: 'payout.mult' as ModHook, op: 'mult', value: v });
  });
  const hookRows = Object.entries(def.modHooks ?? {}).map(([hook, desc]) => {
    const f = input('number', '0', 'font:inherit;color:inherit;background:#15111d;border:1px solid #4a3e2a;padding:1px 4px;width:56px');
    f.step = '0.01';
    f.addEventListener('change', () => {
      const v = Number(f.value);
      setEff(`hook:${hook}`, v ? { hook: hook as ModHook, op: 'add', value: v } : null);
    });
    return make('div', 'margin:2px 0', row(txt(hook, 'color:#9fd8ff'), f), make('div', 'color:#8a8170;font-size:11px', desc));
  });
  const modRows: Kid[] = [
    row(txt('luck'), luckIn, luckOut),
    row(txt('payout'), payIn, payOut),
    ...(hookRows.length ? [txt('machine hooks (add):', 'color:#8a8170')] : []),
    ...hookRows,
  ];

  // ── headless sim ──
  const simOut = out('');
  const simRow = row(btn(`sim ${SIM_ROUNDS.toLocaleString('en-US')} rounds`, () => {         // i18n-ok
    const t0 = performance.now();
    const r = simulate(run, def.id, SIM_ROUNDS, def.minBet, bench.seed);
    const ms = performance.now() - t0;
    simOut.textContent = r
      ? `RTP ${(r.rtp * 100).toFixed(2)} %  hit ${(r.hitRate * 100).toFixed(1)} %  biggest ${r.biggest}\n` + // i18n-ok
        `wagered ${r.wagered}  paid ${r.paid}  ${ms.toFixed(0)} ms`                         // i18n-ok
      : 'no headless play for this machine';                                                  // i18n-ok
  }));

  // ── view ──
  const psxChk = input('checkbox', '');
  psxChk.checked = app.renderer.settings.enabled;
  psxChk.addEventListener('change', () => app.renderer.apply({ enabled: psxChk.checked }));

  // ── assemble ──
  const close = make('div', 'text-align:right', btn('close', () => close_()));                // i18n-ok
  const root = make('div', PANEL_CSS,
    make('div', 'color:#e0b84a;font-weight:bold', `BENCH · ${def.id} · ${t(`m.${def.id}.name`)}`),   // i18n-ok
    make('div', 'color:#8a8170;font-size:11px', `slot ${def.slotSize} · zone ${def.zone} · wallet 10 000`), // i18n-ok
    head('STATS'), statsEl,                                  // i18n-ok
    head('WALLET'), row(walletEl, btn('reset', () => run.setWallet(10_000)), btn('+1000', () => run.setWallet(run.wallet() + 1_000))), // i18n-ok
    statEl,
    head('MACHINE'), ...machineRows,                         // i18n-ok
    head('MODIFIERS'), ...modRows,                           // i18n-ok
    head('SIM'), simRow, simOut,                             // i18n-ok
    head('VIEW'), row(txt('PSX pipeline'), psxChk),                                            // i18n-ok
    close,
  );
  const close_ = (): void => {
    for (const u of unsub.splice(0)) u();
    root.remove();
  };
  app.ui.root.append(root);
  return close_;
}
