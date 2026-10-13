/**
 * Collectible notes and tapes (STORY lane). Each sits on the floor next to a named world anchor (`world.anchor()`);
 * the exact floor height comes from a downward ray. Text keys: `story.note.<id>.t` (title) and `.b` (body).
 */
export interface NoteDef {
  id: string;
  kind: 'note' | 'tape';
  anchor: string;          // a world anchor name (level.ts)
  dx: number; dz: number;  // metres from the anchor, on the floor
  yaw: number;             // radians
}

export const NOTES: readonly NoteDef[] = [
  { id: 'n01', kind: 'note', anchor: 'terminal', dx: 0.6, dz: 0.3, yaw: 0 },
  { id: 'n02', kind: 'note', anchor: 'quotaBoard', dx: 0.8, dz: 0.2, yaw: 0.4 },
  { id: 'n03', kind: 'note', anchor: 'clock', dx: 0.5, dz: 0.5, yaw: -0.3 },
  { id: 'n04', kind: 'note', anchor: 'furnace', dx: 0.6, dz: 0.4, yaw: 1.1 },
  { id: 'n05', kind: 'note', anchor: 'jack', dx: 0.5, dz: 0.0, yaw: 0.2 },
  { id: 'n06', kind: 'note', anchor: 'collector', dx: 1.0, dz: 0.6, yaw: 0.9 },
  { id: 'n07', kind: 'note', anchor: 'sump', dx: 0.8, dz: 0.0, yaw: 0 },
  { id: 'n08', kind: 'note', anchor: 'hotline', dx: 0.4, dz: 0.4, yaw: -0.6 },
  { id: 'n09', kind: 'note', anchor: 'parlour.curtain', dx: 0.5, dz: 0.6, yaw: 0.5 },
  { id: 'n10', kind: 'note', anchor: 'mgmt.door', dx: 0.7, dz: 0.3, yaw: 0 },
  { id: 'n11', kind: 'note', anchor: 'elevator.door', dx: 0.6, dz: 0.2, yaw: 0 },
  { id: 'n12', kind: 'note', anchor: 'trapdoor', dx: 1.3, dz: 1.3, yaw: 0.7 },
  { id: 'n13', kind: 'tape', anchor: 'hotline', dx: 1.1, dz: 0.5, yaw: 0 },
  { id: 'n14', kind: 'tape', anchor: 'sump', dx: 1.1, dz: 0.6, yaw: 0.3 },
];
