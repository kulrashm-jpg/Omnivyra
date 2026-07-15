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
        return res.status(201).json({ lead });
      } catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save lead' });
      }
    }

    // ── Mode 2: Embedded form submission — form_id in body (no auth required) ──
    if (body.form_id) {
      const form = await getForm(String(body.form_id));
      if (!form) return res.status(404).json({ error: 'Form not found' });
      const originDecision = await checkFormOrigin(form, typeof req.headers.origin === 'string' ? req.headers.origin : undefined);
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
      return res.status(201).json({ lead });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save lead' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/leads' });
