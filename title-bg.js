'use strict';

/**
 * Star Catcher v2.2 — Fancy Background Factory
 * Creates independent animated deep-space backgrounds with:
 *   - Parallax star field (3 depth layers)
 *   - Shooting stars with trails
 *   - Nebula color clouds (soft radial gradients)
 *   - Floating constellation particles connected by faint lines
 *   - Optional pulsing glow ring (for title screen)
 *
 * Usage:
 *   const bg = createFancyBG({ showTitleGlow: true });
 *   bg.init(canvasElement);
 *   bg.start();
 */
function createFancyBG(opts = {}) {
  const showTitleGlow = opts.showTitleGlow !== false;

  let _canvas, _ctx, _raf;
  let _w, _h;
  let _running = false;
  let _t = 0;

  // ── Layers ──────────────────────────────────────────────────────────────

  const STAR_COUNTS = [180, 120, 60];
  const STAR_SPEEDS = [0.15, 0.35, 0.7];
  const STAR_SIZES  = [0.8, 1.4, 2.2];
  const STAR_ALPHAS = [0.3, 0.55, 0.85];
  let _starLayers = [[], [], []];

  const NEBULA_COUNT = 5;
  let _nebulae = [];

  const CONSTELLATION_COUNT = 35;
  const LINK_DIST = 120;
  let _particles = [];

  let _shooters = [];
  const SHOOTER_CHANCE = 0.008;

  // ── Initialisation ──────────────────────────────────────────────────────

  function init(canvas) {
    _canvas = canvas;
    _ctx = canvas.getContext('2d');
    _resize();
    _buildStars();
    _buildNebulae();
    _buildParticles();
  }

  function _resize() {
    const parent = _canvas.parentElement;
    _w = _canvas.width  = parent.offsetWidth;
    _h = _canvas.height = parent.offsetHeight;
  }

  function _buildStars() {
    _starLayers = STAR_COUNTS.map(count =>
      Array.from({ length: count }, () => ({
        x: Math.random() * _w,
        y: Math.random() * _h,
        twinkleOffset: Math.random() * Math.PI * 2,
        twinkleSpeed:  0.5 + Math.random() * 2,
      }))
    );
  }

  function _buildNebulae() {
    _nebulae = Array.from({ length: NEBULA_COUNT }, () => {
      const hue = [170, 200, 280, 320, 210][Math.floor(Math.random() * 5)];
      return {
        x: Math.random() * _w,
        y: Math.random() * _h,
        r: 120 + Math.random() * 200,
        hue,
        alpha: 0.02 + Math.random() * 0.035,
        driftX: (Math.random() - 0.5) * 0.12,
        driftY: (Math.random() - 0.5) * 0.08,
        pulseOffset: Math.random() * Math.PI * 2,
        pulseSpeed: 0.3 + Math.random() * 0.5,
      };
    });
  }

  function _buildParticles() {
    _particles = Array.from({ length: CONSTELLATION_COUNT }, () => ({
      x: Math.random() * _w,
      y: Math.random() * _h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.3,
      size: 1.2 + Math.random() * 1.8,
      hue: 160 + Math.random() * 40,
      alpha: 0.4 + Math.random() * 0.4,
    }));
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  function _drawBackground() {
    const grad = _ctx.createLinearGradient(0, 0, 0, _h);
    grad.addColorStop(0,   '#000408');
    grad.addColorStop(0.4, '#000a10');
    grad.addColorStop(0.7, '#040812');
    grad.addColorStop(1,   '#000206');
    _ctx.fillStyle = grad;
    _ctx.fillRect(0, 0, _w, _h);
  }

  function _drawNebulae() {
    _nebulae.forEach(n => {
      n.x += n.driftX;
      n.y += n.driftY;
      if (n.x < -n.r) n.x = _w + n.r;
      if (n.x > _w + n.r) n.x = -n.r;
      if (n.y < -n.r) n.y = _h + n.r;
      if (n.y > _h + n.r) n.y = -n.r;

      // v2.2: quantize pulse to 20 steps — gradient only rebuilds when step changes
      const rawPulse = 1 + 0.2 * Math.sin(_t * n.pulseSpeed + n.pulseOffset);
      const qPulse   = Math.round(rawPulse * 20) / 20;
      const r = n.r * qPulse;

      // v2.2: reuse cached gradient if radius step hasn't changed
      if (n._cachedR !== r || n._cachedX !== (n.x | 0) || n._cachedY !== (n.y | 0)) {
        const cx = n.x | 0, cy = n.y | 0;   // integer coords reduce gradient variance
        const grad = _ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0,   `hsla(${n.hue}, 80%, 50%, ${n.alpha * 1.5})`);
        grad.addColorStop(0.4, `hsla(${n.hue}, 70%, 40%, ${n.alpha * 0.8})`);
        grad.addColorStop(1,   `hsla(${n.hue}, 60%, 30%, 0)`);
        n._cachedGrad = grad;
        n._cachedR = r;
        n._cachedX = cx;
        n._cachedY = cy;
      }
      _ctx.fillStyle = n._cachedGrad;
      _ctx.fillRect(n.x - r, n.y - r, r * 2, r * 2);
    });
  }

  function _drawStars() {
    _starLayers.forEach((layer, li) => {
      const speed = STAR_SPEEDS[li];
      const size  = STAR_SIZES[li];
      const baseA = STAR_ALPHAS[li];
      layer.forEach(s => {
        s.y += speed;
        if (s.y > _h + 5) { s.y = -5; s.x = Math.random() * _w; }
        const twinkle = 0.5 + 0.5 * Math.sin(_t * s.twinkleSpeed + s.twinkleOffset);
        const a = baseA * (0.4 + 0.6 * twinkle);
        _ctx.fillStyle = `rgba(255,255,255,${a})`;
        _ctx.beginPath();
        _ctx.arc(s.x, s.y, size * (0.7 + 0.3 * twinkle), 0, Math.PI * 2);
        _ctx.fill();
        if (li === 2 && twinkle > 0.8) {
          _ctx.fillStyle = `rgba(200,240,255,${a * 0.25})`;
          _ctx.beginPath();
          _ctx.arc(s.x, s.y, size * 3, 0, Math.PI * 2);
          _ctx.fill();
        }
      });
    });
  }

  function _drawConstellations() {
    _particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0)  { p.x = 0;  p.vx *= -1; }
      if (p.x > _w) { p.x = _w; p.vx *= -1; }
      if (p.y < 0)  { p.y = 0;  p.vy *= -1; }
      if (p.y > _h) { p.y = _h; p.vy *= -1; }
    });

    // v2.2: compare squared distances to avoid sqrt per pair;
    // only sqrt the few pairs that actually need the exact distance for alpha.
    const LINK_DIST_SQ = LINK_DIST * LINK_DIST;
    for (let i = 0; i < _particles.length; i++) {
      for (let j = i + 1; j < _particles.length; j++) {
        const dx = _particles[i].x - _particles[j].x;
        const dy = _particles[i].y - _particles[j].y;
        const distSq = dx * dx + dy * dy;
        if (distSq < LINK_DIST_SQ) {
          const dist = Math.sqrt(distSq);
          const a = 0.12 * (1 - dist / LINK_DIST);
          _ctx.strokeStyle = `rgba(0,255,204,${a})`;
          _ctx.lineWidth = 0.6;
          _ctx.beginPath();
          _ctx.moveTo(_particles[i].x, _particles[i].y);
          _ctx.lineTo(_particles[j].x, _particles[j].y);
          _ctx.stroke();
        }
      }
    }

    _particles.forEach(p => {
      const pulse = 0.6 + 0.4 * Math.sin(_t * 1.5 + p.x * 0.01);
      _ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${p.alpha * pulse})`;
      _ctx.beginPath();
      _ctx.arc(p.x, p.y, p.size * pulse, 0, Math.PI * 2);
      _ctx.fill();
    });
  }

  function _drawShootingStars() {
    if (Math.random() < SHOOTER_CHANCE) {
      const fromLeft = Math.random() > 0.5;
      const vx = fromLeft ? (6 + Math.random() * 6) : -(6 + Math.random() * 6);
      const vy = 2 + Math.random() * 3;
      const mag = Math.sqrt(vx * vx + vy * vy);
      _shooters.push({
        x: fromLeft ? -20 : _w + 20,
        y: Math.random() * _h * 0.6,
        vx, vy,
        dirX: vx / mag,   // v2.2: cached unit direction
        dirY: vy / mag,
        life: 1,
        decay: 0.012 + Math.random() * 0.01,
        len: 40 + Math.random() * 60,
        hue: Math.random() > 0.6 ? 180 : 45,
      });
    }

    for (let i = _shooters.length - 1; i >= 0; i--) {
      const s = _shooters[i];
      s.x += s.vx;
      s.y += s.vy;
      s.life -= s.decay;
      if (s.life <= 0) {
        // v2.2: swap-and-pop instead of splice
        _shooters[i] = _shooters[_shooters.length - 1];
        _shooters.pop();
        continue;
      }
      // v2.2: use cached inverse magnitude (set at spawn time)
      const tailX = s.x - s.dirX * s.len;
      const tailY = s.y - s.dirY * s.len;
      const grad = _ctx.createLinearGradient(tailX, tailY, s.x, s.y);
      grad.addColorStop(0, `hsla(${s.hue},90%,80%,0)`);
      grad.addColorStop(1, `hsla(${s.hue},90%,80%,${s.life * 0.8})`);
      _ctx.strokeStyle = grad;
      _ctx.lineWidth = 1.8;
      _ctx.lineCap = 'round';
      _ctx.beginPath();
      _ctx.moveTo(tailX, tailY);
      _ctx.lineTo(s.x, s.y);
      _ctx.stroke();
      _ctx.fillStyle = `hsla(${s.hue},90%,90%,${s.life * 0.6})`;
      _ctx.beginPath();
      _ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
      _ctx.fill();
    }
  }

  function _drawTitleGlow() {
    const cx = _w / 2;
    const cy = _h * 0.38;
    const pulse = 0.6 + 0.4 * Math.sin(_t * 0.4);
    const r = 160 + pulse * 30;
    const grad = _ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    grad.addColorStop(0,   `rgba(0,255,204,${0.04 * pulse})`);
    grad.addColorStop(0.5, `rgba(0,180,255,${0.025 * pulse})`);
    grad.addColorStop(1,   'rgba(0,100,200,0)');
    _ctx.fillStyle = grad;
    _ctx.beginPath();
    _ctx.arc(cx, cy, r, 0, Math.PI * 2);
    _ctx.fill();
  }

  // ── Main loop ───────────────────────────────────────────────────────────

  function _frame() {
    if (!_running) return;
    _t += 0.016;

    _drawBackground();
    _drawNebulae();
    _drawStars();
    if (showTitleGlow) _drawTitleGlow();
    _drawConstellations();
    _drawShootingStars();

    _raf = requestAnimationFrame(_frame);
  }

  function start() {
    if (_running) return;
    _running = true;
    _resize();
    _buildStars();
    _buildNebulae();
    _buildParticles();
    _shooters = [];
    _frame();
  }

  function stop() {
    _running = false;
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  }

  function resize() {
    if (!_canvas) return;
    _resize();
    _buildStars();
    _buildNebulae();
    _buildParticles();
  }

  function isRunning() { return _running; }

  return { init, start, stop, resize, isRunning };
}

// Backward-compatible global — title screen instance
const TitleBG = createFancyBG({ showTitleGlow: true });