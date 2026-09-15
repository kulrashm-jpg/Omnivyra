/**
 * SEC-C5 (STEP 3AH-91) — re-verify tenant ids carried in BullMQ job payloads.
 *
 * Producers authorise the caller before they enqueue (plan-v2 / plan.ts via
 * requireCampaignAccess, BOLT via its authorised run), and the processor then
 * trusted `companyId` / `campaignId` / row ids from `job.data` verbatim. The
 * queue itself is not an authorisation boundary: anything that can write to
 * the Redis keyspace — a leaked Upstash credential, or a developer process on
 * the shared production Redis — can inject a job naming company A's billing
 * and company B's campaign or daily-plan row, and the worker (service role,
 * no RLS) would read B's data into A's output or overwrite B's rows.
 *
 * Defence in depth, cheap (1–3 indexed reads per job): before any billing or
 * side effect, prove the campaign belongs to the company with the SAME
 * authority the HTTP layer uses (campaignOwnershipService, ROUTE-AUTH-001),
 * and that an addressed row belongs to that campaign.
 *
 * Outcomes:
 *   owned        → proceed.
 *   foreign      → JobTenantBindingError (never retried into success).
 *   not_found    → JobTenantBindingError when the producer guarantees the
 *                  campaign exists (`requireExisting`), otherwise proceed —
 *                  a non-existent campaign cannot belong to another tenant.
 *   lookup_error → a plain Error so BullMQ retries (transient DB failure);
 *                  exhaustion lands in the dead-letter table as usual.
 * A rejection is logged as a structured `queue_job_tenant_binding_rejected`
 * error event and, after BullMQ's attempts are spent, dead-lettered by the
 * existing worker `failed` handlers.
 */
import { checkCampaignOwnership, type CampaignOwnership } from '../../services/campaignOwnershipService';
import { ownedDbTable } from '../../db/writeOwner';

export class JobTenantBindingError extends Error {
  readonly ownership: CampaignOwnership | 'missing_ids' | 'row_not_in_campaign' | 'payload_mismatch';
  constructor(detail: string, ownership: JobTenantBindingError['ownership']) {
    super(`queue job tenant binding rejected: ${detail}`);
    this.name = 'JobTenantBindingError';
    this.ownership = ownership;
  }
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function reject(
  queue: string,
  jobId: unknown,
  detail: string,
  ownership: JobTenantBindingError['ownership'],
  ids: Record<string, unknown>,
): never {
  console.error(JSON.stringify({
    level: 'ERROR',
    event: 'queue_job_tenant_binding_rejected',
    queue,
    jobId: jobId == null ? null : String(jobId),
    ownership,
    ...ids,
  }));
  throw new JobTenantBindingError(detail, ownership);
}

export interface JobCampaignBindingInput {
  queue: string;
  jobId: unknown;
  campaignId: unknown;
  companyId: unknown;
  /** The producer guarantees the campaign exists → an unknown campaign is rejected. */
  requireExisting: boolean;
}

/** Throws unless `campaignId` is bound to `companyId` (see module doc for outcomes). */
export async function assertJobCampaignBinding(input: JobCampaignBindingInput): Promise<void> {
  const { queue, jobId, campaignId, companyId, requireExisting } = input;
  const ids = { campaignId: campaignId ?? null, companyId: companyId ?? null };
  if (!nonEmpty(campaignId) || !nonEmpty(companyId)) {
    reject(queue, jobId, 'campaign and company ids are required', 'missing_ids', ids);
  }
  const ownership = await checkCampaignOwnership(campaignId as string, companyId as string);
  if (ownership === 'owned') return;
  if (ownership === 'not_found' && !requireExisting) return;
  if (ownership === 'lookup_error') {
    // Transient: let BullMQ retry rather than fail open or fail permanently.
    throw new Error(`queue job tenant binding lookup failed (${queue}); will retry`);
  }
  reject(queue, jobId, `campaign is ${ownership === 'foreign' ? 'owned by another company' : 'unknown'}`, ownership, ids);
}

/**
 * Throws unless the company a job is billed to is the company whose rows it
 * addresses (a payload can carry both, e.g. creator jobs: top-level
 * `company_id` for billing, `bolt_payload.company_id` for the row).
 */
export function assertPayloadCompaniesAgree(input: {
  queue: string;
  jobId: unknown;
  billingCompanyId: unknown;
  rowCompanyId: unknown;
}): void {
  const { queue, jobId, billingCompanyId, rowCompanyId } = input;
  if (!nonEmpty(billingCompanyId) || !nonEmpty(rowCompanyId) || billingCompanyId !== rowCompanyId) {
    reject(queue, jobId, 'billing company differs from the addressed company', 'payload_mismatch', {
      billingCompanyId: billingCompanyId ?? null,
      rowCompanyId: rowCompanyId ?? null,
    });
  }
}

/**
 * Throws unless the `daily_content_plans` row `rowId` belongs to `campaignId`.
 * Read with BOTH predicates, so it can only confirm, never disclose.
 */
export async function assertDailyPlanRowInCampaign(input: {
  queue: string;
  jobId: unknown;
  rowId: unknown;
  campaignId: string;
}): Promise<void> {
  const { queue, jobId, rowId, campaignId } = input;
  if (!nonEmpty(rowId)) {
    reject(queue, jobId, 'daily plan row id is required', 'missing_ids', { campaignId, rowId: rowId ?? null });
  }
  const { data, error } = await ownedDbTable('daily_content_plans')
    .select('id')
    .eq('id', rowId as string)
    .eq('campaign_id', campaignId)
    .maybeSingle();
  if (error) throw new Error(`queue job daily-plan binding lookup failed (${queue}); will retry`);
  if (!data) {
    reject(queue, jobId, 'daily plan row does not belong to the job campaign', 'row_not_in_campaign', { campaignId, rowId });
  }
}
