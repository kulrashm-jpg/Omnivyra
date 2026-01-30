import { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  refineProfileWithAIWithDetails,
  saveProfile,
} from '../../../backend/services/companyProfileService';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (req.body?.company_id as string | undefined);
  const user = await resolveUserContext(req);
  const resolvedCompanyId = companyId || user.defaultCompanyId;
  console.log('Resolved company_id:', resolvedCompanyId);
  const access = await enforceCompanyAccess({ req, res, companyId: resolvedCompanyId });
  if (!access) return;

  try {
    let profile: any = null;
    const effectiveCompanyId = resolvedCompanyId;
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
    return res.status(200).json({ profile: refined.profile, refinement: refined.details });
  } catch (error: any) {
    console.error('Error refining company profile:', error);
    return res.status(500).json({ error: 'Failed to refine company profile' });
  }
}
