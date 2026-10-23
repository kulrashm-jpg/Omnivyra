/**
 * PI — THE relationship-scoped attribute producer.
 *
 * Employment attributes are facts about an EMPLOYMENT, not about a person. The
 * relationship foundation gave them a home (`person_account_relationships`),
 * the authority gate gave a tenant a way to declare who is authoritative for
 * them, and b1b has always known how to arbitrate. What did not exist was
 * anything that PRODUCED a relationship-level value: only the migration's
 * backfill ever wrote one. This module is that producer, and it is the only
 * one.
 *
 * The chain it completes, end to end:
 *
 *   assertion (provider or human)
 *     -> relationship-scoped source_assertions row
 *       -> authority declaration for (tenant, 'relationship', attribute)
 *         -> b1b arbitration (D-1..D-5, unchanged)
 *           -> canonical person_account_relationships.<attribute>
 *
 * ─── WHAT IS REUSED, AND WHY NOTHING IS REIMPLEMENTED ─────────────────────
 * `upsertSourceRecord`, `reconcileAssertionLiveness`, `computeValueHash` and
 * `decideCanonicalUpdates` are all imported from the b1b boundary, and
 * `resolveAttributeAuthority` from the authority module. Neither file is
 * modified. This module therefore adds no arbitration rule, no supersession
 * rule and no hash scheme: it adds a SUBJECT. That is deliberate — a second
 * implementation of any of those would be a second answer to a question b1b has
 * already ratified.
 *
 * What is genuinely new here is only: the relationship-scoped assertion row,
 * the canonical write to the relationship, and the stamp on the winning
 * assertion.
 *
 * ─── WHY THE SOURCE RECORD IS PERSON-SHAPED ───────────────────────────────
 * `source_records_entity_type_valid` admits only 'person' and 'account', so a
 * record cannot declare itself to be about a relationship. That is correct
 * rather than a gap: a provider observes a PERSON ("P is CTO at Company B").
 * The relationship is OUR derived employment context, reached by resolving the
 * person and the account. So the record stays person-shaped and carries
 * `person_id`, while the ASSERTION carries `entity_type = 'relationship'` and
 * `relationship_id`. `source_assertions_relationship_coherent` then requires
 * `person_id` and `account_id` to be NULL on that assertion, so a relationship
 * assertion can never also pretend to be a person assertion.
 *
 * ─── WHY THE SOURCE RECORD KEY IS SCOPED PER RELATIONSHIP ─────────────────
 * This is the load-bearing detail of the whole module, and it is not cosmetic.
 *
 * LIVENESS is no longer the reason. `reconcileAssertionLiveness` has been
 * SUBJECT-CONFINED since D2: it keys on `(organization_id, source_record_id,
 * entity_type, <the subject column>)`, and this producer passes
 * `{ kind: 'relationship', relationshipId }`. So one record carrying
 * `job_title` for TWO relationships can no longer have the first marked
 * SUPERSEDED when the second is reconciled — the subject predicate closes that,
 * and it no longer depends on how the record key happens to be built.
 *
 * DEDUPE still is. `uq_source_assertions_dedupe` is
 * `(organization_id, source_record_id, attribute, value_hash)` — subject-BLIND.
 * So the same record asserting the same attribute and value for two
 * relationships would still collide (23505), and the second relationship would
 * silently record nothing: the boundary counts that code as already present.
 *
 * Rather than change the boundary or the index, the producer makes a record
 * never span two relationships: the stored `source_record_id` is the caller's
 * key with the relationship appended. Dedupe then becomes relationship-scoped
 * by construction, and the caller cannot get it wrong by forgetting.
 *
 * ─── FAIL CLOSED ──────────────────────────────────────────────────────────
 * If the authority declaration cannot be read, NO canonical value is written.
 * The store throws, this module lets it throw, and the evidence it already
 * recorded stays recorded. Writing a canonical value under an unknown
 * declaration would silently apply recency to a tenant that had declared
 * otherwise, which is the precise defect the authority work removed.
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  upsertSourceRecord,
  reconcileAssertionLiveness,
  computeValueHash,
  decideCanonicalUpdates,
  type ArbitrationCandidate,
} from './ingestionBoundary';
import {
  resolveAttributeAuthority,
  RELATIONSHIP_AUTHORITY_COLUMNS,
} from './attributeAuthority';
import { normalizeDisplayText, isSeniority, isBuyingRole } from './attributes';
import { logger } from '../logger';

/** Bumped when this producer's contract changes. */
export const RELATIONSHIP_ATTRIBUTE_PRODUCER_VERSION = 'pi-rel-attr.1';

export type RelationshipAttribute = typeof RELATIONSHIP_AUTHORITY_COLUMNS[number];

export const isRelationshipAttribute = (v: unknown): v is RelationshipAttribute =>
  typeof v === 'string' && (RELATIONSHIP_AUTHORITY_COLUMNS as readonly string[]).includes(v);

export interface RelationshipAssertionInput {
  /** TENANT. Never the prospect's employer. */
  organizationId: string;
  /**
   * The relationship this claim is about. NOT a person, and NOT the person
   * spine's denormalized employer pointer: a person may hold several
   * employments at once and several historically, so "their current company"
   * does not identify which employment a title belongs to.
   *
   * The pointer column is deliberately described rather than named here.
   * `prospectIdentityIngestionBoundary` scans any file that names a spine table
   * AND mentions an LI-1 attribute, and this module legitimately does the
   * second. Naming the table in prose would trip that scan without this file
   * ever writing the spine. The scan loses nothing: a real write would have to
   * pass the table name to `ownedDbTable`, which still trips it. That this
   * module writes no person-level employment attribute is asserted directly,
   * in both its unit and its real-schema suite.
   */
  relationshipId: string;
  attribute: RelationshipAttribute;
  /** The asserted value. Normalised here, never by the caller. */
  value: string | null;
  /** Free-text source key, compared case-insensitively against a declaration. */
  provider: string;
  origin?: 'provider' | 'human';
  /** Required when origin is 'human', forbidden otherwise. */
  assertedByUserId?: string | null;
  observedAt?: string | null;
  confidence?: number | null;
  /**
   * The SOURCE's own identifier for the observation. The producer scopes it to
   * the relationship before storing, so one caller key may safely describe
   * several employments.
   */
  sourceRecordKey: string;
  rawPayload?: Record<string, unknown>;
  ingestionRunId?: string | null;
}

export type RelationshipAssertionRefusal =
  | 'tenant_required'
  | 'relationship_required'
  | 'source_key_required'
  | 'provider_required'
  | 'invalid_attribute'
  | 'invalid_value'
  | 'actor_required'
  | 'actor_forbidden'
  | 'relationship_not_found';

export interface RelationshipAssertionApplied {
  readonly attribute: string;
  readonly value: string;
  readonly reason: string;
  readonly assertionId: string;
}

export type RelationshipAssertionResult =
  | {
      readonly ok: true;
      readonly relationshipId: string;
      readonly sourceRecordId: string;
      readonly assertionRecorded: boolean;
      readonly assertionAlreadyPresent: boolean;
      readonly superseded: number;
      readonly revived: number;
      readonly canonicalApplied: readonly RelationshipAssertionApplied[];
      readonly canonicalWithheld: ReadonlyArray<{ attribute: string; reason: string }>;
      readonly canonicalContested: readonly string[];
    }
  | { readonly ok: false; readonly reason: RelationshipAssertionRefusal; readonly detail?: string };

interface RelationshipRow {
  id: string;
  organization_id: string;
  person_id: string;
  account_id: string;
  ended_at: string | null;
  job_title: string | null;
  department: string | null;
  seniority: string | null;
  buying_role: string | null;
  attributes_source: string | null;
  attributes_updated_at: string | null;
}

/**
 * Normalise a claim for one attribute, or reject it.
 *
 * `seniority` and `buying_role` are closed vocabularies with CHECK constraints
 * on the relationship table. An out-of-vocabulary value is refused HERE rather
 * than stored: stored, it could never become canonical, so it would sit in the
 * evidence log looking like a claim that merely lost an arbitration, and the
 * canonical UPDATE would fail for every later caller on that relationship.
 *
 * A blank value is refused too. Withdrawal is expressed by asserting a
 * DIFFERENT value under the same source record, which supersession already
 * handles; a null claim is not evidence of anything.
 */
function normalizeClaim(
  attribute: RelationshipAttribute, value: string | null,
): { ok: true; normalized: string } | { ok: false } {
  if (attribute === 'job_title' || attribute === 'department') {
    const normalized = normalizeDisplayText(value);
    return normalized ? { ok: true, normalized } : { ok: false };
  }
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (attribute === 'seniority') {
    return isSeniority(candidate) ? { ok: true, normalized: candidate } : { ok: false };
  }
  return isBuyingRole(candidate) ? { ok: true, normalized: candidate } : { ok: false };
}

/**
 * The stored source-record identity: the caller's key, scoped to the
 * relationship. See the module header — this is what keeps liveness and dedupe
 * from reaching across employments.
 */
const scopedSourceRecordId = (callerKey: string, relationshipId: string): string =>
  `${callerKey.trim()}#rel:${relationshipId}`;

/**
 * Assert ONE relationship-scoped attribute, then let b1b decide the canonical
 * value.
 *
 * Evidence is recorded whether or not it wins. A claim that loses an
 * arbitration is still what a source said, and the next call re-decides from
 * the whole evidence set rather than from this claim alone.
 */
export async function assertRelationshipAttribute(
  input: RelationshipAssertionInput,
  now: string = new Date().toISOString(),
): Promise<RelationshipAssertionResult> {
  if (!input.organizationId?.trim()) return { ok: false, reason: 'tenant_required' };
  if (!input.relationshipId?.trim()) return { ok: false, reason: 'relationship_required' };
  if (!input.sourceRecordKey?.trim()) return { ok: false, reason: 'source_key_required' };
  if (!input.provider?.trim()) return { ok: false, reason: 'provider_required' };
  if (!isRelationshipAttribute(input.attribute)) return { ok: false, reason: 'invalid_attribute' };

  const origin = input.origin ?? 'provider';
  const actor = input.assertedByUserId ?? null;
  // Mirrors `source_assertions_origin_actor` so the refusal is a clear answer
  // rather than a constraint violation surfaced from the database.
  if (origin === 'human' && !actor) return { ok: false, reason: 'actor_required' };
  if (origin === 'provider' && actor) return { ok: false, reason: 'actor_forbidden' };

  const claim = normalizeClaim(input.attribute, input.value);
  if (!claim.ok) return { ok: false, reason: 'invalid_value' };

  // ── 1. The relationship, read under its tenant ─────────────────────────
  // This read IS the tenant check and the existence check at once: a
  // relationship belonging to another tenant simply is not found, so a
  // cross-tenant assertion is refused before any evidence is written. The
  // composite foreign keys would refuse it at the database too; this makes the
  // refusal legible instead of a 23503 from three statements later.
  const relRead = await ownedDbTable('person_account_relationships')
    .select('id, organization_id, person_id, account_id, ended_at, '
      + 'job_title, department, seniority, buying_role, attributes_source, attributes_updated_at')
    .eq('id', input.relationshipId)
    .eq('organization_id', input.organizationId)
    .single();
  if (relRead.error || !relRead.data) {
    return { ok: false, reason: 'relationship_not_found' };
  }
  const relationship = relRead.data as unknown as RelationshipRow;

  // ── 2. Retain the evidence record ──────────────────────────────────────
  // Person-shaped, carrying the relationship's person, and keyed per
  // relationship. `upsertSourceRecord` is passed NO attribute bags, so it
  // cannot create person-level assertions: this producer never writes a
  // person-global employment fact.
  const sourceRecordId = scopedSourceRecordId(input.sourceRecordKey, input.relationshipId);
  const { id: recordId } = await upsertSourceRecord({
    organizationId: input.organizationId,
    provider: input.provider,
    entityType: 'person',
    sourceRecordId,
    rawPayload: input.rawPayload ?? {
      relationship_id: input.relationshipId,
      attribute: input.attribute,
      value: claim.normalized,
    },
    personId: relationship.person_id,
    observedAt: input.observedAt ?? null,
    ingestionRunId: input.ingestionRunId ?? null,
  }, now);

  // ── 3. The relationship-scoped assertion ───────────────────────────────
  const valueHash = computeValueHash(claim.normalized, typeof input.value === 'string' ? input.value : null);
  const assertionRow = {
    organization_id: input.organizationId,
    source_record_id: recordId,
    entity_type: 'relationship',
    relationship_id: input.relationshipId,
    // Both NULL by `source_assertions_relationship_coherent`: a relationship
    // assertion names its relationship and nothing else.
    person_id: null,
    account_id: null,
    attribute: input.attribute,
    raw_value: typeof input.value === 'string' ? input.value : null,
    normalized_value: claim.normalized,
    value_hash: valueHash,
    provider: input.provider,
    origin,
    asserted_by_user_id: actor,
    confidence: input.confidence ?? null,
    observed_at: input.observedAt ?? null,
    recorded_at: now,
  };

  let assertionRecorded = false;
  let assertionAlreadyPresent = false;
  const inserted = await ownedDbTable('source_assertions').insert(assertionRow).select('id').single();
  if (!inserted.error) {
    assertionRecorded = true;
  } else if ((inserted.error as { code?: string }).code === '23505') {
    // The inherited idempotency contract: the dedupe index is
    // (organization_id, source_record_id, attribute, value_hash), so the same
    // claim from the same observation is a REPLAY, not an error.
    assertionAlreadyPresent = true;
  } else {
    const code = (inserted.error as { code?: string }).code;
    logger.warn('relationship_assertion_rejected', { code, attribute: input.attribute });
    throw new Error(`relationshipAttributeIngestion: assertion insert failed (${code}): ${inserted.error.message}`);
  }

  // ── 4. Liveness, before anything arbitrates ────────────────────────────
  // A claim this observation has WITHDRAWN must not contest the attribute it no
  // longer makes. The source-record key is already scoped to one relationship;
  // D2 makes that confinement STRUCTURAL by naming the subject, so the guarantee
  // no longer rests on how the key happens to be constructed.
  const liveness = await reconcileAssertionLiveness(
    input.organizationId, recordId,
    { kind: 'relationship', relationshipId: input.relationshipId },
    [{ attribute: input.attribute, rawValue: assertionRow.raw_value, normalizedValue: claim.normalized }],
    now,
  );

  // ── 5. Every assertion about THIS relationship ─────────────────────────
  // Superseded rows are read too: they cannot win, but they ATTEST that a value
  // passed through this layer, which is what stops a withdrawn value freezing
  // the canonical column (D-4).
  const live = await ownedDbTable('source_assertions')
    .select('id, attribute, normalized_value, provider, confidence, observed_at, recorded_at, superseded_at')
    .eq('organization_id', input.organizationId)
    // C-1 — SUBJECT-SCOPED, like every sibling assertion reader. `relationship_id`
    // alone is exact only by writer discipline: this module is its only writer,
    // but no CHECK forbids a person- or account-scoped row from carrying a
    // `relationship_id`, and the detachment trigger guards UPDATE only — such a
    // row would pass every constraint on INSERT. `entity_type` is what declares
    // which leg is the subject, so this makes the confinement structural.
    .eq('entity_type', 'relationship')
    .eq('relationship_id', input.relationshipId);
  if (live.error) {
    throw new Error(`relationshipAttributeIngestion: assertion read failed: ${live.error.message}`);
  }
  const candidates = ((live.data ?? []) as unknown as ArbitrationCandidate[]);

  // ── 6. Authority (D-3), for the RELATIONSHIP scope ─────────────────────
  // Throws on a read failure, and is deliberately not caught: no canonical
  // value may be written under an unknown declaration.
  const authority = await resolveAttributeAuthority(input.organizationId, 'relationship');

  // ── 7. Arbitration — b1b's, unchanged ──────────────────────────────────
  const decision = decideCanonicalUpdates(
    {
      job_title: relationship.job_title,
      department: relationship.department,
      seniority: relationship.seniority,
      buying_role: relationship.buying_role,
    },
    candidates,
    RELATIONSHIP_AUTHORITY_COLUMNS,
    authority,
  );

  const result = {
    ok: true as const,
    relationshipId: input.relationshipId,
    sourceRecordId: recordId,
    assertionRecorded,
    assertionAlreadyPresent,
    superseded: liveness.superseded,
    revived: liveness.revived,
    canonicalApplied: [] as RelationshipAssertionApplied[],
    canonicalWithheld: decision.withhold,
    canonicalContested: decision.contested,
  };
  if (decision.apply.length === 0) return result;

  // ── 8. The canonical relationship value ────────────────────────────────
  // `attributes_source` is stamped with the provider of the WINNING assertion,
  // not with this call's provider: when a human correction wins against an
  // Apollo claim, recording 'apollo' as the source of the canonical value would
  // be false.
  const providerOf = new Map<string, string>();
  for (const c of candidates) providerOf.set(String(c.id), String(c.provider ?? ''));
  const winnerForThisCall = decision.apply.find((a) => a.attribute === input.attribute)
    ?? decision.apply[0];
  const winningProvider = providerOf.get(String(winnerForThisCall.assertionId)) ?? input.provider;

  const patch: Record<string, unknown> = {
    attributes_source: winningProvider,
    attributes_updated_at: now,
  };
  for (const a of decision.apply) patch[a.attribute] = a.value;

  const applied = await ownedDbTable('person_account_relationships')
    .update(patch)
    .eq('id', input.relationshipId)
    .eq('organization_id', input.organizationId);
  if (applied.error) {
    throw new Error(`relationshipAttributeIngestion: canonical update failed: ${applied.error.message}`);
  }

  // ── 9. Provenance: APPEND the decision, then STAMP the winner ──────────
  // The same two steps, in the same order, as the person/account boundary's
  // `recordCanonicalProvenance`. That function is module-private to a
  // protected file, so the MECHANISM is reused — one decision log, the same
  // columns, the same semantics — rather than the function itself.
  //
  // Why both: `applied_to_canonical_at` has room for exactly one event, so it
  // cannot express a value winning, losing and winning again. The log can, and
  // it is append-only by trigger, so a later re-win adds a row rather than
  // rewriting one.
  //
  // Nothing is logged when arbitration applies nothing. That is the whole
  // distinction the log encodes: a losing assertion is EVIDENCE, and only a
  // canonical decision is a DECISION. It is also what makes a replay
  // idempotent, since an already-in-force value applies nothing.
  for (const a of decision.apply) {
    const logged = await ownedDbTable('canonical_attribute_decisions').insert({
      organization_id: input.organizationId,
      entity_type: 'relationship',
      // A relationship decision describes an employment, so it names neither
      // a person nor an account.
      person_id: null,
      account_id: null,
      relationship_id: input.relationshipId,
      attribute: a.attribute,
      assertion_id: a.assertionId,
      value: a.value,
      reason: a.reason,
      decided_at: now,
    });
    if (logged.error) {
      throw new Error(`relationshipAttributeIngestion: canonical decision log failed: ${logged.error.message}`);
    }

    // Only if not already stamped, and never cleared — the same rule the
    // person boundary follows. The log carries any later re-win.
    const stamped = await ownedDbTable('source_assertions')
      .update({ applied_to_canonical_at: now, applied_reason: a.reason })
      .eq('id', a.assertionId)
      .eq('organization_id', input.organizationId)
      .is('applied_to_canonical_at', null);
    if (stamped.error) {
      throw new Error(`relationshipAttributeIngestion: provenance stamp failed: ${stamped.error.message}`);
    }
  }

  result.canonicalApplied = decision.apply.map((a) => ({
    attribute: a.attribute, value: a.value, reason: a.reason, assertionId: a.assertionId,
  }));
  return result;
}
