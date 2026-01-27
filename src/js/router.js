// Router for hash-based navigation and view management.
import { sanitizeHtml } from './sanitize.js';

// Simple markdown to HTML converter for view modes. Supports headings,
// paragraphs, inline code and image embedding. Does not implement
// full Markdown spec but covers essential elements.
function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  let html = '';
  let inCode = false;
  lines.forEach((line) => {
    // fence: not implemented; treat as pre blocks
    if (/^```/.test(line)) {
      inCode = !inCode;
      return;
    }
    if (inCode) {
      html += `<pre><code>${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
      return;
    }
    if (line.startsWith('# ')) {
      html += `<h1>${line.slice(2).trim()}</h1>`;
    } else if (line.startsWith('## ')) {
      html += `<h2>${line.slice(3).trim()}</h2>`;
    } else if (line.startsWith('### ')) {
      html += `<h3>${line.slice(4).trim()}</h3>`;
    } else if (/^\s*- /.test(line)) {
      // unordered list item
      html += `<li>${line.replace(/^\s*-\s*/, '').trim()}</li>`;
    } else if (line.trim() === '') {
      html += '';
    } else {
      // images and inline code in paragraphs
      let processed = line;
      processed = processed.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (m, p1) => {
        const base = p1.trim().split('/').pop().split('?')[0].split('#')[0];
        return `<img src="assets/images/${base}" alt="${base}" />`;
      });
      processed = processed.replace(/`([^`]*)`/g, '<code>$1</code>');
      html += `<p>${processed}</p>`;
    }
  });
  return html;
}

export class Router {
  constructor({ terminal, terminalEl, termContainer, editorSurface, vimSurface, vimContent, nanoSurface, nanoContent }) {
    this.terminal = terminal;
    this.terminalEl = terminalEl;
    // DOM elements for view management
    this.termContainer = termContainer;
    this.editorSurface = editorSurface;
    this.vimSurface = vimSurface;
    this.vimContent = vimContent;
    this.nanoSurface = nanoSurface;
    this.nanoContent = nanoContent;

    window.addEventListener('hashchange', () => this.loadRoute());
  }

  init() {
    this.loadRoute();
  }

  // Hide editor surfaces and show terminal
  hideEditors() {
    if (this.terminalEl) this.terminalEl.classList.remove('editor-active');
    this.termContainer.hidden = false;
    this.editorSurface.hidden = true;
    this.vimSurface.hidden = true;
    this.nanoSurface.hidden = true;
    try{
	    this.terminal.term.focus();
    } catch {
	    /* no-op */
    }
  }

  // Show a specific editor mode
  showEditor(mode, safeHtml) {
    if (this.terminalEl) this.terminalEl.classList.add('editor-active');
    this.termContainer.hidden = true;
    this.editorSurface.hidden = false;
    if (mode === 'vim') {
      this.nanoSurface.hidden = true;
      this.vimSurface.hidden = false;
      this.vimContent.innerHTML = safeHtml;
    } else {
      this.vimSurface.hidden = true;
      this.nanoSurface.hidden = false;
      this.nanoContent.innerHTML = safeHtml;
    }

    // Give the editor surface focus so keyboard shortcuts are reliable.
    // This also helps prevent xterm from stealing focus.
    try {
      this.editorSurface.focus();
    } catch {
      /* no-op */
    }
  }

  // Load the current hash state
  loadRoute() {
    const hash = window.location.hash || '#root';
    const [route, ...rest] = hash.slice(1).split('/');
    // Determine root route
    if (route === 'about') {
      // About route: set cwd to root and display about content
      this.hideEditors();
      this.terminal.cd('/');
      this.terminal.cat('about.md');
      return;
    }
    if (route === 'blog' || route === 'root') {
      // Show terminal; do not reset cwd
      this.hideEditors();
      return;
    }
    if (route === 'post') {
      // Not used currently; fallback to root
      this.hideEditors();
      return;
    }
    if (route === 'vim' || route === 'nano') {
      const mode = route;
      const virtualPath = rest.join('/');
      if (!virtualPath) {
        this.hideEditors();
        return;
      }
      // Determine file contents
      const md = this.getMarkdownForVirtualPath(virtualPath);
      if (!md) {
        this.hideEditors();
        return;
      }
      const html = mdToHtml(md);
      const safeHtml = sanitizeHtml(html);
      this.showEditor(mode, safeHtml);
      return;
    }
    // Unknown route: just show terminal
    this.hideEditors();
  }

  getMarkdownForVirtualPath(vPath) {
    // about.md
    if (vPath === 'about.md') {
      return this.terminal.bundle.aboutMd;
    }
    return this.terminal.bundle.postMarkdownByVirtualPath[vPath];
  }
}
