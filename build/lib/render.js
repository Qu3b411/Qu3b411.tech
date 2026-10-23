const fs = require('fs');
const path = require('path');

// Render an HTML page by injecting body HTML into a base template.
// basePath: path to base template (with {{BODY}} placeholder)
// bodyPath: path to body partial
// replacements: optional map of additional {{KEY}} placeholders to fill
//   (e.g. { HEAD_EXTRA: '<meta ...>' }). Missing placeholders are blanked.
// returns rendered HTML string
function renderPage(basePath, bodyPath, replacements = {}) {
  const base = fs.readFileSync(basePath, 'utf8');
  // Body may come from a file (bodyPath) or directly via replacements.BODY.
  const body = bodyPath ? fs.readFileSync(bodyPath, 'utf8') : (replacements.BODY || '');
  const tokens = Object.assign({ HEAD_EXTRA: '' }, replacements, { BODY: body });
  return base.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : ''
  );
}

module.exports = {
  renderPage,
};