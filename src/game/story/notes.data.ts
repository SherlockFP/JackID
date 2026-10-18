/**
 * Collectible notes and tapes (STORY lane). Each sits on the floor next to a named world anchor (`world.anchor()`);
 * the exact floor height comes from a downward ray. Text keys: `story.note.<id>.t` (title) and `.b` (body).
 *
 * Gating (WAVE24 §3): a note with `zone` is placed only while that wing is open (`NoteGate.zoneOpen`); a note with `night`
 * is placed only from that Night on (1-based). Notes with neither are always placed. Room notes use the anchor name
 * `<zone>.<noteId>` (e.g. `cards.n15`), which the world lane exports; `mouth.*` and `sump.*` are the Mouth and the Sump.
 */
export interface NoteDef {
  id: string;
  kind: 'note' | 'tape';
  anchor: string;          // a world anchor name (level.ts)
  dx: number; dz: number;  // metres from the anchor, on the floor
  yaw: number;             // radians
  /** Wing (zone id) that must be open for this note to be placed. Undefined = not room-gated. */
  zone?: string;
  /** First Night (1-based) this note exists. Undefined = from Night 1. */
  night?: number;
  /** Placed whatever the wing state: the zone only names the Wash locker pool (the Wash ledger pages lie on the open floor). */
  always?: true;
}

/** What the placement needs to know about the run: which wings are open and which Night it is. */
export interface NoteGate {
  zoneOpen(zone: string): boolean;
  /** The printed 1-based Night number. */
  night(): number;
}

/**
 * Whether a note is placed under `gate`. With no gate, the room-gated notes stay hidden (their wing is unknown) and the
 * ungated ones show as before. Pure, so the tests can load it without the app core.
 */
export function noteOpen(def: NoteDef, gate: NoteGate | null): boolean {
  if (def.zone !== undefined && !def.always && !(gate?.zoneOpen(def.zone) ?? false)) return false;
  if (def.night !== undefined && (gate?.night() ?? 1) < def.night) return false;
  return true;
}

/** Every note in one wing (the Wash's lockers draw from this pool). */
export function notesInZone(zone: string): readonly NoteDef[] {
  return NOTES.filter((d) => d.zone === zone);
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
  // ── WAVE24 §3: Jade (cards), Wash (laundry), Boiler, Parlour, Counting, the Mouth and the Sump ──
  { id: 'n15', kind: 'note', anchor: 'note.n15', dx: 0.6, dz: 0.4, yaw: 0.2, zone: 'cards', night: 2 },
  { id: 'n16', kind: 'note', anchor: 'note.n16', dx: 0.6, dz: 0.4, yaw: -0.4, zone: 'cards', night: 5 },
  // The Wash ledger (quest 1, story/quests.ts): three pages on the open floor, from Night 1 to Night 3 (n19 from Night 3).
  { id: 'n17', kind: 'note', anchor: 'quotaBoard', dx: 1.5, dz: -0.5, yaw: 0.6, zone: 'laundry', always: true },
  { id: 'n18', kind: 'note', anchor: 'jack', dx: -1.1, dz: 0.9, yaw: 0, zone: 'laundry', always: true },
  { id: 'n19', kind: 'note', anchor: 'clock', dx: -1.2, dz: 1.0, yaw: -0.8, zone: 'laundry', night: 3, always: true },
  { id: 'n20', kind: 'note', anchor: 'note.n20', dx: 0.6, dz: 0.4, yaw: 0.3, zone: 'boiler' },
  { id: 'n21', kind: 'note', anchor: 'note.n21', dx: 0.6, dz: 0.4, yaw: -0.2, zone: 'boiler', night: 5 },
  { id: 'n22', kind: 'note', anchor: 'note.n22', dx: 0.6, dz: 0.4, yaw: 0.5, zone: 'parlour' },
  { id: 'n23', kind: 'note', anchor: 'note.n23', dx: 0.6, dz: 0.4, yaw: -0.5, zone: 'parlour' },
  { id: 'n24', kind: 'note', anchor: 'note.n24', dx: 0.6, dz: 0.4, yaw: 0.1, zone: 'counting', night: 6 },
  { id: 'n25', kind: 'note', anchor: 'note.n25', dx: 0.6, dz: 0.4, yaw: -0.1, zone: 'counting', night: 7 },
  { id: 'n26', kind: 'note', anchor: 'note.n26', dx: 0.6, dz: 0.4, yaw: 0.4, zone: 'counting', night: 8 },
  { id: 'n27', kind: 'note', anchor: 'note.n27', dx: 0.6, dz: 0.4, yaw: 0, night: 1 },
  { id: 'n28', kind: 'note', anchor: 'note.n28', dx: 0.6, dz: 0.4, yaw: 0.7 },
];
