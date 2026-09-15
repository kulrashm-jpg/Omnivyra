/**
 * SEC-C5 (STEP 3AH-91) — queue processors re-verify the tenant ids in job
 * payloads before billing or any side effect.
 *
 * The database is faked (the campaign ownership authority runs for real on
 * top of it); billing admission is replaced by a sentinel that throws
 * PAST_BINDING, so "rejected" and "got past the binding" are unambiguous.
 *
 * Fixture: company A owns camp-a (+ daily-plan row row-a1); company B owns
 * camp-b (+ row-b1).
 */
import fs from 'fs';
import path from 'path';

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {};
const writes: Array<{ table: string; op: string }> = [];
let failTable: string | null = null;

function resetDb() {
  TABLES.campaign_versions = [
    { campaign_id: 'camp-a', company_id: 'comp-a', created_at: '2026-01-01', campaign_snapshot: {} },
    { campaign_id: 'camp-b', company_id: 'comp-b', created_at: '2026-01-01', campaign_snapshot: {} },
  ];
  TABLES.campaigns = [
    { id: 'camp-a', company_id: 'comp-a' },
    { id: 'camp-b', company_id: 'comp-b' },
  ];
  TABLES.daily_content_plans = [
    { id: 'row-a1', campaign_id: 'camp-a' },
    { id: 'row-b1', campaign_id: 'camp-b' },
  ];
  writes.length = 0;
  failTable = null;
}

function from(table: string) {
  const filters: Array<[string, unknown]> = [];
  const result = () => {
    if (failTable === table) return { data: null, error: { message: 'boom' } };
    const rows = (TABLES[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    return { data: rows[0] ?? null, error: null };
  };
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, order: chain, limit: chain,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    maybeSingle: async () => result(),
    single: async () => result(),
    upsert: (..._a: unknown[]) => { writes.push({ table, op: 'upsert' }); return b; },
    update: (..._a: unknown[]) => { writes.push({ table, op: 'update' }); return b; },
    insert: (..._a: unknown[]) => { writes.push({ table, op: 'insert' }); return b; },
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
  });
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => from(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => from(t) }));

const admission = jest.fn(async () => { throw new Error('PAST_BINDING'); });
const shadow = jest.fn();
jest.mock('../../services/billing/admissionControl', () => ({ evaluateActivityAdmission: (...a: unknown[]) => admission(...(a as [])) }));
jest.mock('../../services/billing/creditEconomyShadow', () => ({ emitCreditEconomyShadowEvaluation: (...a: unknown[]) => shadow(...(a as [])) }));

// eslint-disable-next-line import/first
import { processCampaignPlanningJob } from '../../queue/jobProcessors/campaignPlanningProcessor';
// eslint-disable-next-line import/first
import { processCreatorContentJob } from '../../queue/jobProcessors/creatorContentProcessor';

beforeEach(() => {
  resetDb();
  admission.mockClear();
  shadow.mockClear();
});

const planningJob = (data: Record<string, unknown>) =>
  ({ id: 'job-1', name: 'campaign-planning', data, attemptsMade: 0, opts: {} }) as never;

describe('ai-heavy campaign-planning processor', () => {
  it("refuses company A's billing with company B's campaign — before billing, before any write", async () => {
    await expect(processCampaignPlanningJob(planningJob({ jobId: 'j', campaignId: 'camp-b', companyId: 'comp-a' })))
      .rejects.toMatchObject({ name: 'JobTenantBindingError', ownership: 'foreign' });
    expect(admission).not.toHaveBeenCalled();
    expect(shadow).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('refuses a job with no companyId (it used to skip billing and run for anyone)', async () => {
    await expect(processCampaignPlanningJob(planningJob({ jobId: 'j', campaignId: 'camp-b' })))
      .rejects.toMatchObject({ name: 'JobTenantBindingError', ownership: 'missing_ids' });
    expect(writes).toEqual([]);
  });

  it('refuses an unknown campaign (the producer guarantees it exists)', async () => {
    await expect(processCampaignPlanningJob(planningJob({ jobId: 'j', campaignId: 'camp-zzz', companyId: 'comp-a' })))
      .rejects.toMatchObject({ name: 'JobTenantBindingError', ownership: 'not_found' });
  });

  it('retries (plain error) on a lookup failure instead of failing open', async () => {
    failTable = 'campaign_versions';
    const err = await processCampaignPlanningJob(planningJob({ jobId: 'j', campaignId: 'camp-a', companyId: 'comp-a' })).catch((e) => e);
    expect(String(err?.message)).toMatch(/will retry/);
    expect(err?.name).not.toBe('JobTenantBindingError');
    expect(admission).not.toHaveBeenCalled();
  });

  it('lets the legitimate pairing through to billing admission', async () => {
    await expect(processCampaignPlanningJob(planningJob({ jobId: 'j', campaignId: 'camp-a', companyId: 'comp-a' })))
      .rejects.toThrow('PAST_BINDING');
    expect(admission).toHaveBeenCalledTimes(1);
  });
});

const creatorJob = (data: Record<string, unknown>) =>
  ({ id: 'cjob-1', data, attemptsMade: 0, opts: { attempts: 3 }, updateProgress: jest.fn() }) as never;
const boltPayload = (over: Record<string, unknown>) => ({
  campaign_id: 'camp-a', company_id: 'comp-a', user_id: null, daily_plan_id: 'row-a1',
  parsed_content: {}, topic: 't', content_type: 'carousel', platform: 'linkedin',
  audience: '', objective: '', summary: '', template_id: null, max_retries: 3, ...over,
});

describe('creator-content processor — BOLT row jobs', () => {
  it("refuses a BOLT row job naming company B's campaign under company A", async () => {
    await expect(processCreatorContentJob(creatorJob({
      company_id: 'comp-a', content_type: 'carousel', bolt_payload: boltPayload({ campaign_id: 'camp-b', daily_plan_id: 'row-b1' }),
    }))).rejects.toMatchObject({ name: 'JobTenantBindingError', ownership: 'foreign' });
    expect(admission).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('refuses a daily-plan row that belongs to another campaign (object-id swap)', async () => {
    await expect(processCreatorContentJob(creatorJob({
      company_id: 'comp-a', content_type: 'carousel', bolt_payload: boltPayload({ daily_plan_id: 'row-b1' }),
    }))).rejects.toMatchObject({ name: 'JobTenantBindingError', ownership: 'row_not_in_campaign' });
    expect(admission).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('refuses a payload whose billing company differs from the row company', async () => {
    await expect(processCreatorContentJob(creatorJob({
      company_id: 'comp-a', content_type: 'carousel', bolt_payload: boltPayload({ company_id: 'comp-b', campaign_id: 'camp-b', daily_plan_id: 'row-b1' }),
    }))).rejects.toMatchObject({ name: 'JobTenantBindingError', ownership: 'payload_mismatch' });
    expect(admission).not.toHaveBeenCalled();
  });

  it('lets a legitimate BOLT row job through to billing admission', async () => {
    await expect(processCreatorContentJob(creatorJob({
      company_id: 'comp-a', content_type: 'carousel', bolt_payload: boltPayload({}),
    }))).rejects.toThrow('PAST_BINDING');
    expect(admission).toHaveBeenCalledTimes(1);
  });
});

describe('creator-content processor — activity-workspace jobs', () => {
  it("refuses an activity workspace pointing at company B's campaign", async () => {
    await expect(processCreatorContentJob(creatorJob({
      company_id: 'comp-a', content_type: 'carousel', activity_workspace: { campaign_id: 'camp-b' },
    }))).rejects.toMatchObject({ name: 'JobTenantBindingError', ownership: 'foreign' });
    expect(admission).not.toHaveBeenCalled();
  });

  it('allows a workspace id that is not a campaign, and jobs without a campaign', async () => {
    await expect(processCreatorContentJob(creatorJob({
      company_id: 'comp-a', content_type: 'carousel', activity_workspace: { campaign_id: 'workspace-123' },
    }))).rejects.toThrow('PAST_BINDING');
    await expect(processCreatorContentJob(creatorJob({ company_id: 'comp-a', content_type: 'carousel' })))
      .rejects.toThrow('PAST_BINDING');
  });
});

describe('source pins', () => {
  const REPO = path.resolve(__dirname, '../../..');
  const src = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

  it('the interactive-plan branch in worker main binds the campaign before running the planner', () => {
    const main = src('backend/workers/main.ts');
    const branch = main.slice(main.indexOf("if (job.name === 'interactive-plan')"));
    const bind = branch.indexOf('assertJobCampaignBinding(');
    expect(bind).toBeGreaterThan(-1);
    expect(bind).toBeLessThan(branch.indexOf('runCampaignAiPlan(args'));
  });

  it('every campaign snapshot read in the creator processor is company-scoped', () => {
    const proc = src('backend/queue/jobProcessors/creatorContentProcessor.ts');
    const reads = proc.split(".from('campaign_versions')").slice(1);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const r of reads) {
      expect(r.slice(0, r.indexOf('.maybeSingle()'))).toMatch(/\.eq\('company_id', company_id\)/);
    }
  });

  it('BOLT row writes to daily_content_plans carry the campaign predicate', () => {
    const proc = src('backend/queue/jobProcessors/creatorContentProcessor.ts');
    const fn = proc.slice(proc.indexOf('async function processBoltCreatorRowJob'));
    const updates = fn.split("ownedDbTable('daily_content_plans')").slice(1);
    expect(updates.length).toBeGreaterThanOrEqual(2);
    for (const u of updates) {
      expect(u.slice(0, u.indexOf(';'))).toMatch(/\.eq\('campaign_id', payload\.campaign_id\)/);
    }
  });
});
