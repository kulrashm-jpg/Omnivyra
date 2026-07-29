/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 7 — Execution Intelligence.
 *
 * Execution Intelligence is MIXED:
 *  • the execution-planner CORE (executionPlannerService / dailyPlanAiGenerator / executionPlannerPersistence)
 *    is REFERENCE-ONLY (company_id FK; reads no company identity) — certified + GUARDED here;
 *  • the BOLT schedule governance prompt CONSUMES the projection-owned `category` — adopted via
 *    `adoptExecutionCompanyIdentity` (flag OFF ⇒ same reference).
 * Types: Consumer Classification · Inventory · Identity Audit · Guard · Projection Integration · Planning
 * Integrity · Prompt Integrity · Output Parity · Approved Improvement · Unexpected Regression · Rollback ·
 * Performance · Consumer Isolation.
 */
import * as fs from 'fs';
import * as path from 'path';
import { adoptExecutionCompanyIdentity } from '../../services/companyIntelligence/adoption/consumers/executionIntelligenceConsumer';
import { readCompanyProfileIdentity, companyProfileRecordToInput } from '../../services/companyIntelligence/adoption/consumers/companyProfileConsumer';
import type { EvidenceSources } from '../../services/companyIntelligence/evidence';

const ASOF = '2026-07-28T00:00:00.000Z';
const AUTH = 'COMPANY_UNDERSTANDING_AUTHORITATIVE';
const ON = () => { process.env[AUTH] = 'true'; };
const OFF = () => { delete process.env[AUTH]; };
afterEach(OFF);

// ── Reference-only guard over the execution-planner CORE ───────────────────────────────────────────
const CORE_FILES = ['executionPlannerService.ts', 'dailyPlanAiGenerator.ts', 'executionPlannerPersistence.ts']
  .map((f) => path.resolve(__dirname, '../../services', f))
  .filter((f) => fs.existsSync(f))
  .map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8') }));

// Owner-company-identity CONSUMPTION signals (fetch / DB read / owner-specific fields / profile field reads / classifiers).
const FORBIDDEN: [string, RegExp][] = [
  ['resolveCompanyProjection', /resolveCompanyProjection/],
  ['getProfile', /\bgetProfile\b/],
  ['getCanonicalProfile', /getCanonicalProfile/],
  ['company_profiles read', /company_profiles/],
  ['report_settings read', /report_settings/],
  ['business_model', /business_?model/i],
  ['operating_model', /operating_?model/i],
  ['domain_role', /\bdomain_role\b/],
  ['provider_type', /provider_type/],
  ['solution_domains', /solution_domains/],
  ['.category read', /\.category\b/],
  ['.industry read', /\.industry\b/],
  ['company classifiers', /classifyCompanyBusiness|inferEntityArchetype|inferCompanyDomainShape/],
];

describe('U3·C7 · consumer classification / guard — execution-planner CORE is reference-only', () => {
  it('scans the execution-planner core files', () => { expect(CORE_FILES.length).toBeGreaterThan(0); });
  it.each(FORBIDDEN)('the core planner never contains %s', (_label, re) => {
    expect(CORE_FILES.filter((s) => re.test(s.text)).map((s) => s.file)).toEqual([]);
  });
});

// ── Adoption: the BOLT governance prompt `category` acquisition ────────────────────────────────────
const PROFILE = () => ({ name: 'Omnivyra', website_url: 'omnivyra.com', category: 'Analytics software for clearer performance insights', category_list: ['Analytics'], industry: 'Data & Analytics', competitors: [] });
const EVIDENCE = (): EvidenceSources => ({
  profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com' },
  ai: { companyId: 'omnivyra', observedAt: ASOF, category: 'AI-driven digital marketing & content platform' },
});

describe('U3·C7 · projection integration + planning integrity', () => {
  it('flag OFF → same profile reference (byte-identical no-op)', () => {
    const p = PROFILE();
    expect(adoptExecutionCompanyIdentity(p, 'omnivyra', ASOF)).toBe(p);
  });
  it('flag ON + evidence → projected category; industry/category_list unchanged (not projection-owned)', () => {
    ON();
    const out = adoptExecutionCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    expect(out.category).toBe('AI-driven digital marketing & content platform');
    expect(out.industry).toBe('Data & Analytics');
    expect(out.category_list).toEqual(['Analytics']);
  });
  it('flag ON without evidence echoes stored category (no execution-time reclassification)', () => {
    ON();
    expect(adoptExecutionCompanyIdentity(PROFILE(), 'omnivyra', ASOF).category).toBe('Analytics software for clearer performance insights');
  });
});

describe('U3·C7 · unexpected regression + rollback', () => {
  it('regression: a parity-locked divergence (name) keeps the stored category', () => {
    ON();
    const evidence: EvidenceSources = { profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'DIFFERENT', domain: 'omnivyra.com' }, ai: EVIDENCE().ai };
    expect(adoptExecutionCompanyIdentity(PROFILE(), 'omnivyra', ASOF, evidence).category).toBe('Analytics software for clearer performance insights');
  });
  it('rollback: ON→OFF restores identical output', () => {
    const before = adoptExecutionCompanyIdentity(PROFILE(), 'omnivyra', ASOF);
    ON();
    expect(adoptExecutionCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE()).category).toBe('AI-driven digital marketing & content platform');
    OFF();
    expect(adoptExecutionCompanyIdentity(PROFILE(), 'omnivyra', ASOF)).toEqual(before);
  });
});

describe('U3·C7 · explainability + performance + isolation', () => {
  it('explainability: the underlying read exposes the category delta + version', () => {
    ON();
    const id = readCompanyProfileIdentity({ ...companyProfileRecordToInput(PROFILE(), 'omnivyra', ASOF), evidence: EVIDENCE() });
    expect(id.observation.deltas.find((d) => d.field === 'category')?.class).toBe('approved_improvement');
    expect(id.projectionVersion).toBeGreaterThan(0);
  });
  it('performance: 1000 adopts, deterministic', () => {
    ON();
    const first = adoptExecutionCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) adoptExecutionCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(adoptExecutionCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE())).toEqual(first);
    expect(ms).toBeLessThan(2500);
  });
  it('isolation: never mutates the input profile', () => {
    ON();
    const p = PROFILE();
    const snap = JSON.parse(JSON.stringify(p));
    adoptExecutionCompanyIdentity(p, 'omnivyra', ASOF, EVIDENCE());
    expect(p).toEqual(snap);
  });
});
