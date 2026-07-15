import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/health/metrics
 *
 * Returns the in-process snapshot of auth-subsystem counters tracked by
 * {@link snapshotAuthMetrics}. Used by:
 *   - dashboards (poll + aggregate),
 *   - the dev-only diagnostics panel,
 *   - oncall debugging ("how many forced signouts in the last hour?").
 *
 * Numbers are process-local — a serverless deployment with many cold
 * workers will report partial views. For canonical aggregates, plumb
 * these to a dedicated metrics backend.
 *
 * Public — no PII is exposed. Counters carry coarse tags (`code`,
 * `category`, `resolver`) only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { snapshotAuthMetrics } from '../../../backend/services/authMetrics';
import { getAuthReadiness, bootAuthSubsystem } from '../../../backend/security/startup/authSubsystemBoot';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  // Ensure boot has run so the fingerprint is present in the snapshot.
  if (!getAuthReadiness()) await bootAuthSubsystem();
  const readiness = getAuthReadiness();
  const snapshot = snapshotAuthMetrics();

  res.status(200).json({
    takenAt:           snapshot.takenAt,
    cardinalityCapped: snapshot.cardinalityCapped,
    counters:          snapshot.counters,
    fingerprint:       readiness?.fingerprint.fingerprint ?? null,
    authContractVersion: readiness?.fingerprint.authContractVersion ?? null,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/health/metrics' });
