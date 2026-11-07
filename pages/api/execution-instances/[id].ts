import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * PI-033 — one Execution Instance.
 *
 *   GET   /api/execution-instances/:id?company_id=<uuid>      -> { instance }
 *   PATCH /api/execution-instances/:id  { lifecycleState }    -> { instance }
 *   PATCH /api/execution-instances/:id  { lifecycleState: 'active', returnDate }
 *       -> { instance, notBefore }   Prompt 4: a person resumes a PAUSED run with a
 *       structured return date ({ kind: 'date', date } | { kind: 'instant', at }); it is
 *       validated server-side (not past, within a year), retimed through the journey
 *       retiming engine, and persisted as the next step's `not_before`. Same guards.
 *   PATCH /api/execution-instances/:id  { evaluation: 'continue' | 'retime' | 'end', returnDate? }
 *       -> { instance, evaluation: { action, notBefore, cancelledSteps }, auditFailed }
 *       Prompt 5: a person evaluates the reply that paused the run (`reply_awaiting_evaluation`):
 *       continue (resume), retime (resume with a return date, `returnDate` required), end, or
 *       opt_out (G-11: an all-channel `unsubscribe` for the person is recorded, then the run
 *       ends; 409 `person_unknown` / 503 `governance_write_failed` leave the run paused).
 *       Recorded as a journey decision with the actor (`actor:<user id>`). Not given with
 *       `lifecycleState`. Nothing reaches PI (P-1 = a). Same guards.
 *
 * O2-F1: every resume of a paused run (plain, with a return date, or an evaluation) moves the
 * run only from `paused`, a compare-and-set; the loser answers 409 `resume_race_lost`.
 *
 * ─── PATCH MOVES LIFECYCLE STATE AND NOTHING ELSE ─────────────────────────
 * Identity and pinned attribution — campaign, workflow, workflow version, target,
 * subject — are immutable after creation, enforced by a database trigger. There is
 * nothing else here to edit.
 *
 * A TERMINAL instance cannot be reopened: `completed`, `cancelled` and `failed` are
 * final, and a whole-run retry is a NEW instance. That is the ratified retry
 * semantic, and it is what keeps run history honest — reopening a finished run
 * would overwrite the record that it finished.
 *
 * ─── IT ADVANCES NOTHING ON ITS OWN ───────────────────────────────────────
 * There is no scheduler, no automatic transition and no retry. This records the
 * state a caller asserts; later execution work owns actual orchestration.
 *
 * There is no DELETE: an instance is the historical record of a run.
 *
 * ─── AUTHORIZATION ────────────────────────────────────────────────────────
 * `PROSPECT_ICP_MANAGE`, the 032 interim boundary, unchanged. No capability was
 * added and the registry was not touched — the collection route records why
 * `AUTOMATION_EXECUTE` was checked and rejected.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withdrawUnsentTasks } from '../../../backend/services/orchestration/journeyExit';
import { resumeJourneyWithReturnDate } from '../../../backend/services/orchestration/journeyRetiming';
import { evaluateSuspendedReply } from '../../../backend/services/orchestration/journeyReplyEvaluation';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ICP_MANAGE } from '../../../shared/contracts/security';
import {
  getExecutionInstance, setExecutionInstanceState, compareAndSetExecutionInstanceState, ExecutionInstanceError,
  TERMINAL_LIFECYCLE_STATES, LIFECYCLE_STATES, type LifecycleState,
} from '../../../backend/services/executionInstances/executionInstanceStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'PATCH'];

const statusFor = (code: string): number => (code === 'terminal_instance' ? 409 : 400);

/**
 * A resume's or an evaluation's refusal: missing run 404; the run moved, is not awaiting this,
 * or has no person to restrict 409; the opt-out record could not be written 503 (retryable,
 * the run is still paused); a bad request 400.
 */
const CONFLICTS = ['not_paused', 'superseded', 'resume_race_lost', 'not_awaiting_evaluation', 'person_unknown'];
const evaluationStatus = (code: string): number =>
  (code === 'run_not_found' ? 404 : code === 'governance_write_failed' ? 503 : CONFLICTS.includes(code) ? 409 : 400);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const instanceId = str(req.query.id);
  if (!instanceId || !UUID.test(instanceId)) {
    return res.status(400).json({ error: 'instance id must be a uuid' });
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
    reason: 'read or advance the lifecycle state of a workflow execution instance',
  });
  if (guard.ok !== true) return;

  try {
    if (req.method === 'GET') {
      const instance = await getExecutionInstance(companyId, instanceId);
      if (!instance) return res.status(404).json({ error: 'no such execution instance' });
      return res.status(200).json({ instance });
    }

    // Prompt 5 — a person's evaluation of a reply that paused the run.
    if (body.evaluation !== undefined) {
      if (body.lifecycleState !== undefined) {
        return res.status(400).json({ error: 'give either lifecycleState or evaluation, not both', code: 'evaluation_with_lifecycle_state' });
      }
      const evaluated = await evaluateSuspendedReply({
        organizationId: companyId,                 // the VERIFIED tenant
        executionInstanceId: instanceId,
        action: body.evaluation,
        returnDate: body.returnDate,
        actorUserId: guard.principal.userId,       // the authenticated person, never the body's
      });
      if (evaluated.ok !== true) {
        return res.status(evaluationStatus(evaluated.code)).json({ error: evaluated.reason, code: evaluated.code });
      }
      return res.status(200).json({
        instance: evaluated.instance,
        evaluation: { action: evaluated.action, notBefore: evaluated.notBefore, cancelledSteps: evaluated.cancelledSteps },
        auditFailed: evaluated.auditFailed,
      });
    }

    const lifecycleState = str(body.lifecycleState);
    if (!lifecycleState || !LIFECYCLE_STATES.includes(lifecycleState as LifecycleState)) {
      return res.status(400).json({
        error: `lifecycleState must be one of ${LIFECYCLE_STATES.join(' | ')}`,
      });
    }

    if (body.returnDate !== undefined) {
      if (lifecycleState !== 'active') return res.status(400).json({ error: 'a returnDate is only given when resuming (lifecycleState: active)' });
      const resumed = await resumeJourneyWithReturnDate(companyId, instanceId, body.returnDate);
      if (resumed.ok !== true) {
        return res.status(evaluationStatus(resumed.code)).json({ error: resumed.reason, code: resumed.code });
      }
      return res.status(200).json({ instance: resumed.instance, notBefore: resumed.notBefore });
    }

    // O2-F1 — a plain resume of a PAUSED run moves it only from `paused` (a compare-and-set),
    // so it can never land in the middle of a resume with a return date and leave the run
    // active before that resume's floor exists: whichever resume moves the run first wins,
    // and the other is told it lost. Any other move keeps the existing path below.
    if (lifecycleState === 'active') {
      const current = await getExecutionInstance(companyId, instanceId);
      if (!current) return res.status(404).json({ error: 'no such execution instance' });
      if (current.lifecycleState === 'paused') {
        const moved = await compareAndSetExecutionInstanceState({
          organizationId: companyId, instanceId, expectedState: 'paused', lifecycleState: 'active',
        });
        if (moved.applied !== true) {
          if (moved.reason === 'not_found') return res.status(404).json({ error: 'no such execution instance' });
          return res.status(409).json({
            error: `the run became ${moved.current?.lifecycleState ?? 'unknown'} while this resume was being applied; it was not moved by this request`,
            code: 'resume_race_lost',
          });
        }
        return res.status(200).json({ instance: moved.instance });
      }
    }

    // A run that ended must not leave a task someone can still approve and send. Withdrawn
    // first, so a failure leaves the run open; again after, for anything created meanwhile.
    const ending = (TERMINAL_LIFECYCLE_STATES as readonly string[]).includes(lifecycleState);
    if (ending) await withdrawUnsentTasks(companyId, instanceId);
    const updated = await setExecutionInstanceState({
      organizationId: companyId,                   // the VERIFIED tenant
      instanceId,
      lifecycleState: lifecycleState as LifecycleState,
    });
    if (updated && ending) await withdrawUnsentTasks(companyId, updated.id);
    if (!updated) return res.status(404).json({ error: 'no such execution instance' });
    return res.status(200).json({ instance: updated });
  } catch (e) {
    if (e instanceof ExecutionInstanceError) {
      return res.status(statusFor(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'execution instance request failed' });
  }
}

export default __createApiRoute(handler, { route: '/api/execution-instances/[id]' });
