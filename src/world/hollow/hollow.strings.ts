/**
 * THE HOLLOW DOOR copy (WORLD-SYS, world/hollow). Prompts for the crack, the doorway and the Lords' table, plus the toasts
 * for each reveal path. Keys are prefixed `hollow.`; EN and TR must match.
 */
const strings = {
  prefix: 'hollow.',
  en: {
    'knock': 'Knock on the cracked plate',
    'knock.sub': 'Knocks {n} of 3, within 4 seconds',
    'step': 'Go down',
    'step.sub': 'Through the black',
    'climb': 'Climb back up',
    'climb.sub': 'The door seals. No game, no Lord.',
    'lord.ash': 'Sit with the Lord of Ash',
    'lord.ledgers': 'Sit with the Lord of Ledgers',
    'lord.mirrors': 'Sit with the Lord of Mirrors',
    'lord.sub': 'One Lord per run. The door seals after.',
    'lord.chosen': '{name} has set the table',
    'name.ash': 'Lord of Ash',
    'name.ledgers': 'Lord of Ledgers',
    'name.mirrors': 'Lord of Mirrors',
    'toast.crack': 'The plate gives. Something below is open.',
    'toast.seam': 'A red seam splits the air in front of you.',
    'toast.phone': 'The line goes dead. A door opens under the floor.',
    'toast.missed': 'The seam closes.',
    'toast.left': 'The door seals behind you.',
    'toast.sealed': 'The door is sealed for this run.',
  },
  tr: {
    'knock': 'Çatlak plakaya vur',
    'knock.sub': '4 saniye içinde {n}/3 vuruş',
    'step': 'Aşağı in',
    'step.sub': 'Karanlığın içinden geç',
    'climb': 'Geri tırman',
    'climb.sub': 'Kapı kapanır. Oyun yok, Lord yok.',
    'lord.ash': 'Kül Lordu ile otur',
    'lord.ledgers': 'Defter Lordu ile otur',
    'lord.mirrors': 'Ayna Lordu ile otur',
    'lord.sub': 'Run başına bir Lord. Kapı sonra mühürlenir.',
    'lord.chosen': '{name} masayı kurdu',
    'name.ash': 'Kül Lordu',
    'name.ledgers': 'Defter Lordu',
    'name.mirrors': 'Ayna Lordu',
    'toast.crack': 'Plaka çöktü. Altta bir şey açıldı.',
    'toast.seam': 'Önünde kırmızı bir dikiş havayı yardı.',
    'toast.phone': 'Hat kesildi. Zeminin altında bir kapı açıldı.',
    'toast.missed': 'Dikiş kapandı.',
    'toast.left': 'Kapı arkandan mühürlendi.',
    'toast.sealed': 'Bu run için kapı mühürlü.',
  },
};

export default strings;
