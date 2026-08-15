import { supabase } from '../db/supabaseClient';
import { compareExternalIdentityShadow, recordShadowObservation } from './prospectIdentity/externalIdentityShadow';
import { writeExternalIdentityClaims } from './prospectIdentity/externalIdentityDualWrite';
import { logger } from './logger';
import { ownedDbTable } from '../db/writeOwner';

export type IdentityExternalKeys = Record<string, unknown>;

export type IdentityResolutionInput = {
  companyId: string;
  email?: string | null;
  phone?: string | null;
  externalKeys?: IdentityExternalKeys | null;
};

export type IdentityResolutionResult = {
  unifiedPersonId: string;
  matchedBy: 'email' | 'phone' | 'external_keys' | 'created';
  created: boolean;
};

type UnifiedPersonRow = {
  id: string;
  company_id: string;
  primary_email: string | null;
  primary_phone: string | null;
  external_keys: IdentityExternalKeys | null;
};

/**
 * Exported for reuse by the W1 prospect-identity foundation
 * (backend/services/prospectIdentity/normalization.ts), so identity_claims are
 * normalized by the SAME rule this resolver already matches on. A second
 * implementation would drift, and a claim normalized differently from the spine
 * it points at is worse than no claim at all. Behaviour is unchanged.
 */
export function normalizeEmail(email?: string | null): string | null {
  const normalized = String(email ?? '').trim().toLowerCase();
  return normalized || null;
}

/** Exported for reuse by prospectIdentity/normalization.ts — see normalizeEmail. */
export function normalizePhone(phone?: string | null): string | null {
  const raw = String(phone ?? '').trim();
  if (!raw) return null;

  const normalized = raw.startsWith('+')
    ? `+${raw.slice(1).replace(/\D/g, '')}`
    : raw.replace(/\D/g, '');

  return normalized || null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanExternalKeys(value?: IdentityExternalKeys | null): IdentityExternalKeys {
  if (!isPlainObject(value)) return {};

  const entries: Array<[string, unknown]> = [];

  for (const [key, entry] of Object.entries(value)) {
    if (entry == null) continue;
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) entries.push([key, trimmed]);
      continue;
    }
    if (isPlainObject(entry)) {
      const cleaned = cleanExternalKeys(entry as IdentityExternalKeys);
      if (Object.keys(cleaned).length > 0) entries.push([key, cleaned]);
      continue;
    }
    entries.push([key, entry]);
  }

  return Object.fromEntries(entries);
}

function mergeExternalKeys(existing: IdentityExternalKeys | null | undefined, incoming: IdentityExternalKeys): IdentityExternalKeys {
  const output: IdentityExternalKeys = { ...(isPlainObject(existing) ? existing : {}) };

  for (const [key, value] of Object.entries(incoming)) {
    if (isPlainObject(output[key]) && isPlainObject(value)) {
      output[key] = mergeExternalKeys(output[key] as IdentityExternalKeys, value as IdentityExternalKeys);
    } else {
      output[key] = value;
    }
  }

  return output;
}

async function findPersonByEmail(companyId: string, email: string): Promise<UnifiedPersonRow | null> {
  const { data, error } = await ownedDbTable('unified_persons')
    .select('id, company_id, primary_email, primary_phone, external_keys')
    .eq('company_id', companyId)
    .eq('primary_email', email)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve unified person by email: ${error.message}`);
  }

  return (data as UnifiedPersonRow | null) ?? null;
}

async function findPersonByPhone(companyId: string, phone: string): Promise<UnifiedPersonRow | null> {
  const { data, error } = await ownedDbTable('unified_persons')
    .select('id, company_id, primary_email, primary_phone, external_keys')
    .eq('company_id', companyId)
    .eq('primary_phone', phone)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve unified person by phone: ${error.message}`);
  }

  return (data as UnifiedPersonRow | null) ?? null;
}

async function findPersonByExternalKeys(companyId: string, externalKeys: IdentityExternalKeys): Promise<UnifiedPersonRow | null> {
  if (Object.keys(externalKeys).length === 0) {
    return null;
  }

  const { data, error } = await ownedDbTable('unified_persons')
    .select('id, company_id, primary_email, primary_phone, external_keys')
    .eq('company_id', companyId)
    .contains('external_keys', externalKeys)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve unified person by external keys: ${error.message}`);
  }

  return (data as UnifiedPersonRow | null) ?? null;
}

/**
 * The deterministic match sequence: email, then phone, then provider keys.
 *
 * Extracted so the create path's conflict recovery re-runs THE SAME order rather
 * than a second copy of it. Two spellings of this sequence would eventually
 * disagree, and a resolver that matches differently depending on whether it lost
 * a race is worse than one that simply fails.
 */
async function findExistingPerson(
  companyId: string,
  email: string | null,
  phone: string | null,
  externalKeys: IdentityExternalKeys,
): Promise<{ person: UnifiedPersonRow | null; matchedBy: IdentityResolutionResult['matchedBy'] }> {
  if (email) {
    const person = await findPersonByEmail(companyId, email);
    if (person) return { person, matchedBy: 'email' };
  }
  if (phone) {
    const person = await findPersonByPhone(companyId, phone);
    if (person) return { person, matchedBy: 'phone' };
  }

  // ── EXTERNAL STAGE ──────────────────────────────────────────────────────
  // The live answer still comes from `external_keys`. LI-5B Phase 1 computes
  // what `identity_claims` WOULD answer and records the comparison; it does not
  // participate in the decision.
  const person = await findPersonByExternalKeys(companyId, externalKeys);
  await observeExternalIdentityShadow(companyId, externalKeys, person?.id ?? null);
  return person ? { person, matchedBy: 'external_keys' } : { person: null, matchedBy: 'created' };
}

/**
 * LI-5D Phase 2 — write the canonical claim alongside `external_keys`.
 *
 * ADDITIVE. `external_keys` has already been written by the caller and remains
 * the sole read authority; nothing reads what this writes. A defect here cannot
 * change an identity decision, which is what makes it safe to ship before any
 * agreement evidence exists.
 *
 * FAIL-OPEN, and deliberately so: the person is already durable by the time this
 * runs, so failing the resolution because a secondary unread store rejected a
 * row would turn an additive migration step into an outage. Failures are
 * CLASSIFIED and logged rather than swallowed — a `23503` is a tenant-FK bug and
 * must never be reported as a transient database problem.
 */
async function dualWriteExternalIdentity(
  companyId: string,
  personId: string,
  externalKeys: IdentityExternalKeys,
): Promise<void> {
  try {
    if (!externalKeys || Object.keys(externalKeys).length === 0) return;

    const result = await writeExternalIdentityClaims({
      organizationId: companyId,
      personId,
      externalKeys,
    });
    if (result.attempted === 0) return;   // nothing in the claims shape to write

    // IDs, counts and SQLSTATEs only — never an identifier, email, phone or name.
    logger.info('external_identity_dual_write', {
      companyId,
      unifiedPersonId: personId,
      attempted: result.attempted,
      created: result.created,
      alreadyExists: result.alreadyExists,
      failed: result.failed,
      outcomes: result.outcomes,
      failureCodes: result.failureCodes,
    });
  } catch {
    // writeExternalIdentityClaims already absorbs its own failures; this second
    // guard exists so a resolution can never fail for a secondary write.
  }
}

/**
 * LI-5B Phase 1 — observe the claims-based answer beside the live one.
 *
 * Runs ONLY when the external stage actually executed and the caller supplied
 * external keys, so it adds at most one query and never adds one to a
 * resolution that email or phone already settled. That is also the only scope
 * where the comparison means anything: "current vs shadow" is a statement about
 * the external lookup, not about the whole resolver.
 *
 * Cannot throw and cannot change the verdict. `compareExternalIdentityShadow`
 * already swallows its own failures into an ERROR category; this second guard
 * exists because a resolution must not fail for a diagnostic.
 */
async function observeExternalIdentityShadow(
  companyId: string,
  externalKeys: IdentityExternalKeys,
  currentPersonId: string | null,
): Promise<void> {
  try {
    if (!externalKeys || Object.keys(externalKeys).length === 0) return;

    const comparison = await compareExternalIdentityShadow({
      organizationId: companyId,
      externalKeys,
      currentPersonId,
    });
    if (comparison.pairsProbed === 0) return;   // nothing in the claims shape to compare

    // LI-5E — count the observation. This line is reached ONLY after a genuine
    // resolution that consulted the external stage and had something to
    // compare, so historical claims, replay and empty reads never inflate it.
    recordShadowObservation(comparison.category);

    // IDs and counts only — never an email, phone, name or identifier value.
    logger.info('external_identity_shadow', {
      companyId,
      category: comparison.category,
      currentPersonId: comparison.currentPersonId,
      shadowMatchCount: comparison.shadowPersonIds.length,
      pairsProbed: comparison.pairsProbed,
      matchedClaimTypes: comparison.matchedClaimTypes,
      hasError: Boolean(comparison.error),
    });
  } catch {
    // A diagnostic must never break a resolution.
  }
}

/**
 * The indexes that make a person's IDENTITY unique within a tenant.
 *
 * `unified_persons` has FOUR unique arbiters — these two, plus `unified_persons_pkey`
 * and `uq_unified_persons_id_company`, both keyed on `id`. A bare
 * `code === '23505'` check would therefore treat a primary-key collision as
 * "another writer created this person", which is false: a uuid collision means
 * something is badly wrong and must stay an error. Only a conflict on one of
 * these two may be recovered by re-resolving.
 */
const IDENTITY_UNIQUE_INDEXES = [
  'idx_unified_persons_company_email_unique',
  'idx_unified_persons_company_phone_unique',
] as const;

/** True only for a unique violation on a person's tenant-scoped identity. */
function isIdentityUniquenessConflict(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string } | null;
  if (!e || e.code !== '23505') return false;
  const text = `${e.message ?? ''} ${e.details ?? ''}`;
  return IDENTITY_UNIQUE_INDEXES.some((index) => text.includes(index));
}

async function updatePersonIfNeeded(
  person: UnifiedPersonRow,
  params: {
    email: string | null;
    phone: string | null;
    externalKeys: IdentityExternalKeys;
  }
): Promise<void> {
  const mergedExternalKeys = mergeExternalKeys(person.external_keys, params.externalKeys);
  const payload: Record<string, unknown> = {};

  if (!person.primary_email && params.email) {
    payload.primary_email = params.email;
  }

  if (!person.primary_phone && params.phone) {
    payload.primary_phone = params.phone;
  }

  if (JSON.stringify(mergedExternalKeys) !== JSON.stringify(person.external_keys ?? {})) {
    payload.external_keys = mergedExternalKeys;
  }

  if (Object.keys(payload).length === 0) {
    return;
  }

  const { error } = await ownedDbTable('unified_persons')
    .update(payload)
    .eq('id', person.id);

  if (error) {
    throw new Error(`Failed to update unified person ${person.id}: ${error.message}`);
  }
}

export async function resolveUnifiedPerson(input: IdentityResolutionInput): Promise<IdentityResolutionResult> {
  if (!input.companyId?.trim()) {
    throw new Error('companyId is required to resolve unified person');
  }

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const externalKeys = cleanExternalKeys(input.externalKeys);

  const found = await findExistingPerson(input.companyId, email, phone, externalKeys);
  let person: UnifiedPersonRow | null = found.person;
  const matchedBy: IdentityResolutionResult['matchedBy'] = found.matchedBy;

  if (person) {
    await updatePersonIfNeeded(person, { email, phone, externalKeys });
    logger.info('unified_person_matched', {
      companyId: input.companyId,
      unifiedPersonId: person.id,
      matchedBy,
    });

    await dualWriteExternalIdentity(input.companyId, person.id, externalKeys);

    return {
      unifiedPersonId: person.id,
      matchedBy,
      created: false,
    };
  }

  const { data, error } = await ownedDbTable('unified_persons')
    .insert({
      company_id: input.companyId,
      primary_email: email,
      primary_phone: phone,
      external_keys: externalKeys,
    })
    .select('id')
    .single();

  if (error) {
    // ── LOST THE RACE (P1-1) ────────────────────────────────────────────────
    // Another caller created this identity between our lookup and our insert.
    // The tenant-scoped unique index is what tells us so, and it has already
    // done the important job: exactly one person exists, never two. Re-resolve
    // and return the winner, so both callers agree on one canonical person.
    //
    // The INSERT is NOT retried and nothing sleeps: the winning row is already
    // committed, so a single re-resolution is sufficient and terminating.
    //
    // Only an IDENTITY uniqueness conflict may take this path. A primary-key
    // collision is also 23505 and must remain a failure — see
    // isIdentityUniquenessConflict.
    if (isIdentityUniquenessConflict(error)) {
      const raced = await findExistingPerson(input.companyId, email, phone, externalKeys);
      if (raced.person) {
        // Same tenant throughout: the recovery re-resolves with the ORIGINAL
        // companyId, so a conflict in one tenant can never resolve into another.
        await updatePersonIfNeeded(raced.person, { email, phone, externalKeys });
        logger.info('unified_person_race_resolved', {
          companyId: input.companyId,
          unifiedPersonId: raced.person.id,
          matchedBy: raced.matchedBy,
        });
        await dualWriteExternalIdentity(input.companyId, raced.person.id, externalKeys);
        return { unifiedPersonId: raced.person.id, matchedBy: raced.matchedBy, created: false };
      }
      // The conflicting row exists but we cannot see it — a different tenant's
      // row could not have collided, so this means the winner was removed, or
      // the index and the lookup disagree. Either way it is a genuine fault and
      // is reported rather than looped on.
      throw new Error(
        `Failed to create unified person: identity conflict reported but no matching person is visible (${error.message})`,
      );
    }
    throw new Error(`Failed to create unified person: ${error.message}`);
  }

  const unifiedPersonId = (data as { id: string }).id;
  logger.info('unified_person_created', {
    companyId: input.companyId,
    unifiedPersonId,
    hasEmail: Boolean(email),
    hasPhone: Boolean(phone),
    hasExternalKeys: Object.keys(externalKeys).length > 0,
  });

  await dualWriteExternalIdentity(input.companyId, unifiedPersonId, externalKeys);

  return {
    unifiedPersonId,
    matchedBy: 'created',
    created: true,
  };
}
