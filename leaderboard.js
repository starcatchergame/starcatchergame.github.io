'use strict';

/**
 * Star Catcher v3.5 — Leaderboard (Supabase backend)
 * Reads and writes to Supabase Postgres tables via the REST API.
 *
 * Table schema expected (identical for both boards):
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
 *
 * ── v3.5: TWO BOARDS ──────────────────────────────────────────────────────
 *
 * A mouse and a thumb are different instruments. Merged, the touch runs would
 * sit permanently at the bottom of a board that never explains why — which
 * reads as "you are bad at this" rather than "you are playing a harder
 * instrument". So there are two tables, and every public call takes a BOARD:
 *
 *     'pointer'  →  CONFIG.SUPABASE.TABLE        (mouse, trackpad, stylus)
 *     'touch'    →  CONFIG.SUPABASE.TABLE_TOUCH  (finger-dragged)
 *
 * Board defaults to Platform.mode() when omitted, so call sites that pass
 * nothing do the right thing for whoever is playing. The board a RUN belongs
 * to is captured at run start and passed explicitly by game.js — never
 * re-derived at submit time, or a mouse plugged in during the game-over
 * screen could move a finished run onto the wrong board.
 *
 * The cache and the join-capability flag are per board, because the boards
 * are separate tables with separate schema caches, and one of them failing
 * its profile join says nothing about the other.
 */
const Leaderboard = (() => {
  const { MAX_ENTRIES, FETCH_MULTIPLIER, DEDUPE_BY_PILOT } = CONFIG.LEADERBOARD;
  const { URL, ANON_KEY } = CONFIG.SUPABASE;

  const HEADERS = {
    'Content-Type':  'application/json',
    'apikey':        ANON_KEY,
    'Authorization': 'Bearer ' + ANON_KEY,
  };

  // How many raw rows to pull so dedupe still leaves a full board.
  const FETCH_LIMIT = DEDUPE_BY_PILOT ? MAX_ENTRIES * FETCH_MULTIPLIER : MAX_ENTRIES;

  const BOARDS = {
    pointer: {
      table: CONFIG.SUPABASE.TABLE,
      label: 'MOUSE',
      // Set to false the first time the embedded profile join fails, so we
      // stop paying for a request shape this database doesn't support.
      canJoin: true,
      cache: { scores: null, combos: null, ts: 0 },
    },
    touch: {
      table: CONFIG.SUPABASE.TABLE_TOUCH,
      label: 'TOUCH',
      canJoin: true,
      cache: { scores: null, combos: null, ts: 0 },
    },
  };

  /**
   * Anything that isn't a known board key falls back to how the player is
   * currently driving. A typo'd board name silently writing to the wrong
   * table would be very hard to notice, so it warns rather than failing quiet.
   */
  function _board(key) {
    if (key && BOARDS[key]) return BOARDS[key];
    if (key) console.warn('[Leaderboard] unknown board "' + key + '" — using current mode');
    return BOARDS[boardKey(null)];
  }

  /** The canonical key for a board, for callers that need to store one. */
  function boardKey(key) {
    if (key && BOARDS[key]) return key;
    return (typeof Platform !== 'undefined' && Platform.mode() === 'touch')
      ? 'touch' : 'pointer';
  }

  function boards() {
    return Object.keys(BOARDS).map(k => ({ key: k, label: BOARDS[k].label }));
  }

  // ─── TTL cache ─────────────────────────────────────────────────────────────

  const CACHE_TTL_MS = 30000;   // 30 seconds

  function _cacheValid(b) {
    return b.cache.scores !== null && (Date.now() - b.cache.ts) < CACHE_TTL_MS;
  }

  function _invalidateCache(b) {
    b.cache.scores = null;
    b.cache.combos = null;
    b.cache.ts     = 0;
  }

  // ─── Storage helpers ───────────────────────────────────────────────────────

  function _select(withJoin) {
    return withJoin
      ? 'name,score,combo,date,user_id,profiles(display_name)'
      : 'name,score,combo,date,user_id';
  }

  /**
   * Fetch rows sorted by a field descending.
   * `withJoin` is passed explicitly rather than read from the board flag, so
   * that two loads racing in parallel each get their own retry.
   */
  async function _load(b, sortField, withJoin = b.canJoin) {
    try {
      const res = await fetch(
        `${URL}/rest/v1/${b.table}?select=${_select(withJoin)}&order=${sortField}.desc&limit=${FETCH_LIMIT}`,
        { headers: HEADERS }
      );

      // A missing FK or a stale schema cache breaks only the join — retry flat.
      if (!res.ok && withJoin) {
        b.canJoin = false;
        return _load(b, sortField, false);
      }
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    } catch (e) {
      console.warn('[Leaderboard] load failed (' + b.table + '):', e);
      return [];
    }
  }

  /**
   * One row per pilot, keeping their best. Registered pilots are keyed by
   * user_id; guests fall back to their name, which is the most we can know
   * about them.
   *
   * This runs per board, so one pilot can legitimately hold a slot on both.
   * The same person with a mouse and with a thumb is two results, not a
   * duplicate.
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

  /** Fetch both views for one board and populate its cache. */
  async function _loadBoth(b) {
    if (_cacheValid(b)) return { scores: b.cache.scores, combos: b.cache.combos };
    const [rawScores, rawCombos] = await Promise.all([_load(b, 'score'), _load(b, 'combo')]);
    b.cache.scores = _shape(_collapse(rawScores, 'score'));
    b.cache.combos = _shape(_collapse(rawCombos, 'combo'));
    b.cache.ts     = Date.now();
    return { scores: b.cache.scores, combos: b.cache.combos };
  }

  /** Insert a single row, signed by the player's token when they have one. */
  async function _save(b, entry) {
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

      const res = await fetch(`${URL}/rest/v1/${b.table}`, {
        method:  'POST',
        headers,
        body:    JSON.stringify(entry),
      });
      if (!res.ok) throw new Error(await res.text());
      return true;
    } catch (e) {
      console.warn('[Leaderboard] save failed (' + b.table + '):', e);
      return false;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns true if either score or combo would place in the top-10 OF THE
   * GIVEN BOARD. Qualification is per board on purpose: an early touch run
   * makes the touch board on merit even though it wouldn't dent the mouse one.
   */
  async function qualifies(score, combo, board) {
    const { scores, combos } = await _loadBoth(_board(board));
    const minScore = scores.length >= MAX_ENTRIES ? scores[scores.length - 1].score : -1;
    const minCombo = combos.length >= MAX_ENTRIES ? combos[combos.length - 1].combo : -1;
    return score > minScore || combo > minCombo;
  }

  /**
   * Inserts the player's result as a single row on the given board.
   * Resolves to true on success.
   *
   * The name goes through Auth.sanitizeName rather than a local copy of the
   * rules: the database enforces the same shape with a check constraint, and
   * two implementations that drift by one collapsed space are a silent
   * rejected insert.
   */
  async function submit(name, score, combo, board) {
    const b    = _board(board);
    const safe = Auth.sanitizeName(name) || 'ANON';
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    const ok = await _save(b, { name: safe, score, combo, date });
    _invalidateCache(b);
    return ok;
  }

  /** Returns both sorted views of one board for rendering. */
  async function getAll(board) {
    return _loadBoth(_board(board));
  }

  /** Drop caches — used when the signed-in identity changes. */
  function refresh(board) {
    if (board && BOARDS[board]) { _invalidateCache(BOARDS[board]); return; }
    Object.keys(BOARDS).forEach(k => _invalidateCache(BOARDS[k]));
  }

  return { qualifies, submit, getAll, refresh, boards, boardKey };
})();
