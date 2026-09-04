'use strict';

/**
 * Star Catcher v3 — Global Configuration
 * All magic numbers live here. Change gameplay feel from one place.
 *
 * v3 changes the core loop from "infinite spawn until death" to
 * "discrete, choreographed STAGES made of FRAMES", each stage previewed
 * by a non-scoring GHOST PASS, and separated by an upgrade DRAFT.
 */
const CONFIG = Object.freeze({

  PADDLE: {
    BASE_WIDTH:        110,
    EXPANDED_WIDTH:    240,
    MIN_WIDTH:         55,
    MAX_WIDTH:         340,
    HEIGHT:            14,
    BOTTOM_OFFSET:     25,
    DISCOVERY_DURATION_MS: 8000,
  },

  GAME: {
    INITIAL_LIVES:     3,
    STAR_COUNT:        120,     // background twinkle stars (non-fancy mode)

    // ───────────────────────────────────────────────────────────────────
    // v3.3 — THE LOGICAL PLAYFIELD
    //
    // The game is authored at exactly this size and then CSS-scaled to fit
    // the window (see viewport.js). Nothing inside the game ever measures
    // the browser, so window size and browser zoom no longer change the
    // difficulty — they only change how big the picture is.
    //
    // WIDTH is the number that matters. Every star position is normalised
    // 0..1 and multiplied by it, while the paddle is a fixed PADDLE.
    // BASE_WIDTH, so WIDTH alone decides what fraction of the field the
    // paddle covers. Raising it makes the game harder for everyone;
    // lowering it makes it easier. Changing it invalidates old scores.
    //
    // 1536 is a 1920x1080 monitor at the 125% display scaling Windows
    // ships by default — the most common desktop playfield there is.
    // ───────────────────────────────────────────────────────────────────
    WIDTH:             1536,
    HEIGHT:            700,

    // ───────────────────────────────────────────────────────────────────
    // v3.4 — THE PLAYABILITY GATE
    //
    // Both numbers below are measured in DEVICE pixels per logical pixel,
    // not CSS pixels. That distinction is the entire point: browser zoom
    // moves CSS pixels and devicePixelRatio by the same factor in opposite
    // directions, so a device-pixel measure is zoom-proof and a CSS-pixel
    // one is not. viewport.js explains the arithmetic.
    // ───────────────────────────────────────────────────────────────────

    // Below this, the game refuses to run and shows the "window too small"
    // gate instead of shrinking. 1.0 means "at least one device pixel per
    // logical pixel", i.e. a 1536x700 device-pixel window. Shrinking below
    // that is fair in logical terms but hands the player a playfield small
    // enough to cross with a flick of the wrist, which is its own easy mode.
    MIN_DEVICE_SCALE:  1.0,

    // The ceiling is deliberately disabled, and it should stay that way.
    // Any clamp on the display scale re-breaks zoom invariance: a capped
    // game stops filling the window, so zooming out shrinks the picture
    // again and shortens the mouse sweep. A tidier-looking HUD on an
    // ultrawide is not worth reopening the exploit. Lower this only if you
    // have decided you would rather have the looks than the fairness.
    MAX_DEVICE_SCALE:  1000,

    // Ceiling on canvas backing-store resolution (display scale x device
    // pixel ratio). Keeps the starfield crisp when scaled up without
    // asking a 4K panel to composite a canvas nobody can perceive.
    MAX_CANVAS_RATIO:  2,

    // Legacy spawn constants — retained so nothing referencing them breaks.
    BASE_SPAWN_MS:     1000,
    MIN_SPAWN_MS:      250,
  },

  OBJECTS: {
    CHROMA_CHANCE:       0.015,  // per-star baseline roll (on top of guaranteed chroma)
    CHROMA_SIZE:         40,
    STAR_SIZE:           16,
    CHROMA_SCORE:        50,
    STAR_SCORE:          10,
    BASE_SPEED:          2.5,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // v3 — STAGE STRUCTURE
  // A stage is an ordered list of FRAMES. A frame is one drop event holding
  // 1..N stars. `gap` is the delay AFTER a frame before the next one fires.
  // ─────────────────────────────────────────────────────────────────────────
  STAGE: {
    FIRST_STAGE_STARS:   5,      // stars in stage 1
    STARS_GROWTH:        1.6,    // additional stars per stage (linear)
    STARS_MAX:           42,     // hard ceiling on stage length

    BASE_FRAME_GAP_MS:   1100,   // gap between frames on stage 1
    MIN_FRAME_GAP_MS:    300,    // floor — frames never get tighter than this
    GAP_DECAY:           0.93,   // gap multiplier per stage (compounding)
    GAP_JITTER:          0.14,   // +/-14% random wobble so rhythm isn't robotic

    // Multi-star frames (two or three stars dropping simultaneously)
    MULTI_START_STAGE:   5,      // first stage that can produce them
    MULTI_CHANCE_BASE:   0.10,   // chance at MULTI_START_STAGE
    MULTI_CHANCE_RAMP:   0.02,   // added per stage beyond that
    MULTI_CHANCE_MAX:    0.35,

    // Chroma seeding
    CHROMA_FROM_STAGE:   3,      // stage at which one chroma is guaranteed
    CHROMA_EVERY:        1,      // guaranteed chroma every N stages

    // Pacing between phases (ms)
    INTRO_MS:            1400,   // "STAGE N" banner
    GHOST_TO_LIVE_MS:    900,    // "GET READY" beat between passes
    TAIL_POLL_MS:        90,     // how often we poll for a pass to finish
    CLEAR_PANEL_MS:      1500,   // stage-clear summary dwell before the draft
    MIN_STAGE_LEN:       3,      // never build a stage with fewer frames
  },

  // ─────────────────────────────────────────────────────────────────────────
  // v3 — GHOST PASS
  // The stage plays through once in ghost form. Ghost stars are pure
  // information: catching them scores nothing, missing them costs nothing.
  // ─────────────────────────────────────────────────────────────────────────
  GHOST: {
    ENABLED:           true,
    // The whole ghost pass is time-compressed: speed x TIME_SCALE and
    // gap / TIME_SCALE, so the rhythm is preserved exactly, just faster.
    TIME_SCALE:        1.6,
    OPACITY:           0.34,
    CATCH_HZ:          330,      // soft, clearly-different tone on ghost catch
    LAND_HZ:           220,
    // Landing markers left behind where a ghost star reaches the floor
    MARKER_POOL_SIZE:  24,
    MARKER_FADE_MS:    2600,
    MARKER_WIDTH:      3,
    MARKER_HEIGHT:     52,
    TRACK_CATCHES:     true,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // v3 — DISTORTION (dormant hook for "the ghost lies to you")
  // Set START_STAGE to a positive number to switch this on. At 0 it is off
  // and the ghost pass is always a perfectly faithful preview.
  // ─────────────────────────────────────────────────────────────────────────
  DISTORTION: {
    START_STAGE:       0,        // 0 = disabled. Try 8 to enable.
    // Chance a frame's ghost simply doesn't fall (telegraph only, no ghost star)
    PHANTOM_CHANCE:    0.10,
    PHANTOM_MAX:       0.30,
    // Chance a frame's ghost shows the WRONG x position
    LIE_CHANCE:        0.08,
    LIE_MAX:           0.25,
    // How far a lying ghost is displaced, in normalised screen units
    LIE_MIN_OFFSET:    0.16,
    LIE_MAX_OFFSET:    0.42,
    // Ramp: chances grow this much per stage past START_STAGE
    RAMP_PER_STAGE:    0.015,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // v3 — DIFFICULTY is now driven by STAGE NUMBER, not by score or combo.
  // This is the fix for "too difficult too quickly": your own success no
  // longer accelerates the game underneath you.
  // ─────────────────────────────────────────────────────────────────────────
  DIFFICULTY: {
    STAGE_SCALE:       6,        // stage at which the curve is ~halfway
    STAGE_CAP:         22,       // stage at which difficulty saturates to 1
    SPEED_EXTRA:       2.5,      // speed = BASE_SPEED + SPEED_EXTRA * difficulty
    MILESTONE_GRACE_MS: 600,
    // Legacy blend weights — unused by v3, kept so old code paths don't throw.
    SCORE_WEIGHT:      0.65,
    COMBO_WEIGHT:      0.35,
    SCORE_SCALE:       16000,
    SCORE_CAP:         25000,
    COMBO_SCALE:       30,
    COMBO_CAP:         40,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // v3 — DRAFT (the Nubby-style build-crafting layer)
  // ─────────────────────────────────────────────────────────────────────────
  DRAFT: {
    CARDS:               3,      // options offered per draft
    REROLLS_PER_RUN:     2,      // free rerolls the player starts with
    CHROMA_GRANTS_PICK:  true,   // a caught chroma banks an extra draft pick
    MAX_BONUS_PICKS:     2,      // ceiling on banked picks per stage
    RARITY_WEIGHTS: {
      common:    100,
      uncommon:   45,
      rare:       16,
    },
    UNCOMMON_FROM_STAGE: 2,
    RARE_FROM_STAGE:     4,
  },

  SCORING: {
    STAGE_CLEAR_BASE:    100,    // per-stage completion bonus, x stage number
    PERFECT_STAGE_BONUS: 250,    // extra, x stage number, if zero misses
  },

  AUDIO: {
    CATCH_BASE_HZ:     440,
    CHROMA_BASE_HZ:    880,
    MILESTONE_HZ:      523,
    MISS_HZ:           150,
    GAME_OVER_HZ:      80,
    COUNTDOWN_HZ:      [200, 300, 400],
    GO_HZ:             880,
    STAGE_START_HZ:    392,
    STAGE_CLEAR_HZ:    659,
    SHIELD_HZ:         290,
    DRAFT_PICK_HZ:     740,
  },

  PRECISION: {
    EDGE_MULT:         1.0,
    CENTER_MULT:       2.0,
    FLOAT_RISE_PX:     60,
    FLOAT_DURATION_MS: 800,
  },

  LEADERBOARD: {
    MAX_ENTRIES:       10,
    // v3.1 — we over-fetch so one pilot can't wallpaper the board with ten
    // runs. Rows are collapsed to a personal best before the top N is cut.
    FETCH_MULTIPLIER:  6,
    DEDUPE_BY_PILOT:   true,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // v3.1 — ACCOUNTS
  // Optional. A guest can play and post scores forever without one; an
  // account just means the name follows you between devices and sessions.
  // ─────────────────────────────────────────────────────────────────────────
  ACCOUNT: {
    PROFILE_TABLE:     'profiles',
    NAME_MAX_LENGTH:   12,
    MIN_PASSWORD:      8,
    // Which OAuth providers to offer. Remove one here if it isn't enabled
    // in the Supabase dashboard — the button disappears with it.
    PROVIDERS: [
      { id: 'google',  label: 'Google',  color: '#ffffff' },
      //{ id: 'discord', label: 'Discord', color: '#8b9dff' },
    ],
  },

  SUPABASE: {
    URL:       'https://frchqoajyygsmyknawnl.supabase.co',
    ANON_KEY:  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyY2hxb2FqeXlnc215a25hd25sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MzEwMjYsImV4cCI6MjA5MDQwNzAyNn0.nAUwYtILSH4az-ygpcIgJ5DQ8YlOMxGFsNUK-qFX-5o',
    TABLE:     'scores',
  },

  E_E: {
    SEQUENCE:          ['BL', 'TR', 'BR', 'TL'],
    HOVER_DELAY_MS:    1000,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // v3.2 — DEV MODE
  // Controls who gets the dev console (devtools.js). Everyone else sees a
  // completely ordinary game: no toolbar, no hotkeys, no stored state.
  //
  // To fill in ADMINS: sign in with the account you want to develop from,
  // open the browser console and run  SC.whoami()  — it prints the exact
  // string to paste here.
  //
  // This is a convenience gate, not a security boundary. It lives in the
  // browser, so it keeps the tools out of players' way rather than out of a
  // determined person's reach. The consequence that actually matters — a
  // doctored run reaching the leaderboard — is blocked separately by the
  // "tainted run" flag, and belongs in a server-side check long-term.
  // ─────────────────────────────────────────────────────────────────────────
  DEV: {
    // Emails or Supabase user IDs allowed to open the dev console.
    ADMINS: [
      'larsonkeagan@gmail.com',
    ],
    // Your own machine is always trusted, so local iteration needs no login.
    ALLOW_LOCALHOST: true,
  },

});
