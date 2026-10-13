/**
 * `kit.cabinet()` — machine shells. Seven styles share one recipe: the side profile (ART_BIBLE §4.8: recessed
 * kick, deck lip, leaning screen face, header) is extruded along X with a one-segment bevel, then dressed with
 * chrome/brass trim strips, side-art stripes, a coin door and optional coin tray. All anchors are positioned
 * and oriented on the real surfaces (screen anchor +Z = screen normal; panel anchor +Y = deck normal, which is
 * how `kit.button` is built), so machines just parent parts to them.
 */
import * as THREE from 'three';
import type { Hex, LocalAABB } from '@/core/types';
import { buildMesh } from './prims';
import { planarUV } from './geo';
import type { KitCtx } from './ctx';
import type { CabinetOpts, CabinetPart, Kit } from './types';

const D2R = Math.PI / 180;

/** Extrude a (z, y) side profile along X (width `w`, centred), with a one-segment bevel. */
function sideProfile(pts: Array<[number, number]>, w: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const b = Math.min(bevel, w / 4);
  const geo = new THREE.ExtrudeGeometry(shape, b > 0.002
    ? { depth: w - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, steps: 1 }
    : { depth: w, bevelEnabled: false, steps: 1 });
  geo.rotateY(-Math.PI / 2);                  // shape x → world +Z, extrusion → −X
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, 0, 0);
  return geo;
}

export function makeCabinet(ctx: KitCtx, controls: Pick<Kit, 'coinTray'>): Pick<Kit, 'cabinet'> {
  const { P, M, pal } = ctx;

  const trimMat = (c: Hex | undefined): THREE.Material => {
    if (c === undefined || c === pal.chrome) return M.chrome();
    if (c === pal.gold) return M.gold();
    if (c === pal.brass) return M.brass();
    return M.flat(c);
  };

  const cabinet = (o: CabinetOpts): CabinetPart => {
    const { w, h, d, style } = o;
    const hd = d / 2;
    const bevel = o.bevel ?? 0.03;
    const kick = o.kick ?? (style === 'wall' ? 0 : 0.08);
    const kin = 0.03;
    const grime = o.grime ?? 0.25;
    const bodyMat = M.enamel(o.body, grime);
    const trim = trimMat(o.trim);
    const accent = o.accent;
    const root = P.group('cabinet');
    const anchors: CabinetPart['anchors'] = { speaker: new THREE.Object3D() };
    const mk = (name: string, x: number, y: number, z: number, rx = 0): THREE.Object3D => {
      const a = new THREE.Object3D();
      a.name = name; a.position.set(x, y, z); a.rotation.x = rx; a.userData.anchor = true;
      root.add(a);
      return a;
    };

    let body: THREE.Mesh;
    let totalH = h;
    let frontMaxZ = hd;
    let deckY = 0, deckTilt = 0, lip = 0;
    let faceTop: [number, number] | null = null, faceBot: [number, number] | null = null;   // screen face segment (z,y)
    let faceTilt = 0;
    let headCenterY = h - 0.1;

    const profileMesh = (pts: Array<[number, number]>): THREE.Mesh =>
      buildMesh(sideProfile(pts, w, bevel), bodyMat, { name: 'cabinet_body', parent: root }, true, (g, tile) => planarUV(g, tile));

    switch (style) {
      case 'upright': {
        deckY = o.panel?.y ?? h * 0.54;
        lip = o.panel?.depth ?? 0.07;
        deckTilt = (o.panel?.tilt ?? 12) * D2R;
        const stilt = (o.screen?.tilt ?? 8) * D2R;
        const topH = o.topper?.h ?? h * 0.14;
        const headY = h - topH;
        const backZ = hd - 0.02, backY = deckY + Math.tan(deckTilt) * (lip + 0.02);
        const topZ = backZ - Math.tan(stilt) * (headY - backY);
        body = profileMesh([[-hd, 0], [hd - kin, 0], [hd - kin, kick], [hd, kick], [hd, deckY - 0.07], [hd + lip, deckY - 0.05], [hd + lip, deckY],
          [backZ, backY], [topZ, headY], [hd + 0.025, headY], [hd + 0.025, h], [-hd, h]]);
        faceBot = [backZ, backY]; faceTop = [topZ, headY]; faceTilt = stilt;
        frontMaxZ = hd + lip;
        headCenterY = headY + topH / 2;
        P.box(w + 0.012, 0.016, 0.03, trim, { pos: [0, h - 0.008, hd + 0.025], parent: root });                       // header cap trim
        P.box(w - 0.04, topH - 0.05, 0.008, M.enamel(0x08080c, 0.25), { pos: [0, headCenterY, hd + 0.027], parent: root });     // dark marquee window
        break;
      }
      case 'slant':
      case 'lowboy': {
        const slant = style === 'slant';
        deckY = o.panel?.y ?? h * (slant ? 0.6 : 0.8);
        lip = o.panel?.depth ?? 0.08;
        deckTilt = (o.panel?.tilt ?? 10) * D2R;
        const backZ = hd - 0.02, backY = deckY + Math.tan(deckTilt) * (lip + 0.02);
        const topZ = -hd + (slant ? 0.12 : 0.1);
        body = profileMesh([[-hd, 0], [hd - kin, 0], [hd - kin, kick], [hd, kick], [hd, deckY - 0.07], [hd + lip, deckY - 0.05], [hd + lip, deckY],
          [backZ, backY], [topZ, h], [-hd, h]]);
        faceBot = [backZ, backY]; faceTop = [topZ, h];
        faceTilt = Math.atan2(backZ - topZ, h - backY);
        frontMaxZ = hd + lip;
        headCenterY = h;
        break;
      }
      case 'tower': {
        const taper = 0.05;
        body = profileMesh([[-hd, 0], [hd - kin, 0], [hd - kin, kick], [hd, kick], [hd - taper, h - 0.06], [hd - taper + 0.03, h - 0.06], [hd - taper + 0.03, h], [-hd, h]]);
        faceBot = [hd - 0.005, h * 0.35]; faceTop = [hd - taper - 0.005, h - 0.12];
        faceTilt = Math.atan2(taper, h * 0.6);
        deckY = h * 0.3;
        break;
      }
      case 'counter': {
        body = P.box(w, h - 0.05, d, bodyMat, { bevel: 0.012, pos: [0, (h - 0.05) / 2, 0], parent: root, name: 'cabinet_body' });
        P.box(w + 0.05, 0.05, d + 0.05, M.wood('walnut'), { bevel: 0.01, pos: [0, h - 0.025, 0], parent: root });
        P.box(w - 0.02, 0.012, 0.012, trim, { pos: [0, h - 0.056, hd + 0.003], parent: root });
        deckY = h; frontMaxZ = hd + 0.025;
        break;
      }
      case 'booth': {
        const t = 0.06;
        body = P.box(w, h, t, bodyMat, { bevel: 0.01, pos: [0, h / 2, -hd + t / 2], parent: root, name: 'cabinet_body' });
        P.box(t, h, d, bodyMat, { bevel: 0.01, pos: [-w / 2 + t / 2, h / 2, 0], parent: root });
        P.box(t, h, d, bodyMat, { bevel: 0.01, pos: [w / 2 - t / 2, h / 2, 0], parent: root });
        P.box(w + 0.06, 0.07, d + 0.06, M.wood('walnut'), { bevel: 0.012, pos: [0, h + 0.035, 0.0], parent: root });
        const shelfY = o.panel?.y ?? 1.0;
        P.box(w - 2 * t, 0.05, o.panel?.depth ?? 0.3, M.wood('walnut'), { bevel: 0.008, pos: [0, shelfY, hd - (o.panel?.depth ?? 0.3) / 2], parent: root });
        P.box(w - 2 * t, shelfY - kick - 0.025, 0.04, bodyMat, { pos: [0, (shelfY + kick - 0.025) / 2, hd - 0.02], parent: root });
        deckY = shelfY + 0.025; frontMaxZ = hd + 0.03;
        totalH = h + 0.07;
        break;
      }
      case 'wall':
      default: {
        body = P.box(w, h, d, bodyMat, { bevel: Math.min(bevel, d / 3), pos: [0, h / 2, 0], parent: root, name: 'cabinet_body' });
        P.box(w + 0.03, 0.025, d + 0.03, trim, { pos: [0, h + 0.0125, 0], parent: root });
        P.box(w + 0.03, 0.025, d + 0.03, trim, { pos: [0, 0.0125, 0], parent: root });
        P.box(0.025, h, d + 0.03, trim, { pos: [-w / 2 - 0.0125, h / 2, 0], parent: root });
        P.box(0.025, h, d + 0.03, trim, { pos: [w / 2 + 0.0125, h / 2, 0], parent: root });
        totalH = h + 0.025;
        break;
      }
    }

    // optional header box for styles whose profile has no built-in header
    if (o.topper && style !== 'upright') {
      const th = o.topper.h, td = Math.min(d * 0.7, 0.35);
      P.box(w * 0.98, th, td, bodyMat, { bevel: 0.01, pos: [0, h + th / 2, -hd + td / 2 + 0.02], parent: root });
      P.box(w, 0.014, td + 0.012, trim, { pos: [0, h + th, -hd + td / 2 + 0.02], parent: root });
      headCenterY = h + th / 2;
      totalH = h + th;
    }

    // chrome/brass strips on the front vertical edges of the lower body
    const stripTop = deckY > 0 ? deckY - 0.08 : h * 0.9;
    if (style !== 'booth' && style !== 'wall' && stripTop > kick + 0.1) {
      const sh = stripTop - kick;
      for (const sx of [-1, 1]) P.box(0.014, sh, 0.012, trim, { pos: [sx * (w / 2 - 0.006), kick + sh / 2, hd + 0.004], parent: root });
    }
    // side-art stripes (accent colour)
    if (accent !== undefined && style !== 'wall') {
      const y0 = kick + 0.12, y1 = Math.min(h * 0.62, (deckY || h) - 0.15);
      if (y1 - y0 > 0.12) {
        for (const sx of [-1, 1]) {
          P.box(0.006, y1 - y0, d * 0.62, M.enamel(accent, grime), { pos: [sx * (w / 2 + 0.002), (y0 + y1) / 2, -d * 0.05], parent: root });
          P.box(0.008, 0.02, d * 0.66, trim, { pos: [sx * (w / 2 + 0.003), y1 + 0.02, -d * 0.05], parent: root });
        }
      }
    }
    // coin door + speaker grille on the lower front
    if (style === 'upright' || style === 'slant' || style === 'lowboy') {
      const doorY = kick + (deckY - 0.08 - kick) * 0.32;
      P.box(0.24, 0.3, 0.012, M.enamel(0x15151c, 0.4), { bevel: 0.003, pos: [w * 0.12, doorY, hd + 0.005], parent: root });
      P.box(0.2, 0.26, 0.006, M.brass(), { pos: [w * 0.12, doorY, hd + 0.012], parent: root });
      P.box(0.17, 0.2, 0.006, M.enamel(0x1d1d26, 0.4), { pos: [w * 0.12, doorY + 0.01, hd + 0.017], parent: root });
      if (w > 0.5) P.box(Math.min(0.22, w * 0.3), 0.07, 0.008, M.grille(), { pos: [-w * 0.18, doorY + 0.07, hd + 0.005], parent: root });
    }
    // coin tray
    if (o.tray) {
      const tray = controls.coinTray({ w: Math.min(0.4, w * 0.7) });
      tray.root.position.set(0, kick + 0.16, hd + 0.015);
      root.add(tray.root);
      P.box(Math.min(0.4, w * 0.7) + 0.04, 0.12, 0.012, 0x08080c, { pos: [0, kick + 0.24, hd + 0.003], parent: root });
      anchors.tray = tray.anchor;
    }

    // ── anchors ──
    anchors.speaker = mk('speaker', 0, Math.max(headCenterY, h * 0.8), hd + 0.02);
    if (faceTop && faceBot) {
      const sy = o.screen?.y ?? (faceTop[1] + faceBot[1]) / 2;
      const k = (sy - faceBot[1]) / (faceTop[1] - faceBot[1] || 1);
      const sz = faceBot[0] + (faceTop[0] - faceBot[0]) * Math.min(1, Math.max(0, k));
      const tilt = (o.screen?.tilt ?? faceTilt / D2R) * D2R;
      anchors.screen = mk('screen', 0, sy, sz + 0.004, -tilt);
    } else if (o.screen) {
      anchors.screen = mk('screen', 0, o.screen.y, frontMaxZ + 0.004, -(o.screen.tilt ?? 0) * D2R);
    }
    if (deckY > 0 && style !== 'tower' && style !== 'wall') {
      const pz = style === 'counter' ? 0 : hd + lip * 0.45;
      anchors.panel = mk('panel', 0, deckY + (style === 'counter' ? 0 : Math.tan(deckTilt) * lip * 0.4), pz, deckTilt);
    }
    anchors.topper = mk('topper', 0, headCenterY, style === 'upright' ? hd + 0.03 : o.topper ? -hd + 0.2 : -hd + 0.05);
    anchors.coinSlot = mk('coin_slot', w * 0.12, kick + ((deckY || h) - 0.08 - kick) * 0.32 + 0.06, hd + 0.022);

    const colliders: LocalAABB[] = [{
      min: [-w / 2 - 0.02, 0, -hd - 0.02], max: [w / 2 + 0.02, totalH, frontMaxZ + 0.02], tag: 'solid',
    }];

    // suggested camera
    const pose = ((): CabinetPart['suggestedPose'] => {
      const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
      switch (style) {
        case 'upright': return { pos: V(0, 1.3, hd + 0.41), look: V(0, 1.22, hd - 0.13), fov: 52 };
        case 'slant': return { pos: V(0, 1.18, hd + 0.22), look: V(0, 0.98, hd - 0.32), fov: 50 };
        case 'lowboy': return { pos: V(0, 1.2, hd + 0.3), look: V(0, Math.max(0.7, h * 0.9), hd - 0.3), fov: 50 };
        case 'tower': return { pos: V(0, 1.58, hd + 0.42), look: V(0, 1.25, hd - 0.2), fov: 52 };
        case 'wall': return { pos: V(0, 1.62, hd + 1.1), look: V(0, 1.4, 0), fov: 66 };
        default: return { pos: V(0, 1.55, hd + 0.4), look: V(0, 1.2, 0), fov: 52 };
      }
    })();

    return { root, body, anchors, colliders, suggestedPose: pose };
  };

  return { cabinet };
}
