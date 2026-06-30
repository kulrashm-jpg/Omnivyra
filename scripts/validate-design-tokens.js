/**
 * Design-token regression gate (CREATOR-139, RULE 8). Scans components/ + pages/ for
 * raw hardcoded design values that should come from tokens (lib/platform/ui/tokens.ts):
 * inline hex colors, arbitrary Tailwind colors (bg-[#...]/text-[#...]), and raw z-index.
 *
 * Report mode (default): prints counts + worst files, exits 0 (non-blocking baseline).
 * Gate mode (--max=N): exits 1 if violations exceed N — wire into predeploy once the
 * migration drives the baseline down. Excludes lib/platform/ui (the token source) and
 * tailwind.config.js (the integration point).
 *
 *   node scripts/validate-design-tokens.js              # report
 *   node scripts/validate-design-tokens.js --max=4000   # gate
 */
const fs = require('fs');
const path = require('path');

// --strict-platform: HARD gate on the platform primitives (must be token-pure; the
// token source tokens.ts is exempt). This is the realized hard enforcement (PART 7):
// the foundation is held to 0 violations even though the repo-wide baseline migrates down.
const STRICT_PLATFORM = process.argv.includes('--strict-platform');
const ROOTS = STRICT_PLATFORM ? [path.join('lib', 'platform', 'ui')] : ['components', 'pages'];
const EXCLUDE = STRICT_PLATFORM ? ['tokens.ts'] : [path.join('lib', 'platform'), 'tailwind.config.js'];
const RX = {
  inlineHex: /['"]#[0-9a-fA-F]{3,8}['"]/g,
  arbitraryColor: /(?:bg|text|border|from|to|via|fill|stroke|ring)-\[#[0-9a-fA-F]{3,8}\]/g,
  rawZ: /z-\[\d{2,}\]|zIndex:\s*\d{2,}/g,
};

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.value || e.name);
    if (EXCLUDE.some((x) => p.includes(x))) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|jsx|js)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p);
  }
}

const files = [];
for (const r of ROOTS) { try { walk(r, files); } catch { /* missing root */ } }

const totals = { inlineHex: 0, arbitraryColor: 0, rawZ: 0 };
const perFile = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const c = {
    inlineHex: (src.match(RX.inlineHex) || []).length,
    arbitraryColor: (src.match(RX.arbitraryColor) || []).length,
    rawZ: (src.match(RX.rawZ) || []).length,
  };
  const sum = c.inlineHex + c.arbitraryColor + c.rawZ;
  if (sum > 0) { perFile.push({ f, sum, ...c }); totals.inlineHex += c.inlineHex; totals.arbitraryColor += c.arbitraryColor; totals.rawZ += c.rawZ; }
}
const grand = totals.inlineHex + totals.arbitraryColor + totals.rawZ;
perFile.sort((a, b) => b.sum - a.sum);

console.log(`design-token violations across ${files.length} files:`);
console.log(`  inline hex colors:        ${totals.inlineHex}`);
console.log(`  arbitrary Tailwind colors: ${totals.arbitraryColor}`);
console.log(`  raw z-index:              ${totals.rawZ}`);
console.log(`  TOTAL:                    ${grand}`);
console.log('worst 8 files:');
perFile.slice(0, 8).forEach((x) => console.log(`  ${x.sum.toString().padStart(4)}  ${x.f}`));

if (STRICT_PLATFORM) {
  if (grand > 0) { console.error(`FAIL: platform primitives must be token-pure (${grand} violations)`); process.exit(1); }
  console.log('PASS: platform primitives are token-pure (0 violations)');
  process.exit(0);
}
const maxArg = process.argv.find((a) => a.startsWith('--max='));
if (maxArg) {
  const max = Number(maxArg.split('=')[1]);
  if (grand > max) { console.error(`FAIL: ${grand} > ${max} (gate)`); process.exit(1); }
  console.log(`PASS: ${grand} <= ${max}`);
}
process.exit(0);
