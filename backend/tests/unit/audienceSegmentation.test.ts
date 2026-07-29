import { evaluateRules, isNonEmptyRules, type RuleGroup } from '../../../lib/audience/segmentation';
import type { CanonicalLeadView } from '../../../lib/leadIntelligence';

function view(overrides: Partial<CanonicalLeadView> = {}): CanonicalLeadView {
  return {
    organizationId: 'co', source: 'website', sourceLabel: 'Website', unifiedPersonId: 'p1',
    identity: { email: 'buyer@acme.com' }, scores: { intent: 0.6, total: 0.6, confidence: 0.5, icp: null, urgency: null },
    status: 'new', campaign: 'q3', content: 'pricing', referrer: null,
    utm: { source: 'google', medium: 'cpc', campaign: 'q3', content: null, term: null },
    occurredAt: '2026-07-01T00:00:00Z', sourceRef: { table: 'leads', id: 'L1' },
    attribution: { originalSource: null, originalChannel: null, campaign: 'q3', content: 'pricing', session: null, journey: null, referrer: null, utm: { source: 'google', medium: 'cpc', campaign: 'q3', content: null, term: null }, identity: {}, sourceMetadata: { company_name: 'Acme', industry: 'SaaS / Technology' } },
    ...overrides,
  } as CanonicalLeadView;
}

describe('LC-301 segmentation engine', () => {
  it('evaluates a simple AND with explainability', () => {
    const rules: RuleGroup = { op: 'and', conditions: [{ field: 'source', operator: 'eq', value: 'website' }, { field: 'intent', operator: 'gte', value: 0.4 }] };
    const r = evaluateRules({ view: view() }, rules);
    expect(r.matched).toBe(true);
    expect(r.matchedRules).toHaveLength(2);
    expect(r.evidence[0]).toMatchObject({ field: 'source', actual: 'website' });
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('fails AND when one condition misses', () => {
    const rules: RuleGroup = { op: 'and', conditions: [{ field: 'source', operator: 'eq', value: 'website' }, { field: 'intent', operator: 'gte', value: 0.9 }] };
    expect(evaluateRules({ view: view() }, rules).matched).toBe(false);
  });

  it('supports OR + nested groups', () => {
    const rules: RuleGroup = {
      op: 'or',
      conditions: [{ field: 'source', operator: 'eq', value: 'crm' }],
      groups: [{ op: 'and', conditions: [{ field: 'company', operator: 'contains', value: 'acme' }, { field: 'industry', operator: 'in', value: ['SaaS / Technology', 'Retail'] }] }],
    };
    const r = evaluateRules({ view: view() }, rules);
    expect(r.matched).toBe(true); // via the nested AND group
  });

  it('reads operational overlay fields', () => {
    const rules: RuleGroup = { op: 'and', conditions: [{ field: 'op_status', operator: 'eq', value: 'working' }] };
    expect(evaluateRules({ view: view(), operational: { status: 'working', assignee: 'u1' } }, rules).matched).toBe(true);
    expect(evaluateRules({ view: view(), operational: { status: 'new', assignee: null } }, rules).matched).toBe(false);
  });

  it('supports exists / contains / not_in', () => {
    expect(evaluateRules({ view: view() }, { op: 'and', conditions: [{ field: 'email', operator: 'exists' }] }).matched).toBe(true);
    expect(evaluateRules({ view: view({ identity: {} }) }, { op: 'and', conditions: [{ field: 'email', operator: 'exists' }] }).matched).toBe(false);
    expect(evaluateRules({ view: view() }, { op: 'and', conditions: [{ field: 'content', operator: 'contains', value: 'pric' }] }).matched).toBe(true);
    expect(evaluateRules({ view: view() }, { op: 'and', conditions: [{ field: 'source', operator: 'not_in', value: ['blog', 'crm'] }] }).matched).toBe(true);
  });

  it('treats empty rules as non-matching', () => {
    expect(isNonEmptyRules({ op: 'and' })).toBe(false);
    expect(evaluateRules({ view: view() }, { op: 'and' }).matched).toBe(false);
    expect(evaluateRules({ view: view() }, null).matched).toBe(false);
  });
});
