# JackID — Director's Brief (source of truth for all design agents)

> **NAME CHANGE (client decision):** the game is called **JackID** (logo may be stylised
> "JACK·ID"). Any doc that still says "JACKPIT" is outdated — always write "JackID". The repo
> folder is still named `jackpit/` for now; that is just a path.

## Request (from the client, translated from Turkish)
"Build me a Three.js gambling game with P2P servers, like CloverPit. Very detailed gambling
machines — every gambling machine you can find. The whole game is PSX style. A CloverPit-like
game that is also playable single-player, with a server browser, menus etc. In 3D, let's start
*inside a jackpot*. It's an FPS. Develop the game a lot; make the plan superb."

## Fixed decisions (do not relitigate — elaborate them)
- **Title:** JackID. First-person, PSX-era (1997) horror casino roguelike. Inspired by CloverPit
  (debt + deadline + charms + trapdoor + ringing phone) but an ORIGINAL work: no CloverPit names,
  text, symbols, art or characters are copied. Mechanics may be similar in spirit.
- **Fiction seed:** you wake up in an underground casino pit, seven floors below a city. You owe
  The House. Every deadline a debt must be deposited into the Debt Terminal. Fail → the floor opens.
  Pay off the final debt → the elevator takes you up. Endless mode after that.
- **Tech:** TypeScript + Vite 8 + three@0.186 (already installed in `jackpit/`). Also installed:
  `ws` (Node lobby/signaling server), `trystero` (optional serverless P2P), `@fontsource/vt323`,
  `@fontsource/press-start-2p`. NO external art/audio assets: every model is procedural three.js
  geometry, every texture is generated at runtime on a canvas (pixel art), every sound is synthesized
  with WebAudio. Everything must run with `npm run dev` in a modern desktop browser.
- **PSX look (whole game, menus included):** low internal resolution (~400×225, nearest-neighbour
  upscale), vertex snapping (jitter), affine texture warping, 15-bit colour + ordered Bayer dither,
  distance fog, low-poly geometry, small nearest-filtered textures (16–64 px), vertex-lit feel,
  optional subtle CRT (scanlines/vignette). Toggleable in settings.
- **FPS:** pointer-lock mouselook, WASD, Shift sprint, C crouch, E interact, Esc pause, Tab
  scoreboard, T chat, head-bob, footsteps, simple AABB collision. Walk up to a machine, press E →
  the camera glides into that machine's "play pose"; play with keys/mouse; E/Esc to stand up.
  A low-poly viewmodel (hands / coin) is a plus.
- **Main menu = inside a jackpot:** the menu is a 3D scene where the camera sits INSIDE a giant slot
  machine cabinet behind the glass, reels/strips rotating around it; menu entries live on reel
  symbols/lit panels. "Play" → reels spin → lands JACKPOT → the camera bursts out through the glass
  into the pit and the run starts. Server browser, settings, credits are also diegetic-ish 3D/PSX UI.
- **Modes:** (1) Debt Run — single player, the CloverPit-like core; (2) Co-op Debt Run — shared
  debt over P2P; (3) Versus "Last One Standing" — every player has their own debt, failures drop
  through the floor and spectate as ghosts; (4) Free Casino — sandbox, no debt, social.
- **Multiplayer:** P2P *listen servers*. The host's browser is authoritative. WebRTC DataChannels in
  a star topology (clients ↔ host). Signaling + **server browser** via a tiny Node WebSocket lobby
  server in `server/` (also provides a WS relay fallback when WebRTC fails). Extra transports:
  BroadcastChannel (same-browser multi-tab testing, zero setup) and optional Trystero/Nostr
  "global lobby". Server browser lists: room name, host, mode, players/max, ping, password lock,
  started/in-lobby. Up to 8 players. Single-player needs no network at all.
- **Machines:** as many real gambling devices as possible, each very detailed (model + rules +
  animation + sound + juice). Candidate list (designers finalize ids/scope, ~30):
  The Big One (5×3 pattern jackpot slot, the hero), one-armed bandit (3-reel, physical lever),
  pachislot (skill-stop), video poker (Jacks or Better), roulette (European), blackjack, Texas
  hold'em (players + bots), baccarat, craps, sic bo / chuck-a-luck cage, Big Six money wheel,
  pachinko (physics balls), plinko, coin pusher, keno, bingo, scratch-card vending machine,
  mechanical horse/rat derby, crash ("The Elevator"/cable snaps), mines grid, hi-lo cards,
  casino war / dragon-tiger, claw crane, cyclone light ring, stacker, lotto ball blower,
  shell game automaton, coin-flip booth, revolver roulette (the Devil's table), fortune-teller
  automaton (tarot gamble / omens), tombola/raffle drum, dice tower.
  Plus systems props: Debt Terminal (ATM), Charm vending machine/pawn window, Hotline phone,
  wall clock, trapdoor, elevator, jukebox, cashier window.
- **Languages:** English + Turkish (Türkçe), switchable in settings. All player-facing strings go
  through i18n keys.
- **Model roles (client's request, final):** **Opus 5.5 is the main thinker and decision-maker** —
  game direction, art/design, 3D modelling, architecture, core engine, reviews, integration and
  every important call. **Sonnet 5.5 = general agent** — the bulk of implementation (systems,
  machine logic, UI). **Haiku 5.5** — can write code and runs tests/checks/data/translations —
  but never makes design or architecture decisions.
- **Parallel-friendly code layout:** every machine is self-contained in
  `src/machines/<id>/` → `model.ts` (procedural model, built by an Opus "modeler") +
  `index.ts` (logic/UI/sound/net, built by a Sonnet coder) and is auto-registered with
  `import.meta.glob` — NO shared registry file to edit. Shared core lives in `src/core`, `src/game`,
  `src/net`, `src/world`, `src/player`, `src/menu`, `src/i18n`, `server/`.

## ADDENDUM 1 — client follow-up (HIGH PRIORITY, overrides anything above that conflicts)
Client: "Add a trillion tycoon-like upgrades, have quotas, give it a light horror theme, and build
an infrastructure for playing with friends."
- **Tycoon / incremental layer (core pillar, not an afterthought):** huge numbers of upgrades with
  idle-game number growth (K, M, B, T, Qa, Qi… formatting; use a big-number-safe representation —
  plain JS numbers up to 1e308 are fine with a formatter, no library needed).
  - Per-machine upgrade tracks (many levels each, cost curves): payout multiplier, luck, speed /
    animation time, bet cap, extra lines/reels/seats, auto-play, special features unlocked at
    milestone levels (e.g. level 10/25/50/100 milestones à la idle games).
  - Expand your casino: buy NEW machines into empty pit slots; unlock new rooms/floors of the pit.
  - Staff/automatons: hire creepy mannequin gamblers/dealers that auto-play machines → passive /
    idle income while you play elsewhere (also offline-ish progress within a run).
  - Pit-wide upgrades: deposit interest, quota discounts, time/plays budget, charm slots, shop
    rerolls, luck aura, coin magnet, lighting (pushes back the horror).
  - Prestige ("Descend"/rebirth): reset a run for permanent currency → permanent meta upgrade tree.
  - Upgrade definitions should be DATA-DRIVEN and partly generated (templates × machines × tiers)
    so there can be hundreds/thousands without hand-writing each.
- **Quotas:** every deadline is a QUOTA (Lethal-Company-like): an escalating amount you must deposit
  into the Debt Terminal by the deadline; quota grows exponentially to match tycoon growth. Fail →
  trapdoor. Overpaying carries bonuses. Show quota/progress/time-left prominently (diegetic board).
- **Light horror:** unsettling, not gory. Flickering lights, the House's distorted voice on the PA,
  mannequins that shift when unobserved, the Collector's footsteps before a deadline, whispers when
  luck is low, darker rooms as quota pressure rises. Upgrading lighting/comfort pushes it back.
- **Play with friends — infrastructure:** room codes + shareable invite links (`?join=CODE`), party
  lobby with ready-up and host settings (mode, difficulty, max players, password, public/friends-only),
  recent-players list, text chat + emotes/pings, spectating, optional WebRTC proximity voice chat
  (tier 2), host-authoritative shared economy for co-op (shared quota, personal wallets, shared
  tycoon floor where friends can each own/upgrade machines), late-join with full snapshot.

## ADDENDUM 2 — story + animated cutscenes (client follow-up)
Client: "Keep it going like a tycoon, with horror stuff too. Add a light story, with animated
cutscenes."
- **Light story** told in small doses: who The House is, why you owe, who the Collector is, the
  other "guests" (mannequins were once players who lost), notes/tapes found in the pit, the PA voice.
  A few branching/ending variants (pay everything → elevator ending; prestige "Descend" → deeper
  truth; secret ending). Keep text short, bilingual EN/TR, PSX-era tone (think Silent Hill-lite).
- **Animated in-engine cutscenes** (PSX style, letterboxed, skippable, subtitled): data-driven
  timeline system (camera keyframes/paths with easing, actor animations for low-poly mannequins/
  the Collector, lights, sounds, subtitles, screen fades/shakes). Required beats at minimum:
  intro after bursting out of the menu jackpot (waking in the pit), first quota explanation by the
  Collector, each quota-met visit, quota-failed trapdoor fall, unlocking a new floor/room, prestige
  "Descend", the elevator ending, plus a few horror stingers. In multiplayer the host triggers
  cutscenes and every peer plays them in sync; players can vote to skip.

## ADDENDUM 3 — buffs + "better than CloverPit" bar (client follow-up)
Client: "There should be buffs too. Better than CloverPit: more ideas, more content, more things to do,
more meaningful context, more challenging, more satisfying, more animated, more fun."
- **Buffs/debuffs system:** timed and conditional status effects with icons, stacks and durations:
  consumables (tonics, cigarettes-free "lucky mints", cursed candy, energy drinks from a vending
  machine), hot/cold streak buffs (win streaks heat a machine up), blessings & curses from the
  hotline/fortune teller/shrine, co-op aura buffs (stand near a friend), machine "overheat" states,
  global events ("Happy Hour", "Blackout", "Full Moon", "Audit"). Buffs stack/synergise with
  charms and tycoon upgrades. Data-driven like upgrades.
- **Design bar:** every system must answer "what decision does the player make here?" — risk/reward
  choices every minute, build-crafting synergies (charms × upgrades × buffs × machines), meaningful
  context (story, notes, the House's rules), escalating challenge (quotas, modifiers/"ante" rules per
  floor, boss-like Collector deadlines with special rules), and huge satisfaction (juicy animations,
  screen shake, coin cascades, number pops, slow-motion near-misses, big-win sequences, sound
  layering). More things to do between spins: explore floors, find secrets/notes, side contracts/
  bounties ("win 3 hands of blackjack in a row"), daily challenges, achievements, collectibles.

## ADDENDUM 4 — real CC0 assets + great music (client follow-up)
Client: "Put them all in, and make good music too."
- The "no external assets" rule is RELAXED: CC0 textures, real casino SFX and an animated humanoid
  mannequin (43 clips) were downloaded — see `docs/ASSETS.md` (inventory, contact sheets, rules).
  Procedural generation stays the default for game-specific art (machines, cards, chips, symbols,
  signage, screens); vendor textures dress the environment and materials (walls, floors, metal,
  wood, cloth/velvet/carpet, grime/stain overlays); the mannequin GLB animates players, dealers,
  staff, ghosts, the Collector and cutscene actors.
- **Music must be genuinely good**, composed procedurally with WebAudio (no music files):
  an adaptive soundtrack system with a composer-quality design — themes/motifs, chord
  progressions, instrument patches (Rhodes/e-piano, upright bass, brushed drums, vibraphone, muted
  trumpet, organ, detuned music-box, choir pads, tape-wobble/lo-fi saturation, PSX-style reverb).
  Layers react to game state (calm lounge → tense as the quota deadline nears → horror stingers →
  euphoric jackpot fanfare); per-floor/zone themes; menu theme (inside the jackpot); cutscene cues;
  a diegetic JUKEBOX with 8+ selectable songs (lounge jazz, bossa, swing, sad waltz, synthwave,
  creepy carnival…); seeded, never-identical variations; smooth crossfades; volume sliders
  (master/music/sfx/voice). Distorted "House" PA voice via formant-ish synthesis or speech-like
  gibberish (Animal Crossing-style babble) with subtitles.

## ADDENDUM 5 — content expansion pool (client: "think of more content, plans, things to build")
Candidate pool from the director — the producer must tier these (T1 ship, T2 next, T3 later),
not drop them silently. Everything must plug into the data-driven systems.
- **Seven floors + secrets:** F7 Lounge (start) · F6 Card Rooms · F5 Arcade (pachinko/claw/
  cyclone/stacker) · F4 Racetrack (derby, betting terminal, rat stock ticker) · F3 Vault (high
  stakes, heist event) · F2 Chapel of Chance (fortune teller, shrine, revolver table) · F1
  Penthouse (final Collector) · Surface. Secret floor "B13". Elevator rides between floors with
  elevator music + random events. Hidden rooms, vents, keys, safe-cracking with clues from notes.
- **Boss deadlines (Balatro-style "boss blinds"):** each quota deadline has a named Collector boss
  rule-set (e.g. The Twins — baccarat duel; The Accountant — blackjack with audited counts; The Rat
  King — derby; final: THE HOUSE — a giant multi-phase slot-machine boss). Per-night "ante"
  modifiers ("all 7s are cursed tonight", "reds pay 0").
- **Nightly random events:** Blackout, Happy Hour, Flood, Rat swarm, VIP Whale arrives, Audit,
  Lucky Moon, Power Surge (double payouts, fire risk), Wedding of the Mannequins, Hunt.
- **Cheating system (risk/reward stealth):** marked cards, loaded dice, roulette magnet, slot
  shim, card counting that really works — Heat meter per machine; security mannequins patrol and
  watch; caught → fine, debuff, or a creepy "finger tax" (lose a charm slot, viewmodel hand loses a
  finger — unsettling, not gory).
- **Loan shark & pawn shop:** borrow at brutal interest (debt spiral), pawn charms or abstract
  things ("your shadow", "your reflection", "your name") for curses + cash.
- **Bar & vending:** cocktails/food/mints = buffs; cocktail mixing mini-game; the Bartender NPC.
- **Tycoon floor management:** place/rotate/upgrade/skin/name your own machines; ghost NPC guests
  with needs (luck, thirst, boredom) generate income on your machines; staff (dealers, cleaners,
  security, bartender); grime/repair mini-games; R&D lab research tree; **machine fusion**
  (combine two machines into a hybrid, e.g. Roulette×Slot); marketing (neon signs, attractions);
  gala nights & VIP whales; insurance against curses; idle/offline earnings.
- **Progressive network jackpot** shared by all machines (and all friends in MP), visible
  everywhere, grows over time. Slot/poker tournaments vs NPCs/friends.
- **Multiplayer party content:** Liar's Dice, Dice Duel, poker nights, betting on a friend's spin
  (spectator bets), trading charms, loans between friends with contracts, sabotage in Versus
  (curse a rival's machine, bribe a dealer), ghosts (eliminated players) can haunt — flicker
  lights, nudge luck — emote wheel, pings, proximity voice, shared co-op heist on the Vault.
- **Characters to play (start perks):** The Gambler, The Accountant, The Widow, The Kid, The
  Priest, The Magician (cheat bonus), The Twin… each with a perk + flaw; unlocked via meta.
- **Stakes difficulty ladder** (8 stakes), daily seed + weekly challenge, run modifiers.
- **Meta & collection:** 120+ achievements, stats, Almanac/Codex (machines, charms, buffs, notes,
  bosses), unlockable cabinet skins, **Hall of Losers** — every failed run becomes a posed
  mannequin in the pit forever (persistent, creepy and personal), photo mode with PSX filters.
- **NPC cast:** The House (PA voice), The Collector, The Bartender, The Fortune Teller, Mira (a lost
  guest's ghost who guides you to secrets), the Rat King, the Mannequin staff.
- **Accessibility:** reduce flicker (photosensitivity), colour-blind-safe symbols, text size,
  hold-to-confirm toggles, subtitles always available.

## ADDENDUM 6 — UNO-style party card games with friends (client follow-up)
Client: "Add UNO-style things too, for playing with friends."
- A dedicated **Parlor** (party room, its own zone/floor wing) with multi-seat tables for 2–8
  players; empty seats filled by mannequin bots (3 difficulty levels); all games are host-
  authoritative shared tables, playable vs bots in single-player too; every table has an
  optional buy-in POT so they are real gambles that feed the run economy/quota; charms/buffs can
  hook them; spectators can side-bet.
- **"SON KART / LAST CARD"** — our ORIGINAL UNO-like shedding game (UNO is a trademark: never use
  that name or its card art). 4 colours × 0–9, Skip, Reverse, +2, Wild, Wild +4, plus JackID
  cards: Debt (+coins to the victim's debt), Collector (everyone discards a colour), Curse (swap
  hands with the richest), Jackpot (winner of the round takes double pot). House rules toggles:
  stacking +2/+4, 7-0 hand swap, jump-in, draw-to-match, "call LAST CARD!" (press key in time or
  draw 2 — others can catch you). Juicy card throws, table slams, colour-change light flash.
- **Turkish classics (client is Turkish — big appeal):** **OKEY** (4 players, 106 tiles, racks,
  indicator/joker, "okey" finish, 101 variant optional), **PİŞTİ** (2/4 players, capture, pişti
  bonus), **BATAK** (4-player trick-taking with bids), **TAVLA** (backgammon with a doubling cube —
  real gamble), **BLÖF** (Cheat / I Doubt It).
- **More party gambles:** Crazy Eights, Liar's Dice, Hot Potato Bomb (pot grows while a fused
  chip passes around; holder when it pops loses), Durak, "The Mole" social-deduction night (one
  friend secretly works for The House; vote them out before the quota).
- Same rules engine pattern for all card/tile games (deck/tile models, deal, turn order, timers,
  hand UI in first person: cards held in the viewmodel hands, mouse to pick, drag to play),
  bilingual rules sheet at every table.

## ADDENDUM 7 — Buckshot-Roulette-style duel (client follow-up)
Client: "Take the Buckshot Roulette logic and add it to the game."
- **"THE DEVIL'S TABLE"** (id `devilstable`, tier 1, Chapel of Chance floor; replaces/absorbs the
  plain revolver table, which may stay as a quick variant). ORIGINAL presentation — no Buckshot
  Roulette names/art/characters; mechanics in its spirit:
  - A double-barrel shotgun is loaded with a shown-then-shuffled mix of LIVE and BLANK shells
    (counts revealed each load, order hidden). On your turn: shoot the opponent or yourself.
    Blank at yourself = keep the turn. Live = lose a charge. Players have 2–6 charges shown as
    lamps on a creepy defibrillator-style box. Rounds escalate (more shells, more charges, more items).
  - **Items** drawn into a 4×2 tray each load (original names, same spirit): Loupe (see the chambered
    shell), Bitter Tonic (rack/eject the current shell), Cuffs (opponent skips next turn), Cigarillo
    → renamed "Lucky Mint" (heal 1), Hacksaw (next live does double), Burner Phone (a voice tells
    you shell #N), Inverter (flip live/blank), Adrenaline (steal & use an opponent's item), Expired
    Pills (50%: +2 charges / 50%: −1), plus JackID items: Loaded Chip (bet doubler), Mirror (bounce
    a self-shot to the next player), Collector's Coin (skip a load). Inventory cap 8.
  - **Opponents:** The Dealer (a tall porcelain-masked mannequin with long hands; AI that tracks
    shell counts, uses items sensibly, bluffs) OR 2–4 friends PvP in multiplayer (host-authoritative,
    hidden information per seat — never send the shell order to clients).
  - **Gamble layer:** coin wager per match; "double or nothing" after each win; usable as a boss
    deadline ("pay the quota or sit at the Devil's Table"); charms/buffs hook it.
  - **Light-horror presentation, no gore:** losing a charge = muzzle flash → hard cut to black,
    ringing tinnitus, screen crack overlay, the defibrillator jolts you back; losing all charges in a
    run = dragged off by the Collector (cutscene), not blood. Camera: seated first-person, you lift
    the gun (viewmodel), aim with mouse (opponent/self), heavy recoil + shake, slow-mo on last shell.

## ADDENDUM 8 — inspiration from "Gamble With Your Friends" (Steam, 2026) + JUICE IS KING
Client: "Research Gamble With Your Friends on Steam and take inspiration." / "Effects and animations
are very important in these games, pay attention to that."
What made GWYF a 2M-copy friends hit (research summary): 1–6 players share ONE bank account and
ONE debt to a loan shark; each casino day is a short REAL-TIME shift (5 min) to hit the quota;
quota overshoot pays a bonus; missing it plays a punishment scene; 17 games over 4 floors with
games RANDOMISED on each floor entry (roulette, duck race, blackjack, slots, street craps, wheel,
"penguin cross", keno, crash, hi-lo, plinko, money wheel, "dragon tower", 1-player poker,
minesweeper); tickets (from quota/challenges/sacrifices) buy 15+ items that are PHYSICAL objects
you carry into the casino and that work in a RADIUS (prevent loss nearby, increase profit nearby,
rewind 60 s, free all-in coin, raise max bet, revert last loss, mystery box); a BODY-PART economy
(sacrifice parts for quota money — losing an eye/mouth/legs degrades vision/voice/movement so
friends must carry you); proximity voice; cosmetics/emotes; lots of comedic chaos.
Adopt (ORIGINAL versions, never copy names/art):
- **Shared bank + shared debt** in co-op (already planned) with clear "who lost what" feed and a
  ledger board; **real-time shift timer** for the night — strongly preferred in multiplayer
  (e.g. 6–8 min shifts) and available in single-player; designers must reconcile it with the
  clock/action-cost design (e.g. real-time shift + per-machine time pressure).
- **Randomised machine line-up per floor visit** (keeps runs fresh; tycoon-owned machines stay).
- **Physical radius items ("Totems")** carried in hand/backpack and placed near tables: luck aura,
  loss shield, profit boost, rewind, reroll, magnet, jinx (Versus) — they show a visible glowing
  radius on the floor.
- **"Collateral" body economy, JackID twist (light horror, no gore):** pawn body parts to the
  Collector for instant quota money — each is replaced by a cracked PORCELAIN MANNEQUIN part:
  eye → half-screen porcelain vignette, ear → muffled audio, mouth → garbled voice/chat, hand →
  slower actions/one-handed, legs → crawl (friends can CARRY you). Buy them back later. Pawn
  everything → you become a mannequin (game over / joins the Hall of Losers). Thematically core.
- **Stake-style "originals"** to add to the catalogue: Tower Climb (pick safe doors up a stairwell,
  cash out any time), Cross the Hall (a wind-up toy crosses lanes of rolling carts; cash out per
  lane), Duck/Rat race variants, Limbo (target multiplier), Dice-over/under.
- Punishment/execution-style beats become JackID cutscenes (the trapdoor, the Collector) — creepy,
  not gory.
**JUICE IS KING (non-negotiable):** every interaction needs anticipation → action → impact →
follow-through. A shared VFX/animation toolkit (particles: coins, sparks, confetti, smoke, dust,
neon glow sprites; decals; trails; screen-space flash/shake/chromatic pulse/slow-mo/zoom punch;
number pop-ups that fly to the HUD; tweened squash&stretch; camera kick; light pulses) must exist in
core and EVERY machine must use it. Each machine ships with a juice checklist: idle attract mode,
bet placement feedback, spin/deal anticipation (rising pitch, slowing reels, near-miss tease),
win tiers (small/medium/big/mega/jackpot each escalating), loss feedback, and a coin payout that
physically pours into a tray. Big wins: lights strobe across the whole floor, music swells,
other players see/hear it from afar. Animation quality is reviewed with screenshots/recordings.

## Proposed folder layout (tech spec may refine, not replace)
```
jackpit/
  index.html, vite.config.ts, tsconfig.json
  server/index.js                 # lobby + signaling + relay (ws), `npm run server`
  src/main.ts                     # bootstrap
  src/core/                       # engine loop, PSX renderer/post, materials, texgen, audio,
                                  # input, events, rng, i18n runtime, save, ui overlay, tween
  src/player/                     # FPS controller, viewmodel, remote avatars
  src/world/                      # the pit level, props, lights, collision, layout slots
  src/game/                       # run state, economy, debt, clock, charms, hotline, modes
  src/machines/_base/             # MachineBase, TableBase, shared machine helpers
  src/machines/<id>/model.ts|index.ts
  src/net/                        # transports, protocol, session, replication, lobby client
  src/menu/                       # 3D jackpot menu, server browser, settings, pause, HUD
  src/i18n/en.ts, tr.ts
  docs/
```
