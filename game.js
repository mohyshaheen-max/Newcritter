(function () {
  const MIN_GRID = 3;
  const MAX_GRID = 8; // spec's brute-force-feasible ceiling; past this, generation needs a constraint solver instead
  const MAX_LIVES = 3;

  // Difficulty ladder (product decision 2026-09-22, revised 2026-09-23): critter count alone
  // drives solving difficulty (masking/ties), not board size - spreading a low critter count
  // over a bigger board makes critters farther apart and the puzzle *easier*, not harder. An
  // earlier version ramped critter count 1..N at every grid size, which meant every new size
  // reset straight back to trivial (1 critter on the biggest board yet) right after the hardest
  // point of the previous size - an oscillating, not escalating, curve. Now each size only uses
  // its top 3 critter counts (N-2, N-1, N, clamped at 1), so the density floor climbs every
  // size (33% -> 50% -> 60% -> 67% -> 71% -> 75%) instead of crashing back down. 3+3+3+3+3+3 =
  // 18 tiers, 3 wins each, 54 wins to clear the ladder once. Fewer tiers than the max-content
  // version, on purpose - a smooth curve matters more than raw tier count, and there are other
  // ways to extend play length later without reintroducing the reset.
  const TIER_WINS_REQUIRED = 3;
  const TIERS = [];
  for (let n = MIN_GRID; n <= MAX_GRID; n++) {
    const minCount = Math.max(1, n - 2);
    for (let c = minCount; c <= n; c++) TIERS.push({ gridSize: n, critterCount: c });
  }
  const TIE = '✦';
  const ARROWS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘']; // index i sits at i*45°, E through SE going counter-clockwise
  const ANIMALS = ['🐶', '🐱', '🦊', '🐰', '🐻', '🦝', '🐨', '🦔'];
  const PULSE_COST = 3; // bumped from 2: on a 5x5 board a 3x3 scan can pin a 3-row block's columns almost exactly, stronger than a 1-coin Sniff
  const PULSE_MIN_GRID = 5; // per product decision: unlocks at 5x5 and above
  const DECODE_COST = 2;
  const WARD_COST = 1; // insurance for one uncertain tap, often wasted on a safe tile - not worth Pulse/Decode's price, which both guarantee useful info

  const el = {
    grid: document.getElementById('grid'),
    lives: document.getElementById('livesStat'),
    coins: document.getElementById('coinsVal'),
    found: document.getElementById('foundVal'),
    total: document.getElementById('totalVal'),
    critters: document.getElementById('crittersVal'),
    newRoundBtn: document.getElementById('newRoundBtn'),
    sniffBtn: document.getElementById('sniffBtn'),
    rewindBtn: document.getElementById('rewindBtn'),
    pulseBtn: document.getElementById('pulseBtn'),
    decodeBtn: document.getElementById('decodeBtn'),
    wardBtn: document.getElementById('wardBtn'),
    shieldBtn: document.getElementById('shieldBtn'),
    winOverlay: document.getElementById('winOverlay'),
    winStats: document.getElementById('winStats'),
    winPlayAgainBtn: document.getElementById('winPlayAgainBtn'),
    continueOverlay: document.getElementById('continueOverlay'),
    continueCoinBtn: document.getElementById('continueCoinBtn'),
    continueAdBtn: document.getElementById('continueAdBtn'),
    continueDeclineBtn: document.getElementById('continueDeclineBtn'),
    toast: document.getElementById('toast'),
    level: document.getElementById('levelVal'),
    streak: document.getElementById('streakVal'),
    debugAdvanceDayBtn: document.getElementById('debugAdvanceDayBtn'),
    debugDateVal: document.getElementById('debugDateVal'),
  };

  let toastTimer = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('visible'), 2400);
  }

  // 0-indexed into TIERS. tierWins counts wins accumulated at the current tier (resets to 0 on
  // advancing); no demotion on a loss. Both persisted, since it's overall progress.
  let tierIndex = 0;
  let tierWins = 0;
  function currentTier() { return TIERS[Math.min(tierIndex, TIERS.length - 1)]; }

  const STARTING_COINS = 5; // a small welcome balance for a brand new player; returning players load their real saved total
  let coins = STARTING_COINS;

  // Persisted so it survives round resets (that's the point of a streak shield) and reloads.
  let streakShieldArmed = false;

  // A separate power-up from Streak Shield: insurance on exactly your very next tap (consumed
  // by it regardless of outcome), not the streak. Persisted since it's a banked, paid-for
  // protection that hasn't been spent on a tap yet.
  let lifeWardArmed = false;

  // Daily streak: only the first completed round of each calendar day decides that day's
  // outcome (later rounds that same day don't change it). A win, or a loss where Streak
  // Shield absorbs it, extends the streak (continuing it if yesterday was the last extended
  // day, otherwise starting fresh at 1). An unshielded loss (declined Continue) breaks it to 0.
  // This is a product decision (2026-09-21) resolving SPEC.md's open question on streak
  // definition, informed by Streak Shield's own description of protecting "one round-reset or
  // one missed day" - implying a lost round is a distinct hazard from simply missing a day.
  let streak = 0;
  let lastExtendDate = null; // last calendar date (YYYY-MM-DD) the streak was successfully extended
  let lastDecidedDate = null; // last calendar date whose outcome (extend or break) has already been decided

  const SAVE_KEY = 'compassCritters.save.v1';

  // Testing-only: lets QA advance the simulated "today" without touching the system clock, to
  // exercise the streak logic's day-sequencing (consecutive days, gaps, shielded saves) without
  // waiting for real calendar days. Not persisted - resets every reload. Strip the debug button
  // (and this offset) out of the actual App Store build.
  let debugDayOffset = 0;

  function todayDateString() {
    const d = new Date();
    d.setDate(d.getDate() + debugDayOffset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dateStringOneDayBefore(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null; // private browsing, storage disabled, or corrupt data - just start fresh
    }
  }

  // Stores the tier as (gridSize, critterCount) rather than a raw index into TIERS - the tier
  // list's order and contents have already changed twice during design iteration, and an index
  // silently points at the wrong tier (or off the end of the array) the moment the list is
  // reshuffled again. Storing the actual values makes reloading robust to future tier-list
  // changes: it just looks up wherever that (gridSize, critterCount) pair lives now.
  function persistSave() {
    try {
      const tier = currentTier();
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        version: 3, coins, streak, lastExtendDate, lastDecidedDate,
        tierGridSize: tier.gridSize, tierCritterCount: tier.critterCount, tierWins,
        streakShieldArmed, lifeWardArmed,
      }));
    } catch (err) { /* storage unavailable - game still works in-memory for this session */ }
  }

  (function loadFromSave() {
    const saved = loadSave();
    if (!saved) return;
    if (typeof saved.coins === 'number') coins = saved.coins;
    if (typeof saved.streak === 'number') streak = saved.streak;
    if (typeof saved.lastExtendDate === 'string') lastExtendDate = saved.lastExtendDate;
    if (typeof saved.lastDecidedDate === 'string') lastDecidedDate = saved.lastDecidedDate;
    if (saved.version === 3 && typeof saved.tierGridSize === 'number') {
      let idx = TIERS.findIndex(t => t.gridSize === saved.tierGridSize && t.critterCount === saved.tierCritterCount);
      if (idx < 0) idx = TIERS.findIndex(t => t.gridSize === saved.tierGridSize); // that exact count no longer exists at this size - land on the size's first tier instead
      tierIndex = idx < 0 ? 0 : idx;
      tierWins = idx < 0 ? 0 : (typeof saved.tierWins === 'number' ? saved.tierWins : 0);
    } else if (saved.version === 2 && typeof saved.tierIndex === 'number') {
      // Pre-v3 saves stored a raw index into an old, differently-shaped tier list - there's no
      // way to recover exactly which (gridSize, critterCount) that meant, so just clamp it into
      // range as a rough approximation rather than losing coins/streak entirely.
      tierIndex = Math.max(0, Math.min(saved.tierIndex, TIERS.length - 1));
      tierWins = 0;
    } else if (typeof saved.level === 'number') {
      const idx = TIERS.findIndex(t => t.gridSize === MIN_GRID + saved.level);
      tierIndex = idx < 0 ? 0 : idx;
    }
    streakShieldArmed = !!saved.streakShieldArmed;
    lifeWardArmed = !!saved.lifeWardArmed;
  })();

  // Lives kept only (product decision 2026-09-21, resolving SPEC.md's star-threshold open
  // question) - power-up usage doesn't affect stars, just how many lives you finished with.
  function starsForRound() {
    if (state.lives >= 3) return 3;
    if (state.lives === 2) return 2;
    return 1; // any win is at least 1 star, even at 0-1 lives kept
  }

  function recordRoundResult(won) {
    const today = todayDateString();
    if (lastDecidedDate === today) return; // a later round today doesn't change today's outcome
    lastDecidedDate = today;

    const shieldSavedThis = !won && streakShieldArmed;
    if (shieldSavedThis) {
      streakShieldArmed = false;
      showToast('🛡️ Shield used — your streak is protected.');
    }

    if (won || shieldSavedThis) {
      streak = (lastExtendDate && dateStringOneDayBefore(today) === lastExtendDate) ? streak + 1 : 1;
      lastExtendDate = today;
    } else {
      streak = 0;
    }
    persistSave();
  }

  let state = null;

  function permutationsOf(n) {
    const indices = Array.from({ length: n }, (_, i) => i);
    const results = [];
    (function build(remaining, chosen) {
      if (remaining.length === 0) { results.push(chosen); return; }
      for (let i = 0; i < remaining.length; i++) {
        const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
        build(rest, chosen.concat(remaining[i]));
      }
    })(indices, []);
    return results;
  }

  function combinationsOf(arr, k) {
    const results = [];
    (function build(start, chosen) {
      if (chosen.length === k) { results.push(chosen.slice()); return; }
      for (let i = start; i < arr.length; i++) {
        chosen.push(arr[i]);
        build(i + 1, chosen);
        chosen.pop();
      }
    })(0, []);
    return results;
  }

  function factorial(k) { let r = 1; for (let i = 2; i <= k; i++) r *= i; return r; }
  function binomial(n, k) { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); }

  // A "perm" is length n; perm[row] is the critter's column, or null if that row has no
  // critter. Full permutations (c === n) are just the c < n case with nothing left null.
  function partialPermutationsOf(n, c) {
    if (c >= n) return permutationsOf(n);
    if (c <= 0) return [Array(n).fill(null)];
    const indices = Array.from({ length: n }, (_, i) => i);
    const rowSubsets = combinationsOf(indices, c);
    const colSubsets = combinationsOf(indices, c);
    const bijections = permutationsOf(c);
    const results = [];
    for (const rows of rowSubsets) {
      for (const cols of colSubsets) {
        for (const bij of bijections) {
          const perm = Array(n).fill(null);
          for (let i = 0; i < c; i++) perm[rows[i]] = cols[bij[i]];
          results.push(perm);
        }
      }
    }
    return results;
  }

  function shuffledIndices(n) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function randomPartialPermutation(n, c) {
    const rows = shuffledIndices(n).slice(0, c);
    const cols = shuffledIndices(n).slice(0, c);
    const perm = Array(n).fill(null);
    for (let i = 0; i < c; i++) perm[rows[i]] = cols[i];
    return perm;
  }

  // Some (gridSize, critterCount) combinations - mid-range critter counts on large boards -
  // have a placement space in the hundreds of thousands (a 6-critter 8x8 board has 564,480
  // possible placements), far past what's safe to enumerate and cross-check exhaustively in a
  // browser (the full-permutation 8x8 case, 40,320 placements, already takes ~350ms). Past
  // MAX_EXHAUSTIVE_SPACE, this samples a large deduplicated random subset to serve as the
  // comparison universe instead of the true full space. That makes "provably unique" become
  // "verified unique against a large representative sample" for those specific tiers - a real,
  // documented tradeoff (see SPEC.md), not the same guarantee as everywhere else.
  const MAX_EXHAUSTIVE_SPACE = 50000;

  function sampleUniverse(n, c, size) {
    const universe = [];
    const seen = new Set();
    const maxAttempts = size * 3;
    let attempts = 0;
    while (universe.length < size && attempts < maxAttempts) {
      attempts++;
      const perm = randomPartialPermutation(n, c);
      const key = perm.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      universe.push(perm);
    }
    return universe;
  }

  function getPlacementSpace(n, c) {
    if (c >= n) return permutationsOf(n);
    const spaceSize = binomial(n, c) * binomial(n, c) * factorial(c);
    return spaceSize <= MAX_EXHAUSTIVE_SPACE ? partialPermutationsOf(n, c) : sampleUniverse(n, c, MAX_EXHAUSTIVE_SPACE);
  }

  function wedgeIndex(dr, dc) {
    // dr/dc are (critter - tile). Flip dr so "up" (toward row 0) reads as north, matching the arrow glyphs.
    let deg = Math.atan2(-dr, dc) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return Math.round(deg / 45) % 8;
  }

  function nearestWedges(perm, n, r, c) {
    let minD2 = Infinity;
    let nearest = [];
    for (let a = 0; a < n; a++) {
      if (perm[a] === null) continue; // no critter in this row - "null - c" would silently coerce to -c otherwise
      const dr = a - r, dc = perm[a] - c;
      const d2 = dr * dr + dc * dc;
      if (d2 < minD2) { minD2 = d2; nearest = [{ dr, dc }]; }
      else if (d2 === minD2) { nearest.push({ dr, dc }); }
    }
    return [...new Set(nearest.map(({ dr, dc }) => wedgeIndex(dr, dc)))];
  }

  const NEAR_DISTANCE_SQUARED = 4; // Euclidean distance <= 2, same metric as everything else here

  function nearestDistanceSquared(perm, n, r, c) {
    let minD2 = Infinity;
    for (let a = 0; a < n; a++) {
      if (perm[a] === null) continue;
      const dr = a - r, dc = perm[a] - c;
      const d2 = dr * dr + dc * dc;
      if (d2 < minD2) minD2 = d2;
    }
    return minD2;
  }

  function computeClueGrid(perm, n) {
    const grid = Array.from({ length: n }, () => Array(n).fill(null));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (perm[r] === c) continue; // critter cell: no clue rendered here
        const wedges = nearestWedges(perm, n, r, c);
        grid[r][c] = wedges.length > 1 ? TIE : ARROWS[wedges[0]];
      }
    }
    return grid;
  }

  // Two permutations are "confusable" if they'd show identical clues at every cell that's
  // non-critter under BOTH of them (cells that are a critter under either one carry no
  // comparable clue, so they're skipped). A permutation only has a provably unique solution
  // if nothing else in the full permutation space is confusable with it. This is why a
  // genuinely forced 50/50 can still happen deep in a round: local ambiguity between two
  // boards can exist even though each board, as a whole, maps back to exactly one arrangement.
  // permB's clue values are computed lazily per cell (not a precomputed grid) so a mismatch
  // on an early cell - the common case for two random permutations - exits without ever
  // computing the rest of permB's grid.
  function isConfusablePair(permA, gridA, permB, n) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (permA[r] === c || permB[r] === c) continue;
        const wedges = nearestWedges(permB, n, r, c);
        const value = wedges.length > 1 ? TIE : ARROWS[wedges[0]];
        if (gridA[r][c] !== value) return false;
      }
    }
    return true;
  }

  function hasUniqueSolution(perm, grid, allPerms, n) {
    for (const other of allPerms) {
      if (other === perm) continue;
      if (isConfusablePair(perm, grid, other, n)) return false;
    }
    return true;
  }

  // Checking one random candidate against the full permutation space is O(n!) - checking
  // every candidate against every other one (the original approach) was O(n!^2), which is
  // instant at 5x5/6x6 but would freeze the browser well before 8x8. Sampling a handful of
  // unique-solution candidates gives the same first-tap-safety and variety as a full pool,
  // without the quadratic blowup.
  function tieCount(grid, n) {
    let count = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (grid[r][c] === TIE) count++;
    return count;
  }

  // Per spec: "higher tiers bias generation toward more ties, which are genuinely harder to
  // triangulate." Sorts the sampled candidates by tie count and keeps a window around the
  // percentile matching the current tier - early tiers skew toward the least-tied (easiest)
  // candidates available, the last tier skews toward the most-tied ones. Everything downstream
  // still just picks uniformly at random from the (now pre-biased) pool.
  function biasPoolByTier(pool) {
    if (pool.length <= 1) return pool;
    const target = TIERS.length > 1 ? tierIndex / (TIERS.length - 1) : 0;
    const sorted = pool
      .map(entry => ({ entry, ties: tieCount(entry.grid, entry.perm.length) }))
      .sort((a, b) => a.ties - b.ties);
    const windowSize = Math.max(1, Math.ceil(sorted.length / 3));
    const center = Math.round(target * (sorted.length - 1));
    const start = Math.max(0, Math.min(sorted.length - windowSize, center - Math.floor(windowSize / 2)));
    return sorted.slice(start, start + windowSize).map(w => w.entry);
  }

  function buildUniqueSolutionPool(n, c) {
    const allPerms = getPlacementSpace(n, c);
    const poolTarget = Math.min(30, allPerms.length);
    const maxAttempts = poolTarget * 40;
    const pool = [];
    const tried = new Set();
    let attempts = 0;
    while (pool.length < poolTarget && attempts < maxAttempts && tried.size < allPerms.length) {
      attempts++;
      const idx = Math.floor(Math.random() * allPerms.length);
      if (tried.has(idx)) continue;
      tried.add(idx);
      const perm = allPerms[idx];
      const grid = computeClueGrid(perm, n);
      if (hasUniqueSolution(perm, grid, allPerms, n)) pool.push({ perm, grid });
    }
    if (!pool.length) {
      const perm = allPerms[Math.floor(Math.random() * allPerms.length)];
      pool.push({ perm, grid: computeClueGrid(perm, n) });
    }
    return biasPoolByTier(pool);
  }

  function startRound() {
    const tier = currentTier();
    const n = tier.gridSize;
    const critterCount = tier.critterCount;
    document.documentElement.style.setProperty('--grid-size', n);
    state = {
      n,
      critterCount,
      pool: buildUniqueSolutionPool(n, critterCount),
      perm: null,
      grid: null,
      firstTapDone: false,
      cells: Array.from({ length: n }, () => Array.from({ length: n }, () => ({ status: 'hidden', flagged: false }))),
      lives: MAX_LIVES,
      revealed: 0,
      total: n * n - critterCount,
      roundOver: false,
      history: [],
      pulseArmed: false,
      decodeArmed: false,
    };
    el.total.textContent = state.total;
    el.critters.textContent = critterCount;
    el.level.textContent = `Tier ${tierIndex + 1}/${TIERS.length} · ${n}×${n} · ${critterCount} critter${critterCount === 1 ? '' : 's'}`;
    updateStats();
    render();
  }

  function resolveFirstTap(r, c) {
    let candidates = state.pool.filter(({ perm }) => perm[r] !== c);
    if (!candidates.length) {
      candidates = getPlacementSpace(state.n, state.critterCount)
        .filter(p => p[r] !== c)
        .map(p => ({ perm: p, grid: computeClueGrid(p, state.n) }));
    }
    const choice = candidates[Math.floor(Math.random() * candidates.length)];
    state.perm = choice.perm;
    state.grid = choice.grid;
    state.firstTapDone = true;
  }

  // Sniff has no cell to guarantee safe, so it just needs any valid board - no first-tap filtering.
  function ensureBoardResolved() {
    if (state.firstTapDone) return;
    const choice = state.pool[Math.floor(Math.random() * state.pool.length)];
    state.perm = choice.perm;
    state.grid = choice.grid;
    state.firstTapDone = true;
  }

  // Only counts critters Sniff would actually be useful for - a hidden critter you've
  // already correctly flagged is nothing new to reveal, so it shouldn't keep Sniff enabled.
  function hasSniffableCritters() {
    if (!state.firstTapDone) return true;
    return state.perm.some((c, r) => {
      if (c === null) return false;
      const cell = state.cells[r][c];
      return cell.status === 'hidden' && !cell.flagged;
    });
  }

  // True once every critter is accounted for - either correctly flagged or already revealed
  // (from a tap, Sniff, etc). A critter cell already revealed can never be flagged (toggleFlag
  // only acts on hidden cells), so it must count as accounted-for on its own, or this could
  // never trigger once a single life had already been lost. Any wrong flag returns false.
  function allCrittersFlaggedCorrectly() {
    if (!state.firstTapDone) return false;
    for (let r = 0; r < state.n; r++) {
      for (let c = 0; c < state.n; c++) {
        const cell = state.cells[r][c];
        const isCritterCell = state.perm[r] === c;
        if (cell.flagged && !isCritterCell) return false;
        if (isCritterCell && cell.status === 'hidden' && !cell.flagged) return false;
      }
    }
    return true;
  }

  // Reveals everything else at once so flagging every critter correctly clears the round
  // without also having to tap every remaining tile one by one - flagging is still optional
  // per spec, this is just a faster path to the same win condition on bigger boards.
  function autoCompleteRound() {
    for (let r = 0; r < state.n; r++) {
      for (let c = 0; c < state.n; c++) {
        const cell = state.cells[r][c];
        if (cell.status !== 'hidden') continue;
        cell.flagged = false;
        if (state.perm[r] === c) {
          cell.status = 'critter';
        } else {
          cell.status = 'revealed';
          state.revealed++;
        }
      }
    }
    updateStats();
    render();
    winRound();
  }

  function toggleFlag(r, c) {
    if (state.roundOver) return;
    const cell = state.cells[r][c];
    if (cell.status !== 'hidden') return;
    cell.flagged = !cell.flagged;
    if (cell.flagged && allCrittersFlaggedCorrectly()) {
      autoCompleteRound();
      return;
    }
    render();
  }

  function tapCell(r, c) {
    if (state.roundOver) return;
    const cell = state.cells[r][c];
    if (cell.status !== 'hidden') return;
    if (cell.flagged) return;

    if (!state.firstTapDone) resolveFirstTap(r, c);

    // Ward covers exactly this one tap, win or lose - it's consumed here regardless of
    // outcome, not left standing until some future critter hit happens to trigger it.
    const wardCoveredThisTap = lifeWardArmed;
    if (wardCoveredThisTap) lifeWardArmed = false;

    state.history.push({ r, c, lives: state.lives, revealed: state.revealed, wardConsumed: wardCoveredThisTap });

    if (state.perm[r] === c) {
      cell.status = 'critter';
      if (wardCoveredThisTap) {
        showToast('🛡️ Ward absorbed that hit — no life lost.');
      } else {
        state.lives--;
      }
      updateStats();
      render();
      if (state.lives <= 0) {
        offerContinue();
      } else if (allCrittersFlaggedCorrectly()) {
        autoCompleteRound();
      }
    } else {
      cell.status = 'revealed';
      state.revealed++;
      if (wardCoveredThisTap) showToast('🛡️ Ward used — that tap was safe anyway.');
      updateStats();
      render();
      if (state.revealed >= state.total) winRound();
    }
  }

  function useSniff() {
    if (state.roundOver || coins < 1) return;
    ensureBoardResolved();
    const hidden = [];
    for (let r = 0; r < state.n; r++) {
      const c = state.perm[r];
      if (c === null) continue;
      const cell = state.cells[r][c];
      if (cell.status === 'hidden' && !cell.flagged) hidden.push([r, c]);
    }
    if (!hidden.length) return; // everything left is already flagged - nothing new to reveal
    const [r, c] = hidden[Math.floor(Math.random() * hidden.length)];
    coins--;
    state.cells[r][c] = { status: 'critter', flagged: false };
    updateStats();
    render();
    if (allCrittersFlaggedCorrectly()) autoCompleteRound();
  }

  function useRewind() {
    if (state.roundOver || coins < 1 || !state.history.length) return;
    const last = state.history.pop();
    coins--;
    state.cells[last.r][last.c] = { status: 'hidden', flagged: false };
    state.lives = last.lives;
    state.revealed = last.revealed;
    if (last.wardConsumed) lifeWardArmed = true; // undoing the tap it covered gives the ward back too
    updateStats();
    render();
  }

  function useShield() {
    if (streakShieldArmed || coins < 1) return;
    coins--;
    streakShieldArmed = true;
    updateStats();
  }

  function useWard() {
    if (lifeWardArmed || coins < WARD_COST) return;
    coins -= WARD_COST;
    lifeWardArmed = true;
    updateStats();
  }

  function countCrittersInArea(perm, n, r, c) {
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        if (perm[rr] === cc) count++;
      }
    }
    return count;
  }

  function togglePulseArm() {
    if (state.roundOver) return;
    if (state.pulseArmed) { state.pulseArmed = false; updateStats(); return; }
    if (coins < PULSE_COST) return;
    state.decodeArmed = false;
    state.pulseArmed = true;
    updateStats();
  }

  function usePulseAt(r, c) {
    state.pulseArmed = false;
    if (coins < PULSE_COST) { updateStats(); return; }
    ensureBoardResolved();
    const count = countCrittersInArea(state.perm, state.n, r, c);
    coins -= PULSE_COST;
    highlightArea(r, c, count);
    showToast(`Pulse: ${count} critter${count === 1 ? '' : 's'} in that 3×3 area`);
    updateStats();
  }

  function highlightArea(r, c, count) {
    const n = state.n;
    const centerDiv = el.grid.children[r * n + c];
    if (centerDiv) {
      const badge = document.createElement('span');
      badge.className = 'pulse-count';
      badge.textContent = count;
      centerDiv.appendChild(badge);
      setTimeout(() => badge.remove(), 1800);
    }
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        const div = el.grid.children[rr * n + cc];
        if (!div) continue;
        div.classList.add('pulse-highlight');
        setTimeout(() => div.classList.remove('pulse-highlight'), 1800);
      }
    }
  }

  function toggleDecodeArm() {
    if (state.roundOver) return;
    if (state.decodeArmed) { state.decodeArmed = false; updateStats(); return; }
    if (coins < DECODE_COST) return;
    state.pulseArmed = false;
    state.decodeArmed = true;
    updateStats();
  }

  function useDecodeAt(r, c) {
    const cell = state.cells[r][c];
    if (cell.status !== 'revealed' || state.grid[r][c] !== TIE) {
      showToast('Decode only works on a revealed ✦ tile.');
      return;
    }
    state.decodeArmed = false;
    coins -= DECODE_COST;
    const wedges = nearestWedges(state.perm, state.n, r, c);
    cell.decodedWedges = wedges;
    showToast(`Decoded: tied between ${wedges.map(i => ARROWS[i]).join(' and ')}`);
    updateStats();
    render();
  }

  function offerContinue() {
    state.roundOver = true;
    el.continueCoinBtn.disabled = coins < 1;
    el.continueOverlay.classList.remove('hidden');
  }

  function grantExtraLife() {
    state.lives = 1;
    state.roundOver = false;
    el.continueOverlay.classList.add('hidden');
    // The critter tap that cost your 3rd life can itself be the one that completes the full
    // set (accounted for by earlier reveals/flags) - without this, the round would be stuck
    // waiting for a manual tap on a tile the game already knows is safe.
    if (allCrittersFlaggedCorrectly()) {
      autoCompleteRound();
      return;
    }
    updateStats();
  }

  function winRound() {
    state.roundOver = true;
    const stars = starsForRound();
    coins += stars; // 1 coin per star, per spec's proposal
    recordRoundResult(true);

    const wasAtLastTier = tierIndex >= TIERS.length - 1;
    tierWins++;
    let tierAdvanced = false;
    if (!wasAtLastTier && tierWins >= TIER_WINS_REQUIRED) {
      tierIndex++;
      tierWins = 0;
      tierAdvanced = true;
    }
    const tier = currentTier();

    persistSave();
    updateStats();
    setTimeout(() => {
      const starText = '⭐'.repeat(stars);
      let progressText;
      if (wasAtLastTier) {
        progressText = `You've maxed out the ladder — ${MAX_GRID}×${MAX_GRID} with ${tier.critterCount} critters!`;
      } else if (tierAdvanced) {
        progressText = `Tier ${tierIndex + 1}/${TIERS.length} unlocked (${tier.gridSize}×${tier.gridSize}, ${tier.critterCount} critter${tier.critterCount === 1 ? '' : 's'})!`;
      } else {
        const winsNeeded = TIER_WINS_REQUIRED - tierWins;
        progressText = `${winsNeeded} more win${winsNeeded === 1 ? '' : 's'} at this tier to advance.`;
      }
      el.winStats.textContent = `${starText}  Lives kept: ${state.lives}/${MAX_LIVES}  ·  +${stars} 🪙  ·  🔥 ${streak}\n${progressText}`;
      el.winOverlay.classList.remove('hidden');
    }, 300);
  }

  const LONG_PRESS_MS = 450;
  const MOVE_TOLERANCE_PX = 16; // touch jitter on Android runs higher than a mouse - too tight a tolerance cancels the hold
  let pressTimer = null;
  let pressStart = null;
  let longPressFired = false;
  let lastTouchTime = 0; // lets us ignore the synthetic mousedown Android fires after a real touch

  function cancelPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressStart = null;
  }

  function startPress(r, c, x, y) {
    longPressFired = false;
    pressStart = { x, y };
    pressTimer = setTimeout(() => {
      longPressFired = true;
      toggleFlag(r, c);
    }, LONG_PRESS_MS);
  }

  function movePress(x, y) {
    if (!pressStart) return;
    if (Math.hypot(x - pressStart.x, y - pressStart.y) > MOVE_TOLERANCE_PX) cancelPress();
  }

  function dispatchTap(r, c) {
    if (state.pulseArmed) { usePulseAt(r, c); return; }
    if (state.decodeArmed) { useDecodeAt(r, c); return; }
    tapCell(r, c);
  }

  // Two earlier attempts (Pointer Events + setPointerCapture, then passive touch/mouse
  // listeners relying on the browser's synthesized click) both failed specifically on Android
  // Chromium browsers while working fine everywhere on iOS/iPadOS WebKit, Chrome included -
  // confirming this is an engine difference, not a browser-branding one. This version fully
  // claims the touch gesture instead of cooperating with it: touchstart/touchend are
  // non-passive and call preventDefault, so no native click, context menu, or selection ever
  // gets a chance to start, and we dispatch the tap/flag ourselves rather than trusting the
  // browser to synthesize a click afterward.
  function attachCellGestures(div, r, c) {
    div.addEventListener('touchstart', (e) => {
      e.preventDefault();
      lastTouchTime = Date.now();
      const t = e.touches[0];
      if (t) startPress(r, c, t.clientX, t.clientY);
    }, { passive: false });
    div.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (t) movePress(t.clientX, t.clientY);
    }, { passive: true });
    div.addEventListener('touchend', (e) => {
      e.preventDefault();
      const wasLongPress = longPressFired;
      cancelPress();
      longPressFired = false;
      if (!wasLongPress) dispatchTap(r, c);
    }, { passive: false });
    div.addEventListener('touchcancel', cancelPress);

    div.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (Date.now() - lastTouchTime < 800) return; // guards against a stray synthetic mouse event on devices where touchstart's preventDefault doesn't suppress it
      startPress(r, c, e.clientX, e.clientY);
    });
    div.addEventListener('mousemove', (e) => movePress(e.clientX, e.clientY));
    div.addEventListener('mouseup', cancelPress);
    div.addEventListener('mouseleave', cancelPress);

    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleFlag(r, c);
    });
    div.addEventListener('click', () => {
      if (Date.now() - lastTouchTime < 800) return; // touch already handled via touchend above
      if (longPressFired) { longPressFired = false; return; }
      dispatchTap(r, c);
    });
  }

  function updateStats() {
    el.lives.textContent = '❤️'.repeat(state.lives) + '🤍'.repeat(MAX_LIVES - state.lives);
    el.coins.textContent = coins;
    el.found.textContent = state.revealed;
    el.sniffBtn.disabled = state.roundOver || coins < 1 || !hasSniffableCritters();
    el.rewindBtn.disabled = state.roundOver || coins < 1 || !state.history.length;

    const pulseUnlocked = state.n >= PULSE_MIN_GRID;
    el.pulseBtn.style.display = pulseUnlocked ? '' : 'none';
    if (pulseUnlocked) {
      el.pulseBtn.disabled = state.roundOver || (!state.pulseArmed && coins < PULSE_COST);
      el.pulseBtn.textContent = state.pulseArmed ? 'Pulse: tap a tile…' : `Pulse · ${PULSE_COST} 🪙`;
      el.pulseBtn.classList.toggle('active', state.pulseArmed);
    }

    el.decodeBtn.disabled = state.roundOver || (!state.decodeArmed && coins < DECODE_COST);
    el.decodeBtn.textContent = state.decodeArmed ? 'Decode: tap a ✦ tile…' : `Decode · ${DECODE_COST} 🪙`;
    el.decodeBtn.classList.toggle('active', state.decodeArmed);

    el.wardBtn.disabled = state.roundOver || coins < WARD_COST || lifeWardArmed;
    el.wardBtn.textContent = lifeWardArmed ? 'Ward: armed 🛡️' : `Ward · ${WARD_COST} 🪙`;

    el.shieldBtn.disabled = state.roundOver || coins < 1 || streakShieldArmed;
    el.shieldBtn.textContent = streakShieldArmed ? 'Shield: armed 🛡️' : 'Shield · 1 🪙';

    el.streak.textContent = streak;
    updateDebugPanel();
    persistSave();
  }

  function render() {
    el.grid.innerHTML = '';
    for (let r = 0; r < state.n; r++) {
      for (let c = 0; c < state.n; c++) {
        const cell = state.cells[r][c];
        const div = document.createElement('div');
        const decoded = cell.status === 'revealed' && cell.decodedWedges;
        const near = cell.status === 'revealed' && nearestDistanceSquared(state.perm, state.n, r, c) <= NEAR_DISTANCE_SQUARED;
        div.className = 'cell ' + cell.status + (cell.flagged ? ' flagged' : '') + (decoded ? ' decoded' : '') + (near ? ' near' : '');
        if (decoded) {
          div.textContent = cell.decodedWedges.map(i => ARROWS[i]).join('');
        } else if (cell.status === 'revealed') {
          div.textContent = state.grid[r][c];
        } else if (cell.status === 'critter') {
          div.textContent = ANIMALS[r % ANIMALS.length];
        } else if (cell.flagged) {
          div.textContent = '🚩';
        }
        attachCellGestures(div, r, c);
        el.grid.appendChild(div);
      }
    }
  }

  el.newRoundBtn.addEventListener('click', () => {
    el.winOverlay.classList.add('hidden');
    el.continueOverlay.classList.add('hidden');
    startRound();
  });

  el.winPlayAgainBtn.addEventListener('click', () => {
    el.winOverlay.classList.add('hidden');
    startRound();
  });

  el.continueCoinBtn.addEventListener('click', () => {
    if (coins < 1) return;
    coins--;
    grantExtraLife();
  });

  el.continueAdBtn.addEventListener('click', () => {
    el.continueAdBtn.disabled = true;
    const original = el.continueAdBtn.textContent;
    el.continueAdBtn.textContent = 'Watching ad…';
    setTimeout(() => {
      el.continueAdBtn.disabled = false;
      el.continueAdBtn.textContent = original;
      grantExtraLife();
    }, 600);
  });

  el.continueDeclineBtn.addEventListener('click', () => {
    el.continueOverlay.classList.add('hidden');
    recordRoundResult(false);
    startRound();
  });

  el.sniffBtn.addEventListener('click', useSniff);
  el.rewindBtn.addEventListener('click', useRewind);
  el.pulseBtn.addEventListener('click', togglePulseArm);
  el.decodeBtn.addEventListener('click', toggleDecodeArm);
  el.wardBtn.addEventListener('click', useWard);
  el.shieldBtn.addEventListener('click', useShield);

  // Shows the actual streak internals, not just the simulated date, so you can verify the
  // mechanism is tracking correctly without guessing from the 🔥 stat alone. Only changes on
  // its own when you win or lose a round - the advance-day button just moves what day it is.
  function updateDebugPanel() {
    el.debugDateVal.textContent =
      `Simulated date: ${todayDateString()}  ·  lastDecided: ${lastDecidedDate || '—'}  ·  lastExtend: ${lastExtendDate || '—'}  ·  streak: ${streak}`;
  }

  el.debugAdvanceDayBtn.addEventListener('click', () => {
    debugDayOffset++;
    updateDebugPanel();
    showToast(`Debug: simulated date is now ${todayDateString()} — win or lose a round to see the streak react`);
  });

  // Testing-only: exposes internal state so an automated test harness can drive full
  // playthroughs (tapping only known-safe tiles) without visually solving puzzles. Same
  // removal note as the rest of the debug tooling - strip before the App Store build.
  window.__debugGetState = () => ({
    state, tierIndex, tierWins, TIERS, streak, coins,
    streakShieldArmed, lifeWardArmed, lastExtendDate, lastDecidedDate,
  });

  updateDebugPanel();
  startRound();
})();
