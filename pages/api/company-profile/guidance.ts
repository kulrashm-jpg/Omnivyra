import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  toLimitedCompanyProfile,
} from '../../../backend/services/companyProfileService';
import { mergeReportSettingsKeys, readReportSettingsChecked } from '../../../backend/db/reportSettingsKeys';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { normalizeUserGuidedIntelligence } from '../../../backend/services/companyProfile/userGuidance';
import type { CompanyProfile } from '../../../backend/services/companyProfile/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  // report_settings unit 2 (e9 2026-11-12): writes ONLY user_guidance, server-side. It used to write
  // `{ ...existing.report_settings, user_guidance }` over the WHOLE column, and `existing` is a
  // SANITIZED read (competitor fields blanked), so every guidance save erased refine's competitor data
  // and reverted every other key to this read.
  const written = await mergeReportSettingsKeys(companyId, 'profile_guidance', { user_guidance: normalizedGuidance }, {
    updatedAt: new Date().toISOString(),
  });
  if (!written) return res.status(404).json({ error: 'Company profile not found' });
  const fresh = await readReportSettingsChecked(companyId);
  const profile: CompanyProfile = {
    ...existing,
    report_settings: fresh.settings as CompanyProfile['report_settings'],
  };

  const responseProfile = access.role === 'COMPANY_ADMIN'
    ? toLimitedCompanyProfile(profile) ?? profile
    : profile;

  return res.status(200).json({ profile: responseProfile });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-profile/guidance' });
