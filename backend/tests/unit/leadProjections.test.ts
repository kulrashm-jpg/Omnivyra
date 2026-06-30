import {
  identityProjection, campaignProjection, journeyProjection, contentProjection,
  activityProjection, opportunityProjection, marketPulseProjection, crmProjection,
  engagementProjection, analyticsProjection, type CanonicalLeadView, type TimelineEvent,
} from '../../../lib/leadIntelligence';

const view = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: 'up1',
  identity: { email: 'a@b.com', platform: 'linkedin', externalKeys: { 'linkedin:user': 'u9' } },
  scores: { intent: 0.8, icp: 0.5, confidence: 0.7, total: 0.75 }, status: 'new', campaign: 'q3', content: null,
  referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, occurredAt: '2026-01-01',
  sourceRef: { table: 'leads', id: 'l1' },
  attribution: { originalSource: 'li', originalChannel: 'social', campaign: 'q3', content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: { opportunity_type: 'buying_intent', signal_category: 'hiring', campaign_id: 'c1' } },
  ...over,
});

describe('Projection builders (pure, independent)', () => {
  it('identity merges lead hints + unified person', () => {
    const p = identityProjection(view(), { id: 'up1', primary_phone: '+1', external_keys: { crm: 'x' } });
    expect(p.unifiedPersonId).toBe('up1');
    expect(p.email).toBe('a@b.com');
    expect(p.phone).toBe('+1');
    expect(p.platforms).toEqual(['linkedin']);
    expect(p.externalKeys.crm).toBe('x');
  });

  it('campaign + journey from touchpoints', () => {
    expect(campaignProjection(view(), [{}, {}]).touchpointCount).toBe(2);
    const steps = journeyProjection(view(), [
      { touched_at: '2026-01-02T00:00:00Z', page_url: '/b', campaign: 'q3' },
      { touched_at: '2026-01-01T00:00:00Z', page_url: '/a' },
    ]);
    expect(steps.map((s) => s.page)).toEqual(['/a', '/b']);
  });

  it('content projection delegates to content intelligence', () => {
    const c = contentProjection(view(), { events: [{ event_category: 'navigation', event_name: 'pageview', page_url: '/x' }] });
    expect(c.pagesViewed).toEqual(['/x']);
  });

  it('activity projection orders + counts', () => {
    const events: TimelineEvent[] = [
      { origin: 'o', source: 'website', entityId: '1', eventType: 't', occurredAt: '2026-01-01T00:00:00Z', metadata: {} },
      { origin: 'o', source: 'website', entityId: '2', eventType: 't', occurredAt: '2026-01-03T00:00:00Z', metadata: {} },
    ];
    const a = activityProjection(view(), events);
    expect(a.count).toBe(2);
    expect(a.lastActivityAt).toBe('2026-01-03T00:00:00Z');
  });

  it('opportunity / marketpulse / crm / engagement / analytics', () => {
    expect(opportunityProjection(view(), [{ opportunity_type: 'migration_signal', total_score: 0.9 }]).opportunityTypes.sort()).toEqual(['buying_intent', 'migration_signal']);
    expect(opportunityProjection(view(), []).topScore).toBe(0.75);
    expect(marketPulseProjection(view(), [{ signal_category: 'funding' }]).signalCategories.sort()).toEqual(['funding', 'hiring']);
    expect(crmProjection(view(), [{ revenue_amount: 5000 }, { revenue_amount: 2000 }]).revenue).toBe(7000);
    expect(engagementProjection(view(), [{ updated_at: '2026-01-02T00:00:00Z' }]).threads).toBe(1);
    expect(analyticsProjection(view())).toEqual({ intent: 0.8, icp: 0.5, confidence: 0.7, total: 0.75 });
  });
});
