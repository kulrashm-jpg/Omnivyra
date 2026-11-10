import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * PI-033 — a Campaign's Execution Instances.
 *
 *   GET  /api/prospect-campaigns/:id/execution-instances?company_id=<uuid>
 *        -> { instances }
 *   POST /api/prospect-campaigns/:id/execution-instances
 *        { workflowId, subjectKind, subjectId, targetId? }   -> { instance }
 *
 * ─── WHY THE CAMPAIGN IS A PATH PARENT ────────────────────────────────────
 * An earlier draft took `campaignId` in the query and body on a flat
 * `/api/execution-instances` route, and the route-auth gate correctly failed it
 * (R3): a route that accepts a campaign identifier must bind that campaign to the
 * authorized tenant, and the gate could not see that the store and the creation
 * function do so.
 *
 * Two tempting fixes were rejected. Passing the id into
 * `enforceCompanyAccess({ campaignId })` would have turned the gate green while
 * proving NOTHING: that binder resolves against the CONTENT `campaigns` table via
 * `campaignOwnershipService`, so a `prospect_campaigns` id is simply absent there
 * and treated as "does not exist yet", which is allowed. An allowlist entry would
 * have recorded an exception where no exception is needed.
 *
 * So the campaign became a path parent, which is what every other
 * `prospect-campaigns/:id/*` sub-resource already does — lists, targets, select —
 * and the bind is explicit below.
 *
 * ─── THE BIND ─────────────────────────────────────────────────────────────
 * `getProspectCampaign(companyId, campaignId)` is tenant-scoped, so a campaign
 * belonging to another tenant answers 404 — the same answer as one that does not
 * exist, which is the point. The creation function re-checks and remains
 * authoritative.
 *
 * ─── THE CALLER NAMES A WORKFLOW, NEVER A VERSION ─────────────────────────
 * There is deliberately no `workflowVersionId` parameter: the system resolves the
 * workflow's current published Version by 032's status invariant and pins it.
 *
 * ─── CREATING AN INSTANCE EXECUTES NOTHING ────────────────────────────────
 * It records that a run was invoked. No Plan, Step, Task or Message is created,
 * nothing is scheduled or dispatched, no state advances on its own, and no
 * permission to contact anyone is conferred — `mayContact` and the dispatch chain
 * remain authoritative and untouched.
 *
 * ─── AUTHORIZATION: THE 032 INTERIM BOUNDARY, UNCHANGED ───────────────────
 * `PROSPECT_ICP_MANAGE`. 033 adds no capability and does not touch the registry.
 * `AUTOMATION_EXECUTE` was checked and rejected: it gates
 * `pages/api/campaigns/[id]/release.ts` and `pages/api/admin/autonomous.ts` — the
 * CONTENT campaign domain and the autonomous admin switch — so using it here would
 * conflate domains exactly as `CAMPAIGN_EXECUTE` would, which 014 rejected on the
 * same grounds.
 *
 * The widening is stated rather than implied: holders of `PROSPECT_ICP_MANAGE` —
 * COMPANY_ADMIN and above — can now also create and transition Execution Instances.
 * That extends the interim boundary 032 recorded to this substrate, and it stands
 * until a dedicated capability is ratified. PI-034 reuses it unchanged and adds no
 * capability: holders of `PROSPECT_ICP_MANAGE` can invoke an Execution Instance.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PI-034 — THIS POST IS THE CANONICAL INVOCATION ACTION
 * ══════════════════════════════════════════════════════════════════════════
 * 034 did not add a second endpoint. The owner ratified wrapping THIS action
 * instead, because a second creating endpoint under the same capability would be
 * the "multiple competing invocation endpoints" the brief forbids, and because the
 * store remains the single Execution Instance mutation owner either way.
 *
 * ─── INVOCATION IDENTITY: WHY THE CALLER SUPPLIES IT ──────────────────────
 * 033 could not tell a RETRY of one invocation from an INTENTIONAL new run. Both
 * arrived as "create an instance for this workflow and subject" and both got the
 * same 409. Nothing in the request distinguished them, and nothing in the schema
 * could: the difference is the caller's INTENT, which exists only at the caller.
 *
 * So invocation identity is the caller's `Idempotency-Key`, carried by the
 * repository's existing `withIdempotency` middleware (caller-scoped per OR-09,
 * stored in `api_idempotency_keys`). It is MANDATORY, which is that middleware's
 * own contract — a POST without the header is 400, exactly as for every other
 * adopter. Nothing was invented and no table was added.
 *
 * Deliberately NOT used as the invocation key:
 *   • The Target. A Target is a PI SELECTION fact; it can back invocations of
 *     several different workflows, and a `lead` subject has no Target at all. One
 *     Target does NOT mean one run.
 *   • The selection event key. Selecting a prospect is not invoking a workflow.
 *   • Any server-minted value, which would make every retry a new invocation.
 *
 * ─── THE FOUR ANSWERS A CALLER CAN NOW TELL APART ─────────────────────────
 *   201 + a new id          a new run was recorded
 *   201 replayed            same key, same payload: your request was already
 *                           accepted, and this is that same instance
 *   409 IDEMPOTENCY_CONFLICT same key, DIFFERENT payload
 *   409 already_active      a DIFFERENT active run blocks this invocation, and
 *                           `activeInstanceId` says which
 * The first two come from the middleware; the last from 033's partial unique
 * index, which stays the final authority. No read-then-write check guards
 * uniqueness: concurrent invocations are adjudicated by the index.
 *
 * ─── 034 STOPS HERE ───────────────────────────────────────────────────────
 * Invocation records that a workflow was invoked. It still creates no Plan, Step,
 * Task or Message, schedules nothing, dispatches nothing, calls no planner and no
 * provider, and the instance is born in `created` and does not advance.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../../shared/contracts/security';
import { withIdempotency } from '../../../../backend/middleware/withIdempotency';
import {
  createExecutionInstance, listCampaignExecutionInstances, getOccupiedExecutionInstance,
  ExecutionInstanceError, SUBJECT_KINDS, type SubjectKind,
} from '../../../../backend/services/executionInstances/executionInstanceStore';
import { getProspectCampaign } from '../../../../backend/services/prospectCampaigns/prospectCampaignStore';
import { checkEnrollmentEligibility } from '../../../../backend/services/orchestration/enrollment';
import { checkUncertainAcknowledgement, acknowledgementRefusalBody } from '../../../../backend/services/orchestration/uncertainCommunicationAcknowledgement';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST'];

const statusFor = (code: string): number => {
  if (code === 'already_active') return 409;
  if (code === 'workflow_not_found' || code === 'subject_not_found'
      || code === 'campaign_not_found') return 404;
  if (code === 'workflow_not_active' || code === 'no_published_version') return 409;
  return 400;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = str(req.query.id);
  if (!campaignId || !UUID.test(campaignId)) {
    return res.status(400).json({ error: 'campaign id must be a uuid' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = str(req.query.company_id) ?? str(body.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ICP_MANAGE,
    organizationId: companyId,
    reason: 'record an invocation of a workflow for a prospect or lead subject',
  });
  // `ok !== true`, not `!ok`: `{ ok:false, sent:true }` is truthy and the root
  // tsconfig sets `strict: false`, disabling narrowing on a negated boolean.
  if (guard.ok !== true) return;

  // THE BIND. Tenant-scoped, so another tenant's campaign is a 404.
  const campaign = await getProspectCampaign(companyId, campaignId);
  if (!campaign) return res.status(404).json({ error: 'no such campaign' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json({
        instances: await listCampaignExecutionInstances(companyId, campaignId),
      });
    }

    const workflowId = str(body.workflowId);
    const subjectKind = str(body.subjectKind);
    const subjectId = str(body.subjectId);
    if (!workflowId || !UUID.test(workflowId)) {
      return res.status(400).json({ error: 'workflowId must be a uuid' });
    }
    if (!subjectKind || !SUBJECT_KINDS.includes(subjectKind as SubjectKind)) {
      return res.status(400).json({
        error: `subjectKind must be one of ${SUBJECT_KINDS.join(' | ')}`,
      });
    }
    if (!subjectId) return res.status(400).json({ error: 'subjectId is required' });

    // ORCHESTRATION — the version's enrollment rules, against this person's facts.
    // Ineligible is a decision with reasons, not an error; nothing is recorded.
    const eligibility = await checkEnrollmentEligibility({
      organizationId: companyId,
      workflowId,
      subject: { kind: subjectKind as SubjectKind, id: subjectId },
    });
    if (!eligibility.eligible) {
      return res.status(422).json({
        error: 'the individual does not meet this workflow version\'s enrollment conditions',
        code: 'not_eligible',
        // OUTPUT only: the version the person was assessed against. No route
        // accepts a version as input — the store resolves the published one.
        assessedVersion: eligibility.assessedVersionId,
        reasons: eligibility.reasons,
      });
    }

    // Follow-up E: enrolling a person with an unresolved uncertain communication from an
    // earlier run needs that possible send acknowledged (and recorded) first; it approves
    // nothing. Under withIdempotency the acknowledged retry is a new body, so a new key.
    const acknowledgement = await checkUncertainAcknowledgement({
      organizationId: companyId, operation: 'reenrol',
      scope: { kind: 'subject', subjectKind, subjectId, campaignId, workflowId },
      actorUserId: guard.principal.userId, acknowledgementKey: body.acknowledgeUncertain, onUnreadable: 'refuse',
    });
    if (acknowledgement.ok !== true) return res.status(acknowledgement.status).json(acknowledgementRefusalBody(acknowledgement));

    const instance = await createExecutionInstance({
      organizationId: companyId,                   // the VERIFIED tenant, never the body's
      campaignId,                                  // the BOUND campaign, from the path
      workflowId,                                  // a WORKFLOW; the version is resolved
      subjectKind: subjectKind as SubjectKind,
      subjectId,
      ...(body.targetId === undefined || body.targetId === null
        ? {}
        : { targetId: String(body.targetId) }),
    });
    return res.status(201).json({ instance, acknowledgement: acknowledgement.acknowledged });
  } catch (e) {
    if (e instanceof ExecutionInstanceError) {
      // PI-034 — name the run that is in the way. The caller already knows a
      // retry replays, so a bare 409 here would leave only "something blocks
      // this" without saying what. The id is read through the occupancy
      // predicate, which is the same set the unique index constrains, so this
      // answer and that refusal can never disagree. It is reported, never
      // reused: re-entry is a new instance once the previous run is terminal.
      if (e.code === 'already_active') {
        let activeInstanceId: string | null = null;
        try {
          const occupied = await getOccupiedExecutionInstance(
            companyId, campaignId, String(body.workflowId),
            String(body.subjectKind) as SubjectKind, String(body.subjectId),
          );
          activeInstanceId = occupied ? occupied.id : null;
        } catch { activeInstanceId = null; }
        return res.status(409).json({ error: e.message, code: e.code, activeInstanceId });
      }
      return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'execution instance request failed' });
  }
}

// PI-034 — the invocation wrapper. `methods: ['POST']` so GET stays a plain
// read: a list has no invocation identity to carry. The gate treats this wrapper
// as transparent and still analyses the handler below it.
export default __createApiRoute(
  withIdempotency(handler, {
    scope: 'pi-execution-instance-invoke',
    methods: ['POST'],
  }),
  { route: '/api/prospect-campaigns/[id]/execution-instances' },
);
