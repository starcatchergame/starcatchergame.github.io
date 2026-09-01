'use strict';

/**
 * Star Catcher v3.2 — DEV MODE
 *
 * A self-contained development environment for the person building this game.
 * It is deliberately a bolt-on: delete the two tags for devtools.js and
 * devtools.css from index.html and the game is byte-for-byte the shipping
 * build again. game.js only ever talks to this file through the small,
 * no-op-safe bridge at the bottom (`window.DevTools`), so nothing here is
 * load-bearing for a normal run.
 *
 * ── WHAT IT GIVES YOU ─────────────────────────────────────────────────────
 *   RUN    live state, god mode, autoplay bot, time scale, freeze/step
 *   BUILD  grant/remove any perk, watch `Upgrades.mods` change in real time,
 *          stack the next draft hand by hand
 *   LAB    write a brand-new perk in a textarea and play with it immediately,
 *          keep several versions side by side, export when you like one
 *   TUNE   every number in CONFIG as a live control, plus a diff you can
 *          paste straight back into config.js
 *   STAGE  inspect the authored StageDef frame by frame, log run results
 *   SNAP   save and restore whole scenarios (seed + build + stage + state)
 *
 * ── HOW IT IS KEPT AWAY FROM PLAYERS ──────────────────────────────────────
 *   1. It unlocks only for an identity listed in CONFIG.DEV.ADMINS (or on
 *      localhost, if CONFIG.DEV.ALLOW_LOCALHOST is left on).
 *   2. For anyone else it builds no DOM, binds no keys and touches no
 *      storage — every bridge method is a pass-through returning the
 *      neutral value.
 *   3. The moment a dev power touches a run, that run is marked TAINTED and
 *      can no longer reach the leaderboard.
 *
 * This is a convenience gate, not a security boundary: everything here runs
 * in the player's browser, so treat it as "keeps the tools out of the way of
 * players", not "keeps a determined person out". The part that actually
 * matters — that a doctored run cannot land on the board — is enforced by
 * the taint flag, and belongs on the server long-term.
 */

const DevTools = (() => {

  // ─── 1. CONFIGURATION + GATING ────────────────────────────────────────────

  const D = (typeof CONFIG !== 'undefined' && CONFIG.DEV) || {};

  const LS = {
    LAB:      'starcatcher_dev_lab',       // saved prototype perks
    SNAPS:    'starcatcher_dev_snapshots', // saved scenarios
    PREFS:    'starcatcher_dev_prefs',     // panel open/tab/toolbar position
    TUNE:     'starcatcher_dev_tuning',    // persisted CONFIG overrides
  };

  /** State that exists whether or not dev mode ever unlocks. */
  let unlocked = false;
  let api      = null;    // the internals game.js hands over via attach()
  let built    = false;   // panel DOM constructed?

  const flags = {
    god:        false,
    autoplay:   false,
    timeScale:  1,
    stepQueued: false,
    startStage: 0,        // 0 = normal (stage 1)
    presetBuild: null,    // [{id, stacks}] applied at run start
    forcedHand: null,     // [perkId] forced into the next draft
    persistTuning: false,
    autoplaySkill: 1,     // 0..1 — how good the bot is
  };

  /**
   * Whether the current run has been touched by dev powers. Set by taint();
   * cleared only when a fresh, untouched run starts. game.js reads this to
   * decide whether the run may be posted to the leaderboard.
   */
  let taintedRun    = false;
  let taintReasons  = new Set();

  function taint(reason) {
    if (!unlocked) return;
    if (!taintedRun) taintedRun = true;
    if (reason) taintReasons.add(reason);
    refreshToolbar();
  }

  /**
   * Decide whether this browser gets the tools.
   *
   * Runs after Auth has settled so a signed-in admin is recognised on the
   * first paint, and re-runs on every identity change so signing in unlocks
   * without a reload.
   */
  function identityAllows() {
    // Local development: your own machine is always trusted.
    if (D.ALLOW_LOCALHOST !== false) {
      const h = location.hostname;
      if (h === 'localhost' || h === '127.0.0.1' || h === '' || h === '::1') return true;
    }

    if (typeof Auth === 'undefined' || !Auth.isLoggedIn()) return false;

    const s       = Auth.state();
    const email   = String(s.email || '').trim().toLowerCase();
    const userId  = String(s.userId || '');
    const admins  = (D.ADMINS || []).map(a => String(a).trim().toLowerCase());

    if (email  && admins.includes(email))  return true;
    if (userId && admins.includes(userId.toLowerCase())) return true;

    // Optional server-side flag. If you later add an `is_admin` boolean or a
    // `role` text column to `profiles`, this picks it up with no code change.
    const p = Auth.profile && Auth.profile();
    if (p && (p.is_admin === true || String(p.role || '').toLowerCase() === 'admin')) return true;

    return false;
  }

  /** Re-evaluate the gate. Called at boot and whenever the pilot changes. */
  function evaluateGate() {
    const should = identityAllows();
    if (should === unlocked) return;

    unlocked = should;
    if (unlocked) {
      console.log(
        '%c★ STAR CATCHER — DEV MODE%c  press ` to open the console',
        'color:#00ffcc;font-weight:bold', 'color:#888'
      );
      loadTuning();
      registerSavedLabPerks();
      buildUI();
      showUI(true);
    } else {
      showUI(false);
    }
    refreshToolbar();
  }

  // ─── 2. SMALL UTILITIES ───────────────────────────────────────────────────

  const $  = (sel, root) => (root || panel).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || panel).querySelectorAll(sel));

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls)  n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function readLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }

  function writeLS(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }

  function num(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /** Short toast in the corner of the dev panel — never blocks. */
  let _toastTimer = null;
  function say(text, kind) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.className   = 'dv-toast is-on' + (kind ? ' dv-' + kind : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { toastEl.className = 'dv-toast'; }, 2200);
  }

  /** Copy to clipboard with a textarea fallback for non-secure origins. */
  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      say((label || 'Copied') + ' → clipboard', 'ok');
      return true;
    } catch (_) {
      const ta = el('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove();
      say(ok ? (label || 'Copied') + ' → clipboard' : 'Copy failed — check the console', ok ? 'ok' : 'warn');
      if (!ok) console.log(text);
      return ok;
    }
  }

  // ─── 3. CONFIG TUNING ENGINE ──────────────────────────────────────────────
  //
  // CONFIG is Object.freeze'd, but freeze is shallow: the section objects
  // underneath it are still writable. That is what makes live tuning possible
  // without unfreezing or shadowing anything — we write straight into
  // CONFIG.STAGE.BASE_FRAME_GAP_MS and the next stage built picks it up.
  //
  // Sections holding credentials or pure wiring are never exposed.

  const TUNE_SKIP_SECTIONS = ['SUPABASE', 'ACCOUNT', 'DEV', 'E_E'];

  /** Pristine copy of every tunable value, captured once at load. */
  const DEFAULTS = {};

  function captureDefaults() {
    if (Object.keys(DEFAULTS).length) return;
    for (const section of Object.keys(CONFIG)) {
      if (TUNE_SKIP_SECTIONS.includes(section)) continue;
      const obj = CONFIG[section];
      if (!obj || typeof obj !== 'object') continue;
      for (const key of Object.keys(obj)) {
        const v = obj[key];
        if (typeof v === 'number' || typeof v === 'boolean') {
          DEFAULTS[section + '.' + key] = v;
        } else if (v && typeof v === 'object' && !Array.isArray(v)) {
          // One level deeper — catches things like DRAFT.RARITY_WEIGHTS.
          for (const sub of Object.keys(v)) {
            if (typeof v[sub] === 'number' || typeof v[sub] === 'boolean') {
              DEFAULTS[section + '.' + key + '.' + sub] = v[sub];
            }
          }
        }
      }
    }
  }

  function tuneGet(path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), CONFIG);
  }

  function tuneSet(path, value) {
    const parts  = path.split('.');
    const leaf   = parts.pop();
    const target = parts.reduce((o, k) => (o == null ? o : o[k]), CONFIG);
    if (!target) return false;
    target[leaf] = value;
    return true;
  }

  /** Every path whose live value differs from the value config.js shipped. */
  function tuneChanged() {
    const out = {};
    for (const path of Object.keys(DEFAULTS)) {
      const live = tuneGet(path);
      if (live !== DEFAULTS[path]) out[path] = { from: DEFAULTS[path], to: live };
    }
    return out;
  }

  function tuneResetAll() {
    for (const path of Object.keys(DEFAULTS)) tuneSet(path, DEFAULTS[path]);
    saveTuning();
  }

  function saveTuning() {
    if (!flags.persistTuning) { try { localStorage.removeItem(LS.TUNE); } catch (_) {} return; }
    const flat = {};
    for (const [path, d] of Object.entries(tuneChanged())) flat[path] = d.to;
    writeLS(LS.TUNE, flat);
  }

  /**
   * Re-apply tuning saved from a previous session. Off by default: a stale
   * override you forgot about is exactly the kind of thing that makes you
   * chase a balance "bug" that is really just your own leftover slider.
   */
  function loadTuning() {
    captureDefaults();
    const saved = readLS(LS.TUNE, null);
    if (!saved || typeof saved !== 'object') return;
    flags.persistTuning = true;
    let n = 0;
    for (const [path, value] of Object.entries(saved)) {
      if (path in DEFAULTS) { tuneSet(path, value); n++; }
    }
    if (n) console.log('[Dev] restored ' + n + ' CONFIG override(s) from last session');
  }

  /** A paste-ready summary of what you changed, for moving into config.js. */
  function tuneExport() {
    const changed = tuneChanged();
    const keys    = Object.keys(changed);
    if (!keys.length) return '// No CONFIG values differ from the defaults in config.js.';

    // Group by section so the output mirrors the shape of config.js.
    const bySection = {};
    for (const path of keys) {
      const [section, ...rest] = path.split('.');
      (bySection[section] = bySection[section] || []).push([rest.join('.'), changed[path]]);
    }

    const lines = ['// Star Catcher — CONFIG changes from the dev TUNE panel',
                   '// ' + new Date().toISOString(), ''];
    for (const [section, entries] of Object.entries(bySection)) {
      lines.push('// ── ' + section + ' ──');
      for (const [key, d] of entries) {
        lines.push('CONFIG.' + section + '.' + key + ': ' + JSON.stringify(d.to) +
                   ',    // was ' + JSON.stringify(d.from));
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // ─── 4. PERK BUILD MANIPULATION ───────────────────────────────────────────
  //
  // Upgrades has no "unapply" — every perk mutates `mods` cumulatively, which
  // is the right design for a real run but useless when you want to yank a
  // perk back out to compare. So instead of un-applying, we rebuild: reset to
  // neutral mods and re-take the perks you want, in order.
  //
  // Upgrades.take() only fires a perk's `instant` effect when it is given a
  // ctx, so replaying a build with no ctx will not hand out the same +1 life
  // three times over.

  /** The current build as plain data. */
  function readBuild() {
    return Upgrades.owned.map(o => ({ id: o.id, stacks: o.stacks }));
  }

  /** Replace the entire build. Stacks are clamped to each perk's maxStacks. */
  function writeBuild(list) {
    const rerolls = Upgrades.rerolls;
    Upgrades.reset();
    for (const entry of list || []) {
      const perk = Upgrades.BY_ID[entry.id];
      if (!perk) continue;
      const n = Math.max(0, Math.min(perk.maxStacks, entry.stacks | 0));
      for (let i = 0; i < n; i++) Upgrades.take(entry.id);   // no ctx → no instants
    }
    if (typeof Upgrades.setRerolls === 'function') Upgrades.setRerolls(rerolls);
    syncPaddleAndHUD();
  }

  function setStacks(perkId, stacks) {
    const build = readBuild().filter(e => e.id !== perkId);
    if (stacks > 0) build.push({ id: perkId, stacks });
    writeBuild(build);
    taint('build');
  }

  function grantPerk(perkId, withInstant) {
    const perk = Upgrades.BY_ID[perkId];
    if (!perk) { say('Unknown perk: ' + perkId, 'warn'); return; }
    if (Upgrades.stacksOf(perkId) >= perk.maxStacks) {
      say(perk.name + ' is already at max stacks', 'warn');
      return;
    }
    Upgrades.take(perkId, withInstant && api ? api.perkCtx() : undefined);
    syncPaddleAndHUD();
    taint('build');
    say('+ ' + perk.name);
  }

  function clearBuild() {
    writeBuild([]);
    taint('build');
    say('Build cleared');
  }

  /** Push paddle width / perk strip / HUD back in sync after a build change. */
  function syncPaddleAndHUD() {
    if (!api) return;
    api.setPaddleWidth(Upgrades.paddleWidth());
    api.renderPerkStrip();
    api.updateStageHUD();
    api.updateLives();
  }

  /** Which `mods` fields a perk currently moves off their neutral value. */
  function modsDiff() {
    const base = {};
    // Reconstruct neutral mods by reading a throwaway reset — cheaper and
    // more honest than hardcoding a second copy of baseMods() here.
    const live = Upgrades.mods;
    const NEUTRAL = {
      paddleWidthBonus: 0, paddleWidthMult: 1, precisionWidthMult: 1,
      scoreMult: 1, centerMultBonus: 0, comboGrowth: 1, perfectBonus: 0,
      chromaScoreMult: 1, revives: 0, shieldsPerStage: 0, missLifeCost: 1,
      stageStarsMult: 1, extraStarsPerStage: 0, frameGapMult: 1,
      fallSpeedMult: 1, chromaChanceBonus: 0, echoEvery: 0,
      ghostTimeScaleMult: 1, ghostBounty: 0, keepGhostMarkers: false,
      ghostOpacityBonus: 0,
    };
    for (const key of Object.keys(live)) {
      const neutral = (key in NEUTRAL) ? NEUTRAL[key] : undefined;
      base[key] = { value: live[key], neutral, changed: live[key] !== neutral };
    }
    return base;
  }

  // ─── 5. THE LAB — PROTOTYPE PERKS ─────────────────────────────────────────
  //
  // The point of this section: a perk idea should cost you a textarea and one
  // button, not a file edit and a reload. A lab perk is an ordinary member of
  // Upgrades.POOL — it drafts, stacks and scores like any other — plus three
  // optional live hooks that the real pool does not have.
  //
  // Those hooks (onCatch / onMiss / onStageEnd) exist so you can prototype a
  // mechanic that `mods` cannot express yet. They are fired from this file,
  // not from game.js, which means a mechanic you like still has to be written
  // properly into game.js afterwards — but you get to find out whether it is
  // fun *before* you pay for that.

  /** Slots are named versions of an idea, so v1/v2/v3 can sit side by side. */
  function labSlots()          { return readLS(LS.LAB, {}); }
  function labSave(slots)      { writeLS(LS.LAB, slots); }

  function labStore(name, source) {
    const slots = labSlots();
    slots[name] = { source, saved: Date.now() };
    labSave(slots);
  }

  function labDelete(name) {
    const slots = labSlots();
    delete slots[name];
    labSave(slots);
  }

  /**
   * Turn source text into a perk object.
   * This evaluates code you typed into your own browser, on purpose. It is
   * the whole feature. It is also why the lab never opens for a player.
   */
  function labCompile(source) {
    const src = String(source || '').trim();
    if (!src) throw new Error('Nothing to compile.');
    let def;
    try {
      // Wrapped in parens so an object literal is an expression, not a block.
      def = (new Function('CONFIG', 'RNG', 'Upgrades', 'return (' + src + ');'))
              (CONFIG, RNG, Upgrades);
    } catch (e) {
      throw new Error('Syntax error: ' + e.message);
    }
    if (typeof def === 'function') def = def();
    if (!def || typeof def !== 'object') throw new Error('Expected an object literal describing the perk.');
    if (!def.id)   throw new Error('Perk needs an `id`.');
    if (!def.name) def.name = String(def.id).toUpperCase().replace(/_/g, ' ');
    if (!def.rarity || !['common', 'uncommon', 'rare'].includes(def.rarity)) def.rarity = 'common';
    if (!def.icon) def.icon = '✦';
    if (!def.desc) def.desc = '(prototype)';
    if (!Number.isFinite(def.maxStacks)) def.maxStacks = 1;
    if (typeof def.apply !== 'function') def.apply = () => {};
    def.__lab = true;
    return def;
  }

  /**
   * Put a compiled perk into the live pool. Re-registering the same id
   * replaces the definition in place, so editing and re-running a prototype
   * does not leave three ghosts of it in the draft.
   */
  function labRegister(def) {
    if (typeof Upgrades.register === 'function') {
      Upgrades.register(def);
    } else {
      // Fallback for an un-patched upgrades.js.
      const i = Upgrades.POOL.findIndex(p => p.id === def.id);
      if (i >= 0) Upgrades.POOL[i] = def; else Upgrades.POOL.push(def);
      Upgrades.BY_ID[def.id] = def;
    }
    return def;
  }

  /** Register everything saved in the lab, so prototypes survive a reload. */
  function registerSavedLabPerks() {
    const slots = labSlots();
    let n = 0;
    for (const [name, slot] of Object.entries(slots)) {
      try { labRegister(labCompile(slot.source)); n++; }
      catch (e) { console.warn('[Dev] lab slot "' + name + '" failed to compile:', e.message); }
    }
    if (n) console.log('[Dev] registered ' + n + ' prototype perk(s) from the lab');
  }

  /** Every perk id currently in the pool that came from the lab. */
  function labPerkIds() {
    return Upgrades.POOL.filter(p => p.__lab).map(p => p.id);
  }

  // ── Prototype hook dispatch ───────────────────────────────────────────────

  /** Build the context object a prototype hook receives. */
  function hookCtx(extra) {
    const s = api.state, st = api.stage;
    return Object.assign({
      state: s,
      stage: st,
      mods:  Upgrades.mods,
      addScore(n) { s.score += Math.round(n); api.updateScore(); },
      addLife(n)  { s.lives += n; api.updateLives(); },
      setCombo(n) { s.combo = n; api.updateCombo(); },
      toast(text, cls) { api.showToast(String(text), cls || 'toast-chroma'); },
      banner(title, sub, ms) { api.showBanner(String(title), sub || '', ms || 1200, 'banner-stage'); },
      log(...args) { console.log('[lab]', ...args); },
    }, extra || {});
  }

  /**
   * Fire `name` on every owned perk that defines it. Errors are caught and
   * reported once per perk per run — a broken prototype should interrupt your
   * playtest with a message, not with a dead game loop.
   */
  const _hookErrored = new Set();
  function fireHook(name, extra) {
    if (!unlocked || !api) return;
    for (const rec of Upgrades.owned) {
      const perk = Upgrades.BY_ID[rec.id];
      if (!perk || typeof perk[name] !== 'function') continue;
      try {
        perk[name](hookCtx(Object.assign({ stacks: rec.stacks, perk }, extra)));
      } catch (e) {
        const key = rec.id + ':' + name;
        if (!_hookErrored.has(key)) {
          _hookErrored.add(key);
          console.error('[Dev] ' + rec.id + '.' + name + '() threw:', e);
          say(rec.id + '.' + name + '() threw — see console', 'warn');
        }
      }
    }
  }

  // ─── 6. AUTOPLAY BOT ──────────────────────────────────────────────────────
  //
  // Not an AI, just a paddle that chases whatever is about to land. Point of
  // it: paired with a high time scale you can watch twenty stages of a build
  // play out in under a minute and see where it actually falls apart, instead
  // of dying on stage 6 to your own wrists every time you test something.

  function tickAutoPlay() {
    if (!flags.autoplay || !api) return;
    const { state, stage, layout, paddleState, objectPool, activeObjects } = api;
    if (!state.active || state.paused) return;

    // Target the live star closest to the floor. During the ghost pass we
    // track ghosts too, so the bot rehearses like a player would.
    let target = null, lowest = -Infinity;
    for (const idx of activeObjects) {
      const obj = objectPool[idx];
      if (!obj.active) continue;
      if (obj.y > lowest) { lowest = obj.y; target = obj; }
    }
    if (!target) return;

    const want = target.x + target.size / 2;
    const half = paddleState.width / 2;

    // Skill < 1 introduces a deliberate lag and aim error so you can test a
    // build against an imperfect player rather than a machine that never misses.
    const skill = Math.max(0, Math.min(1, flags.autoplaySkill));
    const wobble = (1 - skill) * (paddleState.width * 0.9);
    const aim    = want + (Math.random() - 0.5) * wobble;
    const lerp   = 0.18 + 0.72 * skill;

    const next = paddleState.x + (aim - paddleState.x) * lerp;
    paddleState.x = Math.max(half, Math.min(next, layout.containerW - half));
    api.setPaddleLeft(paddleState.x);
  }

  // ─── 7. RUN LOG ───────────────────────────────────────────────────────────
  // Every cleared stage appends a row. Export as CSV when you want to look at
  // a build's curve in a spreadsheet instead of squinting at the HUD.

  let runLog = [];

  function logStage(result) {
    if (!unlocked || !api) return;
    const st = api.stage, s = api.state;
    runLog.push({
      stage:    st.num,
      stars:    st.starsTotal,
      caught:   st.caught,
      missed:   st.missed,
      ghosts:   st.ghostCatches,
      lives:    s.lives,
      combo:    s.combo,
      score:    s.score,
      gained:   s.score - st.scoreAtStart,
      perfect:  result && result.perfect ? 1 : 0,
      speed:    st.def ? Math.round(st.def.speed * 100) / 100 : 0,
      gap:      st.def ? Math.round(st.def.baseGap) : 0,
      build:    readBuild().map(b => b.id + (b.stacks > 1 ? '×' + b.stacks : '')).join(' '),
    });
    if (runLog.length > 400) runLog.shift();
    if (activeTab === 'stage') renderStageTab();
  }

  function runLogCsv() {
    if (!runLog.length) return 'stage,stars,caught,missed,ghosts,lives,combo,score,gained,perfect,speed,gap,build\n';
    const cols = Object.keys(runLog[0]);
    const rows = runLog.map(r => cols.map(c => {
      const v = String(r[c]);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(','));
    return cols.join(',') + '\n' + rows.join('\n') + '\n';
  }

  // ─── 8. SNAPSHOTS ─────────────────────────────────────────────────────────
  //
  // "It broke when I had three Glass Cannons on stage 14 with one life" is a
  // sentence you should be able to click, not re-earn.

  function snapshots()      { return readLS(LS.SNAPS, {}); }
  function snapshotsSave(o) { writeLS(LS.SNAPS, o); }

  function captureSnapshot(name) {
    if (!api) return null;
    const s = api.state, st = api.stage;
    const snap = {
      name,
      saved:   Date.now(),
      seed:    s.runSeedCode || '',
      stage:   Math.max(1, st.num || 1),
      score:   s.score,
      lives:   s.lives,
      combo:   s.combo,
      rerolls: Upgrades.rerolls,
      build:   readBuild(),
      tuning:  Object.fromEntries(Object.entries(tuneChanged()).map(([k, v]) => [k, v.to])),
      lab:     labSlots(),
      flags:   { god: flags.god, autoplay: flags.autoplay, timeScale: flags.timeScale,
                 autoplaySkill: flags.autoplaySkill },
    };
    const all = snapshots();
    all[name] = snap;
    snapshotsSave(all);
    return snap;
  }

  /**
   * Restore a scenario by starting a fresh run configured to land exactly
   * where the snapshot was taken. The stage itself is regenerated from the
   * seed, so the frames are identical too.
   */
  function restoreSnapshot(snap) {
    if (!api || !snap) return;

    // Prototypes first — a saved build may reference a lab perk.
    if (snap.lab) { labSave(Object.assign(labSlots(), snap.lab)); registerSavedLabPerks(); }

    if (snap.tuning) {
      for (const [path, value] of Object.entries(snap.tuning)) {
        if (path in DEFAULTS) tuneSet(path, value);
      }
    }
    if (snap.flags) Object.assign(flags, snap.flags);

    flags.startStage  = snap.stage || 1;
    flags.presetBuild = snap.build || [];

    api.setSeedInput(snap.seed || '');
    api.launchRun();

    // Score / lives / rerolls are applied after the run has been rebuilt,
    // since launching resets them.
    setTimeout(() => {
      const s = api.state;
      if (Number.isFinite(snap.score)) { s.score = snap.score; api.updateScore(); }
      if (Number.isFinite(snap.lives)) { s.lives = snap.lives; api.updateLives(); }
      if (Number.isFinite(snap.combo)) { s.combo = snap.combo; api.updateCombo(); }
      if (Number.isFinite(snap.rerolls) && typeof Upgrades.setRerolls === 'function') {
        Upgrades.setRerolls(snap.rerolls);
      }
      taint('snapshot');
      refreshAll();
    }, 60);

    say('Restored "' + snap.name + '"', 'ok');
  }

  // ─── 9. UI SHELL ──────────────────────────────────────────────────────────

  let panel = null, bar = null, toastEl = null, body = null;
  let activeTab = 'run';
  let liveTimer = null;

  const TABS = [
    ['run',   'RUN'],
    ['build', 'BUILD'],
    ['lab',   'LAB'],
    ['tune',  'TUNE'],
    ['stage', 'STAGE'],
    ['snap',  'SNAP'],
  ];

  function buildUI() {
    if (built) return;
    built = true;
    captureDefaults();

    const prefs = readLS(LS.PREFS, {});
    activeTab = prefs.tab && TABS.some(t => t[0] === prefs.tab) ? prefs.tab : 'run';

    // ── Toolbar: the things you reach for constantly, one click away ──
    bar = el('div', 'dv-bar');
    bar.innerHTML = `
      <span class="dv-bar-badge" title="Dev mode is active for this browser">DEV</span>
      <span class="dv-taint" id="dv-taint" title="This run has been altered and cannot be posted">TAINTED</span>
      <span class="dv-bar-sep"></span>
      <button class="dv-mini" data-act="stage-restart" title="Restart the current stage">⟲</button>
      <button class="dv-mini" data-act="stage-skip"    title="Clear the current stage and draft">⏭</button>
      <button class="dv-mini" data-act="freeze"        title="Freeze / unfreeze (no menu)">⏸</button>
      <button class="dv-mini" data-act="step"          title="Advance one frame while frozen">⏵|</button>
      <span class="dv-bar-sep"></span>
      <label class="dv-bar-label">SPD</label>
      <select class="dv-mini dv-speed" data-act="speed">
        <option value="0.25">0.25×</option>
        <option value="0.5">0.5×</option>
        <option value="1" selected>1×</option>
        <option value="2">2×</option>
        <option value="4">4×</option>
        <option value="8">8×</option>
      </select>
      <button class="dv-mini dv-toggle" data-act="god" title="Misses stop costing lives">GOD</button>
      <button class="dv-mini dv-toggle" data-act="bot" title="Let the paddle play itself">BOT</button>
      <span class="dv-bar-sep"></span>
      <button class="dv-mini dv-open" data-act="open" title="Open the dev console (\`)">CONSOLE</button>`;
    document.body.appendChild(bar);

    bar.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (btn && btn.tagName === 'BUTTON') barAction(btn.dataset.act);
    });
    bar.querySelector('[data-act="speed"]').addEventListener('change', e => {
      setTimeScale(num(e.target.value, 1));
    });

    // ── Panel ──
    panel = el('div', 'dv-panel');
    panel.innerHTML = `
      <div class="dv-head">
        <span class="dv-title">◈ DEV CONSOLE</span>
        <span class="dv-head-spacer"></span>
        <button class="dv-x" data-act="close" title="Close (\`)">✕</button>
      </div>
      <div class="dv-tabs">
        ${TABS.map(([id, label]) =>
          `<button class="dv-tab${id === activeTab ? ' is-on' : ''}" data-tab="${id}">${label}</button>`
        ).join('')}
      </div>
      <div class="dv-body"></div>
      <div class="dv-toast"></div>`;
    document.body.appendChild(panel);

    body    = panel.querySelector('.dv-body');
    toastEl = panel.querySelector('.dv-toast');

    body.addEventListener('click', onBodyClick);

    panel.querySelector('.dv-x').addEventListener('click', () => togglePanel(false));
    panel.querySelector('.dv-tabs').addEventListener('click', e => {
      const t = e.target.closest('.dv-tab');
      if (t) selectTab(t.dataset.tab);
    });

    makeDraggable(panel, panel.querySelector('.dv-head'), prefs.pos);

    if (prefs.open) togglePanel(true);
    selectTab(activeTab);

    // Live readouts. Deliberately only touches the RUN tab and the toolbar,
    // so typing in the lab or dragging a tuning slider is never interrupted
    // by a re-render underneath your cursor.
    clearInterval(liveTimer);
    liveTimer = setInterval(refreshLive, 250);
  }

  function showUI(on) {
    if (!built) return;
    bar.style.display = on ? 'flex' : 'none';
    if (!on) panel.classList.remove('is-open');
  }

  function togglePanel(force) {
    if (!built) return;
    const open = force == null ? !panel.classList.contains('is-open') : !!force;
    panel.classList.toggle('is-open', open);
    savePrefs({ open });
    if (open) renderActiveTab();
  }

  function selectTab(id) {
    activeTab = id;
    $$('.dv-tab').forEach(t => t.classList.toggle('is-on', t.dataset.tab === id));
    savePrefs({ tab: id });
    renderActiveTab();
  }

  function renderActiveTab() {
    if (!panel || !panel.classList.contains('is-open')) return;
    ({
      run:   renderRunTab,
      build: renderBuildTab,
      lab:   renderLabTab,
      tune:  renderTuneTab,
      stage: renderStageTab,
      snap:  renderSnapTab,
    })[activeTab]();
  }

  function refreshAll() { refreshToolbar(); renderActiveTab(); }

  function savePrefs(patch) {
    const prefs = readLS(LS.PREFS, {});
    writeLS(LS.PREFS, Object.assign(prefs, patch));
  }

  function makeDraggable(node, handle, saved) {
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      node.style.left = saved.x + 'px';
      node.style.top  = saved.y + 'px';
      node.style.right = 'auto';
    }
    let dx = 0, dy = 0, dragging = false;
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      dragging = true;
      const r = node.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(e.clientX - dx, window.innerWidth  - 120));
      const y = Math.max(0, Math.min(e.clientY - dy, window.innerHeight - 40));
      node.style.left  = x + 'px';
      node.style.top   = y + 'px';
      node.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      const r = node.getBoundingClientRect();
      savePrefs({ pos: { x: Math.round(r.left), y: Math.round(r.top) } });
    });
  }

  // ─── 10. TOOLBAR ACTIONS ──────────────────────────────────────────────────

  function barAction(act) {
    switch (act) {
      case 'open':          togglePanel(); break;
      case 'god':           setGod(!flags.god); break;
      case 'bot':           setAutoplay(!flags.autoplay); break;
      case 'freeze':        toggleFreeze(); break;
      case 'step':          stepFrame(); break;
      case 'stage-skip':    skipStage(); break;
      case 'stage-restart': restartStage(); break;
    }
  }

  function refreshToolbar() {
    if (!built || !bar) return;
    bar.querySelector('[data-act="god"]').classList.toggle('is-on', flags.god);
    bar.querySelector('[data-act="bot"]').classList.toggle('is-on', flags.autoplay);
    bar.querySelector('[data-act="freeze"]').classList.toggle('is-on', !!(api && api.state.paused));
    bar.querySelector('.dv-speed').value = String(flags.timeScale);
    bar.querySelector('#dv-taint').classList.toggle('is-on', taintedRun);
  }

  // ─── 11. DEV ACTIONS ──────────────────────────────────────────────────────

  function setGod(on) {
    flags.god = !!on;
    if (flags.god) taint('god');
    refreshToolbar();
    say('God mode ' + (flags.god ? 'ON — misses cost nothing' : 'off'));
  }

  function setAutoplay(on) {
    flags.autoplay = !!on;
    if (flags.autoplay) taint('autoplay');
    refreshToolbar();
    say('Autoplay ' + (flags.autoplay ? 'ON' : 'off'));
  }

  function setTimeScale(v) {
    flags.timeScale = Math.max(0.1, Math.min(16, num(v, 1)));
    if (flags.timeScale !== 1) taint('timescale');
    refreshToolbar();
  }

  function toggleFreeze() {
    if (!api || !api.state.active) { say('No run in progress', 'warn'); return; }
    if (api.state.paused) {
      // Unfreeze without the 3-2-1, which is the point of a dev freeze.
      api.state.paused = false;
      api.stResume();
      api.startGameBG();
    } else {
      api.pauseGame(false);
    }
    refreshToolbar();
  }

  function stepFrame() {
    if (!api || !api.state.active) return;
    if (!api.state.paused) api.pauseGame(false);
    flags.stepQueued = true;
    refreshToolbar();
  }

  function skipStage() {
    if (!api || !api.state.active) { say('No run in progress', 'warn'); return; }
    taint('stage-skip');
    api.forceEndStage();
    say('Stage ' + api.stage.num + ' cleared');
  }

  function restartStage() {
    if (!api || !api.state.active) { say('No run in progress', 'warn'); return; }
    taint('stage-restart');
    api.jumpToStage(Math.max(1, api.stage.num));
  }

  function jumpTo(n) {
    if (!api) return;
    const target = Math.max(1, n | 0);
    if (!api.state.active) {
      // Not playing — launch a run that starts there instead.
      flags.startStage = target;
      api.launchRun();
      taint('jump');
      return;
    }
    taint('jump');
    api.jumpToStage(target);
    say('→ Stage ' + target);
  }

  // ─── 12. RUN TAB ──────────────────────────────────────────────────────────

  function renderRunTab() {
    const s  = api ? api.state : {};
    const st = api ? api.stage : {};

    body.innerHTML = `
      <div class="dv-sec">
        <div class="dv-sec-h">LIVE STATE</div>
        <div class="dv-grid" id="dv-live"></div>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">EDIT</div>
        <div class="dv-row">
          <label>SCORE</label>
          <input type="number" class="dv-in" id="dv-set-score" value="${s.score || 0}">
          <button class="dv-btn" data-act="apply-score">SET</button>
        </div>
        <div class="dv-row">
          <label>LIVES</label>
          <input type="number" class="dv-in" id="dv-set-lives" value="${s.lives || 0}">
          <button class="dv-btn" data-act="apply-lives">SET</button>
          <button class="dv-btn dv-sm" data-act="life-up">+1</button>
          <button class="dv-btn dv-sm" data-act="life-down">−1</button>
        </div>
        <div class="dv-row">
          <label>COMBO</label>
          <input type="number" class="dv-in" id="dv-set-combo" value="${s.combo || 0}">
          <button class="dv-btn" data-act="apply-combo">SET</button>
        </div>
        <div class="dv-row">
          <label>REROLLS</label>
          <input type="number" class="dv-in" id="dv-set-rerolls" value="${Upgrades.rerolls}">
          <button class="dv-btn" data-act="apply-rerolls">SET</button>
        </div>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">STAGE CONTROL</div>
        <div class="dv-row">
          <label>JUMP TO</label>
          <input type="number" class="dv-in" id="dv-jump" min="1" value="${Math.max(1, st.num || 1)}">
          <button class="dv-btn" data-act="jump">GO</button>
        </div>
        <div class="dv-btns">
          <button class="dv-btn" data-act="stage-restart">⟲ RESTART STAGE</button>
          <button class="dv-btn" data-act="stage-skip">⏭ CLEAR STAGE</button>
          <button class="dv-btn" data-act="skip-ghost">SKIP GHOST PASS</button>
          <button class="dv-btn" data-act="open-draft">FORCE A DRAFT</button>
        </div>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">ASSISTS</div>
        <div class="dv-row dv-wrap">
          <button class="dv-btn dv-toggle${flags.god ? ' is-on' : ''}" data-act="god">GOD MODE</button>
          <button class="dv-btn dv-toggle${flags.autoplay ? ' is-on' : ''}" data-act="bot">AUTOPLAY</button>
        </div>
        <div class="dv-row">
          <label>BOT SKILL</label>
          <input type="range" class="dv-range" id="dv-skill" min="0" max="1" step="0.05" value="${flags.autoplaySkill}">
          <span class="dv-val" id="dv-skill-val">${Math.round(flags.autoplaySkill * 100)}%</span>
        </div>
        <div class="dv-row">
          <label>TIME SCALE</label>
          <input type="range" class="dv-range" id="dv-ts" min="0.1" max="8" step="0.1" value="${flags.timeScale}">
          <span class="dv-val" id="dv-ts-val">${flags.timeScale}×</span>
        </div>
        <p class="dv-hint">Autoplay at 4–8× is the fastest way to see how far a
        build actually gets. Bot skill below 100% adds aim error, so a build can
        still fail the way a human would fail it.</p>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">RUN</div>
        <div class="dv-btns">
          <button class="dv-btn" data-act="relaunch">RESTART RUN</button>
          <button class="dv-btn" data-act="clean-run">CLEAN RUN (UNTAINTED)</button>
          <button class="dv-btn dv-danger" data-act="kill">FORCE GAME OVER</button>
        </div>
        <div class="dv-row">
          <label>SEED</label>
          <input type="text" class="dv-in dv-in-wide" id="dv-seed" placeholder="RANDOM"
                 value="${esc(api ? api.getSeedInput() : '')}">
          <button class="dv-btn dv-sm" data-act="copy-seed">COPY</button>
        </div>
        <p class="dv-hint" id="dv-taint-why"></p>
      </div>`;

    const skill = $('#dv-skill');
    skill.addEventListener('input', () => {
      flags.autoplaySkill = num(skill.value, 1);
      $('#dv-skill-val').textContent = Math.round(flags.autoplaySkill * 100) + '%';
    });

    const ts = $('#dv-ts');
    ts.addEventListener('input', () => {
      setTimeScale(num(ts.value, 1));
      $('#dv-ts-val').textContent = flags.timeScale + '×';
    });

    refreshLive();
  }

  function runTabClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || !body.contains(btn)) return;
    const s = api.state;

    switch (btn.dataset.act) {
      case 'apply-score':
        s.score = num($('#dv-set-score').value, s.score) | 0;
        api.updateScore(); taint('score'); break;
      case 'apply-lives':
        s.lives = num($('#dv-set-lives').value, s.lives) | 0;
        api.updateLives(); taint('lives'); break;
      case 'apply-combo':
        s.combo = num($('#dv-set-combo').value, s.combo) | 0;
        if (s.combo > s.sessionMaxCombo) s.sessionMaxCombo = s.combo;
        api.updateCombo(); taint('combo'); break;
      case 'apply-rerolls':
        if (typeof Upgrades.setRerolls === 'function') {
          Upgrades.setRerolls(num($('#dv-set-rerolls').value, 0) | 0);
          taint('rerolls'); say('Rerolls set');
        } else say('upgrades.js has no setRerolls() — apply the patch', 'warn');
        break;
      case 'life-up':   s.lives++; api.updateLives(); taint('lives'); break;
      case 'life-down': s.lives--; api.updateLives(); taint('lives'); break;
      case 'jump':          jumpTo(num($('#dv-jump').value, 1)); break;
      case 'stage-restart': restartStage(); break;
      case 'stage-skip':    skipStage(); break;
      case 'skip-ghost':    api.skipGhostPass(); taint('skip-ghost'); break;
      case 'open-draft':    api.forceDraft(); taint('draft'); break;
      case 'god':  setGod(!flags.god);        renderRunTab(); break;
      case 'bot':  setAutoplay(!flags.autoplay); renderRunTab(); break;
      case 'relaunch':
        api.setSeedInput($('#dv-seed').value);
        api.launchRun();
        break;
      case 'clean-run':
        // Wipe every dev influence and start a run that could legitimately post.
        flags.god = false; flags.autoplay = false; flags.timeScale = 1;
        flags.startStage = 0; flags.presetBuild = null; flags.forcedHand = null;
        api.setSeedInput($('#dv-seed').value);
        api.launchRun();
        say('Clean run — leaderboard eligible', 'ok');
        break;
      case 'kill': taint('kill'); api.triggerGameOver(); break;
      case 'copy-seed': copy(api.state.runSeedCode || $('#dv-seed').value, 'Seed'); break;
      default: return;
    }
    refreshToolbar();
  }

  /** Cheap per-tick refresh: text only, no DOM rebuilds. */
  function refreshLive() {
    if (!unlocked || !panel || !panel.classList.contains('is-open')) { refreshToolbar(); return; }
    if (activeTab !== 'run') return;
    const host = $('#dv-live');
    if (!host || !api) return;

    const s = api.state, st = api.stage;
    const rows = [
      ['STATUS',  s.active ? (s.paused ? 'FROZEN' : 'RUNNING') : 'IDLE'],
      ['STAGE',   st.num || '—'],
      ['PHASE',   (st.phase || 'idle').toUpperCase()],
      ['SCORE',   s.score],
      ['LIVES',   s.lives],
      ['COMBO',   'x' + s.combo],
      ['SHIELDS', st.shields],
      ['PROGRESS', (st.resolved || 0) + ' / ' + (st.starsTotal || 0)],
      ['MISSED',  st.missed],
      ['GHOSTS',  st.ghostCatches],
      ['SEED',    s.runSeedCode || '—'],
      ['SPEED',   st.def ? (Math.round(st.def.speed * 100) / 100) : '—'],
      ['GAP',     st.def ? Math.round(st.def.baseGap) + 'ms' : '—'],
      ['ACTIVE OBJ', api.activeObjects.length],
    ];
    host.innerHTML = rows.map(([k, v]) =>
      `<div class="dv-cell"><span>${k}</span><b>${esc(v)}</b></div>`).join('');

    const why = $('#dv-taint-why');
    if (why) {
      why.textContent = taintedRun
        ? 'This run is TAINTED (' + [...taintReasons].join(', ') + ') and will not be offered to the leaderboard.'
        : 'Clean run — a good score here can still post to the board.';
      why.className = 'dv-hint' + (taintedRun ? ' dv-warn' : '');
    }
    refreshToolbar();
  }

  // ─── 13. BUILD TAB ────────────────────────────────────────────────────────
  //
  // Two halves. On top, every perk in the pool with its stack count, so you
  // can assemble any build in seconds. Underneath, the actual contents of
  // `Upgrades.mods` — which is where you find out whether a perk is bugged or
  // merely disappointing, because you can see exactly what it wrote.

  let buildFilter = '';

  function renderBuildTab() {
    const q = buildFilter.toLowerCase();
    const pool = Upgrades.POOL.filter(p =>
      !q || p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) ||
      p.rarity.includes(q) || (p.desc || '').toLowerCase().includes(q));

    const byRarity = { common: [], uncommon: [], rare: [] };
    for (const p of pool) (byRarity[p.rarity] || byRarity.common).push(p);

    const card = p => {
      const n = Upgrades.stacksOf(p.id);
      return `
        <div class="dv-perk rarity-${p.rarity}${n ? ' is-owned' : ''}${p.__lab ? ' is-lab' : ''}"
             title="${esc(p.desc)}">
          <span class="dv-perk-ico">${esc(p.icon)}</span>
          <span class="dv-perk-name">${esc(p.name)}${p.__lab ? ' <em>lab</em>' : ''}</span>
          <span class="dv-perk-stack">${n}/${p.maxStacks}</span>
          <span class="dv-perk-btns">
            <button class="dv-btn dv-sm" data-perk-dec="${esc(p.id)}">−</button>
            <button class="dv-btn dv-sm" data-perk-inc="${esc(p.id)}">+</button>
            <button class="dv-btn dv-sm" data-perk-max="${esc(p.id)}">MAX</button>
          </span>
        </div>`;
    };

    const owned = Upgrades.ownedSummary();
    const diff  = modsDiff();
    const changedKeys = Object.keys(diff).filter(k => diff[k].changed);

    body.innerHTML = `
      <div class="dv-sec">
        <div class="dv-sec-h">CURRENT BUILD
          <span class="dv-sec-note">${owned.length} perk${owned.length === 1 ? '' : 's'}</span>
        </div>
        <div class="dv-owned">
          ${owned.length
            ? owned.map(o => `<span class="dv-chip rarity-${o.rarity}" title="${esc(o.desc)}"
                 data-perk-zero="${esc(o.id)}">${esc(o.icon)} ${esc(o.name)}${o.stacks > 1 ? ' ×' + o.stacks : ''} <b>✕</b></span>`).join('')
            : '<span class="dv-empty">Nothing drafted yet.</span>'}
        </div>
        <div class="dv-btns">
          <button class="dv-btn" data-act="build-clear">CLEAR BUILD</button>
          <button class="dv-btn" data-act="build-copy">COPY BUILD</button>
          <button class="dv-btn" data-act="build-paste">PASTE BUILD</button>
          <button class="dv-btn" data-act="build-random">RANDOM 5</button>
        </div>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">NEXT DRAFT</div>
        <p class="dv-hint">Pick up to ${CONFIG.DRAFT.CARDS} perks to force into the next
        hand instead of rolling for them. Clears itself once it has been dealt.</p>
        <div class="dv-row">
          <span class="dv-forced" id="dv-forced">${
            flags.forcedHand && flags.forcedHand.length
              ? flags.forcedHand.map(id => esc((Upgrades.BY_ID[id] || {}).name || id)).join(' · ')
              : '<span class="dv-empty">rolling normally</span>'}</span>
          <button class="dv-btn dv-sm" data-act="forced-clear">CLEAR</button>
        </div>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">POOL</div>
        <div class="dv-row">
          <input type="text" class="dv-in dv-in-wide" id="dv-perk-filter"
                 placeholder="filter by name, id, rarity…" value="${esc(buildFilter)}">
          <button class="dv-btn dv-sm" data-act="forced-hint" title="Shift-click a perk to force it into the next draft">?</button>
        </div>
        ${['common', 'uncommon', 'rare'].map(r => byRarity[r].length ? `
          <div class="dv-rarity-h dv-${r}">${r.toUpperCase()} <span>${byRarity[r].length}</span></div>
          <div class="dv-perks">${byRarity[r].map(card).join('')}</div>` : '').join('')}
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">MODS
          <span class="dv-sec-note">${changedKeys.length} changed</span>
        </div>
        <p class="dv-hint">Every field the game reads off <code>Upgrades.mods</code>.
        Highlighted rows differ from neutral — if a perk you just granted did not
        light one of these up, its <code>apply()</code> is the bug.</p>
        <div class="dv-mods">
          ${Object.keys(diff).map(k => {
            const d = diff[k];
            return `<div class="dv-mod${d.changed ? ' is-changed' : ''}">
              <span>${esc(k)}</span>
              <b>${esc(fmtMod(d.value))}</b>
              <em>${d.changed ? esc(fmtMod(d.neutral)) : ''}</em>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    const filter = $('#dv-perk-filter');
    filter.addEventListener('input', () => {
      buildFilter = filter.value;
      const at = filter.selectionStart;
      renderBuildTab();
      const again = $('#dv-perk-filter');
      again.focus();
      again.setSelectionRange(at, at);
    });
  }

  function fmtMod(v) {
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number')  return Math.round(v * 1000) / 1000;
    return String(v);
  }

  function buildTabClick(e) {
    const inc  = e.target.closest('[data-perk-inc]');
    const dec  = e.target.closest('[data-perk-dec]');
    const max  = e.target.closest('[data-perk-max]');
    const zero = e.target.closest('[data-perk-zero]');

    if (inc || dec || max) {
      const node = inc || dec || max;
      const id   = node.dataset.perkInc || node.dataset.perkDec || node.dataset.perkMax;
      const perk = Upgrades.BY_ID[id];
      if (!perk) return;

      // Shift-click a + to stage the perk into the next draft instead.
      if (inc && e.shiftKey) {
        const hand = (flags.forcedHand || []).filter(x => x !== id);
        hand.push(id);
        flags.forcedHand = hand.slice(-CONFIG.DRAFT.CARDS);
        taint('forced-draft');
        say('Forced into next draft: ' + perk.name);
        renderBuildTab();
        return;
      }

      const now = Upgrades.stacksOf(id);
      setStacks(id, max ? perk.maxStacks : Math.max(0, Math.min(perk.maxStacks, now + (inc ? 1 : -1))));
      renderBuildTab();
      return;
    }

    if (zero) { setStacks(zero.dataset.perkZero, 0); renderBuildTab(); return; }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;

    switch (btn.dataset.act) {
      case 'build-clear':  clearBuild(); renderBuildTab(); break;
      case 'build-copy':   copy(JSON.stringify(readBuild()), 'Build'); break;
      case 'build-paste': {
        const raw = prompt('Paste a build (JSON array of {id, stacks}):');
        if (!raw) return;
        try {
          writeBuild(JSON.parse(raw));
          taint('build');
          say('Build applied', 'ok');
        } catch (err) { say('That is not valid build JSON', 'warn'); }
        renderBuildTab();
        break;
      }
      case 'build-random': {
        const pool = Upgrades.POOL.slice();
        const picked = [];
        for (let i = 0; i < 5 && pool.length; i++) {
          picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
        writeBuild(picked.map(p => ({ id: p.id, stacks: 1 })));
        taint('build');
        renderBuildTab();
        break;
      }
      case 'forced-clear': flags.forcedHand = null; renderBuildTab(); break;
      case 'forced-hint':  say('Shift-click a perk’s + to force it into the next draft'); break;
    }
  }

  // ─── 14. LAB TAB ──────────────────────────────────────────────────────────
  //
  // Write a perk, press TRY, play it. That is the whole loop.

  const LAB_TEMPLATE = `{
  id: 'proto_magnet',
  name: 'MAGNET',
  rarity: 'uncommon',
  icon: '🧲',
  maxStacks: 3,
  desc: '+30px paddle, but stars fall 8% faster.',

  // Standard perk: change values the game already reads.
  apply: (m, stacks) => {
    m.paddleWidthBonus += 30;
    m.fallSpeedMult    *= 1.08;
  },

  // Prototype-only hooks. These are fired by devtools.js, not by game.js,
  // so they let you feel out a mechanic before you commit to wiring it in.
  // onCatch:    ctx => { if (ctx.isChroma) ctx.addLife(1); },
  // onMiss:     ctx => { ctx.addScore(-50); },
  // onStageEnd: ctx => { ctx.addScore(25 * ctx.stage.num); },
}`;

  let labCurrent = '';

  function renderLabTab() {
    const slots = labSlots();
    const names = Object.keys(slots).sort();
    const modKeys = Object.keys(Upgrades.mods);

    body.innerHTML = `
      <div class="dv-sec">
        <div class="dv-sec-h">PROTOTYPE
          <span class="dv-sec-note">${labPerkIds().length} live in the pool</span>
        </div>
        <textarea class="dv-code" id="dv-lab-src" spellcheck="false"
          placeholder="a perk object literal…">${esc(labCurrent || LAB_TEMPLATE)}</textarea>
        <div class="dv-btns">
          <button class="dv-btn dv-primary" data-act="lab-try">TRY IT</button>
          <button class="dv-btn" data-act="lab-register">REGISTER ONLY</button>
          <button class="dv-btn" data-act="lab-save">SAVE AS…</button>
          <button class="dv-btn" data-act="lab-template">TEMPLATE</button>
          <button class="dv-btn" data-act="lab-export">EXPORT FOR upgrades.js</button>
        </div>
        <p class="dv-hint"><b>TRY IT</b> compiles it, replaces any earlier version,
        wipes it off your build and grants one fresh stack — so pressing it twice
        never leaves you comparing v2 stacked on top of v1.</p>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">VERSIONS
          <span class="dv-sec-note">${names.length} saved</span>
        </div>
        ${names.length ? `<div class="dv-slots">${names.map(n => `
          <div class="dv-slot">
            <button class="dv-slot-load" data-lab-load="${esc(n)}">${esc(n)}</button>
            <button class="dv-btn dv-sm" data-lab-try="${esc(n)}">TRY</button>
            <button class="dv-btn dv-sm dv-danger" data-lab-del="${esc(n)}">✕</button>
          </div>`).join('')}</div>`
          : '<p class="dv-empty">Nothing saved. SAVE AS… keeps a version so you can flip between takes.</p>'}
        <p class="dv-hint">Saved versions are re-registered automatically on reload,
        so a prototype you liked yesterday is still draftable today.</p>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">WHAT apply() CAN REACH</div>
        <p class="dv-hint">These are the only fields game.js actually reads. A perk
        that needs something not on this list needs a real change in game.js —
        the hooks above are how you decide whether it is worth making.</p>
        <div class="dv-keys">${modKeys.map(k =>
          `<code data-lab-key="${esc(k)}" title="click to insert">${esc(k)}</code>`).join('')}</div>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">HOOK CONTEXT</div>
        <div class="dv-mods">
          ${[
            ['ctx.state',      'live run state (score, lives, combo…)'],
            ['ctx.stage',      'current stage record (num, caught, missed…)'],
            ['ctx.mods',       'the live Upgrades.mods object'],
            ['ctx.stacks',     'how many copies of this perk are owned'],
            ['ctx.obj',        'onCatch / onMiss: the star involved'],
            ['ctx.points',     'onCatch: points already awarded'],
            ['ctx.precision',  'onCatch: 0 = paddle edge, 1 = dead centre'],
            ['ctx.isChroma',   'onCatch / onMiss: was it a Chroma'],
            ['ctx.addScore(n)','award points, HUD updated for you'],
            ['ctx.addLife(n)', 'give or take lives'],
            ['ctx.setCombo(n)','overwrite the combo'],
            ['ctx.toast(text)','small message near the paddle'],
            ['ctx.banner(t,s)','big centred banner'],
            ['ctx.log(...)',   'console.log tagged [lab]'],
          ].map(([k, v]) => `<div class="dv-mod"><span>${esc(k)}</span><em>${esc(v)}</em></div>`).join('')}
        </div>
      </div>`;

    const ta = $('#dv-lab-src');
    ta.addEventListener('input', () => { labCurrent = ta.value; });
    // Tab should indent, not escape the textarea.
    ta.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const s = ta.selectionStart, t = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(t);
      ta.selectionStart = ta.selectionEnd = s + 2;
      labCurrent = ta.value;
    });
  }

  function labTabClick(e) {
    const load = e.target.closest('[data-lab-load]');
    const tryN = e.target.closest('[data-lab-try]');
    const del  = e.target.closest('[data-lab-del]');
    const key  = e.target.closest('[data-lab-key]');

    if (key) {
      const ta = $('#dv-lab-src');
      const at = ta.selectionStart;
      const insert = 'm.' + key.dataset.labKey;
      ta.value = ta.value.slice(0, at) + insert + ta.value.slice(ta.selectionEnd);
      labCurrent = ta.value;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = at + insert.length;
      return;
    }

    if (load || tryN) {
      const node = load || tryN;
      const name = node.dataset.labLoad || node.dataset.labTry;
      const slot = labSlots()[name];
      if (!slot) return;
      labCurrent = slot.source;
      renderLabTab();
      if (tryN) labTry();
      return;
    }

    if (del) {
      if (!confirm('Delete lab version "' + del.dataset.labDel + '"?')) return;
      labDelete(del.dataset.labDel);
      renderLabTab();
      return;
    }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;

    switch (btn.dataset.act) {
      case 'lab-try':      labTry(); break;
      case 'lab-register': labDoRegister(); break;
      case 'lab-save': {
        const name = prompt('Save this version as:', 'v' + (Object.keys(labSlots()).length + 1));
        if (!name) return;
        labStore(name.trim(), $('#dv-lab-src').value);
        say('Saved "' + name.trim() + '"', 'ok');
        renderLabTab();
        break;
      }
      case 'lab-template':
        if (labCurrent && !confirm('Replace the editor with the template?')) return;
        labCurrent = LAB_TEMPLATE;
        renderLabTab();
        break;
      case 'lab-export': {
        const src = ($('#dv-lab-src').value || '').trim().replace(/,\s*$/, '');
        copy('    ' + src.replace(/\n/g, '\n    ') + ',\n', 'Perk');
        say('Copied — paste it into the POOL array in upgrades.js', 'ok');
        break;
      }
    }
  }

  function labDoRegister() {
    try {
      const def = labRegister(labCompile($('#dv-lab-src').value));
      say('Registered ' + def.name + ' — it can now appear in drafts', 'ok');
      return def;
    } catch (err) {
      say(err.message, 'warn');
      console.error('[Dev] lab compile failed:', err);
      return null;
    }
  }

  /** Compile, replace any earlier version, and grant exactly one clean stack. */
  function labTry() {
    const def = labDoRegister();
    if (!def) return;
    const build = readBuild().filter(b => b.id !== def.id);
    build.push({ id: def.id, stacks: 1 });
    writeBuild(build);
    taint('lab');
    renderLabTab();
    say('Granted ' + def.name + ' — go play', 'ok');
  }

  // ─── 15. TUNE TAB ─────────────────────────────────────────────────────────
  //
  // Reflected straight off CONFIG rather than hand-listed, so a constant you
  // add to config.js next week shows up here on its own with no work.

  let tuneFilter = '';

  /** A sensible slider range for a value we know nothing about but its size. */
  function rangeFor(path, value) {
    const def = DEFAULTS[path];
    if (typeof def === 'boolean') return null;
    if (def === 0) return { min: 0, max: 10, step: 0.1 };
    const mag = Math.abs(def);
    const max = mag * 3;
    const step = mag >= 100 ? 5 : mag >= 10 ? 1 : mag >= 1 ? 0.1 : 0.005;
    return { min: def < 0 ? def * 3 : 0, max, step };
  }

  function renderTuneTab() {
    captureDefaults();
    const q = tuneFilter.toLowerCase();
    const changed = tuneChanged();
    const nChanged = Object.keys(changed).length;

    const paths = Object.keys(DEFAULTS).filter(p => !q || p.toLowerCase().includes(q));
    const bySection = {};
    for (const p of paths) {
      const section = p.split('.')[0];
      (bySection[section] = bySection[section] || []).push(p);
    }

    const control = path => {
      const live = tuneGet(path);
      const isChanged = live !== DEFAULTS[path];
      const label = path.split('.').slice(1).join('.');
      if (typeof DEFAULTS[path] === 'boolean') {
        return `<div class="dv-tune${isChanged ? ' is-changed' : ''}">
          <label title="${esc(path)}">${esc(label)}</label>
          <input type="checkbox" class="dv-check" data-tune="${esc(path)}" ${live ? 'checked' : ''}>
          <span class="dv-was">${isChanged ? 'was ' + DEFAULTS[path] : ''}</span>
        </div>`;
      }
      const r = rangeFor(path, live);
      return `<div class="dv-tune${isChanged ? ' is-changed' : ''}">
        <label title="${esc(path)}">${esc(label)}</label>
        <input type="range" class="dv-range" data-tune-range="${esc(path)}"
               min="${r.min}" max="${r.max}" step="${r.step}" value="${live}">
        <input type="number" class="dv-in dv-in-num" data-tune="${esc(path)}"
               step="${r.step}" value="${live}">
        <span class="dv-was">${isChanged ? 'was ' + DEFAULTS[path] : ''}</span>
      </div>`;
    };

    body.innerHTML = `
      <div class="dv-sec">
        <div class="dv-sec-h">LIVE CONFIG
          <span class="dv-sec-note">${nChanged} changed</span>
        </div>
        <p class="dv-hint">Writes straight into the live CONFIG object. Values read
        once per stage (star counts, gaps, speeds) take effect on the
        <em>next</em> stage — restart the stage to see them immediately.</p>
        <div class="dv-row">
          <input type="text" class="dv-in dv-in-wide" id="dv-tune-filter"
                 placeholder="filter, e.g. gap, chroma, ghost…" value="${esc(tuneFilter)}">
        </div>
        <div class="dv-btns">
          <button class="dv-btn dv-primary" data-act="tune-export">COPY CHANGES</button>
          <button class="dv-btn" data-act="tune-reset">RESET ALL</button>
          <button class="dv-btn dv-toggle${flags.persistTuning ? ' is-on' : ''}"
                  data-act="tune-persist">KEEP ON RELOAD</button>
        </div>
        ${nChanged ? `<div class="dv-diff">${Object.entries(changed).map(([p, d]) =>
          `<div><span>${esc(p)}</span><b>${esc(d.to)}</b><em>${esc(d.from)}</em>
           <button class="dv-btn dv-sm" data-tune-revert="${esc(p)}">↺</button></div>`).join('')}</div>` : ''}
      </div>

      ${Object.keys(bySection).map(section => `
        <div class="dv-sec">
          <div class="dv-sec-h">${esc(section)}</div>
          ${bySection[section].map(control).join('')}
        </div>`).join('')}`;

    const filter = $('#dv-tune-filter');
    filter.addEventListener('input', () => {
      tuneFilter = filter.value;
      const at = filter.selectionStart;
      renderTuneTab();
      const again = $('#dv-tune-filter');
      again.focus();
      again.setSelectionRange(at, at);
    });

    // Sliders and number boxes stay in step with each other without a rerender.
    $$('[data-tune-range]').forEach(r => {
      r.addEventListener('input', () => {
        const path = r.dataset.tuneRange;
        tuneSet(path, num(r.value, DEFAULTS[path]));
        const box = $(`[data-tune="${CSS.escape(path)}"]`);
        if (box) box.value = r.value;
        r.closest('.dv-tune').classList.toggle('is-changed', tuneGet(path) !== DEFAULTS[path]);
        taint('tuning');
        saveTuning();
      });
    });

    $$('[data-tune]').forEach(input => {
      const path = input.dataset.tune;
      input.addEventListener('change', () => {
        const value = input.type === 'checkbox' ? input.checked : num(input.value, DEFAULTS[path]);
        tuneSet(path, value);
        const slider = $(`[data-tune-range="${CSS.escape(path)}"]`);
        if (slider) slider.value = value;
        input.closest('.dv-tune').classList.toggle('is-changed', tuneGet(path) !== DEFAULTS[path]);
        taint('tuning');
        saveTuning();
      });
    });
  }

  function tuneTabClick(e) {
    const revert = e.target.closest('[data-tune-revert]');
    if (revert) {
      tuneSet(revert.dataset.tuneRevert, DEFAULTS[revert.dataset.tuneRevert]);
      saveTuning();
      renderTuneTab();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'tune-export': copy(tuneExport(), 'CONFIG changes'); break;
      case 'tune-reset':
        if (!confirm('Reset every CONFIG value to what config.js ships?')) return;
        tuneResetAll();
        renderTuneTab();
        say('CONFIG back to defaults', 'ok');
        break;
      case 'tune-persist':
        flags.persistTuning = !flags.persistTuning;
        saveTuning();
        renderTuneTab();
        say(flags.persistTuning
          ? 'Overrides will be restored next reload'
          : 'Overrides cleared — reloads start clean');
        break;
    }
  }

  // ─── 16. STAGE TAB ────────────────────────────────────────────────────────
  //
  // The stage is authored in full before a single star drops, which means we
  // can just read it. When a stage "feels wrong", this tells you whether the
  // generator built something wrong or the game played it wrong.

  function renderStageTab() {
    const st = api ? api.stage : {};
    const def = st.def;

    const previewStage = def ? def.number : 1;

    body.innerHTML = `
      <div class="dv-sec">
        <div class="dv-sec-h">STAGE ${def ? def.number : '—'}</div>
        ${def ? `
        <div class="dv-grid">
          ${[['STARS', def.starCount], ['FRAMES', def.frames.length],
             ['SPEED', Math.round(def.speed * 100) / 100],
             ['BASE GAP', Math.round(def.baseGap) + 'ms'],
             ['DIFFICULTY', Math.round(def.difficulty * 100) + '%'],
             ['PATTERNS', def.patterns.join(', ') || '—'],
             ['LIES', def.hasLies ? 'yes' : 'no'],
             ['PHANTOMS', def.hasPhantoms ? 'yes' : 'no']]
            .map(([k, v]) => `<div class="dv-cell"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
        </div>
        <div class="dv-frames">
          ${def.frames.map((f, i) => `
            <div class="dv-frame${f.phantom ? ' is-phantom' : ''}">
              <span class="dv-frame-n">${String(i + 1).padStart(2, '0')}</span>
              <span class="dv-track">
                ${f.stars.map(s => `
                  <i class="dv-dot${s.isChroma ? ' is-chroma' : ''}${s.lying ? ' is-lie' : ''}"
                     style="left:${(s.nx * 100).toFixed(1)}%"
                     title="nx ${s.nx.toFixed(3)}${s.lying ? ' · ghost shows ' + s.ghostNx.toFixed(3) : ''}${s.isChroma ? ' · CHROMA' : ''}"></i>
                  ${s.lying ? `<i class="dv-dot is-ghost" style="left:${(s.ghostNx * 100).toFixed(1)}%"></i>` : ''}
                `).join('')}
              </span>
              <span class="dv-frame-gap">${Math.round(f.gap)}</span>
            </div>`).join('')}
        </div>
        <p class="dv-hint">Each row is one frame; dots are normalised x positions.
        Gold = Chroma, hollow = where a lying ghost claims the star will be,
        dimmed row = a phantom the ghost pass skips. Right-hand number is the
        gap in ms before the next frame.</p>
        <div class="dv-btns">
          <button class="dv-btn" data-act="stage-reroll">REBUILD THIS STAGE</button>
          <button class="dv-btn" data-act="stage-copy">COPY STAGE JSON</button>
        </div>`
        : '<p class="dv-empty">No stage built yet — start a run.</p>'}
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">DRY RUN</div>
        <p class="dv-hint">Build a stage without playing it, to check the curve
        at a stage you have not reached.</p>
        <div class="dv-row">
          <label>STAGE</label>
          <input type="number" class="dv-in" id="dv-dry" min="1" value="${previewStage}">
          <button class="dv-btn" data-act="dry-run">INSPECT</button>
          <button class="dv-btn" data-act="dry-curve">CURVE 1–30</button>
        </div>
        <div id="dv-dry-out"></div>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">RUN LOG
          <span class="dv-sec-note">${runLog.length} stage${runLog.length === 1 ? '' : 's'}</span>
        </div>
        ${runLog.length ? `
          <div class="dv-log">
            <div class="dv-log-r dv-log-h"><span>ST</span><span>CAUGHT</span><span>MISS</span><span>SCORE</span><span>+</span></div>
            ${runLog.slice(-14).reverse().map(r => `
              <div class="dv-log-r${r.perfect ? ' is-perfect' : ''}">
                <span>${r.stage}</span><span>${r.caught}/${r.stars}</span>
                <span>${r.missed}</span><span>${r.score}</span><span>+${r.gained}</span>
              </div>`).join('')}
          </div>` : '<p class="dv-empty">Clear a stage and it lands here.</p>'}
        <div class="dv-btns">
          <button class="dv-btn" data-act="log-csv">COPY CSV</button>
          <button class="dv-btn" data-act="log-clear">CLEAR LOG</button>
        </div>
      </div>`;
  }

  function stageTabClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'stage-reroll':
        taint('stage-reroll');
        api.rebuildStage();
        renderStageTab();
        say('Stage rebuilt from the current CONFIG');
        break;
      case 'stage-copy':
        copy(JSON.stringify(api.stage.def, null, 2), 'StageDef');
        break;
      case 'dry-run': {
        const n = Math.max(1, num($('#dv-dry').value, 1) | 0);
        const def = StageGen.build(n, Upgrades.mods);
        $('#dv-dry-out').innerHTML = `
          <div class="dv-grid">
            ${[['STARS', def.starCount], ['FRAMES', def.frames.length],
               ['SPEED', Math.round(def.speed * 100) / 100],
               ['GAP', Math.round(def.baseGap) + 'ms'],
               ['DIFFICULTY', Math.round(def.difficulty * 100) + '%'],
               ['EST. LENGTH', Math.round(StageGen.estimateDuration(def) / 100) / 10 + 's']]
              .map(([k, v]) => `<div class="dv-cell"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
          </div>`;
        break;
      }
      case 'dry-curve': {
        const rows = [];
        for (let n = 1; n <= 30; n++) {
          const def = StageGen.build(n, Upgrades.mods);
          rows.push({ n, stars: def.starCount, frames: def.frames.length,
                      speed: Math.round(def.speed * 100) / 100,
                      gap: Math.round(def.baseGap),
                      secs: Math.round(StageGen.estimateDuration(def) / 100) / 10 });
        }
        $('#dv-dry-out').innerHTML = `
          <div class="dv-log">
            <div class="dv-log-r dv-log-h"><span>ST</span><span>STARS</span><span>SPEED</span><span>GAP</span><span>SECS</span></div>
            ${rows.map(r => `<div class="dv-log-r">
              <span>${r.n}</span><span>${r.stars}</span><span>${r.speed}</span>
              <span>${r.gap}</span><span>${r.secs}</span></div>`).join('')}
          </div>
          <div class="dv-btns"><button class="dv-btn dv-sm" data-act="curve-csv">COPY CSV</button></div>`;
        window.__dvCurve = rows;
        break;
      }
      case 'curve-csv': {
        const rows = window.__dvCurve || [];
        copy('stage,stars,frames,speed,gap,secs\n' +
             rows.map(r => [r.n, r.stars, r.frames, r.speed, r.gap, r.secs].join(',')).join('\n'),
             'Curve');
        break;
      }
      case 'log-csv':   copy(runLogCsv(), 'Run log'); break;
      case 'log-clear': runLog = []; renderStageTab(); break;
    }
  }

  // ─── 17. SNAP TAB ─────────────────────────────────────────────────────────

  function renderSnapTab() {
    const all = snapshots();
    const names = Object.keys(all).sort((a, b) => all[b].saved - all[a].saved);

    body.innerHTML = `
      <div class="dv-sec">
        <div class="dv-sec-h">SCENARIOS</div>
        <p class="dv-hint">A snapshot stores the seed, the stage, the whole build,
        your CONFIG changes and any lab prototypes. Restoring one relaunches the
        run and drops you back in exactly where you were.</p>
        <div class="dv-row">
          <input type="text" class="dv-in dv-in-wide" id="dv-snap-name"
                 placeholder="name this scenario…">
          <button class="dv-btn dv-primary" data-act="snap-save">SAVE NOW</button>
        </div>
      </div>

      <div class="dv-sec">
        <div class="dv-sec-h">SAVED
          <span class="dv-sec-note">${names.length}</span>
        </div>
        ${names.length ? names.map(n => {
          const s = all[n];
          return `<div class="dv-snap">
            <div class="dv-snap-top">
              <b>${esc(n)}</b>
              <span>stage ${s.stage} · ${s.build.length} perk${s.build.length === 1 ? '' : 's'} · seed ${esc(s.seed || '—')}</span>
            </div>
            <div class="dv-snap-btns">
              <button class="dv-btn dv-sm dv-primary" data-snap-load="${esc(n)}">RESTORE</button>
              <button class="dv-btn dv-sm" data-snap-copy="${esc(n)}">EXPORT</button>
              <button class="dv-btn dv-sm dv-danger" data-snap-del="${esc(n)}">✕</button>
            </div>
          </div>`;
        }).join('') : '<p class="dv-empty">No scenarios saved yet.</p>'}
        <div class="dv-btns">
          <button class="dv-btn" data-act="snap-import">IMPORT FROM TEXT</button>
        </div>
      </div>`;
  }

  function snapTabClick(e) {
    const load = e.target.closest('[data-snap-load]');
    const cp   = e.target.closest('[data-snap-copy]');
    const del  = e.target.closest('[data-snap-del]');

    if (load) { restoreSnapshot(snapshots()[load.dataset.snapLoad]); return; }
    if (cp)   { copy(JSON.stringify(snapshots()[cp.dataset.snapCopy]), 'Scenario'); return; }
    if (del)  {
      if (!confirm('Delete scenario "' + del.dataset.snapDel + '"?')) return;
      const all = snapshots();
      delete all[del.dataset.snapDel];
      snapshotsSave(all);
      renderSnapTab();
      return;
    }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'snap-save') {
      const name = ($('#dv-snap-name').value || '').trim() ||
                   ('stage ' + (api.stage.num || 1) + ' — ' + new Date().toLocaleTimeString());
      captureSnapshot(name);
      renderSnapTab();
      say('Saved "' + name + '"', 'ok');
    } else if (btn.dataset.act === 'snap-import') {
      const raw = prompt('Paste an exported scenario:');
      if (!raw) return;
      try {
        const snap = JSON.parse(raw);
        if (!snap || !snap.name) throw new Error('missing name');
        const all = snapshots();
        all[snap.name] = snap;
        snapshotsSave(all);
        renderSnapTab();
        say('Imported "' + snap.name + '"', 'ok');
      } catch (_) { say('That is not a scenario export', 'warn'); }
    }
  }

  // ─── 18. EVENT ROUTING ────────────────────────────────────────────────────
  //
  // One delegated listener on the body, installed once. Each tab re-renders by
  // replacing innerHTML, so per-render listeners would pile up invisibly.

  function onBodyClick(e) {
    switch (activeTab) {
      case 'run':   runTabClick(e);   break;
      case 'build': buildTabClick(e); break;
      case 'lab':   labTabClick(e);   break;
      case 'tune':  tuneTabClick(e);  break;
      case 'stage': stageTabClick(e); break;
      case 'snap':  snapTabClick(e);  break;
    }
  }

  // ─── 19. HOTKEYS ──────────────────────────────────────────────────────────

  function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  document.addEventListener('keydown', e => {
    if (!unlocked || isTyping(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case '`':  e.preventDefault(); togglePanel(); break;
      case '[':  e.preventDefault(); restartStage(); break;
      case ']':  e.preventDefault(); skipStage();    break;
      case '\\': e.preventDefault(); toggleFreeze();  break;
      default: return;
    }
  }, true);   // capture, so the game's own Space handler never sees these

  // ─── 20. BOOT ─────────────────────────────────────────────────────────────

  (function boot() {
    captureDefaults();

    if (typeof Auth !== 'undefined' && Auth.ready && typeof Auth.ready.then === 'function') {
      Auth.ready.then(evaluateGate, evaluateGate);
      if (typeof Auth.onChange === 'function') Auth.onChange(() => evaluateGate());
    } else {
      evaluateGate();
    }
  })();

  // ─── 21. THE BRIDGE ───────────────────────────────────────────────────────
  //
  // Everything game.js is allowed to know about this file. Every method is
  // safe to call when dev mode is locked, and returns the neutral answer — so
  // the seams in game.js read as ordinary code rather than as debug plumbing.

  return {
    get enabled() { return unlocked; },

    // — per-frame / per-schedule queries —
    timeScale()  { return unlocked ? flags.timeScale : 1; },
    godMode()    { return unlocked && flags.god; },
    tainted()    { return unlocked && taintedRun; },

    /** True exactly once after the STEP button, to advance a frozen frame. */
    consumeStep() {
      if (!unlocked || !flags.stepQueued) return false;
      flags.stepQueued = false;
      return true;
    },

    /** Which stage a fresh run should open on. */
    startStage(fallback) {
      if (!unlocked || !flags.startStage) return fallback;
      const n = flags.startStage;
      flags.startStage = 0;
      if (n > 1) taint('start-stage');
      return n;
    },

    /**
     * Perks to force into the next draft, or null to roll normally.
     * Consumed on read so a forced hand applies once and then gets out of
     * the way.
     */
    forcedHand() {
      if (!unlocked || !flags.forcedHand || !flags.forcedHand.length) return null;
      const hand = flags.forcedHand.map(id => Upgrades.BY_ID[id]).filter(Boolean);
      flags.forcedHand = null;
      if (activeTab === 'build') renderBuildTab();
      return hand.length ? hand : null;
    },

    // — notifications from the game —
    onFrame() {
      if (!unlocked) return;
      tickAutoPlay();
    },

    onRunStart() {
      if (!unlocked) return;
      // A new run is innocent until a dev power touches it.
      taintedRun = false;
      taintReasons = new Set();
      _hookErrored.clear();
      runLog = [];

      if (flags.presetBuild && flags.presetBuild.length) {
        writeBuild(flags.presetBuild);
        flags.presetBuild = null;
        taint('preset-build');
      }
      refreshAll();
    },

    onStageBegin() {
      if (!unlocked) return;
      if (activeTab === 'stage') renderStageTab();
      refreshToolbar();
    },

    onStageEnd(result) {
      if (!unlocked) return;
      logStage(result);
      fireHook('onStageEnd', { result });
    },

    onCatch(info) { if (unlocked) fireHook('onCatch', info); },
    onMiss(info)  { if (unlocked) fireHook('onMiss',  info); },

    onGameOver() {
      if (!unlocked) return;
      refreshAll();
      if (taintedRun) {
        console.log('[Dev] run was tainted (' + [...taintReasons].join(', ') +
                    ') — leaderboard submission was skipped.');
      }
    },

    /** game.js hands over its internals here, once, at the end of load. */
    attach(gameApi) {
      api = gameApi;
      if (unlocked) { refreshAll(); }
      return this;
    },

    taint,

    // — console conveniences —
    open:  () => togglePanel(true),
    close: () => togglePanel(false),
    jumpTo,
    grantPerk,
    clearBuild,
    setGod,
    setAutoplay,
    setTimeScale,
    snapshot: name => captureSnapshot(name || 'quick'),
    restore:  name => restoreSnapshot(snapshots()[name]),
    lab: {
      compile:  labCompile,
      register: src => labRegister(labCompile(src)),
      list:     labSlots,
    },
    config: { changed: tuneChanged, reset: tuneResetAll, export: tuneExport },
    log: () => runLog.slice(),

    /**
     * Prints the identity strings to paste into CONFIG.DEV.ADMINS. Sign in as
     * the account you want to be your dev account, then call SC.whoami().
     */
    whoami() {
      if (typeof Auth === 'undefined') { console.log('[Dev] Auth is not loaded.'); return null; }
      const s = Auth.state();
      const info = {
        signedIn: s.loggedIn, email: s.email, userId: s.userId,
        displayName: s.displayName, devModeActive: unlocked,
      };
      console.log('%c[Dev] identity', 'color:#00ffcc', info);
      if (!s.loggedIn) {
        console.log('[Dev] Not signed in. Sign in first, then run SC.whoami() again.');
      } else {
        console.log('[Dev] Add this to CONFIG.DEV.ADMINS in config.js:\n  ' +
                    JSON.stringify(s.email || s.userId));
      }
      return info;
    },
  };
})();

window.DevTools = DevTools;
