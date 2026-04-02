'use strict';

/**
 * Star Catcher v2 — Audio Manager
 * Lazy-initialises the AudioContext on first interaction to satisfy browser policies.
 */
const AudioManager = (() => {
  let _ctx = null;
  let _volume = 1;   // master SFX multiplier 0–1
  let _muted  = false;

  function _ctx_get() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    return _ctx;
  }

  /** Resumes a suspended context (required after user gesture on some browsers). */
  function resume() {
    const c = _ctx_get();
    if (c.state === 'suspended') c.resume();
  }

  /** Set master SFX volume (0–1). */
  function setVolume(v) { _volume = Math.max(0, Math.min(1, v)); }

  /** Set muted state — when true, all SFX is silenced. */
  function setMuted(m) { _muted = !!m; }

  /**
   * Plays a simple synthesised tone.
   * @param {number} freq  - Frequency in Hz
   * @param {string} type  - OscillatorType ('sine' | 'square' | 'sawtooth' | 'triangle')
   * @param {number} dur   - Duration in seconds
   * @param {number} [vol] - Peak gain (default 0.1)
   */
  function play(freq, type, dur, vol = 0.1) {
    if (_muted) return;
    const effective = vol * _volume;
    if (effective <= 0) return;
    resume();
    const c   = _ctx_get();
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    g.gain.setValueAtTime(effective, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + dur);
  }

  return { play, resume, setVolume, setMuted };
})();