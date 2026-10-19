/**
 * KONSOL, the fourth tab of the home computer: a green-on-black prompt. The rules live in src/game/cheats.ts; this file only draws the
 * last lines, takes one typed line at a time (Enter) and prints the reply. The scrollback is owned by the computer UI so it survives a
 * redraw and a tab switch.
 */
import { t } from '@/core/i18n';
import { addTicker, h, textField, uiSfx } from '@/core/ui/widgets';
import { CHEATS, type CheatReply, type Cheats } from '@/game/cheats';

export interface KonsolLine { text: string; tone: 'in' | CheatReply['tone'] }
const SHOWN = 9;
const KEPT = 40;

/** The printed lines of one reply (YARDIM lists every code). */
function replyLines(r: CheatReply): string[] {
  if (r.key !== 'konsol.help') return [t(r.key, r.vars)];
  return [t(r.key), ...CHEATS.map((c) => `${c.code}  ${t(`konsol.fx.${c.code.toLowerCase()}`)}`)];
}

export function drawKonsol(body: HTMLElement, cheats: Cheats, log: KonsolLine[], redraw: () => void): void {
  h('div', 'pc-line pc-dim', body, t('konsol.hint'));
  const term = h('div', 'pc-term', body);
  for (const l of log.slice(-SHOWN)) h('div', `pc-t pc-t-${l.tone}`, term, l.text);
  const row = h('div', 'pc-prompt', term);
  h('span', 'pc-ps', row, '>');
  const field = textField(row, {
    maxLength: 24,
    onSubmit: (v) => {
      const r = cheats.submit(v);
      if (v.trim()) log.push({ text: `> ${v.trim()}`, tone: 'in' });
      if (r) {
        for (const text of replyLines(r)) log.push({ text, tone: r.tone });
        uiSfx(r.tone === 'ok' ? 'purchase' : r.tone === 'ask' ? 'click' : 'buzzer', 0.5);
      }
      if (log.length > KEPT) log.splice(0, log.length - KEPT);
      redraw();
    },
  });
  addTicker(() => { field.focus(); return false; });   // the screen is in the page by the next frame
}
