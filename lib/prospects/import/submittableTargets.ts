/**
 * PI-LDB — which canonical destinations the CSV ingestion contract can actually carry.
 *
 * ─── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────
 * `CanonicalFieldKey` (backend/services/leadMapping/canonicalFieldRegistry.ts)
 * is the vocabulary the MAPPING engine may propose. `CsvLeadInput`
 * (= `ManualLeadInput`, backend/services/leadIngestion/adapters/csvAdapter.ts)
 * is the vocabulary the INGESTION contract accepts. They are nearly the same
 * list, and it is tempting to assume they are identical. They are not.
 *
 * `description` WAS the standing example: a registry key with no field on
 * `ManualLeadInput`, so the engine could propose it, a tenant could approve it,
 * and the record would be submitted with the value silently absent — an import
 * that reported success and quietly lost a column. That gap is now closed:
 * `ManualLeadInput.description` exists, `manualAdapter` reads it onto the
 * normalized account, and `toAccountAttributeInput` persists it to
 * `prospect_accounts.description`, which `ACCOUNT_ATTRIBUTE_COLUMNS` permits.
 * So `description` has moved to the submittable list and the gap list is empty.
 *
 * The partition itself still earns its place — the two vocabularies are still
 * maintained separately and can still drift — but it is now a guard with
 * nothing caught in it, which is the state it was always meant to reach.
 *
 * This module makes that mismatch explicit and LOUD instead of silent. A target
 * that is not submittable is surfaced to the tenant as "cannot be imported yet"
 * rather than being mapped and dropped.
 *
 * ─── THE GUARD THAT CAN ACTUALLY FAIL ─────────────────────────────────────
 * A hand-maintained list drifts the moment someone adds a registry key. So the
 * partition below is asserted against the live registry by
 * `backend/tests/unit/piLdbImportSubmittableTargets.test.ts`, which fails if a
 * canonical key appears in neither set. Adding a key to the registry therefore
 * forces a decision here rather than producing a quiet data loss.
 */

/**
 * Canonical keys that map 1:1 onto a `CsvLeadInput` property of the same name.
 *
 * The names are identical by design — `ManualLeadInput`'s own comment states
 * the canonical attribute names are used unprefixed, with `company*` reserved
 * for employer geography — so the applier can assign by key without a
 * translation table that could itself drift.
 */
export const SUBMITTABLE_TARGETS = [
  // contact identity
  'referenceId',
  'email',
  'phone',
  // contact detail
  'fullName',
  'firstName',
  'lastName',
  'jobTitle',
  'department',
  'countryCode',
  'region',
  'city',
  'observedAt',
  // employer identity
  'companyName',
  'companyDomain',
  'companyExternalId',
  // employer firmographics
  'description',
  'industry',
  'employeeCount',
  'employeeBand',
  'annualRevenue',
  'revenueBand',
  'foundedYear',
  'technologies',
  'fundingStage',
  'lastFundingAt',
  'companyCountryCode',
  'companyRegion',
  'companyCity',
] as const;

export type SubmittableTarget = (typeof SUBMITTABLE_TARGETS)[number];

/**
 * Canonical keys the mapping engine may propose but the ingestion contract
 * cannot carry, each with the reason a tenant can be told.
 *
 * EMPTY, deliberately, and kept rather than deleted. Every canonical key is
 * currently carryable; the last gap (`description`) was closed by adding the
 * field to `ManualLeadInput` and teaching the adapter to read it. The map stays
 * because the next registry key added will land here first — and because the
 * partition test fails on a key that is in neither set, so deleting this would
 * force the next addition to be silently submittable instead of a decision.
 */
export const NON_SUBMITTABLE_TARGETS: Readonly<Record<string, string>> = {};

const SUBMITTABLE = new Set<string>(SUBMITTABLE_TARGETS);

/** True when a proposed destination can actually be submitted. */
export function isSubmittableTarget(target: string): target is SubmittableTarget {
  return SUBMITTABLE.has(target);
}

/** The tenant-facing reason a recognised destination cannot be imported, if any. */
export function nonSubmittableReason(target: string): string | null {
  return NON_SUBMITTABLE_TARGETS[target] ?? null;
}

/**
 * Targets that identify WHO a record is. Mirrors the registry's
 * `identityCritical` flag for the subset reachable from a CSV, and is used by
 * the UI to explain why a column cannot be auto-applied. Presentation only —
 * the engine's own `requiresTenantApproval` remains the authority.
 */
export const IDENTITY_TARGETS: readonly SubmittableTarget[] = [
  'referenceId',
  'email',
  'phone',
  'companyName',
  'companyDomain',
  'companyExternalId',
];
