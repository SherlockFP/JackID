/**
 * ACHIEVEMENTS, the screen side: the unlock toast (slides in from the bottom right, one at a time, queued) and the ACHIEVEMENTS page
 * (the settings screen's button asks for it with `achievements:open`). The rules are in achievements.ts; `installAchievements()` starts
 * them with the toast and the page, once, from main.ts after the app exists. Clocks are the UI frame clock (no timers).
 */
import './achievements.css';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { addTicker, button, frame, h, modalPanel, pixelIcon, scroll, uiSfx, type IconName } from '@/core/ui/widgets';
import { ACHIEVEMENTS, GAMERSCORE_TOTAL, achievementDef, gamerscore, mountAchievements, type AchDef, type AchRun } from './achievements';

const PAGE = 'ach-page';
/** Seconds a toast holds on screen once in, and the length of its slide (see `.ach-toast` in achievements.css). */
const HOLD_S = 4;
const SLIDE_S = 0.45;
const PAGE_W = 300;
const LIST_H = 170;

/** The round icon: gold when unlocked, a grey lock when not. */
function ring(parent: HTMLElement, def: AchDef, unlocked: boolean): void {
  const r = h('div', 'ach-ring', parent);
  r.appendChild(pixelIcon(unlocked ? def.icon as IconName : 'lock'));
}

function mountToasts(): () => void {
  const host = h('div', 'ach-toasts', app.ui.root);
  const queue: AchDef[] = [];
  let cur: { el: HTMLElement; age: number } | null = null;
  let alive = true;

  const show = (def: AchDef): void => {
    const el = h('div', 'ach-toast', host);
    ring(el, def, true);
    const txt = h('div', 'ach-txt', el);
    h('div', 'ach-head', txt, t('ach.toast.head'));
    h('div', 'ach-name', txt, t(`ach.${def.id}.name`));
    h('div', 'ach-g', el, t('ach.g', { g: def.g }));
    uiSfx('streakPing', 0.8);   // two bell notes a fifth apart
    cur = { el, age: 0 };
  };
  addTicker((dt) => {
    if (!alive) return false;
    if (cur) {
      cur.age += dt;
      cur.el.classList.toggle('in', cur.age >= 0.05 && cur.age < HOLD_S);
      if (cur.age >= HOLD_S + SLIDE_S) { cur.el.remove(); cur = null; }
    }
    const next = cur ? undefined : queue.shift();
    if (next) show(next);
    return true;
  });
  const off = bus.on('achievement:unlock', ({ id }) => { const def = achievementDef(id); if (def) queue.push(def); });
  return () => { alive = false; off(); host.remove(); };
}

function openPage(): void {
  app.ui.panel(PAGE, (el) => {
    modalPanel(el, { escClose: true, dim: true });
    const have = new Set(app.save.data.achievements);
    const fr = frame(el, { title: t('ach.title'), width: PAGE_W, className: 'ach-frame' });
    const unlocked = ACHIEVEMENTS.filter((a) => have.has(a.id));
    h('div', 'ach-sum', fr.body, t('ach.score', { g: gamerscore(have), total: GAMERSCORE_TOTAL }));
    h('div', 'ach-count', fr.body, t('ach.count', { k: unlocked.length, total: ACHIEVEMENTS.length }));
    const list = scroll(fr.body, LIST_H);
    list.tabIndex = 0;   // the arrow keys scroll it
    // unlocked first, then the rest in table order (a stable sort)
    for (const def of [...ACHIEVEMENTS].sort((a, b) => Number(have.has(b.id)) - Number(have.has(a.id)))) {
      const on = have.has(def.id);
      const hidden = def.secret === true && !on;
      const row = h('div', `ach-row${on ? ' on' : ''}`, list);
      ring(row, def, on);
      const info = h('div', 'ach-info', row);
      h('div', 'ach-name', info, hidden ? t('ach.secret.name') : t(`ach.${def.id}.name`));
      h('div', 'ach-desc', info, hidden ? t('ach.secret.desc') : t(`ach.${def.id}.desc`));
      h('div', 'ach-g', row, t('ach.g', { g: def.g }));
    }
    const foot = h('div', 'ach-foot', fr.body);
    button(foot, { label: t('common.back'), kind: 'primary', sfx: 'back', onClick: () => app.ui.closePanel(PAGE) });
    uiSfx('popUp', 0.6);
    list.focus({ preventScroll: true });
  });
}

/** Starts the unlock rules, the toast and the page. Returns the disposer. */
export function installAchievements(): () => void {
  const rules = mountAchievements({ save: app.save, run: () => app.run as unknown as AchRun | null });
  const toasts = mountToasts();
  const open = bus.on('achievements:open', openPage);
  return () => { rules(); toasts(); open(); app.ui.closePanel(PAGE); };
}
