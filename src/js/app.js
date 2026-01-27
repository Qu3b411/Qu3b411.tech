// Entry point for the terminal blog UI.

import { Terminal } from './terminal.js';
import { Router } from './router.js';
import { populatePostsDropdown } from './blog.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Fetch the content bundle
  const bundleRes = await fetch('assets/data/content.bundle.json');
  const bundle = await bundleRes.json();

  // Get DOM elements
  const terminalEl = document.getElementById('terminal');
  const termContainer = document.getElementById('term-container');
  const aboutBtn = document.getElementById('aboutBtn');
  const postsDropdown = document.getElementById('postsDropdown');
  // Editor surfaces inside the terminal panel
  const editorSurface = document.getElementById('editor-surface');
  const vimSurface = document.getElementById('vimSurface');
  const vimContent = document.getElementById('vimContent');
  const nanoSurface = document.getElementById('nanoSurface');
  const nanoContent = document.getElementById('nanoContent');

  // State variables
  // Track overlay sessions so we can restore hash *and* cwd without terminal chatter.
  let currentView = null; // { type: 'vim'|'nano', prevHash: string, prevCwd: string }
  // 0 = not in exit sequence, 1 = saw ':' and waiting for 'q'
  let vimExitStage = 0;

  // Instantiate Terminal using xterm.js
  const terminal = new Terminal({
    containerEl: termContainer,
    bundle,
    openViewCallback: (virtualPath, type) => {
      // open view triggered by terminal command; update hash and store previous
      currentView = { type, prevHash: window.location.hash || '#root', prevCwd: terminal.cwdPath };
      if (type === 'vim') vimExitStage = 0;
      window.location.hash = `#${type}/${virtualPath}`;
    },
    onPathChange: (path) => {
      // nothing else for now
    },
  });

  // Populate posts dropdown
  populatePostsDropdown(postsDropdown, bundle.posts);

  // About button click
  aboutBtn.addEventListener('click', () => {
    currentView = null;
    window.location.hash = '#about';
  });

  // Posts dropdown change
  postsDropdown.addEventListener('change', () => {
    const id = postsDropdown.value;
    if (!id) return;
    const post = bundle.posts.find((p) => p.id === id);
    if (!post) return;
    currentView = { type: 'vim', prevHash: window.location.hash || '#root', prevCwd: terminal.cwdPath };
    vimExitStage = 0;
    window.location.hash = `#vim/blog/${post.file}`;
  });

  // Handle keydown events for exiting vim/nano view modes
  // Capture-phase handler so xterm can't swallow the key events before we see them.
  document.addEventListener('keydown', (e) => {
    // VIM exits via :q (realistic) and should not print chatter.
    if (!vimSurface.hidden) {
      // Minimal state machine for :q
      if (e.key === ':' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        vimExitStage = 1;
        return;
      }
      if (vimExitStage === 1 && (e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        // close editor
        if (currentView) {
          window.location.hash = currentView.prevHash;
          // restore cwd exactly (router won't reset on #root/#blog)
          terminal.cd(currentView.prevCwd);
        } else {
          window.location.hash = '#root';
        }
        currentView = null;
        vimExitStage = 0;
        // show clean prompt only
        //terminal.printPrompt();
        return;
      }
      // swallow everything else while vim is open
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // NANO exits via Ctrl+X
    if (!nanoSurface.hidden) {
      // Exit ONLY on Ctrl+X
      if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        e.stopPropagation();
        if (currentView) {
          window.location.hash = currentView.prevHash;
          terminal.cd(currentView.prevCwd);
        } else {
          window.location.hash = '#root';
        }
        currentView = null;
        //terminal.printPrompt();
        return;
      }
      // While nano is open, swallow all keystrokes so xterm can't receive them.
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Focus xterm input when clicking on terminal panel
  terminalEl.addEventListener('click', () => {
    // Do NOT steal focus from editor modes
    if (!editorSurface.hidden) return;
    // xterm exposes focus() to focus the underlying textarea
    if (terminal.term && typeof terminal.term.focus === 'function') {
      terminal.term.focus();
    }
  });

  // Instantiate Router
  const router = new Router({
    terminal,
    terminalEl,
    termContainer,
    editorSurface,
    vimSurface,
    vimContent,
    nanoSurface,
    nanoContent,
  });
  router.init();
});
