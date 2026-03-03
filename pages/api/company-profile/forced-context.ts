import { NextApiRequest, NextApiResponse } from 'next';
import { getProfile, saveProfile } from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string) ||
    (req.body?.companyId as string) ||
    (req.body?.company_id as string);
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  const forced_context_fields = req.body?.forced_context_fields;
  if (forced_context_fields != null && typeof forced_context_fields !== 'object') {
    return res.status(400).json({ error: 'forced_context_fields must be an object (e.g. { brand_voice: true, geography: true })' });
  }

  const existing = await getProfile(companyId, { autoRefine: false });
  const newForcedFields =
    forced_context_fields != null
      ? (forced_context_fields as Record<string, boolean>)
      : existing?.forced_context_fields ?? null;

  const profile = await saveProfile({
    company_id: companyId,
    ...existing,
    forced_context_fields: newForcedFields,
  });
  return res.status(200).json({
    profile,
    forced_context_fields: profile.forced_context_fields ?? {},
  });
}
