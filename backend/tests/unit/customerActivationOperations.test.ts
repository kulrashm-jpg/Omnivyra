/**
 * Phase 20 — Customer Activation Operations (execution tracking) tests. Pure, deterministic.
 */

import {
  buildOperations,
  isOutreachState,
  OUTREACH_STATES,
  type OutreachRecord,
  type ActivityLogEntry,
} from '../../services/customerActivationOperationsService';
import type { CustomerActivationInput } from '../../services/customerActivationWorkbenchService';

const inp = (over: Partial<CustomerActivationInput> = {}): CustomerActivationInput => ({
  company_id: 'c1', company_name: 'Acme',
  profile_confidence: 0, domain_verified: false, ga_status: null, gsc_status: null, active_team_members: 1, ...over,
});

describe('isOutreachState', () => {
  it('accepts valid states, rejects others', () => {
    OUTREACH_STATES.forEach((s) => expect(isOutreachState(s)).toBe(true));
    expect(isOutreachState('NOPE')).toBe(false);
    expect(isOutreachState(undefined)).toBe(false);
  });
});

describe('buildOperations', () => {
  const inputs = [
    inp({ company_id: 'unf', company_name: 'Unfinished', profile_confidence: 100 }),
    inp({ company_id: 'full', company_name: 'FullyDone', profile_confidence: 80, domain_verified: true, ga_status: 'connected', gsc_status: 'connected', active_team_members: 2 }),
    inp({ company_id: 'none', company_name: 'Fresh' }),
  ];
  const outreach: OutreachRecord[] = [
    { company_id: 'unf', current_state: 'CONTACTED', last_activity_date: '2026-06-24T00:00:00Z' },
    { company_id: 'full', current_state: 'IN_PROGRESS', last_activity_date: null },
  ];
  const activity: ActivityLogEntry[] = [
    { company_id: 'unf', activity_type: 'NOTE', activity_date: '2026-06-23T10:00:00Z', owner: 'op', notes: 'a', status: null },
    { company_id: 'unf', activity_type: 'STATE_CHANGE', activity_date: '2026-06-24T00:00:00Z', owner: 'op', notes: null, status: 'CONTACTED' },
  ];
  const rows = buildOperations(inputs, outreach, activity);

  it('maps persisted outreach state; defaults to NOT_CONTACTED when missing', () => {
    expect(rows.find((r) => r.company_id === 'unf')!.current_state).toBe('CONTACTED');
    expect(rows.find((r) => r.company_id === 'none')!.current_state).toBe('NOT_CONTACTED');
  });
  it('computes milestones + %', () => {
    const unf = rows.find((r) => r.company_id === 'unf')!;
    expect(unf.activation_percent).toBe(20);
    expect(unf.completed_milestones).toEqual(['PROFILE']);
    expect(unf.remaining_milestones).toEqual(['DOMAIN', 'GA', 'GSC', 'TEAM']);
  });
  it('is_activated derived from 100% completion, independent of workflow state', () => {
    const full = rows.find((r) => r.company_id === 'full')!;
    expect(full.activation_percent).toBe(100);
    expect(full.is_activated).toBe(true);
    expect(full.current_state).toBe('IN_PROGRESS'); // operator state untouched by derivation
  });
  it('recent activity newest-first', () => {
    const unf = rows.find((r) => r.company_id === 'unf')!;
    expect(unf.recent_activity.map((a) => a.activity_type)).toEqual(['STATE_CHANGE', 'NOTE']);
  });
  it('deterministic', () => {
    expect(JSON.stringify(buildOperations(inputs, outreach, activity))).toBe(JSON.stringify(rows));
  });
});
