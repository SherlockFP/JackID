/**
 * Burst-out transition for PLAY (menu-3d). Timeline, seconds from `start()`:
 *   0.00  anticipation: the die swells and jitters, the lever is already down, a power-up hum
 *   0.35  impact: the die bursts into shards, coins pour out, sparks, a white flash, a shake
 *   0.45  glass: the cabinet glass shatters outward, the camera dollies in
 *   0.90  the flash peaks and the zoom punches
 *   1.55  done: the state hands off to the Debt Run
 * Cosmetic only. Uses app.rng.cosmetic, never gameplay RNG.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import type { Cabinet } from './menuCabinet';
import type { MenuDie } from './menuDie';

interface Shard { mesh: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; life: number; glass: boolean }

const DURATION = 1.55;
const SHARD_GEO = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const GLASS_GEO = new THREE.PlaneGeometry(0.22, 0.22);
const SHARD_COLORS = [0x6a0c1c, 0xe6b23a, 0xf2d9a0, 0x9c1a2c];

export class MenuBurst {
  readonly group = new THREE.Group();
  /** 0 = camera at rest, 1 = pushed into the cabinet. The state reads this every frame. */
  dolly = 0;
  done = false;
  private t = 0;
  private stage = 0;
  private shards: Shard[] = [];
  private readonly glassMats: THREE.Material[] = [];
  private readonly shardMats = SHARD_COLORS.map((c) => psxMaterial({ color: c }));

  constructor(private readonly scene: THREE.Scene, private readonly die: MenuDie, private readonly cab: Cabinet) {
    scene.add(this.group);
  }

  start(): void {
    this.t = 0;
    this.stage = 0;
    this.done = false;
    this.dolly = 0;
    this.die.root.visible = true;
    this.cab.setGlassVisible(true);
    app.audio.play('powerUp', { bus: 'ui', vol: 0.9 });
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    const t = this.t;
    // stage 0: anticipation
    if (t < 0.35) {
      const k = t / 0.35;
      const s = 1 + 0.12 * k * k;
      this.die.root.scale.setScalar(s);
      this.die.root.position.x = this.die.base.x + Math.sin(t * 90) * 0.02 * k;
      app.fx.lightPulse(this.die.root.position, { color: 0xffc06a, mul: 1 + 2 * k, radius: 4, dur: 0.1 });
    }
    if (this.stage < 1 && t >= 0.35) {
      this.stage = 1;
      this.impact();
    }
    if (this.stage < 2 && t >= 0.45) {
      this.stage = 2;
      this.cab.setGlassVisible(false);
      this.glassShards();
      app.audio.play('glassBreak', { bus: 'ui', vol: 1 });
    }
    if (this.stage < 3 && t >= 0.9) {
      this.stage = 3;
      app.fx.zoomPunch(0.12, 0.45);
      app.fx.flash(0xffffff, 1, 0.5);
      app.audio.play('win3', { bus: 'ui', vol: 1 });
    }
    if (t >= 0.45) this.dolly = Math.min(1, (t - 0.45) / 0.9);
    this.stepShards(dt);
    if (t >= DURATION) this.done = true;
  }

  private impact(): void {
    const c = this.die.base.clone();
    this.die.root.visible = false;
    this.die.root.scale.setScalar(1);
    const rng = app.rng.cosmetic;
    for (let i = 0; i < 26; i++) {
      const mesh = new THREE.Mesh(SHARD_GEO, this.shardMats[i % this.shardMats.length]);
      mesh.position.copy(c);
      mesh.scale.setScalar(rng.float(0.6, 1.4));
      this.group.add(mesh);
      const dir = new THREE.Vector3(rng.float(-1, 1), rng.float(-0.2, 1), rng.float(0.2, 1)).normalize();
      this.shards.push({
        mesh,
        v: dir.multiplyScalar(rng.float(3, 6.5)),
        w: new THREE.Vector3(rng.float(-9, 9), rng.float(-9, 9), rng.float(-9, 9)),
        life: rng.float(1.0, 1.5),
        glass: false,
      });
    }
    app.fx.coins(c, 48, { spread: 1.6, up: 4, over: 1.2 });
    app.fx.sparks(c, 36, 0xffcc55);
    app.fx.flash(0xffffff, 0.9, 0.35);
    app.fx.shake(0.22, 0.5);
    app.audio.play('coinShower', { bus: 'ui', vol: 1 });
    app.audio.play('jackpot', { bus: 'ui', vol: 0.8 });
  }

  private glassShards(): void {
    const rng = app.rng.cosmetic;
    for (let i = 0; i < 22; i++) {
      const mat = psxMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.5, lit: false, depthWrite: false, unique: true });
      this.glassMats.push(mat);
      const mesh = new THREE.Mesh(GLASS_GEO, mat);
      mesh.position.set(rng.float(-2.3, 2.3), rng.float(-1.7, 1.7), 1.16);
      mesh.scale.setScalar(rng.float(0.6, 1.6));
      this.group.add(mesh);
      this.shards.push({
        mesh,
        v: new THREE.Vector3(rng.float(-1.2, 1.2), rng.float(-1, 1), rng.float(1.5, 4)),
        w: new THREE.Vector3(rng.float(-6, 6), rng.float(-6, 6), rng.float(-6, 6)),
        life: rng.float(1.0, 1.3),
        glass: true,
      });
    }
    app.fx.sparks(new THREE.Vector3(0, 0, 1.2), 24, 0xbfe9ff);
  }

  private stepShards(dt: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      s.v.y -= (s.glass ? 2 : 9) * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.x += s.w.x * dt;
      s.mesh.rotation.y += s.w.y * dt;
      s.mesh.rotation.z += s.w.z * dt;
      if (s.life < 0.35) s.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 10));
      if (s.life <= 0) {
        this.group.remove(s.mesh);
        this.shards.splice(i, 1);
      }
    }
  }

  /** Remove everything the burst spawned and restore the die (called on enter/exit). */
  reset(): void {
    for (const s of this.shards) this.group.remove(s.mesh);
    this.shards = [];
    for (const m of this.glassMats) m.dispose();
    this.glassMats.length = 0;
    this.die.root.visible = true;
    this.die.root.scale.setScalar(1);
    this.cab.setGlassVisible(true);
    this.dolly = 0;
    this.done = false;
    this.t = 0;
    this.stage = 0;
  }

  dispose(): void {
    this.reset();
    this.scene.remove(this.group);
  }
}
