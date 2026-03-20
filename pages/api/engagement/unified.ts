/**
 * GET /api/engagement/unified
 *
 * Returns engagement messages from all platforms in priority order:
 *   negative > intent > questions > positive > neutral
 *
 * Query params:
 *   organization_id (required)
 *   limit           (default 50)
 *   offset          (default 0)
 *   sentiment       (optional filter: positive|neutral|negative|intent)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';

const SENTIMENT_PRIORITY: Record<string, number> = {
  negative: 1,
  intent:   2,
  neutral:  3,
  positive: 4,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const orgId     = String(req.query.organization_id ?? '').trim();
  const limit     = Math.min(200, Math.max(1, Number(req.query.limit  ?? 50)));
  const offset    = Math.max(0, Number(req.query.offset ?? 0));
  const sentiment = String(req.query.sentiment ?? '').trim().toLowerCase();

  if (!orgId) return res.status(400).json({ error: 'organization_id required' });

  try {
    // Pull from community_ai_actions (engagement ingest store)
    let query = supabase
      .from('community_ai_actions')
      .select(`
        id,
        platform,
        action_type,
        target_id,
        suggested_text,
        intent_classification,
        tone,
        status,
        discovered_user_id,
        created_at
      `)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    type Row = {
      id: string;
      platform: string;
      action_type: string;
      target_id: string;
      suggested_text?: string | null;
      intent_classification?: Record<string, unknown> | null;
      tone?: string | null;
      status?: string | null;
      discovered_user_id?: string | null;
      created_at?: string | null;
    };

    let rows = (data ?? []) as Row[];

    // Annotate with sentiment + priority score
    const annotated = rows.map((row) => {
      const sentimentLabel = String(
        (row.intent_classification as any)?.sentiment ?? row.tone ?? 'neutral'
      ).toLowerCase() as keyof typeof SENTIMENT_PRIORITY;
      const priority = SENTIMENT_PRIORITY[sentimentLabel] ?? 3;
      return { ...row, sentiment: sentimentLabel, priority_score: priority };
    });

    // Filter by sentiment if requested
    const filtered = sentiment
      ? annotated.filter((r) => r.sentiment === sentiment)
      : annotated;

    // Sort: lowest priority_score (= highest urgency) first, then newest
    filtered.sort((a, b) => a.priority_score - b.priority_score || (b.created_at ?? '').localeCompare(a.created_at ?? ''));

    return res.status(200).json({
      success: true,
      total: filtered.length,
      offset,
      limit,
      items: filtered,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
