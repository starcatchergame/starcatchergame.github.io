'use strict';

/**
 * Star Catcher v2 — Main Game Controller
 *
 * Sections:
 *   1. DOM refs
 *   2. Game state
 *   3. Stars (background animation)
 *   4. Paddle
 *   5. UI updates
 *   6. Explosions
 *   7. Falling objects
 *   8. Milestone / upgrades
 *   9. Pause
 *  10. Countdown
 *  11. Game over + leaderboard UI
 *  12. Game start / reset
 *  13. ???
 *  14. Global listeners
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
    bgMusic: document.getElementById('bg-music'),
  };

  const canvasCtx = DOM.canvas.getContext('2d');

  // ─── MUSIC HELPERS ──────────────────────────────────────────────────────────

  function startMusic() {
    DOM.bgMusic.loop = true;
    DOM.bgMusic.currentTime = 0;
    DOM.bgMusic.play().catch(() => {});  // may fail before user gesture
  }

  function stopMusic() {
    DOM.bgMusic.pause();
    DOM.bgMusic.currentTime = 0;
  }

  // ─── 2. GAME STATE ──────────────────────────────────────────────────────────

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

    // Timer handles for cleanup
    spawnTimer:      null,
    discoveryTimer:  null,
    starsRaf:        null,
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

  // ─── 4. PADDLE ──────────────────────────────────────────────────────────────

  function setPaddleWidth(w) {
    DOM.paddle.style.width = w + 'px';
  }

  function impactEffect() {
    const w = parseInt(DOM.paddle.style.width) || CONFIG.PADDLE.BASE_WIDTH;
    DOM.paddle.style.height = '8px';
    DOM.paddle.style.width  = (w + 20) + 'px';
    setTimeout(() => {
      DOM.paddle.style.height = CONFIG.PADDLE.HEIGHT + 'px';
      DOM.paddle.style.width  = w + 'px';
    }, 100);
  }

  DOM.container.addEventListener('mousemove', e => {
    if (!state.active || state.paused) return;
    const rect = DOM.container.getBoundingClientRect();
    const x    = e.clientX - rect.left;
    const half = (parseInt(DOM.paddle.style.width) || CONFIG.PADDLE.BASE_WIDTH) / 2;
    DOM.paddleWrap.style.left = Math.max(half, Math.min(x, rect.width - half)) + 'px';
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

  // ─── 6. EXPLOSIONS ──────────────────────────────────────────────────────────

  function createExplosion(x, y, color) {
    for (let i = 0; i < 15; i++) {
      const p     = document.createElement('div');
      p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:4px;height:4px;background:${color};pointer-events:none;z-index:5;`;
      DOM.container.appendChild(p);

      const angle = Math.random() * Math.PI * 2;
      const vel   = 3 + Math.random() * 5;
      let px = 0, py = 0, op = 1;

      function animParticle() {
        if (!state.active) { p.remove(); return; }
        if (state.paused)  { requestAnimationFrame(animParticle); return; }
        px += Math.cos(angle) * vel;
        py += Math.sin(angle) * vel;
        op -= 0.03;
        p.style.transform = `translate(${px}px,${py}px)`;
        p.style.opacity   = op;
        if (op > 0) requestAnimationFrame(animParticle); else p.remove();
      }
      requestAnimationFrame(animParticle);
    }
  }

  // ─── 7. FALLING OBJECTS ─────────────────────────────────────────────────────

  function spawnObject() {
    if (!state.active || state.paused || state.countingDown) return;

    const isGold  = Math.random() < CONFIG.OBJECTS.GOLD_CHANCE;
    const size    = isGold ? CONFIG.OBJECTS.GOLD_SIZE : CONFIG.OBJECTS.STAR_SIZE;
    const x       = Math.random() * (DOM.container.offsetWidth - size);
    const color   = isGold ? 'transparent' : `hsl(${Math.random() * 360},80%,60%)`;
    const speed   = CONFIG.OBJECTS.BASE_SPEED + Math.sqrt(state.score / 50);

    const obj = document.createElement('div');
    obj.style.cssText = `position:absolute;top:-50px;left:${x}px;width:${size}px;height:${size}px;` +
      `background:${color};box-shadow:0 0 10px ${color};z-index:5;`;
    if (isGold) {
      obj.classList.add('rainbow');
      obj.style.clipPath = 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)';
    }
    DOM.container.appendChild(obj);

    let top = -50;

    function fall() {
      if (!state.active) { obj.remove(); return; }
      if (state.paused)  { requestAnimationFrame(fall); return; }

      top += speed;
      obj.style.top = top + 'px';

      // Collision with paddle
      const pRect = DOM.paddleWrap.getBoundingClientRect();
      const oRect = obj.getBoundingClientRect();
      const hit   = oRect.bottom >= pRect.top  && oRect.top    <= pRect.bottom &&
                    oRect.left   <= pRect.right && oRect.right  >= pRect.left;

      if (hit) {
        state.combo++;
        if (state.combo > state.sessionMaxCombo) state.sessionMaxCombo = state.combo;
        state.score += (isGold ? CONFIG.OBJECTS.GOLD_SCORE : CONFIG.OBJECTS.STAR_SCORE) * state.combo;
        updateScore();
        updateCombo();
        if (isGold) triggerMilestone();
        AudioManager.play(
          (isGold ? CONFIG.AUDIO.GOLD_BASE_HZ : CONFIG.AUDIO.CATCH_BASE_HZ) + state.combo * 20,
          'square', 0.1
        );
        createExplosion(oRect.left, oRect.top, isGold ? '#fff' : color);
        impactEffect();
        obj.remove();
        return;
      }

      // Fell off bottom
      if (top > DOM.container.offsetHeight) {
        if (!isGold) {
          state.lives--;
          state.combo = 0;
          updateLives();
          updateCombo();
          AudioManager.play(CONFIG.AUDIO.MISS_HZ, 'sawtooth', 0.3, 0.2);
          DOM.container.classList.add('shake');
          setTimeout(() => DOM.container.classList.remove('shake'), 300);
          if (state.lives <= 0) { triggerGameOver(); obj.remove(); return; }
        } else {
          state.combo = 0;
          updateCombo();
        }
        obj.remove();
        return;
      }

      requestAnimationFrame(fall);
    }

    requestAnimationFrame(fall);
  }

  function scheduleSpawn() {
    if (!state.active || state.paused || state.countingDown) return;
    spawnObject();
    const interval = Math.max(
      CONFIG.GAME.MIN_SPAWN_MS,
      CONFIG.GAME.BASE_SPAWN_MS - Math.sqrt(state.score * 25)
    );
    state.spawnTimer = setTimeout(scheduleSpawn, interval);
  }

  function stopSpawning() {
    clearTimeout(state.spawnTimer);
    state.spawnTimer = null;
  }

  // ─── 8. MILESTONE / UPGRADES ────────────────────────────────────────────────

  function triggerMilestone() {
    AudioManager.play(CONFIG.AUDIO.MILESTONE_HZ, 'square', 0.5, 0.15);
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

  // ─── 9. PAUSE ───────────────────────────────────────────────────────────────

  /**
   * @param {boolean} showMenu - show the pause overlay (false during milestone)
   */
  function pauseGame(showMenu = true) {
    if (!state.active) return;
    state.paused = true;
    stopSpawning();
    stopStars();
    if (showMenu) DOM.pauseMenu.style.display = 'block';
  }

  function resumeGame() {
    DOM.pauseMenu.style.display  = 'none';
    DOM.milestoneMenu.style.display = 'none';
    state.paused = false;
    drawStars();
    scheduleSpawn();
  }

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (!state.active || state.countingDown) return;
    if (DOM.milestoneMenu.style.display === 'block') return;
    if (state.paused) resumeGame();
    else pauseGame(true);
  });

  DOM.resumeBtn.addEventListener('click', () => resumeGame());

  // ─── 10. COUNTDOWN ──────────────────────────────────────────────────────────

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

        drawStars();
        scheduleSpawn();
      }
    }

    tick();
  }

  // ─── 11. GAME OVER + LEADERBOARD UI ─────────────────────────────────────────

  async function triggerGameOver() {
    state.active = false;
    stopSpawning();
    stopStars();
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
    }
    DOM.lbScreen.style.display = 'flex';
  }

  DOM.leaderboardBtn.addEventListener('click', () => showLeaderboard(false));
  DOM.viewLbBtn.addEventListener('click',      () => showLeaderboard(true));

  DOM.lbBackBtn.addEventListener('click', () => {
    DOM.lbScreen.style.display = 'none';
    if (state.lbOpenedFromGameOver) {
      DOM.container.style.display = 'block';
      DOM.gameOver.style.display = 'block';
    } else {
      DOM.startScreen.style.display = 'flex';
    }
  });

  // ─── 12. GAME START / RESET ─────────────────────────────────────────────────

  function startGame() {
    AudioManager.resume();

    // Hide all screens / overlays
    DOM.startScreen.style.display    = 'none';
    DOM.lbScreen.style.display       = 'none';
    DOM.gameOver.style.display       = 'none';
    DOM.milestoneMenu.style.display  = 'none';
    DOM.countdown.style.display      = 'none';
    DOM.nameEntry.style.display      = 'none';
    DOM.viewLbBtn.style.display      = 'none';
    DOM.container.style.display      = 'block';

    // Reset timers
    stopSpawning();
    stopStars();
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
      paddleExpanded:  false,
      discoveryTimer:  null,
    });

    // Reset UI
    setPaddleWidth(CONFIG.PADDLE.BASE_WIDTH);
    DOM.paddleWrap.style.left = '50%';
    DOM.comboEl.style.opacity = '0';
    updateScore();
    updateLives();

    initStars();
    drawStars();
    scheduleSpawn();
    startMusic();
  }

  DOM.startGameBtn.addEventListener('click', startGame);
  DOM.rebootBtn.addEventListener('click',    startGame);

  // ─── 13. ??? ─────────────────────────────────────────────────────────

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

  // ─── 14. GLOBAL LISTENERS ───────────────────────────────────────────────────

  // Unlock AudioContext on first user interaction
  document.addEventListener('click', () => AudioManager.resume(), { once: true });

  // Re-initialise star canvas on resize
  window.addEventListener('resize', () => { if (state.active) initStars(); });

}); // end window load