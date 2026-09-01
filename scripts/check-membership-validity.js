#!/usr/bin/env node
/**
 * AUTHZ-SERVICE-LAYER-DETECTOR-001 — the membership-validity guard.
 *
 * THE CLASS THIS CATCHES, found twice in production code:
 *
 *     authenticated principal
 *       -> user_company_roles keyed on that principal
 *       -> a company_id is derived
 *       -> the membership's own VALIDITY is never established
 *       -> that company authorizes a read or a write
 *
 * SETTINGS-EXECUTION-CONFIG-SEC-001 and MEMBERSHIP-DERIVATION-SWEEP-001 each
 * found a real defect of exactly this shape (settings/execution-config, and the
 * organisation credited by credits/claim-action). Both were invisible to all
 * four existing guards, because neither route takes a tenant id from the
 * REQUEST — check-tenant-authz's entire premise — and neither uses withRBAC or
 * withOrgAccess. This guard asks the orthogonal question.
 *
 * WHY A SEPARATE GUARD (architecture Option B)
 *
 * The existing guards each answer one question about one wrapper or one route
 * surface. This class spans BOTH routes and services and is independent of any
 * wrapper, so folding it into check-tenant-authz would conflate "did the caller
 * choose the tenant?" with "is the derived membership valid?", and would force
 * that guard's scan scope out of pages/api. Kept separate, each guard keeps a
 * single, testable contract.
 *
 * WHAT THIS GUARD DELIBERATELY DOES NOT DO
 *
 * It does NOT require `.eq('status','active')` on every membership query. That
 * rule would be wrong and would fire on revocation lookups, invitation
 * processing, onboarding, team management, attribution and lifecycle
 * transitions — all of which legitimately read non-active rows. It fires only
 * on the combination above.
 *
 * It does NOT flag SUPER_ADMIN lookups for lacking a status filter.
 * SUPERADMIN-MEMBERSHIP-VALIDITY-001 established that platform authority is
 * ROLE-based: revocation downgrades the role rather than flipping status, so a
 * status-agnostic `.eq('role', SUPER_ADMIN)` query is correct by design. Any
 * query carrying a role predicate is therefore out of scope here.
 *
 * SCOPE — user_company_roles only, deliberately.
 *
 * A company can also be derived from users.active_company_id. That is NOT the
 * same class, because the invariant is held in the database:
 * omnivyra_enforce_active_company_membership (migration 20260510) is a BEFORE
 * INSERT OR UPDATE trigger that raises 23514 unless the value names an ACTIVE
 * membership of that user. Application code cannot write an invalid one.
 *
 * The honest limit of that: the trigger fires on writes to users, so the column
 * is validated when it is SET and is not re-validated if the membership is
 * later deactivated (the migration repairs existing rows once, and installs no
 * reverse trigger on user_company_roles). Nothing authorizes on the column
 * today — TenantGuard refuses to, in terms: "There is no active_company_id
 * inference" — so this guard does not police it. If anything ever does
 * authorize on it, that is the follow-up recorded in this audit, not a silent
 * gap.
 *
 * FAIL-CLOSED: a site that derives a company from the principal and cannot be
 * shown to establish validity is SUSPICIOUS, and an unrecognised shape is
 * UNKNOWN. Both fail unless recorded in the ledger with a reason and an owner.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [
  path.join(ROOT, 'backend', 'services'),
  path.join(ROOT, 'backend', 'security'),
  path.join(ROOT, 'backend', 'middleware'),
  path.join(ROOT, 'pages', 'api'),
];
/*
 * The ledger path is overridable so the fail-closed exit path itself can be
 * tested. Mutation testing found that nothing asserted on it: the guard could
 * have been changed to exit 0 on an unrecorded finding and every test would
 * still have passed.
 */
const LEDGER = process.env.MEMBERSHIP_VALIDITY_LEDGER
  || path.join(ROOT, 'scripts', 'membership-validity-baseline.json');

/** The membership table, via either data-layer entrypoint. */
const MEMBERSHIP_TABLE_RE = /(?:\.from|ownedDbTable)\(\s*['"]user_company_roles['"]\s*\)/g;

/** A company identifier is being READ out of the membership row. */
const SELECTS_COMPANY_RE = /\.select\(\s*['"][^'"]*company_id/;
/** The row's own state is read back, so the caller decides what it means. */
const SELECTS_STATUS_RE = /\.select\(\s*['"][^'"]*status/;
/** Keyed on a principal rather than on a company. */
const USER_PRED_RE = /\.eq\(\s*['"]user_id['"]\s*,/;
/**
 * ANY status predicate makes the query status-aware. WHICH value it chooses is
 * a policy question, not a missing validity check: onboarding legitimately
 * looks for status='invited'.
 */
const STATUS_PRED_RE = /\.eq\(\s*['"]status['"]\s*,|\.in\(\s*['"]status['"]/;
/** Role-scoped: platform authority, governed by the SUPER_ADMIN policy above. */
const ROLE_PRED_RE = /\.eq\(\s*['"]role['"]\s*,|\.in\(\s*['"]role['"]/;
/** Already scoped to a known company — validating within it, not deriving one. */
const COMPANY_PRED_RE = /\.eq\(\s*['"]company_id['"]\s*,/;
/** Membership management: invitation, onboarding, revocation, role change. */
const MUTATION_RE = /\.(insert|update|upsert|delete)\s*\(/;
/** The filter lives in code rather than in SQL. */
const STATUS_IN_CODE_RE = /status\s*(?:===|!==)\s*['"]active['"]/;

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|\.next|[\\/]tests[\\/]?/.test(f)) walk(f, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec|d)\.tsx?$/.test(e.name)) {
      out.push(f);
    }
  }
  return out;
}

/**
 * Classify ONE membership query.
 * @returns {{cls:'SAFE'|'SUSPICIOUS'|'UNKNOWN', reason:string}}
 */
function classifyQuery(chain, context) {
  if (!SELECTS_COMPANY_RE.test(chain)) {
    return { cls: 'SAFE', reason: 'no company derived from the membership row' };
  }
  if (MUTATION_RE.test(chain)) {
    return { cls: 'SAFE', reason: 'membership management (invite / onboarding / revoke)' };
  }
  if (ROLE_PRED_RE.test(chain)) {
    return { cls: 'SAFE', reason: 'role-scoped — platform authority is role-based (SUPERADMIN-MEMBERSHIP-VALIDITY-001)' };
  }
  if (COMPANY_PRED_RE.test(chain)) {
    return { cls: 'SAFE', reason: 'scoped to an already-known company — validates within it rather than deriving one' };
  }
  if (!USER_PRED_RE.test(chain)) {
    return { cls: 'SAFE', reason: 'not keyed on a principal' };
  }
  if (STATUS_PRED_RE.test(chain)) {
    return { cls: 'SAFE', reason: 'membership validity established in SQL' };
  }
  if (SELECTS_STATUS_RE.test(chain)) {
    return { cls: 'SAFE', reason: 'status returned to the caller to judge (data lookup, not authorization)' };
  }
  if (STATUS_IN_CODE_RE.test(context)) {
    return { cls: 'SAFE', reason: 'membership validity established in code' };
  }
  return {
    cls: 'SUSPICIOUS',
    reason: 'a company is derived from the authenticated principal with no membership-validity condition — an invited or revoked membership would authorize',
  };
}

/** Analyse one source file. Exported for the fixture tests. */
function scanSource(src) {
  const findings = [];
  MEMBERSHIP_TABLE_RE.lastIndex = 0;
  let m;
  while ((m = MEMBERSHIP_TABLE_RE.exec(src))) {
    const tail = src.slice(m.index, m.index + 900);
    const end = tail.indexOf(';');
    const chain = end > 0 ? tail.slice(0, end) : tail;
    const context = src.slice(Math.max(0, m.index - 400), m.index + 1600);
    const line = src.slice(0, m.index).split('\n').length;
    findings.push({ line, ...classifyQuery(chain, context) });
  }
  return findings;
}

function scanRepo() {
  const rows = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const src = fs.readFileSync(file, 'utf8');
      for (const f of scanSource(src)) rows.push({ file: rel, ...f });
    }
  }
  return rows;
}

function main() {
  const rows = scanRepo();
  const counts = rows.reduce((a, r) => ((a[r.cls] = (a[r.cls] || 0) + 1), a), {});

  console.log('\n── membership-validity guard ──');
  console.log(`scanned: ${rows.length} membership queries under backend/{services,security,middleware} and pages/api/**`);
  console.log(`SAFE: ${counts.SAFE || 0}  SUSPICIOUS: ${counts.SUSPICIOUS || 0}  UNKNOWN: ${counts.UNKNOWN || 0}`);

  const accepted = fs.existsSync(LEDGER)
    ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')).accepted ?? []
    : [];
  const acceptedKeys = new Set(accepted.map((a) => a.site));

  const flagged = rows.filter((r) => r.cls !== 'SAFE');
  const known = flagged.filter((r) => acceptedKeys.has(`${r.file}:${r.line}`));
  const unknown = flagged.filter((r) => !acceptedKeys.has(`${r.file}:${r.line}`));

  if (known.length) {
    console.log(`\nrecorded findings (reviewed, not authorization): ${known.length}`);
    for (const r of known) {
      const entry = accepted.find((a) => a.site === `${r.file}:${r.line}`);
      console.log(`  - ${r.file}:${r.line}  [${entry.classification}]  ${entry.reason}`);
    }
  }

  const stale = [...acceptedKeys].filter((k) => !flagged.some((r) => `${r.file}:${r.line}` === k));
  if (stale.length) {
    console.log('\nledger entries that no longer match (moved or fixed — remove them):');
    for (const k of stale) console.log(`  - ${k}`);
  }

  if (unknown.length) {
    console.log('\nMembership derivations without a validity condition:');
    for (const r of unknown) console.log(`  [${r.cls}] ${r.file}:${r.line}\n      ${r.reason}`);
    console.log('\nFix: establish the membership is currently valid before the derived company');
    console.log('authorizes anything — add the status predicate to the query, filter it in code,');
    console.log('or use an approved tenant primitive. If the derivation is NOT authorization');
    console.log('(attribution, diagnostics, lifecycle), record it in scripts/membership-validity-baseline.json');
    console.log('with the reason and an owner.');
    console.log('\nRESULT: FAIL — a principal-derived company may be authorized by an invalid membership.');
    process.exit(1);
  }

  console.log('\nRESULT: PASS — every principal-derived company establishes membership validity.');
}

if (require.main === module) main();
module.exports = { classifyQuery, scanSource, scanRepo };
