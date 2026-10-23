// Targeted regression tests for the build / SEO generation.
// Run from the repo root: `node build/test.js`
// Exits non-zero on failure. No external dependencies.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const seo = require('./lib/seo');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

const repoRoot = process.cwd();
const site = {
  url: 'https://example.test',
  title: 'Example',
  description: 'desc',
  author: 'me',
  language: 'en',
};

// ---- slugs ----
test('slugify normalizes ids to kebab-case', () => {
  assert.strictEqual(seo.slugify('terminal_tricks'), 'terminal-tricks');
  assert.strictEqual(seo.slugify('Hello World!!'), 'hello-world');
});

// ---- markdown sanitization (security critical) ----
test('mdToHtml escapes raw HTML / script tags', () => {
  const out = seo.renderArticlePage({
    post: { title: 'T', path: 'blog/x.md', date: '2025-01-01', summary: 's' },
    md: '# Hi\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>',
    site, slug: 'x', prefix: '../../', shellHtml: '<div id="app-container"></div>',
  });
  assert.ok(!/<script>alert/.test(out), 'raw <script> must not appear');
  assert.ok(out.includes('&lt;script&gt;'), 'script must be escaped');
  // The hostile <img onerror> is not markdown image syntax, so it must be
  // escaped to text — never emitted as a real, executable element.
  assert.ok(!/<img[^>]*onerror/i.test(out), 'no executable <img onerror> element');
  assert.ok(out.includes('&lt;img'), 'raw img tag must be escaped');
});

test('mdToHtml rejects javascript: links', () => {
  const out = seo.renderArticlePage({
    post: { title: 'T', path: 'blog/x.md', date: '2025-01-01', summary: 's' },
    md: '[click](javascript:alert(1))',
    site, slug: 'x', prefix: '../../', shellHtml: '<div></div>',
  });
  assert.ok(!/javascript:/i.test(out), 'javascript: URLs must be dropped');
});

// ---- article page invariants ----
test('renderArticlePage carries content, boot signal, canonical', () => {
  const out = seo.renderArticlePage({
    post: { title: 'Welcome', path: 'blog/welcome.md', date: '2025-01-01', summary: 'hi' },
    md: '# Welcome\n\nBody text here.',
    site, slug: 'welcome', prefix: '../../', shellHtml: '<div id="app-container"></div>',
  });
  assert.ok(out.includes('Body text here.'), 'article body present in HTML');
  assert.ok(out.includes('data-view="vim"'), 'vim boot signal present');
  assert.ok(out.includes('data-path="blog/welcome.md"'), 'boot path present');
  assert.ok(out.includes('<link rel="canonical" href="https://example.test/blog/welcome/" />'), 'canonical present');
  assert.ok(out.includes('id="app-container"'), 'terminal shell embedded');
  assert.ok(out.includes('../../assets/js/app.js'), 'app script with depth-correct prefix');
});

// ---- deploy-time site URL ----
test('resolveSiteConfig: SITE_URL env overrides config', () => {
  const prev = process.env.SITE_URL;
  process.env.SITE_URL = 'https://override.test/sub';
  const cfg = seo.resolveSiteConfig(repoRoot);
  assert.strictEqual(cfg.url, 'https://override.test/sub');
  process.env.SITE_URL = prev;
});

test('resolveSiteConfig: non-https URL is rejected', () => {
  const prev = process.env.SITE_URL;
  process.env.SITE_URL = 'http://insecure.test';
  assert.throws(() => seo.resolveSiteConfig(repoRoot), /https/);
  process.env.SITE_URL = prev;
});

// ---- sitemap / feed / robots consistency ----
test('sitemap + feed + robots reference canonical article URLs', () => {
  const posts = [{ id: 'welcome', title: 'Welcome', path: 'blog/welcome.md', date: '2025-01-01', summary: 's', slug: 'welcome' }];
  const slugOf = (p) => p.slug;
  const sm = seo.renderSitemap({ site, posts, slugOf });
  const feed = seo.renderFeed({ site, posts, slugOf });
  const robots = seo.renderRobots({ site });
  assert.ok(sm.includes('<loc>https://example.test/blog/welcome/</loc>'), 'sitemap has article');
  assert.ok(sm.includes('<loc>https://example.test/</loc>'), 'sitemap has home');
  assert.ok(feed.includes('https://example.test/blog/welcome/'), 'feed has article');
  assert.ok(robots.includes('Sitemap: https://example.test/sitemap.xml'), 'robots points to sitemap');
});

// ---- built output (requires a prior `node build/build.js`) ----
test('built docs: article page has body + boot signal, no localhost', () => {
  const p = path.join(repoRoot, 'docs', 'blog', 'welcome', 'index.html');
  if (!fs.existsSync(p)) {
    console.log('      (skipped: run `node build/build.js` first)');
    return;
  }
  const html = fs.readFileSync(p, 'utf8');
  assert.ok(html.includes('data-view="vim"'), 'built page has boot signal');
  assert.ok(/<article>[\s\S]*Welcome/.test(html), 'built page has article body');
  assert.ok(!/localhost|127\.0\.0\.1/.test(html), 'no dev origin leaked');
});

console.log(`\n${passed} checks passed.`);
