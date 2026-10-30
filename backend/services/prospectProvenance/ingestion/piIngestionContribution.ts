/**
 * PI ingestion (manual / csv / crm adapters and Apollo discovery) → provenance.
 *
 * Two helpers the LI-4D orchestrator calls (the orchestrator itself is not owned
 * by this track; the exact wiring patch is in the Agent-2 report):
 *
 *   `piProspectCandidateKeys`  — the namespaced + legacy key pair handed to
 *                                `resolveOrCreateProspect`, so new prospects are
 *                                namespaced and existing raw-keyed ones still match.
 *   `recordPiIngestionContribution` — the contribution for the canonical prospect
 *                                the record resolved to, with `leadCreated` taken
 *                                from the resolution outcome (`created` only).
 *
 * The category comes from the explicit adapter table (`PI_ADAPTER_PROFILES`).
 * An adapter key that is not in the table records NOTHING — it is reported as
 * `skipped:unmapped_source`, never classified by guess.
 */
import type { SourceContributionResult } from '../../../../lib/prospectProvenance/contract';
import { piAdapterProfile, prospectKeyCandidates, toNamespacedRef } from './sourceProfiles';
import { recordObservedContribution, sourceObservedAt, type ContributionRecorder } from './recordContribution';
import { recordProvenanceOutcome } from './provenanceTelemetry';

/** Keys for `ProspectCandidate`: `{ externalLeadKey: legacy raw, namespacedExternalLeadKey }`. */
export function piProspectCandidateKeys(
  adapterSource: string,
  externalId: string | null | undefined,
): { externalLeadKey: string | null; namespacedExternalLeadKey: string | null; provenance: { sourceCategory: string; platform: string | null; externalRef: string } | null } {
  const profile = piAdapterProfile(adapterSource);
  const raw = String(externalId ?? '').trim() || null;
  if (!profile || !raw) return { externalLeadKey: raw, namespacedExternalLeadKey: null, provenance: null };
  const keys = prospectKeyCandidates(profile.refProvider, raw)!;
  return {
    externalLeadKey: raw,
    namespacedExternalLeadKey: keys.namespaced,
    provenance: { sourceCategory: profile.sourceCategory, platform: profile.platform, externalRef: keys.namespaced },
  };
}

export interface PiContributionInput {
  organizationId: string;
  /** The adapter key (`record.source`), e.g. `apollo`, `csv`. */
  adapterSource: string;
  /** The adapter's `record.externalId`. */
  externalId: string | null;
  /** From `resolveOrCreateProspect`. */
  prospect: { prospectId: string | null; outcome: string; matchedKey?: 'namespaced' | 'legacy' };
  /** `source_records.id` from `ingestSourceRecord`. */
  sourceRecordId: string | null;
  /** `record.observedAt` — source time when the provider states one. */
  observedAt: string | null;
  /** Ingestion instant; the honest fallback when the source gives no time. */
  ingestedAt: string;
  ingestionRunId?: string | null;
  /** Where the evidence lives, when the record carries a URL. */
  sourceUrl?: string | null;
  personId?: string | null;
  accountId?: string | null;
}

export type PiContributionOutcome =
  | SourceContributionResult
  | { status: 'skipped'; reason: 'unmapped_source' | 'no_prospect' | 'no_external_id' };

export async function recordPiIngestionContribution(
  input: PiContributionInput,
  recorder?: ContributionRecorder,
): Promise<PiContributionOutcome> {
  const profile = piAdapterProfile(input.adapterSource);
  const skip = (reason: 'unmapped_source' | 'no_prospect' | 'no_external_id'): PiContributionOutcome => {
    recordProvenanceOutcome('pi_ingestion', 'skipped', { reason, adapterSource: input.adapterSource });
    return { status: 'skipped', reason };
  };
  if (!profile) return skip('unmapped_source');
  if (!input.prospect.prospectId) return skip('no_prospect');
  const raw = String(input.externalId ?? '').trim();
  if (!raw) return skip('no_external_id');

  const { observedAt, observedAtBasis } = sourceObservedAt(input.observedAt, input.ingestedAt);
  return recordObservedContribution('pi_ingestion', {
    organizationId: input.organizationId,
    canonicalLeadId: input.prospect.prospectId,
    leadCreated: input.prospect.outcome === 'created',
    sourceCategory: profile.sourceCategory,
    externalRef: toNamespacedRef(profile.refProvider, raw),
    sourceRecordId: input.sourceRecordId ?? null,
    platform: profile.platform,
    sourceUrl: input.sourceUrl ?? null,
    observedAt,
    ingestionRunId: input.ingestionRunId ?? null,
    evidence: {
      sourceRecordId: input.sourceRecordId ?? null,
      providerRecordId: raw,
      personId: input.personId ?? null,
      accountId: input.accountId ?? null,
    },
    sourceMetadata: {
      adapterSource: input.adapterSource,
      observedAtBasis,
      prospectMatchedBy: input.prospect.matchedKey ?? null,
      ...(profile.sourceCategory === 'pi_discovery' && input.ingestionRunId
        ? { discoveryExecutionId: input.ingestionRunId }
        : {}),
    },
  }, recorder);
}
