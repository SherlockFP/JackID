/**
 * Debt Run session (single player, TECH §8): builds the pit (`createWorld` places the registered machines into the GDD
 * slots), the FPS player at the lobby spawn, the run (`createRun` / `resumeRun`) and the HUD, and drives them each step.
 * It also wires the live systems into the pit: the tycoon service-plate badges and the Upgrade Ledger (U), the totems
 * (B to place or pick up, their floor rings), the light-horror director with its ActorDirector (fed dread and time),
 * and the journal (J). Owned by the in-game state (`inGameState.ts`), which handles pause, the Intermission panel,
 * the story runtime and the run-end hand-off.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import type { Action } from '@/core/input/types';
import { bus, type GameEvents } from '@/core/events';
import { log } from '@/core/log';
import { fmtCoins, t } from '@/core/i18n';
import type { InGameParams } from '@/core/states';
import type { InstanceId, Unsub } from '@/core/types';
import { createRng, hashSeed } from '@/core/rng';
import { makeFog } from '@/core/renderer/fog';
import type { UIOverlayX } from '@/core/ui/ui';
import type { KitX } from '@/kit';
import { createCover, type CoverProp } from '@/world/props/cover';
import { createNewMarquee, createTableMark, type NewMarqueeProp } from '@/world/props/cover';
import { tallyAdd } from '@/game/story/notes';
import { unlockNightOf, isNew, effectiveNight, newOnFloorText, machineName, opensText } from '@/game/progression';
import type { InteractableX } from '@/world/interact';
import { createWorld, type WorldHost } from '@/world/world';
import { rosterFor, type RosterCandidate } from '@/world/layout';
import type { SlotChange } from '@/world/world';
import { createLocalPlayer, type LocalPlayerHost } from '@/player/local';
import { createHud, type Hud, type HudPrompt } from '@/menu/hud';
import { createRun, resumeRun, type DebtRun } from '@/game/run';
import { playableMode } from '@/game/modes';
import { BADGE_GROUP_NAME, disposeBadges, popBadges, syncServiceBadges } from '@/game/tycoon/badges';
import { mountLedger, type LedgerHandle } from '@/game/tycoon/ledger';
import { TotemView } from '@/game/items';
import { EVENT_DREAD, createHorror, type DreadEventKind, type HorrorDirector, type HorrorState } from '@/game/horror';
import { openJournal } from '@/game/story';
import { createActorDirector } from '@/world/actors';
import { charmDef } from '@/game/charms/engine';
import * as registry from '@/machines/_base/registry';
import { suitOf } from '@/game/suits';
import { profileOf } from '@/game/data/machineProfiles';
import { paceOf } from '@/game/pace';
import type { QuotaBoardProp } from '@/world/types';
import { startOnlineHooks } from './mp';
import { nightPaid } from '@/machines/debt_terminal/night';
import { SeatHud } from '@/machines/_base/seatHud';
import { startTutorial, type Tutorial } from '@/game/tutorial';
import { holdClockFor } from '@/game/clockHold';
import { startRoomsHost } from './roomsHost';
import { startGrandCasino } from './grandCasino';
import { applyEffects, effectsOf } from '@/game/hollow/rules';
import { lordsHooks } from '@/machines/lordstable';
import { hollowDoor } from '@/world/hollow';
import { mountDraftUi } from '@/game/draft.ui';
import { mountNightCardsUi } from '@/game/nightCards.ui';
import { mountScrounge } from '@/game/scrounge';
import { mountFood } from '@/game/food';
import { mountOverpayUi } from '@/game/overpay.ui';
import { mountPhoneUi } from '@/game/home/phone.ui';
import { mountEvening, type Evening } from '@/game/home/evening';

export interface DebtSession {
  readonly world: WorldHost;
  readonly player: LocalPlayerHost;
  readonly run: DebtRun;
  readonly hud: Hud;
  /** True once the initial machine build has finished (the Intermission waits for it). */
  readonly ready: () => boolean;
  fixedUpdate(dt: number): void;
  frame(dt: number, alpha: number): void;
  dispose(): void;
}

const LOBBY_FOG = 0x1c1610;
const LOBBY_NEAR = 6;
const LEDGER_PANEL = 'ingame-ledger';
/** Reach for B (pick up a placed totem) and the fallback badge origin (slot-group space, metres). */
const TOTEM_REACH_M = 2.5;
const BADGE_FALLBACK = new THREE.Vector3(0, 1.2, 0.7);
const BADGE_POP_S = 0.45;
/** Brighter Bulbs upgrade (GDD §6.2): −2 dread per level, read by the horror meter. */
const BULBS_UPGRADE = 'imp_brighter_bulbs';
/** The Lobby crate spot (CRATE DROP): the centre of the Lobby zone (layout.ts, `lobby` rect x -11..11, z 2..20). */
const LOBBY_CRATE = { x: 0, z: 11 } as const;
/** The floor event keys: K stakes the carried keepsake at a seat, N takes a dare or bids, E opens the crate in reach. */
const KEEPSAKE_ACTION = 'keepsake' as Action;
const FLOOR_ACT_ACTION = 'floorAct' as Action;
/** THE CROOKED TABLE: C at (or facing, or sitting at) a marked table calls the cheat. */
const CALL_CHEAT_ACTION = 'callCheat' as Action;
const CROOKED_P = 'event.watch.crooked_table.';
const isCursed = (id: string): boolean => charmDef(id)?.rarity === 'cursed';

/** Every registered machine with the facts the Pit Deck line-up reads (WAVE8 item 8). */
function rosterCandidates(): RosterCandidate[] {
  return registry.all().map(({ def }) => ({
    id: def.id, slotSize: def.slotSize, tier: def.tier, seats: def.seats, shared: def.shared, modes: def.modes,
    suit: suitOf(def.id) ?? undefined, volatility: profileOf(def.id)?.cls,
  }));
}

export function startDebtSession(params: InGameParams, scene: THREE.Scene): DebtSession {
  // The run exists before the world: machines read `app.run` (wallet, tycoon) while they are built.
  const banner = (text: string, o?: { color?: string; hold?: number; size?: 8 | 16 | 24 }): void => {
    void (app.ui as UIOverlayX).banner(text, o);
  };
  // THE EVENING (wave 69): a solo run has the Home layer (the lift home, the phone, the doomed ride); an online run keeps the old
  // lever and the trapdoor. The run decides what the flag means for the mode (the Free Casino has no Evening).
  const home = !params.online;
  const run = (params.resume ? resumeRun(app.save, { banner, home }) : null)
    ?? createRun({
      seed: params.seed, mode: playableMode(params.mode), save: app.save, banner, home,
      // THE PROLOGUE (wave 72): a fresh solo run opens in the apartment before Night 1 Watch 1.
      prologue: !params.resume && !params.online,
      // Only the starting kit travels from the menu for now; the MP lobby config is not applied here yet.
      cfg: params.config?.kit || params.config?.stake || params.config?.daily
        ? { kit: params.config.kit, stake: params.config.stake, daily: params.config.daily }
        : undefined,
    });
  app.run = run;
  // The UI the run's own state asks for. Their disposers run with the session (the draft ticker and the phone chip must not outlive it).
  const mounts: Unsub[] = [];
  // The Starter Draft: a fresh run opens it, and a resumed Night 1 does too while the offer can still open or is open (a saved open
  // offer holds the Bell, so without the panel the run would wait on a card nobody can take).
  if (!params.online && (!params.resume || run.starterPending() || run.starterDraft() !== null)) mounts.push(mountDraftUi(run));
  if (!params.online) mounts.push(mountNightCardsUi(run));
  if (run.homeOn) mounts.push(mountPhoneUi(run));
  mounts.push(mountOverpayUi(run));
  const self = run.selfId;
  // The Lords' table (the Hollow Door): the duel's end becomes run effects, its spent Tickets come off the run, and the door seals.
  lordsHooks.apply = (end) => {
    const r = app.run;
    if (!r) return;
    if ((end.spent ?? 0) > 0) r.spend('ticket', end.spent ?? 0, 'lordstable');
    applyEffects(effectsOf(end.ended, end.lord, end.calledCorrect), {
      forgiveQuota: (n) => r.forgiveQuota(n),
      takeRun: () => r.takeRun(),
      restoreSoulMark: () => r.restoreSoulMark(),
      bankObols: (m) => r.hollowBankObols(m),
    });
    r.hollowFinish(end.ended);
    if (end.ended !== 'left') hollowDoor()?.resolve(end.ended === 'won' ? 'won' : 'taken');
  };

  scene.background = new THREE.Color(LOBBY_FOG);
  scene.fog = makeFog(LOBBY_FOG, LOBBY_NEAR, app.save.data.settings.psx.drawDistance);

  // Pit Deck: a seeded line-up for the flexible pads (WAVE8 item 8). `randomLineup: false` keeps the GDD §8.6 layout.
  const lineup = run.mode === 'free' && run.config.randomLineup !== false ? rosterFor(run.seed, rosterCandidates(), run.mode) : undefined;
  const world = createWorld({ mode: run.mode, seed: run.seed, assign: lineup }, app.camera);
  scene.add(world.root);
  app.world = world;
  // Broke-state scrounge (wave 76): critters to catch and sell, and the wristwatch, when the pocket cannot cover a bet.
  // (the run class has cheapestBet; the public DebtRun interface does not list it)
  if (!params.online) mounts.push(mountScrounge(run as unknown as Parameters<typeof mountScrounge>[0], world));
  // food (wave 79): the fridge station at home and the bar meals
  if (!params.online) mounts.push(mountFood(run as unknown as Parameters<typeof mountFood>[0]));
  SeatHud.helpKeyLabel = () => app.input.keyLabel('m.help');
  run.attachWorld({
    machines: () => world.machines().map((m) => ({ instance: m.id, machineId: m.def.id, size: world.slot(m.id)?.size })),
    instancePos: (mid) => world.slot(mid)?.pos,
    locked: (mid) => world.isLocked(mid),
    lobbyCrate: () => LOBBY_CRATE,
  });

  const player = createLocalPlayer(app.camera);
  app.player = player;
  // Online runs spawn on the Mouth rows, one per seat (MP-only branch; single-player keeps the solo spawn).
  const spawn = params.online ? world.spawn('mouth', Math.max(0, app.net.selfId - 1)) : world.spawn('solo');
  player.teleport(new THREE.Vector3(spawn.pos[0], spawn.pos[1], spawn.pos[2]), spawn.yaw);
  app.input.setMode('walk');
  const online = params.online ? startOnlineHooks(scene, player, run) : null;
  // THE EVENING: the lift, the apartment's stations and the doomed ride (solo runs); the run owns the stage, this shows it
  const evening: Evening | null = run.homeOn ? mountEvening(run, world, player) : null;

  const hud = createHud();
  let ready = false;
  // A new run opens straight on Night 1 Watch 1 (the bell, then the floor). Intermissions only sit between Watches and Nights.
  let openingWatch = !params.resume && run.rules.timed;
  const offs: Unsub[] = [];
  // THE GRAND CASINO (wave 75): the jackpot wall, the prize case and the light show read this run
  offs.push(startGrandCasino(run, world));
  // Night 1 onboarding: first run only (its own flag), Debt Run only, never a resumed or online run.
  const tutorial: Tutorial | null = !params.resume && !params.online && run.rules.timed ? startTutorial({ world, run }) : null;

  // ── tycoon: service-plate badges (on the slot group, DECISIONS C26) ──────────────────────────────────
  const badgeKeys = new Map<InstanceId, string>();
  const pops: Array<{ g: THREE.Object3D; k: number }> = [];
  const plateAt = new THREE.Vector3();
  const syncBadge = (mid: InstanceId): void => {
    const g = world.slotGroup(mid);
    if (!g) return;
    const model = (world.machine(mid) as unknown as { model?: { anchors?: Record<string, THREE.Object3D> } } | undefined)?.model;
    const anchor = model?.anchors?.servicePlate;
    if (anchor) { anchor.updateWorldMatrix(true, false); anchor.getWorldPosition(plateAt); g.worldToLocal(plateAt); }
    else plateAt.copy(BADGE_FALLBACK);
    const key = run.tycoon.upgradesFor(mid).map((u) => u.level).join(',');
    const prev = badgeKeys.get(mid);
    badgeKeys.set(mid, key);
    const badges = syncServiceBadges(g, run.tycoon, mid, plateAt);
    if (prev !== undefined && prev !== key) pops.push({ g: badges, k: 0 });   // a purchase pops the plate
  };
  const clearBadge = (mid: InstanceId): void => {
    badgeKeys.delete(mid);
    const g = world.slotGroup(mid);
    if (!g) return;
    for (const c of g.children.filter((o) => o.name === BADGE_GROUP_NAME)) disposeBadges(c);
  };
  const syncAllBadges = (): void => { for (const m of world.machines()) syncBadge(m.id); };
  offs.push(world.onSlotChange((e: SlotChange) => {
    if (!ready) return;
    if (e.kind === 'removed') clearBadge(e.slot);
    else syncBadge(e.slot);
  }));
  offs.push(run.tycoon.onChange(() => { if (ready) syncAllBadges(); }));

  // ── totems: rings on the floor ───────────────────────────────────────────────────────────────────────
  const totemView = new TotemView(app.kit, world.root, (id) => run.totems.def(id));

  // ── Upgrade Ledger (U) ──────────────────────────────────────────────────────────────────────────────
  let ledger: LedgerHandle | null = null;
  let ledgerOpen = false;
  const closeLedger = (): void => {
    if (!ledgerOpen) return;
    ledgerOpen = false;
    ledger = null;
    app.ui.closePanel(LEDGER_PANEL);
    app.input.setMode('walk');
    void app.input.requestLock();
  };
  const openLedger = (): void => {
    if (ledgerOpen) { ledger?.close(); return; }
    const focus = world.interact.focused;
    const mid = world.seat?.mid ?? (focus && world.slot(focus.id) ? focus.id : null);
    if (!mid || !world.machine(mid)) { app.ui.toast(t('ingame.ledger.none'), 'warn'); return; }
    ledgerOpen = true;
    app.input.setMode('ui');
    app.input.exitLock();
    app.ui.panel(LEDGER_PANEL, (el) => {
      ledger = mountLedger(el, run.tycoon, mid, {
        onClose: closeLedger,
        toast: (text) => app.ui.toast(text, 'sys'),
        mods: run.machineMods,
      });
    });
  };

  // ── totems: B places the carried totem at your feet, or picks up the nearest placed one ─────────────
  const placeOrPickTotem = (): void => {
    const mine = run.totems.mine(self);
    const carried = mine.find((s) => s.pos === null);
    const p = player.pos;
    if (carried) {
      if (run.totems.place(carried.uid, [p.x, 0, p.z])) app.ui.toast(t('ingame.totem.placed'), 'sys');
      else app.ui.toast(t('ingame.totem.refused'), 'warn');
      return;
    }
    let best: { uid: string; d: number } | null = null;
    for (const s of mine) {
      if (!s.pos) continue;
      const d = Math.hypot(s.pos[0] - p.x, s.pos[2] - p.z);
      if (d <= TOTEM_REACH_M && (!best || d < best.d)) best = { uid: s.uid, d };
    }
    if (best && run.totems.pickup(best.uid)) app.ui.toast(t('ingame.totem.picked'), 'sys');
    else app.ui.toast(t('ingame.totem.none'), 'warn');
  };

  // ── horror director + its ActorDirector (started at enter, fed dread and time, disposed at exit) ─────
  const actors = createActorDirector({ kit: app.kit, scene: () => world.root });
  const settings = (): { calm: boolean; reduceFlashing: boolean; subtitles: boolean } => {
    const s = app.save.data.settings;
    return { calm: (s as { calm?: boolean }).calm === true, reduceFlashing: s.reduceFlashing, subtitles: s.subtitles };
  };
  const horror: HorrorDirector = createHorror({
    audio: app.audio,
    subtitle: (text, speaker, dur) => { if (text && dur) holdClockFor('horror', dur); app.ui.subtitle(text, speaker, dur); },
    lights: () => world.lights,
    actors,
    rng: createRng(hashSeed('horror', run.seed)),
    viewers: () => { const p = player.pos; return [{ pos: [p.x, p.y, p.z], camera: app.camera }]; },
    settings,
  });
  const horrorState = (): HorrorState => {
    const q = run.shift.quota();
    const sh = run.shift.state();
    const dur = sh.duration > 0 ? sh.duration : 1;
    const elapsed = 1 - Math.max(0, Math.min(dur, run.shift.timeLeft())) / dur;
    const cursed = run.charms(self).filter((c) => isCursed(c.id)).length;
    const bulbs = Number(run.tycoon.level(BULBS_UPGRADE)) || 0;
    return {
      night: run.night(),
      nightElapsed: Math.max(0, Math.min(1, elapsed)),
      deposit: q.deposited,
      quota: q.due,
      cursedCharms: cursed,
      brightBulbs: Math.max(0, Math.min(4, Math.round(bulbs))),
      charmRelief: Math.max(0, -run.mod('dread.add', 'run', 0)),
      luck: run.luck('run', self),
      badRun: run.buffs.has('bad_run', { pid: self }),
    };
  };
  offs.push(bus.on('shift:phase', ({ phase }) => {
    if (!ready) return;
    if (phase === 'lastCall') horror.pa();
    else if (phase === 'collection') horror.startDawnWalk(horrorState());
  }));
  offs.push(bus.on('quota:met', () => { horror.stopDawnWalk(); }));
  // THE CROOKED TABLE: what the run learned goes onto the Tally Sheet (a page of the journal)
  offs.push(bus.on('crooked:sheet', ({ key, vars }) => { tallyAdd(key, vars); }));
  offs.push(bus.on('event:start', ({ id }: GameEvents['event:start']) => {
    if (id in EVENT_DREAD) horror.notify(id as DreadEventKind);
  }));

  // ── input: journal (J), upgrade ledger (U), totems (B) — walk mode only ──────────────────────────────
  offs.push(app.input.on('journal', (down) => { if (down && app.input.mode === 'walk') openJournal(); }));
  offs.push(app.input.on('upgrade', (down) => { if (down && app.input.mode === 'walk') openLedger(); }));
  offs.push(app.input.on('place', (down) => { if (down && app.input.mode === 'walk') placeOrPickTotem(); }));

  // ── prompt, flush, ready ─────────────────────────────────────────────────────────────────────────────
  let promptKey = '';
  const updatePrompt = (): void => {
    const f = app.input.mode === 'walk' ? world.interact.focused : null;
    const key = f ? `${f.id}|${f.label()}` : '';
    if (key === promptKey) return;
    promptKey = key;
    const p: HudPrompt | null = f ? { action: 'interact', label: f.label(), sub: f.sub?.() } : null;
    hud.setPrompt(p);
  };

  // special rooms: the world's grille / locker / vent seam, toasts, the Boiler chip, Mira's call
  offs.push(startRoomsHost(run, world));

  const flush = (): void => run.flush();
  window.addEventListener('pagehide', flush);

  world.ready.then(() => {
    ready = true;
    syncAllBadges();
  }, (e: unknown) => log.error('ingame', 'world build failed', e));
  void world.prebuild().catch((e: unknown) => log.error('ingame', 'prebuild failed', e));
  app.ui.toast(t('ingame.loading'), 'sys', 2);

  const idle = run.takeIdleReport();
  if (idle && idle.earned > 0) app.ui.toast(t('ingame.idle', { n: Math.round(idle.earned) }), 'sys', 3);

  // The quota board above the Well: numbers plus the NEED / PULL line (WAVE8 item 5). Repainted only when the text would change.
  let boardAcc = 0;
  let boardKey = '';
  const syncBoard = (): void => {
    const board = world.prop<QuotaBoardProp>('quotaBoard');
    if (!board) return;
    const q0 = run.shift.quota();
    const paid = nightPaid(run);
    const q = paid ? { ...q0, due: 0, deposited: 0, ratio: 1, met: true } : q0;
    const pace = run.rules.quota && !paid
      ? paceOf({ due: q.due, deposited: q.deposited, pocket: run.wallet(), pullsLeft: Number.isFinite(run.pulls()) ? run.pulls() : 0 })
      : null;
    const timeLeft = Math.max(0, Math.ceil(run.shift.timeLeft()));
    const lastCall = run.shift.phase === 'lastCall';
    const key = `${q.due}|${q.deposited}|${timeLeft}|${lastCall ? 1 : 0}|${JSON.stringify(pace)}`;
    if (key === boardKey) return;
    boardKey = key;
    board.set({ due: q.due, deposited: q.deposited, ratio: q.ratio, timeLeft, lastCall, pace });
  };

  // progressive floor: tarps over locked machines, NEW signs on today's openings
  const covers = new Map<string, CoverProp>();
  const marquees = new Map<string, NewMarqueeProp>();
  /** THE CROOKED TABLE: the small numbered plates over the three tables, and the plate/habit tells already shown. */
  const tableMarks = new Map<string, NewMarqueeProp>();
  const tellsShown = new Set<string>();
  /** The machine kind the player sits at or faces (null when neither). */
  const tableUnderFoot = (): string | null => {
    const focus = world.interact.focused;
    const mid = world.seat?.mid ?? (app.input.mode === 'walk' && focus && world.slot(focus.id) ? focus.id : null);
    return mid ? (world.machine(mid)?.def.id ?? null) : null;
  };
  const buyers = new Map<string, () => void>();
  let coverAcc = 0, lastNight = 0, summaryShown = false;
  /** E on a tarp: BUY the machine with coins (tycoon). The sheet itself lifts on the next lock refresh. */
  const addBuyer = (instance: InstanceId, machineId: string, c: CoverProp, g: THREE.Object3D): void => {
    g.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(c.root);
    const mid = machineId as Parameters<typeof run.buyPriceOf>[0];
    const x: InteractableX = {
      id: `buy:${instance}`, box, priority: 10, maxDist: 3,
      // the tarp always answers E: "BUY <name> · <price>" when buyable, otherwise the greyed "OPENS NIGHT n" plate line
      // (a machine parked behind a shut wing has no visible sheet, so its BUY prompt stays off until the wing opens)
      enabled: () => world.seat == null && world.isZoneOpen(world.slot(instance)?.zone ?? 'well'),
      label: () => {
        const price = run.buyPriceOf(mid);
        return price > 0 ? t('cover.buy', { name: machineName(mid), price: fmtCoins(price) }) : opensText(mid, run.seed);
      },
      sub: () => {
        const price = run.buyPriceOf(mid);
        if (price <= 0) return '';
        const have = run.wallet(self);
        return have >= price ? t('prog.buy.sub', { n: unlockNightOf(mid, run.seed) }) : t('prog.buy.short', { need: fmtCoins(price - have), name: machineName(mid) });
      },
      disabled: () => { const price = run.buyPriceOf(mid); return price <= 0 || run.wallet(self) < price; },
      onInteract: () => {
        const price = run.buyPriceOf(mid);
        if (price <= 0) { app.ui.toast(opensText(mid, run.seed), 'warn'); return; }
        if (!run.buyMachine(mid)) { app.ui.toast(t('prog.buy.short', { need: fmtCoins(Math.max(1, price - run.wallet(self))), name: machineName(mid) }), 'warn'); app.audio.play('buzzer', { vol: 0.4 }); return; }
        app.audio.play('purchase');
        coverAcc = 1;   // lift the sheet on the next frame
      },
    };
    buyers.set(instance, world.interact.add(x));
  };
  /** THE CROOKED TABLE: at a marked table the player reads its plate, and its dealer once they have played there (one new line per pass). */
  const showTells = (crooked: NonNullable<ReturnType<typeof run.crookedView>>): void => {
    const here = tableUnderFoot();
    const tb = here === null ? undefined : crooked.tables.find((x) => x.mid === here);
    if (!tb) return;
    for (const tell of tb.tells) {
      if (tell.channel === 'tally') continue;   // the maths goes straight to the Sheet (run.ts)
      const id = `${tell.key}|${tell.vars?.t ?? 0}`;
      if (tellsShown.has(id)) continue;
      tellsShown.add(id);
      tallyAdd(tell.key, tell.vars);
      app.ui.toast(t(CROOKED_P + tell.key, tell.vars), 'info', 4);
      return;
    }
  };
  const syncCovers = (): void => {
    const crooked = run.crookedView();
    if (!crooked) tellsShown.clear(); else showTells(crooked);
    const night = effectiveNight(run.night(), run.nightPaid, false);
    if (night !== lastNight) {
      const txt = newOnFloorText(night, run.seed);
      if (txt) app.ui.toast(txt, 'sys', 4);
      lastNight = night;
    }
    // the Night summary line for the tycoon: what the owned machines paid tonight (once per paid Night)
    if (run.nightPaid && !summaryShown) {
      summaryShown = true;
      const cut = run.nightLedger().cut;
      if (cut > 0) app.ui.toast(t('prog.summary', { n: fmtCoins(cut) }), 'good', 5);
    } else if (!run.nightPaid) summaryShown = false;
    for (const m of world.machines()) {
      const g = world.slotGroup(m.id), size = world.slot(m.id)?.size;
      if (!g || !size) continue;
      const mid = m.def.id;
      const locked = world.isLocked(m.id);
      const cov = covers.get(m.id);
      if (cov && run.mode !== 'free') { const p = run.buyPriceOf(mid); cov.setPrice(p > 0 ? fmtCoins(p) : null); }
      if (locked && !cov) {
        const c = createCover(app.kit as KitX, { size, night: unlockNightOf(mid, run.seed), id: m.id });
        g.add(c.root); covers.set(m.id, c);
        if (run.mode !== 'free') addBuyer(m.id, mid, c, g);
      } else if (!locked && cov && cov.covered) {
        // The lift is a tween driven by cov.update(dt) in frame(): the cover stays in `covers` until it has landed
        // (deleting it first froze the tarp in place over the opened machine).
        buyers.get(m.id)?.(); buyers.delete(m.id);
        void cov.setCovered(false, 1.2).then(() => { covers.delete(m.id); g.remove(cov.root); cov.dispose(); });
      }
      const wantNew = !locked && run.mode !== 'free' && isNew(mid, night, run.seed);
      const mq = marquees.get(m.id);
      if (wantNew && !mq) { const n = createNewMarquee(app.kit as KitX, { size, id: m.id }); g.add(n.root); marquees.set(m.id, n); }
      else if (!wantNew && mq) { g.remove(mq.root); mq.dispose(); marquees.delete(m.id); }
      // THE CROOKED TABLE: a numbered plate over each of the three tables while the event runs
      const tableNo = crooked && !locked ? crooked.tables.findIndex((tb) => tb.mid === mid) + 1 : 0;
      const tm = tableMarks.get(m.id);
      if (tableNo > 0 && !tm) { const n = createTableMark(app.kit as KitX, { size, text: t(`${CROOKED_P}mark`, { t: tableNo }), id: m.id }); g.add(n.root); tableMarks.set(m.id, n); }
      else if (tableNo === 0 && tm) { g.remove(tm.root); tm.dispose(); tableMarks.delete(m.id); }
    }
  };

  // THE FLOOR EVENTS and THE KEEPSAKE STAKE (wave 75), read once per step: K stakes the carried keepsake at the seat, N takes a
  // dare or bids, and E opens a CRATE DROP in reach (the crate reads the player's floor position, not the seat).
  const floorKeys = (): void => {
    const here = tableUnderFoot();
    const marked = here !== null && run.isCrookedTable(here as Parameters<typeof run.isCrookedTable>[0]);
    hud.setCallHint(marked);
    if (marked && app.input.pressed(CALL_CHEAT_ACTION)) run.floorCall(here as Parameters<typeof run.floorCall>[0]);
    if (app.input.pressed(KEEPSAKE_ACTION)) { const seat = world.seat; if (seat) run.keepsakeStake(seat.mid); }
    if (app.input.pressed(FLOOR_ACT_ACTION)) run.floorAct();
    const p = player.pos;
    run.floorCrate({ x: p.x, z: p.z }, app.input.pressed('interact'));
  };

  return {
    world, player, run, hud,
    ready: () => ready,
    fixedUpdate(dt) {
      player.fixedUpdate(dt);
      world.fixedUpdate(dt);
      floorKeys();
      run.tick(dt);
      evening?.update(dt);
      horror.update(dt, horrorState(), dt);
      online?.fixedUpdate(dt);
    },
    frame(dt, alpha) {
      boardAcc += dt;
      coverAcc += dt;
      if (ready && coverAcc >= 0.5) { coverAcc = 0; syncCovers(); }
      for (const c of covers.values()) c.update?.(dt);
      for (const n of marquees.values()) n.update?.(dt);
      for (const n of tableMarks.values()) n.update?.(dt);
      if (ready && boardAcc >= 0.25) { boardAcc = 0; syncBoard(); }
      if (openingWatch && ready) {
        openingWatch = false;
        if (run.shift.phase === 'intermission' && run.startWatch()) {
          void (app.ui as UIOverlayX).banner(t('ingame.night', { n: run.night() }));
        }
      }
      player.frame(dt, alpha);
      tutorial?.update(dt);
      world.frame(dt, app.time.sim);
      online?.frame(dt);
      totemView.sync(run.totems.list());
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.k += dt / BADGE_POP_S;
        popBadges(p.g, Math.min(1, p.k));
        if (p.k >= 1) pops.splice(i, 1);
      }
      hud.update(dt);
      updatePrompt();
    },
    dispose() {
      window.removeEventListener('pagehide', flush);
      for (const off of offs.splice(0)) off();
      for (const off of buyers.values()) off();
      buyers.clear();
      ledgerOpen = false;
      ledger = null;
      app.ui.closePanel(LEDGER_PANEL);
      tutorial?.dispose();
      horror.dispose();
      for (const a of actors.all()) actors.despawn(a);
      totemView.dispose();
      evening?.dispose();
      for (const off of mounts.splice(0)) off();
      run.dispose();
      online?.dispose();
      hud.setPrompt(null);
      hud.dispose();
      player.dispose();
      scene.remove(world.root);
      world.dispose();
      run.flush();
      app.world = null; app.player = null; app.run = null;
    },
  };
}
