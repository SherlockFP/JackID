/**
 * THE HOME COMPUTER UI (wave 77): the old CRT PC on the apartment desk. The world emits `home:interact` with station 'computer'
 * (the food lane adds the station); in the Evening this opens a modal green-phosphor screen with three tabs: HOME (the run goal:
 * the debt left to the House and what paying it buys back, the ventures' income and the Collector's freeze warning),
 * INVESTMENTS (buy and sell ventures) and MARKET (food for the fridge, the deadbolt, the photo frame, reroll slips).
 *
 * Keys: 1 / 2 / 3 switch tabs, Esc closes. Every rule lives in src/game/economy (`run.homeEconomy()`); this file only draws and
 * forwards clicks. The panel closes itself when the Evening ends. `mountComputerUi(run)` returns the disposer (the run calls it).
 */
import './computer.css';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { addTicker, h, modalPanel, uiSfx } from '@/core/ui/widgets';
import type { DebtRun } from '@/game/run';
import type { HomeEconomy, TradeResult } from '@/game/economy/homeEconomy';

const PANEL = 'home-pc';
type Tab = 'home' | 'invest' | 'market';
const TABS: readonly Tab[] = ['home', 'invest', 'market'];

export function mountComputerUi(run: DebtRun): () => void {
  let alive = true;
  let open = false;
  let tab: Tab = 'home';
  let status = '';
  let screen: HTMLElement | null = null;

  const econ = (): HomeEconomy | null => run.homeEconomy();

  const close = (): void => {
    if (!open) return;
    open = false;
    screen = null;
    app.ui.closePanel(PANEL);
  };

  const say = (r: TradeResult, sold?: number): void => {
    status = r === 'ok' && sold !== undefined ? t('pc.res.sold', { n: sold }) : t(`pc.res.${r}`);
    uiSfx(r === 'ok' ? 'purchase' : 'buzzer', r === 'ok' ? 0.6 : 0.4);
    draw();
  };

  const line = (parent: HTMLElement, cls: string, text: string): HTMLElement => h('div', `pc-line ${cls}`, parent, text);

  const drawHome = (body: HTMLElement, e: HomeEconomy): void => {
    const g = e.goal();
    const box = h('div', 'pc-goal', body);
    h('div', 'pc-goal-title', box, t('pc.goal.title'));
    h('div', 'pc-goal-big', box, g.left > 0 ? t('pc.goal.left', { n: g.left, k: g.nights - g.nightsPaid }) : t('pc.goal.done'));
    const bar = h('div', 'pc-bar', box);
    const fill = h('div', 'pc-bar-fill', bar);
    fill.style.width = `${Math.round((g.total > 0 ? g.paid / g.total : 1) * 100)}%`;
    line(box, 'pc-dim', t('pc.goal.paid', { n: g.nightsPaid, k: g.nights }));
    line(box, 'pc-story', t('pc.goal.buys'));
    const inc = e.incomeMean();
    line(body, '', inc > 0 ? t('pc.home.income', { n: inc }) : t('pc.home.noIncome'));
    if (e.worth() > 0) line(body, 'pc-dim', t('pc.home.worth', { n: e.worth() }));
    const last = e.lastDawn();
    if (last) line(body, 'pc-dim', t('pc.home.last', { n: last.total }));
    const freeze = e.freezeNext();
    if (freeze > 0) line(body, 'pc-warn', t('pc.home.heat', { n: freeze }));
    const tot = e.totals();
    if (tot.earned > 0 || tot.spent > 0) line(body, 'pc-dim', t('pc.home.totals', { a: tot.earned, b: tot.spent }));
  };

  const drawInvest = (body: HTMLElement, e: HomeEconomy): void => {
    line(body, 'pc-dim', t('pc.inv.hint'));
    for (const v of e.ventures()) {
      const row = h('div', `pc-row${v.locked ? ' pc-locked' : ''}`, body);
      const info = h('div', 'pc-info', row);
      h('div', 'pc-name', info, t(`pc.inv.${v.id}.name`));
      h('div', 'pc-desc', info, t(`pc.inv.${v.id}.desc`));
      const meta = [t('pc.inv.pays', { n: Math.round(v.mean), k: v.payback }), t('pc.inv.held', { n: v.held, k: v.cap })];
      if (v.held > 0 && v.growth > 1) meta.push(t('pc.inv.growth', { n: v.growth.toFixed(1) }));
      h('div', 'pc-meta', info, v.locked ? t('pc.inv.from', { n: v.from }) : meta.join(' · '));
      const acts = h('div', 'pc-acts', row);
      const buy = h('button', 'pc-btn', acts, t('pc.inv.buy', { n: v.price }));
      buy.type = 'button';
      buy.disabled = v.locked || v.held >= v.cap || run.wallet() < v.price;
      buy.addEventListener('click', () => say(e.buyVenture(v.id)));
      if (v.held > 0) {
        const sell = h('button', 'pc-btn pc-btn-sell', acts, t('pc.inv.sell', { n: v.sell }));
        sell.type = 'button';
        sell.addEventListener('click', () => say(e.sellVenture(v.id), v.sell));
      }
    }
  };

  const drawMarket = (body: HTMLElement, e: HomeEconomy): void => {
    line(body, 'pc-dim', t('pc.mk.hint'));
    for (const m of e.market()) {
      const row = h('div', `pc-row${m.locked ? ' pc-locked' : ''}`, body);
      const info = h('div', 'pc-info', row);
      h('div', 'pc-name', info, t(`pc.mk.${m.id}.name`));
      h('div', 'pc-desc', info, t(`pc.mk.${m.id}.desc`));
      const meta = m.locked ? t('pc.mk.from', { n: m.from })
        : m.kind === 'upgrade' ? '' : m.left > 0 ? t('pc.mk.left', { n: m.left }) : t('pc.mk.soldOut');
      if (meta) h('div', 'pc-meta', info, meta);
      const acts = h('div', 'pc-acts', row);
      const btn = h('button', 'pc-btn', acts, m.owned ? t('pc.mk.owned') : t('pc.mk.buy', { n: m.price }));
      btn.type = 'button';
      btn.disabled = m.locked || m.owned || m.left <= 0 || run.wallet() < m.price;
      btn.addEventListener('click', () => say(e.buyItem(m.id)));
    }
  };

  function draw(): void {
    const e = econ();
    if (!screen || !e) return;
    screen.replaceChildren();
    const top = h('div', 'pc-top', screen);
    h('span', 'pc-title', top, t('pc.title'));
    h('span', 'pc-pocket', top, t('pc.pocket', { n: run.wallet() }));
    h('div', 'pc-boot', screen, t('pc.boot'));
    const tabs = h('div', 'pc-tabs', screen);
    TABS.forEach((id, i) => {
      const b = h('button', `pc-tab${id === tab ? ' pc-tab-on' : ''}`, tabs, `${i + 1} ${t(`pc.tab.${id}`)}`);
      b.type = 'button';
      b.addEventListener('click', () => { tab = id; status = ''; uiSfx('click', 0.4); draw(); });
    });
    const body = h('div', 'pc-body', screen);
    if (tab === 'home') drawHome(body, e);
    else if (tab === 'invest') drawInvest(body, e);
    else drawMarket(body, e);
    h('div', 'pc-status', screen, status);
    h('div', 'pc-foot', screen, t('pc.close'));
  }

  const show = (): void => {
    if (open || !econ()) return;
    open = true;
    tab = 'home';
    status = '';
    app.ui.panel(PANEL, (host) => {
      const root = h('div', 'pc-root', host);
      modalPanel(root, { escClose: true, dim: true });
      const crt = h('div', 'pc-crt', root);
      screen = h('div', 'pc-screen', crt);
      h('div', 'pc-scan', crt);
      draw();
      const onKey = (ev: KeyboardEvent): void => {
        const i = ['1', '2', '3'].indexOf(ev.key);
        if (i < 0) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        tab = TABS[i] ?? 'home';
        status = '';
        draw();
      };
      window.addEventListener('keydown', onKey, true);
      uiSfx('click', 0.5);
      return () => { window.removeEventListener('keydown', onKey, true); open = false; screen = null; };
    });
  };

  const off = bus.on('home:interact', ({ station }) => {
    if (!alive || (station as string) !== 'computer') return;
    if (run.homeStage() !== 'evening' || run.prologueOn()) {
      app.ui.toast?.(t('pc.closed'), 'info', 2.5);
      return;
    }
    show();
  });

  // the Evening ends (the bed, the lift, a knock that ends the run): the screen goes dark
  addTicker(() => {
    if (!alive) { close(); return false; }
    if (open && (run.homeStage() !== 'evening' || run.over)) close();
    return true;
  });

  return () => {
    alive = false;
    off();
    close();
  };
}
