import { NextApiRequest, NextApiResponse } from 'next';
import {
  saveProblemTransformationAnswers,
  toLimitedCompanyProfile,
} from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string) ||
    (req.body?.companyId as string) ||
    (req.body?.company_id as string);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  const rawAnswers = Array.isArray(req.body?.rawAnswers)
    ? req.body.rawAnswers
    : req.body?.answers;
  const answers = Array.isArray(rawAnswers)
    ? rawAnswers.map((a: unknown) => (a != null ? String(a) : null))
    : [];

  try {
    const profile = await saveProblemTransformationAnswers(companyId, answers);
    const responseProfile =
      access.role === 'COMPANY_ADMIN' ? toLimitedCompanyProfile(profile) ?? profile : profile;
    return res.status(200).json({ profile: responseProfile });
  } catch (err: any) {
    console.error('Problem transformation save failed:', err);
    return res.status(500).json({
      error: 'Failed to save problem transformation',
      details: err?.message || null,
    });
  }
}
