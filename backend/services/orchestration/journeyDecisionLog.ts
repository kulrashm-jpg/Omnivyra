/**
 * The durable journey decision record — THE writer of
 * `execution_journey_decisions` (20270120000000).
 *
 * Each decision is recorded the FIRST time it is reached, keyed by what was decided
 * rather than when: a step waiting on approval for a week is one row, and the moment
 * it changes to `needs_human` is another. Replays and concurrent sweeps converge on
 * the unique key.
 *
 * Recording never gates a journey: an engine has already acted or refused by the
 * time a decision exists, so a failed write is reported to the caller and the next
 * sweep reaches, and records, the same decision again.
 *
 * Codes and condition descriptions only. Never a fact value, address or content.
 */

import { ownedDbTable } from '../../db/writeOwner';

export const JOURNEY_DECISIONS_TABLE = 'execution_journey_decisions';

export type JourneyDecisionKind =
  | 'executed' | 'skipped' | 'deferred' | 'waiting' | 'needs_human' | 'unsupported' | 'exited';

export interface JourneyDecisionInput {
  readonly executionInstanceId: string;
  /** Null only for the run-level `exited`. */
  readonly planStepId: string | null;
  readonly stepKey: string | null;
  readonly channel: string | null;
  readonly engine: string | null;
  readonly decision: JourneyDecisionKind;
  readonly outcome: string | null;
  readonly reasons: readonly string[];
}

export interface RecordedJourneyDecision extends JourneyDecisionInput {
  readonly id: string;
  readonly decidedAt: string;
}

const COLUMNS = 'id, execution_instance_id, plan_step_id, step_key, channel, engine, decision, outcome, reasons, decided_at';

/** What makes two decisions "the same". The reason text is deliberately not part of it: a deferral's wording changes every sweep. */
export const journeyDecisionKey = (d: JourneyDecisionInput): string =>
  `${d.planStepId ?? 'run'}|${d.decision}|${d.outcome ?? ''}`;

/** Returns how many could not be written; a repeat is not a failure. Never throws. */
export async function recordJourneyDecisions(
  organizationId: string,
  decisions: readonly JourneyDecisionInput[],
): Promise<{ failed: number; firstError: string | null }> {
  let failed = 0;
  let firstError: string | null = null;
  for (const d of decisions) {
    let error: { code?: string; message?: string } | null = null;
    try {
      const res = await ownedDbTable(JOURNEY_DECISIONS_TABLE)
        .insert({
          organization_id: organizationId,
          execution_instance_id: d.executionInstanceId,
          plan_step_id: d.planStepId,
          step_key: d.stepKey,
          channel: d.channel,
          engine: d.engine,
          decision: d.decision,
          outcome: d.outcome,
          reasons: [...d.reasons],
          decision_key: journeyDecisionKey(d),
        })
        .select('id');
      error = (res.error as typeof error) ?? null;
    } catch (e) {
      error = { message: e instanceof Error ? e.message : String(e) };
    }
    if (error && error.code !== '23505') {
      failed += 1;
      firstError = firstError ?? String(error.message ?? error.code ?? 'decision write failed').slice(0, 200);
    }
  }
  return { failed, firstError };
}

const toDecision = (r: Record<string, unknown>): RecordedJourneyDecision => ({
  id: String(r.id),
  executionInstanceId: String(r.execution_instance_id),
  planStepId: r.plan_step_id == null ? null : String(r.plan_step_id),
  stepKey: r.step_key == null ? null : String(r.step_key),
  channel: r.channel == null ? null : String(r.channel),
  engine: r.engine == null ? null : String(r.engine),
  decision: String(r.decision) as JourneyDecisionKind,
  outcome: r.outcome == null ? null : String(r.outcome),
  reasons: Array.isArray(r.reasons) ? (r.reasons as unknown[]).map(String) : [],
  decidedAt: String(r.decided_at),
});

/** One run's decisions, oldest first. Tenant first. */
export async function listJourneyDecisions(
  organizationId: string,
  executionInstanceId: string,
): Promise<RecordedJourneyDecision[]> {
  const res = await ownedDbTable(JOURNEY_DECISIONS_TABLE)
    .select(COLUMNS)
    .eq('organization_id', organizationId)
    .eq('execution_instance_id', executionInstanceId)
    .order('decided_at', { ascending: true });
  if (res.error) {
    throw Object.assign(new Error('journey decisions unreadable'), { code: 'decisions_unreadable' });
  }
  return ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map(toDecision);
}
