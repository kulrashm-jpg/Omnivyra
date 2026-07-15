import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { buildProblemTransformationQuestions } from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string) || (req.body?.companyId as string);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  const result = buildProblemTransformationQuestions();
  return res.status(200).json(result);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-profile/problem-transformation-questions' });
