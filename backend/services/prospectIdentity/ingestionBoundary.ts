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
 * ─── THE CANONICAL SELECTION RULES ─────────────────────────────────────────
 *
 * LI-2 deliberately implements the WEAKEST rule that is still useful, because
 * anything stronger is a precedence policy and precedence is a product decision
 * this phase is forbidden to make:
 *
 *   A. canonical value is NULL, and exactly ONE distinct live value is asserted
 *      across all sources  -> apply it. reason: 'single_uncontested_assertion'
 *   B. canonical value is NULL, and sources DISAGREE
 *      -> apply nothing. The evidence is retained and the field stays NULL.
 *         reason recorded on no assertion; the disagreement is the output.
 *   C. canonical value is already set
 *      -> never overwrite. Re-arbitration belongs to LI-6.
 *
 * There is no provider ranking, no recency preference, no confidence weighting
 * and no "Apollo beats CRM". Introducing any of those silently would decide a
 * question the programme has not answered. See the LI-2 report.
 */

import { createHash } from 'node:crypto';
import { ownedDbTable } from '../../db/writeOwner';
import {
  toPersonAttributes, toAccountAttributes,
  PERSON_ATTRIBUTE_COLUMNS, ACCOUNT_ATTRIBUTE_COLUMNS,
  type PersonAttributes, type AccountAttributes,
} from './attributes';

export const INGESTION_BOUNDARY_VERSION = 'li2.1';

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
}

export type SourceRecordOutcome = 'created' | 'unchanged' | 'changed';

export interface IngestionResult {
  sourceRecordId: string;
  outcome: SourceRecordOutcome;
  assertionsRecorded: number;
  assertionsAlreadyPresent: number;
  canonicalApplied: string[];
  canonicalWithheld: Array<{ attribute: string; reason: string }>;
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
    .select('id, payload_hash, observation_count')
    .eq('organization_id', input.organizationId)
    .eq('provider', input.provider)
    .eq('source_entity_type', input.entityType)
    .eq('source_record_id', input.sourceRecordId)
    .single();

  if (existing.error || !existing.data) {
    throw new Error('ingestionBoundary: source record conflicted but could not be re-read');
  }
  const found = existing.data as { id: string; payload_hash: string; observation_count: number };
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
  // Canonical links are only ever filled in, never re-pointed here.
  if (input.personId) update.person_id = input.personId;
  if (input.accountId) update.account_id = input.accountId;

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
      person_id: input.entityType === 'person' ? (input.personId ?? null) : null,
      account_id: input.accountId ?? null,
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

/**
 * Decide, per attribute, whether the canonical value may be written — using
 * ONLY the three rules documented at the top of this file. Pure: it takes the
 * live evidence and the current canonical row and returns a decision.
 */
export function decideCanonicalUpdates(
  canonical: Record<string, unknown>,
  liveAssertions: Array<{ attribute: string; normalized_value: string | null; id: string }>,
  allowedColumns: readonly string[],
): { apply: Array<{ attribute: string; value: string; assertionId: string; reason: string }>;
     withhold: Array<{ attribute: string; reason: string }> } {
  const apply: Array<{ attribute: string; value: string; assertionId: string; reason: string }> = [];
  const withhold: Array<{ attribute: string; reason: string }> = [];

  const byAttribute = new Map<string, Array<{ value: string; id: string }>>();
  for (const a of liveAssertions) {
    if (!allowedColumns.includes(a.attribute)) continue;   // never write outside LI-1's surface
    if (a.normalized_value == null) continue;
    const list = byAttribute.get(a.attribute) ?? [];
    list.push({ value: a.normalized_value, id: a.id });
    byAttribute.set(a.attribute, list);
  }

  for (const [attribute, candidates] of byAttribute) {
    // RULE C — never overwrite a value that is already canonical.
    if (canonical[attribute] !== null && canonical[attribute] !== undefined) {
      withhold.push({ attribute, reason: 'canonical_value_already_set' });
      continue;
    }
    const distinct = [...new Set(candidates.map((c) => c.value))];
    // RULE B — sources disagree. Retain the evidence, write nothing.
    if (distinct.length > 1) {
      withhold.push({ attribute, reason: 'sources_disagree' });
      continue;
    }
    // RULE A — one uncontested value.
    apply.push({
      attribute,
      value: distinct[0],
      assertionId: candidates[0].id,
      reason: 'single_uncontested_assertion',
    });
  }
  return { apply, withhold };
}

/**
 * The full boundary: evidence first, canonical second, provenance last.
 *
 * Returns what it applied AND what it withheld, because a withheld attribute is
 * a finding — it means two sources disagree and something downstream (LI-6)
 * will have to arbitrate.
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

  const result: IngestionResult = {
    sourceRecordId, outcome,
    assertionsRecorded: recorded, assertionsAlreadyPresent: alreadyPresent,
    canonicalApplied: [], canonicalWithheld: [],
  };

  // 5/6/7 — canonical update only where a rule permits, and only when identity
  // is resolved. Unresolved evidence is parked, which is a supported state.
  const targetId = input.entityType === 'person' ? input.personId : input.accountId;
  if (!targetId) return result;

  const table = input.entityType === 'person' ? 'unified_persons' : 'prospect_accounts';
  const tenantColumn = input.entityType === 'person' ? 'company_id' : 'organization_id';
  const allowed = input.entityType === 'person' ? PERSON_ATTRIBUTE_COLUMNS : ACCOUNT_ATTRIBUTE_COLUMNS;

  // 1. tenant ownership is re-validated on the read itself.
  const canonicalRow = await ownedDbTable(table)
    .select('*').eq('id', targetId).eq(tenantColumn, input.organizationId).single();
  if (canonicalRow.error || !canonicalRow.data) return result;

  const live = await ownedDbTable('source_assertions')
    .select('id, attribute, normalized_value')
    .eq('organization_id', input.organizationId)
    .eq(input.entityType === 'person' ? 'person_id' : 'account_id', targetId)
    .is('superseded_at', null);
  if (live.error) return result;

  const decision = decideCanonicalUpdates(
    canonicalRow.data as Record<string, unknown>,
    (live.data ?? []) as Array<{ attribute: string; normalized_value: string | null; id: string }>,
    allowed,
  );
  result.canonicalWithheld = decision.withhold;
  if (decision.apply.length === 0) return result;

  const patch: Record<string, unknown> = { attributes_source: input.provider, attributes_updated_at: now };
  for (const a of decision.apply) patch[a.attribute] = a.value;

  const applied = await ownedDbTable(table)
    .update(patch).eq('id', targetId).eq(tenantColumn, input.organizationId);
  if (applied.error) {
    throw new Error(`ingestionBoundary: canonical update failed: ${applied.error.message}`);
  }
  result.canonicalApplied = decision.apply.map((a) => a.attribute);

  // 7. provenance — mark exactly which assertion became canonical, and why.
  for (const a of decision.apply) {
    await ownedDbTable('source_assertions')
      .update({ applied_to_canonical_at: now, applied_reason: a.reason })
      .eq('id', a.assertionId)
      .eq('organization_id', input.organizationId);
  }
  return result;
}
