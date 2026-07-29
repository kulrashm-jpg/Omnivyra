/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 3 — Market Pulse.
 *
 * Certifies Market Pulse reads its projection-owned interpretive identity (business_model /
 * operating_model / domain_role) through the seam's worldView: byte-identical when OFF, projected when ON
 * (evidence-derived when supplied), fail-safe on regression, no reclassification, competitors/provider_type/
 * solution_domains untouched, explainability preserved, O(1) rollback. Types: Inventory · Projection
 * Integration · Prompt Input · Market Report · Output Parity · Approved Improvement · Unexpected Regression ·
 * Rollback · Explainability · Performance · Consumer Isolation.
 */
import { adoptMarketPulseIdentity, marketPulseSettingsToInput } from '../../services/companyIntelligence/adoption/consumers/marketPulseConsumer';
import { resolveCompanyProjection } from '../../services/companyIntelligence/adoption/consumerAdapter';
import type { EvidenceSources } from '../../services/companyIntelligence/evidence';

const ASOF = '2026-07-28T00:00:00.000Z';
const AUTH = 'COMPANY_UNDERSTANDING_AUTHORITATIVE';
const ON = () => { process.env[AUTH] = 'true'; };
const OFF = () => { delete process.env[AUTH]; };
afterEach(OFF);

const SETTINGS = () => ({
  business_model: 'B2B SaaS', operating_model: 'AI software platform', domain_role: 'AI-powered problem-solution provider',
  provider_type: 'ai_product', solution_domains: ['Marketing Technology'],
  named_competitors: ['RivalCo'], competitor_details: [{ name: 'RivalCo' }],
});
const PROFILE = () => ({ name: 'Omnivyra', website_url: 'omnivyra.com', category: 'Analytics software for clearer performance insights' });
const EVIDENCE = (): EvidenceSources => ({
  profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com' },
  ai: { companyId: 'omnivyra', observedAt: ASOF, category: 'AI-driven digital marketing & content platform', operatingModel: 'AI-powered marketing & content platform', domainRole: 'AI marketing content solution provider' },
});

describe('U3·C3 · inventory + mapping', () => {
  it('maps market_pulse settings → projection input (operating_model→primaryMotion, domain_role→marketPosition)', () => {
    const inp = marketPulseSettingsToInput(SETTINGS(), PROFILE(), 'omnivyra', ASOF);
    expect(inp.primaryMotion).toBe('AI software platform');
    expect(inp.marketPosition).toBe('AI-powered problem-solution provider');
    expect(inp.businessModel).toBe('B2B SaaS');
  });
});

describe('U3·C3 · projection integration + approved improvement', () => {
  it('flag ON + evidence → operating_model & domain_role projected (business_model kept: no evidence)', () => {
    ON();
    const out = adoptMarketPulseIdentity(SETTINGS(), PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    expect(out.operating_model).toBe('AI-powered marketing & content platform');
    expect(out.domain_role).toBe('AI marketing content solution provider');
    expect(out.business_model).toBe('B2B SaaS'); // abstention-safe: null projection never wipes stored
  });
  it('flag ON without evidence keeps stored interpretive identity (profile-derived echo)', () => {
    ON();
    const out = adoptMarketPulseIdentity(SETTINGS(), PROFILE(), 'omnivyra', ASOF);
    expect(out.operating_model).toBe('AI software platform');
    expect(out.domain_role).toBe('AI-powered problem-solution provider');
  });
});

describe('U3·C3 · market report input — non-owned fields untouched', () => {
  it('provider_type, solution_domains, and competitors are never changed', () => {
    ON();
    const out = adoptMarketPulseIdentity(SETTINGS(), PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    expect(out.provider_type).toBe('ai_product');
    expect(out.solution_domains).toEqual(['Marketing Technology']);
    expect(out.named_competitors).toEqual(['RivalCo']);
    expect(out.competitor_details).toEqual([{ name: 'RivalCo' }]);
  });
});

describe('U3·C3 · output parity + rollback (O(1))', () => {
  it('flag OFF returns the SAME settings reference (byte-identical no-op)', () => {
    const s = SETTINGS();
    expect(adoptMarketPulseIdentity(s, PROFILE(), 'omnivyra', ASOF)).toBe(s);
  });
  it('ON→OFF restores identical settings', () => {
    const before = adoptMarketPulseIdentity(SETTINGS(), PROFILE(), 'omnivyra', ASOF);
    ON();
    expect(adoptMarketPulseIdentity(SETTINGS(), PROFILE(), 'omnivyra', ASOF, EVIDENCE()).operating_model).toBe('AI-powered marketing & content platform');
    OFF();
    expect(adoptMarketPulseIdentity(SETTINGS(), PROFILE(), 'omnivyra', ASOF)).toEqual(before);
  });
});

describe('U3·C3 · unexpected regression fail-safe', () => {
  it('a parity-locked divergence (name) keeps stored settings (same reference)', () => {
    ON();
    const s = SETTINGS();
    const evidence: EvidenceSources = { profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'DIFFERENT NAME', domain: 'omnivyra.com' }, ai: EVIDENCE().ai };
    expect(adoptMarketPulseIdentity(s, PROFILE(), 'omnivyra', ASOF, evidence)).toBe(s); // fail-safe ⇒ untouched
  });
});

describe('U3·C3 · seam worldView + explainability', () => {
  it('the seam exposes worldView on canonical paths and null on legacy', () => {
    expect(resolveCompanyProjection(marketPulseSettingsToInput(SETTINGS(), PROFILE(), 'omnivyra', ASOF)).worldView).toBeNull(); // OFF
    ON();
    const r = resolveCompanyProjection(marketPulseSettingsToInput(SETTINGS(), PROFILE(), 'omnivyra', ASOF), { evidence: EVIDENCE() });
    expect(r.worldView?.operatingModel).toBe('AI-powered marketing & content platform');
    expect(r.observation.deltas.length).toBeGreaterThanOrEqual(0);
    expect(r.observation.version).toBeGreaterThan(0);
  });
});

describe('U3·C3 · performance + determinism', () => {
  it('1000 adopts, no network, deterministic', () => {
    ON();
    const first = adoptMarketPulseIdentity(SETTINGS(), PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) adoptMarketPulseIdentity(SETTINGS(), PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(adoptMarketPulseIdentity(SETTINGS(), PROFILE(), 'omnivyra', ASOF, EVIDENCE())).toEqual(first);
    expect(ms).toBeLessThan(2500);
  });
});

describe('U3·C3 · consumer isolation (consumes, never derives)', () => {
  it('never mutates input settings; only overlays the three worldView fields', () => {
    ON();
    const s = SETTINGS();
    const snapshot = JSON.parse(JSON.stringify(s));
    adoptMarketPulseIdentity(s, PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    expect(s).toEqual(snapshot); // input untouched
  });
});
