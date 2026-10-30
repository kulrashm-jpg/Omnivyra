/**
 * PI FOUNDATION — the ONE writer for person↔company relationships.
 *
 * ─── WHY A SINGLE MODULE ──────────────────────────────────────────────────
 * `unified_persons.account_id` is now a denormalized pointer to the primary
 * current relationship, and the two must agree at every COMMITTED instant. If
 * two services could each move one of them, the pointer would drift and nothing
 * would notice — which is precisely the class of defect this foundation exists
 * to remove. So there is one module, and inside it the state-changing
 * operations are SQL functions rather than sequences of calls.
 *
 * ─── WHY THE MUTATIONS ARE RPC ────────────────────────────────────────────
 * The runtime reaches the database through PostgREST, which has no
 * multi-statement transaction. Promoting a relationship and moving the pointer
 * as two calls can commit the first and lose the second. `pi_relationship_*`
 * (migration 20261122000000) do both in one atomic call, which is the mechanism
 * this repository already uses for `merge_unified_persons`, the execution-plan
 * creation and the credit reservations — not a new pattern.
 *
 * ─── WHAT THIS MODULE DELIBERATELY DOES NOT DO ────────────────────────────
 * It resolves no identity: `person_id` and `account_id` arrive already resolved,
 * from `resolveUnifiedPerson` and `resolveOrCreateAccount`. It neither writes
 * NOR READS a relationship-scoped attribute: those are decided by B1b from
 * assertions, writing one here would be a second arbitration path, and even
 * projecting one would make this the first database-capable module outside the
 * boundary to name an LI-1 attribute column. It never writes
 * `is_primary` or `account_id` directly — only through the functions — and it
 * never deletes a relationship: ending one is a state change that keeps the
 * evidence.
 *
 * It is also NOT yet wired into ingestion. `attachPersonToAccount` remains the
 * orchestrator's employer step and is byte-unchanged, because re-pointing it is
 * a behaviour change that belongs to the gate which also moves the ICP and
 * scoring readers. This module is the foundation those gates will call.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';

/** The six-value vocabulary, matching `par_relationship_type_valid` exactly. */
export const RELATIONSHIP_TYPES = [
  'employee', 'advisor', 'contractor', 'founder', 'former_employee', 'unknown',
] as const;
export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

export const isRelationshipType = (v: unknown): v is RelationshipType =>
  typeof v === 'string' && (RELATIONSHIP_TYPES as readonly string[]).includes(v);

export interface PersonAccountRelationship {
  readonly id: string;
  readonly organizationId: string;
  readonly personId: string;
  readonly accountId: string;
  readonly relationshipType: RelationshipType;
  readonly isPrimary: boolean;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

type Row = Record<string, unknown>;

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

const toRelationship = (r: Row): PersonAccountRelationship => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  personId: String(r.person_id),
  accountId: String(r.account_id),
  relationshipType: (text(r.relationship_type) ?? 'unknown') as RelationshipType,
  isPrimary: r.is_primary === true,
  startedAt: text(r.started_at),
  endedAt: text(r.ended_at),
});

/**
 * Structure only. The relationship-scoped attribute columns exist in the table
 * and the backfill populates them, but they are deliberately NOT projected
 * here: deciding them is relationship-scoped arbitration, which is a later
 * gate, and `prospectIdentityIngestionBoundary` enforces that no
 * database-capable module outside the b1b boundary even names an LI-1 attribute
 * beside a spine table. Reading them here would buy nothing this gate needs and
 * would put this module on the wrong side of that guarantee.
 */
const SELECT_COLS =
  'id, organization_id, person_id, account_id, relationship_type, is_primary, ' +
  'started_at, ended_at';

const requireTenant = (organizationId: string, where: string): void => {
  if (!organizationId || !organizationId.trim()) {
    throw new Error(`${where}: organizationId is required — a relationship is never tenant-less`);
  }
};

/**
 * Every relationship for a person, newest-ended last. Current rows first,
 * because that is what every caller wants and ordering it here stops each one
 * inventing its own rule.
 */
export async function listRelationshipsForPerson(
  organizationId: string,
  personId: string,
): Promise<PersonAccountRelationship[]> {
  requireTenant(organizationId, 'listRelationshipsForPerson');
  const { data, error } = await ownedDbTable('person_account_relationships')
    .select(SELECT_COLS)
    .eq('organization_id', organizationId)
    .eq('person_id', personId);
  if (error) throw new Error(`relationship read failed: ${error.message}`);
  // Through `unknown`: PostgREST types a string-literal select as a union
  // that includes GenericStringError, which does not overlap Row.
  const rows = (data as unknown as Row[] | null) ?? [];
  return rows
    .map(toRelationship)
    .sort((a, b) => (a.endedAt === null ? 0 : 1) - (b.endedAt === null ? 0 : 1));
}

/** The person's CURRENT relationships. `ended_at IS NULL` is the definition. */
export async function listCurrentRelationships(
  organizationId: string,
  personId: string,
): Promise<PersonAccountRelationship[]> {
  const all = await listRelationshipsForPerson(organizationId, personId);
  return all.filter((r) => r.endedAt === null);
}

/**
 * The relationship through which this person is being pursued, or null.
 *
 * At most one can exist — `uq_par_one_primary` makes more impossible — so this
 * returns a single value rather than asking the caller to disambiguate.
 */
export async function getPrimaryRelationship(
  organizationId: string,
  personId: string,
): Promise<PersonAccountRelationship | null> {
  const current = await listCurrentRelationships(organizationId, personId);
  return current.find((r) => r.isPrimary) ?? null;
}

export type CreateRelationshipResult =
  | { readonly created: true; readonly relationship: PersonAccountRelationship }
  | { readonly created: false; readonly reason: 'already_current'; readonly relationship: PersonAccountRelationship }
  | {
    readonly created: false;
    readonly reason: 'rejected';
    readonly detail: string;
    /**
     * The SQLSTATE, when the transport reported one. Carried so a caller can
     * tell an unapplied table from a genuine refusal without re-parsing a
     * message — `isRelationIllegible` below is the one place that judgement is
     * made, and it needs the code to make it exactly.
     */
    readonly code?: string;
  };

/**
 * Record a relationship. NEVER primary.
 *
 * Two things are deliberate. First, `is_primary` is not a parameter: primary is
 * a targeting decision and belongs to `setPrimaryRelationship`, so ingestion
 * order can never decide who gets pursued. Second, a duplicate CURRENT
 * relationship for the same pair is not an error — it is a replay, and the
 * existing row is returned. `uq_par_live` is PARTIAL, so `ON CONFLICT` cannot
 * name it (42P10); INSERT-then-catch-23505 is the only correct shape, and it is
 * the one WS-1 uses for the same reason.
 */
export async function createRelationship(input: {
  organizationId: string;
  personId: string;
  accountId: string;
  relationshipType?: RelationshipType;
  startedAt?: string | null;
}): Promise<CreateRelationshipResult> {
  requireTenant(input.organizationId, 'createRelationship');
  if (!input.personId?.trim() || !input.accountId?.trim()) {
    throw new Error('createRelationship: personId and accountId are required');
  }
  const relationshipType = input.relationshipType ?? 'employee';
  if (!isRelationshipType(relationshipType)) {
    throw new Error(`createRelationship: '${relationshipType}' is not a relationship type`);
  }

  const { data, error } = await ownedDbTable('person_account_relationships')
    .insert({
      organization_id: input.organizationId,
      person_id: input.personId,
      account_id: input.accountId,
      relationship_type: relationshipType,
      started_at: input.startedAt ?? null,
    })
    .select(SELECT_COLS)
    .single();

  if (!error && data) {
    return { created: true, relationship: toRelationship(data as unknown as Row) };
  }

  const code = (error as { code?: string } | null)?.code;
  if (code === '23505') {
    // A concurrent writer won, or this is a replay. Re-resolve rather than
    // retrying blindly: the winning row is the answer.
    const existing = (await listCurrentRelationships(input.organizationId, input.personId))
      .find((r) => r.accountId === input.accountId);
    if (existing) return { created: false, reason: 'already_current', relationship: existing };
  }
  const detail = (error as { message?: string } | null)?.message ?? 'unknown error';
  logger.warn('relationship_create_rejected', { code, detail });
  return { created: false, reason: 'rejected', detail, code };
}

/**
 * Make one relationship the primary, atomically moving the pointer with it.
 *
 * Refuses a relationship that is not current: a finished employment is not
 * something we can be pursuing, and `par_primary_is_current` would refuse the
 * row anyway. Nothing here writes `is_primary` or `account_id` — the function
 * does both, or neither.
 */
export async function setPrimaryRelationship(input: {
  organizationId: string;
  personId: string;
  accountId: string;
}): Promise<{ ok: true; relationshipId: string } | { ok: false; detail: string }> {
  requireTenant(input.organizationId, 'setPrimaryRelationship');
  const { data, error } = await supabase.rpc('pi_relationship_set_primary', {
    p_organization_id: input.organizationId,
    p_person_id: input.personId,
    p_account_id: input.accountId,
  });
  if (error) return { ok: false, detail: error.message };
  return { ok: true, relationshipId: String(data) };
}

/** Leave the person with no targeting relationship, and no pointer. */
export async function clearPrimaryRelationship(input: {
  organizationId: string;
  personId: string;
}): Promise<{ ok: true } | { ok: false; detail: string }> {
  requireTenant(input.organizationId, 'clearPrimaryRelationship');
  const { error } = await supabase.rpc('pi_relationship_clear_primary', {
    p_organization_id: input.organizationId,
    p_person_id: input.personId,
  });
  return error ? { ok: false, detail: error.message } : { ok: true };
}

/**
 * End a relationship, keeping the row.
 *
 * This is how "company A is historical" is recorded. The evidence survives — a
 * correction never deletes what a source observed — and if the ended
 * relationship was the primary one the pointer is cleared in the same
 * transaction, so `account_id` cannot keep naming a finished employment.
 */
export async function endRelationship(input: {
  organizationId: string;
  personId: string;
  accountId: string;
  endedAt?: string;
}): Promise<{ ok: true; relationshipId: string } | { ok: false; detail: string }> {
  requireTenant(input.organizationId, 'endRelationship');
  const { data, error } = await supabase.rpc('pi_relationship_end', {
    p_organization_id: input.organizationId,
    p_person_id: input.personId,
    p_account_id: input.accountId,
    p_ended_at: input.endedAt ?? new Date().toISOString(),
  });
  if (error) return { ok: false, detail: error.message };
  return { ok: true, relationshipId: String(data) };
}

// ───────────────────────────────────────────────────────────────────────────────
// PI WAVE-2B — ACCOUNT-SCOPED, DEGRADE-SAFE READS.
//
// Everything above throws when the read fails, which is correct for a writer:
// a mutation that cannot read its own state must not proceed. A READER on the
// intelligence path cannot behave that way, and neither can it be wired blind.
//
// `20261122000000` IS NOT KNOWN TO BE APPLIED IN PRODUCTION. If it is not, this
// table does not exist, and a reader that let the error propagate would turn
// every account aggregation into a 500; a reader that swallowed it into `[]`
// would be worse still, because "no rows" and "no table" would arrive at the
// caller as the same answer and the caller would report a person with a
// perfectly good employer pointer as having no relationship. That is the exact
// confusion of UNKNOWN with NEGATIVE this read exists to prevent.
//
// So the result is a TRI-STATE the caller cannot collapse by accident, and the
// caller decides what an unreadable table means for its own answer.
// ───────────────────────────────────────────────────────────────────────────────

/**
 * The table is not there. PostgREST reports a missing relation either as its
 * own schema-cache code (`PGRST205`) or as PostgreSQL's `42P01`; a missing
 * COLUMN (`42703`) means the migration landed in a shape this reader does not
 * recognise, which is equally "no usable evidence here". The message test is
 * the last resort, for a transport that forwards no code.
 */
export const isRelationIllegible = (err: { code?: string; message?: string } | null): boolean => {
  if (!err) return false;
  if (err.code === '42P01' || err.code === '42703' || err.code === 'PGRST205') return true;
  return Boolean(err.message
    && /does not exist|could not find the table|schema cache/i.test(err.message));
};

/**
 * Relationship evidence for ONE account, or the reason there is none to read.
 *
 * `legible: false` is NOT an empty roster. It says the question could not be
 * asked, and a caller that renders it as "this person has no relationship to
 * this account" is stating something the data never said.
 */
export type AccountRelationshipEvidence =
  | { readonly legible: true; readonly relationships: readonly PersonAccountRelationship[] }
  | {
    readonly legible: false;
    readonly reason: 'relation_absent' | 'read_failed';
    readonly detail: string;
  };

/**
 * Every relationship row for one ACCOUNT, in one tenant. Never throws.
 *
 * TENANT AND ACCOUNT ARE BOTH PREDICATES, AND BOTH ARE RE-CHECKED ON THE ROWS.
 * The query filters on them; the filter below re-asserts them. That is not
 * belt-and-braces for its own sake — this is the read that decides whether a
 * person is attributed to an account, so a row for a different account must be
 * incapable of reaching a caller even if the query were later edited wrongly.
 */
export async function readAccountRelationshipEvidence(
  organizationId: string,
  accountId: string,
): Promise<AccountRelationshipEvidence> {
  requireTenant(organizationId, 'readAccountRelationshipEvidence');
  if (!accountId?.trim()) {
    throw new Error('readAccountRelationshipEvidence: accountId is required');
  }

  let data: unknown;
  let error: { code?: string; message?: string } | null = null;
  try {
    const res = await ownedDbTable('person_account_relationships')
      .select(SELECT_COLS)
      .eq('organization_id', organizationId)
      .eq('account_id', accountId);
    data = res.data;
    error = (res.error as { code?: string; message?: string } | null) ?? null;
  } catch (thrown) {
    // A client that throws instead of returning an error is the same situation.
    error = { message: thrown instanceof Error ? thrown.message : String(thrown) };
  }

  if (error) {
    const absent = isRelationIllegible(error);
    if (absent) {
      logger.warn('relationship_evidence_relation_absent', { detail: error.message });
    }
    return {
      legible: false,
      reason: absent ? 'relation_absent' : 'read_failed',
      detail: error.message ?? 'unknown error',
    };
  }

  const rows = (data as unknown as Row[] | null) ?? [];
  const relationships = rows
    .map(toRelationship)
    // Re-assert both boundaries on the DATA, not just in the query.
    .filter((r) => r.organizationId === organizationId && r.accountId === accountId);
  return { legible: true, relationships };
}

/**
 * The ONE relationship that describes a person's standing at this account.
 *
 * A person may legitimately hold several rows for one account over time — an
 * employment that ended and a later one that did not. Order is therefore
 * decided here, once, rather than by whichever caller looked first:
 *
 *   1. the CURRENT primary (the relationship they are pursued through),
 *   2. any other CURRENT relationship,
 *   3. the most recently ENDED one — which is evidence of a FINISHED
 *      relationship, a negative fact, and must not be discarded into silence.
 *
 * Returns null only when the person holds no row for this account at all.
 */
export function pickAccountRelationship(
  relationships: readonly PersonAccountRelationship[],
): PersonAccountRelationship | null {
  const current = relationships.filter((r) => r.endedAt === null);
  const primary = current.find((r) => r.isPrimary);
  if (primary) return primary;
  if (current.length > 0) {
    // Deterministic among equals: `started_at` then id, never arrival order.
    return [...current].sort((a, b) =>
      (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || a.id.localeCompare(b.id))[0];
  }
  const ended = [...relationships].sort((a, b) =>
    (b.endedAt ?? '').localeCompare(a.endedAt ?? '') || a.id.localeCompare(b.id));
  return ended[0] ?? null;
}
