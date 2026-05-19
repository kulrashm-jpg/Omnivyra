/**
 * Phase 3.1 Task 3 — ENFORCE readiness pre-check (READ-ONLY, NO SIDE EFFECTS).
 *
 * Operator runs this BEFORE enabling the first canary ENFORCE org. It performs
 * only read-only queries + env/filesystem inspection. It NEVER mutates the
 * ledger, NEVER creates reservations, NEVER enables enforcement, and NEVER
 * runs billing. Exit 0 = all required checks PASS (GO); exit 1 = at least one
 * required check FAIL (NO-GO).
 *
 * Run:
 *   node scripts/phase2-enforce-readiness.js
 * with SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 * in the environment (e.g. loaded from .env.local for the target DB).
 *
 * Note: the partial indexes from 20260668 (CONCURRENTLY) are not introspectable
 * via PostgREST — they are listed as a MANUAL operator confirmation item, not
 * an automated check.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_CATALOG_ACTIONS = [
  'blog_generation', 'blog_rewrite_hook', 'blog_brief_suggestions',
  'content_repurpose', 'content_suggestions', 'quick_platform_adapt',
  'creator_content', 'chat_theme_refine', 'engagement_refine',
  'campaign_chat', 'campaign_suggest_update', 'campaign_suggest_duration',
  'campaign_preplanning', 'skeleton_command', 'async_campaign_planning',
  'recommendations_generate', 'recommendations_opportunities',
  'recommendations_preview_strategy', 'recommendations_group_preview',
];

const results = [];
function record(name, status, detail, required = true) {
  results.push({ name, status, detail, required });
}

function envTrue(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'on';
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ── Env / flag reachability (no mutation) ────────────────────────────────
  record(
    'PHASE2_LEDGER_LINK_COLUMN active',
    envTrue(process.env.PHASE2_LEDGER_LINK_COLUMN) ? 'PASS' : 'FAIL',
    `value=${process.env.PHASE2_LEDGER_LINK_COLUMN ?? '<unset>'} (must be true before ENFORCE so column writes activate)`,
  );
  record(
    'PHASE2_BILLING_KILL_SWITCH reachable',
    process.env.PHASE2_BILLING_KILL_SWITCH === undefined || !envTrue(process.env.PHASE2_BILLING_KILL_SWITCH)
      ? 'PASS' : 'FAIL',
    `kill-switch must be wired but OFF for ENFORCE (current=${process.env.PHASE2_BILLING_KILL_SWITCH ?? '<unset/off>'})`,
  );
  record(
    'Supabase service credentials present',
    url && key ? 'PASS' : 'FAIL',
    url && key ? 'SUPABASE_URL + SERVICE_ROLE_KEY found' : 'missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY',
  );

  // ── Filesystem: required Phase-2 modules deployed ────────────────────────
  const repo = path.resolve(__dirname, '..');
  const mustExist = [
    'backend/services/billing/phase2EnforcementGate.ts',
    'backend/services/billing/phase2RouteWiring.ts',
    'backend/services/billing/ledgerLinkColumnFlag.ts',
    'backend/services/billing/queueBillingMiddleware.ts',
    'backend/services/creditExecutionService.ts',
    'pages/api/cron/credit-orphan-hold-reap.ts',
  ];
  for (const rel of mustExist) {
    record(
      `module present: ${rel}`,
      fs.existsSync(path.join(repo, rel)) ? 'PASS' : 'FAIL',
      rel,
    );
  }

  // ── DB read-only checks ──────────────────────────────────────────────────
  if (url && key) {
    let createClient;
    try {
      ({ createClient } = require('@supabase/supabase-js'));
    } catch {
      record('@supabase/supabase-js loadable', 'FAIL', 'dependency not resolvable');
    }
    if (createClient) {
      const db = createClient(url, key, { auth: { persistSession: false } });

      // Column presence via a limit(0) select — error 42703 = missing column.
      for (const [tbl] of [['usage_events'], ['unified_transactions']]) {
        const { error } = await db.from(tbl).select('ledger_hold_transaction_id').limit(0);
        record(
          `column ${tbl}.ledger_hold_transaction_id (migration 20260667)`,
          error ? 'FAIL' : 'PASS',
          error ? error.message : 'present',
        );
      }

      // Policy-snapshot table presence (migration 20260666).
      {
        const { error } = await db.from('credit_hold_policy_snapshots').select('id').limit(0);
        record(
          'table credit_hold_policy_snapshots (migration 20260666)',
          error ? 'FAIL' : 'PASS',
          error ? error.message : 'present',
        );
      }

      // Catalog completeness (migration 20260665) — all 19 action keys.
      {
        const { data, error } = await db
          .from('credit_cost_config')
          .select('action_type')
          .in('action_type', REQUIRED_CATALOG_ACTIONS);
        if (error) {
          record('credit_cost_config completeness (migration 20260665)', 'FAIL', error.message);
        } else {
          const found = new Set((data || []).map((r) => r.action_type));
          const missing = REQUIRED_CATALOG_ACTIONS.filter((a) => !found.has(a));
          record(
            'credit_cost_config completeness (migration 20260665)',
            missing.length === 0 ? 'PASS' : 'FAIL',
            missing.length === 0 ? 'all 19 action keys present' : `missing: ${missing.join(', ')}`,
          );
        }
      }

      // Org-scoped feature-flag plumbing (read-only existence probe).
      {
        const { error } = await db.from('feature_flags').select('flag_key').limit(1);
        record(
          'feature_flags table readable (org-scoped flag plumbing)',
          error ? 'FAIL' : 'PASS',
          error ? error.message : 'readable',
        );
      }
    }
  } else {
    record('DB checks', 'SKIP', 'no Supabase creds — DB checks not run', true);
  }

  // ── Manual operator confirmations (cannot be auto-introspected) ──────────
  record(
    'MANUAL: 20260668 indexes built (CREATE INDEX CONCURRENTLY)',
    'MANUAL',
    'confirm idx_usage_events_ledger_hold + idx_unified_txn_ledger_hold exist (pg_indexes / \\d) — not PostgREST-introspectable',
    false,
  );
  record(
    'MANUAL: non-prod ENFORCE smoke matrix green (Phase-3 Output D)',
    'MANUAL',
    'all 10 smoke scenarios verified on a seeded non-prod org',
    false,
  );

  // ── Report ───────────────────────────────────────────────────────────────
  let hardFail = false;
  for (const r of results) {
    if (r.status === 'FAIL' && r.required) hardFail = true;
    // eslint-disable-next-line no-console
    console.log(`[${r.status.padEnd(6)}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\nRESULT: ${hardFail ? 'NO-GO — required check(s) failed' : 'GO (automated checks pass; resolve MANUAL items before canary)'}`);
  process.exit(hardFail ? 1 : 0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('readiness check crashed:', e && e.message ? e.message : e);
  process.exit(1);
});
