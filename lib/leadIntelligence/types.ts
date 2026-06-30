/**
 * Canonical Lead Intelligence — domain types (Phase 2 foundation).
 *
 * ONE canonical Lead entity that every source ultimately becomes. Sources are
 * adapters only — there are no source-specific lead models below this layer.
 * This module is PURE (no DB, no server imports) so both the Next app and the
 * worker can consume it. Persistence + identity are injected as hexagonal ports
 * so the domain stays testable and reuses existing infrastructure.
 */

/** The canonical lead-source taxonomy — every incoming lead resolves to exactly one. */
export type CanonicalLeadSource =
  | 'website'
  | 'blog'
  | 'social'
  | 'engagement'
  | 'community'
  | 'marketpulse'
  | 'crm'
  | 'import'
  | 'manual'
  | 'referral'
  | 'partner'
  | 'api'
  | 'webhook'
  | 'other';

/** Identity hints carried from any source — resolved to a unified person via the port. */
export interface CanonicalIdentityHints {
  email?: string | null;
  phone?: string | null;
  unifiedPersonId?: string | null;
  anonymousId?: string | null;
  contactId?: string | null;
  platform?: string | null;
  platformUserId?: string | null;
  externalKeys?: Record<string, unknown>;
}

/** Unified attribution contract — NOTHING is discarded (`sourceMetadata` is the catch-all). */
export interface CanonicalAttribution {
  originalSource: string | null;
  originalChannel: string | null;
  campaign: string | null;
  content: string | null;
  session: string | null;
  journey: unknown | null;
  referrer: string | null;
  utm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    content: string | null;
    term: string | null;
  };
  identity: CanonicalIdentityHints;
  /** Every raw field not mapped above — preserved verbatim, never dropped. */
  sourceMetadata: Record<string, unknown>;
}

export interface CanonicalLeadScores {
  intent?: number | null;
  urgency?: number | null;
  icp?: number | null;
  confidence?: number | null;
  total?: number | null;
}

/** Pointer to the originating legacy row — the bridge (no data is copied/migrated). */
export interface SourceRef {
  table: string;
  id: string | null;
}

export interface CanonicalLeadInput {
  organizationId: string;
  source: CanonicalLeadSource;
  identity: CanonicalIdentityHints;
  attribution: CanonicalAttribution;
  scores?: CanonicalLeadScores;
  status?: string | null;
  occurredAt?: string | null;
  display?: { name?: string | null; title?: string | null; contentText?: string | null };
  sourceRef?: SourceRef;
}

export interface CanonicalLead extends CanonicalLeadInput {
  unifiedPersonId: string | null;
  identityMatchedBy?: string;
  ingestedAt: string;
}

/** The ONE read model every consumer (dashboard, analytics, active-leads, CRM, exports, future modules) reads. */
export interface CanonicalLeadView {
  organizationId: string;
  source: CanonicalLeadSource;
  sourceLabel: string;
  unifiedPersonId: string | null;
  identity: CanonicalIdentityHints;
  scores: CanonicalLeadScores;
  status: string | null;
  campaign: string | null;
  content: string | null;
  referrer: string | null;
  utm: CanonicalAttribution['utm'];
  occurredAt: string | null;
  sourceRef: SourceRef | null;
  attribution: CanonicalAttribution;
}

/* ── Hexagonal ports (reuse existing infrastructure; never duplicated here) ── */

export interface IdentityResolverPort {
  resolve(input: {
    organizationId: string;
    email?: string | null;
    phone?: string | null;
    externalKeys?: Record<string, unknown> | null;
  }): Promise<{ unifiedPersonId: string | null; matchedBy?: string }>;
}

export interface LeadIntelligenceSink {
  emit(lead: CanonicalLead): Promise<void>;
}

export interface IngestionPorts {
  identity: IdentityResolverPort;
  sink: LeadIntelligenceSink;
  /** Injectable clock for deterministic tests; defaults to wall-clock. */
  now?: () => string;
}
