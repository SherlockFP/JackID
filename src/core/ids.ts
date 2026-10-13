/**
 * Shared id registries — DECISIONS C35 / TECH §11.1, §11.5. Frozen by Contracts v1.1.
 * Lists are the single source for id typos: `check.mjs` and typed lookups read from here.
 * Not yet listed (owners add them with their packages): prop ids (world/props), cutscene hook ids,
 * light targets and world/HUD sound ids.
 */

/** Machine ids = catalogue ids = folder names under `src/machines/` (TECH §11.1). */
export const MACHINE_IDS = [
  'bigone', 'bandit', 'videopoker', 'elevator', 'scratch', 'pachislot', 'pachinko', 'plinko', 'coinpusher',
  'cyclone', 'mines', 'dicetower', 'lootbox', 'claw', 'stacker', 'fruitmachine', 'bingopin', 'roulette',
  'blackjack', 'holdem', 'devilstable', 'baccarat', 'craps', 'sicbo', 'bigsix', 'cardwar', 'hilo', 'keno',
  'derby', 'fortuneteller', 'coinflip', 'threecard', 'reddog', 'bingo', 'lottoblower', 'tombola', 'shellgame',
  'fantan', 'teetotum',
] as const;
export type MachineIdLit = (typeof MACHINE_IDS)[number];

/** System devices (same machine contract, `category: 'system'`). */
export const SYSTEM_DEVICE_IDS = [
  'debt_terminal', 'hotline', 'charm_vendor',            // the Pawn Window
  'concession_desk', 'cashier', 'jukebox', 'tape_deck', 'tonic_vendor',   // The Apothecary
  'bounty_board', 'shrine',                              // Moth Shrine
] as const;
export type SystemDeviceIdLit = (typeof SYSTEM_DEVICE_IDS)[number];

/**
 * Standard model anchors (`MachineModel.anchors.<name>`, TECH §11.5). `speaker` is required on every model.
 * `marqueeTop` → WORLD-SYS mounts the Circuit badge; `servicePlate` → Level plate, nameplate, staff badge;
 * `upgradeMounts` → tycoon visual parts. Mounts go on the SLOT GROUP, never in `machine.root` (DECISIONS C26).
 */
export const MODEL_ANCHORS = [
  'speaker', 'prompt', 'label', 'marqueeTop', 'servicePlate', 'upgradeMounts', 'light', 'light2',
  'coinOut', 'stand', 'insideGlass', 'fxTwist', 'seatLantern0', 'seatLantern1', 'seatLantern2', 'seatLantern3',
] as const;
export type ModelAnchorId = (typeof MODEL_ANCHORS)[number];

/** Time words (DECISIONS C17): Night = QuotaState.index, Watch = one play window, Dawn = collection. */
export const TIME_WORDS = ['night', 'watch', 'dawn'] as const;
