/**
 * Provider enrichment → provenance (owner decision 5, 2026-10-30).
 *
 * When enrichment persists a provider's answer about a prospect's person or
 * account, the provider becomes a CONTRIBUTING source of that prospect. It is
 * recorded beside the originating source and never replaces it:
 *
 *   - `leadCreated` is always false, so the writer can only insert a
 *     `contributing` row. Enrichment never creates a prospect, so it can never
 *     originate one — and a prospect with no originating row is not
 *     re-originated by enrichment either (the writer's rule).
 *   - This module writes ONLY `prospect_source_contributions` (through the one
 *     writer). It never writes `canonical_leads` — not `source`, not
 *     `created_at`, not `lead_metadata` — and never touches the originating
 *     contribution (the table is append-only).
 *   - The external reference is `enrichment_<provider>:<subject>:<entityId>`,
 *     the same identity as the enrichment `source_records` row
 *     (`<provider>:<subject>:<entityId>`), so a retry or a later refresh of the
 *     same provider/subject converges on ONE contribution per prospect
 *     (`duplicate`), exactly as a CRM resync does.
 *
 * WHICH PROSPECT. The executor's subject is a person or account id, not a
 * prospect id. The prospect is taken from the caller when it knows it (the
 * planner path carries `plan.prospectId`). Otherwise, for a PERSON subject only,
 * the tenant's prospects anchored to that person are read and the contribution
 * is recorded only when exactly one exists. Zero or several is reported as
 * `skipped` — never guessed. An account subject without a prospect id is
 * skipped: an account enrichment describes a company shared by many prospects,
 * and fanning it out to all of them is a product decision not taken here.
 *
 * NEVER FATAL. Every outcome is counted and every failure is logged
 * (provenanceTelemetry, path `pi_enrichment`); nothing here throws, so a
 * provenance failure can never fail the enrichment that already persisted.
 */
import type { SourceContributionResult } from '../../../../lib/prospectProvenance/contract';
import { ownedDbTable } from '../../../db/writeOwner';
import { piEnrichmentProfile, toNamespacedRef } from './sourceProfiles';
import { recordObservedContribution, sourceObservedAt, type ContributionRecorder } from './recordContribution';
import { recordProvenanceOutcome } from './provenanceTelemetry';

export interface EnrichmentContributionInput {
  organizationId: string;
  /** The enrichment provider that answered (`apollo`, `clearbit`, …). */
  providerId: string;
  subject: 'person' | 'account';
  /** `unified_persons.id` or `prospect_accounts.id`. */
  entityId: string;
  /** The canonical prospect, when the caller knows it. */
  prospectId?: string | null;
  /** `source_records.id` returned by the LI-2 boundary for this observation. */
  sourceRecordId: string | null;
  /** The provider's own timestamp, when it gave one. */
  observedAt: string | null;
  /** Ingestion instant; the honest fallback when the provider gave no time. */
  ingestedAt: string;
  correlationId?: string | null;
  /** Canonical attribute names the provider returned. Names only, never values. */
  attributes?: readonly string[];
  payloadHash?: string | null;
}

export type EnrichmentSkipReason =
  | 'unmapped_provider'
  | 'no_source_record'
  | 'no_prospect'
  | 'ambiguous_prospect';

export type EnrichmentContributionOutcome =
  | SourceContributionResult
  | { status: 'skipped'; reason: EnrichmentSkipReason };

/** Tenant prospects anchored to a person. Returns at most `limit` ids. */
export type PersonProspectFinder = (organizationId: string, personId: string, limit: number) => Promise<string[]>;

const defaultPersonProspectFinder: PersonProspectFinder = async (organizationId, personId, limit) => {
  const { data, error } = await ownedDbTable('canonical_leads')
    .select('id')
    .eq('company_id', organizationId)          // tenant boundary — never optional
    .eq('unified_person_id', personId)
    .limit(limit);
  if (error) throw new Error(`canonical_leads lookup failed: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
};

/** The namespaced reference for one enrichment observation, or null for an unusable provider id. */
export function enrichmentExternalRef(providerId: string, subject: 'person' | 'account', entityId: string): string | null {
  const profile = piEnrichmentProfile(providerId);
  const id = String(entityId ?? '').trim();
  if (!profile || !id) return null;
  return toNamespacedRef(profile.refProvider, `${subject}:${id}`);
}

export async function recordEnrichmentContribution(
  input: EnrichmentContributionInput,
  deps: { recorder?: ContributionRecorder; findPersonProspects?: PersonProspectFinder } = {},
): Promise<EnrichmentContributionOutcome> {
  const skip = (reason: EnrichmentSkipReason): EnrichmentContributionOutcome => {
    recordProvenanceOutcome('pi_enrichment', 'skipped', {
      reason, organizationId: input.organizationId, providerId: input.providerId, subject: input.subject,
    });
    return { status: 'skipped', reason };
  };

  try {
    const profile = piEnrichmentProfile(input.providerId);
    const externalRef = enrichmentExternalRef(input.providerId, input.subject, input.entityId);
    if (!profile || !externalRef) return skip('unmapped_provider');
    if (!input.sourceRecordId) return skip('no_source_record');

    let prospectId = String(input.prospectId ?? '').trim() || null;
    let prospectResolvedBy: 'caller' | 'person_anchor' = 'caller';
    if (!prospectId) {
      if (input.subject !== 'person') return skip('no_prospect');
      const found = await (deps.findPersonProspects ?? defaultPersonProspectFinder)(
        input.organizationId, input.entityId, 2,
      );
      if (found.length === 0) return skip('no_prospect');
      if (found.length > 1) return skip('ambiguous_prospect');
      prospectId = found[0];
      prospectResolvedBy = 'person_anchor';
    }

    const { observedAt, observedAtBasis } = sourceObservedAt(input.observedAt, input.ingestedAt);
    return await recordObservedContribution('pi_enrichment', {
      organizationId: input.organizationId,
      canonicalLeadId: prospectId,
      // Enrichment NEVER originates a prospect.
      leadCreated: false,
      sourceCategory: profile.sourceCategory,
      externalRef,
      sourceRecordId: input.sourceRecordId,
      platform: profile.platform,
      sourceUrl: null,
      observedAt,
      ingestionRunId: input.correlationId ?? null,
      evidence: {
        sourceRecordId: input.sourceRecordId,
        subject: input.subject,
        entityId: input.entityId,
        personId: input.subject === 'person' ? input.entityId : null,
        accountId: input.subject === 'account' ? input.entityId : null,
        attributes: [...(input.attributes ?? [])],
        payloadHash: input.payloadHash ?? null,
      },
      sourceMetadata: {
        path: 'pi_enrichment',
        providerId: profile.platform,
        observedAtBasis,
        prospectResolvedBy,
        correlationId: input.correlationId ?? null,
      },
    }, deps.recorder);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    recordProvenanceOutcome('pi_enrichment', 'error', {
      organizationId: input.organizationId, providerId: input.providerId, subject: input.subject, message,
    });
    return { status: 'error', code: 'threw', message };
  }
}
