/**
 * GET  /api/social-platforms/content-type-prefs?companyId=...
 *   Returns platform_content_type_prefs (Record<platform, string[]>) for the company.
 *
 * PUT  /api/social-platforms/content-type-prefs?companyId=...
 *   Body: { prefs: Record<string, string[]> }
 *   Saves platform_content_type_prefs for the company.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : null;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('company_profiles')
      .select('platform_content_type_prefs')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'Failed to load prefs' });
    return res.status(200).json({ prefs: (data?.platform_content_type_prefs as Record<string, string[]>) ?? {} });
  }

  if (req.method === 'PUT') {
    const { prefs } = req.body ?? {};
    if (!prefs || typeof prefs !== 'object') return res.status(400).json({ error: 'prefs object is required' });

    // Upsert into company_profiles
    const { error } = await supabase
      .from('company_profiles')
      .upsert(
        { company_id: companyId, platform_content_type_prefs: prefs, updated_at: new Date().toISOString() },
        { onConflict: 'company_id' }
      );

    if (error) return res.status(500).json({ error: 'Failed to save prefs' });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
