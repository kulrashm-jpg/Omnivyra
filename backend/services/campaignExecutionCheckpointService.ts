/**
 * Campaign Execution Checkpoint Service
 * Guarantees exactly-once progression advancement via atomic checkpoints.
 *
 * Flow:
 * 1. Before content gen: createCheckpoint(campaignId, week, day)
 * 2. After content stored: completeCheckpoint(campaignId, week, day, contentId)
 * 3. On resume: resolveOrphanedCheckpoints(campaignId) then resume
 */

import { supabase } from '../db/supabaseClient';
import { getContentAssetById, listContentAssets } from '../db/contentAssetStore';
import { markDayComplete, getCampaignState } from './campaignExecutionStateService';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export type CheckpointStatus = 'in_progress' | 'completed' | 'abandoned';
export type ContentSource = 'content_assets' | 'daily_content_plans';

export interface ExecutionCheckpoint {
  id: string;
  campaign_id: string;
  week: number;
  day: number;
  status: CheckpointStatus;
  content_id: string | null;
  content_source: ContentSource;
  created_at: string;
  updated_at: string;
}

function toCheckpoint(row: Record<string, unknown>): ExecutionCheckpoint {
  return {
    id: String(row.id ?? ''),
    campaign_id: String(row.campaign_id ?? ''),
    week: Number(row.week) || 1,
    day: Number(row.day) || 1,
    status: (row.status as CheckpointStatus) ?? 'in_progress',
    content_id: row.content_id ? String(row.content_id) : null,
    content_source: (row.content_source as ContentSource) ?? 'content_assets',
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

async function contentExists(contentId: string, source: ContentSource): Promise<boolean> {
  if (!contentId) return false;
  if (source === 'content_assets') {
    const asset = await getContentAssetById(contentId);
    return asset != null;
  }
  if (source === 'daily_content_plans') {
    const { data, error } = await supabase
      .from('daily_content_plans')
      .select('id')
      .eq('id', contentId)
      .maybeSingle();
    return !error && data != null;
  }
  return false;
}

/** Find content for checkpoint when content_id is null (crash after store, before complete). */
async function findContentForCheckpoint(
  campaignId: string,
  week: number,
  day: number
): Promise<string | null> {
  const assets = await listContentAssets({ campaignId, weekNumber: week });
  if (!assets?.length) return null;
  const dayName = DAY_NAMES[day - 1];
  const dayStr = String(day);
  const match = assets.find(
    (a: any) => a.day === dayName || a.day === dayStr || String(a.day) === dayStr
  );
  return match?.asset_id ?? assets[0]?.asset_id ?? null;
}

/**
 * Create checkpoint BEFORE generating content. Idempotent: returns existing in_progress.
 */
export async function createCheckpoint(
  campaignId: string,
  week: number,
  day: number
): Promise<ExecutionCheckpoint | null> {
  const { data: existing } = await supabase
    .from('campaign_execution_checkpoint')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('week', week)
    .eq('day', day)
    .maybeSingle();

  if (existing) {
    const status = (existing as Record<string, unknown>).status as string;
    if (status === 'completed') return null;
    if (status === 'in_progress') return toCheckpoint(existing as Record<string, unknown>);
    if (status === 'abandoned') {
      const { data: updated, error } = await supabase
        .from('campaign_execution_checkpoint')
        .update({
          status: 'in_progress',
          content_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('campaign_id', campaignId)
        .eq('week', week)
        .eq('day', day)
        .select()
        .single();
      if (error) throw new Error(`Failed to reset checkpoint: ${error.message}`);
      return toCheckpoint(updated as Record<string, unknown>);
    }
  }

  const { data: inserted, error } = await supabase
    .from('campaign_execution_checkpoint')
    .insert({
      campaign_id: campaignId,
      week,
      day,
      status: 'in_progress',
      content_id: null,
      content_source: 'content_assets',
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    if ((error as any).code === '23505') {
      const { data: conflict } = await supabase
        .from('campaign_execution_checkpoint')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('week', week)
        .eq('day', day)
        .maybeSingle();
      if (conflict) return toCheckpoint(conflict as Record<string, unknown>);
    }
    throw new Error(`Failed to create checkpoint: ${error.message}`);
  }
  return toCheckpoint(inserted as Record<string, unknown>);
}

/**
 * Complete checkpoint AFTER content stored. Updates checkpoint then calls markDayComplete.
 */
export async function completeCheckpoint(
  campaignId: string,
  week: number,
  day: number,
  contentId: string,
  contentSource: ContentSource = 'content_assets'
): Promise<{ checkpoint: ExecutionCheckpoint; state: Awaited<ReturnType<typeof markDayComplete>> } | null> {
  const { data: row, error: fetchError } = await supabase
    .from('campaign_execution_checkpoint')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('week', week)
    .eq('day', day)
    .maybeSingle();

  if (fetchError || !row) return null;

  const status = (row as Record<string, unknown>).status as string;
  if (status === 'completed') {
    const state = await getCampaignState(campaignId);
    return { checkpoint: toCheckpoint(row as Record<string, unknown>), state };
  }
  if (status !== 'in_progress') return null;

  const { data: updated, error } = await supabase
    .from('campaign_execution_checkpoint')
    .update({
      status: 'completed',
      content_id: contentId,
      content_source: contentSource,
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', campaignId)
    .eq('week', week)
    .eq('day', day)
    .select()
    .single();

  if (error) throw new Error(`Failed to complete checkpoint: ${error.message}`);

  const state = await markDayComplete(campaignId, week, day, contentId);
  return { checkpoint: toCheckpoint(updated as Record<string, unknown>), state };
}

/**
 * Abandon checkpoint (no content). Caller can retry generation.
 */
export async function abandonCheckpoint(
  campaignId: string,
  week: number,
  day: number
): Promise<ExecutionCheckpoint | null> {
  const { data: updated, error } = await supabase
    .from('campaign_execution_checkpoint')
    .update({
      status: 'abandoned',
      content_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', campaignId)
    .eq('week', week)
    .eq('day', day)
    .eq('status', 'in_progress')
    .select()
    .maybeSingle();

  if (error) throw new Error(`Failed to abandon checkpoint: ${error.message}`);
  if (!updated) return null;
  return toCheckpoint(updated as Record<string, unknown>);
}

/**
 * Resolve orphaned checkpoints on resume. In_progress + content exists → finalize. In_progress + no content → abandon.
 */
export async function resolveOrphanedCheckpoints(campaignId: string): Promise<{
  finalized: { week: number; day: number }[];
  abandoned: { week: number; day: number }[];
}> {
  const { data: rows, error } = await supabase
    .from('campaign_execution_checkpoint')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('status', 'in_progress');

  if (error || !rows?.length) return { finalized: [], abandoned: [] };

  const finalized: { week: number; day: number }[] = [];
  const abandoned: { week: number; day: number }[] = [];

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const week = Number(r.week) || 1;
    const day = Number(r.day) || 1;
    let contentId = r.content_id ? String(r.content_id) : null;
    const source = (r.content_source as ContentSource) ?? 'content_assets';

    if (!contentId) {
      contentId = await findContentForCheckpoint(campaignId, week, day);
    }
    if (contentId && (await contentExists(contentId, source))) {
      await completeCheckpoint(campaignId, week, day, contentId, source);
      finalized.push({ week, day });
    } else {
      await abandonCheckpoint(campaignId, week, day);
      abandoned.push({ week, day });
    }
  }

  return { finalized, abandoned };
}

/**
 * Get in-progress checkpoint for (campaign, week, day) if any.
 */
export async function getCheckpoint(
  campaignId: string,
  week: number,
  day: number
): Promise<ExecutionCheckpoint | null> {
  const { data, error } = await supabase
    .from('campaign_execution_checkpoint')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('week', week)
    .eq('day', day)
    .maybeSingle();

  if (error || !data) return null;
  return toCheckpoint(data as Record<string, unknown>);
}
