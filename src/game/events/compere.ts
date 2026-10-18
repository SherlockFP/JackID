/**
 * The Compere: the House's voice that announces each floor event with one short line (wave 75). Spoken through the subtitle
 * system: the speaker label is translated, the blip voice is `compere` (a stable voice from its name, blip.ts). The line
 * lives in the cue's `ambient` lane, so a cutscene or a story line can still replace it.
 */
import { t } from '@/core/i18n';
import type { SubLine } from '@/core/ui/subtitles';

export const COMPERE_VOICE = 'compere';

/** The Compere's subtitle line for one floor event (`id` is the event id, without the `watch.` prefix). */
export function compereLine(id: string): SubLine {
  return {
    text: t(`event.watch.${id}.compere`),
    speaker: t('event.watch.compere.speaker'),
    voice: COMPERE_VOICE,
    lane: 'ambient',
    source: 'compere',
  };
}
