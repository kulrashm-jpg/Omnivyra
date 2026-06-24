/**
 * Phase 17 — Customer Activation Workbench (operational tooling) tests. Pure, deterministic.
 */

import {
  milestoneStatus,
  buildRow,
  buildWorkbench,
  REQUIRED_MILESTONES,
  type CustomerActivationInput,
} from '../../services/customerActivationWorkbenchService';

const inp = (over: Partial<CustomerActivationInput> = {}): CustomerActivationInput => ({
  company_id: 'c1', company_name: 'Acme',
  profile_confidence: 0, domain_verified: false, ga_status: null, gsc_status: null, active_team_members: 1, ...over,
});

describe('milestoneStatus (mechanical mapping)', () => {
  it('PROFILE: >=60 COMPLETE else READY_NOW', () => {
    expect(milestoneStatus(inp({ profile_confidence: 100 }), 'PROFILE')).toBe('COMPLETE');
    expect(milestoneStatus(inp({ profile_confidence: 59 }), 'PROFILE')).toBe('READY_NOW');
    expect(milestoneStatus(inp({ profile_confidence: null }), 'PROFILE')).toBe('READY_NOW');
  });
  it('DOMAIN: verified COMPLETE else READY_NOW', () => {
    expect(milestoneStatus(inp({ domain_verified: true }), 'DOMAIN')).toBe('COMPLETE');
    expect(milestoneStatus(inp({ domain_verified: false }), 'DOMAIN')).toBe('READY_NOW');
  });
  it('GA/GSC: connected COMPLETE else READY_NOW', () => {
    expect(milestoneStatus(inp({ ga_status: 'connected' }), 'GA')).toBe('COMPLETE');
    expect(milestoneStatus(inp({ ga_status: 'disconnected' }), 'GA')).toBe('READY_NOW');
    expect(milestoneStatus(inp({ gsc_status: 'error' }), 'GSC')).toBe('READY_NOW');
  });
  it('TEAM: >1 active member COMPLETE else READY_NOW', () => {
    expect(milestoneStatus(inp({ active_team_members: 2 }), 'TEAM')).toBe('COMPLETE');
    expect(milestoneStatus(inp({ active_team_members: 1 }), 'TEAM')).toBe('READY_NOW');
  });
  it('explicit product blocker → BLOCKED', () => {
    expect(milestoneStatus(inp({ ga_status: 'connected', product_blockers: { GA: 'secret stale' } }), 'GA')).toBe('BLOCKED');
  });
});

describe('buildRow', () => {
  it('activation % = completed/required and action cards only for outstanding', () => {
    const row = buildRow(inp({ profile_confidence: 100, domain_verified: true })); // 2 complete
    expect(row.completed_count).toBe(2);
    expect(row.activation_pct).toBe(40);
    expect(row.remaining).toEqual(['GA', 'GSC', 'TEAM']);
    expect(row.action_cards.map((a) => a.milestone)).toEqual(['GA', 'GSC', 'TEAM']);
    expect(row.action_cards.every((a) => a.execution_url && a.completion_criteria)).toBe(true);
  });
  it('fully onboarded → 100%, no action cards', () => {
    const row = buildRow(inp({ profile_confidence: 80, domain_verified: true, ga_status: 'connected', gsc_status: 'connected', active_team_members: 2 }));
    expect(row.activation_pct).toBe(100);
    expect(row.action_cards).toEqual([]);
    expect(row.remaining).toEqual([]);
  });
  it('BLOCKED milestone yields a PRODUCT-owned action card', () => {
    const row = buildRow(inp({ product_blockers: { GA: 'config secret stale' } }));
    const ga = row.action_cards.find((a) => a.milestone === 'GA')!;
    expect(ga.owner).toBe('PRODUCT');
    expect(ga.action).toBe('config secret stale');
  });
});

describe('buildWorkbench — queue + tracker (the live 5-customer shape)', () => {
  const inputs: CustomerActivationInput[] = [
    inp({ company_id: 'unf', company_name: 'Unfinished Innovations LLP', profile_confidence: 100 }), // 1 complete
    inp({ company_id: 'drishiq', company_name: 'Drishiq', profile_confidence: 67 }),                 // 1 complete
    inp({ company_id: 'embro', company_name: 'Embrosales', profile_confidence: 0 }),                  // 0
    inp({ company_id: 'afrost', company_name: 'Afrost', profile_confidence: 0 }),                     // 0
    inp({ company_id: 'infitoo', company_name: 'Infitoo Systems llp', profile_confidence: 0 }),       // 0
  ];
  const r = buildWorkbench(inputs);

  it('queue sorted by activation % desc then name', () => {
    expect(r.queue.map((x) => x.company_name)).toEqual([
      'Drishiq', 'Unfinished Innovations LLP', 'Afrost', 'Embrosales', 'Infitoo Systems llp',
    ]);
  });
  it('tracker defaults to Unfinished Innovations LLP', () => {
    expect(r.tracker?.company_name).toBe('Unfinished Innovations LLP');
    expect(r.tracker?.activation_pct).toBe(20);
    expect(r.tracker?.remaining).toEqual(['DOMAIN', 'GA', 'GSC', 'TEAM']);
  });
  it('every required milestone present per row', () => {
    expect(Object.keys(r.workbench[0].milestones).sort()).toEqual([...REQUIRED_MILESTONES].sort());
  });
  it('deterministic', () => {
    expect(JSON.stringify(buildWorkbench(inputs))).toBe(JSON.stringify(r));
  });
});
