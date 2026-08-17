/**
 * LI-4D — the provider-neutral lead ingestion contract.
 *
 * The LI-4A audit found that the platform had a genuinely provider-neutral
 * provenance boundary (LI-2), a deterministic identity resolver (W1), an account
 * resolver (W4) and — after LI-4C — duplicate parking, but nothing that turned a
 * provider's native record into the shape those layers expect. Every future
 * source (Apollo, LinkedIn, RapidAPI, CRM, CSV, manual entry) needs the same
 * translation step, and if each one wires itself directly into identity or the
 * database, the chain the programme spent five phases building gets bypassed.
 *
 * This file is that missing contract, and nothing more. It contains no provider
 * name, no network call, no database access and no decision.
 *
 * ─── THE SEPARATION THAT MATTERS ──────────────────────────────────────────
 * An ADAPTER translates. An ORCHESTRATOR persists. They are different jobs and
 * live in different files:
 *
 *   adapter   : provider's native record -> NormalizedIngestionRecord.  Pure.
 *   orchestra : NormalizedIngestionRecord -> provenance, identity, dedupe.
 *
 * An adapter may NOT create a `unified_persons` row, write a lead, call LI-2
 * directly, evaluate governance or decide readiness. It is handed data and
 * returns data. That restriction is what makes "no source may bypass the chain"
 * an architectural property rather than a convention.
 *
 * ─── RAW IS NOT NORMALIZED ────────────────────────────────────────────────
 * `AdapterResult` carries both. The raw record is what the provider actually
 * said and is persisted by LI-2 (which redacts credentials and hashes it for
 * change detection). The normalized record is what this platform understands.
 * Collapsing them would make a normalisation bug unauditable — the LI-2
 * precedent, and the reason `target_raw` exists in LI-3.
 */

import type { EmployeeBand, Seniority } from '../prospectIdentity/attributes';

export const INGESTION_CONTRACT_VERSION = 'li4d.1';

/** What kind of thing a record describes. Mirrors LI-2's `SourceEntityType`. */
export type IngestionEntityType = 'person' | 'account';

/**
 * What a source can actually do. Declared per adapter and validated against the
 * methods it implements, so a capability can never be claimed without code
 * behind it (§16).
 */
export const SOURCE_CAPABILITIES = [
  'person_discovery',
  'account_discovery',
  'single_record_fetch',
  'bulk_fetch',
  'search',
  'enrichment',
] as const;
export type SourceCapability = typeof SOURCE_CAPABILITIES[number];

/**
 * The person half of a normalized record.
 *
 * Deliberately narrow: every field here maps onto something LI-1 already models
 * on `unified_persons`. Fields are NOT added because a provider might supply
 * them — an attribute with nowhere canonical to go is evidence the platform
 * cannot act on.
 */
export interface NormalizedPerson {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  seniority?: Seniority | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  timezone?: string | null;
  /**
   * Provider identifiers for THIS person, shaped like `unified_persons.external_keys`
   * — `{ apollo: { external_id: '...' } }`. A hard identity signal.
   */
  externalKeys?: Record<string, unknown> | null;
}

/**
 * The employer half.
 *
 * THIS IS THE PROSPECT'S EMPLOYER, NOT THE TENANT. `companies` is the tenant and
 * is never described here; the employer is `prospect_accounts`, reached from
 * `unified_persons.account_id`. Conflating the two is the single most damaging
 * error available in this model, so the naming here never says "company" alone.
 */
export interface NormalizedAccount {
  /** The provider's own immutable id for the employer. Strongest evidence. */
  externalId?: string | null;
  name?: string | null;
  legalName?: string | null;
  /** Bare host, URL, or an email to take the domain from — W4 normalises it. */
  domain?: string | null;
  websiteUrl?: string | null;
  industry?: string | null;
  employeeCount?: number | string | null;
  employeeBand?: EmployeeBand | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  description?: string | null;

  // ── P2A firmographics ─────────────────────────────────────────────────────
  // The six attributes `prospect_accounts` gained in P2A. Industry, headcount,
  // band and geography are NOT repeated here — they already exist above, added
  // by LI-1, and a second declaration would be a competing definition.
  //
  // All optional, and they stay optional: no provider supplies every attribute,
  // and a required field would force an adapter to invent one.

  /** Annual revenue as a NUMBER, in the provider's stated currency. */
  annualRevenue?: number | string | null;
  /**
   * The provider's own revenue bucket, verbatim.
   *
   * Free text on purpose: there is no canonical revenue vocabulary in this
   * repository, and inventing one here would force every provider to translate
   * into terms none of them use. The bucket a provider states is evidence;
   * mapping it to a platform vocabulary is a later, explicit decision.
   */
  revenueBand?: string | null;
  foundedYear?: number | string | null;
  /** Technology names as a LIST. The column rejects any other jsonb shape. */
  technologies?: string[] | null;
  /** The provider's own funding-stage label, verbatim — see `revenueBand`. */
  fundingStage?: string | null;
  /** When the most recent funding event occurred, if the source says so. */
  lastFundingAt?: string | null;
}

/**
 * One record, translated. This is the ONLY shape the orchestrator accepts, from
 * every source, forever.
 */
export interface NormalizedIngestionRecord {
  /** TENANT. Enters at the boundary and is never re-derived downstream. */
  organizationId: string;
  /** Free-text provider key — `source_records.provider` is free text on purpose. */
  source: string;
  entityType: IngestionEntityType;
  /**
   * The provider's OWN identifier for this record. Never an email, phone or
   * domain: those are identity, resolved elsewhere. For a file source this is a
   * deterministic row identity, not a row number.
   */
  externalId: string;
  person?: NormalizedPerson | null;
  /** The prospect's employer, when the source says anything about it. */
  account?: NormalizedAccount | null;
  /** When the SOURCE observed this, if it says so. Not when we ingested it. */
  observedAt?: string | null;
  /** Provider-stated confidence for this record's claims, 0..1. */
  confidence?: number | null;
}

/** What an adapter returns per record: what the provider said, and what we understood. */
export interface AdapterResult {
  /** Verbatim provider record. LI-2 redacts and hashes it; do not pre-strip. */
  raw: Record<string, unknown>;
  normalized: NormalizedIngestionRecord;
}

/**
 * A source adapter.
 *
 * PURE BY CONTRACT: `translate` receives a provider record and returns data. It
 * performs no I/O of its own — fetching from a provider is a separate concern
 * that must pass through the existing cost governor and SSRF seam, and is not
 * part of this contract.
 */
export interface LeadSourceAdapter {
  /** Stable provider key, e.g. 'apollo'. Becomes `source_records.provider`. */
  readonly source: string;
  /** Human-facing label for a future source-selection UI. */
  readonly label: string;
  /** Only capabilities this adapter actually implements (§16). */
  readonly capabilities: readonly SourceCapability[];
  /**
   * Translate ONE provider record. Throwing is a normalization failure and is
   * reported per record; it must never abort a batch.
   */
  translate(raw: Record<string, unknown>, organizationId: string): AdapterResult;
}

/** Why a record was rejected before anything was persisted. */
export type IngestionRejection =
  | 'unsupported_source'
  | 'validation_failed'
  | 'normalization_failed'
  | 'provenance_failed'
  | 'identity_failed'
  | 'duplicate_detection_failed'
  | 'account_resolution_failed';

/** The outcome of ONE record. A batch is a list of these — never a single verdict. */
export interface IngestionRecordOutcome {
  externalId: string | null;
  ok: boolean;
  /** Present only when `ok`. */
  sourceRecordId?: string;
  personId?: string | null;
  accountId?: string | null;
  /** LI-2's verdict: whether the evidence was new, unchanged, or changed. */
  provenanceOutcome?: 'created' | 'unchanged' | 'changed';
  /** Canonical attributes LI-2 applied and withheld — a withheld one is a finding. */
  canonicalApplied?: string[];
  canonicalWithheld?: Array<{ attribute: string; reason: string }>;
  /** Duplicate candidates surfaced for tenant review. Never auto-merged. */
  duplicatesParked?: number;
  duplicatesAlreadyOpen?: number;
  /** Present only when `!ok`. */
  rejection?: IngestionRejection;
  error?: string;
}

export interface IngestionBatchResult {
  organizationId: string;
  source: string;
  total: number;
  succeeded: number;
  failed: number;
  outcomes: IngestionRecordOutcome[];
}

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Validate a normalized record before anything is persisted.
 *
 * Returns a reason rather than throwing, because a bad record in a batch must
 * fail that record and no other.
 */
export function validateNormalizedRecord(record: NormalizedIngestionRecord): string | null {
  if (!record || typeof record !== 'object') return 'record is not an object';
  if (!isNonEmpty(record.organizationId)) return 'organizationId is required — ingestion is never tenant-less';
  if (!isNonEmpty(record.source)) return 'source is required';
  if (!isNonEmpty(record.externalId)) return 'externalId is required — a record with no source identity cannot be idempotent';
  if (record.entityType !== 'person' && record.entityType !== 'account') {
    return `entityType must be 'person' or 'account', got '${String(record.entityType)}'`;
  }
  if (record.entityType === 'person') {
    const p = record.person;
    // A person with no identifier at all can never be resolved or matched, so it
    // is not ingestible evidence — it is noise.
    const hasAnchor = !!p && (isNonEmpty(p.email ?? '') || isNonEmpty(p.phone ?? '')
      || (!!p.externalKeys && Object.keys(p.externalKeys).length > 0));
    if (!hasAnchor) return 'a person record needs an email, a phone or a provider identifier';
  }
  if (record.entityType === 'account') {
    const a = record.account;
    const hasAnchor = !!a && (isNonEmpty(a.externalId ?? '') || isNonEmpty(a.domain ?? '') || isNonEmpty(a.websiteUrl ?? ''));
    if (!hasAnchor) return 'an account record needs a provider identifier, a domain or a website';
  }
  if (record.confidence != null) {
    const c = Number(record.confidence);
    if (!Number.isFinite(c) || c < 0 || c > 1) return 'confidence must be between 0 and 1';
  }
  if (record.observedAt != null && Number.isNaN(Date.parse(String(record.observedAt)))) {
    return 'observedAt is not a parseable timestamp';
  }
  return null;
}
