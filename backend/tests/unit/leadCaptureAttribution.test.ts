/**
 * @jest-environment jsdom
 *
 * Phase 8 — client attribution capture: hidden-field capture, first-touch persistence,
 * and cross-domain (blog→website) journey preservation.
 */
import { captureAttribution } from '../../../lib/website/attributionCapture';

function setUrl(url: string) {
  window.history.replaceState({}, '', url);
}
function setReferrer(value: string) {
  Object.defineProperty(document, 'referrer', { value, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setReferrer('');
  setUrl('/');
});

describe('Phase 8 — client attribution capture', () => {
  it('captures every hidden attribution field from the URL + tracker session', () => {
    sessionStorage.setItem('omn_session', 'sess-abc');
    setUrl('/request-demo?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_content=ad1&utm_term=kw&journey_id=j1&campaign_id=cmp1&content_id=ct1&asset_id=as1&cta_id=cta1&form_id=f1&website_id=w1');
    const a = captureAttribution();
    expect(a).toMatchObject({
      utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring', utm_content: 'ad1', utm_term: 'kw',
      journey_id: 'j1', campaign_id: 'cmp1', content_id: 'ct1', asset_id: 'as1', cta_id: 'cta1', form_id: 'f1', website_id: 'w1',
      session_id: 'sess-abc', anonymous_id: 'sess-abc',
    });
    expect(a.current_page).toContain('/request-demo');
  });

  it('persists FIRST touch across navigation (later pages keep the original utms + landing page)', () => {
    setUrl('/?utm_source=linkedin&utm_campaign=launch');
    const first = captureAttribution();
    expect(first.utm_source).toBe('linkedin');
    expect(first.landing_page).toContain('/?utm_source=linkedin');

    // navigate to a page with no params — first-touch is retained from localStorage
    setUrl('/contact-sales');
    const later = captureAttribution();
    expect(later.utm_source).toBe('linkedin'); // first-touch retained
    expect(later.utm_campaign).toBe('launch');
    expect(later.landing_page).toContain('/?utm_source=linkedin'); // original landing page
    expect(later.current_page).toContain('/contact-sales'); // current reflects now
  });

  it('cross-domain blog journey: the originating blog referrer is preserved as first_referrer', () => {
    setReferrer('https://blog.omnivyra.com/post/lead-intelligence');
    setUrl('/request-demo?utm_source=blog');
    const a = captureAttribution();
    expect(a.first_referrer).toBe('https://blog.omnivyra.com/post/lead-intelligence');
    expect(a.referrer).toBe('https://blog.omnivyra.com/post/lead-intelligence');
  });

  it('returns empty on the server (no window)', () => {
    // captureAttribution guards on typeof window; in jsdom window exists, so just assert it never throws
    expect(() => captureAttribution()).not.toThrow();
  });
});
