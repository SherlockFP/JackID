/**
 * THE HALL VISITORS (wave 71, world/home): the three silhouettes that stand in the corridor outside the front door (the Listener,
 * the Leaner, the Picker, docs/WAVE71_KNOCK). Each is a skinned mannequin, one of which is shown at a time. The game tells the
 * world which one (showVisitor in index.ts); the world only poses it. Pose and colour tell the type at the peephole.
 *
 *  - THE LISTENER (DİNLEYEN): still at the door, head tilted to it, grey coat. The clip is frozen (speed 0).
 *  - THE LEANER (YASLANAN): big, shoulder to the door, brown coat. He pushes (Push_Loop) against the leaf.
 *  - THE PICKER (KİLİTÇİ): thin and dark, crouched at the lock (Crouch_Idle_Loop), by the knob's height.
 *
 * The mannequins face north (the door): the GLB faces +Z, so a half turn (yaw π) points them at -Z. The poses use the sim clock
 * through the kit's mannequin mixer, so a pause or a slow-mo freezes them with the game.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { MannequinActor } from '@/kit/types';
import { at, DOOR_H, DOOR_HINGE_X, DOOR_Z } from './config';

/** The three visitors of the knock (docs/WAVE71_KNOCK). */
export type HomeVisitor = 'listener' | 'leaner' | 'picker';
export const HOME_VISITORS: readonly HomeVisitor[] = ['listener', 'leaner', 'picker'];

interface VisitorSpec {
  readonly height: number;
  readonly color: number;
  readonly jointColor: number;
  readonly style: 'plain' | 'shadow';
  readonly clip: string;
  readonly speed: number;
  /** The plan point (local metres) where the silhouette stands in the corridor (x, z). */
  readonly x: number;
  readonly z: number;
  /** Whether the head turns to the door (the Listener's tilt). */
  readonly lookAtDoor: boolean;
}

/** The three silhouettes. The hall anchor is at x -0.6, z 3.9; the door's outer face is at z 2.8. */
const SPEC: Record<HomeVisitor, VisitorSpec> = {
  listener: { height: 1.8, color: 0x7a7a80, jointColor: 0x2a2a2e, style: 'plain', clip: 'Idle_Loop', speed: 0, x: -0.6, z: 3.5, lookAtDoor: true },
  leaner: { height: 1.95, color: 0x6b4424, jointColor: 0x2a1a10, style: 'plain', clip: 'Push_Loop', speed: 0.6, x: -0.6, z: 3.0, lookAtDoor: false },
  picker: { height: 1.66, color: 0x1a1a1e, jointColor: 0x0a0a0c, style: 'shadow', clip: 'Crouch_Idle_Loop', speed: 1, x: DOOR_HINGE_X + 0.78, z: 3.05, lookAtDoor: false },
};

/** The Listener's head turns to this point on the door (world space): the leaf's upper half, at the peephole's side. */
const LOOK_DOOR = at(-0.6, DOOR_H * 0.7, DOOR_Z);

export class HallVisitors {
  private readonly actors: Record<HomeVisitor, MannequinActor>;
  private readonly roots: Record<HomeVisitor, THREE.Group>;
  private shown: HomeVisitor | null = null;

  /** Builds the three silhouettes under `parent` (hidden). The caller adds nothing else. */
  constructor(kit: KitX, parent: THREE.Group) {
    const build = (type: HomeVisitor): [MannequinActor, THREE.Group] => {
      const s = SPEC[type];
      const actor = kit.mannequin({ color: s.color, jointColor: s.jointColor, style: s.style, clip: s.clip, height: s.height });
      actor.root.name = `home:visitor:${type}`;
      actor.root.position.set(...at(s.x, 0, s.z));
      // the mannequins' +Z is forward: a half turn faces the door (north, -Z)
      actor.root.rotation.y = Math.PI;
      actor.setSpeed(s.speed);
      actor.setVisible(false);
      parent.add(actor.root);
      return [actor, actor.root];
    };
    const l = build('listener');
    const n = build('leaner');
    const p = build('picker');
    this.actors = { listener: l[0], leaner: n[0], picker: p[0] };
    this.roots = { listener: l[1], leaner: n[1], picker: p[1] };
  }

  /** Shows one visitor (poses it, turns the head where the spec says) or hides them all (null). */
  show(type: HomeVisitor | null): void {
    if (this.shown === type) return;
    if (this.shown) this.actors[this.shown].setVisible(false);
    this.shown = type;
    if (!type) return;
    const s = SPEC[type];
    const a = this.actors[type];
    a.setVisible(true);
    a.setSpeed(s.speed);
    void a.play(s.clip, { fade: 0 });
    if (s.lookAtDoor) a.lookAt(new THREE.Vector3(...LOOK_DOOR), 0.4);
    else a.lookAt(null);
  }

  /** The visitor on show, or null. */
  current(): HomeVisitor | null {
    return this.shown;
  }

  /** The Listener's, Leaner's and Picker's root groups (tests and the camera read the spot, not the mesh). */
  root(type: HomeVisitor): THREE.Group {
    return this.roots[type];
  }

  dispose(): void {
    for (const type of HOME_VISITORS) this.actors[type].dispose();
    this.shown = null;
  }
}
