/**
 * ICP list evaluator — keeps an ICP list's membership in step with Prospect
 * Intelligence's evaluations under the ICP's RATIFIED version.
 *
 * PORTED from the parked PI program's list evaluator (pi-consol 010/010B/012)
 * onto the CANONICAL lists model (LISTS-001). The rules are the canonical model's:
 *
 *   - membership is a row; removal is SOFT (removed_at / by / reason) and a
 *     re-add is a NEW row — history is never rewritten (the parked evaluator
 *     reactivated rows in place, which destroyed removal history);
 *   - the evaluator writes only through the canonical module's SYSTEM path
 *     (`addProspectToListBySystem` / `removeProspectFromListBySystem`), with
 *     provenance `evaluator:icp`, so it is not a second membership writer;
 *   - a HUMAN decision wins: a prospect whose latest membership row was removed by
 *     a person is never re-added by the evaluator, and members a person added are
 *     never removed by it (the parked `curation = 'excluded'` rule, expressed on
 *     the canonical rows instead of a new column).
 *
 * "Evaluated under the ICP" means PI recorded an evaluation citing the ICP's
 * currently ratified version. The evaluator scores and qualifies nothing.
 */

import {
  addProspectToListBySystem, removeProspectFromListBySystem, getProspectList,
  type ListStore, type ProspectListMember,
} from './index';
import { productionListStore } from './store';
import { durableIcpEvidence, type IcpEvidencePort } from '../orchestration/icpEvidence';

export const EVALUATOR_ADDED_VIA = 'evaluator:icp';
export const EVALUATOR_REMOVAL_REASON = 'evaluator: no longer evaluated under the ratified ICP version';

export class IcpListEvaluationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'IcpListEvaluationError';
  }
}

function fail(message: string, code: string): never {
  throw new IcpListEvaluationError(message, code);
}

export interface IcpListEvaluation {
  readonly listId: string;
  readonly icpId: string;
  readonly icpVersion: number;
  readonly dryRun: boolean;
  readonly evaluated: number;
  readonly added: number;
  readonly alreadyMember: number;
  readonly removed: number;
  /** Evaluated prospects NOT re-added because a person removed them. */
  readonly keptOutByHuman: number;
}

/** Every membership row of a list, any status (removal history included). */
async function allMemberships(store: ListStore, organizationId: string, listId: string): Promise<ProspectListMember[]> {
  const out: ProspectListMember[] = [];
  let cursor: { addedAt: string; id: string } | null = null;
  for (;;) {
    const page = await store.pageMembers({ organizationId, listId, status: null, pageSize: 200, cursor });
    out.push(...page.members);
    if (!page.nextCursor) return out;
    const last = page.members[page.members.length - 1];
    cursor = { addedAt: last.addedAt, id: last.id };
  }
}

export async function evaluateIcpList(input: {
  organizationId: string;
  listId: string;
  dryRun?: boolean;
  deps?: { lists?: ListStore; evidence?: IcpEvidencePort };
}): Promise<IcpListEvaluation> {
  const store = input.deps?.lists ?? productionListStore;
  const evidence = input.deps?.evidence ?? durableIcpEvidence;
  const dryRun = input.dryRun === true;

  const list = await getProspectList(store, { organizationId: input.organizationId, listId: input.listId });
  if (list.ok === false) fail('no such list in this tenant', 'list_not_found');
  if (list.value.status === 'archived') fail('an archived list is not evaluated', 'list_archived');
  const icpId = await store.getListIcp(input.organizationId, input.listId);
  if (icpId === undefined) fail('no such list in this tenant', 'list_not_found');
  if (icpId === null) fail('a manual or intake list has no ICP to evaluate', 'list_has_no_icp');
  const icpVersion = await evidence.ratifiedVersion(input.organizationId, icpId);
  if (icpVersion === null) fail('the list\'s ICP has no ratified version; nothing is evaluated', 'icp_not_ratified');

  const evaluated = await evidence.evaluationsUnder(input.organizationId, icpId, icpVersion);
  const rows = await allMemberships(store, input.organizationId, input.listId);

  // The LATEST row per prospect decides: active, removed by a person, or removed
  // by the evaluator. Rows arrive newest first per the canonical keyset order,
  // but are re-sorted here so the rule never depends on paging order.
  const latest = new Map<string, ProspectListMember>();
  for (const r of [...rows].sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0))) {
    if (!latest.has(r.prospectId)) latest.set(r.prospectId, r);
  }

  let added = 0;
  let alreadyMember = 0;
  let keptOutByHuman = 0;
  for (const prospectId of evaluated.keys()) {
    const row = latest.get(prospectId);
    if (row?.status === 'active') { alreadyMember += 1; continue; }
    if (row && row.status === 'removed' && row.removedByUserId !== null) { keptOutByHuman += 1; continue; }
    added += 1;
    if (dryRun) continue;
    const r = await addProspectToListBySystem(store, {
      organizationId: input.organizationId, listId: input.listId, prospectId, addedVia: EVALUATOR_ADDED_VIA,
    });
    if (r.ok === false) fail(`evaluator could not add a member: ${r.refusal}`, `add_${r.refusal}`);
    if (r.value.alreadyMember) { added -= 1; alreadyMember += 1; }
  }

  let removed = 0;
  for (const [prospectId, row] of latest) {
    if (row.status !== 'active' || row.addedVia !== EVALUATOR_ADDED_VIA) continue;   // a person's member stays
    if (evaluated.has(prospectId)) continue;
    removed += 1;
    if (dryRun) continue;
    const r = await removeProspectFromListBySystem(store, {
      organizationId: input.organizationId, listId: input.listId, prospectId, removalReason: EVALUATOR_REMOVAL_REASON,
    });
    if (r.ok === false) fail(`evaluator could not remove a member: ${r.refusal}`, `remove_${r.refusal}`);
    if (r.value.alreadyRemoved) removed -= 1;
  }

  return { listId: input.listId, icpId, icpVersion, dryRun, evaluated: evaluated.size, added, alreadyMember, removed, keptOutByHuman };
}
