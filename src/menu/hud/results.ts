/**
 * The Sump receipt (GDD §9.9): a thermal-paper run summary that prints line by line, then gets its stamp.
 * Pure DOM. `resultsState.ts` owns the overlay, keys and the app transitions.
 */
import { fmtCoins, fmtNum, fmtTime, has, t } from '@/core/i18n';
import { uiSfx, h } from '@/core/ui/widgets';
import type { RunSummary } from '@/net/protocol';
import './results.css';

export interface ReceiptOpts {
  onAgain(): void;
  onMenu(): void;
}
export interface Receipt {
  readonly el: HTMLElement;
  /** Prints every line (0.12 s each), then stamps. Resolves when the stamp lands. Safe to call once. */
  print(): Promise<void>;
  /** Skips the print animation (Space / click while printing). */
  finish(): void;
  dispose(): void;
}

const LINE_S = 0.12;
const resultKey = (r: string): string => (has(`hud.results.result.${r}`) ? `hud.results.result.${r}` : `hud.results.result.lost`);
const won = (r: RunSummary['result']): boolean => r === 'escaped' || r === 'won';

/**
 * Post-mortem for the receipt (wave 8 item 9). Optional on RunSummary (`post?: ResultsPost`, to be added in
 * net/protocol.ts). Each field is filled by the run at endRun; the line omits what is missing.
 *  - short: coins below the quota at the end (0 = quota met); pullsLeft: pulls unused at the end;
 *  - bestMachine: machine id of the biggest win; topCharm: charm id with the most procs.
 */
export interface ResultsPost { short: number; pullsLeft: number; bestMachine?: string | null; topCharm?: string | null }

const machineLabel = (id: string): string => (has(`m.${id}.name`) ? t(`m.${id}.name`) : id);
const charmLabel = (id: string): string => (has(`charm.${id}.name`) ? t(`charm.${id}.name`) : id);

/** "You were 120 short · 3 pulls unused · best machine Bandit · top charm Lucky Coin" (segments with no data are dropped). */
export function postLine(p: ResultsPost | undefined): string {
  if (!p) return '';
  const parts: string[] = [
    p.short > 0 ? t('hud.results.post.short', { x: fmtCoins(p.short, true) }) : t('hud.results.post.met'),
    p.pullsLeft === 1 ? t('hud.results.post.pull1') : t('hud.results.post.pulls', { n: fmtNum(p.pullsLeft) }),
  ];
  if (p.bestMachine) parts.push(t('hud.results.post.best', { name: machineLabel(p.bestMachine) }));
  if (p.topCharm) parts.push(t('hud.results.post.top', { name: charmLabel(p.topCharm) }));
  return parts.join(' · ');
}

/** Stat keys the receipt prints as fixed rows (in this order), so the generic list below skips them. */
const FIXED_STATS = ['rounds', 'wagered', 'paid', 'biggest', 'wins', 'nightsPaid'] as const;

/** Any other stat the run reports (non-zero, capped); unknown keys print verbatim. */
function statLines(stats: Record<string, number> | undefined): Array<[string, string]> {
  if (!stats) return [];
  return Object.entries(stats)
    .filter(([k, v]) => !(FIXED_STATS as readonly string[]).includes(k) && typeof v === 'number' && Number.isFinite(v) && v !== 0)
    .slice(0, 4)
    .map(([k, v]) => [has(`hud.results.stat.${k}`) ? t(`hud.results.stat.${k}`) : k, fmtNum(v)]);
}

export function buildReceipt(s: RunSummary, o: ReceiptOpts): Receipt {
  const root = h('div', 'rcp');
  const paper = h('div', 'rcp-paper', root);
  h('div', 'rcp-title', paper, t('hud.results.title'));
  h('div', 'rcp-sub', paper, t('hud.results.sub'));
  h('div', 'rcp-rule', paper);

  const me = s.players[0];
  const name = me?.name?.trim() ? me.name.trim() : t('hud.results.you');
  const st: Record<string, number> = s.stats ?? {};
  const stat = (k: (typeof FIXED_STATS)[number]): number => (typeof st[k] === 'number' && Number.isFinite(st[k]) ? st[k] : 0);
  const rows: Array<[string, string]> = [
    [t('hud.results.name'), name],
    [t('hud.results.seed'), String(s.seed)],
    [t('hud.results.result'), t(resultKey(s.result))],
    [t('hud.results.floor'), fmtNum(s.floor)],
    [t('hud.results.time'), fmtTime(s.durationSec)],
    [t('hud.results.maxWallet'), fmtCoins(s.maxWallet, true)],
    [t('hud.results.deadlines'), fmtNum(s.deadlines)],
    [t('hud.results.stat.rounds'), fmtNum(s.rounds)],
    [t('hud.results.stat.wagered'), fmtCoins(stat('wagered'), true)],
    [t('hud.results.stat.paid'), fmtCoins(stat('paid'), true)],
    [t('hud.results.stat.biggest'), fmtCoins(s.biggestWin, true)],
    [t('hud.results.stat.wins'), fmtNum(stat('wins'))],
    [t('hud.results.stat.nightsPaid'), fmtNum(stat('nightsPaid'))],
    ...statLines(s.stats),
  ];
  if (s.obols !== undefined) rows.push([t('hud.results.obols'), `+${fmtNum(s.obols)}`]);

  const body = h('div', 'rcp-body', paper);
  const lines: HTMLElement[] = rows.map(([k, v]) => {
    const row = h('div', 'rcp-line', body);
    h('span', 'k', row, k);
    h('span', 'v', row, v);
    return row;
  });
  const post = postLine((s as RunSummary & { post?: ResultsPost }).post);
  if (post) {
    const row = h('div', 'rcp-line', body);
    h('span', 'k', row, post);
    h('span', 'v', row);
    lines.push(row);
  }

  if (s.players.length > 1) {
    h('div', 'rcp-rule', body);
    const ranked = [...s.players].sort((a, b) => a.placement - b.placement);
    for (const p of ranked) {
      const row = h('div', 'rcp-line', body);
      h('span', 'k', row, `${t('hud.results.place')} ${p.placement}  ${p.name}`);
      h('span', 'v', row, fmtCoins(p.wallet, true));
      lines.push(row);
    }
  }

  const stamp = h('div', `rcp-stamp${won(s.result) ? ' good' : ''}`, paper, won(s.result) ? t('hud.results.stamp') : t(resultKey(s.result)));
  stamp.hidden = true;
  const btns = h('div', 'rcp-btns', root);
  const again = h('button', 'rcp-btn', btns, t('hud.results.again'));
  const menu = h('button', 'rcp-btn', btns, t('hud.results.menu'));
  again.addEventListener('click', () => o.onAgain());
  menu.addEventListener('click', () => o.onMenu());
  h('div', 'rcp-hint', root, t('hud.results.hint'));

  let skip = false;
  let done = false;
  const wait = (ms: number): Promise<void> => new Promise((res) => window.setTimeout(res, ms));

  async function print(): Promise<void> {
    if (done) return;
    for (const ln of lines) {
      if (skip) { lines.forEach((l) => l.classList.add('on')); break; }
      ln.classList.add('on');
      uiSfx('click', 0.3);
      await wait(LINE_S * 1000);
    }
    done = true;
    stamp.hidden = false;
    stamp.classList.add('thud');
    uiSfx('quotaTick', 1);
  }

  return {
    el: root,
    print,
    finish() { skip = true; },
    dispose() { root.remove(); },
  };
}

