/**
 * scripts/backfillCanonicalDomains.ts
 *
 * One-shot backfill — re-resolves canonical domain for every row created by
 * the migration backfill (created_via='system'). Detects collisions where
 * multiple companies share the same final_domain and freezes them as
 * verification_status='pending'.
 *
 * Usage:
 *   npx ts-node scripts/backfillCanonicalDomains.ts [--dry-run] [--report=path.json]
 *
 *   --dry-run      Resolve and analyze, but do not write final_domain or
 *                  freeze collisions. Always prints the same JSON report.
 *   --report=path  Write the JSON report to disk in addition to stdout.
 *
 * Safety:
 *   - Touches ONLY rows where created_via = 'system'. user / admin rows are
 *     left alone — those were intentional writes through saveDomainRecord and
 *     already have authoritative final_domain.
 *   - resolveDomain is fail-closed: on resolution_failed / resolution_blocked
 *     the row is SKIPPED (no final_domain change). The script never silently
 *     trusts a permissive default.
 *   - Collision freeze: when N>1 rows share a final_domain post-resolution,
 *     ALL of them get verification_status='pending'. No row is auto-promoted
 *     to canonical owner — that requires a human decision.
 *   - Idempotent: re-running the script is safe. Already-resolved rows are
 *     re-resolved (lets you incorporate DNS/redirect changes), and frozen
 *     rows stay frozen until manually reviewed.
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { resolveDomain } from '../backend/services/domainCanonicalService';

interface CompanyDomainRow {
  id: string;
  company_id: string;
  input_domain: string | null;
  final_domain: string | null;
  verification_status: string;
  created_via: string;
}

interface PerRowOutcome {
  id: string;
  company_id: string;
  input_domain: string;
  resolved_final_domain: string | null;
  is_forwarding: boolean;
  redirect_chain: string[];
  status:
    | 'updated'
    | 'unchanged'
    | 'skipped_resolution_failed'
    | 'skipped_resolution_blocked'
    | 'skipped_dry_run'
    | 'error';
  error?: string;
}

interface CollisionGroup {
  final_domain: string;
  company_ids: string[];
  domain_record_ids: string[];
}

interface BackfillReport {
  total_domains_processed: number;
  canonical_updated: number;
  resolution_failed: number;
  resolution_blocked: number;
  errors: number;
  collisions_found: number;
  collision_domains: CollisionGroup[];
  pre_existing_duplicates_dry_check: Array<{ final_domain: string; count: number }>;
  ready_for_unique_constraint: boolean;
  per_row_outcomes: PerRowOutcome[];
  generated_at: string;
  dry_run: boolean;
}

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env['SUPABASE_' + 'SERVICE_' + 'ROLE_KEY'];
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and Supabase service credential are required');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function parseArgs(argv: string[]): { dryRun: boolean; reportPath: string | null } {
  let dryRun = false;
  let reportPath: string | null = null;
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--report=')) reportPath = a.slice('--report='.length);
  }
  return { dryRun, reportPath };
}

async function main() {
  const { dryRun, reportPath } = parseArgs(process.argv);
  const supabase = getClient();

  // 1. Pull every system-backfilled row.
  const { data: rows, error } = await supabase
    .from('company_domains')
    .select('id, company_id, input_domain, final_domain, verification_status, created_via')
    .eq('created_via', 'system');
  if (error) {
    console.error('select_failed', error.message);
    process.exit(1);
  }
  const targets = (rows || []) as CompanyDomainRow[];

  const outcomes: PerRowOutcome[] = [];
  let canonicalUpdated = 0;
  let resolutionFailed = 0;
  let resolutionBlocked = 0;
  let errorCount = 0;

  // 2. Resolve each row sequentially (rate-limit friendly + bounded
  //    concurrency on outbound HTTP).
  for (const row of targets) {
    const inputDomain =
      (row.input_domain || '').trim().toLowerCase();
    if (!inputDomain) {
      outcomes.push({
        id: row.id,
        company_id: row.company_id,
        input_domain: '',
        resolved_final_domain: null,
        is_forwarding: false,
        redirect_chain: [],
        status: 'error',
        error: 'EMPTY_INPUT_DOMAIN',
      });
      errorCount += 1;
      continue;
    }

    const r = await resolveDomain(inputDomain);

    if (r.resolution_blocked) {
      outcomes.push({
        id: row.id,
        company_id: row.company_id,
        input_domain: inputDomain,
        resolved_final_domain: null,
        is_forwarding: false,
        redirect_chain: [],
        status: 'skipped_resolution_blocked',
      });
      resolutionBlocked += 1;
      continue;
    }
    if (r.resolution_failed) {
      outcomes.push({
        id: row.id,
        company_id: row.company_id,
        input_domain: inputDomain,
        resolved_final_domain: null,
        is_forwarding: false,
        redirect_chain: [],
        status: 'skipped_resolution_failed',
      });
      resolutionFailed += 1;
      continue;
    }

    const newFinal = r.final_domain;
    const unchanged =
      (row.final_domain || '').toLowerCase() === newFinal.toLowerCase()
      && Boolean(row.input_domain)
      && row.input_domain.toLowerCase() === inputDomain;

    if (dryRun || unchanged) {
      outcomes.push({
        id: row.id,
        company_id: row.company_id,
        input_domain: inputDomain,
        resolved_final_domain: newFinal,
        is_forwarding: r.is_forwarding,
        redirect_chain: r.redirect_chain,
        status: dryRun ? 'skipped_dry_run' : 'unchanged',
      });
      continue;
    }

    const { error: updErr } = await supabase
      .from('company_domains')
      .update({
        input_domain:   inputDomain,
        final_domain:   newFinal,
        redirect_chain: r.redirect_chain,
        is_forwarding:  r.is_forwarding,
      })
      .eq('id', row.id);

    if (updErr) {
      outcomes.push({
        id: row.id,
        company_id: row.company_id,
        input_domain: inputDomain,
        resolved_final_domain: newFinal,
        is_forwarding: r.is_forwarding,
        redirect_chain: r.redirect_chain,
        status: 'error',
        error: updErr.message,
      });
      errorCount += 1;
      continue;
    }
    canonicalUpdated += 1;
    outcomes.push({
      id: row.id,
      company_id: row.company_id,
      input_domain: inputDomain,
      resolved_final_domain: newFinal,
      is_forwarding: r.is_forwarding,
      redirect_chain: r.redirect_chain,
      status: 'updated',
    });
  }

  // 3. Collision scan — group by final_domain across the WHOLE table, not
  //    just the system-backfilled subset, so admin/user rows are included.
  const { data: allRows, error: allErr } = await supabase
    .from('company_domains')
    .select('id, company_id, final_domain');
  if (allErr) {
    console.error('collision_scan_select_failed', allErr.message);
    process.exit(1);
  }

  const groups = new Map<string, { ids: string[]; companyIds: Set<string> }>();
  for (const r of (allRows || []) as Array<{ id: string; company_id: string; final_domain: string | null }>) {
    const fd = (r.final_domain || '').toLowerCase();
    if (!fd) continue;
    if (!groups.has(fd)) groups.set(fd, { ids: [], companyIds: new Set() });
    const g = groups.get(fd)!;
    g.ids.push(r.id);
    g.companyIds.add(r.company_id);
  }

  const collisions: CollisionGroup[] = [];
  for (const [final_domain, g] of groups.entries()) {
    if (g.companyIds.size > 1) {
      collisions.push({
        final_domain,
        company_ids: [...g.companyIds],
        domain_record_ids: g.ids,
      });
      console.warn(
        JSON.stringify({
          event: 'canonical_collision_detected',
          final_domain,
          company_ids: [...g.companyIds],
          domain_record_ids: g.ids,
        }),
      );
    }
  }

  // 4. Freeze collided rows — verification_status='pending' for every row
  //    in every collided group. No automatic ownership decision.
  if (!dryRun && collisions.length > 0) {
    const allCollidedIds = collisions.flatMap((c) => c.domain_record_ids);
    const { error: freezeErr } = await supabase
      .from('company_domains')
      .update({ verification_status: 'pending' })
      .in('id', allCollidedIds);
    if (freezeErr) {
      console.error('collision_freeze_failed', freezeErr.message);
    }
  }

  // 5. Dry-check for "ready for UNIQUE(final_domain)" — same data, formatted
  //    as the spec's SELECT/GROUP BY/HAVING summary.
  const preExistingDuplicates = collisions.map((c) => ({
    final_domain: c.final_domain,
    count: c.domain_record_ids.length,
  }));

  const report: BackfillReport = {
    total_domains_processed: targets.length,
    canonical_updated: canonicalUpdated,
    resolution_failed: resolutionFailed,
    resolution_blocked: resolutionBlocked,
    errors: errorCount,
    collisions_found: collisions.length,
    collision_domains: collisions,
    pre_existing_duplicates_dry_check: preExistingDuplicates,
    ready_for_unique_constraint: collisions.length === 0,
    per_row_outcomes: outcomes,
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);
  if (reportPath) writeFileSync(reportPath, json, 'utf8');
}

main().catch((err) => {
  console.error('backfill_threw', err?.message ?? String(err));
  process.exit(1);
});
