import { NextApiRequest, NextApiResponse } from 'next';
import { saveProblemTransformationAnswers } from '../../../backend/services/companyProfileService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin } from '../../../backend/services/rbacService';

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

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  if (!(await isSuperAdmin(user.id))) {
    const { role, error: roleError } = await getUserRole(user.id, companyId);
    if (roleError || !role) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
  }

  const rawAnswers = Array.isArray(req.body?.rawAnswers)
    ? req.body.rawAnswers
    : req.body?.answers;
  const answers = Array.isArray(rawAnswers)
    ? rawAnswers.map((a: unknown) => (a != null ? String(a) : null))
    : [];

  try {
    const profile = await saveProblemTransformationAnswers(companyId, answers);
    return res.status(200).json({ profile });
  } catch (err: any) {
    console.error('Problem transformation save failed:', err);
    return res.status(500).json({
      error: 'Failed to save problem transformation',
      details: err?.message || null,
    });
  }
}
