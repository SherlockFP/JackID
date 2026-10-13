/**
 * Player-facing controls: button (round / rect / mushroom, lit, labelled, pressable), pull lever, coin slot,
 * coin tray, hand crank. Conventions: a button faces +Y (rotate the root to mount it on a sloped deck, press =
 * −Y); a lever's hinge is the root origin, rest 0 = pointing up, pulled = +1.05 rad about X (top swings to +Z);
 * a crank spins about +Z. All animation runs on the kit clock and the returned promises always resolve.
 */
import * as THREE from 'three';
import type { Hex } from '@/core/types';
import { ease } from '@/core/tween';
import { psx } from './materials';
import { keep, part, type KitCtx } from './ctx';
import { fitText } from './draw';
import { finalizeModel } from './finalize';
import { css, scaleHex } from './palette';
import type { ButtonPart, Kit, LeverPart, TextSource } from './types';

const lum = (c: Hex): number => (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;


/**
 * Point every vertex of a cap that is NOT on its top face at the (blank) corner texel of the label texture, and map
 * the top face onto the whole label. Round caps use the cylinder's own cap disc, rects a planar box projection, the
 * mushroom a planar projection of its flat crown.
 */
function labelUV(geo: THREE.BufferGeometry, shape: 'round' | 'rect' | 'mushroom', w: number, d: number, capH: number, r: number): void {
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal');
  let uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) { uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2); geo.setAttribute('uv', uv); }
  const blank = 0.02;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (shape === 'round') {
      if (nor.getY(i) > 0.9) continue;                                    // cylinder cap disc UV already spans 0..1
      uv.setXY(i, blank, blank);
    } else if (shape === 'rect') {
      if (nor.getY(i) > 0.99 && y > capH - 1e-4) uv.setXY(i, (x + w / 2) / w, (d / 2 - z) / d);
      else uv.setXY(i, blank, blank);
    } else if (y > capH - 0.0012) {
      const k = 1 / (r * 1.0);                                            // crown radius 0.5·r → label diameter r
      uv.setXY(i, 0.5 + x * k, 0.5 - z * k);
    } else uv.setXY(i, blank, blank);
  }
  uv.needsUpdate = true;
}

export function makeControls(ctx: KitCtx): Pick<Kit, 'button' | 'lever' | 'coinSlot' | 'coinTray' | 'crank'> {
  const { P, M, tex, pal, anim } = ctx;

  const button: Kit['button'] = (o) => {
    const shape = o.shape ?? 'round';
    const r = o.r ?? 0.025;
    const bw = o.w ?? r * 2.4, bh = o.h ?? r * 1.5;
    const root = part(P.group('button'));
    const labelled = o.label !== undefined;
    const dark = lum(o.color) < 0.38;
    const baseK = dark ? 0.6 : 1;                       // texture base level: dark caps get a lighter glyph instead of a darker one
    const capMat = psx({ color: scaleHex(o.color, 0.5), map: null, vertexColors: true, emissive: o.color, emissiveIntensity: 0, unique: true }) as THREE.MeshLambertMaterial;
    const capH = shape === 'mushroom' ? 0.022 : 0.014;
    const baseH = 0.008;

    // base plate (static → merged into the model)
    if (shape === 'rect') P.box(bw + 0.012, baseH, bh + 0.012, M.chrome(), { pos: [0, baseH / 2, 0], bevel: 0.002, parent: root });
    else P.cyl(r * 1.22, r * 1.3, baseH, M.chrome(), { pos: [0, baseH / 2, 0], seg: 10, parent: root });

    // cap
    let cap: THREE.Mesh;
    if (shape === 'rect') {
      cap = P.box(bw, capH, bh, capMat, { bevel: 0.0025 });
      cap.geometry.translate(0, capH / 2, 0);
    } else if (shape === 'mushroom') {
      cap = P.lathe([[0.001, capH], [r * 0.5, capH - 0.001], [r * 0.85, capH - 0.007], [r, 0.004], [r * 0.95, 0]], 10, capMat);
    } else {
      cap = P.cyl(r * 0.92, r, capH, capMat, { seg: 10 });
      cap.geometry.translate(0, capH / 2, 0);
    }
    cap.position.y = baseH;
    cap.name = 'cap';
    keep(cap);
    root.add(cap);

    // label baked into the cap's own texture (top face only): no extra decal, no extra draw call
    if (labelled) {
      const aspect = shape === 'rect' ? Math.max(0.35, Math.min(2.5, bh / bw)) : 1;
      const tw = 32, th = Math.max(12, Math.round(32 * aspect));
      const t = tex.canvas(tw, th, () => {}, { wrap: 'clamp' });
      const tg = (t.image as HTMLCanvasElement).getContext('2d')!;
      tg.imageSmoothingEnabled = false;
      const base = `rgb(${Math.round(baseK * 255)},${Math.round(baseK * 255)},${Math.round(baseK * 255)})`;
      const ink = dark ? '#ffffff' : '#2a2a2a';
      const pad = shape === 'rect' ? 2 : 6;
      ctx.text.bind(o.label as TextSource, t, (s) => { fitText(tex, tg, s, tw, th, { font: 'px5', color: ink, bg: base, pad }); t.needsUpdate = true; });
      capMat.map = t;
      capMat.needsUpdate = true;
      labelUV(cap.geometry, shape, bw, bh, capH, r);
    }

    let lit = !!o.lit, enabled = true;
    const paint = (): void => {
      capMat.color.setHex(!enabled ? scaleHex(o.color, 0.3) : lit ? o.color : scaleHex(o.color, 0.55)).multiplyScalar(labelled && dark ? 1 / baseK : 1);
      capMat.emissiveIntensity = enabled && lit ? 0.85 : 0;
    };
    paint();

    const rest = baseH;
    const partApi: ButtonPart = {
      root, cap,
      press(dur = 0.13) {
        if (!enabled) return Promise.resolve();
        return anim.run(dur, (k) => {
          const d = k < 0.4 ? ease.outCubic(k / 0.4) : 1 - ease.inOutQuad((k - 0.4) / 0.6);
          cap.position.y = rest - 0.006 * d;
        }, { owner: cap }).then(() => { cap.position.y = rest; });
      },
      setLit(on) { lit = on; paint(); },
      setEnabled(on) { enabled = on; paint(); },
    };
    return partApi;
  };

  const lever: Kit['lever'] = (o = {}) => {
    const L = o.length ?? 0.45;
    const side = o.side ?? 'right';
    const sx = side === 'right' ? -1 : 1;        // the cabinet lies on this side of the hinge
    const root = P.group('lever');
    P.box(0.05, 0.17, 0.13, M.chrome(), { pos: [sx * 0.032, 0, 0], bevel: 0.006, parent: root });
    P.box(0.012, 0.11, 0.06, 0x08080c, { pos: [sx * 0.004 + 0.002 * -sx, 0, 0.032], parent: root });   // guide slot
    P.cyl(0.024, 0.024, 0.06, M.brass(), { rot: [0, 0, 90], pos: [-sx * 0.012, 0, 0], seg: 8, parent: root });  // hinge boss
    const arm = new THREE.Group();
    arm.name = 'arm';
    arm.position.x = -sx * 0.026;
    root.add(arm);
    P.cyl(0.011, 0.014, L, M.chrome(), { pos: [0, L / 2, 0], seg: 6, parent: arm });
    P.cyl(0.02, 0.02, 0.026, M.brass(), { pos: [0, 0.02, 0], seg: 8, parent: arm });
    const knob = P.sphere(0.036, M.metal(o.knob ?? pal.red), { pos: [0, L + 0.03, 0], wSeg: 8, hSeg: 6, parent: arm });
    knob.name = 'knob';
    arm.userData.noAO = true;
    finalizeModel(arm);                    // bar + collar + knob → one mesh (before arm is flagged: a kept root merges nothing)
    keep(arm); part(root);
    return {
      root, arm,
      pull(dur = 0.55) {
        return anim.run(dur, (k) => {
          let a: number;
          if (k < 0.12) a = -0.14 * Math.sin((k / 0.12) * Math.PI / 2);                              // wind-up
          else if (k < 0.45) { const u = (k - 0.12) / 0.33; a = -0.14 + 1.24 * (0.5 - 0.5 * Math.cos(u * Math.PI)); }   // the pull
          else if (k < 0.56) a = 1.1 - 0.05 * ((k - 0.45) / 0.11);                                      // clunk at the bottom
          else a = 1.05 * (1 - ease.outElastic((k - 0.56) / 0.44));                                      // spring back
          arm.rotation.x = a;
        }, { owner: arm }).then(() => { arm.rotation.x = 0; });
      },
    } satisfies LeverPart;
  };

  const coinSlot: Kit['coinSlot'] = (o = {}) => {
    const g = P.group('coin_slot');
    P.box(0.07, 0.11, 0.012, M.enamel(0x1a1a22, 0.3), { pos: [0, 0, 0.006], bevel: 0.002, parent: g });
    P.box(0.074, 0.115, 0.004, o.color === undefined ? M.brass() : psx({ color: o.color, vertexColors: true }), { pos: [0, 0, 0.002], parent: g });
    P.box(0.006, 0.05, 0.004, 0x050508, { pos: [0, 0.008, 0.0135], parent: g });
    P.box(0.04, 0.012, 0.003, M.gold(), { pos: [0, -0.04, 0.0135], parent: g });
    return g;
  };

  const coinTray: Kit['coinTray'] = (o = {}) => {
    const w = o.w ?? 0.4, d = 0.14, h = 0.07;
    const root = P.group('coin_tray');
    const mat = o.color === undefined ? M.chrome() : psx({ color: o.color, vertexColors: true });
    P.box(w, 0.01, d, mat, { pos: [0, 0.005, 0], parent: root });
    P.box(w, h, 0.012, mat, { pos: [0, h / 2, -d / 2 + 0.006], parent: root });                     // back wall
    P.box(0.012, h * 0.8, d, mat, { pos: [-w / 2 + 0.006, h * 0.4, 0], parent: root });
    P.box(0.012, h * 0.8, d, mat, { pos: [w / 2 - 0.006, h * 0.4, 0], parent: root });
    P.box(w, 0.03, 0.012, mat, { pos: [0, 0.015, d / 2 - 0.006], parent: root });                  // low front lip
    P.box(w - 0.03, 0.002, d - 0.03, 0x15151c, { pos: [0, 0.011, 0], parent: root });              // dark dish
    const anchor = new THREE.Object3D();
    anchor.name = 'coin_anchor';
    anchor.position.set(0, 0.02, 0.01);
    anchor.userData.anchor = true;
    root.add(anchor);
    return { root, anchor };
  };

  const crank: Kit['crank'] = (o = {}) => {
    const r = o.r ?? 0.12;
    const root = P.group('crank');
    P.cyl(r * 0.45, r * 0.5, 0.02, M.brass(), { rot: [90, 0, 0], pos: [0, 0, 0.01], seg: 10, parent: root });
    const rotor = new THREE.Group();
    rotor.name = 'rotor';
    rotor.position.z = 0.025;
    root.add(rotor);
    P.cyl(0.012, 0.012, 0.03, M.chrome(), { rot: [90, 0, 0], pos: [0, 0, 0.0], seg: 6, parent: rotor });
    P.box(r + 0.02, 0.022, 0.012, M.brass(), { pos: [r / 2, 0, 0.012], bevel: 0.003, parent: rotor });
    const handle = new THREE.Group();
    handle.name = 'handle';
    handle.position.set(r, 0, 0.03);
    rotor.add(handle);
    P.cyl(0.016, 0.014, 0.075, M.wood('walnut'), { rot: [90, 0, 0], pos: [0, 0, 0.03], seg: 8, parent: handle });
    P.sphere(0.02, M.brass(), { pos: [0, 0, 0.07], wSeg: 6, hSeg: 4, parent: handle });
    keep(rotor); part(root);
    return {
      root, handle,
      turn(rev, dur) {
        const a0 = rotor.rotation.z;
        return anim.run(dur, (k) => { rotor.rotation.z = a0 - rev * Math.PI * 2 * k; }, { ease: 'inOutQuad', owner: rotor });
      },
    };
  };

  return { button, lever, coinSlot, coinTray, crank };
}
