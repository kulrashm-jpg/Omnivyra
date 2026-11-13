/**
 * GET /api/observability/metrics — Prometheus scrape endpoint (F-02).
 *
 * Exposes the HARDEN-001 in-process registry in Prometheus text format so an
 * external scraper can back the alert rules. Read-only; never mutates state.
 *
 * DARK BY DEFAULT: returns 404 unless OBSERVABILITY_EXPORT_TOKEN is set in the
 * environment. When set, requests must present the token via
 * `Authorization: Bearer <token>` or `x-metrics-secret: <token>` (the header
 * convention already used by /api/internal/metrics). PL-09(b): OBSERVABILITY_EXPORT_TOKEN_PREVIOUS, when set, is
 * also accepted (rotation) - see backend/security/metricsExportToken.ts; it never re-enables a dark endpoint.
 *
 * Note (same caveat as the super-admin snapshot): metrics are per-process. On
 * Vercel this reflects the instance that served the scrape; the long-lived
 * Railway worker exposes the fuller picture when scraped there.
 *
 * Built on the F-01 route factory — this endpoint is a validation adopter.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createApiRoute } from '../../../lib/platform/routeFactory';
import { decideMetricsExportToken, previousTokenGaugeText } from '../../../backend/security/metricsExportToken';
import {
  renderPrometheusText,
  PROMETHEUS_CONTENT_TYPE,
} from '../../../backend/observability';

function presentedToken(req: NextApiRequest): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const secret = req.headers['x-metrics-secret'];
  if (typeof secret === 'string' && secret.trim()) return secret.trim();
  return undefined;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  // PL-09(b): current OR previous token (rotation without a scrape gap) - the ONE shared decision, identical
  // to the worker target. SEC-C4: every comparison is constant-time and both always run.
  const decision = decideMetricsExportToken(presentedToken(req));
  if (decision === 'dark') {
    // Dark by default — indistinguishable from a missing route. A previous token never re-enables it.
    return res.status(404).end();
  }
  if (decision !== 'accepted') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(renderPrometheusText() + previousTokenGaugeText());
}

export default createApiRoute(handler, { route: '/api/observability/metrics' });
