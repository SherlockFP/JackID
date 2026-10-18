**Why the casino is boring (Night 1, debt run, seed 1, headless bench, read-only)**

I walked the pit with `--run` anchors and `goto`, then read about 14 screenshots. The pit is dark, empty and flat. Light only sits on the machines and the HUD.

- **Near-black zones.** Each zone's ambient and fog colour is almost black, with fog falling off at 10 to 32 m (`src/world/layout.ts:266-277`). The Parlour fog is 2 to 10 m (`:276`). The lift was already boosted once after a playtest said the pit read too dark (`src/world/level.ts:34-40`). Screenshots `shots2/10-trapdoor.png`, `shots2/07-parlour.png` and `shots3/02-collector.png` are close to solid black.
- **No people.** The only walking actor is the Collector, and only in a cutscene (`src/game/horror/director.ts:369`). Dealers exist only at table machines. The actor system and patrol graph exist (`src/world/actors/actorDirector.ts`, `src/world/layout.ts:292-317`) but nothing uses them on the floor. Nothing moves or reacts to the player.
- **One sound bed.** Ambience falls back to the generic `'pit'` tone (`src/core/audio/sfx.ts:1124-1185`). Zones have no beds of their own.
- **Flat, repeated floors.** The Mouth floor is a checker grid with nothing to walk to (`shots3/05-quota-b.png`). The Card Room and Boiler are the same kind of box with machines on the walls (`shots2/08-cards.png`, `shots2/09-boiler.png`).
- **Lift reads as a dead end.** The lift niche is dark, and its plate says "OUT OF SERVICE UNTIL PAID IN FULL" (`src/world/props/props.strings.ts:24`, `src/world/props/elevator.ts:104`, `shots2/01-lift.png`). Nothing shows that home is up there.
- **No landmark or events in sight.** Floor events (11 ids) are banners and HUD timers, not things you see on the floor.

**Early complexity and the home problem**

- The first frame is a starter-charm modal (`shots2/00-spawn.png`, `src/game/draft.ts:37`), before the player has been told anything.
- The HUD shows about ten numbers at once: QUOTA, SHORT, PAYOUT x1.48, FAVOUR, MOOD, DAWN, POCKET, DEPOSIT, W1/3 and PULLS. A "SOMETHING IS RUNNING WARM" line and a tutorial box add more.
- The `PHONE [T]` label is visible at the bottom-left from the start, but the spouse only texts during Watches, and home is reached only through a paid Night's lever (`src/game/run.ts:510`, `docs/WAVE69_HOME.md` §2). A new player has no reason to expect anything after the Mola.

**Ten changes, ranked by impact over effort**

1. **Light the route, not the walls (high impact, low effort).** Give each zone a brighter key colour and a light pool on its landmark. Light a clear path from the Mouth past the Terminal to the Big One (`src/world/layout.ts:266-277`, `src/world/level.ts:34-40`, `src/world/sys/lightPool.ts`).
2. **Make the lift the landmark (high, low).** Put a lit HOME sign and a live "due / paid" counter on the lift panel, so it is the first thing seen on the Mouth wall (`src/world/level.ts:274-305`, `src/world/level.ts:453`).
3. **Home is visible from Night 1 (high, low).** Show the lift's destination in the Night 1 plan ("home at Dawn"). Give the spouse one scripted text in Watch 1 of Night 1 so the phone pays off early (`src/game/home/phone.ts`, `docs/WAVE69_HOME.md` §5).
4. **Moving patrons on the floor (high, medium).** Spawn 4 to 6 mannequins as gamblers and staff that wander the nav graph and stop at machines. Reuse `ActorDirector` and `NAV_NODES` (`src/world/actors/actorDirector.ts`, `src/world/layout.ts:292-317`). Some of them carry the dread (a shadow that turns as the player looks).
5. **A stage and an announcer at the Lobby centre (high, medium).** Put a lit stage at the Lobby (`c.lobby`, `layout.ts:294`) with a spotlight and an MC mannequin. Use it for Machine of the Night and big wins (`src/game/spotlight.ts`).
6. **Zone sound beds (medium, low).** Add beds for lobby murmur, gallery hum, boiler pressure and the card shuffle. Switch them on zone entry (`src/core/audio/sfx.ts:1124-1185`, `src/core/audio/audio.ts:485`, `src/world/sys/zones.ts`).
7. **Floor events you can see (medium, medium).** `dealers_break` empties a table, `lucky_lamp` flares a lamp over a machine, `high_roller` puts a rope up, `jackpot_whisper` darkens one corner (`src/game/watchEvents.ts`).
8. **One visible story spot per zone (medium, low).** A note or photo at each room (Jade, Wash, Boiler, Counting) gives a reason to walk there (`src/world/rooms`, `src/world/level.ts:413-421`).
9. **Smaller, denser pit (medium, high).** Pull the Parlour and Counting zones in closer, and cluster machines around the Well and the Lobby. This cuts walk time between the Terminal and the Big One (`src/world/layout.ts:45-118`, `:266-277`).
10. **Start-of-run simplicity (high for new players, low effort).** Move the starter charm to after the first pull. Show one GOAL line ("24 coins by the Dawn bell") and hide the other HUD numbers until they matter (`src/game/draft.ts:37`, `src/game/run.ts:3473`, `src/game/tutorial.ts:68`).

Ideas 1, 2, 3 and 10 are the cheapest and address the client's three complaints directly. Ideas 4 and 5 are what make the floor feel alive.

**Screenshots** (under `C:\Users\Admin\AppData\Local\Temp\claude\C--Users-Admin-Documents-JackID\48c49d04-016b-4c0d-ac70-780ba1fcc555\scratchpad\`):
- `shots2\`: `00-spawn.png`, `01-lift.png`, `02-terminal.png`, `07-parlour.png`, `08-cards.png`, `09-boiler.png`, `10-trapdoor.png`, `11-mgmt.png`, `13-goto-scratch.png`
- `shots3\`: `02-collector.png`, `05-quota-b.png`

**Limits:** I had no overhead camera, so the wide-view layout judgement is partly inferred from `layout.ts` coordinates. No project files were edited and no git writes were made.