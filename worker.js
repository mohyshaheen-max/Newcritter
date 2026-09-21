// Compass Critters — Cloudflare Worker
// Serves the static site (via ASSETS) and the leaderboard API (via D1).

const REWARD_TIERS = [
  { minRank: 1, maxRank: 1, coins: 10 },
  { minRank: 2, maxRank: 3, coins: 7 },
  { minRank: 4, maxRank: 10, coins: 5 },
  { minRank: 11, maxRank: 50, coins: 3 },
  { minRank: 51, maxRank: 100, coins: 1 },
];

function coinsForRank(rank) {
  for (const tier of REWARD_TIERS) {
    if (rank >= tier.minRank && rank <= tier.maxRank) return tier.coins;
  }
  return 0;
}

// ISO 8601 week id, e.g. "2026-W38". Weeks run Monday..Sunday, UTC.
function isoWeekId(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function badRequest(message) {
  return jsonResponse({ error: message }, 400);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidPlayerId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

function sanitizeNickname(nickname) {
  if (typeof nickname !== 'string') return null;
  const trimmed = nickname.trim().slice(0, 20);
  if (trimmed.length < 1) return null;
  return trimmed;
}

async function handlePlayer(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid JSON body');
  }
  const { playerId, nickname } = body;
  if (!isValidPlayerId(playerId)) return badRequest('invalid playerId');
  const cleanNickname = sanitizeNickname(nickname);
  if (!cleanNickname) return badRequest('invalid nickname');

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO players (id, nickname, created_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET nickname = excluded.nickname`
  ).bind(playerId, cleanNickname, now).run();

  return jsonResponse({ ok: true, playerId, nickname: cleanNickname });
}

async function handleSubmitScore(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid JSON body');
  }
  const { playerId, stars } = body;
  if (!isValidPlayerId(playerId)) return badRequest('invalid playerId');
  if (typeof stars !== 'number' || !Number.isFinite(stars)) return badRequest('invalid stars');

  // Server is authoritative on the plausible per-round range; clamp rather than trust the client.
  const clampedStars = Math.max(1, Math.min(3, Math.round(stars)));

  const player = await env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(playerId).first();
  if (!player) return badRequest('unknown playerId - call /api/player first');

  const weekId = isoWeekId(new Date());
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO weekly_scores (player_id, week_id, stars, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(player_id, week_id) DO UPDATE SET stars = stars + excluded.stars, updated_at = excluded.updated_at`
  ).bind(playerId, weekId, clampedStars, now).run();

  return jsonResponse({ ok: true, weekId, starsAdded: clampedStars });
}

async function handleLeaderboard(request, env) {
  const url = new URL(request.url);
  const playerId = url.searchParams.get('playerId');
  const weekId = url.searchParams.get('weekId') || isoWeekId(new Date());

  const top = await env.DB.prepare(
    `SELECT ws.player_id AS playerId, p.nickname AS nickname, ws.stars AS stars
     FROM weekly_scores ws JOIN players p ON p.id = ws.player_id
     WHERE ws.week_id = ?
     ORDER BY ws.stars DESC, ws.updated_at ASC
     LIMIT 100`
  ).bind(weekId).all();

  const entries = (top.results || []).map((row, i) => ({ ...row, rank: i + 1 }));

  let self = null;
  if (isValidPlayerId(playerId)) {
    const selfRow = entries.find((e) => e.playerId === playerId);
    if (selfRow) {
      self = selfRow;
    } else {
      const own = await env.DB.prepare(
        `SELECT stars FROM weekly_scores WHERE player_id = ? AND week_id = ?`
      ).bind(playerId, weekId).first();
      if (own) {
        const ahead = await env.DB.prepare(
          `SELECT COUNT(*) AS cnt FROM weekly_scores WHERE week_id = ? AND stars > ?`
        ).bind(weekId, own.stars).first();
        self = { playerId, stars: own.stars, rank: (ahead?.cnt || 0) + 1 };
      }
    }
  }

  return jsonResponse({ weekId, entries, self });
}

async function handleRewards(request, env) {
  const url = new URL(request.url);
  const playerId = url.searchParams.get('playerId');
  if (!isValidPlayerId(playerId)) return badRequest('invalid playerId');

  const rows = await env.DB.prepare(
    `SELECT week_id AS weekId, rank, coins_awarded AS coins FROM reward_claims
     WHERE player_id = ? AND claimed = 0 AND coins_awarded > 0`
  ).bind(playerId).all();

  return jsonResponse({ unclaimed: rows.results || [] });
}

async function handleClaimRewards(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid JSON body');
  }
  const { playerId } = body;
  if (!isValidPlayerId(playerId)) return badRequest('invalid playerId');

  const unclaimed = await env.DB.prepare(
    `SELECT week_id AS weekId, coins_awarded AS coins FROM reward_claims
     WHERE player_id = ? AND claimed = 0 AND coins_awarded > 0`
  ).bind(playerId).all();

  const rows = unclaimed.results || [];
  const totalCoins = rows.reduce((sum, r) => sum + r.coins, 0);

  if (rows.length > 0) {
    await env.DB.prepare(
      `UPDATE reward_claims SET claimed = 1 WHERE player_id = ? AND claimed = 0 AND coins_awarded > 0`
    ).bind(playerId).run();
  }

  return jsonResponse({ ok: true, totalCoins, weeksClaimed: rows.length });
}

async function handleApi(request, env, pathname) {
  if (pathname === '/api/player' && request.method === 'POST') return handlePlayer(request, env);
  if (pathname === '/api/submit-score' && request.method === 'POST') return handleSubmitScore(request, env);
  if (pathname === '/api/leaderboard' && request.method === 'GET') return handleLeaderboard(request, env);
  if (pathname === '/api/rewards' && request.method === 'GET') return handleRewards(request, env);
  if (pathname === '/api/rewards/claim' && request.method === 'POST') return handleClaimRewards(request, env);
  return jsonResponse({ error: 'not found' }, 404);
}

// Ranks last week's weekly_scores and inserts reward_claims rows. Idempotent per week
// (INSERT OR IGNORE keyed on player_id+week_id) so a re-run (e.g. a retried cron) is harmless.
async function computeWeeklyRewards(env, now = new Date()) {
  const lastWeekDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // safely inside the previous ISO week
  const weekId = isoWeekId(lastWeekDate);

  const scores = await env.DB.prepare(
    `SELECT player_id AS playerId, stars FROM weekly_scores WHERE week_id = ? ORDER BY stars DESC, updated_at ASC LIMIT 100`
  ).bind(weekId).all();

  const rows = scores.results || [];
  const now_ts = Date.now();
  const statements = rows.map((row, i) => {
    const rank = i + 1;
    const coins = coinsForRank(rank);
    return env.DB.prepare(
      `INSERT OR IGNORE INTO reward_claims (player_id, week_id, rank, coins_awarded, claimed, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    ).bind(row.playerId, weekId, rank, coins, now_ts);
  });

  if (statements.length > 0) await env.DB.batch(statements);
  return { weekId, rankedCount: rows.length };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url.pathname);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(computeWeeklyRewards(env));
  },
};
