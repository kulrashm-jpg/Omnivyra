/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 5 — Lead Intelligence.
 *
 * Lead Intelligence is MIXED:
 *  • canonical `leadUnderstanding/` + `leadIntelligence/` = REFERENCES-ONLY (keyed by companyId; reads no
 *    company identity) — certified + GUARDED here;
 *  • the Active-Leads source-recommendation surface CONSUMES the company's projection-owned `category` —
 *    adopted via `adoptLeadCompanyIdentity` (flag OFF ⇒ same reference).
 * Types: Inventory · Identity Audit · Guard · Projection Integration · Prompt Integrity · Output Parity ·
 * Approved Improvement · Unexpected Regression · Rollback · Performance · Consumer Isolation.
 */
import * as fs from 'fs';
import * as path from 'path';
import { adoptLeadCompanyIdentity } from '../../services/companyIntelligence/adoption/consumers/leadIntelligenceConsumer';
import { readCompanyProfileIdentity, companyProfileRecordToInput } from '../../services/companyIntelligence/adoption/consumers/companyProfileConsumer';
import type { EvidenceSources } from '../../services/companyIntelligence/evidence';

const ASOF = '2026-07-28T00:00:00.000Z';
const AUTH = 'COMPANY_UNDERSTANDING_AUTHORITATIVE';
const ON = () => { process.env[AUTH] = 'true'; };
const OFF = () => { delete process.env[AUTH]; };
afterEach(OFF);

// ── Reference-only guard over the canonical spine ─────────────────────────────────────────────────
function readSources(dir: string): { file: string; text: string }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { file: string; text: string }[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...readSources(full));
    else if (e.name.endsWith('.ts')) out.push({ file: full, text: fs.readFileSync(full, 'utf8') });
  }
  return out;
}
const SPINE = [
  ...readSources(path.resolve(__dirname, '../../services/leadUnderstanding')),
  ...readSources(path.resolve(__dirname, '../../services/leadIntelligence')),
];
// Company-identity CONSUMPTION signals: profile fetch, identity DB read, or a shared company classifier.
const FORBIDDEN: [string, RegExp][] = [
  ['resolveCompanyProjection', /resolveCompanyProjection/],
  ['getCanonicalProfile', /getCanonicalProfile/],
  ['getProfile', /\bgetProfile\b/],
  ['company_profiles read', /company_profiles/],
  ['report_settings read', /report_settings/],
  ['CompanyProfile type', /\bCompanyProfile\b/],
  ['company classifiers', /classifyCompanyBusiness|inferEntityArchetype|inferCompanyDomainShape/],
];

describe('U3·C5 · identity audit / guard — canonical spine is references-only', () => {
  it('scans the canonical lead spine', () => { expect(SPINE.length).toBeGreaterThan(0); });
  it.each(FORBIDDEN)('leadUnderstanding/ + leadIntelligence/ never contain %s', (_label, re) => {
    expect(SPINE.filter((s) => re.test(s.text)).map((s) => s.file)).toEqual([]);
  });
});

// ── Adoption: source-recommendation `category` acquisition ─────────────────────────────────────────
const PROFILE = () => ({ name: 'Omnivyra', website_url: 'omnivyra.com', category: 'Analytics software for clearer performance insights', category_list: ['Analytics'], competitors: [] });
const EVIDENCE = (): EvidenceSources => ({
  profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'Omnivyra', domain: 'omnivyra.com' },
  ai: { companyId: 'omnivyra', observedAt: ASOF, category: 'AI-driven digital marketing & content platform' },
});

describe('U3·C5 · projection integration + parity', () => {
  it('flag OFF → same profile reference (byte-identical no-op)', () => {
    const p = PROFILE();
    expect(adoptLeadCompanyIdentity(p, 'omnivyra', ASOF)).toBe(p);
  });
  it('flag ON without evidence echoes the stored category (no correction without evidence)', () => {
    ON();
    expect(adoptLeadCompanyIdentity(PROFILE(), 'omnivyra', ASOF).category).toBe('Analytics software for clearer performance insights');
  });
  it('flag ON + evidence → projected category', () => {
    ON();
    expect(adoptLeadCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE()).category).toBe('AI-driven digital marketing & content platform');
  });
});

describe('U3·C5 · approved improvement + unexpected regression + rollback', () => {
  it('approved: category corrects under evidence; category_list untouched (not projection-owned)', () => {
    ON();
    const out = adoptLeadCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    expect(out.category).toBe('AI-driven digital marketing & content platform');
    expect(out.category_list).toEqual(['Analytics']);
  });
  it('regression: a parity-locked divergence (name) keeps the stored category', () => {
    ON();
    const evidence: EvidenceSources = { profile: { companyId: 'omnivyra', observedAt: ASOF, name: 'DIFFERENT', domain: 'omnivyra.com' }, ai: EVIDENCE().ai };
    expect(adoptLeadCompanyIdentity(PROFILE(), 'omnivyra', ASOF, evidence).category).toBe('Analytics software for clearer performance insights');
  });
  it('rollback: ON→OFF restores identical output', () => {
    const before = adoptLeadCompanyIdentity(PROFILE(), 'omnivyra', ASOF);
    ON();
    expect(adoptLeadCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE()).category).toBe('AI-driven digital marketing & content platform');
    OFF();
    expect(adoptLeadCompanyIdentity(PROFILE(), 'omnivyra', ASOF)).toEqual(before);
  });
});

describe('U3·C5 · explainability + performance + isolation', () => {
  it('explainability: the underlying read exposes the category delta + version', () => {
    ON();
    const id = readCompanyProfileIdentity({ ...companyProfileRecordToInput(PROFILE(), 'omnivyra', ASOF), evidence: EVIDENCE() });
    expect(id.observation.deltas.find((d) => d.field === 'category')?.class).toBe('approved_improvement');
    expect(id.projectionVersion).toBeGreaterThan(0);
  });
  it('performance: 1000 adopts, deterministic', () => {
    ON();
    const first = adoptLeadCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) adoptLeadCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE());
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(adoptLeadCompanyIdentity(PROFILE(), 'omnivyra', ASOF, EVIDENCE())).toEqual(first);
    expect(ms).toBeLessThan(2500);
  });
  it('isolation: never mutates the input profile; lead data untouched', () => {
    ON();
    const p = PROFILE();
    const snap = JSON.parse(JSON.stringify(p));
    adoptLeadCompanyIdentity(p, 'omnivyra', ASOF, EVIDENCE());
    expect(p).toEqual(snap);
  });
});
