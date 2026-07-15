#!/usr/bin/env node
/**
 * W0-1 (Gate A) — route-factory adoption codemod.
 *
 * Wraps every pages/api route's default export in createApiRoute() — the
 * canonical pass-through pipeline (HARDEN-001 observability + F-03 request
 * context + error-class counting; response bytes unchanged, errors rethrown).
 *
 * CONSERVATIVE BY DESIGN: only three well-understood export shapes are
 * transformed; everything else is skip-listed and reported for manual review.
 *   A) export default [async] function NAME(...)   → declaration kept,
 *      wrapper appended
 *   B) export default NAME;                        → wrapped in place
 *   C) export default <single-line expression>;    → wrapped in place
 *
 * Idempotent: files already containing createApiRoute/withContract are
 * skipped. Run with --dry to preview. Prints a coverage report.
 */
const fs = require('fs');
const path = require('path');

const API_ROOT = path.join('pages', 'api');
const DRY = process.argv.includes('--dry');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) yield full;
  }
}

function routeLabel(file) {
  let rel = file.replace(/\\/g, '/').replace(/^pages/, '').replace(/\.ts$/, '');
  rel = rel.replace(/\/index$/, '') || '/api';
  rel = rel.replace(/\[\.\.\.([^\]]+)\]/g, ':$1*').replace(/\[([^\]]+)\]/g, ':$1');
  return rel;
}

function importPath(file) {
  const rel = path.relative(path.dirname(file), path.join('lib', 'platform', 'routeFactory'));
  const posix = rel.replace(/\\/g, '/');
  return posix.startsWith('.') ? posix : './' + posix;
}

const stats = { adopted: 0, alreadyCovered: 0, skipped: [] };

for (const file of walk(API_ROOT)) {
  let src = fs.readFileSync(file, 'utf8');

  if (src.includes('createApiRoute') || src.includes('withContract(')) {
    stats.alreadyCovered++;
    continue;
  }

  const defaults = src.match(/^export default /gm) || [];
  if (defaults.length === 0) { stats.skipped.push({ file, reason: 'no-default-export' }); continue; }
  if (defaults.length > 1) { stats.skipped.push({ file, reason: 'multiple-default-exports' }); continue; }

  const label = routeLabel(file);
  const imp = `import { createApiRoute as __createApiRoute } from '${importPath(file)}';\n`;
  let out = null;

  // A) named function declaration
  const declRe = /^export default (async function|function)\s+([A-Za-z0-9_$]+)\s*\(/m;
  const decl = src.match(declRe);
  if (decl) {
    const name = decl[2];
    out = src.replace(declRe, `${decl[1]} ${name}(`);
    if (!/\n$/.test(out)) out += '\n';
    out += `\n// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.\nexport default __createApiRoute(${name}, { route: '${label}' });\n`;
  } else {
    // B/C) single-line expression or identifier
    const exprRe = /^export default ([^\n;]+);[ \t]*$/m;
    const expr = src.match(exprRe);
    if (expr && !/^(async\b|function\b|class\b|\{)/.test(expr[1].trim())) {
      out = src.replace(exprRe, `export default __createApiRoute(${expr[1].trim()}, { route: '${label}' });`);
    } else {
      stats.skipped.push({ file, reason: expr ? 'unwrappable-expression' : 'multiline-or-anonymous-default' });
      continue;
    }
  }

  out = imp + out;
  stats.adopted++;
  if (!DRY) fs.writeFileSync(file, out);
}

console.log(`── W0-1 route-factory adoption${DRY ? ' (DRY RUN)' : ''} ──`);
console.log(`adopted:         ${stats.adopted}`);
console.log(`already covered: ${stats.alreadyCovered}`);
console.log(`skipped:         ${stats.skipped.length}`);
const byReason = {};
for (const s of stats.skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
console.log('skip reasons:', byReason);
for (const s of stats.skipped.slice(0, 40)) console.log(`  [${s.reason}] ${s.file}`);
fs.writeFileSync(path.join('scripts', '.route-factory-adoption-report.json'), JSON.stringify(stats, null, 2));
