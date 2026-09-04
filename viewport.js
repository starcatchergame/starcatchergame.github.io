'use strict';

/**
 * Star Catcher v3.4 — Fixed Logical Viewport + Playability Gate
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Every screen used to be `width: 100%; height: 700px`, so the playfield was
 * as many CSS pixels wide as the browser said it was. The paddle, though,
 * was a fixed 110 CSS px. So the paddle's SHARE of the playfield — the thing
 * that actually decides how hard the game is — changed with the window:
 *
 *     1520px wide  →  paddle covers  7.2%  of the field
 *      760px wide  →  paddle covers 14.5%  of the field
 *
 * The game is now authored at ONE fixed logical size (CONFIG.GAME.WIDTH x
 * CONFIG.GAME.HEIGHT) and scaled to fit. Every coordinate inside the game
 * stays in logical pixels; only the display size changes.
 *
 * ── WHY THE FIT IS COMPUTED IN DEVICE PIXELS ──────────────────────────────
 *
 * This is the subtle part, and it is the reason the scale ceiling is off.
 *
 * Browser zoom changes how many CSS pixels fit on screen AND changes
 * devicePixelRatio by the same factor, in opposite directions. So if the
 * game simply fills the window, zoom cancels out completely — the picture
 * ends up the same physical size on the desk either way:
 *
 *     100% zoom:  1536 CSS px avail  →  scale 1.00  →  1536 physical px
 *      50% zoom:  3072 CSS px avail  →  scale 2.00  →  1536 physical px
 *     200% zoom:   768 CSS px avail  →  scale 0.50  →  1536 physical px
 *
 * That cancellation is the whole defence, and ANY clamp applied to the CSS
 * scale breaks it. Cap the scale at 1.35 and the 50% case renders at 1037
 * physical px instead of 1536 — smaller picture, shorter mouse sweep, zoom
 * is an exploit again. A ceiling and zoom-invariance are mutually exclusive,
 * which is why CONFIG.GAME.MAX_DEVICE_SCALE ships effectively disabled.
 *
 * So the fit is computed in DEVICE pixels (CSS px x devicePixelRatio), which
 * zoom does not change, and converted back to a CSS scale only at the last
 * moment when writing the transform. Everything the gate below decides is
 * therefore zoom-proof.
 *
 * ── WHAT THIS CANNOT DO ───────────────────────────────────────────────────
 *
 * Normalise PHYSICAL size. Browsers cannot report display DPI: a 4K 27" and
 * a 4K 32" panel look identical to this code, as do a 1440p 14" laptop and a
 * 1440p 27" monitor. So a bigger monitor means a bigger playfield means a
 * longer physical mouse sweep, and there is no honest way to detect it. That
 * residual sits in the same bucket as the player's mouse DPI and pointer
 * acceleration — real, uncontrollable, and true of every mouse game on the
 * web. The gate bounds it from below; nothing bounds it from above.
 *
 * ── HOOK FOR LATER ────────────────────────────────────────────────────────
 *
 * Because the playfield is an explicit number rather than an accident, a
 * difficulty setting is just a different CONFIG.GAME.WIDTH. Call
 * Viewport.setLogicalWidth(1100) for a NARROW / harder field, or 1900 for a
 * WIDE / easier one. Deliberately not wired to any UI yet.
 */
const Viewport = (() => {

  let el       = null;   // the element we scale
  let gate     = null;   // the blocking overlay
  let scale    = 1;      // CSS display px per logical px
  let offX     = 0;      // screen-space left edge of the scaled box
  let offY     = 0;      // screen-space top edge
  let blocked  = false;  // is the game currently refusing to run?
  let reason   = null;   // 'small' | 'pointer' | null

  const watchers      = [];   // fired after every recompute
  const blockWatchers = [];   // fired only when the blocked state flips

  /** Logical playfield size. Nothing inside the game reads anything else. */
  function width()  { return CONFIG.GAME.WIDTH;  }
  function height() { return CONFIG.GAME.HEIGHT; }

  function dpr() { return window.devicePixelRatio || 1; }

  /**
   * Multiply canvas dimensions by this so the backing store matches the
   * pixels actually on screen.
   */
  function pixelRatio() {
    return Math.min(scale * dpr(), CONFIG.GAME.MAX_CANVAS_RATIO);
  }

  /**
   * Does this machine have a mouse, trackpad or stylus — something that can
   * hover and move continuously? The paddle follows pointer movement, so a
   * touch-only device cannot play the game as it currently exists: there is
   * no mousemove to follow, and a tap-to-teleport paddle would be a
   * different game with a different difficulty curve.
   *
   * `any-pointer: fine` rather than `pointer: fine` on purpose — a tablet
   * with a mouse plugged in reports a coarse PRIMARY pointer but a fine one
   * is available, and that machine can play.
   */
  function hasFinePointer() {
    if (!window.matchMedia) return true;   // ancient browser; assume desktop
    const mq = window.matchMedia('(any-pointer: fine)');
    return mq.media === 'not all' ? true : mq.matches;   // query unsupported
  }

  /** Recompute the fit, write the transform, and run the gate. */
  function apply() {
    if (!el) return;

    const ratio  = dpr();
    const availW = document.documentElement.clientWidth;
    const availH = document.documentElement.clientHeight;
    const G      = CONFIG.GAME;

    // Fit in DEVICE pixels — the zoom-invariant measure. See the header.
    const deviceFit = Math.min(
      (availW * ratio) / width(),
      (availH * ratio) / height()
    );

    // ── The gate ──────────────────────────────────────────────────────────
    // Refuse rather than shrink. Below the floor the game is still perfectly
    // fair in logical terms, but the picture gets small enough that crossing
    // the field is a flick of the wrist instead of a sweep, and that is its
    // own kind of easy mode. A refusal is honest; a silent clamp would
    // quietly hand those players a shorter game.
    let nextReason = null;
    if (!hasFinePointer())                   nextReason = 'pointer';
    else if (deviceFit < G.MIN_DEVICE_SCALE) nextReason = 'small';

    const wasBlocked = blocked;
    blocked = nextReason !== null;
    reason  = nextReason;

    // Clamp for display only. When blocked we still lay the game out at the
    // floor so the overlay has something coherent behind it; when not
    // blocked the ceiling is off by default and the upper clamp is a no-op.
    const shown = Math.min(Math.max(deviceFit, G.MIN_DEVICE_SCALE), G.MAX_DEVICE_SCALE);
    scale = shown / ratio;

    offX = Math.round((availW - width()  * scale) / 2);
    offY = Math.round((availH - height() * scale) / 2);

    el.style.width     = width()  + 'px';
    el.style.height    = height() + 'px';
    el.style.transform = 'translate(' + offX + 'px, ' + offY + 'px) scale(' + scale + ')';

    renderGate(availW, availH, ratio);

    for (const fn of watchers) {
      try { fn(scale); } catch (err) { console.error('[Viewport] watcher failed', err); }
    }
    if (blocked !== wasBlocked) {
      for (const fn of blockWatchers) {
        try { fn(blocked, reason); }
        catch (err) { console.error('[Viewport] block watcher failed', err); }
      }
    }
  }

  // ─── THE GATE OVERLAY ─────────────────────────────────────────────────────

  /**
   * Lives outside #app-scaler and is never scaled — the one thing on the page
   * that has to stay legible precisely when the playfield doesn't fit.
   */
  function renderGate(availW, availH, ratio) {
    if (!gate) return;

    if (!blocked) {
      gate.style.display = 'none';
      gate.setAttribute('aria-hidden', 'true');
      gate.innerHTML = '';
      return;
    }

    gate.style.display = 'flex';
    gate.setAttribute('aria-hidden', 'false');

    if (reason === 'pointer') {
      gate.innerHTML =
        '<div class="gate-panel">' +
          '<h2 class="gate-title">MOUSE REQUIRED</h2>' +
          '<p class="gate-body">The paddle follows a pointer, and this device ' +
            'has none to follow. Star Catcher needs a mouse, trackpad or ' +
            'stylus for now.</p>' +
          '<p class="gate-body gate-dim">Touch controls are on the list.</p>' +
        '</div>';
      return;
    }

    // reason === 'small' — report the shortfall in the player's own CSS
    // pixels, since that is the number that matches what they can see.
    const needW = Math.ceil(width()  * CONFIG.GAME.MIN_DEVICE_SCALE / ratio);
    const needH = Math.ceil(height() * CONFIG.GAME.MIN_DEVICE_SCALE / ratio);
    const tooNarrow = availW < needW;
    const tooShort  = availH < needH;
    const fix = (tooNarrow && tooShort) ? 'bigger' : tooNarrow ? 'wider' : 'taller';

    gate.innerHTML =
      '<div class="gate-panel">' +
        '<h2 class="gate-title">WINDOW TOO SMALL</h2>' +
        '<p class="gate-body">Star Catcher runs on a fixed ' + width() + ' \u00d7 ' +
          height() + ' playfield so every pilot gets the same game. This ' +
          'window is too small to show it honestly.</p>' +
        '<div class="gate-metrics">' +
          '<div class="gate-metric"><span>YOU HAVE</span><b>' +
            Math.round(availW) + ' \u00d7 ' + Math.round(availH) + '</b></div>' +
          '<div class="gate-metric"><span>YOU NEED</span><b>' +
            needW + ' \u00d7 ' + needH + '</b></div>' +
        '</div>' +
        '<p class="gate-body gate-dim">Make the window ' + fix +
          ', or zoom out with Ctrl and \u2212 (\u2318 and \u2212 on a Mac). ' +
          'The game picks up the moment it fits.</p>' +
      '</div>';
  }

  // ─── API ──────────────────────────────────────────────────────────────────

  /** Convert a screen-space clientX/clientY pair into logical coordinates. */
  function toLogical(clientX, clientY) {
    return { x: (clientX - offX) / scale, y: (clientY - offY) / scale };
  }

  /**
   * Change the logical playfield width at runtime and re-fit. This is the
   * seam a NARROW / STANDARD / WIDE difficulty setting plugs into. Callers
   * are responsible for not doing it mid-run.
   */
  function setLogicalWidth(px) {
    CONFIG.GAME.WIDTH = Math.max(600, Math.round(px));
    apply();
    return CONFIG.GAME.WIDTH;
  }

  function init(element) {
    el   = element || document.getElementById('app-scaler');
    gate = document.getElementById('viewport-gate');
    apply();

    window.addEventListener('resize', apply);

    if (window.matchMedia) {
      // Zoom fires `resize`, but OS display-scaling changes and some zoom
      // steps only move devicePixelRatio, so watch that directly too.
      let mq = null;
      const onDpr    = () => { apply(); watchDpr(); };
      const watchDpr = () => {
        if (mq) mq.removeEventListener('change', onDpr);
        mq = window.matchMedia('(resolution: ' + dpr() + 'dppx)');
        mq.addEventListener('change', onDpr);
      };
      watchDpr();

      // A mouse being plugged into or unplugged from a tablet.
      const pointerMq = window.matchMedia('(any-pointer: fine)');
      if (pointerMq.addEventListener) pointerMq.addEventListener('change', apply);
    }

    return api;
  }

  function onChange(fn)      { if (typeof fn === 'function') watchers.push(fn); }
  function onBlockChange(fn) { if (typeof fn === 'function') blockWatchers.push(fn); }

  const api = {
    init, apply, onChange, onBlockChange, toLogical, setLogicalWidth,
    scale:       () => scale,
    offsetX:     () => offX,
    offsetY:     () => offY,
    isBlocked:   () => blocked,
    blockReason: () => reason,
    width, height, pixelRatio, hasFinePointer,
  };

  return api;
})();

// Fit before the first paint so the game never flashes at the wrong size.
// Every script tag in this project sits at the end of <body>, so #app-scaler
// already exists by the time this runs; the listener is belt and braces.
if (document.getElementById('app-scaler')) {
  Viewport.init();
} else {
  document.addEventListener('DOMContentLoaded', () => Viewport.init());
}
