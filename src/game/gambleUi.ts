/**
 * Risk layer overlay: the DOM half of `gamble.ts`. One instance per machine seat, mounted in `#ui` (`ctx.ui.root`), built lazily.
 * It only draws; MachineBase owns every decision and feeds the state in. Texts go through `t()` (`gamble.*`).
 */
import { t, fmtCoins } from '@/core/i18n';
import { GAMBLE_OFFER_S, GAMBLE_STEPS, HS_MULT, type GambleCard } from './gamble';
import './gamble.css';

const SUIT: Record<string, string> = { H: '♥', D: '♦', S: '♠', C: '♣' };
const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}
const q = (root: HTMLElement, sel: string): HTMLElement => root.querySelector(sel) as HTMLElement;

export class GambleUi {
  private readonly root: HTMLElement;
  private readonly hs: HTMLElement;
  private readonly hsT: HTMLElement;
  private readonly hsW: HTMLElement;
  private readonly offerEl: HTMLElement;
  private readonly offerA: HTMLElement;
  private readonly offerK: HTMLElement;
  private readonly offerBar: HTMLElement;
  private readonly lad: HTMLElement;
  private readonly rungs: HTMLElement[] = [];
  private readonly card: HTMLElement;
  private readonly face: HTMLElement;
  private readonly faceR: HTMLElement;
  private readonly faceS: HTMLElement;
  private readonly pot: HTMLElement;
  private readonly next: HTMLElement;
  private readonly picks: HTMLElement;
  private readonly collect: HTMLElement;
  private readonly say: HTMLElement;
  private readonly allin: HTMLElement;
  private readonly allinW: HTMLElement;
  private readonly flashEl: HTMLElement;
  private flashT = 0;

  constructor(mount: HTMLElement) {
    this.root = el('div', 'gmb', mount);
    this.hs = el('div', 'gmb-hs', this.root);
    this.hsT = el('div', 'gmb-hs-t', this.hs);
    this.hsW = el('div', 'gmb-hs-w', this.hs);
    this.offerEl = el('div', 'gmb-offer gmb-pan', this.root);
    this.offerA = el('span', 'gmb-offer-a', this.offerEl);
    this.offerK = el('span', 'gmb-offer-k', this.offerEl);
    this.offerBar = el('span', 'gmb-offer-bar', this.offerEl);
    this.lad = el('div', 'gmb-ladder gmb-pan', this.root);
    el('div', 'gmb-title', this.lad);
    const rr = el('div', 'gmb-rungs', this.lad);
    for (let i = 0; i < GAMBLE_STEPS; i++) this.rungs.push(el('span', 'gmb-rung', rr, `x${2 ** (i + 1)}`));
    this.card = el('div', 'gmb-card', this.lad);
    const inn = el('div', 'gmb-card-in', this.card);
    el('div', 'gmb-back', inn);
    this.face = el('div', 'gmb-face', inn);
    this.faceR = el('span', 'gmb-face-r', this.face);
    this.faceS = el('span', 'gmb-face-s', this.face);
    this.pot = el('div', 'gmb-pot', this.lad);
    this.next = el('div', 'gmb-next', this.lad);
    this.picks = el('div', 'gmb-btns', this.lad);
    el('span', 'gmb-pick red', this.picks);
    el('span', 'gmb-pick black', this.picks);
    el('div', 'gmb-hint', this.lad);
    this.collect = el('div', 'gmb-collect', this.lad);
    this.say = el('div', 'gmb-say', this.lad);
    this.allin = el('div', 'gmb-allin gmb-pan', this.root);
    el('div', 'gmb-allin-t', this.allin);
    this.allinW = el('div', 'gmb-allin-w', this.allin);
    el('div', 'gmb-allin-c', this.allin);
    el('div', 'gmb-allin-x', this.allin);
    this.flashEl = el('div', 'gmb-flash gmb-pan', this.root);
    for (const e of [this.hs, this.offerEl, this.lad, this.allin, this.flashEl]) e.hidden = true;
    this.relang();
  }

  /** Static texts (called again on a language change). */
  relang(): void {
    this.hsT.textContent = t('gamble.hsBanner', { m: HS_MULT });
    this.hsW.textContent = t('gamble.hsWarn', { m: HS_MULT });
    this.offerK.textContent = t('gamble.offerKey');
    q(this.lad, '.gmb-title').textContent = t('gamble.title');
    (this.picks.children[0] as HTMLElement).textContent = t('gamble.red');
    (this.picks.children[1] as HTMLElement).textContent = t('gamble.black');
    q(this.lad, '.gmb-hint').textContent = t('gamble.pickHint');
    q(this.allin, '.gmb-allin-t').textContent = `⚠ ${t('gamble.allinTitle')} ⚠`;
    q(this.allin, '.gmb-allin-c').textContent = t('gamble.allinConfirm');
    q(this.allin, '.gmb-allin-x').textContent = t('gamble.allinCancel');
  }

  setHighStakes(on: boolean): void { this.hs.hidden = !on; }

  showOffer(amount: number): void {
    this.offerA.textContent = t('gamble.offer', { n: fmtCoins(amount) });
    this.offerBar.classList.remove('run');
    void this.offerBar.offsetWidth;
    this.offerBar.style.animationDuration = `${GAMBLE_OFFER_S}s`;
    this.offerBar.classList.add('run');
    this.offerEl.hidden = false;
  }
  hideOffer(): void { this.offerEl.hidden = true; }

  openLadder(pot: number): void {
    this.hideOffer();
    this.say.textContent = ''; this.say.className = 'gmb-say';
    this.setRung(0, pot, 'pick');
    this.lad.hidden = false;
  }
  /** `phase`: pick (waiting for a colour) · flip (card in the air) · done (ladder over). */
  setRung(step: number, pot: number, phase: 'pick' | 'flip' | 'done'): void {
    this.rungs.forEach((r, i) => { r.classList.toggle('done', i < step); r.classList.toggle('cur', phase !== 'done' && i === step); });
    this.pot.textContent = `${t('gamble.pot')} ${fmtCoins(pot)}`;
    this.pot.classList.toggle('dead', pot <= 0);
    this.next.textContent = phase === 'pick' && step < GAMBLE_STEPS ? t('gamble.next', { n: fmtCoins(pot * 2) }) : '';
    this.picks.style.visibility = phase === 'pick' ? 'visible' : 'hidden';
    this.collect.textContent = phase === 'pick' ? t('gamble.collect', { n: fmtCoins(pot) }) : '';
    if (phase === 'pick') this.card.classList.remove('up', 'tense', 'win', 'lose');
  }
  /** The card is in the air: shake it while the player waits. */
  tension(): void { this.card.classList.add('tense'); this.say.textContent = t('gamble.flipping'); this.say.className = 'gmb-say'; }
  flip(card: GambleCard, won: boolean): void {
    this.faceR.textContent = RANK[card.rank] ?? '';
    this.faceS.textContent = SUIT[card.suit] ?? '';
    this.face.classList.toggle('red', card.color === 'red');
    this.card.classList.remove('tense');
    this.card.classList.add('up', won ? 'win' : 'lose');
  }
  speak(text: string, tone: 'good' | 'bad' | ''): void { this.say.textContent = text; this.say.className = `gmb-say ${tone}`; }
  popPot(): void { this.pot.classList.remove('pop'); void this.pot.offsetWidth; this.pot.classList.add('pop'); }
  closeLadder(): void { this.lad.hidden = true; }

  showAllIn(pocket: number, win: number): void {
    this.allinW.textContent = t('gamble.allinWarn', { n: fmtCoins(pocket), win: fmtCoins(win) });
    this.allin.hidden = false;
  }
  hideAllIn(): void { this.allin.hidden = true; }

  /** A short result line, kept for `frames` render frames. */
  flash(text: string, tone: 'good' | 'bad' | 'gold', frames = 150): void {
    this.flashEl.textContent = text;
    this.flashEl.className = `gmb-flash gmb-pan ${tone}`;
    this.flashEl.hidden = false;
    this.flashT = frames;
  }
  /** Per-frame upkeep (the machine feeds its render loop): expires the flash line. */
  frame(): void { if (this.flashT > 0 && --this.flashT === 0) this.flashEl.hidden = true; }

  get ladderOpen(): boolean { return !this.lad.hidden; }
  dispose(): void { this.root.remove(); }
}
