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
    leaderboardBtn: document.getElementById('leaderboardBtn'),
    leaderboardOverlay: document.getElementById('leaderboardOverlay'),
    leaderboardWeekLabel: document.getElementById('leaderboardWeekLabel'),
    leaderboardNicknameVal: document.getElementById('leaderboardNicknameVal'),
    leaderboardEditNicknameBtn: document.getElementById('leaderboardEditNicknameBtn'),
    leaderboardList: document.getElementById('leaderboardList'),
    leaderboardSelfRow: document.getElementById('leaderboardSelfRow'),
    leaderboardCloseBtn: document.getElementById('leaderboardCloseBtn'),
    nicknameOverlay: document.getElementById('nicknameOverlay'),
    nicknameInput: document.getElementById('nicknameInput'),
    nicknameConfirmBtn: document.getElementById('nicknameConfirmBtn'),
    nicknameSkipBtn: document.getElementById('nicknameSkipBtn'),
    tutorialBanner: document.getElementById('tutorialBanner'),
    tutorialText: document.getElementById('tutorialText'),
    tutorialNextBtn: document.getElementById('tutorialNextBtn'),
    tutorialSkipBtn: document.getElementById('tutorialSkipBtn'),
    howToPlayBtn: document.getElementById('howToPlayBtn'),
    powerupsIntroOverlay: document.getElementById('powerupsIntroOverlay'),
    powerupsIntroCloseBtn: document.getElementById('powerupsIntroCloseBtn'),
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

  // Power-ups intro: shown once, the first time a player clears a tier (see winRound). Set when
  // that happens and consumed by the win overlay's "Play again" handler, which shows the intro
  // modal instead of immediately starting the next round.
  const POWERUPS_INTRO_SEEN_KEY = 'compassCritters.powerupsIntroSeen.v1';
  let pendingPowerupsIntro = false;
  function shouldShowPowerupsIntro() {
    try { return !localStorage.getItem(POWERUPS_INTRO_SEEN_KEY); } catch (err) { return false; }
  }
  function markPowerupsIntroSeen() {
    try { localStorage.setItem(POWERUPS_INTRO_SEEN_KEY, '1'); } catch (err) { /* storage unavailable - will just show again next load */ }
  }

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

  // --- Leaderboard (2026-09-21 product decision): anonymous playerId + self-chosen nickname,
  // global-only (no friends/accounts - that needs a real social graph, deferred), weekly total
  // stars as the score metric, ISO-8601 week boundary (Mon-Sun, UTC) computed server-side so
  // every player shares one canonical reset regardless of local timezone. Coin rewards for top
  // weekly ranks are computed server-side (see worker.js) and claimed on load - this is why
  // /api/submit-score clamps stars itself rather than trusting the client's cumulative total.
  // All calls are relative (same origin as the Worker serving this page) and fire-and-forget:
  // a dropped call just means this round isn't reflected on the board yet, never a gameplay
  // interruption. See SPEC.md's Scoring section.
  const PLAYER_ID_KEY = 'compassCritters.playerId.v1';
  const NICKNAME_KEY = 'compassCritters.nickname.v1';

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function ensurePlayerId() {
    try {
      let id = localStorage.getItem(PLAYER_ID_KEY);
      if (!id) {
        id = randomId();
        localStorage.setItem(PLAYER_ID_KEY, id);
      }
      return id;
    } catch (err) {
      return randomId(); // storage unavailable - works for this session, won't persist
    }
  }

  function getNickname() {
    try { return localStorage.getItem(NICKNAME_KEY); } catch (err) { return null; }
  }

  function setNickname(nickname) {
    try { localStorage.setItem(NICKNAME_KEY, nickname); } catch (err) { /* session-only */ }
  }

  const playerId = ensurePlayerId();

  function registerPlayer(nickname) {
    fetch('/api/player', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, nickname }),
    }).catch(() => { /* offline or API unavailable - nickname is still saved locally */ });
  }

  (function ensureNickname() {
    if (getNickname()) return;
    const defaultNickname = `Critter${Math.floor(1000 + Math.random() * 9000)}`;
    setNickname(defaultNickname);
    registerPlayer(defaultNickname);
  })();

  function submitScore(stars) {
    fetch('/api/submit-score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, stars }),
    }).catch(() => { /* fire-and-forget - a dropped submission just isn't on the board this week */ });
  }

  async function checkUnclaimedRewards() {
    try {
      const res = await fetch(`/api/rewards?playerId=${encodeURIComponent(playerId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.unclaimed || data.unclaimed.length === 0) return;
      const claimRes = await fetch('/api/rewards/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
      if (!claimRes.ok) return;
      const claimData = await claimRes.json();
      if (claimData.totalCoins > 0) {
        coins += claimData.totalCoins;
        persistSave();
        updateStats();
        showToast(`🏆 Weekly leaderboard reward: +${claimData.totalCoins} 🪙!`);
      }
    } catch (err) { /* offline or API unavailable - will retry next load */ }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function openLeaderboard() {
    el.leaderboardOverlay.classList.remove('hidden');
    el.leaderboardNicknameVal.textContent = getNickname() || '';
    el.leaderboardWeekLabel.textContent = '';
    el.leaderboardSelfRow.classList.add('hidden');
    el.leaderboardList.innerHTML = '<p class="leaderboard-empty">Loading…</p>';
    try {
      const res = await fetch(`/api/leaderboard?playerId=${encodeURIComponent(playerId)}`);
      if (!res.ok) throw new Error('leaderboard request failed');
      const data = await res.json();
      el.leaderboardWeekLabel.textContent = `Week ${data.weekId}`;
      const entries = data.entries || [];
      if (entries.length === 0) {
        el.leaderboardList.innerHTML = '<p class="leaderboard-empty">No scores yet this week — be the first!</p>';
      } else {
        el.leaderboardList.innerHTML = entries.map((e) => `
          <div class="leaderboard-row${e.playerId === playerId ? ' self' : ''}">
            <span class="lb-rank">#${e.rank}</span>
            <span class="lb-nickname">${escapeHtml(e.nickname)}</span>
            <span class="lb-stars">⭐ ${e.stars}</span>
          </div>`).join('');
      }
      if (data.self && !entries.some((e) => e.playerId === playerId)) {
        el.leaderboardSelfRow.textContent = `You: #${data.self.rank} · ⭐ ${data.self.stars}`;
        el.leaderboardSelfRow.classList.remove('hidden');
      }
    } catch (err) {
      el.leaderboardWeekLabel.textContent = '';
      el.leaderboardList.innerHTML = '<p class="leaderboard-empty">Leaderboard unavailable right now.</p>';
    }
  }

  el.leaderboardBtn.addEventListener('click', openLeaderboard);
  el.leaderboardCloseBtn.addEventListener('click', () => el.leaderboardOverlay.classList.add('hidden'));
  el.leaderboardEditNicknameBtn.addEventListener('click', () => {
    el.nicknameInput.value = getNickname() || '';
    el.nicknameOverlay.classList.remove('hidden');
  });
  el.nicknameConfirmBtn.addEventListener('click', () => {
    const val = el.nicknameInput.value.trim().slice(0, 20);
    if (!val) return;
    setNickname(val);
    registerPlayer(val);
    el.leaderboardNicknameVal.textContent = val;
    el.nicknameOverlay.classList.add('hidden');
  });
  el.nicknameSkipBtn.addEventListener('click', () => el.nicknameOverlay.classList.add('hidden'));

  checkUnclaimedRewards();

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
    if (tutorialActive) { handleTutorialFlag(r, c); return; }
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
    submitScore(stars);

    const wasAtLastTier = tierIndex >= TIERS.length - 1;
    tierWins++;
    let tierAdvanced = false;
    if (!wasAtLastTier && tierWins >= TIER_WINS_REQUIRED) {
      tierIndex++;
      tierWins = 0;
      tierAdvanced = true;
      // Power-ups intro (2026-09-21 product decision): held back from the opening tutorial and
      // introduced instead the first time a player clears a tier, on the theory they should
      // learn the core arrow/tie/critter loop cold before another system gets layered on top.
      // Gated purely on the "seen it" flag rather than this specific tier index, since the tier
      // list's shape has already changed twice - checking the flag is robust to a third change,
      // checking `tierIndex === 1` wouldn't be.
      if (shouldShowPowerupsIntro()) pendingPowerupsIntro = true;
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
    if (tutorialActive) { handleTutorialTap(r, c); return; }
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
    if (pendingPowerupsIntro) {
      pendingPowerupsIntro = false;
      markPowerupsIntroSeen();
      el.powerupsIntroOverlay.classList.remove('hidden');
      return; // startRound() happens once they dismiss the intro instead, see below
    }
    startRound();
  });

  el.powerupsIntroCloseBtn.addEventListener('click', () => {
    el.powerupsIntroOverlay.classList.add('hidden');
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
    tutorialActive, tutorialStep,
  });

  // --- Onboarding tutorial (2026-09-21, expanded same day per feedback that the first cut was
  // too thin): a scripted interactive walkthrough rather than a slide deck, so a new player's
  // first taps land on real tiles and watch a real arrow/red-warning/tie/critter appear - the
  // actual grid rendering and CSS, not a mockup. Runs on a small fixed board entirely separate
  // from `state`/the tier ladder/coins - it's a teaching fixture, not a real round, so nothing
  // here touches persistence except the one "seen it" flag. Covers the whole core loop
  // (including flagging, masking, and the win condition) but deliberately NOT power-ups - those
  // get their own intro the first time a player actually clears a tier (see winRound /
  // POWERUPS_INTRO_SEEN_KEY above), on the theory that the core loop should land solidly before
  // another system stacks on top of it. Replayable any time via the How to play button.
  //
  // Each step is one of three kinds:
  //   'tap'  - highlight one tile, wait for it to be tapped, then show what appeared
  //   'flag' - highlight one tile, wait for it to be held/right-clicked (flagged), then explain
  //   'info' - no board interaction; just a caption and a Next button
  const TUTORIAL_SEEN_KEY = 'compassCritters.tutorialSeen.v1';
  const TUTORIAL_N = 5;
  const TUTORIAL_PERM = [0, null, null, null, 4]; // critters at (0,0) and (4,4) on a 5x5 board
  const TUTORIAL_GRID = computeClueGrid(TUTORIAL_PERM, TUTORIAL_N);
  const TUTORIAL_STEPS = [
    {
      kind: 'tap', r: 0, c: 3,
      prompt: 'Tap the glowing tile to reveal it. Your very first tap each round is always guaranteed safe.',
      explain: 'That arrow points toward the nearest hidden critter, using 8 compass directions. Every direction is a true 45° wedge, so it always reads the same width no matter which way it’s pointing.',
    },
    {
      kind: 'tap', r: 0, c: 2,
      prompt: 'Tap the next glowing tile.',
      explain: 'When an arrow turns red, the nearest critter is within just 2 tiles — a proximity warning layered on top of the direction.',
    },
    {
      kind: 'tap', r: 2, c: 2,
      prompt: 'One more — tap the glowing tile.',
      explain: '✦ means two critters are exactly tied for nearest, in different directions. It’s deliberately fuzzy on its own — cross-reference a tile you’ve already revealed nearby to narrow it down, or spend a Decode power-up later to see the tied directions directly.',
    },
    {
      kind: 'info',
      text: 'One more thing about that first arrow: it only ever points to the ONE nearest critter. There’s a second critter on this very board, but it stayed completely invisible from that tile because the other one was closer. That’s called masking — a farther critter is hidden until you’re standing closer to it than to anything else.',
    },
    {
      kind: 'flag', r: 4, c: 4,
      prompt: 'Press and hold (or right-click on desktop) the glowing tile to flag it as a reminder.',
      explain: 'Flagging marks a tile you’re confident about — useful for tiles you suspect hide a critter. It’s optional bookkeeping to avoid a misclick, purely free, and never required to win. Hold again to unflag.',
    },
    {
      kind: 'tap', r: 0, c: 0,
      prompt: 'Last interactive one — this tile is different. Tap it anyway.',
      explain: 'That was a critter — it costs a life, 3 per round. Lose all 3 and you’ll get a Continue offer (spend a coin, or watch a rewarded ad) for one more life before the round resets.',
    },
    {
      kind: 'info',
      text: 'You win a round once every tile that isn’t a critter has been safely revealed. There’s no move limit and no rationed clues — every arrow is always available. The only risk is in which tile you pick next.',
    },
    {
      kind: 'info',
      text: 'Winning earns coins based on how many lives you kept (1-3 🪙 per round), and your first win or loss each day updates a daily streak 🔥. Power-ups that spend those coins to make tricky rounds easier unlock once you clear your first tier — for now, just explore with your eyes and your taps.',
    },
  ];

  let tutorialActive = false;
  let tutorialStep = 0;
  let tutorialPhase = 'prompt'; // 'prompt' (waiting for the target tap/flag) or 'explain' (showing what happened) - unused by 'info' steps, which always show their text immediately
  let tutorialCells = null; // [r][c] = { status: 'hidden'|'revealed'|'critter', flagged: bool }

  function renderTutorial() {
    el.grid.innerHTML = '';
    const step = TUTORIAL_STEPS[tutorialStep];
    const isInfo = step.kind === 'info';
    for (let r = 0; r < TUTORIAL_N; r++) {
      for (let c = 0; c < TUTORIAL_N; c++) {
        const cell = tutorialCells[r][c];
        const div = document.createElement('div');
        const near = cell.status === 'revealed' && nearestDistanceSquared(TUTORIAL_PERM, TUTORIAL_N, r, c) <= NEAR_DISTANCE_SQUARED;
        const isTarget = !isInfo && tutorialPhase === 'prompt' && r === step.r && c === step.c;
        div.className = 'cell ' + cell.status + (cell.flagged ? ' flagged' : '') + (near ? ' near' : '') + (isTarget ? ' tutorial-target' : '');
        if (cell.status === 'revealed') div.textContent = TUTORIAL_GRID[r][c];
        else if (cell.status === 'critter') div.textContent = ANIMALS[r % ANIMALS.length];
        else if (cell.flagged) div.textContent = '🚩';
        attachCellGestures(div, r, c);
        el.grid.appendChild(div);
      }
    }
    el.tutorialText.textContent = isInfo ? step.text : (tutorialPhase === 'prompt' ? step.prompt : step.explain);
    el.tutorialNextBtn.classList.toggle('hidden', !isInfo && tutorialPhase !== 'explain');
    el.tutorialNextBtn.textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? 'Start playing' : 'Next';
  }

  function handleTutorialTap(r, c) {
    const step = TUTORIAL_STEPS[tutorialStep];
    if (step.kind !== 'tap' || tutorialPhase !== 'prompt') return;
    if (r !== step.r || c !== step.c) return; // guided - taps elsewhere just don't do anything
    tutorialCells[r][c].status = TUTORIAL_PERM[r] === c ? 'critter' : 'revealed';
    tutorialPhase = 'explain';
    renderTutorial();
  }

  function handleTutorialFlag(r, c) {
    const step = TUTORIAL_STEPS[tutorialStep];
    if (step.kind !== 'flag' || tutorialPhase !== 'prompt') return;
    if (r !== step.r || c !== step.c) return;
    tutorialCells[r][c].flagged = true;
    tutorialPhase = 'explain';
    renderTutorial();
  }

  function startTutorial() {
    tutorialActive = true;
    tutorialStep = 0;
    tutorialPhase = 'prompt';
    tutorialCells = Array.from({ length: TUTORIAL_N }, () => Array.from({ length: TUTORIAL_N }, () => ({ status: 'hidden', flagged: false })));
    document.documentElement.style.setProperty('--grid-size', TUTORIAL_N);
    document.body.classList.add('tutorial-mode');
    el.tutorialBanner.classList.remove('hidden');
    renderTutorial();
  }

  function finishTutorial() {
    tutorialActive = false;
    try { localStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch (err) { /* storage unavailable - will just replay next load */ }
    document.body.classList.remove('tutorial-mode');
    el.tutorialBanner.classList.add('hidden');
    startRound();
  }

  el.tutorialNextBtn.addEventListener('click', () => {
    if (tutorialStep >= TUTORIAL_STEPS.length - 1) { finishTutorial(); return; }
    tutorialStep++;
    tutorialPhase = 'prompt';
    renderTutorial();
  });
  el.tutorialSkipBtn.addEventListener('click', finishTutorial);
  el.howToPlayBtn.addEventListener('click', startTutorial);

  updateDebugPanel();

  // First-ever launch (no save at all yet) gets the tutorial before anything else. A returning
  // player who already has a save predates this feature or has simply played before either way
  // - mark it seen rather than interrupting them, since How to play covers the replay case.
  if (loadSave()) {
    try { localStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch (err) { /* non-fatal */ }
    startRound();
  } else {
    let alreadySeen = false;
    try { alreadySeen = !!localStorage.getItem(TUTORIAL_SEEN_KEY); } catch (err) { /* non-fatal */ }
    if (alreadySeen) startRound(); else startTutorial();
  }
})();
