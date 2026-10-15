/** Watch checkpoints (wave 58, director): the Watch tithe's HUD line, the met and missed banners, and the Bell line. */
export default {
  prefix: 'tithe.',
  en: {
    'label': 'WATCH TITHE',
    'hud': 'WATCH TITHE {earned} / {target} won in play',
    'hudMet': 'WATCH TITHE MET',
    'hint': 'Win {target} net in this Watch (wins less stakes). Deposits do not count.',
    'met': 'WATCH TITHE MET +{tickets} TICKET',
    'missed': 'TITHE MISSED +{n}',
    'missedHint': 'The shortfall joins tonight\'s quota.',
    'off': 'No tithe this Watch',
  },
  tr: {
    'label': 'NÖBET VERGİSİ',
    'hud': 'NÖBET VERGİSİ {earned} / {target} oyunda kazanıldı',
    'hudMet': 'NÖBET VERGİSİ TAMAM',
    'hint': 'Bu Nöbette {target} net kazan (kazançlar eksi bahisler). Yatırmalar sayılmaz.',
    'met': 'NÖBET VERGİSİ TAMAM +{tickets} BİLET',
    'missed': 'VERGİ ÖDENMEDİ +{n}',
    'missedHint': 'Eksik kısım bu gecenin kotasına eklendi.',
    'off': 'Bu Nöbette vergi yok',
  },
};
