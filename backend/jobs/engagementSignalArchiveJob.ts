/**
 * Engagement Signal Archive Job
 * Moves signals older than 180 days to campaign_activity_engagement_signals_archive.
 * Run nightly.
 */

import { supabase } from '../db/supabaseClient';

const RETENTION_DAYS = 180;

export type ArchiveResult = {
  archived: number;
  errors: string[];
};

export async function archiveOldSignals(): Promise<ArchiveResult> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString();

  const errors: string[] = [];

  const { data: oldSignals, error: selectError } = await supabase
    .from('campaign_activity_engagement_signals')
    .select('*')
    .lt('detected_at', cutoffStr)
    .limit(5000);

  if (selectError) {
    if (selectError.code === '42P01') return { archived: 0, errors: [] };
    return { archived: 0, errors: [selectError.message] };
  }

  if (!oldSignals?.length) return { archived: 0, errors: [] };

  const archiveRows = oldSignals.map((r: Record<string, unknown>) => ({
    id: r.id,
    campaign_id: r.campaign_id,
    activity_id: r.activity_id,
    platform: r.platform,
    source_type: r.source_type,
    source_id: r.source_id,
    conversation_url: r.conversation_url,
    author: r.author,
    content: r.content,
    signal_type: r.signal_type,
    engagement_score: r.engagement_score,
    signal_status: r.signal_status ?? 'new',
    detected_at: r.detected_at,
    created_at: r.created_at,
    organization_id: r.organization_id,
    raw_payload: r.raw_payload,
  }));

  const { error: insertError } = await supabase
    .from('campaign_activity_engagement_signals_archive')
    .insert(archiveRows);

  if (insertError) {
    if (insertError.code === '42P01') return { archived: 0, errors: [] };
    return { archived: 0, errors: [insertError.message] };
  }

  const ids = oldSignals.map((r: { id: string }) => r.id);
  const { error: deleteError } = await supabase
    .from('campaign_activity_engagement_signals')
    .delete()
    .in('id', ids);

  if (deleteError) {
    errors.push(`Archive succeeded but delete failed: ${deleteError.message}`);
  }

  return { archived: oldSignals.length, errors };
}
