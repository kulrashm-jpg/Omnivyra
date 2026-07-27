/**
 * LC-401 (W4) — Campaign Intelligence service (decision + orchestration; NO execution).
 *
 * A GTM Campaign is a first-class STRATEGY object that REFERENCES an audience and reuses
 * every foundation below it — it duplicates nothing:
 *   • members/reach/intelligence  ← W3 audience layer (`audienceService`) — never copies recipients
 *   • strategy/channel decisions   ← pure `campaignStrategy` engine over materialized scores
 *   • owner/status/notes/tasks     ← W2 operational core (`entity_type='gtm_campaign'`)
 *   • messaging assets             ← reusable `gtm_messages` (shared across campaigns)
 *
 * It RECOMMENDS and SIMULATES only. It sends nothing (execution is W5).
 */

import { ownedDbTable } from '../../db/writeOwner';
import { getAudienceIntelligence, listMembers, type AudienceIntelligence } from '../audience/audienceService';
import { recommendStrategy, recommendChannelPlan, type AudienceSignal } from '../../../lib/campaign/campaignStrategy';
import { trackEvent } from '../telemetry/telemetryDispatcher';

const C = 'gtm_campaigns', MSG = 'gtm_messages';
const now = () => new Date().toISOString();
const DEFAULT_CHANNELS = ['email', 'linkedin', 'in_app', 'manual'];

export class CampaignError extends Error { constructor(public code: string, public httpStatus: number) { super(code); this.name = 'CampaignError'; } }

export interface CampaignInput { name: string; description?: string; objective?: string; audienceId?: string | null; channels?: string[]; kpis?: unknown[]; schedule?: Record<string, unknown>; metadata?: Record<string, unknown> }

/* ── CRUD ───────────────────────────────────────────────────────────────────── */

export async function createCampaign(companyId: string, actorId: string | null, input: CampaignInput): Promise<{ id: string }> {
  if (!input.name?.trim()) throw new CampaignError('name_required', 400);
  const { data, error } = await ownedDbTable(C).insert({
    company_id: companyId, name: input.name.trim(), description: input.description ?? null, objective: input.objective ?? null,
    audience_id: input.audienceId ?? null, channels: input.channels ?? [], kpis: input.kpis ?? [], schedule: input.schedule ?? {},
    metadata: input.metadata ?? {}, created_by: actorId,
  }).select('id').maybeSingle();
  if (error || !data) throw new CampaignError('create_failed', 500);
  trackEvent({ type: 'campaign.created', organizationId: companyId, actorId, entityId: String((data as any).id), metadata: { audienceId: input.audienceId ?? null } });
  return { id: String((data as any).id) };
}

export async function updateCampaign(companyId: string, campaignId: string, patch: Partial<CampaignInput> & { status?: string; strategy?: unknown }): Promise<void> {
  const row: Record<string, unknown> = { updated_at: now() };
  for (const k of ['name', 'description', 'objective', 'status'] as const) if ((patch as any)[k] != null) row[k] = (patch as any)[k];
  if (patch.audienceId !== undefined) row.audience_id = patch.audienceId;
  if (patch.channels != null) row.channels = patch.channels;
  if (patch.kpis != null) row.kpis = patch.kpis;
  if (patch.schedule != null) row.schedule = patch.schedule;
  if (patch.strategy != null) row.strategy = patch.strategy;
  if (patch.metadata != null) row.metadata = patch.metadata;
  const { error } = await ownedDbTable(C).update(row).eq('company_id', companyId).eq('id', campaignId).select('id').maybeSingle();
  if (error) throw new CampaignError('update_failed', 500);
}

export async function listCampaigns(companyId: string): Promise<Array<Record<string, unknown>>> {
  const { data } = await ownedDbTable(C).select('*').eq('company_id', companyId).is('deleted_at', null).order('created_at', { ascending: false }).limit(500);
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

export async function getCampaign(companyId: string, campaignId: string): Promise<Record<string, unknown> | null> {
  const { data } = await ownedDbTable(C).select('*').eq('company_id', companyId).eq('id', campaignId).maybeSingle();
  return data ? (data as Record<string, unknown>) : null;
}

export async function deleteCampaign(companyId: string, campaignId: string): Promise<void> {
  await ownedDbTable(C).update({ deleted_at: now(), updated_at: now() }).eq('company_id', companyId).eq('id', campaignId);
}

/* ── Signal resolution (reuse the W3 audience layer) ─────────────────────────── */

function toSignal(ai: AudienceIntelligence): AudienceSignal {
  return { members: ai.members, avgIntent: ai.avgIntent, intentBands: ai.intentBands, bySource: ai.bySource };
}

async function resolveAudienceSignal(companyId: string, audienceId: string | null): Promise<AudienceSignal> {
  if (!audienceId) throw new CampaignError('audience_required', 400);
  const ai = await getAudienceIntelligence(companyId, audienceId); // reuse — never copies members
  return toSignal(ai);
}

/* ── Recommendation (explainable; recommend only) ───────────────────────────── */

export async function recommendCampaign(companyId: string, campaignId: string): Promise<{ strategy: unknown; channelPlan: unknown }> {
  const campaign = await getCampaign(companyId, campaignId);
  if (!campaign) throw new CampaignError('not_found', 404);
  const signal = await resolveAudienceSignal(companyId, (campaign.audience_id as string) ?? null);
  const channels = Array.isArray(campaign.channels) && campaign.channels.length ? (campaign.channels as string[]) : DEFAULT_CHANNELS;
  const strategy = recommendStrategy(signal, channels);
  const channelPlan = recommendChannelPlan(signal, channels);
  // Snapshot the last explainable recommendation on the campaign.
  await updateCampaign(companyId, campaignId, { strategy: { strategy, channelPlan, generatedAt: now() } });
  trackEvent({ type: 'campaign.recommended', organizationId: companyId, actorId: null, entityId: campaignId, metadata: { objective: strategy.objective.value, confidence: strategy.objective.confidence } });
  return { strategy, channelPlan };
}

/** Preview a strategy for an ad-hoc audience without persisting a campaign. */
export async function previewStrategy(companyId: string, audienceId: string, channels?: string[]): Promise<{ strategy: unknown; channelPlan: unknown; signal: AudienceSignal }> {
  const signal = await resolveAudienceSignal(companyId, audienceId);
  const ch = channels?.length ? channels : DEFAULT_CHANNELS;
  return { strategy: recommendStrategy(signal, ch), channelPlan: recommendChannelPlan(signal, ch), signal };
}

/* ── Simulation (before execution; sends nothing) ───────────────────────────── */

export interface CampaignSimulation {
  audienceId: string | null;
  expectedReach: number;
  audienceOverlap: Array<{ campaignId: string; name: string; sharedMembers: number }>;
  estimatedEngagement: { engaged: number; rate: number; basis: string };
  estimatedWorkload: { touches: number; tasks: number; basis: string };
  operationalImpact: { newTasksIfExecuted: number; note: string };
  executed: false;
}

export async function simulateCampaign(companyId: string, campaignId: string): Promise<CampaignSimulation> {
  const campaign = await getCampaign(companyId, campaignId);
  if (!campaign) throw new CampaignError('not_found', 404);
  const audienceId = (campaign.audience_id as string) ?? null;
  if (!audienceId) throw new CampaignError('audience_required', 400);
  const ai = await getAudienceIntelligence(companyId, audienceId);
  const signal = toSignal(ai);
  const channels = Array.isArray(campaign.channels) && campaign.channels.length ? (campaign.channels as string[]) : DEFAULT_CHANNELS;
  const plan = recommendChannelPlan(signal, channels);
  const touches = plan.cadence.value.touches;

  // Estimated engagement — explainable weights over the intent bands (no sends).
  const engaged = Math.round(ai.intentBands.high * 0.5 + ai.intentBands.medium * 0.2 + ai.intentBands.low * 0.05);
  const overlap = await computeOverlap(companyId, campaignId, audienceId);

  return {
    audienceId,
    expectedReach: ai.members,
    audienceOverlap: overlap,
    estimatedEngagement: { engaged, rate: ai.members ? Number((engaged / ai.members).toFixed(3)) : 0, basis: 'high×0.5 + medium×0.2 + low×0.05 over intent bands' },
    estimatedWorkload: { touches, tasks: ai.members * touches, basis: `${ai.members} members × ${touches} touches` },
    operationalImpact: { newTasksIfExecuted: ai.members, note: 'One follow-up task per member if the campaign were executed (W5). Simulation only — nothing sent.' },
    executed: false,
  };
}

/** Overlap of this campaign's audience members with OTHER active campaigns' audiences. */
async function computeOverlap(companyId: string, campaignId: string, audienceId: string): Promise<Array<{ campaignId: string; name: string; sharedMembers: number }>> {
  const mine = new Set((await listMembers(companyId, audienceId, 5000)).map((m) => String((m as any).entity_id)));
  if (!mine.size) return [];
  const others = (await listCampaigns(companyId)).filter((c) => String(c.id) !== campaignId && c.audience_id);
  const out: Array<{ campaignId: string; name: string; sharedMembers: number }> = [];
  for (const c of others) {
    const theirs = await listMembers(companyId, String(c.audience_id), 5000);
    const shared = theirs.reduce((n, m) => n + (mine.has(String((m as any).entity_id)) ? 1 : 0), 0);
    if (shared > 0) out.push({ campaignId: String(c.id), name: String(c.name), sharedMembers: shared });
  }
  return out;
}

/* ── Campaign intelligence (aggregate; reuse existing scores) ────────────────── */

export async function getCampaignIntelligence(companyId: string, campaignId: string): Promise<{ audience: AudienceIntelligence | null; messages: number }> {
  const campaign = await getCampaign(companyId, campaignId);
  if (!campaign) throw new CampaignError('not_found', 404);
  const audience = campaign.audience_id ? await getAudienceIntelligence(companyId, String(campaign.audience_id)).catch(() => null) : null;
  const { count } = await ownedDbTable(MSG).select('id', { count: 'exact', head: true }).eq('company_id', companyId).is('deleted_at', null);
  return { audience, messages: count ?? 0 };
}

/* ── Reusable messaging assets ──────────────────────────────────────────────── */

export interface MessageInput { name: string; channel: string; subject?: string; body: string; buyingStage?: string; audienceFit?: Record<string, unknown>; notes?: string }

export async function createMessage(companyId: string, actorId: string | null, input: MessageInput): Promise<{ id: string }> {
  if (!input.body?.trim() || !input.name?.trim()) throw new CampaignError('name_and_body_required', 400);
  const { data, error } = await ownedDbTable(MSG).insert({
    company_id: companyId, name: input.name.trim(), channel: input.channel, subject: input.subject ?? null, body: input.body.trim(),
    buying_stage: input.buyingStage ?? null, audience_fit: input.audienceFit ?? {}, notes: input.notes ?? null, created_by: actorId,
  }).select('id').maybeSingle();
  if (error || !data) throw new CampaignError('message_create_failed', 500);
  return { id: String((data as any).id) };
}

export async function listMessages(companyId: string, channel?: string): Promise<Array<Record<string, unknown>>> {
  let q = ownedDbTable(MSG).select('*').eq('company_id', companyId).is('deleted_at', null);
  if (channel) q = q.eq('channel', channel);
  const { data } = await q.order('created_at', { ascending: false }).limit(500);
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}
