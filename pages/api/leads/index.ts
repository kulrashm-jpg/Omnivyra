import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  createLead,
  getLeads,
  validateWebhookAuth,
  getForm,
} from '../../../backend/services/leadService';
import {
  extractAttributionPayload,
  recordLeadAttribution,
} from '../../../backend/services/leadAttributionService';
import { resolveVisitorSession, stitchSessionToLead, persistCampaignTouchpoint } from '../../../backend/services/attributionResolverService';
import { checkFormOrigin } from '../../../backend/services/websiteDomainEnforcementService';
import { triggerLeadIntelligence } from '../../../backend/services/leadIntelligenceActivation';
import { checkRateLimit } from '../../../lib/auth/rateLimit';
import { getTrustedClientIp } from '../../../lib/security/clientIp';
import { recordRawCounter } from '../../../backend/observability';

/**
 * WSF-ORD-003 abuse controls for the ANONYMOUS embedded-form branch (Mode 2).
 *
 * Both limits use the repo's canonical limiter (lib/auth/rateLimit) and are
 * NOT marked `sensitive`, matching every other public non-auth limit here
 * (rl:domain_track, rl:domain_verification_status, DOMAIN_RESOLUTION_LIMIT).
 * That matters: `sensitive` limits go 'strict' when Redis is down, while these
 * take the generous in-memory fallback — during a Redis outage a public
 * capture form must keep accepting real leads rather than start dropping them.
 */

/**
 * Per client IP: 20 per minute. Deliberately the same budget the repo already
 * chose for anonymous lead capture (LEAD_CAPTURE_RATE_LIMIT, 20/60s in
 * backend/services/leadCaptureProtection.ts), and inside the 30/60s band the
 * other public endpoints use — a little tighter because this one WRITES a lead
 * rather than reading or recording telemetry.
 */
const LEAD_FORM_IP_LIMIT = { keyPrefix: 'rl:leads:form:ip', limit: 20, windowSecs: 60 };

/**
 * Per form_id: 60 per minute. This is the dimension the per-IP limit cannot
 * cover — a leaked form_id flooded from many addresses. 60/min is ~3x the
 * per-IP budget, so it only binds once traffic is spread over 3+ IPs, i.e.
 * exactly the distributed case; and it is far above any real single-form rate
 * (60/min sustained would be ~86k submissions a day on one form).
 */
const LEAD_FORM_ID_LIMIT = { keyPrefix: 'rl:leads:form:id', limit: 60, windowSecs: 60 };

/** Fail-safe metric emit — observability must never break lead capture. */
function countLeadFormEvent(metric: string, labels: Record<string, string>): void {
  try { recordRawCounter(metric, 1, labels); } catch { /* fail-safe */ }
}

/**
 * OFF by default and deliberately NOT enabled. When an operator sets it, a form
 * with no allowed_domains is refused instead of being accepted fail-open. It
 * exists so the fail-open state is controllable once the
 * `leads.form_submission_unverified_origin` counter shows which tenants would
 * be affected; turning it on before then would silently stop real capture.
 */
const strictOriginMode = (): boolean => {
  const v = String(process.env.LEAD_FORM_REQUIRE_ALLOWED_DOMAINS ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
};

function setCors(req: NextApiRequest, res: NextApiResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Omnivera-Signature');
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(req, res);
  // CORS — allow embed script and external webhooks to call this endpoint
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: list leads (authenticated) ───────────────────────────────────────
  if (req.method === 'GET') {
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
    if (!companyId) return res.status(400).json({ error: 'company_id is required' });
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;

    const { form_id, integration_id, source, since, is_test } = req.query;
    try {
      const leads = await getLeads(companyId, {
        form_id: typeof form_id === 'string' ? form_id : undefined,
        integration_id: typeof integration_id === 'string' ? integration_id : undefined,
        source: typeof source === 'string' ? source : undefined,
        since: typeof since === 'string' ? since : undefined,
        is_test: is_test === 'true' ? true : is_test === 'false' ? false : undefined,
      });
      return res.status(200).json({ leads });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load leads' });
    }
  }

  // ── POST: capture lead (three modes) ─────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    // ── Mode 1: Inbound webhook — integration_id + webhook_secret (or api_key) ──
    if (body.integration_id && (body.webhook_secret || body.api_key)) {
      const secret = body.webhook_secret || body.api_key;
      const auth = await validateWebhookAuth(String(body.integration_id), String(secret));
      if (!auth) return res.status(401).json({ error: 'Invalid integration_id or webhook_secret' });

      const { name, email, phone, source, metadata, is_test } = body;
      if (!name || !email) return res.status(400).json({ error: 'name and email are required' });

      try {
        const attribution = extractAttributionPayload(body);
        const websiteId = auth.website_id ?? attribution.website_id ?? null;
        const session = await resolveVisitorSession({
          companyId: auth.company_id,
          websiteId,
          attribution,
        });
        const lead = await createLead(auth.company_id, {
          name: String(name).trim(),
          email: String(email).trim().toLowerCase(),
          phone: phone ? String(phone).trim() : undefined,
          source: source ? String(source) : 'webhook',
          integration_id: body.integration_id,
          website_id: websiteId,
          visitor_session_id: session.sessionId,
          attribution: attribution as Record<string, unknown>,
          consent_state: attribution.consent_state ?? null,
          metadata: {
            ...(typeof metadata === 'object' && metadata !== null ? metadata : {}),
            attribution,
          },
          is_test: !!is_test,
        });
        await recordLeadAttribution({
          companyId: auth.company_id,
          leadId: lead.id,
          websiteId,
          visitorSessionId: session.sessionId,
          source: lead.source,
          attribution: { ...attribution, first_touch: session.firstTouch, last_touch: session.lastTouch },
        });
        await stitchSessionToLead({ leadId: lead.id, companyId: auth.company_id, visitorSessionId: session.sessionId, unifiedPersonId: lead.unified_person_id });
        await persistCampaignTouchpoint({ companyId: auth.company_id, websiteId, visitorSessionId: session.sessionId, leadId: lead.id, attribution, touchpointType: 'conversion' });
        // INT-002 Wave 1: fire-and-forget intelligence generation after the chain.
        triggerLeadIntelligence(auth.company_id, lead.id, 'lead_captured');
        return res.status(201).json({ lead });
      } catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save lead' });
      }
    }

    // ── Mode 2: Embedded form submission — form_id in body (no auth required) ──
    //
    // WSF-ORD-003 — OWNER REVIEW 2026-09-18 (repo owner, via release gate)
    // confirmed this branch PUBLIC BY PRODUCT CONTRACT, so it is KEPT
    // unauthenticated on purpose. The route-auth gate flags it (R5-ORDER: an
    // anonymous caller reaches a write) and keeps printing it as a tracked
    // finding — correct, because it IS a deliberate anonymous mutation and
    // should stay visible.
    //
    // It is not an authorization defect: an embedded capture form is submitted
    // by anonymous visitors on the customer's own site (hence setCors and the
    // OPTIONS branch above), and the TENANT IS DERIVED SERVER-SIDE from the
    // form row — every write below passes form.company_id, never a company
    // taken from the request — so a submission can only ever create a lead for
    // the company that owns this form_id. No cross-tenant write is reachable.
    //
    // The route is deliberately NOT declared kind:"public": that kind is
    // order-exempt for the WHOLE route and would also exempt the authenticated
    // GET (enforceCompanyAccess) and Mode 3 below.
    //
    // ABUSE CONTROLS (WSF-ORD-003, owner pulled into scope 2026-09-18). Being
    // public is the contract; being UNMETERED was the gap — a leaked form_id
    // could be used to flood its tenant's lead list. Two limits now bound it,
    // both before any write. They are abuse controls, not authorization: the
    // tenant still comes only from form.company_id, unchanged.
    if (body.form_id) {
      // Per-IP first: it is the cheapest check, and it caps form_id PROBING as
      // well as submission, so an unknown id never reaches the database read.
      const clientIp = getTrustedClientIp(req);
      const ipRl = await checkRateLimit(clientIp, LEAD_FORM_IP_LIMIT);
      if (!ipRl.allowed) {
        countLeadFormEvent('leads.form_submission_rate_limited', { scope: 'ip' });
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'Too many submissions. Please try again shortly.' });
      }

      const form = await getForm(String(body.form_id));
      if (!form) return res.status(404).json({ error: 'Form not found' });

      // Per-form second, keyed by the RESOLVED form id so the Redis key space
      // is bounded by real forms rather than by whatever a caller posts. This
      // is the dimension the per-IP limit cannot see: one form flooded from
      // many addresses.
      const formRl = await checkRateLimit(form.id, LEAD_FORM_ID_LIMIT);
      if (!formRl.allowed) {
        countLeadFormEvent('leads.form_submission_rate_limited', { scope: 'form' });
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'Too many submissions. Please try again shortly.' });
      }

      const originDecision = await checkFormOrigin(form, typeof req.headers.origin === 'string' ? req.headers.origin : undefined);

      // The fail-open origin state is now EXPLICIT and MEASURED. A form with no
      // allowed_domains is still accepted — refusing it would silently stop
      // real capture for tenants whose forms were created without one — but
      // every such submission is counted, so the size of that population is
      // visible before anyone tightens it.
      if (originDecision.allowlistConfigured === false) {
        countLeadFormEvent('leads.form_submission_unverified_origin', { form_id: String(form.id) });
        // Opt-in strict mode, default OFF and NOT enabled here. See
        // LEAD_FORM_REQUIRE_ALLOWED_DOMAINS above.
        if (strictOriginMode()) {
          return res.status(403).json({ error: 'This form requires a configured domain allowlist.' });
        }
      }

      if (!originDecision.allowed) return res.status(403).json({ error: originDecision.message });

      // Validate required fields per form schema
      for (const field of form.fields) {
        if (field.required && !body[field.name]) {
          return res.status(400).json({ error: `${field.label} is required` });
        }
      }

      // Resolve name and email from dynamic field names
      const emailField = form.fields.find(f => f.type === 'email');
      const nameField = form.fields.find(f => f.type === 'text');
      const phoneField = form.fields.find(f => f.type === 'phone');

      const leadEmail = emailField ? body[emailField.name] : body.email;
      const leadName = nameField ? body[nameField.name] : (body.name || 'Unknown');
      const leadPhone = phoneField ? body[phoneField.name] : body.phone;

      if (!leadEmail) return res.status(400).json({ error: 'email is required' });

      try {
        const attribution = extractAttributionPayload({
          ...body,
          website_id: body.website_id ?? form.website_id ?? null,
        });
        const websiteId = form.website_id ?? attribution.website_id ?? null;
        const session = await resolveVisitorSession({
          companyId: form.company_id,
          websiteId,
          attribution,
        });
        const lead = await createLead(form.company_id, {
          name: String(leadName).trim(),
          email: String(leadEmail).trim().toLowerCase(),
          phone: leadPhone ? String(leadPhone).trim() : undefined,
          source: 'form_embed',
          form_id: form.id,
          integration_id: form.integration_id ?? undefined,
          website_id: websiteId,
          visitor_session_id: session.sessionId,
          attribution: attribution as Record<string, unknown>,
          consent_state: attribution.consent_state ?? null,
          metadata: { form_name: form.name, attribution, origin_decision: originDecision },
          is_test: !!body.is_test,
        });
        await recordLeadAttribution({
          companyId: form.company_id,
          leadId: lead.id,
          formId: form.id,
          websiteId,
          visitorSessionId: session.sessionId,
          source: lead.source,
          attribution: { ...attribution, first_touch: session.firstTouch, last_touch: session.lastTouch },
        });
        await stitchSessionToLead({ leadId: lead.id, companyId: form.company_id, visitorSessionId: session.sessionId, unifiedPersonId: lead.unified_person_id });
        await persistCampaignTouchpoint({ companyId: form.company_id, websiteId, visitorSessionId: session.sessionId, leadId: lead.id, attribution, touchpointType: 'conversion' });
        // INT-002 Wave 1: fire-and-forget intelligence generation after the chain.
        triggerLeadIntelligence(form.company_id, lead.id, 'lead_captured');
        return res.status(201).json({ lead });
      } catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save lead' });
      }
    }

    // ── Mode 3: Authenticated manual entry ────────────────────────────────────
    const companyId =
      typeof req.query.company_id === 'string' ? req.query.company_id :
      typeof body.company_id === 'string' ? body.company_id : null;
    if (!companyId) return res.status(400).json({ error: 'company_id is required' });

    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;

    const { name, email, phone, source, metadata } = body;
    if (!name || !email) return res.status(400).json({ error: 'name and email are required' });

    try {
      const attribution = extractAttributionPayload(body);
      const lead = await createLead(companyId, {
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        phone: phone ? String(phone).trim() : undefined,
        source: source ? String(source) : 'manual',
        website_id: attribution.website_id ?? null,
        attribution: attribution as Record<string, unknown>,
        consent_state: attribution.consent_state ?? null,
        metadata: {
          ...(typeof metadata === 'object' && metadata !== null ? metadata : {}),
          attribution,
        },
      });
      await recordLeadAttribution({
        companyId,
        leadId: lead.id,
        websiteId: attribution.website_id ?? null,
        visitorSessionId: null,
        source: lead.source,
        attribution,
      });
      // INT-002 Wave 1: fire-and-forget intelligence generation after the chain.
      triggerLeadIntelligence(companyId, lead.id, 'lead_captured');
      return res.status(201).json({ lead });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save lead' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/leads' });
