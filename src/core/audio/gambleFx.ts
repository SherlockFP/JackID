/**
 * Gamble risk layer → audio, owned by CORE-AUDIO. Listens to the `gamble:fx` events that the risk layer emits
 * (src/game/gamble.ts, fired from src/machines/_base/riskLayer.ts) and plays the matching sfx:
 *
 *   open → gambleOpen riser · flip → cardFlip · win → gambleStep (pitch climbs one scale step per rung)
 *   lose → gambleBust thud · collect → coin cascade sized by the pot · allinArm → short tension riser
 *   allinFire → allinDrum roll · allinWin / allinLose → allinHit / allinMiss stingers
 *
 * Other kinds (offer, tension, max, high-stakes, all-in cancel) are not wired here.
 */
import { bus } from '../events';
import type { AudioEngine } from './types';

/** Semitone offsets of the rung pitches (major pentatonic-ish climb). Past the end the last note holds. */
const RUNG_SEMIS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];

/** Coin clinks for a collect: grows with the square root of the pot, clamped to a readable cascade. */
export const collectCoins = (pot: number): number => Math.min(30, Math.max(6, Math.round(4 + Math.sqrt(Math.max(0, pot)))));

/** Subscribe the engine to `gamble:fx`. Returns the unsubscribe function. */
export function wireGambleFx(engine: AudioEngine): () => void {
  return bus.on('gamble:fx', ({ kind, step, pot }) => {
    switch (kind) {
      case 'open': engine.play('gambleOpen'); break;
      case 'flip': engine.play('cardFlip'); break;
      case 'win': {
        const i = Math.min(Math.max(1, Math.round(step)) - 1, RUNG_SEMIS.length - 1);
        engine.play('gambleStep', { pitch: RUNG_SEMIS[i] });
        break;
      }
      case 'lose': engine.play('gambleBust'); break;
      case 'collect': engine.coins(collectCoins(pot)); break;
      case 'allinArm': engine.play('tensionRise', { param: 0.2 }); break;
      case 'allinFire': engine.play('allinDrum'); break;
      case 'allinWin': engine.play('allinHit'); break;
      case 'allinLose': engine.play('allinMiss'); break;
      default: break;
    }
  });
}
