const fs = require('fs');
const path = require('path');

const { readJson, validatePosts, validateVfs, assertNoMarkdownInDocs, scanForHttp, scanForUnpinnedCdn } = require('./lib/validate');
const { bundleContent } = require('./lib/bundle');
const { renderPage } = require('./lib/render');
const { computeHashes } = require('./lib/hash');

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

  // Render index.html
  const baseTemplate = path.join(srcDir, 'templates/base.html');
  const indexBody = path.join(srcDir, 'templates/index.body.html');
  const html = renderPage(baseTemplate, indexBody);
  fs.writeFileSync(path.join(docsDir, 'index.html'), html);

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