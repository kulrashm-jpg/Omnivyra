/**
 * A3 — wiring enrichment observations into the canonical identity and evidence
 * spine.
 *
 * The executor knows how to obtain a provider response safely. This module is
 * where that response becomes a canonical observation — and it does so by
 * calling the paths LI-2 and W4 already own, not by writing rows itself.
 *
 * ─── IT ADDS NO EVIDENCE STORE AND NO IDENTITY MODEL ──────────────────────
 * `ingestSourceRecord` is the LI-2 write path: it upserts `source_records`,
 * records `source_assertions`, decides which canonical values may be applied,
 * redacts secrets from the raw payload and computes the payload hash. It
 * already returns `canonicalApplied` / `canonicalWithheld`. Reimplementing any
 * of that here would be a second evidence architecture, so none of it is
 * reimplemented — this file maps provider fields onto that contract and calls
 * it.
 *
 * Identity is the same story: `resolveOrCreateAccount` is W4's, and its
 * `ambiguous` outcome already exists precisely because provider evidence
 * routinely points at two different companies at once.
 *
 * ─── AMBIGUITY IS REFUSED, NOT RESOLVED ───────────────────────────────────
 * When account evidence points at more than one existing account, W4 answers
 * `ambiguous`. This module then attaches NOTHING. Picking the first candidate
 * would merge two real companies on the strength of a similar name, and that
 * error is invisible afterwards — the wrong prospects simply appear under the
 * wrong account forever. Refusing leaves the observation recorded and the
 * identity untouched, which is recoverable.
 */

import {
  ingestSourceRecord, type ProviderSourceRecord,
} from '../../prospectIdentity/ingestionBoundary';
import {
  resolveOrCreateAccount, type AccountCandidate, type AccountOutcome,
} from '../../prospectIdentity/accountResolution';
import type { ExecuteEnrichmentPorts } from './execute';
import type { ProviderField } from './contract';

/** Account outcomes that must NOT be attached to a person. */
export const UNSAFE_ACCOUNT_OUTCOMES: readonly AccountOutcome[] = ['ambiguous', 'insufficient_evidence'];

export interface ResolvedEnrichmentTarget {
  readonly accountId: string | null;
  readonly outcome: AccountOutcome;
  readonly reason: string;
  /** True when the evidence was good enough to link. */
  readonly linkable: boolean;
  /** Distinct accounts the evidence pointed at. >1 is why `ambiguous` exists. */
  readonly candidateAccountIds: readonly string[];
}

/**
 * Resolve the account an enrichment is about, using W4's rules.
 *
 * Never creates an account from a name alone: `resolveOrCreateAccount` requires
 * a provider reference or a domain, because a company name is not an identity —
 * two different companies share one every day.
 */
export async function resolveEnrichmentAccount(
  organizationId: string,
  candidate: AccountCandidate,
  at: string,
  resolver: typeof resolveOrCreateAccount = resolveOrCreateAccount,
): Promise<ResolvedEnrichmentTarget> {
  const resolution = await resolver(organizationId, candidate, at);
  const unsafe = UNSAFE_ACCOUNT_OUTCOMES.includes(resolution.outcome);
  return {
    accountId: unsafe ? null : resolution.accountId,
    outcome: resolution.outcome,
    reason: resolution.reason,
    linkable: !unsafe && Boolean(resolution.accountId),
    candidateAccountIds: resolution.candidateAccountIds,
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * A3V — the PI → LI-2 vocabulary translation.
 *
 * PI names attributes the way the ICP model does — `employee_count` — because
 * that is the vocabulary a criterion is written in. LI-2's ingestion contract
 * names the same attributes `employeeCount`, and maps them back to snake_case
 * COLUMNS on the way to `source_assertions`. Both spellings are correct in
 * their own layer; what was missing was the sentence between them.
 *
 * Until A3U there was no adapter, every test mocked the ingest, and the bag
 * went straight through with PI's spelling. `toAccountAttributes` read
 * `input.employeeCount`, found nothing, and normalised the whole record to
 * nulls — so a provider's answer was accepted, carried, and silently discarded
 * at the last step. Nothing failed; the evidence simply never arrived.
 *
 * ─── WHY AN EXPLICIT MAP AND NOT A snake_case→camelCase FUNCTION ──────────
 * Because a generic transformer cannot refuse. It would happily invent
 * `someNewThing` from `some_new_thing` and hand it to a contract that has no
 * such field, reproducing the same silent loss one attribute later. The map
 * below is a closed list: an attribute PI cannot express through LI-2 is
 * REPORTED as unmapped rather than quietly dropped.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Canonical PI account attribute → the `AccountAttributes` key LI-2 reads.
 *
 * Deliberately NOT the whole of `toAccountAttributes`. `market`,
 * `business_model` and `growth_stage` are normalised there but are absent from
 * `pendingFromAccount`, so they would never become an assertion — including
 * them here would re-create exactly the silent loss this map exists to end.
 * They are excluded until that map carries them.
 */
export const ACCOUNT_ATTRIBUTE_TO_LI2: Readonly<Record<string, string>> = {
  industry: 'industry',
  employee_count: 'employeeCount',
  employee_band: 'employeeBand',
  country_code: 'countryCode',
  region: 'region',
  city: 'city',
  description: 'description',
  annual_revenue: 'annualRevenue',
  revenue_band: 'revenueBand',
  founded_year: 'foundedYear',
  technologies: 'technologies',
  funding_stage: 'fundingStage',
  last_funding_at: 'lastFundingAt',
};

/**
 * Canonical PI person attribute → the `PersonAttributes` key LI-2 reads.
 *
 * `authority`, `influence` and `buying_role` are excluded for the same reason
 * as their account counterparts: `pendingFromPerson` does not carry them, so
 * they normalise and then vanish. GAP-3 remains open regardless.
 */
export const PERSON_ATTRIBUTE_TO_LI2: Readonly<Record<string, string>> = {
  full_name: 'fullName',
  first_name: 'firstName',
  last_name: 'lastName',
  job_title: 'jobTitle',
  department: 'department',
  seniority: 'seniority',
  country_code: 'countryCode',
  region: 'region',
  city: 'city',
  timezone: 'timezone',
};

export interface AttributeBags {
  personAttributes: Record<string, unknown>;
  accountAttributes: Record<string, unknown>;
  /**
   * Canonical attributes the provider returned that LI-2 has no field for.
   *
   * Surfaced rather than discarded: an attribute silently disappearing between
   * two layers is the defect this whole function exists to fix, and it must not
   * be reintroduced for the next attribute somebody adds.
   */
  unmapped: readonly string[];
}

/**
 * Split provider fields into the attribute bags `ingestSourceRecord` expects,
 * translating PI's canonical names into LI-2's.
 *
 * Values are passed through exactly as the provider gave them: normalisation
 * belongs to the ingestion boundary, which owns the canonical vocabulary. Doing
 * it twice, in two places, is how two spellings of one value end up in one
 * column. This function changes the KEY and never the VALUE.
 */
export function toAttributeBags(fields: readonly ProviderField[]): AttributeBags {
  const personAttributes: Record<string, unknown> = {};
  const accountAttributes: Record<string, unknown> = {};
  const unmapped: string[] = [];

  for (const f of fields) {
    if (f.value === null || f.value === undefined || f.value === '') continue;

    const isPerson = f.subject === 'person';
    const map = isPerson ? PERSON_ATTRIBUTE_TO_LI2 : ACCOUNT_ATTRIBUTE_TO_LI2;
    const key = map[f.attribute];

    if (!key) {
      // Not silently dropped, and NOT passed through under its PI name either:
      // an unknown key in the ingestion contract is indistinguishable from a
      // typo, and LI-2 would ignore it exactly as it ignored all of them before.
      unmapped.push(f.attribute);
      continue;
    }

    if (isPerson) personAttributes[key] = f.value;
    else accountAttributes[key] = f.value;
  }

  return { personAttributes, accountAttributes, unmapped };
}

/**
 * The default `persistObservation` port: hand the observation to LI-2.
 *
 * The provider's raw payload is passed through so `source_records.raw_payload`
 * carries it — `ingestSourceRecord` redacts credential-shaped keys before it is
 * stored, so the redaction rule lives in one place rather than being restated
 * per adapter.
 */
export function makePersistObservation(
  ingest: typeof ingestSourceRecord = ingestSourceRecord,
): ExecuteEnrichmentPorts['persistObservation'] {
  return async (input) => {
    const { personAttributes, accountAttributes } = toAttributeBags(input.fields);

    const record: ProviderSourceRecord = {
      organizationId: input.organizationId,
      provider: input.providerId,
      entityType: input.subject,
      // The provider's own record id for this observation. Stable per entity +
      // provider, so a repeat observation updates rather than duplicates.
      sourceRecordId: `${input.providerId}:${input.subject}:${input.entityId}`,
      rawPayload: (input.rawPayload ?? {}) as Record<string, unknown>,
      personId: input.subject === 'person' ? input.entityId : null,
      accountId: input.subject === 'account' ? input.entityId : null,
      observedAt: input.observedAt,
      ingestionRunId: input.correlationId,
      personAttributes,
      accountAttributes,
      // Provider-stated confidence only. Never a number we invented to fill it.
      confidence: input.fields.find((f) => typeof f.confidence === 'number')?.confidence ?? null,
    };

    const result = await ingest(record);
    return {
      sourceRecordId: result.sourceRecordId,
      canonicalWithheld: result.canonicalWithheld,
    };
  };
}

/** Ready-to-use default. Tests inject their own `ingest`. */
export const defaultPersistObservation = makePersistObservation();
