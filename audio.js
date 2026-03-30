'use strict';

/**
 * Star Catcher v2 — Audio Manager
 * Lazy-initialises the AudioContext on first interaction to satisfy browser policies.
 */
const AudioManager = (() => {
  let _ctx = null;

  function _ctx_get() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    return _ctx;
  }

  /** Resumes a suspended context (required after user gesture on some browsers). */
  function resume() {
    const c = _ctx_get();
    if (c.state === 'suspended') c.resume();
  }

  /**
   * Plays a simple synthesised tone.
   * @param {number} freq  - Frequency in Hz
   * @param {string} type  - OscillatorType ('sine' | 'square' | 'sawtooth' | 'triangle')
   * @param {number} dur   - Duration in seconds
   * @param {number} [vol] - Peak gain (default 0.1)
   */
  function play(freq, type, dur, vol = 0.1) {
    resume();
    const c   = _ctx_get();
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + dur);
  }

  return { play, resume };
})();
