/**
 * THE ENDINGS (story wave A5): the placeholder card of the six endings that have no finished scene yet (ALONE, THE CHAIR, PAID IN FULL,
 * HE CAME HOME, DESCEND, FALL). Black screen, two or three lines, then the ending's name. Each `ending_<id>.cutscene.ts` default-exports
 * one card. Not a scene itself (no `.cutscene.ts` suffix), so the cutscene glob does not register it. Copy: `../endings.strings.ts`.
 * FALL's last line is Loki's, picked by the run: play it with `vars: { loki: t(record.lokiLine) }`.
 */
import type { CutsceneDef, SubtitleCue } from '@/core/cutscene/types';
import { endingScene, endingTitleKey, type EndingId } from '../endings';

export type CardId = Exclude<EndingId, 'kept_pair' | 'cold_kitchen' | 'kept'>;
export const CARD_IDS: readonly CardId[] = ['alone', 'chair', 'paid_in_full', 'he_came_home', 'descend', 'fall'];

type Line = Pick<SubtitleCue, 'key' | 'speaker' | 'voice' | 'mood'>;
const E = 'story.end.';
const loki = (key: string): Line => ({ key: E + key, speaker: 'story.speaker.loki', voice: 'loki', mood: 'whisper' });
const ada = (n: number): Line => ({ key: `${E}he_came_home.${n}`, speaker: 'evening.speaker.spouse', voice: 'spouse', mood: 'calm' });
const line = (id: CardId, n: number): Line => ({ key: `${E}${id}.${n}` });

const CARDS: Record<CardId, { music: string; lines: Line[] }> = {
  alone: { music: 'ending', lines: [line('alone', 1), line('alone', 2), loki('loki.rides')] },
  chair: { music: 'dread', lines: [line('chair', 1), line('chair', 2), line('chair', 3)] },
  paid_in_full: {
    music: 'tense',
    lines: [line('paid_in_full', 1), { ...line('paid_in_full', 2), speaker: 'story.speaker.collector', voice: 'collector', mood: 'calm' }, loki('loki.likes')],
  },
  he_came_home: { music: 'dread', lines: [line('he_came_home', 1), line('he_came_home', 2), ada(3)] },
  descend: { music: 'dread', lines: [line('descend', 1), loki('loki.comes'), line('descend', 2)] },
  fall: { music: 'defeat', lines: [line('fall', 1), line('fall', 2), loki('loki')] },
};

const STEP = 3.4;
const FIRST = 1.2;

export function endingCard(id: CardId): CutsceneDef {
  const { music, lines } = CARDS[id];
  const titleAt = FIRST + lines.length * STEP;
  const subs: SubtitleCue[] = [
    ...lines.map((l, i): SubtitleCue => ({ t: FIRST + i * STEP, dur: 3.0, ...l })),
    { t: titleAt, dur: 3.2, key: endingTitleKey(id) },
  ];
  return {
    id: endingScene(id),
    kind: 'ending',
    duration: titleAt + 3.8,
    fadeIn: 0.4,
    fadeOut: 1.0,
    tracks: [
      { kind: 'camera', keys: [{ t: 0, pos: { player: 'local' }, look: { anchor: 'quotaBoard' }, fov: 60, cut: true }] },
      { kind: 'subtitle', cues: subs },
      { kind: 'audio', cues: [{ t: 0, do: 'music', state: music, fade: 1.2 }, { t: titleAt, do: 'sfx', name: 'stamp', vol: 0.7 }] },
      { kind: 'fx', cues: [{ t: 0, do: 'fade', alpha: 1, dur: 0.6, color: '#000000' }] },
    ],
  };
}
