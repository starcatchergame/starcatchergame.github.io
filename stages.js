'use strict';

/**
 * Star Catcher v3 — Stage Director
 *
 * Exposes two globals:
 *   RNG      — deterministic, seedable pseudo-random generator
 *   StageGen — builds a StageDef for a given stage number
 *
 * ── DATA SHAPES ───────────────────────────────────────────────────────────
 *
 * StageDef {
 *   number:    int         1-based stage number
 *   starCount: int         total real stars in this stage
 *   baseGap:   number      nominal ms between frames at this stage
 *   speed:     number      px/frame fall speed for real stars
 *   frames:    FrameDef[]
 *   patterns:  string[]    names of the phrases used (for the intro banner)
 * }
 *
 * FrameDef {
 *   gap:     number        ms to wait AFTER this frame before the next fires
 *   stars:   StarDef[]     1..3 stars dropping simultaneously
 *   phantom: bool          ghost pass skips this frame entirely (DISTORTION)
 * }
 *
 * StarDef {
 *   nx:       number 0..1  normalised x of the REAL star
 *   ghostNx:  number 0..1  normalised x the GHOST shows (== nx unless lying)
 *   lying:    bool         ghostNx deliberately differs from nx (DISTORTION)
 *   isChroma: bool
 *   hue:      number 0..360
 * }
 *
 * Positions are normalised (0..1) rather than pixels so a stage stays valid
 * across window resizes; game.js converts to pixels at spawn time.
 */

// ─── SEEDED RNG (mulberry32) ────────────────────────────────────────────────

const RNG = (() => {
  let _state = 0;
  let _seed  = 0;

  function _next() {
    _state |= 0;
    _state = (_state + 0x6D2B79F5) | 0;
    let t = Math.imul(_state ^ (_state >>> 15), 1 | _state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    /** Seed from an integer or a string. Returns the numeric seed used. */
    seed(v) {
      if (typeof v === 'string') {
        let h = 2166136261;
        for (let i = 0; i < v.length; i++) {
          h ^= v.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        v = h >>> 0;
      }
      _seed  = (v >>> 0) || 1;
      _state = _seed;
      return _seed;
    },
    /** Generate + apply a fresh random seed. Returns it. */
    reseed() {
      return this.seed(Math.floor(Math.random() * 0xFFFFFFFF));
    },
    getSeed()   { return _seed; },
    /** Short human-shareable code, e.g. "K3F-92AB". */
    seedCode()  {
      const s = _seed.toString(36).toUpperCase().padStart(7, '0');
      return s.slice(0, 3) + '-' + s.slice(3);
    },
    next()            { return _next(); },
    range(a, b)       { return a + _next() * (b - a); },
    int(a, b)         { return Math.floor(a + _next() * (b - a + 1)); },
    chance(p)         { return _next() < p; },
    pick(arr)         { return arr[Math.floor(_next() * arr.length)]; },
    /** Weighted pick: items is [{ w: number, ... }] */
    weighted(items) {
      let total = 0;
      for (const it of items) total += it.w;
      let r = _next() * total;
      for (const it of items) { r -= it.w; if (r <= 0) return it; }
      return items[items.length - 1];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(_next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
})();

// ─── STAGE GENERATOR ────────────────────────────────────────────────────────

const StageGen = (() => {

  const EDGE = 0.06;   // keep stars this far (normalised) from the walls

  function clampNx(v) {
    return Math.max(EDGE, Math.min(1 - EDGE, v));
  }

  // ── Curves ────────────────────────────────────────────────────────────────

  /** 0..1 difficulty from stage number, logarithmic so early stages ramp gently. */
  function difficultyFor(stageNum) {
    const D = CONFIG.DIFFICULTY;
    return Math.min(1,
      Math.log(1 + stageNum / D.STAGE_SCALE) /
      Math.log(1 + D.STAGE_CAP / D.STAGE_SCALE)
    );
  }

  /** Number of real stars in this stage. `mods` may stretch it. */
  function starCountFor(stageNum, mods) {
    const S = CONFIG.STAGE;
    let n = S.FIRST_STAGE_STARS + S.STARS_GROWTH * (stageNum - 1);
    if (mods) {
      n = n * (mods.stageStarsMult || 1) + (mods.extraStarsPerStage || 0);
    }
    return Math.max(1, Math.min(S.STARS_MAX, Math.round(n)));
  }

  /** Nominal ms between frames at this stage — shrinks every stage. */
  function frameGapFor(stageNum, mods) {
    const S = CONFIG.STAGE;
    let gap = S.BASE_FRAME_GAP_MS * Math.pow(S.GAP_DECAY, stageNum - 1);
    if (mods && mods.frameGapMult) gap *= mods.frameGapMult;
    return Math.max(S.MIN_FRAME_GAP_MS, gap);
  }

  /** Fall speed for real stars at this stage. */
  function speedFor(stageNum, mods) {
    const base = CONFIG.OBJECTS.BASE_SPEED +
                 CONFIG.DIFFICULTY.SPEED_EXTRA * difficultyFor(stageNum);
    return base * ((mods && mods.fallSpeedMult) || 1);
  }

  /** Chance a given frame carries more than one star. */
  function multiChanceFor(stageNum) {
    const S = CONFIG.STAGE;
    if (stageNum < S.MULTI_START_STAGE) return 0;
    return Math.min(
      S.MULTI_CHANCE_MAX,
      S.MULTI_CHANCE_BASE + S.MULTI_CHANCE_RAMP * (stageNum - S.MULTI_START_STAGE)
    );
  }

  // ── Phrase patterns ───────────────────────────────────────────────────────
  // Each returns an array of frames-worth of positions:
  //   number[]   → one star per frame
  //   number[][] → explicit multi-star frames
  // Readable, learnable shapes are what make the ghost preview meaningful.

  const PATTERNS = {

    /** Pure random placement with a minimum hop from the previous star. */
    scatter(k, prev) {
      const out = [];
      let last = prev;
      for (let i = 0; i < k; i++) {
        let nx;
        let tries = 0;
        do {
          nx = clampNx(RNG.range(EDGE, 1 - EDGE));
          tries++;
        } while (last !== null && Math.abs(nx - last) < 0.18 && tries < 8);
        out.push(nx);
        last = nx;
      }
      return out;
    },

    /** A steady march from one side to the other. */
    sweep(k) {
      const leftToRight = RNG.chance(0.5);
      const span = RNG.range(0.55, 0.88);
      const start = RNG.range(EDGE, 1 - EDGE - span);
      const out = [];
      for (let i = 0; i < k; i++) {
        const t = k === 1 ? 0.5 : i / (k - 1);
        const nx = start + span * (leftToRight ? t : 1 - t);
        out.push(clampNx(nx));
      }
      return out;
    },

    /** Alternating edges that converge toward the middle. */
    pendulum(k) {
      const out = [];
      let lo = RNG.range(EDGE, 0.22);
      let hi = RNG.range(0.78, 1 - EDGE);
      let left = RNG.chance(0.5);
      for (let i = 0; i < k; i++) {
        out.push(clampNx(left ? lo : hi));
        const step = (hi - lo) * 0.22;
        lo += step; hi -= step;
        if (hi - lo < 0.1) { lo = RNG.range(EDGE, 0.25); hi = RNG.range(0.75, 1 - EDGE); }
        left = !left;
      }
      return out;
    },

    /** Evenly stepped ladder — small, predictable increments. */
    stairs(k) {
      const dir  = RNG.chance(0.5) ? 1 : -1;
      const step = RNG.range(0.10, 0.20) * dir;
      let nx = dir > 0 ? RNG.range(EDGE, 0.35) : RNG.range(0.65, 1 - EDGE);
      const out = [];
      for (let i = 0; i < k; i++) {
        out.push(clampNx(nx));
        nx += step;
        if (nx > 1 - EDGE || nx < EDGE) nx = clampNx(nx - step * (k - i));
      }
      return out;
    },

    /** Tight cluster in one zone, then one far outlier to punish autopilot. */
    cluster(k) {
      const centre = RNG.range(0.2, 0.8);
      const out = [];
      for (let i = 0; i < k; i++) {
        if (i === k - 1 && k > 2) {
          const far = centre > 0.5 ? RNG.range(EDGE, 0.25) : RNG.range(0.75, 1 - EDGE);
          out.push(clampNx(far));
        } else {
          out.push(clampNx(centre + RNG.range(-0.07, 0.07)));
        }
      }
      return out;
    },

    /** Same lane repeatedly — a "hold still" drill. */
    volley(k) {
      const nx = clampNx(RNG.range(EDGE, 1 - EDGE));
      return new Array(k).fill(nx);
    },

    /** Bouncing between two fixed lanes. */
    zigzag(k) {
      const a = clampNx(RNG.range(EDGE, 0.4));
      const b = clampNx(RNG.range(0.6, 1 - EDGE));
      const out = [];
      for (let i = 0; i < k; i++) out.push(i % 2 === 0 ? a : b);
      return out;
    },

    /** Symmetric pairs — inherently multi-star frames. */
    mirror(k) {
      const out = [];
      for (let i = 0; i < k; i++) {
        const nx = clampNx(RNG.range(EDGE, 0.45));
        out.push([nx, clampNx(1 - nx)]);
      }
      return out;
    },
  };

  /** Which phrases are legal at this stage, with weights. */
  function patternMenu(stageNum) {
    const menu = [
      { name: 'sweep',    w: 22 },
      { name: 'stairs',   w: 20 },
      { name: 'scatter',  w: 16 },
      { name: 'volley',   w: 12 },
    ];
    if (stageNum >= 2) menu.push({ name: 'zigzag',   w: 16 });
    if (stageNum >= 3) menu.push({ name: 'pendulum', w: 16 });
    if (stageNum >= 4) menu.push({ name: 'cluster',  w: 14 });
    if (stageNum >= CONFIG.STAGE.MULTI_START_STAGE) menu.push({ name: 'mirror', w: 10 });
    return menu;
  }

  // ── Distortion (ghost lies / phantoms) ────────────────────────────────────

  function distortionFor(stageNum) {
    const D = CONFIG.DISTORTION;
    if (!D.START_STAGE || stageNum < D.START_STAGE) {
      return { phantom: 0, lie: 0 };
    }
    const past = stageNum - D.START_STAGE;
    return {
      phantom: Math.min(D.PHANTOM_MAX, D.PHANTOM_CHANCE + D.RAMP_PER_STAGE * past),
      lie:     Math.min(D.LIE_MAX,     D.LIE_CHANCE     + D.RAMP_PER_STAGE * past),
    };
  }

  /** Displace a ghost position by a meaningful, visible amount. */
  function lieOffset(nx) {
    const D = CONFIG.DISTORTION;
    const mag = RNG.range(D.LIE_MIN_OFFSET, D.LIE_MAX_OFFSET);
    // Push toward whichever side has room
    const dir = nx > 0.5 ? -1 : 1;
    return clampNx(nx + mag * dir);
  }

  // ── Star construction ─────────────────────────────────────────────────────

  function makeStar(nx, isChroma, dist) {
    const star = {
      nx:       clampNx(nx),
      ghostNx:  clampNx(nx),
      lying:    false,
      isChroma: !!isChroma,
      hue:      Math.floor(RNG.next() * 360),
    };
    if (dist.lie > 0 && !isChroma && RNG.chance(dist.lie)) {
      star.ghostNx = lieOffset(star.nx);
      star.lying   = true;
    }
    return star;
  }

  // ── Main builder ──────────────────────────────────────────────────────────

  /**
   * Build a full stage definition.
   * @param {number} stageNum  1-based
   * @param {object} mods      Upgrades.mods (optional)
   */
  function build(stageNum, mods) {
    const S       = CONFIG.STAGE;
    const total   = starCountFor(stageNum, mods);
    const baseGap = frameGapFor(stageNum, mods);
    const speed   = speedFor(stageNum, mods);
    const multiP  = multiChanceFor(stageNum);
    const dist    = distortionFor(stageNum);
    const menu    = patternMenu(stageNum);

    // 1. Lay out normalised positions, phrase by phrase, until we hit `total`.
    const laid     = [];   // entries are number OR number[]
    const usedNames = [];
    let placed = 0;
    let lastNx = null;
    let guard  = 0;

    while (placed < total && guard++ < 200) {
      const name    = RNG.weighted(menu).name;
      const isMulti = name === 'mirror';
      const remain  = total - placed;

      // Phrase length in FRAMES
      const maxFrames = isMulti ? Math.floor(remain / 2) : remain;
      if (maxFrames < 1) {
        // Not enough budget for a mirror phrase — drop a single scatter star.
        const one = PATTERNS.scatter(1, lastNx);
        laid.push(one[0]); lastNx = one[0]; placed += 1;
        continue;
      }
      const k = Math.max(1, Math.min(maxFrames, RNG.int(2, 5)));

      const seg = PATTERNS[name](k, lastNx);
      usedNames.push(name);

      for (const entry of seg) {
        if (Array.isArray(entry)) {
          laid.push(entry);
          placed += entry.length;
          lastNx = entry[entry.length - 1];
        } else {
          laid.push(entry);
          placed += 1;
          lastNx = entry;
        }
      }
    }

    // Trim any overshoot from the tail so the count is exact.
    while (placed > total && laid.length) {
      const tail = laid[laid.length - 1];
      if (Array.isArray(tail) && tail.length > 1) { tail.pop(); placed -= 1; }
      else { laid.pop(); placed -= 1; }
    }

    // 2. Optionally merge adjacent singles into simultaneous frames.
    const merged = [];
    for (let i = 0; i < laid.length; i++) {
      const cur = laid[i];
      if (Array.isArray(cur)) { merged.push(cur.slice()); continue; }
      if (multiP > 0 && i + 1 < laid.length && !Array.isArray(laid[i + 1]) &&
          Math.abs(laid[i + 1] - cur) > 0.22 && RNG.chance(multiP)) {
        merged.push([cur, laid[i + 1]]);
        i++;
      } else {
        merged.push([cur]);
      }
    }

    // 3. Decide which star is a chroma.
    const chromaIdx = new Set();
    if (stageNum >= S.CHROMA_FROM_STAGE &&
        (stageNum - S.CHROMA_FROM_STAGE) % S.CHROMA_EVERY === 0 &&
        merged.length > 1) {
      // Never the very first frame — give the player a beat to settle.
      chromaIdx.add(RNG.int(1, merged.length - 1));
    }

    // 4. Materialise frames.
    const chromaRoll = CONFIG.OBJECTS.CHROMA_CHANCE +
                       ((mods && mods.chromaChanceBonus) || 0);
    const frames = merged.map((positions, fi) => {
      const stars = positions.map((nx, si) => {
        const guaranteed = chromaIdx.has(fi) && si === 0;
        const rolled     = !guaranteed && fi > 0 && RNG.chance(chromaRoll);
        return makeStar(nx, guaranteed || rolled, dist);
      });

      // Gap AFTER this frame, with jitter. Multi-star frames get a little air.
      const jitter  = 1 + RNG.range(-S.GAP_JITTER, S.GAP_JITTER);
      const breathe = stars.length > 1 ? 1.25 : 1;
      const gap     = Math.max(S.MIN_FRAME_GAP_MS * 0.8, baseGap * jitter * breathe);

      return {
        gap,
        stars,
        phantom: dist.phantom > 0 && fi > 0 && RNG.chance(dist.phantom),
      };
    });

    return {
      number:    stageNum,
      starCount: frames.reduce((a, f) => a + f.stars.length, 0),
      baseGap,
      speed,
      difficulty: difficultyFor(stageNum),
      frames,
      patterns:  Array.from(new Set(usedNames)),
      hasLies:   frames.some(f => f.stars.some(s => s.lying)),
      hasPhantoms: frames.some(f => f.phantom),
    };
  }

  /** Total wall-clock ms the live pass will take (used for HUD estimates). */
  function estimateDuration(def, containerH) {
    let ms = 0;
    for (const f of def.frames) ms += f.gap;
    const fallFrames = (containerH || CONFIG.GAME.HEIGHT) / def.speed;
    return ms + (fallFrames / 60) * 1000;
  }

  return {
    build,
    estimateDuration,
    difficultyFor,
    starCountFor,
    frameGapFor,
    speedFor,
    PATTERNS,
  };
})();
