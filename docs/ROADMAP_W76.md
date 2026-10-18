# JackID roadmap (director, 2026-10-18, after the client's live playtest)

## Verdict
JackID is not AA yet. It is an ambitious prototype with many systems that do not yet land together.
- **Readability is weak:** blurry signs, an unreadable terminal and an empty ceiling.
- **Systems overlap:** with no clear "what do I do now", nothing has a strong reason to exist.
- **Money has no use:** there is nothing satisfying to spend it on, and that loop is the heart of CloverPit.
- **Sound and look are uneven.**

## Direction
Keep the engine and pull the design centre toward CloverPit:
1. A clear money goal.
2. Spending that makes you stronger (a build).
3. Events and mystery on top of that.

Keep the pillars in docs/DESIGN_PILLARS.md: one identity, no soup, plain human wording.

## Waves
- **W76 PLAYABLE (running):**
  - client bug list: stuck broke line, stuck objective, unreadable terminal, empty ceiling, blurry signs, squashed menu
  - a physical Last Call bell with a waypoint
  - an elapsed-time clock
  - a sound pass
  - an animated phone
- **W77 MONEY WITH PURPOSE:**
  - a home computer (buy and sell, passive income: small investments, a side business), permanent upgrades, and a shop at the centre of the loop
  - run goal: clear the debt and buy back your life
  - every purchase changes how you play (CloverPit-style)
  - food you can eat for short bonuses (client request): banana, coffee, sandwich, energy drink, soup from the bar or the fridge at home
    - each one gives a small, readable bonus for the next Watch or a few pulls: steadier hands, one extra pull, a luck star, faster reels
    - extend the existing tonics (src/game/data/buffs.ts, tonic_vendor) rather than adding a new system
    - eating has a hand animation and a sound
- **W78 NEW GAMES (fewer, better):**
  - bring back and polish the horse race (src/machines/derby)
  - a tumble/cascade multiplier slot (original theme, Gates-of-Olympus-like feel)
  - two mind games against an NPC in the spirit of gambling-duel anime: bluff and read, easy first, harder ones unlocked later
- **W79 HOME & DREAD:**
  - redesign the spouse as attractive anime-styled but still dark (the other-dimension rim)
  - spouse surprises: drawings on the fridge, gifts, small events
  - blackouts you must fix; Collector calls; hiding (WTTG-like), driven by Heat
- **W80 GRAND CASINO II:**
  - an upper floor and a basement unlocked by progress, with secret rooms tied to THE SECOND NAME
  - seeded variety per run, and a meta unlock tree for replayability

## Assets
- Sounds and textures are procedural first.
- Downloading packs (for example CC0 packs from itch.io) needs the client to approve each file: name, source, licence and size.
