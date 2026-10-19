/**
 * The Steam Next Fest demo (`npm run build:demo`, vite `--mode demo`): Nights 1-3, ending on Lucan's broken word. The flag is baked
 * by vite.config.ts (`__DEMO__`), the way the version id is. Pure rules live here so a test can pin them; the card is game/demoEnd.ts.
 */
declare const __DEMO__: boolean | undefined;

export const DEMO: boolean = typeof __DEMO__ !== 'undefined' && __DEMO__ === true;
/** The demo run ends in this printed Night: after Lucan's duel, or at its paid Dawn when Lucan never sat down. */
export const DEMO_LAST_NIGHT = 3;

/** True when this event closes a demo run: Lucan's duel on the last Night (`rivalId`), or the paid Dawn of it (no rival). */
export function demoRunEnds(demo: boolean, night: number, rivalId?: string): boolean {
  return demo && night === DEMO_LAST_NIGHT && (rivalId === undefined || rivalId === 'lucan');
}

export type MainFace = 'multi' | 'settings' | 'free' | 'quit' | 'play' | 'foundations' | 'credits';
/** The main die's faces. The demo has no multiplayer and no Free Casino: those faces show CREDITS and a second PLAY. */
export function mainFaces(demo: boolean): readonly MainFace[] {
  return demo ? ['credits', 'settings', 'play', 'quit', 'play', 'foundations'] : ['multi', 'settings', 'free', 'quit', 'play', 'foundations'];
}
