const fs = require('fs');
const path = require('path');

/**
 * Read a JSON file from disk. If the file cannot be read or parsed, throws a
 * user error with a descriptive message. This helper centralises error
 * handling so upstream code can assume returned objects are valid.
 *
 * @param {string} filePath Absolute or relative path to a JSON file
 * @returns {any} Parsed JSON contents
 */
function readJson(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    const err = new Error(`Unable to read JSON file: ${filePath}\n${e.message}`);
    err.isUserError = true;
    throw err;
  }
}

/**
 * Validate the structure of posts.json. Each entry must be an object with
 * required keys. Duplicate ids are not allowed. Dates must be strings but
 * are not parsed. Throws a user error on invalid structure.
 *
 * @param {any} posts The parsed posts.json contents
 */
function validatePosts(posts) {
  if (!Array.isArray(posts)) {
    const err = new Error('posts.json must be an array');
    err.isUserError = true;
    throw err;
  }
  const ids = new Set();
  posts.forEach((post, idx) => {
    if (typeof post !== 'object' || post === null) {
      const err = new Error(`Post at index ${idx} is not an object`);
      err.isUserError = true;
      throw err;
    }
    const required = ['id', 'title', 'file', 'path', 'date', 'summary'];
    required.forEach((k) => {
      if (!(k in post)) {
        const err = new Error(`Post at index ${idx} missing required key '${k}'`);
        err.isUserError = true;
        throw err;
      }
    });
    if (ids.has(post.id)) {
      const err = new Error(`Duplicate post id detected: ${post.id}`);
      err.isUserError = true;
      throw err;
    }
    ids.add(post.id);
  });
}

/**
 * Validate the structure of vfs.json. The expected minimal shape is a root
 * directory with children "blog" (dir) and "about.md" (file). The
 * validation here is intentionally lenient: it ensures required keys and
 * types but does not attempt to fully validate arbitrary virtual
 * filesystem structures.
 *
 * @param {any} vfs The parsed vfs.json contents
 */
function validateVfs(vfs) {
  if (typeof vfs !== 'object' || vfs === null || typeof vfs.root !== 'object') {
    const err = new Error('vfs.json must contain a root object');
    err.isUserError = true;
    throw err;
  }
  const root = vfs.root;
  if (root.type !== 'dir' || typeof root.children !== 'object' || root.children === null) {
    const err = new Error('vfs.root must be a directory with children');
    err.isUserError = true;
    throw err;
  }
  // Require blog directory and about.md file
  if (!('blog' in root.children) || !('about.md' in root.children)) {
    const err = new Error('vfs.root.children must include "blog" and "about.md"');
    err.isUserError = true;
    throw err;
  }
  if (root.children.blog.type !== 'dir') {
    const err = new Error('vfs.root.children.blog must have type "dir"');
    err.isUserError = true;
    throw err;
  }
  if (root.children['about.md'].type !== 'file') {
    const err = new Error('vfs.root.children.about.md must have type "file"');
    err.isUserError = true;
    throw err;
  }
}

/**
 * Ensure that the generated docs directory does not contain any markdown
 * files. Static sites should only contain HTML, CSS, JS and other assets. If
 * any file ending with .md is found, an error is thrown.
 *
 * @param {string} docsDir Absolute path to the docs output directory
 */
function assertNoMarkdownInDocs(docsDir) {
  const files = [];
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else files.push(full);
    });
  }
  walk(docsDir);
  const mdFile = files.find((f) => f.endsWith('.md'));
  if (mdFile) {
    const err = new Error(`Markdown file found in docs: ${mdFile}`);
    err.isUserError = true;
    throw err;
  }
}

/**
 * Scan files under docsDir for any occurrences of "http://". All external
 * resources must use https or be local. If any http:// string is found,
 * throws a user error.
 *
 * @param {string} docsDir Absolute path to the docs output directory
 */
function scanForHttp(docsDir) {
  // Only scan file types that should contain readable text/URLs.
  const TEXT_EXTS = new Set([
    '.html', '.htm',
    '.css',
    '.js', '.mjs', '.cjs',
    '.json',
    '.svg',
    '.map',
    '.txt', '.md', '.xml'
  ]);

  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) return walk(full);

      const ext = path.extname(ent.name).toLowerCase();
      if (!TEXT_EXTS.has(ext)) return; // skip binaries (png/jpg/woff/etc)

      // Read as utf8 ONLY for text files
      const data = fs.readFileSync(full, 'utf8');
      if (/http:\/\//i.test(data)) {
        const err = new Error(`Unsecured http:// reference found in ${full}`);
        err.isUserError = true;
        throw err;
      }
    });
  }

  walk(docsDir);
}
/*
function scanForHttp(docsDir) {
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else {
        const data = fs.readFileSync(full, 'utf8');
        if (/http:\/\//i.test(data)) {
          const err = new Error(`Unsecured http:// reference found in ${full}`);
          err.isUserError = true;
          throw err;
        }
      }
    });
  }
  walk(docsDir);
}*/

/**
 * Scan files under docsDir for unpinned CDN URLs. A pinned CDN URL should
 * contain a version number in its path (e.g. cdn.example.com/lib/1.2.3/lib.js).
 * This function checks for occurrences of known CDN domains without
 * obvious version segments and throws an error if found. The check is
 * heuristic and not exhaustive.
 *
 * @param {string} docsDir Absolute path to the docs output directory
 */
function scanForUnpinnedCdn(docsDir) {
  const cdnDomains = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com'];
  const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else {
        const data = fs.readFileSync(full, 'utf8');
        cdnDomains.forEach((domain) => {
          const escapedDomain = escapeRegExp(domain);
          const regex = new RegExp(`${escapedDomain}[^\"'\n]*`, 'gi');
          const matches = data.match(regex);
          if (matches) {
            matches.forEach((url) => {
              // consider unpinned if no digit sequence in path
              if (!/\d+\.\d+/.test(url)) {
                const err = new Error(`Unpinned CDN URL detected: ${url} in ${full}`);
                err.isUserError = true;
                throw err;
              }
            });
          }
        });
      }
    });
  }
  walk(docsDir);
}

module.exports = {
  readJson,
  validatePosts,
  validateVfs,
  assertNoMarkdownInDocs,
  scanForHttp,
  scanForUnpinnedCdn,
};
