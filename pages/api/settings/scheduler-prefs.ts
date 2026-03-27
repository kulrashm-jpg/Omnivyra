/**
 * GET  /api/settings/scheduler-prefs
 * PUT  /api/settings/scheduler-prefs
 *
 * Per-company scheduler preferences:
 *   interval_minutes  — how often to check for due posts during working hours
 *   timezone          — IANA timezone string (e.g. "America/New_York")
 *   working_start     — start of working hours 0-23 (default 9)
 *   working_end       — end of working hours 0-23 (default 18)
 *
 * Off-hours: scheduler checks every 6 hours (twice per 12-hr night).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

const VALID_INTERVALS = [15, 30, 60, 120, 240, 480];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  const companyId = (roleRow as any)?.company_id as string | undefined;
  if (!companyId) return res.status(401).json({ error: 'Unauthorized' });

  const db = supabase;

  if (req.method === 'GET') {
    const { data } = await db
      .from('company_scheduler_prefs')
      .select('interval_minutes, timezone, working_start, working_end')
      .eq('company_id', companyId)
      .maybeSingle();

    return res.status(200).json(data ?? {
      interval_minutes: 60,
      timezone: 'UTC',
      working_start: 9,
      working_end: 18,
    });
  }

  if (req.method === 'PUT') {
    const { interval_minutes, timezone, working_start, working_end } = req.body ?? {};

    if (!VALID_INTERVALS.includes(Number(interval_minutes))) {
      return res.status(400).json({ error: `interval_minutes must be one of ${VALID_INTERVALS.join(', ')}` });
    }
    if (typeof timezone !== 'string' || !timezone) {
      return res.status(400).json({ error: 'timezone is required' });
    }
    // Validate timezone
    try { Intl.DateTimeFormat(undefined, { timeZone: timezone }); }
    catch { return res.status(400).json({ error: 'Invalid timezone' }); }

    const ws = Number(working_start ?? 9);
    const we = Number(working_end ?? 18);
    if (ws < 0 || ws > 23 || we < 0 || we > 23 || ws >= we) {
      return res.status(400).json({ error: 'Invalid working hours (start must be < end, 0–23)' });
    }

    const { error } = await db.from('company_scheduler_prefs').upsert({
      company_id: companyId,
      interval_minutes: Number(interval_minutes),
      timezone,
      working_start: ws,
      working_end: we,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' });

    if (error) {
      console.error('[scheduler-prefs] upsert error:', error.message);
      return res.status(500).json({ error: 'Failed to save preferences' });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
