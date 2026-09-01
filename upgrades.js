'use strict';

/**
 * Star Catcher v3 — Upgrades / Perks
 *
 * The replayability layer. Between stages the player drafts one perk from a
 * random hand of three. Perks stack, some carry real downsides, and several
 * only pay off if the rest of your build supports them — the "what did the
 * shop offer me this run" loop that makes Nubby's Number Factory work.
 *
 * Everything a perk can change lives in `Upgrades.mods`. Nothing else in the
 * codebase mutates that object; game.js only reads it.
 */

const Upgrades = (() => {

  // ─── RUN MODIFIER STATE ───────────────────────────────────────────────────

  /** Fresh, neutral modifier set. */
  function baseMods() {
    return {
      // Paddle
      paddleWidthBonus:   0,       // flat px added to base width
      paddleWidthMult:    1,       // multiplier applied after the flat bonus
      precisionWidthMult: 1,       // <1 = easier to score "centre" hits

      // Scoring
      scoreMult:          1,       // global multiplier on every catch
      centerMultBonus:    0,       // added to CONFIG.PRECISION.CENTER_MULT
      comboGrowth:        1,       // combo increments by this much per catch
      perfectBonus:       0,       // flat bonus x stage for a zero-miss stage
      chromaScoreMult:    1,

      // Survivability
      revives:            0,       // free "back from 0 lives" charges
      shieldsPerStage:    0,       // misses absorbed each stage
      missLifeCost:       1,       // lives lost per unshielded miss

      // Stage shape
      stageStarsMult:     1,
      extraStarsPerStage: 0,
      frameGapMult:       1,       // >1 = more air between frames
      fallSpeedMult:      1,
      chromaChanceBonus:  0,
      echoEvery:          0,       // every Nth live star spawns a mirrored twin

      // Ghost pass
      ghostTimeScaleMult: 1,       // >1 = ghost pass runs faster
      ghostBounty:        0,       // points per ghost catch, x stage number
      keepGhostMarkers:   false,   // landing markers persist into the live pass
      ghostOpacityBonus:  0,
    };
  }

  let mods  = baseMods();
  let owned = [];                  // [{ id, stacks }]
  let rerolls = 0;

  // ─── PERK POOL ────────────────────────────────────────────────────────────
  // apply(m, stacks) mutates the mods object. `ctx` gives access to live game
  // hooks (e.g. granting a life immediately) for perks that need it.

  const POOL = [

    // ── Common ──────────────────────────────────────────────────────────────
    {
      id: 'wide_load', name: 'WIDE LOAD', rarity: 'common', icon: '▬', maxStacks: 3,
      desc: '+40px paddle width.',
      apply: (m) => { m.paddleWidthBonus += 40; },
    },
    {
      id: 'comet_security', name: 'COMET SECURITY', rarity: 'common', icon: '❤', maxStacks: 99,
      desc: '+1 life, right now.',
      apply: () => {}, instant: (ctx) => ctx.grantLife(1),
    },
    {
      id: 'feather_fall', name: 'FEATHER FALL', rarity: 'common', icon: '🪶', maxStacks: 2,
      desc: 'Stars fall 12% slower. Score x0.92.',
      apply: (m) => { m.fallSpeedMult *= 0.88; m.scoreMult *= 0.92; },
    },
    {
      id: 'long_lens', name: 'LONG LENS', rarity: 'common', icon: '◇', maxStacks: 2,
      desc: '+20% air between frames. Score x0.95.',
      apply: (m) => { m.frameGapMult *= 1.20; m.scoreMult *= 0.95; },
    },
    {
      id: 'deja_vu', name: 'DÉJÀ VU', rarity: 'common', icon: '👁', maxStacks: 2,
      desc: 'The ghost pass runs 20% slower — easier to read.',
      apply: (m) => { m.ghostTimeScaleMult *= 0.80; },
    },
    {
      id: 'heavy_stars', name: 'HEAVY STARS', rarity: 'common', icon: '⬇', maxStacks: 3,
      desc: 'Stars fall 12% faster. Score x1.25.',
      apply: (m) => { m.fallSpeedMult *= 1.12; m.scoreMult *= 1.25; },
    },
    {
      id: 'chroma_bloom', name: 'CHROMA BLOOM', rarity: 'common', icon: '◆', maxStacks: 3,
      desc: '+6% chance any star is a Chroma. Chroma banks an extra draft pick.',
      apply: (m) => { m.chromaChanceBonus += 0.06; },
    },
    {
      id: 'sightline', name: 'SIGHTLINE', rarity: 'common', icon: '⌖', maxStacks: 1,
      desc: 'Ghost landing markers stay lit through the live pass.',
      apply: (m) => { m.keepGhostMarkers = true; m.ghostOpacityBonus += 0.08; },
    },

    // ── Uncommon ────────────────────────────────────────────────────────────
    {
      id: 'hairline', name: 'HAIRLINE', rarity: 'uncommon', icon: '│', maxStacks: 2,
      desc: '−28px paddle width. Score x1.40.',
      apply: (m) => { m.paddleWidthBonus -= 28; m.scoreMult *= 1.40; },
    },
    {
      id: 'bullseye', name: 'BULLSEYE', rarity: 'uncommon', icon: '◎', maxStacks: 2,
      desc: 'Dead-centre catches pay +1.0x on top of the usual 2x.',
      apply: (m) => { m.centerMultBonus += 1.0; },
    },
    {
      id: 'steady_hand', name: 'STEADY HAND', rarity: 'uncommon', icon: '✛', maxStacks: 2,
      desc: 'The high-precision zone on your paddle is 40% wider.',
      apply: (m) => { m.precisionWidthMult *= 0.60; },
    },
    {
      id: 'momentum', name: 'MOMENTUM', rarity: 'uncommon', icon: '≫', maxStacks: 2,
      desc: 'Your combo climbs by 2 per catch instead of 1.',
      apply: (m) => { m.comboGrowth += 1; },
    },
    {
      id: 'aegis', name: 'AEGIS', rarity: 'uncommon', icon: '🛡', maxStacks: 3,
      desc: 'Start each stage with a shield that eats one miss — no life, no combo break.',
      apply: (m) => { m.shieldsPerStage += 1; },
    },
    {
      id: 'fast_forward', name: 'FAST FORWARD', rarity: 'uncommon', icon: '⏩', maxStacks: 2,
      desc: 'Ghost pass runs 50% faster. Score x1.18.',
      apply: (m) => { m.ghostTimeScaleMult *= 1.50; m.scoreMult *= 1.18; },
    },
    {
      id: 'overclock', name: 'OVERCLOCK', rarity: 'uncommon', icon: '⚡', maxStacks: 3,
      desc: '+2 stars per stage. Score x1.20.',
      apply: (m) => { m.extraStarsPerStage += 2; m.scoreMult *= 1.20; },
    },
    {
      id: 'star_tax', name: 'STAR TAX', rarity: 'uncommon', icon: '⚖', maxStacks: 1,
      desc: '+2 lives now. Score x0.80 for the rest of the run.',
      apply: (m) => { m.scoreMult *= 0.80; }, instant: (ctx) => ctx.grantLife(2),
    },
    {
      id: 'clean_sweep', name: 'CLEAN SWEEP', rarity: 'uncommon', icon: '✦', maxStacks: 3,
      desc: 'Clearing a stage without a single miss pays +400 x stage.',
      apply: (m) => { m.perfectBonus += 400; },
    },

    // ── Rare ────────────────────────────────────────────────────────────────
    {
      id: 'precognition', name: 'PRECOGNITION', rarity: 'rare', icon: '☯', maxStacks: 3,
      desc: 'Catching a ghost star pays 6 x stage number. Ghosts finally mean money.',
      apply: (m) => { m.ghostBounty += 6; },
    },
    {
      id: 'second_wind', name: 'SECOND WIND', rarity: 'rare', icon: '↺', maxStacks: 2,
      desc: 'The first time you hit zero lives, come back with one.',
      apply: (m) => { m.revives += 1; },
    },
    {
      id: 'echo', name: 'ECHO', rarity: 'rare', icon: '⧉', maxStacks: 1,
      desc: 'Every 4th live star spawns a mirrored twin. More stars, more score, more risk.',
      apply: (m) => { m.echoEvery = m.echoEvery ? Math.max(3, m.echoEvery - 1) : 4; },
    },
    {
      id: 'long_night', name: 'LONG NIGHT', rarity: 'rare', icon: '🌙', maxStacks: 2,
      desc: 'Stages are 30% longer. Score x1.30.',
      apply: (m) => { m.stageStarsMult *= 1.30; m.scoreMult *= 1.30; },
    },
    {
      id: 'glass_cannon', name: 'GLASS CANNON', rarity: 'rare', icon: '☄', maxStacks: 1,
      desc: 'Every miss costs 2 lives. Score x1.90.',
      apply: (m) => { m.missLifeCost += 1; m.scoreMult *= 1.90; },
    },
    {
      id: 'prism', name: 'PRISM', rarity: 'rare', icon: '🔺', maxStacks: 2,
      desc: 'Chroma catches pay triple, and Chroma appears 4% more often.',
      apply: (m) => { m.chromaScoreMult *= 3; m.chromaChanceBonus += 0.04; },
    },
  ];

  const BY_ID = Object.fromEntries(POOL.map(p => [p.id, p]));

  // ─── DRAFT ────────────────────────────────────────────────────────────────

  function stacksOf(id) {
    const rec = owned.find(o => o.id === id);
    return rec ? rec.stacks : 0;
  }

  function isDraftable(perk, stageNum) {
    if (stacksOf(perk.id) >= perk.maxStacks) return false;
    const D = CONFIG.DRAFT;
    if (perk.rarity === 'uncommon' && stageNum < D.UNCOMMON_FROM_STAGE) return false;
    if (perk.rarity === 'rare'     && stageNum < D.RARE_FROM_STAGE)     return false;
    return true;
  }

  /**
   * Roll a hand of draft options.
   * @param {number} stageNum  the stage the player is about to enter
   * @param {number} count     how many cards (defaults to CONFIG.DRAFT.CARDS)
   * @returns {object[]} perk definitions
   */
  function rollHand(stageNum, count) {
    const n    = count || CONFIG.DRAFT.CARDS;
    const W    = CONFIG.DRAFT.RARITY_WEIGHTS;
    const pool = POOL.filter(p => isDraftable(p, stageNum))
                     .map(p => ({ w: W[p.rarity] || 1, perk: p }));

    const hand = [];
    const used = new Set();
    let guard = 0;
    while (hand.length < n && pool.length && guard++ < 200) {
      const avail = pool.filter(e => !used.has(e.perk.id));
      if (!avail.length) break;
      const chosen = RNG.weighted(avail);
      used.add(chosen.perk.id);
      hand.push(chosen.perk);
    }
    return hand;
  }

  /**
   * Take a perk. `ctx` supplies immediate-effect hooks:
   *   ctx.grantLife(n)
   */
  function take(perkId, ctx) {
    const perk = BY_ID[perkId];
    if (!perk) return null;
    // Hard stack ceiling. rollHand() already filters maxed perks out of the
    // draft, but this guards any other caller (debug hooks, future code).
    if (stacksOf(perkId) >= perk.maxStacks) return null;

    const rec = owned.find(o => o.id === perkId);
    if (rec) rec.stacks++;
    else owned.push({ id: perkId, stacks: 1 });

    perk.apply(mods, stacksOf(perkId));
    if (perk.instant && ctx) perk.instant(ctx);
    return perk;
  }

  // ─── DERIVED VALUES ───────────────────────────────────────────────────────

  function paddleWidth() {
    const P = CONFIG.PADDLE;
    const w = (P.BASE_WIDTH + mods.paddleWidthBonus) * mods.paddleWidthMult;
    return Math.round(Math.max(P.MIN_WIDTH, Math.min(P.MAX_WIDTH, w)));
  }

  function ghostTimeScale() {
    return Math.max(0.6, Math.min(3.0, CONFIG.GHOST.TIME_SCALE * mods.ghostTimeScaleMult));
  }

  function ghostOpacity() {
    return Math.min(0.85, CONFIG.GHOST.OPACITY + mods.ghostOpacityBonus);
  }

  function centerMult() {
    return CONFIG.PRECISION.CENTER_MULT + mods.centerMultBonus;
  }

  /** Compact list for the HUD perk strip. */
  function ownedSummary() {
    return owned.map(o => {
      const p = BY_ID[o.id];
      return { id: o.id, name: p.name, icon: p.icon, rarity: p.rarity, stacks: o.stacks, desc: p.desc };
    });
  }

  function reset() {
    mods    = baseMods();
    owned   = [];
    rerolls = CONFIG.DRAFT.REROLLS_PER_RUN;
  }

  // ─── RUNTIME REGISTRATION (v3.2) ──────────────────────────────────────────
  //
  // Two small seams the dev console needs and nothing else uses. They are
  // here rather than in devtools.js so that poking at the pool is a supported
  // operation with one owner, instead of another module reaching in and
  // mutating POOL and BY_ID behind this module's back.

  /**
   * Add a perk to the live pool, or replace one that already has this id.
   * Replacing in place matters for prototyping: editing a perk and running it
   * again should give you one perk, not three generations of it in the draft.
   */
  function register(def) {
    if (!def || !def.id) return null;
    const i = POOL.findIndex(p => p.id === def.id);
    if (i >= 0) POOL[i] = def;
    else        POOL.push(def);
    BY_ID[def.id] = def;
    return def;
  }

  /** Set the remaining reroll count directly. */
  function setRerolls(n) {
    rerolls = Math.max(0, n | 0);
    return rerolls;
  }

  reset();

  return {
    get mods()    { return mods; },
    get owned()   { return owned; },
    get rerolls() { return rerolls; },
    spendReroll() { if (rerolls > 0) { rerolls--; return true; } return false; },
    reset,
    register,
    setRerolls,
    rollHand,
    take,
    stacksOf,
    paddleWidth,
    ghostTimeScale,
    ghostOpacity,
    centerMult,
    ownedSummary,
    POOL,
    BY_ID,
  };
})();
