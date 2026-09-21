# Compass Critters — Game Design Spec

2026-09-19 · drafted with @Someone

*Working title only — naming and visual direction not yet decided.*

## Core loop

Tap a hidden tile. An empty tile always reveals safely and shows an arrow toward the nearest critter, or ✦ if two critters are exactly tied for nearest. A tile that hides a critter costs one life instead of revealing safely.

Win a round by safely revealing every tile that isn't a critter. Flagging a tile you're confident about is optional bookkeeping to avoid a misclick — it is never required to win.

No move budget and no rationed information: every clue is always available for the taking. The risk lives entirely in which tile you choose to tap next, not in how much you're allowed to see.

## Board & generation rules

- Grid is N×N. Critter count ranges from 1 up to N depending on tier (see Difficulty progression) - critters are always placed one per row and one per column among however many there are (a partial permutation, like non-attacking rooks that don't have to fill the whole board). The N-critters-on-an-N×N-board case (a full permutation) is just the top of each size's ramp, not a separate rule.
- Direction is a true 45° angle wedge, not a sign-based quadrant, so all eight directions read the same width. On integer grid coordinates, no tile's angle ever lands exactly on a wedge boundary — a single critter never produces an ambiguous reading.
- "Nearest" is decided by plain Euclidean distance. A tile's arrow only ever reports its nearest critter; a farther critter is invisible from that tile until you're standing closer to it than to anything else (masking).
- An arrow or ✦ renders in red when its nearest critter is within Euclidean distance 2 (decided 2026-09-20) - a proximity warning layered on top of the direction, using the same distance metric as everything else.
- A ✦ tie only appears when two or more critters share the exact minimum distance to a tile and fall in different wedges.
- Generation checks candidate permutations for the grid size and only serves ones with a provably unique solution — the full clue grid maps back to exactly one arrangement.
- The first tap of every round is generation-time guaranteed safe: the arrangement isn't finalized until after that tap, filtered to permutations that don't place a critter there. This is free and automatic, not a purchasable power-up.

## Win & loss conditions

- **Win**: every non-critter tile has been safely revealed.
- **Loss**: tapping a critter tile costs one life, 3 lives per round.
- On the 3rd life lost, a Continue offer appears first — spend a coin or watch a rewarded ad for one more life — before the round resets.
- If the round resets without continuing, the daily streak breaks unless a Streak Shield is active.
- Deep in a hard board, a genuinely forced 50/50 tap can still occur, as in Minesweeper's endgame. The unique-solution guarantee covers the whole board, not that every single step along the way is deducible with zero risk.

## Difficulty progression

- Decided 2026-09-22, revised 2026-09-23; win-count settled 2026-09-21 after trying 3, then 2, then briefly 1 wins-per-difficulty-step before landing on **2** (see below for why). Two distinct concepts, deliberately not the same number:
  - **Difficulty step** (18 total, internal - `TIERS` in code): a specific `(gridSize, critterCount)` pair. Within each grid size N (3×3 through 8×8), critter count ramps through its top 3 values (`max(1, N-2)` through `N`). This is what the puzzle generator reads; a loss just retries the current difficulty step, never demotes.
  - **Level** (36 total, what the player sees - "Level 1/36" etc.): a round-within-the-ladder counter that climbs by exactly one on every single win, whether or not the difficulty step changed that round. Each difficulty step spans exactly 2 consecutive level numbers (2 wins per difficulty step), so e.g. Level 1 and Level 2 are both 3×3/1-critter, and Level 3 is the first round at 3×3/2-critters.
  - Why split them: an earlier pass required 3 (then tried 1) wins per difficulty step with the level number tied directly to the difficulty-step index, which meant either the level counter stayed put for many rounds in a row (3 wins/step felt like a long wait with nothing visibly changing) or the puzzle itself changed every single round (1 win/step, tried and reverted the same day - a different, harder-feeling curve than intended). 2 wins/step with an independent, always-climbing level counter gets both: the number in the corner reliably goes up every round, but the actual puzzle only gets harder every other round.
  - Fixed 2026-09-21: since a win always advances the level counter by one (never repeats), the win overlay's button was renamed from "Play again" to "Next round" - "Play again" implied replaying the same thing, which is never actually what happens.
  - The full ladder, spelled out:

    | Levels | Board | Critters |
    |---|---|---|
    | 1–2 | 3×3 | 1 |
    | 3–4 | 3×3 | 2 |
    | 5–6 | 3×3 | 3 |
    | 7–8 | 4×4 | 2 |
    | 9–10 | 4×4 | 3 |
    | 11–12 | 4×4 | 4 |
    | 13–14 | 5×5 | 3 |
    | 15–16 | 5×5 | 4 |
    | 17–18 | 5×5 | 5 |
    | 19–20 | 6×6 | 4 |
    | 21–22 | 6×6 | 5 |
    | 23–24 | 6×6 | 6 |
    | 25–26 | 7×7 | 5 |
    | 27–28 | 7×7 | 6 |
    | 29–30 | 7×7 | 7 |
    | 31–32 | 8×8 | 6 |
    | 33–34 | 8×8 | 7 |
    | 35–36 | 8×8 | 8 |
- **Why it's not a full 1..N ramp per size**: critter count, not board size, drives solving difficulty (masking and ties both come from critters being close enough together to compete for "nearest"). Spreading a low critter count over a *bigger* board makes critters farther apart and the puzzle easier, not harder. An initial version ramped every size from 1 critter up to N, which meant every new size reset straight back to trivial - the biggest, emptiest board yet with only 1 critter on it - immediately after the hardest point of the previous size. That's an oscillating curve, not an escalating one.
- **The fix**: each size only uses its top 3 critter counts - `max(1, N-2)` through `N` - so the *floor* difficulty climbs every size instead of resetting: 3×3 starts at 33% critter density, 4×4 at 50%, 5×5 at 60%, 6×6 at 67%, 7×7 at 71%, 8×8 at 75%. Every size still ends at its own "full" difficulty step (N critters on an N×N board, one per row/column - the classic non-attacking-rooks case), so the top of the ladder is unchanged; only the bottom of each size's ramp rises. Less raw content than a full 1..N ramp would give (that was 33 difficulty steps/99 wins), traded deliberately for a curve that actually escalates. Other ways to extend play length are still open (see the retention discussion elsewhere) - this isn't the only lever for that, and a 36-round total ladder puts more weight on those other levers (post-ladder replay variety, the leaderboard/streak loops) to sustain play past a single sitting.
- A 1-critter difficulty step (only 3×3's opening one now) has no masking and no ties possible (nothing to be nearest *relative to*) - every arrow just points straight at the one critter - a deliberately trivial opener, not an oversight.
- Higher difficulty steps bias generation toward more ✦ ties, which are genuinely harder to triangulate. Implemented by sampling a batch of unique-solution candidates per round, sorting by tie count, and keeping a window around the percentile matching the current difficulty step (0 to 17 of 18) - early steps skew toward the least-tied candidates available, the last step skews toward the most-tied ones.
- A later difficulty step could add a second constraint layer (colored regions, as in Dogdoku) on top of one-per-row/column for a further difficulty jump.
- Technical note: brute-force uniqueness checking stays instant through roughly 8×8 *for a full permutation* (checking one random candidate against the full permutation space at a time, ~n! work, rather than cross-checking every candidate against every other one, ~n!² work). Partial permutations (fewer critters than rows) have a much larger placement space at mid-range counts - a 6-critter 8×8 board has 564,480 possible placements, versus 40,320 for the full 8-critter case. Past a fixed cap (50,000 placements), generation samples a large deduplicated random subset as the comparison universe instead of enumerating the true full space. This affects 3 of the 18 difficulty steps (7×7 with 5 critters; 8×8 with 6 or 7 critters): their "provably unique" guarantee is really "verified unique against a large representative sample," not a mathematical proof over every possible placement, unlike every other step. Worst-case generation time measured at ~950ms server-side; expect a brief pause on-device at those specific steps, not a freeze.

## Retention: win-count milestones, daily quests & Endless Mode

- Decided 2026-09-21, informed by a look at how other mobile puzzle games (Zoodoku's first-win/milestone badges and finite-campaign-into-endless-mode structure; daily-quest claim screens common across the genre) handle replayability. Three small, purely client-side/per-device systems, independent of the server-backed leaderboard/friends/gifting - these are personal habit loops, not competitive ones.
- **Win-count milestones**: a celebratory overlay the moment a lifetime win-count threshold is crossed - "First Win!" at win 1 (+3 coins), then every 5th win after that ("5 Wins!", "10 Wins!", ...) for +5 coins, indefinitely. Tracked by a new `totalWins` counter (persisted alongside the rest of the save, independent of level/tier progress), so it keeps paying out even once the 36-level ladder is fully cleared.
- **Daily quests**: three fixed objectives that reset every calendar day (same `todayDateString()` boundary the streak uses, so it also respects the debug day-offset for testing): win 2 rounds (+2 coins), reveal 30 tiles (+2 coins), use a power-up (+2 coins), plus a +3 coin bonus for claiming all three. Progress accumulates automatically as the objectives already-tracked stats change; coins are only granted when the player explicitly taps Claim in the Daily Quests panel, which also shows a small unclaimed-count badge on the button (e.g. "📅 Daily Quests (2)") as a lightweight nudge to check in. Deliberately **no ad-watching quests** (unlike the reference screenshots that prompted this) - there's no real ad SDK integrated yet (see Monetization touchpoints), only objectives the game already has the data for.
- **Endless Mode**: decided 2026-09-21, same day as the above - gives the post-ladder replay (previously just silently repeating 8×8/8-critters forever) its own identity. The moment a player's win pushes them onto the ladder's last difficulty step (8×8/8-critters) for the first time, a one-time "♾️ Endless Mode unlocked!" overlay explains that the board is now fixed and the score is a win streak. From then on the level stat and win-overlay text both switch to Endless Mode framing ("♾️ Endless Mode · Streak N (best M)") instead of a level number, tracked by a new `endlessStreak` (consecutive endless-mode wins) and persisted `bestEndlessStreak` (a high-water mark that never decreases). A loss (declining a Continue offer) resets `endlessStreak` to 0 but never touches `bestEndlessStreak`, and never demotes out of Endless Mode - the board stays 8×8/8-critters regardless. Deliberately no escalating difficulty or scaling coin reward within Endless Mode itself in this pass (the board is already capped at the brute-force-feasible ceiling - see the Difficulty progression technical note - and the win-count milestones above already provide an uncapped, ongoing coin-reward loop that continues seamlessly into Endless Mode without needing a second one).
- Shown via a dedicated overlay chain after the win screen, each step consuming whichever `pending*` flags are set that round: win overlay → [power-ups intro, if pending] → [Endless Mode intro, if pending] → [milestone, if pending] → next round starts. All three flags can in principle be pending the same win (rare) and the chain shows all of them in order rather than dropping any.
- All three are considered a first pass, not the final word on retention - the earlier Zoodoku-style research also surfaced a genuine daily *puzzle* (one seeded board per day, shareable/comparable across players) as a further option, intentionally deferred pending a decision on whether it should be server-seeded (comparable leaderboard entry, more Worker/D1 work) or per-device (free, but not comparable).

## Power-ups

| Power-up | Effect | Cost | Unlock |
| --- | --- | --- | --- |
| Sniff | Reveals one critter directly | 1 coin | Level 1 |
| Rewind | Undoes your last action | 1 coin | Level 1 |
| Pulse | Scans a 3×3 area (clipped at edges) and returns a count of critters inside; immune to masking | 3 coins | 5×5 and above |
| Decode | Reveals the exact tied directions behind a ✦ on a tile you've already revealed | 2 coins | Level 1 |
| Ward | Covers exactly your next tap: no life lost if it's a critter, spent for nothing if it's safe | 1 coin | Level 1 |
| Continue | One extra life the moment your 3rd life is lost, before the round resets | 1 coin or rewarded ad | Level 1 |
| Streak Shield | Protects your streak through one round-reset or one missed day | Earned or purchased | Level 1 |

Ward and Streak Shield are deliberately separate systems: Ward is one-shot insurance on your very next tap, Streak Shield protects the daily streak when a round fully resets. Arming one has no effect on the other.

Decode exists specifically so ✦ ties can stay an intentionally weak, hard-to-triangulate clue by default (see Difficulty progression) without leaving players stuck — it's an opt-in, paid way to unstick a tie instead of the base game revealing tied directions for free.

The free first-tap safety guarantee (see Board & generation rules) sits outside this economy entirely — it's baseline fairness, not a power-up.

## Onboarding

- Decided 2026-09-21, expanded same day per feedback that the first cut was too thin, trimmed again the same day per feedback that the expanded cut over-explained, then corrected again the same day per feedback that playtesters didn't understand the actual objective — a scripted interactive tutorial, not a slide-deck explainer: a new player's very first taps land on a small fixed 5×5 demo board (critters at opposite corners, entirely separate from the real tier ladder/coins/persistence) rendered with the actual grid CSS and gesture handling, so what they learn transfers directly. Text is kept to one short, punchy line per step rather than a lecture. Eight guided steps covering the whole core loop except power-ups (see below): an opening statement of the actual goal (see below); a plain arrow; a red/near arrow (within 2 tiles); a ✦ tie; flagging a tile via hold/right-click; an open "go find the other critter" exploration step (any hidden unflagged tile can be tapped and reveals normally, completing only once a critter is actually tapped); the win condition; and a closing note on coins-from-stars and the daily streak. Masking is deliberately not explained in words anywhere - the exploration step lets the player discover "the earlier arrows never hinted at this one" by playing, not by being told. Interactive steps highlight exactly one target tile (or, for the flag step, require the hold/right-click gesture specifically, not a plain tap); the exploration step highlights nothing, since the point is unguided search. Action on any other tile, or the wrong gesture, is simply ignored, not blocked or shaken. Purely explanatory steps show their text immediately with no tile interaction required.
- **Fixed 2026-09-21**: real playtesting surfaced that the tutorial never actually stated the goal, and its own wording actively misled players toward the wrong one. Two changes: (1) added a new opening step, shown before any tap, stating the objective directly - "Critters are hiding on this board. Reveal every OTHER tile without tapping one!" - since every other step assumed the player already understood that framing. (2) The arrow-explanation step used to say "Follow it!", which reads as an instruction to walk toward the critter - backwards from the actual goal of avoiding it. Reworded to "it's a clue to help you avoid it, not a path to follow!" - an explicit correction, not just a rewording. The flagging step's explanation was similarly passive ("mark tiles you're sure about") and didn't say why - reworded to "so you never accidentally tap it — that's the real goal!" to directly connect the mechanic to the objective. The critter-tap step (in the explore step, once the second critter is found) now frames the life loss as a mistake to learn from ("Oops...") and explicitly says to flag that kind of tile next time instead, rather than presenting tapping a critter as a neutral thing that just happens.
- **Fixed 2026-09-21, same day**: the wording fix above told players to flag a critter instead of tapping it, but the explore step's own completion condition only accepted a *tap* on the critter - a player who correctly followed the new advice and flagged it instead got stuck, since nothing acknowledged the flag. The explore step now completes either way: tapping the critter shows the "Oops, tap costs a life" message (`explainTap`), flagging it shows a distinct positive one ("Nice — flagging it avoids the life loss completely!", `explainFlag`), and which one fired is tracked so the right message shows. Flagging any *other* hidden tile during the explore step is still allowed (matches real gameplay - flagging is always free) but doesn't complete the step, same as a wrong tap elsewhere doing nothing on the earlier fixed-target steps.
- Power-ups are deliberately left out of the opening tutorial and introduced separately the first time a player clears their first tier (3 wins at 3×3/1-critter) - a dedicated "Power-ups unlocked!" modal listing all six, shown once (gated on its own "seen it" flag, checked at every tier-advance rather than tied to a specific tier index, since the tier list's shape has already changed twice). The idea is the core arrow/tie/critter loop should land solidly before another system stacks on top of it.
- The main tutorial is shown automatically only on a true first-ever launch (no save in localStorage at all). A device with an existing save - a returning player, or simply one who predates this feature - has its "seen it" flag set retroactively rather than being interrupted with a forced tutorial.
- Replayable any time via a "❓ How to play" button next to the New round / Leaderboard controls; replaying overwrites the grid with the tutorial board and, on finish or skip, starts a fresh real round (any in-progress round's partial reveals are lost, same as tapping New round). The power-ups intro is not separately replayable - it's a one-time unlock notice, not a reference doc.
- Considered and rejected: a slide-based modal walkthrough (simpler to build, but front-loads a lot of text before any real play) and contextual just-in-time tooltips fired off real gameplay events (lower effort, but ties/near-warnings don't reliably appear on a player's very first tiers, so the lesson could arrive too late or not at all).

## Scoring, streaks, and leaderboard rewards

- **Stars**: decided 2026-09-21 — lives kept only, not power-ups used (simpler than spec's original framing): 3 lives kept = 3★, 2 lives kept = 2★, 0-1 lives kept = 1★ (any win is at least 1★).
- **Coins from stars**: decided 2026-09-21 — 1 coin per star, as originally proposed (3★ win = 3 coins).
- **Daily streak**: decided 2026-09-21 — only the first completed round of each calendar day decides that day's outcome. A win, or a loss Streak Shield absorbs, extends the streak (continuing it if yesterday was the last extended day, otherwise starting fresh at 1). An unshielded loss (declined Continue) breaks it to 0. This reconciles the "win or loss both counting" proposal with Streak Shield's own description of protecting "one round-reset or one missed day" - a lost round is treated as a distinct hazard from simply missing a day, not something that silently keeps the streak alive.
- **Leaderboard**: decided 2026-09-21 — anonymous device-generated `playerId` + a self-chosen nickname. Score metric is total stars earned that calendar week, submitted per-round win. Weekly boundary is ISO 8601 (Monday-Sunday, UTC), computed server-side - deliberately different from the daily streak's local-calendar-date boundary, since a leaderboard needs one canonical, fair boundary shared by every player globally rather than each player's own day. Top ranks on the global board earn a server-issued coin bonus (not badges-only - the payout was explicitly chosen over the simpler deferred-reward option): rank 1 = 10 coins, ranks 2-3 = 7, ranks 4-10 = 5, ranks 11-50 = 3, ranks 51-100 = 1, below rank 100 = 0. Rewards are computed by a weekly Cloudflare Cron Trigger (00:05 UTC every Monday, scoring the week that just ended) and claimed automatically on the player's next load. Because the payout is server-issued, the server is the authority on submitted scores: `/api/submit-score` clamps each submission to the valid 1-3 stars per round rather than trusting a client-reported cumulative total - full move-by-move anti-cheat is out of scope and a known limitation. Backed by Cloudflare D1 (`players`, `weekly_scores`, `reward_claims` tables); API and cron logic live in `worker.js`, schema in `schema.sql`.
- **Friends & gifting**: decided 2026-09-21 (superseding the earlier "deferred until real accounts exist" call) — friend codes instead of a full account/social-login system, since the existing anonymous `playerId` model already covers everything a lightweight friends graph needs. Registering (or updating a nickname) gets each player a short server-generated 6-character code (`friend_code` on `players`, a readable alphabet with ambiguous characters like 0/O/1/I/L removed). Entering someone else's code in the Friends panel links both players immediately and symmetrically (`friendships` table, one row per direction, no accept/request step). The Leaderboard modal gained a Global/Friends tab: Friends shows just you and your friends ranked by the same weekly stars metric, with no top-100 cap since the list is inherently small. Each player can send each friend one free 1-coin gift per week (`gifts` table, a unique index on sender+recipient+week enforces the cap; no self-gifting) - deliberately capped low since there's no real identity behind a code to stop alt-account farming otherwise; gifts auto-claim into coins on load the same way weekly leaderboard rewards do. A friend code is not an account: losing local storage (a new device, a cleared browser) means a new anonymous identity and a new code, with no way to recover the old one's friends - an accepted limitation of staying account-free.
- **Persistence**: coins, streak, tier progress (tier index + wins at that tier), and armed power-up state (Streak Shield, Ward) are saved to localStorage on this device. New players start with 5 coins. Cross-device sync is not implemented - see open questions.

## Monetization touchpoints

- Rewarded video ads refill coins on demand.
- Continue offers, on losing the 3rd life, are ad- or coin-gated.
- Occasional interstitial ad between rounds.
- Coin packs and a remove-ads option as standard in-app purchases.
- Cosmetic monetization (critter skins, themes) intentionally deferred — not part of this pass.

## Open questions still needing a decision

- [x] Levels-per-grid-size pacing — superseded 2026-09-23 by the 18-difficulty-step critter-count ramp, win count settled 2026-09-21 (see Difficulty progression): each size's top 3 critter counts only, 2 wins per difficulty step, a 36-number level counter that climbs every win regardless, no demotion on a loss
- [x] Exact star-rating thresholds — decided 2026-09-21: lives kept only (3/2/0-1 lives → 3★/2★/1★)
- [x] Stars → coins conversion rate — decided 2026-09-21: 1 coin per star
- [x] Daily streak definition — decided 2026-09-21: see Scoring section; first round of the day decides it, an unshielded loss breaks it
- [x] Leaderboard scoring metric and reward structure — decided 2026-09-21: see Scoring section; anonymous+nickname global leaderboard, weekly total stars, server-issued coin payout by rank
- [x] Pulse's exact unlock grid size — decided 2026-09-20: 5×5 and above
- [x] First-time onboarding — decided 2026-09-21: see Onboarding section; scripted interactive tutorial on a fixed demo board, shown once on first-ever launch, replayable via How to play
- [x] Friends leaderboard — decided 2026-09-21, superseding the earlier "deferred until real accounts exist" call: see Scoring section's Friends & gifting entry; friend codes on top of the existing anonymous playerId model, a Friends tab on the Leaderboard modal, and a capped weekly 1-coin gift between friends
- [x] First-pass endless-replay incentives — decided 2026-09-21: see the new Retention section; win-count milestones (first win + every 5th win, +coins) and three fixed daily quests with a completion bonus, both client-side/per-device
- [x] Branded "Endless Mode" past level 36 — decided 2026-09-21: see Retention section; a one-time unlock overlay, Endless-Mode-specific level-stat/win-overlay text, and a persisted win-streak/best-streak score in place of the level counter
- [ ] Naming and visual direction (deferred, not urgent)
- [ ] Cross-device streak/coin sync — currently localStorage-only, single device (also means a friend code doesn't survive a device change - see Friends & gifting)
- [ ] Server-seeded daily puzzle (one shared board per day, comparable across players) vs. a per-device daily seed (free, not comparable) — surfaced by the Zoodoku-style research, not yet decided
- [ ] Escalating difficulty or a scaling coin reward within Endless Mode itself — deliberately left flat in the first pass (see Retention section); the board is already at the generation-performance ceiling, so any further escalation would need something other than bigger boards/more critters (e.g. an even stronger tie-bias, or a second constraint layer per the Difficulty progression note on Dogdoku-style regions)
