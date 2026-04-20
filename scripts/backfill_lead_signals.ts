import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { supabase } from '../backend/db/supabaseClient';
import { upsertCanonicalLeadSignal } from '../backend/services/canonicalLeadSignalService';

type BackfillResult = { processed: number; inserted: number; skipped_duplicates: number; errors: number };

async function backfillListeningSignals(): Promise<BackfillResult> {
  const { data, error } = await supabase
    .from('lead_signals_v1')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to read lead_signals_v1: ${error.message}`);

  let inserted = 0;
  let processed = 0;
  let skipped_duplicates = 0;
  let errors = 0;
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    processed++;
    try {
      const sourceId =
        (typeof row.source_url === 'string' && row.source_url.trim()) || String(row.id);
      const result = await upsertCanonicalLeadSignal({
        organization_id: String(row.company_id),
        source_type: 'listening',
        source_id: sourceId,
        thread_id: null,
        platform: String(row.platform ?? ''),
        platform_user_id:
          typeof row.author_handle === 'string' && row.author_handle.trim() ? String(row.author_handle).trim() : null,
        content_text:
          (typeof row.raw_text === 'string' && row.raw_text) ||
          (typeof row.snippet === 'string' ? row.snippet : '') ||
          '',
        intent_score: typeof row.intent_score === 'number' ? row.intent_score : null,
        urgency_score: typeof row.urgency_score === 'number' ? row.urgency_score : null,
        icp_score: typeof row.icp_score === 'number' ? row.icp_score : null,
        confidence_score: typeof row.total_score === 'number' ? row.total_score : null,
        total_score: typeof row.total_score === 'number' ? row.total_score : null,
        detected_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
        migration_source: 'v1',
        metadata: {
          signal_type: row.signal_type ?? null,
          risk_flag: row.risk_flag ?? null,
          problem_domain: row.problem_domain ?? null,
          engagement_potential: row.engagement_potential ?? null,
          trend_velocity: row.trend_velocity ?? null,
          conversion_window_days: row.conversion_window_days ?? null,
          job_id: row.job_id ?? null,
          region: row.region ?? null,
        },
      });
      if (result.inserted) inserted++;
      else skipped_duplicates++;
    } catch (backfillError) {
      errors++;
      console.error('[backfill_lead_signals] listening row failed', {
        source_id: row.source_url ?? row.id ?? null,
        error: backfillError instanceof Error ? backfillError.message : String(backfillError),
      });
    }
  }

  return { processed, inserted, skipped_duplicates, errors };
}

async function backfillEngagementSignals(): Promise<BackfillResult> {
  const { data: signals, error } = await supabase
    .from('engagement_lead_signals')
    .select('id, organization_id, message_id, thread_id, author_id, lead_intent, lead_score, confidence_score, detected_at')
    .order('detected_at', { ascending: true });

  if (error) throw new Error(`Failed to read engagement_lead_signals: ${error.message}`);
  if (!signals?.length) return { processed: 0, inserted: 0, skipped_duplicates: 0, errors: 0 };

  const messageIds = [...new Set(signals.map((row: { message_id: string }) => row.message_id))];
  const threadIds = [...new Set(signals.map((row: { thread_id: string }) => row.thread_id))];
  const authorIds = [...new Set(signals.map((row: { author_id?: string | null }) => row.author_id).filter(Boolean))];

  const [{ data: messages }, { data: threads }, { data: authors }] = await Promise.all([
    supabase.from('engagement_messages').select('id, content, platform').in('id', messageIds),
    supabase.from('engagement_threads').select('id, platform').in('id', threadIds),
    authorIds.length > 0
      ? supabase
          .from('engagement_authors')
          .select('id, platform_user_id, username, display_name, profile_url')
          .in('id', authorIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  const messageMap = new Map(
    ((messages ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
  );
  const threadMap = new Map(
    ((threads ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
  );
  const authorMap = new Map(
    ((authors ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
  );

  let inserted = 0;
  let processed = 0;
  let skipped_duplicates = 0;
  let errors = 0;
  for (const row of signals as Array<Record<string, unknown>>) {
    processed++;
    try {
      const message = messageMap.get(String(row.message_id));
      const thread = threadMap.get(String(row.thread_id));
      const author = row.author_id ? authorMap.get(String(row.author_id)) : undefined;
      const platform =
        (typeof thread?.platform === 'string' ? String(thread.platform) : null) ||
        (typeof message?.platform === 'string' ? String(message.platform) : null) ||
        '';

      const result = await upsertCanonicalLeadSignal({
        organization_id: String(row.organization_id),
        source_type: 'engagement',
        source_id: String(row.message_id),
        thread_id: String(row.thread_id),
        platform,
        platform_user_id:
          typeof author?.platform_user_id === 'string' ? String(author.platform_user_id) : null,
        content_text: typeof message?.content === 'string' ? String(message.content) : '',
        intent_score:
          typeof row.lead_score === 'number' ? Number(row.lead_score) / 100 : null,
        urgency_score: null,
        icp_score: null,
        confidence_score:
          typeof row.confidence_score === 'number' ? row.confidence_score : null,
        total_score:
          typeof row.lead_score === 'number' ? Number(row.lead_score) / 100 : null,
        detected_at: typeof row.detected_at === 'string' ? row.detected_at : new Date().toISOString(),
        migration_source: 'engagement',
        metadata: {
          lead_intent: row.lead_intent ?? null,
          display_name: author?.display_name ?? author?.username ?? null,
          profile_url: author?.profile_url ?? null,
        },
      });
      if (result.inserted) inserted++;
      else skipped_duplicates++;
    } catch (backfillError) {
      errors++;
      console.error('[backfill_lead_signals] engagement row failed', {
        source_id: row.message_id ?? null,
        error: backfillError instanceof Error ? backfillError.message : String(backfillError),
      });
    }
  }

  return { processed, inserted, skipped_duplicates, errors };
}

async function main() {
  const [listening, engagement] = await Promise.all([
    backfillListeningSignals(),
    backfillEngagementSignals(),
  ]);

  console.log(
    JSON.stringify(
      {
        listening,
        engagement,
        totals: {
          processed: listening.processed + engagement.processed,
          inserted: listening.inserted + engagement.inserted,
          skipped_duplicates: listening.skipped_duplicates + engagement.skipped_duplicates,
          errors: listening.errors + engagement.errors,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[backfill_lead_signals]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
