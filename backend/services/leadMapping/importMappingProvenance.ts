/**
 * PI-LDB D: server-side VERIFICATION of the mapping a browser used for an
 * import, turned into per-attribute provenance for `source_assertions`.
 *
 * The browser describes the mapping it applied (which source column went to
 * which canonical field, and how that was decided). Nothing in that description
 * is trusted as-is (coordinator ruling, 2026-11-11):
 *
 *   - A claimed profile id is NEVER used. The only profile that can verify a
 *     field is the one the SERVER loads for (this tenant, this source, this
 *     file's schema fingerprint) - the tenant's active version for that shape.
 *   - A field is stamped `approved_profile_match` with that profile's id and
 *     the entry's approver ONLY when the loaded profile has an approved entry
 *     for the same (normalised) source column AND the same target.
 *   - Anything else - a mismatching pair, a claimed profile that is not the
 *     active one, an unreadable profile - is stamped `tenant_confirmed` (or the
 *     stated `tenant_override`) with NO profile id, approved by the VERIFIED
 *     principal who submitted the import, at submission time.
 *   - `high_confidence_suggestion` (the engine's choice accepted without an
 *     individual decision) keeps that method and carries no approver.
 *   - A target that is not a canonical field, or a target claimed by two source
 *     columns, gets NO provenance (unknown is honest; a guess is not).
 *
 * Verification never fails an import: a profile that cannot be read only
 * downgrades the provenance, it does not refuse the records.
 */
import { canonicalField, isCanonicalFieldKey } from './canonicalFieldRegistry';
import { normaliseHeader } from './mappingScorer';
import { loadActiveProfile } from './mappingProfileStore';
import type { StoredMappingProfile } from './mappingTypes';
import type { AssertionMappingProvenance } from '../prospectIdentity/ingestionBoundary';

const FINGERPRINT = /^[a-f0-9]{64}$/;
const MAX_FIELDS = 200;
const MAX_FIELD_CHARS = 200;
const CLAIMABLE = new Set(['approved_profile_match', 'high_confidence_suggestion', 'tenant_confirmed', 'tenant_override']);

export interface SubmittedImportMapping {
  schemaFingerprint: string;
  /** Advisory only: never used to look anything up. */
  profileId?: string | null;
  fields: ReadonlyArray<{ sourceField: string; target: string; method: string }>;
}

export interface VerifiedImportProvenance {
  /** Keyed by the PERSON attribute column (e.g. job_title). */
  person: Record<string, AssertionMappingProvenance>;
  /** Keyed by the ACCOUNT attribute column. */
  account: Record<string, AssertionMappingProvenance>;
  /** The server-loaded profile that verified at least one field, else null. */
  verifiedProfileId: string | null;
  /** Fields that got no provenance, by reason (counts only). */
  unstamped: { invalid: number; duplicateTarget: number };
}

export interface VerifyImportMappingInput {
  organizationId: string;
  source: string;
  mapping: unknown;
  /** The VERIFIED principal who submitted the import. */
  principalUserId: string;
  now: string;
  loadProfile?: (key: { organizationId: string; source: string; schemaFingerprint: string }) => Promise<StoredMappingProfile | null>;
}

const EMPTY = (): VerifiedImportProvenance => ({ person: {}, account: {}, verifiedProfileId: null, unstamped: { invalid: 0, duplicateTarget: 0 } });

/** Shape-check the browser's description. Anything malformed means "no provenance", never a refusal. */
export function parseSubmittedMapping(raw: unknown): SubmittedImportMapping | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.schemaFingerprint !== 'string' || !FINGERPRINT.test(m.schemaFingerprint)) return null;
  if (!Array.isArray(m.fields) || m.fields.length === 0 || m.fields.length > MAX_FIELDS) return null;
  const fields: Array<{ sourceField: string; target: string; method: string }> = [];
  for (const f of m.fields) {
    if (!f || typeof f !== 'object') return null;
    const { sourceField, target, method } = f as Record<string, unknown>;
    if (typeof sourceField !== 'string' || typeof target !== 'string' || typeof method !== 'string') return null;
    fields.push({ sourceField: sourceField.slice(0, MAX_FIELD_CHARS), target, method });
  }
  return { schemaFingerprint: m.schemaFingerprint, profileId: typeof m.profileId === 'string' ? m.profileId : null, fields };
}

export async function verifyImportMapping(input: VerifyImportMappingInput): Promise<VerifiedImportProvenance> {
  const out = EMPTY();
  const mapping = parseSubmittedMapping(input.mapping);
  if (!mapping) return out;
  const load = input.loadProfile ?? loadActiveProfile;

  // The ONLY profile that can verify anything: loaded by the server, for this
  // tenant, source and file shape. A request-supplied id is ignored.
  let profile: StoredMappingProfile | null = null;
  try {
    profile = await load({ organizationId: input.organizationId, source: input.source, schemaFingerprint: mapping.schemaFingerprint });
  } catch {
    profile = null;      // unreadable: downgrade, never refuse
  }
  const approved = new Map<string, { target: string; approvedBy: string | null; approvedAt: string }>();
  for (const e of profile?.entries ?? []) {
    if (e.target) approved.set(normaliseHeader(e.sourceField), { target: e.target, approvedBy: e.approvedBy, approvedAt: e.approvedAt });
  }

  // A target fed by two columns is ambiguous: no provenance for it at all.
  const targetCount = new Map<string, number>();
  for (const f of mapping.fields) targetCount.set(f.target, (targetCount.get(f.target) ?? 0) + 1);

  for (const f of mapping.fields) {
    if (!f.sourceField.trim() || !isCanonicalFieldKey(f.target) || !CLAIMABLE.has(f.method)) { out.unstamped.invalid += 1; continue; }
    if ((targetCount.get(f.target) ?? 0) > 1) { out.unstamped.duplicateTarget += 1; continue; }
    const def = canonicalField(f.target);
    if (!def) { out.unstamped.invalid += 1; continue; }

    const entry = approved.get(normaliseHeader(f.sourceField));
    let prov: AssertionMappingProvenance;
    if (profile && entry && entry.target === f.target) {
      prov = {
        sourceField: f.sourceField, mappingMethod: 'approved_profile_match',
        mappingProfileId: profile.profileId, approvedBy: entry.approvedBy, approvedAt: entry.approvedAt,
      };
      out.verifiedProfileId = profile.profileId;
    } else if (f.method === 'high_confidence_suggestion') {
      prov = { sourceField: f.sourceField, mappingMethod: 'high_confidence_suggestion' };
    } else {
      // Includes a claimed 'approved_profile_match' that did not verify.
      prov = {
        sourceField: f.sourceField,
        mappingMethod: f.method === 'tenant_override' ? 'tenant_override' : 'tenant_confirmed',
        approvedBy: input.principalUserId, approvedAt: input.now,
      };
    }
    (def.entity === 'contact' ? out.person : out.account)[def.column] = prov;
  }
  return out;
}
