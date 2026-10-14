/**
 * The Hollow Door's run-effect lines (`src/game/hollow/rules.ts` → `applyEffects`): the toasts a run shows when a Lord's
 * duel changes the run. The door, phone and Lord copy belongs to `src/world/hollow/hollow.strings.ts`. Keys are prefixed
 * `hollowrun.`; EN and TR must match.
 */
export default {
  prefix: 'hollowrun.',
  en: {
    'forgiven.1': "The Lord's writ forgives this Night's quota.",
    'forgiven.2': "The Lord's writ forgives this Night and the next.",
    'soulRestored': 'You caught the cheat. One Soul Mark returns to your card.',
    'taken': 'You are taken below. The run is over.',
    'banked': 'Your Obols are banked, times 1.5.',
  },
  tr: {
    'forgiven.1': 'Lordun emri bu Gecenin kotasını affediyor.',
    'forgiven.2': 'Lordun emri bu Geceyi ve sonrakini affediyor.',
    'soulRestored': 'Hileyi yakaladın. Bir Ruh İzi kartına geri döndü.',
    'taken': 'Aşağıya alındın. Koşu bitti.',
    'banked': 'Obolların ×1,5 olarak hesaba geçti.',
  },
};
