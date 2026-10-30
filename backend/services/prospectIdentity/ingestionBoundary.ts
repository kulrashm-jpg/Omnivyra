/**
 * LI-2 — the canonical ingestion boundary.
 *
 * THIS IS THE ONLY PLACE CANONICAL ATTRIBUTES MAY BE WRITTEN FROM SOURCE DATA.
 *
 * Provider adapters (LI-7) produce provider-neutral records and hand them here.
 * They must never issue `UPDATE unified_persons ...` or
 * `UPDATE prospect_accounts ...` themselves — a test asserts that no file
 * outside this module writes an LI-1 attribute column.
 *
 * The order is deliberate and each step is refusable:
 *
 *   1. validate tenant ownership      - a record without a tenant is rejected
 *   2. resolve identity               - delegated, unchanged (see below)
 *   3. retain source evidence         - source_records + source_assertions
 *   4. normalize values               - reuses LI-1 / W1 normalisers only
 *   5. decide whether canonical may be updated  - deterministic, see RULES
 *   6. update canonical attributes    - only what the rule permits
 *   7. record provenance              - applied_to_canonical_at + applied_reason
 *
 * IDENTITY IS NOT RESOLVED HERE. `identityResolutionService.resolveUnifiedPerson`
 * remains the sole resolve-or-create path and is untouched by LI-2; this module
 * accepts an already-resolved personId/accountId, or none at all. A source
 * record with no canonical link is a legal, supported state — parking
 * unresolved evidence is what makes LI-4's review queue possible later.
 *
 * ─── THE CANONICAL SELECTION RULES (B1b — ratified by D22-B1a) ─────────────
 *
 * LI-2 shipped the WEAKEST rule that was still useful — fill an empty field,
 * abstain on disagreement, never overwrite — because anything stronger was a
 * product decision it was forbidden to make. That decision has now been made and
 * ratified (D22-B1A-SOURCE-ARBITRATION-OWNER-DECISION.md, D-1..D-5), so the rule
 * below is the ratified one and LI-2's is gone.
 *
 * THE CANONICAL VALUE IS A DERIVED PROJECTION OF THE LIVE ASSERTION SET, not a
 * value latched by whoever wrote first. Arbitration runs per
 * (tenant, entity, attribute) and resolves in a FIXED order:
 *
 *   1. COLLAPSE BY VALUE. Exactly one distinct live value across all sources
 *      -> apply.                         reason: 'single_uncontested_assertion'
 *
 *   2. DECLARED AUTHORITY (D-3). If the tenant declares an authoritative source
 *      for this (entity_type, attribute), the candidate set is RESTRICTED to it.
 *      One distinct value left -> apply.         reason: 'authoritative_source'
 *      An authoritative source disagreeing with ITSELF falls through to step 3
 *      WITHIN the restricted set: authority narrows the field, never widens it.
 *      An authoritative source that has said nothing is silent, not decisive —
 *      the full set continues to step 3.
 *      The declaration is DATA, resolved by ./attributeAuthority. No provider is
 *      named in this file, and a test fails the build if one ever is.
 *
 *   3. RECENCY (D-1), the PRIMARY rule.
 *      arbitration time = COALESCE(observed_at, recorded_at). Never an ingestion
 *      timestamp: a late-arriving stale record must not defeat a genuinely newer
 *      observation. One distinct value at the maximum -> apply.
 *                                                  reason: 'newest_observation'
 *
 *   4. CONFIDENCE (D-2), a TIE-BREAK ONLY, among the values tied at that
 *      maximum, and ONLY when every tied candidate states a confidence.
 *      A missing confidence is NEVER treated as low.
 *                                    reason: 'newest_then_highest_confidence'
 *      No cross-provider normalisation and no magnitude threshold exist, because
 *      `confidence` is recorded per RECORD rather than per attribute and is not
 *      comparable between providers (O-2, ratified).
 *
 *   5. OTHERWISE NO WINNER. Canonical is untouched, every assertion stays live,
 *      and the attribute is reported.             reason: 'sources_disagree'
 *
 * Then, against the current canonical value:
 *
 *   - NULL                     -> write.
 *   - equal to the winner      -> no write at all. Idempotent.
 *   - different, and NO assertion has EVER carried it
 *                              -> WITHHOLD.       reason: 'unattested_incumbent'
 *      A canonical value no evidence supports predates or came from outside this
 *      layer and cannot be re-derived if lost, so it is never overwritten.
 *      Attestation deliberately counts SUPERSEDED evidence, while candidacy does
 *      not: a value a source has withdrawn may no longer WIN, but it still shows
 *      the value passed through this layer, so a canonical value we wrote from
 *      evidence stays ours to re-decide even after that evidence is withdrawn.
 *      Without that distinction a source returning to an earlier value would
 *      freeze canonical on the value it had just abandoned.
 *   - different, and attested  -> WRITE. This is the re-arbitration D-4 ratified
 *      in place of LI-2's "never overwrite". The losing assertion stays LIVE and
 *      the superseded canonical decision is recorded, never erased.
 *
 * NOTHING IS EVER DISCARDED. Losing arbitration is not supersession: a value is
 * superseded only when the SAME source record later asserts a different value for
 * the same attribute (see `reconcileAssertionLiveness`). No age-based expiry
 * participates in arbitration at all (D-5, O-4).
 */

import { createHash } from 'node:crypto';
import { ownedDbTable, ownedDbRpc } from '../../db/writeOwner';
import {
  toPersonAttributes, toAccountAttributes,
  PERSON_ATTRIBUTE_COLUMNS, ACCOUNT_ATTRIBUTE_COLUMNS,
  type PersonAttributes, type AccountAttributes,
} from './attributes';
import {
  authoritativeProvidersFor, normalizeProviderKey, resolveAttributeAuthority,
  type AttributeAuthority,
} from './attributeAuthority';
import { isSourceCategory, type SourceCategory } from '../../../lib/prospectProvenance/contract';

export const INGESTION_BOUNDARY_VERSION = 'b1b.1';

export type SourceEntityType = 'person' | 'account';

/**
 * The provider-neutral ingestion contract. Every future adapter — Apollo,
 * LinkedIn, RapidAPI, CRM, Excel, RPA — produces this shape and nothing more.
 * Nothing in it names a provider, so adding one requires no change here and no
 * migration (`source_records.provider` is free text on purpose).
 */
export interface ProviderSourceRecord {
  /** TENANT. Never the prospect's employer. */
  organizationId: string;
  /** Free-form provider key, e.g. 'apollo', 'excel', 'hubspot'. */
  provider: string;
  entityType: SourceEntityType;
  /**
   * The provider's OWN identifier for this record. Never an email, phone or
   * domain — those are person/account identity and are resolved elsewhere.
   * For file imports this is a deterministic row identity, not a row number.
   */
  sourceRecordId: string;
  /** Verbatim provider payload. Must already be free of credentials/tokens. */
  rawPayload: Record<string, unknown>;
  /** Canonical links when identity has already been resolved. */
  personId?: string | null;
  accountId?: string | null;
  /** When the SOURCE observed this, if it says. */
  observedAt?: string | null;
  /** Operational correlation only; carries no foreign key. */
  ingestionRunId?: string | null;
  /** Attribute claims this record makes. Values are normalised here, not by the caller. */
  personAttributes?: PersonAttributes;
  accountAttributes?: AccountAttributes;
  /** Provider-stated confidence for this record's claims, 0..1. */
  confidence?: number | null;
  /**
   * Typed provenance (lib/prospectProvenance/contract.ts). Written on INSERT only —
   * a later observation never rewrites where the record originally came from — and
   * only when supplied, so callers that do not pass them never name the columns.
   */
  sourceCategory?: SourceCategory | null;
  platform?: string | null;
  sourceUrl?: string | null;
}

export type SourceRecordOutcome = 'created' | 'unchanged' | 'changed';

export interface IngestionResult {
  sourceRecordId: string;
  outcome: SourceRecordOutcome;
  assertionsRecorded: number;
  assertionsAlreadyPresent: number;
  /** Claims this record has WITHDRAWN by asserting a different value (S-1). */
  assertionsSuperseded: number;
  /** Previously superseded claims this record is asserting again (S-4). */
  assertionsRevived: number;
  canonicalApplied: string[];
  canonicalWithheld: Array<{ attribute: string; reason: string }>;
  /**
   * Attributes with more than one distinct live value, whether or not arbitration
   * resolved them. Additive: existing consumers read `canonicalWithheld`.
   */
  canonicalContested: string[];
}

/** Keys the platform must never persist inside a raw payload. */
const SECRET_KEY_PATTERN = /^(.*_)?(api[-_]?key|apikey|authorization|auth|token|secret|password|passwd|credential|credentials|bearer|cookie|session|private[-_]?key)(_.*)?$/i;

/**
 * Strip anything that looks like a credential before the payload is stored.
 * Providers routinely echo the request — including its auth header — back in a
 * response envelope, and a stored token is a durable breach rather than a leak.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? '[REDACTED]' : redactSecrets(v);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic hash over a canonicalised payload: object keys sorted at every
 * depth, so key order from a provider never registers as a change. Change
 * detection is a hash comparison and never a deep diff.
 */
export function computePayloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function computeValueHash(normalized: string | null, raw: string | null): string {
  return createHash('sha256').update(normalized ?? raw ?? '').digest('hex');
}

function requireTenant(organizationId: string): void {
  if (!organizationId || typeof organizationId !== 'string' || !organizationId.trim()) {
    throw new Error('ingestionBoundary: organizationId is required — a source record without a tenant is never valid');
  }
}

/** Only the typed provenance columns the caller supplied; an unknown category is a contract violation. */
function typedProvenanceColumns(input: ProviderSourceRecord): Record<string, string> {
  const cols: Record<string, string> = {};
  if (input.sourceCategory != null) {
    if (!isSourceCategory(input.sourceCategory)) {
      throw new Error(`ingestionBoundary: unknown sourceCategory '${String(input.sourceCategory)}'`);
    }
    cols.source_category = input.sourceCategory;
  }
  if (input.platform?.trim()) cols.platform = input.platform.trim().toLowerCase();
  if (input.sourceUrl?.trim()) cols.source_url = input.sourceUrl.trim();
  return cols;
}

/**
 * Persist the source record. Identity is
 * (organization_id, provider, entity_type, source_record_id), enforced by a
 * NON-PARTIAL unique index so it is inferable by ON CONFLICT.
 *
 * Idempotency is by DATABASE CONSTRAINT, never SELECT-then-INSERT: the insert
 * is attempted, and a 23505 means another worker won the race, at which point
 * the existing row is updated. Repeated ingestion therefore yields exactly one
 * row regardless of concurrency.
 *
 * KNOWN LIMIT: `observation_count` is maintained read-modify-write through
 * PostgREST, which cannot express `col = col + 1`. Under simultaneous
 * re-ingestion the counter may under-report. The ROW IDENTITY — one record per
 * provider record per tenant — is exact and is what the tests assert.
 */
export async function upsertSourceRecord(
  input: ProviderSourceRecord,
  now: string = new Date().toISOString(),
): Promise<{ id: string; outcome: SourceRecordOutcome }> {
  requireTenant(input.organizationId);
  if (!input.provider?.trim()) throw new Error('ingestionBoundary: provider is required');
  if (!input.sourceRecordId?.trim()) throw new Error('ingestionBoundary: sourceRecordId is required');

  const payload = redactSecrets(input.rawPayload ?? {}) as Record<string, unknown>;
  const payloadHash = computePayloadHash(payload);

  const row = {
    organization_id: input.organizationId,
    provider: input.provider,
    source_entity_type: input.entityType,
    source_record_id: input.sourceRecordId,
    person_id: input.personId ?? null,
    account_id: input.accountId ?? null,
    raw_payload: payload,
    payload_hash: payloadHash,
    observed_at: input.observedAt ?? null,
    ingestion_run_id: input.ingestionRunId ?? null,
    first_seen_at: now,
    last_seen_at: now,
    ingested_at: now,
    ...typedProvenanceColumns(input),
  };

  const insert = await ownedDbTable('source_records').insert(row).select('id').single();
  if (!insert.error) {
    return { id: (insert.data as { id: string }).id, outcome: 'created' };
  }
  if ((insert.error as { code?: string }).code !== '23505') {
    throw new Error(`ingestionBoundary: source record insert failed (${(insert.error as { code?: string }).code}): ${insert.error.message}`);
  }

  // Another worker created it, or we have seen this record before. Read the
  // existing row — tenant-filtered, always.
  const existing = await ownedDbTable('source_records')
    // Both canonical links are selected for the immutability guards below.
    // Without them a guard cannot tell an absent association from an existing
    // one, and silently degrades into the overwrite it exists to prevent.
    .select('id, payload_hash, observation_count, person_id, account_id')
    .eq('organization_id', input.organizationId)
    .eq('provider', input.provider)
    .eq('source_entity_type', input.entityType)
    .eq('source_record_id', input.sourceRecordId)
    .single();

  if (existing.error || !existing.data) {
    throw new Error('ingestionBoundary: source record conflicted but could not be re-read');
  }
  const found = existing.data as {
    id: string; payload_hash: string; observation_count: number;
    person_id: string | null; account_id: string | null;
  };
  const changed = found.payload_hash !== payloadHash;

  const update: Record<string, unknown> = {
    last_seen_at: now,
    updated_at: now,
    observation_count: (found.observation_count ?? 1) + 1,
  };
  if (changed) {
    // The payload moved. Retain the new one as current; the OLD claims survive
    // as assertions, which is where history actually lives.
    update.raw_payload = payload;
    update.payload_hash = payloadHash;
    update.observed_at = input.observedAt ?? null;
  }
  // ── CANONICAL LINKS: FILLED ONCE, NEVER RE-POINTED (O-5C, O-5E) ─────────
  // Both links are filled when absent, and ordinary ingestion never re-points
  // or clears either one. For a person-shaped record `person_id` is the
  // original SUBJECT anchor — whose record this was — while `account_id` is
  // contextual employer association, which `source_records_entity_coherent`
  // deliberately permits a person-shaped record to carry alongside its own.
  //
  // These are guards rather than comments because re-pointing is reachable in
  // code: a record's identity is the PROVIDER's record id, while the person is
  // resolved from the payload's email/phone/externalKeys with EMAIL TAKING
  // PRECEDENCE, and the account from the RECORD's company data rather than
  // from the person's existing attachment. So the same external id arriving
  // with a corrected email or a changed company can resolve differently. No
  // claim is made here about whether that has happened in any environment.
  //
  // KNOWN LIMITATION — this row and its children can disagree about the
  // subject. Child `source_assertions` carry their OWN subject, written once
  // at insert and never updated afterwards, so if resolution changes across
  // observations this row keeps the first subject while later assertions carry
  // the newer one. This code does not detect, report or repair that
  // divergence, and it does not authorize reassignment: there is deliberately
  // no merge or reassignment mechanism here, and nothing in the stored data
  // identifies which subject was the correct one.
  //
  // Both guards depend on `person_id` and `account_id` being selected above.
  if (input.personId && !found.person_id) update.person_id = input.personId;
  if (input.accountId && !found.account_id) update.account_id = input.accountId;

  const upd = await ownedDbTable('source_records')
    .update(update)
    .eq('id', found.id)
    .eq('organization_id', input.organizationId);
  if (upd.error) {
    throw new Error(`ingestionBoundary: source record update failed: ${upd.error.message}`);
  }

  return { id: found.id, outcome: changed ? 'changed' : 'unchanged' };
}

/** One normalised claim about one canonical attribute. */
interface PendingAssertion {
  attribute: string;
  rawValue: string | null;
  normalizedValue: string | null;
}

function pendingFromPerson(attrs: PersonAttributes, raw: PersonAttributes): PendingAssertion[] {
  const map: Array<[keyof PersonAttributes, string]> = [
    ['fullName', 'full_name'], ['firstName', 'first_name'], ['lastName', 'last_name'],
    ['jobTitle', 'job_title'], ['department', 'department'], ['seniority', 'seniority'],
    ['countryCode', 'country_code'], ['region', 'region'], ['city', 'city'], ['timezone', 'timezone'],
  ];
  return map
    .map(([key, column]) => ({
      attribute: column,
      rawValue: raw[key] == null ? null : String(raw[key]),
      normalizedValue: attrs[key] == null ? null : String(attrs[key]),
    }))
    .filter((a) => a.rawValue !== null || a.normalizedValue !== null);
}

function pendingFromAccount(attrs: AccountAttributes, raw: AccountAttributes): PendingAssertion[] {
  const map: Array<[keyof AccountAttributes, string]> = [
    ['industry', 'industry'], ['employeeCount', 'employee_count'], ['employeeBand', 'employee_band'],
    ['countryCode', 'country_code'], ['region', 'region'], ['city', 'city'], ['description', 'description'],
    // P2A firmographics. `technologies` arrives already JSON-serialised from
    // `toAccountAttributes`, so `String(...)` below leaves valid jsonb text
    // rather than the `'a,b'` a raw array would have produced.
    ['annualRevenue', 'annual_revenue'], ['revenueBand', 'revenue_band'],
    ['foundedYear', 'founded_year'], ['technologies', 'technologies'],
    ['fundingStage', 'funding_stage'], ['lastFundingAt', 'last_funding_at'],
  ];
  return map
    .map(([key, column]) => ({
      attribute: column,
      rawValue: raw[key] == null ? null : String(raw[key]),
      normalizedValue: attrs[key] == null ? null : String(attrs[key]),
    }))
    .filter((a) => a.rawValue !== null || a.normalizedValue !== null);
}

/**
 * Append assertions. Idempotent by unique constraint: re-asserting an identical
 * value from the same source record raises 23505 and is counted as already
 * present. A CHANGED value is a new row, so the previous claim survives.
 */
export async function recordAssertions(
  input: ProviderSourceRecord,
  sourceRecordId: string,
  pending: PendingAssertion[],
  now: string = new Date().toISOString(),
): Promise<{ recorded: number; alreadyPresent: number }> {
  requireTenant(input.organizationId);
  let recorded = 0;
  let alreadyPresent = 0;

  for (const a of pending) {
    const row = {
      organization_id: input.organizationId,
      source_record_id: sourceRecordId,
      entity_type: input.entityType,
      // O-5 — ONE SUBJECT PER ROW, and `entity_type` declares which. Both legs
      // are gated the same way: the caller resolves an employer before it
      // records provenance, so an ungated `account_id` meant every person
      // assertion also named that account and read as company evidence. The
      // employer association is NOT stored here — `attachPersonToAccount` owns
      // it on `unified_persons.account_id`. Forward-only: historical rows keep
      // both legs, which is why the readers stay subject-filtered.
      person_id: input.entityType === 'person' ? (input.personId ?? null) : null,
      account_id: input.entityType === 'account' ? (input.accountId ?? null) : null,
      attribute: a.attribute,
      raw_value: a.rawValue,
      normalized_value: a.normalizedValue,
      value_hash: computeValueHash(a.normalizedValue, a.rawValue),
      provider: input.provider,
      confidence: input.confidence ?? null,
      observed_at: input.observedAt ?? null,
      recorded_at: now,
    };
    const res = await ownedDbTable('source_assertions').insert(row).select('id').single();
    if (!res.error) { recorded += 1; continue; }
    if ((res.error as { code?: string }).code === '23505') { alreadyPresent += 1; continue; }
    throw new Error(`ingestionBoundary: assertion insert failed (${(res.error as { code?: string }).code}): ${res.error.message}`);
  }
  return { recorded, alreadyPresent };
}

/** Reasons an assertion may become canonical. A CLOSED vocabulary. */
export type CanonicalApplyReason =
  | 'single_uncontested_assertion'
  | 'authoritative_source'
  | 'newest_observation'
  | 'newest_then_highest_confidence';

/**
 * Reasons a write is refused.
 *
 * `sources_disagree` is preserved BYTE-FOR-BYTE: it is a published vocabulary
 * with external consumers (`accountIntelligence`, `enrichment/result`'s
 * markConflicting) and pinned tests. `canonical_value_already_set` is RETAINED in
 * the vocabulary and is no longer emitted — D-4 replaced the rule that produced
 * it — because a consumer that recognises it must keep compiling.
 */
export type CanonicalWithholdReason =
  | 'sources_disagree'
  | 'unattested_incumbent'
  | 'canonical_value_already_set';

/**
 * One live assertion, as arbitration sees it.
 *
 * `provider`, `observed_at`, `recorded_at` and `confidence` are what LI-2
 * recorded and never read. They are optional in the TYPE only so a caller asking
 * a narrower question (WS-7 asks only "do the sources disagree?") need not
 * fabricate them; a candidate that cannot be ordered in time simply cannot win on
 * recency, which fails closed rather than guessing.
 */
export interface ArbitrationCandidate {
  id: string;
  attribute: string;
  normalized_value: string | null;
  provider?: string | null;
  observed_at?: string | null;
  recorded_at?: string | null;
  confidence?: number | null;
  /**
   * Liveness. A SUPERSEDED assertion may not win — the source has withdrawn it —
   * but it still ATTESTS that its value passed through this layer, which is what
   * separates a value we once believed from a value that arrived from outside.
   *
   * Absent (the WS-7 case, whose loader filters to live rows) means live.
   */
  superseded_at?: string | null;
}

export interface CanonicalDecision {
  attribute: string;
  value: string;
  assertionId: string;
  reason: CanonicalApplyReason;
}

export interface CanonicalUpdateDecision {
  apply: CanonicalDecision[];
  withhold: Array<{ attribute: string; reason: CanonicalWithholdReason }>;
  /**
   * RAW disagreement: every attribute carrying more than one distinct live value,
   * whether or not arbitration then resolved it.
   *
   * This exists because the two questions came apart. Under LI-2, "do the sources
   * disagree?" and "may we write?" had the same answer, so WS-7 could read
   * disagreement out of `withhold`. Under the ratified rules recency RESOLVES most
   * disagreements, so `withhold` no longer reports them. Reporting raw
   * disagreement separately keeps WS-7's consistency dimension exactly as it was.
   */
  contested: string[];
}

/**
 * D-1, ratified: the arbitration timestamp is COALESCE(observed_at, recorded_at).
 *
 * NEVER an ingestion timestamp. `recorded_at` is NOT NULL in the schema, so on the
 * real path this is always a number; null is reachable only from a caller that
 * selected neither column, and such a candidate is refused the recency step.
 */
function arbitrationTimeMs(c: ArbitrationCandidate): number | null {
  const stamp = c.observed_at ?? c.recorded_at ?? null;
  if (typeof stamp !== 'string' || stamp.trim() === '') return null;
  const t = Date.parse(stamp);
  return Number.isFinite(t) ? t : null;
}

/**
 * A confidence the provider actually STATED, inside the range the database CHECK
 * allows. Anything else is "not stated" — never zero. A missing confidence must
 * not penalise an honest provider that declined to invent one.
 */
function statedConfidence(c: ArbitrationCandidate): number | null {
  const v = c.confidence;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

/** Live, usable candidate values only. Blank is not a value. */
function usableValue(c: ArbitrationCandidate): string | null {
  const v = c.normalized_value;
  if (typeof v !== 'string') return null;
  return v.trim() === '' ? null : v;
}

function distinctValues(pool: readonly ArbitrationCandidate[]): string[] {
  return [...new Set(pool.map((c) => c.normalized_value as string))];
}

/**
 * Order two assertions carrying the SAME winning value, so the one stamped as
 * canonical is chosen deterministically rather than by query row order. Newest
 * first, then highest stated confidence, then lowest id as the final total order —
 * so the result cannot depend on how the rows arrived.
 */
function compareForStamp(a: ArbitrationCandidate, b: ArbitrationCandidate): number {
  const ta = arbitrationTimeMs(a); const tb = arbitrationTimeMs(b);
  const na = ta === null ? Number.NEGATIVE_INFINITY : ta;
  const nb = tb === null ? Number.NEGATIVE_INFINITY : tb;
  if (na !== nb) return nb - na;
  const ca = statedConfidence(a); const cb = statedConfidence(b);
  const ka = ca === null ? -1 : ca; const kb = cb === null ? -1 : cb;
  if (ka !== kb) return kb - ka;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function stampedAssertionId(pool: readonly ArbitrationCandidate[], value: string): string {
  const carrying = pool.filter((c) => c.normalized_value === value);
  let best = carrying[0];
  for (const c of carrying) if (compareForStamp(c, best) < 0) best = c;
  return best.id;
}

/**
 * The ratified resolution order, over the live candidates for ONE attribute.
 * Pure, total and order-independent. Returns null when nothing wins — which is a
 * result, not a failure.
 */
function selectWinner(
  candidates: readonly ArbitrationCandidate[],
  authoritative: readonly string[],
): { value: string; reason: CanonicalApplyReason } | null {
  // 1. COLLAPSE BY VALUE. Agreement is value identity; the provider is irrelevant.
  const distinct = distinctValues(candidates);
  if (distinct.length === 1) {
    return { value: distinct[0], reason: 'single_uncontested_assertion' };
  }

  // 2. DECLARED AUTHORITY (D-3). Restricts, never widens.
  let pool: readonly ArbitrationCandidate[] = candidates;
  if (authoritative.length > 0) {
    const restricted = candidates.filter((c) => authoritative.includes(normalizeProviderKey(c.provider)));
    if (restricted.length > 0) {
      const d = distinctValues(restricted);
      if (d.length === 1) return { value: d[0], reason: 'authoritative_source' };
      // The authoritative source disagrees with ITSELF; continue within it only.
      pool = restricted;
    }
    // An authoritative source that said nothing is silent, not decisive: the full
    // candidate set continues to recency.
  }

  // 3. RECENCY (D-1), PRIMARY. Every candidate must be orderable in time, or
  // nothing can be chosen — refusing beats picking arbitrarily.
  if (pool.some((c) => arbitrationTimeMs(c) === null)) return null;
  let maxT = Number.NEGATIVE_INFINITY;
  for (const c of pool) { const t = arbitrationTimeMs(c) as number; if (t > maxT) maxT = t; }
  const atMax = pool.filter((c) => arbitrationTimeMs(c) === maxT);
  const dMax = distinctValues(atMax);
  if (dMax.length === 1) return { value: dMax[0], reason: 'newest_observation' };

  // 4. CONFIDENCE (D-2), TIE-BREAK ONLY, and only when EVERY tied candidate states
  // one. No normalisation and no magnitude threshold (O-2, ratified).
  if (atMax.some((c) => statedConfidence(c) === null)) return null;
  let maxC = Number.NEGATIVE_INFINITY;
  for (const c of atMax) { const v = statedConfidence(c) as number; if (v > maxC) maxC = v; }
  const atMaxC = atMax.filter((c) => statedConfidence(c) === maxC);
  const dC = distinctValues(atMaxC);
  if (dC.length === 1) return { value: dC[0], reason: 'newest_then_highest_confidence' };

  // 5. NO WINNER.
  return null;
}

/**
 * Does the current canonical value equal this asserted value?
 *
 * Canonical columns are not all text — `employee_count` and `founded_year` are
 * numeric, `last_funding_at` is a timestamp — while an assertion is always text.
 * A scalar is compared through its string form; a STRUCTURE never is, because a
 * coincidental `String()` match is not evidence. Failing to match makes the
 * incumbent look unattested, which is the protected direction.
 */
function canonicalMatches(current: unknown, value: string | null): boolean {
  if (value === null) return false;
  if (current === value) return true;
  if (current === null || current === undefined) return false;
  if (typeof current === 'object') return false;
  return String(current) === value;
}

const byAttributeName = (a: { attribute: string }, b: { attribute: string }): number =>
  (a.attribute < b.attribute ? -1 : a.attribute > b.attribute ? 1 : 0);

/**
 * Decide, per attribute, what the canonical value should be — using the rules
 * ratified in D22-B1a and documented at the top of this file.
 *
 * PURE. It takes the live evidence, the current canonical row and the tenant's
 * authority declaration, and returns a decision. It performs no I/O, reads no
 * clock and names no provider.
 *
 * `authority` is optional so a caller asking a narrower question keeps working
 * unchanged. WS-7 (`accountIntelligence`) deliberately passes an EMPTY canonical
 * row to disable incumbent handling and read `contested`; that convention is
 * load-bearing and must keep behaving this way.
 *
 * Outputs are sorted by attribute, so the result is identical however the rows
 * arrived.
 */
export function decideCanonicalUpdates(
  canonical: Record<string, unknown>,
  liveAssertions: readonly ArbitrationCandidate[],
  allowedColumns: readonly string[],
  authority?: AttributeAuthority | null,
): CanonicalUpdateDecision {
  const apply: CanonicalDecision[] = [];
  const withhold: Array<{ attribute: string; reason: CanonicalWithholdReason }> = [];
  const contested: string[] = [];

  // CANDIDACY and ATTESTATION read the same evidence for different purposes.
  // Only a LIVE assertion may win; ANY assertion, live or superseded, shows that
  // its value once passed through this layer and is therefore ours to re-decide.
  const byAttribute = new Map<string, ArbitrationCandidate[]>();
  const attestedByAttribute = new Map<string, Set<string>>();
  for (const a of liveAssertions) {
    if (!allowedColumns.includes(a.attribute)) continue;   // never write outside LI-1's surface
    const value = usableValue(a);
    if (value === null) continue;                          // null and blank are not values

    const seen = attestedByAttribute.get(a.attribute) ?? new Set<string>();
    seen.add(value);
    attestedByAttribute.set(a.attribute, seen);

    if (a.superseded_at != null) continue;                 // withdrawn: attests, cannot win
    const list = byAttribute.get(a.attribute) ?? [];
    list.push(a);
    byAttribute.set(a.attribute, list);
  }

  for (const [attribute, candidates] of byAttribute) {
    if (distinctValues(candidates).length > 1) contested.push(attribute);

    const winner = selectWinner(candidates, authoritativeProvidersFor(authority, attribute));
    if (!winner) {
      withhold.push({ attribute, reason: 'sources_disagree' });
      continue;
    }

    const current = canonical[attribute];
    const decision: CanonicalDecision = {
      attribute,
      value: winner.value,
      assertionId: stampedAssertionId(candidates, winner.value),
      reason: winner.reason,
    };

    // Empty canonical — write.
    if (current === null || current === undefined) { apply.push(decision); continue; }

    // Already in force — write nothing at all, so a re-run is a no-op.
    if (canonicalMatches(current, winner.value)) continue;

    // Different. An incumbent that NO assertion has ever carried is never
    // overwritten: it predates or came from outside this layer and cannot be
    // re-derived. A value a source has since WITHDRAWN is still attested — we
    // wrote it from evidence, so it is ours to re-decide.
    const everAsserted = attestedByAttribute.get(attribute) ?? new Set<string>();
    let attested = false;
    for (const value of everAsserted) {
      if (canonicalMatches(current, value)) { attested = true; break; }
    }
    if (!attested) { withhold.push({ attribute, reason: 'unattested_incumbent' }); continue; }

    // Attested and different — re-arbitration (D-4).
    apply.push(decision);
  }

  apply.sort(byAttributeName);
  withhold.sort(byAttributeName);
  contested.sort();
  return { apply, withhold, contested };
}

/**
 * D2 — the SUBJECT a reconciliation pass is permitted to touch.
 *
 * Liveness used to be keyed on (organization_id, source_record_id) alone, which
 * is SUBJECT-BLIND. One source record can legitimately carry evidence for more
 * than one subject — the lead orchestrator's account pass falls back to the
 * person's external id when the provider supplies no account id of its own — and
 * `currentHash` below is keyed by ATTRIBUTE, so ingesting for one subject could
 * supersede another subject's live row for the same attribute. The person and
 * account attribute surfaces overlap on country_code, region and city, so that
 * was reachable rather than theoretical.
 *
 * A discriminated union rather than three nullable ids: a malformed call cannot
 * compile into an ambiguous predicate, and there is no shape that means "any
 * subject".
 */
export type ReconcileSubject =
  | { readonly kind: 'person'; readonly personId: string }
  | { readonly kind: 'account'; readonly accountId: string }
  | { readonly kind: 'relationship'; readonly relationshipId: string };

/**
 * The column carrying each subject, and the id to match it against. Equality is
 * deliberate: a NULL subject reference can never satisfy it, so a fully detached
 * row is unreachable by reconciliation without a second predicate.
 */
function requireSubject(subject: ReconcileSubject): readonly [string, string, string] {
  const kind = (subject as { kind?: unknown } | null | undefined)?.kind;
  let column: string;
  let id: unknown;
  if (kind === 'person') { column = 'person_id'; id = (subject as { personId?: unknown }).personId; }
  else if (kind === 'account') { column = 'account_id'; id = (subject as { accountId?: unknown }).accountId; }
  else if (kind === 'relationship') { column = 'relationship_id'; id = (subject as { relationshipId?: unknown }).relationshipId; }
  else {
    throw new Error(
      `ingestionBoundary: a reconcile subject of kind person|account|relationship is required — `
      + `liveness is never subject-blind (got ${JSON.stringify(kind ?? null)})`,
    );
  }
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(`ingestionBoundary: reconcile subject '${kind}' requires a non-blank id`);
  }
  return [column, id, kind];
}

/**
 * S-1 — ASSERTION LIVENESS, reconciled against what this source record asserts NOW.
 *
 * LI-2's migration promised "A value that later changes at the same source inserts
 * a new row and the previous one is marked superseded, never deleted", and only
 * delivered the first half: `superseded_at` had FOUR readers and NO writer, so
 * every assertion ever recorded stayed live for ever. The consequence was severe
 * and silent — a source that CORRECTED itself still contested the attribute, so a
 * disagreement was permanent and no later evidence could repair it.
 *
 * ─── WHAT CAUSES SUPERSESSION, AND WHAT DOES NOT ──────────────────────────
 * Supersession is caused by the SAME source record asserting a DIFFERENT value for
 * the SAME attribute. It is scoped to (source_record_id, attribute) and never to a
 * provider, an entity or a tenant.
 *
 *   - LOSING ARBITRATION IS NOT SUPERSESSION. A live assertion that lost to a
 *     newer or authoritative value stays live. Marking losers superseded would
 *     erase the disagreement, break WS-7's contested set and silently stop
 *     `markConflicting` firing.
 *   - SILENCE IS NOT SUPERSESSION. A source that stops supplying an attribute
 *     retires nothing: its last claim stands. D-5 and O-4 are ratified — no
 *     age-based expiry participates anywhere.
 *
 * ─── RE-ASSERTION (the S-4 case B1a delegated here) ───────────────────────
 * The dedupe index is (organization_id, source_record_id, attribute, value_hash),
 * so a source that asserts A, then B, then A again cannot INSERT the second A —
 * the superseded row already occupies that key. Discovering that as a 23505 in
 * production was the outcome B1a explicitly told this gate to prevent.
 *
 * THE DECISION: liveness is a FUNCTION of what the source record currently
 * asserts, not an append-only stamp. Exactly one row per
 * (source_record, attribute) is live — the one whose `value_hash` matches the
 * current claim — and a returning value is REVIVED rather than duplicated.
 *
 * What that costs, stated plainly: the timestamp of a PREVIOUS supersession is
 * overwritten when a value returns, so "superseded at 10:00, revived at 11:00,
 * superseded again at 12:00" reads only as the last state. No row is deleted, no
 * `raw_value` is lost and no `applied_*` provenance is cleared, so no EVIDENCE is
 * discarded — only one derived marker is recomputed. Preserving every supersession
 * EVENT would need an additive log, and that was not authorised here.
 */
export async function reconcileAssertionLiveness(
  organizationId: string,
  sourceRecordId: string,
  subject: ReconcileSubject,
  pending: readonly PendingAssertion[],
  now: string = new Date().toISOString(),
): Promise<{ superseded: number; revived: number }> {
  requireTenant(organizationId);
  // Validated BEFORE any query: a bad subject must never degrade into a wide read.
  const [subjectColumn, subjectId, subjectKind] = requireSubject(subject);
  if (pending.length === 0) return { superseded: 0, revived: 0 };

  // One tenant-filtered, SUBJECT-CONFINED read for this record.
  const existing = await ownedDbTable('source_assertions')
    .select('id, attribute, value_hash, superseded_at')
    .eq('organization_id', organizationId)
    .eq('source_record_id', sourceRecordId)
    // BOTH legs of the confinement. The subject column alone is not enough: a
    // person-scoped row also carries `account_id` (the ingestion boundary sets it
    // unconditionally), so an account-subject read would still match a person's
    // row. `entity_type` is what DECLARES which leg is the subject, so it is the
    // predicate that makes "belonging to the incoming subject" exact.
    .eq('entity_type', subjectKind)
    .eq(subjectColumn, subjectId);
  if (existing.error) {
    throw new Error(`ingestionBoundary: assertion liveness read failed: ${existing.error.message}`);
  }
  const rows = (existing.data ?? []) as Array<{
    id: string; attribute: string; value_hash: string; superseded_at: string | null;
  }>;
  if (rows.length === 0) return { superseded: 0, revived: 0 };

  const currentHash = new Map<string, string>();
  for (const a of pending) currentHash.set(a.attribute, computeValueHash(a.normalizedValue, a.rawValue));

  const toSupersede: string[] = [];
  const toRevive: string[] = [];
  for (const row of rows) {
    const want = currentHash.get(row.attribute);
    if (want === undefined) continue;                 // the record no longer speaks to it
    if (row.value_hash === want) {
      if (row.superseded_at !== null) toRevive.push(row.id);
    } else if (row.superseded_at === null) {
      toSupersede.push(row.id);
    }
  }

  // Tenant stays in the predicate on the write, not only on the read.
  if (toSupersede.length > 0) {
    const r = await ownedDbTable('source_assertions')
      .update({ superseded_at: now })
      .eq('organization_id', organizationId)
      .eq('entity_type', subjectKind)
      .eq(subjectColumn, subjectId)
      .in('id', toSupersede);
    if (r.error) throw new Error(`ingestionBoundary: supersession failed: ${r.error.message}`);
  }
  if (toRevive.length > 0) {
    const r = await ownedDbTable('source_assertions')
      .update({ superseded_at: null, recorded_at: now })
      .eq('organization_id', organizationId)
      .eq('entity_type', subjectKind)
      .eq(subjectColumn, subjectId)
      .in('id', toRevive);
    if (r.error) throw new Error(`ingestionBoundary: assertion revival failed: ${r.error.message}`);
  }

  return { superseded: toSupersede.length, revived: toRevive.length };
}

/**
 * S-6/S-7/S-8 — the canonical DECISION history, append-only.
 *
 * This used to be `recordCanonicalProvenance`, a module-private helper that ran
 * AFTER the canonical update had already committed. That is the defect this
 * change closes, so the helper is gone rather than merely reordered: the
 * decision insert and the assertion stamp now happen inside
 * `pi_apply_canonical_decisions`, in the same transaction as the canonical
 * update. Nothing outside this module ever called it.
 *
 * The semantics it carried are unchanged and now live in SQL:
 *
 * `applied_to_canonical_at` and `applied_reason` are tied together by a CHECK,
 * so clearing one clears both and destroys the record that an assertion was ever
 * canonical. They are therefore NEVER cleared and NEVER overwritten — the
 * function stamps only an assertion that does not already carry a stamp, as a
 * database condition rather than a race.
 *
 * That alone cannot express a value winning, losing and winning again: a single
 * timestamptz has room for one event, so a re-win would either overwrite the
 * first stamp or leave the LATEST stamp pointing at a value that is no longer
 * canonical. Both are misleading, which is why `canonical_attribute_decisions`
 * exists: one append-only row per decision, ordered by `decided_at`, the newest
 * being what we believe now and the rest being why.
 */

/**
 * The full boundary: evidence first, liveness second, canonical third, provenance
 * last.
 *
 * Returns what it applied, what it withheld AND what is contested, because a
 * contested attribute is a finding in its own right even when arbitration
 * resolved it: it means two sources describe the prospect differently and
 * something downstream may want to know.
 */
export async function ingestSourceRecord(
  input: ProviderSourceRecord,
  now: string = new Date().toISOString(),
): Promise<IngestionResult> {
  requireTenant(input.organizationId);

  // 3. retain evidence
  const { id: sourceRecordId, outcome } = await upsertSourceRecord(input, now);

  // 4. normalise — reusing LI-1's normalisers, never re-implementing them
  const pending = input.entityType === 'person'
    ? pendingFromPerson(toPersonAttributes(input.personAttributes ?? {}), input.personAttributes ?? {})
    : pendingFromAccount(toAccountAttributes(input.accountAttributes ?? {}), input.accountAttributes ?? {});

  const { recorded, alreadyPresent } = await recordAssertions(input, sourceRecordId, pending, now);

  // 5/6/7 — canonical update only where a rule permits, and only when identity is
  // resolved. Unresolved evidence is parked, which is a supported state. Resolved
  // here rather than below because 4b needs it.
  const targetId = input.entityType === 'person' ? input.personId : input.accountId;

  // 4b. RECONCILE LIVENESS before anything arbitrates. A claim this record has
  // withdrawn must not contest the attribute it no longer makes.
  //
  // D2: the pass is SUBJECT-CONFINED. One source record can carry evidence for
  // more than one subject, so liveness is scoped to the subject being ingested.
  // Parked evidence has no resolved subject to confine to, so it is left alone
  // rather than reconciled widely — reconciling it would be the subject-blind
  // behaviour this change exists to remove.
  const liveness = targetId
    ? await reconcileAssertionLiveness(
        input.organizationId, sourceRecordId,
        input.entityType === 'person'
          ? { kind: 'person', personId: targetId }
          : { kind: 'account', accountId: targetId },
        pending, now,
      )
    : { superseded: 0, revived: 0 };

  const result: IngestionResult = {
    sourceRecordId, outcome,
    assertionsRecorded: recorded, assertionsAlreadyPresent: alreadyPresent,
    assertionsSuperseded: liveness.superseded, assertionsRevived: liveness.revived,
    canonicalApplied: [], canonicalWithheld: [], canonicalContested: [],
  };

  if (!targetId) return result;

  const table = input.entityType === 'person' ? 'unified_persons' : 'prospect_accounts';
  const tenantColumn = input.entityType === 'person' ? 'company_id' : 'organization_id';
  const allowed = input.entityType === 'person' ? PERSON_ATTRIBUTE_COLUMNS : ACCOUNT_ATTRIBUTE_COLUMNS;

  // 1. tenant ownership is re-validated on the read itself.
  const canonicalRow = await ownedDbTable(table)
    .select('*').eq('id', targetId).eq(tenantColumn, input.organizationId).single();
  if (canonicalRow.error || !canonicalRow.data) return result;

  // D-1 needs `recorded_at` as the fallback timestamp, D-2 needs `confidence` and
  // D-3 needs `provider`. LI-2 recorded all three and read none of them.
  //
  // SUPERSEDED rows are read too, and `superseded_at` is selected so the decision
  // function can tell them apart. They cannot win — the source withdrew them — but
  // they attest that a value passed through this layer, which is what stops a
  // withdrawn value freezing canonical. One query answers both questions.
  const live = await ownedDbTable('source_assertions')
    .select('id, attribute, normalized_value, provider, confidence, observed_at, recorded_at, superseded_at')
    .eq('organization_id', input.organizationId)
    // SUBJECT-CORRECT (E-1). The subject column alone is NOT sufficient: a
    // person-scoped row can also carry an account leg, which would otherwise be
    // read as company evidence — DECIDING and ATTESTING an account attribute
    // from a person's own value. O-5 has since gated the writer, so NEW person
    // assertions store `account_id = NULL`; HISTORICAL rows still carry both,
    // and no schema constraint forbids it, so this predicate stays as the
    // defence. `entity_type` declares which leg is the subject, which is what
    // makes "evidence about this subject" exact — matching D2's reconciliation
    // predicate, which confines on both legs.
    .eq('entity_type', input.entityType)
    .eq(input.entityType === 'person' ? 'person_id' : 'account_id', targetId);
  if (live.error) return result;

  // D-3: the authority declaration is DATA, resolved per tenant and entity type.
  // It is source-neutral today (O-1 and O-7 ratified as deferred).
  const authority: AttributeAuthority = await resolveAttributeAuthority(
    input.organizationId, input.entityType,
  );

  const decision = decideCanonicalUpdates(
    canonicalRow.data as Record<string, unknown>,
    (live.data ?? []) as ArbitrationCandidate[],
    allowed,
    authority,
  );
  result.canonicalWithheld = decision.withhold;
  result.canonicalContested = decision.contested;
  if (decision.apply.length === 0) return result;

  // 6/7. THE CANONICAL WRITE, ATOMICALLY.
  //
  // The canonical update, the decision log and the provenance stamp are one
  // transaction because they are one fact. Three separate PostgREST statements
  // could commit the first and fail the second, leaving a canonical value that
  // no decision row explains — and arbitration would never repair it, because
  // the next pass skips an attribute whose canonical value already matches and
  // returns before provenance is reached. So the gap was permanent, which is
  // why this is a function call and not a retry.
  //
  // Winner selection stays HERE, in `decideCanonicalUpdates`. The function
  // verifies the decisions it is handed against their assertions and refuses
  // anything outside the authorized attribute surface, but it cannot choose a
  // winner — there is no ordering or comparison in it at all.
  const applied = await ownedDbRpc('pi_apply_canonical_decisions', {
    p_organization_id: input.organizationId,
    p_entity_type: input.entityType,
    p_target_id: targetId,
    p_provider: input.provider,
    p_now: now,
    p_decisions: decision.apply.map((a) => ({
      attribute: a.attribute,
      value: a.value,
      assertion_id: a.assertionId,
      reason: a.reason,
    })),
  });
  if (applied.error) {
    throw new Error(`ingestionBoundary: canonical write failed: ${applied.error.message}`);
  }
  result.canonicalApplied = decision.apply.map((a) => a.attribute);
  return result;
}
