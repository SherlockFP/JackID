/**
 * Manga preview bench: every portrait in every expression, plus buttons for the cut-in, glyph, dialogue and reveal.
 * Open `src/core/ui/manga/bench.html` on the dev server (or mount `mountBench(host)` from a dev-only path).
 * Calm and reduceFlashing toggles here drive the same motion policy the save settings do.
 */
import { setLang, lang, t } from '@/core/i18n';
import { PORTRAIT_IDS, EXPRESSIONS, portraitSrc, type Expr } from './portrait';
import { cutin, glyph, reveal, dialogue, type MangaClue } from './index';
import { setMotionSource, skip } from './mangaPanel';

const demoClues: MangaClue[] = [
  { channel: 'math', round: 3, key: 'manga.bench.demo.math' },
  { channel: 'tell', round: 1, key: 'manga.bench.demo.tell' },
  { channel: 'table', round: 2, key: 'manga.bench.demo.table' },
];
const demoScript = { saw: 'manga.bench.demo.saw', happened: 'manga.bench.demo.happened', why: 'manga.bench.demo.why' };

function btn(label: string, onClick: () => void, cls = 'mb-btn'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function mountBench(host: HTMLElement): void {
  const motion = { calm: false, noFlash: false };
  setMotionSource(() => ({ ...motion }));

  const wrap = document.createElement('div');
  wrap.className = 'mb-wrap';
  host.appendChild(wrap);

  const bar = document.createElement('div');
  bar.className = 'mb-bar';
  const calmBtn = btn(t('manga.bench.calm'), () => {
    motion.calm = !motion.calm;
    calmBtn.classList.toggle('on', motion.calm);
  });
  const flashBtn = btn(t('manga.bench.flash'), () => {
    motion.noFlash = !motion.noFlash;
    flashBtn.classList.toggle('on', motion.noFlash);
  });
  const langBtn = btn(lang() === 'en' ? 'TR' : 'EN', () => {
    setLang(lang() === 'en' ? 'tr' : 'en');
    host.replaceChildren();
    mountBench(host);
  });
  bar.append(
    calmBtn, flashBtn, langBtn,
    btn(t('manga.bench.cutin'), () => void cutin('tamsin', 'calm', 'manga.bench.demo.line')),
    btn(t('manga.bench.glyph'), () => void glyph('menace')),
    btn(t('manga.bench.dlg'), () => void dialogue('tamsin', 'manga.bench.demo.line', 'left')),
    btn(t('manga.bench.dlgR'), () => void dialogue('lucan', 'manga.bench.demo.line', 'right', 'smirk')),
    btn(t('manga.bench.cheat'), () => void reveal(demoScript, demoClues, 'CHEAT')),
    btn(t('manga.bench.fair'), () => void reveal(demoScript, demoClues, 'FAIR')),
    btn(t('manga.skip'), () => skip()),
  );
  wrap.appendChild(bar);

  for (const id of PORTRAIT_IDS) {
    const row = document.createElement('div');
    row.className = 'mb-row';
    const label = document.createElement('div');
    label.className = 'mb-id';
    label.textContent = id;
    row.appendChild(label);
    for (const e of EXPRESSIONS) {
      const img = document.createElement('img');
      img.alt = `${id} ${e}`;
      img.src = portraitSrc(id, e as Expr);
      img.title = e;
      img.addEventListener('click', () => void cutin(id, e as Expr, undefined, { side: 'right' }));
      row.appendChild(img);
    }
    wrap.appendChild(row);
  }
}

const hostEl = typeof document !== 'undefined' ? document.getElementById('manga-bench') : null;
if (hostEl) mountBench(hostEl);
