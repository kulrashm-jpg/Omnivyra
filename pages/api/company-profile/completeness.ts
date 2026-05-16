import { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  calculateCompanyProfileCompleteness,
} from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import {
  calculateIntelligenceReadiness,
  getCompanyContextIntelligence,
} from '../../../backend/services/companyContextIntelligenceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = req.query.companyId as string;
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  const profile = await getProfile(companyId, { autoRefine: false });
  const completeness = calculateCompanyProfileCompleteness(profile);
  const intelligence = await getCompanyContextIntelligence(companyId);
  const intelligenceReadiness = calculateIntelligenceReadiness({ intelligence, profile });

  return res.status(200).json({
    problem_transformation_completion: completeness.section_scores.problem_transformation,
    overall_profile_completion: completeness.score,
    profile_completeness: completeness,
    intelligence_readiness: intelligenceReadiness,
    ...completeness,
  });
}
