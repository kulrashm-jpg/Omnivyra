
/**
 * GET /api/system/diagnostics/engagement
 * Administrative diagnostics for the engagement system.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getWorkerDiagnostics,
  getQueueDiagnostics,
  getIngestionDiagnostics,
  getResponseLearningDiagnostics,
  getReplyIntelligenceDiagnostics,
  getOpportunityDiagnostics,
} from '../../../../backend/services/engagementDiagnosticsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const [workers, queues, ingestion, response_learning, reply_intelligence, opportunities] =
      await Promise.all([
        getWorkerDiagnostics(),
        getQueueDiagnostics(),
        getIngestionDiagnostics(),
        getResponseLearningDiagnostics(),
        getReplyIntelligenceDiagnostics(),
        getOpportunityDiagnostics(),
      ]);

    return res.status(200).json({
      workers,
      queues,
      ingestion,
      response_learning,
      reply_intelligence,
      opportunities,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to fetch diagnostics';
    console.error('[system/diagnostics/engagement]', msg);
    return res.status(500).json({ error: msg });
  }
}
