// Terminal shell logic for the terminal blog.
// This module exports a Terminal class that manages command parsing,
// virtual filesystem navigation and printing to the terminal output.

import { sanitizeHtml } from './sanitize.js';

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
      scrollback: 1000,
      convertEol: true
    });
    this.term.open(this.containerEl);
    // Focus the terminal on init so that user can start typing immediately
    if (typeof this.term.focus === 'function') {
      this.term.focus();
    }
    // Print welcome / initial prompt
    this.printPrompt();
    // Handle input
    this.term.onData((data) => this.handleData(data));
  }

  // Print the current prompt
  printPrompt() {
    const path = '/' + this.cwd.join('/');
    this.term.write(`\r\n${path}> `);
  }

  // Print a line to the terminal
  printLine(text) {
    this.term.write(`\r\n${text}`);
  }

  // Handle input from xterm
  handleData(data) {
    switch (data) {
      case '\u0003': // Ctrl+C
        this.commandBuffer = '';
        this.term.write('^C');
        this.printPrompt();
        break;
      case '\r': // Enter
        this.term.write('\r\n');
        const cmd = this.commandBuffer.trim();
        if (cmd.length) {
          this.history.unshift(cmd);
          this.historyIndex = -1;
          this.executeCommand(cmd);
        }
        this.commandBuffer = '';
        this.printPrompt();
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
          this.term.write(histCmd);
        }
        break;
      case '\u001b[B': // Down arrow
        if (this.history.length > 0) {
          if (this.historyIndex > 0) {
            this.historyIndex--;
            const histCmd = this.history[this.historyIndex];
            this.clearLine();
            this.commandBuffer = histCmd;
            this.term.write(histCmd);
          } else if (this.historyIndex === 0) {
            this.historyIndex = -1;
            this.clearLine();
            this.commandBuffer = '';
          }
        }
        break;
      default:
        // Normal character; append to buffer and echo
        this.commandBuffer += data;
        this.term.write(data);
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

  // Execute a full command string
  executeCommand(cmd) {
    const [command, ...args] = cmd.split(/\s+/);
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
    // Validate path: allowed only root and blog
    if (newCwd.length === 0) {
      // OK
    } else if (newCwd.length === 1 && newCwd[0] === 'blog') {
      // OK
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
    const opts = new Set(args.filter((a) => a.startsWith('-')));
    const long = opts.has('-l') || opts.has('-la') || opts.has('-al');
    const all = opts.has('-a') || opts.has('-la') || opts.has('-al');

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
        outSimple('blog', true);
        outSimple('about.md', false);
        // join names once for simple listing
        this.printLine(names.join(' '));
        return;
      }
      if (all) {
        outLong(dirPerm, 2, owner, group, dirSize, '.');
        outLong(dirPerm, 4, owner, group, dirSize, '..');
      }
      outLong(dirPerm, 2, owner, group, dirSize, 'blog');
      outLong(filePerm, 1, owner, group, 300, 'about.md');
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
    if (file && file.startsWith('/')) {
      const trimmed = file.replace(/^\//, '');
      if (trimmed === 'about.md') return this.bundle.aboutMd;
      const vPath = trimmed.replace(/^blog\//, 'blog/');
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