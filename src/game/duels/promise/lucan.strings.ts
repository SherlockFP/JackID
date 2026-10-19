/**
 * LUCAN'S TABLE (Rock, Paper, Promise as the Night 3 boss duel, `lucan.ts`): clue lines, the reveal scripts, the Tally Sheet rows, the HUD
 * and the Gambler's Eye thoughts. Keys are `duel.pr.<part>`; the hand names are built into the keys (`ev.hands.rock.paper`) because a
 * Tally Sheet row is stored as a key plus numbers, so it can switch language after it was written. Plain words; Lucan says "sen".
 */
import { HANDS, type Hand } from './rules';

type Table = Record<string, string>;

const NAME: Record<'en' | 'tr', Record<Hand, string>> = {
  en: { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' },
  tr: { rock: 'Taş', paper: 'Kağıt', scissors: 'Makas' },
};

function hands(l: 'en' | 'tr'): Table {
  const out: Table = {};
  const n = NAME[l];
  for (const h of HANDS) {
    if (l === 'en') {
      out[`act.promise.${h}`] = `PROMISE ${n[h].toUpperCase()}`;
      out[`act.throw.${h}`] = `THROW ${n[h].toUpperCase()}`;
      out[`act.switch.${h}`] = `SWITCH TO ${n[h].toUpperCase()}`;
      out[`ev.say.you.${h}`] = `You promise ${n[h]}.`;
      out[`ev.say.him.${h}`] = `Lucan: "I'll throw ${n[h]}."`;
      out[`line.you.${h}`] = `You promised ${n[h]}.`;
      out[`line.him.${h}`] = `Lucan promised ${n[h]}.`;
    } else {
      out[`act.promise.${h}`] = `SÖZ VER: ${n[h].toUpperCase()}`;
      out[`act.throw.${h}`] = `AT: ${n[h].toUpperCase()}`;
      out[`act.switch.${h}`] = `DEĞİŞTİR: ${n[h].toUpperCase()}`;
      out[`ev.say.you.${h}`] = `Söz veriyorsun: ${n[h]}.`;
      out[`ev.say.him.${h}`] = `Lucan: "${n[h]} atacağım."`;
      out[`line.you.${h}`] = `Verdiğin söz: ${n[h]}.`;
      out[`line.him.${h}`] = `Lucan'ın sözü: ${n[h]}.`;
    }
    for (const g of HANDS) {
      out[`ev.hands.${h}.${g}`] = l === 'en' ? `You show ${n[h]}. He shows ${n[g]}.` : `Sen ${n[h]} gösterdin. O ${n[g]} gösterdi.`;
    }
  }
  return out;
}

/** The generated keys sit under `pr.` with the rest. */
const pre = (t: Table): Table => Object.fromEntries(Object.entries(t).map(([k, v]) => [`pr.${k}`, v]));

export default {
  prefix: 'duel.',
  en: {
    ...pre(hands('en')),
    // clues
    'pr.tell.glance': 'Lucan checks the watch before he answers. He did not before he called.',
    'pr.tell.look': 'The watch glints. He is looking at the glass again.',
    'pr.table.glass': 'The watch glass catches your glove under the table edge.',
    'pr.math.answered': 'Tally Sheet: he answered {n} of your throws and won {won}.',
    // the thoughts of the Gambler's Eye
    'pr.eye.watch': 'He only checks the watch when he answers.',
    'pr.eye.look': 'He is looking. Do not move.',
    'pr.eye.glass': 'The glass. It holds my glove.',
    'pr.eye.wide': 'He has kept every word. That is the point.',
    // reveal
    'pr.reveal.saw': 'He checked the watch before every throw he answered, and the glass held your glove.',
    'pr.reveal.happened': 'The cracked watch is a mirror. Under the table edge it showed him your hand, and he threw the answer to it. Every time.',
    'pr.reveal.why': 'I never needed to guess you. A mirror does not guess.',
    'pr.fair.saw': 'The watch never showed him your hand.',
    'pr.fair.happened': 'The mirror was blind before he answered a single throw. Every answer was his own.',
    'pr.fair.why': 'A kept word, a broken word, a good read. You cannot call a cheat that never happened.',
    // HUD
    'pr.call': 'MIRROR',
    'pr.act.photo': 'SET THE PHOTO IN FRONT OF THE WATCH',
    'pr.act.hold': 'HOLD YOUR HAND',
    'pr.act.wait': 'WAIT',
    'pr.line.score': 'You {you} : {him} Lucan. First to {goal}. Cracks: you {yc}, Lucan {hc}.',
    'pr.line.late': 'He has answered. Hold your hand, or change it.',
    'pr.line.photo': 'Her photo covers the watch.',
    // Tally Sheet rows
    'pr.ev.photo': '"I like to look at her when I play." The glass shows a photograph now.',
    'pr.ev.answered': 'Lucan has answered. Your hand is still under the table edge.',
    'pr.ev.out.you': 'You take the round. +{n}',
    'pr.ev.out.him': 'Lucan takes the round. +{n}',
    'pr.ev.out.tie': 'A tie.',
    'pr.ev.kept.you': 'Your word is kept. Double.',
    'pr.ev.kept.him': 'His word is kept. Double.',
    'pr.ev.crack.you': 'You broke your word. Your card cracks.',
    'pr.ev.crack.him': 'Lucan broke his word. His card cracks.',
    'pr.ev.foul': 'FOUL. He saw your hand change.',
    'pr.ev.switchok': 'You change your hand. He is not looking.',
    'pr.ev.end.you': 'The match is yours.',
    'pr.ev.end.him': 'The match is his.',
    // table board
    'pr.goal': 'First to 4 points. Say a hand, then throw. A kept word scores double.',
    'pr.zone.wordHim': 'LUCAN\'S WORD',
    'pr.zone.wordYou': 'YOUR WORD',
    'pr.zone.yours': 'YOUR THROW',
    'pr.zone.last': 'LAST ROUND  ·  you, then him',
    'pr.note.cracks': 'Cracks: you {yc}, Lucan {hc}  ·  {limit} cracks lose',
  } as Table,
  tr: {
    ...pre(hands('tr')),
    'pr.tell.glance': 'Lucan cevap vermeden önce saate bakıyor. Kendi eli sırasında bakmamıştı.',
    'pr.tell.look': 'Saat parlıyor. Yine camına bakıyor.',
    'pr.table.glass': 'Saatin camı, masanın altında eldivenini yakalıyor.',
    'pr.math.answered': 'Hesap Çizelgesi: atışlarından {n} tanesine cevap verdi ve {won} tanesini kazandı.',
    'pr.eye.watch': 'Saate yalnızca cevap verirken bakıyor.',
    'pr.eye.look': 'Bakıyor. Kıpırdama.',
    'pr.eye.glass': 'Cam. Eldivenimi tutuyor.',
    'pr.eye.wide': 'Her sözünü tuttu. Mesele de bu.',
    'pr.reveal.saw': 'Cevap verdiği her atıştan önce saate baktı ve camda eldivenin vardı.',
    'pr.reveal.happened': 'Çatlak saat bir ayna. Masanın altında eldivenini ona gösterdi, o da hep cevabı attı.',
    'pr.reveal.why': 'Seni tahmin etmem gerekmedi. Ayna tahmin etmez.',
    'pr.fair.saw': 'Saat eldivenini ona hiç göstermedi.',
    'pr.fair.happened': 'Daha tek bir atışa cevap vermeden ayna kör oldu. Her cevap kendi aklındı.',
    'pr.fair.why': 'Tutulan söz, bozulan söz, iyi bir okuma. Olmamış bir hileyi ihbar edemezsin.',
    'pr.call': 'AYNA',
    'pr.act.photo': 'FOTOĞRAFI SAATİN ÖNÜNE KOY',
    'pr.act.hold': 'ELİNİ BIRAKMA',
    'pr.act.wait': 'BEKLE',
    'pr.line.score': 'Sen {you} : {him} Lucan. İlk {goal}\'e varan alır. Çatlak: sen {yc}, Lucan {hc}.',
    'pr.line.late': 'Cevap verdi. Elini tut ya da değiştir.',
    'pr.line.photo': 'Fotoğraf saatin önünde.',
    'pr.ev.photo': '"Oynarken ona bakmayı severim." Camda artık bir fotoğraf var.',
    'pr.ev.answered': 'Lucan cevap verdi. Elin hâlâ masanın altında.',
    'pr.ev.out.you': 'Eli sen aldın. +{n}',
    'pr.ev.out.him': 'Eli Lucan aldı. +{n}',
    'pr.ev.out.tie': 'Berabere.',
    'pr.ev.kept.you': 'Sözün tutuldu. Çift puan.',
    'pr.ev.kept.him': 'Onun sözü tutuldu. Çift puan.',
    'pr.ev.crack.you': 'Sözünü bozdun. Kartın çatladı.',
    'pr.ev.crack.him': 'Lucan sözünü bozdu. Kartı çatladı.',
    'pr.ev.foul': 'HATA. Elinin değiştiğini gördü.',
    'pr.ev.switchok': 'Elini değiştirdin. Bakmıyor.',
    'pr.ev.end.you': 'Maç senin.',
    'pr.ev.end.him': 'Maç onun.',
    'pr.goal': 'İlk 4 puana varan kazanır. Bir el söyle, sonra at. Tutulan söz çift puan.',
    'pr.zone.wordHim': 'LUCAN\'IN SÖZÜ',
    'pr.zone.wordYou': 'SENİN SÖZÜN',
    'pr.zone.yours': 'SENİN ELİN',
    'pr.zone.last': 'SON TUR  ·  sen, sonra o',
    'pr.note.cracks': 'Çatlak: sen {yc}, Lucan {hc}  ·  {limit} çatlak kaybettirir',
  } as Table,
};
