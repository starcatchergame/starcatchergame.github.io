'use strict';

/**
 * Star Catcher v3.1 — Account UI
 *
 * Owns three surfaces:
 *   1. The pilot chip on the title screen (identity at a glance, one click in)
 *   2. The PILOT ID screen (sign in, create account, rename, sign out)
 *   3. The account row inside Settings, so pause and game-over reach it too
 *
 * All screen transitions are delegated back to game.js through hooks, because
 * game.js is the one that knows about music, the title background and the
 * star cursor.
 */
const AccountUI = (() => {

  const { PROVIDERS, NAME_MAX_LENGTH, MIN_PASSWORD } = CONFIG.ACCOUNT;

  let hooks = {
    enterScreen: () => {},   // (from) — hide whatever screen we came from
    exitScreen:  () => {},   // (from) — put it back
    onIdentity:  () => {},   // (state) — identity changed; refresh dependents
    blip:        () => {},   // (hz, type, dur, vol)
  };

  let openedFrom = null;
  let mode       = 'signin';   // 'signin' | 'signup'
  let busy       = false;

  const D = {};

  function grab() {
    const ids = [
      'account-screen', 'account-signed-out', 'account-signed-in', 'oauth-row',
      'account-tabs', 'account-form', 'account-email', 'account-password',
      'account-name-field', 'account-newname', 'account-submit', 'account-forgot',
      'account-avatar', 'account-name-display', 'account-email-display',
      'account-provider-tag', 'account-rename', 'account-rename-btn',
      'account-signout-btn', 'account-msg', 'account-back-btn',
      'pilot-chip', 'pilot-chip-badge', 'pilot-chip-name',
      'settings-account-line', 'settings-account-action', 'settings-guest-row',
      'settings-guest-name',
    ];
    ids.forEach(id => { D[_camel(id)] = document.getElementById(id); });
    D.accountTabButtons = document.querySelectorAll('.account-tab');
  }

  function _camel(id) {
    return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  // ─── Messages ──────────────────────────────────────────────────────────────

  function msg(text, kind = 'info') {
    D.accountMsg.textContent = text || '';
    D.accountMsg.className   = 'account-msg' + (text ? ' is-' + kind : '');
  }

  function setBusy(on, label) {
    busy = on;
    [D.accountSubmit, D.accountRenameBtn, D.accountSignoutBtn, D.accountForgot]
      .forEach(b => { if (b) b.disabled = on; });
    D.oauthRow.querySelectorAll('button').forEach(b => { b.disabled = on; });
    if (label !== undefined) D.accountSubmit.textContent = label;
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  function providerLabel(p) {
    if (p === 'email') return 'Email';
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Email';
  }

  /** Repaint every surface that shows who the player is. */
  function render() {
    const s = Auth.state();

    // ── Title-screen chip ──
    if (s.loggedIn) {
      D.pilotChip.classList.add('is-signed-in');
      D.pilotChipBadge.textContent = (s.displayName || 'P').charAt(0);
      D.pilotChipName.textContent  = s.displayName;
      D.pilotChip.title = 'Signed in as ' + s.displayName;
    } else if (s.displayName) {
      D.pilotChip.classList.remove('is-signed-in');
      D.pilotChipBadge.textContent = '·';
      D.pilotChipName.textContent  = s.displayName;
      D.pilotChip.title = 'Playing as a guest — click to sign in';
    } else {
      D.pilotChip.classList.remove('is-signed-in');
      D.pilotChipBadge.textContent = '+';
      D.pilotChipName.textContent  = 'SIGN IN';
      D.pilotChip.title = 'Sign in, or keep playing as a guest';
    }

    // ── Account screen ──
    D.accountSignedIn.style.display  = s.loggedIn ? 'block' : 'none';
    D.accountSignedOut.style.display = s.loggedIn ? 'none'  : 'block';

    if (s.loggedIn) {
      D.accountAvatar.textContent       = (s.displayName || 'P').charAt(0);
      D.accountNameDisplay.textContent  = s.displayName;
      D.accountEmailDisplay.textContent = s.email || '';
      D.accountProviderTag.textContent  = 'via ' + providerLabel(s.provider);
      D.accountRename.value             = s.displayName;
    }

    // ── Settings row ──
    if (D.settingsAccountLine) {
      if (s.loggedIn) {
        D.settingsAccountLine.innerHTML =
          `Signed in as <b>${_esc(s.displayName)}</b>`;
        D.settingsAccountAction.textContent = 'Manage';
        D.settingsGuestRow.style.display    = 'none';
      } else {
        D.settingsAccountLine.textContent =
          s.displayName ? 'Playing as a guest' : 'Not signed in';
        D.settingsAccountAction.textContent = 'Sign in';
        D.settingsGuestRow.style.display    = 'flex';
        if (document.activeElement !== D.settingsGuestName) {
          D.settingsGuestName.value = Auth.guestName();
        }
      }
    }
  }

  function _esc(str) {
    return String(str).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ─── Mode switching (sign in vs create account) ────────────────────────────

  function setMode(next) {
    mode = next;
    D.accountTabButtons.forEach(t => t.classList.toggle('active', t.dataset.mode === next));
    D.accountNameField.style.display = next === 'signup' ? 'flex' : 'none';
    D.accountSubmit.textContent      = next === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN';
    D.accountPassword.autocomplete   = next === 'signup' ? 'new-password' : 'current-password';
    D.accountForgot.style.display    = next === 'signup' ? 'none' : 'inline';
    msg('');
  }

  // ─── Screen open / close ───────────────────────────────────────────────────

  function open(from) {
    openedFrom = from;
    msg('');
    setMode('signin');
    D.accountPassword.value = '';
    render();
    hooks.enterScreen(from);
    D.accountScreen.style.display = 'flex';

    // Only autofocus on desktop — a mobile keyboard popping up on open is rude.
    if (!Auth.isLoggedIn() && window.matchMedia('(min-width: 780px)').matches) {
      setTimeout(() => D.accountEmail.focus(), 60);
    }
  }

  function close() {
    D.accountScreen.style.display = 'none';
    const from = openedFrom;
    openedFrom = null;
    hooks.exitScreen(from);
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  async function submitForm(e) {
    if (e) e.preventDefault();
    if (busy) return;

    const email = D.accountEmail.value.trim();
    const pw    = D.accountPassword.value;

    if (!email)          return msg('Enter your email address.', 'error');
    if (!pw)             return msg('Enter your password.', 'error');
    if (mode === 'signup' && pw.length < MIN_PASSWORD)
      return msg(`Passwords need at least ${MIN_PASSWORD} characters.`, 'error');

    setBusy(true, mode === 'signup' ? 'CREATING…' : 'SIGNING IN…');
    msg('');

    const res = mode === 'signup'
      ? await Auth.signUp(email, pw, D.accountNewname.value)
      : await Auth.signIn(email, pw);

    setBusy(false);
    setMode(mode);   // resets the button label

    if (!res.ok) return msg(res.error, 'error');

    if (res.needsConfirmation) {
      msg('Account created. Open the confirmation link in your email, then sign in.', 'ok');
      setMode('signin');
      D.accountPassword.value = '';
      return;
    }

    hooks.blip(880, 'sine', 0.35, 0.14);
    msg('');
    close();
  }

  async function startOAuth(provider) {
    if (busy) return;
    setBusy(true);
    msg('Opening ' + providerLabel(provider) + '…');
    const res = await Auth.signInWithOAuth(provider);
    if (!res.ok) { setBusy(false); msg(res.error, 'error'); }
    // On success the browser navigates away; nothing left to do here.
  }

  async function rename() {
    if (busy) return;
    const wanted = D.accountRename.value;
    if (!Auth.sanitizeName(wanted)) return msg('Names need at least one letter or number.', 'error');
    if (Auth.sanitizeName(wanted) === Auth.displayName()) return msg('That is already your name.', 'info');

    setBusy(true);
    const res = await Auth.setDisplayName(wanted);
    setBusy(false);

    if (!res.ok) return msg(res.error, 'error');
    hooks.blip(740, 'sine', 0.25, 0.12);
    msg('Name saved. The board updates on your next visit.', 'ok');
    render();
  }

  async function doSignOut() {
    if (busy) return;
    setBusy(true);
    await Auth.signOut();
    setBusy(false);
    setMode('signin');
    msg('Signed out. You can keep playing as a guest.', 'info');
    render();
  }

  async function forgotPassword() {
    if (busy) return;
    const email = D.accountEmail.value.trim();
    if (!email) return msg('Type your email above first, then tap this again.', 'error');
    setBusy(true);
    const res = await Auth.sendPasswordReset(email);
    setBusy(false);
    msg(res.ok
      ? 'If that email has an account, a reset link is on its way.'
      : res.error, res.ok ? 'ok' : 'error');
  }

  // ─── Wiring ────────────────────────────────────────────────────────────────

  function buildProviderButtons() {
    D.oauthRow.innerHTML = PROVIDERS.map(p => `
      <button type="button" class="oauth-btn" data-provider="${p.id}"
              style="--oauth-accent:${p.color};">
        <span class="oauth-mark">◈</span>Continue with ${p.label}
      </button>`).join('');

    D.oauthRow.querySelectorAll('.oauth-btn').forEach(btn => {
      btn.addEventListener('click', () => startOAuth(btn.dataset.provider));
    });
  }

  function init(userHooks) {
    hooks = { ...hooks, ...(userHooks || {}) };
    grab();
    buildProviderButtons();

    // Chip
    D.pilotChip.addEventListener('click', () => open('start'));
    D.pilotChip.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open('start'); }
    });

    // Tabs
    D.accountTabButtons.forEach(tab => {
      tab.addEventListener('click', () => setMode(tab.dataset.mode));
    });

    // Forms
    D.accountForm.addEventListener('submit', submitForm);
    D.accountForgot.addEventListener('click', forgotPassword);
    D.accountRenameBtn.addEventListener('click', rename);
    D.accountRename.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); rename(); }
    });
    D.accountSignoutBtn.addEventListener('click', doSignOut);
    D.accountBackBtn.addEventListener('click', close);

    // Settings row
    if (D.settingsAccountAction) {
      D.settingsAccountAction.addEventListener('click', () => open('settings'));
    }
    if (D.settingsGuestName) {
      D.settingsGuestName.addEventListener('input', () => {
        Auth.setGuestName(D.settingsGuestName.value);
      });
      D.settingsGuestName.addEventListener('blur', () => {
        D.settingsGuestName.value = Auth.guestName();
      });
    }

    // Esc closes the screen
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && D.accountScreen.style.display === 'flex') close();
    });

    // Identity changes repaint everything and tell game.js
    Auth.onChange(state => { render(); hooks.onIdentity(state); });

    render();

    // Surface a failed OAuth round-trip once the screen is available.
    Auth.ready.then(() => {
      render();
      if (Auth.redirectError) {
        open('start');
        msg(Auth.redirectError, 'error');
      }
    });
  }

  return { init, open, close, render, isOpen: () => D.accountScreen && D.accountScreen.style.display === 'flex' };
})();
