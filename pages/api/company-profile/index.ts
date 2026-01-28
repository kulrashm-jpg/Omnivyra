import { NextApiRequest, NextApiResponse } from 'next';
import {
  getLatestProfile,
  getProfile,
  saveProfile,
} from '../../../backend/services/companyProfileService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);

  if (req.method === 'GET') {
    try {
      console.log('Resolved company_id:', companyId);
      if (!companyId) {
        const latest = await getLatestProfile();
        if (latest) {
          return res.status(200).json({ profile: latest });
        }
        const created = await saveProfile({});
        return res.status(200).json({ profile: created });
      }

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
        const created = await saveProfile({ ...req.body });
        return res.status(200).json({ profile: created });
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
