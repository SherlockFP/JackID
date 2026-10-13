/**
 * Kit extras — the rest of ART_BIBLE §4.8 that the frozen `Kit` interface does not list yet (DECISIONS E / C32: they
 * move into `kit/types.ts` with Contracts v1.1). They live on the SAME kit object at runtime; type access today:
 * `import type { KitX } from '@/kit'` and `const kit = baseKit as KitX`.
 *
 *   chair · crtMonitor · ledPanel · plaque · towerLight · stanchion + velvetRope · cardShoe · decal · buttonPanel ·
 *   lightStrip (emissive bar strip with the bulb-chain patterns) · cards({ atlas: 'sonkart' | 'okey' })
 *
 * `buttonPanel` is the draw-call saver: N buttons on one sloped plate are ONE dynamic mesh (caps merged, per-cap vertex
 * colours, labels in a shared atlas, lit state in an emissive atlas), instead of N unique-material caps.
 */
import * as THREE from 'three';
import type { Hex, V3 } from '@/core/types';
import type { FontId } from '@/core/texgen/types';
import { ease } from '@/core/tween';
import { bevelBox } from './geo';
import { psx } from './materials';
import { CRT_SCHEMES, fitText, sevenSeg } from './draw';
import { PAL, css } from './palette';
import { keep, part, type KitCtx } from './ctx';
import { createBulbChain } from './lights';
import type { BulbChain, CardPool, Kit, LampPart, ScreenSurface, TextSource } from './types';

export interface LedPanelPart { root: THREE.Object3D; screen: ScreenSurface; set(text: string): void; setColor(css: string): void }
export interface PanelButtonSpec { id: string; label?: TextSource; color: Hex; x: number; z: number; w?: number; h?: number; lit?: boolean; font?: FontId }
export interface ButtonPanelOpts { buttons: PanelButtonSpec[]; w: number; d: number; slope?: number /* deg, default 12 */; plate?: Hex; capH?: number }
export interface PanelButton { id: string; /** Anchor at the cap's top centre (panel space). */ root: THREE.Object3D; press(dur?: number): Promise<void>; setLit(on: boolean): void; setEnabled(on: boolean): void }
export interface ButtonPanelPart {
  /** Origin = plate centre, +Y = plate normal; already tilted by `slope`. */
  root: THREE.Group;
  /** The single dynamic mesh holding every cap (raycast target). */
  caps: THREE.Mesh;
  buttons: Record<string, PanelButton>;
  list: PanelButton[];
  /** Which button owns a raycast hit on `caps`. */
  pick(hit: THREE.Intersection): PanelButton | null;
}

/** `CardPool` for atlases whose card ids are plain strings. */
export interface StringCardPool extends Omit<CardPool, 'add' | 'setCard'> {
  add(card: string | null, at: THREE.Vector3, rotY?: number): number;
  setCard(id: number, card: string): void;
}

export interface KitExtras {
  chair(o?: { h?: number; seat?: Hex; wood?: Hex }): THREE.Group;
  crtMonitor(o?: { w?: number; h?: number; px?: [number, number]; scheme?: 'green' | 'amber' | 'cyan' | 'red'; glow?: number }): { root: THREE.Group; screen: ScreenSurface };
  ledPanel(o: { digits: number; color?: string; h?: number }): LedPanelPart;
  plaque(o: { text: TextSource; w?: number; h?: number; color?: Hex }): THREE.Group;
  towerLight(o?: { colors?: [Hex, Hex] }): { root: THREE.Group; top: LampPart; bottom: LampPart };
  stanchion(o?: { h?: number; color?: Hex }): THREE.Group;
  velvetRope(a: V3, b: V3, o?: { sag?: number; color?: Hex }): THREE.Mesh;
  cardShoe(): { root: THREE.Group; mouth: THREE.Object3D };
  decal(o: { tex: THREE.Texture; w: number; h: number; alphaTest?: number }): THREE.Mesh;
  buttonPanel(o: ButtonPanelOpts): ButtonPanelPart;
  /** Card pool on the SON KART / OKEY texgen atlas (string ids: `R7`, `W+4`, `K13`, `FJ`, …; `back` is the card back). */
  cards(o: { max: number; scale?: number; atlas: 'sonkart' | 'okey' }): StringCardPool;
  /** Emissive light strip made of `segments` bars along `axis` (centred): pattern chase / alt / blink / all / off / rainbow. */
  lightStrip(o: { length: number; color: Hex; thickness?: number; segments?: number; axis?: 'x' | 'y' | 'z' }): BulbChain;
}

const lum = (c: Hex): number => (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;

export function makeExtras(ctx: KitCtx, base: Pick<Kit, 'screen' | 'label' | 'lamp' | 'cards'> & { chair: KitExtras['chair'] }): KitExtras {
  const { P, M, tex, pal, anim } = ctx;

  const crtMonitor: KitExtras['crtMonitor'] = (o = {}) => {
    const w = o.w ?? 0.4, h = o.h ?? 0.3, sch = CRT_SCHEMES[o.scheme ?? 'green'];
    const root = part(P.group('crt_monitor'));
    const screen = base.screen({ w, h, px: o.px ?? [128, 96], bezel: PAL.PIT_BLACK, glow: o.glow ?? 0.5 });
    screen.clear(sch.bg);
    root.add(screen.mesh);
    const d = w * 0.8;
    P.box(w + 0.07, h + 0.07, 0.05, M.enamel(0xd9d2bc, 0.35), { bevel: 0.012, pos: [0, 0, -0.055], parent: root });
    P.box(w * 0.78, h * 0.78, d, M.enamel(0xcfc8b2, 0.35), { bevel: 0.01, pos: [0, -0.005, -0.08 - d / 2], parent: root });
    P.box(w * 0.5, 0.03, w * 0.5, M.enamel(0xcfc8b2, 0.35), { pos: [0, -h / 2 - 0.05, -0.2], parent: root });
    return { root, screen };
  };

  const ledPanel: KitExtras['ledPanel'] = (o) => {
    const scale = 2;
    const pw = o.digits * 6 * scale + 2, ph = 11 * scale + 2;
    const hh = o.h ?? 0.06, ww = hh * (pw / ph);
    const screen = base.screen({ w: ww, h: hh, px: [pw, ph], scanlines: false });
    let color = o.color ?? '#ff3a2a';
    let text = '';
    const draw = (): void => screen.draw((g) => {
      g.fillStyle = '#0a0606'; g.fillRect(0, 0, pw, ph);
      sevenSeg(g, text.padStart(o.digits, ' '), 1, 1, { scale, color, ghost: 'rgba(255,255,255,0.07)' });
    });
    draw();
    return {
      root: screen.mesh, screen,
      set(t) { if (t !== text) { text = t; draw(); } },
      setColor(c) { color = c; draw(); },
    };
  };

  const plaque: KitExtras['plaque'] = (o) => {
    const w = o.w ?? 0.12, h = o.h ?? 0.03;
    const g = part(P.group('plaque'));
    P.box(w, h, 0.008, o.color === undefined ? M.brass() : { color: o.color, vertexColors: true }, { bevel: 0.002, pos: [0, 0, 0.004], parent: g });
    const l = base.label({ text: o.text, w: w * 0.92, h: h * 0.7, bg: null, color: PAL.BRASS_SHADOW, font: 'px5', px: [Math.max(16, Math.round(w * 400)), Math.max(8, Math.round(h * 300))] });
    l.mesh.position.z = 0.0092;
    g.add(l.mesh);
    return g;
  };

  const towerLight: KitExtras['towerLight'] = (o = {}) => {
    const [ct, cb] = o.colors ?? [PAL.SIGNAL_RED, PAL.AMBER];
    const root = part(P.group('tower_light'));
    P.cyl(0.02, 0.025, 0.2, M.chrome(), { pos: [0, 0.1, 0], seg: 6, parent: root });
    const bottom = base.lamp({ r: 0.035, color: cb, shape: 'dome' });
    bottom.root.position.y = 0.2;
    const top = base.lamp({ r: 0.035, color: ct, shape: 'dome' });
    top.root.position.y = 0.28;
    root.add(bottom.root, top.root);
    return { root, top, bottom };
  };

  const stanchion: KitExtras['stanchion'] = (o = {}) => {
    const h = o.h ?? 0.95;
    const g = part(P.group('stanchion'));
    const m = o.color === undefined ? M.brass() : { color: o.color, vertexColors: true };
    P.cyl(0.14, 0.16, 0.03, m, { pos: [0, 0.015, 0], seg: 8, parent: g });
    P.cyl(0.02, 0.025, h - 0.05, m, { pos: [0, 0.03 + (h - 0.05) / 2, 0], seg: 6, parent: g });
    P.sphere(0.04, m, { pos: [0, h, 0], wSeg: 6, hSeg: 4, parent: g });
    P.torus(0.03, 0.008, m, { pos: [0, h - 0.07, 0], rot: [90, 0, 0], seg: 8, tubeSeg: 3, parent: g });
    const a = new THREE.Object3D();
    a.name = 'rope_anchor'; a.position.set(0, h - 0.07, 0); a.userData.anchor = true;
    g.add(a);
    return g;
  };

  const velvetRope: KitExtras['velvetRope'] = (a, b, o = {}) => {
    const sag = o.sag ?? 0.12;
    const pts: V3[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]); }
    return P.tube(pts, 0.025, M.velvet(o.color ?? PAL.CASINO_RED), { seg: 12, radialSeg: 6, name: 'velvet_rope' });
  };

  const cardShoe: KitExtras['cardShoe'] = () => {
    const root = part(P.group('card_shoe'));
    const smoked = psx({ color: 0x1a1a22, lit: false, transparent: true, opacity: 0.55, depthWrite: false });
    P.extrude([[0.0, 0.0], [0.18, 0.0], [0.18, 0.045], [0.0, 0.12]], 0.1, smoked, { pos: [-0.05, 0, 0.0], rot: [0, 90, 0], shade: false, parent: root, name: 'shoe_glass' });
    P.box(0.18, 0.012, 0.11, M.brass(), { pos: [0, 0.006, 0], parent: root });
    P.box(0.012, 0.13, 0.11, M.brass(), { pos: [-0.085, 0.065, 0], parent: root });
    P.box(0.16, 0.012, 0.012, M.brass(), { pos: [0.0, 0.05, 0.054], rot: [0, 0, -10], parent: root });
    for (let i = 0; i < 6; i++) P.box(0.15 - i * 0.002, 0.012, 0.085, M.paper(), { pos: [0.0, 0.018 + i * 0.013, 0], rot: [0, 0, -10 + 0], parent: root });
    const mouth = new THREE.Object3D();
    mouth.name = 'shoe_mouth'; mouth.position.set(0.09, 0.052, 0.0); mouth.userData.anchor = true;
    root.add(mouth);
    return { root, mouth };
  };

  const decal: KitExtras['decal'] = (o) => {
    const m = psx({ map: o.tex, lit: true, alphaTest: o.alphaTest ?? 0.5, transparent: false, side: 'double', unique: true });
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), m);
    mesh.name = 'decal';
    return mesh;
  };

  // ── button panel ──
  const buttonPanel: KitExtras['buttonPanel'] = (o) => {
    const n = o.buttons.length;
    const capH = o.capH ?? 0.016;
    const plateH = 0.012;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n))), rows = Math.max(1, Math.ceil(n / cols));
    const CELL = 32, AW = cols * CELL, AH = rows * CELL;
    const root = part(P.group('button_panel'));
    root.rotation.x = ((o.slope ?? 12) * Math.PI) / 180;
    P.box(o.w, plateH, o.d, M.enamel(o.plate ?? 0x15151c, 0.4), { bevel: 0.003, pos: [0, plateH / 2, 0], parent: root, name: 'plate' });

    const albedo = tex.canvas(AW, AH, () => {}, { wrap: 'clamp' });
    const glow = tex.canvas(AW, AH, () => {}, { wrap: 'clamp' });
    const ag = (albedo.image as HTMLCanvasElement).getContext('2d')!, gg = (glow.image as HTMLCanvasElement).getContext('2d')!;
    ag.imageSmoothingEnabled = false; gg.imageSmoothingEnabled = false;
    const cellCanvas = tex.canvas(CELL, Math.ceil(CELL * 2.5), () => {}, { wrap: 'clamp' });
    const cg = (cellCanvas.image as HTMLCanvasElement).getContext('2d')!;
    cg.imageSmoothingEnabled = false;
    const scratch = tex.canvas(CELL, Math.ceil(CELL * 2.5), () => {}, { wrap: 'clamp' });
    const sg = (scratch.image as HTMLCanvasElement).getContext('2d')!;
    sg.imageSmoothingEnabled = false;

    interface Cap { spec: PanelButtonSpec; w: number; h: number; start: number; count: number; cx: number; cy: number; dark: boolean; lit: boolean; enabled: boolean; press: number; label: string }
    const caps: Cap[] = [];
    const geos: THREE.BufferGeometry[] = [];
    let vcount = 0;
    o.buttons.forEach((spec, i) => {
      const w = spec.w ?? 0.045, h = spec.h ?? 0.032;
      const g = bevelBox(w, capH, h, 0.003);
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
      const cx = i % cols, cy = Math.floor(i / cols);
      const u0 = (cx * CELL) / AW, u1 = ((cx + 1) * CELL) / AW, vT = 1 - (cy * CELL) / AH, vB = 1 - ((cy + 1) * CELL) / AH;
      const uv = new Float32Array(pos.count * 2), col = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        const top = nor.getY(v) > 0.99 && y > capH / 2 - 1e-4;
        if (top) { uv[v * 2] = u0 + ((x + w / 2) / w) * (u1 - u0); uv[v * 2 + 1] = vT - ((z + h / 2) / h) * (vT - vB); }
        else { uv[v * 2] = u0 + 1.5 / AW; uv[v * 2 + 1] = vB + 1.5 / AH; }
        const shade = 0.76 + 0.12 * nor.getZ(v) + 0.05 * nor.getX(v) + 0.24 * nor.getY(v);
        col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = shade;
        pos.setXYZ(v, x + spec.x, plateH + capH / 2 + y, z + spec.z);
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(g);
      caps.push({ spec, w, h, start: vcount, count: pos.count, cx, cy, dark: lum(spec.color) < 0.38, lit: !!spec.lit, enabled: true, press: 0, label: '' });
      vcount += pos.count;
    });
    const merged = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'color'] as const) {
      const size = geos[0].getAttribute(k).itemSize;
      const arr = new Float32Array(vcount * size);
      let off = 0;
      for (const g of geos) { arr.set((g.getAttribute(k) as THREE.BufferAttribute).array as Float32Array, off); off += g.getAttribute(k).count * size; }
      merged.setAttribute(k, new THREE.BufferAttribute(arr, size).setUsage(k === 'uv' ? THREE.StaticDrawUsage : THREE.DynamicDrawUsage));
    }
    for (const g of geos) g.dispose();
    const rest = new Float32Array((merged.getAttribute('position').array as Float32Array));
    const shade0 = new Float32Array((merged.getAttribute('color').array as Float32Array));
    const mat = psx({ color: 0xffffff, map: albedo, emissive: 0xffffff, emissiveIntensity: 0.85, emissiveMap: glow, vertexColors: true, unique: true });
    const capsMesh = new THREE.Mesh(merged, mat);
    capsMesh.name = 'button_caps';
    capsMesh.frustumCulled = false;
    keep(capsMesh);
    root.add(capsMesh);

    const posA = merged.getAttribute('position') as THREE.BufferAttribute, colA = merged.getAttribute('color') as THREE.BufferAttribute;
    const paintCell = (c: Cap): void => {
      const x = c.cx * CELL, y = c.cy * CELL;
      const baseK = c.dark ? 0.6 : 1;
      cg.clearRect(0, 0, CELL, CELL);
      const gr = Math.round(baseK * 255);
      cg.fillStyle = `rgb(${gr},${gr},${gr})`; cg.fillRect(0, 0, CELL, CELL);
      if (c.label) {
        const aspect = Math.max(0.35, Math.min(2.5, c.h / c.w));
        const ph = Math.max(10, Math.round(CELL * aspect));
        fitText(tex, sg, c.label, CELL, ph, { font: c.spec.font ?? 'px5', color: c.dark ? '#ffffff' : '#2a2a2a', bg: `rgb(${gr},${gr},${gr})`, pad: 2 });
        cg.drawImage(scratch.image as HTMLCanvasElement, 0, 0, CELL, ph, 0, 0, CELL, CELL);   // pre-stretched back to the cap's aspect
      }
      ag.drawImage(cellCanvas.image as HTMLCanvasElement, x, y);
      // emissive cell = albedo × colour while lit and enabled, black otherwise
      gg.fillStyle = '#000'; gg.fillRect(x, y, CELL, CELL);
      if (c.lit && c.enabled) {
        gg.drawImage(cellCanvas.image as HTMLCanvasElement, x, y);
        gg.save(); gg.globalCompositeOperation = 'multiply'; gg.fillStyle = css(c.spec.color); gg.fillRect(x, y, CELL, CELL); gg.restore();
      }
      albedo.needsUpdate = true; glow.needsUpdate = true;
    };
    const paintColor = (c: Cap): void => {
      const k = (!c.enabled ? 0.3 : c.lit ? 1 : 0.55) * (c.dark ? 1 / 0.6 : 1);
      const t = new THREE.Color(c.spec.color).multiplyScalar(k);
      for (let v = c.start; v < c.start + c.count; v++) { const sh = shade0[v * 3]; colA.setXYZ(v, t.r * sh, t.g * sh, t.b * sh); }
      colA.needsUpdate = true;
    };
    const offset = (c: Cap, d: number): void => {
      for (let v = c.start; v < c.start + c.count; v++) posA.setY(v, rest[v * 3 + 1] - d);
      posA.needsUpdate = true;
    };

    const list: PanelButton[] = [];
    const byId: Record<string, PanelButton> = {};
    caps.forEach((c) => {
      const anchor = new THREE.Object3D();
      anchor.name = `btn_${c.spec.id}`;
      anchor.position.set(c.spec.x, plateH + capH, c.spec.z);
      anchor.userData.anchor = true;
      root.add(anchor);
      if (c.spec.label !== undefined) ctx.text.watch(albedo, () => { c.label = ctx.text.resolve(c.spec.label as TextSource); paintCell(c); });
      else paintCell(c);
      paintColor(c);
      const b: PanelButton = {
        id: c.spec.id, root: anchor,
        press(dur = 0.13) {
          if (!c.enabled) return Promise.resolve();
          return anim.run(dur, (k) => { const d = k < 0.4 ? ease.outCubic(k / 0.4) : 1 - ease.inOutQuad((k - 0.4) / 0.6); offset(c, 0.006 * d); }, { owner: c }).then(() => offset(c, 0));
        },
        setLit(on) { c.lit = on; paintColor(c); paintCell(c); },
        setEnabled(on) { c.enabled = on; paintColor(c); paintCell(c); },
      };
      list.push(b); byId[c.spec.id] = b;
    });
    return {
      root, caps: capsMesh, buttons: byId, list,
      pick(hit) {
        if (hit.object !== capsMesh || hit.faceIndex === undefined || hit.faceIndex === null) return null;
        const v = hit.faceIndex * 3;
        const i = caps.findIndex((c) => v >= c.start && v < c.start + c.count);
        return i >= 0 ? list[i] : null;
      },
    };
  };

  const lightStrip: KitExtras['lightStrip'] = (o) => {
    const n = Math.max(1, o.segments ?? Math.max(2, Math.round(o.length / 0.15)));
    const th = o.thickness ?? 0.03, seg = o.length / n, axis = o.axis ?? 'x';
    const positions: V3[] = [];
    for (let i = 0; i < n; i++) { const t = -o.length / 2 + seg * (i + 0.5); positions.push(axis === 'x' ? [t, 0, 0] : axis === 'y' ? [0, t, 0] : [0, 0, t]); }
    const geo = new THREE.BoxGeometry(axis === 'x' ? seg * 0.88 : th, axis === 'y' ? seg * 0.88 : th, axis === 'z' ? seg * 0.88 : th);
    const chain = createBulbChain(ctx, positions, [o.color], th, n * 13 + 5, geo);
    chain.root.name = 'light_strip';
    chain.setPattern('all');
    return chain;
  };

  return { chair: base.chair, cards: base.cards as unknown as KitExtras['cards'], crtMonitor, ledPanel, plaque, towerLight, stanchion, velvetRope, cardShoe, decal, buttonPanel, lightStrip };
}
