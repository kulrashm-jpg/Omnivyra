/**
 * PI-LDB — the versioned store for tenant mapping decisions.
 *
 * A tenant who has once told us that their `Designation` column means
 * `job_title` must never be asked again. This module is where that answer
 * lives, and it is the only writer of `source_mapping_profiles` and
 * `source_mapping_profile_entries`.
 *
 * ─── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 * Not a mapping engine. It stores and returns decisions; it never scores,
 * proposes or ranks. `mappingEngine.ts` remains the only thing that decides
 * what a column means, and nothing here can influence that beyond handing back
 * what a human already approved.
 *
 * Not a second ingestion path. Nothing here writes a prospect, an account or
 * an assertion.
 *
 * ─── VERSIONED, NEVER EDITED ───────────────────────────────────────────────
 * An approval inserts a NEW version and supersedes the previous one, so the
 * mapping that was in force for any past import stays recoverable. That is
 * also why `source_assertions.mapping_profile_id` can cite the exact version
 * that decided a field: the row it names never changes afterwards.
 *
 * ─── WHY THE WRITE IS STAGED, AND WHAT IT COSTS ────────────────────────────
 * There is no transaction available here. The Supabase client issues one
 * statement per call, so a four-statement approval cannot be made atomic from
 * this side. Rather than pretend otherwise, the write is ORDERED so that every
 * intermediate state is either correct or invisible:
 *
 *   1. insert the new profile row as `superseded`  — complete but UNREADABLE,
 *      because every read path selects `status = 'active'`
 *   2. insert its entries                          — still unreadable
 *   3. supersede the previous active row
 *   4. activate the new row
 *
 * A failure at 1 or 2 leaves a row nothing reads, and the next approval simply
 * takes the next version number. A failure between 3 and 4 leaves the tenant
 * with NO active profile, which makes the next import re-propose its mapping.
 * That is the one degradation this design accepts, and it is chosen
 * deliberately: the alternative orderings fail towards a profile whose entries
 * are half-written, and a mapping that is quietly wrong is far worse for a
 * tenant than a mapping they are asked to confirm again.
 *
 * The database does the rest of the work. `uq_source_mapping_profiles_active`
 * makes "one active profile per file shape" an invariant rather than a
 * convention, and `uq_source_mapping_profiles_version` is what resolves two
 * concurrent approvals — one of them loses on the unique index and retries,
 * instead of both believing they won.
 *
 * ─── THE TENANT IS PART OF EVERY KEY ───────────────────────────────────────
 * Every function takes `organizationId` and every query filters on it,
 * including the ones that already filter on a profile id. The composite
 * foreign key `smpe_profile_tenant_fk` means a cross-tenant entry is refused
 * by the database too, so a mistake here is caught rather than stored.
 *
 * ─── PLATFORM (VENDOR) PROFILES: step E, 2026-11-11 ────────────────────────
 * A data vendor's mapping (scope 'platform', organization_id NULL) is approved
 * ONCE by a Super Admin and applies to every company. Rules (virality-e9):
 *   - Tenants never write one: `saveProfileVersion` refuses a vendor source and
 *     the `platform_approved` method; only `savePlatformProfileVersion` writes
 *     platform rows, and only its Super Admin route calls it.
 *   - READ precedence is tenant first, platform fallback. A vendor source reads
 *     the platform profile directly. A tenant upload (csv) reads the tenant's
 *     own profile for that file shape; if none exists, a platform profile with
 *     the SAME header-set fingerprint answers (an Apollo export uploaded as a
 *     csv is recognised as Apollo's shape). Two vendors claiming one shape is
 *     ambiguous, and answers nothing rather than guessing.
 *   - The answering profile carries `scope`, so provenance cites it in the
 *     right column (mapping_profile_id vs platform_mapping_profile_id).
 *   - Every platform query filters scope = 'platform' AND organization_id IS
 *     NULL; every tenant query filters scope = 'tenant' AND the tenant id.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { isCanonicalFieldKey, type CanonicalFieldKey } from './canonicalFieldRegistry';
import { normaliseHeader } from './mappingScorer';
import { platformVendorKey } from './platformVendorSources';
import {
  isTransformationName,
  type StoredMappingEntry,
  type StoredMappingProfile,
  type TransformationName,
} from './mappingTypes';

const PROFILES = 'source_mapping_profiles';
const ENTRIES = 'source_mapping_profile_entries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[a-f0-9]{64}$/;

/** Mirrors `smpe_mapping_method_valid`. */
export const MAPPING_METHODS = [
  'approved_profile_match',
  'high_confidence_suggestion',
  'tenant_confirmed',
  'tenant_override',
  // A Super Admin's approval of a PLATFORM (vendor) profile entry. Never a
  // tenant method: saveProfileVersion refuses it.
  'platform_approved',
] as const;
export type MappingMethod = (typeof MAPPING_METHODS)[number];

/** Mirrors `smpe_decision_valid`. */
export const MAPPING_DECISIONS = ['approved', 'rejected', 'ignored'] as const;
export type MappingDecision = (typeof MAPPING_DECISIONS)[number];

/** Identifies one file SHAPE for one tenant. Never a file name. */
export interface MappingProfileKey {
  organizationId: string;
  /** Free-text provider key, matching `source_records.provider`. */
  source: string;
  /** `fingerprintSchema(headers)` — sha256 over the normalised header set. */
  schemaFingerprint: string;
}

export interface SaveProfileEntry {
  /** The header exactly as the source wrote it. */
  sourceField: string;
  /** `null` only when the decision is `ignored`. */
  target: CanonicalFieldKey | null;
  transformation: TransformationName;
  decision: MappingDecision;
  mappingMethod: MappingMethod;
  /**
   * The deterministic score at the time of approval, 0..1. Optional because
   * the approval route does not currently forward it; stored when supplied, so
   * an audit can see how strong the evidence was when a human agreed.
   */
  score?: number | null;
  /** The scorer's evidence list, verbatim. */
  evidence?: readonly string[];
}

export interface SaveProfileArgs extends MappingProfileKey {
  /** Every header in the file, in file order — not only the decided ones. */
  headers: readonly string[];
  /** The VERIFIED actor. Never read from a request body. */
  approvedBy: string;
  entries: readonly SaveProfileEntry[];
}

export interface SavedProfileVersion {
  profileId: string;
  version: number;
}

/**
 * Everything the engine needs about a tenant's past decisions for one file
 * shape, from a single pair of reads.
 */
export interface MappingProfileContext {
  profile: StoredMappingProfile | null;
  /**
   * Destinations the tenant has explicitly refused, keyed by the header as it
   * appears in THIS file. The engine looks these up by raw header
   * (`input.rejectedTargets?.[header]`) while the store matches on the
   * normalised form, so the translation happens here — in the module that owns
   * the normalised column — rather than in each caller.
   */
  rejectedTargets: Record<string, CanonicalFieldKey[]>;
  /**
   * WHOSE refusals those are: the answering profile's id and scope, or null when
   * there are none. A refusal from a platform (vendor) profile came from a
   * Super Admin, on a profile the tenant cannot see, so the UI must be able to
   * say so rather than present it as the tenant's own rule.
   */
  rejectionSource: { profileId: string; scope: 'tenant' | 'platform' } | null;
}

/** A platform (vendor) profile is keyed by shape alone: no tenant. */
export interface PlatformProfileKey {
  /** A platform vendor source (see platformVendorSources); stored as its vendor key. */
  source: string;
  schemaFingerprint: string;
}

export interface SavePlatformProfileArgs extends PlatformProfileKey {
  headers: readonly string[];
  /** The VERIFIED Super Admin. Never read from a request body. */
  approvedBy: string;
  entries: readonly SaveProfileEntry[];
}

/** Which rows a query may touch. Internal; every query goes through `scoped`. */
type Target = { scope: 'tenant'; organizationId: string } | { scope: 'platform' };

export class MappingProfileStoreError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid_argument' | 'conflict' | 'write_failed' | 'read_failed',
  ) {
    super(message);
    this.name = 'MappingProfileStoreError';
  }
}

const invalid = (message: string) => new MappingProfileStoreError(message, 'invalid_argument');

/* ── reading ──────────────────────────────────────────────────────────────── */

interface ProfileRow {
  id: string;
  version: number;
  schema_fingerprint: string;
  headers: unknown;
  created_at: string;
}

interface EntryRow {
  source_field: string;
  source_field_normalized: string;
  target_field: string | null;
  decision: string;
  transformation: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

function assertKey(key: MappingProfileKey): void {
  if (!UUID.test(key.organizationId ?? '')) throw invalid('organizationId must be a uuid');
  if (typeof key.source !== 'string' || key.source.trim() === '') {
    throw invalid('source must be a non-empty string');
  }
  if (!FINGERPRINT.test(key.schemaFingerprint ?? '')) {
    throw invalid('schemaFingerprint must be a 64-character sha256 hex digest');
  }
}

function assertPlatformKey(key: PlatformProfileKey): string {
  const vendor = platformVendorKey(key.source);
  if (!vendor) throw invalid(`'${String(key.source)}' is not a platform vendor source`);
  if (!FINGERPRINT.test(key.schemaFingerprint ?? '')) {
    throw invalid('schemaFingerprint must be a 64-character sha256 hex digest');
  }
  return vendor;
}

/** The query-builder surface `scoped` needs. */
interface Filterable<Q> {
  eq(column: string, value: unknown): Q;
  is(column: string, value: null): Q;
}

/**
 * Narrows a query to one scope. Tenant: scope 'tenant' AND this tenant.
 * Platform: scope 'platform' AND organization_id IS NULL. Both filters every
 * time - the scope column alone or the tenant column alone is not enough.
 */
function scoped<Q extends Filterable<Q>>(q: Q, target: Target): Q {
  return target.scope === 'tenant'
    ? q.eq('scope', 'tenant').eq('organization_id', target.organizationId)
    : q.eq('scope', 'platform').is('organization_id', null);
}

async function fetchEntries(target: Target, profileId: string): Promise<EntryRow[]> {
  const { data: entryRows, error: entryError } = await scoped(
    ownedDbTable(ENTRIES).select(
      'source_field, source_field_normalized, target_field, decision, transformation, approved_by, approved_at',
    ),
    target,
  ).eq('profile_id', profileId);

  if (entryError) {
    throw new MappingProfileStoreError(
      `${ENTRIES} read failed: ${entryError.message}`,
      'read_failed',
    );
  }
  return (entryRows ?? []) as unknown as EntryRow[];
}

async function fetchActive(
  target: Target,
  source: string,
  schemaFingerprint: string,
): Promise<{ row: ProfileRow; entries: EntryRow[] } | null> {
  const { data: row, error } = await scoped(
    ownedDbTable(PROFILES).select('id, version, schema_fingerprint, headers, created_at'),
    target,
  )
    .eq('source', source)
    .eq('schema_fingerprint', schemaFingerprint)
    .eq('status', 'active')
    // `uq_source_mapping_profiles_active` guarantees at most one. `maybeSingle`
    // rather than `single` because "no profile yet" is the ordinary case for a
    // tenant's first import, not an error.
    .maybeSingle();

  if (error) {
    throw new MappingProfileStoreError(`${PROFILES} read failed: ${error.message}`, 'read_failed');
  }
  if (!row) return null;

  const profile = row as unknown as ProfileRow;
  return { row: profile, entries: await fetchEntries(target, profile.id) };
}

/**
 * Below this many headers a shape is too common to identify a vendor: a
 * `name,email,company` file would collide with half the CSVs anywhere. A
 * platform profile narrower than this never answers a tenant upload by shape
 * (a vendor source still reads it directly).
 */
export const MIN_PLATFORM_FALLBACK_HEADERS = 8;

/**
 * The platform profile for a FILE SHAPE, whichever vendor it belongs to: the
 * fallback for a tenant upload with no tenant profile.
 *
 * FAIL-SAFE DIRECTION: this matcher must UNDER-match, because a match applies a
 * vendor's mapping semantics to a tenant's data. So: the fingerprint is the
 * sha256 of the COMPLETE normalised header set (fingerprintSchema), matched
 * EXACTLY - never fuzzy, never a subset; the shape must be at least
 * MIN_PLATFORM_FALLBACK_HEADERS wide; exactly one active match answers, and
 * none or several (two vendors claiming one header set) answer nothing.
 * The vendor-KEY matcher (platformVendorSources) over-matches on purpose; its
 * consequence is a refusal. Do not align the two (virality-05, 2026-11-11).
 *
 * "Nothing" downstream: the proposal route reports profileRead 'none', the
 * engine proposes a mapping, and the tenant confirms each column in the import
 * wizard. Data is never ingested unmapped because the fallback declined.
 */
async function fetchActivePlatformByShape(
  schemaFingerprint: string,
): Promise<{ row: ProfileRow; entries: EntryRow[] } | null> {
  const platform: Target = { scope: 'platform' };
  const { data, error } = await scoped(
    ownedDbTable(PROFILES).select('id, version, schema_fingerprint, headers, created_at'),
    platform,
  )
    .eq('schema_fingerprint', schemaFingerprint)
    .eq('status', 'active')
    .limit(2);

  // A null error is not an answer: only an array body is.
  if (error || !Array.isArray(data)) {
    throw new MappingProfileStoreError(
      `${PROFILES} read failed: ${error?.message ?? 'no rows array returned'}`,
      'read_failed',
    );
  }
  const rows = data as unknown as ProfileRow[];
  if (rows.length !== 1) return null;
  const width = Array.isArray(rows[0].headers) ? rows[0].headers.length : 0;
  if (width < MIN_PLATFORM_FALLBACK_HEADERS) return null;
  return { row: rows[0], entries: await fetchEntries(platform, rows[0].id) };
}

/**
 * Tenant first, platform fallback (see the header). Returns the answering
 * profile's rows and its scope, or null.
 */
async function resolveActive(
  key: MappingProfileKey,
): Promise<{ row: ProfileRow; entries: EntryRow[]; scope: 'tenant' | 'platform' } | null> {
  const vendor = platformVendorKey(key.source);
  if (vendor) {
    const found = await fetchActive({ scope: 'platform' }, vendor, key.schemaFingerprint);
    return found ? { ...found, scope: 'platform' } : null;
  }
  const own = await fetchActive(
    { scope: 'tenant', organizationId: key.organizationId }, key.source, key.schemaFingerprint,
  );
  if (own) return { ...own, scope: 'tenant' };
  const shared = await fetchActivePlatformByShape(key.schemaFingerprint);
  return shared ? { ...shared, scope: 'platform' } : null;
}

/**
 * Turns stored rows into the engine's shape.
 *
 * Only `approved` and `ignored` entries become profile entries. A `rejected`
 * row is NOT a decision about where to write — it is a refusal of one
 * candidate, and a column may carry several. Letting rejections through here
 * would turn "not job title" into "write to job title".
 */
function toStoredProfile(
  row: ProfileRow,
  entries: readonly EntryRow[],
  scope: 'tenant' | 'platform',
): StoredMappingProfile {
  const mapped: StoredMappingEntry[] = [];

  for (const entry of entries) {
    if (entry.decision !== 'approved' && entry.decision !== 'ignored') continue;

    // The registry is application-owned and `target_field` is deliberately not
    // CHECK-constrained to a value list, so a target stored before a field was
    // renamed or removed can still be read back. Such a row is dropped rather
    // than returned: the write boundary would refuse it anyway, and a mapping
    // the tenant cannot act on is better absent than displayed as live.
    const target = entry.target_field;
    if (entry.decision === 'approved' && (target === null || !isCanonicalFieldKey(target))) continue;
    if (entry.decision === 'ignored' && target !== null) continue;

    mapped.push({
      sourceField: entry.source_field,
      target: entry.decision === 'ignored' ? null : (target as CanonicalFieldKey),
      // `transformation` is NULL for identity in the database and a named
      // member of the closed set here. Anything unrecognised becomes 'none',
      // because applying an unknown transformation is not an option and
      // refusing a whole profile over one field would be worse.
      transformation: isTransformationName(entry.transformation) ? entry.transformation : 'none',
      approvedBy: entry.approved_by,
      // `approved_at` is nullable in the database (only tenant decisions are
      // required to carry it) but the engine quotes it back to the tenant —
      // "Reusing the mapping you approved on <date>" — so it must be a real
      // timestamp. The profile's own creation is the correct fallback: it is
      // when this decision set was recorded, which is a true statement about
      // when the tenant approved it rather than an invented one.
      approvedAt: entry.approved_at ?? row.created_at,
    });
  }

  return {
    profileId: row.id,
    scope,
    version: row.version,
    sourceSchemaFingerprint: row.schema_fingerprint,
    headers: Array.isArray(row.headers)
      ? row.headers.filter((h): h is string => typeof h === 'string')
      : [],
    entries: mapped,
  };
}

/**
 * The tenant's active mapping for this file shape, or `null` when they have
 * not approved one.
 *
 * `null` is an ordinary answer, and callers must render it as "no saved
 * mapping yet" rather than as a failure.
 */
export async function loadActiveProfile(
  key: MappingProfileKey,
): Promise<StoredMappingProfile | null> {
  assertKey(key);
  const found = await resolveActive(key);
  return found ? toStoredProfile(found.row, found.entries, found.scope) : null;
}

/**
 * The profile and the tenant's past refusals together, from one pair of reads.
 *
 * Prefer this over calling `loadActiveProfile` and then asking separately: the
 * refusals come from the same rows, and two round trips could straddle an
 * approval and return a profile from one version with refusals from another.
 */
export async function loadProfileContext(
  key: MappingProfileKey,
  headers: readonly string[],
): Promise<MappingProfileContext> {
  assertKey(key);
  const found = await resolveActive(key);
  if (!found) return { profile: null, rejectedTargets: {}, rejectionSource: null };
  // Refusals come from the ANSWERING profile only: a tenant's own, or (when a
  // platform profile answers) the Super Admin's refusals for that vendor shape.

  const rejectedByNormalised = new Map<string, CanonicalFieldKey[]>();
  for (const entry of found.entries) {
    if (entry.decision !== 'rejected') continue;
    const target = entry.target_field;
    if (target === null || !isCanonicalFieldKey(target)) continue;
    const bucket = rejectedByNormalised.get(entry.source_field_normalized) ?? [];
    if (!bucket.includes(target)) bucket.push(target);
    rejectedByNormalised.set(entry.source_field_normalized, bucket);
  }

  // Keyed by THIS file's header spelling. A profile matches on the normalised
  // header set, so the same column can arrive as `Job Title` today and
  // `job title` tomorrow; keying the result by the stored spelling would make
  // the engine's lookup miss exactly when the tenant's refusal matters most.
  const rejectedTargets: Record<string, CanonicalFieldKey[]> = {};
  for (const header of headers) {
    const refusals = rejectedByNormalised.get(normaliseHeader(header));
    if (refusals && refusals.length) rejectedTargets[header] = [...refusals];
  }

  return {
    profile: toStoredProfile(found.row, found.entries, found.scope),
    rejectedTargets,
    rejectionSource: Object.keys(rejectedTargets).length
      ? { profileId: found.row.id, scope: found.scope }
      : null,
  };
}

/* ── writing ──────────────────────────────────────────────────────────────── */

/**
 * Validates an approval before any statement is issued.
 *
 * Every rule here is also a database constraint. It is spelled twice on
 * purpose: a database refusal arrives as `23505` or a constraint name, which
 * is unusable in a tenant-facing message, and a caller that cannot tell
 * "duplicate column" from "unknown destination" cannot tell the tenant what to
 * fix. The database remains the guarantee; this is the explanation.
 */
type EntryArgs = Pick<SaveProfileArgs, 'headers' | 'approvedBy' | 'entries'>;

/** Tenant entries may use any method but platform_approved; platform entries only platform_approved. */
const TENANT_METHODS = MAPPING_METHODS.filter((m) => m !== 'platform_approved');
const PLATFORM_METHODS: readonly MappingMethod[] = ['platform_approved'];

function assertEntries(args: EntryArgs, allowedMethods: readonly MappingMethod[]): void {
  if (!UUID.test(args.approvedBy ?? '')) throw invalid('approvedBy must be a uuid');
  if (!Array.isArray(args.headers) || args.headers.length === 0) {
    throw invalid('headers must be a non-empty array');
  }
  if (!args.headers.every((h) => typeof h === 'string' && h.trim() !== '')) {
    throw invalid('every header must be a non-empty string');
  }
  if (!Array.isArray(args.entries) || args.entries.length === 0) {
    // A profile with no decisions would be an active row that answers nothing,
    // and it would still supersede a previous version that DID answer.
    throw invalid(
      'entries must be a non-empty array — an empty approval would erase a working profile',
    );
  }

  const knownHeaders = new Set(args.headers);
  const approved = new Set<string>();
  const ignored = new Set<string>();
  const rejected = new Set<string>();

  for (const entry of args.entries) {
    const { sourceField, target, decision, mappingMethod, transformation } = entry;

    if (typeof sourceField !== 'string' || !knownHeaders.has(sourceField)) {
      throw invalid(
        `entry.sourceField '${String(sourceField)}' is not one of the submitted headers`,
      );
    }
    if (!(MAPPING_DECISIONS as readonly string[]).includes(decision)) {
      throw invalid(`entry.decision '${String(decision)}' is not a recognised decision`);
    }
    if (!(MAPPING_METHODS as readonly string[]).includes(mappingMethod)) {
      throw invalid(`entry.mappingMethod '${String(mappingMethod)}' is not a recognised method`);
    }
    if (!(allowedMethods as readonly string[]).includes(mappingMethod)) {
      throw invalid(
        mappingMethod === 'platform_approved'
          ? `'platform_approved' is a Super Admin method for vendor profiles; a tenant approval cannot use it`
          : `a platform (vendor) profile entry must use 'platform_approved', not '${mappingMethod}'`,
      );
    }
    if (!isTransformationName(transformation)) {
      throw invalid(`entry.transformation '${String(transformation)}' is not a named transformation`);
    }

    // Mirrors `smpe_target_matches_decision`. An `ignored` row carrying a
    // target would read as an approval to anything that only checks for a
    // non-null target.
    if (decision === 'ignored') {
      if (target !== null) throw invalid(`'${sourceField}' is ignored, so it cannot name a target`);
    } else if (target === null || !isCanonicalFieldKey(target)) {
      throw invalid(`'${sourceField}' is ${decision}, so it must name a canonical destination`);
    }

    if (entry.score !== undefined && entry.score !== null) {
      if (
        typeof entry.score !== 'number' ||
        !Number.isFinite(entry.score) ||
        entry.score < 0 ||
        entry.score > 1
      ) {
        throw invalid(`entry.score for '${sourceField}' must be a number between 0 and 1`);
      }
    }

    const normalised = normaliseHeader(sourceField);
    if (!normalised) throw invalid(`'${sourceField}' normalises to an empty header`);

    const targetKey = `${normalised}\u0000${target ?? ''}`;
    if (decision === 'approved') {
      if (approved.has(normalised)) {
        throw invalid(`'${sourceField}' has more than one approved destination`);
      }
      approved.add(normalised);
    } else if (decision === 'ignored') {
      if (ignored.has(normalised)) throw invalid(`'${sourceField}' is ignored more than once`);
      ignored.add(normalised);
    } else {
      if (rejected.has(targetKey)) {
        throw invalid(`'${sourceField}' rejects '${String(target)}' more than once`);
      }
      rejected.add(targetKey);
    }
  }

  // Not a database constraint — the two partial unique indexes are independent,
  // so the database would accept both rows. It is still a contradiction, and
  // whichever one a reader honoured would be arbitrary.
  for (const field of approved) {
    if (ignored.has(field)) {
      throw invalid(`a column cannot be both approved and ignored (normalised: '${field}')`);
    }
  }
}

/** Highest version yet used for this shape, across every status. */
async function currentVersions(
  target: Target,
  source: string,
  schemaFingerprint: string,
): Promise<{ maxVersion: number; activeId: string | null }> {
  const { data, error } = await scoped(ownedDbTable(PROFILES).select('id, version, status'), target)
    .eq('source', source)
    .eq('schema_fingerprint', schemaFingerprint)
    .order('version', { ascending: false });

  // A null error is not an answer: numbering from a missing read would reuse a
  // version, so only an array body counts.
  if (error || !Array.isArray(data)) {
    throw new MappingProfileStoreError(
      `${PROFILES} version read failed: ${error?.message ?? 'no rows array returned'}`,
      'read_failed',
    );
  }

  const rows = data as unknown as Array<{ id: string; version: number; status: string }>;
  // Over every status, not just active: superseded rows hold the earlier
  // version numbers and the version index spans all of them, so numbering from
  // the active row alone would collide on the second approval after any
  // supersession.
  const maxVersion = rows.reduce((max, r) => (r.version > max ? r.version : max), 0);
  const activeId = rows.find((r) => r.status === 'active')?.id ?? null;
  return { maxVersion, activeId };
}

/** The tenant column value for a target: the tenant id, or NULL on platform rows. */
const orgOf = (target: Target): string | null => (target.scope === 'tenant' ? target.organizationId : null);

/**
 * The staged, versioned write shared by both scopes (see the header for the
 * ordering and the one accepted degradation). Callers have validated the key
 * and the entries for their scope.
 */
async function saveVersion(
  target: Target,
  source: string,
  schemaFingerprint: string,
  args: EntryArgs,
): Promise<SavedProfileVersion> {
  const approvedAt = new Date().toISOString();
  const organizationId = orgOf(target);

  // One retry, and exactly one. A `23505` on the version index means another
  // approval for the same shape landed between the read and the insert, and
  // taking the next number is the correct response. Retrying indefinitely
  // would turn a contended shape into a spin, so a second collision is
  // reported as the conflict it is.
  let inserted: { id: string; version: number } | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 2 && !inserted; attempt += 1) {
    const { maxVersion } = await currentVersions(target, source, schemaFingerprint);
    const version = maxVersion + 1;

    const { data, error } = await ownedDbTable(PROFILES)
      .insert({
        scope: target.scope,
        organization_id: organizationId,
        source,
        schema_fingerprint: schemaFingerprint,
        version,
        // STAGED: complete but unreadable. Every read path selects
        // `status = 'active'`, so nothing can observe this row - or its
        // entries - until the publish step below. The coherence CHECK requires
        // a timestamp for any non-active status.
        status: 'superseded',
        superseded_at: approvedAt,
        header_count: args.headers.length,
        headers: args.headers,
        created_by: args.approvedBy,
      })
      .select('id, version')
      .single();

    if (!error && data) {
      inserted = data as unknown as { id: string; version: number };
      break;
    }
    lastError = error?.message ?? 'unknown error';
    if (error?.code !== '23505') {
      throw new MappingProfileStoreError(`${PROFILES} insert failed: ${lastError}`, 'write_failed');
    }
  }

  if (!inserted) {
    throw new MappingProfileStoreError(
      `another approval for this source schema landed first; retry the approval (${String(lastError)})`,
      'conflict',
    );
  }

  const profileId = inserted.id;

  const entryRows = args.entries.map((entry) => ({
    scope: target.scope,
    organization_id: organizationId,
    profile_id: profileId,
    source_field: entry.sourceField,
    source_field_normalized: normaliseHeader(entry.sourceField),
    target_field: entry.target,
    decision: entry.decision,
    mapping_method: entry.mappingMethod,
    // NULL for identity, matching the column's documented meaning.
    transformation: entry.transformation === 'none' ? null : entry.transformation,
    score: entry.score ?? null,
    evidence: entry.evidence ? [...entry.evidence] : [],
    approved_by: args.approvedBy,
    // Written for every entry, not only the methods the CHECK requires it for.
    // A bulk-accepted suggestion was still accepted at a moment, and an audit
    // that can date some decisions and not others is harder to read than one
    // that dates them all.
    approved_at: approvedAt,
  }));

  const { error: entryError } = await ownedDbTable(ENTRIES).insert(entryRows);
  if (entryError) {
    // The staged profile row stays `superseded`, so nothing reads it; the next
    // approval takes the next version number. It is NOT deleted: service_role
    // holds no DELETE on these tables (deliberately narrow grants), so a delete
    // here could only ever fail - silently - and suggest a cleanup that never
    // happened (step E, 2026-11-11).
    throw new MappingProfileStoreError(
      `${ENTRIES} insert failed, approval not saved: ${entryError.message}`,
      'write_failed',
    );
  }

  // -- PUBLISH ----------------------------------------------------------------
  // Demote first. The active-profile unique index permits one active row per
  // shape, so promoting before demoting is refused by the index - this order is
  // forced by the constraint, not chosen.
  const { activeId } = await currentVersions(target, source, schemaFingerprint);
  if (activeId && activeId !== profileId) {
    const { error: demoteError } = await scoped(
      ownedDbTable(PROFILES).update({ status: 'superseded', superseded_at: approvedAt }),
      target,
    )
      .eq('id', activeId)
      .eq('status', 'active');
    if (demoteError) {
      throw new MappingProfileStoreError(
        `failed to supersede profile ${activeId}, approval not published: ${demoteError.message}`,
        'write_failed',
      );
    }
  }

  const { error: promoteError } = await scoped(
    ownedDbTable(PROFILES).update({ status: 'active', superseded_at: null }),
    target,
  ).eq('id', profileId);
  if (promoteError) {
    // The documented degradation: the previous version is superseded and the
    // new one is not yet active, so this shape has no active profile and the
    // next import re-proposes. Nobody is given a half-written mapping.
    throw new MappingProfileStoreError(
      `profile ${profileId} was saved but not activated; this source will be re-proposed on the next import: ${promoteError.message}`,
      'write_failed',
    );
  }

  return { profileId, version: inserted.version };
}

/**
 * Records a TENANT's approved mapping as a new version and makes it the active
 * one. Returns the id and version of the row that `source_assertions` should
 * cite.
 *
 * Refuses a platform vendor source: a vendor's mapping is approved once by a
 * Super Admin for every company (savePlatformProfileVersion), never per tenant.
 */
export async function saveProfileVersion(args: SaveProfileArgs): Promise<SavedProfileVersion> {
  assertKey(args);
  if (platformVendorKey(args.source)) {
    throw invalid(
      `'${args.source}' is a platform vendor source; its mapping is approved by a Super Admin for every company, not by a tenant`,
    );
  }
  assertEntries(args, TENANT_METHODS);
  return saveVersion(
    { scope: 'tenant', organizationId: args.organizationId }, args.source, args.schemaFingerprint, args,
  );
}

/**
 * Records a PLATFORM (vendor) mapping, approved by a Super Admin, as a new
 * version and makes it the active one for every company.
 *
 * The CALLER verifies that `approvedBy` is a Super Admin (GOV-H writer
 * validation); this store never trusts a body field for it. The source is
 * stored as its vendor key, so 'Apollo' and 'apollo.io' are one profile.
 */
export async function savePlatformProfileVersion(
  args: SavePlatformProfileArgs,
): Promise<SavedProfileVersion> {
  const vendor = assertPlatformKey(args);
  assertEntries(args, PLATFORM_METHODS);
  return saveVersion({ scope: 'platform' }, vendor, args.schemaFingerprint, args);
}

/** The active platform profile for a vendor shape, or null. Super Admin reads. */
export async function loadPlatformProfile(key: PlatformProfileKey): Promise<StoredMappingProfile | null> {
  const vendor = assertPlatformKey(key);
  const found = await fetchActive({ scope: 'platform' }, vendor, key.schemaFingerprint);
  return found ? toStoredProfile(found.row, found.entries, 'platform') : null;
}
