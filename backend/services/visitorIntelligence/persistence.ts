/**
 * V-A101 (persistence) — Canonical Visitor persistence contract (pure shape builder; NO writer wired
 * in Phase A). A compat adapter maps the canonical understanding to a legacy visitor-field shape so
 * consumers can be served the projection during adoption — Visitor is the sole owner; consumers
 * reference it.
 */

import type { VisitorUnderstanding, VisitorProjection, VisitorUnderstandingShadowRecord } from './types';

export function toShadowRecord(u: VisitorUnderstanding, projection: VisitorProjection, parity: number | null): VisitorUnderstandingShadowRecord {
  return { company_id: u.key.companyId, visitor_id: u.key.visitorId, version: u.version, understanding: u, projection, parity, built_at: u.builtAt };
}

export interface LegacyVisitorFields {
  company_id: string; visitor_id: string;
  status: string | null; lifecycle: string | null;
  device: string | null; country: string | null; source: string | null; campaign: string | null;
  lead_ref: string | null; page_count: number | null; confidence: number;
}
export function toLegacyFields(u: VisitorUnderstanding): LegacyVisitorFields {
  const id = u.facets.identity.value;
  return {
    company_id: u.key.companyId,
    visitor_id: u.key.visitorId,
    status: id?.status ?? null,
    lifecycle: u.facets.lifecycle.value?.state ?? null,
    device: u.facets.device.value?.device ?? null,
    country: u.facets.geo.value?.country ?? null,
    source: u.facets.acquisition.value?.source ?? null,
    campaign: u.facets.acquisition.value?.campaign ?? null,
    lead_ref: id?.leadRef ?? null,
    page_count: u.facets.session.value?.pageCount ?? null,
    confidence: u.score.confidence,
  };
}
