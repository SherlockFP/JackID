/**
 * THE SECOND NAME (STORY lane, bible wave S1): the Night title cards and the Night 8 reveal. Keys: `story.chapter.n<N>.title` and
 * `.line` (played by the cutscenes `cutscenes/chapter_n<N>.cutscene.ts`), and `story.reveal.<n>` (cutscenes/reveal_n8.cutscene.ts).
 * The reveal keeps its four slots (PA, PA, Clerk, Mira) but no longer names the second name: that stays a mystery until the Wager.
 */
export default {
  prefix: 'story.',
  en: {
    'chapter.n1.title': 'THE FIRST NAME',
    'chapter.n1.line': 'Your name on the card. A smaller one under it.',
    'chapter.n2.title': 'THE WRONG NUMBER',
    'chapter.n2.line': 'A woman wanted the flat next door. You picked up anyway.',
    'chapter.n3.title': 'A MAN OF HIS WORD',
    'chapter.n3.line': 'Four kept words. Watch the fifth.',
    'chapter.n4.title': 'UNCLAIMED',
    'chapter.n4.line': 'Everything in the Wash is lost until somebody looks.',
    'chapter.n5.title': 'HER WORD',
    'chapter.n5.line': 'At home, a game for the truth. Then three knocks.',
    'chapter.n6.title': 'THE COLLECTOR SITS DOWN',
    'chapter.n6.line': 'He hangs his wet raincoat on the chair across from yours.',
    'chapter.n7.title': 'THE AUDIT',
    'chapter.n7.line': 'The Clerk has opened your file. It reads all of it.',
    'chapter.n8.title': 'THE SECOND NAME',
    'chapter.n8.line': 'You put your name on the table. So did she.',
    // the Night 8 reveal (cutscenes/reveal_n8.cutscene.ts): PA, PA, the Clerk, Mira
    'reveal.1': 'Attention, guests. Tonight a card with two names sits down at the final table.',
    'reveal.2': 'The first name owes. The second name beat our champion once. Tonight the champion sits down again.',
    'reveal.3': 'Rule one applies tonight. Whatever is said over the card is entered.',
    'reveal.4': 'Whatever you stake tonight, keep your word. It is the one thing they cannot price.',
  },
  tr: {
    'chapter.n1.title': 'İLK AD',
    'chapter.n1.line': 'Kartta adınız var. Altında, daha küçük bir ad daha.',
    'chapter.n2.title': 'YANLIŞ NUMARA',
    'chapter.n2.line': 'Bir kadın yan daireyi istedi. Yine de açtınız.',
    'chapter.n3.title': 'SÖZÜNÜN ERİ',
    'chapter.n3.line': 'Dört tutulmuş söz. Beşincisine dikkat edin.',
    'chapter.n4.title': 'SAHİPSİZ',
    'chapter.n4.line': 'Çamaşırhanedeki her şey, biri bakana kadar kayıp.',
    'chapter.n5.title': 'ONUN SÖZÜ',
    'chapter.n5.line': 'Evde, gerçek için bir oyun. Sonra üç vuruş.',
    'chapter.n6.title': 'TAHSİLDAR OTURUYOR',
    'chapter.n6.line': 'Islak yağmurluğunu karşınızdaki sandalyeye asıyor.',
    'chapter.n7.title': 'DENETİM',
    'chapter.n7.line': 'Katip dosyanızı açtı. Hepsini okuyacak.',
    'chapter.n8.title': 'İKİNCİ AD',
    'chapter.n8.line': 'Adınızı masaya koydunuz. O da koydu.',
    'reveal.1': 'Misafirlerimizin dikkatine. Bu gece iki adlı bir kart final masasına oturuyor.',
    'reveal.2': 'İlk ad borçlu. İkinci ad şampiyonumuzu bir kez yendi. Bu gece şampiyon yeniden oturuyor.',
    'reveal.3': 'Bu gece birinci kural geçerli. Kart üzerinde söylenen her şey kayda geçer.',
    'reveal.4': 'Bu gece neyi koyarsan koy, sözünü tut. Fiyatını biçemedikleri tek şey o.',
  },
};
