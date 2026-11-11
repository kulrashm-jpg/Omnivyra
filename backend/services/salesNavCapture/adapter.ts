/**
 * The Sales Navigator lead source adapter — PURE translation, like every other.
 *
 * Input is a `CapturedSavedLead` (from either transport) serialised as the raw
 * record; output is the vendor-neutral `NormalizedIngestionRecord`. No I/O, no
 * identity decision, no write: the orchestrator does all of that, exactly as
 * for CSV or Apollo.
 *
 * ─── IDENTITY ──────────────────────────────────────────────────────────────
 * `externalId` is `salesnav:<leadKey>` — the MEMBER, never the list, so a
 * person in two lists is one person (the simulator's rule, kept). The same key
 * goes into `externalKeys` under `linkedin_sales_navigator`, NOT under
 * `linkedin`: the Sales Navigator id is a different encoding from the core
 * LinkedIn member id, and putting it in the same namespace would let two
 * different numbering schemes collide.
 *
 * ─── WHAT IS DELIBERATELY NOT MAPPED ──────────────────────────────────────
 *  - email / phone: not on the page (owner decision P-3).
 *  - `company.linkedinUrl` is NEVER a website or domain. W4 normalises a website
 *    into a domain; `linkedin.com` would become the "domain" of every employer
 *    and merge them all into one account.
 *  - headline, location, profile URL: kept in the raw evidence only. Parsing a
 *    free-text location into a country code, or a headline into a title, would
 *    be invention; profile-URL identity claims are deferred (LI-5C Q-3).
 *
 * ─── RAW EVIDENCE IS LEAD-DESCRIBING ONLY ─────────────────────────────────
 * LI-2 hashes the whole raw payload for change detection. Per-capture fields
 * (capture time, page, list, the viewer's connection degree, saved-at) are
 * therefore NOT part of `raw`: if they were, every re-capture — or the same
 * lead seen in a second list — would register as "changed" evidence.
 * `capturedAt` travels as `observedAt` instead.
 */

import type { AdapterResult, LeadSourceAdapter, NormalizedIngestionRecord } from '../leadIngestion/contracts';
import { SALESNAV_SOURCE, type CapturedSavedLead } from './contract';
import { checkLeadKey, salesNavCompanyId } from './providers';

/** The raw evidence for one lead. Stable for an unchanged lead. */
export function toRawEvidence(lead: CapturedSavedLead): Record<string, unknown> {
  return {
    lead_key: lead.leadKey,
    capture_transport: lead.transport,
    public_profile_url: lead.profileUrl,
    full_name: lead.fullName,
    headline: lead.headline,
    title: lead.title,
    company_name: lead.company?.name ?? null,
    company_salesnav_urn: lead.company?.salesNavUrn ?? null,
    company_linkedin_url: lead.company?.linkedinUrl ?? null,
    location: lead.location,
  };
}

/**
 * The record handed to `ingestLeadBatch`: the raw evidence plus the capture
 * instant under a reserved key. The adapter reads `__observed_at` and returns
 * a `raw` WITHOUT it, so the instant never enters the hashed evidence.
 */
export function toBatchRecord(lead: CapturedSavedLead): Record<string, unknown> {
  return { ...toRawEvidence(lead), __observed_at: lead.capturedAt };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function translateSalesNavLead(raw: Record<string, unknown>, organizationId: string): AdapterResult {
  const checked = checkLeadKey(raw.lead_key);
  if ('reason' in checked) throw new Error(`sales navigator lead rejected: ${checked.reason}`);
  const leadKey = checked.key;

  const { __observed_at: observedAtRaw, ...evidence } = raw;
  const observedAt = str(observedAtRaw);

  // Derived at READ time from the evidence as captured (review F1).
  const companyName = str(evidence.company_name);
  const companyId = salesNavCompanyId(evidence.company_salesnav_urn);

  const normalized: NormalizedIngestionRecord = {
    organizationId,
    source: SALESNAV_SOURCE,
    entityType: 'person',
    externalId: `salesnav:${leadKey}`,
    person: {
      fullName: str(evidence.full_name),
      jobTitle: str(evidence.title),
      externalKeys: { [SALESNAV_SOURCE]: { external_id: leadKey } },
    },
    // Only a Sales Navigator company id anchors an employer. A name alone is
    // not identity, and the company's LinkedIn URL is never a domain (header).
    account: companyId
      ? { externalId: companyId, name: companyName }
      : null,
    observedAt,
    // Sales Navigator states no per-record confidence.
    confidence: null,
  };
  return { raw: evidence, normalized };
}

export const salesNavLeadSourceAdapter: LeadSourceAdapter = {
  source: SALESNAV_SOURCE,
  label: 'LinkedIn Sales Navigator (saved leads)',
  capabilities: ['person_discovery', 'bulk_fetch'],
  translate: translateSalesNavLead,
};
