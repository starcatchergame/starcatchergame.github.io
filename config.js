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
    GOLD_CHANCE:       0.03,
    GOLD_SIZE:         40,
    STAR_SIZE:         16,
    GOLD_SCORE:        50,
    STAR_SCORE:        10,
    BASE_SPEED:        2.5,
  },

  AUDIO: {
    CATCH_BASE_HZ:     440,
    GOLD_BASE_HZ:      880,
    MILESTONE_HZ:      523,
    MISS_HZ:           150,
    GAME_OVER_HZ:      80,
    COUNTDOWN_HZ:      [200, 300, 400],   // count 3, 2, 1
    GO_HZ:             880,
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
