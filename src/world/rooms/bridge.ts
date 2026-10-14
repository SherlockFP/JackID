/**
 * Seam between the rooms lane (`game/rooms.ts`: wing state, keys, lockers, boiler pressure) and the room dressing in
 * the pit. The world never imports `game/rooms.ts` or the run directly: the integrator wires the real helpers once with
 * `setRoomsBridge({...})`. Until then every read answers "sealed, no keys, night 1" and every action does nothing, so the
 * pit builds and runs without the rooms lane.
 */

/** Wing ids of the shared contract (`game/rooms.ts` exports the same union). Each one is also its zone id. */
export type WingId = 'midway' | 'cards' | 'laundry' | 'boiler' | 'gallery' | 'wheels' | 'counting';
/** `wingState(zone)` of the shared contract. */
export type WingState = 'sealed' | 'keyReady' | 'open';

export interface RoomsBridge {
  /** rooms.ts `wingState(zone)`. */
  wingState(wing: WingId): WingState;
  /** `run.wingKeys`. */
  keys(): number;
  /** Night number, 1-based (the Collector's chair shows on Nights 3–7). */
  night(): number;
  /** Tycoon request `{op:'zone', zone, key}`: `key` true = Spend KEY, false = BUY 1.5× quota. */
  sendZone(wing: WingId, key: boolean): void;
  /** rooms.ts locker helper: spends 1 Ticket, rolls the seeded result, emits `room:locker`. `n` is 1–12. */
  openLocker(n: number): void;
  /** rooms.ts pressure helper: current boiler pressure P, 0–100. */
  pressure(): number;
  /** rooms.ts vent helper: resets P and costs 1 pull. */
  vent(): void;
  /** Optional: the Counting Room tape replay (story lane). */
  readLedger?(): void;
}

const IDLE: RoomsBridge = {
  wingState: () => 'sealed',
  keys: () => 0,
  night: () => 1,
  sendZone: () => undefined,
  openLocker: () => undefined,
  pressure: () => 0,
  vent: () => undefined,
};

let current: RoomsBridge = IDLE;

/** Merge the real helpers in (call once, when the run exists). Unset keys keep their idle behaviour. */
export function setRoomsBridge(b: Partial<RoomsBridge>): void {
  current = { ...current, ...b };
}

/** The bridge the dressing reads and calls. Always defined. */
export function roomsBridge(): RoomsBridge {
  return current;
}
