import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

/**
 * BOLT launch pre-flight: detect cross-campaign scheduling conflicts BEFORE
 * generation. Read-only. Returns the platform-days this company's OTHER campaigns
 * already occupy within the target window, so the launch UI can surface them and
 * let the user decide (avoid / skip / post anyway) via chat.
 */
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : null;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const campaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : null;
  const platforms: string[] = Array.isArray(body.platforms)
    ? Array.from(new Set(body.platforms.map((p: unknown) => norm(p)).filter(Boolean)))
    : [];
  const startDate = typeof body.startDate === 'string' && body.startDate.trim() ? body.startDate.trim() : null;
  const weeks = Number.isFinite(Number(body.weeks)) && Number(body.weeks) > 0 ? Math.min(12, Number(body.weeks)) : 1;

  try {
    // Sibling campaigns for this company (exclude the one being launched).
    const { data: siblings } = await supabase
      .from('campaigns')
      .select('id, name')
      .eq('company_id', companyId)
      .neq('id', campaignId ?? '00000000-0000-0000-0000-000000000000');
    const siblingIds = (siblings ?? []).map((c: { id: string }) => c.id).filter(Boolean);
    const nameById = new Map<string, string>((siblings ?? []).map((c: { id: string; name?: string }) => [c.id, c.name || 'another campaign']));
    if (siblingIds.length === 0) {
      return res.status(200).json({ hasConflicts: false, conflicts: [], summary: '' });
    }

    // Target date window (best-effort; when no start date, scan all sibling content).
    let startStr: string | null = null;
    let endStr: string | null = null;
    if (startDate) {
      const start = new Date(`${startDate.slice(0, 10)}T00:00:00Z`);
      if (!Number.isNaN(start.getTime())) {
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + weeks * 7);
        startStr = start.toISOString().slice(0, 10);
        endStr = end.toISOString().slice(0, 10);
      }
    }

    let query = supabase
      .from('daily_content_plans')
      .select('platforms, date, content_type, campaign_id')
      .in('campaign_id', siblingIds);
    if (startStr && endStr) query = query.gte('date', startStr).lte('date', endStr);
    const { data: rows } = await query;

    const conflicts: Array<{ platform: string; date: string; content_type: string | null; campaign_id: string; campaign_name: string }> = [];
    for (const row of rows ?? []) {
      const r = row as { platforms?: unknown; date?: unknown; content_type?: unknown; campaign_id?: unknown };
      const date = String(r.date ?? '').trim();
      if (!date) continue;
      const rowPlatforms = Array.isArray(r.platforms) ? r.platforms.map((p) => norm(p)).filter(Boolean) : [];
      const relevant = platforms.length > 0 ? rowPlatforms.filter((p) => platforms.includes(p)) : rowPlatforms;
      for (const platform of relevant) {
        conflicts.push({
          platform,
          date,
          content_type: r.content_type ? String(r.content_type) : null,
          campaign_id: String(r.campaign_id ?? ''),
          campaign_name: nameById.get(String(r.campaign_id ?? '')) ?? 'another campaign',
        });
      }
    }

    conflicts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.platform.localeCompare(b.platform)));
    const summary = conflicts.length
      ? conflicts
          .slice(0, 8)
          .map((c) => `• ${c.platform} · ${c.date}${c.content_type ? ` · ${c.content_type}` : ''} (${c.campaign_name})`)
          .join('\n') + (conflicts.length > 8 ? `\n…and ${conflicts.length - 8} more` : '')
      : '';

    return res.status(200).json({ hasConflicts: conflicts.length > 0, conflicts, summary });
  } catch (err: unknown) {
    console.error('BOLT conflict pre-flight failed:', err);
    return res.status(500).json({ error: 'Failed to check scheduling conflicts', details: err instanceof Error ? err.message : null });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/bolt/conflicts' });
