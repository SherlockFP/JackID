/**
 * THE BURNING WAGER on the floor (STORY_BIBLE §4 N8 Act 2, §5a "Finale", §9). Night 8 is paid (`run.wagerDue()`): a short beat, then the
 * Compere calls the last table, sets the mic on its stand and sits down at a table on the stage (`wager_sit` cutscene, hook `wager.sit`
 * dresses the stage). You stand at its edge, he sits across, and Loki stands behind his chair as his mirror image. The board
 * (duels/promise/burning.ts) plays the match; the crowd is sound only. The outcome goes to `run.burningWager`, which ends the run, and the
 * routed ending plays from story/index.ts.
 *
 * Opened once per session while the Wager is due. Restart rule: nothing of the match is saved, so a resume opens it again from 0:0 (the
 * seed is the run's: the same match). Mounted by the session for solo story runs (`run.homeOn`).
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { endCutsceneMode, type InputExt } from '@/core/input';
import { hashSeed } from '@/core/rng';
import type { UIOverlayX } from '@/core/ui/ui';
import type { MannequinActor } from '@/kit/types';
import { SEATED_HIP } from '@/kit/mannequin';
import { STAGE } from '@/world/props/grand';
import type { StageProp, World } from '@/world/types';
import type { LocalPlayerHost } from '@/player/local';
import type { Apparition } from '@/game/joker/apparition';
import { openBurning, type Burning, type BurningResult } from '@/game/duels/promise/burning';
import { wagerHelps } from '@/game/duels/promise/champion';
import type { Hand } from '@/game/duels/promise/rules';
import type { DebtRun } from '@/game/run';
import { playStory } from './index';

/** Seconds after the paid Dawn before the Compere calls the table (the Dawn's own toasts first). */
export const WAGER_WAIT_S = 2.5;
const X = STAGE.x, H = STAGE.h;
/** The table stands at the stage's front edge; his chair behind it facing the room; you on the floor below; Loki behind his chair, at
 *  his shoulder (straight behind, the seated Champion would hide him). */
const TABLE_Z = STAGE.z - STAGE.d / 2 + 0.45;
const CHAIR_Z = TABLE_Z + 0.62;
const LOKI_Z = CHAIR_Z + 0.5;
const LOKI_X = X + 0.62;
const YOU_Z = STAGE.z - STAGE.d / 2 - 0.55;
const EYE_Y = 1.62;
const SEAT_Y = H + 0.46;
const COMPERE_H = 1.85;
const GREEN = 0x5aff7b;

export interface WagerMount {
  update(dt: number): void;
  /** DEV (bench `duel:burning`): start it now, wherever the run is. False when it is already running. */
  open(): boolean;
  dispose(): void;
}

let current: WagerMount | null = null;
/** The live mount (bench and dev console). */
export const liveWager = (): WagerMount | null => current;

export function mountWager(run: DebtRun, world: World, player: LocalPlayerHost, loki: Apparition): WagerMount {
  let state: 'idle' | 'wait' | 'scene' | 'board' | 'done' = 'idle';
  let wait = 0;
  let board: Burning | null = null;
  let dressed = false;
  let locked = false;
  let disposed = false;
  const stage = world.prop<StageProp>('stage');
  const props = new THREE.Group();
  props.name = 'wager:table';
  const offs: Array<() => void> = [];
  const eye = new THREE.Object3D();
  eye.position.set(X, EYE_Y, YOU_Z);
  world.root.add(eye, props);
  offs.push(world.registerAnchor('wager.eye', eye));

  /** The table, the two chairs, the mic set aside, the Compere seated with his pink gone green (idempotent: the hook and the board). */
  const dress = (): void => {
    if (dressed || disposed) return;
    dressed = true;
    const kit = app.kit;
    const wood = kit.mat(kit.pal.woodDark), felt = kit.mat(kit.pal.felt), brass = kit.mat(kit.pal.brass);
    kit.box(1.1, 0.05, 0.62, felt, { pos: [X, H + 0.74, TABLE_Z], parent: props });
    kit.box(1.16, 0.04, 0.68, wood, { pos: [X, H + 0.705, TABLE_Z], parent: props });
    kit.box(0.12, 0.68, 0.12, wood, { pos: [X, H + 0.35, TABLE_Z], parent: props });
    kit.box(0.5, 0.04, 0.4, brass, { pos: [X, H + 0.02, TABLE_Z], parent: props });
    kit.box(0.46, 0.05, 0.44, wood, { pos: [X, SEAT_Y, CHAIR_Z], parent: props });           // his chair
    kit.box(0.46, 0.62, 0.05, wood, { pos: [X, SEAT_Y + 0.33, CHAIR_Z + 0.22], parent: props });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(0.04, 0.46, 0.04, wood, { pos: [X + sx * 0.2, H + 0.23, CHAIR_Z + sz * 0.19], parent: props });
    stage?.root.getObjectByName('mic')?.position.set(X + 1.7, H, STAGE.z - 0.55);
    const c: MannequinActor | undefined = stage?.compere;
    if (c) {
      const yaw = Math.PI;   // he faces the room (north, -Z)
      c.root.rotation.set(0, yaw, 0);
      c.root.position.set(X + Math.sin(yaw) * SEATED_HIP.back * COMPERE_H * 0.6, SEAT_Y - (SEATED_HIP.up - SEATED_HIP.contact) * COMPERE_H, CHAIR_Z + Math.cos(yaw) * SEATED_HIP.back * COMPERE_H * 0.6);
      void c.play('Sitting_Idle_Loop', { fade: 0.3 });
      c.setTint(GREEN, 0.35);
    }
    // the endings look at his head and at the table below it (ending_kept_pair, ending_cold_kitchen)
    world.anchor('stage.compere')?.position.set(X, H + 1.25, CHAIR_Z);
  };
  offs.push(app.cutscene.registerHook('wager.sit', () => dress()));

  const lock = (on: boolean): void => {
    if (on === locked) return;
    locked = on;
    if (on) { app.input.setMode('cutscene'); app.input.exitLock(); }   // the mouse is free for the board's buttons
    else if (!app.cutscene.playing) endCutsceneMode(app.input as InputExt, 'walk');
  };

  const finish = (r: BurningResult): void => {
    board = null;
    state = 'done';
    lock(false);
    if (!run.over) run.burningWager({ wager: r.wager, cracks: r.cracks, word: r.word });
  };

  const openBoard = (): void => {
    if (disposed || state !== 'scene') return;
    dress();
    state = 'board';
    player.teleport(new THREE.Vector3(X, 0, YOU_Z), Math.PI);   // yaw 0 faces -Z: you face him, south
    lock(true);
    world.lights.setLevel(world.anchor('stage.compere') ?? 'lobby', 1.8, 1.2);
    loki.pin({ kind: 'mirror', x: LOKI_X, y: H, z: LOKI_Z, yaw: Math.PI });
    const c = stage?.compere;
    board = openBurning({
      parent: (app.ui as UIOverlayX).hudLayer,
      seed: hashSeed(run.seed, 'burning'),
      helps: wagerHelps(run.bonds(), run.chapterRecord().kitchen === 'pair'),
      whisper: (fact) => { run.jokerWager(fact); },
      wordReady: () => run.jokerWordReady(),
      spendWord: () => run.jokerWager('word', true),
      say: (speaker, key, voice) => bus.emit('floor:say', { text: t(key), speaker: t(speaker), voice, source: `wager.${key}` }),
      sfx: (name, vol) => { app.audio.play(name, { vol }); },
      pose: (talk) => { void c?.play(talk ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop', { fade: 0.2 }); },
      playHand: (hd: Hand) => { try { void player.viewmodel.play(hd === 'rock' ? 'rpsRock' : hd === 'paper' ? 'rpsPaper' : 'rpsScissors'); } catch { /* hands are optional */ } },
      done: finish,
    });
  };

  const start = (): void => {
    state = 'scene';
    void playStory('wager_sit').then(openBoard, openBoard);
  };

  const mount: WagerMount = {
    update(dt) {
      if (disposed) return;
      if (state === 'idle' && run.wagerDue()) { state = 'wait'; wait = WAGER_WAIT_S; }
      else if (state === 'wait' && (wait -= dt) <= 0) start();
      else if (state === 'board') {
        if (run.over) { board?.dispose(); board = null; state = 'done'; lock(false); return; }
        board?.update(dt);
      }
    },
    open() {
      if (disposed || state === 'scene' || state === 'board') return false;
      start();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      board?.dispose();
      board = null;
      lock(false);
      loki.pin(null);
      for (const off of offs.splice(0)) off();
      if (current === mount) current = null;   // the table and the anchor stay in the world, which the session disposes next
    },
  };
  current = mount;
  return mount;
}
