/**
 * D1 — the ONLY module permitted to write the ICP tables.
 *
 * It decides nothing. Every rule — the four-status lifecycle, the one-ratified-
 * version constraint, ratified immutability, the vocabulary — is fixed by
 * 20261012000000_d1_tenant_icp_model.sql and by `criteria.ts`. This module
 * enforces them at the edge so a caller receives a clear error instead of a raw
 * SQLSTATE, and otherwise lets the database be the authority.
 *
 * ─── IDEMPOTENCY AND CONCURRENCY ARE BY DATABASE CONSTRAINT ───────────────
 * `uq_prospect_icp_versions_one_ratified` is a PARTIAL unique index
 * (`WHERE status = 'ratified'`). PostgREST CANNOT infer a partial index, so
 * `ON CONFLICT` answers `42P10` — the trap this programme hit in W0.1, W0.2 and
 * W3. Every write here is INSERT-or-UPDATE → catch `23505` → re-resolve. There
 * is no SELECT-then-write used as a guard: between the read and the write the
 * world can change, and a unique index cannot.
 *
 * `nextVersionNumber` DOES read the current maximum, but it is explicitly NOT a
 * guard — it is a hint. Two concurrent proposers can compute the same number;
 * the identity index then refuses the loser with `23505` and it retries. That
 * is the correct division: the read makes the common case cheap, the constraint
 * makes every case correct.
 *
 * ─── TENANT SAFETY IS ENFORCED BY THE DATABASE, NOT BY A PRE-CHECK ────────
 * `(icp_id, organization_id) → prospect_icps(id, organization_id)` means naming
 * another tenant's ICP raises `23503`. Every query here also filters on
 * `organization_id` FIRST, so a caller who somehow reached this module with a
 * foreign id reads nothing.
 *
 * ─── CONTRACT 16: WHAT A MODEL CANNOT DO ──────────────────────────────────
 * `ratifyIcpVersion` requires `ratifiedByUserId`. There is no default, no
 * system actor and no service principal — a caller with no user id cannot
 * ratify, and a model has no user id. The route above this supplies the id of a
 * principal that `enforceCompanyAccess` and `requireCapability` have both
 * already verified.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { validateCriteria } from './criteria';
import { withValidatedTargets } from './proposalTargets';
import {
  IcpContractError,
  type IcpCriterion, type IcpProposal, type IcpVersionRecord, type IcpVersionStatus,
  type RatifiedIcp,
} from './types';

const ICPS = 'prospect_icps';
const VERSIONS = 'prospect_icp_versions';

const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;
const errMsg = (e: unknown): string => (e as { message?: string } | null)?.message ?? 'unknown error';

/** A declaration, not an arrow — see the note in `criteria.ts`: only a
 *  declaration's `never` return participates in control-flow narrowing. */
function fail(message: string, code: string): never {
  throw new IcpContractError(message, code);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirrors `prospect_icps_key_slug` exactly. Divergence would be a 23514. */
const ICP_KEY = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

function assertTenant(organizationId: string): void {
  if (!UUID.test(String(organizationId ?? '').trim())) {
    fail('organizationId must be a uuid — an ICP is never tenant-less', 'tenant_required');
  }
}

/** Translate the SQLSTATEs the schema deliberately raises into stated errors. */
function translate(error: unknown, context: string): never {
  const code = errCode(error);
  if (code === '23503') {
    fail(`${context}: the ICP does not belong to this tenant — cross-tenant reference refused by the database`, 'cross_tenant_reference');
  }
  if (code === '23514') {
    fail(`${context}: ${errMsg(error)}`, 'invariant_violation');
  }
  fail(`${context} (${code ?? 'no code'}): ${errMsg(error)}`, code ?? 'write_failed');
}

// ── Row mapping ─────────────────────────────────────────────────────────────
const VERSION_COLUMNS =
  'id, organization_id, icp_id, version, status, criteria, proposal, proposed_by_model, '
  + 'ratified_at, ratified_by, superseded_at, superseded_by_version, created_at';

/**
 * Rows from a `select`, as records.
 *
 * The client types `data` as a union that includes `GenericStringError[]`, so a
 * direct cast is rejected as non-overlapping. Narrowing with `Array.isArray`
 * first is both accepted and safer: a non-array `data` becomes no rows rather
 * than an array-shaped lie.
 */
function asRows(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

function toVersionRecord(row: Record<string, unknown>): IcpVersionRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    icpId: String(row.icp_id),
    version: Number(row.version),
    status: row.status as IcpVersionStatus,
    // Re-validated on the way OUT as well as in. A row could predate a
    // tightening of `criteria.ts`, and a criterion that is no longer
    // expressible must not be silently evaluated under its old meaning.
    criteria: validateCriteria(Array.isArray(row.criteria) ? row.criteria : []),
    proposal: (row.proposal ?? {}) as IcpProposal,
    proposedByModel: (row.proposed_by_model as string | null) ?? null,
    ratifiedAt: (row.ratified_at as string | null) ?? null,
    ratifiedBy: (row.ratified_by as string | null) ?? null,
    supersededAt: (row.superseded_at as string | null) ?? null,
    supersededByVersion: row.superseded_by_version === null || row.superseded_by_version === undefined
      ? null : Number(row.superseded_by_version),
    createdAt: String(row.created_at),
  };
}

// ── The ICP object ──────────────────────────────────────────────────────────
export interface EnsureIcpResult { icpId: string; outcome: 'created' | 'already_present' }

/**
 * Resolve the tenant's ICP by key, creating it if absent.
 *
 * INSERT first, catch `23505`, then re-resolve. Not SELECT-then-INSERT: two
 * concurrent callers would both see nothing and both insert, and one would fail
 * with an unhandled error instead of converging on the row that exists.
 */
export async function ensureIcp(
  organizationId: string, icpKey: string, name?: string | null,
): Promise<EnsureIcpResult> {
  assertTenant(organizationId);
  const key = String(icpKey ?? '').trim().toLowerCase();
  if (!ICP_KEY.test(key) || key.length > 64) {
    fail(`icpKey '${icpKey}' must be a lower-case slug of at most 64 characters`, 'icp_key_invalid');
  }

  const insert = await ownedDbTable(ICPS)
    .insert({ organization_id: organizationId, icp_key: key, name: name?.trim() || null })
    .select('id').single();

  if (!insert.error) return { icpId: String((insert.data as { id: string }).id), outcome: 'created' };
  if (errCode(insert.error) !== '23505') translate(insert.error, 'ICP create failed');

  const existing = await resolveIcpByKey(organizationId, key);
  if (!existing) {
    fail('the ICP insert collided on (organization_id, icp_key) but the winning row could not be resolved', 'collision_unresolved');
  }
  return { icpId: existing, outcome: 'already_present' };
}

/** Mirrors `uq_prospect_icps_org_key`. Tenant filter first, always. */
export async function resolveIcpByKey(organizationId: string, icpKey: string): Promise<string | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(ICPS)
    .select('id')
    .eq('organization_id', organizationId)
    .eq('icp_key', String(icpKey ?? '').trim().toLowerCase())
    .limit(1);
  if (res.error) translate(res.error, 'ICP lookup failed');
  const rows = (res.data ?? []) as Array<{ id: string }>;
  return rows.length ? String(rows[0].id) : null;
}

// ── Versions ────────────────────────────────────────────────────────────────
export interface CreateVersionInput {
  organizationId: string;
  icpId: string;
  criteria: unknown;
  /** `draft` (still being written) or `proposed` (put forward for a decision). */
  status?: Extract<IcpVersionStatus, 'draft' | 'proposed'>;
  proposal?: IcpProposal;
  /** The model that produced the proposal, when one did. NEVER a ratifier. */
  proposedByModel?: string | null;
  /** Explicit version number. Omit to take the next one. */
  version?: number;
}

export interface CreateVersionResult { versionId: string; version: number; outcome: 'created' | 'already_present' }

/**
 * The next version number for an ICP. A HINT, not a guard — see the header.
 */
export async function nextVersionNumber(organizationId: string, icpId: string): Promise<number> {
  assertTenant(organizationId);
  const res = await ownedDbTable(VERSIONS)
    .select('version')
    .eq('organization_id', organizationId)
    .eq('icp_id', icpId)
    .order('version', { ascending: false })
    .limit(1);
  if (res.error) translate(res.error, 'version lookup failed');
  const rows = (res.data ?? []) as Array<{ version: number }>;
  return rows.length ? Number(rows[0].version) + 1 : 1;
}

/**
 * Create a DRAFT or PROPOSED version. This is the AI's entire reach into the
 * model: it may propose, and nothing else (contract 16). The row it writes is
 * not an input to scoring, and the CHECK constraint
 * `prospect_icp_versions_ratification_coherent` refuses any attempt to attach a
 * ratifier to it.
 */
export async function createIcpVersion(input: CreateVersionInput): Promise<CreateVersionResult> {
  assertTenant(input.organizationId);
  if (!UUID.test(String(input.icpId ?? '').trim())) fail('icpId must be a uuid', 'icp_id_invalid');

  const status = input.status ?? 'draft';
  if (status !== 'draft' && status !== 'proposed') {
    fail(
      `a version is created as 'draft' or 'proposed' — '${String(status)}' would bypass ratification`,
      'status_not_creatable',
    );
  }

  // Contract 17 is enforced BEFORE the write, so an unexpressible criterion
  // never reaches storage and a caller learns exactly which one was refused.
  const criteria: IcpCriterion[] = validateCriteria(input.criteria);

  // ICP-SELECTION-CONTRACT-001 §12/§13, enforced on the SAME terms and in the
  // same place: refused before the write, normalised for byte-identical
  // storage, never repaired. `withValidatedTargets` reads only `proposal` and
  // returns only `proposal` — the ranked shortlist has no route into `criteria`,
  // which is what §10 requires. It is additive: a proposal that names no
  // targets comes back unchanged, so pre-contract shapes still store as before.
  const proposal: IcpProposal = withValidatedTargets(input.proposal);

  const version = input.version ?? await nextVersionNumber(input.organizationId, input.icpId);
  if (!Number.isInteger(version) || version < 1) fail('version must be a positive integer', 'version_invalid');

  const insert = await ownedDbTable(VERSIONS).insert({
    organization_id: input.organizationId,
    icp_id: input.icpId,
    version,
    status,
    criteria,
    proposal,
    proposed_by_model: input.proposedByModel?.trim() || null,
  }).select('id').single();

  if (!insert.error) {
    return { versionId: String((insert.data as { id: string }).id), version, outcome: 'created' };
  }
  if (errCode(insert.error) !== '23505') translate(insert.error, 'version create failed');

  // 23505 on (organization_id, icp_id, version) — a concurrent proposer took
  // this number. Report it rather than silently renumbering: the caller asked
  // for a specific version, or computed one from a hint that is now stale.
  const existing = await getIcpVersion(input.organizationId, input.icpId, version);
  if (!existing) {
    fail('the version insert collided but the winning row could not be resolved', 'collision_unresolved');
  }
  return { versionId: existing.id, version, outcome: 'already_present' };
}

export async function getIcpVersion(
  organizationId: string, icpId: string, version: number,
): Promise<IcpVersionRecord | null> {
  assertTenant(organizationId);
  const res = await ownedDbTable(VERSIONS)
    .select(VERSION_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('icp_id', icpId)
    .eq('version', version)
    .limit(1);
  if (res.error) translate(res.error, 'version read failed');
  const rows = asRows(res.data);
  return rows.length ? toVersionRecord(rows[0]) : null;
}

/**
 * Every version of one ICP, newest first. Read-only.
 *
 * A2 needs enumeration because the reviewer has to see WHICH version they are
 * reviewing, and `getIcpVersion` can only answer about a version whose number
 * the caller already knows. Nothing here interprets the list: it does not
 * nominate a "current" proposal, because no such concept exists in the model —
 * exactly one version may be `ratified`, and any number may be `proposed`.
 * Choosing between several proposals is a human act, so the list is returned
 * as it is and the caller shows the ambiguity rather than resolving it.
 */
export async function listIcpVersions(
  organizationId: string, icpId: string,
): Promise<IcpVersionRecord[]> {
  assertTenant(organizationId);
  if (!UUID.test(String(icpId ?? '').trim())) fail('icpId must be a uuid', 'icp_id_invalid');
  const res = await ownedDbTable(VERSIONS)
    .select(VERSION_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('icp_id', icpId)
    .order('version', { ascending: false });
  if (res.error) translate(res.error, 'version list read failed');
  return asRows(res.data).map(toVersionRecord);
}

// ── Ratification (contract 16) ──────────────────────────────────────────────
export interface RatifyInput {
  organizationId: string;
  icpId: string;
  version: number;
  /**
   * The id of the HUMAN ratifying. Required, with no default: a model has no
   * user id, so requiring one is what makes "an AI may never ratify" a property
   * rather than a promise. The route supplies the principal that
   * `enforceCompanyAccess` and `requireCapability` both already verified.
   */
  ratifiedByUserId: string;
  /** Deterministic ratification instant, supplied by the caller. */
  ratifiedAt: string;
}

export interface RatifyResult {
  versionId: string;
  version: number;
  supersededVersion: number | null;
}

/**
 * Promote a draft/proposed version to RATIFIED, superseding whichever version
 * currently holds that status.
 *
 * ─── WHY THIS IS TWO STATEMENTS, AND WHY THAT IS SAFE ─────────────────────
 * The partial unique index permits one ratified version, so the incumbent must
 * be superseded BEFORE the successor is ratified. PostgREST cannot wrap two
 * statements in one transaction, so there is a window in which the tenant has
 * ZERO ratified versions.
 *
 * That window is safe BY CONTRACT 18, and only by it: no ratified ICP means the
 * evaluator emits NO contribution, so a caller scoring in that instant abstains
 * rather than scoring against a half-applied profile. The failure mode is a
 * missing dimension, never a wrong one, and the operator simply ratifies again.
 * A database function would close the window; it is not worth a second
 * privileged write surface for a degradation that is already fail-safe.
 *
 * Concurrency: two ratifiers racing both supersede (the second is a no-op) and
 * both attempt the promotion; the index refuses the loser with `23505`, which
 * is surfaced as `already_ratified` rather than retried. Ratification is a
 * human decision — retrying one automatically would ratify a version the second
 * person did not choose.
 */
export async function ratifyIcpVersion(input: RatifyInput): Promise<RatifyResult> {
  assertTenant(input.organizationId);
  if (!input.ratifiedByUserId || !String(input.ratifiedByUserId).trim()) {
    fail(
      'ratifiedByUserId is required — ratification is a human act and an AI model has no user id',
      'ratifier_required',
    );
  }
  if (!input.ratifiedAt) fail('ratifiedAt is required', 'ratified_at_required');

  const target = await getIcpVersion(input.organizationId, input.icpId, input.version);
  if (!target) fail(`version ${input.version} of this ICP does not exist in this tenant`, 'version_not_found');

  if (target.status === 'ratified') {
    fail(`version ${input.version} is already ratified`, 'already_ratified');
  }
  if (target.status === 'superseded') {
    fail(
      `version ${input.version} is superseded and immutable — ratify a NEW version instead`,
      'version_superseded',
    );
  }

  // Step 1: retire the incumbent. Its content is untouched; the trigger permits
  // exactly this transition and nothing else.
  const incumbent = await getRatifiedVersionRow(input.organizationId, input.icpId);
  if (incumbent && incumbent.version !== input.version) {
    const retire = await ownedDbTable(VERSIONS)
      .update({
        status: 'superseded',
        superseded_at: input.ratifiedAt,
        superseded_by_version: input.version,
        updated_at: input.ratifiedAt,
      })
      .eq('organization_id', input.organizationId)
      .eq('icp_id', input.icpId)
      .eq('version', incumbent.version)
      .eq('status', 'ratified');          // lost race ⇒ zero rows, not an error
    if (retire.error) translate(retire.error, 'superseding the incumbent version failed');
  }

  // Step 2: promote. `.eq('status', target.status)` makes this a compare-and-set
  // against the status we read, so a concurrent writer that moved the row out of
  // draft/proposed updates zero rows rather than being overwritten.
  const promote = await ownedDbTable(VERSIONS)
    .update({
      status: 'ratified',
      ratified_at: input.ratifiedAt,
      ratified_by: input.ratifiedByUserId,
      updated_at: input.ratifiedAt,
    })
    .eq('organization_id', input.organizationId)
    .eq('icp_id', input.icpId)
    .eq('version', input.version)
    .eq('status', target.status)
    .select('id');

  if (promote.error) {
    if (errCode(promote.error) === '23505') {
      fail(
        'another version was ratified concurrently — re-read the ICP and ratify again if that is still your intent',
        'concurrent_ratification',
      );
    }
    translate(promote.error, 'ratification failed');
  }

  const promoted = (promote.data ?? []) as Array<{ id: string }>;
  if (promoted.length === 0) {
    fail(
      `version ${input.version} was no longer '${target.status}' when ratification ran — re-read and retry`,
      'ratification_raced',
    );
  }

  return {
    versionId: String(promoted[0].id),
    version: input.version,
    supersededVersion: incumbent && incumbent.version !== input.version ? incumbent.version : null,
  };
}

async function getRatifiedVersionRow(
  organizationId: string, icpId: string,
): Promise<IcpVersionRecord | null> {
  const res = await ownedDbTable(VERSIONS)
    .select(VERSION_COLUMNS)
    .eq('organization_id', organizationId)     // TENANT FIRST, always
    .eq('icp_id', icpId)
    .eq('status', 'ratified')
    .limit(1);
  if (res.error) translate(res.error, 'ratified version read failed');
  const rows = asRows(res.data);
  return rows.length ? toVersionRecord(rows[0]) : null;
}

/**
 * THE EVALUATOR'S READ. The only function that produces a `RatifiedIcp`, and it
 * returns `null` — never a fabricated default — when the tenant has not ratified
 * anything. Contract 18 begins here: `null` in, no contribution out.
 */
export async function getRatifiedIcp(
  organizationId: string, icpKey: string,
): Promise<RatifiedIcp | null> {
  assertTenant(organizationId);
  const icpId = await resolveIcpByKey(organizationId, icpKey);
  if (!icpId) return null;

  const row = await getRatifiedVersionRow(organizationId, icpId);
  if (!row || row.ratifiedAt === null || row.ratifiedBy === null) return null;

  return {
    organizationId,
    icpId,
    icpKey: String(icpKey).trim().toLowerCase(),
    version: row.version,
    criteria: row.criteria,
    ratifiedAt: row.ratifiedAt,
    ratifiedBy: row.ratifiedBy,
  };
}
