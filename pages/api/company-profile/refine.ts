import { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  refineProfileWithAIWithDetails,
  saveProfile,
  toLimitedCompanyProfile,
} from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (req.body?.company_id as string | undefined);
  const resolvedCompanyId = companyId;
  if (!resolvedCompanyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const access = await resolveCompanyAccess(req, res, resolvedCompanyId);
  if (!access) return;

  const effectiveCompanyId = resolvedCompanyId;
  try {
    let profile: any = null;
    profile = await getProfile(effectiveCompanyId, { autoRefine: false });
    if (!profile) {
      const seedProfile = await saveProfile({
        ...(req.body?.profile || req.body || {}),
        company_id: effectiveCompanyId,
        source: 'user',
      });
      profile = seedProfile;
    } else if (req.body && Object.keys(req.body).length > 0) {
      const hasSeedData = Object.values(req.body).some(
        (value) => value !== undefined && value !== null && value !== ''
      );
      if (hasSeedData) {
        profile = await saveProfile({
          ...profile,
          ...req.body,
          company_id: profile.company_id,
          source: profile.source || 'user',
        });
      }
    }
    const refined = await refineProfileWithAIWithDetails(profile, { force: true });
    const responseProfile =
      access.role === 'COMPANY_ADMIN'
        ? toLimitedCompanyProfile(refined.profile) ?? refined.profile
        : refined.profile;
    return res.status(200).json({ profile: responseProfile, refinement: refined.details });
  } catch (error: any) {
    console.error('Error refining company profile:', error);
    return res.status(500).json({
      error: 'Failed to refine company profile',
      details: error?.message || null,
    });
  }
}
