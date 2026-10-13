/** Multiplayer navigation: the one place that leaves the MP panels and enters the party lobby. */
import { app } from '@/core/app';

/** Every DOM panel the multiplayer flow can leave open (server browser, host form, join prompts). */
export const MP_PANELS = ['mp-browser', 'mp-pass', 'mp-code', 'mp-host'] as const;

/** Close the MP panels and enter the party lobby (`role` = who we are in that room). */
export function enterLobby(role: 'host' | 'client'): void {
  for (const id of MP_PANELS) app.ui.closePanel(id);
  void app.go('lobby', { role });
}
