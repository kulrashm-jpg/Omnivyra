/**
 * The two Sales Navigator saved-lead providers behind one interface.
 *
 *   linkedin_salesnav_extension  PUSH. Outreach's extension captures what the
 *                                user sees and the route hands it over.
 *   linkedin_snap                PULL. The official LinkedIn Sales Navigator
 *                                Application Platform. A STUB until the
 *                                partnership is live: always `not_connected`.
 *
 * Both produce `CapturedSavedLead`. Validation of the extension's wire shape
 * lives here, in the provider, so the adapter only ever sees clean,
 * transport-neutral leads.
 */

import { SALESNAV_EXTENSION_CAPTURE_ENABLED } from './captureSwitch';
import {
  CAPTURE_CONTRACT_VERSION,
  MAX_CAPTURE_BATCH,
  type AcceptedBatch,
  type CaptureBatchPayload,
  type CapturedLeadWire,
  type CapturedSavedLead,
  type SavedLeadsProvider,
  type SavedLeadsProviderId,
} from './contract';

// ── small, strict field readers ─────────────────────────────────────────────

/** Trimmed non-empty string up to `max` chars; anything else is absent. */
export function text(v: unknown, max = 500): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

const LEAD_KEY_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;

/**
 * Validate a `lead_key`. Returns the key or a rejection code.
 *
 * A FULL `fs_salesProfile` URN is refused outright (agreed defence in depth):
 * its tuple carries a per-search suffix, so accepting it would split one person
 * into one identity per search. The extension refuses to send one too.
 */
export function checkLeadKey(v: unknown): { key: string } | { reason: string } {
  if (typeof v !== 'string' || !v.trim()) return { reason: 'missing_lead_key' };
  const k = v.trim();
  if (/urn:|[(),:]/i.test(k)) return { reason: 'lead_key_is_full_urn' };
  if (!LEAD_KEY_PATTERN.test(k)) return { reason: 'invalid_lead_key' };
  return { key: k };
}

/**
 * A captured evidence string, kept EXACTLY as sent: no trimming, no case
 * change, no URL rewriting (see `CapturedSavedLead`, review F1). Only absence,
 * blankness and oversize are refused, which are rejections, not transformations.
 */
export function captured(v: unknown, max = 500): string | null {
  return typeof v === 'string' && v.trim() !== '' && v.length <= max ? v : null;
}

/**
 * A captured URL that is safe to STORE as evidence, kept verbatim, or null.
 *
 * Refusing is not rewriting (F1 holds): a URL is either stored exactly as sent
 * or not stored at all. Refused, because storing them would persist a secret or
 * a non-profile locator (review NEW 1):
 *  - credentials in the authority (`user:pass@`);
 *  - any Sales Navigator app URL (`/sales/...`): `/sales/lead/<id>,<authToken>`
 *    carries an auth token, and the boundary's redactor matches KEY names only,
 *    never values, so a token in a URL value would be stored durably;
 *  - anything that does not parse as an absolute http(s) URL.
 */
export function capturedUrl(v: unknown, max = 400): string | null {
  const c = captured(v, max);
  if (!c) return null;
  let u: URL;
  try { u = new URL(c.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (/^\/sales(\/|$)/i.test(u.pathname)) return null;
  return c;
}

// The LinkedIn URL normaliser and slug classifier live in the neutral
// `lib/linkedin/profileUrl.ts`, shared with Outreach's extension so the two
// sides cannot drift. Re-exported here for the capture module's callers.
export { normalizeLinkedinUrl, classifyLinkedinProfile, type LinkedinSlugForm } from '../../../lib/linkedin/profileUrl';

/**
 * The Sales Navigator company id: the trailing number of
 * `urn:li:fs_salesCompany:<n>` (or a bare number). Anything else is absent —
 * an unrecognised shape is not guessed into an identity.
 */
export function salesNavCompanyId(v: unknown): string | null {
  const t = text(v, 200);
  if (!t) return null;
  const m = /^(?:urn:li:fs_salesCompany:)?(\d{1,20})$/.exec(t);
  return m ? m[1] : null;
}

/** Five minutes of clock skew between browser and server is tolerated. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function checkCapturedAt(v: unknown, now: Date): string | null {
  const t = text(v, 64);
  if (!t) return null;
  const ms = Date.parse(t);
  if (Number.isNaN(ms) || ms > now.getTime() + MAX_FUTURE_SKEW_MS) return null;
  return new Date(ms).toISOString();
}

/**
 * Validate the batch envelope. Returns a refusal code, or null when the
 * envelope is acceptable. Per-lead problems are NOT refusals of the batch.
 */
export function checkEnvelope(
  payload: CaptureBatchPayload | null | undefined,
  now: Date,
): { refusal: 'unsupported_provider' | 'unsupported_contract_version' | 'unsupported_surface' | 'invalid_payload' | 'batch_too_large'; detail: string } | null {
  if (!payload || typeof payload !== 'object') return { refusal: 'invalid_payload', detail: 'payload_not_object' };
  if (payload.provider !== 'linkedin_salesnav_extension') return { refusal: 'unsupported_provider', detail: 'provider' };
  if (payload.contract_version !== CAPTURE_CONTRACT_VERSION) {
    return { refusal: 'unsupported_contract_version', detail: 'contract_version' };
  }
  if (!payload.source || payload.source.surface !== 'sales_navigator') {
    return { refusal: 'unsupported_surface', detail: 'source.surface' };
  }
  if (!checkCapturedAt(payload.captured_at, now)) return { refusal: 'invalid_payload', detail: 'captured_at' };
  if (!Array.isArray(payload.leads) || payload.leads.length === 0) return { refusal: 'invalid_payload', detail: 'leads' };
  if (payload.leads.length > MAX_CAPTURE_BATCH) return { refusal: 'batch_too_large', detail: `max_${MAX_CAPTURE_BATCH}` };
  return null;
}

/** Translate one wire lead. Throws nothing; returns a lead or a reason. */
export function fromWire(
  w: CapturedLeadWire,
  capturedAt: string,
): { lead: CapturedSavedLead } | { reason: string } {
  if (!w || typeof w !== 'object') return { reason: 'lead_not_object' };
  const checked = checkLeadKey(w.lead_key);
  if ('reason' in checked) return checked;
  const rawUrn = text(w.raw_urn, 400);
  // The raw URN is evidence the key was extracted from. If it is sent and does
  // not contain the key, the extraction is wrong — refuse rather than mint an
  // identity from a key nobody can trace.
  if (rawUrn && !rawUrn.includes(checked.key)) return { reason: 'lead_key_urn_mismatch' };

  const companyName = captured(w.company_name, 300);
  const companyUrn = captured(w.company_salesnav_urn, 200);
  const companyUrl = capturedUrl(w.company_linkedin_url);
  return {
    lead: {
      leadKey: checked.key,
      profileUrl: capturedUrl(w.public_profile_url),
      fullName: captured(w.full_name, 300),
      headline: captured(w.headline, 500),
      title: captured(w.title, 300),
      company: companyName || companyUrn || companyUrl
        ? { name: companyName, salesNavUrn: companyUrn, linkedinUrl: companyUrl }
        : null,
      location: captured(w.location, 300),
      capturedAt,
      transport: 'extension',
    },
  };
}

// ── the providers ───────────────────────────────────────────────────────────

export const extensionSavedLeadsProvider: SavedLeadsProvider = {
  id: 'linkedin_salesnav_extension',
  transport: 'extension',
  label: 'Sales Navigator (Omnivyra extension)',
  async availability() {
    return SALESNAV_EXTENSION_CAPTURE_ENABLED
      ? { available: true, reason: 'enabled' }
      : { available: false, reason: 'capture_disabled_pending_owner_terms_acceptance' };
  },
  acceptBatch(payload: CaptureBatchPayload): AcceptedBatch {
    const capturedAt = checkCapturedAt(payload.captured_at, new Date()) ?? new Date().toISOString();
    const seen = new Set<string>();
    const rows: AcceptedBatch['rows'] = [];
    for (const w of payload.leads) {
      const key = typeof w?.lead_key === 'string' ? w.lead_key.trim() || null : null;
      const r = fromWire(w, capturedAt);
      if ('reason' in r) { rows.push({ key, lead: null, reason: r.reason }); continue; }
      if (seen.has(r.lead.leadKey)) { rows.push({ key, lead: null, reason: 'duplicate_in_batch' }); continue; }
      seen.add(r.lead.leadKey);
      rows.push({ key, lead: r.lead });
    }
    return { rows };
  },
};

export class SnapNotConnectedError extends Error {
  constructor() {
    super('LinkedIn SNAP is not connected: the partnership is not live');
    this.name = 'SnapNotConnectedError';
  }
}

/**
 * LinkedIn SNAP — STUB. The official partner API is the lawful long-term path;
 * until the partnership is live there is no endpoint, credential or field
 * mapping to implement, and inventing one would advertise a source that cannot
 * be read. `providerCapabilityModel` keeps `linkedin_sales_navigator` BLOCKED.
 * When it goes live: implement `fetchSavedLeads` to map SNAP records onto
 * `CapturedSavedLead` with `transport: 'snap'` — nothing downstream changes.
 */
export const snapSavedLeadsProvider: SavedLeadsProvider = {
  id: 'linkedin_snap',
  transport: 'snap',
  label: 'LinkedIn Sales Navigator Application Platform (SNAP)',
  async availability() {
    return { available: false, reason: 'not_connected' };
  },
  async fetchSavedLeads() {
    throw new SnapNotConnectedError();
  },
};

const PROVIDERS: Readonly<Record<SavedLeadsProviderId, SavedLeadsProvider>> = Object.freeze({
  linkedin_salesnav_extension: extensionSavedLeadsProvider,
  linkedin_snap: snapSavedLeadsProvider,
});

export function getSavedLeadsProvider(id: string): SavedLeadsProvider | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id as SavedLeadsProviderId] : null;
}
