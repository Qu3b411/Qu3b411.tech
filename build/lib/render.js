const fs = require('fs');
const path = require('path');

// Render an HTML page by injecting body HTML into a base template.
// basePath: path to base template (with {{BODY}} placeholder)
// bodyPath: path to body partial
// returns rendered HTML string
function renderPage(basePath, bodyPath) {
  const base = fs.readFileSync(basePath, 'utf8');
  const body = fs.readFileSync(bodyPath, 'utf8');
  return base.replace('{{BODY}}', body);
}

module.exports = {
  renderPage,
};