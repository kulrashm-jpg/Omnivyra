/**
 * PI LISTS-001 — the AUDIENCE READ CONTRACT.
 *
 * The one seam a future Workflow Engine is meant to consume. Defined now, in
 * the batch that owns lists, so that the engine does not get to invent its own
 * way of asking "who is in this audience?" later.
 *
 * ─── IT IS A READ. IT IS ONLY A READ. ─────────────────────────────────────
 * No enrolment, no execution record, no step, no schedule, no dispatch, no AI
 * decision. Those are WS-3 and WS-5 and are explicitly out of scope here.
 * Defining this contract does NOT mean workflow integration exists — nothing
 * consumes it yet, and saying otherwise would be the "contracts plus test
 * doubles reported as integration" failure the programme brief warns about.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT ANSWER ─────────────────────────────────
 *
 * ELIGIBILITY. `AudienceMember` carries no "may we contact this person" field,
 * and this module calls no suppression service. That is not an omission:
 *
 *   - `contact_governance_records` via `mayContact` is the canonical authority,
 *     and `prospectOutreach/readiness` already composes it with the
 *     recommendation. A second evaluator here would be a competing answer to a
 *     question that already has an owner.
 *   - Eligibility is answered PER ATTEMPT, immediately before dispatch, because
 *     it changes between the moment an audience is read and the moment a
 *     message is sent. Baking a stale verdict into an audience page would be
 *     worse than omitting it — it would look authoritative.
 *
 * So the engine reads membership here and asks the governance gate there, in
 * that order, every time. `eligibilityEvaluated: false` says so on every page
 * rather than leaving a reader to assume.
 *
 * ICP FIT and SCORES. Owned by `prospectIcp/evaluate` and
 * `prospect_score_evaluations`. A membership does not imply a score and this
 * contract does not carry one.
 *
 * ─── ARCHIVED LISTS ARE READABLE BUT NOT ENROLLABLE ───────────────────────
 * `readAudiencePage` returns the audience of an archived list, with
 * `listStatus: 'archived'`, because an operator reviewing history needs it. The
 * engine's own entry criteria must refuse to ENROL from a list whose status is
 * not 'active' — the flag is supplied here precisely so that refusal can be
 * made where enrolment lives, not guessed.
 */

import {
  listMembers,
  type ListStore,
  type MembershipStatus,
  type ProspectList,
} from './index';

/** One addressable member of an audience, as a Workflow Engine would read it. */
export interface AudienceMember {
  /** The canonical prospect. A REFERENCE — this contract owns no attribute. */
  readonly prospectId: string;
  readonly membershipId: string;
  readonly membershipStatus: MembershipStatus;
  /** Provenance: how, and when, this prospect entered the audience. */
  readonly addedVia: string;
  readonly addedAt: string;
  readonly addedByUserId: string | null;
}

export interface AudiencePage {
  readonly listId: string;
  readonly organizationId: string;
  readonly listName: string;
  /** 'archived' means readable but NOT enrollable. See the header. */
  readonly listStatus: ProspectList['status'];
  readonly members: readonly AudienceMember[];
  /** Opaque keyset cursor. Null on the last page. */
  readonly nextCursor: string | null;
  /**
   * ALWAYS false. Contact eligibility is not evaluated here and must be asked
   * of the governance gate per attempt. Present as a field, not a comment, so a
   * consumer cannot mistake silence for permission.
   */
  readonly eligibilityEvaluated: false;
}

export type AudienceReadResult =
  | { readonly ok: true; readonly page: AudiencePage }
  | { readonly ok: false; readonly refusal: string; readonly detail?: string };

/**
 * Read one page of a list's ACTIVE audience.
 *
 * Active-only by default and by intent: an engine enrolling from this must
 * never receive a removed membership, and making that the caller's choice is
 * how a removed prospect ends up contacted.
 */
export async function readAudiencePage(
  store: ListStore,
  input: {
    organizationId: string;
    listId: string;
    pageSize?: number;
    cursor?: string;
  },
): Promise<AudienceReadResult> {
  const list = await (async () => {
    try {
      return await store.getList(input.organizationId, input.listId);
    } catch {
      return undefined;
    }
  })();

  if (list === undefined) return { ok: false, refusal: 'store_failed' };
  if (list === null) return { ok: false, refusal: 'list_not_found' };

  const page = await listMembers(store, {
    organizationId: input.organizationId,
    listId: input.listId,
    status: 'active',
    pageSize: input.pageSize,
    cursor: input.cursor,
  });

  if (page.ok === false) {
    return page.detail === undefined
      ? { ok: false, refusal: page.refusal }
      : { ok: false, refusal: page.refusal, detail: page.detail };
  }

  return {
    ok: true,
    page: {
      listId: list.id,
      organizationId: list.organizationId,
      listName: list.name,
      listStatus: list.status,
      members: page.value.members.map((m) => ({
        prospectId: m.prospectId,
        membershipId: m.id,
        membershipStatus: m.status,
        addedVia: m.addedVia,
        addedAt: m.addedAt,
        addedByUserId: m.addedByUserId,
      })),
      nextCursor: page.value.nextCursor,
      eligibilityEvaluated: false,
    },
  };
}

/**
 * May a Workflow Engine enrol from this list?
 *
 * A capability answer about the LIST, not about any person in it. It says
 * nothing about whether a given member may be contacted, which is the
 * governance gate's question and is asked per attempt.
 */
export function isListEnrollable(list: Pick<ProspectList, 'status'> | null): boolean {
  return list?.status === 'active';
}
