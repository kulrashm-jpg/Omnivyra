/**
 * The ONLY write path into `prospect_source_contributions`.
 *
 * Append-only by construction: this module inserts and never updates or deletes,
 * and the migration grants service_role SELECT + INSERT only (no UPDATE/DELETE).
 *
 * Idempotency and the one-originating rule are database-enforced, so persistence
 * is INSERT → catch `23505` (the same shape as prospectResolution and
 * upsertSourceRecord; the originating index is PARTIAL, so ON CONFLICT cannot
 * infer it — PostgREST answers 42P10):
 *   - violation of `uq_psc_org_lead_external_ref`  ⇒ this source event is already
 *     recorded for this lead → `duplicate` (retries converge);
 *   - violation of `uq_psc_one_originating_per_lead` ⇒ the lead already has an
 *     originator (a race, or a lead created before provenance existed) → the
 *     contribution is recorded as `contributing` and `roleDowngraded` is true.
 *     It is never dropped and never re-originates the lead.
 *
 * Failures are RETURNED, not thrown and not swallowed: callers decide whether a
 * failed provenance write fails their ingestion, and must make it observable.
 */
import { ownedDbTable } from '../../db/writeOwner';
import {
  PROVENANCE_DB,
  isSourceCategory,
  parseExternalRef,
  type ContributionRole,
  type SourceContributionInput,
  type SourceContributionResult,
} from '../../../lib/prospectProvenance/contract';

type Inserter = (row: Record<string, unknown>) => Promise<{ data: { id: string } | null; error: { code?: string; message?: string; details?: string } | null }>;

const defaultInserter: Inserter = async (row) => {
  const { data, error } = await ownedDbTable(PROVENANCE_DB.table).insert(row).select('id').single();
  return { data: (data as { id: string } | null) ?? null, error };
};

const violates = (e: { message?: string; details?: string } | null, name: string): boolean =>
  !!e && `${e.message ?? ''} ${e.details ?? ''}`.includes(name);

function toRow(input: SourceContributionInput, role: ContributionRole): Record<string, unknown> {
  return {
    organization_id: input.organizationId,
    canonical_lead_id: input.canonicalLeadId,
    contribution_role: role,
    source_category: input.sourceCategory,
    external_ref: input.externalRef,
    source_record_id: input.sourceRecordId ?? null,
    platform: input.platform ?? null,
    source_url: input.sourceUrl ?? null,
    contact_id: input.contactId ?? null,
    lead_signal_id: input.leadSignalId ?? null,
    opportunity_feed_item_id: input.opportunityFeedItemId ?? null,
    engagement_message_id: input.engagementMessageId ?? null,
    ingestion_run_id: input.ingestionRunId ?? null,
    observed_at: input.observedAt,
    evidence: input.evidence ?? {},
    source_metadata: input.sourceMetadata ?? {},
  };
}

export function validateContributionInput(input: SourceContributionInput): string | null {
  if (!input.organizationId) return 'organizationId is required';
  if (!input.canonicalLeadId) return 'canonicalLeadId is required';
  if (!isSourceCategory(input.sourceCategory)) return `unknown sourceCategory '${String(input.sourceCategory)}'`;
  if (!parseExternalRef(input.externalRef)) return `externalRef '${input.externalRef}' is not namespaced (<provider>:<id>)`;
  if (!input.observedAt || Number.isNaN(Date.parse(input.observedAt))) return 'observedAt must be an ISO timestamp';
  for (const [k, v] of [['evidence', input.evidence], ['sourceMetadata', input.sourceMetadata]] as const) {
    if (v !== undefined && (v === null || typeof v !== 'object' || Array.isArray(v))) return `${k} must be a JSON object`;
  }
  return null;
}

export async function recordSourceContribution(
  input: SourceContributionInput,
  deps: { insert?: Inserter } = {},
): Promise<SourceContributionResult> {
  const invalid = validateContributionInput(input);
  if (invalid) return { status: 'error', code: 'invalid_input', message: invalid };
  const insert = deps.insert ?? defaultInserter;

  const attempt = async (role: ContributionRole) => insert(toRow(input, role));
  const initialRole: ContributionRole = input.leadCreated ? 'originating' : 'contributing';

  let { data, error } = await attempt(initialRole);
  if (!error && data) return { status: 'inserted', id: data.id, role: initialRole, roleDowngraded: false };

  if (error?.code === '23505' && violates(error, PROVENANCE_DB.idempotencyConstraint)) {
    return { status: 'duplicate', role: null };
  }
  if (error?.code === '23505' && initialRole === 'originating' && violates(error, PROVENANCE_DB.oneOriginatingIndex)) {
    ({ data, error } = await attempt('contributing'));
    if (!error && data) return { status: 'inserted', id: data.id, role: 'contributing', roleDowngraded: true };
    if (error?.code === '23505' && violates(error, PROVENANCE_DB.idempotencyConstraint)) {
      return { status: 'duplicate', role: null };
    }
  }
  return { status: 'error', code: error?.code ?? null, message: error?.message ?? 'insert returned no row' };
}
