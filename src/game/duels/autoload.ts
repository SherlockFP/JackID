/**
 * Side-effect import: loads every duel game folder (`src/game/duels/<game>/index.ts`) so each one registers itself with
 * `registry.ts`. Kept apart from the registry on purpose (the games import the registry; a registry that imported the
 * games would run them before its own table exists). The `tallytable` machine imports this once.
 */
import.meta.glob('./*/index.ts', { eager: true })
export {}
