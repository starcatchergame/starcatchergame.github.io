'use strict';

/**
 * Star Catcher v3.5 — Platform / Input Mode
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Until v3.5 the game asked exactly one question about the machine it was
 * running on — "is there a fine pointer?" — and refused to run if the answer
 * was no. That question was buried inside viewport.js, which meant the gate
 * owned it and nothing else could see it.
 *
 * Three separate systems now need to know how the player is driving:
 *
 *   viewport.js   — which gate floor to apply, and whether "rotate the phone"
 *                   is a sensible thing to say
 *   game.js       — mousemove-follow vs finger-drag, star cursor on or off
 *   leaderboard.js— which board a run belongs on
 *
 * So the answer lives here, once, and everyone reads it from the same place.
 *
 * ── MODE IS NOT THE SAME AS DEVICE ────────────────────────────────────────
 *
 * There are two different things a caller might mean by "mobile", and
 * conflating them is how hybrid machines end up on the wrong board:
 *
 *   isTouchDevice()  — CAN this thing be driven by a finger?  A touchscreen
 *                      laptop says yes. So does a tablet with a mouse.
 *   mode()           — how is it ACTUALLY being driven right now?
 *
 * `mode()` is what the leaderboard keys on, because the board is a claim
 * about the control scheme a score was set with, not about the hardware it
 * was set on. A Surface with a mouse plugged in posts to the pointer board;
 * unplug the mouse and drag the paddle with a thumb and the next run posts
 * to the touch board. The device never changed. The way it was played did.
 *
 * ── HOW MODE IS DECIDED ───────────────────────────────────────────────────
 *
 * Start from the media queries, then let observed reality override them:
 *
 *   1. A forced override (dev tools, ?input= query param) wins outright.
 *   2. No fine pointer anywhere  →  touch. This is a phone.
 *   3. Fine pointer available    →  pointer, UNLESS the player has actually
 *                                   dragged the paddle with a finger, in
 *                                   which case we believe the finger.
 *
 * Rule 3 is why `observeTouchDrag()` exists. It is deliberately only called
 * from the paddle drag handler and not from every stray tap: tapping a
 * button on a touchscreen laptop is not playing the game with a finger, and
 * should not move that machine onto the touch board.
 *
 * Mode is FROZEN while a run is live (see `lock()`), so a run that starts on
 * one board cannot finish on the other.
 */
const Platform = (() => {

  const STORAGE_KEY = 'starcatcher_input_mode';

  let _forced    = null;   // 'touch' | 'pointer' | null
  let _observed  = null;   // 'touch' once a finger has driven the paddle
  let _locked    = null;   // mode frozen for the duration of a run
  let _lastMode  = null;   // for change detection

  const watchers = [];

  // ─── Media query helpers ──────────────────────────────────────────────────

  /**
   * `matchMedia` returns a MediaQueryList with `media === 'not all'` when the
   * browser does not understand the query at all, which is a different answer
   * from "understood it, and it's false". Everything below distinguishes the
   * two rather than treating an unsupported query as a negative.
   */
  function _mq(query, whenUnsupported) {
    if (!window.matchMedia) return whenUnsupported;
    const m = window.matchMedia(query);
    return m.media === 'not all' ? whenUnsupported : m.matches;
  }

  /**
   * `any-pointer` rather than `pointer` on purpose — a tablet with a mouse
   * plugged in reports a coarse PRIMARY pointer but a fine one is available,
   * and that machine can play the desktop game.
   *
   * Unsupported → true. An ancient browser that has never heard of pointer
   * media queries is a desktop browser.
   */
  function hasFinePointer()   { return _mq('(any-pointer: fine)',   true);  }
  function hasCoarsePointer() { return _mq('(any-pointer: coarse)', false); }
  function hasHover()         { return _mq('(any-hover: hover)',    true);  }

  /** Touch points is the one signal that isn't a media query, so it's a useful cross-check. */
  function touchPoints() {
    return navigator.maxTouchPoints || navigator.msMaxTouchPoints || 0;
  }

  /** CAN this be driven by a finger? Says nothing about whether it IS being. */
  function isTouchDevice() {
    return touchPoints() > 0 || hasCoarsePointer() || 'ontouchstart' in window;
  }

  /**
   * Both a finger and a mouse. These are the machines that make a
   * device-based board split dishonest, and the reason `mode()` tracks
   * behaviour instead.
   */
  function isHybrid() {
    return isTouchDevice() && hasFinePointer();
  }

  /**
   * Nothing that can drive a paddle at all — no fine pointer, no touch.
   * A TV browser driven by a D-pad, essentially. Rare, but it is the one
   * case that still deserves the old "this device cannot play" refusal.
   */
  function hasNoUsableInput() {
    return !hasFinePointer() && !isTouchDevice();
  }

  // ─── Mode ─────────────────────────────────────────────────────────────────

  /** 'touch' | 'pointer' — how the game should be driven right now. */
  function mode() {
    if (_locked)  return _locked;
    if (_forced)  return _forced;
    if (!hasFinePointer()) return 'touch';
    return _observed || 'pointer';
  }

  function isTouchMode()   { return mode() === 'touch'; }
  function isPointerMode() { return mode() === 'pointer'; }

  /**
   * Called by the paddle drag handler the first time a finger actually moves
   * the paddle. On a phone this changes nothing (mode was already 'touch');
   * on a hybrid it is the moment we stop guessing from hardware and start
   * believing observed behaviour.
   */
  function observeTouchDrag() {
    if (_observed === 'touch') return;
    _observed = 'touch';
    _notify();
  }

  /**
   * The mirror image: a mousemove that actually drove the paddle. Without
   * this, a single accidental thumb-drag would strand a hybrid on the touch
   * board for the rest of the session.
   */
  function observePointerMove() {
    if (_observed === null) return;
    _observed = null;
    _notify();
  }

  /**
   * Freeze the mode for the duration of a run. A run must post to the board
   * matching the controls it was actually played with, and a mid-run flip —
   * bumping the trackpad on a convertible, say — must not be able to move it.
   */
  function lock()   { _locked = mode(); return _locked; }
  function unlock() { _locked = null; _notify(); }
  function isLocked() { return _locked !== null; }

  // ─── Orientation ──────────────────────────────────────────────────────────

  /**
   * Measured rather than read from `screen.orientation`, because the thing
   * that actually matters is the shape of the box we have to draw into, and
   * on mobile that is also affected by the address bar and the on-screen
   * keyboard. `screen.orientation` would happily report landscape while the
   * usable area is a letterbox slot above a keyboard.
   */
  function isPortrait() {
    const el = document.documentElement;
    return el.clientHeight > el.clientWidth;
  }

  // ─── Overrides ────────────────────────────────────────────────────────────

  /**
   * Force a mode. `null` clears it. Persisted, so a forced mode survives the
   * reload that testing a mobile layout usually involves.
   *
   * This is a testing affordance, not a player-facing setting: a desktop
   * player who forces touch mode gets a paddle they cannot drag with a mouse,
   * and their scores land on the touch board where they don't belong. The dev
   * console taints a run that used it, same as any other override.
   */
  function force(next) {
    _forced = (next === 'touch' || next === 'pointer') ? next : null;
    try {
      if (_forced) localStorage.setItem(STORAGE_KEY, _forced);
      else         localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* private browsing — the override just won't persist */ }
    _notify();
    return mode();
  }

  function forcedMode() { return _forced; }

  function _restoreForced() {
    // A query param beats stored state, so a link can demo either mode
    // without leaving the tester's browser stuck in it afterwards.
    try {
      const q = new URLSearchParams(window.location.search).get('input');
      if (q === 'touch' || q === 'pointer') { _forced = q; return; }
    } catch (e) { /* no URLSearchParams — ignore */ }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'touch' || stored === 'pointer') _forced = stored;
    } catch (e) { /* no localStorage — ignore */ }
  }

  // ─── Change notification ──────────────────────────────────────────────────

  function _notify() {
    const next = mode();
    if (next === _lastMode) return;
    _lastMode = next;
    _applyBodyClass();
    for (const fn of watchers) {
      try { fn(next); } catch (err) { console.error('[Platform] watcher failed', err); }
    }
  }

  function onModeChange(fn) { if (typeof fn === 'function') watchers.push(fn); }

  /** CSS needs to know too — hover effects and the hidden cursor both depend on it. */
  function _applyBodyClass() {
    const b = document.body;
    if (!b) return;
    b.classList.toggle('touch-mode',   isTouchMode());
    b.classList.toggle('pointer-mode', isPointerMode());
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    _restoreForced();
    _lastMode = mode();
    _applyBodyClass();

    // A mouse being plugged into or unplugged from a tablet. Not all browsers
    // fire this, which is exactly why observed behaviour is also tracked.
    if (window.matchMedia) {
      const mq = window.matchMedia('(any-pointer: fine)');
      if (mq.addEventListener) mq.addEventListener('change', _notify);
    }
    return api;
  }

  /** One-line summary for the dev console and bug reports. */
  function describe() {
    return {
      mode:        mode(),
      forced:      _forced,
      observed:    _observed,
      locked:      _locked,
      finePointer: hasFinePointer(),
      coarse:      hasCoarsePointer(),
      hover:       hasHover(),
      touchPoints: touchPoints(),
      hybrid:      isHybrid(),
      portrait:    isPortrait(),
    };
  }

  const api = {
    init, describe,
    mode, isTouchMode, isPointerMode,
    isTouchDevice, isHybrid, hasNoUsableInput,
    hasFinePointer, hasCoarsePointer, hasHover, touchPoints,
    isPortrait,
    observeTouchDrag, observePointerMove,
    lock, unlock, isLocked,
    force, forcedMode,
    onModeChange,
  };

  return api;
})();

// Must be settled before viewport.js runs its first fit, since the gate floor
// depends on the mode. Both scripts sit at the end of <body>, so the body
// element exists and the class can be written immediately.
Platform.init();
