/**
 * THE GHOST SEAT (src/game/ghostSeat.ts): the faint copy at the machine where the player lost most the Night before, and the
 * match that gives a ŞANS star. Loaded by the `*.strings.ts` glob in main.ts.
 */
export default {
  prefix: 'ghost.',
  en: {
    'seat': 'Your ghost is at the {machine} tonight. Beat it.',
    'seat.none': 'No copy tonight. Nothing was lost enough to leave a mark.',
    'match.lost': 'You beat the copy here. The copy lost this round.',
    'match.won': 'The copy took the round you lost.',
  },
  tr: {
    'seat': 'Hayaletin bu gece {machine} masasında. Onu yen.',
    'seat.none': 'Bu gece kopya yok. Burada kaybın yeterince büyük değildi.',
    'match.lost': 'Kopyayı burada yendin. Bu eli kopya kaybetti.',
    'match.won': 'Kopya kaybettiğin eli aldı.',
  },
};
