const fs = require('fs');
const path = require('path');

const { readJson, validatePosts, validateVfs, assertNoMarkdownInDocs, scanForHttp, scanForUnpinnedCdn } = require('./lib/validate');
const { bundleContent } = require('./lib/bundle');
const { renderPage } = require('./lib/render');
const { computeHashes } = require('./lib/hash');
const seo = require('./lib/seo');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  fs.readdirSync(src, { withFileTypes: true }).forEach((ent) => {
    const srcPath = path.join(src, ent.name);
    const destPath = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

function build() {
  const repoRoot = process.cwd();
  const docsDir = path.join(repoRoot, 'docs');
  const srcDir = path.join(repoRoot, 'src');
  const buildDir = path.join(repoRoot, 'build');
  const contentDir = path.join(repoRoot, 'content');
  // Validate content
  const posts = readJson(path.join(contentDir, 'posts.json'));
  validatePosts(posts);
  const vfs = readJson(path.join(contentDir, 'vfs.json'));
  validateVfs(vfs);

  // Bundle content
  const bundle = bundleContent({ repoRoot });

  // Resolve the deploy-time site config (SITE_URL env overrides site.json) and
  // assign each post a stable, unique slug for its canonical URL. The slug is
  // added to the client bundle so app.js can map pathname <-> article.
  const site = seo.resolveSiteConfig(repoRoot);
  const usedSlugs = new Set();
  const slugById = {};
  bundle.posts.forEach((p) => {
    const base = seo.slugify(p.id) || 'post';
    let candidate = base;
    let n = 2;
    while (usedSlugs.has(candidate)) candidate = `${base}-${n++}`;
    usedSlugs.add(candidate);
    slugById[p.id] = candidate;
    p.slug = candidate;
  });
  const slugOf = (p) => slugById[p.id];

  // Clean docs directory
  if (fs.existsSync(docsDir)) {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
  ensureDir(docsDir);
  ensureDir(path.join(docsDir, 'assets'));
  ensureDir(path.join(docsDir, 'assets/css'));
  ensureDir(path.join(docsDir, 'assets/js'));
  ensureDir(path.join(docsDir, 'assets/images'));
  ensureDir(path.join(docsDir, 'assets/data'));

  // Copy CSS and JS
  copyDir(path.join(srcDir, 'css'), path.join(docsDir, 'assets/css'));
  copyDir(path.join(srcDir, 'js'), path.join(docsDir, 'assets/js'));
  // Copy images: from content/images and src/assets/images
  const imagesOut = path.join(docsDir, 'assets/images');
  if (fs.existsSync(path.join(contentDir, 'images'))) {
    copyDir(path.join(contentDir, 'images'), imagesOut);
  }
  if (fs.existsSync(path.join(srcDir, 'assets', 'images'))) {
    copyDir(path.join(srcDir, 'assets', 'images'), imagesOut);
  }
  // Copy xterm assets (js and css) into docs/assets/xterm
  const xtermSrc = path.join(srcDir, 'assets', 'xterm');
  const xtermDest = path.join(docsDir, 'assets', 'xterm');
  if (fs.existsSync(xtermSrc)) {
    copyDir(xtermSrc, xtermDest);
  }
  // Write bundle
  fs.writeFileSync(path.join(docsDir, 'assets/data/content.bundle.json'), JSON.stringify(bundle, null, 2));
  // Create SECURITY_NOTES.json
  const securityNotes = {
    notes: 'Markdown is rendered with DOM node creation and textContent instead of string-based HTML injection; terminal output strips control sequences; a restrictive CSP is emitted in index.html.',
  };
  fs.writeFileSync(path.join(docsDir, 'assets/data/SECURITY_NOTES.json'), JSON.stringify(securityNotes, null, 2));

  // ---- Discoverability / SEO: generate pages, sitemap, robots, feed ----
  // All content pages embed the same terminal shell (single source of truth)
  // filled with a depth-correct relative asset prefix.
  const baseTemplate = path.join(srcDir, 'templates/base.html');
  const shellRaw = fs.readFileSync(path.join(srcDir, 'templates/shell.html'), 'utf8');
  const shellFor = (prefix) => shellRaw.replace(/\{\{PREFIX\}\}/g, prefix);

  // Home: the SPA shell. Terminal shows immediately; crawlable links live in the
  // footer, the /blog/ index, and the sitemap.
  const headExtra = seo.renderHomeHead({ site, posts: bundle.posts, slugOf });
  fs.writeFileSync(
    path.join(docsDir, 'index.html'),
    renderPage(baseTemplate, null, { HEAD_EXTRA: headExtra, BODY: shellFor('./') })
  );

  // Per-post canonical pages: docs/blog/<slug>/index.html (prerendered article
  // + terminal shell; app.js opens the article in Vim at this same URL).
  bundle.posts.forEach((post) => {
    const slug = slugOf(post);
    const md = bundle.postMarkdownByVirtualPath[post.path] || '';
    const dir = path.join(docsDir, 'blog', slug);
    ensureDir(dir);
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      seo.renderArticlePage({ post, md, site, slug, prefix: '../../', shellHtml: shellFor('../../') })
    );
  });

  // Crawlable /blog/ hub and /about/ page.
  ensureDir(path.join(docsDir, 'blog'));
  fs.writeFileSync(
    path.join(docsDir, 'blog', 'index.html'),
    seo.renderBlogIndexPage({ site, posts: bundle.posts, slugOf, prefix: '../', shellHtml: shellFor('../') })
  );
  ensureDir(path.join(docsDir, 'about'));
  fs.writeFileSync(
    path.join(docsDir, 'about', 'index.html'),
    seo.renderAboutPage({ aboutMd: bundle.aboutMd, site, prefix: '../', shellHtml: shellFor('../') })
  );

  // 404 page (GitHub Pages serves this for unknown paths).
  fs.writeFileSync(path.join(docsDir, '404.html'), seo.render404Page({ site }));

  // sitemap.xml, robots.txt, RSS feed.xml at the site root.
  fs.writeFileSync(path.join(docsDir, 'sitemap.xml'), seo.renderSitemap({ site, posts: bundle.posts, slugOf }));
  fs.writeFileSync(path.join(docsDir, 'robots.txt'), seo.renderRobots({ site }));
  fs.writeFileSync(path.join(docsDir, 'feed.xml'), seo.renderFeed({ site, posts: bundle.posts, slugOf }));

  // CNAME for a custom domain (skip for *.github.io default hosting).
  const host = site.url.replace(/^https:\/\//i, '').split('/')[0];
  if (!/\.github\.io$/i.test(host)) {
    fs.writeFileSync(path.join(docsDir, 'CNAME'), host + '\n');
  }
  console.log(`SEO: ${site.url} — ${bundle.posts.length} post page(s) + blog index, about, 404, sitemap, robots, feed.`);

  // Compute manifest
  const hashes = computeHashes(docsDir, docsDir);
  fs.writeFileSync(path.join(docsDir, 'assets/data/BUILD_MANIFEST.json'), JSON.stringify(hashes, null, 2));

  // Validation on docs: no markdown, no http, pinned CDN
  assertNoMarkdownInDocs(docsDir);
  scanForHttp(docsDir);
  scanForUnpinnedCdn(docsDir);

  console.log('Build completed.');
}

try {
  build();
} catch (e) {
  if (e.isUserError) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } else {
    console.error(e);
    process.exit(1);
  }
}