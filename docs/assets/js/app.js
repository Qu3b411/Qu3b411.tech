// Entry point for the terminal blog UI.
//
// Routing model (static-first progressive enhancement):
//  - Every content page is a real file (/, /blog/<slug>/, /about/, /blog/) whose
//    static HTML contains a readable fallback. When this script runs it reveals
//    the terminal and opens the requested view at the SAME canonical URL.
//  - Canonical pathname navigation is used for published-article transitions via
//    the History API; ordinary shell commands do not touch the URL.
//  - Legacy #hash deep links still work and are normalized to canonical paths.

import { Terminal } from './terminal.js';
import { Router } from './router.js';
import { populatePostsDropdown } from './blog.js';

// app.js is served at <site-root>/assets/js/app.js, so '../../' from its own URL
// is the site root — correct regardless of page depth or deploy sub-path.
const ROOT = new URL('../../', import.meta.url);
const BASE_PATH = ROOT.pathname; // '/' or e.g. '/Qu3b411.tech/'

document.addEventListener('DOMContentLoaded', async () => {
  const bundle = await fetch(new URL('assets/data/content.bundle.json', ROOT)).then((r) => r.json());

  // Reveal the terminal shell (content pages hide it by default so the no-JS
  // fallback is what non-JS clients see). Done before Terminal init so xterm can
  // measure its container.
  document.body.classList.add('term-ready');

  // DOM elements
  const terminalEl = document.getElementById('terminal');
  const termContainer = document.getElementById('term-container');
  const aboutBtn = document.getElementById('aboutBtn');
  const postsDropdown = document.getElementById('postsDropdown');
  const editorSurface = document.getElementById('editor-surface');
  const vimSurface = document.getElementById('vimSurface');
  const vimContent = document.getElementById('vimContent');
  const nanoSurface = document.getElementById('nanoSurface');
  const nanoContent = document.getElementById('nanoContent');

  // Lookup maps (posts carry a build-assigned slug).
  const postBySlug = {};
  const postByPath = {};
  bundle.posts.forEach((p) => {
    postBySlug[p.slug] = p;
    postByPath[p.path] = p;
  });

  // Editor state (shared by the vim/nano views).
  const editor = {
    mode: null, // 'vim' | 'nano'
    path: null, // virtual path, or null for an empty [No Name] buffer
    filename: '',
    source: '',
    cmdActive: false, // vim command-line mode
    cmdBuf: '',
    lastG: 0,
    lastZ: 0,
  };

  const terminal = new Terminal({
    containerEl: termContainer,
    bundle,
    openViewCallback,
    onPathChange,
  });

  const router = new Router({
    terminal, terminalEl, termContainer,
    editorSurface, vimSurface, vimContent, nanoSurface, nanoContent,
    assetBase: ROOT.href,
  });

  populatePostsDropdown(postsDropdown, bundle.posts);

  // ---- View model -----------------------------------------------------------
  // A view is { kind: 'home'|'blog'|'about'|'article', post? }.

  function pathForView(view) {
    if (view.kind === 'article') return `${BASE_PATH}blog/${view.post.slug}/`;
    if (view.kind === 'about') return `${BASE_PATH}about/`;
    if (view.kind === 'blog') return `${BASE_PATH}blog/`;
    return BASE_PATH; // home
  }

  // Render a view without touching history (boot / popstate).
  function showView(view) {
    if (view.kind === 'article' || view.kind === 'about') {
      const vp = view.kind === 'about' ? 'about.md' : view.post.path;
      const md = router.getMarkdownForVirtualPath(vp);
      if (md != null) {
        if (view.kind === 'about') terminal.cd('/');
        // Honor the requested editor (vim/nano); default to vim for SEO and
        // direct URL landings, which carry no explicit editor choice.
        enterEditor(view.editor || 'vim', vp);
        return;
      }
    }
    if (view.kind === 'blog') {
      router.hideEditors();
      terminal.cd('/blog');
      return;
    }
    router.hideEditors(); // home
  }

  // Navigate to a view and push its canonical URL (in-app actions).
  function navigate(view) {
    const target = pathForView(view);
    if (location.pathname + location.hash !== target) {
      history.pushState({}, '', target);
    }
    showView(view);
    removePrerender();
  }

  // Map a legacy #hash route to a view, or null.
  function viewFromHash(hash) {
    const h = (hash || '').replace(/^#/, '');
    if (!h) return null;
    const [route, ...rest] = h.split('/');
    const vp = rest.join('/');
    if ((route === 'vim' || route === 'nano') && vp) {
      if (postByPath[vp]) return { kind: 'article', post: postByPath[vp], editor: route };
      if (vp === 'about.md') return { kind: 'about', editor: route };
    }
    if (route === 'about') return { kind: 'about' };
    if (route === 'blog') return { kind: 'blog' };
    return null;
  }

  // Derive a view from the current location (pathname first, then legacy hash).
  function viewFromLocation() {
    let rel = location.pathname;
    if (rel.startsWith(BASE_PATH)) rel = rel.slice(BASE_PATH.length);
    rel = rel.replace(/^\/+/, '').replace(/index\.html$/, '');
    const m = rel.match(/^blog\/([^/]+)\/?$/);
    if (m && postBySlug[m[1]]) return { kind: 'article', post: postBySlug[m[1]] };
    if (/^blog\/?$/.test(rel)) return { kind: 'blog' };
    if (/^about\/?$/.test(rel)) return { kind: 'about' };
    return viewFromHash(location.hash) || { kind: 'home' };
  }

  // Prefer the generated page's explicit signal for a deterministic boot.
  function initialView() {
    const dv = document.body.dataset.view;
    const dp = document.body.dataset.path;
    if (dv === 'vim' && dp && postByPath[dp]) return { kind: 'article', post: postByPath[dp] };
    if (dv === 'about') return { kind: 'about' };
    if (dv === 'blog') return { kind: 'blog' };
    return viewFromLocation();
  }

  function removePrerender() {
    // The Vim view preserves the full article text + semantic structure in the
    // DOM, so the static fallback can be safely removed to leave one copy.
    const pre = document.getElementById('prerender');
    if (pre) pre.remove();
  }

  // ---- Boot -----------------------------------------------------------------
  const first = initialView();
  showView(first);
  removePrerender();
  // Normalize legacy hash / index.html URLs to the canonical path.
  const canonical = pathForView(first);
  if (location.hash || location.pathname !== canonical) {
    history.replaceState({}, '', canonical);
  }

  // ---- Callbacks ------------------------------------------------------------

  // Terminal `vim`/`nano [file]` commands. A null path is a bare `vim`/`nano`:
  // an empty [No Name] buffer.
  function openViewCallback(virtualPath, type) {
    if (virtualPath === null || virtualPath === undefined) return enterEditor(type, null);
    if (postByPath[virtualPath]) return navigate({ kind: 'article', post: postByPath[virtualPath], editor: type });
    if (virtualPath === 'about.md') return navigate({ kind: 'about', editor: type });
    // Any other file (e.g. a .games source): open the editor without a URL change.
    const md = router.getMarkdownForVirtualPath(virtualPath);
    if (md != null) enterEditor(type, virtualPath);
  }

  // Open a resolved file (or empty buffer) in the editor and record its state.
  function enterEditor(mode, vp) {
    const source = vp ? router.getMarkdownForVirtualPath(vp) || '' : '';
    editor.mode = mode;
    editor.path = vp || null;
    editor.filename = vp ? vp.split('/').pop() : '';
    editor.source = source;
    editor.cmdActive = false;
    editor.cmdBuf = '';
    router.showEditor(mode, source, editor.filename);
  }

  function onPathChange() {
    /* reserved */
  }

  aboutBtn.addEventListener('click', () => navigate({ kind: 'about' }));

  postsDropdown.addEventListener('change', () => {
    const id = postsDropdown.value;
    const post = bundle.posts.find((p) => p.id === id);
    if (post) navigate({ kind: 'article', post });
  });

  // Back/Forward and legacy hash navigation.
  window.addEventListener('popstate', () => {
    showView(viewFromLocation());
    removePrerender();
  });
  window.addEventListener('hashchange', () => {
    // A legacy #hash deep link takes priority, then normalizes to canonical.
    const v = viewFromHash(location.hash) || viewFromLocation();
    history.replaceState({}, '', pathForView(v));
    showView(v);
    removePrerender();
  });

  // Keep the vim status position in sync while scrolling the buffer.
  vimContent.addEventListener('scroll', () => router.updateVimPos());

  // Editor key handling (capture phase so xterm can't swallow the keys first).
  document.addEventListener(
    'keydown',
    (e) => {
      if (!vimSurface.hidden) return handleVimKey(e);
      if (!nanoSurface.hidden) return handleNanoKey(e);
    },
    true
  );

  const vimCmdlineEl = document.getElementById('vimCmdline');
  const nanoMsgEl = document.getElementById('nanoMsg');
  const scrollBy = (el, dy) => el.scrollBy({ top: dy });

  function handleVimKey(e) {
    const el = vimContent;
    // --- Command-line mode (after ':') ---
    if (editor.cmdActive) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') return runVimCommand(editor.cmdBuf);
      if (e.key === 'Escape') return endVimCommand();
      if (e.key === 'Backspace') {
        if (!editor.cmdBuf) return endVimCommand();
        editor.cmdBuf = editor.cmdBuf.slice(0, -1);
        vimCmdlineEl.textContent = ':' + editor.cmdBuf;
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        editor.cmdBuf += e.key;
        vimCmdlineEl.textContent = ':' + editor.cmdBuf;
      }
      return;
    }
    // --- Normal mode ---
    if (e.key === ':' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      editor.cmdActive = true;
      editor.cmdBuf = '';
      vimCmdlineEl.classList.add('vim-cmd-active');
      vimCmdlineEl.textContent = ':';
      return;
    }
    const half = el.clientHeight / 2;
    const page = el.clientHeight * 0.9;
    const step = 48;
    if (e.key === 'g' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (editor.lastG && Date.now() - editor.lastG < 600) { el.scrollTo({ top: 0 }); editor.lastG = 0; }
      else editor.lastG = Date.now();
      return;
    }
    if (e.key === 'Z') {
      e.preventDefault();
      if (editor.lastZ && Date.now() - editor.lastZ < 600) { exitEditor(); editor.lastZ = 0; }
      else editor.lastZ = Date.now();
      return;
    }
    if (e.ctrlKey && (e.key === 'd' || e.key === 'f')) { e.preventDefault(); scrollBy(el, e.key === 'd' ? half : page); return; }
    if (e.ctrlKey && (e.key === 'u' || e.key === 'b')) { e.preventDefault(); scrollBy(el, -(e.key === 'u' ? half : page)); return; }
    const nav = {
      j: step, ArrowDown: step, k: -step, ArrowUp: -step,
      ' ': page, PageDown: page, PageUp: -page,
    };
    if (e.key === 'G') { e.preventDefault(); el.scrollTo({ top: el.scrollHeight }); return; }
    if (Object.prototype.hasOwnProperty.call(nav, e.key)) { e.preventDefault(); scrollBy(el, nav[e.key]); return; }
    if (e.key === 'Home') { e.preventDefault(); el.scrollTo({ top: 0 }); return; }
    if (e.key === 'End') { e.preventDefault(); el.scrollTo({ top: el.scrollHeight }); return; }
    // Read-only buffer: swallow other printable keys (no accidental typing).
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) e.preventDefault();
  }

  function endVimCommand() {
    editor.cmdActive = false;
    editor.cmdBuf = '';
    vimCmdlineEl.classList.remove('vim-cmd-active');
    vimCmdlineEl.textContent = editor.filename ? `"${editor.filename}" [readonly]` : '';
  }

  function runVimCommand(raw) {
    const s = raw.trim();
    editor.cmdActive = false;
    editor.cmdBuf = '';
    vimCmdlineEl.classList.remove('vim-cmd-active');
    const [word, ...rest] = s.split(/\s+/);
    const arg = rest.join(' ');
    if (['q', 'q!', 'quit', 'quit!', 'qa', 'qa!', 'quitall'].includes(word)) return exitEditor();
    if (['wq', 'wq!', 'x', 'x!', 'xit', 'exit'].includes(word)) return exitEditor(); // read-only: just leave
    if (word === 'w' || word === 'write') { vimCmdlineEl.textContent = "E45: 'readonly' option is set (add ! to override)"; return; }
    if (word === 'w!' || word === 'write!') { vimCmdlineEl.textContent = `"${editor.filename || '[No Name]'}" written`; return; }
    if (word === 'e' || word === 'e!' || word === 'edit' || word === 'edit!') {
      if (!arg) { vimCmdlineEl.textContent = 'E32: No file name'; return; }
      return openFileFromEditor(arg, 'vim');
    }
    if (word === 'help' || word === 'h') { vimCmdlineEl.textContent = 'help: j/k scroll · gg/G top/bottom · :q to exit · qu3b411.tech'; return; }
    if (!word) return;
    vimCmdlineEl.textContent = `E492: Not an editor command: ${s}`;
  }

  // `:e <file>` / editor file open — resolve via the shell (honours cwd).
  function openFileFromEditor(name, mode) {
    const target = mode === 'vim' ? vimCmdlineEl : nanoMsgEl;
    if (terminal.isDirectoryPath(name)) { target.textContent = `"${name}" is a directory`; return; }
    const src = terminal.getMarkdownForFile(name);
    if (src == null) { target.textContent = `E484: Can't open file ${name}`; return; }
    const vp = terminal.getVirtualPath(name);
    if (postByPath[vp]) return navigate({ kind: 'article', post: postByPath[vp], editor: mode });
    if (vp === 'about.md') return navigate({ kind: 'about', editor: mode });
    enterEditor(mode, vp);
  }

  function handleNanoKey(e) {
    const el = nanoContent;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); e.stopPropagation(); return exitEditor(); }
    if (ctrl && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault(); e.stopPropagation();
      const max = el.scrollHeight - el.clientHeight;
      const pct = max <= 1 ? 100 : Math.round((el.scrollTop / max) * 100);
      const lines = editor.source ? editor.source.split(/\r?\n/).length : 0;
      nanoMsgEl.textContent = `[ buffer: ${lines} lines · ${pct}% ]`;
      return;
    }
    if (ctrl && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault(); e.stopPropagation();
      nanoMsgEl.textContent = '[ ^X Exit · ^C Location · arrows/space scroll · read-only preview ]';
      return;
    }
    if (ctrl && 'owktr\\'.includes((e.key || '').toLowerCase())) {
      e.preventDefault(); e.stopPropagation();
      nanoMsgEl.textContent = '[ read-only buffer: writing/cut/replace disabled ]';
      return;
    }
    const half = el.clientHeight / 2;
    const page = el.clientHeight * 0.9;
    const step = 48;
    const nav = { ArrowDown: step, ArrowUp: -step, ' ': page, PageDown: page, PageUp: -page };
    if (Object.prototype.hasOwnProperty.call(nav, e.key)) { e.preventDefault(); e.stopPropagation(); scrollBy(el, nav[e.key]); return; }
    if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); el.scrollTo({ top: 0 }); return; }
    if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); el.scrollTo({ top: el.scrollHeight }); return; }
    if (!ctrl && !e.altKey && e.key.length === 1) {
      e.preventDefault(); e.stopPropagation();
      nanoMsgEl.textContent = '[ This is a read-only preview buffer ]';
    }
  }

  function exitEditor() {
    editor.cmdActive = false;
    editor.mode = null;
    navigate({ kind: 'home' });
  }

  // Focus the terminal when clicking the panel (but never steal editor focus).
  terminalEl.addEventListener('click', () => {
    if (!editorSurface.hidden) return;
    if (terminal.term && typeof terminal.term.focus === 'function') terminal.term.focus();
  });
});
