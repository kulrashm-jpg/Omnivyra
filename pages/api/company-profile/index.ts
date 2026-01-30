import { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  saveProfile,
} from '../../../backend/services/companyProfileService';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);
  const mode = (req.query.mode as string | undefined) || (req.body?.mode as string | undefined);
  const user = await resolveUserContext();

  if (req.method === 'GET') {
    try {
      if (mode === 'list') {
        const profiles = await Promise.all(
          user.companyIds.map(async (id) => {
            const profile = await getProfile(id, { autoRefine: false });
            return profile || { company_id: id, name: id };
          })
        );
        return res.status(200).json({
          user,
          companies: profiles.map((profile) => ({
            company_id: profile.company_id,
            name: profile.name || profile.company_id,
          })),
        });
      }

      console.log('Resolved company_id:', companyId);
      const access = await enforceCompanyAccess({ req, res, companyId });
      if (!access) return;

      const profile = await getProfile(companyId, { autoRefine: false });
      if (!profile) {
        const created = await saveProfile({ company_id: companyId });
        return res.status(200).json({ profile: created });
      }
      return res.status(200).json({ profile });
    } catch (error: any) {
      console.error('Error fetching company profile:', error);
      return res.status(500).json({ error: 'Failed to fetch company profile' });
    }
  }

  if (req.method === 'POST') {
    try {
      let resolvedCompanyId = companyId;
      if (!resolvedCompanyId) {
        const access = await enforceCompanyAccess({ req, res, companyId: resolvedCompanyId });
        if (!access) return;
      } else {
        const access = await enforceCompanyAccess({ req, res, companyId: resolvedCompanyId });
        if (!access) return;
      }
      const payload = {
        ...req.body,
        company_id: resolvedCompanyId,
      };
      const profile = await saveProfile(payload);
      return res.status(200).json({ profile });
    } catch (error: any) {
      console.error('Error saving company profile:', error);
      return res.status(500).json({ error: 'Failed to save company profile' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
