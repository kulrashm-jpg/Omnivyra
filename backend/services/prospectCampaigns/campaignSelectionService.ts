/**
 * Campaign selection — who a campaign targets, recorded as immutable targets.
 *
 * PORTED from the parked PI program's selection producer (pi-consol 030) onto the
 * CANONICAL lists model (LISTS-001) and the targeting added in 20261231000000.
 *
 * One call is ONE selection occurrence across every list attached to the
 * campaign. For each ACTIVE member of each ACTIVE attached list:
 *
 *   manual campaign  → selected (manual and intake lists need no ICP);
 *   ICP campaign     → selected only when Prospect Intelligence has evaluated the
 *                      prospect under the campaign's pinned, ratified ICP version
 *                      (and, when set, scored at least `minIcpScore`); otherwise
 *                      excluded WITH A REASON.
 *
 * It composes canonical reads and re-derives nothing: membership comes from the
 * canonical list module, ICP evidence from PI's own evaluations (icpEvidence.ts).
 * It scores nothing and qualifies nothing.
 *
 * IDEMPOTENT: the caller supplies the occurrence key; a retry re-finds the same
 * targets (`reused`), a new key is a deliberate re-selection.
 *
 * PREVIEW (`dryRun`): the same evaluation, nothing written — the population,
 * the would-be targets and every exclusion reason.
 */

import {
  getProspectCampaign, getCampaignTargeting, type CampaignTargeting,
} from './prospectCampaignStore';
import { listCampaignListAttachments } from './campaignListStore';
import {
  buildSelectionEventKey, createCampaignTarget, type TargetOrigin,
} from './campaignTargetStore';
import { getProspectList, listMembers, type ListStore } from '../prospectLists';
import { productionListStore } from '../prospectLists/store';
import { durableIcpEvidence, type IcpEvidencePort } from '../orchestration/icpEvidence';

export class CampaignSelectionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'CampaignSelectionError';
  }
}

function fail(message: string, code: string): never {
  throw new CampaignSelectionError(message, code);
}

/** Why a member of an attached list did not become a target. Closed set. */
export type SelectionExclusion =
  | 'not_evaluated_under_icp'
  | 'below_min_icp_score'
  | 'list_archived'
  | 'list_not_found';

export interface SelectionReport {
  readonly organizationId: string;
  readonly campaignId: string;
  readonly targeting: CampaignTargeting;
  readonly selectionEventKey: string;
  readonly dryRun: boolean;
  /** Distinct prospects across all attached lists' active members. */
  readonly population: number;
  /** (list, prospect) pairs that were (or, in preview, would be) targets. */
  readonly selected: number;
  readonly created: number;
  readonly reused: number;
  readonly excluded: Record<SelectionExclusion, number>;
  readonly lists: ReadonlyArray<{ listId: string; considered: number; selected: number; excluded: number; skipped: SelectionExclusion | null }>;
  /** Preview only: the would-be targets (bounded). */
  readonly preview: ReadonlyArray<{ listId: string; prospectId: string; scoreEvaluationId: string | null }>;
}

const PAGE_SIZE = 200;
const MAX_PREVIEW = 200;

async function activeMembers(store: ListStore, organizationId: string, listId: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await listMembers(store, { organizationId, listId, status: 'active', pageSize: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    if (page.ok === false) fail(`list members unreadable: ${page.refusal}`, 'members_unreadable');
    out.push(...page.value.members.map((m) => m.prospectId));
    if (!page.value.nextCursor) return out;
    cursor = page.value.nextCursor;
  }
}

export async function selectCampaignTargets(input: {
  organizationId: string;
  campaignId: string;
  /** The caller's name for this selection occurrence. */
  selectionKey: string;
  origin: TargetOrigin;
  actorUserId: string | null;
  dryRun?: boolean;
  deps?: { lists?: ListStore; evidence?: IcpEvidencePort };
}): Promise<SelectionReport> {
  const lists = input.deps?.lists ?? productionListStore;
  const evidence = input.deps?.evidence ?? durableIcpEvidence;
  const dryRun = input.dryRun === true;
  const selectionEventKey = buildSelectionEventKey(input.origin, input.selectionKey);

  const campaign = await getProspectCampaign(input.organizationId, input.campaignId);
  if (!campaign) fail('no such campaign in this tenant', 'campaign_not_found');
  if (campaign.status === 'archived') fail('an archived campaign selects no one', 'campaign_archived');
  const targeting = await getCampaignTargeting(input.organizationId, input.campaignId);
  if (!targeting) fail('no such campaign in this tenant', 'campaign_not_found');

  // An ICP campaign's authority must still be valid at selection time.
  if (targeting.mode === 'icp') {
    const status = await evidence.versionStatus(input.organizationId, targeting.icpId as string, targeting.icpVersion as number);
    if (status === null) fail('the campaign\'s ICP version does not exist in this tenant', 'icp_version_not_found');
    if (status !== 'ratified' && status !== 'superseded') {
      fail(`the campaign's ICP version is ${status}; an ICP campaign selects only under a ratified version`, 'campaign_icp_not_ratified');
    }
  }

  const attachments = await listCampaignListAttachments(input.organizationId, input.campaignId);
  const excluded: Record<SelectionExclusion, number> = {
    not_evaluated_under_icp: 0, below_min_icp_score: 0, list_archived: 0, list_not_found: 0,
  };
  const listReports: Array<{ listId: string; considered: number; selected: number; excluded: number; skipped: SelectionExclusion | null }> = [];
  const preview: Array<{ listId: string; prospectId: string; scoreEvaluationId: string | null }> = [];
  const population = new Set<string>();
  let selected = 0;
  let created = 0;
  let reused = 0;

  for (const { listId } of attachments) {
    const list = await getProspectList(lists, { organizationId: input.organizationId, listId });
    if (list.ok === false) {
      excluded.list_not_found += 1;
      listReports.push({ listId, considered: 0, selected: 0, excluded: 0, skipped: 'list_not_found' });
      continue;
    }
    if (list.value.status === 'archived') {
      excluded.list_archived += 1;
      listReports.push({ listId, considered: 0, selected: 0, excluded: 0, skipped: 'list_archived' });
      continue;
    }

    const members = await activeMembers(lists, input.organizationId, listId);
    members.forEach((p) => population.add(p));
    const icpEvidence = targeting.mode === 'icp'
      ? await evidence.evaluationsUnder(input.organizationId, targeting.icpId as string, targeting.icpVersion as number, members)
      : null;

    let listSelected = 0;
    let listExcluded = 0;
    for (const prospectId of members) {
      let scoreEvaluationId: string | null = null;
      if (icpEvidence !== null) {
        const ev = icpEvidence.get(prospectId);
        if (!ev) { excluded.not_evaluated_under_icp += 1; listExcluded += 1; continue; }
        if (targeting.minIcpScore !== null && !(ev.scoreIcp !== null && ev.scoreIcp >= targeting.minIcpScore)) {
          excluded.below_min_icp_score += 1; listExcluded += 1; continue;
        }
        scoreEvaluationId = ev.evaluationId;
      }
      listSelected += 1;
      selected += 1;
      if (dryRun) {
        if (preview.length < MAX_PREVIEW) preview.push({ listId, prospectId, scoreEvaluationId });
        continue;
      }
      const r = await createCampaignTarget({
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        listId,
        prospectId,
        selectionEventKey,
        origin: input.origin,
        actorUserId: input.actorUserId,
        icpId: targeting.mode === 'icp' ? targeting.icpId : null,
        icpVersion: targeting.mode === 'icp' ? targeting.icpVersion : null,
        scoreEvaluationId,
      });
      if (r.created) created += 1; else reused += 1;
    }
    listReports.push({ listId, considered: members.length, selected: listSelected, excluded: listExcluded, skipped: null });
  }

  return {
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    targeting,
    selectionEventKey,
    dryRun,
    population: population.size,
    selected,
    created,
    reused,
    excluded,
    lists: listReports,
    preview,
  };
}
