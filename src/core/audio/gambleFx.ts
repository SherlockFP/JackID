/**
 * Gamble risk layer → audio, owned by CORE-AUDIO. Listens to the `gamble:fx` events that the risk layer emits
 * (src/game/gamble.ts, fired from src/machines/_base/riskLayer.ts) and plays the matching sfx:
 *
 *   open → gambleOpen riser · flip → cardFlip · win → gambleStep (pitch climbs one scale step per rung)
 *   lose → gambleBust thud · collect → coin cascade sized by the pot · allinArm → short tension riser
 *   allinFire → allinDrum roll · allinWin / allinLose → allinHit / allinMiss stingers
 *   tension → tensionRise, longer the higher the rung (the ladder's tension before a flip)
 *   max → winMega and a coin cascade (the top rung is reached) · offer → short chime (double or nothing offered)
 *   hsBoost → chime pitched up with the High Stakes bonus
 *
 * Other kinds (all-in cancel, high-stakes on/off) are not wired here. This layer is sound only: it draws nothing, so the
 * reduce-flashing and calm gates do not apply here.
 */
import { bus } from '../events';
import type { AudioEngine } from './types';

/** Semitone offsets of the rung pitches (major pentatonic-ish climb). Past the end the last note holds. */
const RUNG_SEMIS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];

/** Rungs on the double-or-nothing ladder (= GAMBLE_STEPS in src/game/gamble.ts; core audio does not import game code). */
export const LADDER_RUNGS = 4;

/** Coin clinks for a collect: grows with the square root of the pot, clamped to a readable cascade. */
export const collectCoins = (pot: number): number => Math.min(30, Math.max(6, Math.round(4 + Math.sqrt(Math.max(0, pot)))));

/** `tensionRise` param for the rung about to be flipped (`step` 1-based): 0.25 on the first rung, 1 on the last. */
export const tensionParam = (step: number, rungs = LADDER_RUNGS): number => Math.min(1, Math.max(0, step / rungs));

/** Chime pitch (semitones) for a High Stakes boost of `bonus` coins: 4 for a small bonus, up to 12 for a large one. */
export const hsBoostPitch = (bonus: number): number => Math.min(12, Math.max(4, Math.round(4 + 3 * Math.log10(1 + Math.max(0, bonus)))));

/** Subscribe the engine to `gamble:fx`. Returns the unsubscribe function. */
export function wireGambleFx(engine: AudioEngine): () => void {
  return bus.on('gamble:fx', ({ kind, step, pot }) => {
    switch (kind) {
      case 'open': engine.play('gambleOpen'); break;
      case 'flip': engine.play('cardFlip'); break;
      case 'tension': engine.play('tensionRise', { param: tensionParam(step) }); break;
      case 'win': {
        const i = Math.min(Math.max(1, Math.round(step)) - 1, RUNG_SEMIS.length - 1);
        engine.play('gambleStep', { pitch: RUNG_SEMIS[i] });
        break;
      }
      case 'max': engine.play('winMega', { vol: 0.9 }); engine.coins(Math.min(40, collectCoins(pot) + 10)); break;
      case 'offer': engine.play('chime', { vol: 0.5 }); break;
      case 'hsBoost': engine.play('chime', { vol: 0.7, pitch: hsBoostPitch(pot) }); break;
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
