/**
 * GET /api/intelligence/events
 * Fetches intelligence events for timeline visualization.
 * Query: companyId (required), limit (optional, default 100), cursor (optional, for next page)
 * Cursor format: created_at|id (base64-safe; ensures deterministic pagination for same-timestamp events)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export type IntelligenceEventType =
  | 'trend_detected'
  | 'insight_generated'
  | 'opportunity_detected'
  | 'campaign_launched'
  | 'engagement_spike';

export interface IntelligenceEvent {
  id: string;
  company_id: string;
  event_type: IntelligenceEventType | string;
  event_data: Record<string, unknown> | null;
  created_at: string;
}

const DEFAULT_LIMIT = 100;
const CURSOR_SEP = '|';

function parseCursor(cursor: string): { created_at: string; id: string } | null {
  const parts = cursor.split(CURSOR_SEP);
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) return null;
  return { created_at: parts[0].trim(), id: parts[1].trim() };
}

function buildCursor(created_at: string, id: string): string {
  return `${created_at}${CURSOR_SEP}${id}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const cursorRaw = (req.query.cursor as string)?.trim() || null;
  const cursor = cursorRaw ? parseCursor(cursorRaw) : null;

  try {
    let query = supabase
      .from('intelligence_events')
      .select('id, company_id, event_type, event_data, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (cursor) {
      const createdAt = cursor.created_at.replace(/"/g, '');
      const idVal = cursor.id.replace(/"/g, '');
      query = query.or(
        `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt."${idVal}")`
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error('[intelligence/events]', error);
      return res.status(500).json({ error: error.message });
    }

    const events = (data ?? []).map((row) => ({
      id: row.id,
      company_id: row.company_id,
      event_type: row.event_type,
      event_data: row.event_data ?? null,
      created_at: row.created_at,
    }));

    const nextCursor = events.length >= limit && events.length > 0
      ? buildCursor(events[events.length - 1].created_at, events[events.length - 1].id)
      : null;

    return res.status(200).json({
      events,
      next_cursor: nextCursor,
    });
  } catch (err) {
    console.error('[intelligence/events]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch intelligence events',
    });
  }
}
