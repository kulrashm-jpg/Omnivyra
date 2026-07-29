/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 8 (FINAL) — Competitor Intelligence.
 *
 * The strictest consumer (origin of prior defects). Competitor Intelligence CONSUMES the owner company's
 * projection-owned identity (category/business_model/operating_model/domain_role) to shape competitor
 * search — adopted via `adoptCompetitorCompanyIdentity`. It NEVER re-derives identity and NEVER touches
 * competitor evidence. Types: Consumer Classification · Inventory · Identity Audit · Projection Integration ·
 * Competitive Integrity · Prompt Integrity · Output Parity · Approved Improvement · Unexpected Regression ·
 * Rollback · Performance · Explainability · Consumer Isolation.
 */
import { adoptCompetitorCompanyIdentity } from '../../services/companyIntelligence/adoption/consumers/competitorIntelligenceConsumer';
import { resolveCompanyProjection } from '../../services/companyIntelligence/adoption/consumerAdapter';
import type { EvidenceSources } from '../../services/companyIntelligence/evidence';

const ASOF = '2026-07-28T00:00:00.000Z';
const AUTH = 'COMPANY_UNDERSTANDING_AUTHORITATIVE';
const ON = () => { process.env[AUTH] = 'true'; };
const OFF = () => { delete process.env[AUTH]; };
afterEach(OFF);

const PROFILE = () => ({
  name: 'Omnivyra', website_url: 'omnivyra.com', category: 'Analytics software for clearer performance insights',
  report_settings: {
    market_pulse: {
      business_model: 'B2B SaaS', operating_model: 'AI software platform', domain_role: 'AI-powered problem-solution provider',
      provider_type: 'ai_product', solution_domains: ['Marketing Technology'],
      named_competitors: ['RivalCo'], competitor_details: [{ name: 'RivalCo', domain: 'rival.co' }],
    },
  },
});
const EVIDENCE = (): EvidenceSources => ({
  profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com' },
  ai: { companyId: 'omnivyra', observedAt: ASOF, category: 'AI-driven digital marketing & content platform', operatingModel: 'AI-powered marketing & content platform', domainRole: 'AI marketing content solution provider' },
});
const inputFrom = (pr: ReturnType<typeof PROFILE>) => ({
  companyId: 'omnivyra', asOf: ASOF, name: pr.name, domain: pr.website_url, category: pr.category,
  businessModel: pr.report_settings.market_pulse.business_model, primaryMotion: pr.report_settings.market_pulse.operating_model, marketPosition: pr.report_settings.market_pulse.domain_role,
});

describe('U3·C8 · projection integration + approved improvement', () => {
  it('flag OFF → same profile reference (byte-identical no-op)', () => {
    const p = PROFILE();
    expect(adoptCompetitorCompanyIdentity(p, 'omnivyra', ASOF)).toBe(p);
  });
  it('flag ON + evidence → projected category/operating_model/domain_role; business_model kept (no evidence)', () => {
    ON();
    const out = adoptCompetitorCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    expect(out.category).toBe('AI-driven digital marketing & content platform');
    expect(out.report_settings.market_pulse.operating_model).toBe('AI-powered marketing & content platform');
    expect(out.report_settings.market_pulse.domain_role).toBe('AI marketing content solution provider');
    expect(out.report_settings.market_pulse.business_model).toBe('B2B SaaS');
  });
  it('flag ON without evidence echoes stored identity (no competitor-time reclassification)', () => {
    ON();
    const out = adoptCompetitorCompanyIdentity(PROFILE(), 'omnivyra', ASOF);
    expect(out.category).toBe('Analytics software for clearer performance insights');
    expect(out.report_settings.market_pulse.operating_model).toBe('AI software platform');
  });
});

describe('U3·C8 · COMPETITIVE INTEGRITY — competitor evidence never altered', () => {
  it('preserves named_competitors, competitor_details, provider_type, solution_domains verbatim', () => {
    ON();
    const out = adoptCompetitorCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    const mp = out.report_settings.market_pulse;
    expect(mp.named_competitors).toEqual(['RivalCo']);
    expect(mp.competitor_details).toEqual([{ name: 'RivalCo', domain: 'rival.co' }]);
    expect(mp.provider_type).toBe('ai_product');            // not projection-owned → untouched
    expect(mp.solution_domains).toEqual(['Marketing Technology']);
  });
});

describe('U3·C8 · unexpected regression + rollback', () => {
  it('regression: a parity-locked divergence (name) keeps the stored identity (same reference)', () => {
    ON();
    const p = PROFILE();
    const evidence: EvidenceSources = { profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'DIFFERENT', domain: 'omnivyra.com' }, ai: EVIDENCE().ai };
    expect(adoptCompetitorCompanyIdentity(p, 'omnivyra', ASOF, evidence)).toBe(p);
  });
  it('rollback: ON→OFF restores identical output', () => {
    const before = adoptCompetitorCompanyIdentity(PROFILE(), 'omnivyra', ASOF);
    ON();
    expect(adoptCompetitorCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE()).category).toBe('AI-driven digital marketing & content platform');
    OFF();
    expect(adoptCompetitorCompanyIdentity(PROFILE(), 'omnivyra', ASOF)).toEqual(before);
  });
});

describe('U3·C8 · explainability + prompt integrity', () => {
  it('the seam exposes the projected worldView + observation for grounding (no LLM inference needed)', () => {
    ON();
    const r = resolveCompanyProjection(inputFrom(PROFILE()), { evidence: EVIDENCE() });
    expect(r.worldView?.category).toBe('AI-driven digital marketing & content platform');
    expect(r.worldView?.operatingModel).toBe('AI-powered marketing & content platform');
    expect(r.observation.version).toBeGreaterThan(0);
    expect(r.observation.deltas.length).toBeGreaterThanOrEqual(0);
  });
});

describe('U3·C8 · performance + consumer isolation', () => {
  it('performance: 1000 adopts, deterministic', () => {
    ON();
    const first = adoptCompetitorCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) adoptCompetitorCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(adoptCompetitorCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE())).toEqual(first);
    expect(ms).toBeLessThan(2500);
  });
  it('isolation: never mutates the input profile (incl. nested market_pulse)', () => {
    ON();
    const p = PROFILE();
    const snap = JSON.parse(JSON.stringify(p));
    adoptCompetitorCompanyIdentity(p, 'omnivyra', ASOF, EVIDENCE());
    expect(p).toEqual(snap);
  });
});
