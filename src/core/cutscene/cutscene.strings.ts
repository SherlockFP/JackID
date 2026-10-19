/**
 * Cutscene UI strings (CUTSCENE WP). The skip lines carry no key name: the HUD's key chip beside them already shows it. Story lines live in each scene's own `*.strings.ts` (`story.<id>.*`).
 */
export default {
  prefix: 'cutscene.',
  en: {
    choose: 'CHOOSE',
    skipVote: 'SKIP VOTE CAST…',
    'skip.prompt': 'TAP: next line  ·  HOLD: skip scene',
    'skip.online': 'HOLD: vote to skip scene',
    'skip.intro': 'TAP: skip intro',
  },
  tr: {
    choose: 'SEÇ',
    skipVote: 'ATLAMA OYU VERİLDİ…',
    'skip.prompt': 'DOKUN: sonraki satır  ·  BASILI TUT: sahneyi atla',
    'skip.online': 'BASILI TUT: sahneyi atlamak için oy ver',
    'skip.intro': 'DOKUN: girişi atla',
  },
};
