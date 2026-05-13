#!/usr/bin/env node
/**
 * check-schema-drift — AST-aware drift linter.
 *
 * Fails CI when code references a watched column that no migration in
 * `supabase/migrations/` actually creates. The Phase 2.B login-loop
 * incident root-caused to exactly this class of drift: code shipped that
 * SELECTed `users.status` before every environment had the migration.
 *
 * What this version does differently
 * ───────────────────────────────────
 * The first version of this script used a line-level regex. That caught
 * inline `.from('users').select('id, status')` but missed:
 *
 *   1. Imported projection constants:
 *        import { LIFECYCLE_USER_COLUMNS } from './userColumnProjection';
 *        await db.from('users').select(LIFECYCLE_USER_COLUMNS);
 *
 *   2. Local const projections:
 *        const COLS = 'id, status';
 *        await db.from('users').select(COLS);
 *
 *   3. Multi-line `.from(...).select(...)` chains spanning many lines.
 *
 * This version uses the TypeScript compiler API to:
 *   - Parse every TS/JS source file as an AST.
 *   - Find every `<expr>.select(<arg>)` call.
 *   - Walk back up the call chain to identify the table from `.from('X')`.
 *   - Resolve the select argument's value by:
 *       (a) string-literal inspection,
 *       (b) local const binding lookup,
 *       (c) ImportSpecifier resolution against
 *           `backend/services/userColumnProjection.ts`.
 *   - Flag a reference only when the value resolves to a real column
 *     string AND the column is in WATCHED_COLUMNS AND the migration
 *     manifest does not declare it.
 *
 * Unresolved references (dynamic select strings, computed projections we
 * can't follow) are ignored — the goal is high-signal, not exhaustive
 * coverage. The runtime tolerant-select helper handles anything we miss.
 *
 * Exit codes:
 *   0 — no drift detected.
 *   1 — at least one offending reference. Output lists file:line:col.
 *
 * Run from CI:
 *   npm run check:schema-drift
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const CODE_DIRS = ['backend', 'pages', 'modules', 'lib', 'components', 'shared'];
const PROJECTION_FILE = path.join(REPO_ROOT, 'backend', 'services', 'userColumnProjection.ts');

/** Tables whose columns are auth-spine load-bearing. */
const WATCHED_TABLES = new Set(['users', 'companies']);

/** Lifecycle-class columns we enforce drift checks on. */
const WATCHED_COLUMNS = new Set([
  'status',
  'session_revoked_after',
  'activated_at',
  'deleted_at',
]);

// ── Migration manifest ──────────────────────────────────────────────────────

function readMigrationManifest() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`No migrations directory at ${MIGRATIONS_DIR}`);
  }
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const manifest = new Map(); // table -> Map<column, sourceMigration>

  function ensure(table) {
    if (!manifest.has(table)) manifest.set(table, new Map());
    return manifest.get(table);
  }

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    // ALTER TABLE ... ADD COLUMN <col>
    const addColumnRegex = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)[\s\S]*?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
    let m;
    while ((m = addColumnRegex.exec(sql)) !== null) {
      const table = m[1];
      const col = m[2];
      if (!ensure(table).has(col)) ensure(table).set(col, file);
    }

    // CREATE TABLE [IF NOT EXISTS] <table> ( ... col type, ... )
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(/gi;
    while ((m = createTableRegex.exec(sql)) !== null) {
      const table = m[1];
      const start = createTableRegex.lastIndex;
      let depth = 1;
      let i = start;
      while (i < sql.length && depth > 0) {
        const ch = sql[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        i++;
      }
      const body = sql.slice(start, i - 1);
      const parts = [];
      let buf = '';
      let bdepth = 0;
      for (const ch of body) {
        if (ch === '(') bdepth++;
        else if (ch === ')') bdepth--;
        if (ch === ',' && bdepth === 0) { parts.push(buf); buf = ''; continue; }
        buf += ch;
      }
      if (buf.trim()) parts.push(buf);
      for (const part of parts) {
        const trimmed = part.trim();
        if (/^(?:CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE)\b/i.test(trimmed)) continue;
        const colMatch = trimmed.match(/^"?(\w+)"?/);
        if (colMatch && !ensure(table).has(colMatch[1])) ensure(table).set(colMatch[1], file);
      }
    }
  }
  return manifest;
}

// ── AST traversal ───────────────────────────────────────────────────────────

function walk(dir, results) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) results.push(full);
  }
}

/** Parse a file into an AST; returns null on failures the walker can skip. */
function parse(file) {
  const src = fs.readFileSync(file, 'utf8');
  return ts.createSourceFile(file, src, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
}

/**
 * Walk back through `.from('table').select(...)`-style chains. Given a
 * CallExpression like `.select(x)`, look at the LHS to find a `.from('y')`
 * earlier in the chain.
 */
function findTableForSelect(selectCall) {
  // selectCall.expression = <chain>.select
  // Inspect PropertyAccessExpression.expression to walk back.
  let cursor = selectCall.expression && selectCall.expression.expression;
  while (cursor) {
    if (ts.isCallExpression(cursor)) {
      const callee = cursor.expression;
      if (callee && ts.isPropertyAccessExpression(callee) && callee.name.text === 'from') {
        const first = cursor.arguments[0];
        if (first && ts.isStringLiteralLike(first)) return first.text;
        return null; // dynamic from()
      }
      cursor = cursor.expression && cursor.expression.expression;
      continue;
    }
    if (ts.isPropertyAccessExpression(cursor)) {
      cursor = cursor.expression;
      continue;
    }
    break;
  }
  return null;
}

/**
 * Resolve the `.select(arg)` argument to a string of column names, if we
 * can. Handles:
 *   - string literal: select('id, status')
 *   - identifier referencing a local `const X = 'id, status';`
 *   - identifier imported from backend/services/userColumnProjection.ts
 */
function resolveSelectArg(arg, sourceFile, projectionConstants) {
  if (!arg) return null;
  if (ts.isStringLiteralLike(arg)) return arg.text;

  if (ts.isIdentifier(arg)) {
    const name = arg.text;
    // Local const lookup — walk the source file's top-level statements.
    for (const stmt of sourceFile.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
        if (decl.initializer && ts.isStringLiteralLike(decl.initializer)) {
          return decl.initializer.text;
        }
        // `as const` wrapping: const X = 'a, b' as const
        if (decl.initializer && ts.isAsExpression(decl.initializer)
            && ts.isStringLiteralLike(decl.initializer.expression)) {
          return decl.initializer.expression.text;
        }
      }
    }
    // Imported projection lookup — match the symbol name against the
    // projection module's exports.
    if (projectionConstants.has(name)) return projectionConstants.get(name);
  }
  return null;
}

/** Parse projection constants from userColumnProjection.ts so the resolver
 *  above can follow `import { BASE_USER_COLUMNS } from ...`. */
function loadProjectionConstants() {
  const constants = new Map();
  if (!fs.existsSync(PROJECTION_FILE)) return constants;
  const sourceFile = parse(PROJECTION_FILE);
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (!stmt.modifiers || !stmt.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;
      let init = decl.initializer;
      if (init && ts.isAsExpression(init)) init = init.expression;
      if (init && ts.isStringLiteralLike(init)) {
        constants.set(name, init.text);
      }
    }
  }
  return constants;
}

// ── Analysis ────────────────────────────────────────────────────────────────

function findOffendingReferences(manifest) {
  const projectionConstants = loadProjectionConstants();
  const offenders = [];
  const files = [];
  for (const dir of CODE_DIRS) walk(path.join(REPO_ROOT, dir), files);

  for (const file of files) {
    if (file === PROJECTION_FILE) continue;          // projection helper itself defines the constants
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    if (file.includes(`${path.sep}generated${path.sep}`)) continue;
    if (file.endsWith('check-schema-drift.js')) continue;

    let sourceFile;
    try {
      sourceFile = parse(file);
    } catch {
      continue;
    }

    function visit(node) {
      if (ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'select') {
        const table = findTableForSelect(node);
        if (table && WATCHED_TABLES.has(table)) {
          const cols = resolveSelectArg(node.arguments[0], sourceFile, projectionConstants);
          if (cols) {
            for (const raw of cols.split(',')) {
              const col = raw.trim().split(/\s+/)[0];
              if (!WATCHED_COLUMNS.has(col)) continue;
              const declared = manifest.get(table);
              if (!declared || !declared.has(col)) {
                const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
                offenders.push({
                  file:   path.relative(REPO_ROOT, file),
                  line:   line + 1,
                  column: character + 1,
                  table,
                  col,
                });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }
  return offenders;
}

function main() {
  const manifest = readMigrationManifest();
  const offenders = findOffendingReferences(manifest);
  if (offenders.length === 0) {
    console.log('check-schema-drift: OK — every watched column reference has a matching migration.');
    process.exit(0);
  }
  console.error('check-schema-drift: FAIL — references to columns with no matching migration:');
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}:${o.column}  ${o.table}.${o.col}`);
  }
  console.error(
    '\nFix by either:\n' +
    '  1. Adding a migration that ALTER TABLE ... ADD COLUMN, OR\n' +
    '  2. Removing the code reference if the column is no longer needed.\n',
  );
  process.exit(1);
}

main();
