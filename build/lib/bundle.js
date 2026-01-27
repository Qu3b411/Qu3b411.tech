const fs = require('fs');
const path = require('path');

// Bundle content for the terminal blog. The bundler aggregates markdown
// content and metadata into a single JSON payload that the client can
// consume. It reads posts.json, vfs.json, about.md and individual post
// markdown files from the repo. Images referenced in markdown are not
// parsed here; instead, all images from content/images are copied by the
// build script and listed in the bundle.

function bundleContent({ repoRoot }) {
  const contentDir = path.join(repoRoot, 'content');
  const postsPath = path.join(contentDir, 'posts.json');
  const vfsPath = path.join(contentDir, 'vfs.json');
  const aboutPath = path.join(contentDir, 'about.md');
  const posts = JSON.parse(fs.readFileSync(postsPath, 'utf8'));
  const vfs = JSON.parse(fs.readFileSync(vfsPath, 'utf8'));
  const aboutMd = fs.readFileSync(aboutPath, 'utf8');
  // Load each post markdown file keyed by its virtual path
  const postMarkdownByVirtualPath = {};
  posts.forEach((post) => {
    // Determine physical file location. Posts live under content/posts/
    // with file names specified in the post definition. The virtual
    // path (post.path) begins with "blog/" but the physical file is
    // located in content/posts/{file}.
    const filePath = path.join(contentDir, 'posts', post.file);
    const md = fs.readFileSync(filePath, 'utf8');
    // store under virtual path (post.path) for runtime lookup
    postMarkdownByVirtualPath[post.path] = md;
  });
  // List images (basenames) from content/images
  let images = [];
  const imagesDir = path.join(contentDir, 'images');
  if (fs.existsSync(imagesDir)) {
    images = fs.readdirSync(imagesDir).filter((f) => !fs.statSync(path.join(imagesDir, f)).isDirectory());
  }
  return {
    aboutMd,
    posts,
    vfs,
    postMarkdownByVirtualPath,
    images,
  };
}

module.exports = {
  bundleContent,
};