/**
 * PI-SCORE-PROVENANCE-001 — the background evaluation job.
 *
 * The job's job is to be inert until deliberately switched on, to stay inside
 * the tenants it was given, and never to end a shared cron tick because one
 * prospect misbehaved. Those are the properties that make it safe to register
 * in `cron.ts`, so they are the properties under test.
 */

import {
  runProspectScoreEvaluationJob,
  scheduledScoreTenants,
  scoreEvaluationEnabled,
  SCORE_EVALUATION_FLAG,
  SCORE_EVALUATION_TENANTS,
  SCORE_EVALUATION_BATCH,
  type ScoreEvaluationPorts,
  type DueProspect,
} from '../../jobs/prospectScoreEvaluationJob';

const due = (id: string): DueProspect => ({ prospectId: id, personId: null, accountId: null });

const NOW = '2026-09-26T00:00:00.000Z';

function ports(over: Partial<ScoreEvaluationPorts> = {}): ScoreEvaluationPorts {
  return {
    listDueProspects: jest.fn(async () => [due('p1'), due('p2')]),
    evaluateAndPersist: jest.fn(async () => 'written' as const),
    ...over,
  };
}

const ON = {
  [SCORE_EVALUATION_FLAG]: 'true',
  [SCORE_EVALUATION_TENANTS]: 'org-a',
} as unknown as NodeJS.ProcessEnv;

describe('PI-SCORE-PROVENANCE-001 — inert by default', () => {
  it('does nothing at all with no flag', async () => {
    const p = ports();
    const r = await runProspectScoreEvaluationJob(p, {} as unknown as NodeJS.ProcessEnv, NOW);
    expect(r.ran).toBe(false);
    expect(p.listDueProspects).not.toHaveBeenCalled();
  });

  it('does nothing when the flag is set to anything but true', async () => {
    const p = ports();
    const r = await runProspectScoreEvaluationJob(
      p, { [SCORE_EVALUATION_FLAG]: '1', [SCORE_EVALUATION_TENANTS]: 'org-a' } as unknown as NodeJS.ProcessEnv, NOW);
    expect(r.ran).toBe(false);
    expect(p.listDueProspects).not.toHaveBeenCalled();
  });

  it('reads NOTHING when the flag is on but no tenant is allow-listed', async () => {
    const p = ports();
    const r = await runProspectScoreEvaluationJob(
      p, { [SCORE_EVALUATION_FLAG]: 'true' } as unknown as NodeJS.ProcessEnv, NOW);
    expect(r.ran).toBe(false);
    expect(p.listDueProspects).not.toHaveBeenCalled();
  });

  it('there is no all-tenants mode — scope comes only from the allow-list', () => {
    expect(scheduledScoreTenants(undefined)).toEqual([]);
    expect(scheduledScoreTenants('')).toEqual([]);
    expect(scheduledScoreTenants('*')).toEqual(['*']); // a literal id, never a wildcard
  });

  it('deduplicates the allow-list and preserves order', () => {
    expect(scheduledScoreTenants('b, a ,b')).toEqual(['b', 'a']);
  });

  it('enablement is exactly the string true', () => {
    expect(scoreEvaluationEnabled('true')).toBe(true);
    expect(scoreEvaluationEnabled('TRUE')).toBe(true);
    expect(scoreEvaluationEnabled('yes')).toBe(false);
    expect(scoreEvaluationEnabled(undefined)).toBe(false);
  });
});

describe('PI-SCORE-PROVENANCE-001 — tenant scope and bounds', () => {
  it('asks only for the allow-listed tenants, one call each', async () => {
    const p = ports();
    await runProspectScoreEvaluationJob(
      p, { ...ON, [SCORE_EVALUATION_TENANTS]: 'org-a,org-b' } as unknown as NodeJS.ProcessEnv, NOW);
    expect(p.listDueProspects).toHaveBeenCalledTimes(2);
    expect(p.listDueProspects).toHaveBeenCalledWith('org-a', SCORE_EVALUATION_BATCH);
    expect(p.listDueProspects).toHaveBeenCalledWith('org-b', SCORE_EVALUATION_BATCH);
  });

  it('passes the injected instant through — it does not read the clock', async () => {
    const p = ports();
    await runProspectScoreEvaluationJob(p, ON, NOW);
    expect(p.evaluateAndPersist).toHaveBeenCalledWith('org-a', due('p1'), NOW);
  });

  it('bounds one tick so a backlog cannot be drained in a single run', async () => {
    expect(SCORE_EVALUATION_BATCH).toBeLessThanOrEqual(100);
  });
});

describe('PI-SCORE-PROVENANCE-001 — one failure never ends the cycle', () => {
  it('counts a throwing prospect and keeps going', async () => {
    const p = ports({
      evaluateAndPersist: jest.fn(async (_o: string, d: DueProspect) => {
        if (d.prospectId === 'p1') throw new Error('boom');
        return 'written' as const;
      }),
    });
    const r = await runProspectScoreEvaluationJob(p, ON, NOW);
    expect(r.failures).toBe(1);
    expect(r.written).toBe(1);
    expect(p.evaluateAndPersist).toHaveBeenCalledTimes(2);
  });

  it('a tenant whose listing throws does not stop the next tenant', async () => {
    const p = ports({
      listDueProspects: jest.fn(async (org: string) => {
        if (org === 'org-a') throw new Error('unreadable');
        return [due('p9')];
      }),
    });
    const r = await runProspectScoreEvaluationJob(
      p, { ...ON, [SCORE_EVALUATION_TENANTS]: 'org-a,org-b' } as unknown as NodeJS.ProcessEnv, NOW);
    expect(r.failures).toBeGreaterThanOrEqual(1);
    expect(r.evaluated).toBe(1);
  });

  it('never throws out of the tick', async () => {
    const p = ports({ listDueProspects: jest.fn(async () => { throw new Error('x'); }) });
    await expect(runProspectScoreEvaluationJob(p, ON, NOW)).resolves.toBeDefined();
  });
});

describe('PI-SCORE-PROVENANCE-001 — an unchanged evaluation is not new history', () => {
  it('reports duplicates separately from writes', async () => {
    const p = ports({ evaluateAndPersist: jest.fn(async () => 'duplicate' as const) });
    const r = await runProspectScoreEvaluationJob(p, ON, NOW);
    expect(r.written).toBe(0);
    expect(r.duplicates).toBe(2);
    expect(r.failures).toBe(0);
  });
});
