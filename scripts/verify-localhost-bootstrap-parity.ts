/**
 * LOCALHOST-ONLY: bootstrap/runtime parity verifier.
 *
 * Reads scripts/localhost-bootstrap.sql, extracts the column lists for each
 * stub table, then scans the codebase for runtime writes against those same
 * tables and computes the set of columns the runtime uses but the bootstrap
 * stub does not declare. Exits non-zero on any drift.
 *
 * Strategy: state-machine scan of each source file. For every occurrence of
 *   .from('<table>')   OR   ownedDbTable('<table>')
 * we walk forward to the next semicolon (statement end), and IF that
 * statement contains a `.insert({...})` / `.upsert({...})` / `.update({...})`
 * object-literal, we extract its top-level keys as column names. This
 * deliberately ignores `.select(...)` (read-only) since reads don't drift.
 *
 * Usage:
 *   npx tsx scripts/verify-localhost-bootstrap-parity.ts
 *
 * Exits:
 *   0 — parity OK
 *   1 — drift detected (missing columns enumerated)
 *   2 — could not read bootstrap or codebase
 */

import * as fs from 'fs';
import * as path from 'path';

const BOOTSTRAP_PATH = path.resolve(__dirname, 'localhost-bootstrap.sql');
const STUB_TABLES = [
  'credit_transactions',
  'usage_events',
  'credit_purchases',
  'payment_provider_events',
  'payment_transactions',
  'billing_subscriptions',
];
const SCAN_ROOTS = ['backend', 'pages'].map(r => path.resolve(__dirname, '..', r));

// Reserved JS tokens that can appear in object literals but aren't column names.
const RESERVED = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'async', 'await', 'return',
  'const', 'let', 'var', 'if', 'else', 'for', 'while', 'function', 'new',
  'typeof', 'instanceof', 'in', 'of', 'try', 'catch', 'finally', 'throw',
  'break', 'continue', 'switch', 'case', 'default', 'void', 'yield',
]);

function readBootstrap(): Map<string, Set<string>> {
  const out: Map<string, Set<string>> = new Map();
  if (!fs.existsSync(BOOTSTRAP_PATH)) {
    console.error(`bootstrap not found: ${BOOTSTRAP_PATH}`);
    process.exit(2);
  }
  const sql = fs.readFileSync(BOOTSTRAP_PATH, 'utf8');
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.(\w+)\s*\(([\s\S]*?)\n\s*\);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const tableName = m[1];
    if (!STUB_TABLES.includes(tableName)) continue;
    const body = m[2];
    const cols = new Set<string>();
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('--')) continue;
      if (/^(UNIQUE|PRIMARY|FOREIGN|CHECK|CONSTRAINT)\b/i.test(t)) continue;
      const colMatch = t.match(/^"?(\w+)"?\s/);
      if (colMatch) cols.add(colMatch[1].toLowerCase());
    }
    out.set(tableName, cols);
  }
  return out;
}

function listSourceFiles(roots: string[]): string[] {
  const all: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.next', 'dist', '__tests__', '.git'].includes(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        all.push(full);
      }
    }
  }
  for (const r of roots) walk(r);
  return all;
}

/**
 * Find the end index of a balanced { ... } starting at `openIdx` (which
 * points at the opening '{'). Returns the index of the closing '}', or -1
 * if unmatched.
 */
function findClosingBrace(src: string, openIdx: number): number {
  let depth = 0;
  let inStr: string | null = null;
  let escape = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (escape) { escape = false; continue; }
    if (inStr) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Extract top-level keys from an object literal body (between { and }). */
function extractKeys(body: string): string[] {
  const keys: string[] = [];
  // Split at depth-0 commas.
  let depth = 0;
  let segment = '';
  let inStr: string | null = null;
  let escape = false;
  const segments: string[] = [];
  for (const ch of body) {
    if (escape) { escape = false; segment += ch; continue; }
    if (inStr) {
      if (ch === '\\') { escape = true; segment += ch; continue; }
      if (ch === inStr) inStr = null;
      segment += ch; continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; segment += ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { segments.push(segment); segment = ''; continue; }
    segment += ch;
  }
  if (segment.trim()) segments.push(segment);
  for (const seg of segments) {
    const t = seg.trim();
    if (!t) continue;
    // Skip spread `...x`.
    if (t.startsWith('...')) continue;
    // `key:`, `'key':`, `"key":`
    let km = t.match(/^['"]?([a-zA-Z_][\w]*)['"]?\s*:/);
    if (km) { keys.push(km[1]); continue; }
    // Shorthand `key,` or `key\n`.
    km = t.match(/^([a-zA-Z_][\w]*)\s*$/);
    if (km) { keys.push(km[1]); continue; }
    // Computed property `[expr]:` — skip; not a stable column name.
  }
  return keys;
}

/**
 * Scan one source file for all write-call object literals targeting `table`.
 * Returns the union of top-level keys.
 *
 * Strategy: match table selector IMMEDIATELY followed by `.insert(`, `.upsert(`,
 * or `.update(` (whitespace permitted). This is the only safe association —
 * supabase-js insert/upsert/update are terminal-ish, never preceded by other
 * chained calls. Cross-statement false positives from greedy walking are
 * eliminated.
 */
function scanFileForTableWrites(src: string, table: string): Set<string> {
  const cols = new Set<string>();
  // Match: `.from('table')` OR `ownedDbTable('table')`, then optional ws/newlines,
  // then DIRECTLY `.insert(` | `.upsert(` | `.update(` followed by `{`.
  const re = new RegExp(
    `(?:\\.from\\(\\s*['"]${table}['"]\\s*\\)|\\bownedDbTable\\(\\s*['"]${table}['"]\\s*\\))` +
    `\\s*\\.(?:insert|upsert|update)\\s*\\(\\s*(?=\\{)`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // re's lookahead means the next char is '{'.
    const objOpen = m.index + m[0].length;
    if (src[objOpen] !== '{') continue;
    const objClose = findClosingBrace(src, objOpen);
    if (objClose < 0) continue;
    const keys = extractKeys(src.slice(objOpen + 1, objClose));
    for (const k of keys) {
      if (!RESERVED.has(k)) cols.add(k.toLowerCase());
    }
  }
  return cols;
}

interface DriftEntry {
  table: string;
  declared_count: number;
  used_count: number;
  missing_columns: string[];
  callsites: string[];
}

function main() {
  const bootstrap = readBootstrap();
  if (bootstrap.size === 0) {
    console.error('no bootstrap tables parsed');
    process.exit(2);
  }

  const files = listSourceFiles(SCAN_ROOTS);
  if (files.length === 0) {
    console.error('no source files found');
    process.exit(2);
  }

  const usedByTable: Map<string, Set<string>> = new Map();
  const callsitesByTable: Map<string, string[]> = new Map();
  for (const t of STUB_TABLES) { usedByTable.set(t, new Set()); callsitesByTable.set(t, []); }

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const table of STUB_TABLES) {
      const found = scanFileForTableWrites(src, table);
      if (found.size > 0) {
        const merged = usedByTable.get(table)!;
        for (const c of found) merged.add(c);
        callsitesByTable.get(table)!.push(path.relative(process.cwd(), file));
      }
    }
  }

  const drift: DriftEntry[] = [];
  for (const table of STUB_TABLES) {
    const declared = bootstrap.get(table) ?? new Set<string>();
    const used = usedByTable.get(table)!;
    const missing: string[] = [];
    for (const c of used) {
      if (!declared.has(c)) missing.push(c);
    }
    if (missing.length > 0) {
      drift.push({
        table,
        declared_count: declared.size,
        used_count: used.size,
        missing_columns: missing.sort(),
        callsites: callsitesByTable.get(table)!,
      });
    }
  }

  const summary = {
    bootstrap_path: path.relative(process.cwd(), BOOTSTRAP_PATH),
    tables_checked: STUB_TABLES,
    files_scanned: files.length,
    drift_count: drift.length,
    drift,
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = drift.length > 0 ? 1 : 0;
}

main();
