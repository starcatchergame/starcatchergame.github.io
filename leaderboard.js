'use strict';

/**
 * Star Catcher v3.1 — Leaderboard (Supabase backend)
 * Reads and writes to a Supabase Postgres table via the REST API.
 *
 * Table schema expected:
 *   id        uuid  primary key (auto)
 *   name      text
 *   score     int
 *   combo     int
 *   date      text
 *   user_id   uuid  null, references profiles(id)   ← v3.1
 *
 * v3.1 changes:
 *   - A signed-in run is written with the player's user_id and their access
 *     token, so the row is provably theirs.
 *   - Rows are collapsed to one personal best per pilot before the top N is
 *     cut, so a good player takes one slot instead of all ten.
 *   - Entries carry the live display name from `profiles`, so renaming your
 *     account renames your history.
 */
const Leaderboard = (() => {
  const { MAX_ENTRIES, FETCH_MULTIPLIER, DEDUPE_BY_PILOT } = CONFIG.LEADERBOARD;
  const { URL, ANON_KEY, TABLE } = CONFIG.SUPABASE;

  const HEADERS = {
    'Content-Type':  'application/json',
    'apikey':        ANON_KEY,
    'Authorization': 'Bearer ' + ANON_KEY,
  };

  // How many raw rows to pull so dedupe still leaves a full board.
  const FETCH_LIMIT = DEDUPE_BY_PILOT ? MAX_ENTRIES * FETCH_MULTIPLIER : MAX_ENTRIES;

  // Set to false the first time the embedded profile join fails, so we stop
  // paying for a request shape this database doesn't support.
  let _canJoinProfiles = true;

  // ─── TTL cache ─────────────────────────────────────────────────────────────

  const CACHE_TTL_MS = 30000;   // 30 seconds
  const _cache = { scores: null, combos: null, ts: 0 };

  function _cacheValid() {
    return _cache.scores !== null && (Date.now() - _cache.ts) < CACHE_TTL_MS;
  }

  function _invalidateCache() {
    _cache.scores = null;
    _cache.combos = null;
    _cache.ts     = 0;
  }

  // ─── Storage helpers ───────────────────────────────────────────────────────

  function _select(withJoin) {
    return withJoin
      ? 'name,score,combo,date,user_id,profiles(display_name)'
      : 'name,score,combo,date,user_id';
  }

  /**
   * Fetch rows sorted by a field descending.
   * `withJoin` is passed explicitly rather than read from the module flag, so
   * that two loads racing in parallel each get their own retry.
   */
  async function _load(sortField, withJoin = _canJoinProfiles) {
    try {
      const res = await fetch(
        `${URL}/rest/v1/${TABLE}?select=${_select(withJoin)}&order=${sortField}.desc&limit=${FETCH_LIMIT}`,
        { headers: HEADERS }
      );

      // A missing FK or a stale schema cache breaks only the join — retry flat.
      if (!res.ok && withJoin) {
        _canJoinProfiles = false;
        return _load(sortField, false);
      }
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (e) {
      console.warn('[Leaderboard] load failed:', e);
      return [];
    }
  }

  /**
   * One row per pilot, keeping their best. Registered pilots are keyed by
   * user_id; guests fall back to their name, which is the most we can know
   * about them.
   */
  function _collapse(rows, field) {
    if (!DEDUPE_BY_PILOT) return rows.slice(0, MAX_ENTRIES);

    const best = new Map();
    for (const row of rows) {
      const key = row.user_id ? 'u:' + row.user_id : 'g:' + String(row.name || '').toUpperCase();
      const held = best.get(key);
      if (!held || row[field] > held[field]) best.set(key, row);
    }
    return [...best.values()]
      .sort((a, b) => b[field] - a[field])
      .slice(0, MAX_ENTRIES);
  }

  /** Flatten the joined profile name over the name frozen into the row. */
  function _shape(rows) {
    return rows.map(r => ({
      name:       (r.profiles && r.profiles.display_name) || r.name || 'ANON',
      score:      r.score,
      combo:      r.combo,
      date:       r.date,
      userId:     r.user_id || null,
      registered: !!r.user_id,
    }));
  }

  /** Fetch both views and populate cache. */
  async function _loadBoth() {
    if (_cacheValid()) return { scores: _cache.scores, combos: _cache.combos };
    const [rawScores, rawCombos] = await Promise.all([_load('score'), _load('combo')]);
    _cache.scores = _shape(_collapse(rawScores, 'score'));
    _cache.combos = _shape(_collapse(rawCombos, 'combo'));
    _cache.ts     = Date.now();
    return { scores: _cache.scores, combos: _cache.combos };
  }

  /** Insert a single row, signed by the player's token when they have one. */
  async function _save(entry) {
    try {
      const headers = { ...HEADERS, 'Prefer': 'return=minimal' };

      // A signed-in write goes out as that user, which is what the row-level
      // security policy checks before letting user_id through.
      if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
        const tok = await Auth.token();
        if (tok) {
          headers['Authorization'] = 'Bearer ' + tok;
          entry.user_id = Auth.state().userId;
        }
      }

      const res = await fetch(`${URL}/rest/v1/${TABLE}`, {
        method:  'POST',
        headers,
        body:    JSON.stringify(entry),
      });
      if (!res.ok) throw new Error(await res.text());
      return true;
    } catch (e) {
      console.warn('[Leaderboard] save failed:', e);
      return false;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Returns true if either score or combo would place in the top-10. */
  async function qualifies(score, combo) {
    const { scores, combos } = await _loadBoth();
    const minScore = scores.length >= MAX_ENTRIES ? scores[scores.length - 1].score : -1;
    const minCombo = combos.length >= MAX_ENTRIES ? combos[combos.length - 1].combo : -1;
    return score > minScore || combo > minCombo;
  }

  /**
   * Inserts the player's result as a single row. Resolves to true on success.
   *
   * The name goes through Auth.sanitizeName rather than a local copy of the
   * rules: the database enforces the same shape with a check constraint, and
   * two implementations that drift by one collapsed space are a silent
   * rejected insert.
   */
  async function submit(name, score, combo) {
    const safe = Auth.sanitizeName(name) || 'ANON';
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    const ok = await _save({ name: safe, score, combo, date });
    _invalidateCache();
    return ok;
  }

  /** Returns both sorted views for rendering. */
  async function getAll() {
    return _loadBoth();
  }

  /** Drop the cache — used when the signed-in identity changes. */
  function refresh() { _invalidateCache(); }

  return { qualifies, submit, getAll, refresh };
})();
