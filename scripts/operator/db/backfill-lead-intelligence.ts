/**
 * G8 (LC-102 / W1.2) — Canonical backfill of legacy `leads` into the canonical
 * Lead Intelligence store, THROUGH the production adoption pipeline.
 *
 * Reuse-first: NEVER inserts into `lead_intelligence` directly. Each legacy lead is
 * routed through the exact canonical pipeline a live capture uses — the canonical
 * facade ingestor over the SAME `durableLeadIntelligenceSink` `adoptLead` uses
 * (adapter → identity resolve → materialize scores → durable upsert → timeline event).
 *
 * Idempotent   — the sink upserts on (company_id, dedupe_key); re-runs are no-ops.
 * Resumable    — only leads with no canonical row (source_table='leads') are processed.
 * Observable   — structured progress per row + a final verified summary.
 *
 * Usage:  npx tsx scripts/operator/db/backfill-lead-intelligence.ts [--company <id>] [--limit N] [--dry]
 *
 * Note: db-timing observability is disabled for this script (see below) so the
 * request-context-aware `observeTable` proxy passes through the raw PostgREST
 * builder — otherwise canonical writes silently no-op in a bare operator process.
 */
import fs from 'node:fs';
import path from 'node:path';
import { enforceOperatorSafety } from '../../_core/operatorSafety';

function loadEnvLocal() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvLocal();
process.env.OBSERVABILITY_DB = 'false'; // pass-through observeTable in a bare script

const args = process.argv.slice(2);
const companyArg = ((): string | null => { const i = args.indexOf('--company'); return i >= 0 ? args[i + 1] : null; })();
const limitArg = ((): number => { const i = args.indexOf('--limit'); return i >= 0 ? Math.max(1, Number(args[i + 1]) || 0) : 100000; })();
const DRY = args.includes('--dry');

async function main() {
  // Operator safety invariant (W1.2): a remote-mutating operator entry point MUST
  // clear enforceOperatorSafety() before ANY client initialization.
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/db/backfill-lead-intelligence.ts',
    mutationTarget: 'db/lead_intelligence',
    intendedAction: 'backfill legacy leads into canonical Lead Intelligence via the adoption pipeline',
    example: 'npx tsx scripts/operator/db/backfill-lead-intelligence.ts --target-env=local --apply [--company <id>] [--limit N]',
  });
  if (!safety.allowed) return;

  // Import + use the admin client EARLY so it initializes (prod env) before ingest.
  const { supabase } = await import('../../../backend/db/supabaseClient');

  // ── --canonical: project canonical_leads prospects (PI-LDB C, 2026-11-11) ──
  // The SECOND entity this CLI handles. Legacy `leads` (below) and canonical
  // prospects (`canonical_leads`) are DIFFERENT entities, so this is a separate
  // mode, not a merge: it calls the ONE reconciliation service
  // (`reconcileLeadProjections`), which reads prospects newest first, checks
  // presence in URL-budgeted batches, and projects only what is missing, through
  // the same durable sink. Tenant-scoped: --company is required.
  // --dry projects NOTHING: the sink refuses, and those rows report as wouldProject.
  if (args.includes('--canonical')) {
    if (!companyArg) {
      console.error(JSON.stringify({ phase: 'REFUSED', reason: '--canonical requires --company <id>: reconciliation is never tenant-less' }));
      process.exitCode = 2;
      return;
    }
    const { reconcileLeadProjections, MAX_RECONCILE_BATCH } = await import('../../../backend/services/leadIntelligence/leadProjectionReconciliation');
    // --dry: a REFUSING sink (fail-closed by construction: there is nothing to
    // write with). The report counts the prospects the sink ACTUALLY RECEIVED,
    // by id, never by matching an error message - so a different, real failure
    // can never be absorbed into "would project" (PI review).
    const refusedProspectIds = new Set<string>();
    const res = await reconcileLeadProjections({
      organizationId: companyArg,
      limit: Math.min(limitArg, MAX_RECONCILE_BATCH),
      ...(DRY ? { ports: { sink: { emit: async (lead) => {
        if (lead?.sourceRef?.id) refusedProspectIds.add(String(lead.sourceRef.id));
        throw new Error('dry run: nothing is written');
      } } } } : {}),
    });
    const tally: Record<string, number> = {};
    let wouldProject = 0;
    for (const o of res.outcomes) {
      if (DRY && o.status === 'still_missing' && o.prospectId && refusedProspectIds.has(o.prospectId)) { wouldProject++; continue; }
      tally[o.status] = (tally[o.status] ?? 0) + 1;
    }
    console.info(JSON.stringify({
      phase: DRY ? 'CANONICAL_DRY_DONE' : 'CANONICAL_DONE', company: companyArg,
      prospects: res.outcomes.length, truncated: res.truncated, ...(DRY ? { wouldProject } : {}), byStatus: tally,
      presenceFallbacks: res.presenceFallbacks,
    }));
    return;
  }

  // Existing canonical mirrors (resumable set = leads NOT already present).
  let ciq = supabase.from('lead_intelligence').select('source_id').eq('source_table', 'leads');
  if (companyArg) ciq = ciq.eq('company_id', companyArg);
  const { data: existing } = await ciq;
  const done = new Set((existing ?? []).map((r) => String((r as { source_id: string }).source_id)));

  let lq = supabase.from('leads').select('*').order('created_at', { ascending: true }).limit(limitArg);
  if (companyArg) lq = lq.eq('company_id', companyArg);
  const { data: leadRows } = await lq;
  const pending = (leadRows ?? []).filter((r) => !done.has(String((r as { id: string }).id)));
  console.info(JSON.stringify({ phase: 'START', total_leads: (leadRows ?? []).length, already_canonical: done.size, pending: pending.length, dry: DRY, company: companyArg ?? 'ALL' }));

  if (DRY) { console.info(JSON.stringify({ phase: 'DRY_DONE', wouldAdopt: pending.length })); return; }

  const { createLeadIntelligenceIngestor } = await import('../../../backend/services/leadIntelligence/leadIntelligenceFacade');
  const { durableLeadIntelligenceSink } = await import('../../../backend/services/leadIntelligence/durableLeadIntelligenceSink');
  const ingestor = createLeadIntelligenceIngestor({ sink: durableLeadIntelligenceSink });

  let ok = 0, fail = 0;
  for (const [i, row] of pending.entries()) {
    try {
      // 'website' routes through websiteAdapter, which resolves the true source from row.source.
      await ingestor.ingestFromSource('website', row as Record<string, unknown>);
      ok++;
      if ((i + 1) % 25 === 0 || i === pending.length - 1) console.info(JSON.stringify({ phase: 'PROGRESS', done: i + 1, total: pending.length, ok, fail }));
    } catch (e) {
      fail++;
      console.error(JSON.stringify({ phase: 'ROW_FAIL', leadId: (row as { id?: string }).id ?? null, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  // Verify via the same client.
  const countLeads = (await (companyArg ? supabase.from('leads').select('id', { count: 'exact', head: true }).eq('company_id', companyArg) : supabase.from('leads').select('id', { count: 'exact', head: true }))).count ?? 0;
  const cq = supabase.from('lead_intelligence').select('id', { count: 'exact', head: true }).eq('source_table', 'leads');
  const countCanonical = (await (companyArg ? cq.eq('company_id', companyArg) : cq)).count ?? 0;
  console.info(JSON.stringify({ phase: 'DONE', adopted_ok: ok, adopted_fail: fail, verify: { leads: countLeads, canonical: countCanonical } }));
}

main().catch((e) => { console.error('FATAL', e instanceof Error ? e.message : String(e)); process.exit(2); });
