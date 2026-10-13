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
import { bus, type GameEvents } from '@/core/events';
import { log } from '@/core/log';
import { t } from '@/core/i18n';
import type { InGameParams } from '@/core/states';
import type { InstanceId, Unsub } from '@/core/types';
import { createRng, hashSeed } from '@/core/rng';
import { makeFog } from '@/core/renderer/fog';
import type { UIOverlayX } from '@/core/ui/ui';
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
  const run = (params.resume ? resumeRun(app.save, { banner }) : null)
    ?? createRun({
      seed: params.seed, mode: playableMode(params.mode), save: app.save, banner,
      // Only the starting kit travels from the menu for now; the MP lobby config is not applied here yet.
      cfg: params.config?.kit ? { kit: params.config.kit } : undefined,
    });
  app.run = run;
  const self = run.selfId;

  scene.background = new THREE.Color(LOBBY_FOG);
  scene.fog = makeFog(LOBBY_FOG, LOBBY_NEAR, app.save.data.settings.psx.drawDistance);

  // Pit Deck: a seeded line-up for the flexible pads (WAVE8 item 8). `randomLineup: false` keeps the GDD §8.6 layout.
  const lineup = run.config.randomLineup !== false ? rosterFor(run.seed, rosterCandidates(), run.mode) : undefined;
  const world = createWorld({ mode: run.mode, seed: run.seed, assign: lineup }, app.camera);
  scene.add(world.root);
  app.world = world;
  run.attachWorld({
    machines: () => world.machines().map((m) => ({ instance: m.id, machineId: m.def.id, size: world.slot(m.id)?.size })),
    instancePos: (mid) => world.slot(mid)?.pos,
  });

  const player = createLocalPlayer(app.camera);
  app.player = player;
  // Online runs spawn on the Mouth rows, one per seat (MP-only branch; single-player keeps the solo spawn).
  const spawn = params.online ? world.spawn('mouth', Math.max(0, app.net.selfId - 1)) : world.spawn('solo');
  player.teleport(new THREE.Vector3(spawn.pos[0], spawn.pos[1], spawn.pos[2]), spawn.yaw);
  app.input.setMode('walk');
  const online = params.online ? startOnlineHooks(scene, player, run) : null;

  const hud = createHud();
  let ready = false;
  // A new run opens straight on Night 1 Watch 1 (the bell, then the floor). Intermissions only sit between Watches and Nights.
  let openingWatch = !params.resume && run.rules.timed;
  const offs: Unsub[] = [];

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
    subtitle: (text, speaker, dur) => app.ui.subtitle(text, speaker, dur),
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
    const q = run.shift.quota();
    const pace = run.rules.quota
      ? paceOf({ due: q.due, deposited: q.deposited, pocket: run.wallet(), pullsLeft: Number.isFinite(run.pulls()) ? run.pulls() : 0 })
      : null;
    const timeLeft = Math.max(0, Math.ceil(run.shift.timeLeft()));
    const lastCall = run.shift.phase === 'lastCall';
    const key = `${q.due}|${q.deposited}|${timeLeft}|${lastCall ? 1 : 0}|${JSON.stringify(pace)}`;
    if (key === boardKey) return;
    boardKey = key;
    board.set({ due: q.due, deposited: q.deposited, ratio: q.ratio, timeLeft, lastCall, pace });
  };

  return {
    world, player, run, hud,
    ready: () => ready,
    fixedUpdate(dt) {
      player.fixedUpdate(dt);
      world.fixedUpdate(dt);
      run.tick(dt);
      horror.update(dt, horrorState(), dt);
      online?.fixedUpdate(dt);
    },
    frame(dt, alpha) {
      boardAcc += dt;
      if (ready && boardAcc >= 0.25) { boardAcc = 0; syncBoard(); }
      if (openingWatch && ready) {
        openingWatch = false;
        if (run.shift.phase === 'intermission' && run.startWatch()) {
          void (app.ui as UIOverlayX).banner(t('ingame.night', { n: run.night() }));
        }
      }
      player.frame(dt, alpha);
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
      ledgerOpen = false;
      ledger = null;
      app.ui.closePanel(LEDGER_PANEL);
      horror.dispose();
      for (const a of actors.all()) actors.despawn(a);
      totemView.dispose();
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
