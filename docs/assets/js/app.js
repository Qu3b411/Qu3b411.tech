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
    cmdActive: false, // vim command-line mode (':')
    searchActive: false, // vim search-input mode ('/')
    cmdBuf: '',
    lastG: 0,
    lastZ: 0,
    ctrlW: false,
    panes: [],
    active: 0,
    orientation: 'row',
    search: { pattern: '', matches: [], index: -1 }, // vim hlsearch (active pane)
    nanoSearch: { active: false, buf: '', pattern: '', matches: [], index: -1 },
  };

  const terminal = new Terminal({
    containerEl: termContainer,
    bundle,
    openViewCallback,
    onPathChange,
  });

  const router = new Router({
    terminal, terminalEl, termContainer,
    editorSurface, vimSurface, nanoSurface, nanoContent,
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
    editor.cmdActive = false;
    editor.cmdBuf = '';
    editor.ctrlW = false;
    if (mode === 'vim') {
      editor.panes = [makePane(vp, source)];
      editor.active = 0;
      editor.orientation = 'row';
      router.renderVimPanes(editor);
    } else {
      editor.source = source;
      editor.filename = vp ? vp.split('/').pop() : '';
      router.renderNano(source, editor.filename);
    }
  }

  function makePane(vp, source) {
    return { path: vp || null, filename: vp ? vp.split('/').pop() : '', source: source || '', numbers: false };
  }
  const activePane = () => editor.panes[editor.active];
  const activeContent = () => activePane() && activePane()._content;

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

  // (Per-pane scroll listeners are attached in router.renderVimPanes.)

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
    // --- Ctrl-w pane command (two-key) ---
    if (editor.ctrlW) {
      e.preventDefault();
      editor.ctrlW = false;
      const k = (e.key || '').toLowerCase();
      if (k === 'w' || k === 'l' || k === 'j') movePane(1);
      else if (k === 'h' || k === 'k') movePane(-1);
      else if (k === 'q' || k === 'c') closeActivePane();
      else if (k === 'o') onlyActivePane();
      else if (k === 'v') addPane('row', '');
      else if (k === 's') addPane('column', '');
      return;
    }
    // --- Prompt mode (command ':' or search '/') ---
    if (editor.cmdActive || editor.searchActive) {
      e.preventDefault();
      e.stopPropagation();
      const prefix = editor.cmdActive ? ':' : '/';
      if (e.key === 'Enter') {
        const buf = editor.cmdBuf;
        if (editor.cmdActive) { editor.cmdActive = false; return runVimCommand(buf); }
        editor.searchActive = false;
        return performVimSearch(buf);
      }
      if (e.key === 'Escape') return endPrompt();
      if (e.key === 'Backspace') {
        if (!editor.cmdBuf) return endPrompt();
        editor.cmdBuf = editor.cmdBuf.slice(0, -1);
        vimCmdlineEl.textContent = prefix + editor.cmdBuf;
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        editor.cmdBuf += e.key;
        vimCmdlineEl.textContent = prefix + editor.cmdBuf;
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
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      editor.searchActive = true;
      editor.cmdBuf = '';
      vimCmdlineEl.classList.add('vim-cmd-active');
      vimCmdlineEl.textContent = '/';
      return;
    }
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); vimSearchStep(1); return; }
    if (e.key === 'N' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); vimSearchStep(-1); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      clearVimSearchHighlight();
      editor.ctrlW = false; editor.lastG = 0; editor.lastZ = 0;
      const p = activePane();
      vimCmdlineEl.textContent = p && p.filename ? `"${p.filename}" [readonly]` : '';
      return;
    }
    if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); editor.ctrlW = true; return; }
    const el = activeContent();
    if (!el) { if (!e.ctrlKey && !e.metaKey) e.preventDefault(); return; }
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

  function endPrompt() {
    editor.cmdActive = false;
    editor.searchActive = false;
    editor.cmdBuf = '';
    vimCmdlineEl.classList.remove('vim-cmd-active');
    const p = activePane();
    vimCmdlineEl.textContent = p && p.filename ? `"${p.filename}" [readonly]` : '';
  }

  // --- Search highlighting (shared by vim and nano) ---
  function clearHighlights(container, cls) {
    if (!container) return;
    container.querySelectorAll('.' + cls).forEach((span) => {
      span.replaceWith(document.createTextNode(span.textContent));
    });
    container.normalize();
  }
  function highlightMatches(container, pattern, cls) {
    clearHighlights(container, cls);
    const matches = [];
    if (!container || !pattern) return matches;
    // smartcase: case-insensitive unless the pattern contains an uppercase letter
    const ci = pattern === pattern.toLowerCase();
    const needle = ci ? pattern.toLowerCase() : pattern;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && n.nodeValue.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    let tn;
    while ((tn = walker.nextNode())) nodes.push(tn);
    nodes.forEach((node) => {
      const hay = ci ? node.nodeValue.toLowerCase() : node.nodeValue;
      let idx = hay.indexOf(needle);
      if (idx < 0) return;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (idx >= 0) {
        if (idx > last) frag.appendChild(document.createTextNode(node.nodeValue.slice(last, idx)));
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = node.nodeValue.slice(idx, idx + pattern.length);
        frag.appendChild(span);
        matches.push(span);
        last = idx + pattern.length;
        idx = hay.indexOf(needle, last);
      }
      if (last < node.nodeValue.length) frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
      node.replaceWith(frag);
    });
    return matches;
  }

  // --- Vim search (/, n, N, :noh) on the active pane ---
  function performVimSearch(pattern) {
    vimCmdlineEl.classList.remove('vim-cmd-active');
    const pat = pattern || editor.search.pattern;
    const content = activeContent();
    if (!content) return;
    if (!pat) { vimCmdlineEl.textContent = 'E35: No previous regular expression'; return; }
    editor.search.pattern = pat;
    editor.search.matches = highlightMatches(content, pat, 'vim-search-match');
    if (!editor.search.matches.length) {
      editor.search.index = -1;
      vimCmdlineEl.textContent = `E486: Pattern not found: ${pat}`;
      return;
    }
    setVimCurrentMatch(0);
    vimCmdlineEl.textContent = `/${pat}`;
  }
  function setVimCurrentMatch(i) {
    const { matches } = editor.search;
    if (!matches.length) return;
    matches.forEach((m) => m.classList.remove('vim-search-current'));
    editor.search.index = (i + matches.length) % matches.length;
    const cur = matches[editor.search.index];
    cur.classList.add('vim-search-current');
    cur.scrollIntoView({ block: 'center' });
  }
  function vimSearchStep(dir) {
    if (!editor.search.matches.length) {
      if (editor.search.pattern) return performVimSearch(editor.search.pattern);
      vimCmdlineEl.textContent = 'E35: No previous regular expression';
      return;
    }
    setVimCurrentMatch(editor.search.index + dir);
    vimCmdlineEl.textContent = `/${editor.search.pattern}  [${editor.search.index + 1}/${editor.search.matches.length}]`;
  }
  function clearVimSearchHighlight() {
    const content = activeContent();
    if (content) clearHighlights(content, 'vim-search-match');
    editor.search.matches = [];
    editor.search.index = -1;
  }

  function runVimCommand(raw) {
    const s = raw.trim();
    editor.cmdActive = false;
    editor.cmdBuf = '';
    vimCmdlineEl.classList.remove('vim-cmd-active');
    const [word, ...rest] = s.split(/\s+/);
    const arg = rest.join(' ');
    if (['q', 'q!', 'quit', 'quit!'].includes(word)) return closeActivePane();
    if (['qa', 'qa!', 'qall', 'qall!', 'quitall', 'quitall!'].includes(word)) return exitEditor();
    if (['wq', 'wq!', 'x', 'x!', 'xit', 'exit'].includes(word)) return closeActivePane(); // read-only: just leave
    if (word === 'w' || word === 'write') { vimCmdlineEl.textContent = "E45: 'readonly' option is set (add ! to override)"; return; }
    if (word === 'w!' || word === 'write!') { vimCmdlineEl.textContent = `"${(activePane() || {}).filename || '[No Name]'}" written`; return; }
    if (['vsplit', 'vsp', 'vs', 'vnew'].includes(word)) return addPane('row', arg);
    if (['split', 'sp', 'new'].includes(word)) return addPane('column', arg);
    if (['only', 'on'].includes(word)) return onlyActivePane();
    if (['e', 'e!', 'edit', 'edit!'].includes(word)) {
      if (!arg) { vimCmdlineEl.textContent = 'E32: No file name'; return; }
      return editInActivePane(arg);
    }
    if (word === 'set' || word === 'se') return vimSet(arg);
    if (['noh', 'nohl', 'nohlsearch'].includes(word)) { clearVimSearchHighlight(); vimCmdlineEl.textContent = ''; return; }
    if (word === 'help' || word === 'h') {
      vimCmdlineEl.textContent = 'j/k scroll · gg/G · Ctrl-w h/l switch pane · :vsplit <file> · :set number · :q';
      return;
    }
    if (!word) return;
    vimCmdlineEl.textContent = `E492: Not an editor command: ${s}`;
  }

  // --- Pane operations ---
  function movePane(dir) {
    if (editor.panes.length < 2) return;
    editor.active = (editor.active + dir + editor.panes.length) % editor.panes.length;
    router.setActivePane(editor);
  }
  function closeActivePane() {
    if (editor.panes.length <= 1) return exitEditor();
    editor.panes.splice(editor.active, 1);
    if (editor.active >= editor.panes.length) editor.active = editor.panes.length - 1;
    router.renderVimPanes(editor);
  }
  function onlyActivePane() {
    editor.panes = [activePane()];
    editor.active = 0;
    router.renderVimPanes(editor);
  }
  function addPane(orientation, fileArg) {
    let pane;
    if (fileArg) {
      if (terminal.isDirectoryPath(fileArg)) { vimCmdlineEl.textContent = `"${fileArg}" is a directory`; return; }
      const src = terminal.getMarkdownForFile(fileArg);
      if (src == null) { vimCmdlineEl.textContent = `E484: Can't open file ${fileArg}`; return; }
      const vp = terminal.getVirtualPath(fileArg);
      pane = makePane(vp, src);
    } else {
      const a = activePane();
      pane = makePane(a.path, a.source);
    }
    editor.orientation = orientation;
    editor.panes.splice(editor.active + 1, 0, pane);
    editor.active += 1;
    router.renderVimPanes(editor);
  }
  function editInActivePane(name) {
    if (terminal.isDirectoryPath(name)) { vimCmdlineEl.textContent = `"${name}" is a directory`; return; }
    const src = terminal.getMarkdownForFile(name);
    if (src == null) { vimCmdlineEl.textContent = `E484: Can't open file ${name}`; return; }
    const vp = terminal.getVirtualPath(name);
    const p = activePane();
    p.path = vp;
    p.filename = vp.split('/').pop();
    p.source = src;
    router.renderVimPanes(editor);
  }
  function vimSet(arg) {
    const p = activePane();
    if (arg === 'number' || arg === 'nu') { p.numbers = true; router.renderVimPanes(editor); return; }
    if (arg === 'nonumber' || arg === 'nonu') { p.numbers = false; router.renderVimPanes(editor); return; }
    vimCmdlineEl.textContent = `E518: Unknown option: ${arg}`;
  }

  function handleNanoKey(e) {
    const el = nanoContent;
    const ns = editor.nanoSearch;
    // --- Search input mode (after ^W) ---
    if (ns.active) {
      e.preventDefault(); e.stopPropagation();
      const ctrlC = (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C');
      if (e.key === 'Enter') return runNanoSearch(ns.buf);
      if (e.key === 'Escape' || ctrlC) { ns.active = false; nanoMsgEl.textContent = '[ Cancelled ]'; return; }
      if (e.key === 'Backspace') { ns.buf = ns.buf.slice(0, -1); updateNanoSearchPrompt(); return; }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { ns.buf += e.key; updateNanoSearchPrompt(); }
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); e.stopPropagation(); return exitEditor(); }
    if (ctrl && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); e.stopPropagation(); startNanoSearch(); return; }
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
      nanoMsgEl.textContent = '[ ^X Exit · ^W Search · ^C Location · arrows/space scroll · read-only ]';
      return;
    }
    if (ctrl && 'oktr\\'.includes((e.key || '').toLowerCase())) {
      e.preventDefault(); e.stopPropagation();
      nanoMsgEl.textContent = '[ read-only buffer: writing/cut/replace disabled ]';
      return;
    }
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

  // --- Nano search (^W) ---
  function startNanoSearch() {
    editor.nanoSearch.active = true;
    editor.nanoSearch.buf = '';
    updateNanoSearchPrompt();
  }
  function updateNanoSearchPrompt() {
    const ns = editor.nanoSearch;
    const def = ns.pattern ? ` [${ns.pattern}]` : '';
    nanoMsgEl.textContent = `Search${def}: ${ns.buf}`;
  }
  function runNanoSearch(buf) {
    const ns = editor.nanoSearch;
    ns.active = false;
    const pat = buf || ns.pattern;
    if (!pat) { nanoMsgEl.textContent = '[ Cancelled ]'; return; }
    if (pat !== ns.pattern || !ns.matches.length) {
      ns.pattern = pat;
      ns.matches = highlightMatches(nanoContent, pat, 'nano-search-match');
      ns.index = -1;
    }
    if (!ns.matches.length) { nanoMsgEl.textContent = `[ "${pat}" not found ]`; return; }
    ns.matches.forEach((m) => m.classList.remove('vim-search-current'));
    ns.index = (ns.index + 1) % ns.matches.length;
    const cur = ns.matches[ns.index];
    cur.classList.add('vim-search-current');
    cur.scrollIntoView({ block: 'center' });
    nanoMsgEl.textContent = `[ match ${ns.index + 1}/${ns.matches.length}: ${pat} ]`;
  }

  function exitEditor() {
    editor.cmdActive = false;
    editor.searchActive = false;
    editor.nanoSearch.active = false;
    editor.mode = null;
    navigate({ kind: 'home' });
  }

  // Focus the terminal when clicking the panel (but never steal editor focus).
  terminalEl.addEventListener('click', () => {
    if (!editorSurface.hidden) return;
    if (terminal.term && typeof terminal.term.focus === 'function') terminal.term.focus();
  });
});
