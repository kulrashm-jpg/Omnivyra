import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';

import {
  FeedbackProcessingError,
  getPromptFeedbackScope,
  processPromptFeedbackResponse,
} from '../../../backend/services/feedbackProcessingService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

type RespondBody = {
  intelligence_prompt_id?: unknown;
  response_type?: unknown;
  response_payload?: unknown;
};

function bodyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body || {}) as RespondBody;
  const intelligencePromptId = bodyText(body.intelligence_prompt_id);
  const responseType = bodyText(body.response_type);

  if (!intelligencePromptId) {
    return res.status(400).json({ error: 'intelligence_prompt_id is required' });
  }

  if (!responseType) {
    return res.status(400).json({ error: 'response_type is required' });
  }

  try {
    const scope = await getPromptFeedbackScope(intelligencePromptId);
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: scope.companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    const result = await processPromptFeedbackResponse({
      intelligence_prompt_id: intelligencePromptId,
      response_type: responseType,
      response_payload: body.response_payload ?? {},
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    const statusCode = error instanceof FeedbackProcessingError
      ? error.statusCode
      : 500;
    const message = error instanceof Error
      ? error.message
      : 'Failed to process prompt response';

    console.error('[intelligence/respond]', message);
    return res.status(statusCode).json({ error: message });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

