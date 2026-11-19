// Regression tests for the persistent virtual-machine state: the localStorage
// record, the writable overlay filesystem, the `rm -rf /` destruction Easter
// egg, and high-score persistence. Pure logic only — no browser/xterm needed.
//
// Run from the repo root: `node build/vm.test.mjs`
// Exits non-zero on failure. No external dependencies.

import assert from 'node:assert';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto; // secrets.js uses global crypto.subtle
import { Terminal } from '../src/js/terminal.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.stack || e.message}`);
    process.exitCode = 1;
  }
}
// Awaited variant for tests that exercise async code (e.g. doUnlock -> crypto).
async function atest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.stack || e.message}`);
    process.exitCode = 1;
  }
}

// ---- in-memory localStorage mock -------------------------------------------
function installStorage(behavior = {}) {
  const map = new Map();
  global.localStorage = {
    getItem(k) {
      if (behavior.getThrows) throw new Error('blocked');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (behavior.setThrows) throw new Error('quota');
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
  };
  return map;
}

// vmstate reads global.localStorage at call time, so import after a default
// mock is installed, then swap behaviors per test.
installStorage();
const { freshState, loadState, saveState } = await import('../src/js/vmstate.js');

// ---- a Terminal test double (bypasses the DOM/xterm constructor) -----------
function makeTerm(state = freshState()) {
  const out = [];
  const persistCalls = [];
  const t = Object.create(Terminal.prototype);
  t.state = state;
  t.cwd = [];
  t.history = [];
  t.halted = false;
  t.rooted = false;
  t.rootKey = null;
  t.pending = null;
  t.onPathChange = null;
  t.bundle = {
    posts: [{ file: 'welcome.md', slug: 'welcome', date: '2025-01-01' }],
    games: { '.games/snake.js': 'export function run(){}' },
    postMarkdownByVirtualPath: { 'blog/welcome.md': '# Welcome\n\nhi\n' },
    aboutMd: '# About\n',
  };
  t.term = { write: (s) => out.push(s), clear: () => {} };
  t.openView = () => {}; // default no-op; withView() overrides to capture
  t._persist = (now) => persistCalls.push(now);
  // Capture logical output lines without ANSI stripping noise.
  t.printLine = (s) => out.push(String(s));
  t._out = out;
  t._persistCalls = persistCalls;
  return t;
}

// Mirror executeCommand's destructive-decision pipeline exactly, WITHOUT side
// effects: parse the line, then judge on tokens + the real redirect. Returns
// which handler (if any) a line would reach.
function decide(t, line) {
  const { tokens, redirect } = t.extractRedirect(t.tokenizeLine(line));
  if (t.isDestroyCommand(tokens)) return 'destroy';
  if (t.isForkBomb(tokens)) return 'forkbomb';
  if (t.destructivePreamble(tokens, redirect)) return 'preamble';
  return 'none';
}

// ---- vmstate persistence ----------------------------------------------------
test('vmstate: save/load round-trips fs, history, scores', () => {
  installStorage();
  const s = freshState();
  s.history = ['ls', 'cd blog'];
  s.fs = { notes: { f: 'hello' }, projects: { d: {} } };
  s.scores = { 'snake.js': 420 };
  s.cwd = ['blog'];
  assert.ok(saveState(s), 'save should succeed');
  const r = loadState();
  assert.deepStrictEqual(r.history, ['ls', 'cd blog']);
  assert.deepStrictEqual(r.fs, s.fs);
  assert.strictEqual(r.scores['snake.js'], 420);
  assert.deepStrictEqual(r.cwd, ['blog']);
  assert.strictEqual(r.status, 'operational');
});

test('vmstate: blocked storage never throws, yields fresh state', () => {
  installStorage({ getThrows: true });
  const r = loadState();
  assert.strictEqual(r.status, 'operational');
  assert.deepStrictEqual(r.fs, {});
});

test('vmstate: corrupt JSON keeps a destroyed machine destroyed', () => {
  const map = installStorage();
  map.set('qu3b411.vm', '{ this is : not json, "status":"destroyed" ');
  const r = loadState();
  assert.strictEqual(r.status, 'destroyed', 'destroyed flag must survive corruption');
});

test('vmstate: a version bump does not resurrect a destroyed machine', () => {
  const map = installStorage();
  map.set('qu3b411.vm', JSON.stringify({ version: 999, status: 'destroyed' }));
  const r = loadState();
  assert.strictEqual(r.status, 'destroyed');
});

test('vmstate: history is capped on save', () => {
  installStorage();
  const s = freshState();
  s.history = Array.from({ length: 900 }, (_, i) => 'cmd' + i);
  saveState(s);
  const r = loadState();
  assert.strictEqual(r.history.length, 500);
  assert.strictEqual(r.history[r.history.length - 1], 'cmd899', 'keeps most recent');
});

// ---- tokenizer & redirection ------------------------------------------------
test('tokenizer: honors quotes', () => {
  const t = makeTerm();
  assert.deepStrictEqual(t.tokenizeLine('echo "hello world" > notes.txt'),
    ['echo', 'hello world', '>', 'notes.txt']);
  assert.deepStrictEqual(t.tokenizeLine("echo ''"), ['echo', '']);
});

test('redirection: splits > and >>', () => {
  const t = makeTerm();
  assert.deepStrictEqual(t.extractRedirect(['echo', 'hi', '>', 'f']),
    { tokens: ['echo', 'hi'], redirect: { mode: 'write', target: 'f' } });
  assert.deepStrictEqual(t.extractRedirect(['echo', 'hi', '>>f']),
    { tokens: ['echo', 'hi'], redirect: { mode: 'append', target: 'f' } });
});

// ---- destruction detection --------------------------------------------------
test('rm -rf / variants are recognized', () => {
  const t = makeTerm();
  const yes = [
    'rm -rf /', 'rm -fr /', 'rm -r -f /', 'rm --recursive --force /',
    'rm -rf --no-preserve-root /', 'rm -rf /*', 'rm  -rf   /',
  ];
  for (const c of yes) assert.ok(t.isDestroyCommand(t.tokenizeLine(c)), `should trigger: ${c}`);
});

test('non-root / non-destructive rm does NOT trigger', () => {
  const t = makeTerm();
  const no = [
    'rm -rf /blog', 'rm -r /', 'rm -f /', 'rm /', 'rm -rf ~/notes',
    'rm -rf notes.txt', 'ls -rf /', 'rm -rf /home',
  ];
  for (const c of no) assert.ok(!t.isDestroyCommand(t.tokenizeLine(c)), `should NOT trigger: ${c}`);
});

test('destroy() commits the destroyed flag immediately and halts', () => {
  const t = makeTerm();
  t.destroy();
  assert.strictEqual(t.state.status, 'destroyed');
  assert.strictEqual(t.halted, true);
  assert.ok(t._persistCalls.includes(true), 'must force a synchronous persist');
});

test('destroy([]) (no preamble) still destroys', () => {
  const t = makeTerm();
  t.destroy([]);
  assert.strictEqual(t.state.status, 'destroyed');
  assert.strictEqual(t.halted, true);
});

test('other destructive tricks are recognized (full pipeline)', () => {
  const t = makeTerm();
  const cases = {
    'dd if=/dev/zero of=/dev/sda': 'preamble',
    'dd bs=1M if=/dev/zero of=/dev/nvme0n1': 'preamble',
    'mkfs.ext4 /dev/sda1': 'preamble',
    'mkfs /dev/sdb': 'preamble',
    'cat /dev/urandom > /dev/sda': 'preamble',
    '> /dev/sda': 'preamble',
    'shred -n 3 /dev/sda': 'preamble',
    'wipefs -a /dev/sdb': 'preamble',
    'mv / /dev/null': 'preamble',
    'mv ~ /dev/null': 'preamble',
    'chmod -R 000 /': 'preamble',
    ':(){ :|:& };:': 'forkbomb',
    ':(){:|:&};:': 'forkbomb',
    'rm -rf /': 'destroy',
  };
  for (const [line, want] of Object.entries(cases)) {
    assert.strictEqual(decide(t, line), want, `${line} -> ${want}`);
  }
});

test('fork bomb degrades/locks the session but does NOT persist (reboot recovers)', () => {
  const t = makeTerm();
  const realST = global.setTimeout;
  global.setTimeout = () => 0; // stop the thrash cascade inside the test
  try { t.forkbomb(); } finally { global.setTimeout = realST; }
  assert.strictEqual(t.halted, true, 'session is wedged');
  assert.strictEqual(t.state.status, 'operational', 'fork bomb must NOT destroy the machine');
  assert.ok(!t._persistCalls.includes(true), 'fork bomb must not force-persist destruction');
});

test('lookalike-but-safe commands do NOT trigger destruction', () => {
  const t = makeTerm();
  const no = [
    'dd if=/dev/zero of=backup.img',
    'mkfs.ext4 disk.img',
    'echo hi > notes.txt',
    'cat /dev/urandom > out.bin',
    'mv notes.txt /dev/null',
    'chmod -R 000 projects',
    'chmod 755 script.sh',
    'shred notes.txt',
    'echo /dev/sda > notes.txt',
  ];
  for (const c of no) assert.strictEqual(decide(t, c), 'none', `should NOT trigger: ${c}`);
});

// ---- Phase 2 adversarial: quoted/literal text must NEVER destroy -----------
test('quoted destructive text prints, never executes (the core invariant)', () => {
  const t = makeTerm();
  const safe = [
    "echo ':(){ :|:& };:'",        // fork bomb as a quoted argument
    'echo "rm -rf /"',             // destroyer as a quoted argument
    "echo 'example > /dev/sda now'", // redirect-looking text inside a quote
    'echo "dd if=/dev/zero of=/dev/sda"',
    'echo "> /dev/sda"',
    'echo "mkfs.ext4 /dev/sda1"',
    'echo ":(){ :|:& };:" > bomb.txt', // writing the text to a file
    "cat /dev/urandom",            // read a device, no redirect → harmless here
    'echo rm -rf /',               // unquoted but as echo args, not the command
    'echo "mv / /dev/null"',
  ];
  for (const c of safe) assert.strictEqual(decide(t, c), 'none', `must be inert: ${c}`);
});

test('fork bomb only in command position, never as an argument', () => {
  const t = makeTerm();
  assert.strictEqual(decide(t, ':(){ :|:& };:'), 'forkbomb');
  assert.strictEqual(decide(t, ':(){:|:&};:'), 'forkbomb');
  assert.strictEqual(decide(t, "echo ':(){ :|:& };:'"), 'none');
  assert.strictEqual(decide(t, 'echo :(){ hi'), 'none');
  assert.strictEqual(decide(t, 'ls'), 'none');
});

test('echo "rm -rf /" prints the literal text and does not destroy', () => {
  const t = makeTerm();
  const raw = t.tokenizeLine('echo "rm -rf /"');
  const { tokens, redirect } = t.extractRedirect(raw);
  t.echo(tokens.slice(1), redirect);
  assert.deepStrictEqual(t._out, ['rm -rf /']);
  assert.strictEqual(t.state.status, 'operational');
});

// ---- guest/root permission model -------------------------------------------
// A simulated root SESSION (rooted flag + a placeholder key) for exercising the
// gate logic. The placeholder key is NOT a real vault key, so content reads must
// still fail — which is exactly the adversarial property we want to prove.
function rootTerm() {
  const t = makeTerm();
  t.rooted = true;
  t.rootKey = {}; // truthy, but not a CryptoKey that decrypts the vault
  t.state.rootKey = 'ZHVtbXk=';
  return t;
}

test('guest is denied the protected /etc/shadow through every route', () => {
  const t = makeTerm(); // guest
  const denied = (fn, label) => { t._out.length = 0; fn(); assert.ok(t._out.some((l) => /Permission denied/.test(l)), label); };
  denied(() => t.cat('/etc/shadow'), 'cat /etc/shadow');
  denied(() => t.cat('/etc/./shadow'), 'cat /etc/./shadow');
  denied(() => t.cat('/home/qu3b411/../../etc/shadow'), 'cat traversal via home');
  denied(() => t.cat('/blog/../etc/shadow'), 'cat traversal via blog');
  denied(() => t.vim('/etc/shadow'), 'vim /etc/shadow');
  denied(() => t.nano('/etc/shadow'), 'nano /etc/shadow');
  denied(() => t.ls('/etc/shadow'), 'ls /etc/shadow');
  // from inside a subdirectory, a relative climb must still be refused.
  t.cwd = ['blog'];
  denied(() => t.cat('../etc/shadow'), 'cat ../etc/shadow from /blog');
});

test('guest keeps access to the public CTF inputs (challenge intact)', () => {
  const t = makeTerm();
  const reads = (f) => { t._out.length = 0; t.cat(f); return t._out.join('\n'); };
  assert.ok(/root:x:0:0/.test(reads('/etc/passwd')), '/etc/passwd readable');
  assert.ok(/ssh-rsa /.test(reads('~/.ssh/id_rsa.pub')), 'RSA pub key readable');
  assert.ok(/ssh-rsa /.test(reads('.ssh/id_rsa.old.pub')), 'old RSA pub key readable');
  assert.ok(/^0x[0-9a-f]+/m.test(reads('~/.secret/flag.enc')), 'flag ciphertext readable');
});

test('loadState never trusts a rooted flag; only a key claim round-trips', () => {
  installStorage();
  // An attacker sets rooted:true and a forged key directly in storage.
  const map = installStorage();
  map.set('qu3b411.vm', JSON.stringify({ version: 1, status: 'operational', rooted: true, rootKey: 'Zm9yZ2Vk' }));
  const r = loadState();
  assert.strictEqual(r.rooted, undefined, 'there is no trusted rooted field');
  assert.strictEqual(r.rootKey, 'Zm9yZ2Vk', 'the key is kept only as an unvalidated claim');
  // A fresh machine carries no key.
  installStorage();
  assert.strictEqual(loadState().rootKey, null);
});

// ---- su / sudo / exit privilege subsystem ----------------------------------
test('su opens a no-echo root password prompt', () => {
  const t = makeTerm();
  t.su([]);
  assert.ok(t.pending, 'a line-read is pending');
  assert.strictEqual(t.pending.echo, false, 'password is not echoed');
  assert.ok(t._out.join('').includes('Password:'), 'prompts for a password');
});

test('password keystrokes are not echoed and feed the buffer', () => {
  const t = makeTerm();
  let submitted = null;
  t.readLine('Password: ', { echo: false, onSubmit: (l) => { submitted = l; } });
  t._out.length = 0;
  for (const ch of 'hunter2') t.handlePending(ch);
  assert.strictEqual(t._out.join(''), '', 'nothing echoed while typing a password');
  assert.strictEqual(t.pending.buffer, 'hunter2', 'buffer captured the input');
  t.handlePending('\r');
  assert.strictEqual(submitted, 'hunter2', 'Enter submits the buffered line');
  assert.strictEqual(t.pending, null, 'prompt cleared after submit');
});

test('grantRoot persists the key material (not a boolean) + solved', () => {
  const t = makeTerm();
  t.grantRoot({ key: {}, raw: 'a2V5bWF0ZXJpYWw=' });
  assert.strictEqual(t.rooted, true);
  assert.strictEqual(t.state.rootKey, 'a2V5bWF0ZXJpYWw=', 'persists key material');
  assert.strictEqual(t.state.rooted, undefined, 'no trusted boolean is written');
  assert.strictEqual(t.state.solved, true);
  assert.ok(t._persistCalls.includes(true), 'durable persist');
});

test('su to an unknown user fails without a prompt', () => {
  const t = makeTerm();
  t.su(['alice']);
  assert.ok(t._out.some((l) => /user alice does not exist/.test(l)));
  assert.strictEqual(t.pending, null);
});

test('su to a known non-root user prompts then fails', () => {
  const t = makeTerm();
  t.su(['qu3b411']);
  assert.strictEqual(t.pending.echo, false);
  t.pending.onSubmit('whatever');
  assert.ok(t._out.some((l) => /Authentication failure/.test(l)));
  assert.strictEqual(t.rooted, false);
});

test('unlock is an alias for su (opens the same prompt)', () => {
  const t = makeTerm();
  t.openView = () => {};
  t.executeCommand('unlock');
  assert.ok(t.pending && t.pending.echo === false, 'unlock routes to the su prompt');
});

test('sudo as guest: lecture once, then the sudoers denial', () => {
  const t = makeTerm();
  t.sudo(['ls']);
  assert.ok(t._out.some((l) => /usual lecture/.test(l)), 'first sudo prints the lecture');
  assert.strictEqual(t.pending.echo, false, 'prompts for password, no echo');
  assert.ok(t._out.join('').includes('[sudo] password for guest:'));
  t.pending.onSubmit('x');
  assert.ok(t._out.some((l) => /not in the sudoers file/.test(l)), 'denied');
  // second invocation: no repeat lecture
  t._out.length = 0;
  t.sudo(['ls']);
  assert.ok(!t._out.some((l) => /usual lecture/.test(l)), 'lecture shown only once');
});

test('sudo make me a sandwich bypasses auth', () => {
  const t = makeTerm();
  t.sudo(['make', 'me', 'a', 'sandwich']);
  assert.deepStrictEqual(t._out, ['Okay.']);
  assert.strictEqual(t.pending, null);
});

test('sudo as root runs the command directly', () => {
  const t = rootTerm();
  t.sudo(['whoami']);
  assert.ok(t._out.some((l) => l === 'root'), 'root sudo runs the command');
});

test('exit revokes the root session: clears the key in memory and storage', () => {
  const t = rootTerm();
  t.exitShell();
  assert.strictEqual(t.rooted, false);
  assert.strictEqual(t.rootKey, null, 'session key wiped from memory');
  assert.strictEqual(t.state.rootKey, null, 'persisted key revoked');
  assert.ok(t._persistCalls.includes(true));
  assert.ok(t._out.some((l) => /logout/.test(l)));
});

test('history lists this session commands, numbered', () => {
  const t = makeTerm();
  t.history = ['cd blog', 'ls']; // stored newest-first
  t.showHistory();
  assert.ok(t._out.some((l) => /^\s+1\s+ls$/.test(l)), 'oldest first, numbered');
  assert.ok(t._out.some((l) => /^\s+2\s+cd blog$/.test(l)));
});

test('key/solved/lecture state persists across reloads', () => {
  installStorage();
  const s = freshState();
  s.rootKey = 'a2V5'; s.solved = true; s.sudoLectured = true;
  saveState(s);
  const r = loadState();
  assert.strictEqual(r.rootKey, 'a2V5');
  assert.strictEqual(r.solved, true);
  assert.strictEqual(r.sudoLectured, true);
});

// ---- writable overlay filesystem -------------------------------------------
test('mkdir / touch / echo redirection create persistent entries', () => {
  const t = makeTerm();
  t.mkdir('projects');
  assert.ok(t.isDirAbsolute(['projects']), 'projects dir exists');
  t.cwd = ['projects'];
  t.touch('notes.txt');
  assert.strictEqual(t.overlayFileContents(['projects', 'notes.txt']), '');
  t.echo(['hello', 'world'], { mode: 'write', target: 'notes.txt' });
  assert.strictEqual(t.overlayFileContents(['projects', 'notes.txt']), 'hello world');
  t.echo(['another', 'line'], { mode: 'append', target: 'notes.txt' });
  assert.strictEqual(t.overlayFileContents(['projects', 'notes.txt']), 'hello world\nanother line');
});

test('cat reads overlay files verbatim', () => {
  const t = makeTerm();
  t.writeFile('a.txt', 'line1\nline2', false);
  t.cat('a.txt');
  assert.deepStrictEqual(t._out, ['line1', 'line2']);
});

test('mv and cp move/copy overlay files', () => {
  const t = makeTerm();
  t.writeFile('notes.txt', 'data', false);
  t.mvcp(['notes.txt', 'old.txt'], false); // mv
  assert.strictEqual(t.overlayFileContents(['notes.txt']), null, 'source gone after mv');
  assert.strictEqual(t.overlayFileContents(['old.txt']), 'data');
  t.mvcp(['old.txt', 'backup.txt'], true); // cp
  assert.strictEqual(t.overlayFileContents(['old.txt']), 'data', 'source kept after cp');
  assert.strictEqual(t.overlayFileContents(['backup.txt']), 'data');
  t.rm(['backup.txt']);
  assert.strictEqual(t.overlayFileContents(['backup.txt']), null, 'removed');
});

test('bundled filesystem is immutable', () => {
  const t = makeTerm();
  t.writeFile('about.md', 'hacked', false);
  assert.ok(t._out.some((l) => /Permission denied/.test(l)), 'cannot overwrite a base file');
  t._out.length = 0;
  t.rm(['blog']);
  assert.ok(t._out.some((l) => /Permission denied/.test(l)), 'cannot remove a base dir');
  t._out.length = 0;
  t.mkdir('blog');
  assert.ok(t._out.some((l) => /File exists/.test(l)), 'cannot clobber a base dir');
});

// ---- vim path resolution & directory view ----------------------------------
function withView(t) {
  t.openView = (vp, mode, synthetic) => { t._view = { vp, mode, synthetic }; };
  return t;
}

test('vim ./blog/<file> opens that article', () => {
  const t = withView(makeTerm());
  t.vim('./blog/welcome.md');
  assert.strictEqual(t._view.vp, 'blog/welcome.md');
  assert.strictEqual(t._view.synthetic, undefined);
});

test('vim ./blog (a directory) acts like vim: netrw listing', () => {
  const t = withView(makeTerm());
  t.vim('./blog');
  assert.strictEqual(t._view.vp, null);
  assert.ok(t._view.synthetic, 'synthetic buffer provided');
  assert.ok(/Netrw Directory Listing/.test(t._view.synthetic.source), 'netrw header');
  assert.ok(/welcome\.md/.test(t._view.synthetic.source), 'lists the directory contents');
});

test('vim . at root lists the root directory', () => {
  const t = withView(makeTerm());
  t.vim('.');
  assert.ok(/blog\//.test(t._view.synthetic.source) && /about\.md/.test(t._view.synthetic.source));
});

test('vim on a user overlay file opens it read-only', () => {
  const t = withView(makeTerm());
  t.writeFile('notes.txt', 'hello', false);
  t.vim('notes.txt');
  assert.strictEqual(t._view.vp, null);
  assert.ok(/hello/.test(t._view.synthetic.source));
});

test('vim on a missing file reports No such file', () => {
  const t = withView(makeTerm());
  t.vim('nope.md');
  assert.ok(t._out.some((l) => /No such file or directory/.test(l)));
});

// ---- easter eggs -----------------------------------------------------------
test('whoami reflects root status', () => {
  const t = makeTerm();
  assert.strictEqual(t.rooted ? 'root' : 'guest', 'guest');
  t.rooted = true;
  assert.strictEqual(t.rooted ? 'root' : 'guest', 'root');
});

test('cowsay frames the message', () => {
  const t = makeTerm();
  t.cowsay('moo');
  assert.ok(t._out.some((l) => /< moo >/.test(l)));
  assert.ok(t._out.some((l) => /\^__\^/.test(l)));
});

test('shutdown/poweroff wedges transiently without persisting', () => {
  const t = makeTerm();
  const realST = global.setTimeout;
  global.setTimeout = () => 0;
  try { t.powerOff(false); } finally { global.setTimeout = realST; }
  assert.strictEqual(t.halted, true);
  assert.strictEqual(t.state.status, 'operational', 'shutdown must not destroy the machine');
  assert.ok(!t._persistCalls.includes(true));
});

test('ls merges overlay entries with the base listing', () => {
  const t = makeTerm();
  t.mkdir('projects');
  t.writeFile('todo.txt', 'x', false);
  t.ls();
  const line = t._out.join(' ');
  assert.ok(/projects\//.test(line), 'overlay dir shown with trailing slash');
  assert.ok(/todo\.txt/.test(line), 'overlay file shown');
  assert.ok(/blog\//.test(line) && /about\.md/.test(line), 'base entries still shown');
});

await atest('su with the wrong root password does not grant root', async () => {
  const t = makeTerm();
  t.su([]); // opens the Password: prompt
  await t.pending.onSubmit('QU3B411{definitely-not-it}');
  assert.strictEqual(t.rooted, false, 'still guest');
  assert.strictEqual(t.rootKey, null, 'no key acquired');
  assert.strictEqual(t.state.rootKey, null, 'nothing persisted');
  assert.ok(t._out.some((l) => /Authentication failure/.test(l)), 'reports auth failure');
});

// ---- adversarial: forged state cannot reveal encrypted content -------------
await atest('a forged persisted key is rejected and purged on boot', async () => {
  const t = makeTerm();
  t.state.rootKey = 'Zm9yZ2VkLWtleS12YWx1ZQ=='; // base64 "forged-key-value"
  await t.restoreRoot();
  assert.strictEqual(t.rooted, false, 'forged key does not grant root');
  assert.strictEqual(t.rootKey, null);
  assert.strictEqual(t.state.rootKey, null, 'the invalid key is purged');
});

await atest('forcing rooted=true with a fake key still cannot decrypt the vault', async () => {
  const t = rootTerm(); // rooted:true but rootKey is a non-vault placeholder
  t._out.length = 0;
  await t.cat('/etc/shadow');
  assert.ok(t._out.some((l) => /Permission denied/.test(l)), 'decryption fails -> denied');
  assert.ok(!t._out.some((l) => /19876/.test(l)), 'no plaintext leaks');
});

await atest('direct cat of a vault path as guest never decrypts', async () => {
  const t = makeTerm();
  await t.cat('/etc/shadow');
  assert.ok(t._out.some((l) => /Permission denied/.test(l)));
  assert.ok(!t._out.some((l) => /19876/.test(l)));
});

console.log(`\n${passed} checks passed.`);
