(function () {
  const GRID_SIZE = 5;
  const MAX_LIVES = 3;
  const TIE = '✦';
  const ARROWS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘']; // index i sits at i*45°, E through SE going counter-clockwise
  const ANIMALS = ['🐶', '🐱', '🦊', '🐰', '🐻'];
  const PULSE_COST = 3; // bumped from 2: on a 5x5 board a 3x3 scan can pin a 3-row block's columns almost exactly, stronger than a 1-coin Sniff
  const PULSE_MIN_GRID = 5; // per product decision: unlocks at 5x5 and above
  const DECODE_COST = 2;

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
    shieldBtn: document.getElementById('shieldBtn'),
    winOverlay: document.getElementById('winOverlay'),
    winStats: document.getElementById('winStats'),
    winPlayAgainBtn: document.getElementById('winPlayAgainBtn'),
    continueOverlay: document.getElementById('continueOverlay'),
    continueCoinBtn: document.getElementById('continueCoinBtn'),
    continueAdBtn: document.getElementById('continueAdBtn'),
    continueDeclineBtn: document.getElementById('continueDeclineBtn'),
    toast: document.getElementById('toast'),
  };

  let toastTimer = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('visible'), 2400);
  }
  document.documentElement.style.setProperty('--grid-size', GRID_SIZE);

  // Bumped up for easier testing of the power-ups; real coin economy (earned from stars, persisted) lands in build-order step 4.
  let coins = 10;

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

  function nearestWedges(perm, n, r, c) {
    let minD2 = Infinity;
    let nearest = [];
    for (let a = 0; a < n; a++) {
      const dr = a - r, dc = perm[a] - c;
      const d2 = dr * dr + dc * dc;
      if (d2 < minD2) { minD2 = d2; nearest = [{ dr, dc }]; }
      else if (d2 === minD2) { nearest.push({ dr, dc }); }
    }
    return [...new Set(nearest.map(({ dr, dc }) => wedgeIndex(dr, dc)))];
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
      pulseArmed: false,
      decodeArmed: false,
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

    state.history.push({ r, c, lives: state.lives, revealed: state.revealed });

    if (state.perm[r] === c) {
      cell.status = 'critter';
      state.lives--;
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
    if (allCrittersFlaggedCorrectly()) autoCompleteRound();
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
    el.sniffBtn.disabled = state.roundOver || coins < 1 || !hasHiddenCritters();
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

    el.shieldBtn.disabled = state.roundOver || coins < 1 || streakShieldArmed;
    el.shieldBtn.textContent = streakShieldArmed ? 'Shield: armed 🛡️' : 'Shield · 1 🪙';
  }

  function render() {
    el.grid.innerHTML = '';
    for (let r = 0; r < state.n; r++) {
      for (let c = 0; c < state.n; c++) {
        const cell = state.cells[r][c];
        const div = document.createElement('div');
        const decoded = cell.status === 'revealed' && cell.decodedWedges;
        div.className = 'cell ' + cell.status + (cell.flagged ? ' flagged' : '') + (decoded ? ' decoded' : '');
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
    if (streakShieldArmed) {
      streakShieldArmed = false; // shield spent protecting the streak through this reset
      showToast('🛡️ Shield used — your streak is protected.');
    }
    startRound();
  });

  el.sniffBtn.addEventListener('click', useSniff);
  el.rewindBtn.addEventListener('click', useRewind);
  el.pulseBtn.addEventListener('click', togglePulseArm);
  el.decodeBtn.addEventListener('click', toggleDecodeArm);
  el.shieldBtn.addEventListener('click', useShield);

  startRound();
})();
