/**
 * Canonical prospect PROVENANCE contract — the single source of truth shared by
 * the schema (`prospect_source_contributions`, `source_records.source_category`),
 * every ingestion path, and the unified reader.
 *
 * Owner-approved rules (2026-10-30):
 *   - Every canonical prospect keeps its ORIGINATING source and every later
 *     CONTRIBUTING source. Contributions are append-only; new evidence never
 *     overwrites old evidence.
 *   - Exactly one `originating` contribution per canonical lead (database-enforced).
 *   - External identifiers are namespaced by provider (`community:<feed-id>`).
 *   - CRM resync and enrichment never replace the original source or discovery time.
 *
 * `source_category` is NOT the display source. `CanonicalLeadSource`
 * (lib/leadIntelligence/types.ts) is the display/persisted vocabulary baked into
 * `lead_intelligence.source`, dedupe keys and audience memberships; renaming it
 * would orphan data. `source_category` is set EXPLICITLY by each ingestion path
 * and is never inferred from the display source, so no category is silently
 * remapped (e.g. social listening is not folded into community).
 *
 * Pure: no I/O. `lib/` never imports `backend/`; the database writer lives in
 * backend/services/prospectProvenance/contributionWriter.ts.
 */

/** Discovery / source classification. Mirrors the CHECK constraint in the migration. */
export const SOURCE_CATEGORIES = [
  'marketpulse',
  'social_listening',
  'community',
  'engagement',
  'inbound_form',
  'inbound_webhook',
  'manual',
  'crm',
  'csv',
  'pi_discovery',
  'pi_enrichment',
  'website', // historical compatibility
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export function isSourceCategory(value: unknown): value is SourceCategory {
  return typeof value === 'string' && (SOURCE_CATEGORIES as readonly string[]).includes(value);
}

/** Exactly two roles. */
export const CONTRIBUTION_ROLES = ['originating', 'contributing'] as const;
export type ContributionRole = (typeof CONTRIBUTION_ROLES)[number];

/** Database object names the writer and tests depend on. Changing one is a contract change. */
export const PROVENANCE_DB = {
  table: 'prospect_source_contributions',
  /** UNIQUE (organization_id, canonical_lead_id, external_ref) — idempotency of a source event per lead. */
  idempotencyConstraint: 'uq_psc_org_lead_external_ref',
  /** UNIQUE (canonical_lead_id) WHERE contribution_role = 'originating'. */
  oneOriginatingIndex: 'uq_psc_one_originating_per_lead',
} as const;

/**
 * Provider prefix for a namespaced external reference: lowercase identifier.
 * Examples: community, apollo, marketpulse, crm_hubspot, csv, manual, form, webhook.
 */
const PROVIDER_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * `<provider>:<id>`. The id is kept verbatim (trimmed); only the provider is
 * validated. Throws on an invalid provider or empty id — a missing namespace is a
 * contract violation, not a value to guess.
 */
export function namespacedExternalRef(provider: string, id: string | number): string {
  const p = String(provider ?? '').trim();
  const v = String(id ?? '').trim();
  if (!PROVIDER_PATTERN.test(p)) throw new Error(`namespacedExternalRef: invalid provider '${p}'`);
  if (!v) throw new Error('namespacedExternalRef: empty id');
  return `${p}:${v}`;
}

/** Parse `<provider>:<id>`; null when the value is not namespaced (legacy raw keys). */
export function parseExternalRef(ref: string | null | undefined): { provider: string; id: string } | null {
  if (!ref) return null;
  const i = ref.indexOf(':');
  if (i <= 0) return null;
  const provider = ref.slice(0, i);
  const id = ref.slice(i + 1);
  return PROVIDER_PATTERN.test(provider) && id ? { provider, id } : null;
}

/**
 * Score scales are never compared implicitly. Every score carries its scale;
 * conversion to the unit interval is explicit and documented here.
 *   unit        — 0..1   (prospect_score_evaluations, lead_intelligence scores)
 *   percent     — 0..100 (canonical_leads.qualification_score, legacy active_leads.*_score)
 */
export type ScoreScale = 'unit' | 'percent';

/** Explicit conversion to 0..1. Returns null for null/non-finite input; clamps nothing — out-of-range throws. */
export function toUnitScore(value: number | string | null | undefined, scale: ScoreScale): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const unit = scale === 'percent' ? n / 100 : n;
  if (unit < 0 || unit > 1) throw new Error(`toUnitScore: ${n} is out of range for scale '${scale}'`);
  return unit;
}

/** Typed references to the signal/evidence row that produced a contribution (each tenant-FK'd). */
export interface SignalRefs {
  leadSignalId?: string | null;
  opportunityFeedItemId?: string | null;
  engagementMessageId?: string | null;
  contactId?: string | null;
}

/** What an ingestion path hands the writer. */
export interface SourceContributionInput extends SignalRefs {
  organizationId: string;
  canonicalLeadId: string;
  /**
   * True only when THIS ingestion created the canonical lead. Decides the role:
   * created ⇒ originating, otherwise contributing. Never "first contribution
   * wins": a pre-existing lead without an originating row is not re-originated.
   */
  leadCreated: boolean;
  sourceCategory: SourceCategory;
  /** Namespaced (`<provider>:<id>`); the idempotency key per lead. */
  externalRef: string;
  sourceRecordId?: string | null;
  platform?: string | null;
  sourceUrl?: string | null;
  observedAt: string; // ISO-8601; when the SOURCE observed it (posted_at, detected_at, …)
  ingestionRunId?: string | null;
  /** Structured evidence references (ids, hashes, excerpts already redaction-safe). JSON object. */
  evidence?: Record<string, unknown>;
  /** Source metadata worth keeping that has no typed column. JSON object. */
  sourceMetadata?: Record<string, unknown>;
}

export type SourceContributionResult =
  | { status: 'inserted'; id: string; role: ContributionRole; roleDowngraded: boolean }
  | { status: 'duplicate'; role: null }
  | { status: 'error'; code: string | null; message: string };

/** A contribution as the unified reader exposes it. */
export interface ProvenanceContribution {
  id: string;
  role: ContributionRole;
  sourceCategory: SourceCategory;
  externalRef: string;
  platform: string | null;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  observedAt: string;
  signalRefs: SignalRefs;
  evidence: Record<string, unknown>;
}
