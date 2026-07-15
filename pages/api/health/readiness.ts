import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/health/readiness
 *
 * Reports whether the auth subsystem is fully serving traffic. The
 * canonical "is this process ready to be load-balanced into?" signal.
 *
 * Status semantics
 * ────────────────
 *   200 + status='ready'    → schema is healthy, boot fingerprint emitted,
 *                              every load-bearing check passed.
 *   503 + status='degraded' → at least one check failed but the subsystem
 *                              is operating in fallback mode. Auth still
 *                              works; specific guarantees (lifecycle gates,
 *                              JWT epoch revocation) may be relaxed.
 *
 * Differs from /api/health/schema (which is single-purpose: schema only)
 * by aggregating multiple checks and surfacing the boot fingerprint so a
 * single curl returns everything a deploy script / oncall needs.
 *
 * Public — no auth required. The response intentionally exposes the
 * auth contract version + manifest hash so deploy tooling can verify
 * version pinning without an authenticated request.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { bootAuthSubsystem } from '../../../backend/security/startup/authSubsystemBoot';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  const readiness = await bootAuthSubsystem();

  const body = {
    status:                 readiness.ready ? 'ready' : 'degraded',
    readinessVersion:       readiness.readinessVersion,
    bootedAt:               readiness.bootedAt,
    schemaHealthy:          readiness.schemaHealthy,
    reasons:                readiness.reasons,
    schema: {
      ok:        readiness.schema.ok,
      checkedAt: readiness.schema.checkedAt,
      missing:   readiness.schema.missing,
    },
    fingerprint: {
      fingerprint:         readiness.fingerprint.fingerprint,
      authContractVersion: readiness.fingerprint.authContractVersion,
      schemaManifestHash:  readiness.fingerprint.schemaManifestHash,
      nodeEnv:             readiness.fingerprint.nodeEnv,
      deploymentId:        readiness.fingerprint.deploymentId,
    },
  } as const;

  return res.status(readiness.ready ? 200 : 503).json(body);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/health/readiness' });
