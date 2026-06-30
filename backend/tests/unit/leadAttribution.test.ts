import { buildAttributionContract } from '../../../lib/leadIntelligence';

describe('Unified attribution contract', () => {
  it('maps standard fields and the utm bag', () => {
    const a = buildAttributionContract({
      source: 'linkedin', channel: 'social', campaign: 'q3', content: 'whitepaper',
      session_id: 'sess1', referrer: 'https://x.com',
      utm_source: 'li', utm_medium: 'cpc', utm_campaign: 'q3', utm_content: 'ad1', utm_term: 'crm',
      first_touch: { ts: 1 },
    }, { email: 'a@b.com' });
    expect(a.originalSource).toBe('linkedin');
    expect(a.originalChannel).toBe('social');
    expect(a.campaign).toBe('q3');
    expect(a.content).toBe('whitepaper');
    expect(a.session).toBe('sess1');
    expect(a.referrer).toBe('https://x.com');
    expect(a.utm).toEqual({ source: 'li', medium: 'cpc', campaign: 'q3', content: 'ad1', term: 'crm' });
    expect(a.journey).toEqual({ ts: 1 });
    expect(a.identity.email).toBe('a@b.com');
  });

  it('discards NOTHING — unmapped keys land in sourceMetadata', () => {
    const a = buildAttributionContract({ source: 'crm', deal_value: 5000, custom_x: 'keep', platform_user_id: 'u9' }, {});
    expect(a.sourceMetadata.deal_value).toBe(5000);
    expect(a.sourceMetadata.custom_x).toBe('keep');
    expect(a.sourceMetadata.platform_user_id).toBe('u9');
    expect(a.sourceMetadata.source).toBeUndefined();
  });

  it('supports a nested utm object', () => {
    const a = buildAttributionContract({ utm: { source: 'ig', campaign: 'launch' } }, {});
    expect(a.utm.source).toBe('ig');
    expect(a.utm.campaign).toBe('launch');
  });
});
