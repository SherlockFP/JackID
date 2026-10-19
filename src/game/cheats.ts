/**
 * KONSOL, the cheat console on the home computer (src/game/home/computer.ui.ts draws it). Pure rules: no DOM, no clock, no random.
 *
 * A typed line is folded to a code (upper case, Turkish letters to ASCII, only letters and digits kept), so "Sakın Gece", "sakingece"
 * and "SAKİNGECE" are the same code. A code either acts at once (`now`) or switches on mod effects for ONE Night (`fx`): the effects
 * ride a single 'debug' source in the run's own modifier pipeline, the way boons and buffs do, and go out when the next Night is paid
 * (the ride home) or the run ends. A few effects use `x.cheat.*` hooks that run.ts reads (see the report: `isLocked`, `jokerSpeak`).
 *
 * The first code of a run asks once ("no achievements"), then marks the run CHEATED: `save.data.cheated` holds the run's seed. A cheated
 * run earns no achievements (achievements.ts reads `isCheated`) and its end must not write bests (run.ts `endRun` reads the same flag).
 */
import { bus } from '@/core/events';
import { SOUL_MARKS_PER_RUN } from '@/game/duels/stakes';
import type { ModEffect, ModProvider } from '@/game/modifiers.types';
import type { SaveStore } from '@/core/save';

declare module '@/core/events' {
  interface GameEvents {
    /** The run took its first cheat code: the HİLE tag shows and the achievements stop. */
    'cheat:marked': { seed: number };
  }
}

/** The run side KONSOL needs (the DebtRun fits). */
export interface CheatRun {
  readonly seed: number;
  readonly mods: { register(p: ModProvider): () => void; touch(): void };
  earn(cur: 'coin', amount: number, reason: string): void;
  restoreSoulMark?(): void;
  readonly duel?: { soulMarks(): number };
  homeSaveNow?(): void;
}
type CheatSave = Pick<SaveStore, 'data' | 'update' | 'flush'>;

export interface CheatDef {
  /** Folded code, e.g. 'SANSLIYIM'. Strings: `konsol.ok.<code lower case>` and `konsol.fx.<code lower case>`. */
  code: string;
  /** Effects for one Night (through the KONSOL mod source). */
  fx?: readonly ModEffect[];
  /** False = there is nothing to do right now (no mark, no reply but "nothing to do"). */
  can?: (run: CheatRun) => boolean;
  /** Acts at once. */
  now?: (run: CheatRun) => void;
}

const fx = (hook: ModEffect['hook'], op: ModEffect['op'], value: number): ModEffect => ({ hook, op, value });

export const CHEATS: readonly CheatDef[] = [
  // +3 ŞANS stars: the luck meter listens for floor:luck (the Crooked Table uses the same event), and clamps at its cap
  { code: 'SANSLIYIM', now: () => { bus.emit('floor:luck', { star: 3, why: 'konsol' }); } },
  { code: 'BABAPARASI', now: (r) => { r.earn('coin', 200, 'cheat:konsol'); } },
  // run.ts: isLocked() reads x.cheat.openAll
  { code: 'ACIKKAT', fx: [fx('x.cheat.openAll', 'set', 1)] },
  // Dread stays at 0 (no blackout, no flicker, no scare) and the omens stay quiet (watchEvents.ts reads x.cheat.quiet)
  { code: 'SAKINGECE', fx: [fx('dread.add', 'add', -100), fx('x.cheat.quiet', 'set', 1)] },
  { code: 'TAHSILDARYOK', fx: [fx('quota.mult', 'mult', 0.75)] },
  // run.ts: jokerSpeak() and the dare read x.cheat.lokiQuiet
  { code: 'LOKISUS', fx: [fx('x.cheat.lokiQuiet', 'set', 1)] },
  { code: 'ALTINEL', can: (r) => (r.duel?.soulMarks() ?? SOUL_MARKS_PER_RUN) < SOUL_MARKS_PER_RUN, now: (r) => { r.restoreSoulMark?.(); } },
  { code: 'BIRDAHA', fx: [fx('x.run.pullsAdd', 'add', 2)] },
];

/** What the console prints back: a string key (+ vars), and a tone for the colour and the sound. */
export interface CheatReply { key: string; tone: 'ok' | 'err' | 'ask'; vars?: Record<string, string | number> }

export interface Cheats {
  /** One typed line. Null for a blank line. */
  submit(line: string): CheatReply | null;
  /** Codes switched on for this Night. */
  active(): readonly string[];
  cheated(): boolean;
  dispose(): void;
}

/** Upper case, Turkish letters folded (ı İ ş ğ ç ö ü), anything but A-Z and 0-9 dropped. */
export function foldCode(s: string): string {
  return s.replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');   // i18n-ok
}

/** True when the run with this seed took a cheat. */
export const isCheated = (save: Pick<SaveStore, 'data'>, seed: number | undefined): boolean => seed !== undefined && save.data.cheated === seed;
/** The run is over: its mark goes (a later run with the same seed, like the daily, starts clean). */
export function clearCheated(save: Pick<SaveStore, 'data' | 'update'>): void {
  if (save.data.cheated !== undefined) save.update((d) => { delete d.cheated; });
}

const YES = new Set(['E', 'EVET', 'Y', 'YES']);   // i18n-ok: the answers to the warning, Turkish and English

export function createCheats(run: CheatRun, save: CheatSave): Cheats {
  const on = new Set<string>();
  let live: ModEffect[] = [];
  let ask: CheatDef | null = null;   // the code waiting for the warning's answer

  const provider: ModProvider = {
    kind: 'debug',
    collect(_q, out) { if (live.length > 0) out.push({ kind: 'debug', id: 'konsol', owner: 0, effects: live }); },
  };
  const unregister = run.mods.register(provider);
  const set = (): void => { live = CHEATS.filter((c) => on.has(c.code)).flatMap((c) => c.fx ?? []); run.mods.touch(); };
  const clear = (): void => { if (on.size === 0) return; on.clear(); set(); };
  const cheated = (): boolean => isCheated(save, run.seed);

  /** Why a code does nothing right now, or null. */
  const refusal = (def: CheatDef): CheatReply | null =>
    def.fx && on.has(def.code) ? { key: 'konsol.already', tone: 'err' }
      : def.can && !def.can(run) ? { key: 'konsol.none', tone: 'err' } : null;

  const apply = (def: CheatDef): CheatReply => {
    const no = refusal(def);
    if (no) return no;
    if (!cheated()) {
      save.update((d) => { d.cheated = run.seed; });
      save.flush();
      bus.emit('cheat:marked', { seed: run.seed });
    }
    def.now?.(run);
    if (def.fx) { on.add(def.code); set(); }
    run.homeSaveNow?.();
    return { key: `konsol.ok.${def.code.toLowerCase()}`, tone: 'ok' };
  };

  // a Night's effects end when that Night is paid (the ride home) or the run ends
  const offs = [
    bus.on('home:stage', ({ stage }) => { if (stage === 'ride') clear(); }),
    bus.on('run:end', clear),
  ];

  return {
    submit(line): CheatReply | null {
      const code = foldCode(line);
      if (ask) {
        const def = ask;
        ask = null;
        return YES.has(code) ? apply(def) : { key: 'konsol.warn.no', tone: 'err' };
      }
      if (!code) return null;
      if (code === 'YARDIM' || code === 'HELP') return { key: 'konsol.help', tone: 'ok' };
      const def = CHEATS.find((c) => c.code === code);
      if (!def) return { key: 'konsol.unknown', tone: 'err' };
      if (cheated() || refusal(def)) return apply(def);
      ask = def;
      return { key: 'konsol.warn', tone: 'ask' };
    },
    active: () => [...on],
    cheated,
    dispose(): void {
      for (const o of offs) o();
      clear();
      unregister();
    },
  };
}
