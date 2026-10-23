// Terminal shell logic for the terminal blog.
// This module exports a Terminal class that manages command parsing,
// virtual filesystem navigation and printing to the terminal output.

import { GAMES } from './games/index.js';

function stripTerminalControls(value) {
  return String(value)
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '');
}

function isPrintableInput(data) {
  return !/[\x00-\x1F\x7F\x1B]/.test(data);
}

// Terminal shell using xterm.js for interactive display.
// This class implements a Unix-like shell with support for ls, cd, cat, vim, nano, clear and help.
export class Terminal {
  constructor({ containerEl, bundle, openViewCallback, onPathChange }) {
    this.containerEl = containerEl;
    this.bundle = bundle;
    this.openView = openViewCallback;
    this.onPathChange = onPathChange;
    // Current working directory segments
    this.cwd = [];
    // Command buffer and history
    this.commandBuffer = '';
    this.history = [];
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
    // Focus the terminal on init so that user can start typing immediately
    if (typeof this.term.focus === 'function') {
      this.term.focus();
    }
    // Print welcome / initial prompt
    this.printPrompt();
    // Handle input
    this.term.onData((data) => this.handleData(data));
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

  // Print the current prompt
  printPrompt() {
    const path = '/' + this.cwd.join('/');
    this.term.write(`\r\n${path}> `);
  }

  // Print a line to the terminal
  printLine(text) {
    this.term.write(`\r\n${stripTerminalControls(text)}`);
  }

  // Handle input from xterm
  handleData(data) {
    // While a game is running it owns all keyboard input.
    if (this.game) {
      this.game.input(data);
      return;
    }
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
        if (cmd.length) {
          this.history.unshift(cmd);
          this.historyIndex = -1;
          this.executeCommand(cmd);
        }
        this.commandBuffer = '';
        // A launched game takes over the screen; don't draw a prompt over it.
        if (!this.game) this.printPrompt();
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
    // Move cursor to start of line: send CR and rewrite prompt
    const path = '/' + this.cwd.join('/');
    // Clear line using VT sequences: CR then clear line right
    this.term.write(`\r${path}> \x1b[K`);
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
      this.term.write(`\r\n${this.cwdPath}> ${this.commandBuffer}`);
    }
  }

  // Execute a full command string
  executeCommand(cmd) {
    const [command, ...args] = cmd.split(/\s+/);
    // Executable paths (files with the rx bit): ./snake.js in /.games, or an
    // absolute /.games/snake.js. Bare names are not executable (need ./).
    if (command.startsWith('./') || command.startsWith('/')) {
      this.execFile(command);
      return;
    }
    switch (command) {
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
      case '':
        break;
      default:
        this.printLine(`${command}: command not found`);
        break;
    }
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

  // Launch a game by filename; it owns input until the player quits.
  launchGame(name) {
    const runner = GAMES[name];
    if (!runner) return;
    this.game = runner(this.term, {
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

  // Change directory with validation
  cd(target) {
    if (!target || target === '~') {
      this.cwd = [];
      if (this.onPathChange) this.onPathChange(this.cwdPath);
      return;
    }
    const parts = target.split('/').filter((p) => p && p.length);
    let newCwd;
    if (target.startsWith('/')) {
      newCwd = [];
    } else {
      newCwd = this.cwd.slice();
    }
    for (const p of parts) {
      if (p === '.') continue;
      if (p === '..') newCwd.pop();
      else newCwd.push(p);
    }
    // Validate path: root, blog, or the hidden .games directory
    if (newCwd.length === 0) {
      // OK
    } else if (newCwd.length === 1 && (newCwd[0] === 'blog' || newCwd[0] === '.games')) {
      // OK ('.games' is navigable but hidden from a plain ls)
    } else {
      this.printLine(`cd: ${target}: No such file or directory`);
      return;
    }
    this.cwd = newCwd;
    if (this.onPathChange) this.onPathChange(this.cwdPath);
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

    // resolve path
    let path = this.cwd.slice();
    if (target) {
      const parts = target.split('/').filter(Boolean);
      if (target.startsWith('/')) path = [];
      for (const p of parts) {
        if (p === '.') continue;
        if (p === '..') path.pop();
        else path.push(p);
      }
    }
    const pathStr = '/' + path.join('/');

    // Collect plain names for simple listing. When printing, join with spaces.
    const names = [];
    const outSimple = (name, isDir = false) => {
      const suffix = isDir ? '/' : '';
      names.push(`${name}${suffix}`);
    };

    const outLong = (perm, links, owner, group, size, name) => {
      // Match common `ls -la` spacing: perms, two spaces, links, owner, group, size, name
      const line = `${perm}  ${String(links).padStart(1, ' ')} ${owner} ${group} ${String(size).padStart(4, ' ')} ${name}`;
      this.printLine(line);
    };

    // deterministic fake metadata
    const owner = 'user';
    const group = 'user';
    const dirPerm = 'drwxr-xr-x';
    const filePerm = '-rw-r--r--';
    const dirSize = 4096;

    const listRoot = () => {
      if (!long) {
        // '.games' is a hidden directory: only revealed with -a.
        if (all) outSimple('.games', true);
        outSimple('blog', true);
        outSimple('about.md', false);
        // join names once for simple listing
        this.printLine(names.join(' '));
        return;
      }
      if (all) {
        outLong(dirPerm, 2, owner, group, dirSize, '.');
        outLong(dirPerm, 4, owner, group, dirSize, '..');
        outLong(dirPerm, 2, owner, group, dirSize, '.games');
      }
      outLong(dirPerm, 2, owner, group, dirSize, 'blog');
      outLong(filePerm, 1, owner, group, 300, 'about.md');
    };

    const listGames = () => {
      const execPerm = '-rwxr-xr-x';
      const games = this.bundle.games || {};
      const files = Object.keys(games).map((k) => k.replace(/^\.games\//, '')).sort();
      if (!long) {
        files.forEach((f) => outSimple(f, false));
        this.printLine(names.join(' '));
        return;
      }
      if (all) {
        outLong(dirPerm, 2, owner, group, dirSize, '.');
        outLong(dirPerm, 2, owner, group, dirSize, '..');
      }
      files.forEach((f) => outLong(execPerm, 1, owner, group, (games['.games/' + f] || '').length || 1024, f));
    };

    const listBlog = () => {
      const posts = [...this.bundle.posts].sort((a, b) => (a.date < b.date ? 1 : -1));
      if (!long) {
        posts.forEach((p) => outSimple(p.file, false));
        // join names into a single line
        this.printLine(names.join(' '));
        return;
      }
      if (all) {
        outLong(dirPerm, 2, owner, group, dirSize, '.');
        outLong(dirPerm, 4, owner, group, dirSize, '..');
      }
      posts.forEach((p) => {
        const md = this.getMarkdownForFile(p.file) || '';
        const size = md.length || 300;
        outLong(filePerm, 1, owner, group, size, p.file);
      });
    };

    if (pathStr === '/') {
      listRoot();
      return;
    }
    if (pathStr === '/blog') {
      listBlog();
      return;
    }
    if (pathStr === '/.games') {
      listGames();
      return;
    }
    this.printLine(`ls: cannot access '${target || pathStr}': No such file or directory`);
  }

  // Fetch markdown for file
  getMarkdownForFile(file) {
    // root about
    if (this.cwdPath === '/' && file === 'about.md') {
      return this.bundle.aboutMd;
    }
    if (this.cwdPath === '/blog') {
      const vPath = 'blog/' + file;
      return this.bundle.postMarkdownByVirtualPath[vPath];
    }
    if (this.cwdPath === '/.games') {
      return (this.bundle.games || {})['.games/' + file];
    }
    if (file && file.startsWith('/')) {
      const trimmed = file.replace(/^\//, '');
      if (trimmed === 'about.md') return this.bundle.aboutMd;
      if (trimmed.startsWith('.games/')) return (this.bundle.games || {})[trimmed];
      const vPath = trimmed;
      return this.bundle.postMarkdownByVirtualPath[vPath];
    }
    return undefined;
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
    const md = this.getMarkdownForFile(file);
    if (!md) {
      this.printLine(`cat: ${file}: No such file or directory`);
      return;
    }
    const text = this.renderMarkdownForCat(md);
    text.split(/\r?\n/).forEach((line) => this.printLine(line));
  }

  // Determine virtual path for view mode
  getVirtualPath(file) {
    if (file.startsWith('/')) {
      return file.replace(/^\//, '');
    }
    if (this.cwdPath === '/') {
      return file;
    }
    if (this.cwdPath === '/blog') {
      return 'blog/' + file;
    }
    if (this.cwdPath === '/.games') {
      return '.games/' + file;
    }
    return file;
  }

  vim(file) {
    if (!file) {
      this.printLine('vim: missing operand');
      return;
    }
    const md = this.getMarkdownForFile(file);
    if (!md) {
      this.printLine(`vim: ${file}: No such file or directory`);
      return;
    }
    if (this.openView) {
      const vPath = this.getVirtualPath(file);
      this.openView(vPath, 'vim');
    }
  }

  nano(file) {
    if (!file) {
      this.printLine('nano: missing operand');
      return;
    }
    const md = this.getMarkdownForFile(file);
    if (!md) {
      this.printLine(`nano: ${file}: No such file or directory`);
      return;
    }
    if (this.openView) {
      const vPath = this.getVirtualPath(file);
      this.openView(vPath, 'nano');
    }
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