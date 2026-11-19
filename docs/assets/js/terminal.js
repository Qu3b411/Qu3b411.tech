// Terminal shell logic for the terminal blog.
// This module exports a Terminal class that manages command parsing,
// virtual filesystem navigation and printing to the terminal output.

import { GAMES } from './games/index.js';
import { SECRETS } from './secrets.js';
import { vaultHas, vaultUnlock, vaultRestore, vaultRead } from './vault.js';

function stripTerminalControls(value) {
  return String(value)
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '');
}

function isPrintableInput(data) {
  return !/[\x00-\x1F\x7F\x1B]/.test(data);
}

// The real first-run sudo lecture, shown once per machine.
const SUDO_LECTURE = [
  'We trust you have received the usual lecture from the local System',
  'Administrator. It usually boils down to these three things:',
  '',
  '    #1) Respect the privacy of others.',
  '    #2) Think before you type.',
  '    #3) With great power comes great responsibility.',
  '',
];

// Terminal shell using xterm.js for interactive display.
// This class implements a Unix-like shell with support for ls, cd, cat, vim, nano, clear and help.
export class Terminal {
  constructor({ containerEl, bundle, openViewCallback, onPathChange, state, onPersist }) {
    this.containerEl = containerEl;
    this.bundle = bundle;
    this.openView = openViewCallback;
    this.onPathChange = onPathChange;
    // Persistent virtual-machine state (localStorage-backed; may be null).
    this.state = state || null;
    this._persist = typeof onPersist === 'function' ? onPersist : () => {};
    this.halted = false;
    // Virtual root state is NEVER trusted from storage — it is derived from
    // possession of a key that actually decrypts the vault. `rooted` starts
    // false and is set true only after a persisted key is cryptographically
    // validated (below) or earned live via `su`. `pending` holds an in-progress
    // line-read (password prompt).
    this.rooted = false;
    this.rootKey = null;
    this.pending = null;
    // Current working directory segments
    this.cwd = [];
    // Command buffer and history (restored from persistent state; newest-first)
    this.commandBuffer = '';
    this.history = this.state && Array.isArray(this.state.history)
      ? this.state.history.slice().reverse()
      : [];
    this.historyIndex = -1;
    // Initialize xterm.js
    this.term = new window.Terminal({
      theme: {
        background: 'transparent',
        foreground: '#00ff00',
        cursor: '#00ff00'
      },
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 1000,
      convertEol: true
    });
    this.term.open(this.containerEl);
    // Size the terminal to fill its container (no FitAddon is bundled, so we
    // compute cols/rows from the measured cell size ourselves). Done on the
    // next frame once xterm has measured its glyph dimensions, and again
    // whenever the container resizes (window resize, or returning from an
    // editor view that had hidden the terminal).
    this.fit();
    // Re-fit whenever the layout changes: container resize (covers window
    // resize and returning from an editor view), plus viewport zoom / mobile
    // keyboard (visualViewport) and device rotation.
    if (typeof window.ResizeObserver === 'function') {
      this._resizeObserver = new window.ResizeObserver(() => this.fit());
      this._resizeObserver.observe(this.containerEl);
    }
    window.addEventListener('resize', () => this.fit());
    window.addEventListener('orientationchange', () => this.fit());
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.fit());
    }
    // A destroyed machine never boots into a usable shell: show the failed boot
    // sequence and ignore all input until the site's storage is cleared.
    if (this.state && this.state.status === 'destroyed') {
      this.halted = true;
      this.renderBootFailure();
    } else {
      if (typeof this.term.focus === 'function') this.term.focus();
      this.restoreCwd();
      this.printPrompt();
      this.restoreRoot(); // async: validate any persisted key, then reflect it
    }
    // Handle input
    this.term.onData((data) => this.handleData(data));
  }

  // Validate a persisted root key by actually decrypting the vault canary. A
  // forged / stale / garbage value never grants privilege; it is purged. On a
  // valid key the prompt is redrawn as root.
  async restoreRoot() {
    const raw = this.state && this.state.rootKey;
    if (!raw) return;
    const key = await vaultRestore(raw);
    if (key) {
      this.rootKey = key;
      this.rooted = true;
      // Reflect the elevation in the live prompt if the shell is idle.
      if (!this.game && !this.pending && !this.halted && !this.commandBuffer) {
        this.term.write('\r' + this.promptString() + '\x1b[K');
      }
    } else if (this.state) {
      this.state.rootKey = null; // drop an invalid/forged key
      this.persist();
    }
  }

  // Persist the current shell state (history, cwd, overlay fs, scores).
  // Pass `now` to force an immediate write (destruction must not be lost).
  persist(now) {
    if (!this.state) return;
    this.state.history = this.history.slice().reverse();
    this.state.cwd = this.cwd.slice();
    this._persist(now);
  }

  // Restore the last working directory if it still resolves to a directory.
  restoreCwd() {
    if (!this.state || !Array.isArray(this.state.cwd) || !this.state.cwd.length) return;
    const path = '/' + this.state.cwd.join('/');
    if (this.isDirAbsolute(this.state.cwd)) {
      this.cwd = this.state.cwd.slice();
      if (this.onPathChange) this.onPathChange(this.cwdPath);
    }
  }

  // The persistent failed-boot screen shown when the machine is destroyed.
  renderBootFailure() {
    const R = (s) => '\x1b[31m' + s + '\x1b[0m';
    const lines = [
      '',
      'Booting Qu3b411 Linux...',
      '',
      R('[    0.824112] /dev/sda1: filesystem errors detected'),
      R('[    1.106291] EXT4-fs (sda1): unable to read superblock'),
      R('[    1.394882] VFS: Cannot open root device "sda1"'),
      '',
      R('[    1.395014] Kernel panic - not syncing:'),
      R('                 VFS: Unable to mount root fs'),
      R('                 on unknown-block(8,1)'),
      '',
      'System halted.',
      '',
    ];
    lines.forEach((l) => this.term.write(l + '\r\n'));
  }

  // Pick a terminal font size for the current viewport width so text stays
  // readable on phones without wasting space on desktop.
  responsiveFontSize() {
    const w = window.innerWidth || 1024;
    if (w < 600) return 12;
    if (w < 900) return 13;
    return 14;
  }

  // Debounced entry point: coalesce bursts of resize events into one fit per
  // animation frame to avoid thrashing xterm's (relatively costly) resize.
  fit() {
    if (this._fitScheduled) return;
    this._fitScheduled = requestAnimationFrame(() => {
      this._fitScheduled = null;
      this._doFit();
    });
  }

  // Resize the xterm grid to fill the available container space. Uses the
  // renderer's measured cell size; guards against xterm internals being absent.
  _doFit() {
    try {
      // Apply a viewport-appropriate font size first. Changing it re-measures
      // the cell asynchronously, so defer the actual grid resize one frame to
      // use the fresh metrics (guarded: the font now matches, so no loop).
      const targetFont = this.responsiveFontSize();
      if (this.term.options.fontSize !== targetFont) {
        this.term.options.fontSize = targetFont;
        requestAnimationFrame(() => this._doFit());
        return;
      }
      const core = this.term._core;
      const cell = core && core._renderService && core._renderService.dimensions
        && core._renderService.dimensions.css && core._renderService.dimensions.css.cell;
      if (!cell || !cell.width || !cell.height) return;
      const el = this.term.element; // the .xterm element filling the container
      if (!el || !el.clientWidth || !el.clientHeight) return;
      const scrollbarWidth = (core.viewport && core.viewport.scrollBarWidth) || 0;
      const cols = Math.max(2, Math.floor((el.clientWidth - scrollbarWidth) / cell.width));
      const rows = Math.max(1, Math.floor(el.clientHeight / cell.height));
      if (cols !== this.term.cols || rows !== this.term.rows) {
        this.term.resize(cols, rows);
      }
    } catch (e) {
      /* non-fatal: leave the terminal at its current size */
    }
  }

  // The prompt string (root mode is purely cosmetic, unlocked via the puzzle).
  promptString() {
    const path = '/' + this.cwd.join('/');
    return this.rooted ? `root@qu3b411:${path}# ` : `${path}> `;
  }

  // Print the current prompt
  printPrompt() {
    // A destroyed/halted machine never draws a usable prompt again.
    if (this.halted) return;
    this.term.write('\r\n' + this.promptString());
  }

  // Print a line to the terminal
  printLine(text) {
    this.term.write(`\r\n${stripTerminalControls(text)}`);
  }

  // Handle input from xterm
  handleData(data) {
    // A destroyed (halted) machine accepts no input.
    if (this.halted) return;
    // A full-screen animation (e.g. `sl`) owns the screen until it finishes.
    if (this._anim) return;
    // While a game is running it owns all keyboard input.
    if (this.game) {
      this.game.input(data);
      return;
    }
    // Pasted/multi-character input arrives as a single onData chunk. Fan it out
    // one code point at a time so an embedded or trailing newline submits the
    // line (instead of being ignored) and stray control bytes are dropped
    // individually — otherwise pasting e.g. the flag with a trailing newline, or
    // any text containing a control byte, silently discards the entire paste.
    // Escape sequences (arrow keys etc.) start with ESC and are left intact so
    // their multi-byte form still matches the handlers below.
    if (data.length > 1 && data[0] !== '\u001b') {
      for (const ch of Array.from(data)) this.handleData(ch);
      return;
    }
    // A line-read in progress (the su / sudo password prompt) owns input.
    if (this.pending) { this.handlePending(data); return; }
    switch (data) {
      case '\u0003': // Ctrl+C
        this.commandBuffer = '';
        this.term.write('^C');
        this.printPrompt();
        break;
      case '\r': // Enter (CR)
      case '\n': // Enter (LF, e.g. from pasted input)
        this.term.write('\r\n');
        const cmd = this.commandBuffer.trim();
        this.commandBuffer = '';
        if (cmd.length) {
          this.history.unshift(cmd);
          this.historyIndex = -1;
          this.persist(); // remember command history across sessions
          const result = this.executeCommand(cmd);
          // Async commands (the padding-oracle ones) return a promise; defer
          // the next prompt until they finish so output lands before it.
          if (result && typeof result.then === 'function') {
            result.finally(() => { if (!this.game && !this.pending) this.printPrompt(); });
            break;
          }
        }
        // A launched game — or an open password prompt — owns the screen; don't
        // draw a shell prompt over it.
        if (!this.game && !this.pending) this.printPrompt();
        break;
      case '\t': // Tab completion
        this.handleTab();
        break;
      case '\u007f': // Backspace
        if (this.commandBuffer.length > 0) {
          // Remove last char
          this.commandBuffer = this.commandBuffer.slice(0, -1);
          // Move cursor back, clear char, move back
          this.term.write('\b \b');
        }
        break;
      case '\u001b[A': // Up arrow
        // Navigate history
        if (this.history.length > 0) {
          if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
          }
          const histCmd = this.history[this.historyIndex];
          // Clear current line
          this.clearLine();
          this.commandBuffer = histCmd;
          this.term.write(stripTerminalControls(histCmd));
        }
        break;
      case '\u001b[B': // Down arrow
        if (this.history.length > 0) {
          if (this.historyIndex > 0) {
            this.historyIndex--;
            const histCmd = this.history[this.historyIndex];
            this.clearLine();
            this.commandBuffer = histCmd;
            this.term.write(stripTerminalControls(histCmd));
          } else if (this.historyIndex === 0) {
            this.historyIndex = -1;
            this.clearLine();
            this.commandBuffer = '';
          }
        }
        break;
      default:
        // Normal printable characters; reject terminal control sequences so
        // pasted escape codes cannot be replayed into xterm.js.
        if (!isPrintableInput(data)) return;
        this.commandBuffer += data;
        this.term.write(stripTerminalControls(data));
        break;
    }
  }

  // Clear current input line (used when navigating history)
  clearLine() {
    // Move cursor to start of line: send CR, rewrite prompt, clear to EOL
    this.term.write('\r' + this.promptString() + '\x1b[K');
  }

  // Resolve a directory fragment (e.g. '', 'blog/', '/', '../') to cwd-relative
  // path segments, for tab completion.
  resolveDirSegments(dirPart) {
    const segs = dirPart.startsWith('/') ? [] : this.cwd.slice();
    dirPart.split('/').forEach((p) => {
      if (!p || p === '.') return;
      if (p === '..') segs.pop();
      else segs.push(p);
    });
    return segs;
  }

  // List the entries of a virtual directory: [{ name, dir }] or null if invalid.
  entriesForPath(segs) {
    const p = '/' + segs.join('/');
    if (p === '/') {
      return [
        { name: 'blog', dir: true },
        { name: 'about.md', dir: false },
        { name: '.games', dir: true }, // hidden; only offered when prefix starts with '.'
      ];
    }
    if (p === '/blog') return this.bundle.posts.map((po) => ({ name: po.file, dir: false }));
    if (p === '/.games') return Object.keys(this.bundle.games || {}).map((k) => ({ name: k.replace(/^\.games\//, ''), dir: false }));
    return null;
  }

  // Tab completion: completes command names in the first word and file/dir paths
  // in arguments. Extends to the longest common prefix, lists on ambiguity, and
  // hides dotfiles unless the typed prefix already starts with '.'.
  handleTab() {
    const buf = this.commandBuffer;
    const tokens = buf.split(/\s+/);
    const isCmd = tokens.length === 1;
    const token = tokens[tokens.length - 1];

    let prefix;
    let candidates;
    if (isCmd && !token.includes('/')) {
      prefix = token;
      const cmds = ['ls', 'cd', 'cat', 'vim', 'nano', 'clear', 'help'];
      candidates = cmds.filter((c) => c.startsWith(prefix)).map((name) => ({ name, dir: false }));
    } else {
      const slash = token.lastIndexOf('/');
      const dirPart = slash >= 0 ? token.slice(0, slash + 1) : '';
      prefix = slash >= 0 ? token.slice(slash + 1) : token;
      const entries = this.entriesForPath(this.resolveDirSegments(dirPart)) || [];
      candidates = entries.filter(
        (e) => e.name.startsWith(prefix) && (prefix.startsWith('.') || !e.name.startsWith('.'))
      );
    }

    if (candidates.length === 0) {
      this.term.write('\x07'); // bell
      return;
    }

    if (candidates.length === 1) {
      const c = candidates[0];
      const add = c.name.slice(prefix.length) + (c.dir ? '/' : ' ');
      this.commandBuffer += add;
      this.term.write(add);
      return;
    }

    // Multiple matches: extend to the longest common prefix, else list them.
    const common = candidates
      .map((c) => c.name)
      .reduce((a, b) => {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return a.slice(0, i);
      });
    if (common.length > prefix.length) {
      const add = common.slice(prefix.length);
      this.commandBuffer += add;
      this.term.write(add);
    } else {
      const names = candidates.map((c) => c.name + (c.dir ? '/' : ''));
      this.term.write('\r\n' + names.join('  '));
      this.term.write('\r\n' + this.promptString() + this.commandBuffer);
    }
  }

  // Execute a full command string
  // Split a command line into tokens, honoring single/double quotes so
  // `echo "hello world" > notes.txt` yields ['echo','hello world','>','notes.txt'].
  tokenizeLine(line) {
    const toks = [];
    let cur = '';
    let quote = null;
    let has = false; // whether the current token has started (incl. empty quotes)
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === quote) quote = null;
        else cur += c;
      } else if (c === '"' || c === "'") {
        quote = c;
        has = true;
      } else if (/\s/.test(c)) {
        if (has) { toks.push(cur); cur = ''; has = false; }
      } else {
        cur += c;
        has = true;
      }
    }
    if (has) toks.push(cur);
    return toks;
  }

  // Pull a trailing `>`/`>>` redirection out of the token list. Returns the
  // remaining tokens plus { mode: 'write'|'append', target } or null.
  extractRedirect(tokens) {
    let redirect = null;
    const rest = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '>' || t === '>>') {
        redirect = { mode: t === '>>' ? 'append' : 'write', target: tokens[i + 1] };
        i++;
        continue;
      }
      const m = t.match(/^(>>?)(.+)$/);
      if (m) { redirect = { mode: m[1] === '>>' ? 'append' : 'write', target: m[2] }; continue; }
      rest.push(t);
    }
    return { tokens: rest, redirect };
  }

  // Recognize a genuine destroy-the-root command — `rm -rf /` and its
  // equivalents (any option ordering/spelling, with or without
  // --no-preserve-root). Only an executed command line reaches here; rendered
  // article text and cat output never do.
  isDestroyCommand(tokens) {
    if (!tokens.length || tokens[0] !== 'rm') return false;
    let recursive = false;
    let force = false;
    const targets = [];
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '--recursive') recursive = true;
      else if (t === '--force') force = true;
      else if (t.startsWith('--')) { /* --no-preserve-root and friends: ignore */ }
      else if (t.startsWith('-') && t.length > 1) {
        if (/[rR]/.test(t)) recursive = true;
        if (/f/.test(t)) force = true;
      } else {
        targets.push(t);
      }
    }
    if (!recursive || !force) return false;
    // Trigger only when a target normalizes to the filesystem root.
    return targets.some((t) => {
      const e = this.expandHome(t);
      if (!e.startsWith('/')) return false;
      const segs = [];
      for (const p of e.split('/').filter(Boolean)) {
        if (p === '.') continue;
        else if (p === '..') segs.pop();
        else segs.push(p);
      }
      return segs.length === 0 || (segs.length === 1 && segs[0] === '*');
    });
  }

  executeCommand(cmd) {
    const rawTokens = this.tokenizeLine(cmd);
    if (!rawTokens.length) return;
    // Parse the line FIRST, then judge destruction on executable semantics —
    // the parsed command + arguments + an actual redirection — never on a
    // raw-text substring. This is why `echo ':(){ :|:& };:'` and
    // `echo 'x > /dev/sda'` print text instead of wrecking the machine: the
    // dangerous shape lives inside a quoted argument, not the command position.
    const { tokens, redirect } = this.extractRedirect(rawTokens);

    // Destructive Easter eggs take precedence over normal handling.
    if (this.isDestroyCommand(tokens)) return this.destroy(); // rm -rf /
    if (this.isForkBomb(tokens)) return this.forkbomb(); // transient exhaustion
    const preamble = this.destructivePreamble(tokens, redirect);
    if (preamble) return this.destroy(preamble);

    if (!tokens.length) {
      // A bare `> file` truncates/creates an empty file, like a real shell.
      if (redirect && redirect.target) this.writeFile(redirect.target, '', redirect.mode === 'append');
      return;
    }
    const [command, ...args] = tokens;
    // Executable paths (files with the rx bit): ./snake.js in /.games, or an
    // absolute /.games/snake.js. Bare names are not executable (need ./).
    if (command.startsWith('./') || command.startsWith('/')) {
      this.execFile(command);
      return;
    }
    switch (command) {
      case 'help':
        this.printLine('Commands: ls, cd, pwd, cat, echo, mkdir, touch, rm, mv, cp, vim, nano, clear, help');
        break;
      case 'ls':
        this.ls(...args);
        break;
      case 'pwd':
        this.printLine(this.cwdPath);
        break;
      case 'cd':
        this.cd(args[0]);
        break;
      case 'cat':
        return this.catCommand(args, redirect);
      case 'echo':
        this.echo(args, redirect);
        break;
      case 'mkdir':
        args.filter((a) => !a.startsWith('-')).forEach((a) => this.mkdir(a));
        break;
      case 'touch':
        args.filter((a) => !a.startsWith('-')).forEach((a) => this.touch(a));
        break;
      case 'rm':
        this.rm(args);
        break;
      case 'mv':
        this.mvcp(args, false);
        break;
      case 'cp':
        this.mvcp(args, true);
        break;
      case 'vim':
      case 'vi': // real nerds' muscle memory
      case 'view':
        this.vim(args[0]);
        break;
      case 'nano':
        this.nano(args[0]);
        break;
      case 'emacs':
        this.printLine('emacs: command not found. this is a vim household.');
        break;
      case 'clear':
        this.clear();
        break;
      case 'history':
        this.showHistory();
        break;
      // ---- Identity / privilege ---------------------------------------------
      case 'su':
      case 'unlock': // alias for su (older hint text referenced `unlock`)
        return this.su(args);
      case 'sudo':
        return this.sudo(args);
      case 'exit':
      case 'logout':
        this.exitShell();
        break;
      // ---- Easter eggs -------------------------------------------------------
      case 'whoami':
        this.printLine(this.rooted ? 'root' : 'guest');
        break;
      case 'make':
        this.printLine(args.join(' ') === 'me a sandwich' ? 'What? Make it yourself.' : `make: *** No rule to make target '${args[0] || ''}'.  Stop.`);
        break;
      case 'neofetch':
      case 'screenfetch':
        this.neofetch();
        break;
      case 'cowsay':
        this.cowsay(args.join(' ') || 'moo');
        break;
      case 'sl':
        return this.steamLocomotive();
      case 'shutdown':
      case 'poweroff':
      case 'halt':
        return this.powerOff(false);
      case 'reboot':
        return this.powerOff(true);
      case '':
        break;
      default:
        this.printLine(`${command}: command not found`);
        break;
    }
  }

  // ---- Identity / privilege subsystem ---------------------------------------

  // Begin a line-read: print the prompt and route subsequent keystrokes to a
  // buffer. `echo:false` suppresses display (password entry). onSubmit(line) is
  // called on Enter; it may be async and may itself open another prompt.
  readLine(promptText, { echo = true, onSubmit }) {
    this.term.write('\r\n' + promptText);
    this.pending = { buffer: '', echo, onSubmit };
  }

  // Keystroke handling while a line-read (password prompt) is active.
  handlePending(data) {
    const p = this.pending;
    if (data === '\r' || data === '\n') {
      this.term.write('\r\n');
      this.pending = null;
      const r = p.onSubmit(p.buffer);
      if (r && typeof r.then === 'function') {
        r.finally(() => { if (!this.game && !this.pending) this.printPrompt(); });
      } else if (!this.game && !this.pending) {
        this.printPrompt();
      }
      return;
    }
    if (data === '\u0003') { // Ctrl-C cancels
      this.term.write('^C');
      this.pending = null;
      this.printPrompt();
      return;
    }
    if (data === '\u007f') { // Backspace
      if (p.buffer.length) {
        p.buffer = p.buffer.slice(0, -1);
        if (p.echo) this.term.write('\b \b');
      }
      return;
    }
    if (isPrintableInput(data)) {
      p.buffer += data;
      if (p.echo) this.term.write(data); // password prompts never echo
    }
  }

  // Grant virtual root from a validated vault key. Persists the key material
  // (base64) — NOT a boolean — so a reload re-validates it against the vault
  // rather than trusting a flag.
  grantRoot(unlocked) {
    this.rootKey = unlocked.key;
    this.rooted = true;
    if (this.state) {
      this.state.rootKey = unlocked.raw;
      this.state.solved = true;
      this.persist(true);
    }
  }

  // su / su - / su root — the authentic way in. Prompts for the root password
  // (the recovered flag), no echo. Other users prompt and fail; unknown users
  // don't exist.
  su(args) {
    const target = args.filter((a) => a !== '-' && !a.startsWith('-'))[0] || 'root';
    if (target !== 'root') {
      const users = ['root', 'qu3b411', 'guest', 'daemon', 'bin', 'sys', 'sshd', 'nobody'];
      if (!users.includes(target)) { this.printLine(`su: user ${target} does not exist`); return; }
      return this.readLine('Password: ', { echo: false, onSubmit: () => { this.printLine('su: Authentication failure'); } });
    }
    if (this.rooted) return; // already root; su root is a no-op
    return this.readLine('Password: ', {
      echo: false,
      onSubmit: async (pw) => {
        const unlocked = await vaultUnlock(pw); // valid only if the flag decrypts the vault
        if (unlocked) this.grantRoot(unlocked); // silent, like real su — the prompt flips
        else this.printLine('su: Authentication failure');
      },
    });
  }

  // sudo. First invocation prints the real lecture. The xkcd sandwich bypasses
  // auth. As guest: prompt for a password (no echo), then refuse — not in the
  // sudoers file. As root: run the command directly, no password.
  sudo(args) {
    if (args.join(' ') === 'make me a sandwich') { this.printLine('Okay.'); return; }
    if (this.rooted) {
      const cmd = args.join(' ');
      if (!cmd) { this.printLine('usage: sudo [-u user] <command>'); return; }
      return this.executeCommand(cmd); // root runs it as-is
    }
    if (this.state && !this.state.sudoLectured) {
      this.state.sudoLectured = true;
      this.persist();
      SUDO_LECTURE.forEach((l) => this.printLine(l));
    }
    return this.readLine('[sudo] password for guest: ', {
      echo: false,
      onSubmit: () => { this.printLine('guest is not in the sudoers file. This incident will be reported.'); },
    });
  }

  // exit / logout. From a root session, drop back to guest (privilege released,
  // persisted). As guest there is nowhere to go — the shell just reports it.
  exitShell() {
    if (this.rooted) {
      this.rooted = false;
      this.rootKey = null; // drop the session key from memory
      if (this.state) { this.state.rootKey = null; this.persist(true); } // and from storage
      this.printLine('logout');
      return;
    }
    this.printLine('logout');
  }

  // history: this session's commands, numbered — the real shell builtin. (The
  // owner's planted trail lives separately in ~/.bash_history.)
  showHistory() {
    const items = this.history.slice().reverse(); // stored newest-first
    items.forEach((cmd, i) => this.printLine(`${String(i + 1).padStart(5, ' ')}  ${cmd}`));
  }

  // neofetch: ASCII logo + tongue-in-cheek "system" specs.
  neofetch() {
    const info = [
      ['OS', 'Qu3b411 Linux x86_64'],
      ['Host', 'qu3b411.tech (a blog pretending to be a box)'],
      ['Kernel', '6.6.6-ctf'],
      ['Uptime', '4269 days, 13:37'],
      ['Shell', 'bash 5.1.16 (mostly)'],
      ['Resolution', 'whatever you brought'],
      ['Terminal', 'xterm.js'],
      ['CPU', 'vibes (8) @ 4.2GHz'],
      ['Memory', '640K ought to be enough'],
    ];
    const logo = [
      '   ____        ',
      '  / __ \\___ _  ',
      ' / /_/ / // /  ',
      ' \\___\\_\\_,_/   ',
      '  q u 3 b      ',
      '               ',
    ];
    const rows = Math.max(logo.length, info.length);
    for (let i = 0; i < rows; i++) {
      const l = (logo[i] || '').padEnd(16, ' ');
      const r = info[i] ? `${info[i][0]}: ${info[i][1]}` : '';
      this.printLine(l + r);
    }
  }

  // cowsay: the ASCII cow with a speech bubble sized to the message.
  cowsay(text) {
    const top = ' ' + '_'.repeat(text.length + 2);
    const bottom = ' ' + '-'.repeat(text.length + 2);
    [
      top,
      `< ${text} >`,
      bottom,
      '        \\   ^__^',
      '         \\  (oo)\\_______',
      '            (__)\\       )\\/\\',
      '                ||----w |',
      '                ||     ||',
    ].forEach((l) => this.printLine(l));
  }

  // sl: the steam locomotive that punishes a mistyped `ls`. Chuffs across the
  // width, then clears and restores the prompt. Non-interactive while it runs.
  steamLocomotive() {
    const train = [
      '      ====        ________                ___________ ',
      '  _D _|  |_______/        \\__I_I_____===__|_________| ',
      '   |(_)---  |   H\\________/ |   |        =|___ ___|   ',
      '   /     |  |   H  |  |     |   |         ||_| |_||   ',
      '  |      |  |   H  |__--------------------| [___] |   ',
      '  | ________|___H__/__|_____/[][]~\\_______|       |   ',
      '  |/ |   |-----------I_____I [][] []  D   |=======|__ ',
      "__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
      ' |/-=|___|=    ||    ||    ||    |_____/~\\___/        ',
      "  \\_/      \\O=====O=====O=====O_/      \\_/            ",
    ];
    const W = (this.term.cols || 80);
    this._anim = true;
    const CSI = '\x1b[';
    return new Promise((resolve) => {
      let x = W;
      const step = () => {
        let out = CSI + '2J' + CSI + 'H\x1b[1;32m';
        for (const line of train) {
          const pad = x > 0 ? ' '.repeat(x) : '';
          const vis = x < 0 ? line.slice(-x) : line;
          out += pad + vis + '\r\n';
        }
        this.term.write(out + '\x1b[0m');
        x -= 3;
        if (x < -train[0].length) {
          this.term.write(CSI + '2J' + CSI + 'H');
          this._anim = false;
          resolve();
          return;
        }
        setTimeout(step, 60);
      };
      step();
    });
  }

  // shutdown / poweroff / halt / reboot. Transient — nothing is persisted; a
  // reload reboots. `reboot` actually reloads the page after the sequence.
  powerOff(reboot) {
    if (this.halted) return;
    this.halted = true;
    const lines = [
      '',
      'Broadcast message from root@qu3b411:',
      `The system is going down for ${reboot ? 'reboot' : 'poweroff'} NOW!`,
      '',
      reboot ? 'Rebooting...' : 'Powering off...',
    ];
    if (!reboot) lines.push('', 'System halted.');
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        if (i >= lines.length) {
          if (reboot && typeof location !== 'undefined' && location.reload) {
            setTimeout(() => location.reload(), 700);
          }
          resolve();
          return;
        }
        this.term.write('\r\n' + lines[i++]);
        setTimeout(step, 170);
      };
      step();
    });
  }

  // echo, with optional `>`/`>>` redirection into the overlay filesystem.
  echo(args, redirect) {
    const text = args.join(' ');
    if (redirect && redirect.target) {
      this.writeFile(redirect.target, text, redirect.mode === 'append');
      return;
    }
    this.printLine(text);
  }

  // cat that also supports `cat src > dst` by copying raw contents into the
  // writable overlay; without redirection it prints as before.
  catCommand(args, redirect) {
    const file = args.find((a) => !a.startsWith('-'));
    if (!redirect) return this.cat(file);
    if (!file) { this.writeFile(redirect.target, '', redirect.mode === 'append'); return; }
    const src = this.readAny(this.absSegs(file));
    if (src === null) { this.printLine(`cat: ${file}: No such file or directory`); return; }
    this.writeFile(redirect.target, src, redirect.mode === 'append');
  }

  // The simulated self-destruction. Commits the destroyed flag immediately (so
  // a refresh mid-sequence stays dead), halts input, and prints a plausible
  // Linux death rattle: a command-specific preamble followed by a shared kernel
  // panic. Writes directly to the terminal (not printLine) to preserve the red
  // ANSI coloring. `preamble` undefined => the default `rm -rf /` lines; an
  // explicit array (even empty) replaces them.
  destroy(preamble) {
    const R = (s) => '\x1b[31m' + s + '\x1b[0m';
    const rmLines = [
      "rm: removing '/bin'...",
      "rm: removing '/etc'...",
      "rm: removing '/usr'...",
      "rm: removing '/home'...",
      '',
      R("rm: cannot remove '/proc': Device or resource busy"),
      R("rm: cannot remove '/sys': Device or resource busy"),
    ];
    const tail = [
      '',
      R('EXT4-fs error (device sda1):'),
      R('  unable to read filesystem metadata'),
      '',
      R('/bin/sh: Input/output error'),
      '',
      R('Kernel panic - not syncing:'),
      R('  Attempted to kill init!'),
      '',
      'System halted.',
    ];
    const seq = (preamble === undefined ? rmLines : preamble).concat(tail);
    this.halted = true;
    if (this.state) {
      this.state.status = 'destroyed';
      this.persist(true); // synchronous, must-not-lose write
    }
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        if (i >= seq.length) { resolve(); return; }
        this.term.write('\r\n' + seq[i++]);
        setTimeout(step, 110);
      };
      step();
    });
  }

  // Recognize destructive OS "tricks" beyond `rm -rf /` and return the
  // command-specific preamble to show before the shared kernel panic, or null
  // if the line is harmless. All simulated — nothing here touches a real disk.
  // Only executed command lines reach this; rendered article/cat text never does.
  destructivePreamble(tokens, redirect) {
    const R = (s) => '\x1b[31m' + s + '\x1b[0m';
    const cmd = tokens[0] || '';
    // Whole disks and their partitions: sda, sda1, nvme0n1, nvme0n1p2, vdb, …
    const diskRe = /^\/dev\/(sd[a-z]|hd[a-z]|vd[a-z]|xvd[a-z]|nvme\d+n\d+(p\d+)?|mmcblk\d+(p\d+)?|disk\d+)\d*$/;
    const isDisk = (t) => diskRe.test(t);

    // dd if=... of=<raw disk>
    if (cmd === 'dd') {
      const of = tokens.find((t) => t.startsWith('of='));
      if (of && isDisk(of.slice(3))) {
        return [
          '1048576+0 records in',
          '1048576+0 records out',
          '536870912 bytes (537 MB, 512 MiB) copied, 2.9 s, 185 MB/s',
        ];
      }
    }

    // mkfs / mkfs.<type> <device>
    if (cmd === 'mkfs' || /^mkfs\.[a-z0-9]+$/.test(cmd)) {
      const dev = tokens.slice(1).find((t) => t.startsWith('/dev/'));
      if (dev && isDisk(dev)) {
        return [
          'mke2fs 1.46.5 (30-Dec-2021)',
          R(`${dev} contains a ext4 file system`),
          'Creating filesystem with 131072000 4k blocks and 32768000 inodes',
          'Writing superblocks and filesystem accounting information: done',
        ];
      }
    }

    // shred / wipefs on a raw device.
    if ((cmd === 'shred' || cmd === 'wipefs') && tokens.slice(1).some(isDisk)) {
      return [R(`${cmd}: overwriting ${tokens.slice(1).find(isDisk)} ...`)];
    }

    // Piping random/zero data straight onto a disk via an ACTUAL redirection:
    //   cat /dev/urandom > /dev/sda   |   echo x > /dev/sda   |   > /dev/sda
    // Uses the parsed redirect target, so a quoted `echo 'x > /dev/sda'` (whose
    // `>` is literal text inside one argument, not a redirection) never matches.
    if (redirect && redirect.target && isDisk(redirect.target)) {
      return ['536870912 bytes (537 MB, 512 MiB) written'];
    }

    // mv / (or ~) into oblivion.
    if (cmd === 'mv' && /\/dev\/null$/.test(tokens[tokens.length - 1] || '')) {
      if (this.expandHome(tokens[1] || '') === '/') return [];
    }

    // chmod -R 000 / — strip every permission from the whole tree.
    if (cmd === 'chmod') {
      const recursive = tokens.some((t) => t === '--recursive' || /^-[^-]*R/.test(t));
      const mode = tokens.find((t) => /^0?[0-7]{3}$/.test(t));
      const root = tokens.some((t) => this.expandHome(t) === '/');
      if (recursive && root && (mode === '000' || mode === '0000')) {
        return [R("chmod: changing permissions of '/bin/su': Operation not permitted")];
      }
    }

    return null;
  }

  // The classic fork bomb: :(){ :|:& };:  (any spacing). Detected only in the
  // COMMAND position — the joined tokens must START with the function
  // definition. Quoted as an argument (`echo ':(){ :|:& };:'`) the first token
  // is `echo`, so the joined stream begins `echo:(){…` and never matches.
  isForkBomb(tokens) {
    return tokens.join('').replace(/\s+/g, '').startsWith(':(){:|:&};:');
  }

  // A fork bomb exhausts the process table: the shell thrashes, flooding fork
  // failures at an accelerating rate until it stops responding. Unlike disk or
  // filesystem destruction NOTHING is persisted — the damage is transient, so
  // reloading the page ("rebooting") brings the machine back healthy. The
  // simulated thrash is bounded and never actually exhausts the real browser.
  forkbomb() {
    if (this.halted) return;
    this.halted = true; // the session is wedged until a reload
    const R = (s) => '\x1b[31m' + s + '\x1b[0m';
    const errs = [
      'bash: fork: retry: Resource temporarily unavailable',
      'bash: fork: retry: No child processes',
      'bash: fork: Cannot allocate memory',
      'bash: fork: retry: Resource temporarily unavailable',
    ];
    return new Promise((resolve) => {
      let n = 0;
      let delay = 150;
      const tick = () => {
        this.term.write('\r\n' + R(errs[n % errs.length]));
        n++;
        if (n >= 40) {
          this.term.write('\r\n' + R('[process table full — system unresponsive]'));
          resolve();
          return;
        }
        delay = Math.max(15, delay - 7); // accelerate into a thrash, then wedge
        setTimeout(tick, delay);
      };
      tick();
    });
  }

  // Clear entire screen (scrollback)
  clear() {
    this.term.clear();
  }

  // Run an executable path. Only files with the rx bit (the hidden games) are
  // runnable; anything else reports "No such file".
  execFile(command) {
    let p = command;
    if (p.startsWith('./')) {
      p = p.slice(2);
      p = this.cwd.length ? this.cwd.join('/') + '/' + p : p;
    } else if (p.startsWith('/')) {
      p = p.replace(/^\/+/, '');
    }
    if (p.startsWith('.games/')) {
      const name = p.slice('.games/'.length);
      if (GAMES[name]) {
        this.launchGame(name);
        return;
      }
    }
    this.printLine(`${command}: No such file or directory`);
  }

  // Launch a game by filename; it owns input until the player quits. The game
  // receives its persisted high score and reports new results back, which we
  // keep as a running maximum in machine state.
  launchGame(name) {
    const runner = GAMES[name];
    if (!runner) return;
    const scores = (this.state && this.state.scores) || {};
    const highScore = Number(scores[name]) || 0;
    this.game = runner(this.term, {
      highScore,
      onScore: (s) => {
        const v = Number(s) || 0;
        if (!this.state) return;
        if (!this.state.scores || typeof this.state.scores !== 'object') this.state.scores = {};
        if (v > (Number(this.state.scores[name]) || 0)) {
          this.state.scores[name] = v;
          this.persist();
        }
      },
      onExit: () => {
        this.game = null;
        this.printPrompt();
        if (typeof this.term.focus === 'function') this.term.focus();
      },
    });
  }

  // Current working directory path
  get cwdPath() {
    return '/' + this.cwd.join('/');
  }

  // In this toy filesystem the home directory IS the root, so '~' and the
  // literal home path both map to '/'. Returns a '/'-rooted path string.
  expandHome(p) {
    const s = String(p == null ? '' : p);
    if (s === '~') return '/';
    if (s.startsWith('~/')) return '/' + s.slice(2);
    if (s === '/home/qu3b411' || s === '/root') return '/';
    if (s.startsWith('/home/qu3b411/')) return '/' + s.slice('/home/qu3b411/'.length);
    if (s.startsWith('/root/')) return '/' + s.slice('/root/'.length);
    return s;
  }

  // Resolve a (possibly relative, possibly ~-prefixed) path to a canonical
  // absolute key, used to look up the hidden SECRETS "files".
  catPath(file) {
    const s = this.expandHome(file);
    const segs = s.startsWith('/') ? [] : this.cwd.slice();
    for (const p of s.split('/').filter(Boolean)) {
      if (p === '.') continue;
      else if (p === '..') segs.pop();
      else segs.push(p);
    }
    return '/' + segs.join('/');
  }

  // ---- Writable overlay filesystem -----------------------------------------
  // Bundled content stays immutable; the overlay (persisted in state.fs) holds
  // user dirs/files at the root and within user dirs. A node is a file
  // ({ f: '<contents>' }) or a directory ({ d: { name: node } }).
  baseDirNames() {
    return ['blog', '.games', '.ssh', '.secret'];
  }

  // Paths that require virtual root. Guests are refused read/traverse/edit here
  // through every route (cat, cd, ls, vim, nano), computed on the RESOLVED path
  // so no relative/`..`/~-spelling slips past. All browser-local; this never
  // touches host privileges. The RSA public keys and the flag ciphertext are
  // deliberately NOT protected — they are public inputs to the CTF. This is the
  // extensible access-control foundation: future root-only paths are added here.
  // (Note: the vfs aliases /root and /home/qu3b411 to its home root '/', so a
  // '/root' directory cannot serve as protected content without redesigning the
  // filesystem; /etc/shadow is the concrete protected file instead.)
  isProtectedPath(segs) {
    if (segs.length === 2 && segs[0] === 'etc' && segs[1] === 'shadow') return true;
    return false;
  }
  overlayRoot() {
    if (!this.state) this.state = { fs: {} };
    if (!this.state.fs || typeof this.state.fs !== 'object') this.state.fs = {};
    return this.state.fs;
  }
  // Walk to the child-map that contains the last segment. Returns { map, name,
  // node } or null if an intermediate path component is missing / not a dir.
  overlayLocate(segs) {
    let map = this.overlayRoot();
    for (let i = 0; i < segs.length - 1; i++) {
      const n = map[segs[i]];
      if (!n || !n.d) return null;
      map = n.d;
    }
    const name = segs[segs.length - 1];
    return { map, name, node: map[name] || null };
  }
  overlayNode(segs) {
    if (!segs.length) return { d: this.overlayRoot() };
    const loc = this.overlayLocate(segs);
    return loc ? loc.node : null;
  }
  isDirAbsolute(segs) {
    if (!segs.length) return true;
    if (segs.length === 1 && this.baseDirNames().includes(segs[0])) return true;
    const n = this.overlayNode(segs);
    return !!(n && n.d);
  }
  // A directory we may create/modify entries in: root or an overlay dir (never
  // a bundled directory).
  isWritableDir(segs) {
    if (!segs.length) return true;
    if (segs.length === 1 && this.baseDirNames().includes(segs[0])) return false;
    const n = this.overlayNode(segs);
    return !!(n && n.d);
  }
  // Read an overlay file's contents, or null if not an overlay file.
  overlayFileContents(segs) {
    const n = this.overlayNode(segs);
    return n && typeof n.f === 'string' ? n.f : null;
  }
  // Does anything (base or overlay) exist at these segments?
  pathExists(segs) {
    if (this.isDirAbsolute(segs)) return true;
    if (this.overlayFileContents(segs) !== null) return true;
    const key = segs.join('/');
    if (key === 'about.md') return true;
    if (this.bundle.postMarkdownByVirtualPath && this.bundle.postMarkdownByVirtualPath[key] != null) return true;
    if (key.startsWith('.games/') && (this.bundle.games || {})[key] != null) return true;
    if (SECRETS['/' + key]) return true;
    return false;
  }
  isBaseFile(segs) {
    const key = segs.join('/');
    if (key === 'about.md') return true;
    if (this.bundle.postMarkdownByVirtualPath && this.bundle.postMarkdownByVirtualPath[key] != null) return true;
    if (key.startsWith('.games/') && (this.bundle.games || {})[key] != null) return true;
    if (SECRETS['/' + key]) return true;
    return false;
  }
  // Resolve an argument to absolute segments (relative to cwd; handles . / ..).
  absSegs(file) {
    const s = this.expandHome(String(file == null ? '' : file));
    const segs = s.startsWith('/') ? [] : this.cwd.slice();
    for (const p of s.split('/').filter(Boolean)) {
      if (p === '.') continue;
      else if (p === '..') segs.pop();
      else segs.push(p);
    }
    return segs;
  }

  mkdir(arg) {
    if (!arg) { this.printLine('mkdir: missing operand'); return; }
    const segs = this.absSegs(arg);
    if (!segs.length) { this.printLine(`mkdir: cannot create directory '${arg}': File exists`); return; }
    if (this.pathExists(segs)) { this.printLine(`mkdir: cannot create directory '${arg}': File exists`); return; }
    const parent = segs.slice(0, -1);
    if (!this.isWritableDir(parent)) { this.printLine(`mkdir: cannot create directory '${arg}': No such file or directory`); return; }
    const loc = this.overlayLocate(segs);
    loc.map[loc.name] = { d: {} };
    this.persist();
  }

  touch(arg) {
    if (!arg) { this.printLine('touch: missing file operand'); return; }
    const segs = this.absSegs(arg);
    if (this.isDirAbsolute(segs) || this.isBaseFile(segs)) return; // exists; no-op
    if (this.overlayFileContents(segs) !== null) return; // exists; no-op
    const parent = segs.slice(0, -1);
    if (!this.isWritableDir(parent)) { this.printLine(`touch: cannot touch '${arg}': No such file or directory`); return; }
    const loc = this.overlayLocate(segs);
    loc.map[loc.name] = { f: '' };
    this.persist();
  }

  // Write/append text to an overlay file (echo redirection).
  writeFile(arg, text, append) {
    const segs = this.absSegs(arg);
    if (this.isDirAbsolute(segs)) { this.printLine(`-bash: ${arg}: Is a directory`); return false; }
    if (this.isBaseFile(segs)) { this.printLine(`-bash: ${arg}: Permission denied`); return false; }
    const parent = segs.slice(0, -1);
    if (!this.isWritableDir(parent)) { this.printLine(`-bash: ${arg}: No such file or directory`); return false; }
    const loc = this.overlayLocate(segs);
    const prev = loc.node && typeof loc.node.f === 'string' ? loc.node.f : '';
    loc.map[loc.name] = { f: append && prev ? prev + '\n' + text : text };
    this.persist();
    return true;
  }

  rm(args) {
    const opts = args.filter((a) => a.startsWith('-'));
    const targets = args.filter((a) => !a.startsWith('-'));
    const recursive = opts.some((o) => /^--recursive$/.test(o) || (/^-[^-]*[rR]/.test(o)));
    if (!targets.length) { this.printLine('rm: missing operand'); return; }
    for (const t of targets) {
      const segs = this.absSegs(t);
      if (!segs.length) { this.printLine(`rm: refusing to remove '/': use the appropriate flags`); continue; }
      if (this.isBaseFile(segs) || (segs.length === 1 && this.baseDirNames().includes(segs[0]))) {
        this.printLine(`rm: cannot remove '${t}': Permission denied`);
        continue;
      }
      const n = this.overlayNode(segs);
      if (!n) { this.printLine(`rm: cannot remove '${t}': No such file or directory`); continue; }
      if (n.d && !recursive) { this.printLine(`rm: cannot remove '${t}': Is a directory`); continue; }
      const loc = this.overlayLocate(segs);
      delete loc.map[loc.name];
    }
    this.persist();
  }

  mvcp(args, copy) {
    const name = copy ? 'cp' : 'mv';
    const files = args.filter((a) => !a.startsWith('-'));
    if (files.length < 2) { this.printLine(`${name}: missing destination file operand`); return; }
    const srcArg = files[0];
    const dstArg = files[1];
    const src = this.absSegs(srcArg);
    const srcContent = this.readAny(src);
    if (srcContent === null) { this.printLine(`${name}: cannot stat '${srcArg}': No such file or directory`); return; }
    let dst = this.absSegs(dstArg);
    // If dest is an existing directory, move/copy into it under the src name.
    if (this.isDirAbsolute(dst)) dst = dst.concat(src[src.length - 1]);
    if (this.isBaseFile(dst)) { this.printLine(`${name}: cannot overwrite '${dstArg}': Permission denied`); return; }
    const parent = dst.slice(0, -1);
    if (!this.isWritableDir(parent)) { this.printLine(`${name}: cannot create '${dstArg}': No such file or directory`); return; }
    const dloc = this.overlayLocate(dst);
    dloc.map[dloc.name] = { f: srcContent };
    if (!copy) {
      // remove the source if it is an overlay file (bundled files aren't moved)
      const sn = this.overlayNode(src);
      if (sn && typeof sn.f === 'string') {
        const sloc = this.overlayLocate(src);
        delete sloc.map[sloc.name];
      }
    }
    this.persist();
  }
  // Read file contents from overlay or base (markdown/source/SECRETS as text).
  readAny(segs) {
    const o = this.overlayFileContents(segs);
    if (o !== null) return o;
    const key = segs.join('/');
    if (key === 'about.md') return this.bundle.aboutMd;
    if (this.bundle.postMarkdownByVirtualPath && this.bundle.postMarkdownByVirtualPath[key] != null) return this.bundle.postMarkdownByVirtualPath[key];
    if (key.startsWith('.games/') && (this.bundle.games || {})[key] != null) return (this.bundle.games || {})[key];
    if (SECRETS['/' + key]) return SECRETS['/' + key].join('\n');
    return null;
  }

  // Change directory with validation
  cd(target) {
    if (!target || target === '~') {
      this.cwd = [];
      if (this.onPathChange) this.onPathChange(this.cwdPath);
      return;
    }
    const expanded = this.expandHome(target);
    const parts = expanded.split('/').filter((p) => p && p.length);
    let newCwd;
    if (expanded.startsWith('/')) {
      newCwd = [];
    } else {
      newCwd = this.cwd.slice();
    }
    for (const p of parts) {
      if (p === '.') continue;
      if (p === '..') newCwd.pop();
      else newCwd.push(p);
    }
    // Guests cannot traverse into protected directories.
    if (this.isProtectedPath(newCwd) && !this.rooted) {
      this.printLine(`cd: ${target}: Permission denied`);
      return;
    }
    // Valid if it resolves to a directory in the merged filesystem (root, the
    // bundled/hidden dirs, or a user-created overlay directory).
    if (this.isDirAbsolute(newCwd)) {
      this.cwd = newCwd;
      if (this.onPathChange) this.onPathChange(this.cwdPath);
      this.persist();
      return;
    }
    if (this.isBaseFile(newCwd) || this.overlayFileContents(newCwd) !== null) {
      this.printLine(`cd: ${target}: Not a directory`);
      return;
    }
    this.printLine(`cd: ${target}: No such file or directory`);
  }

  // The merged entries of a directory (bundled base + user overlay), sorted by
  // name. Each is { name, kind: 'dir'|'file'|'exec', size }. Shared by ls and
  // the netrw-style directory view.
  collectDirEntries(segs) {
    const dirSize = 4096;
    const pathStr = '/' + segs.join('/');
    const entries = [];
    const add = (name, kind, size) => entries.push({ name, kind, size });

    if (pathStr === '/') {
      add('.bash_history', 'file', 420);
      add('.games', 'dir', dirSize);
      add('.secret', 'dir', dirSize);
      add('.ssh', 'dir', dirSize);
      add('blog', 'dir', dirSize);
      add('about.md', 'file', 300);
    } else if (pathStr === '/blog') {
      this.bundle.posts.forEach((p) => add(p.file, 'file', (this.getMarkdownForFile(p.file) || '').length || 300));
    } else if (pathStr === '/.games') {
      const games = this.bundle.games || {};
      Object.keys(games)
        .map((k) => k.replace(/^\.games\//, ''))
        .forEach((f) => add(f, 'exec', (games['.games/' + f] || '').length || 1024));
    } else if (pathStr === '/.ssh') {
      add('id_rsa.pub', 'file', 560);
      add('id_rsa.old.pub', 'file', 560);
    } else if (pathStr === '/.secret') {
      add('flag.enc', 'file', 260);
    }

    // Merge overlay children, skipping names already provided by the base layer.
    const node = this.overlayNode(segs);
    if (node && node.d) {
      for (const [name, child] of Object.entries(node.d)) {
        if (entries.some((e) => e.name === name)) continue;
        if (child && child.d) add(name, 'dir', dirSize);
        else add(name, 'file', typeof (child && child.f) === 'string' ? child.f.length : 0);
      }
    }
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  // `vim <dir>` / `nano <dir>` behave like real vim on a directory: drop into
  // the editor showing a netrw-style listing (fenced so it renders verbatim).
  openDirInEditor(segs, mode) {
    const path = '/' + segs.join('/');
    const entries = this.collectDirEntries(segs);
    const rows = ['../'].concat(entries.map((e) => e.name + (e.kind === 'dir' ? '/' : '')));
    const body = [
      '```text',
      '" ============================================================',
      '" Netrw Directory Listing',
      `"   ${path}`,
      '" ============================================================',
      ...rows,
      '```',
    ].join('\n');
    const name = path === '/' ? '/' : path.replace(/^\//, '') + '/';
    this.openView(null, mode, { name, source: body });
  }

  // List directory contents.
  // Supports: ls, ls <path>, ls -l, ls -la (order-insensitive).
  ls(...args) {
    // Parse clustered flags like -l, -a, -la, -lah. -h (human sizes) is accepted
    // but has no visible effect on our deterministic fake metadata.
    let long = false;
    let all = false;
    for (const a of args) {
      if (a.startsWith('-') && a.length > 1) {
        for (const ch of a.slice(1)) {
          if (ch === 'l') long = true;
          else if (ch === 'a') all = true;
        }
      }
    }

    const target = args.find((a) => !a.startsWith('-'));
    const segs = target ? this.absSegs(target) : this.cwd.slice();
    const pathStr = '/' + segs.join('/');

    // Protected directories are opaque to guests.
    if (this.isProtectedPath(segs) && !this.rooted) {
      this.printLine(`ls: cannot open directory '${target || pathStr}': Permission denied`);
      return;
    }

    // A path that resolves to a file (not a directory): real ls echoes the
    // name; a missing path is an error.
    if (!this.isDirAbsolute(segs)) {
      if (this.pathExists(segs)) this.printLine(target || pathStr);
      else this.printLine(`ls: cannot access '${target || pathStr}': No such file or directory`);
      return;
    }

    // deterministic fake metadata
    const owner = 'user';
    const group = 'user';
    const dirPerm = 'drwxr-xr-x';
    const filePerm = '-rw-r--r--';
    const execPerm = '-rwxr-xr-x';
    const dirSize = 4096;

    // Dotfiles are hidden without -a; entries come merged (base + overlay).
    const list = this.collectDirEntries(segs).filter((e) => all || !e.name.startsWith('.'));

    if (!long) {
      const names = list.map((e) => e.name + (e.kind === 'dir' ? '/' : ''));
      if (names.length) this.printLine(names.join(' '));
      return;
    }

    const outLong = (perm, links, size, name) => {
      // perms, two spaces, links, owner, group, size, name
      this.printLine(`${perm}  ${String(links).padStart(1, ' ')} ${owner} ${group} ${String(size).padStart(4, ' ')} ${name}`);
    };
    if (all) {
      outLong(dirPerm, 2, dirSize, '.');
      outLong(dirPerm, 2, dirSize, '..');
    }
    list.forEach((e) => {
      const perm = e.kind === 'dir' ? dirPerm : e.kind === 'exec' ? execPerm : filePerm;
      outLong(perm, e.kind === 'dir' ? 2 : 1, e.size, e.name);
    });
  }

  // Fetch markdown for a file, resolving it (relative to cwd, or absolute)
  // through the same virtual-path mapping the editor uses.
  getMarkdownForFile(file) {
    if (!file) return undefined;
    const vPath = this.getVirtualPath(file);
    if (vPath === 'about.md') return this.bundle.aboutMd;
    if (vPath.startsWith('.games/')) return (this.bundle.games || {})[vPath];
    return this.bundle.postMarkdownByVirtualPath[vPath];
  }

  // True if the argument names one of the (virtual) directories, so vim/nano
  // can report "Is a directory" instead of "No such file".
  isDirectoryPath(file) {
    if (!file) return false;
    let p = this.getVirtualPath(file).replace(/\/+$/, '');
    if (p === '' || p === 'blog' || p === '.games') return true;
    // A trailing slash on a non-file also reads as a directory attempt.
    return /\/$/.test(file) && !this.getMarkdownForFile(file);
  }

  // Render markdown to plain text for cat (no images)
  renderMarkdownForCat(md) {
    const lines = md.split(/\r?\n/);
    const output = [];
    const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    for (let line of lines) {
      const matches = [...line.matchAll(imgRe)];
      if (matches.length) {
        for (const m of matches) {
          const src = m[1].trim();
          const base = src.split('/').pop().split('?')[0].split('#')[0];
          line = line.replace(m[0], `[image: ${base}]`);
        }
      }
      output.push(line);
    }
    return output.join('\n');
  }

  cat(file) {
    if (!file) {
      this.printLine('cat: missing operand');
      return;
    }
    // Vault-protected content: the gate is cryptographic, not a flag. Guests are
    // refused; root decrypts on the fly with the validated key. A forced
    // `rooted` without a real key yields null here and is refused all the same.
    // Resolved path, so no relative / '..' / ~-spelling slips past.
    const secretKey = this.catPath(file);
    if (vaultHas(secretKey)) {
      if (!this.rooted || !this.rootKey) {
        this.printLine(`cat: ${file}: Permission denied`);
        return;
      }
      return vaultRead(this.rootKey, secretKey).then((txt) => {
        if (txt == null) this.printLine(`cat: ${file}: Permission denied`);
        else txt.split('\n').forEach((line) => this.printLine(line));
      });
    }
    // Easter-egg "files" (/etc/passwd, ~/.ssh keys, the buried puzzle, &c.),
    // resolved to a canonical path so relative / ~ spellings all work.
    if (SECRETS[secretKey]) {
      SECRETS[secretKey].forEach((line) => this.printLine(line));
      return;
    }
    // User-created overlay files print verbatim (plain text, not markdown).
    const segs = this.absSegs(file);
    const ov = this.overlayFileContents(segs);
    if (ov !== null) {
      (ov === '' ? [] : ov.split('\n')).forEach((line) => this.printLine(line));
      return;
    }
    if (this.isDirAbsolute(segs)) {
      this.printLine(`cat: ${file}: Is a directory`);
      return;
    }
    const md = this.getMarkdownForFile(file);
    if (!md) {
      this.printLine(`cat: ${file}: No such file or directory`);
      return;
    }
    const text = this.renderMarkdownForCat(md);
    text.split(/\r?\n/).forEach((line) => this.printLine(line));
  }

  // Determine virtual path for view mode
  // Resolve a file argument (relative to cwd, absolute, or ~-rooted, with any
  // '.' / '..' / nested segments) to a canonical virtual path key such as
  // 'blog/welcome.md', 'about.md' or '.games/snake.js'.
  getVirtualPath(file) {
    return this.catPath(file).replace(/^\//, '');
  }

  openEditor(file, mode) {
    if (!this.openView) return;
    // Bare `vim` / `nano` opens an empty buffer, like the real editors.
    if (!file) {
      this.openView(null, mode);
      return;
    }
    const segs = this.absSegs(file);
    // Protected paths are denied to guests through the editor too.
    if (this.isProtectedPath(segs) && !this.rooted) {
      this.printLine(`${mode}: ${file}: Permission denied`);
      return;
    }
    // Vault-protected files decrypt for root (guests already refused above).
    const vKey = this.catPath(file);
    if (vaultHas(vKey)) {
      vaultRead(this.rootKey, vKey).then((txt) => {
        if (txt == null) this.printLine(`${mode}: ${file}: Permission denied`);
        else this.openView(null, mode, { name: vKey, source: '```text\n' + txt + '\n```' });
      });
      return;
    }
    // A directory drops into the editor with a netrw-style listing, like vim.
    if (this.isDirAbsolute(segs)) {
      this.openDirInEditor(segs, mode);
      return;
    }
    // Bundled content (articles, about, game source) renders richly.
    if (this.getMarkdownForFile(file)) {
      this.openView(this.getVirtualPath(file), mode);
      return;
    }
    // Simulated system "files" (e.g. the .ssh keys, or /etc/shadow once root)
    // open read-only, shown verbatim.
    const secretKey = this.catPath(file);
    if (SECRETS[secretKey]) {
      this.openView(null, mode, { name: secretKey, source: '```text\n' + SECRETS[secretKey].join('\n') + '\n```' });
      return;
    }
    // A user-created overlay file opens read-only, shown verbatim.
    const ov = this.overlayFileContents(segs);
    if (ov !== null) {
      this.openView(null, mode, { name: '/' + segs.join('/'), source: '```text\n' + ov + '\n```' });
      return;
    }
    this.printLine(`${mode}: ${file}: No such file or directory`);
  }

  vim(file) {
    this.openEditor(file, 'vim');
  }

  nano(file) {
    this.openEditor(file, 'nano');
  }

  // Handle unknown command
  unknown(cmd) {
    this.printLine(`${cmd}: command not found`);
  }

  handleCommandLine(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    switch (cmd) {
      case 'help':
        this.printLine('Commands: ls, cd, cat, vim, nano, clear, help');
        break;
      case 'ls':
        this.ls(...args);
        break;
      case 'cd':
        this.cd(args[0]);
        break;
      case 'cat':
        this.cat(args[0]);
        break;
      case 'vim':
        this.vim(args[0]);
        break;
      case 'nano':
        this.nano(args[0]);
        break;
      case 'clear':
        this.clear();
        break;
      default:
        this.unknown(cmd);
    }
  }
}