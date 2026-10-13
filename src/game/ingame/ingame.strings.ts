/**
 * In-game shell strings (Debt Run session: loading, pause menu, Intermission panel, Night banner).
 * Loaded by the `*.strings.ts` glob in main.ts. Run HUD / refusal / phase strings live in `game/game.strings.ts`.
 */
export default {
  prefix: 'ingame.',
  en: {
    'loading': 'Building the pit...',
    'night': 'NIGHT {n}',
    'refused': 'Not now.',
    'pause.title': 'Paused',
    'pause.resume': 'RESUME',
    'pause.quit': 'LEAVE THE RUN',
    'pause.hint': 'Esc resumes. Leaving ends the run and prints the receipt.',
    'inter.title': 'Intermission · Night {n}',
    'inter.debt': 'Debt paid {paid} of {due}',
    'inter.continue': 'CONTINUE',
    'inter.stayUp': 'STAY UP',
    'inter.goBack': 'GO BACK DOWN',
    'inter.hint': 'Continue opens the floor after a paid Night, or rings the bell for the next Watch.',
  },
  tr: {
    'loading': 'Çukur kuruluyor...',
    'night': '{n}. GECE',
    'refused': 'Şimdi olmaz.',
    'pause.title': 'Duraklatıldı',
    'pause.resume': 'DEVAM',
    'pause.quit': 'OYUNDAN AYRIL',
    'pause.hint': 'Esc devam ettirir. Ayrılmak oyunu bitirir ve fişi basar.',
    'inter.title': 'Ara · {n}. Gece',
    'inter.debt': 'Ödenen borç {paid} / {due}',
    'inter.continue': 'DEVAM ET',
    'inter.stayUp': 'YUKARIDA KAL',
    'inter.goBack': 'AŞAĞI DÖN',
    'inter.hint': 'Devam et, ödenen Gece sonrası katı açar ya da sonraki Watch için zili çalar.',
  },
};
