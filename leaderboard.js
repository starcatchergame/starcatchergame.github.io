'use strict';

/**
 * Star Catcher v2.2 — Leaderboard (Supabase backend)
 * Reads and writes to a Supabase Postgres table via the REST API.
 *
 * Table schema expected:
 *   id        uuid  primary key (auto)
 *   name      text
 *   score     int
 *   combo     int
 *   date      text
 *
 * Public API is intentionally identical to the localStorage version.
 * Only _load() and _save() changed.
 */
const Leaderboard = (() => {
  const { MAX_ENTRIES }          = CONFIG.LEADERBOARD;
  const { URL, ANON_KEY, TABLE } = CONFIG.SUPABASE;

  const HEADERS = {
    'Content-Type':  'application/json',
    'apikey':        ANON_KEY,
    'Authorization': 'Bearer ' + ANON_KEY,
  };

  // ─── v2.2: TTL cache ─────────────────────────────────────────────────────
  // Avoids redundant network requests on rapid retries or back-to-back
  // qualifies() + getAll() calls.  Cache is invalidated on submit().

  const CACHE_TTL_MS = 30000;   // 30 seconds
  const _cache = {
    scores: null,
    combos: null,
    ts:     0,          // timestamp of last successful fetch
  };

  function _cacheValid() {
    return _cache.scores !== null && (Date.now() - _cache.ts) < CACHE_TTL_MS;
  }

  function _invalidateCache() {
    _cache.scores = null;
    _cache.combos = null;
    _cache.ts     = 0;
  }

  // ─── Storage helpers ────────────────────────────────────────────────────────

  /** Fetch top N rows sorted by a field descending. */
  async function _load(sortField) {
    try {
      const res = await fetch(
        `${URL}/rest/v1/${TABLE}?select=name,score,combo,date&order=${sortField}.desc&limit=${MAX_ENTRIES}`,
        { headers: HEADERS }
      );
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (e) {
      console.warn('[Leaderboard] load failed:', e);
      return [];
    }
  }

  /** Fetch both views and populate cache. */
  async function _loadBoth() {
    if (_cacheValid()) return { scores: _cache.scores, combos: _cache.combos };
    const [scores, combos] = await Promise.all([_load('score'), _load('combo')]);
    _cache.scores = scores;
    _cache.combos = combos;
    _cache.ts     = Date.now();
    return { scores, combos };
  }

  /** Insert a single row. Supabase handles deduplication via the DB. */
  async function _save(entry) {
    try {
      const res = await fetch(`${URL}/rest/v1/${TABLE}`, {
        method:  'POST',
        headers: { ...HEADERS, 'Prefer': 'return=minimal' },
        body:    JSON.stringify(entry),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      console.warn('[Leaderboard] save failed:', e);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns true if either score or combo would place in the top-10.
   * v2.2: uses shared cache to avoid double-fetch.
   */
  async function qualifies(score, combo) {
    const { scores, combos } = await _loadBoth();
    const minScore = scores.length >= MAX_ENTRIES ? scores[scores.length - 1].score : -1;
    const minCombo = combos.length >= MAX_ENTRIES ? combos[combos.length - 1].combo : -1;
    return score > minScore || combo > minCombo;
  }

  /**
   * Inserts the player's result as a single row.
   * v2.2: invalidates cache after submit so next read is fresh.
   */
  async function submit(name, score, combo) {
    const safe = (name || 'ANON').trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 10) || 'ANON';
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    await _save({ name: safe, score, combo, date });
    _invalidateCache();
  }

  /** Returns both sorted views for rendering. v2.2: uses shared cache. */
  async function getAll() {
    return _loadBoth();
  }

  return { qualifies, submit, getAll };
})();