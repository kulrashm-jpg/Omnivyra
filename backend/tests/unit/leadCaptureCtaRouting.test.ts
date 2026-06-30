/**
 * Phase 9 — CTA routing audit. Every sales-engagement intent has a canonical
 * lead-capture route; the free-audit funnel is a lite (email-only) migration target,
 * not a marketing CTA. Self-serve product routes are intentionally NOT in this set.
 */
import {
  LEAD_CAPTURE_INTENTS,
  SALES_INTENTS,
  LITE_INTENTS,
  LEAD_INTENTS,
  isLeadIntent,
} from '../../../lib/website/leadCaptureConfig';

describe('Phase 9 — CTA routing audit', () => {
  it('every sales intent routes to a canonical lead-capture page', () => {
    for (const intent of SALES_INTENTS) {
      const cfg = LEAD_CAPTURE_INTENTS[intent];
      expect(cfg.route).toMatch(/^\/(request-demo|contact-sales|book-consultation|talk-to-expert)$/);
      expect(cfg.cta).toBeTruthy();
      expect(['inline', 'page', 'redirect']).toContain(cfg.confirmation.mode);
    }
  });

  it('free-audit is a lite funnel migration target, not a sales CTA', () => {
    expect(LITE_INTENTS).toContain('free_audit');
    expect(SALES_INTENTS).not.toContain('free_audit' as never);
    expect(LEAD_CAPTURE_INTENTS.free_audit.route).toBe('/free-audit/start');
    expect(LEAD_CAPTURE_INTENTS.free_audit.confirmation.mode).toBe('redirect');
  });

  it('all intents are recognized + every intent has a config entry', () => {
    for (const intent of LEAD_INTENTS) {
      expect(isLeadIntent(intent)).toBe(true);
      expect(LEAD_CAPTURE_INTENTS[intent]).toBeTruthy();
    }
    expect(isLeadIntent('create-account')).toBe(false); // self-serve product route is NOT a lead-capture intent
    expect(isLeadIntent('get-free-credits')).toBe(false);
  });
});
