import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  runPostGeneration,
  type PostGenerationRequest,
} from '../../../lib/post/runPostGeneration';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company_id,
    topic,
    platform,
    intent,
    objective,
    target_audience,
    tone,
    cta,
    template_name,
    extra_instruction,
  } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return res.status(400).json({ error: 'topic required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req,
    res,
    companyId: company_id,
    allowedRoles: [
      Role.COMPANY_ADMIN,
      Role.CONTENT_CREATOR,
      Role.CONTENT_REVIEWER,
      Role.CONTENT_PUBLISHER,
      Role.SUPER_ADMIN,
    ],
  });
  if (!roleGate) return;

  try {
    const result = await runPostGeneration({
      company_id,
      topic: topic.trim(),
      platform: typeof platform === 'string' ? platform : undefined,
      intent: typeof intent === 'string' ? intent : undefined,
      objective: typeof objective === 'string' ? objective : undefined,
      target_audience: typeof target_audience === 'string' ? target_audience : undefined,
      tone: typeof tone === 'string' ? tone : undefined,
      cta: typeof cta === 'string' ? cta : undefined,
      template_name: typeof template_name === 'string' ? template_name : undefined,
      extra_instruction: typeof extra_instruction === 'string' ? extra_instruction : undefined,
    } satisfies PostGenerationRequest);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[posts/generate] runPostGeneration error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate post',
    });
  }
}
