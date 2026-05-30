/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: DB_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/

/**
 * Active Leads backfill — Phase 1 companion to migration
 * 20260817_active_leads_object_model.sql.
 *
 * Walks every opportunity_feed_items row whose active_lead_id is
 * NULL, joins to lead_signals.contact_id, groups by
 *   (organization_id, contact_id, opportunity_type)
 * and upserts one active_leads row per group with status='new'
 * and owner_user_id=NULL. Then sets active_lead_id on each
 * source opportunity_feed_items row.
 *
 * Default mode: DRY-RUN. Reads + groups + prints a report. NO
 * writes. Pass --execute (plus --target-env and, for production,
 * --confirm-production-impact) to actually write.
 *
 * Idempotency: the UNIQUE (organization_id, contact_id,
 * opportunity_type) constraint plus an upsert-then-attach pattern
 * make repeated executions safe — already-attached items are
 * skipped by the WHERE active_lead_id IS NULL filter.
 *
 * Usage:
 *   # Dry-run report, all orgs
 *   npx tsx scripts/operator/db/backfill-active-leads.ts --target-env=local
 *
 *   # Dry-run, single org
 *   npx tsx scripts/operator/db/backfill-active-leads.ts \
 *     --target-env=staging --org=<uuid>
 *
 *   # Execute against staging
 *   npx tsx scripts/operator/db/backfill-active-leads.ts \
 *     --target-env=staging --execute
 *
 *   # Execute against production
 *   npx tsx scripts/operator/db/backfill-active-leads.ts \
 *     --target-env=production --execute --confirm-production-impact
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { supabase } from '../../../backend/db/supabaseClient';

type Args = {
  targetEnv: 'local' | 'staging' | 'production' | null;
  execute: boolean;
  confirmProduction: boolean;
  orgFilter: string | null;
  limit: number | null;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    targetEnv: null,
    execute: false,
    confirmProduction: false,
    orgFilter: null,
    limit: null,
  };
  for (const raw of argv) {
    if (raw === '--execute' || raw === '--apply') out.execute = true;
    else if (raw === '--confirm-production-impact') out.confirmProduction = true;
    else if (raw.startsWith('--target-env=')) {
      const value = raw.slice('--target-env='.length);
      if (value === 'local' || value === 'staging' || value === 'production') out.targetEnv = value;
    } else if (raw.startsWith('--org=')) {
      out.orgFilter = raw.slice('--org='.length);
    } else if (raw.startsWith('--limit=')) {
      const parsed = Number.parseInt(raw.slice('--limit='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) out.limit = parsed;
    }
  }
  return out;
}

function fail(reason: string): never {
  console.error(`[backfill-active-leads] ${reason}`);
  process.exit(1);
}

type FeedItemRow = {
  id: string;
  organization_id: string;
  signal_id: string;
  opportunity_type: string;
  platform: string;
  opportunity_score: number | null;
  confidence_score: number | null;
  urgency_score: number | null;
  created_at: string;
};

type SignalRow = {
  id: string;
  contact_id: string | null;
  intent_score: number | null;
  icp_score: number | null;
  confidence_score: number | null;
  total_score: number | null;
  detected_at: string | null;
  platform: string | null;
};

type GroupKey = string;

type GroupAggregate = {
  organization_id: string;
  contact_id: string;
  opportunity_type: string;
  feed_item_ids: string[];
  first_seen_at: string;
  last_seen_at: string;
  intent_score: number | null;
  icp_score: number | null;
  confidence_score: number | null;
  total_score: number | null;
  source_platforms: Set<string>;
  signal_count: number;
};

function makeKey(orgId: string, contactId: string, opportunityType: string): GroupKey {
  return `${orgId}::${contactId}::${opportunityType}`;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function minIso(a: string, b: string): string {
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

function maxIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

async function fetchFeedItems(args: Args): Promise<FeedItemRow[]> {
  const pageSize = 1000;
  const out: FeedItemRow[] = [];
  let from = 0;
  while (true) {
    let query = (supabase as any)
      .from('opportunity_feed_items')
      .select('id, organization_id, signal_id, opportunity_type, platform, opportunity_score, confidence_score, urgency_score, created_at')
      .is('active_lead_id', null)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (args.orgFilter) query = query.eq('organization_id', args.orgFilter);

    const { data, error } = await query;
    if (error) fail(`Failed reading opportunity_feed_items: ${error.message}`);
    const rows = (data ?? []) as FeedItemRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (args.limit && out.length >= args.limit) {
      out.length = args.limit;
      break;
    }
  }
  return out;
}

async function fetchSignalsByIds(signalIds: string[]): Promise<Map<string, SignalRow>> {
  const out = new Map<string, SignalRow>();
  if (signalIds.length === 0) return out;
  const batchSize = 500;
  for (let i = 0; i < signalIds.length; i += batchSize) {
    const batch = signalIds.slice(i, i + batchSize);
    const { data, error } = await (supabase as any)
      .from('lead_signals')
      .select('id, contact_id, intent_score, icp_score, confidence_score, total_score, detected_at, platform')
      .in('id', batch);
    if (error) fail(`Failed reading lead_signals: ${error.message}`);
    for (const row of (data ?? []) as SignalRow[]) out.set(row.id, row);
  }
  return out;
}

function groupAggregates(
  feedItems: FeedItemRow[],
  signals: Map<string, SignalRow>,
): { groups: Map<GroupKey, GroupAggregate>; skippedNoContact: number; skippedNoSignal: number } {
  const groups = new Map<GroupKey, GroupAggregate>();
  let skippedNoContact = 0;
  let skippedNoSignal = 0;
  for (const item of feedItems) {
    const signal = signals.get(item.signal_id);
    if (!signal) {
      skippedNoSignal += 1;
      continue;
    }
    if (!signal.contact_id) {
      skippedNoContact += 1;
      continue;
    }
    const key = makeKey(item.organization_id, signal.contact_id, item.opportunity_type);
    const detectedAt = signal.detected_at ?? item.created_at;
    const platform = signal.platform ?? item.platform;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        organization_id: item.organization_id,
        contact_id: signal.contact_id,
        opportunity_type: item.opportunity_type,
        feed_item_ids: [item.id],
        first_seen_at: detectedAt,
        last_seen_at: detectedAt,
        intent_score: signal.intent_score,
        icp_score: signal.icp_score,
        confidence_score: signal.confidence_score,
        total_score: signal.total_score,
        source_platforms: new Set<string>(platform ? [platform] : []),
        signal_count: 1,
      });
      continue;
    }
    existing.feed_item_ids.push(item.id);
    existing.first_seen_at = minIso(existing.first_seen_at, detectedAt);
    existing.last_seen_at = maxIso(existing.last_seen_at, detectedAt);
    existing.intent_score = maxNullable(existing.intent_score, signal.intent_score);
    existing.icp_score = maxNullable(existing.icp_score, signal.icp_score);
    existing.confidence_score = maxNullable(existing.confidence_score, signal.confidence_score);
    existing.total_score = maxNullable(existing.total_score, signal.total_score);
    if (platform) existing.source_platforms.add(platform);
    existing.signal_count += 1;
  }
  return { groups, skippedNoContact, skippedNoSignal };
}

async function upsertLeadAndAttach(group: GroupAggregate): Promise<{ leadId: string; attached: number }> {
  const payload = {
    organization_id: group.organization_id,
    contact_id: group.contact_id,
    opportunity_type: group.opportunity_type,
    status: 'new',
    intent_score: group.intent_score,
    icp_score: group.icp_score,
    confidence_score: group.confidence_score,
    total_score: group.total_score,
    source_platforms: Array.from(group.source_platforms),
    signal_count: group.signal_count,
    first_seen_at: group.first_seen_at,
    last_seen_at: group.last_seen_at,
    last_activity_at: group.last_seen_at,
  };

  const { data, error } = await (supabase as any)
    .from('active_leads')
    .upsert(payload, { onConflict: 'organization_id,contact_id,opportunity_type' })
    .select('id')
    .single();
  if (error) fail(`Upsert active_leads failed for group ${makeKey(group.organization_id, group.contact_id, group.opportunity_type)}: ${error.message}`);
  const leadId = (data as { id: string }).id;

  const { error: attachError, count } = await (supabase as any)
    .from('opportunity_feed_items')
    .update({ active_lead_id: leadId }, { count: 'exact' })
    .in('id', group.feed_item_ids)
    .is('active_lead_id', null);
  if (attachError) fail(`Attach opportunity_feed_items failed for lead ${leadId}: ${attachError.message}`);

  return { leadId, attached: count ?? group.feed_item_ids.length };
}

function printBanner(args: Args): void {
  console.log('========================================');
  console.log('ACTIVE LEADS BACKFILL');
  console.log(`MODE: ${args.execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`TARGET ENV: ${args.targetEnv ?? 'unspecified'}`);
  console.log(`ORG FILTER: ${args.orgFilter ?? '(none — all orgs)'}`);
  console.log(`LIMIT: ${args.limit ?? '(none)'}`);
  console.log('========================================');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  printBanner(args);

  if (!args.targetEnv) {
    fail('Missing --target-env=local|staging|production.');
  }
  if (args.execute && args.targetEnv === 'production' && !args.confirmProduction) {
    fail('Production execute requires --confirm-production-impact.');
  }

  console.log('[backfill-active-leads] Loading unattached opportunity_feed_items...');
  const feedItems = await fetchFeedItems(args);
  console.log(`[backfill-active-leads] Loaded ${feedItems.length} unattached feed items.`);

  const signalIds = Array.from(new Set(feedItems.map((item) => item.signal_id)));
  console.log(`[backfill-active-leads] Loading ${signalIds.length} referenced signals...`);
  const signals = await fetchSignalsByIds(signalIds);
  console.log(`[backfill-active-leads] Loaded ${signals.size} signals.`);

  const { groups, skippedNoContact, skippedNoSignal } = groupAggregates(feedItems, signals);
  console.log(`[backfill-active-leads] Grouped into ${groups.size} leads.`);
  console.log(`[backfill-active-leads] Skipped (no contact_id on signal): ${skippedNoContact}`);
  console.log(`[backfill-active-leads] Skipped (missing referenced signal): ${skippedNoSignal}`);

  const orgs = new Set<string>();
  const opportunityTypeCounts = new Map<string, number>();
  for (const group of groups.values()) {
    orgs.add(group.organization_id);
    opportunityTypeCounts.set(
      group.opportunity_type,
      (opportunityTypeCounts.get(group.opportunity_type) ?? 0) + 1,
    );
  }

  console.log('\n[backfill-active-leads] Distribution:');
  console.log(`  organizations affected: ${orgs.size}`);
  console.log('  leads by opportunity_type:');
  for (const [type, count] of [...opportunityTypeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(28)} ${count}`);
  }

  if (!args.execute) {
    console.log('\n[backfill-active-leads] DRY-RUN complete. No writes performed.');
    console.log('[backfill-active-leads] Pass --execute to write.');
    return;
  }

  console.log('\n[backfill-active-leads] Writing leads...');
  let leadsWritten = 0;
  let attachmentsWritten = 0;
  for (const group of groups.values()) {
    const { attached } = await upsertLeadAndAttach(group);
    leadsWritten += 1;
    attachmentsWritten += attached;
    if (leadsWritten % 50 === 0) {
      console.log(`  ... ${leadsWritten}/${groups.size} leads written`);
    }
  }

  console.log('\n[backfill-active-leads] EXECUTE complete.');
  console.log(`  leads upserted: ${leadsWritten}`);
  console.log(`  feed items attached: ${attachmentsWritten}`);
}

main().catch((err) => {
  console.error('[backfill-active-leads] Unexpected failure:', err);
  process.exitCode = 1;
});
