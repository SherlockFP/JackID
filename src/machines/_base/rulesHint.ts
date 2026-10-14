/**
 * The small "[key] RULES" reminder shown instead of the HOW TO PLAY card on every sit after the first one in the save
 * (see `rulesFirstEver` in placard3d.ts). A DOM chip mounted inside the seat HUD root (it inherits `--su` and the HUD
 * font from there), upper-left, fades out by itself and goes away with `off()`. It sits below the coin counter and the
 * ticket / staff lines of the HUD top band (the wallet is at 4 units, the stack ends near 50), never on top of them.
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
  const su = 'var(--su, var(--u, 4px))';
  s.position = 'absolute';
  s.left = `calc(${su} * 3)`;
  // under the HUD top band (`--hud-top-h`, set by hud.ts), so the coin counter and its stack are never covered
  s.top = `calc(var(--hud-top-h, calc(${su} * 52)) + ${su} * 2)`;
  // a brass key cap: bitmap heading font, about 4.5 units tall, so it reads from the seat
  s.fontFamily = "var(--f-head, 'Press Start 2P', monospace)";
  s.fontSize = `calc(${su} * 4.5)`;
  s.letterSpacing = '0';
  s.lineHeight = '1';
  s.whiteSpace = 'nowrap';
  s.padding = `calc(${su} * 2.5) calc(${su} * 4)`;
  s.background = 'rgba(6, 9, 6, 0.92)';
  s.border = `calc(${su} * 0.75) solid #3a2c18`;
  s.borderLeft = `calc(${su} * 2.5) solid #ffd040`;
  s.boxShadow = `0 0 0 calc(${su} * 0.75) #000`;
  s.textShadow = `0 calc(${su} * 0.75) 0 #000`;
  s.color = '#ffd040';
  s.pointerEvents = 'none';
  s.animation = `shud-hint-fade ${ms}ms linear forwards`;
  mount.appendChild(el);
  ensureKeyframes();
  const off = (): void => { el.remove(); };
  el.addEventListener('animationend', off);
  return off;
}
