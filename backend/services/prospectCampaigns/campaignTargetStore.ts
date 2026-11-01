/**
 * Campaign targets — the SOLE writer of `prospect_campaign_targets`
 * (20261231000000).
 *
 * A target is an immutable SELECTION FACT: "campaign C selected prospect P from
 * list L in occurrence K". There is no update and no delete here; the database
 * refuses UPDATE, and only a prospect's erasure removes a target (CASCADE).
 *
 * IDEMPOTENT BY OCCURRENCE. Identity is (tenant, campaign, list, prospect,
 * selection key). The key is supplied by the caller — a retry of the same
 * occurrence collides and returns the existing target (`created:false`); a
 * deliberate re-selection uses a new key and is a new fact.
 */

import { ownedDbTable } from '../../db/writeOwner';

export const PROSPECT_CAMPAIGN_TARGETS_TABLE = 'prospect_campaign_targets';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._-]{1,200}$/;

export type TargetOrigin = 'human' | 'derived';

export class CampaignTargetError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'CampaignTargetError';
  }
}

function fail(message: string, code: string): never {
  throw new CampaignTargetError(message, code);
}

export interface CampaignTarget {
  readonly id: string;
  readonly organizationId: string;
  readonly campaignId: string;
  readonly listId: string;
  readonly prospectId: string;
  readonly selectionEventKey: string;
  readonly selectedAt: string;
  readonly origin: TargetOrigin;
  readonly actorUserId: string | null;
  readonly icpId: string | null;
  readonly icpVersion: number | null;
  readonly scoreEvaluationId: string | null;
}

const COLUMNS = 'id, organization_id, campaign_id, list_id, prospect_id, selection_event_key, '
  + 'selected_at, origin, actor_user_id, icp_id, icp_version, score_evaluation_id';

const toTarget = (r: Record<string, unknown>): CampaignTarget => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  campaignId: String(r.campaign_id),
  listId: String(r.list_id),
  prospectId: String(r.prospect_id),
  selectionEventKey: String(r.selection_event_key),
  selectedAt: String(r.selected_at),
  origin: r.origin === 'human' ? 'human' : 'derived',
  actorUserId: typeof r.actor_user_id === 'string' ? r.actor_user_id : null,
  icpId: typeof r.icp_id === 'string' ? r.icp_id : null,
  icpVersion: typeof r.icp_version === 'number' ? r.icp_version : null,
  scoreEvaluationId: typeof r.score_evaluation_id === 'string' ? r.score_evaluation_id : null,
});

const missingSchema = (code: string) => code === '42P01' || code === 'PGRST205' || code === '42703';

function translate(error: unknown, context: string): never {
  const code = String((error as { code?: string } | null)?.code ?? '');
  const message = String((error as { message?: string } | null)?.message ?? 'unknown error');
  if (missingSchema(code)) fail(`${context}: campaign targets are not installed (20261231000000)`, 'targets_schema_missing');
  // A composite tenant FK refusal: some referenced row is not in THIS tenant.
  if (code === '23503') fail(`${context}: the campaign, list, prospect, ICP version or evaluation is not in this tenant`, 'cross_tenant_or_missing_reference');
  fail(`${context} (${code || 'no code'}): ${message}`, code || 'write_failed');
}

/** `origin:key`, the stored form. The caller owns `key`; it names the occurrence. */
export function buildSelectionEventKey(origin: TargetOrigin, key: string): string {
  if (origin !== 'human' && origin !== 'derived') fail('origin must be human or derived', 'invalid_origin');
  if (!KEY.test(String(key ?? ''))) fail('selection key must be 1-200 chars of [A-Za-z0-9._-]', 'invalid_selection_key');
  return `${origin}:${key}`;
}

export async function createCampaignTarget(input: {
  organizationId: string;
  campaignId: string;
  listId: string;
  prospectId: string;
  selectionEventKey: string;
  origin: TargetOrigin;
  actorUserId: string | null;
  icpId: string | null;
  icpVersion: number | null;
  scoreEvaluationId: string | null;
}): Promise<{ target: CampaignTarget; created: boolean }> {
  for (const [k, v] of [['organizationId', input.organizationId], ['campaignId', input.campaignId], ['listId', input.listId], ['prospectId', input.prospectId]] as const) {
    if (!UUID.test(String(v ?? ''))) fail(`${k} must be a uuid`, `invalid_${k}`);
  }
  if ((input.origin === 'human') !== (input.actorUserId !== null)) {
    fail('a human selection names its actor; a derived one names none', 'origin_actor_mismatch');
  }
  const ins = await ownedDbTable(PROSPECT_CAMPAIGN_TARGETS_TABLE)
    .insert({
      organization_id: input.organizationId,
      campaign_id: input.campaignId,
      list_id: input.listId,
      prospect_id: input.prospectId,
      selection_event_key: input.selectionEventKey,
      origin: input.origin,
      actor_user_id: input.actorUserId,
      icp_id: input.icpId,
      icp_version: input.icpVersion,
      score_evaluation_id: input.scoreEvaluationId,
    })
    .select(COLUMNS)
    .single();
  if (!ins.error && ins.data) return { target: toTarget(ins.data as unknown as Record<string, unknown>), created: true };
  if (String((ins.error as { code?: string } | null)?.code ?? '') === '23505') {
    // The same occurrence already recorded this selection: return that fact.
    const res = await ownedDbTable(PROSPECT_CAMPAIGN_TARGETS_TABLE)
      .select(COLUMNS)
      .eq('organization_id', input.organizationId)
      .eq('campaign_id', input.campaignId)
      .eq('list_id', input.listId)
      .eq('prospect_id', input.prospectId)
      .eq('selection_event_key', input.selectionEventKey)
      .maybeSingle();
    if (!res.error && res.data) return { target: toTarget(res.data as unknown as Record<string, unknown>), created: false };
  }
  translate(ins.error, 'campaign target');
}

/** A campaign's targets, oldest first; optionally one occurrence only. */
export async function listCampaignTargets(
  organizationId: string, campaignId: string, options: { selectionEventKey?: string; limit?: number } = {},
): Promise<CampaignTarget[]> {
  if (!UUID.test(String(organizationId ?? ''))) fail('organizationId must be a uuid', 'tenant_required');
  if (!UUID.test(String(campaignId ?? ''))) fail('campaignId must be a uuid', 'invalid_campaign');
  let query = ownedDbTable(PROSPECT_CAMPAIGN_TARGETS_TABLE)
    .select(COLUMNS)
    .eq('organization_id', organizationId)
    .eq('campaign_id', campaignId);
  if (options.selectionEventKey) query = query.eq('selection_event_key', options.selectionEventKey);
  const res = await query.order('selected_at', { ascending: true }).limit(options.limit ?? 5000);
  if (res.error) translate(res.error, 'campaign targets');
  return ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map(toTarget);
}
