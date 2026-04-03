'use strict';

/**
 * Star Catcher v2 — Global Configuration
 * All magic numbers live here. Change gameplay feel from one place.
 */
const CONFIG = Object.freeze({

  PADDLE: {
    BASE_WIDTH:        110,
    EXPANDED_WIDTH:    240,
    HEIGHT:            14,
    BOTTOM_OFFSET:     25,
    DISCOVERY_DURATION_MS: 8000,
  },

  GAME: {
    INITIAL_LIVES:     3,
    STAR_COUNT:        120,
    BASE_SPAWN_MS:     1000,
    MIN_SPAWN_MS:      250,
    HEIGHT:            700,
  },

  OBJECTS: {
    CHROMA_CHANCE:       0.03,
    CHROMA_SIZE:         40,
    STAR_SIZE:         16,
    CHROMA_SCORE:        50,
    STAR_SCORE:        10,
    BASE_SPEED:        2.5,
  },

  // v2.1 — Logarithmic difficulty ramping
  // Difficulty is a weighted blend: 0.65 * scoreFactor + 0.35 * comboFactor
  // Both factors use log curves so early game ramps noticeably, late game plateaus.
  DIFFICULTY: {
    SCORE_WEIGHT:      0.65,
    COMBO_WEIGHT:      0.35,
    // Spawn interval: lerp from BASE_SPAWN_MS → MIN_SPAWN_MS as difficulty 0→1
    // difficulty = W_s * log(1 + score / SCORE_SCALE) / log(1 + SCORE_CAP / SCORE_SCALE)
    //            + W_c * log(1 + combo / COMBO_SCALE) / log(1 + COMBO_CAP / COMBO_SCALE)
    SCORE_SCALE:       16000,   // score value at which curve is ~halfway
    SCORE_CAP:         25000,  // score at which score-factor saturates to 1
    COMBO_SCALE:       30,     // combo at which curve is ~halfway
    COMBO_CAP:         40,    // combo at which combo-factor saturates to 1
    // Fall speed: BASE_SPEED + SPEED_EXTRA * difficulty
    SPEED_EXTRA:       2.5,
    // Post-milestone grace period before spawning resumes
    MILESTONE_GRACE_MS: 600,
  },

  AUDIO: {
    CATCH_BASE_HZ:     440,
    CHROMA_BASE_HZ:      880,
    MILESTONE_HZ:      523,
    MISS_HZ:           150,
    GAME_OVER_HZ:      80,
    COUNTDOWN_HZ:      [200, 300, 400],   // count 3, 2, 1
    GO_HZ:             880,
  },

  // v2.2 — Precision scoring: center catches are worth more
  PRECISION: {
    // Multiplier range: edge of paddle → center of paddle
    EDGE_MULT:         1.0,
    CENTER_MULT:       2.0,
    // Floating score text rise distance & duration
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