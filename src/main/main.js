'use strict';
const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, screen, dialog, clipboard, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const { buildGuide, viewAt, planSummary } = require('../engine/guide');
const { Tracker } = require('../engine/tracker');
const { LogWatcher } = require('../engine/logwatcher');
const { planTree, treeView } = require('../engine/passives');
const { RunTimer, splitDefs, parseTime } = require('../engine/timer');
const { importPob } = require('../engine/pob');
const { CLASSES, Gems, Quests, Areas } = require('../engine/data');
const { createKeySender } = require('./sendkeys');

const ROOT = path.join(__dirname, '..', '..');
const USER_DIR = path.join(ROOT, 'user');
const BUILD_DIR = path.join(ROOT, 'builds');
const SETTINGS_FILE = path.join(USER_DIR, 'settings.json');
const PROGRESS_FILE = path.join(USER_DIR, 'progress.json');
const TIMER_FILE = path.join(USER_DIR, 'timer.json');
fs.mkdirSync(USER_DIR, { recursive: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });

// The app folder can live in OneDrive and run on several PCs. Settings that differ per PC (the
// Client.txt path, the overlay window position/size, lock and visibility) are kept in
// user/devices/<PC name>.json; everything else (build, hotkeys, searches, timer goals) and the route
// progress and run timer are shared, so you can switch PCs mid-league and carry on.
const DEVICE = String(process.env.COMPUTERNAME || os.hostname() || 'this-pc').replace(/[^\w.-]+/g, '_');
const DEVICE_DIR = path.join(USER_DIR, 'devices');
const DEVICE_FILE = path.join(DEVICE_DIR, `${DEVICE}.json`);
const DEVICE_KEYS = ['clientLog', 'overlay', 'locked', 'visible'];
fs.mkdirSync(DEVICE_DIR, { recursive: true });

const LOG_CANDIDATES = [
  'F:\\Steam\\steamapps\\common\\Path of Exile\\logs\\Client.txt',
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile\\logs\\Client.txt',
  'C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile\\logs\\Client.txt',
  'C:\\Program Files\\Grinding Gear Games\\Path of Exile\\logs\\Client.txt',
  'D:\\Steam\\steamapps\\common\\Path of Exile\\logs\\Client.txt',
  'D:\\SteamLibrary\\steamapps\\common\\Path of Exile\\logs\\Client.txt',
];

/** Find this PC's Client.txt: known paths, every Steam library, the standalone client's registry entry. */
function detectClientLog() {
  const cands = [...LOG_CANDIDATES];
  const logIn = (dir) => path.join(dir, 'logs', 'Client.txt');
  for (const vdf of ['C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf', 'C:\\Program Files\\Steam\\steamapps\\libraryfolders.vdf']) {
    try {
      const text = fs.readFileSync(vdf, 'utf8');
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) cands.push(logIn(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', 'Path of Exile')));
    } catch { /* no Steam here */ }
  }
  for (const key of ['HKCU\\Software\\GrindingGearGames\\Path of Exile', 'HKLM\\SOFTWARE\\WOW6432Node\\GrindingGearGames\\Path of Exile']) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', 'InstallLocation'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = /InstallLocation\s+REG_SZ\s+(.+)/.exec(out);
      if (m) cands.push(logIn(m[1].trim()));
    } catch { /* not installed standalone */ }
  }
  for (const d of 'CDEFGHIJ') {
    for (const sub of ['Steam\\steamapps\\common', 'SteamLibrary\\steamapps\\common', 'Games\\Steam\\steamapps\\common', 'Program Files (x86)\\Steam\\steamapps\\common', 'Program Files (x86)\\Grinding Gear Games', 'Games']) {
      cands.push(logIn(`${d}:\\${sub}\\Path of Exile`));
    }
  }
  return cands.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

const DEFAULT_SETTINGS = {
  clientLog: LOG_CANDIDATES[0],
  buildFile: 'static-strike-slayer.json',
  hotkeys: {
    nextStep: 'F2',
    prevStep: 'F1',
    nextZone: 'Shift+F2',
    prevZone: 'Shift+F1',
    searchMenu: 'F3',
    pasteSearch: 'F4',
    cycleStage: 'F6',
    toggleDetails: 'F7',
    toggleLock: 'F8',
    toggleVisible: 'F10',
    openSettings: 'F11',
    timerPause: 'Shift+F8',
  },
  pasteMode: 'paste', // 'paste' = Ctrl+F, Ctrl+A, Ctrl+V into PoE; 'clipboard' = copy only
  // general vendor/stash search strings for the F3 menu (build-specific ones live in the build file)
  searches: [
    { label: 'Shop sweep: 4-link or movement speed', search: String.raw`"\w-\w-\w-\w|ent sp"` },
    { label: 'Movement speed', search: '"ent sp"' },
    { label: '3+ links', search: String.raw`"\w-\w-\w"` },
    { label: '4+ links', search: String.raw`"\w-\w-\w-\w"` },
    { label: 'Utility flasks', search: '"quicks|granite|jade|silver f"' },
  ],
  autoReset: true,
  // run timer: comparison is a key of goals, 'pb' or 'none'. Goal times are act-end times (h:mm or
  // h:mm:ss) from the practice cheat sheet; they don't include labyrinths.
  timer: {
    show: true,
    pauseInLab: true,
    comparison: 'goal7h',
    goals: {
      goal7h: { label: 'Goal 7h', splits: { brutus: '0:16', a1: '0:34', a2: '1:16', a3: '2:10', a4: '2:48', a5: '3:22', a6: '3:59', a7: '4:46', a8: '5:32', a9: '6:14', a10: '7:00' } },
      goal5h: { label: 'Goal 5h', splits: { brutus: '0:11:30', a1: '0:24', a2: '0:54', a3: '1:33', a4: '2:00', a5: '2:24', a6: '2:51', a7: '3:24', a8: '3:57', a9: '4:27', a10: '5:00' } },
      goal4h: { label: 'Goal 4h', splits: { brutus: '0:09', a1: '0:19', a2: '0:43', a3: '1:14', a4: '1:36', a5: '1:55', a6: '2:17', a7: '2:43', a8: '3:10', a9: '3:34', a10: '4:00' } },
      goal3h15: { label: 'Goal 3h15', splits: { brutus: '0:07:30', a1: '0:16', a2: '0:35', a3: '1:00', a4: '1:18', a5: '1:34', a6: '1:51', a7: '2:13', a8: '2:34', a9: '2:54', a10: '3:15' } },
    },
  },
  overlay: { x: null, y: null, width: 400, opacity: 0.92, scale: 1, showUpcoming: 2, showLinks: true, showTree: true, showGear: true, compact: false },
  locked: false,
  visible: true,
};

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeJson = (f, obj) => fs.writeFileSync(f, JSON.stringify(obj, null, 2));

function mergeDeep(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? mergeDeep(base[k], v) : v;
  }
  return out;
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

function loadSettings() {
  const shared = readJson(SETTINGS_FILE, {});
  let dev = readJson(DEVICE_FILE, null);
  if (!dev) {
    // first start on this PC: take over the shared file's values where they fit this PC
    dev = pick(shared, DEVICE_KEYS);
    if (!dev.clientLog || !fs.existsSync(dev.clientLog)) dev.clientLog = detectClientLog() || DEFAULT_SETTINGS.clientLog;
    writeJson(DEVICE_FILE, dev);
  } else if (!dev.clientLog || !fs.existsSync(dev.clientLog)) {
    const found = detectClientLog();
    if (found) { dev.clientLog = found; writeJson(DEVICE_FILE, dev); }
  }
  return mergeDeep(mergeDeep(DEFAULT_SETTINGS, omit(shared, DEVICE_KEYS)), dev);
}

let settings = loadSettings();
let progressAll = readJson(PROGRESS_FILE, {}); // per build file
let guide = null;
let build = null;
let tracker = null;
let treePlan = null; // passive tree plan of the build (engine/passives)
let watcher = null;
let logStatus = { ok: false };
let lastLevelEvent = null;
let overlayWin = null;
let settingsWin = null;
let tray = null;
let keySender = null;
let runTimer = null;
let flash = null; // transient message shown on the overlay

let snapshotMode = !!process.env.EXILEGUIDE_SNAPSHOT; // snapshots never write user files
const saveSettings = () => {
  if (snapshotMode) return;
  writeJson(SETTINGS_FILE, omit(settings, DEVICE_KEYS));
  writeJson(DEVICE_FILE, pick(settings, DEVICE_KEYS));
};

// Progress and timer files are shared through OneDrive. Each write is stamped with this PC's name and
// the time; when another PC writes a newer state (you switched PCs), this one adopts it.
const fileMtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
let progressMtime = 0;
let timerMtime = 0;
function saveProgress() {
  if (!tracker || snapshotMode) return;
  // how far this PC's Client.txt has been read, so passives allocated while the overlay was closed are caught up
  if (tracker.passives && watcher && watcher.ok) tracker.passives.pos[DEVICE] = watcher.pos;
  progressAll[settings.buildFile] = { ...tracker.save(), savedAt: Date.now(), device: DEVICE };
  writeJson(PROGRESS_FILE, progressAll);
  progressMtime = fileMtime(PROGRESS_FILE);
}
const saveTimer = () => {
  if (!runTimer || snapshotMode) return;
  writeJson(TIMER_FILE, { ...runTimer.save(), savedAt: Date.now(), device: DEVICE });
  timerMtime = fileMtime(TIMER_FILE);
};

function watchSharedFiles() {
  progressMtime = fileMtime(PROGRESS_FILE);
  timerMtime = fileMtime(TIMER_FILE);
  fs.watchFile(PROGRESS_FILE, { interval: 3000 }, (cur) => {
    if (!cur.mtimeMs || cur.mtimeMs === progressMtime) return;
    progressMtime = cur.mtimeMs;
    const disk = readJson(PROGRESS_FILE, null);
    if (!disk || !tracker) return;
    const mine = progressAll[settings.buildFile] || {};
    const theirs = disk[settings.buildFile];
    progressAll = { ...progressAll, ...disk };
    if (theirs && theirs.device && theirs.device !== DEVICE && (theirs.savedAt || 0) > (mine.savedAt || 0)) {
      progressAll[settings.buildFile] = theirs;
      tracker = new Tracker(guide, theirs, { autoReset: settings.autoReset });
      showFlash(`Progress synced from ${theirs.device}: step ${tracker.stepIndex + 1}, level ${tracker.level}`);
      pushSettings();
    }
  });
  fs.watchFile(TIMER_FILE, { interval: 3000 }, (cur) => {
    if (!cur.mtimeMs || cur.mtimeMs === timerMtime) return;
    timerMtime = cur.mtimeMs;
    const disk = readJson(TIMER_FILE, null);
    if (!disk || !guide || !disk.device || disk.device === DEVICE) return;
    runTimer = new RunTimer(guide.route, disk, { pauseInLab: settings.timer.pauseInLab });
    pushOverlay();
  });
}

function listBuilds() {
  return fs.readdirSync(BUILD_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const b = readJson(path.join(BUILD_DIR, f), {});
    return { file: f, name: b.name || f, class: b.class || '', ascendancy: b.ascendancy || '' };
  });
}

function loadBuild(file) {
  const p = path.join(BUILD_DIR, file);
  const b = readJson(p, null);
  if (!b) throw new Error(`Could not read build ${file}`);
  return b;
}

function activateBuild(file) {
  let b;
  try { b = loadBuild(file); } catch (e) {
    const builds = listBuilds();
    if (!builds.length) throw e;
    file = builds[0].file;
    b = loadBuild(file);
  }
  settings.buildFile = file;
  saveSettings();
  build = b;
  guide = buildGuide(b);
  try { treePlan = planTree(b); } catch (e) { treePlan = null; console.error('passive tree plan:', e); }
  const saved = progressAll[file] || {};
  tracker = new Tracker(guide, saved, { autoReset: settings.autoReset });
  if (lastLevelEvent && !saved.level) tracker.onLevel(lastLevelEvent);
  // the timer is shared by all builds; split points come from the route (bandit choice shifts steps)
  if (!runTimer) runTimer = new RunTimer(guide.route, readJson(TIMER_FILE, {}), { pauseInLab: settings.timer.pauseInLab });
  else runTimer.defs = splitDefs(guide.route);
  pushAll();
}

// ---------------- views ----------------
function overlayState() {
  if (!guide) return null;
  const view = viewAt(guide, tracker.stepIndex, { level: tracker.level, stageOverride: tracker.stageOverride });
  return {
    view,
    build: { name: build.name, class: build.class, ascendancy: build.ascendancy, bandit: build.bandit, pantheon: build.pantheon },
    char: { name: tracker.charName, level: tracker.level, area: tracker.currentArea ? (Areas[tracker.currentArea]?.name || tracker.currentArea) : null },
    settings: { overlay: settings.overlay, locked: settings.locked, hotkeys: settings.hotkeys, pasteMode: settings.pasteMode },
    logStatus,
    flash,
    timer: timerState(),
    missed: tracker.missed().map((m) => ({ area: Areas[m.areaId]?.name || m.areaId, steps: m.steps.map((st) => st.tokens) })),
    townNotes: tracker.townNotes.map((i) => guide.route.steps[i].tokens),
    detour: tracker.returnTo !== null,
    tree: treeState(view),
  };
}

function treeState(view) {
  if (!treePlan || !view.stage) return null;
  // labs the route has passed (used until you allocate ascendancy points)
  let labsPassed = 0;
  for (let i = 0; i < tracker.stepIndex; i++) if (guide.route.steps[i].tokens.some((t) => t.k === 'ascend')) labsPassed++;
  try {
    return treeView(treePlan, view.stage.index, tracker.passives, { level: tracker.level, labsPassed, max: 4 });
  } catch (e) { console.error('tree view:', e); return null; }
}

// ---------------- timer ----------------
function comparison() {
  const c = settings.timer.comparison;
  if (c === 'none') return null;
  if (c === 'pb') {
    const pb = runTimer.pb();
    return pb ? { label: 'PB', splits: pb.splits } : null;
  }
  const g = settings.timer.goals?.[c];
  if (!g) return null;
  const splits = {};
  for (const [k, v] of Object.entries(g.splits || {})) splits[k] = parseTime(v);
  return { label: g.label || c, splits };
}

function timerState() {
  if (!runTimer) return null;
  const r = runTimer.run;
  const cmp = comparison();
  let prev = 0;
  const splits = [];
  for (const d of runTimer.defs) {
    const t = r.splits[d.key];
    if (t === undefined) continue;
    const target = cmp?.splits[d.key] ?? null;
    splits.push({ key: d.key, name: d.name, t, seg: t - prev, target, delta: target !== null ? t - target : null });
    prev = t;
  }
  const cur = runTimer.current();
  return {
    show: settings.timer.show !== false,
    startedAt: r.startedAt, pausedAt: r.pausedAt, pauseReason: r.pauseReason, pausedMs: r.pausedMs, finishedAt: r.finishedAt,
    splits,
    current: cur && !runTimer.finished ? { key: cur.key, name: cur.name, target: cmp?.splits[cur.key] ?? null, since: prev } : null,
    comparison: cmp?.label || null,
  };
}

const fmtTime = (ms) => {
  const t = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
};
function splitFlash(sp) {
  const s = timerState().splits.find((x) => x.key === sp.key);
  const delta = s && s.delta !== null ? ` (${s.delta <= 0 ? '\u2212' : '+'}${fmtTime(s.delta)} vs ${comparison().label})` : '';
  return `${sp.final ? 'Run finished' : `Split ${sp.name}`}: ${fmtTime(sp.t)}${delta}`;
}
function afterTimer(res) {
  if (!res || (!res.split && !res.started)) return;
  saveTimer();
  if (res.split) showFlash(splitFlash(res.split));
  else showFlash('Timer started');
}

function pushOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('state', overlayState());
}
function pushSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('progress', { stepIndex: tracker?.stepIndex, level: tracker?.level });
}
function pushAll() { pushOverlay(); pushSettings(); }

let flashTimer = null;
function showFlash(text) {
  flash = text;
  pushOverlay();
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash = null; pushOverlay(); }, 2500);
}

// ---------------- actions ----------------
function currentSearch() {
  const v = viewAt(guide, tracker.stepIndex, { level: tracker.level });
  // the first search string in the current zone segment, starting from the current step
  const seg = v.segmentSteps.filter((s) => s.index >= tracker.stepIndex).concat(v.segmentSteps);
  for (const s of seg) {
    for (const g of s.gems) if (g.search && g.search.length) return g.search[0];
    for (const n of s.notes) if (n.search) return n.search;
    // {copy|...} strings in the step or its hints (post-campaign crafting/stash searches)
    const c = stepCopies(s)[0];
    if (c) return c.search;
    // in post-campaign chapters only the current step counts, not the rest of the chapter
    if (s.chapter && s.index >= tracker.stepIndex) break;
  }
  return null;
}

function stepCopies(s) {
  const out = [];
  const label = (tokens) => tokens.filter((t) => t.k !== 'copy').map((t) => t.v).join('').replace(/\s+/g, ' ').replace(/[:\s]+$/, '').trim();
  for (const line of [s.tokens, ...s.subs]) {
    for (const t of line) if (t.k === 'copy') out.push({ label: label(line) || label(s.tokens) || t.v, search: t.v });
  }
  return out;
}

const actions = {
  nextStep: () => { if (runTimer) afterTimer({ split: runTimer.onStepDone(tracker.stepIndex, Date.now()) }); tracker.next(); },
  prevStep: () => tracker.prev(),
  nextZone: () => { if (runTimer) afterTimer({ split: runTimer.onStepDone(tracker.stepIndex, Date.now()) }); tracker.nextSegment(); },
  prevZone: () => tracker.prevSegment(),
  cycleStage: () => tracker.cycleStage(1),
  cycleStageBack: () => tracker.cycleStage(-1),
  toggleLock: () => { settings.locked = !settings.locked; applyLock(); saveSettings(); showFlash(settings.locked ? 'Locked (click-through)' : 'Unlocked: drag to move'); },
  toggleVisible: () => {
    settings.visible = !settings.visible;
    if (settings.visible) overlayWin.showInactive(); else overlayWin.hide();
    saveSettings();
  },
  searchMenu: () => toggleMenu(),
  timerPause: () => {
    const what = runTimer.toggle(Date.now());
    saveTimer();
    showFlash({ started: 'Timer started', paused: 'Timer paused: it resumes on the next zone change', resumed: 'Timer running' }[what] || '');
  },
  // you skipped those on purpose: forget this act's open quest work and any detour
  dismissMissed: () => {
    const segs = guide.route.segments;
    const sec = guide.route.steps[tracker.stepIndex].sectionIndex;
    tracker.skipped = tracker.skipped.filter((k) => guide.route.steps[segs[k].firstStep].sectionIndex !== sec);
    tracker.townNotes = [];
  },
  timerReset: () => { runTimer.reset(); saveTimer(); showFlash('Timer reset: it starts in The Twilight Strand'); },
  toggleDetails: () => { settings.overlay.compact = !settings.overlay.compact; saveSettings(); },
  openSettings: () => openSettings(),
  pasteSearch: () => {
    const s = currentSearch();
    if (!s) { showFlash('No search string at this step: F3 opens the search menu'); return; }
    pasteText(s);
  },
};

function pasteText(text) {
  clipboard.writeText(String(text));
  if (settings.pasteMode === 'paste' && keySender) keySender.paste();
  showFlash(`Search: ${text}`);
}

// ---------------- F3 search menu ----------------
let menuWin = null;
let menuTimer = null;
let menuEntriesCache = [];
const MENU_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Escape'];

function menuEntries() {
  const out = [];
  const steps = guide.route.steps;
  const cur = steps[tracker.stepIndex];
  // gem buys and route notes with search strings in the current act: upcoming first, then done
  const act = steps.filter((s) => s.sectionIndex === cur.sectionIndex);
  const ordered = [...act.filter((s) => s.index >= cur.index || s.segment === cur.segment), ...act.filter((s) => s.index < cur.index && s.segment !== cur.segment)];
  for (const s of ordered) {
    const done = s.index < cur.index && s.segment !== cur.segment;
    const here = s.segment === cur.segment;
    for (const b of s.gems) {
      if (b.kind !== 'buy') continue;
      b.search.forEach((str, k) => out.push({
        group: `Gem buys · ${cur.section}`, label: `${b.npc}: ${b.gems.map((g) => g.name.replace(/ Support$/, '')).join(', ')}${b.search.length > 1 ? ` (${k + 1}/${b.search.length})` : ''}`,
        search: str, done, here,
      }));
    }
    for (const n of s.notes) if (n.search) out.push({ group: `Gem buys · ${cur.section}`, label: n.text, search: n.search, done, here });
    for (const c of stepCopies(s)) out.push({ group: cur.chapter ? `${cur.section} · ${cur.areaName}` : `Searches · ${cur.section}`, label: c.label, search: c.search, done, here });
  }
  const lvl = tracker.level;
  for (const m of guide.build.milestones || []) {
    if (m.search && (m.level ?? 1) <= lvl + 2 && (m.until ?? 999) >= lvl) out.push({ group: `Build · ${guide.build.name}`, label: m.text, search: m.search });
  }
  for (const x of guide.build.searches || []) if (x.search) out.push({ group: `Build · ${guide.build.name}`, label: x.label || x.search, search: x.search });
  for (const x of settings.searches || []) if (x.search) out.push({ group: 'General', label: x.label || x.search, search: x.search });
  // drop duplicates, keep first
  const seen = new Set();
  return out.filter((e) => (seen.has(e.search + e.group) ? false : seen.add(e.search + e.group)));
}

function closeMenu() {
  clearTimeout(menuTimer);
  for (const k of MENU_KEYS) { try { globalShortcut.unregister(k); } catch { /* ignore */ } }
  if (menuWin && !menuWin.isDestroyed()) menuWin.hide();
}

function pickMenu(i) {
  const e = menuEntriesCache[i];
  closeMenu();
  if (e) pasteText(e.search);
}

function toggleMenu() {
  if (menuWin && !menuWin.isDestroyed() && menuWin.isVisible()) { closeMenu(); return; }
  menuEntriesCache = menuEntries();
  if (!menuEntriesCache.length) { showFlash('No search strings yet: add some in Settings'); return; }
  if (!menuWin || menuWin.isDestroyed()) {
    menuWin = new BrowserWindow({
      width: 420, height: 300, transparent: true, frame: false, resizable: false, alwaysOnTop: true,
      skipTaskbar: true, focusable: false, hasShadow: false, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    menuWin.setAlwaysOnTop(true, 'screen-saver');
    menuWin.loadFile(path.join(__dirname, '..', 'renderer', 'menu.html'));
    menuWin.webContents.once('did-finish-load', () => showMenu());
  } else showMenu();
}

function showMenu() {
  const pt = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  menuWin.webContents.send('menu', { entries: menuEntriesCache, scale: settings.overlay.scale || 1 });
  const b = menuWin.getBounds();
  const x = Math.min(Math.max(wa.x, pt.x - 20), wa.x + wa.width - b.width);
  const y = Math.min(Math.max(wa.y, pt.y - 20), wa.y + wa.height - b.height);
  menuWin.setPosition(x, y);
  menuWin.showInactive();
  MENU_KEYS.forEach((k, i) => {
    try { globalShortcut.register(k, () => (k === 'Escape' ? closeMenu() : pickMenu(i))); } catch { /* ignore */ }
  });
  clearTimeout(menuTimer);
  menuTimer = setTimeout(closeMenu, 20000);
}

ipcMain.on('menu:pick', (_e, i) => pickMenu(i));
ipcMain.on('menu:close', () => closeMenu());
ipcMain.on('menu:resize', (_e, h) => {
  if (!menuWin || menuWin.isDestroyed()) return;
  const pt = menuWin.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: pt.x, y: pt.y }).workArea;
  const height = Math.min(Math.ceil(h), wa.height - 20);
  menuWin.setBounds({ x: pt.x, y: Math.min(pt.y, wa.y + wa.height - height), width: pt.width, height });
});

function runAction(name) {
  if (!tracker || !actions[name]) return;
  actions[name]();
  saveProgress();
  pushAll();
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [name, accel] of Object.entries(settings.hotkeys)) {
    if (!accel) continue;
    try {
      if (!globalShortcut.register(accel, () => runAction(name))) failed.push(`${name} (${accel})`);
    } catch { failed.push(`${name} (${accel})`); }
  }
  return failed;
}

// ---------------- log ----------------
function startWatcher() {
  if (watcher) watcher.stop();
  watcher = new LogWatcher(settings.clientLog);
  const recent = watcher.scanRecent();
  if (recent.level) {
    lastLevelEvent = recent.level;
    // this PC's log can be older than the shared progress (you levelled on another PC): never go back
    if (tracker && (!tracker.charName || (tracker.charName === recent.level.name && recent.level.level >= tracker.level))) tracker.onLevel(recent.level);
  }
  if (recent.area && tracker) tracker.currentArea = recent.area.id;
  catchUpPassives();
  watcher.on('status', (s) => { logStatus = s; pushOverlay(); });
  watcher.on('area', (e) => {
    if (!tracker) return;
    const prevStepIndex = tracker.stepIndex;
    const prevArea = tracker.currentArea;
    const moved = tracker.onArea(e.id);
    saveProgress(); // also keeps the skipped/visited lists current
    if (moved && tracker.returnTo !== null && tracker.stepIndex < prevStepIndex) showFlash('Back to a part you skipped. The route returns to where you were afterwards');
    if (runTimer) { afterTimer(runTimer.onArea(e.id, Date.now(), { prevStepIndex, prevArea, char: tracker.charName })); saveTimer(); }
    pushAll();
  });
  watcher.on('passive', (e) => {
    if (!tracker || !tracker.onPassive(e)) return;
    saveProgress();
    pushOverlay();
  });
  watcher.on('skillPoints', (e) => {
    if (!tracker) return;
    tracker.onSkillPoints(e);
    saveProgress();
    pushOverlay();
  });
  watcher.on('level', (e) => {
    lastLevelEvent = e;
    if (!tracker) return;
    const before = tracker.autoStage();
    tracker.onLevel(e);
    const after = tracker.autoStage();
    saveProgress();
    if (after !== before) showFlash(`New stage: ${guide.build.stages[after]?.title}`);
    else pushAll();
  });
  watcher.start();
}

// Passives allocated while the overlay was closed: read this PC's Client.txt from where it was last read.
// The first time (no position saved for this run on this PC), read from the start of the current run (its
// last Twilight Strand), if that run is this character's.
function catchUpPassives() {
  if (!tracker || !watcher || snapshotMode) return;
  const p = tracker.passives;
  const pos = p && Number.isInteger(p.pos?.[DEVICE]) ? p.pos[DEVICE] : null;
  let res;
  if (pos !== null) res = watcher.readEvents({ from: pos });
  else if (!p) {
    res = watcher.readEvents({ startMarker: 'area "1_1_1"' });
    const lv = res.events.find((e) => e.type === 'level');
    if (res.ok && tracker.charName && lv && lv.name !== tracker.charName) res = { ...res, events: [] };
  }
  if (res && !res.ok && pos !== null && res.size) { tracker.passives.pos[DEVICE] = res.size; return; } // log was cleared
  if (!res || !res.ok) return;
  let n = 0;
  for (const e of res.events) {
    if (e.type === 'passive' && tracker.onPassive(e)) n++;
    if (e.type === 'skillPoints') tracker.onSkillPoints(e);
  }
  if (!tracker.passives) tracker.passives = { taken: {}, asc: {}, quest: 0, pos: {} };
  tracker.passives.pos[DEVICE] = res.size;
  saveProgress();
  if (n) console.log(`passives: caught up ${n} allocations from Client.txt`);
}

// ---------------- windows ----------------
function applyLock() {
  if (!overlayWin) return;
  overlayWin.setIgnoreMouseEvents(settings.locked, { forward: true });
  overlayWin.setResizable(!settings.locked);
}

function createOverlay() {
  const wa = screen.getPrimaryDisplay().workArea;
  const o = settings.overlay;
  // a position saved on another PC (or with a monitor that's gone) may be off every screen here
  const onScreen = o.x !== null && o.y !== null && screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return o.x + 40 >= b.x && o.x + 40 <= b.x + b.width && o.y + 10 >= b.y && o.y + 10 <= b.y + b.height;
  });
  if (!onScreen) { o.x = null; o.y = null; }
  overlayWin = new BrowserWindow({
    x: o.x ?? wa.x + wa.width - o.width - 20,
    y: o.y ?? wa.y + 80,
    width: o.width,
    height: 300,
    minWidth: 260,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true);
  overlayWin.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  overlayWin.once('ready-to-show', () => {
    if (settings.visible) overlayWin.showInactive();
    applyLock();
    pushOverlay();
  });
  const savePos = () => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    const b = overlayWin.getBounds();
    settings.overlay.x = b.x; settings.overlay.y = b.y; settings.overlay.width = b.width;
    saveSettings();
  };
  overlayWin.on('moved', savePos);
  overlayWin.on('resized', savePos);
}

function openSettings(tab) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show(); settingsWin.focus();
    if (tab) settingsWin.webContents.send('tab', tab);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1180, height: 860, title: 'Exile Guide: Build & Settings',
    backgroundColor: '#14110f', autoHideMenuBar: true,
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'), tab ? { hash: tab } : undefined);
  settingsWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')));
  tray.setToolTip('Exile Guide');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Build & Settings…', click: () => openSettings() },
    { label: 'Gem plan…', click: () => openSettings('plan') },
    { label: 'Route…', click: () => openSettings('route') },
    { type: 'separator' },
    { label: settings.locked ? 'Unlock overlay (move/resize)' : 'Lock overlay (click-through)', click: () => { runAction('toggleLock'); tray.setContextMenu(menu()); } },
    { label: settings.visible ? 'Hide overlay' : 'Show overlay', click: () => { runAction('toggleVisible'); tray.setContextMenu(menu()); } },
    { label: 'Reset overlay position', click: () => { settings.overlay.x = null; settings.overlay.y = null; const wa = screen.getPrimaryDisplay().workArea; overlayWin.setPosition(wa.x + wa.width - settings.overlay.width - 20, wa.y + 80); saveSettings(); } },
    { type: 'separator' },
    { label: 'Restart route (new character)', click: () => { tracker.reset(); saveProgress(); pushAll(); } },
    { label: 'Pause / resume timer', click: () => runAction('timerPause') },
    { label: 'Reset timer', click: () => runAction('timerReset') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', () => openSettings());
}

// ---------------- IPC ----------------
function compactRoute() {
  return guide.route.steps.map((s) => ({
    index: s.index, section: s.section, segment: s.segment, area: s.areaName, town: s.isTown,
    tokens: s.tokens, gems: s.gems, notes: s.notes, level: s.progressLevel,
  }));
}

ipcMain.on('overlay:resize', (_e, h) => {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const b = overlayWin.getBounds();
  const height = Math.max(60, Math.min(Math.ceil(h), 1400));
  if (Math.abs(b.height - height) > 1) overlayWin.setBounds({ x: b.x, y: b.y, width: b.width, height });
});
ipcMain.on('overlay:action', (_e, name) => runAction(name));
ipcMain.on('overlay:copy', (_e, text) => pasteText(text));
ipcMain.on('overlay:ready', () => pushOverlay());

ipcMain.handle('settings:get', () => ({
  settings,
  builds: listBuilds(),
  buildFile: settings.buildFile,
  build,
  warnings: guide.warnings,
  plan: guide.plan,
  planSummary: planSummary(guide),
  route: compactRoute(),
  sections: guide.route.sections,
  stepIndex: tracker.stepIndex,
  level: tracker.level,
  classes: CLASSES,
  logStatus,
  device: DEVICE,
  hotkeyFailures: hotkeyFailures,
  defaults: DEFAULT_SETTINGS,
  timer: { state: timerState(), history: runTimer.history.slice(0, 20), defs: runTimer.defs.map((d) => ({ key: d.key, name: d.name })) },
}));
ipcMain.handle('settings:timerReset', () => { runAction('timerReset'); return { ok: true }; });
ipcMain.handle('settings:gemNames', () => Object.values(Gems).filter((g) => !/^(Vaal|Awakened) /.test(g.name) && !/Royale/.test(g.name)).map((g) => g.name).sort());
ipcMain.handle('settings:quests', () => Object.values(Quests).filter((q) => +q.act >= 1 && +q.act <= 10).map((q) => ({ id: q.id, name: q.name, act: q.act })));
ipcMain.handle('settings:areas', () => Object.values(Areas).filter((a) => a.act >= 1 && a.act <= 10).map((a) => ({ id: a.id, name: a.name, act: a.act, town: a.is_town_area })));

let hotkeyFailures = [];
ipcMain.handle('settings:save', (_e, patch) => {
  settings = mergeDeep(settings, patch);
  saveSettings();
  hotkeyFailures = registerHotkeys();
  if (patch.clientLog) startWatcher();
  if (patch.autoReset !== undefined && tracker) tracker.opts.autoReset = settings.autoReset;
  if (runTimer) runTimer.opts.pauseInLab = settings.timer.pauseInLab;
  pushAll();
  return { ok: true, hotkeyFailures };
});
ipcMain.handle('settings:selectBuild', (_e, file) => { saveProgress(); activateBuild(file); return { ok: true }; });
ipcMain.handle('settings:previewBuild', (_e, json) => {
  try {
    const g = buildGuide(json);
    return { ok: true, warnings: g.warnings, plan: g.plan, planSummary: planSummary(g) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('settings:saveBuild', (_e, { file, json }) => {
  try {
    buildGuide(json); // validate
    const name = (file || json.name || 'build').replace(/\.json$/i, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.json';
    writeJson(path.join(BUILD_DIR, name), json);
    saveProgress();
    activateBuild(name);
    return { ok: true, file: name };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('settings:deleteBuild', (_e, file) => {
  const p = path.join(BUILD_DIR, path.basename(file));
  if (fs.existsSync(p)) fs.unlinkSync(p);
  if (settings.buildFile === file) activateBuild(listBuilds()[0]?.file);
  return { ok: true };
});
ipcMain.handle('settings:importPob', async (_e, input) => {
  try { return { ok: true, build: await importPob(input) }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('settings:jump', (_e, i) => { tracker.jump(i); saveProgress(); pushAll(); return { ok: true }; });
ipcMain.handle('settings:setLevel', (_e, lvl) => { tracker.onLevel({ name: tracker.charName, level: +lvl }); saveProgress(); pushAll(); return { ok: true }; });
ipcMain.handle('settings:reset', () => { tracker.reset(); saveProgress(); pushAll(); return { ok: true }; });
ipcMain.handle('settings:browseLog', async () => {
  const r = await dialog.showOpenDialog(settingsWin, { title: 'Find Path of Exile Client.txt', filters: [{ name: 'Client.txt', extensions: ['txt'] }], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('settings:openBuildsFolder', () => shell.openPath(BUILD_DIR));

// ---------------- snapshot mode (development) ----------------
// EXILEGUIDE_SNAPSHOT=<dir> [EXILEGUIDE_STEP=n] [EXILEGUIDE_LEVEL=n]: render both windows to PNGs, log
// renderer console output, then quit. Progress and settings files are not modified.
async function runSnapshot(dir) {
  snapshotMode = true;
  fs.mkdirSync(dir, { recursive: true });
  const log = [];
  const hook = (win, name) => win.webContents.on('console-message', (e) => log.push(`[${name}] ${e.level ?? ''} ${e.message}`));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (win, file) => fs.writeFileSync(path.join(dir, file), (await win.webContents.capturePage()).toPNG());
  try {
    hook(overlayWin, 'overlay');
    if (process.env.EXILEGUIDE_STEP) tracker.jump(+process.env.EXILEGUIDE_STEP - 1);
    // zone ids to replay from there, comma separated (as if read from Client.txt)
    if (process.env.EXILEGUIDE_AREAS) for (const id of process.env.EXILEGUIDE_AREAS.split(',')) tracker.onArea(id.trim());
    if (process.env.EXILEGUIDE_LEVEL) tracker.onLevel({ name: tracker.charName, level: +process.env.EXILEGUIDE_LEVEL });
    if (process.env.EXILEGUIDE_UNLOCKED) settings.locked = false;
    // passives as if read from Client.txt: "Name,Name*2,asc:Name,quest:4"
    if (process.env.EXILEGUIDE_PASSIVES) {
      tracker.passives = { taken: {}, asc: {}, quest: 0, pos: {} };
      for (const part of process.env.EXILEGUIDE_PASSIVES.split(',')) {
        const [name, times] = part.trim().split('*');
        if (name.startsWith('quest:')) { tracker.passives.quest = +name.slice(6); continue; }
        const asc = name.startsWith('asc:');
        for (let i = 0; i < (+times || 1); i++) (asc ? tracker.passives.asc : tracker.passives.taken)[asc ? name.slice(4) : name] = ((asc ? tracker.passives.asc : tracker.passives.taken)[asc ? name.slice(4) : name] || 0) + 1;
      }
    }
    if (process.env.EXILEGUIDE_TIMER) {
      // fake a run that started N minutes ago, with two splits done
      const now = Date.now();
      runTimer.run = { startedAt: now - +process.env.EXILEGUIDE_TIMER * 60000, pausedAt: null, pauseReason: null, pausedMs: 0, finishedAt: null, splits: { brutus: 14 * 60000 + 5000, a1: 35 * 60000 + 41000 }, char: 'Test' };
    }
    pushAll();
    await wait(1500);
    log.push(`overlay bounds ${JSON.stringify(overlayWin.getBounds())}`);
    log.push(`hotkeys ${JSON.stringify(settings.hotkeys)} failed: ${JSON.stringify(hotkeyFailures)}`);
    if (process.env.EXILEGUIDE_MENU) {
      toggleMenu();
      await wait(1500);
      log.push(`menu entries ${menuEntriesCache.length}, bounds ${JSON.stringify(menuWin.getBounds())}`);
      hook(menuWin, 'menu');
      await shot(menuWin, 'menu.png');
      closeMenu();
    }
    await shot(overlayWin, 'overlay.png');
    openSettings();
    const sw = settingsWin;
    hook(sw, 'settings');
    sw.on('closed', () => log.push('settings window closed'));
    sw.webContents.on('render-process-gone', (_e, d) => log.push(`settings renderer gone ${JSON.stringify(d)}`));
    await wait(2000);
    for (const tab of ['build', 'plan', 'route', 'settings', 'json']) {
      await sw.webContents.executeJavaScript(`showTab(${JSON.stringify(tab)})`);
      await wait(500);
      await shot(sw, `settings-${tab}.png`);
    }
  } catch (e) { log.push(`ERROR ${e.stack}`); }
  fs.writeFileSync(path.join(dir, 'console.log'), log.join('\n'));
  app.exit(0);
}

// ---------------- game process ----------------
// The run timer pauses when the game closes (you stop for the day, or move to another PC) and resumes on
// the next zone change. Checked every 10 s with tasklist (PathOfExile.exe, PathOfExileSteam.exe, _x64, ...).
const GAME_EXE = /^"PathOfExile[^"]*\.exe"/im;
const OTHER_PC_IDLE_MS = 10 * 60 * 1000;
let gameSeenAt = 0; // last check that found the game running on this PC
let firstGameCheck = true;
function checkGame() {
  execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
    if (err || !runTimer) return;
    const now = Date.now();
    if (GAME_EXE.test(out)) { gameSeenAt = now; firstGameCheck = false; return; }
    let at = null;
    if (gameSeenAt) {
      at = gameSeenAt; // closed while the overlay was watching
    } else if (firstGameCheck) {
      // the overlay started with the game closed. A run last saved by this PC pauses as of the last
      // Client.txt write. A run from another PC pauses only if it has been idle a while: that PC may be
      // playing it right now.
      const disk = readJson(TIMER_FILE, {});
      const mine = !disk.device || disk.device === DEVICE;
      const last = runTimer.run.lastActive ?? runTimer.run.startedAt ?? now;
      if (mine) at = fileMtime(settings.clientLog) || last;
      else if (now - last >= OTHER_PC_IDLE_MS) at = last;
    }
    firstGameCheck = false;
    gameSeenAt = 0;
    if (at !== null && runTimer.gameClosed(at, now)) {
      saveTimer();
      showFlash('Game closed: timer paused. It resumes on your next zone');
    }
  });
}

// ---------------- app ----------------
// snapshot runs use their own profile and skip the single-instance lock, so they work while the overlay runs
if (process.env.EXILEGUIDE_SNAPSHOT) app.setPath('userData', path.join(app.getPath('temp'), 'exile-guide-snapshot'));
if (!process.env.EXILEGUIDE_SNAPSHOT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());
  app.whenReady().then(() => {
    app.setAppUserModelId('ExileGuide');
    try { activateBuild(settings.buildFile); } catch (e) {
      dialog.showErrorBox('Exile Guide', `No usable build in ${BUILD_DIR}.\n${e.message}`);
    }
    keySender = createKeySender();
    createOverlay();
    createTray();
    hotkeyFailures = registerHotkeys();
    startWatcher();
    if (!process.env.EXILEGUIDE_SNAPSHOT) {
      watchSharedFiles();
      checkGame();
      setInterval(checkGame, 10000);
    }
    if (hotkeyFailures.length) showFlash(`Hotkeys in use elsewhere: ${hotkeyFailures.join(', ')}`);
    if (process.env.EXILEGUIDE_SNAPSHOT) runSnapshot(process.env.EXILEGUIDE_SNAPSHOT);
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    // progress and timer are saved on every change; saving again here could overwrite a newer state
    // that another PC wrote while this one sat idle
    fs.unwatchFile(PROGRESS_FILE);
    fs.unwatchFile(TIMER_FILE);
    if (keySender) keySender.dispose();
  });
  app.on('window-all-closed', (e) => e.preventDefault?.());
}
