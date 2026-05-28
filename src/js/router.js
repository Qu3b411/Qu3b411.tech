// Router for hash-based navigation and view management.

// Minimal markdown renderer that builds DOM nodes directly instead of creating
// HTML strings. All markdown text is inserted with textContent and all image
// filenames are reduced to a conservative local basename before being used in
// attributes.
function basenameFromMarkdownImage(src) {
  const basename = src.trim().split('/').pop().split('?')[0].split('#')[0];
  return /^[A-Za-z0-9._-]+$/.test(basename) ? basename : '';
}

function appendInlineCode(parent, text) {
  const parts = text.split(/(`[^`]*`)/g);
  parts.forEach((part) => {
    if (!part) return;
    if (part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      parent.appendChild(code);
      return;
    }
    parent.appendChild(document.createTextNode(part));
  });
}

function appendParagraphContent(parent, line) {
  const imagePattern = /!\[[^\]]*\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = imagePattern.exec(line)) !== null) {
    appendInlineCode(parent, line.slice(lastIndex, match.index));

    const basename = basenameFromMarkdownImage(match[1]);
    if (basename) {
      const image = document.createElement('img');
      image.src = `assets/images/${basename}`;
      image.alt = basename;
      parent.appendChild(image);
    } else {
      parent.appendChild(document.createTextNode(match[0]));
    }

    lastIndex = match.index + match[0].length;
  }

  appendInlineCode(parent, line.slice(lastIndex));
}

function markdownToFragment(md) {
  const fragment = document.createDocumentFragment();
  const lines = md.split(/\r?\n/);
  let inCode = false;
  let codeBlock = null;

  lines.forEach((line) => {
    if (/^```/.test(line)) {
      inCode = !inCode;
      if (inCode) {
        const pre = document.createElement('pre');
        codeBlock = document.createElement('code');
        pre.appendChild(codeBlock);
        fragment.appendChild(pre);
      } else {
        codeBlock = null;
      }
      return;
    }

    if (inCode) {
      if (codeBlock.textContent) codeBlock.appendChild(document.createTextNode('\n'));
      codeBlock.appendChild(document.createTextNode(line));
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) return;

    let element;
    if (line.startsWith('# ')) {
      element = document.createElement('h1');
      element.textContent = line.slice(2).trim();
    } else if (line.startsWith('## ')) {
      element = document.createElement('h2');
      element.textContent = line.slice(3).trim();
    } else if (line.startsWith('### ')) {
      element = document.createElement('h3');
      element.textContent = line.slice(4).trim();
    } else if (/^\s*- /.test(line)) {
      element = document.createElement('li');
      appendParagraphContent(element, line.replace(/^\s*-\s*/, '').trim());
    } else {
      element = document.createElement('p');
      appendParagraphContent(element, line);
    }

    fragment.appendChild(element);
  });

  return fragment;
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
    if (this.terminal.term && typeof this.terminal.term.focus === 'function') {
      this.terminal.term.focus();
    }
  }

  // Show a specific editor mode
  showEditor(mode, markdown) {
    if (this.terminalEl) this.terminalEl.classList.add('editor-active');
    this.termContainer.hidden = true;
    this.editorSurface.hidden = false;

    const targetContent = mode === 'vim' ? this.vimContent : this.nanoContent;
    targetContent.replaceChildren(markdownToFragment(markdown));

    if (mode === 'vim') {
      this.nanoSurface.hidden = true;
      this.vimSurface.hidden = false;
    } else {
      this.vimSurface.hidden = true;
      this.nanoSurface.hidden = false;
    }

    // Give the editor surface focus so keyboard shortcuts are reliable.
    // This also helps prevent xterm from stealing focus.
    this.editorSurface.focus();
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
      this.showEditor(mode, md);
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
