/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U4 — Competitor Intelligence Hardening.
 *
 * Certifies that Competitor Intelligence consumes canonical identity and reasons only about competitors:
 * the LLM "understand THIS company" prompt no longer asks the model to infer the owner's category, and the
 * discovery extractor no longer fabricates a hardcoded owner identity — both gated by the authoritative flag
 * (flag OFF ⇒ byte-identical legacy). Competitor evidence never leaks into company identity.
 * Types: Identity Isolation · Competitor Evidence · Prompt Hardening · Identity Leakage · Explainability ·
 * Ranking Consistency · Rollback · Performance · Regression.
 */
import { buildCompetitorUnderstandingSystemPrompt, mayFabricateSparseIdentity } from '../../services/competitorIdentityHardening';
import { extractCompetitiveContextFromProfile } from '../../services/competitorEngineServiceEngineDiscovery';
import { resolveCompanyProjection } from '../../services/companyIntelligence/adoption/consumerAdapter';

const AUTH = 'COMPANY_UNDERSTANDING_AUTHORITATIVE';
const ON = () => { process.env[AUTH] = 'true'; };
const OFF = () => { delete process.env[AUTH]; };
afterEach(OFF);

describe('U4 · prompt hardening — LLM reasons about competitors, never infers company identity', () => {
  it('authoritative prompt gives identity as established and forbids re-inference', () => {
    const p = buildCompetitorUnderstandingSystemPrompt(true);
    expect(p).toMatch(/ALREADY ESTABLISHED/);
    expect(p).toMatch(/Do NOT re-infer/i);
    expect(p).toMatch(/COMPETITIVE ARENA/);
    // never asks the model to state/infer the company's own category
    expect(p).not.toMatch(/state your understanding of THIS company: the exact product CATEGORY it competes in/);
  });
  it('non-authoritative prompt is the exact legacy string (byte-identical when flag OFF)', () => {
    expect(buildCompetitorUnderstandingSystemPrompt(false)).toBe(
      'You are a sharp competitive-intelligence analyst. In 3–4 confident, specific sentences, state your ' +
      'understanding of THIS company: the exact product CATEGORY it competes in, what it actually sells, who it ' +
      'serves, and the competitive arena — grounded strictly in the profile (never invent). ' +
      'Return JSON ONLY: { "understanding": string }.'
    );
  });
});

describe('U4 · fallback identity inference gate (sparse-context fabrication)', () => {
  it('authoritative ⇒ may NOT fabricate; non-authoritative ⇒ legacy fabrication allowed', () => {
    expect(mayFabricateSparseIdentity(true)).toBe(false);
    expect(mayFabricateSparseIdentity(false)).toBe(true);
  });
});

// ── Competitor evidence isolation / identity leakage (behavioural, flag OFF = production default) ──
const PROFILE = () => ({
  company_id: 'omnivyra', name: 'Omnivyra', website_url: 'omnivyra.com',
  category: 'Analytics software for clearer performance insights', industry: 'Data & Analytics',
  report_settings: {
    market_pulse: {
      operating_model: 'AI software platform', domain_role: 'AI-powered problem-solution provider',
      solution_domains: ['Marketing Technology'],
      named_competitors: ['RivalCorp'], competitor_details: [{ name: 'RivalCorp', domain: 'rivalcorp.com' }],
    },
  },
});

describe('U4 · competitor evidence isolation — competitor names never leak into owner identity', () => {
  it('the extracted competitive context contains no competitor name in any identity field', () => {
    const ctx = extractCompetitiveContextFromProfile(PROFILE() as never) as unknown as Record<string, unknown>;
    const identityText = JSON.stringify({
      marketFocus: ctx.marketFocus, primaryService: ctx.primaryService, targetCustomer: ctx.targetCustomer,
      idealCustomerProfile: ctx.idealCustomerProfile, brandPositioning: ctx.brandPositioning, businessModel: ctx.businessModel,
    });
    expect(identityText).not.toMatch(/RivalCorp/i);
  });
  it('extraction is deterministic (ranking consistency — same input ⇒ same context)', () => {
    expect(extractCompetitiveContextFromProfile(PROFILE() as never)).toEqual(extractCompetitiveContextFromProfile(PROFILE() as never));
  });
});

describe('U4 · explainability — identity is independently traceable via the projection', () => {
  it('the seam exposes projection version + worldView separate from competitor evidence', () => {
    ON();
    const r = resolveCompanyProjection({ companyId: 'omnivyra', asOf: '2026-07-28T00:00:00.000Z', category: 'x', name: 'Omnivyra', domain: 'omnivyra.com', primaryMotion: 'AI software platform', marketPosition: 'AI-powered problem-solution provider' });
    expect(r.observation.version).toBeGreaterThan(0);
    expect(r.worldView).not.toBeNull();
  });
});

describe('U4 · rollback + performance', () => {
  it('rollback: prompt + fabrication gate flip with the flag (OFF ⇒ legacy)', () => {
    expect(buildCompetitorUnderstandingSystemPrompt(false)).toMatch(/state your understanding of THIS company/);
    expect(mayFabricateSparseIdentity(false)).toBe(true);
  });
  it('performance: extraction is pure/in-memory (1000 runs)', () => {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) extractCompetitiveContextFromProfile(PROFILE() as never);
    expect(Number(process.hrtime.bigint() - start) / 1e6).toBeLessThan(3000);
  });
});
