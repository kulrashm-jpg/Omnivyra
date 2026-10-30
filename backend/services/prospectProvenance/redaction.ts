/**
 * Prospect provenance — PRIVACY REDACTION of contributions (owner decision 8).
 *
 * `prospect_source_contributions` is append-only: service_role holds SELECT +
 * INSERT and nothing else, and that does not change here. The single sanctioned
 * mutation is redaction, performed by the SECURITY DEFINER function
 * `public.pi_redact_prospect_source_contributions` (migration
 * 20270108000001_pi_provenance_privacy_and_marketpulse.sql), which in ONE
 * transaction, for the tenant's contributions of the given canonical leads:
 *
 *   - refuses (42501) if any lead belongs to another tenant — nothing changes;
 *   - writes a TOMBSTONE per contribution (`prospect_source_contribution_redactions`):
 *     reason, requester, the NAMES of the redacted fields and a sha256 of the
 *     redacted values — never the values;
 *   - nulls `source_url` and replaces `evidence` / `source_metadata` with a
 *     `{ redacted: true, redaction_id }` marker;
 *   - never deletes the contribution, and is idempotent (one tombstone per
 *     contribution; a repeat reports `alreadyRedacted`).
 *
 * This module is the only caller. It FAILS CLOSED: any failure that could leave
 * personal data behind throws, so an erasure built on it aborts before the
 * person is deleted. The single tolerated "not deployed" case is the one in
 * which there is provably nothing to redact (the ledger table itself is absent,
 * or the tenant holds no contribution for the leads).
 */
import { ownedDbRpc, ownedDbTable } from '../../db/writeOwner';

export const REDACTION_FUNCTION = 'pi_redact_prospect_source_contributions';
export const REDACTION_TOMBSTONE_TABLE = 'prospect_source_contribution_redactions';

export class ProvenanceRedactionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ProvenanceRedactionError';
  }
}

export interface RedactContributionsInput {
  organizationId: string;
  canonicalLeadIds: string[];
  /** Why — stored verbatim on every tombstone. Required. */
  reason: string;
  /** Who/what asked (actor id or system label). Required. */
  requestedBy: string;
}

export type RedactContributionsResult =
  | { status: 'redacted'; redacted: number; alreadyRedacted: number; contributionIds: string[] }
  /** Nothing to redact — no leads, no contributions, or the ledger is not deployed. */
  | { status: 'nothing_to_redact'; reason: 'no_leads' | 'no_contributions' | 'ledger_absent' };

const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

/** PostgREST / PostgreSQL "function does not exist". */
const FUNCTION_MISSING = new Set(['PGRST202', '42883']);
/** PostgREST / PostgreSQL "relation does not exist". */
const RELATION_MISSING = new Set(['PGRST205', '42P01']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Redact the tenant's contributions for the given canonical leads.
 */
export async function redactProspectContributions(
  input: RedactContributionsInput,
): Promise<RedactContributionsResult> {
  const organizationId = input.organizationId?.trim();
  if (!organizationId) {
    throw new ProvenanceRedactionError('organizationId is required — redaction is never tenant-less', 'tenant_required');
  }
  if (!input.reason?.trim()) {
    throw new ProvenanceRedactionError('reason is required — an unexplained redaction is an unusable audit record', 'reason_required');
  }
  if (!input.requestedBy?.trim()) {
    throw new ProvenanceRedactionError('requestedBy is required', 'requested_by_required');
  }
  const leadIds = [...new Set((input.canonicalLeadIds ?? []).map((id) => String(id ?? '').trim()))];
  if (leadIds.some((id) => !UUID.test(id))) {
    throw new ProvenanceRedactionError('every canonical lead id must be a uuid', 'invalid_lead_id');
  }
  if (leadIds.length === 0) return { status: 'nothing_to_redact', reason: 'no_leads' };

  const res = await ownedDbRpc(REDACTION_FUNCTION, {
    p_organization_id: organizationId,
    p_canonical_lead_ids: leadIds,
    p_reason: input.reason.trim(),
    p_requested_by: input.requestedBy.trim(),
  });

  if (res.error) {
    const code = errCode(res.error);
    if (code && FUNCTION_MISSING.has(code)) {
      return whenFunctionMissing(organizationId, leadIds);
    }
    if (code === '42501') {
      throw new ProvenanceRedactionError(
        `redaction refused: a requested lead belongs to another tenant (${res.error.message})`,
        'cross_tenant',
      );
    }
    throw new ProvenanceRedactionError(
      `contribution redaction failed (${code ?? 'unknown'}): ${res.error.message}`,
      code ?? 'redaction_failed',
    );
  }

  const data = (res.data ?? {}) as { redacted?: unknown; already_redacted?: unknown; contribution_ids?: unknown };
  return {
    status: 'redacted',
    redacted: Number(data.redacted ?? 0),
    alreadyRedacted: Number(data.already_redacted ?? 0),
    contributionIds: Array.isArray(data.contribution_ids) ? data.contribution_ids.map(String) : [],
  };
}

/**
 * The function is not deployed. Tolerated ONLY when there is provably nothing
 * to redact; otherwise personal data would survive an erasure that reports
 * success, so this throws.
 */
async function whenFunctionMissing(organizationId: string, leadIds: string[]): Promise<RedactContributionsResult> {
  const probe = await ownedDbTable('prospect_source_contributions')
    .select('id')
    .eq('organization_id', organizationId)        // TENANT FIRST
    .in('canonical_lead_id', leadIds)
    .limit(1);
  if (probe.error) {
    const code = errCode(probe.error);
    if (code && RELATION_MISSING.has(code)) return { status: 'nothing_to_redact', reason: 'ledger_absent' };
    throw new ProvenanceRedactionError(
      `redaction function is not deployed and the ledger could not be checked (${code ?? 'unknown'}): ${probe.error.message}`,
      'redaction_unavailable',
    );
  }
  if (((probe.data ?? []) as unknown[]).length === 0) {
    return { status: 'nothing_to_redact', reason: 'no_contributions' };
  }
  throw new ProvenanceRedactionError(
    'contributions exist for these leads but the redaction function is not deployed (apply 20270108000001)',
    'redaction_unavailable',
  );
}

export interface RedactPersonContributionsInput {
  organizationId: string;
  personId: string;
  reason: string;
  requestedBy: string;
}

/**
 * Redact every contribution of every canonical prospect linked to a person.
 *
 * MUST run before the person row is deleted: `canonical_leads.unified_person_id`
 * is `ON DELETE SET NULL (unified_person_id)`, so afterwards nothing links the
 * prospects to the erased person any more.
 */
export async function redactContributionsForPerson(
  input: RedactPersonContributionsInput,
): Promise<RedactContributionsResult & { canonicalLeadIds: string[] }> {
  const organizationId = input.organizationId?.trim();
  if (!organizationId) {
    throw new ProvenanceRedactionError('organizationId is required — redaction is never tenant-less', 'tenant_required');
  }
  if (!input.personId?.trim()) {
    throw new ProvenanceRedactionError('personId is required', 'person_required');
  }
  const leads = await ownedDbTable('canonical_leads')
    .select('id')
    .eq('company_id', organizationId)              // TENANT FIRST
    .eq('unified_person_id', input.personId);
  if (leads.error) {
    throw new ProvenanceRedactionError(
      `could not read the person's canonical prospects: ${leads.error.message}`,
      errCode(leads.error) ?? 'leads_unreadable',
    );
  }
  const canonicalLeadIds = ((leads.data ?? []) as Array<{ id?: unknown }>)
    .map((r) => String(r.id ?? ''))
    .filter(Boolean);
  const result = await redactProspectContributions({
    organizationId,
    canonicalLeadIds,
    reason: input.reason,
    requestedBy: input.requestedBy,
  });
  return { ...result, canonicalLeadIds };
}
