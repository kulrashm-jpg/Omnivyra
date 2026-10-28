/**
 * Campaign × list attachment — the SOLE writer of `prospect_campaign_lists`
 * (20261231000000).
 *
 * An attachment says "this campaign selects from this canonical list". It is
 * not history (detach is a row delete); what a campaign actually selected is
 * recorded, immutably, by the campaign target store.
 *
 * Tenant-safe twice over: every query is tenant-first, and the composite foreign
 * keys refuse a campaign or list of another tenant (23503 → `not_found`).
 */

import { ownedDbTable } from '../../db/writeOwner';

export const PROSPECT_CAMPAIGN_LISTS_TABLE = 'prospect_campaign_lists';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CampaignListError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'CampaignListError';
  }
}

function fail(message: string, code: string): never {
  throw new CampaignListError(message, code);
}

export interface CampaignListAttachment {
  readonly campaignId: string;
  readonly listId: string;
  readonly attachedBy: string | null;
  readonly attachedAt: string;
}

const missingSchema = (code: string) => code === '42P01' || code === 'PGRST205' || code === '42703';

function translate(error: unknown, context: string): never {
  const code = String((error as { code?: string } | null)?.code ?? '');
  const message = String((error as { message?: string } | null)?.message ?? 'unknown error');
  if (missingSchema(code)) fail(`${context}: campaign targeting is not installed (20261231000000)`, 'targeting_schema_missing');
  if (code === '23503') fail(`${context}: no such campaign or list in this tenant`, 'not_found');
  fail(`${context} (${code || 'no code'}): ${message}`, code || 'write_failed');
}

function ids(organizationId: string, campaignId: string, listId?: string): void {
  if (!UUID.test(String(organizationId ?? ''))) fail('organizationId must be a uuid', 'tenant_required');
  if (!UUID.test(String(campaignId ?? ''))) fail('campaignId must be a uuid', 'invalid_campaign');
  if (listId !== undefined && !UUID.test(String(listId ?? ''))) fail('listId must be a uuid', 'invalid_list');
}

const toAttachment = (r: Record<string, unknown>): CampaignListAttachment => ({
  campaignId: String(r.campaign_id),
  listId: String(r.list_id),
  attachedBy: typeof r.attached_by === 'string' ? r.attached_by : null,
  attachedAt: String(r.attached_at),
});

/** Attach a list. Idempotent: an existing attachment is returned as `created:false`. */
export async function attachListToCampaign(input: {
  organizationId: string; campaignId: string; listId: string; actorUserId: string | null;
}): Promise<{ attachment: CampaignListAttachment; created: boolean }> {
  ids(input.organizationId, input.campaignId, input.listId);
  const ins = await ownedDbTable(PROSPECT_CAMPAIGN_LISTS_TABLE)
    .insert({
      organization_id: input.organizationId,
      campaign_id: input.campaignId,
      list_id: input.listId,
      attached_by: input.actorUserId,
    })
    .select('campaign_id, list_id, attached_by, attached_at')
    .single();
  if (!ins.error && ins.data) return { attachment: toAttachment(ins.data as Record<string, unknown>), created: true };
  if (String((ins.error as { code?: string } | null)?.code ?? '') === '23505') {
    const existing = (await listCampaignListAttachments(input.organizationId, input.campaignId))
      .find((a) => a.listId === input.listId);
    if (existing) return { attachment: existing, created: false };
  }
  translate(ins.error, 'attach list');
}

/** Detach a list. Returns false when it was not attached. */
export async function detachListFromCampaign(input: {
  organizationId: string; campaignId: string; listId: string;
}): Promise<boolean> {
  ids(input.organizationId, input.campaignId, input.listId);
  const res = await ownedDbTable(PROSPECT_CAMPAIGN_LISTS_TABLE)
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('campaign_id', input.campaignId)
    .eq('list_id', input.listId)
    .select('id');
  if (res.error) translate(res.error, 'detach list');
  return Array.isArray(res.data) && res.data.length > 0;
}

export async function listCampaignListAttachments(
  organizationId: string, campaignId: string,
): Promise<CampaignListAttachment[]> {
  ids(organizationId, campaignId);
  const res = await ownedDbTable(PROSPECT_CAMPAIGN_LISTS_TABLE)
    .select('campaign_id, list_id, attached_by, attached_at')
    .eq('organization_id', organizationId)
    .eq('campaign_id', campaignId)
    .order('attached_at', { ascending: true });
  if (res.error) translate(res.error, 'list attachments');
  return ((res.data ?? []) as Array<Record<string, unknown>>).map(toAttachment);
}
