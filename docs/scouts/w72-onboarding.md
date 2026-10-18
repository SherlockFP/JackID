**Onboarding study, JackID wave7-controls-circuit (HEAD 4a1fee5), seed 7301, Turkish, headless bench. No project files or git state were touched.**

**Runs:** 4 bench runs, all `--run` with `--query "lang=tr"`. One extra call was rejected at parse time for an invalid step (`phone:close`) and never launched Chrome. Screenshots are in the scratchpad (`C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-Documents-JackID/48c49d04-016b-4c0d-ac70-780ba1fcc555/scratchpad/`):
- `onb/`: t00-boot.png, t20.png, t40.png
- `onb2/`: t01-draft-picked.png, t20b-seated.png, t60.png, t86-deposit.png, t92-bell.png (plus t22, t40, t43, t80, t85)
- `onb4/`: n1-dawn-offer.png, evening-arrive.png, spouse-talk.png, phone-open.png (plus n1-card-picked, apartment-lights-off, spouse-after)
- `onb3/`: n1-after.png

**Timeline (sim time)**
- **0–30 s, boot:** the starter draft modal is on top of the floor with a 27 s auto-pick (`draft.ts`, `session.ts:110`). Behind it sits the HUD: Ç, BİLET, KOTA 0/24, EKSİK 24, GECE/VARDİYA/NÖBET, a clock, a floor-event timer, SICAK (Hot Lamp), ÖDEME x1.33 with GÖZDE/HAVA/CEREYAN, ŞAFAK 0/24 (Dawn projection), CEP/YATIR, ÇEKİŞ, TELEFON [T], and an objective card. The intro cutscene is 15 s and chains to `quota_explain` (`intro.cutscene.ts:9`).
- **~20–60 s, Big One seated:** a "NASIL OYNANIR" overlay covers the machine. Its bottom bar has nine buttons, and the BAHİS/CEP counter shows "2 / 30" and "1 ÇEKİŞ = 1 TUR". The floor banner "HAVALANDIRMADAN CEREYAN. IŞIKLAR TİTREDİ." (`watchEvents.strings.ts:73`) sits over the overlay for the whole first Watch.
- **Frozen clocks:** the Watch clock stays at 02:30 and the floor-event timer stays at 00:49 from about 20 s to 86 s, through play. `tutorial.ts:51, 307` holds the clock for tutorial steps 1–3 (walk, spin, deposit), and `watchEvents.ts:117-121` stops the event with it. Nothing on screen says the clock is paused.
- **Bell and Dawn:** the bot bells Watch 1 with 5 pulls left and deposits. Night 1 pays at Watch 3. The Dawn receipt (`onb4/n1-dawn-offer.png`) shows a two-card Night Card offer with a 20 s auto-pick.
- **Home:** the lift is offered only after a paid Night (`run.ts:1651-1653`, `homeLiftReady`). The bot reached the apartment at about 123 s of sim time (Watches 1–3 plus Evening; 84 s of that was bets). An all-clock human pace is about 9 minutes (estimate, not measured).

**Concepts per minute:** about 23 distinct terms are on screen in the first frame (pocket, bank, quota, shortfall, Dawn projection, night, watch, pulls, tickets, coins, payout, three mood or favour modifiers, Hot Lamp, floor event, charm, starter draft, rarity tiers, phone, objective, auto-pick timer, skip hold, Tilt, stake keys 7/8/9, bell). Only the stake keys and the pull keys are taught in the seat overlay. Most of the rest is shown without explanation.

**Contradictions and dead ends**
1. The starter draft (a charm build choice) appears before the player has pulled once or understands charms.
2. The floor banner covers the tutorial box and the seat instructions for the whole first Watch.
3. The objective still reads "Adım 6/6: Mola sırasında Rehin Penceresi'nden bir tılsım al" in the apartment (`onb4/evening-arrive.png`). The pawn step only shows during the Mola and the bot never bought.
4. The Dawn receipt reads "Kota 11" while the quota was 24, and "Yatırılan 18" matches the bank after the bot's withdrawals. The "Kota 11" figure is unexplained and needs checking.
5. Night Card choice is asked on the first Dawn, before the player knows what a Night Card is (`nightCards.ts`).
6. The spouse and the rent thread ("Kira ayın birinde...", `phone.strings.ts`) only exist after the first lift, so a newcomer who misses the Mola never sees them.

**Casino look:** from one frame (t00), the floor is dark brown carpet with generic cabinets, and Big One is the only saturated object. I did not tour the floor, so treat "boring" as the client's view, supported by this one frame only.

**Proposed guided onboarding**

*Home prologue before Watch 1*
- Start in the apartment at `home.spawn`. In `session.ts`, mount the Evening (line ~153) before the tutorial (line ~161) and start the run in stage `evening` (`run.ts:258` HOME_TIMING).
- Add a cutscene after `intro` (`intro.cutscene.ts:9`): the spouse at the table, then the Collector's call on the wall phone (`phone.ts`) stating the debt and tonight's quota. Reuse the `quota_explain` text.
- Bed: `homeSleep` (`run.ts:1657`) opens Night 1, which is the exit from the prologue.
- Lift down: the reverse of the `ride` stage, using the existing `HOME_TIMING`.

*One objective line, always visible*
- `tutorial.ts:68-75`: show one step at a time with a world waypoint (`showTarget`, `tutorial.ts:254`).
- Keep the objective line in `hud.ts` `updatePlan` (line ~822). Do not carry the Mola step into the Evening: clear it when the Mola or the Evening starts.

*Progressive disclosure*
- Night 1, Watch 1: show Ç, ÇEKİŞ, KOTA/EKSİK, the Bell and the clock. Show only the SAFE stake (key 7). Hide ÖDEME/HAVA/GÖZDE (`payout.strings.ts:14-18`, `hud.ts` `updatePayout` line ~769), SICAK and Tilt (`circuit.ts`), the floor-event timer (`watchEvents.ts`), ŞAFAK, and BİLET until the first ticket.
- Move the starter draft to after the first Bell (`draft.ts`: STARTER_TIMEOUT_SEC = 30; `session.ts:110`) or to the Night 1 Mola.
- Night 2: show Hot Lamp and Tilt, stake BOLD (8), first Night Card offer, and the hotline (`hotline.ts:562` forces it from Night 2).
- Night 3: show the Watch tithe (`checkpoints.ts`), stake BIG (9), and the charm shop.
- Night 4+: show the Spotlight and the Overshoot seal. Night 6 adds the House notice.

*Fixes before any of that*
- Show a clock-hold indicator while `tutorial.ts` holds the clock (`tutorial.ts:307`), or start the clock only after step 3.
- Do not let the floor banner cover the tutorial box (`watchEvents.strings.ts:73`).
- Check the Dawn "Kota" figure.