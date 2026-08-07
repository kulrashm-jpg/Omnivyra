import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { captureWebsiteLead, LeadCaptureError } from '../../../backend/services/leadCaptureService';
import { resolveTenantForWebsite } from '../../../backend/services/tenantResolutionService';
import { evaluateCaptureProtection } from '../../../backend/services/leadCaptureProtection';
import { LEAD_CAPTURE_INTENTS, isLeadIntent } from '../../../lib/website/leadCaptureConfig';

/**
 * POST /api/website/lead-capture — the public, MULTI-TENANT lead-capture endpoint.
 *
 * Canonical Tenant Resolution runs FIRST (verified domain → website id → host header →
 * integration key → configured default site); everything after is identical for every
 * tenant: leadCaptureService → createLead/adoptLead → identity → attribution →
 * repository → existing lead persistence. No tenant is hardcoded; unknown websites are
 * rejected. No direct DB writes here. The body is the authoritative attribution source
 * for the server (client values are enrichment only).
 */
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
const str = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v));

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const intent = str(body.intent) ?? '';

  // Honeypot — bots fill hidden fields. Drop silently with a success-shaped response.
  if (str(body.company_website)) {
    const cfg = isLeadIntent(intent) ? LEAD_CAPTURE_INTENTS[intent] : LEAD_CAPTURE_INTENTS.contact_sales;
    return res.status(200).json({ status: 'created', leadId: null, intent: cfg.intent, confirmation: cfg.confirmation });
  }

  // G1 (LC-102): abuse protection WRAPS the existing pipeline — runs after the
  // honeypot, before tenant resolution. Fail-open; never blocks legitimate capture.
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0]?.trim() || null;
  const guard = await evaluateCaptureProtection({
    ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    email: str(body.email),
    nonce: str(body.submission_id) ?? str(body.nonce),
    captchaToken: str(body.captcha_token) ?? str(body.cf_turnstile_response),
  });
  if (!guard.allowed) {
    if (guard.retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(guard.retryAfterMs / 1000)));
    return res.status(guard.httpStatus ?? 429).json({ error: guard.reason ?? 'blocked' });
  }

  // Canonical tenant resolution — the only entry point into public ingestion.
  const tenant = await resolveTenantForWebsite({
    websiteId: str(body.website_id),
    origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
    host: typeof req.headers.host === 'string' ? req.headers.host : null,
    integrationId: str(body.integration_id),
    integrationSecret: str(body.integration_secret) ?? str(body.webhook_secret),
  });
  if (!tenant) return res.status(404).json({ error: 'unrecognized_website' });

  try {
    const result = await captureWebsiteLead({
      intent,
      firstName: str(body.firstName),
      lastName: str(body.lastName),
      email: str(body.email),
      phone: str(body.phone),
      company: str(body.company),
      jobTitle: str(body.jobTitle),
      companySize: str(body.companySize),
      industry: str(body.industry),
      country: str(body.country),
      primaryInterest: str(body.primaryInterest),
      message: str(body.message),
      consent: bool(body.consent),
      rawBody: body,
      // WS-2 M2: headers carry the user-agent and the edge geography used to
      // derive coarse device/location context. Nothing raw is persisted.
      requestHeaders: req.headers as Record<string, unknown>,
    }, { companyId: tenant.tenantId });
    return res.status(result.status === 'created' ? 201 : 200).json(result);
  } catch (err) {
    if (err instanceof LeadCaptureError) {
      return res.status(err.httpStatus).json({ error: err.code, fields: err.fields });
    }
    return res.status(500).json({ error: 'capture_failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website/lead-capture' });
