/**
 * Host form (GDD §7.6, §9.6), drawn as toggles on the same CRT as the server browser: room name, mode (co-op / versus /
 * free), max players 2–8, optional password, and visibility (public / friends-only / same-browser tabs). OPEN THE LIFT opens
 * the room and enters the party lobby as host. Keys: W/S or arrows pick a field · A/D or arrows change a toggle · type into
 * the name and password fields · Enter activates · Esc goes back to the browser.
 */
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import type { GameMode } from '@/core/types';
import type { HostOptions } from '@/net/types';
import { MP_MAX_MAX, MP_MAX_MIN, MP_MODES, ROOM_NAME_MAX } from './mp/config';
import { enterLobby } from './mp/nav';
import { stage, hookStageOverlay, type Screen, type StageKey } from './mp/stage';
import { HitMap, PHOS, PIX, box, button, say, sayFit, wrapLines } from './mp/crtArt';

type Vis = 'public' | 'friends' | 'tab';
const VIS: readonly Vis[] = ['public', 'friends', 'tab'];
const PASS_MAX = 32;

/** Visibility → host options: friends-only rooms are hidden from the browser, same-browser rooms only show to tabs. */
export function visibilityOptions(v: Vis): Pick<HostOptions, 'public' | 'friendsOnly'> {
  if (v === 'public') return { public: true, friendsOnly: false };
  if (v === 'friends') return { public: false, friendsOnly: true };
  return { public: false, friendsOnly: false };
}

// Fields in screen order: 0 name (text) · 1 mode · 2 max · 3 password (text) · 4 visibility · 5 OPEN · 6 BACK.
const FIELD_COUNT = 7;
const OPEN = 5;
const BACK = 6;
const isText = (i: number): boolean => i === 0 || i === 3;
const isCycle = (i: number): boolean => i === 1 || i === 2 || i === 4;
const LABEL_KEY = ['host.name', 'host.mode', 'host.max', 'host.password', 'host.vis'] as const;

class HostScreen implements Screen {
  private sel = 0;
  private name: string;
  private pw = '';
  private modeIdx = Math.max(0, MP_MODES.indexOf('coop'));
  private max = 4;
  private visIdx = 0;
  private err = '';
  private busy = false;
  private readonly hits = new HitMap();
  private readonly who = app.save.data.profile.name || 'JackID';

  constructor(private readonly back: () => void) {
    this.name = this.who;
  }

  open(): void { /* nothing to start: the form is static until typed into */ }
  close(): void { /* nothing to stop */ }

  private adjust(i: number, dir: number): void {
    if (i === 1) this.modeIdx = (this.modeIdx + dir + MP_MODES.length) % MP_MODES.length;
    else if (i === 2) {
      const n = MP_MAX_MAX - MP_MAX_MIN + 1;
      this.max = wrapIndex(this.max - MP_MAX_MIN + dir, n) + MP_MAX_MIN;
    } else if (i === 4) this.visIdx = (this.visIdx + dir + VIS.length) % VIS.length;
  }

  private mode(): GameMode { return MP_MODES[this.modeIdx]!; }

  private async go(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.err = '';
    const vis = visibilityOptions(VIS[this.visIdx]!);
    const opts: HostOptions = {
      name: this.name.trim().slice(0, ROOM_NAME_MAX) || this.who,
      mode: this.mode(),
      max: this.max,
      public: vis.public,
      lateJoin: true,
      friendsOnly: vis.friendsOnly,
      ...(this.pw ? { password: this.pw } : {}),
    };
    try {
      await app.net.host(opts);
      enterLobby('host');
    } catch (e) {
      this.busy = false;
      this.err = t('mp.host.failed', { msg: e instanceof Error ? e.message : String(e) });
    }
  }

  key(e: StageKey): void {
    const textField = isText(this.sel);
    if (textField && e.key.length === 1 && e.code !== 'Escape') {
      const cur = this.sel === 0 ? this.name : this.pw;
      const max = this.sel === 0 ? ROOM_NAME_MAX : PASS_MAX;
      if (cur.length < max) {
        if (this.sel === 0) this.name += e.key; else this.pw += e.key;
      }
      return;
    }
    switch (e.code) {
      case 'Backspace':
        if (textField) { if (this.sel === 0) this.name = this.name.slice(0, -1); else this.pw = this.pw.slice(0, -1); }
        break;
      case 'ArrowUp': case 'KeyW': this.sel = (this.sel + FIELD_COUNT - 1) % FIELD_COUNT; break;
      case 'ArrowDown': case 'KeyS': this.sel = (this.sel + 1) % FIELD_COUNT; break;
      case 'ArrowLeft': case 'KeyA': if (isCycle(this.sel)) this.adjust(this.sel, -1); break;
      case 'ArrowRight': case 'KeyD': if (isCycle(this.sel)) this.adjust(this.sel, 1); break;
      case 'Enter': case 'NumpadEnter':
        if (this.sel === OPEN) void this.go();
        else if (this.sel === BACK) this.back();
        else if (isCycle(this.sel)) this.adjust(this.sel, 1);
        else this.sel = (this.sel + 1) % FIELD_COUNT;
        break;
      case 'Escape': this.back(); break;
      default: return;
    }
    e.preventDefault();
  }

  click(x: number, y: number): void {
    const id = this.hits.at(x, y);
    if (!id) return;
    if (id === 'open') { this.sel = OPEN; void this.go(); return; }
    if (id === 'back') { this.back(); return; }
    if (id.startsWith('field:')) {
      const i = Number(id.slice(6));
      this.sel = i;
      if (isCycle(i)) this.adjust(i, x < 341 ? -1 : 1);
    }
  }

  private row(c: CanvasRenderingContext2D, i: number, y: number, value: string, cursor: boolean): void {
    const on = this.sel === i;
    const w = 512;
    say(c, t(`mp.${LABEL_KEY[i]}`), 30, y + 6, on ? PHOS.hi : PHOS.dim, 16);
    box(c, 200, y, w - 230, 28, on ? PHOS.sel : PHOS.ink, on ? PHOS.sel : PHOS.dim);
    const ink = on ? PHOS.ink : PHOS.fg;
    if (isCycle(i)) {
      if (on) say(c, '<', 212, y + 4, ink, 18);
      if (on) say(c, '>', w - 216, y + 4, ink, 18, 'right');
      say(c, value, w / 2 - 6, y + 4, ink, 18, 'center');
    } else {
      sayFit(c, `${value}${cursor && on ? '_' : ''}`, 210, y + 4, w - 250, on ? PHOS.ink : PHOS.hi, 18);
    }
    this.hits.add(`field:${i}`, 200, y, w - 230, 28);
  }

  paint(c: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    const hits = this.hits;
    hits.clear();
    c.fillStyle = PHOS.bg;
    c.fillRect(0, 0, w, h);
    say(c, t('mp.host.title'), 18, 14, PHOS.warn, 12, 'left', PIX);
    box(c, 10, 8, w - 20, 34, null, PHOS.dim);
    const blink = Math.floor(time * 2) % 2 === 0;
    const modeText = t(`mp.mode.${this.mode()}`);
    const visText = t(`mp.host.vis.${VIS[this.visIdx]!}`);
    const maskedPw = '*'.repeat(this.pw.length);
    this.row(c, 0, 56, this.name, blink);
    this.row(c, 1, 94, modeText, false);
    this.row(c, 2, 132, String(this.max), false);
    this.row(c, 3, 170, maskedPw, blink);
    this.row(c, 4, 208, visText, false);

    button(c, hits, 'open', t('mp.host.start'), 30, 258, 210, 30, this.sel === OPEN, PHOS.fg);
    button(c, hits, 'back', t('mp.browser.back'), 272, 258, 210, 30, this.sel === BACK, PHOS.dim);
    if (this.err) sayFit(c, this.err, w / 2, 302, w - 40, PHOS.bad, 16, 'center');
    for (const [i, line] of wrapLines(c, t('mp.host.hint'), w - 40, 14).slice(0, 2).entries()) {
      say(c, line, w / 2, 326 + i * 14, PHOS.dim, 14, 'center');
    }
    for (const line of wrapLines(c, t('mp.host.keys'), w - 40, 13).slice(0, 1)) {
      say(c, line, w / 2, 366, PHOS.dim, 13, 'center');
    }
  }
}

/** Wrap an index into [0, n). */
function wrapIndex(v: number, n: number): number {
  return ((v % n) + n) % n;
}

/** Open the host form on the CRT. `back` puts the previous screen (the browser) back on the monitor. */
export function openHostPanel(back?: () => void): void {
  hookStageOverlay();
  stage.show(new HostScreen(back ?? (() => stage.close())));
}
