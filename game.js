'use strict';

/**
 * Star Catcher v2.2 — Main Game Controller
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
 *   8. Central game loop
 *   9. Spawn scheduling
 *  10. Milestone / upgrades
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
    milestoneMenu:  document.getElementById('milestone-menu'),
    discoveryBtn:   document.getElementById('discovery-btn'),
    securityBtn:    document.getElementById('security-btn'),
    gameOver:       document.getElementById('game-over'),
    pauseMenu:      document.getElementById('pause-menu'),
    resumeBtn:      document.getElementById('resume-btn'),

    // Game over details
    finalScore:     document.getElementById('final-score'),
    highScore:      document.getElementById('high-score'),
    maxCombo:       document.getElementById('max-combo'),
    nameEntry:      document.getElementById('name-entry'),
    playerName:     document.getElementById('player-name'),
    submitScoreBtn: document.getElementById('submit-score-btn'),
    viewLbBtn:      document.getElementById('view-lb-btn'),
    rebootBtn:      document.getElementById('reboot-btn'),

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

  /** Cached layout dimensions — updated on resize and game start. */
  const layout = {
    containerW:  0,
    containerH:  0,
    containerLeft: 0,
    containerTop:  0,
  };

  /** Paddle position tracked in JS — no DOM reads needed during gameplay. */
  const paddleState = {
    x:     0,      // centre x relative to container
    width: CONFIG.PADDLE.BASE_WIDTH,
    height: CONFIG.PADDLE.HEIGHT,
  };

  function updateLayout() {
    const rect = DOM.container.getBoundingClientRect();
    layout.containerW    = rect.width;
    layout.containerH    = rect.height;
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
    milestoneJustEnded: false,

    lbOpenedFromGameOver: false,  // tracks which screen to return to from leaderboard

    // v2.2: cached difficulty value, updated once per frame
    cachedDifficulty: 0,

    // Timer handles for cleanup
    spawnTimer:      null,
    discoveryTimer:  null,
    starsRaf:        null,
    gameLoopRaf:     null,   // v2.2: central game loop handle
  };

  // ─── 3. STARS ───────────────────────────────────────────────────────────────

  let stars = [];

  function initStars() {
    DOM.canvas.width  = DOM.container.offsetWidth;
    DOM.canvas.height = DOM.container.offsetHeight;
    stars = Array.from({ length: CONFIG.GAME.STAR_COUNT }, () => ({
      x: Math.random() * DOM.canvas.width,
      y: Math.random() * DOM.canvas.height,
      s: Math.random() * 2.5 + 0.5,
      o: Math.random(),
    }));
  }

  function drawStars() {
    canvasCtx.fillStyle = '#000';
    canvasCtx.fillRect(0, 0, DOM.canvas.width, DOM.canvas.height);
    stars.forEach(s => {
      canvasCtx.fillStyle = `rgba(255,255,255,${s.o})`;
      canvasCtx.fillRect(s.x, s.y, s.s, s.s);
      s.y = (s.y + s.s * 0.4) % DOM.canvas.height;
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
    const x    = e.clientX - layout.containerLeft;
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
  const POOL_SIZE = 30;
  const objectPool = [];          // { el, active, x, y, speed, size, isChroma, color }
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
    obj.el.classList.remove('rainbow');
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
      obj.el.classList.remove('rainbow');
    }
    activeObjects.length = 0;
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

  /** v2.2 — Logarithmic difficulty curve, computed once per frame. */
  function computeDifficulty() {
    const D = CONFIG.DIFFICULTY;
    const scoreFactor = Math.min(1,
      Math.log(1 + state.score / D.SCORE_SCALE) /
      Math.log(1 + D.SCORE_CAP   / D.SCORE_SCALE)
    );
    const comboFactor = Math.min(1,
      Math.log(1 + state.combo / D.COMBO_SCALE) /
      Math.log(1 + D.COMBO_CAP   / D.COMBO_SCALE)
    );
    return Math.min(1, D.SCORE_WEIGHT * scoreFactor + D.COMBO_WEIGHT * comboFactor);
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

  function gameLoop() {
    if (!state.active) return;
    if (state.paused) {
      state.gameLoopRaf = requestAnimationFrame(gameLoop);
      return;
    }

    // ── Per-frame caches ──
    state.cachedDifficulty = computeDifficulty();
    const pRect      = getPaddleRect();
    const containerH = layout.containerH;

    // ── Update falling objects ──
    let gameOverTriggered = false;
    for (let i = activeObjects.length - 1; i >= 0; i--) {
      const poolIdx = activeObjects[i];
      const obj = objectPool[poolIdx];

      obj.y += obj.speed;
      obj.el.style.top = obj.y + 'px';

      // Collision: AABB from JS-tracked positions (zero reflows)
      const oBottom = obj.y + obj.size;
      const oRight  = obj.x + obj.size;

      const hit = oBottom >= pRect.top  && obj.y   <= pRect.bottom &&
                  obj.x   <= pRect.right && oRight >= pRect.left;

      if (hit) {
        state.combo++;
        if (state.combo > state.sessionMaxCombo) state.sessionMaxCombo = state.combo;

        // v2.2 — Precision scoring: how close to paddle center?
        const objCenterX   = obj.x + obj.size / 2;
        const paddleCenterX = paddleState.x;
        const halfW        = paddleState.width / 2;
        const distFromCenter = Math.abs(objCenterX - paddleCenterX);
        const precision    = 1 - Math.min(1, distFromCenter / halfW);   // 0 = edge, 1 = dead center
        const P = CONFIG.PRECISION;
        const precisionMult = P.EDGE_MULT + (P.CENTER_MULT - P.EDGE_MULT) * precision;

        const basePoints = (obj.isChroma ? CONFIG.OBJECTS.CHROMA_SCORE : CONFIG.OBJECTS.STAR_SCORE) * state.combo;
        const finalPoints = Math.round(basePoints * precisionMult);
        state.score += finalPoints;
        updateScore();
        updateCombo();

        // Show floating precision score
        if (settings.scorePopups) {
          showPrecisionFloat(objCenterX, obj.y, finalPoints, precision);
        }

        AudioManager.play(
          (obj.isChroma ? CONFIG.AUDIO.CHROMA_BASE_HZ : CONFIG.AUDIO.CATCH_BASE_HZ) + state.combo * 20,
          'square', 0.1
        );
        createExplosion(obj.x, obj.y, obj.isChroma ? '#fff' : obj.color);
        impactEffect();
        const wasChroma = obj.isChroma;
        releaseObject(poolIdx);
        if (wasChroma) triggerMilestone();
        continue;
      }

      // Fell off bottom
      if (obj.y > containerH) {
        if (!obj.isChroma) {
          state.lives--;
          state.combo = 0;
          updateLives();
          updateCombo();
          AudioManager.play(CONFIG.AUDIO.MISS_HZ, 'sawtooth', 0.3, 0.2);
          DOM.container.classList.add('shake');
          setTimeout(() => DOM.container.classList.remove('shake'), 300);
          if (state.lives <= 0) gameOverTriggered = true;
        } else {
          state.combo = 0;
          updateCombo();
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

  // ─── 9. SPAWN SCHEDULING ───────────────────────────────────────────────

  function spawnObject() {
    if (!state.active || state.paused || state.countingDown) return;

    const obj = acquireObject();
    if (!obj) return;   // pool exhausted, skip this spawn

    const isChroma = Math.random() < CONFIG.OBJECTS.CHROMA_CHANCE;
    const size   = isChroma ? CONFIG.OBJECTS.CHROMA_SIZE : CONFIG.OBJECTS.STAR_SIZE;
    const x      = Math.random() * (layout.containerW - size);
    const color  = isChroma ? 'transparent' : `hsl(${Math.random() * 360},80%,60%)`;
    const diff   = state.cachedDifficulty;
    const speed  = CONFIG.OBJECTS.BASE_SPEED + CONFIG.DIFFICULTY.SPEED_EXTRA * diff;

    obj.x      = x;
    obj.y      = -50;
    obj.speed  = speed;
    obj.size   = size;
    obj.isChroma = isChroma;
    obj.color  = color;

    const el = obj.el;
    el.style.left       = x + 'px';
    el.style.top        = '-50px';
    el.style.width      = size + 'px';
    el.style.height     = size + 'px';
    el.style.background = color;
    el.style.boxShadow  = '0 0 10px ' + color;
    el.style.clipPath   = isChroma ? 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)' : '';
    el.style.display    = 'block';

    if (isChroma) el.classList.add('rainbow');
  }

  /**
   * v2.2 — Spawn scheduling uses cached difficulty for interval calc.
   */
  function scheduleSpawn() {
    if (!state.active || state.paused || state.countingDown) return;
    spawnObject();
    const diff     = state.cachedDifficulty;
    const range    = CONFIG.GAME.BASE_SPAWN_MS - CONFIG.GAME.MIN_SPAWN_MS;
    const interval = CONFIG.GAME.MIN_SPAWN_MS + range * (1 - diff);
    state.spawnTimer = setTimeout(scheduleSpawn, interval);
  }

  function stopSpawning() {
    clearTimeout(state.spawnTimer);
    state.spawnTimer = null;
  }

  // ─── 10. MILESTONE / UPGRADES ────────────────────────────────────────────────

  function triggerMilestone() {
    AudioManager.play(CONFIG.AUDIO.MILESTONE_HZ, 'square', 0.5, 0.15);
    state.milestoneJustEnded = true;   // v2.1: flag for post-milestone grace
    pauseGame(/* showMenu= */ false);
    DOM.milestoneMenu.style.display = 'block';
  }

  DOM.discoveryBtn.addEventListener('click', () => {
    AudioManager.play(CONFIG.AUDIO.GO_HZ, 'sine', 0.3);
    setPaddleWidth(CONFIG.PADDLE.EXPANDED_WIDTH);
    state.paddleExpanded = true;
    startCountdown();
  });

  DOM.securityBtn.addEventListener('click', () => {
    AudioManager.play(CONFIG.AUDIO.GO_HZ, 'sine', 0.3);
    state.lives++;
    updateLives();
    startCountdown();
  });

  // ─── 11. PAUSE ───────────────────────────────────────────────────────────────

  /**
   * @param {boolean} showMenu - show the pause overlay (false during milestone)
   */
  function pauseGame(showMenu = true) {
    if (!state.active) return;
    state.paused = true;
    stopSpawning();
    stopGameBG();
    if (showMenu) DOM.pauseMenu.style.display = 'block';
  }

  function resumeGame() {
    DOM.pauseMenu.style.display  = 'none';
    DOM.milestoneMenu.style.display = 'none';
    state.paused = false;
    startGameBG();
    scheduleSpawn();
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (!state.active || state.countingDown) return;
    if (DOM.milestoneMenu.style.display === 'block') return;
    if (DOM.settingsScreen.style.display === 'flex') return;
    if (state.paused) resumeGame();
    else pauseGame(true);
  });

  DOM.resumeBtn.addEventListener('click', () => resumeGame());

  // ─── 12. COUNTDOWN ──────────────────────────────────────────────────────────

  function startCountdown() {
    DOM.milestoneMenu.style.display = 'none';
    DOM.countdown.style.display     = 'block';
    state.countingDown = true;
    let count = 3;

    function tick() {
      if (count > 0) {
        AudioManager.play(CONFIG.AUDIO.COUNTDOWN_HZ[3 - count], 'sine', 0.1);
        DOM.countdown.innerText = count;
        count--;
        setTimeout(tick, 1000);
      } else {
        AudioManager.play(CONFIG.AUDIO.GO_HZ, 'sine', 0.2);
        DOM.countdown.style.display = 'none';
        state.paused       = false;
        state.countingDown = false;

        if (state.paddleExpanded) {
          state.discoveryTimer = setTimeout(() => {
            setPaddleWidth(CONFIG.PADDLE.BASE_WIDTH);
            state.paddleExpanded = false;
          }, CONFIG.PADDLE.DISCOVERY_DURATION_MS);
        }

        startGameBG();
        // v2.1: after a milestone, delay first spawn so objects don't
        // land immediately on top of the player.
        if (state.milestoneJustEnded) {
          state.milestoneJustEnded = false;
          state.spawnTimer = setTimeout(scheduleSpawn, CONFIG.DIFFICULTY.MILESTONE_GRACE_MS);
        } else {
          scheduleSpawn();
        }
      }
    }

    tick();
  }

  // ─── 13. GAME OVER + LEADERBOARD UI ─────────────────────────────────────────

  async function triggerGameOver() {
    state.active = false;
    stopSpawning();
    stopGameLoop();
    releaseAllObjects();
    releaseAllParticles();
    DOM.precisionFloatPool.innerHTML = '';
    stopGameBG();
    stopMusic();
    AudioManager.play(CONFIG.AUDIO.GAME_OVER_HZ, 'sine', 1.0, 0.3);

    if (state.score > state.bestScore) state.bestScore = state.score;

    DOM.finalScore.innerText = 'SCORE: '      + state.score;
    DOM.highScore.innerText  = 'BEST SCORE: ' + state.bestScore;
    DOM.maxCombo.innerText   = 'BEST COMBO: x' + state.sessionMaxCombo;

    if (await Leaderboard.qualifies(state.score, state.sessionMaxCombo)) {
      DOM.nameEntry.style.display = 'block';
      DOM.playerName.value = '';
      setTimeout(() => DOM.playerName.focus(), 50);
    } else {
      DOM.nameEntry.style.display = 'none';
    }

    DOM.viewLbBtn.style.display = 'inline-block';
    DOM.gameOver.style.display  = 'block';
  }

  DOM.submitScoreBtn.addEventListener('click', () => {
    const name = DOM.playerName.value || 'ANON';
    Leaderboard.submit(name, state.score, state.sessionMaxCombo);
    DOM.nameEntry.style.display = 'none';
    AudioManager.play(880, 'sine', 0.4, 0.15);
  });

  DOM.playerName.addEventListener('keydown', e => {
    if (e.key === 'Enter') DOM.submitScoreBtn.click();
  });

  // ── Leaderboard rendering ───────────────────────────────────────────────────

  function _renderTable(entries, field, label) {
    if (!entries.length) {
      return `<p class="lb-empty">No entries yet — be the first!</p>`;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const rows = entries.map((e, i) => `
      <tr class="lb-row${i < 3 ? ' lb-podium' : ''}">
        <td class="lb-rank">${medals[i] || (i + 1)}</td>
        <td class="lb-name">${e.name}</td>
        <td class="lb-val">${field === 'combo' ? 'x' : ''}${e[field]}</td>
        <td class="lb-date">${e.date}</td>
      </tr>`).join('');
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
             <p>Catch one to trigger a <span style="color:var(--magenta);font-weight:bold;">LEVEL UP</span> — choose between an expanded paddle or an extra life.</p>
             <p style="margin-top:12px;color:rgba(255,255,255,0.5);font-size:13px;">Missing a Chroma won't cost a life, but it resets your combo.</p>`,
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

    // First-time tutorial check — show tutorial before launching
    if (isFirstTimePlaying()) {
      TitleBG.stop();
      stopTitleMusic();
      stopLbMusic();
      DOM.startScreen.style.display    = 'none';
      DOM.lbScreen.style.display       = 'none';
      DOM.settingsScreen.style.display = 'none';
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

    // Hide all screens / overlays
    DOM.startScreen.style.display    = 'none';
    DOM.lbScreen.style.display       = 'none';
    DOM.settingsScreen.style.display = 'none';
    DOM.gameOver.style.display       = 'none';
    DOM.milestoneMenu.style.display  = 'none';
    DOM.countdown.style.display      = 'none';
    DOM.nameEntry.style.display      = 'none';
    DOM.viewLbBtn.style.display      = 'none';
    DOM.tutorialOverlay.style.display = 'none';
    DOM.container.style.display      = 'block';

    // Reset timers
    stopSpawning();
    stopGameBG();
    clearTimeout(state.discoveryTimer);

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
      milestoneJustEnded:  false,
      discoveryTimer:      null,
    });

    // Reset UI
    setPaddleWidth(CONFIG.PADDLE.BASE_WIDTH);
    DOM.paddleWrap.style.left = '50%';
    DOM.comboEl.style.opacity = '0';
    updateScore();
    updateLives();

    // v2.2: initialise pools + layout cache
    updateLayout();
    paddleState.x = layout.containerW / 2;
    paddleState.width = CONFIG.PADDLE.BASE_WIDTH;
    initObjectPool();
    initParticlePool();
    DOM.precisionFloatPool.innerHTML = '';  // clear any lingering float text

    startGameBG();
    startGameLoop();
    scheduleSpawn();
    startMusic();
  }

  DOM.startGameBtn.addEventListener('click', startGame);
  DOM.rebootBtn.addEventListener('click',    startGame);

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

    // Letter magnetic repulsion
    DOM.titleLetters.forEach(letter => {
      const lr  = letter.getBoundingClientRect();
      const lx  = (lr.left + lr.right)   / 2 - rect.left;
      const ly  = (lr.top  + lr.bottom)  / 2 - rect.top;
      const dx  = lx - mx, dy = ly - my;
      const dist = Math.hypot(dx, dy);
      if (dist < 500) {
        const f = (500 - dist) / 500;
        letter.style.transform = `translate(${dx * f * 0.8}px,${dy * f * 0.8}px)`;
      } else {
        letter.style.transform = '';
      }
    });
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

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'width:400px;height:600px;background:#333;position:relative;overflow:hidden;' +
      'border:5px solid #555;font-family:"Courier New",Courier,monospace;margin:0 auto;';
    wrapper.innerHTML = `
      <div style="position:absolute;width:100%;height:100%;background:#222;">
        <div id="ee-lane" style="position:absolute;left:50%;transform:translateX(-50%);width:10px;height:1200px;border-left:10px dashed #fff;top:-600px;"></div>
      </div>
      <div id="ee-player" style="position:absolute;bottom:20px;left:175px;width:50px;height:80px;background:#f00;border-radius:8px;box-shadow:0 0 15px #f00;z-index:5;">
        <div style="position:absolute;top:10px;left:5px;width:40px;height:25px;background:#88f;border-radius:4px;border:2px solid #fff;"></div>
      </div>
      <div style="position:absolute;top:10px;left:10px;color:#0f0;font-size:18px;z-index:20;">SCORE: <span id="ee-score">0</span></div>
      <div id="ee-menu" style="position:absolute;inset:0;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;z-index:100;">
        <h1 style="color:#ff0;">RATCHET CARS</h1>
        <button id="ee-start" class="game-button">START ENGINE</button>
      </div>`;
    document.body.appendChild(wrapper);

    const player    = document.getElementById('ee-player');
    const scoreSpan = document.getElementById('ee-score');
    const menu      = document.getElementById('ee-menu');
    const lane      = document.getElementById('ee-lane');
    let eeScore = 0, eeActive = false, eePos = 175, eeSpeed = 6, eeOffset = 0;
    let enemies = [], eeKeys = {};

    document.addEventListener('keydown', e => { eeKeys[e.code] = true;  });
    document.addEventListener('keyup',   e => { eeKeys[e.code] = false; });

    function spawnEnemy() {
      const colors = ['#0af','#f0f','#0f0','#ff8','#fff'];
      const el = document.createElement('div');
      const c  = colors[Math.floor(Math.random() * colors.length)];
      el.style.cssText = `position:absolute;width:50px;height:80px;background:${c};border-radius:8px;` +
        `top:-100px;left:${Math.random() * 350}px;z-index:4;box-shadow:0 0 10px ${c};`;
      wrapper.appendChild(el);
      enemies.push({ el, top: -100 });
    }

    function eeLoop() {
      if (!eeActive) return;
      eeOffset = (eeOffset + eeSpeed) % 40;
      lane.style.top = (eeOffset - 600) + 'px';
      if (eeKeys['ArrowLeft']  && eePos > 0)   eePos -= 8;
      if (eeKeys['ArrowRight'] && eePos < 350)  eePos += 8;
      player.style.left = eePos + 'px';

      for (let i = enemies.length - 1; i >= 0; i--) {
        enemies[i].top += eeSpeed;
        enemies[i].el.style.top = enemies[i].top + 'px';
        const pr = player.getBoundingClientRect();
        const er = enemies[i].el.getBoundingClientRect();
        if (!(pr.right < er.left || pr.left > er.right || pr.bottom < er.top || pr.top > er.bottom)) {
          eeActive = false;
          alert('TOTALED! Score: ' + eeScore);
          menu.style.display = 'flex';
        }
        if (enemies[i].top > 600) {
          enemies[i].el.remove();
          enemies.splice(i, 1);
          eeScore++;
          scoreSpan.innerText = eeScore;
          if (eeScore % 10 === 0) eeSpeed += 0.5;
        }
      }
      if (Math.random() < 0.03) spawnEnemy();
      requestAnimationFrame(eeLoop);
    }

    document.getElementById('ee-start').onclick = () => {
      enemies.forEach(en => en.el.remove());
      enemies = []; eeScore = 0; eeSpeed = 6; eePos = 175;
      scoreSpan.innerText = '0';
      menu.style.display = 'none';
      eeActive = true;
      eeLoop();
    };
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

  // Re-initialise star canvas on resize
  window.addEventListener('resize', () => {
    if (state.active) {
      updateLayout();
      resizeGameBG();
    }
    TitleBG.resize();
  });

  // ─── 18. TITLE BACKGROUND ──────────────────────────────────────────────────

  TitleBG.init(DOM.titleCanvas);
  if (settings.fancyStars) {
    TitleBG.start();
  } else {
    DOM.titleCanvas.style.display = 'none';
  }

}); // end window load