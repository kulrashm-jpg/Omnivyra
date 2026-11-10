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
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MIG_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const ROLLBACK_DIR = path.join(MIG_DIR, 'rollbacks');
const BASELINE = path.join(process.cwd(), 'scripts', 'migrations', 'historical-baseline.txt');
const ORDERING_BASELINE = path.join(process.cwd(), 'scripts', 'migrations', 'ordering-baseline.txt');
const RESERVATIONS = path.join(process.cwd(), 'scripts', 'migrations', 'version-reservations.json');
const APPLIED_BOUNDARY = path.join(process.cwd(), 'scripts', 'migrations', 'applied-boundary.json');
const KNOWN_SET_NULL = path.join(process.cwd(), 'scripts', 'migrations', 'set-null-known-defects.json');
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

// ══════════════════════════════════════════════════════════════════════════
// GOV-H EXTENSIONS (2026-11-01) — rules 5-8.
//
// WHY THESE LIVE HERE rather than in a new script: rules 5-8 are all
// "read the migration file names and text in this checkout and decide whether
// a NEW migration is admissible". That is precisely the contract this gate
// already has (deterministic, read-only, no DB/network/secrets, identical
// locally and in CI) and it already runs in the one required status check on
// main ("Non-regression TypeScript baseline"). A separate script would need
// its own CI wiring, its own baseline handling and its own frozen-history
// logic, and would duplicate listSql/versionPrefix/readList.
//
// The catalog-level end-state detector is a DIFFERENT contract — it needs a
// schema model and optionally a database — and lives in
// scripts/ci/check-actor-fk-compatibility.js instead. Rule 8 here and that
// detector are not duplicates: rule 8 catches a contradiction an author writes
// INTO ONE FILE, at authoring time, with no database; the detector catches a
// contradiction ASSEMBLED ACROSS SEVERAL migrations, which no single-file rule
// can see.
// ══════════════════════════════════════════════════════════════════════════

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { __parseError: e.message }; }
}

const slugOf = (name) => path.basename(name).replace(/^\d+_/, '').replace(/\.sql$/, '');

/**
 * RULE 5 — CROSS-BRANCH VERSION COLLISION.
 *
 * THE HOLE THIS CLOSES. The uniqueness rule above compares a new migration
 * only with the files in THIS checkout. It therefore cannot see a version
 * claimed by a sibling branch, and it is blind to a version that exists only
 * as an UNCOMMITTED file in another worktree. That is not hypothetical: three
 * independent branches each claimed 20270110000000 (PPO
 * `pi_prospect_problem_actor_fk_removal`, SEC-A
 * `canonical_leads_users_client_privileges_revoked`, and media H-3
 * `media_h3_storage_quarantine_policies`). At the SEC-A commit the tree held
 * exactly one file at that version, so this gate passed. The collision was
 * resolved by renumbering the two UNMERGED migrations — never the merged one.
 *
 * The committed registry is the durable half: once a branch records its claim,
 * every branch that rebases sees it, and a second claim on the same version
 * fails here. `--scan-refs` is the pre-integration half (see scanRefs).
 *
 * A reservation is matched on version AND slug, so "reserved to track X" cannot
 * be borrowed by an unrelated migration that happens to use the number.
 */
function reservationViolations(newFiles, reservations) {
  const out = [];
  if (!reservations || reservations.__parseError) {
    if (reservations && reservations.__parseError) {
      out.push(`scripts/migrations/version-reservations.json\n    ✗ unreadable (${reservations.__parseError}). A gate that cannot read its registry must fail, not pass.`);
    }
    return out;
  }
  const byVersion = new Map();
  for (const r of reservations.reservations || []) {
    if (byVersion.has(r.version)) {
      out.push(`scripts/migrations/version-reservations.json\n    ✗ version ${r.version} is registered twice — the registry itself is the collision.`);
    }
    byVersion.set(r.version, r);
  }
  for (const f of newFiles) {
    const v = versionPrefix(f);
    if (!v) continue;
    const r = byVersion.get(v);
    if (!r) continue;
    if (r.status === 'occupied_elsewhere') {
      out.push(`${f}\n    ✗ version ${v} is already occupied outside this checkout — ${r.owner}: ${r.note}. ` +
        'A version is claimed repository-wide, not per branch. Pick a free version and update ' +
        'scripts/migrations/version-reservations.json in the same change.');
      continue;
    }
    if (r.slug && slugOf(f) !== r.slug) {
      out.push(`${f}\n    ✗ version ${v} is reserved to ${r.owner} for slug '${r.slug}', but this file's slug is '${slugOf(f)}'. ` +
        'Either you are using someone else\'s reserved version, or the reservation needs updating in the same change.');
    }
  }
  return out;
}

/**
 * `--scan-refs` — the pre-integration collision scan. OFF by default and
 * never run in CI, because it needs the full ref graph and sibling worktrees,
 * neither of which a shallow CI checkout has. Keeping it opt-in is what lets
 * the default path keep its "no shelling out, identical everywhere" contract.
 *
 * Reads, for every local branch tip and every registered worktree (including
 * that worktree's UNCOMMITTED on-disk files — the case that actually bit):
 * which migration versions exist. Reports every version claimed by more than
 * one distinct slug. Report-only by design: another branch's duplicate is not
 * this branch's failure, it is an integration decision.
 */
function scanRefs(repoRoot) {
  const git = (args, cwd = repoRoot) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const claims = new Map(); // version -> Map<slug, Set<origin>>
  const record = (version, slug, origin) => {
    if (!version) return;
    if (!claims.has(version)) claims.set(version, new Map());
    const m = claims.get(version);
    if (!m.has(slug)) m.set(slug, new Set());
    m.get(slug).add(origin);
  };

  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])
    .split('\n').map((s) => s.trim()).filter(Boolean);
  for (const ref of refs) {
    let listing;
    try { listing = git(['ls-tree', '--name-only', ref, 'supabase/migrations/']); } catch { continue; }
    for (const line of listing.split('\n')) {
      const base = path.posix.basename(line.trim());
      if (!base.endsWith('.sql')) continue;
      record(versionPrefix(base), slugOf(base), `ref:${ref}`);
    }
  }

  // Worktrees — and crucially their UNCOMMITTED files, which no ref holds.
  let porcelain = '';
  try { porcelain = git(['worktree', 'list', '--porcelain']); } catch { /* none */ }
  const worktrees = porcelain.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9).trim());
  for (const wt of worktrees) {
    const dir = path.join(wt, 'supabase', 'migrations');
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.sql')) continue;
      record(versionPrefix(e.name), slugOf(e.name), `worktree:${wt}`);
    }
  }

  const collisions = [];
  for (const [version, bySlug] of claims) {
    if (bySlug.size < 2) continue;
    collisions.push({
      version,
      slugs: [...bySlug.keys()].sort(),
      origins: Object.fromEntries([...bySlug].map(([s, o]) => [s, [...o].sort()])),
    });
  }
  collisions.sort((a, b) => (a.version < b.version ? -1 : 1));
  return { versions_seen: claims.size, refs_scanned: refs.length, worktrees_scanned: worktrees.length, collisions };
}

/**
 * RULE 6 — HISTORICAL APPLIED-MIGRATION IMMUTABILITY.
 *
 * WHERE THE BOUNDARY LIVES, AND WHY THAT IS HONEST. The production ledger max
 * is DATA, in a database this gate must never connect to. So the boundary
 * cannot be read here; it can only be ATTESTED. scripts/migrations/applied-boundary.json
 * therefore records the LAST ATTESTED boundary with its provenance
 * (`ledger_max`, `attested_at`, `attested_from`, `evidence_class`) plus the
 * sha256 of every top-level migration at or below it.
 *
 * The claim this check makes is deliberately weaker than "nothing applied has
 * changed", and is therefore true: *nothing at or below the last attested
 * boundary has changed since that attestation*. It never asserts the
 * attestation is current.
 *
 * How it avoids becoming a lie as the ledger moves on:
 *   - it fails on any content change, deletion, or rename at or below the
 *     boundary (a rename is a deletion plus an unpinned addition);
 *   - a NEW file at or below the boundary fails: that is a migration numbered
 *     into already-applied history;
 *   - `staleness_versions` reports how many repository versions now sit above
 *     the boundary, so an attestation that has stopped tracking reality is
 *     visible in the gate's own output instead of silently narrowing coverage.
 *     Re-attesting is an operator step (a production ledger read, which is
 *     parent-gated) — not something this gate may do for itself.
 */
function immutabilityViolations(topLevelFiles, boundary, digestOf) {
  const out = [];
  if (!boundary) return { violations: out, checked: 0, boundary: null, staleVersions: 0 };
  if (boundary.__parseError) {
    out.push(`scripts/migrations/applied-boundary.json\n    ✗ unreadable (${boundary.__parseError}). A gate that cannot read its attestation must fail, not pass.`);
    return { violations: out, checked: 0, boundary: null, staleVersions: 0 };
  }
  const max = String(boundary.ledger_max || '');
  const digests = boundary.digests || {};
  const atOrBelow = topLevelFiles.filter((f) => {
    const v = versionPrefix(f);
    return v && v.length === String(max).length ? v <= max : v && v.length <= max.length;
  });
  // Compare on the SAME scale: a legacy 8-digit version is below any 14-digit
  // boundary whose first 8 digits are greater or equal.
  const below = topLevelFiles.filter((f) => {
    const v = versionPrefix(f);
    if (!v) return false;
    const a = v.padEnd(14, '0');
    return a <= max.padEnd(14, '0');
  });
  void atOrBelow;

  for (const f of below) {
    const expected = digests[f];
    const actual = digestOf(f);
    if (!expected) {
      out.push(`${f}\n    ✗ migration at version ${versionPrefix(f)} is at or below the attested applied boundary ` +
        `${max} but is NOT in the attestation — a new migration numbered into already-applied history, or an unpinned rename. ` +
        'Number it above the boundary.');
      continue;
    }
    if (expected !== actual) {
      out.push(`${f}\n    ✗ APPLIED MIGRATION MODIFIED. Version ${versionPrefix(f)} is at or below the attested applied ` +
        `boundary ${max}; its content hash changed (${expected.slice(0, 12)}… -> ${actual.slice(0, 12)}…). ` +
        'A migration that has already run in production is immutable: the database will never re-read it, so editing it ' +
        'only makes the repository disagree with reality. Remediate forward with a NEW migration.');
    }
  }
  const present = new Set(below);
  for (const f of Object.keys(digests)) {
    if (!present.has(f)) {
      out.push(`${f}\n    ✗ APPLIED MIGRATION DELETED OR RENAMED. It is pinned in the applied-boundary attestation ` +
        `(boundary ${max}) but is no longer at that path. Applied history is immutable; restore the file.`);
    }
  }
  const staleVersions = new Set(
    topLevelFiles.map(versionPrefix).filter((v) => v && v.padEnd(14, '0') > max.padEnd(14, '0')),
  ).size;
  return { violations: out, checked: below.length, boundary: max, staleVersions };
}

/**
 * RULE 6b — APPLIED-ABOVE-BOUNDARY IMMUTABILITY (design #18, 2026-11-10).
 *
 * Some migrations are applied in production OUT OF BAND (Management API, no
 * ledger row) at versions ABOVE the attested ledger tip. They are as immutable
 * as anything below the boundary, but they cannot go in `digests`: rule 6
 * reports every `digests` key that is not at or below `ledger_max` as DELETED,
 * so an above-boundary entry there would be reported deleted while present.
 * And `ledger_max` must NOT be raised to cover them: it is the attested ledger
 * tip, and raising it would assert that everything beneath it was applied.
 *
 * So they live in their own map, `applied_above_boundary`, keyed by filename,
 * each entry carrying its own provenance. Four rules, all scoped to that map:
 *   A1  the file's sha256 (over LF bytes) matches       -> APPLIED MIGRATION MODIFIED (above boundary)
 *   A2  the file exists at exactly that path             -> APPLIED MIGRATION DELETED OR RENAMED (above boundary)
 *   A3  every provenance field is present and non-empty  -> APPLIED-OUT-OF-BAND ENTRY INCOMPLETE
 *   A4  not also in `digests`, and version > ledger_max   -> APPLIED RECORD INCONSISTENT
 * A4 makes the record self-correcting: after a re-attestation raises the
 * boundary past an entry, that entry must MOVE into `digests`.
 *
 * DIGEST BASIS. The database ran the file's LF text. A Windows checkout may
 * carry CRLF (and a matching git blob id does NOT prove byte equality: eol=lf
 * cleans before hashing), so A1 hashes the file with CRLF normalised to LF and
 * the recorded sha256 must be computed over LF bytes
 * (`git -c core.autocrlf=false show <commit>:<path> | sha256sum`).
 *
 * With no `applied_above_boundary` key (schema_version 1 files) this rule is
 * silent, and rule 6 behaves exactly as before.
 */
const ABOVE_BOUNDARY_FIELDS = [
  'sha256', 'applied_at', 'operator', 'method', 'project_ref',
  'cluster_system_identifier', 'ledger_row', 'record', 'evidence_class',
];
const KNOWN_BOUNDARY_SCHEMAS = new Set([1, 2]);
const lfSha256 = (buf) => sha256(Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));

function aboveBoundaryViolations(topLevelFiles, boundary, readBytes) {
  const out = [];
  if (!boundary || boundary.__parseError) return { violations: out, checked: 0 };
  if (boundary.schema_version !== undefined && !KNOWN_BOUNDARY_SCHEMAS.has(boundary.schema_version)) {
    out.push(`scripts/migrations/applied-boundary.json\n    ✗ unknown schema_version ${JSON.stringify(boundary.schema_version)} ` +
      '(this gate understands 1 and 2). A gate that cannot interpret its attestation must fail, not pass.');
    return { violations: out, checked: 0 };
  }
  const above = boundary.applied_above_boundary;
  if (above === undefined) return { violations: out, checked: 0 };
  if (!above || typeof above !== 'object' || Array.isArray(above)) {
    out.push('scripts/migrations/applied-boundary.json\n    ✗ applied_above_boundary must be an object keyed by migration filename.');
    return { violations: out, checked: 0 };
  }
  const max = String(boundary.ledger_max || '').padEnd(14, '0');
  const digests = boundary.digests || {};
  const present = new Set(topLevelFiles);
  let checked = 0;
  for (const [f, entry] of Object.entries(above)) {
    // A4 — one record per file, on the correct side of the boundary.
    if (Object.prototype.hasOwnProperty.call(digests, f)) {
      out.push(`${f}\n    ✗ APPLIED RECORD INCONSISTENT. It is in both digests and applied_above_boundary; keep exactly one record.`);
    }
    const v = versionPrefix(f);
    if (!v || v.padEnd(14, '0') <= max) {
      out.push(`${f}\n    ✗ APPLIED RECORD INCONSISTENT. Version ${v || '(none)'} is not above the attested boundary ` +
        `${boundary.ledger_max}; at or below the boundary it belongs in digests, not applied_above_boundary.`);
    }
    // A3 — provenance is mandatory: "applied" is never asserted without it.
    const e = entry && typeof entry === 'object' ? entry : {};
    const missing = ABOVE_BOUNDARY_FIELDS.filter((k) => {
      const val = e[k];
      if (k === 'ledger_row') return typeof val !== 'boolean';
      if (k === 'sha256') return typeof val !== 'string' || !/^[0-9a-f]{64}$/.test(val);
      return typeof val !== 'string' || val.trim() === '';
    });
    if (missing.length) {
      out.push(`${f}\n    ✗ APPLIED-OUT-OF-BAND ENTRY INCOMPLETE. Missing or empty: ${missing.join(', ')}. ` +
        'An out-of-band application is recorded with its full provenance or not at all.');
    }
    // A2 — exact path.
    if (!present.has(f)) {
      out.push(`${f}\n    ✗ APPLIED MIGRATION DELETED OR RENAMED (above boundary). It is recorded as applied in production ` +
        'but is no longer at that path. Applied history is immutable; restore the file.');
      continue;
    }
    // A1 — content, over LF bytes.
    checked++;
    if (typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256)) {
      const actual = lfSha256(readBytes(f));
      if (actual !== e.sha256) {
        out.push(`${f}\n    ✗ APPLIED MIGRATION MODIFIED (above boundary). Recorded ${e.sha256.slice(0, 12)}… (LF bytes), ` +
          `now ${actual.slice(0, 12)}…. It has already run in production; remediate forward with a NEW migration.`);
      }
    }
  }
  return { violations: out, checked };
}

/**
 * RULE 7 — ROLLBACK COMPANION NAMING.
 *
 * THE HAZARD, ANSWERED DIRECTLY. Rollbacks live at
 * `supabase/migrations/rollbacks/<slug>_rollback.sql` with NO version prefix.
 * That is UNSAFE as soon as two differently-versioned migrations share a slug:
 * both rollbacks resolve to the SAME path. Two branches each adding one write
 * the same file, and whichever merges second either conflicts or — after a
 * rebase that takes "theirs" — silently replaces a rollback that belongs to a
 * different migration. Nothing in the filename records which version it undoes,
 * so the substitution is undetectable afterwards.
 *
 * This rule does not change the convention (that would rename 45 committed
 * files and is an owner decision). It removes the ambiguity the convention
 * depends on:
 *   - a NEW migration may not reuse a slug already used at another version;
 *   - every rollback file must resolve to exactly one top-level migration;
 *   - a rollback must be named `<slug>_rollback.sql`.
 */
function rollbackViolations(topLevelFiles, rollbackFiles, newFiles) {
  const out = [];
  const bySlug = new Map();
  for (const f of topLevelFiles) {
    const s = slugOf(f);
    if (!bySlug.has(s)) bySlug.set(s, []);
    bySlug.get(s).push(f);
  }
  const newSet = new Set(newFiles);
  for (const [slug, files] of bySlug) {
    if (files.length < 2) continue;
    if (!files.some((f) => newSet.has(f))) continue; // historical duplicates are frozen
    out.push(`${files.filter((f) => newSet.has(f)).join(', ')}\n    ✗ slug '${slug}' is already used by ${files.length} migrations ` +
      `(${files.sort().join(', ')}). Rollback companions are named '<slug>_rollback.sql' with NO version, so these ` +
      'would share one rollback path and silently overwrite each other. Use a distinct slug.');
  }
  for (const rb of rollbackFiles) {
    const base = path.basename(rb);
    if (!/^(?:\d{8}|\d{14})?_?[a-z0-9]+(?:_[a-z0-9]+)*_rollback\.sql$/.test(base)) {
      out.push(`supabase/migrations/rollbacks/${base}\n    ✗ invalid rollback name — expected '<slug>_rollback.sql' or ` +
        "'<version>_<slug>_rollback.sql' (lower_snake slug).");
      continue;
    }
    // BOTH forms are accepted, deliberately. 45 committed rollbacks on
    // origin/main carry no version prefix; at least one branch
    // (security/media-h3-fixes) uses
    // `20270111000000_media_h3_storage_quarantine_policies_rollback.sql`
    // instead. The version-prefixed form is the SAFER of the two — it is never
    // ambiguous — so rejecting it would be the wrong call, and renaming the 45
    // committed files is an owner decision, not this gate's.
    //
    // What the rule enforces is that whichever form is used, the rollback
    // resolves to exactly ONE migration.
    const versioned = /^(\d{8}|\d{14})_/.exec(base);
    if (versioned) {
      const slug = base.replace(/^\d+_/, '').replace(/_rollback\.sql$/, '');
      const owners = (bySlug.get(slug) || []).filter((f) => versionPrefix(f) === versioned[1]);
      if (owners.length === 0) {
        out.push(`supabase/migrations/rollbacks/${base}\n    ✗ orphan rollback — no top-level migration is '${versioned[1]}_${slug}.sql'. ` +
          'A version-prefixed rollback must name the exact migration it undoes.');
      }
      continue;
    }
    const slug = base.replace(/_rollback\.sql$/, '');
    const owners = bySlug.get(slug) || [];
    if (owners.length === 0) {
      out.push(`supabase/migrations/rollbacks/${base}\n    ✗ orphan rollback — no top-level migration has slug '${slug}'. ` +
        'Either the migration was renamed (so this rollback now undoes nothing) or the rollback is misnamed.');
    } else if (owners.length > 1) {
      out.push(`supabase/migrations/rollbacks/${base}\n    ✗ ambiguous rollback — slug '${slug}' is shared by ${owners.sort().join(', ')}. ` +
        'The filename carries no version, so which migration this undoes is undecidable. ' +
        `Rename it '${versionPrefix(owners.sort()[0])}_${slug}_rollback.sql' to say which one.`);
    }
  }
  return out;
}

/**
 * RULE 8 — FK / NOT NULL / CHECK CONTRADICTION WRITTEN INTO ONE MIGRATION.
 *
 * The DEFECT-008 class, caught at authoring time with no database. An
 * `ON DELETE SET NULL` foreign key promises to write NULL into a column; a
 * NOT NULL declaration, or a CHECK requiring the column non-NULL for some
 * rows, refuses it. Written into the same file, that is statically detectable.
 *
 * It is CODE_VERIFIED that this shape has been committed:
 * supabase/migrations/20261030000000_pi_prospect_archive_recommendations.sql
 * declares `reviewed_by_user_id uuid REFERENCES public.users (id) ON DELETE
 * SET NULL` at :63 and, at :90, a CHECK requiring it IS NOT NULL when status
 * is confirmed or rejected.
 *
 * Deliberately conservative — it only looks at columns this file itself gives
 * a SET NULL reference. Contradictions assembled across migrations are the
 * catalog detector's job. Escape hatch: `-- set-null-ok: <reason>`.
 */
/**
 * Table scopes in one migration: every CREATE TABLE body and every ALTER TABLE
 * statement, keyed by table name. Without this, a NOT NULL on `provider_id` in
 * one table was matched against a nullable `provider_id` in another table of
 * the same file — two false positives on origin/main
 * (20260906000000_ai_orchestration_foundation.sql, llm_models.provider_id vs
 * ai_execution_bindings.provider_id). ALTER TABLE statements INSIDE a
 * DO $$…$$ block are included deliberately: that is where composite tenant FKs
 * are added (20261031000000_pi_score_evaluations.sql).
 */
function tableScopes(nc) {
  const scopes = [];
  for (const m of nc.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[A-Za-z_]\w*"?\.)?"?([A-Za-z_]\w*)"?\s*\(/gi)) {
    const open = m.index + m[0].length - 1;
    let depth = 0; let end = nc.length;
    for (let i = open; i < nc.length; i++) {
      if (nc[i] === '(') depth++;
      else if (nc[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    scopes.push({ table: m[1].toLowerCase(), start: open + 1, end });
  }
  for (const m of nc.matchAll(/\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:"?[A-Za-z_]\w*"?\.)?"?([A-Za-z_]\w*)"?/gi)) {
    let depth = 0; let end = nc.length;
    for (let i = m.index; i < nc.length; i++) {
      if (nc[i] === '(') depth++;
      else if (nc[i] === ')') depth--;
      else if (nc[i] === ';' && depth === 0) { end = i; break; }
    }
    scopes.push({ table: m[1].toLowerCase(), start: m.index, end });
  }
  return scopes;
}

/** Balanced-paren slices of every CHECK (...) in `text`, with absolute offsets. */
function checkBodies(text, base) {
  const out = [];
  for (const m of text.matchAll(/\bCHECK\s*\(/gi)) {
    let depth = 0; let end = text.length;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    out.push({ offset: base + m.index, body: text.slice(m.index, end + 1) });
  }
  return out;
}

// Column-definition patterns. Regex LITERALS on purpose: these were first
// written as interpolated `new RegExp` templates and every escape in them was
// silently eaten, so the rule matched nothing and reported a clean run. A gate
// that cannot fail is worse than no gate, so the patterns stay literal.
const TYPE = '(?:uuid|bigint|integer|int|text|smallint|serial|bigserial|boolean|bool|numeric|jsonb|json|timestamptz|date|citext|character)';
const COL_SET_NULL_RE = new RegExp(
  String.raw`(^|[,(\n])\s{0,12}"?([a-z_][a-z0-9_]*)"?\s+` + TYPE +
  String.raw`\b([^,;()]*?)\bREFERENCES\s+[^,;]*?\bON\s+DELETE\s+SET\s+NULL\b`, 'gi');
const COL_NOT_NULL_RE = new RegExp(
  String.raw`(^|[,(\n])\s{0,12}"?([a-z_][a-z0-9_]*)"?\s+` + TYPE + String.raw`\b[^,;()]*\bNOT\s+NULL\b`, 'gi');
const ADD_COL_NOT_NULL_RE = new RegExp(
  String.raw`\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s+` + TYPE +
  String.raw`\b[^,;]*\bNOT\s+NULL\b`, 'gi');
/** `<col> IS NOT NULL` for one specific column, anywhere in a CHECK body. */
const colIsNotNullRe = (col) =>
  new RegExp(String.raw`(?:^|[^A-Za-z0-9_."])"?` + col.replace(/[^a-z0-9_]/gi, '') + String.raw`"?\s+IS\s+NOT\s+NULL`, 'i');

function setNullContradictions(sql) {
  const v = [];
  const lines = sql.split('\n');
  const nc = stripSqlComments(sql);
  const byTable = new Map();
  const scopeOf = (t) => {
    if (!byTable.has(t)) byTable.set(t, { setNull: new Map(), notNull: new Set(), checks: [] });
    return byTable.get(t);
  };

  for (const sc of tableScopes(nc)) {
    const text = nc.slice(sc.start, sc.end);
    const s = scopeOf(sc.table);

    // (a) inline column definition giving the column a SET NULL reference.
    for (const m of text.matchAll(COL_SET_NULL_RE)) {
      const col = m[2].toLowerCase();
      const abs = sc.start + m.index + m[1].length;
      if (/\bNOT\s+NULL\b/i.test(m[3] || '')) s.notNull.add(col);
      if (!s.setNull.has(col)) s.setNull.set(col, { offset: abs, text: m[0].replace(/\s+/g, ' ').trim().slice(0, 160) });
    }

    // (b) FOREIGN KEY (cols) REFERENCES … ON DELETE SET NULL [(cols)].
    //     Without a column list PostgreSQL nulls EVERY referencing column, so a
    //     composite tenant FK nulls the tenant column too. With a list (PG15)
    //     only the listed columns are nulled.
    for (const m of text.matchAll(/\bFOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES[^;]*?\bON\s+DELETE\s+SET\s+NULL\b\s*(?:\(([^)]*)\))?/gi)) {
      const nulled = (m[2] || m[1]).split(',').map((x) => x.trim().replace(/"/g, '').toLowerCase()).filter(Boolean);
      const abs = sc.start + m.index;
      for (const col of nulled) {
        if (!s.setNull.has(col)) s.setNull.set(col, { offset: abs, text: m[0].replace(/\s+/g, ' ').trim().slice(0, 160) });
      }
    }

    // NOT NULL declared for a column of THIS table.
    for (const m of text.matchAll(COL_NOT_NULL_RE)) s.notNull.add(m[2].toLowerCase());
    for (const m of text.matchAll(/\bALTER\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+SET\s+NOT\s+NULL\b/gi)) s.notNull.add(m[1].toLowerCase());
    for (const m of text.matchAll(ADD_COL_NOT_NULL_RE)) s.notNull.add(m[1].toLowerCase());

    s.checks.push(...checkBodies(text, sc.start));
  }

  for (const [table, s] of byTable) {
    for (const [col, info] of s.setNull) {
      const ln = lineOf(sql, info.offset);
      if (s.notNull.has(col) && !annotated(lines, ln, 'set-null-ok')) {
        v.push({
          line: ln,
          table,
          column: col,
          kind: 'set_null_on_not_null',
          rule: `ON DELETE SET NULL nulls ${table}.${col}, which this migration declares NOT NULL — the FK promises to write a NULL the column refuses, so deleting the referenced row raises 23502 and can never succeed. `
            + 'A composite FOREIGN KEY with no column list nulls EVERY referencing column, tenant key included. '
            + 'Make the column nullable, list only the nullable columns in ON DELETE SET NULL (col, …), drop the FK and validate the referent in the writer '
            + '(immutable actor attribution — see scripts/migrations/actor-field-registry.json), or use RESTRICT/NO ACTION. Else `-- set-null-ok: <reason>`.',
          text: info.text,
        });
      }
      for (const ch of s.checks) {
        if (!colIsNotNullRe(col).test(ch.body)) continue;
        const cln = lineOf(sql, ch.offset);
        if (annotated(lines, cln, 'set-null-ok') || annotated(lines, ln, 'set-null-ok')) continue;
        v.push({
          line: cln,
          table,
          column: col,
          kind: 'set_null_vs_check',
          rule: `CHECK requires ${table}.${col} IS NOT NULL for some rows, but this migration also gives that column an ON DELETE SET NULL foreign key — `
            + 'the delete then succeeds or fails depending on the row, and any row left NULL becomes permanently un-updatable (an UPDATE re-evaluates every table CHECK). '
            + 'This is the DEFECT-008 shape. Drop the FK and validate the referent in the writer, or use RESTRICT/NO ACTION. Else `-- set-null-ok: <reason>`.',
          text: ch.body.replace(/\s+/g, ' ').trim().slice(0, 160),
        });
      }
    }
  }
  v.sort((a, b) => a.line - b.line);
  return v;
}

function main() {
  if (!fs.existsSync(MIG_DIR)) { console.log('[migration-quality] no supabase/migrations — skip'); process.exitCode = 0; return; }
  if (process.argv.includes('--scan-refs')) {
    const report = scanRefs(process.cwd());
    console.log(JSON.stringify({ event: 'migration_quality.scan_refs', ...report }, null, 2));
    process.exitCode = 0;
    return;
  }
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

  // Rule 8's frozen acknowledgement list (GOV-H).
  const knownDefects = readJson(KNOWN_SET_NULL, { known: [] });
  const knownSetNull = new Map((knownDefects.known || []).map((k) => [k.key, k]));
  const knownSeen = new Set();

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
    // 8. FK / NOT NULL / CHECK contradiction (GOV-H).
    //    Pre-existing instances are FROZEN in set-null-known-defects.json, for a
    //    reason that is not cosmetic: every one of those files sits at or below
    //    the applied boundary, which rule 6 declares immutable. A gate that
    //    failed on files another rule forbids editing could never pass and would
    //    be turned off. Frozen entries are REPORTED, never ignored.
    for (const viol of setNullContradictions(sql)) {
      const key = `${path.basename(f)}:${viol.column}`;
      if (knownSetNull.has(key)) { knownSeen.add(key); continue; }
      errors.push(`${f}:${viol.line}\n    ✗ ${viol.rule}\n      ${viol.text}`);
    }
  }

  // 5. Cross-branch version reservations (GOV-H).
  const reservations = readJson(RESERVATIONS, null);
  errors.push(...reservationViolations(newFiles, reservations));

  // 6. Historical applied-migration immutability (GOV-H).
  const topLevel = all.filter((f) => !f.includes('/'));
  const immut = immutabilityViolations(
    topLevel,
    readJson(APPLIED_BOUNDARY, null),
    (f) => sha256(fs.readFileSync(path.join(MIG_DIR, f))),
  );
  errors.push(...immut.violations);

  // 6b. Applied-above-boundary immutability (design #18).
  const aboveB = aboveBoundaryViolations(
    topLevel,
    readJson(APPLIED_BOUNDARY, null),
    (f) => fs.readFileSync(path.join(MIG_DIR, f)),
  );
  errors.push(...aboveB.violations);

  // 7. Rollback companion naming (GOV-H).
  const rollbacks = fs.existsSync(ROLLBACK_DIR)
    ? fs.readdirSync(ROLLBACK_DIR).filter((f) => f.endsWith('.sql'))
    : [];
  errors.push(...rollbackViolations(topLevel, rollbacks, newFiles));

  // A freeze entry that no longer reproduces means the shape was fixed (or the
  // file moved). Failing here is what stops the list quietly growing into a
  // blanket suppression: an entry must be REMOVED once it stops reproducing.
  for (const key of knownSetNull.keys()) {
    if (!knownSeen.has(key)) {
      errors.push(`scripts/migrations/set-null-known-defects.json\n    ✗ frozen entry '${key}' no longer reproduces — ` +
        'the contradiction was fixed, or the migration was renamed. Remove the entry (and confirm the fix with ' +
        '`node scripts/ci/check-actor-fk-compatibility.js --db <replayed schema>`), so the freeze list keeps matching reality.');
    }
  }

  const out = {
    event: 'migration_quality.check',
    historical_frozen: baseline.size,
    ordering_snapshot: ordering.size,
    ordering_floor: order.floor,
    total_migrations: all.length,
    new_migrations_validated: newFiles.length,
    reserved_versions: reservations && reservations.reservations ? reservations.reservations.length : 0,
    applied_boundary: immut.boundary,
    applied_files_verified: immut.checked,
    versions_above_boundary: immut.staleVersions,
    applied_above_boundary_verified: aboveB.checked,
    rollback_companions: rollbacks.length,
    set_null_known_open: knownSeen.size,
    violations: errors.length,
  };
  console.log(JSON.stringify(out));

  // Known open items are printed every run, with their owner. They are
  // acknowledged, not forgiven.
  if (knownSeen.size) {
    process.stdout.write(`\n[migration-quality] ${knownSeen.size} KNOWN OPEN FK/NOT NULL/CHECK contradiction(s) ` +
      '(frozen in scripts/migrations/set-null-known-defects.json — remediate FORWARD, never by editing these files):\n');
    for (const key of [...knownSeen].sort()) {
      const k = knownSetNull.get(key);
      process.stdout.write(`  ${key}\n    ${k.classification} — owner: ${k.owner}\n`);
    }
    process.stdout.write('\n');
  }

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

module.exports = {
  securityViolations,
  idempotencyViolations,
  orderingViolations,
  SECURITY_RULES_FROM,
  // GOV-H (2026-11-01) — rules 5-8, each a pure function so it is testable
  // without a filesystem, a database or a git repository.
  reservationViolations,
  immutabilityViolations,
  aboveBoundaryViolations,
  rollbackViolations,
  setNullContradictions,
  scanRefs,
  slugOf,
};
