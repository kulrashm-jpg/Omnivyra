import { recommendNextAction, summarizeLead, type CanonicalLeadView } from '../../../lib/leadIntelligence';

const v = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: null,
  identity: {}, scores: {}, status: null, campaign: null, content: null, referrer: null,
  utm: { source: null, medium: null, campaign: null, content: null, term: null }, occurredAt: null, sourceRef: null,
  attribution: { originalSource: null, originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} },
  ...over,
});

describe('Deterministic lead recommendations + summary', () => {
  it('recommends by status / intent / source', () => {
    expect(recommendNextAction(v({ status: 'qualified' }))).toContain('sales');
    expect(recommendNextAction(v({ status: 'contacted' }))).toContain('Follow up');
    expect(recommendNextAction(v({ scores: { intent: 0.9 } }))).toContain('high buying intent');
    expect(recommendNextAction(v({ source: 'marketpulse' }))).toContain('watchlist');
    expect(recommendNextAction(v({ identity: { email: 'a@b.com' } }))).toContain('follow-up');
  });

  it('summarizes deterministically with intent band', () => {
    const s = summarizeLead(v({ source: 'crm', sourceLabel: 'CRM', identity: { email: 'a@b.com' }, scores: { intent: 0.8 }, status: 'new', campaign: 'q3' }));
    expect(s).toContain('a@b.com');
    expect(s).toContain('CRM');
    expect(s).toContain('high intent (80%)');
  });
});
