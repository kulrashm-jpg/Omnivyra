import type { NextApiRequest, NextApiResponse } from 'next';
import { listPlatformCatalog } from '../../../backend/services/platformIntelligenceService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const activeOnly = String(req.query.activeOnly ?? 'true') !== 'false';
    const strict = String(req.query.strict ?? 'false') === 'true';
    if (!strict) {
      const catalog = await listPlatformCatalog({ activeOnly });
      return res.status(200).json(catalog);
    }

    const q = supabase.from('platform_master').select('*');
    const { data: platforms, error: platformsError } = activeOnly ? await q.eq('active', true) : await q;
    if (platformsError) {
      return res.status(500).json({ error: platformsError.message || 'Failed to load platform_master' });
    }
    const rows = Array.isArray(platforms) ? (platforms as any[]) : [];
    const ids = rows.map((p) => String(p?.id || '')).filter(Boolean);

    const { data: rules, error: rulesError } = await supabase
      .from('platform_content_rules')
      .select('platform_id, content_type')
      .in('platform_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
    if (rulesError) {
      return res.status(500).json({ error: rulesError.message || 'Failed to load platform_content_rules' });
    }

    const typesByPlatformId = new Map<string, Set<string>>();
    (rules || []).forEach((r: any) => {
      const pid = String(r?.platform_id || '');
      const ct = String(r?.content_type || '').trim();
      if (!pid || !ct) return;
      const set = typesByPlatformId.get(pid) ?? new Set<string>();
      set.add(ct);
      typesByPlatformId.set(pid, set);
    });

    return res.status(200).json({
      platforms: rows.map((p) => ({
        ...p,
        supported_content_types: Array.from(typesByPlatformId.get(String(p.id)) ?? new Set<string>()).sort(),
      })),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load platform catalog' });
  }
}

