/**
 * Canonical Lead Intelligence — domain types (Phase 2 foundation).
 *
 * ONE canonical Lead entity that every source ultimately becomes. Sources are
 * adapters only — there are no source-specific lead models below this layer.
 * This module is PURE (no DB, no server imports) so both the Next app and the
 * worker can consume it. Persistence + identity are injected as hexagonal ports
 * so the domain stays testable and reuses existing infrastructure.
 */

import type { ContributionRole, ProvenanceContribution, ScoreScale, SourceCategory } from '../prospectProvenance/contract';

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

/**
 * A raw source score as it was read, with its declared scale. Kept so a converted
 * value can always be traced back; scales are never compared implicitly.
 */
export interface SourceScore {
  /** Source column, e.g. `qualification_score`, `opportunity_score`. */
  field: string;
  value: number;
  scale: ScoreScale;
  /** `toUnitScore(value, scale)`; null when the value is out of range for its scale. */
  unit: number | null;
}

/**
 * Canonical scores. Every numeric field is on the UNIT scale (0..1); adapters
 * convert explicitly with `toUnitScore` at the boundary. `scale` is set by the
 * adapters; views produced before the provenance contract (durable rows, test
 * fixtures) omit it and are unit by the same convention.
 */
export interface CanonicalLeadScores {
  intent?: number | null;
  urgency?: number | null;
  icp?: number | null;
  confidence?: number | null;
  total?: number | null;
  scale?: 'unit';
  /** The source columns these values were derived from, with their declared scales. */
  sourceScores?: SourceScore[];
}

/**
 * Pointer to the originating legacy row — the bridge (no data is copied/migrated).
 *
 * `table` is a PERSISTED identity: it feeds `dedupeViews`, `leadKeyFor` (profile
 * deep links) and `audience_memberships.entity_id`. It is a LABEL and is never
 * renamed (community rows are labelled `opportunity_feed_items`). `readFrom` is
 * the table the row was physically read from when the reader knows it; it is
 * informational only and never part of any key.
 */
export interface SourceRef {
  table: string;
  id: string | null;
  readFrom?: string;
}

/**
 * One piece of evidence behind a canonical prospect, flattened from its
 * provenance contributions (typed signal references, source records, URLs).
 */
export interface LeadEvidenceRef {
  contributionId: string;
  role: ContributionRole;
  sourceCategory: SourceCategory;
  platform: string | null;
  observedAt: string;
  kind: 'source_url' | 'source_record' | 'lead_signal' | 'opportunity_feed_item' | 'engagement_message' | 'contact';
  /** The id or URL the evidence lives at. */
  ref: string;
}

/**
 * Per-view provenance status:
 *   loaded         — contributions were read for this canonical prospect (may be empty
 *                    for a prospect created before provenance existed);
 *   unavailable    — the provenance store could not be read (e.g. table not yet
 *                    applied); `sources`/`evidence` are empty, NOT proven absent;
 *   not_applicable — the view is not a canonical prospect (website form lead,
 *                    durable community/marketpulse lead, …).
 */
export type LeadProvenanceStatus = 'loaded' | 'unavailable' | 'not_applicable';

/** Display-level origin of a view: the discovery classification when it is known. */
export interface LeadOrigin {
  category: SourceCategory | null;
  platform: string | null;
  observedAt: string | null;
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
  /** Row-level origin hint (e.g. a canonical prospect whose raw source is a discovery provider). */
  origin?: LeadOrigin;
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
  /**
   * Provenance (read side). Optional in the type so pre-contract constructors keep
   * compiling; the read service ALWAYS sets all four on every row it returns.
   * `source` / `sourceLabel` stay the display vocabulary; these carry the truth.
   */
  /** Complete contribution history (originating first, then contributing by observedAt). */
  sources?: ProvenanceContribution[];
  /** Evidence references flattened from `sources`. */
  evidence?: LeadEvidenceRef[];
  provenanceStatus?: LeadProvenanceStatus;
  /** Discovery origin: from the originating contribution when loaded, else a row-level hint. */
  origin?: LeadOrigin | null;
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
