/**
 * Party lobby = the Lift (GDD §9.5), as a small 3D room. Players stand as mannequins in a row under spotlights, a READY lamp
 * hangs over each seat, the roster / settings / chat run on a CRT that hangs from the ceiling, and the host pulls the lever
 * to START. The host sets the mode and max players on the CRT (click, or F2 / F3). The host starts the run (`start` to
 * everyone, then `app.go('ingame', { online: true })`); clients follow the `start` message.
 * Entered after a successful host or join (`role`). Keep the factory name `createLobbyState`.
 */
import * as THREE from 'three';
import type { AppStateHandler, StateParams } from '@/core/states';
import { app } from '@/core/app';
import { has, t } from '@/core/i18n';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import type { GameMode, PlayerId, Unsub } from '@/core/types';
import type { PlayerInfo, RunConfig } from '@/net/protocol';
import type { MannequinActor } from '@/kit/types';
import { CHAT_LINES, CHAT_MAX, MP_MAX_MAX, MP_MAX_MIN, MP_MODES, defaultRunConfig, roomSeed } from './mp/config';
import { CrtRig } from './mp/crt';
import { HitMap, PHOS, PIX, SCREEN_H, SCREEN_W, box, button, makeScreenCanvas, say, sayFit, wrapLines, type ScreenCanvas } from './mp/crtArt';

const SEAT_GAP = 1.15;
const CEIL_Y = 5;
const CAM_FOV = 50;
const CRT_POS = new THREE.Vector3(0, 1.3, -1.25);      // hanging CRT: the body centre sits 1.6 above this
const LEVER_POS = new THREE.Vector3(4.7, 0.3, -0.4);
const SEATS = MP_MAX_MAX;
const ENAMEL = 0x6a0c1c;
const BRASS_DIM = 0x6b5424;
const BRASS = 0xc9a040;

/** Seat centre for seat `i` of a row of `n` (the row is centred on x = 0). */
const seatX = (i: number, n: number): number => (i - (n - 1) / 2) * SEAT_GAP;

interface Seat {
  readonly x: number;
  readonly spot: THREE.SpotLight;
  readonly lampMat: THREE.MeshBasicMaterial;
  readonly ring: THREE.Mesh;
  readonly plate: ScreenCanvas;
  plateName: string;
}

interface Rec {
  readonly actor: MannequinActor;
  seat: number;
  ready: boolean;
  played: boolean | null;
}

interface LobbyView {
  update(dt: number): void;
  dispose(): void;
}

/** Turn a `start` (host) or local decision into the in-game params. */
function beginRun(mode: GameMode, seed: number, cfg: RunConfig): void {
  void app.go('ingame', { mode, seed, online: true, config: cfg });
}

export function createLobbyState(): AppStateHandler<'lobby'> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0a09);
  scene.fog = new THREE.Fog(0x0b0a09, 11, 24);
  let view: LobbyView | null = null;

  return {
    enter(params: StateParams['lobby']) {
      if (!app.net.room) {
        void app.go('menu', { toast: t('mp.lobby.noRoom') });
        return;
      }
      view = openLobby(params.role, scene);
    },
    exit() {
      view?.dispose();
      view = null;
    },
    fixedUpdate() {},
    frame(dt) {
      view?.update(dt);
      app.renderer.render(scene, app.camera);
    },
  };
}

function openLobby(role: 'host' | 'client', scene: THREE.Scene): LobbyView {
  const net = app.net;
  const room = net.room!;
  const isHost = role === 'host' && net.isHost;
  const offs: Unsub[] = [];
  const built: THREE.Object3D[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const canvases: ScreenCanvas[] = [];
  const recs = new Map<PlayerId, Rec>();
  const log: Array<{ kind: 'chat' | 'sys'; text: string }> = [];
  const hits = new HitMap();
  let mode: GameMode = room.mode;
  let max = room.max;
  let runCfg: RunConfig = defaultRunConfig(mode);
  let started = false;
  let closed = false;
  let input = '';
  let notice = '';
  let time = 0;
  let leverT = -1;
  let hoverHit = '';
  const pointer = new THREE.Vector2();
  const ray = new THREE.Raycaster();

  // ── the room ───────────────────────────────────────────────────────────────────────────────

  const put = <T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0): T => {
    o.position.set(x, y, z);
    scene.add(o);
    built.push(o);
    return o;
  };
  const boxMesh = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh => {
    const g = new THREE.BoxGeometry(w, h, d);
    geos.push(g);
    return put(new THREE.Mesh(g, psxMaterial({ color })), x, y, z);
  };
  const plane = (w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh => {
    const g = new THREE.PlaneGeometry(w, h);
    geos.push(g);
    const m = put(new THREE.Mesh(g, mat), x, y, z);
    m.rotation.x = rx;
    return m;
  };

  // floor, walls, ceiling
  plane(18, 18, psxMaterial({ color: 0x1d1412 }), 0, 0, 0, -Math.PI / 2);
  plane(18, 8, psxMaterial({ color: 0x2a0f1c }), 0, CEIL_Y / 2, -2.6);
  plane(18, 18, psxMaterial({ color: 0x0c0908 }), 0, CEIL_Y, 0, Math.PI / 2);
  boxMesh(12, 0.16, 0.4, BRASS_DIM, 0, CEIL_Y - 0.05, -1.4);
  // the hanging CRT: two chains from its top to the ceiling bar
  const chainTop = CRT_POS.y + 2.95;
  const chainBar = CEIL_Y - 0.05;
  const chainGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 4);
  geos.push(chainGeo);
  for (const x of [-1.15, 1.15]) {
    const chain = put(new THREE.Mesh(chainGeo, psxMaterial({ color: BRASS })), x, (chainTop + chainBar) / 2, CRT_POS.z);
    chain.scale.y = chainBar - chainTop;
  }

  const rig = new CrtRig({ stand: false, keyboard: false });
  rig.group.position.copy(CRT_POS);
  scene.add(rig.group);
  built.push(rig.group);

  // the lever on the right-hand pillar
  boxMesh(0.3, 1.4, 0.3, 0x2a2420, LEVER_POS.x, LEVER_POS.y + 0.65, LEVER_POS.z);
  const pivot = new THREE.Group();
  pivot.position.copy(LEVER_POS).add(new THREE.Vector3(0, 0.45, 0.3));
  scene.add(pivot);
  built.push(pivot);
  const rodGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.2, 8);
  geos.push(rodGeo);
  const rod = new THREE.Mesh(rodGeo, psxMaterial({ color: BRASS }));
  rod.position.y = 0.6;
  const knobGeo = new THREE.IcosahedronGeometry(0.15, 0);
  geos.push(knobGeo);
  const knob = new THREE.Mesh(knobGeo, psxMaterial({ color: isHost ? ENAMEL : 0x4a4a4a }));
  knob.position.y = 1.28;
  pivot.add(rod, knob);

  // seats: spotlight, ready lamp on a cord, floor ring and a name plate
  put(new THREE.HemisphereLight(0xfff0d0, 0x2a0a18, 0.9));
  const seats: Seat[] = [];
  const cordGeo = new THREE.CylinderGeometry(0.01, 0.01, 1, 4);
  geos.push(cordGeo);
  const lampGeo = new THREE.SphereGeometry(0.1, 8, 6);
  geos.push(lampGeo);
  const ringGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.02, 12);
  geos.push(ringGeo);
  for (let i = 0; i < SEATS; i++) {
    const x = seatX(i, SEATS);
    const spot = new THREE.SpotLight(0xffe2b0, 0, 12, 0.5, 0.6, 1.2);
    spot.position.set(x, CEIL_Y - 0.2, 1.8);
    const target = new THREE.Object3D();
    target.position.set(x, 1.0, 0);
    scene.add(target, spot);
    built.push(target, spot);
    spot.target = target;
    const cord = put(new THREE.Mesh(cordGeo, psxMaterial({ color: 0x111111 })), x, (CEIL_Y + 2.4) / 2, 0);
    cord.scale.y = CEIL_Y - 2.4;
    const lampMat = psxMaterial({ color: 0x5a1a1a, lit: false, unique: true }) as THREE.MeshBasicMaterial;
    put(new THREE.Mesh(lampGeo, lampMat), x, 2.4, 0);
    const ring = put(new THREE.Mesh(ringGeo, psxMaterial({ color: BRASS_DIM })), x, 0.01, 0);
    const plate = makeScreenCanvas(256, 64);
    canvases.push(plate);
    plane(0.9, 0.22, psxMaterial({ map: plate.tex, color: 0xffffff, lit: false, snap: false, affine: false, unique: true }), x, 0.02, 0.85, -Math.PI / 2);
    seats.push({ x, spot, lampMat, ring, plate, plateName: '' });
  }

  // ── people ─────────────────────────────────────────────────────────────────────────────────

  const nameOf = (pid: PlayerId): string => net.players.get(pid)?.name || `#${pid}`;

  function appendLine(kind: 'chat' | 'sys', who: string, text: string): void {
    log.push({ kind, text: kind === 'chat' ? `${who}: ${text}` : text });
    while (log.length > CHAT_LINES) log.shift();
  }

  /** Mannequins follow the roster; the seat order is the player id order. */
  function syncPeople(): void {
    const players: PlayerInfo[] = [...net.players.values()].sort((a, b) => a.id - b.id);
    for (const [pid, rec] of recs) {
      if (net.players.has(pid)) continue;
      rec.actor.dispose();
      scene.remove(rec.actor.root);
      recs.delete(pid);
    }
    players.forEach((p, i) => {
      let rec = recs.get(p.id);
      if (!rec) {
        const actor = app.kit.mannequin({ style: 'plain', color: p.color, clip: 'Idle_Loop', npc: false });
        scene.add(actor.root);
        rec = { actor, seat: i, ready: false, played: null };
        recs.set(p.id, rec);
      }
      rec.seat = i;
      rec.ready = p.ready;
    });
    for (let i = 0; i < SEATS; i++) {
      const seat = seats[i]!;
      const p = players[i];
      const name = p ? (p.name || `#${p.id}`) : '';
      if (name !== seat.plateName) {
        seat.plateName = name;
        seat.plate.paint((c, w, h) => {
          if (!name) return;
          sayFit(c, name, w / 2, 14, w - 16, PHOS.fg, 30, 'center');
        });
      }
    }
  }

  function syncSeats(): void {
    const list = players();
    for (let i = 0; i < SEATS; i++) {
      const seat = seats[i]!;
      const active = i < max;
      const p = list[i];
      const occupied = !!p;
      const ready = p?.ready === true;
      seat.ring.visible = active;
      seat.spot.intensity = active ? (occupied ? 9 : 2.2) : 0;
      seat.spot.color.set(occupied && ready ? 0xc8ffd6 : 0xffe2b0);
      seat.lampMat.color.set(!active ? 0x000000 : occupied && ready ? 0x7dff8e : occupied ? 0x5a1a1a : 0x2a1010);
    }
  }

  const players = (): PlayerInfo[] => [...net.players.values()].sort((a, b) => a.id - b.id);

  // ── the CRT ────────────────────────────────────────────────────────────────────────────────

  function paintCrt(c: CanvasRenderingContext2D, w: number, h: number): void {
    hits.clear();
    c.fillStyle = PHOS.bg;
    c.fillRect(0, 0, w, h);
    say(c, t('mp.lobby.title'), 18, 14, PHOS.fg, 12, 'left', PIX);
    say(c, t('mp.lobby.code', { code: room.id }), w - 18, 17, PHOS.cyan, 16, 'right');
    say(c, t('mp.lobby.roster', { n: net.players.size, max }), 18, 40, PHOS.dim, 16);
    say(c, `${t('mp.lobby.mode', { m: t(`mp.mode.${mode}`) })}  ${t('mp.lobby.max', { n: max })}`, w - 18, 40, PHOS.dim, 16, 'right');

    // roster, two columns
    const list = players();
    list.forEach((p, i) => {
      const col = i < 4 ? 0 : 1;
      const x = 18 + col * 248;
      const y = 62 + (i % 4) * 16;
      c.fillStyle = `#${(p.color & 0xffffff).toString(16).padStart(6, '0')}`;
      c.fillRect(x, y + 2, 10, 10);
      const tags = [p.host ? t('mp.lobby.host') : '', p.id === net.selfId ? t('mp.lobby.you') : ''].filter(Boolean).join(' ');
      sayFit(c, `${p.name || `#${p.id}`}${tags ? ` [${tags}]` : ''}`, x + 16, y, 150, p.id === net.selfId ? PHOS.cyan : PHOS.fg, 16);
      say(c, t(p.ready ? 'mp.lobby.lampOn' : 'mp.lobby.lampOff'), x + 226, y, p.ready ? PHOS.fg : PHOS.dim, 15, 'right');
    });
    if (list.length === 0) say(c, '-', 18, 62, PHOS.dim, 16);

    const me = net.players.get(net.selfId);
    button(c, hits, 'ready', me?.ready ? t('mp.lobby.unready') : t('mp.lobby.ready'), 18, 128, 128, 22, !!me?.ready);
    button(c, hits, 'mode', t('mp.lobby.mode', { m: t(`mp.mode.${mode}`) }), 152, 128, 128, 22, false, isHost ? PHOS.fg : PHOS.dim);
    button(c, hits, 'max', t('mp.lobby.max', { n: max }), 286, 128, 108, 22, false, isHost ? PHOS.fg : PHOS.dim);
    button(c, hits, 'leave', t('mp.lobby.leave'), 400, 128, 94, 22, false, PHOS.bad);

    const line = notice || (isHost ? t('mp.lobby.lever') : t('mp.lobby.hostOnly'));
    sayFit(c, line, 18, 158, w - 36, notice ? PHOS.warn : PHOS.dim, 15);

    box(c, 12, 178, w - 24, 162, PHOS.ink, PHOS.dim);
    const rows: Array<{ text: string; kind: 'chat' | 'sys' }> = [];
    for (const e of log) for (const s of wrapLines(c, e.text, w - 40, 16)) rows.push({ text: s, kind: e.kind });
    const visible = rows.slice(-9);
    visible.forEach((r, i) => say(c, r.text, 22, 184 + i * 17, r.kind === 'sys' ? PHOS.cyan : PHOS.fg, 16));

    box(c, 12, 346, w - 24, 22, PHOS.ink, PHOS.fg);
    const cursor = Math.floor(time * 2) % 2 === 0 ? '_' : ' ';
    sayFit(c, `> ${input}${cursor}`, 20, 350, w - 40, PHOS.hi, 16);
    for (const line2 of wrapLines(c, t('mp.lobby.hint3d'), w - 30, 13)) say(c, line2, w / 2, 372, PHOS.dim, 13, 'center');
  }

  // ── actions ────────────────────────────────────────────────────────────────────────────────

  const sendReady = (r: boolean): void => {
    net.send({ t: 'ready', r }, isHost ? net.selfId : 'host');
  };

  function toggleReady(): void {
    const me = net.players.get(net.selfId);
    sendReady(!(me?.ready ?? false));
  }

  function cycleMode(): void {
    if (!isHost) { notice = t('mp.lobby.hostOnly'); return; }
    mode = MP_MODES[(MP_MODES.indexOf(mode) + 1) % MP_MODES.length]!;
    runCfg = { ...runCfg, sharedBank: mode === 'coop' };
    net.send({ t: 'lcfg', mode, max, lateJoin: room.lateJoin, cfg: runCfg }, 'others');
  }

  function cycleMax(): void {
    if (!isHost) { notice = t('mp.lobby.hostOnly'); return; }
    const floor = Math.max(MP_MAX_MIN, net.players.size);
    let next = max + 1 > MP_MAX_MAX ? MP_MAX_MIN : max + 1;
    if (next < floor) next = floor;
    max = next;
    net.send({ t: 'lcfg', mode, max, lateJoin: room.lateJoin, cfg: runCfg }, 'others');
  }

  function startGame(): void {
    if (!isHost) { notice = t('mp.lobby.hostOnly'); return; }
    if (started || closed) return;
    started = true;
    leverT = 0;
    notice = '';
    app.audio.play('lever', { bus: 'ui', vol: 1 });
    const seed = roomSeed(room.id, Date.now(), app.save.data.profile.id);
    const cfg: RunConfig = { ...runCfg, sharedBank: mode === 'coop' };
    net.send({ t: 'start', mode, seed, cfg, at: net.hostTime() + 600 }, 'others');
    app.ui.toast(t('mp.lobby.starting'), 'sys', 2);
    // the lever travels down before the doors close
    window.setTimeout(() => { if (!closed) beginRun(mode, seed, cfg); }, 700);
  }

  function sendChat(): void {
    const text = input.trim().slice(0, CHAT_MAX);
    input = '';
    if (!text) return;
    if (isHost) {
      net.send({ t: 'chat', from: net.selfId, text }, 'others');
      appendLine('chat', nameOf(net.selfId), text);
    } else {
      net.send({ t: 'chat', text }, 'host');
    }
  }

  const leave = (): void => {
    if (closed) return;
    closed = true;
    net.leave('left');
    void app.go('menu', undefined);
  };

  // ── input ──────────────────────────────────────────────────────────────────────────────────

  const onKey = (e: KeyboardEvent): void => {
    if (closed) return;
    switch (e.code) {
      case 'Escape': e.preventDefault(); leave(); return;
      case 'F1': e.preventDefault(); toggleReady(); return;
      case 'F2': e.preventDefault(); cycleMode(); return;
      case 'F3': e.preventDefault(); cycleMax(); return;
      case 'F4': e.preventDefault(); startGame(); return;
      case 'Enter': case 'NumpadEnter': e.preventDefault(); sendChat(); return;
      case 'Backspace': e.preventDefault(); input = input.slice(0, -1); return;
      default: break;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (input.length < CHAT_MAX) input += e.key;
    }
  };

  /** Raycast the canvas: the lever, the hanging CRT (returns its canvas hit id) or nothing. */
  const pick = (e: PointerEvent): { lever: boolean; id: string | null } => {
    const r = app.canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1));
    ray.setFromCamera(pointer, app.camera);
    const hit = ray.intersectObjects([knob, rod, rig.glass], false)[0];
    if (!hit) return { lever: false, id: null };
    if (hit.object === rig.glass && hit.uv) {
      return { lever: false, id: hits.at(hit.uv.x * SCREEN_W, (1 - hit.uv.y) * SCREEN_H) };
    }
    return { lever: true, id: null };
  };

  const onDown = (e: PointerEvent): void => {
    if (closed) return;
    void app.audio.resume();
    const p = pick(e);
    if (p.lever) { startGame(); return; }
    switch (p.id) {
      case 'ready': toggleReady(); break;
      case 'mode': cycleMode(); break;
      case 'max': cycleMax(); break;
      case 'leave': leave(); break;
      default: break;
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (closed) return;
    const p = pick(e);
    const id = p.lever ? 'lever' : (p.id ?? '');
    if (id !== hoverHit) {
      hoverHit = id;
      if (id) app.audio.play('hover', { bus: 'ui', vol: 0.25 });
    }
    app.canvas.style.cursor = id ? 'pointer' : '';
  };

  window.addEventListener('keydown', onKey);
  app.canvas.addEventListener('pointerdown', onDown);
  app.canvas.addEventListener('pointermove', onMove);
  app.input.setMode('ui');

  // ── camera ─────────────────────────────────────────────────────────────────────────────────

  const prevFov = app.camera.fov;
  app.camera.fov = CAM_FOV;
  app.camera.updateProjectionMatrix();

  // ── network: roster, settings, chat and the start signal ──────────────────────────────────

  const refresh = (): void => {
    syncPeople();
    syncSeats();
  };

  offs.push(net.on('pjoin', (m) => { appendLine('sys', '', t('mp.lobby.joined', { name: m.p.name })); refresh(); }));
  offs.push(net.on('pupd', () => refresh()));
  offs.push(net.on('pleave', (m) => {
    appendLine('sys', '', t('mp.lobby.left', { name: nameOf(m.id) }));
    refresh();
  }));
  offs.push(net.on('lcfg', (m) => { mode = m.mode; max = m.max; runCfg = m.cfg; refresh(); }));
  offs.push(net.on('chat', (m, from) => { appendLine('chat', nameOf(m.from ?? from), m.text); }));
  offs.push(net.on('sys', (m) => {
    const key = has(`mp.${m.key}`) ? `mp.${m.key}` : has(m.key) ? m.key : 'mp.sys.generic';
    appendLine('sys', '', t(key, { ...(m.vars ?? {}), text: m.key }));
  }));
  offs.push(net.on('start', (m) => {
    if (isHost || started || closed) return;
    started = true;
    leverT = 0;
    app.audio.play('lever', { bus: 'ui', vol: 1 });
    window.setTimeout(() => { if (!closed) beginRun(m.mode, m.seed, m.cfg); }, 700);
  }));
  offs.push(net.on('kick', (m) => {
    if (closed) return;
    closed = true;
    app.net.leave(m.reason ?? 'kicked');
    void app.go('menu', { toast: t('mp.lobby.kicked') });
  }));
  offs.push(net.on('close', (m) => {
    if (closed) return;
    closed = true;
    const key = m.reason === 'hostQuit' ? 'mp.close.hostQuit' : m.reason === 'error' ? 'mp.close.error' : 'mp.close.hostLeft';
    void app.go('menu', { toast: t(key) });
  }));

  refresh();
  appendLine('sys', '', t('mp.sys.joined', { name: nameOf(net.selfId) }));
  let shownNotice = 0;

  return {
    update(dt: number) {
      time += dt;
      // the lever: down and back up with a bounce
      if (leverT >= 0) {
        leverT += dt;
        const k = Math.min(1, leverT / 0.7);
        pivot.rotation.z = -Math.sin(k * Math.PI) * 1.0;
        if (k >= 1) { leverT = -1; pivot.rotation.z = 0; }
      }
      // people walk to their seats, ready state drives animation and light colour
      for (const rec of recs.values()) {
        const target = seatX(rec.seat, max);
        rec.actor.root.position.x += (target - rec.actor.root.position.x) * (1 - Math.exp(-dt * 6));
        if (rec.played !== rec.ready) {
          rec.played = rec.ready;
          void rec.actor.play(rec.ready ? 'Idle_Talking_Loop' : 'Idle_Loop', { fade: 0.3 });
        }
      }
      rig.update(dt, time);
      rig.screen.paint((c, w, h) => paintCrt(c, w, h));
      // a notice fades after a few seconds
      if (notice) { shownNotice += dt; if (shownNotice > 3) { notice = ''; shownNotice = 0; } } else shownNotice = 0;
      // the camera frames the row of seats
      const aspect = app.camera.aspect || 1.6;
      const need = (Math.max(max, 2) * SEAT_GAP) / 2 + 1.1;
      const dist = Math.max(6.4, need / (Math.tan((CAM_FOV * Math.PI) / 360) * aspect));
      app.camera.position.set(0, 2.2, dist);
      app.camera.lookAt(0, 1.5, -0.6);
    },
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
      window.removeEventListener('keydown', onKey);
      app.canvas.removeEventListener('pointerdown', onDown);
      app.canvas.removeEventListener('pointermove', onMove);
      app.canvas.style.cursor = '';
      for (const rec of recs.values()) { rec.actor.dispose(); scene.remove(rec.actor.root); }
      recs.clear();
      for (const o of built) scene.remove(o);
      built.length = 0;
      for (const g of geos) g.dispose();
      for (const c of canvases) c.tex.dispose();
      rig.dispose();
      app.camera.fov = prevFov;
      app.camera.updateProjectionMatrix();
    },
  };
}
