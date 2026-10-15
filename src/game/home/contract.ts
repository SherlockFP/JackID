/**
 * THE EVENING (wave 69, director contract): the shared names, types and events of the Home layer (docs/WAVE69_HOME.md,
 * docs/DESIGN_PILLARS.md). Every lane codes against this file, and nothing here holds logic. Change it only with the
 * director's sign-off: four lanes build against it at the same time.
 *
 * The Evening is a sub-state of the run's 'intermission' (no new ShiftPhase). After a paid Dawn and the Mola, the lever takes
 * the lift home. The apartment is a far-offset room (`HOME_ORIGIN`), and the bed opens the next Night. A missed quota in a
 * solo run takes the doomed ride home instead, where the Collector's men are waiting (run end 'fell' with ending 'shot').
 */

/** The apartment origin (floor level). Far from the pit and THE UNDERNEATH (120, -10, 120), above the fall limit (-12). */
export const HOME_ORIGIN: readonly [number, number, number] = [-120, 0, 120];

/** Interactable stations in the apartment. The world emits `home:interact` with one of these, and the game decides. */
export type HomeStation = 'bed' | 'door' | 'peephole' | 'chain' | 'switch' | 'phone' | 'spouse' | 'window';

/** Named world anchors (world.anchor(name)), used by the flow, cutscenes and the camera. */
export const HOME_ANCHORS = {
  spawn: 'home.spawn',       // where the player stands after the ride (inside the front door, facing in)
  bed: 'home.bed',
  door: 'home.door',         // the front door's hinge-side centre, inside
  peephole: 'home.peephole', // eye height at the door, looking out
  hall: 'home.hall',         // the corridor outside the door (where a visitor stands)
  switch: 'home.switch',
  phone: 'home.phone',       // the wall phone / answering machine
  table: 'home.table',       // the kitchen table
  spouse: 'home.spouse',     // the spouse's chair (seated, facing the door)
  window: 'home.window',
} as const;
export type HomeAnchor = typeof HOME_ANCHORS[keyof typeof HOME_ANCHORS];

/** Where the run stands in the Home layer. null: not at home (casino floor). */
export type HomeStage =
  | 'ride'      // the lift up: fade, ding, teleport (input locked)
  | 'evening'   // free walk in the apartment; the bed ends it
  | 'sleep'     // the bed was used: fade, next Night opens, ride back down
  | 'doomed';   // a missed quota (solo): the ride home ends in the Collector's visit

/** The apartment's controls, built by src/world/home and exposed on `World.home`. */
export interface HomeRoomApi {
  /** The room's ceiling light (the switch). Off = the apartment is dark except the window and the door crack. */
  setLights(on: boolean): void;
  lightsOn(): boolean;
  /** The door chain (visual + state). */
  setChain(on: boolean): void;
  chainOn(): boolean;
  /** Swing the front door to `amount` (0 shut .. 1 open) over `dur` seconds. */
  doorTo(amount: number, dur: number): Promise<void>;
  /** Show or hide the seated spouse (absent on a night of Harmony 0). */
  setSpouse(present: boolean): void;
  /** A short light strip under the door that shows a visitor's shadow (wave 70 uses it; wave 69 builds it, off). */
  setDoorShadow(on: boolean): void;
}

/** Message threads on the player's phone. */
export type PhoneThread = 'spouse' | 'collector';

export interface PhoneMessage {
  /** Unique within a run: `${thread}:${night}:${watch}:${k}`. */
  id: string;
  thread: PhoneThread;
  /** Printed Night (1-based) and Watch (1-based) it arrived in. */
  night: number;
  watch: number;
  /** i18n key of the message text and its vars. */
  textKey: string;
  vars?: Record<string, string | number>;
  /** i18n keys of the reply options (empty: no reply needed). */
  replies: string[];
  read: boolean;
  /** Index of the reply sent, or null. */
  answered: number | null;
}

/** The phone's opaque save slice (owned by src/game/home/phone.ts, stored by the run in RunExt.home). */
export type PhoneSave = Record<string, unknown>;

/** The phone model the run creates (`createPhone(run)` in src/game/home/phone.ts) and the UI reads via `run.homePhone()`. */
export interface HomePhoneApi {
  /** Sim-time tick, called by the run every frame (any phase). Schedules messages during play only. */
  tick(dt: number): void;
  messages(): readonly PhoneMessage[];
  unread(): number;
  markRead(thread: PhoneThread): void;
  /** Send reply `choice` to message `id`. Applies its effect once. False if unknown or already answered. */
  reply(id: string, choice: number): boolean;
  /** The spouse's Harmony 0..5 (start 3). Wave 69: moved by replies, by the quota margin and by the Evening talk. */
  harmony(): number;
  /** The Collector's Heat 0..6 (start 0). Wave 69: moved by Collector replies and thin margins; wave 70 adds more inputs. */
  heat(): number;
  /** The Evening began (spouse present or not, request checks). Called once per Evening by the flow. */
  onEvening(): void;
  /** The player talked to the spouse at home. Returns the i18n lines to show (typewriter), and applies a blessing once. */
  talk(): Array<{ key: string; vars?: Record<string, string | number> }>;
  snapshot(): PhoneSave | undefined;
  restore(s: PhoneSave | undefined): void;
  dispose(): void;
}

/** The Home slice of the run save (RunExt.home, optional: older saves have none). */
export interface HomeSave {
  stage: HomeStage | null;
  /** Sim seconds left in the current stage (the Evening's auto-sleep timer). */
  left: number;
  lights: boolean;
  chain: boolean;
  phone?: PhoneSave;
}

/** Sound names the audio lane adds to src/core/audio/sfx.ts (and the ambience bed). */
export const HOME_SFX = {
  knock: 'knock', chain: 'chainRattle', lightSwitch: 'lightSwitch', bed: 'bedCreak',
  buzz: 'phoneBuzz', ding: 'liftDing', blip: 'msgBlip', lockTurn: 'lockTurn',
} as const;
export const HOME_AMBIENCE = 'apartment';

declare module '@/core/events' {
  interface GameEvents {
    /** The player used a station in the apartment (world → game). */
    'home:interact': { station: HomeStation };
    /** The Home stage changed (null: back on the casino floor). */
    'home:stage': { stage: HomeStage | null };
    /** A phone message arrived. */
    'msg:in': { msg: PhoneMessage };
    /** A phone message was answered. */
    'msg:reply': { id: string; thread: PhoneThread; choice: number };
  }
}
