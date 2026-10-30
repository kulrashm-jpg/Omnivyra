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
  SourceScore,
} from './types';
import { buildAttributionContract } from './attribution';
import { resolveCanonicalSource, PI_DISCOVERY_PROVIDERS } from './sourceTaxonomy';
import { toUnitScore, type ScoreScale } from '../prospectProvenance/contract';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : v == null ? null : String(v));
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

/**
 * Declared scale of every source score column the adapters read. Conversion is
 * explicit (`toUnitScore`); scales are never compared implicitly.
 *   qualification_score — canonical_leads, CHECK 0..100           ⇒ percent
 *   opportunity_score   — opportunity_feed_items, CHECK 0..1      ⇒ unit
 *   the rest            — 0..1 by the existing read-model convention ⇒ unit
 */
export const SOURCE_SCORE_SCALES: Readonly<Record<string, ScoreScale>> = Object.fromEntries([
  ['intent_score', 'unit'],
  ['urgency_score', 'unit'],
  ['icp_score', 'unit'],
  ['confidence_score', 'unit'],
  ['total_score', 'unit'],
  ['opportunity_score', 'unit'],
  ['qualification_score', 'percent'],
  ['lead_score', 'unit'],
] as Array<[string, ScoreScale]>);

/** Precedence for `scores.total` (first present wins). */
const TOTAL_FIELDS = ['total_score', 'qualification_score', 'opportunity_score', 'lead_score'] as const;

function readScore(row: Row, field: string, sourceScores: SourceScore[]): number | null {
  const raw = row[field];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return null;
  const scale = SOURCE_SCORE_SCALES[field] ?? 'unit';
  let unit: number | null;
  try { unit = toUnitScore(value, scale); } catch { unit = null; } // out of range for its scale → no score, kept in sourceScores
  sourceScores.push({ field, value, scale, unit });
  return unit;
}

function scoresFrom(row: Row): CanonicalLeadScores {
  const sourceScores: SourceScore[] = [];
  const intent = readScore(row, 'intent_score', sourceScores);
  const urgency = readScore(row, 'urgency_score', sourceScores);
  const icp = readScore(row, 'icp_score', sourceScores);
  const confidence = readScore(row, 'confidence_score', sourceScores);
  let total: number | null = null;
  for (const f of TOTAL_FIELDS) {
    const v = readScore(row, f, sourceScores);
    if (total === null && v !== null) total = v;
  }
  const out: CanonicalLeadScores = { intent, urgency, icp, confidence, total, scale: 'unit' };
  if (sourceScores.length) out.sourceScores = sourceScores;
  return out;
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
    origin?: CanonicalLeadInput['origin'];
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
    ...(opts.origin ? { origin: opts.origin } : {}),
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

/**
 * `opportunity_feed_items` (community listening). `sourceRef.table` is a
 * persisted label (lead keys, audience memberships) — never renamed.
 * `opportunity_score` (0..1) is the feed's qualification score → `scores.total`.
 */
export const communityAdapter: SourceAdapter = (row) =>
  assemble('community', row, {
    table: 'opportunity_feed_items',
    // The feed stores the author's platform id inside author_metadata, not at the
    // top level; without it a community lead never resolves to a person.
    identity: { platformUserId: s(obj(row.author_metadata).platform_user_id) },
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
  const raw = (s(row.source) ?? '').toLowerCase();
  // A prospect created by a PI discovery provider (Apollo) is not a CRM lead. Its
  // display SOURCE stays the persisted value (keys/memberships depend on it); the
  // origin hint makes it DISPLAY as prospect discovery (sourceTaxonomy.displayLabelFor).
  const origin = PI_DISCOVERY_PROVIDERS.has(raw)
    ? { category: 'pi_discovery' as const, platform: raw, observedAt: s(row.created_at) }
    : undefined;
  return assemble(resolved === 'website' || resolved === 'other' ? 'crm' : resolved, row, { table: 'canonical_leads', origin });
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
