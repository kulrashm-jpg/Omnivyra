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

/**
 * Split provider fields into the attribute bags `ingestSourceRecord` expects.
 *
 * Values are passed through as the provider gave them: normalisation belongs to
 * the ingestion boundary, which owns the canonical vocabulary. Doing it twice,
 * in two places, is how two spellings of the same value end up in one column.
 */
export function toAttributeBags(fields: readonly ProviderField[]): {
  personAttributes: Record<string, unknown>;
  accountAttributes: Record<string, unknown>;
} {
  const personAttributes: Record<string, unknown> = {};
  const accountAttributes: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.value === null || f.value === undefined || f.value === '') continue;
    if (f.subject === 'person') personAttributes[f.attribute] = f.value;
    else accountAttributes[f.attribute] = f.value;
  }
  return { personAttributes, accountAttributes };
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
