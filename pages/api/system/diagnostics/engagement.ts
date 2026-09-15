import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

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
import { requireSuperAdminUser } from '../../../../backend/services/requestAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ROUTE-AUTH-001 (STEP 3AH-85): platform-wide engagement diagnostics — super admin only.
  const admin = await requireSuperAdminUser(req, res);
  if (!admin) return;

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/system/diagnostics/engagement' });
