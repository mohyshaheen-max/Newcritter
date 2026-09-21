# Compass Critters — Game Design Spec

2026-09-19 · drafted with @Someone

*Working title only — naming and visual direction not yet decided.*

## Core loop

Tap a hidden tile. An empty tile always reveals safely and shows an arrow toward the nearest critter, or ✦ if two critters are exactly tied for nearest. A tile that hides a critter costs one life instead of revealing safely.

Win a round by safely revealing every tile that isn't a critter. Flagging a tile you're confident about is optional bookkeeping to avoid a misclick — it is never required to win.

No move budget and no rationed information: every clue is always available for the taking. The risk lives entirely in which tile you choose to tap next, not in how much you're allowed to see.

## Board & generation rules

- Grid is N×N with exactly N critters, one per row and one per column (a permutation, like non-attacking rooks). Critter count is never set independently of grid size.
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

- Grid size scales up through levels (e.g. 3×3 → 4×4 → …), with critter count always matching grid size.
- Higher tiers bias generation toward more ✦ ties, which are genuinely harder to triangulate. Implemented by sampling a batch of unique-solution candidates per round, sorting by tie count, and keeping a window around the percentile matching the current level - low levels skew toward the least-tied candidates available, the top level skews toward the most-tied ones.
- A later tier could add a second constraint layer (colored regions, as in Dogdoku) on top of one-per-row/column for a further difficulty jump.
- Technical note: brute-force uniqueness checking stays instant through roughly 8×8; past that, generation should move to a constraint solver rather than checking every permutation. In practice, generating a candidate is fast enough at every size up to 8×8 only by checking one random candidate against the full permutation space at a time (~n! work) rather than cross-checking every candidate against every other one (~n!² work, which is what makes 8×8 infeasible without this).
- Progression is 3×3 → 4×4 → 5×5 → 6×6 → 7×7 → 8×8, one win per size to advance (decided 2026-09-20). A loss (declining Continue) does not demote - the round just retries at the same size.

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

## Scoring, streaks, and leaderboard rewards

- **Stars**: decided 2026-09-21 — lives kept only, not power-ups used (simpler than spec's original framing): 3 lives kept = 3★, 2 lives kept = 2★, 0-1 lives kept = 1★ (any win is at least 1★).
- **Coins from stars**: decided 2026-09-21 — 1 coin per star, as originally proposed (3★ win = 3 coins).
- **Daily streak**: decided 2026-09-21 — only the first completed round of each calendar day decides that day's outcome. A win, or a loss Streak Shield absorbs, extends the streak (continuing it if yesterday was the last extended day, otherwise starting fresh at 1). An unshielded loss (declined Continue) breaks it to 0. This reconciles the "win or loss both counting" proposal with Streak Shield's own description of protecting "one round-reset or one missed day" - a lost round is treated as a distinct hazard from simply missing a day, not something that silently keeps the streak alive.
- **Leaderboard**: proposed weekly cumulative score against friends and globally, resetting each week; top ranks get a badge/title and a small coin bonus — not yet confirmed.
- **Persistence**: coins, streak, level progress, and armed power-up state (Streak Shield, Ward) are saved to localStorage on this device. New players start with 5 coins. Cross-device sync is not implemented - see open questions.

## Monetization touchpoints

- Rewarded video ads refill coins on demand.
- Continue offers, on losing the 3rd life, are ad- or coin-gated.
- Occasional interstitial ad between rounds.
- Coin packs and a remove-ads option as standard in-app purchases.
- Cosmetic monetization (critter skins, themes) intentionally deferred — not part of this pass.

## Open questions still needing a decision

- [x] Levels-per-grid-size pacing — decided 2026-09-20: 1 win per size, no demotion on a loss
- [x] Exact star-rating thresholds — decided 2026-09-21: lives kept only (3/2/0-1 lives → 3★/2★/1★)
- [x] Stars → coins conversion rate — decided 2026-09-21: 1 coin per star
- [x] Daily streak definition — decided 2026-09-21: see Scoring section; first round of the day decides it, an unshielded loss breaks it
- [ ] Leaderboard scoring metric and reward structure
- [x] Pulse's exact unlock grid size — decided 2026-09-20: 5×5 and above
- [ ] Naming and visual direction (deferred, not urgent)
- [ ] Cross-device streak/coin sync — currently localStorage-only, single device
