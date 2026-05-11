import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  toLimitedCompanyProfile,
} from '../../../backend/services/companyProfileService';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { normalizeUserGuidedIntelligence } from '../../../backend/services/companyProfile/userGuidance';
import type { CompanyProfile } from '../../../backend/services/companyProfile/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = String(req.body?.companyId || req.body?.company_id || req.query.companyId || '').trim();
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  const existing = await getProfile(companyId, { autoRefine: false, languageRefine: false });
  if (!existing) return res.status(404).json({ error: 'Company profile not found' });

  const normalizedGuidance = normalizeUserGuidedIntelligence(req.body?.user_guidance, {
    action: typeof req.body?.action === 'string' ? req.body.action : 'update_guidance',
    target: typeof req.body?.target === 'string' ? req.body.target : null,
    previous: existing.report_settings?.user_guidance ?? null,
  });

  const reportSettings: CompanyProfile['report_settings'] = {
    ...(existing.report_settings ?? {}),
    user_guidance: normalizedGuidance,
  };

  const { data, error } = await supabase
    .from('company_profiles')
    .update({
      report_settings: reportSettings,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const profile = (data as CompanyProfile | null) ?? {
    ...existing,
    report_settings: reportSettings,
  };

  const responseProfile = access.role === 'COMPANY_ADMIN'
    ? toLimitedCompanyProfile(profile) ?? profile
    : profile;

  return res.status(200).json({ profile: responseProfile });
}
