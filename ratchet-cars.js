'use strict';

/**
 * Ratchet Cars — Elevated Easter Egg for Star Catcher
 *
 * Canvas-rendered top-down racer with:
 *   - 3-lane road with markings, curbs, and roadside scenery
 *   - Smooth player car with tilt, exhaust particles, headlights
 *   - Varied enemy cars (3 body shapes × 8 color schemes)
 *   - Near-miss scoring with combo multiplier
 *   - 5-speed gear shifting system
 *   - Screen shake, flash, particle explosions on crash
 *   - Synthesised engine drone + SFX (Web Audio)
 *   - Progressive difficulty
 *
 * Public API:
 *   RatchetCars.launch(wrapperEl)  — mounts the game into the given element
 */
const RatchetCars = (() => {

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════

  const W = 420, H = 700;

  const ROAD_LEFT     = 60;
  const ROAD_RIGHT    = 360;
  const ROAD_W        = ROAD_RIGHT - ROAD_LEFT;
  const LANE_W        = ROAD_W / 3;
  const LANE_CENTERS  = [0,1,2].map(i => ROAD_LEFT + LANE_W * i + LANE_W / 2);

  const PLAYER_W = 36, PLAYER_H = 68, PLAYER_Y = H - 110;
  const ENEMY_W  = 38, ENEMY_H  = 70;
  const NEAR_MISS_THRESHOLD = 14;

  const ENEMY_STYLES = [
    { body: '#0af', accent: '#06c', glow: 'rgba(0,170,255,0.4)' },
    { body: '#f0f', accent: '#a0a', glow: 'rgba(255,0,255,0.4)' },
    { body: '#0f0', accent: '#090', glow: 'rgba(0,255,0,0.3)' },
    { body: '#ff8', accent: '#cc6', glow: 'rgba(255,255,100,0.3)' },
    { body: '#fff', accent: '#aaa', glow: 'rgba(255,255,255,0.3)' },
    { body: '#f80', accent: '#a50', glow: 'rgba(255,136,0,0.4)' },
    { body: '#f44', accent: '#a22', glow: 'rgba(255,68,68,0.35)' },
    { body: '#4ff', accent: '#0aa', glow: 'rgba(100,255,255,0.3)' },
  ];

  const GEARS = [
    { maxSpeed: 4,  accel: 0.08, label: '1st' },
    { maxSpeed: 7,  accel: 0.05, label: '2nd' },
    { maxSpeed: 10, accel: 0.035, label: '3rd' },
    { maxSpeed: 13, accel: 0.025, label: '4th' },
    { maxSpeed: 16, accel: 0.018, label: '5th' },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIO ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  const RCAudio = (() => {
    let actx = null;
    function get() {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      return actx;
    }
    function tone(freq, type, dur, vol) {
      vol = vol || 0.08;
      const c = get();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, c.currentTime);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + dur);
    }
    let engineOsc = null, engineGain = null, engineLP = null;
    function startEngine() {
      const c = get();
      engineOsc  = c.createOscillator();
      engineGain = c.createGain();
      engineLP   = c.createBiquadFilter();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.setValueAtTime(55, c.currentTime);
      engineGain.gain.setValueAtTime(0.03, c.currentTime);
      engineLP.type = 'lowpass';
      engineLP.frequency.setValueAtTime(200, c.currentTime);
      engineOsc.connect(engineLP);
      engineLP.connect(engineGain);
      engineGain.connect(c.destination);
      engineOsc.start();
    }
    function updateEngine(speed) {
      if (!engineOsc) return;
      const c = get();
      engineOsc.frequency.setTargetAtTime(45 + speed * 1.2, c.currentTime, 0.1);
      engineGain.gain.setTargetAtTime(0.02 + speed * 0.0004, c.currentTime, 0.1);
    }
    function stopEngine() {
      if (engineOsc) { try { engineOsc.stop(); } catch(e){} engineOsc = null; }
    }
    function nearMiss()  { tone(880,'sine',0.15,0.06); setTimeout(()=>tone(1100,'sine',0.1,0.04),60); }
    function crash()     { tone(60,'sawtooth',0.8,0.15); tone(80,'square',0.5,0.1); }
    function milestone() { tone(660,'sine',0.12,0.06); setTimeout(()=>tone(990,'sine',0.15,0.05),80); }
    function shift(gear) { tone(200 + gear * 120, 'square', 0.06, 0.04); }
    return { tone, startEngine, updateEngine, stopEngine, nearMiss, crash, milestone, shift };
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  let canvas, ctx;
  let bestScore = 0;
  let state = {};
  let keys = {};
  let mouseX = null, mouseActive = false;

  // DOM refs (populated at launch)
  let $menuScreen, $goScreen;
  let $hudScore, $hudSpeed, $hudMult;
  let $goScore, $goBest, $goSpeed;

  function resetState() {
    state = {
      active: false,
      score: 0,
      speed: 4,
      maxSpeed: 4,
      targetSpeed: 4,
      gear: 0,
      playerX: W / 2,
      targetX: W / 2,
      playerTilt: 0,
      roadOffset: 0,
      enemies: [],
      particles: [],
      exhaustParticles: [],
      sceneryItems: [],
      nearMissTimer: 0,
      nearMissCombo: 0,
      shake: { x: 0, y: 0, intensity: 0 },
      flash: 0,
      frameCount: 0,
      distanceTraveled: 0,
      spawnAccumulator: 0,
      sceneryAccum: 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INPUT
  // ═══════════════════════════════════════════════════════════════════════════

  let _keydownHandler, _keyupHandler;

  function bindInput(wrapperEl) {
    _keydownHandler = e => {
      keys[e.code] = true;
      if ((e.code === 'ArrowUp' || e.code === 'KeyW') && state.active) shiftGear(1);
      if ((e.code === 'ArrowDown' || e.code === 'KeyS') && state.active) shiftGear(-1);
    };
    _keyupHandler = e => { keys[e.code] = false; };
    document.addEventListener('keydown', _keydownHandler);
    document.addEventListener('keyup', _keyupHandler);

    wrapperEl.addEventListener('mousemove', e => {
      const rect = wrapperEl.getBoundingClientRect();
      mouseX = (e.clientX - rect.left) / rect.width * W;
      mouseActive = true;
    });
    wrapperEl.addEventListener('mouseleave', () => { mouseActive = false; });
  }

  function shiftGear(dir) {
    const newGear = Math.max(0, Math.min(GEARS.length - 1, state.gear + dir));
    if (newGear !== state.gear) {
      state.gear = newGear;
      RCAudio.shift(newGear);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPAWNING
  // ═══════════════════════════════════════════════════════════════════════════

  function spawnSceneryItem(side) {
    const types = ['post', 'sign', 'barrier', 'tree'];
    const type = types[Math.floor(Math.random() * types.length)];
    const x = side === 'left'
      ? Math.random() * 45 + 5
      : ROAD_RIGHT + Math.random() * 45 + 10;
    state.sceneryItems.push({ type, x, y: -40, side });
  }

  function spawnEnemy() {
    const lane = Math.floor(Math.random() * 3);
    const style = ENEMY_STYLES[Math.floor(Math.random() * ENEMY_STYLES.length)];
    const laneX = LANE_CENTERS[lane];
    // Avoid stacking
    if (state.enemies.some(e => Math.abs(e.x - laneX) < ENEMY_W && e.y < 80)) return;
    state.enemies.push({
      x: laneX, y: -ENEMY_H - 20, lane, style,
      variant: Math.floor(Math.random() * 3),
      nearMissScored: false,
    });
  }

  function spawnExplosion(x, y) {
    const colors = ['#ff2244','#ff6600','#ffe500','#ffffff','#ff00ff'];
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 8;
      state.particles.push({
        x, y, vx: Math.cos(a)*v, vy: Math.sin(a)*v - 2,
        life: 1, decay: 0.015 + Math.random()*0.02,
        size: 2 + Math.random()*4,
        color: colors[Math.floor(Math.random()*colors.length)],
      });
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1 + Math.random() * 4;
      state.particles.push({
        x: x + (Math.random()-0.5)*30, y: y + (Math.random()-0.5)*30,
        vx: Math.cos(a)*v, vy: Math.sin(a)*v,
        life: 1, decay: 0.008 + Math.random()*0.008,
        size: 6 + Math.random()*8,
        color: Math.random() > 0.5 ? '#444' : '#666',
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random()-0.5)*0.3,
      });
    }
  }

  function spawnExhaust() {
    const spread = 6;
    for (const ox of [-10, 10]) {
      state.exhaustParticles.push({
        x: state.playerX + (Math.random()-0.5)*spread + ox,
        y: PLAYER_Y + PLAYER_H - 5,
        vx: (Math.random()-0.5)*0.5, vy: 1 + Math.random()*2,
        life: 1, decay: 0.04 + Math.random()*0.03,
        size: 2 + Math.random()*2,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAWING
  // ═══════════════════════════════════════════════════════════════════════════

  function drawRoad() {
    // Road surface
    const rg = ctx.createLinearGradient(ROAD_LEFT, 0, ROAD_RIGHT, 0);
    rg.addColorStop(0,   '#1a1a22');
    rg.addColorStop(0.1, '#222230');
    rg.addColorStop(0.5, '#282838');
    rg.addColorStop(0.9, '#222230');
    rg.addColorStop(1,   '#1a1a22');
    ctx.fillStyle = rg;
    ctx.fillRect(ROAD_LEFT, 0, ROAD_W, H);

    // Edge lines
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ROAD_LEFT, 0); ctx.lineTo(ROAD_LEFT, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ROAD_RIGHT, 0); ctx.lineTo(ROAD_RIGHT, H); ctx.stroke();

    // Lane dividers
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    const offset = state.roadOffset % 55;
    for (let lane = 1; lane <= 2; lane++) {
      const x = ROAD_LEFT + LANE_W * lane;
      ctx.setLineDash([30, 25]);
      ctx.lineDashOffset = -offset;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Shoulders
    const sg = ctx.createLinearGradient(0, 0, ROAD_LEFT, 0);
    sg.addColorStop(0, '#0a0a12'); sg.addColorStop(1, '#141420');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, ROAD_LEFT, H);
    const sgr = ctx.createLinearGradient(ROAD_RIGHT, 0, W, 0);
    sgr.addColorStop(0, '#141420'); sgr.addColorStop(1, '#0a0a12');
    ctx.fillStyle = sgr;
    ctx.fillRect(ROAD_RIGHT, 0, W - ROAD_RIGHT, H);

    // Curb stripes
    const curbH = 6, stripeW = 12;
    const co = state.roadOffset % (stripeW * 2);
    for (const cx of [ROAD_LEFT - curbH, ROAD_RIGHT]) {
      ctx.save();
      ctx.beginPath(); ctx.rect(cx, 0, curbH, H); ctx.clip();
      for (let y = -stripeW * 2 + co; y < H + stripeW; y += stripeW * 2) {
        ctx.fillStyle = '#cc2200';
        ctx.fillRect(cx, y, curbH, stripeW);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx, y + stripeW, curbH, stripeW);
      }
      ctx.restore();
    }
  }

  function drawScenery() {
    state.sceneryItems.forEach(item => {
      ctx.save();
      const ix = item.x, iy = item.y;
      if (item.type === 'post') {
        ctx.fillStyle = '#333';
        ctx.fillRect(ix - 2, iy, 4, 30);
        const glow = ctx.createRadialGradient(ix, iy, 0, ix, iy, 25);
        glow.addColorStop(0, 'rgba(255,200,100,0.3)');
        glow.addColorStop(1, 'rgba(255,200,100,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(ix - 25, iy - 25, 50, 50);
        ctx.fillStyle = '#ff8';
        ctx.beginPath(); ctx.arc(ix, iy, 3, 0, Math.PI*2); ctx.fill();
      } else if (item.type === 'sign') {
        ctx.fillStyle = '#444';
        ctx.fillRect(ix - 1, iy + 8, 3, 18);
        ctx.fillStyle = '#0066cc';
        ctx.fillRect(ix - 8, iy, 17, 10);
        ctx.fillStyle = '#fff';
        ctx.font = '6px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(Math.floor(Math.random()*99+1)+'', ix, iy + 8);
      } else if (item.type === 'barrier') {
        ctx.fillStyle = '#cc4400';
        ctx.fillRect(ix - 6, iy, 12, 5);
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(ix - 6, iy + 2, 12, 1);
      } else if (item.type === 'tree') {
        ctx.fillStyle = '#2a1a0a';
        ctx.fillRect(ix - 2, iy + 8, 4, 12);
        ctx.fillStyle = '#1a3a1a';
        ctx.beginPath(); ctx.arc(ix, iy + 5, 9, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawPlayerCar(x, y, tilt) {
    ctx.save();
    ctx.translate(x, y + PLAYER_H/2);
    ctx.rotate(tilt);
    ctx.translate(-x, -(y + PLAYER_H/2));
    const hw = PLAYER_W / 2;

    // Shadow
    ctx.fillStyle = 'rgba(255,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(x, y + PLAYER_H + 4, hw + 4, 8, 0, 0, Math.PI*2); ctx.fill();

    // Body
    ctx.fillStyle = '#cc0000';
    ctx.beginPath();
    ctx.moveTo(x - hw + 4, y + PLAYER_H);
    ctx.lineTo(x - hw, y + PLAYER_H - 15);
    ctx.lineTo(x - hw + 2, y + 15);
    ctx.lineTo(x - hw + 8, y + 4);
    ctx.lineTo(x + hw - 8, y + 4);
    ctx.lineTo(x + hw - 2, y + 15);
    ctx.lineTo(x + hw, y + PLAYER_H - 15);
    ctx.lineTo(x + hw - 4, y + PLAYER_H);
    ctx.closePath();
    ctx.fill();

    // Cockpit
    ctx.fillStyle = '#220044';
    ctx.beginPath();
    ctx.moveTo(x - hw + 7, y + 20);
    ctx.lineTo(x - hw + 10, y + 12);
    ctx.lineTo(x + hw - 10, y + 12);
    ctx.lineTo(x + hw - 7, y + 20);
    ctx.lineTo(x + hw - 6, y + 36);
    ctx.lineTo(x - hw + 6, y + 36);
    ctx.closePath();
    ctx.fill();

    // Windshield shine
    ctx.fillStyle = 'rgba(100,150,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(x - hw + 9, y + 14);
    ctx.lineTo(x, y + 12);
    ctx.lineTo(x + hw - 9, y + 14);
    ctx.lineTo(x + hw - 7, y + 20);
    ctx.lineTo(x - hw + 7, y + 20);
    ctx.closePath();
    ctx.fill();

    // Stripe
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x - 3, y + 5, 6, PLAYER_H - 8);

    // Headlights
    ctx.fillStyle = '#ffffcc';
    ctx.shadowColor = '#ffffcc';
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.ellipse(x - hw + 8, y + 6, 3, 2, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + hw - 8, y + 6, 3, 2, 0, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    // Headlight beams
    ctx.fillStyle = 'rgba(255,255,200,0.03)';
    ctx.beginPath();
    ctx.moveTo(x - hw + 5, y + 4);
    ctx.lineTo(x - hw - 10, y - 80);
    ctx.lineTo(x + hw + 10, y - 80);
    ctx.lineTo(x + hw - 5, y + 4);
    ctx.closePath();
    ctx.fill();

    // Tail lights
    ctx.fillStyle = '#ff0000';
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = 10;
    ctx.fillRect(x - hw + 3, y + PLAYER_H - 5, 6, 3);
    ctx.fillRect(x + hw - 9, y + PLAYER_H - 5, 6, 3);
    ctx.shadowBlur = 0;

    // Body outline
    ctx.strokeStyle = 'rgba(255,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - hw + 4, y + PLAYER_H);
    ctx.lineTo(x - hw, y + PLAYER_H - 15);
    ctx.lineTo(x - hw + 2, y + 15);
    ctx.lineTo(x - hw + 8, y + 4);
    ctx.lineTo(x + hw - 8, y + 4);
    ctx.lineTo(x + hw - 2, y + 15);
    ctx.lineTo(x + hw, y + PLAYER_H - 15);
    ctx.lineTo(x + hw - 4, y + PLAYER_H);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }

  function drawEnemyCar(enemy) {
    const { x, y, style, variant } = enemy;
    const hw = ENEMY_W / 2;

    // Shadow
    ctx.fillStyle = style.glow;
    ctx.beginPath(); ctx.ellipse(x, y + ENEMY_H + 4, hw + 3, 7, 0, 0, Math.PI*2); ctx.fill();

    // Body variants
    ctx.fillStyle = style.body;
    ctx.beginPath();
    if (variant === 0) { // Sedan
      ctx.moveTo(x - hw + 3, y + ENEMY_H);
      ctx.lineTo(x - hw, y + ENEMY_H - 12);
      ctx.lineTo(x - hw + 3, y + 12);
      ctx.lineTo(x - hw + 10, y + 3);
      ctx.lineTo(x + hw - 10, y + 3);
      ctx.lineTo(x + hw - 3, y + 12);
      ctx.lineTo(x + hw, y + ENEMY_H - 12);
      ctx.lineTo(x + hw - 3, y + ENEMY_H);
    } else if (variant === 1) { // SUV
      ctx.moveTo(x - hw + 2, y + ENEMY_H);
      ctx.lineTo(x - hw, y + 8);
      ctx.lineTo(x - hw + 6, y + 2);
      ctx.lineTo(x + hw - 6, y + 2);
      ctx.lineTo(x + hw, y + 8);
      ctx.lineTo(x + hw - 2, y + ENEMY_H);
    } else { // Sports
      ctx.moveTo(x - hw + 5, y + ENEMY_H);
      ctx.lineTo(x - hw - 1, y + ENEMY_H - 18);
      ctx.lineTo(x - hw + 2, y + 18);
      ctx.lineTo(x - hw + 12, y + 2);
      ctx.lineTo(x + hw - 12, y + 2);
      ctx.lineTo(x + hw - 2, y + 18);
      ctx.lineTo(x + hw + 1, y + ENEMY_H - 18);
      ctx.lineTo(x + hw - 5, y + ENEMY_H);
    }
    ctx.closePath();
    ctx.fill();

    // Roof
    ctx.fillStyle = style.accent;
    ctx.fillRect(x - hw + 7, y + 14, ENEMY_W - 14, 22);

    // Rear windshield
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x - hw + 8, y + ENEMY_H - 22, ENEMY_W - 16, 10);

    // Tail lights (top)
    ctx.fillStyle = '#ff4444';
    ctx.shadowColor = '#ff4444';
    ctx.shadowBlur = 6;
    ctx.fillRect(x - hw + 3, y + 4, 5, 3);
    ctx.fillRect(x + hw - 8, y + 4, 5, 3);
    ctx.shadowBlur = 0;

    // Headlights (bottom, facing us)
    ctx.fillStyle = '#ffffcc';
    ctx.shadowColor = '#ffffcc';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.ellipse(x - hw + 6, y + ENEMY_H - 4, 3, 2, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + hw - 6, y + ENEMY_H - 4, 3, 2, 0, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    // Undercarriage glow
    ctx.fillStyle = style.glow;
    ctx.fillRect(x - hw + 4, y + ENEMY_H - 2, ENEMY_W - 8, 3);
  }

  function drawExhaust() {
    state.exhaustParticles.forEach(p => {
      ctx.fillStyle = `rgba(255,${Math.floor(100 + p.life*100)},0,${p.life*0.3})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI*2); ctx.fill();
    });
  }

  function drawParticles() {
    state.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      if (p.rotation !== undefined) {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawSpeedLines() {
    if (state.speed < 6) return;
    const intensity = Math.min(1, (state.speed - 6) / 10);
    const count = Math.floor(intensity * 8);
    ctx.strokeStyle = `rgba(255,255,255,${0.04 + intensity*0.06})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < count; i++) {
      const x = Math.random() * W;
      const len = 30 + intensity * 80;
      ctx.beginPath();
      ctx.moveTo(x, Math.random() * H);
      ctx.lineTo(x + (Math.random()-0.5)*3, Math.random() * H + len);
      ctx.stroke();
    }
  }

  function drawVignette() {
    const grad = ctx.createRadialGradient(W/2, H/2, W*0.3, W/2, H/2, W*0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════════════════════════════

  function update() {
    state.frameCount++;
    const spd = state.speed;

    // Player movement
    const steerSpeed = 5.5;
    if (mouseActive && mouseX !== null) {
      state.targetX = Math.max(ROAD_LEFT + PLAYER_W/2 + 4, Math.min(ROAD_RIGHT - PLAYER_W/2 - 4, mouseX));
    }
    if (keys['ArrowLeft'] || keys['KeyA']) {
      state.targetX = Math.max(ROAD_LEFT + PLAYER_W/2 + 4, state.targetX - steerSpeed);
      mouseActive = false;
    }
    if (keys['ArrowRight'] || keys['KeyD']) {
      state.targetX = Math.min(ROAD_RIGHT - PLAYER_W/2 - 4, state.targetX + steerSpeed);
      mouseActive = false;
    }
    const dx = state.targetX - state.playerX;
    state.playerX += dx * 0.15;
    state.playerTilt = dx * 0.003;

    // Gear / speed
    const gear = GEARS[state.gear];
    state.targetSpeed = gear.maxSpeed;
    if (state.speed < state.targetSpeed) state.speed += gear.accel;
    else if (state.speed > state.targetSpeed) state.speed -= 0.06;
    state.speed = Math.max(2, Math.min(state.speed, gear.maxSpeed));
    if (state.speed > state.maxSpeed) state.maxSpeed = state.speed;
    RCAudio.updateEngine(state.speed);

    // Road scroll
    state.roadOffset += spd;
    state.distanceTraveled += spd;

    // Spawn enemies
    const baseInterval = 45;
    const minInterval = 12;
    const progress = Math.min(1, state.score / 100);
    const spawnInterval = baseInterval - (baseInterval - minInterval) * progress;
    state.spawnAccumulator++;
    if (state.spawnAccumulator >= spawnInterval) {
      spawnEnemy();
      state.spawnAccumulator = 0;
      if (state.score > 30 && Math.random() < 0.2) {
        setTimeout(() => { if (state.active) spawnEnemy(); }, 200);
      }
    }

    // Spawn scenery
    state.sceneryAccum++;
    if (state.sceneryAccum > 20) {
      state.sceneryAccum = 0;
      if (Math.random() < 0.5) spawnSceneryItem('left');
      if (Math.random() < 0.5) spawnSceneryItem('right');
    }

    // Update enemies
    const pLeft = state.playerX - PLAYER_W/2;
    const pRight = state.playerX + PLAYER_W/2;

    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      e.y += spd * 0.65;
      const eLeft = e.x - ENEMY_W/2, eRight = e.x + ENEMY_W/2;

      // Collision
      if (!(pRight < eLeft || pLeft > eRight || PLAYER_Y + PLAYER_H < e.y || PLAYER_Y > e.y + ENEMY_H)) {
        triggerCrash(e);
        return;
      }

      // Near-miss
      if (!e.nearMissScored && e.y > PLAYER_Y - 5 && e.y + ENEMY_H > PLAYER_Y + PLAYER_H) {
        const hGap = Math.min(Math.abs(pLeft - eRight), Math.abs(pRight - eLeft));
        if (hGap < NEAR_MISS_THRESHOLD && hGap > 0) {
          e.nearMissScored = true;
          state.nearMissCombo++;
          state.nearMissTimer = 60;
          state.score += state.nearMissCombo;
          RCAudio.nearMiss();
        }
      }

      // Off screen
      if (e.y > H + 20) {
        state.enemies.splice(i, 1);
        state.score++;
        if (state.score % 25 === 0) RCAudio.milestone();
      }
    }

    // Update scenery
    for (let i = state.sceneryItems.length - 1; i >= 0; i--) {
      state.sceneryItems[i].y += spd;
      if (state.sceneryItems[i].y > H + 40) state.sceneryItems.splice(i, 1);
    }

    // Near-miss timer
    if (state.nearMissTimer > 0) state.nearMissTimer--;
    else state.nearMissCombo = 0;

    // Exhaust
    if (state.frameCount % 2 === 0) spawnExhaust();
    for (let i = state.exhaustParticles.length - 1; i >= 0; i--) {
      const p = state.exhaustParticles[i];
      p.x += p.vx; p.y += p.vy + spd * 0.3; p.life -= p.decay;
      if (p.life <= 0 || p.y > H + 10) state.exhaustParticles.splice(i, 1);
    }

    // Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life -= p.decay;
      if (p.rotation !== undefined) p.rotation += p.rotSpeed;
      if (p.life <= 0) state.particles.splice(i, 1);
    }

    // Shake decay
    if (state.shake.intensity > 0) {
      state.shake.intensity *= 0.9;
      state.shake.x = (Math.random()-0.5) * state.shake.intensity;
      state.shake.y = (Math.random()-0.5) * state.shake.intensity;
      if (state.shake.intensity < 0.5) state.shake.intensity = 0;
    }
    if (state.flash > 0) state.flash -= 0.05;

    // HUD
    $hudScore.textContent = state.score;
    $hudSpeed.textContent = Math.floor(40 + state.speed * 12) + ' MPH';
    if (state.nearMissTimer > 0) {
      $hudMult.textContent = '\u00d7' + state.nearMissCombo + ' NEAR MISS';
      $hudMult.classList.add('rc-visible');
    } else {
      $hudMult.classList.remove('rc-visible');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRASH
  // ═══════════════════════════════════════════════════════════════════════════

  function triggerCrash(enemy) {
    state.active = false;
    RCAudio.stopEngine();
    RCAudio.crash();
    spawnExplosion(state.playerX, PLAYER_Y + PLAYER_H/2);
    spawnExplosion(enemy.x, enemy.y + ENEMY_H/2);
    state.shake.intensity = 25;
    state.flash = 1;
    if (state.score > bestScore) bestScore = state.score;

    let postFrames = 0;
    function postCrash() {
      postFrames++;
      // Tick particles + shake + flash
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life -= p.decay;
        if (p.rotation !== undefined) p.rotation += p.rotSpeed;
        if (p.life <= 0) state.particles.splice(i, 1);
      }
      if (state.shake.intensity > 0) {
        state.shake.intensity *= 0.9;
        state.shake.x = (Math.random()-0.5) * state.shake.intensity;
        state.shake.y = (Math.random()-0.5) * state.shake.intensity;
        if (state.shake.intensity < 0.5) state.shake.intensity = 0;
      }
      if (state.flash > 0) state.flash -= 0.05;

      ctx.save();
      ctx.translate(state.shake.x, state.shake.y);
      drawRoad(); drawScenery();
      state.enemies.forEach(e => { if (e !== enemy) drawEnemyCar(e); });
      drawParticles();
      ctx.restore();
      if (state.flash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + state.flash + ')';
        ctx.fillRect(0, 0, W, H);
      }
      drawVignette();

      if (postFrames < 90) requestAnimationFrame(postCrash);
      else showGameOver();
    }
    postCrash();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER + LOOP
  // ═══════════════════════════════════════════════════════════════════════════

  function render() {
    ctx.save();
    ctx.translate(state.shake.x, state.shake.y);
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(-10, -10, W + 20, H + 20);
    drawRoad(); drawSpeedLines(); drawScenery(); drawExhaust();
    state.enemies.forEach(e => drawEnemyCar(e));
    drawPlayerCar(state.playerX, PLAYER_Y, state.playerTilt);
    drawParticles();
    ctx.restore();
    if (state.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + state.flash + ')';
      ctx.fillRect(0, 0, W, H);
    }
    drawVignette();
    // Gear indicator
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(GEARS[state.gear].label.toUpperCase() + ' GEAR', W - 16, H - 16);
  }

  function gameLoop() {
    if (!state.active) return;
    update();
    render();
    requestAnimationFrame(gameLoop);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  function showMenu() {
    $goScreen.classList.add('rc-hidden');
    $menuScreen.classList.remove('rc-hidden');
    resetState();
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);
    drawRoad();
    drawPlayerCar(W / 2, PLAYER_Y, 0);
    drawVignette();
  }

  function startGame() {
    resetState();
    state.active = true;
    keys = {};
    $menuScreen.classList.add('rc-hidden');
    $goScreen.classList.add('rc-hidden');
    RCAudio.startEngine();
    gameLoop();
  }

  function showGameOver() {
    $goScore.textContent = 'SCORE: ' + state.score;
    $goBest.textContent = bestScore > state.score ? 'BEST: ' + bestScore : 'NEW BEST!';
    $goBest.style.color = bestScore > state.score ? '#ffe500' : '#ff00ff';
    $goSpeed.textContent = 'TOP SPEED: ' + Math.floor(40 + state.maxSpeed * 12) + ' MPH';
    $goScreen.classList.remove('rc-hidden');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LAUNCH — called from game.js easter egg trigger
  // ═══════════════════════════════════════════════════════════════════════════

  function launch(mountEl) {
    // Build DOM
    mountEl.innerHTML = '';
    mountEl.innerHTML = [
      '<div id="rc-wrapper">',
      '  <canvas id="rc-canvas"></canvas>',
      '  <div id="rc-scanlines"></div>',
      '  <div id="rc-hud">',
      '    <div>',
      '      <div class="rc-hud-score" id="rc-hud-score">0</div>',
      '      <div class="rc-hud-mult" id="rc-hud-mult">\u00d72 NEAR MISS</div>',
      '    </div>',
      '    <div>',
      '      <div class="rc-hud-speed" id="rc-hud-speed">60 MPH</div>',
      '    </div>',
      '  </div>',
      '  <div class="rc-screen-overlay" id="rc-menu-screen">',
      '    <h1 class="rc-title">RATCHET<br>CARS</h1>',
      '    <p class="rc-subtitle">an illegal street race</p>',
      '    <button class="rc-btn" id="rc-btn-start">IGNITION</button>',
      '    <div class="rc-controls-hint">',
      '      <kbd>\u2190</kbd> <kbd>\u2192</kbd> or <kbd>A</kbd> <kbd>D</kbd> to steer<br>',
      '      <kbd>\u2191</kbd> <kbd>\u2193</kbd> to shift gear<br>',
      '      mouse also works',
      '    </div>',
      '  </div>',
      '  <div class="rc-screen-overlay rc-hidden" id="rc-gameover-screen">',
      '    <div class="rc-crash-text">TOTALED</div>',
      '    <p class="rc-stat-line rc-score-line" id="rc-go-score">0</p>',
      '    <p class="rc-stat-line rc-best-line" id="rc-go-best"></p>',
      '    <p class="rc-stat-line rc-speed-line" id="rc-go-speed"></p>',
      '    <div class="rc-go-actions">',
      '      <button class="rc-btn" id="rc-btn-retry">REBUILD</button>',
      '      <button class="rc-btn rc-secondary" id="rc-btn-menu">PIT STOP</button>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');

    // Grab refs
    const wrapper = document.getElementById('rc-wrapper');
    canvas = document.getElementById('rc-canvas');
    ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;

    $menuScreen = document.getElementById('rc-menu-screen');
    $goScreen   = document.getElementById('rc-gameover-screen');
    $hudScore   = document.getElementById('rc-hud-score');
    $hudSpeed   = document.getElementById('rc-hud-speed');
    $hudMult    = document.getElementById('rc-hud-mult');
    $goScore    = document.getElementById('rc-go-score');
    $goBest     = document.getElementById('rc-go-best');
    $goSpeed    = document.getElementById('rc-go-speed');

    // Bind buttons
    document.getElementById('rc-btn-start').addEventListener('click', startGame);
    document.getElementById('rc-btn-retry').addEventListener('click', startGame);
    document.getElementById('rc-btn-menu').addEventListener('click', showMenu);

    // Bind input
    bindInput(wrapper);

    // Show menu
    showMenu();
  }

  return { launch };
})();