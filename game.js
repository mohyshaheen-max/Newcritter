(function () {
  const GRID_SIZE = 5;
  const MAX_LIVES = 3;
  const TIE = '✦';
  const ARROWS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘']; // index i sits at i*45°, E through SE going counter-clockwise
  const ANIMALS = ['🐶', '🐱', '🦊', '🐰', '🐻'];

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
    shieldBtn: document.getElementById('shieldBtn'),
    winOverlay: document.getElementById('winOverlay'),
    winStats: document.getElementById('winStats'),
    winPlayAgainBtn: document.getElementById('winPlayAgainBtn'),
    continueOverlay: document.getElementById('continueOverlay'),
    continueCoinBtn: document.getElementById('continueCoinBtn'),
    continueAdBtn: document.getElementById('continueAdBtn'),
    continueDeclineBtn: document.getElementById('continueDeclineBtn'),
  };
  document.documentElement.style.setProperty('--grid-size', GRID_SIZE);

  // Placeholder balance until the real coin economy (earned from stars, persisted) lands in build-order step 4.
  let coins = 3;

  // Survives round resets (that's the point of a streak shield) - there's no real streak
  // counter to protect yet (that's build-order step 4), so this just tracks arm/consume state.
  let streakShieldArmed = false;

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

  function wedgeIndex(dr, dc) {
    // dr/dc are (critter - tile). Flip dr so "up" (toward row 0) reads as north, matching the arrow glyphs.
    let deg = Math.atan2(-dr, dc) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return Math.round(deg / 45) % 8;
  }

  function computeClueGrid(perm, n) {
    const critters = perm.map((c, r) => ({ r, c }));
    const grid = Array.from({ length: n }, () => Array(n).fill(null));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (perm[r] === c) continue; // critter cell: no clue rendered here
        let minD2 = Infinity;
        let nearest = [];
        for (const a of critters) {
          const dr = a.r - r, dc = a.c - c;
          const d2 = dr * dr + dc * dc;
          if (d2 < minD2) { minD2 = d2; nearest = [{ dr, dc }]; }
          else if (d2 === minD2) { nearest.push({ dr, dc }); }
        }
        const wedges = new Set(nearest.map(({ dr, dc }) => wedgeIndex(dr, dc)));
        grid[r][c] = wedges.size > 1 ? TIE : ARROWS[[...wedges][0]];
      }
    }
    return grid;
  }

  // Two permutations are "confusable" if they'd show identical clues at every cell that's
  // non-critter under BOTH of them (cells that are a critter under either one carry no
  // comparable clue, so they're skipped). A permutation only has a provably unique solution
  // if nothing else in the candidate pool is confusable with it. This is why a genuinely
  // forced 50/50 can still happen deep in a round: local ambiguity between two boards can
  // exist even though each board, as a whole, maps back to exactly one arrangement.
  function areConfusable(permA, gridA, permB, gridB, n) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (permA[r] === c || permB[r] === c) continue;
        if (gridA[r][c] !== gridB[r][c]) return false;
      }
    }
    return true;
  }

  function buildUniqueSolutionPool(n) {
    const perms = permutationsOf(n);
    const grids = perms.map(p => computeClueGrid(p, n));
    const pool = [];
    for (let i = 0; i < perms.length; i++) {
      let confusable = false;
      for (let j = 0; j < perms.length; j++) {
        if (i === j) continue;
        if (areConfusable(perms[i], grids[i], perms[j], grids[j], n)) { confusable = true; break; }
      }
      if (!confusable) pool.push({ perm: perms[i], grid: grids[i] });
    }
    return pool.length ? pool : perms.map((p, i) => ({ perm: p, grid: grids[i] }));
  }

  function startRound() {
    const n = GRID_SIZE;
    state = {
      n,
      pool: buildUniqueSolutionPool(n),
      perm: null,
      grid: null,
      firstTapDone: false,
      cells: Array.from({ length: n }, () => Array.from({ length: n }, () => ({ status: 'hidden', flagged: false }))),
      lives: MAX_LIVES,
      revealed: 0,
      total: n * n - n,
      roundOver: false,
      history: [],
    };
    el.total.textContent = state.total;
    el.critters.textContent = state.n;
    updateStats();
    render();
  }

  function resolveFirstTap(r, c) {
    let candidates = state.pool.filter(({ perm }) => perm[r] !== c);
    if (!candidates.length) {
      candidates = permutationsOf(state.n)
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

  function hasHiddenCritters() {
    if (!state.firstTapDone) return true;
    return state.perm.some((c, r) => state.cells[r][c].status === 'hidden');
  }

  function toggleFlag(r, c) {
    if (state.roundOver) return;
    const cell = state.cells[r][c];
    if (cell.status !== 'hidden') return;
    cell.flagged = !cell.flagged;
    render();
  }

  function tapCell(r, c) {
    if (state.roundOver) return;
    const cell = state.cells[r][c];
    if (cell.status !== 'hidden') return;
    if (cell.flagged) return;

    if (!state.firstTapDone) resolveFirstTap(r, c);

    state.history.push({ r, c, lives: state.lives, revealed: state.revealed });

    if (state.perm[r] === c) {
      cell.status = 'critter';
      state.lives--;
      updateStats();
      render();
      if (state.lives <= 0) offerContinue();
    } else {
      cell.status = 'revealed';
      state.revealed++;
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
      if (state.cells[r][c].status === 'hidden') hidden.push([r, c]);
    }
    if (!hidden.length) return;
    const [r, c] = hidden[Math.floor(Math.random() * hidden.length)];
    coins--;
    state.cells[r][c] = { status: 'critter', flagged: false };
    updateStats();
    render();
  }

  function useRewind() {
    if (state.roundOver || coins < 1 || !state.history.length) return;
    const last = state.history.pop();
    coins--;
    state.cells[last.r][last.c] = { status: 'hidden', flagged: false };
    state.lives = last.lives;
    state.revealed = last.revealed;
    updateStats();
    render();
  }

  function useShield() {
    if (streakShieldArmed || coins < 1) return;
    coins--;
    streakShieldArmed = true;
    updateStats();
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
    updateStats();
  }

  function winRound() {
    state.roundOver = true;
    setTimeout(() => {
      el.winStats.textContent = `Lives kept: ${state.lives}/${MAX_LIVES}`;
      el.winOverlay.classList.remove('hidden');
    }, 300);
  }

  const LONG_PRESS_MS = 450;
  const MOVE_TOLERANCE_PX = 10;
  let pressTimer = null;
  let pressStart = null;
  let longPressFired = false;

  function cancelPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressStart = null;
  }

  function attachCellGestures(div, r, c) {
    div.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return; // right-click handled via contextmenu
      longPressFired = false;
      pressStart = { x: e.clientX, y: e.clientY };
      pressTimer = setTimeout(() => {
        longPressFired = true;
        toggleFlag(r, c);
      }, LONG_PRESS_MS);
    });
    div.addEventListener('pointermove', (e) => {
      if (!pressStart) return;
      if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > MOVE_TOLERANCE_PX) cancelPress();
    });
    div.addEventListener('pointerup', cancelPress);
    div.addEventListener('pointerleave', cancelPress);
    div.addEventListener('pointercancel', cancelPress);
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleFlag(r, c);
    });
    div.addEventListener('click', () => {
      if (longPressFired) { longPressFired = false; return; }
      tapCell(r, c);
    });
  }

  function updateStats() {
    el.lives.textContent = '❤️'.repeat(state.lives) + '🤍'.repeat(MAX_LIVES - state.lives);
    el.coins.textContent = coins;
    el.found.textContent = state.revealed;
    el.sniffBtn.disabled = state.roundOver || coins < 1 || !hasHiddenCritters();
    el.rewindBtn.disabled = state.roundOver || coins < 1 || !state.history.length;
    el.shieldBtn.disabled = state.roundOver || coins < 1 || streakShieldArmed;
    el.shieldBtn.textContent = streakShieldArmed ? 'Shield: armed 🛡️' : 'Shield · 1 🪙';
  }

  function render() {
    el.grid.innerHTML = '';
    for (let r = 0; r < state.n; r++) {
      for (let c = 0; c < state.n; c++) {
        const cell = state.cells[r][c];
        const div = document.createElement('div');
        div.className = 'cell ' + cell.status + (cell.flagged ? ' flagged' : '');
        if (cell.status === 'revealed') {
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
    if (streakShieldArmed) streakShieldArmed = false; // shield spent protecting the streak through this reset
    startRound();
  });

  el.sniffBtn.addEventListener('click', useSniff);
  el.rewindBtn.addEventListener('click', useRewind);
  el.shieldBtn.addEventListener('click', useShield);

  startRound();
})();
