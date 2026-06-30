/**
 * Canonical public-website lead capture (multi-tenant).
 *
 * THE single ingestion path for website submissions — it reuses the existing
 * canonical pipeline end to end and writes nothing directly:
 *   resolveVisitorSession  → server-authoritative session/visitor (never client-trusted)
 *   createLead             → identity resolution (ensureUnifiedPerson) + the ONE `leads`
 *                            write + adoptLead() canonical bridge (facade → repository)
 *   recordLeadAttribution  → canonical attribution snapshot + conversion
 *   stitchSessionToLead    → anonymous→lead identity stitch
 *   persistCampaignTouchpoint → conversion touchpoint
 *
 * Same helpers the existing /api/leads form-embed mode uses — no parallel persistence,
 * no duplicated attribution/tracking logic. The tenant is resolved UPSTREAM by
 * tenantResolutionService and passed in via `opts.companyId`; this service owns no
 * tenant bootstrap. Rich website fields are preserved verbatim in the lead metadata.
 */

import { ownedDbTable } from '../db/writeOwner';
import { createLead } from './leadService';
import { extractAttributionPayload, recordLeadAttribution } from './leadAttributionService';
import { resolveVisitorSession, stitchSessionToLead, persistCampaignTouchpoint } from './attributionResolverService';
import { LEAD_CAPTURE_INTENTS, isLeadIntent, ATTRIBUTION_FIELDS, LITE_INTENTS, type ConfirmationConfig, type LeadIntent } from '../../lib/website/leadCaptureConfig';

export interface WebsiteLeadFields {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  companySize?: string | null;
  industry?: string | null;
  country?: string | null;
  primaryInterest?: string | null;
  message?: string | null;
  consent?: boolean;
}

export interface WebsiteLeadSubmission extends WebsiteLeadFields {
  intent: string;
  /** raw POST body — the server re-derives attribution from it (client values are enrichment only). */
  rawBody: Record<string, unknown>;
}

export interface CaptureResult {
  status: 'created' | 'duplicate';
  leadId: string | null;
  intent: LeadIntent;
  confirmation: ConfirmationConfig;
}

export class LeadCaptureError extends Error {
  constructor(public code: string, public httpStatus: number, public fields?: Record<string, string>) {
    super(code);
    this.name = 'LeadCaptureError';
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/** Preserve every hidden attribution field verbatim (incl. ones the typed extractor doesn't map). */
function pickAttributionFields(rawBody: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ATTRIBUTION_FIELDS) {
    const v = rawBody[f];
    if (typeof v === 'string' && v.trim()) out[f] = v.trim();
  }
  return out;
}

const isLite = (intent?: string): boolean => !!intent && (LITE_INTENTS as readonly string[]).includes(intent);

export function validateWebsiteLead(fields: WebsiteLeadFields, intent?: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isLite(intent)) {
    // Full sales forms require a name; lite funnels (free audit) capture email + consent only.
    if (!fields.firstName?.trim()) errors.firstName = 'First name is required';
    if (!fields.lastName?.trim()) errors.lastName = 'Last name is required';
  }
  if (!fields.email?.trim()) errors.email = 'Work email is required';
  else if (!EMAIL_RE.test(fields.email.trim())) errors.email = 'Enter a valid email address';
  if (!fields.consent) errors.consent = 'Consent is required to proceed';
  return errors;
}

/** Duplicate-submission protection — a recent lead with the same email in this tenant. Read-only. */
async function findRecentLead(companyId: string, email: string, now: number): Promise<{ id: string } | null> {
  try {
    const sinceIso = new Date(now - DEDUPE_WINDOW_MS).toISOString();
    const { data, error } = await ownedDbTable('leads')
      .select('id, created_at')
      .eq('company_id', companyId)
      .eq('email', email)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return { id: String((data[0] as Record<string, unknown>).id) };
  } catch {
    return null;
  }
}

export async function captureWebsiteLead(
  submission: WebsiteLeadSubmission,
  opts: { companyId?: string | null; now?: number } = {},
): Promise<CaptureResult> {
  // Tenant is resolved upstream (tenantResolutionService) and passed in. The service
  // owns no tenant bootstrap of its own — no env read, no OmniVyra-specific default.
  const companyId = opts.companyId ?? null;
  if (!companyId) throw new LeadCaptureError('NOT_CONFIGURED', 503);
  if (!isLeadIntent(submission.intent)) throw new LeadCaptureError('INVALID_INTENT', 400);

  const errors = validateWebsiteLead(submission, submission.intent);
  if (Object.keys(errors).length > 0) throw new LeadCaptureError('VALIDATION', 400, errors);

  const cfg = LEAD_CAPTURE_INTENTS[submission.intent];
  const now = opts.now ?? Date.now();
  const email = submission.email!.trim().toLowerCase();
  // Lite funnels may omit the name — derive a display name from the email local-part.
  const fullName = [submission.firstName?.trim(), submission.lastName?.trim()].filter(Boolean).join(' ').trim()
    || email.split('@')[0]
    || 'Website visitor';

  // Duplicate protection — return the existing lead idempotently (no second write).
  const recent = await findRecentLead(companyId, email, now);
  if (recent) return { status: 'duplicate', leadId: recent.id, intent: submission.intent, confirmation: cfg.confirmation };

  // Server-authoritative attribution + session (client values are enrichment only).
  const attribution = extractAttributionPayload(submission.rawBody);
  const websiteId = attribution.website_id ?? null;
  const session = await resolveVisitorSession({ companyId, websiteId, attribution });

  const lead = await createLead(companyId, {
    name: fullName,
    email,
    phone: submission.phone?.trim() || undefined,
    source: 'website',
    website_id: websiteId,
    visitor_session_id: session.sessionId,
    attribution: attribution as Record<string, unknown>,
    consent_state: submission.consent ? 'granted' : 'not_granted',
    metadata: {
      lead_capture: true,
      intent: submission.intent,
      name: fullName,
      company_name: submission.company?.trim() || null,
      job_title: submission.jobTitle?.trim() || null,
      company_size: submission.companySize?.trim() || null,
      industry: submission.industry?.trim() || null,
      country: submission.country?.trim() || null,
      primary_interest: submission.primaryInterest?.trim() || cfg.defaultInterest,
      message: submission.message?.trim() || null,
      attribution,
      web_attribution: pickAttributionFields(submission.rawBody),
    },
  });

  await recordLeadAttribution({
    companyId,
    leadId: lead.id,
    websiteId,
    visitorSessionId: session.sessionId,
    source: lead.source,
    attribution: { ...attribution, first_touch: session.firstTouch, last_touch: session.lastTouch },
  });
  await stitchSessionToLead({ leadId: lead.id, companyId, visitorSessionId: session.sessionId, unifiedPersonId: lead.unified_person_id });
  await persistCampaignTouchpoint({ companyId, websiteId, visitorSessionId: session.sessionId, leadId: lead.id, attribution, touchpointType: 'conversion' });

  return { status: 'created', leadId: lead.id, intent: submission.intent, confirmation: cfg.confirmation };
}
