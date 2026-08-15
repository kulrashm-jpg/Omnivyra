/**
 * LI-5D — external identity DUAL-WRITE.
 *
 * LI-5C found the migration deadlocked: the LI-5B shadow reads `identity_claims`,
 * but nothing writes resolved external claims, so the shadow could never observe
 * agreement no matter how much traffic arrived. This closes that loop by writing
 * the canonical claim ALONGSIDE the legacy `external_keys`, so the observation
 * window LI-5E needs is produced by genuine ingestion rather than manufactured.
 *
 * ─── ADDITIVE ONLY. IT CANNOT CHANGE A DECISION. ──────────────────────────
 * `external_keys` continues to be written exactly as before and remains the sole
 * read authority. Claims written here are read by nothing: the LI-5B lookup is
 * still shadow. A defect in this module therefore cannot alter a single identity
 * resolution — which is the property that makes shipping it safe before any
 * evidence exists.
 *
 * ─── IT REUSES THE W3 WRITER ──────────────────────────────────────────────
 * Persistence is `canonicalisation.persistClaims`: insert, catch `23505`, treat
 * as already present. `uq_identity_claims_tenant_identity` is PARTIAL
 * (`WHERE revoked_at IS NULL`), so PostgREST cannot infer it and `ON CONFLICT`
 * answers `42P10` — the trap W0.1, W0.2 and W3 each hit. No second writer, no
 * second normalizer, no second vocabulary.
 *
 * The one thing NOT inherited is provenance: W3 stamps `source='w3_backfill'`,
 * and a claim created by today's ingestion must not describe itself as a
 * historical backfill. `DerivedClaim.source` / `.evidence` carry the honest
 * values instead.
 *
 * ─── IT NEVER CREATES AN UNRESOLVED CLAIM ─────────────────────────────────
 * Every claim is linked to the `person_id` the existing resolver returned. The
 * 10 unresolved W3 LinkedIn claims stay exactly as they are — untouched,
 * unlinked, and invisible to this module.
 */

import { persistClaims, type DerivedClaim } from './canonicalisation';
import {
  normalizeExternalIdentity,
  normalizePlatform,
  type ClaimType,
} from './normalization';

export const DUAL_WRITE_VERSION = 'li5d.1';
/** Provenance for a claim created by live ingestion, distinct from `w3_backfill`. */
export const DUAL_WRITE_SOURCE = 'identity_dual_write';

/**
 * The claim type LI-5C decided for the sources reachable today.
 *
 * `external_id` — an opaque, provider-issued identifier. LinkedIn (matching the
 * 10 existing claims), manual and CRM all fall here. `external_profile` is for a
 * resolvable profile URL and is DEFERRED per provider (LI-5C Q-3), so this phase
 * emits only `external_id` and invents no provider-specific type.
 */
export const DUAL_WRITE_CLAIM_TYPE: ClaimType = 'external_id';

/** Per-claim outcome. Only `already_exists` is a benign duplicate. */
export type ClaimWriteOutcome =
  | 'created'
  | 'already_exists'
  | 'invalid_claim'
  | 'tenant_fk_failure'
  | 'normalization_failure'
  | 'database_failure';

export interface DualWriteResult {
  attempted: number;
  created: number;
  alreadyExists: number;
  /** Anything that is neither created nor a benign duplicate. */
  failed: number;
  outcomes: ClaimWriteOutcome[];
  /** SQLSTATEs observed on failure — codes only, never values. */
  failureCodes: string[];
}

const EMPTY: DualWriteResult = Object.freeze({
  attempted: 0, created: 0, alreadyExists: 0, failed: 0, outcomes: [], failureCodes: [],
});

/**
 * Map a SQLSTATE to the outcome vocabulary.
 *
 * `23505` never reaches here — `persistClaims` absorbs it as already-present,
 * which is the only benign duplicate. Everything else is a real failure and is
 * classified rather than flattened, so a constraint violation is never reported
 * as a transient database problem.
 */
export function classifyClaimFailure(code: string | null | undefined): ClaimWriteOutcome {
  switch (code) {
    case '23503': return 'tenant_fk_failure';   // composite FK: person not in this tenant
    case '23514': return 'invalid_claim';       // CHECK: platform rule, normalisation, vocabulary
    case '23502': return 'invalid_claim';       // NOT NULL
    default: return 'database_failure';
  }
}

/**
 * Build the claims a resolution implies. Pure.
 *
 * Reads ONLY the `{ provider: { external_id } }` shape the current code writes.
 * The legacy `linkedin_urns`, `external_user_keys` and `unified_person_id`
 * values yield nothing, so LI-5C Q-1 stays uninfluenced and no legacy value is
 * reinterpreted as a provider identity.
 */
export function buildExternalIdentityClaims(input: {
  organizationId: string;
  personId: string;
  externalKeys: Record<string, unknown> | null | undefined;
}): { claims: DerivedClaim[]; normalizationFailures: number } {
  const { organizationId, personId, externalKeys } = input;
  if (!organizationId?.trim() || !personId?.trim()) return { claims: [], normalizationFailures: 0 };
  if (!externalKeys || typeof externalKeys !== 'object' || Array.isArray(externalKeys)) {
    return { claims: [], normalizationFailures: 0 };
  }

  const claims: DerivedClaim[] = [];
  const seen = new Set<string>();
  let normalizationFailures = 0;

  for (const [provider, value] of Object.entries(externalKeys)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const raw = (value as Record<string, unknown>).external_id;
    if (typeof raw !== 'string') continue;

    const platform = normalizePlatform(DUAL_WRITE_CLAIM_TYPE, provider);
    const normalizedValue = normalizeExternalIdentity(raw);
    if (!platform || !normalizedValue) {
      // The caller supplied something shaped like an identifier that no rule can
      // turn into one. Counted, never silently dropped.
      normalizationFailures += 1;
      continue;
    }

    const key = `${platform}\u0000${normalizedValue}`;
    if (seen.has(key)) continue;
    seen.add(key);

    claims.push({
      organizationId,
      personId,                                   // never null — §8
      claimType: DUAL_WRITE_CLAIM_TYPE,
      platform,
      normalizedValue,
      rawValue: raw,
      sourceTable: 'unified_persons',
      sourceId: personId,
      sourceColumn: 'external_keys',
      source: DUAL_WRITE_SOURCE,
      // Summary only. The provider's payload is NOT stored here — that belongs
      // to LI-2 `source_records`, and duplicating it would create a second
      // provenance store.
      evidence: {
        dualWriteVersion: DUAL_WRITE_VERSION,
        platform,
        derivation: 'external_keys_transcription',
      },
    });
  }

  return { claims, normalizationFailures };
}

/**
 * Write the canonical claims for an already-resolved person.
 *
 * NEVER THROWS. The person and their `external_keys` are already durable by the
 * time this runs; failing the resolution because a secondary, unread store
 * rejected a row would turn an additive migration step into an outage. Failures
 * are classified and returned so the caller can make them observable — they are
 * not swallowed into silence.
 */
export async function writeExternalIdentityClaims(input: {
  organizationId: string;
  personId: string;
  externalKeys: Record<string, unknown> | null | undefined;
  now?: string;
}): Promise<DualWriteResult> {
  let normalizationFailures = 0;
  try {
    const built = buildExternalIdentityClaims(input);
    normalizationFailures = built.normalizationFailures;

    if (built.claims.length === 0) {
      return normalizationFailures === 0
        ? EMPTY
        : {
          attempted: normalizationFailures, created: 0, alreadyExists: 0,
          failed: normalizationFailures,
          outcomes: Array<ClaimWriteOutcome>(normalizationFailures).fill('normalization_failure'),
          failureCodes: [],
        };
    }

    const persisted = await persistClaims(built.claims, input.now);

    const outcomes: ClaimWriteOutcome[] = [
      ...Array<ClaimWriteOutcome>(persisted.inserted).fill('created'),
      ...Array<ClaimWriteOutcome>(persisted.alreadyPresent).fill('already_exists'),
      ...persisted.errors.map((e) => classifyClaimFailure(e.code)),
      ...Array<ClaimWriteOutcome>(normalizationFailures).fill('normalization_failure'),
    ];

    return {
      attempted: persisted.attempted + normalizationFailures,
      created: persisted.inserted,
      alreadyExists: persisted.alreadyPresent,
      failed: persisted.failed + normalizationFailures,
      outcomes,
      failureCodes: persisted.errors.map((e) => e.code ?? 'unknown'),
    };
  } catch (e) {
    // persistClaims reports row errors rather than throwing, so reaching here
    // means the driver or the connection failed. Still not fatal to resolution.
    return {
      attempted: 1, created: 0, alreadyExists: 0, failed: 1,
      outcomes: ['database_failure'],
      failureCodes: [(e as { code?: string })?.code ?? 'unknown'],
    };
  }
}
