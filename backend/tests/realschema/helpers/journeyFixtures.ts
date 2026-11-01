/**
 * Real rows and real services for journey suites. Requires the suite to have mocked the
 * transport with pgTransport first, so the service modules load lazily here.
 */
import { db } from '../setup';

type Row = Record<string, unknown>;

/* eslint-disable @typescript-eslint/no-var-requires */
const svc = () => ({
  lists: require('../../../services/prospectLists'),
  store: require('../../../services/prospectLists/store').productionListStore,
  campaigns: require('../../../services/prospectCampaigns/prospectCampaignStore'),
  attach: require('../../../services/prospectCampaigns/campaignListStore'),
  select: require('../../../services/prospectCampaigns/campaignSelectionService').selectCampaignTargets,
  enroll: require('../../../services/orchestration/campaignEnrollment').enrollCampaignTargets,
  workflows: require('../../../services/workflows/workflowStore'),
});
/* eslint-enable @typescript-eslint/no-var-requires */

export const rnd = () => Math.random().toString(36).slice(2, 10);
export const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as Row;
export const rows = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as Row[];

export async function newUser(): Promise<string> {
  return String((await one('INSERT INTO public.users (email) VALUES ($1) RETURNING id', [`orch-${rnd()}@example.test`])).id);
}

export async function newProspect(
  org: string,
  contact: { email?: string; phone?: string; firstName?: string | null } = {},
): Promise<{ prospectId: string; personId: string }> {
  const key = `orch-${rnd()}`;
  const personId = String((await one(
    'INSERT INTO public.unified_persons (company_id, primary_email, primary_phone, first_name) VALUES ($1,$2,$3,$4) RETURNING id',
    [org, contact.email ?? null, contact.phone ?? null, contact.firstName === undefined ? 'Ana' : contact.firstName],
  )).id);
  const u = await one(`INSERT INTO public.canonical_users (company_id, user_type, device, external_user_key)
    VALUES ($1,'known','desktop',$2) RETURNING id`, [org, `${key}-u`]);
  const prospectId = String((await one(`INSERT INTO public.canonical_leads (company_id, user_id, source, external_lead_key, unified_person_id)
    VALUES ($1,$2,'orch',$3,$4) RETURNING id`, [org, u.id, key, personId])).id);
  return { prospectId, personId };
}

export async function enableOutreach(org: string, channels: string[]): Promise<void> {
  await db.query(`INSERT INTO public.outreach_governance_config (company_id, enabled, enabled_channels)
    VALUES ($1, true, $2) ON CONFLICT (company_id) DO UPDATE SET enabled = true, enabled_channels = $2`, [org, channels]);
}

export const humanStep = (key: string, channel: string, extra: Row = {}) =>
  ({ key, channel, delay_after_previous_hours: 0, execution_mode: 'human', ...extra });
export const emailStep = (key: string) =>
  humanStep(key, 'email', { instruction: `Hello {{first_name}}, about ${key}\nBody of ${key}` });

export async function enrol(org: string, actor: string, prospectId: string, definition: Row): Promise<{ instanceId: string; workflowId: string; report: Row }> {
  const s = svc();
  const l = await s.lists.createProspectList(s.store, { organizationId: org, name: `list-${rnd()}`, actorUserId: actor });
  await s.lists.addProspectToList(s.store, { organizationId: org, listId: l.value.id, prospectId, addedVia: 'manual', actorUserId: actor });
  const campaignId = String((await s.campaigns.createProspectCampaign({ organizationId: org, name: `camp-${rnd()}`, status: 'active' })).id);
  await s.attach.attachListToCampaign({ organizationId: org, campaignId, listId: l.value.id, actorUserId: actor });
  await s.select({ organizationId: org, campaignId, selectionKey: rnd(), origin: 'human', actorUserId: actor });
  const wf = await s.workflows.createWorkflow({ organizationId: org, name: `wf-${rnd()}`, actorUserId: actor });
  const draft = await s.workflows.createDraftVersion({ organizationId: org, workflowId: wf.id, definition, actorUserId: actor });
  await s.workflows.publishWorkflowVersion({ organizationId: org, versionId: draft.id, actorUserId: actor });
  const report = await s.enroll({ organizationId: org, campaignId, workflowId: wf.id });
  const out = report.outcomes.find((o: Row) => o.prospectId === prospectId);
  return { instanceId: out?.instanceId as string, workflowId: String(wf.id), report };
}

export const lifecycle = (org: string, prospectId: string) => rows(
  'SELECT state, origin, evidence_kind, source_event_key FROM public.prospect_lifecycle_transitions WHERE organization_id = $1 AND prospect_id = $2 ORDER BY seq',
  [org, prospectId],
);
export const instanceState = async (id: string) =>
  String((await one('SELECT lifecycle_state s FROM public.execution_instances WHERE id = $1', [id])).s);
export const handoffTasks = (id: string) => rows(
  `SELECT t.id, t.status FROM public.outreach_bridge_handoffs h JOIN public.outreach_tasks t ON t.id = h.outreach_task_id
    WHERE h.execution_instance_id = $1 ORDER BY t.task_order`, [id],
) as Promise<Array<{ id: string; status: string }>>;
export const decisions = (instanceId: string) => rows(
  'SELECT step_key, decision, outcome, reasons FROM public.execution_journey_decisions WHERE execution_instance_id = $1 ORDER BY decided_at, step_key',
  [instanceId],
);
