// Persistent, browser-local virtual-machine state for the simulated Linux
// environment. One versioned record lives in localStorage and is read/written
// defensively: malformed data, disabled storage, or quota errors must never
// throw, and must never accidentally undo a "destroyed" machine.
//
// The record holds only simulated state. It is confined to this site's origin
// and never touches the real filesystem.

const KEY = 'qu3b411.vm';
const VERSION = 1;
const MAX_HISTORY = 500;

export function freshState() {
  return {
    version: VERSION,
    status: 'operational', // 'operational' | 'destroyed'
    cwd: [], // last working directory (segments under root)
    history: [], // shell command history (most-recent-last)
    fs: {}, // writable overlay: root's child map { name: node }
    scores: {}, // high scores by game file, e.g. { 'snake.js': 680 }
    prefs: {}, // reserved for terminal/editor preferences
    rootKey: null, // base64 key material; only grants root if it decrypts the vault
    solved: false, // has ever authenticated as root (CTF completed at least once)
    sudoLectured: false, // whether the first-run sudo lecture has been shown
  };
}

export function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    return freshState(); // storage blocked (private mode, policy) — ephemeral
  }
  if (!raw) return freshState();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    // Corrupt record. Start fresh, but never resurrect a machine that may have
    // been destroyed — if we can still see that flag, keep it destroyed.
    return /"status"\s*:\s*"destroyed"/.test(raw) ? Object.assign(freshState(), { status: 'destroyed' }) : freshState();
  }
  if (!data || typeof data !== 'object') return freshState();
  if (data.version !== VERSION) {
    // Unknown/old version: fresh, but preserve a destroyed flag if present.
    return data.status === 'destroyed' ? Object.assign(freshState(), { status: 'destroyed' }) : freshState();
  }
  const s = freshState();
  s.status = data.status === 'destroyed' ? 'destroyed' : 'operational';
  s.cwd = Array.isArray(data.cwd) ? data.cwd.filter((x) => typeof x === 'string') : [];
  s.history = Array.isArray(data.history) ? data.history.filter((x) => typeof x === 'string').slice(-MAX_HISTORY) : [];
  s.fs = data.fs && typeof data.fs === 'object' && !Array.isArray(data.fs) ? data.fs : {};
  s.scores = data.scores && typeof data.scores === 'object' && !Array.isArray(data.scores) ? data.scores : {};
  s.prefs = data.prefs && typeof data.prefs === 'object' && !Array.isArray(data.prefs) ? data.prefs : {};
  // A persisted key is only ever a *claim*; terminal.js validates it against the
  // vault before granting root. `rooted` is intentionally never read from storage.
  s.rootKey = typeof data.rootKey === 'string' ? data.rootKey : null;
  s.solved = data.solved === true;
  s.sudoLectured = data.sudoLectured === true;
  return s;
}

// Persist immediately (used for destruction and other must-not-lose writes).
export function saveState(state) {
  try {
    if (state && Array.isArray(state.history) && state.history.length > MAX_HISTORY) {
      state.history = state.history.slice(-MAX_HISTORY);
    }
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false; // quota/denied: ignore; never throw, never auto-recover
  }
}

// Coalesce frequent writes (history, cwd, routine fs edits).
let _timer = null;
export function saveStateSoon(state) {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _timer = null;
    saveState(state);
  }, 200);
}
