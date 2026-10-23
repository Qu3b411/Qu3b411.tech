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

  let vimExitStage = 0; // 0 = idle, 1 = saw ':' awaiting 'q'

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
      if (md) {
        vimExitStage = 0;
        if (view.kind === 'about') terminal.cd('/');
        router.showEditor('vim', md);
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
      if (postByPath[vp]) return { kind: 'article', post: postByPath[vp] };
      if (vp === 'about.md') return { kind: 'about' };
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

  // Terminal `vim`/`nano <file>` commands.
  function openViewCallback(virtualPath, type) {
    if (postByPath[virtualPath]) return navigate({ kind: 'article', post: postByPath[virtualPath] });
    if (virtualPath === 'about.md') return navigate({ kind: 'about' });
    // Any other file: open the editor without changing the URL.
    const md = router.getMarkdownForVirtualPath(virtualPath);
    if (md) {
      vimExitStage = 0;
      router.showEditor(type, md);
    }
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

  // Editor exit: Vim via :q, Nano via Ctrl+X — return to the terminal (home).
  // Capture phase so xterm can't swallow the keys first.
  document.addEventListener(
    'keydown',
    (e) => {
      if (!vimSurface.hidden) {
        if (e.key === ':' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          vimExitStage = 1;
          return;
        }
        if (vimExitStage === 1 && (e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          exitEditor();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!nanoSurface.hidden) {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
          e.preventDefault();
          e.stopPropagation();
          exitEditor();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  function exitEditor() {
    vimExitStage = 0;
    navigate({ kind: 'home' });
  }

  // Focus the terminal when clicking the panel (but never steal editor focus).
  terminalEl.addEventListener('click', () => {
    if (!editorSurface.hidden) return;
    if (terminal.term && typeof terminal.term.focus === 'function') terminal.term.focus();
  });
});
