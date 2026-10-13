/**
 * Cutscene UI strings (CUTSCENE WP). Story lines live in each scene's own `*.strings.ts` (`story.<id>.*`).
 */
export default {
  prefix: 'cutscene.',
  en: {
    choose: 'CHOOSE',
    skipVote: 'SKIP VOTE CAST…',
    'skip.prompt': 'TAP {key}: next line  ·  HOLD {key}: skip scene',
    'skip.online': 'HOLD {key}: vote to skip scene',
  },
  tr: {
    choose: 'SEÇ',
    skipVote: 'ATLAMA OYU VERİLDİ…',
    'skip.prompt': '{key} DOKUN: sonraki satır  ·  {key} BASILI TUT: sahneyi atla',
    'skip.online': '{key} BASILI TUT: sahneyi atlamak için oy ver',
  },
};
