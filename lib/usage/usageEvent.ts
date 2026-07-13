/**
 * usageEvent.ts — the ONE canonical customer usage event model (CSA-001 §1).
 *
 * This is the single, reusable shape every product-usage signal takes. Every
 * future Customer Success capability (Health, Lifecycle, Retention, Risk,
 * Engagement, Adoption) MUST consume events in this shape via the usage
 * authority — there is no second usage model.
 *
 * Scope boundary: this is CUSTOMER PRODUCT USAGE (in-app actions), distinct from
 * (a) website-visitor analytics (`blog_analytics` via /api/track) and (b) billing
 * usage (`usage_events` ledger linkage). Those remain untouched.
 *
 * Privacy (§5): an event carries only EXISTING identifiers — companyId + userId
 * (already the platform's tenant/user keys). No email, name, IP, or free-text
 * PII belongs in a usage event; `metadata` is a small bounded bag of
 * non-identifying context (ids, counts, enums).
 */

/** The canonical, closed set of usage event types (§1). Extend here only. */
export const USAGE_EVENT_TYPES = [
  'login',
  'page_view',
  'feature_used',
  'campaign_created',
  'campaign_completed',
  'content_generated',
  'content_published',
  'recommendation_viewed',
  'recommendation_applied',
  'integration_connected',
  'integration_used',
  'report_generated',
  'workspace_member_added',
  'credit_consumed',
] as const;

export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];

const USAGE_EVENT_TYPE_SET = new Set<string>(USAGE_EVENT_TYPES);

export function isUsageEventType(v: unknown): v is UsageEventType {
  return typeof v === 'string' && USAGE_EVENT_TYPE_SET.has(v);
}

/**
 * The canonical usage event. `eventId` is the idempotency key (client- or
 * producer-supplied); when absent the ingestion authority derives a
 * deterministic one so retries/replays never double-count (§6).
 */
export interface UsageEvent {
  /** Idempotency key. Optional on input; always present after ingestion. */
  eventId?: string;
  /** Tenant (company) key — an existing identifier. Required. */
  companyId: string;
  /** Actor (user) key — an existing identifier. Optional (system events). */
  userId?: string | null;
  /** One of the canonical event types. */
  eventType: UsageEventType;
  /** Optional finer-grained feature slug (e.g. 'content_writer'). */
  feature?: string | null;
  /** Optional capability grouping (e.g. 'publishing', 'analytics'). */
  capability?: string | null;
  /** When the action happened (ISO). Defaults to ingestion time. */
  occurredAt?: string;
  /** Bounded, non-PII context (ids/counts/enums only). */
  metadata?: Record<string, unknown> | null;
}

/** A validated, storage-ready usage event (all defaults resolved). */
export interface NormalizedUsageEvent {
  eventId: string;
  companyId: string;
  userId: string | null;
  eventType: UsageEventType;
  feature: string | null;
  capability: string | null;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
}

const MAX_STR = 128;
const clip = (v: unknown, n = MAX_STR): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, n) : null;
};

/**
 * Deterministic idempotency key for an event that arrived without one. Same
 * logical event (company + user + type + feature + timestamp) → same key, so a
 * retry of the identical event is de-duplicated rather than double-counted.
 * Pure and stable (no randomness/time).
 */
export function deriveEventId(e: {
  companyId: string; userId: string | null; eventType: string;
  feature: string | null; occurredAt: string;
}): string {
  const basis = [e.companyId, e.userId ?? '', e.eventType, e.feature ?? '', e.occurredAt].join('|');
  // FNV-1a 32-bit → stable hex; deterministic, dependency-free.
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return `ue_${hex}_${e.eventType}`;
}

export interface NormalizeResult {
  ok: boolean;
  event?: NormalizedUsageEvent;
  reason?: string;
}

/**
 * Validate + normalize one raw event into storage-ready form. Pure and
 * deterministic given `now`. Rejects unknown types and missing company; strips
 * everything not in the canonical shape (privacy §5). `metadata` is shallow and
 * size-bounded; any obviously-PII reserved keys are dropped defensively.
 */
const PII_KEYS = new Set(['email', 'name', 'phone', 'ip', 'ip_address', 'address', 'password']);

export function normalizeUsageEvent(raw: UsageEvent, now: string): NormalizeResult {
  const companyId = clip(raw.companyId, 64);
  if (!companyId) return { ok: false, reason: 'missing_company' };
  if (!isUsageEventType(raw.eventType)) return { ok: false, reason: 'invalid_event_type' };

  const userId = clip(raw.userId ?? null, 64);
  const feature = clip(raw.feature ?? null);
  const capability = clip(raw.capability ?? null);
  const occurredAt = clip(raw.occurredAt ?? null, 40) ?? now;

  let metadata: Record<string, unknown> | null = null;
  if (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(raw.metadata)) {
      if (count >= 24) break;
      if (PII_KEYS.has(k.toLowerCase())) continue; // never store PII (§5)
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
        out[k.slice(0, 48)] = typeof v === 'string' ? v.slice(0, 256) : v;
        count++;
      }
    }
    metadata = count > 0 ? out : null;
  }

  const eventId =
    clip(raw.eventId, 96) ??
    deriveEventId({ companyId, userId, eventType: raw.eventType, feature, occurredAt });

  return {
    ok: true,
    event: { eventId, companyId, userId, eventType: raw.eventType, feature, capability, occurredAt, metadata },
  };
}
