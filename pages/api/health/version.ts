import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Version / Build / Environment Health Endpoint  (BETA-011 · RULE 3/4)
 *
 * GET /api/health/version
 *
 * The single source of truth an SRE / uptime monitor can hit to answer
 * "what exactly is deployed here?" — version, build (git commit / deployment id),
 * environment, node version, uptime, and the canonical boot fingerprint. Previously
 * this was only inferrable by calling /api/health/readiness and parsing its fingerprint.
 *
 * Read-only, no dependencies (reuses the already-cached boot fingerprint), so it stays
 * green even when DB/Redis are degraded — making it safe for liveness/version probes.
 *
 * 🔴 NODE RUNTIME ONLY.
 */

export const runtime = 'nodejs';

import type { NextApiRequest, NextApiResponse } from 'next';
import { emitBootFingerprint } from '../../../backend/security/startup/bootFingerprint';

function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const fp = emitBootFingerprint();
    res.status(200).json({
      status: 'ok',
      version: process.env.npm_package_version ?? null,
      // Build identity: git commit SHA (Vercel) / deployment id (Railway) when present.
      build: fp.deploymentId,
      environment: fp.vercelEnv ?? fp.railwayEnv ?? fp.nodeEnv,
      node_env: fp.nodeEnv,
      node_version: fp.nodeVersion,
      fingerprint: fp.fingerprint,
      auth_contract_version: fp.authContractVersion,
      schema_manifest_hash: fp.schemaManifestHash,
      uptime_seconds: Math.round(process.uptime()),
      booted_at: fp.emittedAt,
      ts: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err?.message || 'version probe failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/health/version' });
