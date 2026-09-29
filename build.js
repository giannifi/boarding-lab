// Bundles index.html + styles.css + src/*.js into one self-contained file for publishing.
// Usage: node build.js   →   dist/index.html
const fs = require('fs');
const path = require('path');

const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="styles.css" \/>/, () =>
  `<style>\n${fs.readFileSync(path.join(root, 'styles.css'), 'utf8')}\n</style>`);

html = html.replace(/<script src="(src\/[\w.-]+\.js)"><\/script>/g, (_, file) =>
  `<script>\n${fs.readFileSync(path.join(root, file), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);

const out = process.argv[2] || path.join(root, 'dist', 'index.html');
// sandboxed hosts (e.g. Cowork artifacts) block external fonts; system fonts are the fallback
if (process.argv.includes('--no-fonts')) html = html.replace(/\s*<link rel="preconnect"[^>]*>|\s*<link href="https:\/\/fonts[^>]*>/g, '');
if (process.argv.includes('--selftest')) html = html.replace('<script>', '<script>window.BL_SELFTEST = true;</script>\n<script>');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} KB`);
