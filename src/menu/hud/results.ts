/**
 * The Sump receipt (GDD §9.9): a thermal-paper run summary that prints line by line, then gets its stamp.
 * Pure DOM. `resultsState.ts` owns the overlay, keys and the app transitions.
 */
import { app } from '@/core/app';
import { fmtCoins, fmtNum, fmtTime, has, t } from '@/core/i18n';
import { counter, uiSfx, h } from '@/core/ui/widgets';
import type { RunSummary } from '@/net/protocol';
import { dailyLine } from '@/game/daily';
import './results.css';
import './resultsFit.css';

export interface ReceiptOpts {
  onAgain(): void;
  onMenu(): void;
  /** Opens the Foundations tree over the receipt (the results state draws it in the overlay). */
  onFoundations(): void;
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
/** The longest roll of a receipt figure (PEAK POCKET, PAID, BIGGEST), seconds. */
const ROLL_S = 0.9;
const resultKey = (r: string): string => (has(`hud.results.result.${r}`) ? `hud.results.result.${r}` : `hud.results.result.lost`);
const won = (r: RunSummary['result']): boolean => r === 'escaped' || r === 'won';

/**
 * Post-mortem for the receipt (wave 8 item 9). Optional on RunSummary (`post?: ResultsPost`, to be added in
 * net/protocol.ts). Each field is filled by the run at endRun; the line omits what is missing.
 *  - short: coins below the quota at the end (0 = quota met); pullsLeft: pulls unused at the end;
 *  - bestMachine: machine id of the biggest win; topCharm: charm id with the most procs.
 */
export interface ResultsPost { short: number; pullsLeft: number; bestMachine?: string | null; topCharm?: string | null }

/** Stake and daily tag the run adds to its summary (run.ts endRun). Not in RunSummary yet, so the receipt reads them through this. */
export interface RunTag { stake?: number; daily?: { date: string; night: number } }

/** Copies `text` to the clipboard. False when the browser refuses (the line stays selectable on the receipt). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

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
  // A run the Collector closed at home (`ending: 'shot'`, a fall) has its own receipt: the debt left, the Nights survived and the
  // biggest win. It is not the Sump's descent receipt.
  const shot = s.ending === 'shot';
  const root = h('div', 'rcp');
  const paper = h('div', 'rcp-paper', root);
  h('div', 'rcp-title', paper, t(shot ? 'hud.results.shot.title' : 'hud.results.title'));
  h('div', 'rcp-sub', paper, t(shot ? 'hud.results.shot.sub' : 'hud.results.sub'));
  h('div', 'rcp-rule', paper);

  const me = s.players[0];
  const name = me?.name?.trim() ? me.name.trim() : t('hud.results.you');
  const st: Record<string, number> = s.stats ?? {};
  const stat = (k: (typeof FIXED_STATS)[number]): number => (typeof st[k] === 'number' && Number.isFinite(st[k]) ? st[k] : 0);
  // The third cell of a row is the figure that rolls up from 0 as its line prints (PEAK POCKET, PAID, BIGGEST).
  const debt = Math.max(0, Math.round(s.post?.short ?? 0));
  const rows: Array<[string, string, number?]> = shot ? [
    [t('hud.results.name'), name],
    [t('hud.results.seed'), String(s.seed)],
    [t('hud.results.shot.debt'), fmtCoins(debt, true), debt],
    [t('hud.results.shot.nights'), fmtNum(stat('nightsPaid'))],
    [t('hud.results.stat.biggest'), fmtCoins(s.biggestWin, true), s.biggestWin],
    [t('hud.results.time'), fmtTime(s.durationSec)],
    [t('hud.results.stat.paid'), fmtCoins(stat('paid'), true), stat('paid')],
    [t('hud.results.stat.wagered'), fmtCoins(stat('wagered'), true)],
    [t('hud.results.stat.rounds'), fmtNum(s.rounds)],
  ] : [
    [t('hud.results.name'), name],
    [t('hud.results.seed'), String(s.seed)],
    [t('hud.results.result'), t(resultKey(s.result))],
    [t('hud.results.floor'), fmtNum(s.floor)],
    [t('hud.results.time'), fmtTime(s.durationSec)],
    [t('hud.results.maxWallet'), fmtCoins(s.maxWallet, true), s.maxWallet],
    [t('hud.results.deadlines'), fmtNum(s.deadlines)],
    [t('hud.results.stat.rounds'), fmtNum(s.rounds)],
    [t('hud.results.stat.wagered'), fmtCoins(stat('wagered'), true)],
    [t('hud.results.stat.paid'), fmtCoins(stat('paid'), true), stat('paid')],
    [t('hud.results.stat.biggest'), fmtCoins(s.biggestWin, true), s.biggestWin],
    [t('hud.results.stat.wins'), fmtNum(stat('wins'))],
    [t('hud.results.stat.nightsPaid'), fmtNum(stat('nightsPaid'))],
    ...statLines(s.stats),
  ];
  const tag = s as RunSummary & RunTag;
  if (tag.stake !== undefined && tag.stake > 0) rows.push([t('hud.results.stake'), String(tag.stake)]);
  if (s.obols !== undefined) rows.push([t('hud.results.obols'), `+${fmtNum(s.obols)}`]);
  const daily = tag.daily;
  const dailyText = daily ? dailyLine(daily.date, daily.night, s.obols ?? 0) : '';

  const body = h('div', 'rcp-body', paper);
  /** A rolled line's roll: starts when the line prints, or lands at once when the print is skipped. */
  const rolls = new Map<HTMLElement, (instant: boolean) => void>();
  const lines: HTMLElement[] = rows.map(([k, v, roll]) => {
    const row = h('div', 'rcp-line', body);
    h('span', 'k', row, k);
    if (roll === undefined) {
      h('span', 'v', row, v);
    } else {
      const cell = h('span', 'v', row);
      const c = counter(cell, { fmt: (n) => fmtCoins(Math.round(n), true), tickSfx: 'numberTick', maxDur: ROLL_S });
      rolls.set(row, (instant) => c.set(roll, instant ? { instant: true } : { dur: ROLL_S }));
    }
    return row;
  });
  // The debt line already says how far short the bank was: the Sump's post-mortem line is not printed on a Collector's receipt.
  const post = shot ? '' : postLine((s as RunSummary & { post?: ResultsPost }).post);
  if (post) {
    const row = h('div', 'rcp-line wide', body);
    h('span', 'k', row, post);
    h('span', 'v', row);
    lines.push(row);
  }
  if (dailyText) {
    // The copyable daily line: the player can also select it by hand.
    const row = h('div', 'rcp-line wide', body);
    h('span', 'k', row, dailyText);
    h('span', 'v', row);
    lines.push(row);
  }

  if (s.players.length > 1) {
    h('div', 'rcp-rule', body);
    const ranked = [...s.players].sort((a, b) => a.placement - b.placement);
    for (const p of ranked) {
      const row = h('div', 'rcp-line wide', body);
      h('span', 'k', row, `${t('hud.results.place')} ${p.placement}  ${p.name}`);
      h('span', 'v', row, fmtCoins(p.wallet, true));
      lines.push(row);
    }
  }

  const winner = won(s.result);
  const stampText = shot ? t('hud.results.shot.stamp') : winner ? t('hud.results.stamp') : t(resultKey(s.result));
  const stamp = h('div', `rcp-stamp ${winner ? 'good' : 'bad'}`, paper, stampText);
  stamp.hidden = true;
  const btns = h('div', 'rcp-btns', root);
  const again = h('button', 'rcp-btn', btns, t('hud.results.again'));
  const foundations = h('button', 'rcp-btn', btns, t('found.title'));
  const menu = h('button', 'rcp-btn', btns, t('hud.results.menu'));
  if (dailyText) {
    const copy = h('button', 'rcp-btn', btns, t('daily.copy'));
    copy.addEventListener('click', () => {
      void copyText(dailyText).then((ok) => { copy.textContent = t(ok ? 'daily.copied' : 'daily.copyFail'); });
    });
  }
  again.addEventListener('click', () => o.onAgain());
  foundations.addEventListener('click', () => o.onFoundations());
  menu.addEventListener('click', () => o.onMenu());
  h('div', 'rcp-hint', root, t('hud.results.hint'));

  let skip = false;
  let done = false;
  const wait = (ms: number): Promise<void> => new Promise((res) => window.setTimeout(res, ms));

  async function print(): Promise<void> {
    if (done) return;
    // A throw while a line prints (a roll, a click sound) must not leave the receipt half-printed with no stamp.
    try {
      for (const ln of lines) {
        if (skip) { lines.forEach((l) => { l.classList.add('on'); rolls.get(l)?.(true); }); break; }
        ln.classList.add('on');
        try { rolls.get(ln)?.(false); } catch { /* a roll that fails leaves its figure as the plain line */ }
        try { uiSfx('click', 0.3); } catch { /* the click is optional */ }
        await wait(LINE_S * 1000);
      }
    } finally {
      lines.forEach((l) => l.classList.add('on'));
    }
    done = true;
    stamp.hidden = false;
    stamp.classList.add('thud');
    // The stamp is the result: a win flashes gold and plays the win stinger; a loss plays the lose sound under its red stamp.
    if (winner) {
      if (!app.save?.data?.settings?.calm) { try { app.fx.flash(0xffd34a, 0.3, 0.4); } catch { /* the flash is optional */ } }
      try { app.audio.music.stinger('bigWin', { vol: 0.7 }); } catch { /* the stinger is optional */ }
    } else {
      uiSfx('lose', 0.8);
    }
  }

  return {
    el: root,
    print,
    finish() { skip = true; },
    dispose() { root.remove(); },
  };
}

