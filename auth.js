'use strict';

/**
 * Star Catcher v3.1 — Auth (Supabase GoTrue, no SDK)
 *
 * Talks directly to the Supabase Auth REST API so the game stays a
 * zero-build, script-tag project.
 *
 * Supports:
 *   - Email + password sign up / sign in
 *   - OAuth (Google, Discord) via the PKCE flow
 *   - Session persistence in localStorage with silent refresh on return
 *   - A public `profiles` row holding the pilot's display name
 *   - Guest mode: a remembered name with no account behind it
 *
 * Everything degrades gracefully. If the network is down, if the tables
 * aren't there yet, if a provider isn't enabled — the game still runs and
 * the player is simply a guest.
 *
 * See SETUP.md for the SQL and dashboard steps this expects.
 */
const Auth = (() => {

  const { URL, ANON_KEY } = CONFIG.SUPABASE;
  const { NAME_MAX_LENGTH, PROFILE_TABLE } = CONFIG.ACCOUNT;

  const SESSION_KEY  = 'starcatcher_session';
  const GUEST_KEY    = 'starcatcher_guest_name';
  const VERIFIER_KEY = 'starcatcher_pkce_verifier';

  // Refresh this many ms before the access token actually expires.
  const REFRESH_MARGIN_MS = 60_000;

  // ─── Internal state ────────────────────────────────────────────────────────

  let session   = null;   // { access_token, refresh_token, expires_at, user }
  let profile   = null;   // { id, display_name, created_at }
  let refreshTimer = null;
  const listeners = [];

  let _resolveReady;
  /** Resolves once the initial session restore / OAuth callback has settled. */
  const ready = new Promise(res => { _resolveReady = res; });

  // ─── Small helpers ─────────────────────────────────────────────────────────

  const baseHeaders = () => ({
    'Content-Type': 'application/json',
    'apikey':       ANON_KEY,
  });

  const authHeaders = () => ({
    ...baseHeaders(),
    'Authorization': 'Bearer ' + (session ? session.access_token : ANON_KEY),
  });

  /** POST/GET wrapper that always returns { ok, data, error }. */
  async function api(path, { method = 'GET', body, headers, useSession = false } = {}) {
    try {
      const res = await fetch(URL + path, {
        method,
        headers: { ...(useSession ? authHeaders() : baseHeaders()), ...(headers || {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
      if (!res.ok) {
        return { ok: false, data, error: _errorMessage(data, res.status) };
      }
      return { ok: true, data, error: null };
    } catch (e) {
      return { ok: false, data: null, error: 'Network unreachable. Check your connection.' };
    }
  }

  /** Turn a GoTrue / PostgREST error body into something a player can read. */
  function _errorMessage(data, status) {
    if (!data) return `Request failed (${status}).`;
    if (typeof data === 'string') return data;
    const raw = data.msg || data.error_description || data.message || data.error || '';

    if (/already registered|already been registered/i.test(raw))
      return 'That email already has an account. Sign in instead.';
    if (/invalid login credentials/i.test(raw))
      return 'Email or password is wrong.';
    if (/email not confirmed/i.test(raw))
      return 'Confirm your email first — check your inbox.';
    if (/password should be at least (\d+)/i.test(raw))
      return 'Password needs at least ' + raw.match(/at least (\d+)/i)[1] + ' characters.';
    if (/unable to validate email|invalid format/i.test(raw))
      return 'That email address does not look right.';
    if (/duplicate key|23505/i.test(raw))
      return 'That name is taken. Try another.';
    if (/rate limit|too many/i.test(raw))
      return 'Too many attempts. Wait a minute and try again.';
    if (/provider is not enabled/i.test(raw))
      return 'That sign-in option is not switched on yet.';
    if (/relation .* does not exist|schema cache/i.test(raw))
      return 'Accounts are not set up on the server yet.';

    return raw || `Request failed (${status}).`;
  }

  /** The game's name charset: uppercase, short, arcade-cabinet legal. */
  function sanitizeName(raw) {
    return (raw || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9 _-]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, NAME_MAX_LENGTH)
      .trim();
  }

  function notify() {
    const snapshot = publicState();
    listeners.forEach(fn => { try { fn(snapshot); } catch (e) { console.warn('[Auth] listener threw:', e); } });
  }

  // ─── Session persistence ───────────────────────────────────────────────────

  function persist() {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else         localStorage.removeItem(SESSION_KEY);
    } catch (_) { /* private browsing — session lives for this tab only */ }
  }

  function readPersisted() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  /** Normalise a GoTrue token response into our session shape. */
  function adoptSession(data) {
    if (!data || !data.access_token) return false;
    session = {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Date.now() + ((data.expires_in || 3600) * 1000),
      user:          data.user || (session && session.user) || null,
    };
    persist();
    scheduleRefresh();
    return true;
  }

  function clearSession() {
    session = null;
    profile = null;
    clearTimeout(refreshTimer);
    refreshTimer = null;
    persist();
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!session) return;
    const delay = Math.max(15_000, session.expires_at - Date.now() - REFRESH_MARGIN_MS);
    refreshTimer = setTimeout(() => { refreshSession(); }, delay);
  }

  async function refreshSession() {
    if (!session || !session.refresh_token) return false;
    const { ok, data } = await api('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body:   { refresh_token: session.refresh_token },
    });
    if (ok && adoptSession(data)) return true;

    // A rejected refresh token means the session is genuinely dead.
    clearSession();
    notify();
    return false;
  }

  /** Returns a valid access token, refreshing first if it is about to lapse. */
  async function token() {
    if (!session) return null;
    if (Date.now() > session.expires_at - REFRESH_MARGIN_MS) {
      const okRefresh = await refreshSession();
      if (!okRefresh) return null;
    }
    return session.access_token;
  }

  // ─── PKCE ──────────────────────────────────────────────────────────────────

  function randomVerifier() {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  }

  function base64url(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function challengeFor(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64url(new Uint8Array(digest));
  }

  /**
   * PKCE needs SubtleCrypto, which browsers only expose in a secure context:
   * https, localhost or 127.0.0.1. On a plain-http origin — a LAN IP during
   * local testing, say — crypto.subtle is simply undefined.
   */
  function canUsePkce() {
    return typeof crypto !== 'undefined'
      && !!crypto.subtle
      && typeof crypto.subtle.digest === 'function';
  }

  /** Where the OAuth provider sends the player back to. */
  function redirectTarget() {
    return window.location.origin + window.location.pathname;
  }

  // ─── OAuth callback handling ───────────────────────────────────────────────

  /**
   * Supabase can hand the session back two ways depending on project config:
   *   PKCE     — ?code=... in the query string
   *   implicit — #access_token=... in the hash
   * Both are handled, then scrubbed from the address bar.
   */
  async function consumeRedirect() {
    const query = new URLSearchParams(window.location.search);
    const hash  = new URLSearchParams(window.location.hash.replace(/^#/, ''));

    const errorDesc = query.get('error_description') || hash.get('error_description');
    const code      = query.get('code');
    const hashToken = hash.get('access_token');

    if (!errorDesc && !code && !hashToken) return null;

    let result = null;

    if (code) {
      let verifier = null;
      try { verifier = localStorage.getItem(VERIFIER_KEY); } catch (_) {}
      try { localStorage.removeItem(VERIFIER_KEY); } catch (_) {}

      if (verifier) {
        const { ok, data, error } = await api('/auth/v1/token?grant_type=pkce', {
          method: 'POST',
          body:   { auth_code: code, code_verifier: verifier },
        });
        result = ok && adoptSession(data) ? { ok: true } : { ok: false, error };
      } else {
        result = { ok: false, error: 'Sign-in link expired. Try again.' };
      }
    } else if (hashToken) {
      const okAdopt = adoptSession({
        access_token:  hashToken,
        refresh_token: hash.get('refresh_token'),
        expires_in:    parseInt(hash.get('expires_in') || '3600', 10),
      });
      result = okAdopt ? { ok: true } : { ok: false, error: 'Sign-in response was incomplete.' };
    } else {
      result = { ok: false, error: errorDesc || 'Sign-in was cancelled.' };
    }

    // Scrub the tokens/code out of the URL so a refresh or a shared link is clean.
    history.replaceState(null, '', redirectTarget());
    return result;
  }

  // ─── Profiles ──────────────────────────────────────────────────────────────

  /**
   * Best guess at a starting display name from whatever the provider gave us.
   * Discord sends global_name/user_name, Google sends full_name/name.
   */
  function derivedName(user) {
    const m = (user && user.user_metadata) || {};
    const candidates = [
      m.display_name, m.global_name, m.full_name, m.name,
      m.user_name, m.preferred_username, m.nickname,
      (user && user.email ? user.email.split('@')[0] : ''),
    ];
    for (const c of candidates) {
      const clean = sanitizeName(c);
      if (clean) return clean;
    }
    return 'PILOT';
  }

  async function loadProfile() {
    if (!session || !session.user) return null;
    const tok = await token();
    if (!tok) return null;

    const { ok, data } = await api(
      `/rest/v1/${PROFILE_TABLE}?select=id,display_name,created_at&id=eq.${session.user.id}`,
      { useSession: true }
    );

    if (ok && Array.isArray(data) && data.length) {
      profile = data[0];
      return profile;
    }

    // No row yet — the DB trigger may not be installed. Create one ourselves,
    // suffixing on collision the same way the trigger would.
    if (ok) return createProfile();
    return null;
  }

  async function createProfile() {
    const base = derivedName(session.user);
    for (let attempt = 0; attempt < 6; attempt++) {
      const suffix    = attempt === 0 ? '' : String(attempt + 1);
      const candidate = base.slice(0, NAME_MAX_LENGTH - suffix.length) + suffix;
      const { ok, data, error } = await api(`/rest/v1/${PROFILE_TABLE}`, {
        method:  'POST',
        headers: { 'Prefer': 'return=representation' },
        body:    { id: session.user.id, display_name: candidate },
        useSession: true,
      });
      if (ok && Array.isArray(data) && data.length) { profile = data[0]; return profile; }
      if (!/taken|duplicate/i.test(error || '')) break;
    }
    // Fall back to a client-only name so the UI still has something to show.
    profile = { id: session.user.id, display_name: base };
    return profile;
  }

  // ─── Public state shape ────────────────────────────────────────────────────

  function publicState() {
    return {
      loggedIn:    !!session,
      userId:      session && session.user ? session.user.id : null,
      email:       session && session.user ? session.user.email : null,
      provider:    session && session.user ? providerOf(session.user) : null,
      displayName: displayName(),
      isGuest:     !session,
    };
  }

  function providerOf(user) {
    const app = user.app_metadata || {};
    return app.provider || (app.providers && app.providers[0]) || 'email';
  }

  /** The name to show and to write on the leaderboard. Never empty. */
  function displayName() {
    if (session && profile && profile.display_name) return profile.display_name;
    if (session && session.user) return derivedName(session.user);
    return guestName();
  }

  // ─── Guest name ────────────────────────────────────────────────────────────

  function guestName() {
    try { return sanitizeName(localStorage.getItem(GUEST_KEY) || ''); }
    catch (_) { return ''; }
  }

  function setGuestName(raw) {
    const clean = sanitizeName(raw);
    try {
      if (clean) localStorage.setItem(GUEST_KEY, clean);
      else       localStorage.removeItem(GUEST_KEY);
    } catch (_) {}
    if (!session) notify();
    return clean;
  }

  // ─── Public actions ────────────────────────────────────────────────────────

  /**
   * Create an account. Depending on the project's email-confirmation setting
   * this either signs the player straight in or asks them to check their inbox.
   * Resolves to { ok, needsConfirmation, error }.
   */
  async function signUp(email, password, wantedName) {
    const clean = sanitizeName(wantedName);
    const { ok, data, error } = await api('/auth/v1/signup', {
      method: 'POST',
      body: {
        email:    (email || '').trim(),
        password: password || '',
        data:     clean ? { display_name: clean } : {},
        gotrue_meta_security: {},
        options:  { emailRedirectTo: redirectTarget() },
      },
    });

    if (!ok) return { ok: false, error };

    if (data && data.access_token) {
      adoptSession(data);
      await loadProfile();
      // The trigger derives a name from metadata, but honour an explicit one.
      if (clean && profile && profile.display_name !== clean) await setDisplayName(clean);
      notify();
      return { ok: true, needsConfirmation: false };
    }

    return { ok: true, needsConfirmation: true };
  }

  async function signIn(email, password) {
    const { ok, data, error } = await api('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body:   { email: (email || '').trim(), password: password || '' },
    });
    if (!ok || !adoptSession(data)) return { ok: false, error: error || 'Sign in failed.' };
    await loadProfile();
    notify();
    return { ok: true };
  }

  /** Hands the browser off to the provider. Does not return. */
  async function signInWithOAuth(provider) {
    try {
      const params = new URLSearchParams({
        provider,
        redirect_to: redirectTarget(),
      });

      if (canUsePkce()) {
        const verifier  = randomVerifier();
        const challenge = await challengeFor(verifier);
        try { localStorage.setItem(VERIFIER_KEY, verifier); } catch (_) {}
        params.set('code_challenge', challenge);
        params.set('code_challenge_method', 's256');
      } else {
        // Without a challenge GoTrue uses the implicit flow and returns the
        // session in the URL hash, which consumeRedirect() also handles.
        // Clear any stale verifier so the callback doesn't try to exchange
        // a code it has no matching secret for.
        try { localStorage.removeItem(VERIFIER_KEY); } catch (_) {}
        console.warn(
          '[Auth] SubtleCrypto is unavailable, so this sign-in uses the implicit ' +
          'OAuth flow instead of PKCE. Browsers only expose SubtleCrypto on a ' +
          'secure origin — serve the game over https, localhost or 127.0.0.1 to ' +
          'get PKCE. Current origin: ' + window.location.origin
        );
      }

      window.location.assign(`${URL}/auth/v1/authorize?${params}`);
      return { ok: true };
    } catch (e) {
      console.warn('[Auth] OAuth start failed:', e);
      return { ok: false, error: 'Could not start sign-in. Try email instead.' };
    }
  }

  async function signOut() {
    const tok = session && session.access_token;
    clearSession();
    notify();
    if (tok) {
      // Fire and forget — the local session is already gone either way.
      fetch(URL + '/auth/v1/logout', {
        method:  'POST',
        headers: { ...baseHeaders(), 'Authorization': 'Bearer ' + tok },
      }).catch(() => {});
    }
    return { ok: true };
  }

  async function setDisplayName(raw) {
    const clean = sanitizeName(raw);
    if (!clean) return { ok: false, error: 'Pick a name with at least one letter or number.' };

    if (!session) { setGuestName(clean); return { ok: true, name: clean }; }

    const tok = await token();
    if (!tok) return { ok: false, error: 'Your session expired. Sign in again.' };

    const { ok, data, error } = await api(
      `/rest/v1/${PROFILE_TABLE}?id=eq.${session.user.id}`,
      {
        method:  'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body:    { display_name: clean },
        useSession: true,
      }
    );

    if (!ok) return { ok: false, error };
    profile = (Array.isArray(data) && data[0]) || { ...profile, display_name: clean };
    notify();
    return { ok: true, name: profile.display_name };
  }

  async function sendPasswordReset(email) {
    const { ok, error } = await api('/auth/v1/recover', {
      method: 'POST',
      body:   { email: (email || '').trim(), gotrue_meta_security: {} },
    });
    return ok ? { ok: true } : { ok: false, error };
  }

  function onChange(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────

  /** Result of an OAuth round-trip, so the UI can surface a failure once. */
  let redirectResult = null;

  (async function init() {
    // 1. An OAuth return beats anything already stored.
    redirectResult = await consumeRedirect();

    // 2. Otherwise restore what we had, refreshing if it has gone stale.
    if (!session) {
      const stored = readPersisted();
      if (stored && stored.access_token) {
        session = stored;
        if (Date.now() > session.expires_at - REFRESH_MARGIN_MS) await refreshSession();
        else scheduleRefresh();
      }
    }

    // 3. Fill in the profile so the first paint already knows the pilot's name.
    if (session) {
      // Ask GoTrue who this token belongs to — restores user data across reloads.
      if (!session.user) {
        const { ok, data } = await api('/auth/v1/user', { useSession: true });
        if (ok && data && data.id) { session.user = data; persist(); }
        else { clearSession(); }
      }
      if (session) await loadProfile();
    }

    notify();
    _resolveReady(publicState());
  })();

  // Another tab signed in or out — mirror it here.
  window.addEventListener('storage', async e => {
    if (e.key !== SESSION_KEY) return;
    const stored = readPersisted();
    if (stored && stored.access_token) {
      session = stored;
      await loadProfile();
    } else {
      clearSession();
    }
    notify();
  });

  return {
    ready,
    get redirectError() { return redirectResult && !redirectResult.ok ? redirectResult.error : null; },
    isLoggedIn: () => !!session,
    state:      publicState,
    user:       () => (session ? session.user : null),
    profile:    () => profile,
    displayName,
    guestName,
    setGuestName,
    sanitizeName,
    token,
    signUp,
    signIn,
    signInWithOAuth,
    signOut,
    setDisplayName,
    sendPasswordReset,
    onChange,
  };
})();