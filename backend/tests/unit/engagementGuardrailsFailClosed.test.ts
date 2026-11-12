/**
 * CLASS-2 block 5 (e9 sweep), the gates a real engagement reply / DM passes:
 *   A19 - the guardrail limits count IN-FLIGHT (`executing`) actions too, and an unreadable guardrail
 *         or count REFUSES (every read error used to answer `allowed: true`);
 *   A20 - the plan-usage gate refuses on an unreadable plan/meter when the caller asks to fail closed
 *         (the engagement send path does); other callers keep allow-on-error;
 *   B10 - the automation counter's compensation is an exact decrement, never an absolute SET that
 *         erased concurrent increments.
 * The real services over the fake database.
 */
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: async () => ({ data: null, error: null }),
  },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../services/planResolutionService', () => ({
  resolveOrganizationPlanLimits: async () => ({ plan_key: 'pro', limits: { llm_tokens: null, external_api_calls: null, automation_executions: 100 } }),
}));

import { failNext, fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { canExecuteAction } from '../../services/executionGuardrailService';
import { checkUsageBeforeExecution } from '../../services/usageEnforcementService';
import { undoAutomationUsageIncrement } from '../../services/automation/automationService';

const ACTION = { id: 'a-new', company_id: 'co-a', organization_id: 'co-a', platform: 'linkedin', action_type: 'reply', target_id: 'post-1' };
const act = (id: string, over: Row = {}): Row => ({ id, organization_id: 'co-a', platform: 'linkedin', action_type: 'reply', target_id: 'post-1', status: 'executed', executed_at: new Date().toISOString(), ...over });

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('A19 guardrails', () => {
  const seed = (actions: Row[], limits: Row = {}) => resetFakeDb({
    execution_guardrails: [{ company_id: 'co-a', auto_execution_enabled: true, daily_platform_limit: null, per_post_reply_limit: 1, per_evaluation_limit: null, ...limits }],
    community_ai_actions: actions,
  });

  it('an IN-FLIGHT (executing) reply to the post counts: the per-post limit refuses a second', async () => {
    seed([act('a-1', { status: 'executing', executed_at: null })]);
    expect(await canExecuteAction(ACTION, { source: 'scheduler' })).toEqual({ allowed: false, reason: 'per_post_limit' });
  });

  it('the guardrail settings are UNREADABLE: refused (it used to allow)', async () => {
    seed([]);
    failNext('execution_guardrails', 'select');
    expect(await canExecuteAction(ACTION, { source: 'scheduler' })).toEqual({ allowed: false, reason: 'guardrail_unreadable' });
  });

  it('a limit count is UNREADABLE: refused (it used to allow)', async () => {
    seed([]);
    failNext('community_ai_actions', 'select');
    expect(await canExecuteAction(ACTION, { source: 'scheduler' })).toEqual({ allowed: false, reason: 'guardrail_unreadable' });
  });

  it('NEGATIVE CONTROL: under every limit -> allowed (a failed reply elsewhere does not count)', async () => {
    seed([act('a-1', { status: 'failed', executed_at: null }), act('a-2', { target_id: 'post-2' })]);
    expect(await canExecuteAction(ACTION, { source: 'scheduler' })).toEqual({ allowed: true });
  });
});

describe('A20 plan usage', () => {
  const seed = () => resetFakeDb({
    organization_plan_assignments: [{ organization_id: 'co-a', plan_id: 'p1' }],
    pricing_plans: [{ id: 'p1', enforcement_enabled: true, allow_overage: false, grace_percent: 0 }],
    usage_meter_monthly: [],
  });

  it('the meter is UNREADABLE and the caller fails closed (the engagement send path): refused', async () => {
    seed();
    failNext('usage_meter_monthly', 'select');
    expect(await checkUsageBeforeExecution({ organization_id: 'co-a', resource_key: 'automation_executions', projected_increment: 1, failClosed: true }))
      .toMatchObject({ allowed: false, reason: 'usage_unverifiable' });
  });

  it('NEGATIVE CONTROL: the same failure for a caller that did not opt in (LLM gateway, external API) still allows', async () => {
    seed();
    failNext('usage_meter_monthly', 'select');
    expect(await checkUsageBeforeExecution({ organization_id: 'co-a', resource_key: 'automation_executions', projected_increment: 1 }))
      .toEqual({ allowed: true });
  });

  it('NEGATIVE CONTROL: readable and within the limit -> allowed, fail-closed or not', async () => {
    seed();
    expect(await checkUsageBeforeExecution({ organization_id: 'co-a', resource_key: 'automation_executions', projected_increment: 1, failClosed: true }))
      .toEqual({ allowed: true });
  });
});

describe('B10 the automation counter compensation', () => {
  const DAY = new Date().toISOString().slice(0, 10);
  const usage = () => fakeDb.tables.automation_usage[0].actions_executed;

  it('another automation incremented in between: an EXACT decrement keeps its increment (it used to be erased by a SET)', async () => {
    // This decision's increment made it 5; another automation's made it 6 before the undo.
    resetFakeDb({ automation_usage: [{ organization_id: 'co-a', day: DAY, actions_executed: 6 }] });
    await undoAutomationUsageIncrement('co-a', 5);
    expect(usage()).toBe(5); // 6 - 1, not 5 - 1
  });

  it('NEGATIVE CONTROL: nothing in between -> decremented once', async () => {
    resetFakeDb({ automation_usage: [{ organization_id: 'co-a', day: DAY, actions_executed: 5 }] });
    await undoAutomationUsageIncrement('co-a', 5);
    expect(usage()).toBe(4);
  });
});
