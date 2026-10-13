/**
 * The procedural modeling kit (ART_BIBLE §4, TECH_SPEC §4, BRIEF Addendum 4). `createKit(tex)` wires every part builder
 * to one shared context (tile-tagged TexGen, material presets, animation clock, language hub).
 *
 * Files: prims / geo / materials / presets / tiles (primitives, metric UVs, baked vertex lighting, PSX material
 * presets), finalize (merge-by-look), cabinet / screens / controls / lights (machine hardware), reels / tables /
 * pools / glassware (gambling hardware), mannequin / dealer / props / totem / states (characters, items, overlays),
 * extras (ART §4.8 parts the frozen `Kit` does not list yet: see `KitX`), draw / palette / text (shared helpers).
 *
 * How to model with it
 *  - Build with `kit.*`, parent parts to your root, then `kit.finalize(root, { keep: [...] })` ONCE. Static meshes are
 *    merged by LOOK: colour never splits a draw call (it is baked into vertex colours), textures do. Enamel has two
 *    wear levels (`grime` < / ≥ 0.5), brass · gold · chrome · `M.metal(c)` share the brushed-metal texture, hex colours
 *    and `M.flat(c)` share the untextured one: reuse the presets and a cabinet lands at ~14–16 draws.
 *  - Moving parts are flagged by the kit itself. Kit part roots (button, lever, lamp, screen, marquee, reel, wheel…)
 *    may be listed in `keep` or not: only their moving child stays separate, the static rest is merged. Anything YOU
 *    animate must be in `keep` (or carry `userData.kitKeep`). Live actors (mannequin, dealer) are protected already.
 *  - Draw calls: button 1 · label 1 · screen 1 (+1 halo with `glow`) · marquee 2 · lamp 1 · reel 1 · wheel 3 ·
 *    chip pool 1 · card pool 1 · mannequin 2 · `buttonPanel` 1 for ANY number of buttons (prefer it above 5 buttons).
 *  - Text is always `{ key, vars }` (re-drawn on `lang:changed`); plain strings only for numbers and symbols.
 *  - Textures you create are per-instance: free a model with `disposeObject3D(model.root)` (shared kit textures and
 *    cached materials are skipped automatically).
 *  - Materials and textures are PSX-grade: `Kit.update(dt)` (called by the loop) advances every tween, bulb chain,
 *    screen upload and mannequin mixer on the sim clock, so pause / slow-mo / hit-stop apply to all of it.
 *    While the sim is paused, screen uploads and canvas repaints stall too.
 * Material presets: `presets(kit.tex)` (`@/kit/presets`); canvas helpers (7-segment, CRT schemes, text fit):
 * `@/kit/draw`; the full 48-colour palette: `@/kit/palette`.
 */
import type { TexGen } from '@/core/texgen/types';
import { createCtx } from './ctx';
import { finalizeModel, aabbOf } from './finalize';
import { PALETTE } from './palette';
import { makeCabinet } from './cabinet';
import { makeControls } from './controls';
import { makeLights } from './lights';
import { makeScreens } from './screens';
import { makePools } from './pools';
import { makeReelAndWheel } from './reels';
import { makeSeating, makeTables } from './tables';
import { makeGlassware } from './glassware';
import { makeMannequins } from './mannequin';
import { makeProps } from './props';
import { makeTotems } from './totem';
import { makeStates } from './states';
import { makeDealers } from './dealer';
import { makeExtras, type KitExtras } from './extras';
import type { Kit } from './types';

const MAX_UPLOADS_PER_FRAME = 4;

/** The frozen `Kit` plus the ART §4.8 extras (see extras.ts). */
export type KitX = Kit & KitExtras;

export function createKit(rawTex: TexGen): KitX {
  const ctx = createCtx(rawTex);
  const controls = makeControls(ctx);
  const lights = makeLights(ctx);
  const screens = makeScreens(ctx);
  const cab = makeCabinet(ctx, controls);
  const pools = makePools(ctx);
  const reels = makeReelAndWheel(ctx);
  const seating = makeSeating(ctx);
  const tables = makeTables(ctx, seating);
  const glassware = makeGlassware(ctx);
  const props = makeProps(ctx);
  const totems = makeTotems(ctx);
  const mannequins = makeMannequins(ctx, (id) => props.prop(id));
  const dealers = makeDealers(ctx, mannequins, (id) => props.prop(id));
  const states = makeStates(ctx, { label: screens.label, cabinet: cab.cabinet, screen: screens.screen });

  const base: Kit = {
    pal: PALETTE,
    tex: ctx.tex,
    ...ctx.P,
    finalize: (root, o) => finalizeModel(root, o),
    aabb: (obj, rel, pad) => aabbOf(obj, rel, pad),
    ...cab, ...screens, ...controls, ...lights, ...pools, ...reels, ...tables, ...glassware,
    stool: seating.stool,
    ...dealers,
    mannequin: mannequins.mannequin,
    loadMannequin: mannequins.loadMannequin,
    setLodCamera: mannequins.setLodCamera,
    prop: props.prop, totem: totems.totem, ...states,
    update(dt) {
      ctx.anim.update(dt);
      mannequins.update(dt);
      let n = 0;
      for (const s of ctx.dirty) {
        if (!s.flush(ctx.anim.time)) continue;            // throttled: try again next frame, does not use up the budget
        ctx.dirty.delete(s);
        if (++n >= MAX_UPLOADS_PER_FRAME) break;
      }
    },
  };
  const extras = makeExtras(ctx, { screen: base.screen, label: base.label, lamp: base.lamp, cards: base.cards, chair: seating.chair });
  return Object.assign(base, extras);
}
