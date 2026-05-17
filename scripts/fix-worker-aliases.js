/**
 * Post-compile alias rewrite for the Railway worker build.
 *
 * `tsc` does not rewrite TS path aliases in emitted JS, and the production
 * Docker stage ships only `dist/` (no source, no runtime resolver). So
 * `require("@/config")` in compiled output is unresolvable and the worker
 * crashes on boot with MODULE_NOT_FOUND.
 *
 * tsconfig path map is `"@/*": ["./*"]` with baseUrl ".", and `dist/`
 * mirrors the repo root — so `@/X` is exactly `<dist>/X`. This script
 * rewrites every `require("@/X")` to a path relative to the importing file.
 *
 * Only the literal `@/` alias is touched; scoped npm packages like
 * `@supabase/...` (letter after `@`) are left alone.
 *
 * Zero dependencies on purpose — runs in the Docker builder after `tsc`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const distRoot = path.resolve(__dirname, '..', 'dist');

if (!fs.existsSync(distRoot)) {
  console.error('[fix-worker-aliases] dist/ not found — run tsc first');
  process.exit(1);
}

const ALIAS_RE = /(\brequire\(\s*|\bfrom\s*|\bimport\(\s*)(['"])@\/([^'"]+)\2/g;

let filesChanged = 0;
let rewrites = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && full.endsWith('.js')) {
      rewriteFile(full);
    }
  }
}

function rewriteFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('@/')) return;

  let rel = path.relative(path.dirname(file), distRoot).split(path.sep).join('/');
  if (rel === '') rel = '.';
  if (!rel.startsWith('.')) rel = './' + rel;

  let count = 0;
  const out = src.replace(ALIAS_RE, (_m, head, quote, sub) => {
    count++;
    return `${head}${quote}${rel}/${sub}${quote}`;
  });

  if (count > 0) {
    fs.writeFileSync(file, out);
    filesChanged++;
    rewrites += count;
  }
}

walk(distRoot);
console.log(`[fix-worker-aliases] rewrote ${rewrites} alias import(s) across ${filesChanged} file(s)`);
