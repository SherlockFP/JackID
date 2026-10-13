/** Multiplayer navigation: the one place that drops the CRT stage and enters the party lobby. */
import { app } from '@/core/app';
import { stage } from './stage';

/** Power the CRT off and enter the party lobby (`role` = who we are in that room). */
export function enterLobby(role: 'host' | 'client'): void {
  stage.close();
  void app.go('lobby', { role });
}
