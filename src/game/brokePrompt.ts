/**
 * THE BROKE PROMPT (wave 27, bank-econ): a big centre card that tells an empty-pocketed player what to do, in order, so Night 1 is
 * never a dead end. It shows while `run.brokeHelp()` says the pocket cannot cover the cheapest bet (with pulls still to play or the
 * Bell still to ring) and goes away the moment the pocket can play again. The ways out are numbered in the order the run lists them:
 * withdraw from the bank, answer the phone (P), the cashier (sell Tickets), the House loan.
 *
 * Pure DOM, pointer-events none, no input. Started by `tutorial.ts` (`startTutorial`) on every fresh Night 1, driven from the
 * session frame next to the tutorial, disposed with it. It is not part of the first-run tutorial: it runs on every run.
 */
import { app } from '@/core/app';
import { t, fmtCoins } from '@/core/i18n';
import { ALL_DEFAULTS, codeLabels } from '@/core/keymap';
import type { UIOverlayX } from '@/core/ui/ui';
import type { DebtRun } from '@/game/run';
import type { BrokeStep } from '@/game/rescue';

/** Seconds the pocket must stay empty before the card shows (a stake just placed is not "broke"). */
export const BROKE_SHOW_AFTER_S = 1.2;
/** Last Night the card is offered (the first Nights are where a new player gets stuck). */
export const BROKE_LAST_NIGHT = 3;

export interface BrokePrompt { update(dt: number): void; dispose(): void }

/** Current label of a binding ("P"), from the player's keybinds or the defaults. */
function keyLabel(key: string): string {
  const codes = app.save.data.settings.keybinds[key] ?? ALL_DEFAULTS[key] ?? [];
  return codeLabels(codes, 1)[0] ?? '';
}

/** One numbered line of the card for a step. */
export function stepLine(step: BrokeStep, tickets: number, phoneKey: string): string {
  switch (step.id) {
    case 'bank': return t('tut.broke.bank', { n: fmtCoins(step.coins) });
    case 'phone': return t('tut.broke.phone', { key: phoneKey });
    case 'cashier': return t('tut.broke.cashier', { n: fmtCoins(step.coins), tk: tickets });
    case 'loan': return t('tut.broke.loan', { c: fmtCoins(step.coins), q: fmtCoins(step.quota ?? 0), key: phoneKey });
  }
}

export function createBrokePrompt(run: DebtRun): BrokePrompt {
  const el = document.createElement('div');
  el.className = 'px-broke';
  el.setAttribute('role', 'alert');
  el.style.cssText = [
    'position:absolute', 'left:50%', 'top:20%', 'transform:translateX(-50%)', 'z-index:40', 'pointer-events:none',
    'width:min(78%,760px)', 'padding:14px 20px 16px', 'box-sizing:border-box',
    'background:rgba(8,6,2,0.92)', 'border:3px solid var(--amber,#ffb000)', 'box-shadow:0 0 0 3px var(--void,#000)',
    'color:var(--ivory,#f4efe0)', 'font-family:var(--f-body,var(--f-head,monospace))', 'font-size:clamp(14px,2.2vw,22px)', 'line-height:1.35',
    'text-align:left', 'display:none',
  ].join(';');
  const title = document.createElement('div');
  title.style.cssText = 'font-family:var(--f-head,monospace);font-size:clamp(18px,3.2vw,34px);color:var(--amber,#ffb000);margin-bottom:6px;letter-spacing:1px';
  const sub = document.createElement('div');
  sub.style.cssText = 'color:var(--grout,#b8b090);margin-bottom:10px';
  const list = document.createElement('ol');
  list.style.cssText = 'margin:0;padding-left:1.6em';
  el.append(title, sub, list);
  const hudHost: HTMLElement = (app.ui as UIOverlayX | undefined)?.hudLayer ?? document.body;
  hudHost.appendChild(el);

  let brokeFor = 0;
  let shown = false;
  let sig = '';
  let disposed = false;

  const hide = (): void => { if (shown) { el.style.display = 'none'; shown = false; sig = ''; } };

  return {
    update(dt: number): void {
      if (disposed) return;
      if (run.night() > BROKE_LAST_NIGHT) { hide(); return; }
      const help = run.brokeHelp();
      if (!help || help.steps.length === 0) { brokeFor = 0; hide(); return; }
      brokeFor += dt;
      if (brokeFor < BROKE_SHOW_AFTER_S) return;
      const phoneKey = keyLabel('answerPhone');
      const key = JSON.stringify([help.steps, help.minBet, help.pocket, phoneKey, run.balance('ticket')]);
      if (key !== sig) {
        sig = key;
        title.textContent = t('tut.broke.title');
        sub.textContent = t('tut.broke.sub', { min: fmtCoins(help.minBet) });
        list.replaceChildren(...help.steps.map((s) => {
          const li = document.createElement('li');
          li.style.cssText = 'margin:3px 0';
          li.textContent = stepLine(s, run.balance('ticket'), phoneKey);
          return li;
        }));
      }
      if (!shown) { el.style.display = ''; shown = true; }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      el.remove();
    },
  };
}
