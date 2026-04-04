'use strict';

/**
 * Star Catcher — Custom Star Cursor with Trail + Gravity Field
 * Renders a glowing star cursor with a fading particle trail
 * on non-gameplay screens (title, leaderboard, settings).
 *
 * Gravity field: registered DOM elements are repelled from the cursor
 * with spring-return physics, subtle rotation, and scale breathing.
 * A visual distortion ring is drawn on the canvas around the cursor.
 *
 * Public API:
 *   StarCursor.init()                          — call once on load
 *   StarCursor.enable()                        — show custom cursor + trail
 *   StarCursor.disable()                       — hide custom cursor
 *   StarCursor.registerGravityTargets(els, opts) — register elements for repulsion
 *   StarCursor.clearGravityTargets()           — unregister all targets
 */
const StarCursor = (() => {
  let _canvas, _ctx;
  let _raf = null;
  let _active = false;
  let _mouseX = -100, _mouseY = -100;
  let _visible = false;

  // Trail particles
  const TRAIL_MAX = 40;
  const _trail = [];

  // Sparkle particles (burst on click)
  const _sparkles = [];

  // Star rotation
  let _starAngle = 0;
  let _starScale = 1;
  let _targetScale = 1;

  // ── Gravity field ───────────────────────────────────────────────────────

  const GRAVITY_DEFAULTS = {
    radius:    200,     // influence radius in px
    strength:  0.9,     // repulsion strength multiplier
    springK:   0.08,    // spring return stiffness (0–1, higher = snappier)
    damping:   0.82,    // velocity damping (0–1, lower = more damped)
    rotScale:  0.015,   // rotation amount relative to displacement
    scaleMin:  0.92,    // minimum scale when very close
    scaleMax:  1.06,    // maximum scale (slight breathe at edge of field)
  };

  // Each target: { el, opts, ox, oy, vx, vy, rot, scl }
  const _gravTargets = [];
  let _gravFieldPulse = 0;

  /**
   * Register DOM elements for gravity repulsion.
   * @param {NodeList|Array} els  — elements to register
   * @param {Object} [opts]      — override GRAVITY_DEFAULTS per-group
   */
  function registerGravityTargets(els, opts = {}) {
    const merged = { ...GRAVITY_DEFAULTS, ...opts };
    Array.from(els).forEach(el => {
      _gravTargets.push({
        el,
        opts: merged,
        ox: 0, oy: 0,
        vx: 0, vy: 0,
        rot: 0,
        scl: 1,
      });
    });
  }

  function clearGravityTargets() {
    _gravTargets.forEach(t => {
      t.el.style.setProperty('--grav-x', '0px');
      t.el.style.setProperty('--grav-y', '0px');
      t.el.style.setProperty('--grav-rot', '0deg');
      t.el.style.setProperty('--grav-scale', '1');
    });
    _gravTargets.length = 0;
  }

  /** Update all gravity targets — called once per frame. */
  function _updateGravity() {
    if (!_gravTargets.length) return;

    _gravFieldPulse += 0.04;

    for (let i = 0; i < _gravTargets.length; i++) {
      const t = _gravTargets[i];
      const { radius, strength, springK, damping, rotScale, scaleMin, scaleMax } = t.opts;

      // Element center in viewport coords
      const r = t.el.getBoundingClientRect();
      const centerX = (r.left + r.right) / 2;
      const centerY = (r.top + r.bottom) / 2;
      // Approximate base position (subtract current offset)
      const baseX = centerX - t.ox;
      const baseY = centerY - t.oy;

      const dx = baseX - _mouseX;
      const dy = baseY - _mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (_visible && dist < radius && dist > 0.1) {
        // Quadratic falloff: stronger close, gentle at edge
        const norm = 1 - dist / radius;
        const force = norm * norm * strength;
        const pushX = (dx / dist) * force * radius * 0.15;
        const pushY = (dy / dist) * force * radius * 0.15;
        t.vx += (pushX - t.ox) * 0.06;
        t.vy += (pushY - t.oy) * 0.06;

        // Scale: shrink slightly when very close, breathe at edge
        const targetScale = scaleMin + (scaleMax - scaleMin) * (1 - norm);
        t.scl += (targetScale - t.scl) * 0.1;
      } else {
        // Spring return to origin
        t.vx += -t.ox * springK;
        t.vy += -t.oy * springK;
        t.scl += (1 - t.scl) * 0.08;
      }

      // Damping
      t.vx *= damping;
      t.vy *= damping;

      // Integrate
      t.ox += t.vx;
      t.oy += t.vy;

      // Rotation proportional to horizontal velocity
      const targetRot = t.vx * rotScale;
      t.rot += (targetRot - t.rot) * 0.15;

      // Deadzone to avoid sub-pixel jitter
      if (Math.abs(t.ox) < 0.05 && Math.abs(t.oy) < 0.05 &&
          Math.abs(t.vx) < 0.01 && Math.abs(t.vy) < 0.01) {
        t.ox = t.oy = t.vx = t.vy = 0;
        t.rot = 0;
        t.scl = 1;
      }

      // Apply via CSS custom properties (composable with existing animations)
      t.el.style.setProperty('--grav-x', t.ox.toFixed(1) + 'px');
      t.el.style.setProperty('--grav-y', t.oy.toFixed(1) + 'px');
      t.el.style.setProperty('--grav-rot', (t.rot * 57.2958).toFixed(2) + 'deg');
      t.el.style.setProperty('--grav-scale', t.scl.toFixed(3));
    }
  }

  /** Draw a visual gravity distortion ring around the cursor. */
  function _drawGravityField() {
    if (!_gravTargets.length || !_visible) return;

    // Find closest proximity to any target
    let closestNorm = 0;
    for (let i = 0; i < _gravTargets.length; i++) {
      const t = _gravTargets[i];
      const r = t.el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2 - t.ox;
      const cy = (r.top + r.bottom) / 2 - t.oy;
      const dist = Math.sqrt((cx - _mouseX) ** 2 + (cy - _mouseY) ** 2);
      const norm = Math.max(0, 1 - dist / t.opts.radius);
      if (norm > closestNorm) closestNorm = norm;
    }

    if (closestNorm < 0.01) return;

    const fieldAlpha = closestNorm * 0.35;
    const pulse = 0.85 + 0.15 * Math.sin(_gravFieldPulse);
    const ringR = 30 + closestNorm * 25 * pulse;

    // Outer distortion ring
    _ctx.strokeStyle = `rgba(0, 255, 204, ${fieldAlpha * 0.5})`;
    _ctx.lineWidth = 1.5;
    _ctx.beginPath();
    _ctx.arc(_mouseX, _mouseY, ringR, 0, Math.PI * 2);
    _ctx.stroke();

    // Inner ring
    _ctx.strokeStyle = `rgba(255, 0, 255, ${fieldAlpha * 0.3})`;
    _ctx.lineWidth = 1;
    _ctx.beginPath();
    _ctx.arc(_mouseX, _mouseY, ringR * 0.6, 0, Math.PI * 2);
    _ctx.stroke();

    // Orbiting dots
    const dotCount = 6;
    for (let i = 0; i < dotCount; i++) {
      const a = _gravFieldPulse * 0.8 + (Math.PI * 2 / dotCount) * i;
      const dx = Math.cos(a) * ringR;
      const dy = Math.sin(a) * ringR;
      const dotAlpha = fieldAlpha * (0.4 + 0.6 * Math.sin(a * 2 + _gravFieldPulse));
      _ctx.fillStyle = `rgba(0, 255, 204, ${Math.max(0, dotAlpha)})`;
      _ctx.beginPath();
      _ctx.arc(_mouseX + dx, _mouseY + dy, 1.5, 0, Math.PI * 2);
      _ctx.fill();
    }

    // Central glow bloom
    const bloomR = 50 + closestNorm * 40;
    const grad = _ctx.createRadialGradient(
      _mouseX, _mouseY, 0,
      _mouseX, _mouseY, bloomR
    );
    grad.addColorStop(0, `rgba(0, 255, 204, ${fieldAlpha * 0.12})`);
    grad.addColorStop(0.4, `rgba(255, 0, 255, ${fieldAlpha * 0.06})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    _ctx.fillStyle = grad;
    _ctx.beginPath();
    _ctx.arc(_mouseX, _mouseY, bloomR, 0, Math.PI * 2);
    _ctx.fill();
  }

  // ── Initialisation ──────────────────────────────────────────────────────

  function init() {
    _canvas = document.getElementById('star-cursor-canvas');
    if (!_canvas) return;
    _ctx = _canvas.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize);

    document.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('mouseleave', () => { _visible = false; });
    document.addEventListener('mouseenter', () => { _visible = true; });
    document.addEventListener('mousedown', _onMouseDown);
    document.addEventListener('mouseup', _onMouseUp);
  }

  function _resize() {
    _canvas.width = window.innerWidth;
    _canvas.height = window.innerHeight;
  }

  function _onMouseMove(e) {
    _mouseX = e.clientX;
    _mouseY = e.clientY;
    _visible = true;

    if (_active) {
      _trail.push({
        x: _mouseX,
        y: _mouseY,
        life: 1.0,
        size: 3 + Math.random() * 2,
        hue: 160 + Math.random() * 40,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
      });
      if (_trail.length > TRAIL_MAX) _trail.shift();
    }
  }

  function _onMouseDown() {
    if (!_active) return;
    _targetScale = 0.7;
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 / 8) * i + Math.random() * 0.3;
      const speed = 2 + Math.random() * 3;
      _sparkles.push({
        x: _mouseX,
        y: _mouseY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        size: 2 + Math.random() * 2,
        hue: Math.random() > 0.5 ? 300 : 170,
      });
    }
  }

  function _onMouseUp() {
    _targetScale = 1;
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  function _drawStar(cx, cy, outerR, innerR, rotation, alpha) {
    _ctx.save();
    _ctx.translate(cx, cy);
    _ctx.rotate(rotation);
    _ctx.globalAlpha = alpha;

    const points = 4;
    _ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (Math.PI / points) * i - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) _ctx.moveTo(x, y);
      else _ctx.lineTo(x, y);
    }
    _ctx.closePath();

    _ctx.shadowColor = '#00ffcc';
    _ctx.shadowBlur = 15;
    _ctx.fillStyle = '#ffffff';
    _ctx.fill();

    _ctx.shadowBlur = 0;

    _ctx.fillStyle = 'rgba(0, 255, 204, 0.6)';
    _ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (Math.PI / points) * i - Math.PI / 2;
      const r = (i % 2 === 0 ? outerR : innerR) * 0.5;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) _ctx.moveTo(x, y);
      else _ctx.lineTo(x, y);
    }
    _ctx.closePath();
    _ctx.fill();

    _ctx.restore();
  }

  function _drawTrail() {
    for (let i = _trail.length - 1; i >= 0; i--) {
      const p = _trail[i];
      p.life -= 0.035;
      p.x += p.vx;
      p.y += p.vy;

      if (p.life <= 0) {
        _trail.splice(i, 1);
        continue;
      }

      const alpha = p.life * 0.6;
      const size = p.size * p.life;

      _ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${alpha * 0.3})`;
      _ctx.beginPath();
      _ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2);
      _ctx.fill();

      _ctx.fillStyle = `hsla(${p.hue}, 90%, 85%, ${alpha})`;
      _ctx.beginPath();
      _ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      _ctx.fill();
    }
  }

  function _drawSparkles() {
    for (let i = _sparkles.length - 1; i >= 0; i--) {
      const s = _sparkles[i];
      s.life -= 0.04;
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.05;

      if (s.life <= 0) {
        _sparkles.splice(i, 1);
        continue;
      }

      const alpha = s.life;
      _ctx.fillStyle = `hsla(${s.hue}, 90%, 75%, ${alpha})`;
      _ctx.shadowColor = `hsla(${s.hue}, 90%, 75%, ${alpha})`;
      _ctx.shadowBlur = 6;
      _ctx.beginPath();
      _ctx.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2);
      _ctx.fill();
      _ctx.shadowBlur = 0;
    }
  }

  // ── Main loop ───────────────────────────────────────────────────────────

  function _frame() {
    if (!_active) return;

    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

    _starAngle += 0.015;
    _starScale += (_targetScale - _starScale) * 0.2;

    // Update gravity physics
    _updateGravity();

    // Draw gravity field visual (behind trail)
    _drawGravityField();

    // Draw trail
    _drawTrail();

    // Draw click sparkles
    _drawSparkles();

    // Draw main star cursor
    if (_visible) {
      const outerR = 10 * _starScale;
      const innerR = 4 * _starScale;
      _drawStar(_mouseX, _mouseY, outerR, innerR, _starAngle, 1);
      _drawStar(_mouseX, _mouseY, 6 * _starScale, 2.5 * _starScale, -_starAngle * 1.5, 0.35);
    }

    _raf = requestAnimationFrame(_frame);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  function enable() {
    if (_active) return;
    _active = true;
    _canvas.style.display = 'block';
    document.body.classList.add('star-cursor-active');
    _trail.length = 0;
    _sparkles.length = 0;
    _resize();
    _raf = requestAnimationFrame(_frame);
  }

  function disable() {
    if (!_active) return;
    _active = false;
    _canvas.style.display = 'none';
    document.body.classList.remove('star-cursor-active');
    if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
    _trail.length = 0;
    _sparkles.length = 0;
    // Reset gravity offsets so letters snap back
    _gravTargets.forEach(t => {
      t.ox = t.oy = t.vx = t.vy = t.rot = 0;
      t.scl = 1;
      t.el.style.setProperty('--grav-x', '0px');
      t.el.style.setProperty('--grav-y', '0px');
      t.el.style.setProperty('--grav-rot', '0deg');
      t.el.style.setProperty('--grav-scale', '1');
    });
  }

  return { init, enable, disable, registerGravityTargets, clearGravityTargets };
})();