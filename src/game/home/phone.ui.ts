/**
 * THE PHONE UI (wave 69, Home layer): the pocket phone over `run.homePhone()` (docs/WAVE69_HOME.md §4). A chip sits bottom-left
 * with an unread dot; PHONE (default T, rebindable) or the wall phone at home opens the overlay: a thread list (EŞİM / SPOUSE and
 * TAHSİLDAR / THE COLLECTOR; newest first, one preview line and an unread badge each), then the open thread (Heat as pips on the
 * Collector header), message bubbles and 2–3 replies on keys 1-3.
 *
 * The overlay is not a modal: it stays in walk mode, so the phone keys keep working (the input service delivers walk actions
 * only in walk mode). Keys are read on the sim timer, once per fixed step, the same place the hotline's keys are read. Replies
 * are refused while a call is up or a choice is on screen. Arrivals raise a `phone` toast and the buzz. The hands hold the phone
 * while it is open. Pure DOM: the sim owns every rule (phone.ts).
 */
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import type { BindingKey } from '@/core/input';
import type { Action } from '@/core/input/types';
import type { UIOverlayX } from '@/core/ui/ui';
import { portraitSrc } from '@/core/ui/manga/portrait';
import type { DebtRun } from '@/game/run';
import { HOME_SFX, type HomePhoneApi, type PhoneMessage, type PhoneThread } from './contract';
import { replyCoinCost } from './phone';
import './phone.css';

/** The sim timers run once per fixed step: the phone keys are read there, where `pressed` is valid. */
const POLL_EVERY_S = 1e-3;
const THREADS: readonly PhoneThread[] = ['spouse', 'collector'];
const HEAT_PIPS = 6;
const TOAST_S = 3;

/** The run's phone (`run.homePhone()`, null on an online run or a bench run without the Home layer). */
function phoneOf(run: DebtRun): HomePhoneApi | null {
  return run.homePhone();
}

/** A call or a choice has the keys: the hotline's deal digits and the choice's own digits come first. */
function callOrChoiceUp(run: DebtRun): boolean {
  return run.phone() !== null || document.querySelector('.px-choice') !== null;
}

const pressed = (a: string): boolean => app.input.pressed(a as Action);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Element | null, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Newest unanswered message of a thread that has replies, or null. */
function pendingIn(p: HomePhoneApi, thread: PhoneThread): PhoneMessage | null {
  const msgs = p.messages();
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.thread === thread && m.answered === null && m.replies.length > 0) return m;
  }
  return null;
}

export function mountPhoneUi(run: DebtRun): () => void {
  const host: HTMLElement = (app.ui as UIOverlayX | undefined)?.hudLayer ?? document.body;
  const chip = el('div', 'px-phone-chip', host);
  chip.setAttribute('role', 'button');
  const chipLabel = el('span', 'px-phone-chip-label', chip);
  const chipDot = el('i', 'px-phone-dot', chip);
  const panel = el('div', 'px-phone', host);
  panel.hidden = true;
  chip.hidden = true;

  let open = false;
  let disposed = false;
  let thread: PhoneThread = 'spouse';
  let view: 'list' | 'thread' = 'list';
  let sig = '';
  let keyLabel = 'T';

  const refreshKeyLabel = (): void => {
    keyLabel = app.input.keyLabel('phone' as BindingKey);
    chipLabel.textContent = `${t('phone.ui.chip')} [${keyLabel}]`;
  };

  // ── panel skeleton (rebuilt on render) ─────────────────────────────────────────────────────────
  const head = el('div', 'px-phone-head', panel);
  el('span', 'px-phone-title', head, t('phone.ui.title'));
  const list = el('div', 'px-phone-list', panel);
  const threadHead = el('div', 'px-phone-thread', panel);
  const body = el('div', 'px-phone-body', panel);
  const replies = el('div', 'px-phone-replies', panel);
  const hint = el('div', 'px-phone-hint', panel);

  function renderThreadHead(p: HomePhoneApi): void {
    threadHead.replaceChildren();
    const back = el('button', 'px-phone-back', threadHead, '<');
    back.type = 'button';
    back.addEventListener('click', () => { view = 'list'; sig = ''; });
    if (thread === 'spouse') {
      const img = el('img', 'px-phone-avatar', threadHead);
      img.alt = '';
      img.src = portraitSrc('spouse', 'calm');
      el('span', 'px-phone-name', threadHead, t('phone.thread.spouse'));
      return;
    }
    el('span', 'px-phone-name', threadHead, t('phone.thread.collector'));
    el('span', 'px-phone-heatlbl', threadHead, t('phone.ui.heat'));
    const pips = el('span', 'px-phone-pips', threadHead);
    const heat = p.heat();
    for (let i = 0; i < HEAT_PIPS; i++) el('i', i < heat ? 'px-pip on' : 'px-pip', pips);
  }

  /** The inbox: threads with messages, newest first; one line of preview and the unread count as a badge. */
  function renderList(p: HomePhoneApi): void {
    list.replaceChildren();
    const msgs = p.messages();
    const rows = THREADS.map((th) => ({ th, last: msgs.map((m, i) => (m.thread === th ? i : -1)).reduce((a, b) => Math.max(a, b), -1) }))
      .filter((r) => r.last >= 0).sort((a, b) => b.last - a.last);
    if (!rows.length) el('div', 'px-phone-empty', list, t('phone.ui.empty'));
    for (const { th, last } of rows) {
      const m = msgs[last];
      const unread = msgs.filter((x) => x.thread === th && !x.read).length;
      const r = el('button', unread ? 'px-phone-row unread' : 'px-phone-row', list);
      r.type = 'button';
      r.dataset.thread = th;
      const top = el('span', 'px-phone-row-top', r);
      el('span', 'px-phone-row-name', top, t(`phone.thread.${th}`));
      if (unread) el('b', 'px-phone-badge', top, String(unread));
      el('span', 'px-phone-row-prev', r, t(m.textKey, m.vars));
      r.addEventListener('click', () => selectThread(th));
    }
  }

  function render(p: HomePhoneApi): void {
    const inThread = view === 'thread';
    list.hidden = inThread; threadHead.hidden = !inThread; body.hidden = !inThread; replies.hidden = !inThread;
    if (!inThread) { renderList(p); hint.textContent = t('phone.ui.hint.list', { key: keyLabel }); return; }
    renderThreadHead(p);

    body.replaceChildren();
    const msgs = p.messages().filter((m) => m.thread === thread);
    if (!msgs.length) el('div', 'px-phone-empty', body, t('phone.ui.empty'));
    for (const m of msgs) {
      const inb = el('div', 'px-msg in', body);
      el('div', 'px-msg-text', inb, t(m.textKey, m.vars));
      el('div', 'px-msg-meta', inb, t('phone.ui.stamp', { n: m.night, w: m.watch }));
      if (m.answered !== null && m.replies[m.answered] !== undefined) {
        const out = el('div', 'px-msg out', body);
        el('div', 'px-msg-text', out, t(m.replies[m.answered], m.vars));
        el('div', 'px-msg-meta', out, t('phone.ui.you'));
      }
    }
    body.scrollTop = body.scrollHeight;

    replies.replaceChildren();
    const pend = pendingIn(p, thread);
    if (pend && !callOrChoiceUp(run)) {
      pend.replies.forEach((key, i) => {
        const cost = replyCoinCost(pend, i);
        const b = el('button', 'px-phone-reply', replies);
        b.type = 'button';
        b.disabled = cost > run.wallet();
        el('b', '', b, String(i + 1));
        el('span', '', b, t(key, pend.vars));
        b.addEventListener('click', () => replyTo(i));
      });
    }
    hint.textContent = t('phone.ui.hint', { key: keyLabel });
  }

  function signature(p: HomePhoneApi): string {
    const msgs = p.messages().map((m) => `${m.id}:${m.answered}:${m.read ? 1 : 0}`).join('|');
    return `${view}#${thread}#${p.heat()}#${msgs}`;
  }

  function selectThread(th: PhoneThread): void {
    const p = phoneOf(run);
    if (!p || !open) return;
    thread = th;
    view = 'thread';
    p.markRead(th);
    sig = '';
  }

  /** Opens straight into a thread with a question waiting (its reply keys must work), else on the inbox. */
  function pendingThread(p: HomePhoneApi): PhoneThread | null {
    for (const th of THREADS) if (pendingIn(p, th)) return th;
    return null;
  }

  let leaveTimer: (() => void) | null = null;

  function openPhone(): void {
    const p = phoneOf(run);
    if (!p || open || disposed) return;
    if (app.input.mode !== 'walk') return;      // a cutscene, a menu or a text field has the screen
    refreshKeyLabel();                          // the bindings may have changed in the controls card
    open = true;
    const pend = pendingThread(p);
    view = 'list';
    if (pend) { thread = pend; view = 'thread'; p.markRead(pend); }
    app.input.exitLock();
    app.player?.viewmodel?.hold?.('phone');
    app.audio.play('phoneOpen');
    if (leaveTimer) { leaveTimer(); leaveTimer = null; }
    panel.classList.remove('leave');
    panel.hidden = false;
    void panel.offsetWidth;                     // restart the slide-up when it re-opens mid slide-down
    panel.classList.add('enter');
    chip.classList.add('open');
    sig = '';
  }

  function closePhone(): void {
    if (!open) return;
    open = false;
    chip.classList.remove('open');
    app.player?.viewmodel?.hold?.('coin');
    if (disposed) { panel.hidden = true; return; }
    app.audio.play('phoneClose');
    panel.classList.remove('enter');
    panel.classList.add('leave');               // slides down, then hides
    leaveTimer = app.timers.sim.after(0.19, () => { leaveTimer = null; panel.classList.remove('leave'); panel.hidden = true; });
  }

  /** Reply `choice` (0-based) to the open thread's pending message. Coins that the pocket cannot cover refuse it. */
  function replyTo(choice: number): void {
    const p = phoneOf(run);
    if (!p || !open || callOrChoiceUp(run)) return;
    const msg = pendingIn(p, thread);
    if (!msg || choice >= msg.replies.length) return;
    if (!p.reply(msg.id, choice)) {
      if (replyCoinCost(msg, choice) > 0) app.ui.toast(t('phone.ui.coins'), 'warn');
      return;
    }
    app.audio.play(HOME_SFX.blip);
    sig = '';
  }

  function poll(): void {
    if (disposed) return;
    const p = phoneOf(run);
    if (!p) { chip.hidden = true; if (open) closePhone(); return; }
    chip.hidden = false;
    chipDot.classList.toggle('lit', p.unread() > 0);

    if (open && app.input.mode !== 'walk') closePhone();   // a cutscene or a menu took the screen
    if (pressed('phone')) { if (open) closePhone(); else openPhone(); }
    if (open) {
      for (let i = 0; i < 3 && open; i++) if (pressed(`phoneReply${i + 1}`)) replyTo(i);
      if (open) {
        const s = signature(p);
        if (s !== sig) { sig = s; render(p); }
      }
    }
  }

  const offs: Array<() => void> = [];
  offs.push(bus.on('msg:in', ({ msg }) => {
    if (disposed) return;
    (app.ui as UIOverlayX).toast(t(msg.thread === 'spouse' ? 'phone.toast.spouse' : 'phone.toast.collector'), 'phone', TOAST_S, `phone:${msg.thread}`);
    app.audio.play(HOME_SFX.buzz);
    const p = phoneOf(run);
    if (open && p && view === 'thread' && msg.thread === thread) p.markRead(thread);
    sig = '';
  }));
  offs.push(bus.on('msg:reply', () => { sig = ''; }));
  // wave 71: every real Heat move shows as a small hard-edged toast over the chip for TOAST_S sim seconds
  let heatToast: HTMLElement | null = null;
  let heatStop: (() => void) | null = null;
  offs.push(bus.on('home:heat', ({ delta }) => {
    if (disposed || delta === 0) return;
    heatStop?.();
    heatToast?.remove();
    const up = delta > 0;
    const b = el('div', up ? 'px-phone-heat up' : 'px-phone-heat down', chip, t(up ? 'phone.ui.heat.up' : 'phone.ui.heat.down', { n: Math.abs(delta) }));
    Object.assign(b.style, {
      position: 'absolute', left: '0', bottom: 'calc(100% + 4px)', padding: '3px 6px', background: 'var(--panel)', whiteSpace: 'nowrap',
      color: up ? 'var(--amber)' : 'var(--ivory)', pointerEvents: 'none', boxShadow: `inset 0 0 0 2px ${up ? 'var(--amber)' : 'var(--slate)'}`,
    } satisfies Partial<CSSStyleDeclaration>);
    heatToast = b;
    heatStop = app.timers.sim.after(TOAST_S, () => { b.remove(); if (heatToast === b) heatToast = null; });
  }));
  offs.push(bus.on('home:interact', ({ station }) => { if (station === 'phone') openPhone(); }));
  offs.push(bus.on('input:device', () => { refreshKeyLabel(); sig = ''; }));   // key cap <-> pad glyph

  chip.addEventListener('click', () => { if (open) closePhone(); else openPhone(); });
  refreshKeyLabel();
  const stopPoll = app.timers.sim.every(POLL_EVERY_S, poll);

  return () => {
    disposed = true;
    leaveTimer?.();
    stopPoll();
    heatStop?.();
    heatToast?.remove();
    for (const off of offs.splice(0)) off();
    if (open) closePhone();
    chip.remove();
    panel.remove();
  };
}
