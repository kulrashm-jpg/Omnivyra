
/**
 * POST /api/track/settings
 *
 * Saves Blog Intelligence settings for a company.
 * Called by BlogIntelligenceWizard after successful verification.
 *
 * Body: { company_id, allowed_domain, allow_subdomains }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company_id, allowed_domain, allow_subdomains } = req.body ?? {};
  if (!company_id) return res.status(400).json({ error: 'company_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const domain = typeof allowed_domain === 'string'
    ? allowed_domain
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/$/, '')
        .trim()
        .toLowerCase()
    : null;

  const { error } = await supabase
    .from('blog_intelligence_settings')
    .upsert(
      {
        company_id,
        allowed_domain:   domain || null,
        allow_subdomains: !!allow_subdomains,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: 'company_id' }
    );

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
