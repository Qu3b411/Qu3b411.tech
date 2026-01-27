const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Recursively compute SHA-256 hashes of all files under dir.
// Returns an object mapping relative file paths (posix) to hex digests.
function computeHashes(dir, baseDir = dir) {
  const result = {};
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((ent) => {
    const fullPath = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      Object.assign(result, computeHashes(fullPath, baseDir));
    } else {
      const rel = path.posix.relative(baseDir.replace(/\\/g, '/'), fullPath.replace(/\\/g, '/'));
      const data = fs.readFileSync(fullPath);
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      result[rel] = hash;
    }
  });
  return result;
}

module.exports = {
  computeHashes,
};