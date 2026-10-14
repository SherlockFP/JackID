/**
 * Reveal sequence after a ruling:
 *   1. hitstop freeze with desaturation (no hitstop in Calm Mode),
 *   2. the Tally Sheet rewinds (rows light up last to first), then each clue rings in order,
 *   3. a three-panel strip: WHAT YOU SAW / WHAT HAPPENED / WHY,
 *   4. the RULED stamp.
 * Skip jumps straight to the end state. The sequence then waits for Continue (or E / Space / Enter).
 */
import { t } from '@/core/i18n';
import { el, enqueue, pause, show, skipButton, stage } from './mangaPanel';

/** Structurally the contract's `Clue` (channel, round, i18n key, optional data). */
export interface MangaClue { channel: 'tell' | 'table' | 'math'; round: number; key: string; data?: Record<string, unknown> }
/** Structurally the contract's `RevealScript`: three i18n keys. */
export interface MangaScript { saw: string; happened: string; why: string }
export type Verdict = 'CHEAT' | 'FAIR';

const CHANNEL_ORDER: Record<MangaClue['channel'], number> = { tell: 0, table: 1, math: 2 };

function varsOf(data?: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (data) for (const [k, v] of Object.entries(data)) if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  return out;
}

export function reveal(script: MangaScript, clues: readonly MangaClue[], verdict: Verdict): Promise<void> {
  return enqueue(async (ctl) => {
    const m = ctl.m;
    const host = stage(ctl, `mg-reveal ${verdict === 'CHEAT' ? 'is-cheat' : 'is-fair'}`);

    const freeze = el('div', 'mg-freeze');
    const sheet = el('div', 'mg-sheet');
    sheet.append(el('h3', 'mg-sheet-title', t('manga.reveal.title')));
    const ordered = [...clues].sort((a, b) => a.round - b.round || CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel]);
    const rows = ordered.map((c) => {
      const row = el('div', `mg-clue mg-ch-${c.channel}`);
      row.append(
        el('span', 'mg-chip', t(`manga.clue.${c.channel}`)),
        el('span', 'mg-round', t('manga.clue.round', { n: c.round })),
        el('span', 'mg-ctext', t(c.key, varsOf(c.data))),
      );
      sheet.append(row);
      return row;
    });

    const strip = el('div', 'mg-strip');
    [
      ['manga.reveal.saw', script.saw],
      ['manga.reveal.happened', script.happened],
      ['manga.reveal.why', script.why],
    ].forEach(([head, body]) => {
      const p = el('div', 'mg-panel-box');
      p.append(el('h4', 'mg-ph', t(head)), el('p', 'mg-pb', t(body)));
      strip.append(p);
    });

    const stamp = el('div', 'mg-stamp', t(verdict === 'CHEAT' ? 'manga.reveal.ruled.cheat' : 'manga.reveal.ruled.fair'));
    const go = el('button', 'mg-continue', t('manga.continue'));
    go.type = 'button';
    host.append(freeze, sheet, strip, stamp, skipButton(ctl), go);
    show(host);

    // 1. Hitstop freeze: the desaturation takes hold, then the sheet appears after a short beat.
    freeze.classList.add('on');
    await pause(ctl, m.calm ? 0 : 260);

    // 2. Rewind the log (last row first), then ring each clue in order.
    sheet.classList.add('on');
    for (let i = rows.length - 1; i >= 0; i--) {
      rows[i].classList.add('lit');
      await pause(ctl, m.calm ? 0 : 70);
    }
    for (const row of rows) {
      row.classList.add('ring');
      await pause(ctl, 340);
    }

    // 3. The three-panel strip.
    strip.classList.add('on');
    await pause(ctl, m.calm ? 200 : 520);

    // 4. The stamp.
    stamp.classList.add('on');
    await pause(ctl, 280);

    // 5. Wait for the player.
    if (!ctl.skipped) {
      go.classList.add('on');
      await new Promise<void>((resolve) => {
        const end = (): void => {
          ctl.wake.delete(end);
          ctl.key = null;
          resolve();
        };
        ctl.wake.add(end);
        ctl.key = end;
        go.addEventListener('click', (e) => { e.stopPropagation(); end(); }, { once: true });
      });
    }
  });
}
