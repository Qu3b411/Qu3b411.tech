// Router for hash-based navigation and view management.

// Minimal markdown renderer that builds DOM nodes directly instead of creating
// HTML strings. All markdown text is inserted with textContent and all image
// filenames are reduced to a conservative local basename before being used in
// attributes.
function basenameFromMarkdownImage(src) {
  const basename = src.trim().split('/').pop().split('?')[0].split('#')[0];
  return /^[A-Za-z0-9._-]+$/.test(basename) ? basename : '';
}

// Allow only safe link targets: https/relative/anchor. Block javascript: etc.
function safeHref(href) {
  const h = String(href || '').trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (/^(\/|\.|#|mailto:)/.test(h) && !/^javascript:/i.test(h)) return h;
  return '';
}

// Inline markdown: `code`, **bold**, *italic*, and [text](url) links. Text is
// inserted via textContent, so nothing is ever parsed as HTML.
function appendInline(parent, text) {
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/;
  let rest = String(text);
  while (rest) {
    const m = re.exec(rest);
    if (!m) {
      parent.appendChild(document.createTextNode(rest));
      break;
    }
    if (m.index > 0) parent.appendChild(document.createTextNode(rest.slice(0, m.index)));
    const tok = m[0];
    if (m[1]) {
      const code = document.createElement('code');
      code.textContent = tok.slice(1, -1);
      parent.appendChild(code);
    } else if (m[2]) {
      const strong = document.createElement('strong');
      appendInline(strong, tok.slice(2, -2));
      parent.appendChild(strong);
    } else if (m[3]) {
      const em = document.createElement('em');
      appendInline(em, tok.slice(1, -1));
      parent.appendChild(em);
    } else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      const href = lm ? safeHref(lm[2]) : '';
      if (href) {
        const a = document.createElement('a');
        a.href = href;
        if (/^https?:\/\//i.test(href)) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        a.textContent = lm[1];
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(tok));
      }
    }
    rest = rest.slice(m.index + tok.length);
  }
}

function appendParagraphContent(parent, line, assetBase) {
  const imagePattern = /!\[[^\]]*\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = imagePattern.exec(line)) !== null) {
    appendInline(parent, line.slice(lastIndex, match.index));

    const basename = basenameFromMarkdownImage(match[1]);
    if (basename) {
      const image = document.createElement('img');
      // Resolve against the site root so images load from nested article URLs.
      image.src = `${assetBase}assets/images/${basename}`;
      image.alt = basename;
      parent.appendChild(image);
    } else {
      parent.appendChild(document.createTextNode(match[0]));
    }

    lastIndex = match.index + match[0].length;
  }

  appendInline(parent, line.slice(lastIndex));
}

// Split a GFM table row into trimmed cells (tolerating optional edge pipes).
function tableCells(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}
function isTableSep(s) {
  return s.includes('|') && tableCells(s).length >= 1 && tableCells(s).every((c) => /^:?-{1,}:?$/.test(c));
}

function markdownToFragment(md, assetBase) {
  const fragment = document.createDocumentFragment();
  const lines = md.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block (``` or ```lang) — a language class drives highlighting.
    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const lang = fence[1].trim().toLowerCase();
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (lang) code.className = `language-${lang.replace(/[^a-z0-9+-]/g, '')}`;
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      code.textContent = buf.join('\n');
      pre.appendChild(code);
      fragment.appendChild(pre);
      continue;
    }

    // GFM pipe table: a row followed by a dash separator row.
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      tableCells(line).forEach((c) => {
        const th = document.createElement('th');
        appendInline(th, c);
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      i += 1; // consume separator
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) {
        i += 1;
        const tr = document.createElement('tr');
        tableCells(lines[i]).forEach((c) => {
          const td = document.createElement('td');
          appendInline(td, c);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      fragment.appendChild(table);
      continue;
    }

    // Horizontal rule.
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      fragment.appendChild(document.createElement('hr'));
      continue;
    }

    // Blockquote (one or more consecutive '>' lines).
    if (/^\s*>\s?/.test(line)) {
      const bq = document.createElement('blockquote');
      const p = document.createElement('p');
      let first = true;
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        if (!first) p.appendChild(document.createElement('br'));
        appendInline(p, lines[i].replace(/^\s*>\s?/, ''));
        first = false;
        i += 1;
      }
      i -= 1;
      bq.appendChild(p);
      fragment.appendChild(bq);
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const ul = document.createElement('ul');
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const li = document.createElement('li');
        appendParagraphContent(li, lines[i].replace(/^\s*[-*]\s+/, ''), assetBase);
        ul.appendChild(li);
        i += 1;
      }
      i -= 1;
      fragment.appendChild(ul);
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const ol = document.createElement('ol');
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const li = document.createElement('li');
        appendParagraphContent(li, lines[i].replace(/^\s*\d+\.\s+/, ''), assetBase);
        ol.appendChild(li);
        i += 1;
      }
      i -= 1;
      fragment.appendChild(ol);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    let element;
    if (line.startsWith('#### ')) {
      element = document.createElement('h4');
      appendInline(element, line.slice(5).trim());
    } else if (line.startsWith('### ')) {
      element = document.createElement('h3');
      appendInline(element, line.slice(4).trim());
    } else if (line.startsWith('## ')) {
      element = document.createElement('h2');
      appendInline(element, line.slice(3).trim());
    } else if (line.startsWith('# ')) {
      element = document.createElement('h1');
      appendInline(element, line.slice(2).trim());
    } else {
      element = document.createElement('p');
      appendParagraphContent(element, line, assetBase);
    }

    fragment.appendChild(element);
  }

  return fragment;
}

export class Router {
  constructor({ terminal, terminalEl, termContainer, editorSurface, vimSurface, vimContent, nanoSurface, nanoContent, assetBase }) {
    this.terminal = terminal;
    this.terminalEl = terminalEl;
    // DOM elements for view management
    this.termContainer = termContainer;
    this.editorSurface = editorSurface;
    this.vimSurface = vimSurface;
    this.vimContent = vimContent;
    this.nanoSurface = nanoSurface;
    this.nanoContent = nanoContent;
    // Absolute site root for resolving in-article asset URLs from nested paths.
    this.assetBase = assetBase || '';
    // NOTE: routing (hash + canonical pathname) is owned by app.js; this class
    // only renders views (showEditor/hideEditors) on request.
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
    targetContent.replaceChildren(markdownToFragment(markdown, this.assetBase));

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
    // Hidden /.games source files: render as a fenced code block so vim/nano
    // show them in a <pre> with original formatting preserved.
    if (vPath.startsWith('.games/')) {
      const games = this.terminal.bundle.games || {};
      const src = games[vPath];
      return src != null ? '```\n' + src + '\n```' : undefined;
    }
    return this.terminal.bundle.postMarkdownByVirtualPath[vPath];
  }
}
