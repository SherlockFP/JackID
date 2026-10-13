/**
 * Pooled gambling props: chips (one InstancedMesh, denomination = instance colour, stacks keyed on the table
 * point), cards (ONE merged quad buffer, each card rewrites its own corners and atlas UVs, so a whole hand is one
 * draw call), dice (box with a texture per face, rolled with a hop and a decaying spin), single coins and bulk
 * balls (InstancedMesh). Pools never allocate per frame; slots are recycled through a free list.
 */
import * as THREE from 'three';
import type { Hex } from '@/core/types';
import { createRng, type Rng } from '@/core/rng';
import { okeyAtlas, sonKartAtlas } from '@/core/texgen/texgen';

/** Which texgen atlas a card pool draws: standard deck (default), SON KART or OKEY tiles (see `KitX.cards`). */
export type CardAtlasName = 'cards' | 'sonkart' | 'okey';
import { patchShader, psx } from './materials';
import { drawTexInto } from './draw';
import { bakeShade } from './geo';
import { keep, type KitCtx } from './ctx';
import { PAL, css, scaleHex } from './palette';
import type { BallPool, CardPool, ChipPool, ChipValue, DicePool, Kit } from './types';

const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const CHIP_R = 0.025, CHIP_T = 0.004;                      // Ø 0.05 m, 1.3× real (TECH §4 scale conventions)
const CARD_W = 0.088, CARD_H = 0.123, CARD_T = 0.0008;     // 1.4× real
/** Die face → unit direction it occupies when that face is up after `setFace`. Opposite faces sum to 7. */
const DIE_FACE_DIR: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0), 6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(1, 0, 0), 5: new THREE.Vector3(-1, 0, 0),
  3: new THREE.Vector3(0, 0, 1), 4: new THREE.Vector3(0, 0, -1),
};
/** BoxGeometry material groups are +x −x +y −y +z −z; these are the die faces they show. */
const DIE_GROUP_FACE = [2, 5, 1, 6, 3, 4] as const;
/** Denomination colours (casino convention, ART_BIBLE §2 palette). */
export const CHIP_COLORS: Record<ChipValue, Hex> = {
  1: 0xe6dec5, 5: 0xc52129, 10: 0x3163c5, 25: 0x297b4a, 100: 0x2a2a33, 500: 0x7b295a, 1000: 0xc59c42, 5000: 0xff42a5,
};

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const keyOf = (x: number, z: number): string => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
/** Shortest angular path from a to b (radians). */
const shortest = (a: number, b: number): number => a + ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);

/**
 * Partial GPU uploads for pooled attributes. `touch(i)` records a changed item (`stride` array elements per item);
 * `flush()` queues only the touched [lo, hi] span. three merges queued ranges and clears them after each upload, so
 * several flushes between two renders simply accumulate. A full upload is forced when the queue grows past `MAX_RANGES`.
 */
const MAX_RANGES = 16;
class Span {
  private lo = Infinity;
  private hi = -1;
  constructor(private readonly attr: THREE.BufferAttribute, private readonly stride: number) {}
  touch(i: number): void { if (i < this.lo) this.lo = i; if (i > this.hi) this.hi = i; }
  flush(): void {
    if (this.hi < 0) return;
    if (this.attr.updateRanges.length >= MAX_RANGES) this.attr.clearUpdateRanges();
    else this.attr.addUpdateRange(this.lo * this.stride, (this.hi - this.lo + 1) * this.stride);
    this.attr.needsUpdate = true;
    this.lo = Infinity; this.hi = -1;
  }
}

// ── chips ───────────────────────────────────────────────────────────────────────────────────────
const CHIP_VALUES: readonly ChipValue[] = [1, 5, 10, 25, 100, 500, 1000, 5000];
const CHIP_SHEET_H = 36;       // 32 px chip top + 4 px edge strip

/** 8 chip tops (texgen's `chipTop`, value printed) side by side, each with its 32×4 edge strip underneath. */
function chipSheet(ctx: KitCtx): THREE.Texture {
  return ctx.tex.canvas(256, CHIP_SHEET_H, (g) => {
    g.imageSmoothingEnabled = false;
    CHIP_VALUES.forEach((v, i) => {
      drawTexInto(g, ctx.tex.chipTop(v), i * 32, 0, 32, 32);
      const base = CHIP_COLORS[v];
      const lum = (((base >> 16) & 255) * 0.3 + ((base >> 8) & 255) * 0.59 + (base & 255) * 0.11) / 255;
      g.fillStyle = css(base); g.fillRect(i * 32, 32, 32, 4);
      g.fillStyle = css(lum > 0.5 ? 0x292131 : 0xe6dec5);
      for (let k = 0; k < 6; k++) g.fillRect(i * 32 + Math.round((k * 32) / 6) + 1, 32, 2, 4);
    });
  }, { key: 'kit:chipsheet', wrap: 'clamp' });
}

/**
 * One InstancedMesh for every chip on a table. The denomination is a per-instance attribute (`aChip`) that offsets the
 * UVs into the chip sheet (a 4-line patch on the PSX shader), so tops show their printed value and the rim its inserts
 * while the whole pool stays ONE draw call.
 */
function makeChips(ctx: KitCtx, max: number): ChipPool {
  const geo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_T, 12, 1);
  bakeShade(geo, { top: 1, bottom: 0.7 });
  {
    const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal'), uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const capV = (x: number, z: number): number => (CHIP_SHEET_H - 32 + (0.5 - z / (2 * CHIP_R)) * 32) / CHIP_SHEET_H;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, pos.getX(i) / (2 * CHIP_R) + 0.5, capV(pos.getX(i), pos.getZ(i)));
      else uv.setXY(i, uv.getX(i), 2 / CHIP_SHEET_H);
    }
  }
  const idx = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  geo.setAttribute('aChip', idx);
  const idxSpan = new Span(idx, 1);
  const mat = psx({ color: 0xffffff, map: chipSheet(ctx), vertexColors: true, unique: true });
  patchShader(mat, 'chips', { vertexDecl: 'attribute float aChip;', vertexAfterUv: 'vMapUv.x = (vMapUv.x + aChip) * 0.125;' });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.name = 'chips';
  mesh.frustumCulled = false;
  keep(mesh);
  const matSpan = new Span(mesh.instanceMatrix, 16);
  const rng: Rng = createRng(max * 97 + 11);
  const active = new Uint8Array(max);
  const free: number[] = [];
  for (let i = max - 1; i >= 0; i--) free.push(i);
  const stacks = new Map<string, number[]>();        // table point → chip ids, bottom → top
  const baseY = new Map<string, number>();            // stack key → y of its bottom chip
  const where = new Map<number, string>();           // chip id → stack key
  const pos = Array.from({ length: max }, () => new THREE.Vector3());
  const yaw = new Float32Array(max);
  const tokens = Array.from({ length: max }, () => ({}));
  const gen = new Uint32Array(max);                  // bumped by every move / remove: a cancelled move must not land later
  let count = 0;
  for (let i = 0; i < max; i++) mesh.setMatrixAt(i, HIDDEN);
  mesh.instanceMatrix.needsUpdate = true;

  const flush = (): void => { matSpan.flush(); idxSpan.flush(); };
  const write = (id: number): void => {
    matSpan.touch(id);
    if (!active[id]) { mesh.setMatrixAt(id, HIDDEN); return; }
    tmpQ.setFromAxisAngle(UP, yaw[id]);
    mesh.setMatrixAt(id, tmpM.compose(pos[id], tmpQ, tmpV.set(1, 1, 1)));
  };
  /** Append `id` on the stack at (x, y, z) and place it on top. */
  const attach = (id: number, x: number, y: number, z: number): void => {
    const k = keyOf(x, z);
    let s = stacks.get(k);
    if (!s) { s = []; stacks.set(k, s); }
    s.push(id);
    if (s.length === 1) baseY.set(k, y);
    where.set(id, k);
    pos[id].set(x, y + (s.length - 1) * CHIP_T + CHIP_T / 2, z);
  };
  const detach = (id: number): void => {
    const k = where.get(id);
    if (k === undefined) return;
    const s = stacks.get(k);
    if (s) {
      const i = s.indexOf(id);
      if (i >= 0) s.splice(i, 1);
      if (!s.length) { stacks.delete(k); baseY.delete(k); }
      else {                                   // close the gap: chips above the removed one drop down
        const by = baseY.get(k) ?? 0;
        for (let j = Math.max(0, i); j < s.length; j++) { pos[s[j]].y = by + j * CHIP_T + CHIP_T / 2; write(s[j]); }
      }
    }
    where.delete(id);
  };

  const pool: ChipPool = {
    root: mesh,
    add(v: ChipValue, at) {
      const id = free.pop();
      if (id === undefined) return -1;
      active[id] = 1; count++;
      yaw[id] = rng.float(0, Math.PI * 2);
      idx.setX(id, Math.max(0, CHIP_VALUES.indexOf(v)));
      idxSpan.touch(id);
      attach(id, at.x, at.y, at.z);
      write(id);
      flush();
      return id;
    },
    stack(vs, at) {
      const ids: number[] = [];
      for (const v of vs) { const id = pool.add(v, at); if (id >= 0) ids.push(id); }
      return ids;
    },
    move(id, to, dur = 0.5, arc = 0.1) {
      if (id < 0 || id >= max || !active[id]) return Promise.resolve();
      const from = pos[id].clone();
      const my = ++gen[id];
      detach(id);
      return ctx.anim.run(dur, (k) => {
        const s = (stacks.get(keyOf(to.x, to.z))?.length ?? 0) * CHIP_T;
        pos[id].set(lerp(from.x, to.x, k), lerp(from.y, to.y + s + CHIP_T / 2, k) + Math.sin(k * Math.PI) * arc, lerp(from.z, to.z, k));
        write(id);
        flush();
      }, { ease: 'inOutCubic', owner: tokens[id] }).then(() => {
        if (gen[id] !== my || !active[id]) return;
        attach(id, to.x, to.y, to.z);
        write(id);
        flush();
      });
    },
    remove(id) {
      if (id < 0 || id >= max || !active[id]) return;
      ctx.anim.cancel(tokens[id]);
      gen[id]++;
      detach(id);
      active[id] = 0; count--;
      write(id);
      flush();
      free.push(id);
    },
    clear() {
      for (let i = 0; i < max; i++) if (active[i]) pool.remove(i);
    },
    get count() { return count; },
  };
  return pool;
}

// ── cards ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Card pool. Card i owns vertices 8i..8i+7: four for the front quad (normal +Y) and four for the back quad
 * (normal −Y). A card is "flipped" by rotating about its own X axis (θ = 0 face up, π face down); its centre rises
 * with sin θ so the card never dips through the felt.
 */
function makeCards(ctx: KitCtx, max: number, back: 'red' | 'blue' | 'black' | undefined, scale: number, atlasName: CardAtlasName = 'cards'): CardPool {
  const atlas: { tex: THREE.Texture; uv(key: string): [number, number, number, number] } =
    atlasName === 'sonkart' ? sonKartAtlas() : atlasName === 'okey' ? okeyAtlas() : ctx.tex.cardAtlas();
  const backKey = atlasName === 'cards' && back ? `back.${back}` : 'back';
  const w = CARD_W * scale, h = CARD_H * scale;
  const n = max * 8;
  const posA = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const idx = new Uint16Array(max * 12);
  for (let i = 0; i < max; i++) {
    for (let q = 0; q < 2; q++) {
      const v0 = i * 8 + q * 4;
      idx.set([v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2], i * 12 + q * 6);     // CCW seen from the face normal
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posA, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mesh = new THREE.Mesh(geo, psx({ map: atlas.tex, lit: true, alphaTest: 0.5, side: 'double', unique: true }));
  mesh.name = 'cards';
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'cards';
  group.add(mesh);
  keep(group);

  interface St { pos: THREE.Vector3; rotY: number; flip: number; front: string; live: boolean }
  const st: St[] = Array.from({ length: max }, () => ({ pos: new THREE.Vector3(), rotY: 0, flip: Math.PI, front: 'back', live: false }));
  const flipTok = Array.from({ length: max }, () => ({}));       // flip and move run side by side (a dealt card flips in flight)
  const moveTok = Array.from({ length: max }, () => ({}));
  const moveGen = new Uint32Array(max), flipGen = new Uint32Array(max);   // a cancelled tween must not snap the card later
  const free: number[] = [];
  for (let i = max - 1; i >= 0; i--) free.push(i);
  const qFlip = new THREE.Quaternion(), qYaw = new THREE.Quaternion();
  const p = new THREE.Vector3(), nv = new THREE.Vector3();
  const posSpan = new Span(geo.getAttribute('position') as THREE.BufferAttribute, 8 * 3);
  const norSpan = new Span(geo.getAttribute('normal') as THREE.BufferAttribute, 8 * 3);
  const uvSpan = new Span(geo.getAttribute('uv') as THREE.BufferAttribute, 8 * 2);
  // corner: x, y, z, uv corner (0 TL, 1 TR, 2 BR, 3 BL)
  const FRONT: Array<[number, number, number, number]> = [
    [-w / 2, CARD_T / 2, -h / 2, 0], [w / 2, CARD_T / 2, -h / 2, 1], [w / 2, CARD_T / 2, h / 2, 2], [-w / 2, CARD_T / 2, h / 2, 3],
  ];
  const BACK: Array<[number, number, number, number]> = [
    [-w / 2, -CARD_T / 2, h / 2, 0], [w / 2, -CARD_T / 2, h / 2, 1], [w / 2, -CARD_T / 2, -h / 2, 2], [-w / 2, -CARD_T / 2, -h / 2, 3],
  ];

  /** Rewrite card i's 8 corners, normals and UVs from its state (collapsed to the origin when not live). */
  const write = (i: number): void => {
    const s = st[i], base = i * 8;
    if (!s.live) {
      posA.fill(0, base * 3, (base + 8) * 3);
    } else {
      const lift = Math.sin(s.flip) * (h / 2 + 0.04);
      qFlip.setFromAxisAngle(AX, s.flip);
      qYaw.setFromAxisAngle(AY, s.rotY);
      const fu = atlas.uv(s.front), bu = atlas.uv(backKey);
      for (let k = 0; k < 8; k++) {
        const front = k < 4;
        const [x, y, z, c] = front ? FRONT[k] : BACK[k - 4];
        p.set(x, y, z).applyQuaternion(qFlip).applyQuaternion(qYaw);
        const vi = (base + k) * 3;
        posA[vi] = p.x + s.pos.x; posA[vi + 1] = p.y + s.pos.y + lift; posA[vi + 2] = p.z + s.pos.z;
        nv.set(0, front ? 1 : -1, 0).applyQuaternion(qFlip).applyQuaternion(qYaw);
        nor[vi] = nv.x; nor[vi + 1] = nv.y; nor[vi + 2] = nv.z;
        const t = front ? fu : bu;
        const ui = (base + k) * 2;
        uv[ui] = c === 0 || c === 3 ? t[0] : t[2];
        uv[ui + 1] = c === 0 || c === 1 ? t[3] : t[1];
      }
    }
    posSpan.touch(i); norSpan.touch(i); uvSpan.touch(i);
    posSpan.flush(); norSpan.flush(); uvSpan.flush();
  };

  const pool: CardPool = {
    root: group,
    add(card, at, rotY = 0) {
      const id = free.pop();
      if (id === undefined) return -1;
      const s = st[id];
      s.live = true; s.pos.copy(at); s.rotY = rotY;
      s.flip = card ? 0 : Math.PI;
      s.front = card ?? 'back';
      write(id);
      return id;
    },
    setCard(id, c) {
      if (id < 0 || id >= max || !st[id].live) return;
      st[id].front = c;
      write(id);
    },
    flip(id, dur = 0.3) {
      if (id < 0 || id >= max || !st[id].live) return Promise.resolve();
      const s = st[id];
      const from = s.flip, to = from < Math.PI / 2 ? Math.PI : 0, my = ++flipGen[id];
      return ctx.anim.run(dur, (k) => { s.flip = lerp(from, to, k); write(id); }, { ease: 'inOutCubic', owner: flipTok[id] })
        .then(() => { if (flipGen[id] === my && s.live) { s.flip = to; write(id); } });
    },
    move(id, to, dur = 0.4, o) {
      if (id < 0 || id >= max || !st[id].live) return Promise.resolve();
      const s = st[id];
      const from = s.pos.clone(), r0 = s.rotY, r1 = o?.rotY !== undefined ? shortest(r0, o.rotY) : r0;
      const arc = o?.arc ?? 0, my = ++moveGen[id];
      return ctx.anim.run(dur, (k) => {
        s.pos.lerpVectors(from, to, k);
        s.pos.y += Math.sin(k * Math.PI) * arc;
        s.rotY = lerp(r0, r1, k);
        write(id);
      }, { ease: 'outCubic', owner: moveTok[id] }).then(() => { if (moveGen[id] === my && s.live) { s.pos.copy(to); s.rotY = r1; write(id); } });
    },
    remove(id) {
      if (id < 0 || id >= max || !st[id].live) return;
      ctx.anim.cancel(flipTok[id]); ctx.anim.cancel(moveTok[id]);
      moveGen[id]++; flipGen[id]++;
      st[id].live = false;
      write(id);
      free.push(id);
    },
    clear() {
      for (let i = 0; i < max; i++) if (st[i].live) pool.remove(i);
    },
  };
  return pool;
}

// ── dice ────────────────────────────────────────────────────────────────────────────────────────
/** 64×32 sheet of the six faces (cells of 16 px, face n at ((n−1) % 4, ⌊(n−1) / 4⌋)) in the requested colours. */
function dieSheet(ctx: KitCtx, body: Hex, pip: Hex): THREE.Texture {
  return ctx.tex.canvas(64, 32, (g) => {
    g.imageSmoothingEnabled = false;
    for (let n = 1; n <= 6; n++) drawTexInto(g, ctx.tex.dieFace(n as 1, { body, pip }), ((n - 1) % 4) * 16, Math.floor((n - 1) / 4) * 16, 16, 16);
  }, { key: `kit:diesheet:${body}:${pip}`, wrap: 'clamp' });
}

/** One draw call per die: a box whose six faces point into the shared sheet. */
function makeDice(ctx: KitCtx, count: number, size: number, body: Hex, pip: Hex): DicePool {
  const rng = createRng(count * 53 + 17);
  const dice: THREE.Mesh[] = [];
  const rollGen = new Uint32Array(count);
  const mat = psx({ map: dieSheet(ctx, body, pip), vertexColors: true });
  const orient = (m: THREE.Mesh, face: number): void => {
    m.quaternion.setFromUnitVectors(DIE_FACE_DIR[face] ?? DIE_FACE_DIR[1], UP);
    m.userData.face = face;
  };
  for (let i = 0; i < count; i++) {
    const geo = new THREE.BoxGeometry(size, size, size);
    bakeShade(geo, { flat: true });
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    DIE_GROUP_FACE.forEach((n, k) => {                               // BoxGeometry: 4 vertices per face, in group order
      const cx = (n - 1) % 4, cy = Math.floor((n - 1) / 4);
      for (let v = 0; v < 4; v++) {
        const j = k * 4 + v, u0 = 0.02 + 0.96 * uv.getX(j), v0 = 0.02 + 0.96 * uv.getY(j);
        uv.setXY(j, (cx + u0) / 4, 1 - (cy + 1 - v0) / 2);
      }
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = `die_${i}`;
    orient(m, 1);
    dice.push(m);
  }
  return {
    dice,
    setFace(i, face) { const m = dice[i]; if (m) { rollGen[i]++; ctx.anim.cancel(m); orient(m, face); } },
    roll(i, from, to, face, dur) {
      const m = dice[i];
      if (!m) return Promise.resolve();
      const target = new THREE.Quaternion().setFromUnitVectors(DIE_FACE_DIR[face] ?? DIE_FACE_DIR[1], UP);
      const axis = new THREE.Vector3(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)).normalize();
      const turns = rng.float(2.5, 3.5) * Math.PI * 2;
      const hop = 0.12;
      m.position.copy(from);
      const my = ++rollGen[i];
      return ctx.anim.run(dur, (k) => {
        m.position.lerpVectors(from, to, k);
        // one hop over the first 60 % of the roll, then two shrinking bounces
        const y = k < 0.6 ? Math.sin((k / 0.6) * Math.PI) * hop : Math.abs(Math.sin(((k - 0.6) / 0.4) * Math.PI * 2)) * hop * 0.2 * (1 - k);
        m.position.y += y;
        tmpQ.setFromAxisAngle(axis, turns * (1 - k));
        m.quaternion.copy(tmpQ).multiply(target);
      }, { ease: 'linear', owner: m }).then(() => { if (rollGen[i] === my) { m.position.copy(to); orient(m, face); } });
    },
  };
}

// ── coin ────────────────────────────────────────────────────────────────────────────────────────
/** Single coin, axis Y: heads on top, tails underneath (reads upright after a flip about X), ONE draw call. */
function makeCoin(ctx: KitCtx, o: { r?: number; thick?: number; heads?: string; tails?: string; color?: Hex }): THREE.Mesh {
  const r = o.r ?? 0.02, t = o.thick ?? 0.004;
  const metal = o.color ?? PAL.GOLD;
  const sheet = ctx.tex.canvas(64, 32, (g) => {
    g.imageSmoothingEnabled = false;
    g.fillStyle = css(metal); g.fillRect(0, 0, 64, 32);
    g.strokeStyle = css(scaleHex(metal, 0.7)); g.lineWidth = 1;
    for (const cx of [0, 32]) { g.beginPath(); g.arc(cx + 16, 16, 14.5, 0, Math.PI * 2); g.stroke(); }
    for (const [sym, cx] of [[o.heads, 0], [o.tails, 32]] as const) if (sym) drawTexInto(g, ctx.tex.symbol(sym, 32), cx + 3, 3, 26, 26);
  }, { key: `kit:coin:${metal}:${o.heads ?? ''}:${o.tails ?? ''}`, wrap: 'clamp' });
  const geo = new THREE.CylinderGeometry(r, r, t, 16, 1);
  bakeShade(geo);
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal'), uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i), cu = pos.getX(i) / (2 * r) + 0.5, z = pos.getZ(i) / (2 * r);
    if (ny > 0.5) uv.setXY(i, cu * 0.5, 0.5 - z);                    // heads: upright seen from +Y with +Z towards the viewer
    else if (ny < -0.5) uv.setXY(i, 0.5 + cu * 0.5, 0.5 + z);        // tails: mirrored in z so it reads upright once flipped about X
    else uv.setXY(i, 0.02, 0.97);                                    // rim: a corner texel of the sheet = plain metal
  }
  const m = new THREE.Mesh(geo, psx({ map: sheet, vertexColors: true }));
  m.name = 'coin';
  return m;
}

// ── balls ───────────────────────────────────────────────────────────────────────────────────────
function makeBalls(max: number, r: number, color: Hex | undefined, metal: boolean | undefined): BallPool {
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(r, 0), psx({ color: metal ? PAL.CHROME_HI : (color ?? 0xf7efde), unique: true }), max);
  mesh.name = 'balls';
  mesh.frustumCulled = false;
  for (let i = 0; i < max; i++) mesh.setMatrixAt(i, HIDDEN);
  mesh.instanceMatrix.needsUpdate = true;
  keep(mesh);
  const span = new Span(mesh.instanceMatrix, 16);
  return {
    root: mesh,
    max,
    set(i, x, y, z) {
      if (i < 0 || i >= max) return;
      mesh.setMatrixAt(i, tmpM.makeTranslation(x, y, z));
      span.touch(i); span.flush();
    },
    hide(i) {
      if (i < 0 || i >= max) return;
      mesh.setMatrixAt(i, HIDDEN);
      span.touch(i); span.flush();
    },
  };
}

export function makePools(ctx: KitCtx): Pick<Kit, 'chips' | 'cards' | 'dice' | 'coin' | 'balls'> {
  return {
    chips: (o) => makeChips(ctx, o.max),
    cards: (o) => makeCards(ctx, o.max, o.back, o.scale ?? 1, (o as { atlas?: CardAtlasName }).atlas),
    dice: (o) => makeDice(ctx, o.count, o.size ?? 0.03, o.body ?? PAL.IVORY, o.pip ?? PAL.PIT_BLACK),
    coin: (o) => makeCoin(ctx, o ?? {}),
    balls: (o) => makeBalls(o.max, o.r, o.color, o.metal),
  };
}
