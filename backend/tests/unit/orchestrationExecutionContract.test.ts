/**
 * The shared execution contract: what every engine declares, and how any engine's word
 * reads under the normalized states. Pure. The real-schema proof is orch_contract_journey.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });

import {
  checkCapabilityDeclaration, EXECUTION_CONTRACT_VERSION, EXECUTION_STATES, executionCorrelationId,
  executionIdempotencyKey, normalizeEngineResult, POSITIVE_ENGAGEMENT_EVENTS, JOURNEY_EVENT_TYPES,
  type EngineCapabilityDeclaration,
} from '../../services/orchestration/executionContract';
import {
  BROWSER_CAPABILITIES, COMMUNITY_CAPABILITIES, SOCIAL_PUBLISH_CAPABILITIES, WHATSAPP_CAPABILITIES, WS3_CAPABILITIES,
} from '../../services/orchestration/engineCapabilities';
import { ENGINE_NAMES, type EngineDisposition, type EngineName } from '../../services/orchestration/engineAdapters';
import {
  isWithinExecutionWindow, validateChoiceGroup, validateExecutionWindow, validateFrequencyPolicy,
} from '../../services/orchestration/journeyPolicy';
import { validateWorkflowDefinition } from '../../services/workflows/workflowStore';

const read = (engine: EngineName, outcome: string, disposition: EngineDisposition) =>
  normalizeEngineResult({ engine, outcome, disposition, reason: null, externalRef: null });

describe('capability declarations', () => {
  const CHANNELS: Record<EngineName, readonly string[]> = {
    ws3: ['internal', 'email'], whatsapp: ['whatsapp'], social_publish: ['social_post'], community: ['community'], browser: [],
  };
  const ALL: readonly EngineCapabilityDeclaration[] = [
    WS3_CAPABILITIES, WHATSAPP_CAPABILITIES, SOCIAL_PUBLISH_CAPABILITIES, COMMUNITY_CAPABILITIES, BROWSER_CAPABILITIES,
  ];

  it('there are exactly five engines, each declaring what its adapter routes', () => {
    expect([...ENGINE_NAMES].sort()).toEqual(ALL.map((d) => d.engine).sort());
    expect(ENGINE_NAMES).toHaveLength(5);
    for (const d of ALL) {
      expect(checkCapabilityDeclaration(d, { engine: d.engine, channels: CHANNELS[d.engine] })).toEqual([]);
    }
  });

  it('no provider claims more than a mock or the database has proven', () => {
    for (const p of ALL.flatMap((d) => d.actions.flatMap((a) => a.providers))) {
      expect(['mocked', 'postgres_verified']).toContain(p.verification);
    }
  });

  it('nothing is declared as credit metered: no engine charges today', () => {
    for (const a of ALL.flatMap((d) => d.actions)) expect(a.creditMetered).toBe(false);
  });

  it('a declaration that disagrees with its adapter is a defect', () => {
    const w = { engine: 'whatsapp' as const, channels: ['whatsapp', 'sms'] };
    expect(checkCapabilityDeclaration(WHATSAPP_CAPABILITIES, w)).toEqual(['routes "sms" with no declared action']);
    expect(checkCapabilityDeclaration(WHATSAPP_CAPABILITIES, { engine: 'whatsapp', channels: [] })).toEqual(['declares "whatsapp", which the adapter does not route']);
    expect(checkCapabilityDeclaration(WS3_CAPABILITIES, { engine: 'whatsapp', channels: ['internal', 'email'] })[0]).toContain('declares ws3');
    expect(checkCapabilityDeclaration({ ...WHATSAPP_CAPABILITIES, contractVersion: '9.0.0' }, { engine: 'whatsapp', channels: ['whatsapp'] })[0]).toContain('incompatible');
  });

  it('an action that acts must name a provider, and a contact needs an approval model', () => {
    const action = WHATSAPP_CAPABILITIES.actions[0]!;
    const noProvider = { ...WHATSAPP_CAPABILITIES, actions: [{ ...action, providers: [] }] };
    expect(checkCapabilityDeclaration(noProvider, { engine: 'whatsapp', channels: ['whatsapp'] })[0]).toContain('names no provider');
    const noModel = { ...WHATSAPP_CAPABILITIES, actions: [{ ...action, approval: 'not_applicable' as const }] };
    expect(checkCapabilityDeclaration(noModel, { engine: 'whatsapp', channels: ['whatsapp'] })[0]).toContain('no approval model');
  });
});

describe('normalized execution result', () => {
  it('only a delivery event reads as DELIVERED; "sent" is ACCEPTED', () => {
    expect(read('ws3', 'sent', 'completed').state).toBe('ACCEPTED');
    expect(read('ws3', 'delivered', 'completed').state).toBe('DELIVERED');
  });

  it('a possible action is uncertain: never FAILED, never RETRY_REQUIRED, and only a person may act', () => {
    for (const outcome of ['uncertain', 'timeout', 'submission_interrupted']) {
      const r = read('whatsapp', outcome, 'needs_human');
      expect(r.certainty).toBe('uncertain');
      expect(r.state).toBe('EXECUTING');
      expect(r.errorClass).toBe('may_have_acted');
      expect(r.retryability).toBe('human_only');
    }
  });

  it('a gate refusal is never retryable by the system', () => {
    for (const outcome of ['tenant_kill_switch', 'global_kill_switch', 'channel_not_enabled', 'blocked_governance']) {
      const r = read('ws3', outcome, 'needs_human');
      expect(r).toMatchObject({ state: 'REJECTED', errorClass: 'gate_refused', retryability: 'human_only', certainty: 'definite' });
    }
  });

  it('a missing approval is a request waiting on a person, not a failure', () => {
    expect(read('whatsapp', 'approval_required', 'needs_human')).toMatchObject({ state: 'REQUESTED', errorClass: 'approval_missing', retryability: 'human_only' });
    expect(read('ws3', 'awaiting_approval', 'wait')).toMatchObject({ state: 'REQUESTED', errorClass: null, retryability: 'next_sweep' });
  });

  it('a transient not-acted result asks for a retry; in-flight and queued work do not', () => {
    expect(read('ws3', 'deferred_rate_limit', 'wait')).toMatchObject({ state: 'RETRY_REQUIRED', errorClass: 'transient_not_acted' });
    expect(read('whatsapp', 'submitted', 'wait')).toMatchObject({ state: 'EXECUTING', errorClass: null });
    expect(read('ws3', 'queued', 'wait')).toMatchObject({ state: 'QUEUED', errorClass: null });
  });

  it('a human no and a person who cannot be contacted are told apart', () => {
    expect(read('ws3', 'rejected', 'skipped')).toMatchObject({ state: 'REJECTED', errorClass: null });
    expect(read('ws3', 'email_missing', 'skipped')).toMatchObject({ state: 'REJECTED', errorClass: 'person_ineligible' });
    expect(read('ws3', 'cancelled', 'skipped').state).toBe('CANCELLED');
    expect(read('ws3', 'expired', 'skipped').state).toBe('CANCELLED');
  });

  it('an unknown word cannot read as success, and every result names the contract', () => {
    const r = read('community', 'something_new', 'needs_human');
    expect(r).toMatchObject({ state: 'FAILED', retryability: 'human_only', engineOutcome: 'something_new', contractVersion: EXECUTION_CONTRACT_VERSION });
    expect(EXECUTION_STATES).toContain(r.state);
  });

  it('correlation and idempotency are stable and distinct per step', () => {
    expect(executionIdempotencyKey('t')).toBe('task:t');
    expect(executionCorrelationId('i', 's')).toBe('journey:i/step:s');
    expect(executionCorrelationId('i', null)).toBe('journey:i');
  });

  it('only a reply is positive engagement: STOP, bounce and complaint never are', () => {
    expect(POSITIVE_ENGAGEMENT_EVENTS).toEqual(['response.replied']);
    for (const t of ['response.unsubscribed', 'delivery.bounced', 'delivery.complained'] as const) {
      expect(JOURNEY_EVENT_TYPES).toContain(t);
      expect(POSITIVE_ENGAGEMENT_EVENTS).not.toContain(t);
    }
  });
});

describe('execution window', () => {
  const w = { timezone: 'UTC', start_hour: 9, end_hour: 17 };
  // 2027-01-04 is a Monday.
  const MON_10_UTC = '2027-01-04T10:00:00.000Z';

  it('holds inside the hours, with the end hour exclusive', () => {
    expect(isWithinExecutionWindow(w, MON_10_UTC, null)).toBe(true);
    expect(isWithinExecutionWindow(w, '2027-01-04T09:00:00.000Z', null)).toBe(true);
    expect(isWithinExecutionWindow(w, '2027-01-04T17:00:00.000Z', null)).toBe(false);
    expect(isWithinExecutionWindow(w, '2027-01-04T08:59:00.000Z', null)).toBe(false);
  });

  it("the person's timezone wins over the authored one, and a bad one falls back to it", () => {
    expect(isWithinExecutionWindow(w, MON_10_UTC, 'Asia/Tokyo')).toBe(false);      // 19:00 there
    expect(isWithinExecutionWindow(w, MON_10_UTC, 'America/New_York')).toBe(false); // 05:00 there
    expect(isWithinExecutionWindow(w, MON_10_UTC, 'Not/AZone')).toBe(true);
  });

  it('weekdays are the local day, and not knowing the time is outside every window', () => {
    expect(isWithinExecutionWindow({ ...w, weekdays: [1] }, MON_10_UTC, null)).toBe(true);
    expect(isWithinExecutionWindow({ ...w, weekdays: [2, 3] }, MON_10_UTC, null)).toBe(false);
    // Monday 23:30 in New York is already Tuesday in Tokyo.
    const wide = { timezone: 'UTC', start_hour: 0, end_hour: 24, weekdays: [2] };
    expect(isWithinExecutionWindow(wide, '2027-01-05T04:30:00.000Z', 'Asia/Tokyo')).toBe(true);
    expect(isWithinExecutionWindow(wide, '2027-01-05T04:30:00.000Z', 'America/Los_Angeles')).toBe(false);
    expect(isWithinExecutionWindow(w, 'not-a-time', null)).toBe(false);
  });

  it('validation refuses what could never hold, and survives the policy round trip', () => {
    const bad = (v: unknown) => expect(() => validateExecutionWindow(v)).toThrow(/execution_window/);
    bad('x');
    bad({ timezone: 'Not/AZone', start_hour: 9, end_hour: 17 });
    bad({ timezone: 'UTC', start_hour: 17, end_hour: 9 });
    bad({ timezone: 'UTC', start_hour: 9, end_hour: 25 });
    bad({ timezone: 'UTC', start_hour: 9.5, end_hour: 17 });
    bad({ timezone: 'UTC', start_hour: 9, end_hour: 17, weekdays: [] });
    bad({ timezone: 'UTC', start_hour: 9, end_hour: 17, weekdays: [7] });
    expect(validateFrequencyPolicy({ min_hours_between_actions: 24, execution_window: w })).toEqual({ min_hours_between_actions: 24, execution_window: w });
    expect(validateFrequencyPolicy({ min_hours_between_actions: 24 })).toEqual({ min_hours_between_actions: 24 });
  });
});

describe('choice groups', () => {
  const step = (key: string, choice_group?: string) => ({
    key, channel: 'internal', delay_after_previous_hours: 0, execution_mode: 'human',
    ...(choice_group === undefined ? {} : { choice_group }),
  });

  it('must be well formed', () => {
    expect(validateChoiceGroup(undefined, 'a')).toBeUndefined();
    expect(validateChoiceGroup('offer-1', 'a')).toBe('offer-1');
    expect(() => validateChoiceGroup('Has Space', 'a')).toThrow(/choice_group/);
    expect(() => validateChoiceGroup(7, 'a')).toThrow(/choice_group/);
  });

  it('consecutive members are kept in the frozen definition', () => {
    const d = validateWorkflowDefinition({ steps: [step('a', 'g'), step('b', 'g'), step('c')] });
    expect(d.steps.map((s) => s.choice_group)).toEqual(['g', 'g', undefined]);
  });

  it('a group may not be split by another step or another group', () => {
    expect(() => validateWorkflowDefinition({ steps: [step('a', 'g'), step('b'), step('c', 'g')] })).toThrow(/consecutive/);
    expect(() => validateWorkflowDefinition({ steps: [step('a', 'g'), step('b', 'h'), step('c', 'g')] })).toThrow(/consecutive/);
    expect(validateWorkflowDefinition({ steps: [step('a', 'g'), step('b', 'h'), step('c', 'h')] }).steps).toHaveLength(3);
  });
});

describe('a result held for a person reads as what it is', () => {
  const held = (outcome: string) => normalizeEngineResult({ engine: 'ws3', outcome, disposition: 'needs_human', reason: null, externalRef: null });
  it('a repeat provider refusal is a provider rejection, only a person may retry', () => {
    expect(held('provider_refused_prior_attempt')).toMatchObject({ state: 'FAILED', errorClass: 'provider_rejected', retryability: 'human_only' });
  });
  it('an engine refusal at send time, or a requested cancel, reads as a gate', () => {
    for (const o of ['blocked_send_control', 'cancel_requested']) expect(held(o)).toMatchObject({ state: 'REJECTED', errorClass: 'gate_refused', retryability: 'human_only' });
  });
  it('an action the engine cannot do reads as unsupported', () => {
    expect(held('unsupported_action')).toMatchObject({ state: 'REJECTED', errorClass: 'unsupported' });
  });
  it('a word meaning it may have gone out never reads as a definite failure', () => {
    for (const o of ['send_uncertain', 'blocked_prior_attempt']) expect(held(o)).toMatchObject({ state: 'EXECUTING', certainty: 'uncertain', errorClass: 'may_have_acted', retryability: 'human_only' });
  });
  it('an engine mid-send is not asked to retry', () => {
    for (const o of ['sending', 'executing', 'acknowledged', 'skipped_already_dispatched']) {
      expect(normalizeEngineResult({ engine: 'whatsapp', outcome: o, disposition: 'wait', reason: null, externalRef: null })).toMatchObject({ state: 'EXECUTING', errorClass: null });
    }
  });
  it('a channel with no permission source is configuration, not a failure of the person', () => {
    expect(held('no_permission_source')).toMatchObject({ state: 'REJECTED', errorClass: 'not_configured', retryability: 'human_only' });
  });
});
