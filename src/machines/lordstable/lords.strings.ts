/**
 * The three Lords' names on the manga plate (EN + TR). The manga layer reads `manga.who.<id>` and `manga.title.<id>`
 * for every speaker, so the Lords register their keys here, next to their table. Loaded by the `*.strings.ts` glob.
 */
export default {
  prefix: 'manga.',
  en: {
    'who.lord_ash': 'Lord of Ash',
    'title.lord_ash': 'The Last Ash',
    'who.lord_ledgers': 'Lord of Ledgers',
    'title.lord_ledgers': 'The Debt Keeper',
    'who.lord_mirrors': 'Lord of Mirrors',
    'title.lord_mirrors': 'Nobody Is Watching',
  },
  tr: {
    'who.lord_ash': 'Kül Lordu',
    'title.lord_ash': 'Son Kül',
    'who.lord_ledgers': 'Defter Lordu',
    'title.lord_ledgers': 'Borç Tutucu',
    'who.lord_mirrors': 'Ayna Lordu',
    'title.lord_mirrors': 'Kimse Bakmıyor',
  },
};
