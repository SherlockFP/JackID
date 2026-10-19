/**
 * SON OYUN, the panel (wave 106; rules in `lastGame.ts`, the cabinet in `world/props/lastGame.ts`). `E` at the open cabinet calls
 * `openLastGamePanel()`: the odds in big digits, what they are made of, what a loss costs, then ÇEK (Space / Enter) or VAZGEÇ (Esc).
 * ÇEK rolls the pull (`run.playLastGame()`), spins three reels for about 3.5 s (they stop one by one; a win lands 7 7 7, a loss a near
 * miss), reveals KAZANDIN / KAYBETTİN and calls `run.endLastGame()`. A loss with a seal left shows the new odds and lets you pull again;
 * a win or a loss on the last seal waits for DEVAM (or 3.5 s) before it ends the run.
 *
 * A rolled pull is never dropped: if the panel is closed from outside before `endLastGame()` ran, the cleanup runs it. Esc is ignored
 * while the reels run. The mouse comes back inside the leaving click or key (a gesture), as the boon offer does. The reels are the
 * UI frame's ticker (`addTicker`): no timers. Calm drops the flash, reduced motion shortens the spin and drops the coin rain.
 */
import './lastGame.css';
import { app } from '@/core/app';
import { lang, t } from '@/core/i18n';
import type { UIOverlayX } from '@/core/ui/ui';
import { addTicker, h, modalPanel, uiRng, uiSfx } from '@/core/ui/widgets';
import type { LastGameProp } from '@/world/props/lastGame';
import type { DebtRun } from './run';
import { LAST_GAME, type LastGameApi, type LastGameOdds, type LastGameResult } from './lastGame';

const PANEL = 'lastGame';
/** The drum faces; index 0 (the 7) is the win. */
const FACES = ['7', '★', '♦', '♥', '♠', '♣'];
const N = FACES.length;
/** Seconds into the pull at which each reel starts to stop, and how long the slowest takes. */
const STOP_AT = [1.5, 2.2, 2.9];
const STOP_DUR = [0.7, 0.7, 0.9];
/** The prop's drums land this long after the pull starts (they take 0.6 s + 0.7 s per reel from there to stop with the panel's). */
const LAND_CALL_S = 0.9;
const SPIN_SPEED = 16;   // cells per second while a reel runs
const CONTINUE_S = 3.5;  // a win or a final loss goes on by itself after this long
const COINS = 46;

const calmOn = (): boolean => !!app?.save?.data?.settings?.calm;
const reduceMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Run = DebtRun & LastGameApi;
const asRun = (): Run | null => {
  const r = app.run as unknown as Partial<Run> | null;
  return r && typeof r.lastGameOpen === 'function' && typeof r.lastGameOdds === 'function' && typeof r.playLastGame === 'function' && typeof r.endLastGame === 'function'
    ? (r as Run) : null;
};

/** A percent for the language: 4 → "4%" / "%4"; signed adds + or −; a half point reads 1,5 in Turkish. */
function pctText(pct: number, signed: boolean): string {
  const n = String(Math.abs(pct)).replace('.', lang() === 'tr' ? ',' : '.');
  return t(signed ? (pct < 0 ? 'lastGame.pctMinus' : 'lastGame.pctPlus') : 'lastGame.pct', { n });
}

/** One line per part of the odds: Base 5%, LUCK 3 stars +9%, Luck points +4%, Blessings and charms +5%. */
function partLine(p: LastGameOdds['parts'][number]): string {
  const v = pctText(p.pct, p.key !== 'base');
  if (p.key === 'stars') return t('lastGame.part.stars', { n: Math.round(p.pct / LAST_GAME.perStar), p: v });
  return t(`lastGame.part.${p.key}`, { p: v });
}

/** Name seals left (undefined on a run without the duel counters: no cost line then). */
const seals = (run: Run): number | undefined => (run.duel ? run.duel.soulMarks() : undefined);

export function openLastGamePanel(): void {
  const run = asRun();
  if (!run || !run.lastGameOpen()) return;
  const ui = app.ui as UIOverlayX;
  const cab = (): LastGameProp | null => app.world?.prop<LastGameProp>('lastGame') ?? null;

  app.ui.panel(PANEL, (host) => {
    ui.holdToasts(true);   // the seal's own toast would land on the title: news waits until the panel closes (as the boon offer does)
    let alive = true;
    let state: 'idle' | 'spin' | 'reveal' = 'idle';
    let pending: LastGameResult | null = null;   // a rolled pull whose `endLastGame()` has not run yet
    let t0 = 0;
    let landed = false;
    let revealT = 0;
    let tickT = 0;
    let continued = false;
    const reduce = reduceMotion();
    const calm = calmOn();
    const speed = reduce ? 0.4 : 1;

    const root = h('div', 'lg-root', host);
    modalPanel(host, { escClose: false, dim: true });
    const box = h('div', 'lg-box', root);
    h('div', 'lg-rays', box);
    h('h2', 'lg-title', box, t('lastGame.title'));
    h('div', 'lg-label', box, t('lastGame.oddsLabel'));
    const oddsEl = h('div', 'lg-odds', box);
    const partsEl = h('div', 'lg-parts', box);
    const reelsEl = h('div', 'lg-reels', box);
    h('i', 'lg-line', reelsEl);
    const strips = [0, 1, 2].map(() => {
      const win = h('div', 'lg-reel', reelsEl);
      const strip = h('div', 'lg-strip', win);
      for (let i = 0; i < N * 4; i++) h('span', i % N === 0 ? 'lg-sym lg-seven' : 'lg-sym', strip, FACES[i % N]);
      return strip;
    });
    const resEl = h('div', 'lg-res', box);
    const resTitle = h('div', 'lg-res-t', resEl);
    const resSub = h('div', 'lg-res-s', resEl);
    const costEl = h('div', 'lg-cost', box);
    const btns = h('div', 'lg-btns', box);
    const pullBtn = h('button', 'lg-btn lg-pull', btns, t('lastGame.pull'));
    const leaveBtn = h('button', 'lg-btn lg-leave', btns, t('lastGame.leave'));
    for (const b of [pullBtn, leaveBtn]) { b.type = 'button'; b.setAttribute('data-nav', ''); }
    const keysEl = h('div', 'lg-keys', box, t('lastGame.keys'));

    /** The reels, in cells: `pos` mod N is the face on the payline. A stop eases from `from` to `to` over `dur`. */
    const reels = strips.map(() => ({ pos: N, from: 0, to: 0, at: 0, dur: 0, mode: 'rest' as 'rest' | 'spin' | 'stop' | 'done', target: 0 }));
    const paint = (): void => {
      reels.forEach((r, i) => {
        const p = ((r.pos % N) + N) % N + N;   // keep the strip's middle copies in view
        strips[i].style.transform = `translateY(${(-(p - 1) / (N * 4)) * 100}%)`;
      });
    };
    const rest = (): void => { for (const r of reels) { r.pos = N; r.mode = 'rest'; } paint(); };

    const drawInfo = (): void => {
      const odds = run.lastGameOdds();
      oddsEl.textContent = pctText(odds.pct, false);
      partsEl.replaceChildren();
      for (const p of odds.parts) h('div', `lg-part${p.pct < 0 ? ' lg-neg' : ''}`, partsEl, partLine(p));
      const sum = odds.parts.reduce((s, p) => s + p.pct, 0);
      if (Math.round(sum) > odds.pct) h('div', 'lg-part lg-cap', partsEl, t('lastGame.cap', { p: pctText(odds.cap, false) }));
      const left = seals(run);
      costEl.textContent = left === undefined ? '' : left <= 1 ? t('lastGame.costLast') : t('lastGame.cost', { n: left });
      costEl.classList.toggle('lg-last', left !== undefined && left <= 1);
    };

    const setButtons = (mode: 'ask' | 'busy' | 'again' | 'next'): void => {
      pullBtn.hidden = leaveBtn.hidden = false;
      pullBtn.textContent = t(mode === 'again' ? 'lastGame.again' : mode === 'next' ? 'lastGame.next' : 'lastGame.pull');
      pullBtn.disabled = mode === 'busy';
      leaveBtn.hidden = mode === 'next' || mode === 'busy';
      keysEl.textContent = t(mode === 'next' ? 'lastGame.keysNext' : 'lastGame.keys');
      keysEl.style.visibility = mode === 'busy' ? 'hidden' : 'visible';
      if (mode !== 'busy') pullBtn.focus({ preventScroll: true });
    };

    /** Leave: close, and take the mouse back inside this click or key (the closing panel's own re-lock may be refused outside a gesture). */
    const leave = (): void => {
      app.ui.closePanel(PANEL);
      if (app.player?.seat == null) void app.input.requestLock();
    };

    /** The result is shown: a final one waits for DEVAM; a loss with a seal left resolves now and offers another pull. */
    const finish = (r: LastGameResult): void => {
      state = 'reveal';
      revealT = 0;
      continued = false;
      resEl.hidden = false;
      resEl.className = `lg-res ${r.win ? 'lg-win' : 'lg-lose'}`;
      resTitle.textContent = t(r.win ? 'lastGame.won' : 'lastGame.lost');
      resSub.textContent = r.win ? t('lastGame.wonSub') : r.final ? t('lastGame.lostLast') : t('lastGame.lostSub', { n: r.sealsLeft });
      box.classList.toggle('lg-won', r.win);
      costEl.hidden = r.final;   // a won (or last) pull has no next cost to warn about
      if (r.win) {
        uiSfx('jackpot', 0.9); uiSfx('jackpotBells', 0.7); uiSfx('coinShower', 0.6);
        if (!calm) { ui.flash('#efd67b', 0.35); app.fx.flash(0xffd34a, 0.45, 0.4); }
        app.fx.shake(0.04, 0.7);
        app.fx.hitstop(0.12);
        app.fx.zoomPunch(0.04, 0.5);
        if (!reduce) for (let i = 0; i < COINS; i++) {
          const c = h('i', `lg-coin c${i % 3}`, root);
          c.style.left = `${uiRng.float(2, 98).toFixed(1)}%`;
          c.style.setProperty('--dx', `${Math.round(uiRng.float(-14, 14))}`);
          c.style.setProperty('--d', `${uiRng.float(1.4, 2.6).toFixed(2)}s`);
          c.style.animationDelay = `${uiRng.float(0, 1.6).toFixed(2)}s`;
        }
      } else {
        uiSfx('thud', 0.9); uiSfx('lose', 0.6); uiSfx('porcelainCrack', 0.7);   // a dull thud, and a seal cracks
        app.fx.shake(0.02, 0.3);
        if (!calm) app.fx.tint(0x8c1921, 0.22, 0.6);
      }
      if (r.final) { setButtons('next'); return; }
      pending = null;
      state = 'idle';
      run.endLastGame();   // a loss with a seal left: the run takes the pull back, the machine is open again
      drawInfo();
      setButtons('again');
    };

    const pull = (): void => {
      if (state !== 'idle') return;
      const r = run.playLastGame();
      if (!r) { leave(); return; }   // it closed under us
      pending = r;
      state = 'spin';
      t0 = 0;
      landed = false;
      resEl.hidden = true;
      box.classList.remove('lg-won');
      const stops = r.win ? [0, 0, 0] : [0, 0, 1 + uiRng.int(0, N - 2)];
      reels.forEach((rl, i) => { rl.mode = 'spin'; rl.target = stops[i]; });
      setButtons('busy');
      uiSfx('lever', 0.9); uiSfx('reelStart', 0.8);
      cab()?.spin();
    };

    /** DEVAM: the result is final, so the run ends now (win: the ending; last seal: the loss). */
    const proceed = (): void => {
      if (continued) return;
      continued = true;
      pending = null;
      run.endLastGame();
      app.ui.closePanel(PANEL);
    };

    pullBtn.addEventListener('click', () => { if (state === 'reveal' && pending) proceed(); else pull(); });
    leaveBtn.addEventListener('click', () => { if (state === 'idle') leave(); });
    for (const b of [pullBtn, leaveBtn]) b.addEventListener('mouseenter', () => uiSfx('hover', 0.5));

    // The veil owns its keys while it is open (a capture listener runs before the game's). A button with focus keeps its own Space / Enter.
    const onKey = (e: KeyboardEvent): void => {
      const go = e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter';
      if (!go && e.code !== 'Escape') return;
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON' && go) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') { if (state === 'idle') leave(); return; }
      if (state === 'reveal' && pending) proceed(); else pull();
    };
    window.addEventListener('keydown', onKey, true);

    drawInfo();
    rest();
    resEl.hidden = true;
    setButtons('ask');
    uiSfx('popUp', 0.5);

    addTicker((dt) => {
      if (!alive) return false;
      if (run.over && state !== 'reveal') { app.ui.closePanel(PANEL); return false; }   // the run ended under the panel
      if (state === 'spin') {
        t0 += dt;
        if (!landed && t0 >= LAND_CALL_S * speed) { landed = true; cab()?.land(pending?.win ?? false); }
        let allDone = true;
        reels.forEach((rl, i) => {
          if (rl.mode === 'spin') {
            rl.pos += SPIN_SPEED * dt;
            if (i === 0 && (tickT += dt) >= 0.11) { tickT = 0; uiSfx('reelTick', 0.3); }
            if (t0 >= STOP_AT[i] * speed) {
              // land on the target face: at least 4 cells ahead, so the stop reads as a slowdown
              const base = Math.ceil(rl.pos) + 4;
              rl.from = rl.pos;
              rl.to = base + ((((rl.target - base) % N) + N) % N);
              rl.at = 0;
              rl.dur = STOP_DUR[i] * speed;
              rl.mode = 'stop';
            }
          } else if (rl.mode === 'stop') {
            rl.at += dt;
            const k = Math.min(1, rl.at / rl.dur);
            rl.pos = rl.from + (rl.to - rl.from) * (1 - Math.pow(1 - k, 3));
            if (k >= 1) { rl.mode = 'done'; rl.pos = rl.to; uiSfx('reelStop', 0.8); if (i === 2 && pending?.win) uiSfx('lineUp', 0.8); }
          }
          if (rl.mode !== 'done') allDone = false;
        });
        paint();
        if (allDone && pending) finish(pending);
      } else if (state === 'reveal' && pending) {
        revealT += dt;
        if (revealT >= CONTINUE_S) proceed();
      }
      return undefined;
    });

    return () => {
      ui.holdToasts(false);
      alive = false;
      window.removeEventListener('keydown', onKey, true);
      // a pull that was rolled must be resolved, whatever closed the panel (Esc is ignored mid-spin, but a run end or a replaced panel is not)
      if (pending && !run.over) { pending = null; try { run.endLastGame(); } catch { /* the run was already over */ } }
    };
  });
}
