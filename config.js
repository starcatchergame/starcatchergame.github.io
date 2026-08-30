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
    HEIGHT:            700,
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
    MAX_ENTRIES:       10
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

});
