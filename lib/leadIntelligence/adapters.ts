/**
 * Source adapters — the ONLY source-specific code in the domain.
 *
 * Each adapter transforms an existing source row (verbatim shapes from the audited
 * tables) into the canonical `CanonicalLeadInput`. No source-specific lead model,
 * no business logic — pure transforms. A registry routes `(source, raw)` to the
 * right adapter. Tenant id is unified here (`company_id` ?? `organization_id`),
 * resolving the audited dual-naming at the canonical boundary.
 */

import type {
  CanonicalLeadInput,
  CanonicalLeadSource,
  CanonicalIdentityHints,
  CanonicalLeadScores,
} from './types';
import { buildAttributionContract } from './attribution';
import { resolveCanonicalSource } from './sourceTaxonomy';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : v == null ? null : String(v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function tenantOf(row: Row): string {
  return String(row.organization_id ?? row.company_id ?? row.organizationId ?? row.companyId ?? '');
}

function identityFrom(row: Row, extra: Partial<CanonicalIdentityHints> = {}): CanonicalIdentityHints {
  const externalKeys: Record<string, unknown> = { ...obj(row.external_keys), ...(extra.externalKeys ?? {}) };
  const platform = s(row.platform) ?? extra.platform ?? null;
  const platformUserId = s(row.platform_user_id) ?? extra.platformUserId ?? null;
  if (platform && platformUserId) externalKeys[`${platform}:user`] = platformUserId;
  const contactId = s(row.contact_id) ?? extra.contactId ?? null;
  if (contactId) externalKeys.contact_id = contactId;
  return {
    email: s(row.email) ?? extra.email ?? null,
    phone: s(row.phone) ?? extra.phone ?? null,
    unifiedPersonId: s(row.unified_person_id) ?? extra.unifiedPersonId ?? null,
    anonymousId: s(row.anonymous_id) ?? extra.anonymousId ?? null,
    contactId,
    platform,
    platformUserId,
    externalKeys: Object.keys(externalKeys).length ? externalKeys : undefined,
  };
}

function scoresFrom(row: Row): CanonicalLeadScores {
  return {
    intent: num(row.intent_score),
    urgency: num(row.urgency_score),
    icp: num(row.icp_score),
    confidence: num(row.confidence_score),
    total: num(row.total_score) ?? num(row.qualification_score) ?? num(row.lead_score),
  };
}

function assemble(
  source: CanonicalLeadSource,
  row: Row,
  opts: {
    table: string;
    identity?: Partial<CanonicalIdentityHints>;
    attributionExtra?: Record<string, unknown>;
    occurredAt?: unknown;
    status?: unknown;
    display?: CanonicalLeadInput['display'];
  },
): CanonicalLeadInput {
  const identity = identityFrom(row, opts.identity);
  const attribution = buildAttributionContract({ ...row, ...(opts.attributionExtra ?? {}) }, identity);
  return {
    organizationId: tenantOf(row),
    source,
    identity,
    attribution,
    scores: scoresFrom(row),
    status: s(opts.status ?? row.status),
    occurredAt: s(opts.occurredAt ?? row.detected_at ?? row.created_at ?? row.occurred_at ?? row.converted_at),
    display: opts.display ?? { name: s(row.name), title: s(row.title), contentText: s(row.content_text ?? row.content) },
    sourceRef: { table: opts.table, id: s(row.id) },
  };
}

export type SourceAdapter = (row: Row) => CanonicalLeadInput;

/* ── Distinct-shape adapters ─────────────────────────────────────────────── */

/** `leads` row (form/website capture). Resolves website vs webhook vs manual from `source`. */
export const websiteAdapter: SourceAdapter = (row) => {
  const resolved = resolveCanonicalSource({ rawSource: s(row.source), unifiedSourceOrigin: s(obj(row.unified_source).origin) });
  return assemble(resolved === 'other' ? 'website' : resolved, row, { table: 'leads' });
};

/** Blog reader/conversion context. */
export const blogAdapter: SourceAdapter = (row) => assemble('blog', row, { table: 'blog_analytics' });

/** Generic social (organic post/profile) — non-engagement. */
export const socialAdapter: SourceAdapter = (row) => assemble('social', row, { table: 'lead_signals' });

/** `lead_signals` with source_type='engagement' (DM/comment/reply/mention). */
export const engagementAdapter: SourceAdapter = (row) =>
  assemble('engagement', row, { table: 'lead_signals', attributionExtra: { channel: 'engagement' } });

/** `opportunity_feed_items` / `active_leads` (community listening). */
export const communityAdapter: SourceAdapter = (row) =>
  assemble('community', row, {
    table: 'opportunity_feed_items',
    attributionExtra: { opportunity_type: s(row.opportunity_type), detected_reason: s(row.detected_reason) },
    status: s(row.status),
  });

/** `marketpulse_signals` (company-level intent — isolated today; bridged here). */
export const marketPulseAdapter: SourceAdapter = (row) =>
  assemble('marketpulse', row, {
    table: 'marketpulse_signals',
    attributionExtra: { signal_category: s(row.signal_category), opportunity_risk_class: s(row.opportunity_risk_class) },
    occurredAt: row.created_at ?? row.detected_at,
    display: { title: s(row.title), contentText: s(row.summary) },
  });

/** `canonical_leads` / CRM record (uses unified_source when present). */
export const crmAdapter: SourceAdapter = (row) => {
  const us = obj(row.unified_source);
  const resolved = resolveCanonicalSource({
    rawSource: s(row.source),
    unifiedSourceCategory: s(us.category),
    unifiedSourceOrigin: s(us.origin),
  });
  return assemble(resolved === 'website' || resolved === 'other' ? 'crm' : resolved, row, { table: 'canonical_leads' });
};

/* ── Generic adapters (a lead row carrying a known source) ───────────────── */

const generic = (source: CanonicalLeadSource, table: string): SourceAdapter =>
  (row) => assemble(source, row, { table });

export const importAdapter: SourceAdapter = generic('import', 'canonical_leads');
export const manualAdapter: SourceAdapter = generic('manual', 'leads');
export const referralAdapter: SourceAdapter = generic('referral', 'leads');
export const partnerAdapter: SourceAdapter = generic('partner', 'leads');
export const apiAdapter: SourceAdapter = generic('api', 'leads');
export const webhookAdapter: SourceAdapter = generic('webhook', 'leads');

/* ── Registry + router ───────────────────────────────────────────────────── */

export const SOURCE_ADAPTERS: Record<CanonicalLeadSource, SourceAdapter> = {
  website: websiteAdapter,
  blog: blogAdapter,
  social: socialAdapter,
  engagement: engagementAdapter,
  community: communityAdapter,
  marketpulse: marketPulseAdapter,
  crm: crmAdapter,
  import: importAdapter,
  manual: manualAdapter,
  referral: referralAdapter,
  partner: partnerAdapter,
  api: apiAdapter,
  webhook: webhookAdapter,
  other: generic('other', 'leads'),
};

/** Route a raw source row through its adapter to the canonical input. */
export function routeToCanonicalInput(source: CanonicalLeadSource, row: Row): CanonicalLeadInput {
  const adapter = SOURCE_ADAPTERS[source] ?? SOURCE_ADAPTERS.other;
  return adapter(row);
}
