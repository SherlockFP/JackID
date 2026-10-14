/**
 * The small "[key] RULES" reminder shown instead of the HOW TO PLAY card on every sit after the first one in the save
 * (see `rulesFirstEver` in placard3d.ts). A DOM chip mounted inside the seat HUD root (it inherits `--su` and the HUD
 * font from there), top-left under the notch, fades out by itself and goes away with `off()`.
 */
const HINT_MS = 9000;

function ensureKeyframes(): void {
  if (document.getElementById('shud-hint-kf')) return;
  const st = document.createElement('style');
  st.id = 'shud-hint-kf';
  st.textContent = '@keyframes shud-hint-fade{0%,93%{opacity:1}100%{opacity:0}}';
  document.head.appendChild(st);
}

/** Show `text` (already translated, e.g. "[H] RULES") in `mount`; returns the function that removes it early. */
export function showRulesHint(mount: HTMLElement, text: string, ms = HINT_MS): () => void {
  const el = document.createElement('div');
  el.className = 'shud-rules-hint';
  el.textContent = text;
  const s = el.style;
  s.position = 'absolute';
  s.left = 'calc(var(--su, var(--u, 4px)) * 3)';
  s.top = 'calc(var(--su, var(--u, 4px)) * 14)';
  s.padding = 'calc(var(--su, var(--u, 4px)) * 1.5) calc(var(--su, var(--u, 4px)) * 3)';
  s.fontSize = 'calc(var(--su, var(--u, 4px)) * 6)';
  s.lineHeight = '1';
  s.background = 'rgba(6, 9, 6, 0.88)';
  s.borderLeft = 'calc(var(--su, var(--u, 4px)) * 1.5) solid #ffd040';
  s.color = '#f4f0dc';
  s.pointerEvents = 'none';
  s.animation = `shud-hint-fade ${ms}ms linear forwards`;
  mount.appendChild(el);
  ensureKeyframes();
  const off = (): void => { el.remove(); };
  el.addEventListener('animationend', off);
  return off;
}
