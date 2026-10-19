/**
 * THE WALK HOME, the street's props (world/street): the old car (and the taxi on the same body), the closed büfe, the street lamp
 * and the cat. Low poly kit parts; each builder returns a group placed by the caller (origin on the ground), static parts only,
 * except the cat's tail (returned so the street can sway it).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { Hex } from '@/core/types';
import { crispLabel } from '../props/signs';

/** An old saloon (a 70s Turkish family car), its length along z, origin at the ground centre. 1.7 x 4.3 m. */
export function oldCar(kit: KitX, o: { body: Hex; taxi?: boolean }): THREE.Group {
  const g = kit.group(o.taxi ? 'street:taxi' : 'street:car');
  const body = kit.mat({ color: o.body });
  const glass = kit.mat({ color: 0x141a22 });
  const chrome = kit.mat({ color: kit.pal.chrome });
  const black = kit.mat({ color: 0x0c0c0e });
  kit.box(1.7, 0.62, 4.3, body, { pos: [0, 0.6, 0], parent: g });
  kit.box(1.5, 0.5, 2.1, glass, { pos: [0, 1.15, 0.15], parent: g });
  kit.box(1.52, 0.06, 2.0, body, { pos: [0, 1.42, 0.15], parent: g });
  for (const z of [-2.17, 2.17]) kit.box(1.74, 0.12, 0.08, chrome, { pos: [0, 0.42, z], parent: g });
  // headlights at the front (-z), tail lights at the back
  const head = kit.mat({ color: 0xe8e0c0, lit: false });
  const tail = kit.mat({ color: 0x5a1010, lit: false });
  for (const x of [-0.58, 0.58]) {
    kit.cyl(0.11, 0.11, 0.04, head, { pos: [x, 0.7, -2.16], rot: [90, 0, 0], parent: g, seg: 8 });
    kit.box(0.3, 0.12, 0.04, tail, { pos: [x, 0.72, 2.16], parent: g });
  }
  for (const x of [-0.82, 0.82]) for (const z of [-1.35, 1.35]) {
    kit.cyl(0.32, 0.32, 0.22, black, { pos: [x, 0.32, z], rot: [0, 0, 90], parent: g, seg: 10 });
    kit.cyl(0.14, 0.14, 0.23, chrome, { pos: [x, 0.32, z], rot: [0, 0, 90], parent: g, seg: 8 });
  }
  if (o.taxi) {
    // the roof light: TAKSİ on both sides, lit (a cab waiting for a fare)
    kit.box(0.5, 0.18, 0.22, kit.mat({ color: 0xf0e0a0, lit: false }), { pos: [0, 1.54, 0.15], parent: g });
    for (const x of [-0.26, 0.26]) {
      const l = crispLabel(kit, { text: 'TAKSİ', w: 0.2, h: 0.08, color: 0x101010, bg: 0xf0d860 });   // i18n-ok: an in-world Turkish sign
      l.mesh.position.set(x, 1.54, 0.15);
      l.mesh.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(l.mesh);
    }
    // the checker band along the doors
    const check = kit.mat({ color: 0x101010 });
    for (const x of [-0.86, 0.86]) kit.box(0.01, 0.08, 3.2, check, { pos: [x, 0.78, 0], parent: g });
  }
  return g;
}

/** The büfe: a small closed kiosk, its rolled shutter facing -x (the road), a sign on top. 1.8 x 2.6 m, 2.5 m high. */
export function kiosk(kit: KitX, shutter: THREE.Material): THREE.Group {
  const g = kit.group('street:bufe');
  const white = kit.mat({ color: 0xd8d4c8 });
  const red = kit.mat({ color: 0xa82a22 });
  kit.box(1.8, 2.4, 2.6, white, { pos: [0, 1.2, 0], parent: g });
  kit.box(2.0, 0.12, 2.9, red, { pos: [-0.1, 2.46, 0], parent: g });                 // the roof's lip
  kit.box(0.04, 1.4, 2.2, shutter, { pos: [-0.92, 1.25, 0], parent: g });             // the rolled shutter, down for the night
  kit.box(0.3, 0.06, 2.4, white, { pos: [-1.0, 0.5, 0], parent: g });                 // the counter ledge under it
  const sign = crispLabel(kit, { text: 'BÜFE', w: 1.6, h: 0.42, color: 0xffffff, bg: 0xa82a22 });   // i18n-ok: an in-world Turkish sign
  sign.mesh.position.set(-0.93, 2.15, 0);
  sign.mesh.rotation.y = -Math.PI / 2;
  g.add(sign.mesh);
  // a freezer on the pavement, chained shut, and a crate of empties
  kit.box(0.7, 0.85, 1.0, kit.mat({ color: 0xc8c8c0 }), { pos: [-0.1, 0.43, 1.95], parent: g });
  kit.box(0.45, 0.3, 0.35, kit.mat({ color: 0x2a5a3a }), { pos: [-0.75, 0.15, -1.6], parent: g });
  return g;
}

/** A street lamp on the pavement: a pole, an arm reaching over the road (+x), the head with its bulb. Origin at the foot. */
export function lampPost(kit: KitX, color: Hex): THREE.Group {
  const g = kit.group('street:lamp');
  const iron = kit.mat({ color: 0x2a2c30 });
  kit.cyl(0.07, 0.1, 5.0, iron, { pos: [0, 2.5, 0], parent: g, seg: 6 });
  kit.box(1.3, 0.06, 0.06, iron, { pos: [0.6, 4.95, 0], parent: g });
  kit.box(0.5, 0.12, 0.3, iron, { pos: [1.2, 4.9, 0], parent: g });
  const bulb = kit.lamp({ r: 0.12, color, shape: 'flat' });
  bulb.root.position.set(1.2, 4.82, 0);
  bulb.root.rotation.x = Math.PI;
  bulb.setOn(true);
  g.add(bulb.root);
  return g;
}

/** The cat: sitting, facing +z, about 30 cm tall. The tail is returned so the caller can sway it. */
export function cat(kit: KitX): { root: THREE.Group; tail: THREE.Object3D } {
  const g = kit.group('street:cat');
  const fur = kit.mat({ color: 0x3a3028 });
  kit.box(0.16, 0.2, 0.26, fur, { pos: [0, 0.1, -0.02], parent: g });                 // the body, haunches down
  kit.box(0.13, 0.12, 0.12, fur, { pos: [0, 0.27, 0.08], parent: g });                // the head
  for (const x of [-0.04, 0.04]) {
    kit.box(0.03, 0.05, 0.02, fur, { pos: [x, 0.35, 0.08], parent: g });              // ears
    kit.box(0.02, 0.015, 0.01, kit.mat({ color: 0xd8e060, lit: false }), { pos: [x, 0.285, 0.145], parent: g });   // eyes catch the lamp
  }
  kit.box(0.04, 0.1, 0.04, fur, { pos: [-0.04, 0.05, 0.12], parent: g });             // forelegs
  kit.box(0.04, 0.1, 0.04, fur, { pos: [0.04, 0.05, 0.12], parent: g });
  const tail = new THREE.Group();
  tail.position.set(0, 0.03, -0.15);
  kit.box(0.03, 0.03, 0.22, fur, { pos: [0.02, 0, -0.1], parent: tail });
  g.add(tail);
  return { root: g, tail };
}
