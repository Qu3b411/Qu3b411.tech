// Discoverability / SEO generation for the terminal blog.
//
// Architecture: static-first progressive enhancement. Each article has ONE
// canonical URL (e.g. /blog/welcome/) whose static HTML contains the complete
// article (indexable, readable with no JS) AND the terminal app shell. When JS
// runs, app.js reveals the terminal and opens that article in Vim at the SAME
// URL — no redirect, no hash, no user-agent sniffing. Crawlers get the article
// either from the initial HTML or the rendered DOM (Vim view), identically.
//
// All absolute URLs (canonical/OG/sitemap/feed) derive from a single build-time
// base URL (SITE_URL env or content/site.json). In-page asset links use a
// relative prefix so pages work from a root domain or a sub-path; app.js
// resolves runtime asset URLs from import.meta.url, independent of page depth.

const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

function resolveSiteConfig(repoRoot) {
  let cfg = {};
  const cfgPath = path.join(repoRoot, 'content', 'site.json');
  if (fs.existsSync(cfgPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      const err = new Error(`Unable to parse content/site.json: ${e.message}`);
      err.isUserError = true;
      throw err;
    }
  }
  const envUrl = process.env.SITE_URL && process.env.SITE_URL.trim();
  const url = (envUrl || cfg.url || 'https://qu3b411.tech').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url)) {
    const err = new Error(`Site URL must be an absolute https:// URL (got "${url}"). Set SITE_URL or content/site.json "url".`);
    err.isUserError = true;
    throw err;
  }
  return {
    url,
    title: cfg.title || 'qu3b411.tech',
    description: cfg.description || '',
    author: cfg.author || 'qu3b411',
    language: cfg.language || 'en',
  };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slugify(id) {
  return String(id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function imageBasename(src) {
  const base = String(src).trim().split('/').pop().split('?')[0].split('#')[0];
  return /^[A-Za-z0-9._-]+$/.test(base) ? base : '';
}

function safeHref(href) {
  const h = String(href).trim();
  if (/^https:\/\//i.test(h)) return h;
  if (/^(\/|\.|#)/.test(h) && !/^javascript:/i.test(h)) return h;
  return '';
}

// Render a limited, safe subset of markdown to an HTML string. All text is
// HTML-escaped; only whitelisted constructs produce markup. `assetPrefix` is
// the relative path from the page to the site root (e.g. '../../').
function mdToHtml(md, assetPrefix) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let listBuf = [];

  const flushList = () => {
    if (listBuf.length) {
      out.push('<ul>' + listBuf.map((li) => `<li>${inline(li)}</li>`).join('') + '</ul>');
      listBuf = [];
    }
  };

  const inline = (text) => {
    const parts = String(text).split(/(`[^`]*`)/g);
    return parts
      .map((part) => {
        if (!part) return '';
        if (part.startsWith('`') && part.endsWith('`')) {
          return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
        }
        let html = '';
        let i = 0;
        const re = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
        let m;
        while ((m = re.exec(part)) !== null) {
          html += escapeHtml(part.slice(i, m.index));
          if (m[2] !== undefined && m[1] !== undefined && m[0].startsWith('!')) {
            const base = imageBasename(m[2]);
            if (base) {
              html += `<img src="${assetPrefix}assets/images/${escapeHtml(base)}" alt="${escapeHtml(m[1])}" loading="lazy" />`;
            } else {
              html += escapeHtml(m[0]);
            }
          } else if (m[3] !== undefined) {
            const href = safeHref(m[4]);
            if (href) {
              const ext = /^https:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
              html += `<a href="${escapeHtml(href)}"${ext}>${escapeHtml(m[3])}</a>`;
            } else {
              html += escapeHtml(m[3]);
            }
          } else if (m[5] !== undefined) {
            html += `<strong>${escapeHtml(m[5])}</strong>`;
          } else if (m[6] !== undefined) {
            html += `<em>${escapeHtml(m[6])}</em>`;
          }
          i = m.index + m[0].length;
        }
        html += escapeHtml(part.slice(i));
        return html;
      })
      .join('');
  };

  lines.forEach((line) => {
    if (/^```/.test(line)) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      return;
    }
    if (inCode) {
      codeBuf.push(line);
      return;
    }
    if (/^\s*-\s+/.test(line)) {
      listBuf.push(line.replace(/^\s*-\s+/, ''));
      return;
    }
    flushList();
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^### /.test(line)) out.push(`<h3>${inline(line.slice(4).trim())}</h3>`);
    else if (/^## /.test(line)) out.push(`<h2>${inline(line.slice(3).trim())}</h2>`);
    else if (/^# /.test(line)) out.push(`<h1>${inline(line.slice(2).trim())}</h1>`);
    else out.push(`<p>${inline(trimmed)}</p>`);
  });
  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  flushList();
  return out.join('\n');
}

function excerpt(md, max = 160) {
  const text = String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

const CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline';";

// Build the <head> inner HTML shared by generated app pages.
function buildHead({ site, prefix, title, desc, canonicalUrl, ogType, image, jsonLd }) {
  const img = image || `${site.url}/assets/images/ProfilePicture.png`;
  const parts = [
    `<meta charset="UTF-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />`,
    `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(desc)}" />`,
    `<meta name="author" content="${escapeHtml(site.author)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:site_name" content="${escapeHtml(site.title)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(img)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(img)}" />`,
    `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="${prefix}feed.xml" />`,
    `<link rel="stylesheet" href="${prefix}assets/css/site.css" />`,
    `<link rel="stylesheet" href="${prefix}assets/css/terminal.css" />`,
    `<link rel="stylesheet" href="${prefix}assets/xterm/xterm.css" />`,
    `<link rel="stylesheet" href="${prefix}assets/css/article.css" />`,
  ];
  if (jsonLd) parts.push(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
  return parts.join('\n    ');
}

// Compose a full generated app page: head + prerendered fallback + terminal
// shell + scripts. `shellHtml` is the shell template already filled with prefix.
function appPage({ site, prefix, bodyClass, dataAttr, headInner, prerenderHtml, shellHtml }) {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(site.language)}">
  <head>
    ${headInner}
  </head>
  <body class="${bodyClass}"${dataAttr ? ' ' + dataAttr : ''}>
    <div id="prerender">
${prerenderHtml}
    </div>
    ${shellHtml}
    <script src="${prefix}assets/xterm/xterm.js"></script>
    <script type="module" src="${prefix}assets/js/app.js"></script>
  </body>
</html>
`;
}

// ----------------------------------------------------------------------------
// Page renderers
// ----------------------------------------------------------------------------

function renderArticlePage({ post, md, site, slug, prefix, shellHtml }) {
  const url = `${site.url}/blog/${slug}/`;
  const desc = post.summary || excerpt(md);
  const bodyHtml = mdToHtml(md, prefix);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: desc,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Person', name: site.author },
    publisher: { '@type': 'Person', name: site.author },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    image: `${site.url}/assets/images/ProfilePicture.png`,
  };
  const headInner = buildHead({
    site, prefix,
    title: `${post.title} — ${site.title}`,
    desc, canonicalUrl: url, ogType: 'article', jsonLd,
  });
  const prerenderHtml = `      <main class="article">
        <nav class="article-nav">
          <a class="back" href="${prefix}">← ${escapeHtml(site.title)}</a>
          <a class="term" href="${prefix}blog/">All posts</a>
        </nav>
        <article>
          <h1>${escapeHtml(post.title)}</h1>
          <p class="article-date"><time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time></p>
${bodyHtml}
        </article>
      </main>`;
  return appPage({
    site, prefix,
    bodyClass: 'page-article',
    dataAttr: `data-view="vim" data-path="${escapeHtml(post.path)}"`,
    headInner, prerenderHtml, shellHtml,
  });
}

function renderAboutPage({ aboutMd, site, prefix, shellHtml }) {
  const url = `${site.url}/about/`;
  const desc = excerpt(aboutMd);
  const bodyHtml = mdToHtml(aboutMd, prefix);
  const headInner = buildHead({
    site, prefix,
    title: `About — ${site.title}`,
    desc, canonicalUrl: url, ogType: 'website',
  });
  const prerenderHtml = `      <main class="article">
        <nav class="article-nav">
          <a class="back" href="${prefix}">← ${escapeHtml(site.title)}</a>
          <a class="term" href="${prefix}blog/">All posts</a>
        </nav>
        <article>
${bodyHtml}
        </article>
      </main>`;
  return appPage({
    site, prefix,
    bodyClass: 'page-about',
    dataAttr: 'data-view="about"',
    headInner, prerenderHtml, shellHtml,
  });
}

function renderBlogIndexPage({ site, posts, slugOf, prefix, shellHtml }) {
  const url = `${site.url}/blog/`;
  const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));
  const items = sorted
    .map(
      (p) =>
        `          <li>\n            <a href="${prefix}blog/${slugOf(p)}/">${escapeHtml(p.title)}</a>\n            <span class="post-date">${escapeHtml(p.date)}</span>\n            <span class="post-summary">${escapeHtml(p.summary || '')}</span>\n          </li>`
    )
    .join('\n');
  const headInner = buildHead({
    site, prefix,
    title: `Blog — ${site.title}`,
    desc: `All posts on ${site.title}.`,
    canonicalUrl: url, ogType: 'website',
  });
  const prerenderHtml = `      <main class="article">
        <nav class="article-nav">
          <a class="back" href="${prefix}">← ${escapeHtml(site.title)}</a>
        </nav>
        <article>
          <h1>Blog</h1>
          <ul class="post-list">
${items}
          </ul>
        </article>
      </main>`;
  return appPage({
    site, prefix,
    bodyClass: 'page-blog',
    dataAttr: 'data-view="blog"',
    headInner, prerenderHtml, shellHtml,
  });
}

// 404 page: standalone (no terminal shell) because it is served by GitHub Pages
// for arbitrary missing paths, so its links must be absolute, not relative.
function render404Page({ site }) {
  const css = `${site.url}/assets/css/article.css`;
  return `<!DOCTYPE html>
<html lang="${escapeHtml(site.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />
    <title>404 — ${escapeHtml(site.title)}</title>
    <meta name="robots" content="noindex" />
    <link rel="stylesheet" href="${escapeHtml(css)}" />
  </head>
  <body>
    <main class="article">
      <article>
        <h1>404 — not found</h1>
        <p>That path doesn't exist. Here's the way back:</p>
        <ul>
          <li><a href="${escapeHtml(site.url)}/">Home (terminal)</a></li>
          <li><a href="${escapeHtml(site.url)}/blog/">All posts</a></li>
        </ul>
      </article>
    </main>
  </body>
</html>
`;
}

// <head> fragment injected into the SPA index.html (home).
function renderHomeHead({ site, posts, slugOf }) {
  const ogImage = `${site.url}/assets/images/ProfilePicture.png`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: site.title,
    description: site.description,
    url: `${site.url}/`,
    author: { '@type': 'Person', name: site.author },
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      datePublished: p.date,
      url: `${site.url}/blog/${slugOf(p)}/`,
    })),
  };
  return [
    `<meta name="description" content="${escapeHtml(site.description)}" />`,
    `<meta name="author" content="${escapeHtml(site.author)}" />`,
    `<link rel="canonical" href="${escapeHtml(site.url)}/" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(site.title)}" />`,
    `<meta property="og:title" content="${escapeHtml(site.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(site.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(site.url)}/" />`,
    `<meta property="og:image" content="${escapeHtml(ogImage)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)}" href="feed.xml" />`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
  ].join('\n    ');
}

function renderSitemap({ site, posts, slugOf }) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${site.url}/`, lastmod: today, priority: '1.0' },
    { loc: `${site.url}/blog/`, lastmod: today, priority: '0.7' },
    { loc: `${site.url}/about/`, lastmod: today, priority: '0.5' },
    ...posts.map((p) => ({ loc: `${site.url}/blog/${slugOf(p)}/`, lastmod: p.date, priority: '0.8' })),
  ];
  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function renderRobots({ site }) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`;
}

function renderFeed({ site, posts, slugOf }) {
  const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = sorted.length ? sorted[0].date : new Date().toISOString().slice(0, 10);
  const items = sorted
    .map((p) => {
      const link = `${site.url}/blog/${slugOf(p)}/`;
      return `    <item>\n      <title>${escapeXml(p.title)}</title>\n      <link>${escapeXml(link)}</link>\n      <guid isPermaLink="true">${escapeXml(link)}</guid>\n      <pubDate>${escapeXml(new Date(p.date + 'T00:00:00Z').toUTCString())}</pubDate>\n      <description>${escapeXml(p.summary || '')}</description>\n    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>${escapeXml(site.title)}</title>\n    <link>${escapeXml(site.url)}/</link>\n    <atom:link href="${escapeXml(site.url)}/feed.xml" rel="self" type="application/rss+xml" />\n    <description>${escapeXml(site.description)}</description>\n    <language>${escapeXml(site.language)}</language>\n    <lastBuildDate>${escapeXml(new Date(latest + 'T00:00:00Z').toUTCString())}</lastBuildDate>\n${items}\n  </channel>\n</rss>\n`;
}

module.exports = {
  resolveSiteConfig,
  slugify,
  renderArticlePage,
  renderAboutPage,
  renderBlogIndexPage,
  render404Page,
  renderHomeHead,
  renderSitemap,
  renderRobots,
  renderFeed,
};
