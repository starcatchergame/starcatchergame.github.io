'use strict';

/**
 * Star Catcher v3 — Main Game Controller
 *
 * v3 Stage overhaul:
 *   - The endless spawn stream is replaced by discrete STAGES of FRAMES
 *   - Every stage is previewed by a non-scoring GHOST PASS
 *   - Difficulty is driven by stage number, not by score or combo
 *   - Stages are separated by a perk DRAFT (run-defining build choices)
 *   - Runs are seeded and reproducible
 *
 * v2.2 Performance overhaul:
 *
 * v2.2 Performance overhaul:
 *   - Single centralised game loop (one rAF drives all objects + particles)
 *   - Object pool for falling objects (no DOM create/destroy per spawn)
 *   - Particle pool for explosions (no DOM create/destroy per burst)
 *   - JS-tracked positions: paddle & container cached, no getBoundingClientRect
 *   - Difficulty cached per frame (avoids redundant Math.log calls)
 *
 * Sections:
 *   1. DOM refs
 *   2. Game state + layout cache
 *   3. Stars (background animation)
 *   3b. Game background wrappers
 *   4. Paddle (JS-tracked)
 *   5. UI updates
 *   6. Object pool
 *   7. Particle pool (explosions)
 *   7c. Ghost landing markers
 *   8. Central game loop
 *   9. Stage director (frames, ghost pass, live pass)
 *  10. Draft (perk selection between stages)
 *  11. Pause
 *  12. Countdown
 *  13. Game over + leaderboard UI
 *  14. Game start / reset
 *  15. ???
 *  16. Settings
 *  17. Global listeners
 *  18. Title background
 */

window.addEventListener('load', () => {

  // ─── 0. DEV BRIDGE ──────────────────────────────────────────────────────────
  //
  // devtools.js is optional. When its script tag is present it installs
  // window.DevTools and the handful of `Dev.*` calls scattered below light up;
  // when it is absent this neutral stand-in takes over and every one of them
  // becomes a no-op returning the ordinary value. Nothing in the shipping game
  // depends on dev mode existing.

  const Dev = window.DevTools || {
    enabled: false,
    timeScale:   () => 1,
    godMode:     () => false,
    tainted:     () => false,
    consumeStep: () => false,
    startStage:  n => n,
    forcedHand:  () => null,
    onFrame() {}, onRunStart() {}, onStageBegin() {}, onStageEnd() {},
    onCatch() {}, onMiss() {}, onGameOver() {},
    attach() {}, taint() {},
    whoami() { console.log('[Dev] devtools.js is not loaded.'); return null; },
  };

  // ─── 1. DOM REFERENCES ──────────────────────────────────────────────────────

  const DOM = {
    // Screens
    startScreen:    document.getElementById('start-screen'),
    lbScreen:       document.getElementById('leaderboard-screen'),
    container:      document.getElementById('game-container'),

    // Start screen
    startGameBtn:   document.getElementById('start-game-btn'),
    leaderboardBtn: document.getElementById('leaderboard-btn'),
    floatingTitle:  document.getElementById('floating-title'),
    seedInput:      document.getElementById('seed-input'),
    titleLetters:   document.querySelectorAll('#floating-title span'),
    titleCanvas:    document.getElementById('title-canvas'),

    // Leaderboard screen
    lbScoresPanel:  document.getElementById('lb-scores-panel'),
    lbCombosPanel:  document.getElementById('lb-combos-panel'),
    lbTabs:         document.querySelectorAll('.lb-tab'),
    lbBackBtn:      document.getElementById('lb-back-btn'),

    // Game canvas + paddle
    canvas:         document.getElementById('bg-canvas'),
    paddleWrap:     document.getElementById('paddle-wrapper'),
    paddle:         document.getElementById('paddle'),

    // In-game HUD
    scoreEl:        document.getElementById('score'),
    livesEl:        document.getElementById('lives'),
    comboEl:        document.getElementById('combo'),
    countdown:      document.getElementById('countdown'),

    // Overlays
    gameOver:       document.getElementById('game-over'),
    pauseMenu:      document.getElementById('pause-menu'),
    resumeBtn:      document.getElementById('resume-btn'),

    // Game over details
    finalScore:     document.getElementById('final-score'),
    highScore:      document.getElementById('high-score'),
    maxCombo:       document.getElementById('max-combo'),
    nameEntry:      document.getElementById('name-entry'),
    nameEntryGuest: document.getElementById('name-entry-guest'),
    nameEntryUser:  document.getElementById('name-entry-user'),
    nameEntrySignin:document.getElementById('name-entry-signin'),
    postingAsName:  document.getElementById('posting-as-name'),
    submitStatus:   document.getElementById('submit-status'),
    playerName:     document.getElementById('player-name'),
    submitScoreBtn: document.getElementById('submit-score-btn'),
    submitScoreUserBtn: document.getElementById('submit-score-user-btn'),
    viewLbBtn:      document.getElementById('view-lb-btn'),
    rebootBtn:      document.getElementById('reboot-btn'),

    // Account
    accountScreen:  document.getElementById('account-screen'),
    pilotChip:      document.getElementById('pilot-chip'),

    // corner markers
    eeCorners: {
      BL: document.getElementById('ee-bl'),
      TR: document.getElementById('ee-tr'),
      BR: document.getElementById('ee-br'),
      TL: document.getElementById('ee-tl'),
    },

    // Background music
    bgMusic:    document.getElementById('bg-music'),
    titleMusic: document.getElementById('title-music'),
    lbMusic:    document.getElementById('lb-music'),

    // Settings screen
    settingsScreen:    document.getElementById('settings-screen'),
    settingsBtnStart:  document.getElementById('settings-btn-start'),
    settingsBtnPause:  document.getElementById('settings-btn-pause'),
    settingsBtnGO:     document.getElementById('settings-btn-gameover'),
    settingsBackBtn:   document.getElementById('settings-back-btn'),
    fancyStarsToggle:  document.getElementById('fancy-stars-toggle'),
    scorePopupsToggle: document.getElementById('score-popups-toggle'),
    musicVolumeSlider: document.getElementById('music-volume'),
    sfxVolumeSlider:   document.getElementById('sfx-volume'),
    musicVolVal:       document.getElementById('music-vol-val'),
    sfxVolVal:         document.getElementById('sfx-vol-val'),

    // Tutorial
    tutorialOverlay:    document.getElementById('tutorial-overlay'),
    tutorialStepContainer: document.getElementById('tutorial-step-container'),
    tutorialDots:       document.getElementById('tutorial-dots'),
    tutorialNextBtn:    document.getElementById('tutorial-next-btn'),

    // Precision float pool
    precisionFloatPool: document.getElementById('precision-float-pool'),

    // ── v3: stage HUD ──
    stageIndicator:    document.getElementById('stage-indicator'),
    phaseIndicator:    document.getElementById('phase-indicator'),
    stageProgressWrap: document.getElementById('stage-progress-wrap'),
    stageProgressFill: document.getElementById('stage-progress-fill'),
    shieldIndicator:   document.getElementById('shield-indicator'),
    perkStrip:         document.getElementById('perk-strip'),
    seedLabel:         document.getElementById('seed-label'),
    ghostMarkerPool:   document.getElementById('ghost-marker-pool'),

    // ── v3: stage banner + stage-clear panel ──
    stageBanner:       document.getElementById('stage-banner'),
    stageBannerTitle:  document.getElementById('stage-banner-title'),
    stageBannerSub:    document.getElementById('stage-banner-sub'),
    stageClearPanel:   document.getElementById('stage-clear-panel'),
    stageClearTitle:   document.getElementById('stage-clear-title'),
    stageClearStats:   document.getElementById('stage-clear-stats'),

    // ── v3: draft ──
    draftPanel:        document.getElementById('draft-panel'),
    draftTitle:        document.getElementById('draft-title'),
    draftSub:          document.getElementById('draft-sub'),
    draftCards:        document.getElementById('draft-cards'),
    draftRerollBtn:    document.getElementById('draft-reroll-btn'),
    draftSkipBtn:      document.getElementById('draft-skip-btn'),

    // ── v3: run summary on the game-over panel ──
    runSummary:        document.getElementById('run-summary'),
  };

  const canvasCtx = DOM.canvas.getContext('2d');

  // ─── MUSIC HELPERS ──────────────────────────────────────────────────────────

  function startMusic() {
    DOM.bgMusic.loop = true;
    DOM.bgMusic.currentTime = 0;
    DOM.bgMusic.play().catch(() => {});
  }

  function stopMusic() {
    DOM.bgMusic.pause();
    DOM.bgMusic.currentTime = 0;
  }

  function startTitleMusic() {
    DOM.titleMusic.loop = true;
    DOM.titleMusic.currentTime = 0;
    DOM.titleMusic.play().catch(() => {});
  }

  function stopTitleMusic() {
    DOM.titleMusic.pause();
    DOM.titleMusic.currentTime = 0;
  }

  function startLbMusic() {
    DOM.lbMusic.loop = true;
    DOM.lbMusic.currentTime = 0;
    DOM.lbMusic.play().catch(() => {});
  }

  function stopLbMusic() {
    DOM.lbMusic.pause();
    DOM.lbMusic.currentTime = 0;
  }

  // ─── SETTINGS STATE ────────────────────────────────────────────────────────

  const settings = {
    fancyStars:    true,
    scorePopups:   true,
    musicVolume:   0.8,
    sfxVolume:     0.8,
    openedFrom:    null,
  };

  // Gameplay fancy background (no title glow)
  const GameBG = createFancyBG({ showTitleGlow: false });

  /** Apply current music volume to all music audio elements. */
  function applyMusicVolume() {
    DOM.bgMusic.volume    = settings.musicVolume;
    DOM.titleMusic.volume = settings.musicVolume;
    DOM.lbMusic.volume    = settings.musicVolume;
  }

  /** Apply current SFX volume to AudioManager. */
  function applySfxVolume() {
    AudioManager.setVolume(settings.sfxVolume);
    AudioManager.setMuted(settings.sfxVolume === 0);
  }

  applyMusicVolume();
  applySfxVolume();

  // ─── 2. GAME STATE ──────────────────────────────────────────────────────────

  /**
   * Cached layout dimensions.
   *
   * v3.3 — containerW/H are the LOGICAL playfield size and never change,
   * whatever the window is doing. They used to be read from the container's
   * bounding rect, which is why browser zoom changed the difficulty.
   *
   * containerLeft/Top and scale describe where that logical box currently
   * lands on the physical screen. They exist for exactly one purpose:
   * turning pointer events back into logical coordinates. Nothing else in
   * the game should read them.
   */
  const layout = {
    containerW:  CONFIG.GAME.WIDTH,
    containerH:  CONFIG.GAME.HEIGHT,
    containerLeft: 0,
    containerTop:  0,
    scale:         1,
  };

  /** Paddle position tracked in JS — no DOM reads needed during gameplay. */
  const paddleState = {
    x:     0,      // centre x relative to container
    width: CONFIG.PADDLE.BASE_WIDTH,
    height: CONFIG.PADDLE.HEIGHT,
  };

  function updateLayout() {
    // The logical size is a constant. Only the mapping onto the screen moves.
    layout.containerW = CONFIG.GAME.WIDTH;
    layout.containerH = CONFIG.GAME.HEIGHT;
    layout.scale      = Viewport.scale();

    // getBoundingClientRect reports the SCALED box, which is what we want
    // here — it is the screen-space origin we subtract from clientX/clientY.
    // It reads as zeroes while the container is display:none, so the
    // Viewport.onChange hook below re-runs this once a run is live.
    const rect = DOM.container.getBoundingClientRect();
    layout.containerLeft = rect.left;
    layout.containerTop  = rect.top;
  }

  const state = {
    score:           0,
    lives:           0,
    combo:           0,
    sessionMaxCombo: 0,
    bestScore:       0,

    active:          false,   // game loop running
    paused:          false,
    countingDown:    false,
    paddleExpanded:  false,

    lbOpenedFromGameOver: false,  // tracks which screen to return to from leaderboard

    // v2.2: cached difficulty value, updated once per frame
    cachedDifficulty: 0,

    // v3: run-level bookkeeping
    stagesCleared:   0,
    runSeed:         0,
    runSeedCode:     '',
    totalGhostCatches: 0,
    totalMisses:     0,
    perfectStages:   0,

    // Timer handles for cleanup
    discoveryTimer:  null,
    starsRaf:        null,
    gameLoopRaf:     null,   // v2.2: central game loop handle
  };

  // ─── 3. STARS ───────────────────────────────────────────────────────────────

  let stars = [];

  // v3.3 — the canvas backing store is now sized in DEVICE pixels while the
  // starfield is positioned in LOGICAL ones, so these two are tracked
  // separately instead of reading canvas.width for both.
  let starW = 0, starH = 0;

  function initStars() {
    const ratio = Viewport.pixelRatio();
    starW = DOM.container.offsetWidth;   // layout width — transforms don't
    starH = DOM.container.offsetHeight;  // affect it, so this is logical

    DOM.canvas.width  = Math.round(starW * ratio);
    DOM.canvas.height = Math.round(starH * ratio);
    canvasCtx.setTransform(ratio, 0, 0, ratio, 0, 0);

    stars = Array.from({ length: CONFIG.GAME.STAR_COUNT }, () => ({
      x: Math.random() * starW,
      y: Math.random() * starH,
      s: Math.random() * 2.5 + 0.5,
      o: Math.random(),
    }));
  }

  function drawStars() {
    canvasCtx.fillStyle = '#000';
    canvasCtx.fillRect(0, 0, starW, starH);
    stars.forEach(s => {
      canvasCtx.fillStyle = `rgba(255,255,255,${s.o})`;
      canvasCtx.fillRect(s.x, s.y, s.s, s.s);
      s.y = (s.y + s.s * 0.4) % starH;
    });
    if (state.active && !state.paused) {
      state.starsRaf = requestAnimationFrame(drawStars);
    }
  }

  function stopStars() {
    if (state.starsRaf !== null) {
      cancelAnimationFrame(state.starsRaf);
      state.starsRaf = null;
    }
  }

  // ─── 3b. GAME BACKGROUND WRAPPERS ──────────────────────────────────────────

  /** Initialise + start the correct game background. */
  function startGameBG() {
    if (settings.fancyStars) {
      GameBG.init(DOM.canvas);
      GameBG.start();
    } else {
      initStars();
      drawStars();
    }
  }

  /** Stop whichever game background is running. */
  function stopGameBG() {
    GameBG.stop();
    stopStars();
  }

  /** Handle resize for the active game background. */
  function resizeGameBG() {
    if (settings.fancyStars) {
      GameBG.resize();
    } else {
      initStars();
    }
  }

  // ─── 4. PADDLE (JS-tracked) ───────────────────────────────────────────────

  function setPaddleWidth(w) {
    paddleState.width = w;
    DOM.paddle.style.width = w + 'px';
  }

  function impactEffect() {
    const w = paddleState.width;
    DOM.paddle.style.height = '8px';
    DOM.paddle.style.width  = (w + 20) + 'px';
    setTimeout(() => {
      DOM.paddle.style.height = CONFIG.PADDLE.HEIGHT + 'px';
      DOM.paddle.style.width  = w + 'px';
    }, 100);
  }

  DOM.container.addEventListener('mousemove', e => {
    if (!state.active || state.paused) return;
    // v3.3 — pointer events are in screen pixels; the playfield is in
    // logical ones. Dividing by the scale is the whole conversion, and it
    // is why zooming no longer buys anyone a wider paddle.
    const x    = (e.clientX - layout.containerLeft) / layout.scale;
    const half = paddleState.width / 2;
    const clamped = Math.max(half, Math.min(x, layout.containerW - half));
    paddleState.x = clamped;
    DOM.paddleWrap.style.left = clamped + 'px';
  });

  // ─── 5. UI UPDATES ──────────────────────────────────────────────────────────

  function updateScore() {
    DOM.scoreEl.innerText = 'SCORE: ' + String(state.score).padStart(3, '0');
  }

  function updateLives() {
    DOM.livesEl.innerText = 'LIVES: ' + '❤'.repeat(Math.max(0, state.lives));
  }

  function updateCombo() {
    if (state.combo > 1) {
      const progress = Math.min((state.combo - 1) / 19, 1);
      const greenCh  = Math.floor(204 * (1 - progress));
      DOM.comboEl.style.opacity    = '1';
      DOM.comboEl.innerText        = 'COMBO x' + state.combo;
      DOM.comboEl.style.transform  = `scale(${1 + progress * 0.5})`;
      DOM.comboEl.style.color      = `rgb(255,${greenCh},0)`;
    } else {
      DOM.comboEl.style.opacity = '0';
      DOM.comboEl.style.color   = '#ffcc00';
    }
  }


  // ─── 6. OBJECT POOL ──────────────────────────────────────────────────────

  /**
   * v2.2 — Pre-allocated pool of DOM elements for falling objects.
   * Instead of createElement/remove on every spawn, we show/hide pooled divs.
   */
  const POOL_SIZE = 72;           // v3: ghost + live stars, multi-star frames, echoes
  const objectPool = [];          // { el, active, x, y, speed, size, isChroma, isGhost, ... }
  const activeObjects = [];       // pool indices of currently-falling objects

  function initObjectPool() {
    objectPool.forEach(o => o.el.remove());
    objectPool.length = 0;
    activeObjects.length = 0;

    for (let i = 0; i < POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;display:none;z-index:5;';
      DOM.container.appendChild(el);
      objectPool.push({
        el,
        active: false,
        x: 0, y: 0,
        speed: 0,
        size: 0,
        isChroma: false,
        isGhost:  false,     // v3: ghost stars never score and never cost lives
        isEcho:   false,     // v3: spawned by the ECHO perk
        lying:    false,     // v3: this ghost is showing a false position
        color: '',
      });
    }
  }

  /** Acquire a pooled object. Returns the object data or null if pool exhausted. */
  function acquireObject() {
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!objectPool[i].active) {
        objectPool[i].active = true;
        activeObjects.push(i);
        return objectPool[i];
      }
    }
    return null; // pool exhausted — skip this spawn
  }

  /** Release a pooled object back to inactive state (swap-and-pop). */
  function releaseObject(poolIdx) {
    const obj = objectPool[poolIdx];
    obj.active = false;
    obj.el.style.display = 'none';
    obj.el.classList.remove('rainbow', 'ghost-obj', 'ghost-chroma');
    const aidx = activeObjects.indexOf(poolIdx);
    if (aidx !== -1) {
      activeObjects[aidx] = activeObjects[activeObjects.length - 1];
      activeObjects.pop();
    }
  }

  /** Release all active objects (used on game over / reset). */
  function releaseAllObjects() {
    for (let i = activeObjects.length - 1; i >= 0; i--) {
      const obj = objectPool[activeObjects[i]];
      obj.active = false;
      obj.el.style.display = 'none';
      obj.el.classList.remove('rainbow', 'ghost-obj', 'ghost-chroma');
    }
    activeObjects.length = 0;
  }

  /** v3 — how many pooled objects of a given kind are still falling. */
  function countActive(isGhost) {
    let n = 0;
    for (let i = 0; i < activeObjects.length; i++) {
      if (objectPool[activeObjects[i]].isGhost === isGhost) n++;
    }
    return n;
  }

  // ─── 7. PARTICLE POOL (explosions) ─────────────────────────────────────

  /**
   * v2.2 — Pre-allocated pool of DOM elements for explosion particles.
   * Each particle has its own velocity/opacity tracked in JS.
   */
  const PARTICLE_POOL_SIZE = 120;   // supports ~8 simultaneous explosions (15 each)
  const particlePool = [];
  const activeParticles = [];

  function initParticlePool() {
    particlePool.forEach(p => p.el.remove());
    particlePool.length = 0;
    activeParticles.length = 0;

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;width:4px;height:4px;pointer-events:none;z-index:5;display:none;';
      DOM.container.appendChild(el);
      particlePool.push({
        el,
        active: false,
        ox: 0, oy: 0,
        dx: 0, dy: 0,
        vx: 0, vy: 0,
        opacity: 0,
      });
    }
  }

  function createExplosion(x, y, color) {
    for (let i = 0; i < 15; i++) {
      let p = null, pIdx = -1;
      for (let j = 0; j < PARTICLE_POOL_SIZE; j++) {
        if (!particlePool[j].active) { p = particlePool[j]; pIdx = j; break; }
      }
      if (!p) break;  // pool exhausted

      const angle = Math.random() * Math.PI * 2;
      const vel   = 3 + Math.random() * 5;

      p.active  = true;
      p.ox      = x;
      p.oy      = y;
      p.dx      = 0;
      p.dy      = 0;
      p.vx      = Math.cos(angle) * vel;
      p.vy      = Math.sin(angle) * vel;
      p.opacity = 1;

      p.el.style.background = color;
      p.el.style.left    = x + 'px';
      p.el.style.top     = y + 'px';
      p.el.style.opacity = '1';
      p.el.style.transform = '';
      p.el.style.display = 'block';

      activeParticles.push(pIdx);
    }
  }

  /** Tick all active particles. Called from central game loop. */
  function updateParticles() {
    for (let i = activeParticles.length - 1; i >= 0; i--) {
      const p = particlePool[activeParticles[i]];
      p.dx += p.vx;
      p.dy += p.vy;
      p.opacity -= 0.03;

      if (p.opacity <= 0) {
        p.active = false;
        p.el.style.display = 'none';
        activeParticles[i] = activeParticles[activeParticles.length - 1];
        activeParticles.pop();
      } else {
        p.el.style.transform = `translate(${p.dx}px,${p.dy}px)`;
        p.el.style.opacity   = p.opacity;
      }
    }
  }

  /** Release all particles (game over / reset). */
  function releaseAllParticles() {
    for (let i = activeParticles.length - 1; i >= 0; i--) {
      const p = particlePool[activeParticles[i]];
      p.active = false;
      p.el.style.display = 'none';
    }
    activeParticles.length = 0;
  }

  // ─── 7b. PRECISION FLOAT TEXT ─────────────────────────────────────────

  /**
   * v2.2 — Shows a floating "+N" text near the catch point, color-coded
   * by how close to center the catch was (precision 0–1).
   */
  function showPrecisionFloat(x, y, points, precision) {
    const el = document.createElement('div');
    el.className = 'precision-float';

    // Tier classification
    let tier, label;
    if (precision >= 0.9)      { tier = 'tier-perfect'; label = 'PERFECT'; }
    else if (precision >= 0.6) { tier = 'tier-great';   label = 'GREAT'; }
    else if (precision >= 0.3) { tier = 'tier-good';    label = ''; }
    else                       { tier = 'tier-ok';      label = ''; }

    el.classList.add(tier);
    el.textContent = '+' + points + (label ? ' ' + label : '');
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.setProperty('--float-dur', CONFIG.PRECISION.FLOAT_DURATION_MS + 'ms');
    el.style.setProperty('--float-rise', CONFIG.PRECISION.FLOAT_RISE_PX + 'px');

    DOM.precisionFloatPool.appendChild(el);

    // Self-cleanup after animation
    setTimeout(() => el.remove(), CONFIG.PRECISION.FLOAT_DURATION_MS + 50);
  }

  // ─── 7c. GHOST LANDING MARKERS ─────────────────────────────────────────

  /**
   * v3 — When a ghost star reaches the floor it leaves a glowing beam at that
   * x. This is the clearest possible statement of "a star is going to land
   * HERE", which is the whole point of the ghost pass.
   */
  const markerPool = [];

  function initMarkerPool() {
    DOM.ghostMarkerPool.innerHTML = '';
    markerPool.length = 0;
    for (let i = 0; i < CONFIG.GHOST.MARKER_POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'ghost-marker';
      el.style.display = 'none';
      DOM.ghostMarkerPool.appendChild(el);
      markerPool.push({ el, active: false });
    }
  }

  /**
   * Drop a landing marker.
   * @param {number} x        centre x in container space
   * @param {boolean} sticky  keep it lit until the stage ends (SIGHTLINE perk)
   */
  function dropGhostMarker(x, sticky) {
    const slot = markerPool.find(m => !m.active) || markerPool[0];
    slot.active = true;
    const el = slot.el;
    el.classList.remove('sticky', 'fading');
    // force reflow so the animation restarts cleanly on a reused element
    void el.offsetWidth;
    el.style.left    = (x - CONFIG.GHOST.MARKER_WIDTH / 2) + 'px';
    el.style.display = 'block';
    if (sticky) {
      el.classList.add('sticky');
    } else {
      el.classList.add('fading');
      setTimeout(() => {
        el.style.display = 'none';
        slot.active = false;
      }, CONFIG.GHOST.MARKER_FADE_MS);
    }
  }

  /** Fade out any sticky markers (called between passes / on stage end). */
  function fadeGhostMarkers() {
    markerPool.forEach(m => {
      if (!m.active) return;
      m.el.classList.remove('sticky');
      m.el.classList.add('fading');
      setTimeout(() => { m.el.style.display = 'none'; m.active = false; },
                 CONFIG.GHOST.MARKER_FADE_MS);
    });
  }

  /** Hard clear — no animation. */
  function clearGhostMarkers() {
    markerPool.forEach(m => {
      m.el.style.display = 'none';
      m.el.classList.remove('sticky', 'fading');
      m.active = false;
    });
  }

  // ─── 7d. STAGE HUD + BANNERS ───────────────────────────────────────────

  let _bannerTimer = null;

  /** Big centred banner: title line + optional subtitle. */
  function showBanner(title, sub, ms, cls) {
    clearTimeout(_bannerTimer);
    DOM.stageBannerTitle.textContent = title;
    DOM.stageBannerSub.textContent   = sub || '';
    DOM.stageBanner.className = 'stage-banner' + (cls ? ' ' + cls : '');
    DOM.stageBanner.style.display = 'block';
    // restart the pop animation
    void DOM.stageBanner.offsetWidth;
    DOM.stageBanner.classList.add('show');
    if (ms) {
      _bannerTimer = setTimeout(() => {
        DOM.stageBanner.classList.remove('show');
        DOM.stageBanner.style.display = 'none';
      }, ms);
    }
  }

  function hideBanner() {
    clearTimeout(_bannerTimer);
    DOM.stageBanner.classList.remove('show');
    DOM.stageBanner.style.display = 'none';
  }

  /** Small transient toast near the paddle (SHIELD, SECOND WIND, CHROMA). */
  function showToast(text, cls) {
    const el = document.createElement('div');
    el.className = 'stage-toast ' + (cls || '');
    el.textContent = text;
    DOM.precisionFloatPool.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  function updateStageHUD() {
    DOM.stageIndicator.textContent = 'STAGE ' + (stage.num || 1);

    const phaseText = {
      intro:     'BRIEFING',
      ghost:     'GHOST PASS',
      interlude: 'GET READY',
      live:      'LIVE',
      clearing:  'STAGE CLEAR',
      draft:     'UPGRADE',
      idle:      '',
    }[stage.phase] || '';
    DOM.phaseIndicator.textContent = phaseText;
    DOM.phaseIndicator.className = 'phase-' + stage.phase;

    const total = Math.max(1, stage.starsTotal);
    const pct   = stage.phase === 'ghost'
      ? (stage.ghostShown / total) * 100
      : (stage.resolved / total) * 100;
    DOM.stageProgressFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    DOM.stageProgressWrap.classList.toggle('is-ghost', stage.phase === 'ghost');

    if (stage.shields > 0) {
      DOM.shieldIndicator.style.display = 'block';
      DOM.shieldIndicator.textContent = 'SHIELD ' + '\u25C8'.repeat(stage.shields);
    } else {
      DOM.shieldIndicator.style.display = 'none';
    }
  }

  function renderPerkStrip() {
    const owned = Upgrades.ownedSummary();
    if (!owned.length) { DOM.perkStrip.innerHTML = ''; return; }
    DOM.perkStrip.innerHTML = owned.map(p =>
      `<span class="perk-chip rarity-${p.rarity}" title="${p.name} — ${p.desc}">` +
      `${p.icon}${p.stacks > 1 ? '<b>x' + p.stacks + '</b>' : ''}</span>`
    ).join('');
  }

  // ─── 8. CENTRAL GAME LOOP ──────────────────────────────────────────────

  /**
   * v2.2 — Single requestAnimationFrame drives ALL gameplay:
   *   - Updates cached difficulty once per frame
   *   - Moves all falling objects via JS positions
   *   - Checks collisions using JS-tracked paddle rect (zero reflows)
   *   - Ticks explosion particles
   *
   * The background (canvas stars / fancy BG) still runs its own rAF
   * since it operates on a separate <canvas> and doesn't touch game DOM.
   */

  /**
   * v3 — Difficulty comes from the STAGE NUMBER only.
   *
   * This is the single most important change for pacing. Previously a good
   * run raised score and combo, which raised difficulty, which meant playing
   * well made the game harder mid-stage and the ramp outran the player. Now
   * the curve is fixed and knowable: stage N always feels like stage N.
   */
  function computeDifficulty() {
    return StageGen.difficultyFor(Math.max(1, stage.num));
  }

  /** Paddle bounding box computed from JS state — zero layout queries. */
  function getPaddleRect() {
    const half = paddleState.width / 2;
    return {
      left:   paddleState.x - half,
      right:  paddleState.x + half,
      top:    layout.containerH - CONFIG.PADDLE.BOTTOM_OFFSET - paddleState.height,
      bottom: layout.containerH - CONFIG.PADDLE.BOTTOM_OFFSET,
    };
  }

  // ─── 8b. CATCH / MISS RESOLUTION ───────────────────────────────────────

  /**
   * v3 — A ghost star was caught.
   *
   * By design this is worth NOTHING. No score, no combo, no life. It exists
   * purely so the ghost pass reads as a real, tactile rehearsal instead of a
   * cutscene you sit through. The only thing it does is tick a counter, which
   * the PRECOGNITION perk can later turn into an end-of-stage payout — an
   * opt-in build choice rather than a baseline reward.
   */
  function onGhostCaught(obj) {
    stage.ghostCatches++;
    state.totalGhostCatches++;
    AudioManager.play(CONFIG.GHOST.CATCH_HZ + Math.min(300, stage.ghostCatches * 8),
                      'sine', 0.07, 0.05);
    dropGhostMarker(obj.x + obj.size / 2, Upgrades.mods.keepGhostMarkers);
    // A faint tick on the paddle so the catch feels acknowledged.
    DOM.paddle.classList.add('ghost-ping');
    setTimeout(() => DOM.paddle.classList.remove('ghost-ping'), 120);
  }

  /** v3 — A ghost star reached the floor. Costs nothing; leaves a marker. */
  function onGhostLanded(obj) {
    dropGhostMarker(obj.x + obj.size / 2, Upgrades.mods.keepGhostMarkers);
    AudioManager.play(CONFIG.GHOST.LAND_HZ, 'sine', 0.05, 0.025);
  }

  /** v3 — A real star was caught. All scoring lives here. */
  function onLiveCaught(obj) {
    const M = Upgrades.mods;

    state.combo += M.comboGrowth;
    if (state.combo > state.sessionMaxCombo) state.sessionMaxCombo = state.combo;

    // Precision scoring: how close to paddle centre? STEADY_HAND widens the
    // window by shrinking the distance we measure against.
    const objCenterX = obj.x + obj.size / 2;
    const halfW      = Math.max(1, (paddleState.width / 2) * M.precisionWidthMult);
    const distFromCenter = Math.abs(objCenterX - paddleState.x);
    const precision  = 1 - Math.min(1, distFromCenter / halfW);
    const P          = CONFIG.PRECISION;
    const precisionMult = P.EDGE_MULT + (Upgrades.centerMult() - P.EDGE_MULT) * precision;

    const unit = obj.isChroma
      ? CONFIG.OBJECTS.CHROMA_SCORE * M.chromaScoreMult
      : CONFIG.OBJECTS.STAR_SCORE;
    const basePoints  = unit * Math.max(1, state.combo);
    const finalPoints = Math.round(basePoints * precisionMult * M.scoreMult);

    state.score += finalPoints;
    updateScore();
    updateCombo();

    if (settings.scorePopups) {
      showPrecisionFloat(objCenterX, obj.y, finalPoints, precision);
    }

    AudioManager.play(
      (obj.isChroma ? CONFIG.AUDIO.CHROMA_BASE_HZ : CONFIG.AUDIO.CATCH_BASE_HZ) + state.combo * 20,
      'square', 0.1
    );
    createExplosion(obj.x, obj.y, obj.isChroma ? '#fff' : obj.color);
    impactEffect();

    stage.caught++;
    stage.resolved++;

    // v3 — Chroma no longer interrupts the stage. It banks an extra pick for
    // the draft at the end of the stage, so flow is never broken mid-pattern.
    if (obj.isChroma && CONFIG.DRAFT.CHROMA_GRANTS_PICK &&
        stage.bonusPicks < CONFIG.DRAFT.MAX_BONUS_PICKS) {
      stage.bonusPicks++;
      AudioManager.play(CONFIG.AUDIO.MILESTONE_HZ, 'square', 0.35, 0.13);
      showToast('CHROMA — EXTRA PICK', 'toast-chroma');
    }
    updateStageHUD();

    // Lets a dev-console prototype react to a catch without needing its
    // mechanic written into this file first.
    Dev.onCatch({ obj, points: finalPoints, precision, isChroma: !!obj.isChroma });
  }

  /**
   * v3 — A real star hit the floor.
   * @returns {boolean} true if this ends the run.
   */
  function onLiveMissed(obj) {
    const M = Upgrades.mods;
    stage.resolved++;

    // Missing a Chroma is a lost opportunity, not a punishment.
    if (obj.isChroma) {
      state.combo = 0;
      updateCombo();
      updateStageHUD();
      return false;
    }

    stage.missed++;
    state.totalMisses++;

    // AEGIS shields absorb the whole consequence, combo included.
    if (stage.shields > 0) {
      stage.shields--;
      AudioManager.play(CONFIG.AUDIO.SHIELD_HZ, 'triangle', 0.25, 0.14);
      showToast('SHIELD', 'toast-shield');
      updateStageHUD();
      return false;
    }

    state.combo = 0;
    // God mode keeps the feedback — the shake, the sound, the broken combo —
    // and only stops the life draining away, so a stage still reads honestly.
    if (!Dev.godMode()) state.lives -= M.missLifeCost;
    updateLives();
    updateCombo();
    updateStageHUD();
    Dev.onMiss({ obj, isChroma: !!obj.isChroma });
    AudioManager.play(CONFIG.AUDIO.MISS_HZ, 'sawtooth', 0.3, 0.2);
    DOM.container.classList.add('shake');
    setTimeout(() => DOM.container.classList.remove('shake'), 300);

    if (state.lives <= 0) {
      if (M.revives > 0) {
        M.revives--;
        state.lives = 1;
        updateLives();
        AudioManager.play(880, 'sine', 0.5, 0.2);
        showBanner('SECOND WIND', 'One more chance.', 1100, 'banner-revive');
        return false;
      }
      return true;
    }
    return false;
  }

  function gameLoop() {
    if (!state.active) return;
    // A frozen game still ticks the loop so a dev "step" can push exactly one
    // frame through; consumeStep() is false for everyone else.
    if (state.paused && !Dev.consumeStep()) {
      state.gameLoopRaf = requestAnimationFrame(gameLoop);
      return;
    }

    // Dev hooks that move the paddle (autoplay) run first, so the collision
    // box below is built from this frame's position rather than last frame's.
    Dev.onFrame();

    // ── Per-frame caches ──
    state.cachedDifficulty = computeDifficulty();
    const pRect      = getPaddleRect();
    const containerH = layout.containerH;
    const timeScale  = Dev.timeScale();   // 1 unless dev mode says otherwise

    // ── Update falling objects ──
    let gameOverTriggered = false;
    for (let i = activeObjects.length - 1; i >= 0; i--) {
      const poolIdx = activeObjects[i];
      const obj = objectPool[poolIdx];

      obj.y += obj.speed * timeScale;
      obj.el.style.top = obj.y + 'px';

      // Collision: AABB from JS-tracked positions (zero reflows)
      const oBottom = obj.y + obj.size;
      const oRight  = obj.x + obj.size;

      const hit = oBottom >= pRect.top  && obj.y   <= pRect.bottom &&
                  obj.x   <= pRect.right && oRight >= pRect.left;

      if (hit) {
        if (obj.isGhost) {
          onGhostCaught(obj);
        } else {
          onLiveCaught(obj);
        }
        releaseObject(poolIdx);
        continue;
      }

      // Fell off bottom
      if (obj.y > containerH) {
        if (obj.isGhost) {
          onGhostLanded(obj);
        } else if (onLiveMissed(obj)) {
          gameOverTriggered = true;
        }
        releaseObject(poolIdx);
        continue;
      }
    }

    // ── Update particles ──
    updateParticles();

    // ── Handle game over after loop (avoids mutation during iteration) ──
    if (gameOverTriggered) {
      triggerGameOver();
      return;
    }

    state.gameLoopRaf = requestAnimationFrame(gameLoop);
  }

  function startGameLoop() {
    if (state.gameLoopRaf) cancelAnimationFrame(state.gameLoopRaf);
    state.gameLoopRaf = requestAnimationFrame(gameLoop);
  }

  function stopGameLoop() {
    if (state.gameLoopRaf) {
      cancelAnimationFrame(state.gameLoopRaf);
      state.gameLoopRaf = null;
    }
  }

  // ─── 9. STAGE DIRECTOR ─────────────────────────────────────────────────
  //
  // The old model was one recursive setTimeout spawning random stars forever,
  // with difficulty climbing off score and combo. v3 replaces it with an
  // explicit phase machine over a pre-built StageDef:
  //
  //   intro  →  ghost  →  interlude  →  live  →  clearing  →  draft  →  intro…
  //
  // Every stage is authored before a single star drops, which is what makes
  // the ghost pass possible: the preview and the real thing are literally the
  // same data played twice.

  const stage = {
    num:         0,      // 1-based stage number
    def:         null,   // StageDef from StageGen.build()
    phase:       'idle', // idle | intro | ghost | interlude | live | clearing | draft
    frameIdx:    0,      // index of the next frame to fire
    starsTotal:  0,      // real stars in this stage (after ECHO injection)
    ghostShown:  0,      // ghost stars released so far this pass
    resolved:    0,      // real stars caught or missed
    caught:      0,
    missed:      0,
    ghostCatches: 0,
    shields:     0,
    bonusPicks:  0,      // extra draft picks banked from Chroma catches
    pendingPicks: 0,
    scoreAtStart: 0,
  };

  // ── Pause-aware timer ────────────────────────────────────────────────────
  // Everything the director schedules goes through this one timer so that a
  // pause freezes the stage exactly where it is and a resume continues from
  // the same point rather than restarting the frame.

  let _stTimer = null, _stFn = null, _stDueAt = 0, _stRemain = 0;

  function stSchedule(fn, ms) {
    if (_stTimer) { clearTimeout(_stTimer); _stTimer = null; }
    // Scaling here rather than at each call site means frame gaps, banners and
    // tail polling all stretch or compress together, so a stage played at 4x
    // keeps its exact rhythm. Divides by 1 for everyone but a developer.
    const wait = Math.max(0, ms / Dev.timeScale());
    _stFn    = fn;
    _stDueAt = performance.now() + wait;
    _stTimer = setTimeout(() => {
      _stTimer = null;
      _stFn    = null;
      fn();
    }, wait);
  }

  function stPause() {
    if (!_stTimer) { _stRemain = 0; return; }
    _stRemain = Math.max(0, _stDueAt - performance.now());
    clearTimeout(_stTimer);
    _stTimer = null;
  }

  function stResume() {
    if (!_stFn) return;
    stSchedule(_stFn, _stRemain > 0 ? _stRemain : 16);
  }

  function stCancel() {
    if (_stTimer) clearTimeout(_stTimer);
    _stTimer = null;
    _stFn    = null;
    _stRemain = 0;
  }

  // ── ECHO perk: inject mirrored twins into the authored stage ─────────────
  //
  // Done here, before either pass runs, so the ghost preview stays perfectly
  // truthful — the twins appear in the rehearsal exactly as they will live.

  function applyEchoPerk(def) {
    const every = Upgrades.mods.echoEvery;
    if (!every) return def;
    let n = 0;
    for (const frame of def.frames) {
      const twins = [];
      for (const s of frame.stars) {
        if (s.isChroma || s.isEcho) continue;
        n++;
        if (n % every === 0) {
          twins.push({
            nx:       1 - s.nx,
            ghostNx:  1 - s.ghostNx,
            lying:    s.lying,
            isChroma: false,
            isEcho:   true,
            hue:      (s.hue + 180) % 360,
          });
        }
      }
      frame.stars.push(...twins);
    }
    def.starCount = def.frames.reduce((a, f) => a + f.stars.length, 0);
    return def;
  }

  // ── Spawning ─────────────────────────────────────────────────────────────

  /**
   * Put one star on screen.
   * @param {number} nx      normalised centre x (0..1)
   * @param {object} starDef StarDef from the StageDef
   * @param {boolean} isGhost
   */
  function spawnStar(nx, starDef, isGhost) {
    const obj = acquireObject();
    if (!obj) return false;          // pool exhausted — extremely unlikely at 72

    const size   = starDef.isChroma ? CONFIG.OBJECTS.CHROMA_SIZE : CONFIG.OBJECTS.STAR_SIZE;
    const centre = nx * layout.containerW;
    const x      = Math.max(0, Math.min(layout.containerW - size, centre - size / 2));
    const color  = starDef.isChroma ? 'transparent' : `hsl(${starDef.hue},80%,60%)`;
    const speed  = stage.def.speed * (isGhost ? Upgrades.ghostTimeScale() : 1);

    obj.x        = x;
    obj.y        = -50;
    obj.speed    = speed;
    obj.size     = size;
    obj.isChroma = !!starDef.isChroma;
    obj.isGhost  = !!isGhost;
    obj.isEcho   = !!starDef.isEcho;
    obj.lying    = !!starDef.lying;
    obj.color    = color;

    const el = obj.el;
    el.style.left       = x + 'px';
    el.style.top        = '-50px';
    el.style.width      = size + 'px';
    el.style.height     = size + 'px';
    el.style.clipPath   = starDef.isChroma ? 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)' : '';
    el.style.display    = 'block';

    if (isGhost) {
      // Ghosts are deliberately washed out and outlined — never mistakable
      // for a live star, even at a glance.
      el.classList.add('ghost-obj');
      el.style.opacity    = Upgrades.ghostOpacity();
      el.style.background = starDef.isChroma ? '#ffffff' : color;
      el.style.boxShadow  = '0 0 8px ' + (starDef.isChroma ? '#ffffff' : color);
      if (starDef.isChroma) el.classList.add('ghost-chroma');
      stage.ghostShown++;
    } else {
      el.style.opacity    = '1';
      el.style.background = color;
      el.style.boxShadow  = '0 0 10px ' + color;
      if (starDef.isChroma) el.classList.add('rainbow');
    }
    return true;
  }

  /** Fire every star in one frame. */
  function spawnFrame(frame, isGhost) {
    for (const s of frame.stars) {
      spawnStar(isGhost ? s.ghostNx : s.nx, s, isGhost);
    }
  }

  /**
   * DISTORTION hook: a phantom frame shows a brief floor marker during the
   * ghost pass but drops no ghost star. Dormant unless
   * CONFIG.DISTORTION.START_STAGE is set above zero.
   */
  function telegraphPhantom(frame) {
    for (const s of frame.stars) {
      dropGhostMarker(s.ghostNx * layout.containerW, false);
    }
    AudioManager.play(CONFIG.GHOST.LAND_HZ * 0.75, 'sine', 0.06, 0.03);
  }

  // ── Phase machine ────────────────────────────────────────────────────────

  function beginStage(n) {
    if (!state.active) return;

    stage.num          = n;
    stage.def          = applyEchoPerk(StageGen.build(n, Upgrades.mods));
    stage.phase        = 'intro';
    stage.frameIdx     = 0;
    stage.starsTotal   = stage.def.starCount;
    stage.ghostShown   = 0;
    stage.resolved     = 0;
    stage.caught       = 0;
    stage.missed       = 0;
    stage.ghostCatches = 0;
    stage.shields      = Upgrades.mods.shieldsPerStage;
    stage.bonusPicks   = 0;
    stage.scoreAtStart = state.score;

    state.cachedDifficulty = stage.def.difficulty;

    clearGhostMarkers();
    releaseAllObjects();
    hideStagePanels();
    updateStageHUD();

    AudioManager.play(CONFIG.AUDIO.STAGE_START_HZ, 'triangle', 0.35, 0.13);
    showBanner('STAGE ' + n, stageBlurb(stage.def), CONFIG.STAGE.INTRO_MS, 'banner-stage');

    Dev.onStageBegin();

    stSchedule(() => {
      if (CONFIG.GHOST.ENABLED) startPass('ghost');
      else                      startPass('live');
    }, CONFIG.STAGE.INTRO_MS);
  }

  /** One-line flavour under the stage banner — tells you what's coming. */
  function stageBlurb(def) {
    const bits = [def.starCount + ' STARS'];
    if (def.frames.some(f => f.stars.length > 1)) bits.push('VOLLEYS');
    if (def.frames.some(f => f.stars.some(s => s.isChroma))) bits.push('CHROMA');
    if (def.hasPhantoms || def.hasLies) bits.push('SIGNAL UNSTABLE');
    return bits.join('  ·  ');
  }

  function startPass(kind) {
    if (!state.active) return;
    stage.phase    = kind;
    stage.frameIdx = 0;

    if (kind === 'ghost') {
      stage.ghostShown = 0;
      showBanner('GHOST PASS', 'Watch where they land. Nothing counts yet.',
                 1200, 'banner-ghost');
      DOM.container.classList.add('ghost-phase');
    } else {
      stage.resolved = 0;
      DOM.container.classList.remove('ghost-phase');
      showBanner('GO', '', 650, 'banner-go');
      AudioManager.play(CONFIG.AUDIO.GO_HZ, 'sine', 0.2);
    }

    updateStageHUD();
    nextFrame();
  }

  function nextFrame() {
    if (!state.active) return;

    const def     = stage.def;
    const isGhost = stage.phase === 'ghost';

    if (stage.frameIdx >= def.frames.length) {
      waitForPassEnd();
      return;
    }

    const frame = def.frames[stage.frameIdx++];

    if (isGhost && frame.phantom) {
      telegraphPhantom(frame);
    } else {
      spawnFrame(frame, isGhost);
    }

    updateStageHUD();

    // The ghost pass is time-compressed by exactly the same factor its stars
    // are sped up by, so the rhythm the player learns is the real rhythm.
    const scale = isGhost ? Upgrades.ghostTimeScale() : 1;
    stSchedule(nextFrame, frame.gap / scale);
  }

  /** Poll until every star from the current pass has left the screen. */
  function waitForPassEnd() {
    if (!state.active) return;
    const isGhost = stage.phase === 'ghost';

    if (countActive(isGhost) > 0) {
      stSchedule(waitForPassEnd, CONFIG.STAGE.TAIL_POLL_MS);
      return;
    }

    if (isGhost) {
      stage.phase = 'interlude';
      updateStageHUD();
      if (!Upgrades.mods.keepGhostMarkers) fadeGhostMarkers();
      showBanner('YOUR TURN', 'Same stage. This time it counts.',
                 CONFIG.STAGE.GHOST_TO_LIVE_MS, 'banner-ready');
      stSchedule(() => startPass('live'), CONFIG.STAGE.GHOST_TO_LIVE_MS);
    } else {
      endStage();
    }
  }

  function endStage() {
    if (!state.active) return;

    stage.phase = 'clearing';
    state.stagesCleared = stage.num;
    fadeGhostMarkers();
    updateStageHUD();

    const M       = Upgrades.mods;
    const perfect = stage.missed === 0;

    const clearBonus   = CONFIG.SCORING.STAGE_CLEAR_BASE * stage.num;
    const perfectBonus = perfect
      ? (CONFIG.SCORING.PERFECT_STAGE_BONUS + M.perfectBonus) * stage.num
      : 0;
    // PRECOGNITION pays out here rather than per-catch, so the ghost pass
    // itself stays completely free of score feedback.
    const ghostBonus = M.ghostBounty * stage.ghostCatches * stage.num;

    const total = Math.round((clearBonus + perfectBonus + ghostBonus) * M.scoreMult);
    state.score += total;
    updateScore();
    if (perfect) state.perfectStages++;

    AudioManager.play(CONFIG.AUDIO.STAGE_CLEAR_HZ, 'triangle', 0.5, 0.16);
    showStageClear({ perfect, clearBonus, perfectBonus, ghostBonus, total });

    // Appends a row to the dev run log and fires any prototype's onStageEnd.
    // Runs after scoring so the hook sees the finished numbers.
    Dev.onStageEnd({ perfect, clearBonus, perfectBonus, ghostBonus, total });

    stSchedule(openDraft, CONFIG.STAGE.CLEAR_PANEL_MS);
  }

  function showStageClear(r) {
    hideBanner();
    DOM.stageClearTitle.textContent = r.perfect ? 'PERFECT STAGE' : 'STAGE CLEAR';
    DOM.stageClearTitle.className   = 'overlay-title' + (r.perfect ? ' perfect' : '');

    const rows = [
      ['STARS CAUGHT', stage.caught + ' / ' + stage.starsTotal],
      ['MISSES',       stage.missed],
      ['GHOSTS TOUCHED', stage.ghostCatches],
      ['STAGE SCORE',  '+' + (state.score - stage.scoreAtStart)],
    ];
    if (r.perfectBonus) rows.push(['PERFECT BONUS', '+' + Math.round(r.perfectBonus * Upgrades.mods.scoreMult)]);
    if (r.ghostBonus)   rows.push(['PRECOGNITION',  '+' + Math.round(r.ghostBonus   * Upgrades.mods.scoreMult)]);

    DOM.stageClearStats.innerHTML = rows.map(([k, v]) =>
      `<div class="sc-row"><span>${k}</span><span>${v}</span></div>`).join('');

    DOM.stageClearPanel.style.display = 'block';
  }

  function hideStagePanels() {
    DOM.stageClearPanel.style.display = 'none';
    DOM.draftPanel.style.display      = 'none';
  }

  function stopStageDirector() {
    stCancel();
    stage.phase = 'idle';
    DOM.container.classList.remove('ghost-phase');
  }

  // ─── 10. DRAFT ─────────────────────────────────────────────────────────
  //
  // The replayability engine. One pick per stage, plus one per Chroma caught.
  // Perks stack, several carry real downsides, and the hand is drawn from the
  // seeded RNG — so a seed is a genuinely reproducible run.

  function openDraft() {
    if (!state.active) return;
    stage.phase = 'draft';
    stage.pendingPicks = 1 + stage.bonusPicks;
    DOM.stageClearPanel.style.display = 'none';
    updateStageHUD();
    dealDraftHand();
  }

  function dealDraftHand() {
    // A dev-forced hand takes the place of the roll exactly once; forcedHand()
    // is null for every normal player and clears itself after it is dealt.
    const hand = Dev.forcedHand() || Upgrades.rollHand(stage.num + 1);

    if (!hand.length) { finishDraft(); return; }

    DOM.draftTitle.textContent = 'CHOOSE AN UPGRADE';
    const picksLeft = stage.pendingPicks;
    DOM.draftSub.textContent =
      (picksLeft > 1 ? picksLeft + ' PICKS REMAINING  ·  ' : '') +
      'ENTERING STAGE ' + (stage.num + 1);

    DOM.draftCards.innerHTML = hand.map(p => `
      <button class="draft-card rarity-${p.rarity}" data-perk="${p.id}">
        <span class="draft-icon">${p.icon}</span>
        <span class="draft-name">${p.name}</span>
        <span class="draft-rarity">${p.rarity.toUpperCase()}</span>
        <span class="draft-desc">${p.desc}</span>
        ${Upgrades.stacksOf(p.id) ? `<span class="draft-owned">OWNED x${Upgrades.stacksOf(p.id)}</span>` : ''}
      </button>`).join('');

    DOM.draftCards.querySelectorAll('.draft-card').forEach(btn => {
      btn.addEventListener('click', () => pickPerk(btn.dataset.perk));
    });

    DOM.draftRerollBtn.textContent = 'REROLL (' + Upgrades.rerolls + ')';
    DOM.draftRerollBtn.disabled    = Upgrades.rerolls <= 0;
    DOM.draftPanel.style.display   = 'block';
  }

  function pickPerk(perkId) {
    AudioManager.play(CONFIG.AUDIO.DRAFT_PICK_HZ, 'square', 0.3, 0.14);

    Upgrades.take(perkId, {
      grantLife: n => { state.lives += n; updateLives(); },
    });

    // Perks that change the paddle take effect immediately.
    setPaddleWidth(Upgrades.paddleWidth());
    renderPerkStrip();

    stage.pendingPicks--;
    if (stage.pendingPicks > 0) dealDraftHand();
    else finishDraft();
  }

  function finishDraft() {
    DOM.draftPanel.style.display = 'none';
    beginStage(stage.num + 1);
  }

  DOM.draftRerollBtn.addEventListener('click', () => {
    if (!Upgrades.spendReroll()) return;
    AudioManager.play(440, 'sine', 0.15, 0.1);
    dealDraftHand();
  });

  DOM.draftSkipBtn.addEventListener('click', () => {
    AudioManager.play(300, 'sine', 0.15, 0.08);
    stage.pendingPicks--;
    if (stage.pendingPicks > 0) dealDraftHand();
    else finishDraft();
  });

  // ─── 11. PAUSE ───────────────────────────────────────────────────────────────

  /** True when a menu owns the screen and gameplay input should be ignored. */
  function inMenuPhase() {
    return stage.phase === 'draft' || stage.phase === 'clearing';
  }

  /**
   * @param {boolean} showMenu - show the pause overlay
   */
  function pauseGame(showMenu = true) {
    if (!state.active || state.paused) return;
    state.paused = true;
    stPause();
    stopGameBG();
    if (showMenu) DOM.pauseMenu.style.display = 'block';
  }

  function resumeGame() {
    if (!state.active) return;
    DOM.pauseMenu.style.display = 'none';
    startGameBG();
    // A 3-2-1 before unfreezing, so nobody eats a star the instant they resume.
    startCountdown(() => {
      state.paused = false;
      stResume();
    });
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    // A space typed into a text field is a space, not a pause. Without this
    // the seed box swallows spaces and the dev console's code editor pauses
    // the game every time you hit the spacebar.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
              t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    if (!state.active || state.countingDown) return;
    if (inMenuPhase()) return;
    if (DOM.settingsScreen.style.display === 'flex') return;
    if (state.paused) resumeGame();
    else pauseGame(true);
  });

  DOM.resumeBtn.addEventListener('click', () => resumeGame());

  // ─── 12. COUNTDOWN ──────────────────────────────────────────────────────────

  /**
   * 3-2-1-GO overlay. Runs on real timers (not the director timer) and calls
   * `onDone` when it finishes.
   */
  function startCountdown(onDone) {
    DOM.countdown.style.display = 'block';
    state.countingDown = true;
    let count = 3;

    function tick() {
      if (!state.active) { DOM.countdown.style.display = 'none'; state.countingDown = false; return; }
      if (count > 0) {
        AudioManager.play(CONFIG.AUDIO.COUNTDOWN_HZ[3 - count], 'sine', 0.1);
        DOM.countdown.innerText = count;
        count--;
        setTimeout(tick, 1000);
      } else {
        AudioManager.play(CONFIG.AUDIO.GO_HZ, 'sine', 0.2);
        DOM.countdown.style.display = 'none';
        state.countingDown = false;
        if (onDone) onDone();
      }
    }

    tick();
  }

  // ─── 13. GAME OVER + LEADERBOARD UI ─────────────────────────────────────────

  async function triggerGameOver() {
    state.active = false;
    stopStageDirector();
    stopGameLoop();
    releaseAllObjects();
    releaseAllParticles();
    clearGhostMarkers();
    hideBanner();
    hideStagePanels();
    DOM.precisionFloatPool.innerHTML = '';
    stopGameBG();
    stopMusic();
    AudioManager.play(CONFIG.AUDIO.GAME_OVER_HZ, 'sine', 1.0, 0.3);

    if (state.score > state.bestScore) state.bestScore = state.score;

    DOM.finalScore.innerText = 'SCORE: '      + state.score;
    DOM.highScore.innerText  = 'BEST SCORE: ' + state.bestScore;
    DOM.maxCombo.innerText   = 'BEST COMBO: x' + state.sessionMaxCombo;

    // v3 — run summary: the "one more run" hook. Reaching a deeper stage is
    // a cleaner brag than raw score, and the seed makes the run repeatable.
    const reached = Math.max(1, stage.num);
    const perkList = Upgrades.ownedSummary();
    DOM.runSummary.innerHTML = `
      <div class="rs-row"><span>STAGE REACHED</span><span>${reached}</span></div>
      <div class="rs-row"><span>STAGES CLEARED</span><span>${state.stagesCleared}</span></div>
      <div class="rs-row"><span>PERFECT STAGES</span><span>${state.perfectStages}</span></div>
      <div class="rs-row"><span>GHOSTS TOUCHED</span><span>${state.totalGhostCatches}</span></div>
      <div class="rs-row"><span>SEED</span><span class="rs-seed">${state.runSeedCode}</span></div>
      ${perkList.length ? `<div class="rs-perks">${perkList.map(p =>
        `<span class="perk-chip rarity-${p.rarity}" title="${p.name} — ${p.desc}">${p.icon}${p.stacks > 1 ? '<b>x' + p.stacks + '</b>' : ''}</span>`
      ).join('')}</div>` : ''}`;

    Dev.onGameOver();

    // v3.2 — a run that dev mode touched never gets offered to the board, no
    // matter how good the number looks. An untouched run from a dev account
    // still posts normally.
    if (Dev.tainted()) {
      DOM.nameEntry.style.display = 'none';
      DOM.runSummary.insertAdjacentHTML('beforeend',
        '<div class="dv-tainted-note">DEV RUN — NOT ELIGIBLE FOR THE BOARD</div>');
    } else if (await Leaderboard.qualifies(state.score, state.sessionMaxCombo)) {
      showNameEntry();
    } else {
      DOM.nameEntry.style.display = 'none';
    }

    DOM.viewLbBtn.style.display = 'inline-block';
    DOM.gameOver.style.display  = 'block';
    StarCursor.enable();
  }

  /**
   * v3.1 — the submission row adapts to who is playing.
   * Signed in: nothing to type, the callsign is already known.
   * Guest: an input prefilled with the last name used on this device.
   */
  function showNameEntry() {
    const signedIn = Auth.isLoggedIn();

    DOM.nameEntry.style.display       = 'block';
    DOM.nameEntryUser.style.display   = signedIn ? 'flex' : 'none';
    DOM.nameEntryGuest.style.display  = signedIn ? 'none' : 'flex';
    DOM.nameEntrySignin.style.display = 'none';   // offered after the post
    DOM.submitStatus.textContent      = '';
    DOM.submitStatus.className        = 'submit-status';
    DOM.submitScoreBtn.disabled       = false;
    DOM.submitScoreUserBtn.disabled   = false;

    if (signedIn) {
      DOM.postingAsName.textContent = Auth.displayName();
    } else {
      DOM.playerName.value = Auth.guestName();
      if (window.matchMedia('(min-width: 780px)').matches) {
        setTimeout(() => { DOM.playerName.focus(); DOM.playerName.select(); }, 50);
      }
    }
  }

  async function submitRun(name) {
    // Belt and braces: the panel above is already hidden for a tainted run,
    // but this is the only door to the board and it should be the thing that
    // is actually locked.
    if (Dev.tainted()) {
      DOM.submitStatus.className   = 'submit-status is-error';
      DOM.submitStatus.textContent = 'DEV RUN — NOT ELIGIBLE';
      return;
    }

    DOM.submitScoreBtn.disabled     = true;
    DOM.submitScoreUserBtn.disabled = true;
    DOM.submitStatus.className      = 'submit-status';
    DOM.submitStatus.textContent    = 'POSTING…';

    const ok = await Leaderboard.submit(name, state.score, state.sessionMaxCombo);

    if (!ok) {
      DOM.submitStatus.className      = 'submit-status is-error';
      DOM.submitStatus.textContent    = "COULDN'T REACH THE BOARD — TRY AGAIN";
      DOM.submitScoreBtn.disabled     = false;
      DOM.submitScoreUserBtn.disabled = false;
      return;
    }

    AudioManager.play(880, 'sine', 0.4, 0.15);

    if (Auth.isLoggedIn()) {
      DOM.nameEntry.style.display = 'none';
      return;
    }

    // Guests keep the panel so we can offer the upsell — but only now that the
    // run is safely on the board, since signing in with a provider reloads the page.
    DOM.nameEntryGuest.style.display  = 'none';
    DOM.submitStatus.textContent      = 'SCORE POSTED AS ' + name;
    DOM.nameEntrySignin.style.display = 'inline-block';
  }

  DOM.submitScoreBtn.addEventListener('click', () => {
    const typed = Auth.sanitizeName(DOM.playerName.value) || 'ANON';
    Auth.setGuestName(typed);   // so the next run comes prefilled
    submitRun(typed);
  });

  DOM.submitScoreUserBtn.addEventListener('click', () => submitRun(Auth.displayName()));

  DOM.nameEntrySignin.addEventListener('click', () => AccountUI.open('gameover'));

  DOM.playerName.addEventListener('keydown', e => {
    if (e.key === 'Enter') DOM.submitScoreBtn.click();
  });

  // ── Leaderboard rendering ───────────────────────────────────────────────────

  function _escHtml(str) {
    return String(str).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function _renderTable(entries, field, label) {
    if (!entries.length) {
      return `<p class="lb-empty">No entries yet — be the first!</p>`;
    }
    const medals = ['🥇', '🥈', '🥉'];

    // v3.1 — find yourself on the board. Signed-in pilots match on id;
    // guests fall back to the name this device remembers.
    const myId    = Auth.state().userId;
    const myGuest = myId ? null : Auth.guestName();

    const rows = entries.map((e, i) => {
      const isMe = myId
        ? e.userId === myId
        : !!(myGuest && !e.registered && e.name === myGuest);
      return `
      <tr class="lb-row${i < 3 ? ' lb-podium' : ''}${isMe ? ' lb-you' : ''}">
        <td class="lb-rank">${medals[i] || (i + 1)}</td>
        <td class="lb-name">${_escHtml(e.name)}${e.registered
          ? '<span class="lb-verified" title="Registered pilot">★</span>' : ''}</td>
        <td class="lb-val">${field === 'combo' ? 'x' : ''}${e[field]}</td>
        <td class="lb-date">${_escHtml(e.date)}</td>
      </tr>`;
    }).join('');
    return `
      <table class="lb-table">
        <thead><tr><th>#</th><th>PILOT</th><th>${label}</th><th>DATE</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  async function renderLeaderboard() {
    const { scores, combos } = await Leaderboard.getAll();
    DOM.lbScoresPanel.innerHTML = _renderTable(scores, 'score', 'SCORE');
    DOM.lbCombosPanel.innerHTML = _renderTable(combos, 'combo', 'COMBO');
  }

  // Tab switching
  DOM.lbTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      DOM.lbTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      DOM.lbScoresPanel.style.display = which === 'scores' ? 'block' : 'none';
      DOM.lbCombosPanel.style.display = which === 'combos' ? 'block' : 'none';
    });
  });

  function showLeaderboard(fromGameOver = false) {
    state.lbOpenedFromGameOver = fromGameOver;
    renderLeaderboard();
    // Reset tabs to scores view
    DOM.lbTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'scores'));
    DOM.lbScoresPanel.style.display = 'block';
    DOM.lbCombosPanel.style.display = 'none';

    if (fromGameOver) {
      DOM.gameOver.style.display = 'none';
      DOM.container.style.display   = 'none';
    } else {
      DOM.startScreen.style.display = 'none';
      TitleBG.stop();
      stopTitleMusic();
    }
    DOM.lbScreen.style.display = 'flex';
    startLbMusic();
  }

  DOM.leaderboardBtn.addEventListener('click', () => showLeaderboard(false));
  DOM.viewLbBtn.addEventListener('click',      () => showLeaderboard(true));

  DOM.lbBackBtn.addEventListener('click', () => {
    DOM.lbScreen.style.display = 'none';
    stopLbMusic();
    if (state.lbOpenedFromGameOver) {
      DOM.container.style.display = 'block';
      DOM.gameOver.style.display = 'block';
    } else {
      DOM.startScreen.style.display = 'flex';
      if (settings.fancyStars) TitleBG.start();
      startTitleMusic();
    }
  });

  // ─── 14. GAME START / RESET ─────────────────────────────────────────────────

  // ─── 14a. TUTORIAL SYSTEM ─────────────────────────────────────────────────

  const TUTORIAL_KEY = 'starcatcher_tutorial_done';

  function isFirstTimePlaying() {
    try { return !localStorage.getItem(TUTORIAL_KEY); }
    catch (e) { return false; }
  }

  function markTutorialDone() {
    try { localStorage.setItem(TUTORIAL_KEY, '1'); }
    catch (e) { /* silently fail */ }
  }

  const TUTORIAL_STEPS = [
    {
      title: 'WELCOME, PILOT',
      titleColor: 'var(--cyan)',
      body: `<p>Your mission: catch falling stars with your paddle before they slip past.</p>
             <p>Move your <span style="color:var(--cyan);">mouse</span> to control the paddle.</p>`,
    },
    {
      title: 'PRECISION MATTERS',
      titleColor: 'var(--magenta)',
      body: `<p>Catching stars near the <span style="color:var(--magenta);font-weight:bold;">center</span> of your paddle scores up to <span style="color:var(--magenta);font-weight:bold;">2x points</span>.</p>
             <p>The edges score 1x. Aim for the glow!</p>
             <div class="tutorial-visual">
               <div class="tutorial-paddle-demo"></div>
               <div class="tutorial-paddle-labels">
                 <span class="edge-label">1x</span>
                 <span class="center-label">★ 2x ★</span>
                 <span class="edge-label">1x</span>
               </div>
             </div>`,
    },
    {
      title: 'COMBO STREAK',
      titleColor: 'var(--gold)',
      body: `<p>Each consecutive catch builds your <span style="color:var(--gold);font-weight:bold;">combo multiplier</span>.</p>
             <p>Miss a star and you lose a <span style="color:var(--red);">❤ life</span> and your combo resets.</p>
             <p style="margin-top:12px;color:rgba(255,255,255,0.5);font-size:13px;">Combine high combos with center catches for massive scores!</p>`,
    },
    {
      title: 'CHROMA',
      titleColor: '#ffcc00',
      body: `<p>Rare <span style="color:#ffcc00;font-weight:bold;">Chroma</span> gems appear occasionally — shimmering rainbow diamonds.</p>
             <p>Catching one banks an <span style="color:var(--magenta);font-weight:bold;">extra upgrade pick</span> for the end of the stage. It never interrupts the run.</p>
             <p style="margin-top:12px;color:rgba(255,255,255,0.5);font-size:13px;">Missing a Chroma won't cost a life, but it resets your combo.</p>`,
    },
    {
      title: 'THE GHOST PASS',
      titleColor: 'rgba(160,220,255,0.95)',
      body: `<p>Every stage plays <span style="color:#9fd8ff;font-weight:bold;">twice</span>.</p>
             <p>First comes the <span style="color:#9fd8ff;font-weight:bold;">ghost pass</span> — a faded, sped-up rehearsal showing exactly where every star will fall.</p>
             <p>Ghost stars are <span style="font-weight:bold;">information only</span>. Catching them scores nothing. Missing them costs nothing. Use them to learn the shape.</p>
             <p style="margin-top:12px;color:rgba(255,255,255,0.5);font-size:13px;">Then the same stage runs for real — and this time it counts.</p>`,
    },
    {
      title: 'BUILD YOUR RUN',
      titleColor: 'var(--magenta)',
      body: `<p>Clear a stage and you <span style="color:var(--magenta);font-weight:bold;">draft an upgrade</span> from three random options.</p>
             <p>They stack. Some have real downsides. A wider paddle scores less; a hairline paddle scores far more.</p>
             <p style="margin-top:12px;color:rgba(255,255,255,0.5);font-size:13px;">Stages get longer and tighter as you go — but only with the stage number, never because you're doing well.</p>`,
    },
    {
      title: 'READY FOR LAUNCH',
      titleColor: 'var(--cyan)',
      body: `<p>Press <span style="color:var(--cyan);font-weight:bold;">SPACE</span> to pause at any time.</p>
             <p style="margin-top:14px;font-size:18px;color:var(--cyan);letter-spacing:3px;">Good luck out there, pilot!</p>`,
    },
  ];

  let _tutorialStep = 0;

  function buildTutorialDOM() {
    DOM.tutorialStepContainer.innerHTML = '';
    DOM.tutorialDots.innerHTML = '';

    TUTORIAL_STEPS.forEach((step, i) => {
      // Step content
      const div = document.createElement('div');
      div.className = 'tutorial-step' + (i === 0 ? ' active' : '');
      div.innerHTML = `<h3 style="color:${step.titleColor}">${step.title}</h3>${step.body}`;
      DOM.tutorialStepContainer.appendChild(div);

      // Dot
      const dot = document.createElement('span');
      dot.className = 'tutorial-dot' + (i === 0 ? ' active' : '');
      DOM.tutorialDots.appendChild(dot);
    });
  }

  function showTutorial(onComplete) {
    _tutorialStep = 0;
    buildTutorialDOM();
    DOM.tutorialOverlay.style.display = 'flex';

    const steps = DOM.tutorialStepContainer.querySelectorAll('.tutorial-step');
    const dots  = DOM.tutorialDots.querySelectorAll('.tutorial-dot');

    function goToStep(idx) {
      steps.forEach((s, i) => s.classList.toggle('active', i === idx));
      dots.forEach((d, i)  => d.classList.toggle('active', i === idx));
      DOM.tutorialNextBtn.textContent = idx === TUTORIAL_STEPS.length - 1 ? 'LAUNCH! 🚀' : 'NEXT →';
    }

    // Remove old listener if any
    const nextBtn = DOM.tutorialNextBtn;
    const newBtn  = nextBtn.cloneNode(true);
    nextBtn.parentNode.replaceChild(newBtn, nextBtn);
    DOM.tutorialNextBtn = newBtn;

    newBtn.addEventListener('click', () => {
      AudioManager.play(660, 'sine', 0.08, 0.1);
      _tutorialStep++;
      if (_tutorialStep >= TUTORIAL_STEPS.length) {
        DOM.tutorialOverlay.style.display = 'none';
        markTutorialDone();
        if (onComplete) onComplete();
      } else {
        goToStep(_tutorialStep);
      }
    });

    goToStep(0);
  }

  // ─── 14b. GAME START LOGIC ────────────────────────────────────────────────

  function startGame() {
    AudioManager.resume();

    // v3 — an entered seed reproduces a run exactly: same stage layouts,
    // same draft hands. Blank means "surprise me".
    const raw = (DOM.seedInput.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    state.forcedSeed = raw ? RNG.seed(raw) : 0;

    // First-time tutorial check — show tutorial before launching
    if (isFirstTimePlaying()) {
      TitleBG.stop();
      stopTitleMusic();
      stopLbMusic();
      StarCursor.disable();
      DOM.startScreen.style.display    = 'none';
      DOM.lbScreen.style.display       = 'none';
      DOM.settingsScreen.style.display = 'none';
      DOM.accountScreen.style.display  = 'none';
      DOM.container.style.display      = 'block';

      // Prep the game visually so tutorial has context
      updateLayout();
      startGameBG();

      showTutorial(() => {
        // After tutorial completes, actually start the game
        _launchGame();
      });
      return;
    }

    _launchGame();
  }

  function _launchGame() {
    AudioManager.resume();
    TitleBG.stop();
    stopTitleMusic();
    stopLbMusic();
    StarCursor.disable();

    // Hide all screens / overlays
    DOM.startScreen.style.display    = 'none';
    DOM.lbScreen.style.display       = 'none';
    DOM.settingsScreen.style.display = 'none';
    DOM.accountScreen.style.display  = 'none';
    DOM.gameOver.style.display       = 'none';
    DOM.countdown.style.display      = 'none';
    DOM.nameEntry.style.display      = 'none';
    DOM.viewLbBtn.style.display      = 'none';
    DOM.tutorialOverlay.style.display = 'none';
    DOM.container.style.display      = 'block';

    // Reset timers
    stopStageDirector();
    stopGameBG();
    clearTimeout(state.discoveryTimer);

    // v3 — a fresh, reproducible seed drives stage layout AND draft hands.
    const seed = (typeof state.forcedSeed === 'number' && state.forcedSeed)
      ? RNG.seed(state.forcedSeed)
      : RNG.reseed();

    // Reset state
    Object.assign(state, {
      score:           0,
      lives:           CONFIG.GAME.INITIAL_LIVES,
      combo:           0,
      sessionMaxCombo: 0,
      active:          true,
      paused:          false,
      countingDown:    false,
      paddleExpanded:      false,
      discoveryTimer:      null,
      stagesCleared:       0,
      totalGhostCatches:   0,
      totalMisses:         0,
      perfectStages:       0,
      runSeed:             seed,
      runSeedCode:         RNG.seedCode(),
    });

    // v3 — wipe the build from the previous run.
    Upgrades.reset();

    // v3.2 — a fresh run is "clean" until dev mode touches it. This is also
    // where a preset build from a restored scenario gets applied.
    Dev.onRunStart();

    // Reset UI
    setPaddleWidth(Upgrades.paddleWidth());
    DOM.paddleWrap.style.left = '50%';
    DOM.comboEl.style.opacity = '0';
    updateScore();
    updateLives();

    // v2.2: initialise pools + layout cache
    updateLayout();
    paddleState.x = layout.containerW / 2;
    paddleState.width = Upgrades.paddleWidth();
    initObjectPool();
    initParticlePool();
    initMarkerPool();
    DOM.precisionFloatPool.innerHTML = '';  // clear any lingering float text

    // v3 — stage HUD reset
    Object.assign(stage, {
      num: 0, def: null, phase: 'idle', frameIdx: 0,
      starsTotal: 0, ghostShown: 0, resolved: 0, caught: 0, missed: 0,
      ghostCatches: 0, shields: 0, bonusPicks: 0, pendingPicks: 0,
      scoreAtStart: 0,
    });
    hideStagePanels();
    hideBanner();
    renderPerkStrip();
    updateStageHUD();
    DOM.seedLabel.textContent = 'SEED ' + state.runSeedCode;

    startGameBG();
    startGameLoop();
    startMusic();

    // v3 — the run begins with stage 1's ghost pass, not a spawn stream.
    // startStage() returns 1 for everyone except a developer who asked to
    // open somewhere else.
    beginStage(Dev.startStage(1));
  }

  // v3.4 — the gate covers the whole page, so these are unreachable while it
  // is up. Guarded anyway: the buttons are still focusable by keyboard, and a
  // run must never start into a window that can't display it fairly.
  function startGameGuarded() {
    if (Viewport.isBlocked()) return;
    startGame();
  }

  DOM.startGameBtn.addEventListener('click', startGameGuarded);
  DOM.rebootBtn.addEventListener('click',    startGameGuarded);

  // ─── 15. ??? ─────────────────────────────────────────────────────────

  let _eeStep = 0, _eeTimer = null;
  const EE_SEQ = CONFIG.E_E.SEQUENCE;

  DOM.startScreen.addEventListener('mousemove', e => {
    const rect = DOM.startScreen.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w  = rect.width;
    const h  = rect.height;

    // Detect which corner the cursor is in
    let corner = null;
    if      (mx < w * 0.1 && my > h * 0.9) corner = 'BL';
    else if (mx > w * 0.9 && my < h * 0.1) corner = 'TR';
    else if (mx > w * 0.9 && my > h * 0.9) corner = 'BR';
    else if (mx < w * 0.1 && my < h * 0.1) corner = 'TL';

    if (corner === EE_SEQ[_eeStep] && _eeStep < 4) {
      if (!_eeTimer) {
        _eeTimer = setTimeout(() => {
          DOM.eeCorners[corner].style.display = 'block';
          AudioManager.play(660 + _eeStep * 100, 'sine', 0.5, 0.05);
          _eeStep++;
          if (_eeStep === 4) _eeAnagramTransition();
          _eeTimer = null;
        }, CONFIG.E_E.HOVER_DELAY_MS);
      }
    } else {
      clearTimeout(_eeTimer);
      _eeTimer = null;
    }

    // Letter magnetic repulsion — now handled by StarCursor gravity field
  });

  function _eeAnagramTransition() {
    const target   = 'RATCHETCARS';
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let iter = 0;
    const interval = setInterval(() => {
      DOM.titleLetters.forEach((span, i) => {
        if (iter > i * 5) {
          span.textContent  = target[i];
          span.style.marginLeft  = i === 7 ? '20px' : '0';
          span.style.color       = '#ff00ff';
          span.style.textShadow  = '0 0 20px #ff00ff';
        } else {
          span.textContent = alphabet[Math.floor(Math.random() * 26)];
          const r  = Math.floor((iter / 60) * 255);
          const g2 = Math.floor(255 - (iter / 60) * 255);
          span.style.color = `rgb(${r},${g2},255)`;
        }
      });
      if (iter >= 60) { clearInterval(interval); _eeLaunchSecret(); }
      iter++;
    }, 50);
  }

  function _eeLaunchSecret() {
    DOM.startScreen.style.display = 'none';
    DOM.container.style.display   = 'none';
    stopTitleMusic();
    TitleBG.stop();
    StarCursor.disable();

    // Mount Ratchet Cars into a dedicated container
    const mount = document.getElementById('ratchet-cars-mount');
    mount.style.display = 'flex';
    RatchetCars.launch(mount);
  }

  // ─── 16. SETTINGS ───────────────────────────────────────────────────────────

  function openSettings(from) {
    settings.openedFrom = from;

    // Sync UI controls with current settings
    DOM.fancyStarsToggle.checked  = settings.fancyStars;
    DOM.scorePopupsToggle.checked = settings.scorePopups;
    DOM.musicVolumeSlider.value   = Math.round(settings.musicVolume * 100);
    DOM.sfxVolumeSlider.value     = Math.round(settings.sfxVolume * 100);
    DOM.musicVolVal.textContent   = Math.round(settings.musicVolume * 100) + '%';
    DOM.sfxVolVal.textContent     = Math.round(settings.sfxVolume * 100) + '%';

    // Hide the source screen
    if (from === 'start') {
      DOM.startScreen.style.display = 'none';
      TitleBG.stop();
      stopTitleMusic();
    } else if (from === 'pause') {
      DOM.pauseMenu.style.display = 'none';
    } else if (from === 'gameover') {
      DOM.gameOver.style.display = 'none';
    }
    DOM.settingsScreen.style.display = 'flex';
  }

  function closeSettings() {
    DOM.settingsScreen.style.display = 'none';
    const from = settings.openedFrom;

    if (from === 'start') {
      DOM.startScreen.style.display = 'flex';
      if (settings.fancyStars) TitleBG.start();
      startTitleMusic();
    } else if (from === 'pause') {
      DOM.pauseMenu.style.display = 'block';
    } else if (from === 'gameover') {
      DOM.gameOver.style.display = 'block';
    }
    settings.openedFrom = null;
  }

  // Open buttons
  DOM.settingsBtnStart.addEventListener('click', () => openSettings('start'));
  DOM.settingsBtnPause.addEventListener('click', () => openSettings('pause'));
  DOM.settingsBtnGO.addEventListener('click',    () => openSettings('gameover'));
  DOM.settingsBackBtn.addEventListener('click',   closeSettings);

  // ─── 16b. ACCOUNTS ──────────────────────────────────────────────────────────
  // AccountUI owns the PILOT ID screen; game.js owns music, the title
  // background and the cursor, so screen transitions come back through here.

  AccountUI.init({
    enterScreen(from) {
      if (from === 'start') {
        DOM.startScreen.style.display = 'none';
        TitleBG.stop();
        stopTitleMusic();
      } else if (from === 'settings') {
        DOM.settingsScreen.style.display = 'none';
      } else if (from === 'gameover') {
        DOM.gameOver.style.display  = 'none';
        DOM.container.style.display = 'none';
      }
      StarCursor.enable();
    },

    exitScreen(from) {
      if (from === 'start') {
        DOM.startScreen.style.display = 'flex';
        if (settings.fancyStars) TitleBG.start();
        startTitleMusic();
      } else if (from === 'settings') {
        DOM.settingsScreen.style.display = 'flex';
      } else if (from === 'gameover') {
        DOM.container.style.display = 'block';
        DOM.gameOver.style.display  = 'block';
      }
    },

    onIdentity() {
      // A new pilot means a different "YOU" row and possibly a new name on
      // existing entries, so the cached board is no longer trustworthy.
      Leaderboard.refresh();
      if (DOM.lbScreen.style.display  === 'flex')  renderLeaderboard();
      if (DOM.nameEntry.style.display === 'block') showNameEntry();
    },

    blip: (hz, type, dur, vol) => AudioManager.play(hz, type, dur, vol),
  });

  // ── Fancy Stars toggle ──────────────────────────────────────────────────────

  DOM.fancyStarsToggle.addEventListener('change', () => {
    settings.fancyStars = DOM.fancyStarsToggle.checked;

    // If toggling while game is paused, we don't restart BG yet —
    // resumeGame / startGameBG will pick up the new setting.
    // But if we came from the start screen, update title canvas visibility.
    if (settings.openedFrom === 'start') {
      DOM.titleCanvas.style.display = settings.fancyStars ? '' : 'none';
    }
  });

  // ── Score Popups toggle ─────────────────────────────────────────────────────

  DOM.scorePopupsToggle.addEventListener('change', () => {
    settings.scorePopups = DOM.scorePopupsToggle.checked;
  });

  // ── Volume sliders ──────────────────────────────────────────────────────────

  /** Play a short preview tone at the given volume (bypasses AudioManager master). */
  let _previewCtx = null;
  function _playPreviewBlip(vol) {
    if (vol <= 0) return;
    if (!_previewCtx) _previewCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_previewCtx.state === 'suspended') _previewCtx.resume();
    const osc = _previewCtx.createOscillator();
    const g   = _previewCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, _previewCtx.currentTime);
    g.gain.setValueAtTime(vol * 0.12, _previewCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _previewCtx.currentTime + 0.08);
    osc.connect(g);
    g.connect(_previewCtx.destination);
    osc.start();
    osc.stop(_previewCtx.currentTime + 0.08);
  }

  DOM.musicVolumeSlider.addEventListener('input', () => {
    settings.musicVolume = DOM.musicVolumeSlider.value / 100;
    DOM.musicVolVal.textContent = DOM.musicVolumeSlider.value + '%';
    applyMusicVolume();
    // Play a test blip at the music volume level
    _playPreviewBlip(settings.musicVolume);
  });

  DOM.sfxVolumeSlider.addEventListener('input', () => {
    settings.sfxVolume = DOM.sfxVolumeSlider.value / 100;
    DOM.sfxVolVal.textContent = DOM.sfxVolumeSlider.value + '%';
    applySfxVolume();
    // Play a test blip so the user hears the level
    AudioManager.play(660, 'sine', 0.08, 0.12);
  });

  // ─── 17. GLOBAL LISTENERS ───────────────────────────────────────────────────

  // Unlock AudioContext + start title music on first user interaction
  document.addEventListener('click', () => {
    AudioManager.resume();
    // Only start title music if we're still on the start screen
    if (DOM.startScreen.style.display !== 'none') {
      startTitleMusic();
    }
  }, { once: true });

  // v3.3 — the window changing no longer changes the playfield, only how it
  // is projected onto the screen. Viewport.apply() has already run by the
  // time this fires; all that is left is refreshing the screen-space origin
  // and re-cutting the canvases at the new display resolution.
  //
  // Note what is NOT here any more: stars already in flight used to be left
  // at stale absolute x positions by a mid-run resize. Their coordinates are
  // logical now, so a resize mid-stage is genuinely inert.
  Viewport.onChange(() => {
    updateLayout();
    if (state.active) resizeGameBG();
    TitleBG.resize();
  });

  // v3.4 — the playability gate can slam shut mid-run if somebody drags the
  // window smaller. Freeze the game when it does, or they lose lives behind
  // an overlay they can't see through. Pausing with the menu visible means
  // the existing resume path (and its 3-2-1 countdown) handles the way back
  // in, so nobody gets dropped straight into a falling star.
  Viewport.onBlockChange(blocked => {
    if (blocked && state.active && !state.paused) pauseGame(true);
  });

  // A run that begins blocked never begins at all.
  if (Viewport.isBlocked()) {
    console.info('[Viewport] blocked at load:', Viewport.blockReason());
  }

  // ─── 18. TITLE BACKGROUND ──────────────────────────────────────────────────

  TitleBG.init(DOM.titleCanvas);
  if (settings.fancyStars) {
    TitleBG.start();
  } else {
    DOM.titleCanvas.style.display = 'none';
  }

  // ─── 19. STAR CURSOR ────────────────────────────────────────────────────────

  StarCursor.init();

  // Register title screen elements as gravity targets
  // Letters get strong, close-range repulsion
  StarCursor.registerGravityTargets(DOM.titleLetters, {
    radius: 180,
    strength: 1.1,
    springK: 0.07,
    damping: 0.80,
    rotScale: 0.025,
    scaleMin: 0.88,
    scaleMax: 1.08,
  });

  // Subtitle + button row get softer, wider repulsion
  StarCursor.registerGravityTargets(
    [document.querySelector('.subtitle'), document.querySelector('.start-actions')],
    {
      radius: 150,
      strength: 0.45,
      springK: 0.10,
      damping: 0.85,
      rotScale: 0.008,
      scaleMin: 0.96,
      scaleMax: 1.02,
    }
  );

  // Leaderboard + Settings headings (always registered, only visible on their screens)
  StarCursor.registerGravityTargets(
    [document.querySelector('.lb-heading'),
     document.querySelector('.settings-heading'),
     document.querySelector('.account-heading')],
    {
      radius: 160,
      strength: 0.6,
      springK: 0.09,
      damping: 0.83,
      rotScale: 0.012,
      scaleMin: 0.94,
      scaleMax: 1.04,
    }
  );

  // Game-over title
  StarCursor.registerGravityTargets(
    document.querySelectorAll('.crash-title'),
    {
      radius: 170,
      strength: 0.7,
      springK: 0.08,
      damping: 0.82,
      rotScale: 0.015,
      scaleMin: 0.92,
      scaleMax: 1.05,
    }
  );

  StarCursor.enable();   // start on title screen

  // ─── 20. DEBUG HANDLE + DEV BRIDGE ──────────────────────────────────────
  //
  // `SC` is the console handle: read/write access to live state for quick
  // balancing pokes. Everything the dev console needs is exposed here too, so
  // there is exactly one surface to keep in sync rather than two.

  /** The ctx an upgrade's `instant` effect expects. */
  function perkCtx() {
    return { grantLife: n => { state.lives += n; updateLives(); } };
  }

  /** Cut the current stage short and award it as cleared. */
  function forceEndStage() {
    if (!state.active) return;
    stCancel();
    releaseAllObjects();
    endStage();
  }

  /** Abandon the ghost pass and go straight to the live one. */
  function skipGhostPass() {
    if (!state.active || stage.phase !== 'ghost') return;
    stCancel();
    releaseAllObjects();
    fadeGhostMarkers();
    startPass('live');
  }

  /** Open a draft without having to finish a stage for it. */
  function forceDraft() {
    if (!state.active) return;
    stCancel();
    releaseAllObjects();
    hideBanner();
    openDraft();
  }

  const SC = {
    // Live state
    state, stage, layout, paddleState, objectPool, activeObjects, settings, DOM,
    CONFIG, Upgrades, StageGen, RNG,

    // Modules
    Auth, AccountUI, Leaderboard,

    // UI refresh
    updateScore, updateLives, updateCombo, updateStageHUD, renderPerkStrip,
    setPaddleWidth,
    setPaddleLeft: x => { DOM.paddleWrap.style.left = x + 'px'; },
    showBanner, showToast, hideBanner,

    // Flow control
    jumpToStage: n => { stCancel(); releaseAllObjects(); beginStage(n); },
    rebuildStage: () => { stCancel(); releaseAllObjects(); beginStage(Math.max(1, stage.num || 1)); },
    forceEndStage, skipGhostPass, forceDraft,
    beginStage, startPass, triggerGameOver,
    pauseGame, resumeGame, stResume, startGameBG,

    // Run control
    launchRun: _launchGame,
    getSeedInput: () => DOM.seedInput.value || '',
    setSeedInput: v => { DOM.seedInput.value = v || ''; },

    // Perks
    perkCtx,
    grantPerk: id => {
      Upgrades.take(id, perkCtx());
      setPaddleWidth(Upgrades.paddleWidth());
      renderPerkStrip();
    },

    // v3.1
    showNameEntry, renderLeaderboard,
  };

  window.SC = SC;

  // Hand the internals to the dev console, if it is loaded. `whoami()` is
  // pulled up onto SC so you can find your admin id without opening anything.
  Dev.attach(SC);
  if (Dev.enabled || window.DevTools) {
    SC.dev    = Dev;
    SC.whoami = () => Dev.whoami();
  }

}); // end window load