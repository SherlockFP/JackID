/**
 * Rival's Terms (STORY lane, Wave 25): a boss Night's modifier, announced by the rival as "Rival's Terms". Reads the same
 * seeded boss the run uses (`bossFor` in `game/bosses.ts`), so the announced modifier always matches the one in play.
 *
 * The boss name and description are the run's own strings (`event.<boss id>.name|desc`, registered by run.ts). Pass them
 * through {@link termsVars} to get the translated vars for the scene (`story.duel.terms.intro` takes `name` and `desc`).
 */
import { t } from '@/core/i18n';
import { bossFor, type BossNight } from '@/game/bosses';

export interface RivalTerms {
  night: number;
  boss: BossNight;
  /** i18n keys of the modifier's name and description (the description may use `{suit}`). */
  nameKey: string;
  descKey: string;
  /** Raw vars for the description (`suit` is set only for Embargo). */
  suit: string;
}

/** The Terms for a boss Night in the run with `seed`, or null when the Night has no boss (rival or not). */
export function rivalTermsFor(seed: number, night: number): RivalTerms | null {
  const boss = bossFor(seed, night);
  if (!boss) return null;
  return {
    night,
    boss,
    nameKey: `event.${boss.id}.name`,
    descKey: `event.${boss.id}.desc`,
    suit: boss.suit ?? '',
  };
}

/** Translated vars for the Terms subtitle (`name`, `desc`), ready for `playStory(id, { vars })`. */
export function termsVars(terms: RivalTerms): Record<string, string> {
  return {
    name: t(terms.nameKey),
    desc: t(terms.descKey, { suit: terms.suit }),
  };
}
