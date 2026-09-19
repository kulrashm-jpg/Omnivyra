#!/usr/bin/env node
/**
 * Migration quality gate (ENG-IMPL-002) — PREVENTATIVE, new-migrations-only.
 *
 * Enforces, for migrations authored AFTER this gate landed:
 *   1. Naming — unique full `YYYYMMDDHHMMSS_<slug>.sql` timestamp prefix.
 *      Rejects the legacy date-only `YYYYMMDD_*` format that caused the
 *      historical collisions (ENG-AUDIT-002), and rejects any prefix that
 *      collides with an existing migration's version.
 *   2. Idempotency — additive statements must be guarded so re-application is
 *      safe: CREATE TABLE / CREATE [UNIQUE] INDEX / ADD COLUMN require
 *      `IF NOT EXISTS`.
 *   3. Ordering (STEP 3AH-91) — a migration added after the ordering snapshot
 *      (scripts/migrations/ordering-baseline.txt) must sort AFTER every
 *      snapshotted migration. Otherwise a new file named with an earlier
 *      timestamp would (a) skip the security rules, which are keyed on the
 *      version, and (b) be silently skipped or applied out of order by
 *      `supabase db push`.
 *   4. Anonymous / cross-tenant exposure (migrations >= SECURITY_RULES_FROM,
 *      STEP 3AH-70, strengthened in STEP 3AH-91; also EVERY migration added
 *      after the ordering snapshot, whatever its name). Supabase grants ALL on
 *      every new public table, and EXECUTE on every new function, to
 *      authenticated (and, before 20261026000000, anon), and PostgREST serves
 *      them to anyone holding the publishable key / any signed-up user. So:
 *        a. every CREATE TABLE in public must ENABLE ROW LEVEL SECURITY on that
 *           table in the same migration — including tables created inside a
 *           DO $$…$$ block or an EXECUTE string (a dynamic `%I` name needs
 *           ENABLE ROW LEVEL SECURITY in the same block);
 *        b. every SECURITY DEFINER function (CREATE, or ALTER … SECURITY
 *           DEFINER) must REVOKE EXECUTE … FROM PUBLIC, anon AND authenticated
 *           in the same migration (it runs as the owner and bypasses RLS;
 *           authenticated still receives EXECUTE through default privileges).
 *           A function meant for signed-in clients grants it back explicitly
 *           with an annotated GRANT (rule d). It must also pin its
 *           search_path (`SET search_path = …` in the definition, or ALTER …
 *           SET search_path in the same migration; else `-- search-path-ok:
 *           <reason>`), STEP 3AH-91 SEC91-INT-C7G;
 *        c. a public VIEW must be `WITH (security_invoker = true)` (or revoke
 *           anon/authenticated); a MATERIALIZED VIEW (cannot be
 *           security_invoker, has no RLS) must revoke anon/authenticated;
 *           `ALTER VIEW … SET (security_invoker = false)` / RESET is flagged;
 *        d. privilege-widening statements need an explicit, reviewed
 *           annotation on the line above:
 *             GRANT … TO anon|authenticated|PUBLIC (incl. ALTER DEFAULT
 *             PRIVILEGES … GRANT, and dynamic grantees)   → `-- grant-ok: <reason>`
 *             ALTER TABLE … DISABLE / NO FORCE ROW LEVEL SECURITY
 *                                                        → `-- rls-disable-ok: <reason>`
 *             ALTER POLICY … TO anon|public, or to (true) → `-- rls-public-ok: <reason>`
 *        e. a policy that grants anon/public/authenticated unconditional access
 *           (USING (true) / WITH CHECK (true)) needs `-- rls-public-ok: <reason>`
 *           on the line above it (any signed-up user is a member of
 *           `authenticated`, so `TO authenticated USING (true)` is cross-tenant).
 *      Revokes, `ALTER FUNCTION … SET search_path`, and grants to service_role
 *      are never flagged.
 *
 * Historical migrations are IMMUTABLE. The set of files that existed when this
 * gate landed is frozen in scripts/migrations/historical-baseline.txt; every
 * file in that list is skipped (no retroactive failures, no history rewrite).
 * Only top-level `supabase/migrations/*.sql` files ABSENT from the baseline are
 * validated. Subdirectory companions (rollback.sql / verification.sql) are
 * intentionally exempt — rollback files are deliberately non-idempotent.
 *
 * Deterministic, read-only, no DB / network / secrets. Identical local and CI
 * execution. Exit 0 = clean; exit 1 = violations (actionable diagnostics).
 */
const fs = require('fs');
const path = require('path');

const MIG_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const BASELINE = path.join(process.cwd(), 'scripts', 'migrations', 'historical-baseline.txt');
const ORDERING_BASELINE = path.join(process.cwd(), 'scripts', 'migrations', 'ordering-baseline.txt');
// Frozen shape of ordering-baseline.txt (STEP 3AH-91, main@f44b1387).
const ORDERING_SNAPSHOT = { count: 415, floor: '20261026000000' };
const NEW_NAME_RE = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const LEGACY_DATE_RE = /^\d{8}_/;

function listSql(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rp = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listSql(path.join(dir, e.name), rp));
    else if (e.name.endsWith('.sql')) out.push(rp);
  }
  return out;
}

function versionPrefix(name) {
  const m = path.basename(name).match(/^(\d+)/);
  return m ? m[1] : null;
}

function readList(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#')));
}

// Idempotency checks — high-confidence, low-false-positive. Each returns the
// 1-indexed line of the first offending statement, or null.
function idempotencyViolations(sql) {
  const v = [];
  const lines = sql.split('\n');
  lines.forEach((line, i) => {
    const l = line.replace(/--.*$/, ''); // strip line comments
    if (/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i.test(l))
      v.push({ line: i + 1, rule: 'CREATE TABLE must use IF NOT EXISTS', text: line.trim() });
    if (/\bCREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?!IF\s+NOT\s+EXISTS)/i.test(l))
      v.push({ line: i + 1, rule: 'CREATE INDEX must use IF NOT EXISTS', text: line.trim() });
    if (/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i.test(l))
      v.push({ line: i + 1, rule: 'ADD COLUMN must use IF NOT EXISTS', text: line.trim() });
  });
  return v;
}

/**
 * Ordering (STEP 3AH-91): every migration that is not in the ordering snapshot
 * (nor the historical baseline) must sort after the latest snapshotted one.
 * `files` are top-level migration file names; returns violation strings.
 */
function orderingViolations(files, frozen) {
  let floor = '';
  for (const f of frozen) {
    const p = versionPrefix(f);
    if (p && p.length === 14 && p > floor) floor = p;
  }
  const out = [];
  for (const f of files) {
    if (frozen.has(f)) continue;
    const p = versionPrefix(f);
    if (!p || p.length !== 14) continue; // naming rule reports it
    if (floor && p <= floor) {
      out.push(`${f}\n    ✗ out-of-order version ${p} — new migrations must sort after the latest existing migration (${floor}). ` +
        'An earlier timestamp skips version-keyed checks and is applied out of order (or skipped) by `supabase db push`.');
    }
  }
  return { floor, violations: out };
}

// Security rules apply from the anonymous-exposure fix onward; earlier migrations
// were remediated in bulk by 20261026000000_close_anon_rls_exposure.sql.
const SECURITY_RULES_FROM = '20261026000000';

// Length-preserving strippers: offsets (and so line numbers and annotations)
// in the stripped text map 1:1 onto the original migration.
const blank = (s) => s.replace(/[^\n]/g, ' ');
const stripSqlComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/--[^\n]*/g, blank);
// Remove dollar-quoted bodies ($$...$$ / $tag$...$tag$) so words inside function bodies never match.
const stripDollarBodies = (sql) => sql.replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, blank);
const lineOf = (sql, idx) => sql.slice(0, idx).split('\n').length;
const tableName = (raw) => raw.replace(/"/g, '').toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CLIENT_ROLES = ['anon', 'authenticated', 'public'];

/** An annotation `-- <token>: <reason>` on the statement's line or the two lines above. */
function annotated(lines, ln, token) {
  const around = lines.slice(Math.max(0, ln - 3), ln).join('\n');
  return new RegExp(`--\\s*${token}:\\s*\\S`).test(around);
}

/** Role names in a grantee/revokee list (`anon, "authenticated", PUBLIC WITH GRANT OPTION`). */
function roleList(text) {
  return text.replace(/\bWITH\s+GRANT\s+OPTION\b|\bGRANTED\s+BY\b[\s\S]*$|\bCASCADE\b|\bRESTRICT\b/gi, ' ')
    .split(',').map((r) => r.trim().replace(/^GROUP\s+/i, '').replace(/"/g, '').toLowerCase()).filter(Boolean);
}

/** [start, end) of the dollar-quoted block containing idx, or null. */
function enclosingDollarBlock(sql, idx) {
  for (const m of sql.matchAll(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g)) {
    if (m.index <= idx && idx < m.index + m[0].length) return [m.index, m.index + m[0].length];
  }
  return null;
}

/** Roles REVOKEd from an object in this migration: kind = FUNCTION|TABLE (views/MVs are TABLE). */
function revokedRoles(sql, kind, name) {
  const roles = new Set();
  const objRe = kind === 'FUNCTION' ? '(?:FUNCTION|PROCEDURE|ROUTINE)' : '(?:TABLE\\s+)?';
  const re = new RegExp(`\\bREVOKE\\s+[^;]*?\\bON\\s+${objRe}\\s*(?:"?public"?\\.)?"?${esc(name)}"?(?![\\w])[^;]*?\\bFROM\\s+([^;]*)`, 'gi');
  for (const m of sql.matchAll(re)) roleList(m[1]).forEach((r) => roles.add(r));
  const all = new RegExp(`\\bREVOKE\\s+[^;]*?\\bON\\s+ALL\\s+${kind === 'FUNCTION' ? '(?:FUNCTIONS|ROUTINES)' : 'TABLES'}\\s+IN\\s+SCHEMA\\s+"?public"?[^;]*?\\bFROM\\s+([^;]*)`, 'gi');
  for (const m of sql.matchAll(all)) roleList(m[1]).forEach((r) => roles.add(r));
  return roles;
}

function securityViolations(sql) {
  const v = [];
  const lines = sql.split('\n');
  const nc = stripSqlComments(sql); // comments blanked, dollar bodies + strings kept
  const clean = stripDollarBodies(nc); // top-level statements only
  const push = (idx, rule, text) => v.push({ line: lineOf(sql, idx), rule, text: String(text).split('\n')[0].trim().slice(0, 160) });

  // (a) CREATE TABLE public.X → ENABLE ROW LEVEL SECURITY on X. Scanned over
  //     the comment-stripped text WITH dollar bodies and strings, so a table
  //     created inside DO $$…$$ or by EXECUTE '…' is not invisible.
  const createRe = /\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(TEMP\s+|TEMPORARY\s+)?(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(;]+)/gi;
  for (const m of nc.matchAll(createRe)) {
    if (m[1]) continue; // temporary tables are session-local, never exposed
    const token = m[2];
    const dynamic = /[%'|$]/.test(token.replace(/^"?public"?\./i, '').replace(/^'/, '')) || /^'?\s*$/.test(token);
    if (dynamic) {
      const schema = token.replace(/^'/, '').match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?\./);
      if (schema && schema[1].toLowerCase() !== 'public') continue;
      const block = enclosingDollarBlock(nc, m.index);
      const scope = block ? nc.slice(block[0], block[1]) : nc;
      if (!/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(scope)) {
        push(m.index, 'dynamically-named public table (CREATE TABLE via EXECUTE/format) must ENABLE ROW LEVEL SECURITY in the same block', m[0]);
      }
      continue;
    }
    const full = tableName(token.replace(/^'/, ''));
    if (full.includes('.') && !full.startsWith('public.')) continue;
    const name = full.replace(/^public\./, '');
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) continue;
    const rls = new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(?:"?public"?\\.)?"?${esc(name)}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    // Search comment-stripped SQL WITH dollar bodies: RLS is often enabled inside a DO block.
    if (!rls.test(nc)) {
      push(m.index, `table public.${name} must ENABLE ROW LEVEL SECURITY in the same migration (authenticated is granted ALL by default)`, m[0]);
    }
  }

  // (b) SECURITY DEFINER function → REVOKE EXECUTE … FROM PUBLIC, anon, authenticated.
  const definers = [];
  const fnRe = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+((?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)\s*\(/gi;
  for (const m of clean.matchAll(fnRe)) {
    const rest = nc.slice(m.index);
    const body = rest.match(/(\$[A-Za-z_]*\$)[\s\S]*?\1/);
    const end = body ? rest.indexOf(';', body.index + body[0].length) : rest.indexOf(';');
    const stmt = stripDollarBodies(rest.slice(0, end < 0 ? undefined : end + 1));
    if (!/\bSECURITY\s+DEFINER\b/i.test(stmt)) continue;
    definers.push({ idx: m.index, raw: m[1], text: m[0], stmt });
  }
  const alterFnRe = /\bALTER\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+((?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)[^;]*?\bSECURITY\s+DEFINER\b[^;]*;/gi;
  for (const m of clean.matchAll(alterFnRe)) definers.push({ idx: m.index, raw: m[1], text: m[0], stmt: m[0] });
  for (const d of definers) {
    const full = tableName(d.raw);
    if (full.includes('.') && !full.startsWith('public.')) continue;
    const name = full.replace(/^public\./, '');
    const revoked = revokedRoles(clean, 'FUNCTION', name);
    const missing = ['public', 'anon', 'authenticated'].filter((r) => !revoked.has(r));
    if (missing.length) {
      push(d.idx, `SECURITY DEFINER function public.${name} must REVOKE EXECUTE … FROM PUBLIC, anon, authenticated (missing: ${missing.join(', ')}); `
        + 'grant back only the roles that need it (a grant to a client role needs `-- grant-ok: <reason>`)', d.text);
    }
    // (b2) STEP 3AH-91 (SEC91-INT-C7G): a SECURITY DEFINER routine must pin its
    //      search_path — in its own CREATE/ALTER statement or by an ALTER … SET
    //      search_path in the same migration. Without it, a later CREATE OR
    //      REPLACE silently re-opens the mutable-search_path class (SEC91-C7/M7).
    const pinnedHere = /\bSET\s+search_path\b/i.test(d.stmt || '');
    const pinnedByAlter = new RegExp(`\\bALTER\\s+(?:FUNCTION|PROCEDURE|ROUTINE)\\s+(?:"?public"?\\.)?"?${esc(name)}"?(?![\\w])[^;]*?\\bSET\\s+search_path\\b`, 'i').test(clean);
    if (!pinnedHere && !pinnedByAlter && !annotated(lines, lineOf(sql, d.idx), 'search-path-ok')) {
      push(d.idx, `SECURITY DEFINER function public.${name} must pin its search_path (\`SET search_path = public, extensions, pg_temp\` in the definition, or ALTER FUNCTION … SET search_path in the same migration; else \`-- search-path-ok: <reason>\`)`, d.text);
    }
  }

  // (c) views: security_invoker or revoked; materialized views: revoked.
  const viewRe = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(TEMP\s+|TEMPORARY\s+)?(?:RECURSIVE\s+)?(MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)([^;]*?)\bAS\b/gi;
  for (const m of clean.matchAll(viewRe)) {
    if (m[1]) continue;
    const full = tableName(m[3]);
    if (full.includes('.') && !full.startsWith('public.')) continue;
    const name = full.replace(/^public\./, '');
    const ln = lineOf(sql, m.index);
    if (annotated(lines, ln, 'view-definer-ok')) continue;
    const revoked = revokedRoles(clean, 'TABLE', name);
    const closed = revoked.has('anon') && revoked.has('authenticated');
    if (m[2]) {
      if (!closed) push(m.index, `materialized view public.${name} has no RLS and cannot be security_invoker — REVOKE ALL ON public.${name} FROM anon, authenticated in the same migration (or \`-- view-definer-ok: <reason>\`)`, m[0]);
      continue;
    }
    const invokerOpt = /\bsecurity_invoker\s*(?:=\s*)?(?:true|on|1|yes)?\s*(?:[,)])/i.test(m[4]) && !/\bsecurity_invoker\s*=\s*(?:false|off|0|no)\b/i.test(m[4]);
    const invokerAlter = new RegExp(`\\bALTER\\s+VIEW\\s+(?:IF\\s+EXISTS\\s+)?(?:"?public"?\\.)?"?${esc(name)}"?\\s+SET\\s*\\([^)]*\\bsecurity_invoker\\s*(?:=\\s*(?:true|on|1|yes))?\\s*[,)]`, 'i').test(clean);
    if (!invokerOpt && !invokerAlter && !closed) {
      push(m.index, `view public.${name} runs with its owner's privileges (bypasses RLS) — create it WITH (security_invoker = true), or REVOKE ALL ON public.${name} FROM anon, authenticated (or \`-- view-definer-ok: <reason>\`)`, m[0]);
    }
  }
  for (const m of clean.matchAll(/\bALTER\s+VIEW\s+[^;]*?(?:\bSET\s*\([^)]*\bsecurity_invoker\s*=\s*(?:false|off|0|no)\b|\bRESET\s*\([^)]*\bsecurity_invoker\b)[^;]*;/gi)) {
    if (annotated(lines, lineOf(sql, m.index), 'view-definer-ok')) continue;
    push(m.index, 'ALTER VIEW turns security_invoker off (the view then bypasses RLS) — add `-- view-definer-ok: <reason>` or keep it invoker', m[0]);
  }

  // (d) privilege-widening statements (scanned INCLUDING dollar bodies and
  //     EXECUTE strings: `EXECUTE 'GRANT … TO anon'` widens exactly the same).
  for (const m of nc.matchAll(/\bGRANT\b([^;]*?)\bTO\b([^;]*)/gi)) {
    const head = m[1];
    // Inside an EXECUTE string the grantee list ends at the closing quote.
    const granteeText = m[2].split("'")[0];
    const dynamic = /%[IsL]/.test(granteeText);
    const hits = roleList(granteeText).filter((r) => CLIENT_ROLES.includes(r));
    if (!hits.length && !dynamic) continue;
    const ln = lineOf(sql, m.index);
    if (annotated(lines, ln, 'grant-ok')) continue;
    const before = nc.slice(Math.max(0, m.index - 200), m.index);
    const isDefault = /\bALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*$/i.test(before);
    const what = isDefault ? 'ALTER DEFAULT PRIVILEGES … GRANT' : 'GRANT';
    const who = dynamic ? 'a dynamic grantee (%I/%s)' : hits.join(', ');
    push(m.index, `${what} … TO ${who} widens client-role access — add \`-- grant-ok: <reason>\` on the line above (or grant only service_role)`, `GRANT${head}TO${m[2]}`);
  }
  for (const m of nc.matchAll(/\bALTER\s+TABLE\b[^;]*?\b(DISABLE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/gi)) {
    if (annotated(lines, lineOf(sql, m.index), 'rls-disable-ok')) continue;
    push(m.index, `ALTER TABLE … ${m[1].toUpperCase().replace(/\s+/g, ' ')} ROW LEVEL SECURITY removes the RLS boundary — add \`-- rls-disable-ok: <reason>\` on the line above`, m[0]);
  }
  for (const m of nc.matchAll(/\bALTER\s+POLICY\b[^;]*;?/gi)) {
    const stmt = m[0];
    const toClause = (stmt.match(/\bTO\s+([^;]*?)(?=\bUSING\b|\bWITH\s+CHECK\b|;|'|$)/i) || [])[1];
    const widensRole = toClause && roleList(toClause).some((r) => r === 'anon' || r === 'public');
    const unconditional = /\bUSING\s*\(\s*true\s*\)/i.test(stmt) || /\bWITH\s+CHECK\s*\(\s*true\s*\)/i.test(stmt);
    const clientTarget = !toClause || roleList(toClause).some((r) => CLIENT_ROLES.includes(r));
    if (!widensRole && !(unconditional && clientTarget)) continue;
    if (annotated(lines, lineOf(sql, m.index), 'rls-public-ok')) continue;
    push(m.index, 'ALTER POLICY widens a policy to anon/public or to unconditional (true) access — add `-- rls-public-ok: <reason>` on the line above', stmt);
  }

  // (e) unconditional anon/public/authenticated policies need an explicit, reviewed justification.
  for (const m of nc.matchAll(/\bCREATE\s+POLICY\b[\s\S]*?;/gi)) {
    const stmt = m[0];
    const toClause = (stmt.match(/\bTO\s+([^;]*?)(?=\bUSING\b|\bWITH\s+CHECK\b|;)/i) || [])[1];
    const clientTarget = !toClause || roleList(toClause).some((r) => CLIENT_ROLES.includes(r));
    const unconditional = /\bUSING\s*\(\s*true\s*\)/i.test(stmt) || /\bWITH\s+CHECK\s*\(\s*true\s*\)/i.test(stmt);
    if (!clientTarget || !unconditional) continue;
    const ln = lineOf(sql, m.index);
    if (!annotated(lines, ln, 'rls-public-ok')) {
      push(m.index, 'policy grants anon/public/authenticated unconditional access (USING/WITH CHECK true) — add `-- rls-public-ok: <reason>` above it or scope it to a role/condition', stmt);
    }
  }
  return v;
}

function main() {
  if (!fs.existsSync(MIG_DIR)) { console.log('[migration-quality] no supabase/migrations — skip'); process.exitCode = 0; return; }
  const baseline = readList(BASELINE);
  const ordering = readList(ORDERING_BASELINE);
  const frozen = new Set([...baseline, ...ordering]);
  const all = listSql(MIG_DIR);
  const allPrefixes = new Map(); // prefix -> [files]
  for (const f of all) {
    const p = versionPrefix(f);
    if (p) { if (!allPrefixes.has(p)) allPrefixes.set(p, []); allPrefixes.get(p).push(f); }
  }

  // New = top-level .sql not in the frozen baseline.
  const newFiles = all.filter((f) => !baseline.has(f) && !f.includes('/'));
  const errors = [];

  // 3. Ordering — against the 3AH-91 snapshot. The snapshot is immutable:
  //    listing a new file in it would exempt that file from ordering.
  if (ordering.size !== ORDERING_SNAPSHOT.count) {
    errors.push(`scripts/migrations/ordering-baseline.txt\n    ✗ ordering snapshot modified (${ordering.size} entries, expected ${ORDERING_SNAPSHOT.count}) — it is frozen; new migrations are never added to it.`);
  }
  const order = orderingViolations(all.filter((f) => !f.includes('/')), frozen);
  if (ordering.size && order.floor !== ORDERING_SNAPSHOT.floor) {
    errors.push(`scripts/migrations/ordering-baseline.txt\n    ✗ ordering floor ${order.floor} != frozen ${ORDERING_SNAPSHOT.floor} — the snapshot is frozen.`);
  }
  errors.push(...order.violations);

  for (const f of newFiles) {
    const base = path.basename(f);
    // 1. Naming
    if (LEGACY_DATE_RE.test(base) && !NEW_NAME_RE.test(base)) {
      errors.push(`${f}\n    ✗ legacy date-only prefix — new migrations must use YYYYMMDDHHMMSS_<slug>.sql (14-digit timestamp).`);
    } else if (!NEW_NAME_RE.test(base)) {
      errors.push(`${f}\n    ✗ invalid filename — expected YYYYMMDDHHMMSS_<lower_snake>.sql.`);
    } else {
      // 2. Uniqueness — the 14-digit prefix must not collide with any OTHER migration.
      const p = versionPrefix(f);
      const others = (allPrefixes.get(p) || []).filter((x) => x !== f);
      if (others.length) {
        errors.push(`${f}\n    ✗ duplicate version prefix ${p} — also used by: ${others.join(', ')}. Use a unique timestamp.`);
      }
    }
    // 2b. Idempotency
    const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    for (const viol of idempotencyViolations(sql)) {
      errors.push(`${f}:${viol.line}\n    ✗ ${viol.rule}\n      ${viol.text}`);
    }
    // 4. Exposure — version-keyed, and for EVERY file added after the ordering
    //    snapshot whatever its name (an earlier timestamp never skips it).
    const ver = versionPrefix(f);
    const afterSnapshot = ordering.size > 0 && !frozen.has(f);
    if (afterSnapshot || (ver && ver.length === 14 && ver >= SECURITY_RULES_FROM)) {
      for (const viol of securityViolations(sql)) {
        errors.push(`${f}:${viol.line}\n    ✗ ${viol.rule}\n      ${viol.text}`);
      }
    }
  }

  const out = {
    event: 'migration_quality.check',
    historical_frozen: baseline.size,
    ordering_snapshot: ordering.size,
    ordering_floor: order.floor,
    total_migrations: all.length,
    new_migrations_validated: newFiles.length,
    violations: errors.length,
  };
  console.log(JSON.stringify(out));

  if (errors.length) {
    process.stderr.write('\n[migration-quality] VIOLATIONS in new migrations:\n\n');
    errors.forEach((e) => process.stderr.write('  ' + e + '\n\n'));
    process.stderr.write(
      'Fix: name new migrations YYYYMMDDHHMMSS_<slug>.sql with a unique timestamp later than every\n' +
      'existing migration, guard additive DDL with IF NOT EXISTS, and keep new objects closed to\n' +
      'anon/authenticated (RLS, REVOKE, security_invoker). See docs/migration-discipline.md.\n',
    );
    // process.exit() here would discard stderr still queued on a pipe (CI captures the gate through one),
    // truncating the violation list mid-stream. Set the status and let Node flush before it exits.
    process.exitCode = 1;
    return;
  }
  console.log(`[migration-quality] OK — ${newFiles.length} new migration(s) valid; ${baseline.size} historical frozen; ordering floor ${order.floor || 'n/a'}.`);
  process.exitCode = 0;
}

if (require.main === module) main();

module.exports = { securityViolations, idempotencyViolations, orderingViolations, SECURITY_RULES_FROM };
