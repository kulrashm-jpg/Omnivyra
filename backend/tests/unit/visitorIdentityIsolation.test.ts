/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 6 — Visitor Intelligence.
 *
 * Visitor Intelligence (the canonical `visitorIntelligence/` Understanding, Program 5) is REFERENCE-ONLY:
 * it partitions by `companyId` and references the visitor's company via `companyRef` (a references-only
 * FK/edge), and NEVER reads owner-company identity (category/industry/business_model/operating_model/
 * domain_role/provider_type/solution_domains/market_position/firmographics/report_settings). It fetches no
 * profile, builds no LLM prompt, and re-derives no identity — visitor segments come from visitor behavior
 * only. Therefore there is NOTHING to route through `resolveCompanyProjection` — adoption is a verified
 * no-op. This suite CERTIFIES and GUARDS that invariant (Segmentation Integrity: segments never modify
 * company identity). No production code changed for Consumer 6.
 *
 * NOTE: `behavioral.ts` `interactionCategories`/`categoryDiversity` is VISITOR behavior (diversity of the
 * visitor's own interactions) — NOT the owner company's `category`. The guard deliberately targets
 * owner-identity-specific tokens + fetch/classifier signals so it never false-positives on visitor terms.
 */
import * as fs from 'fs';
import * as path from 'path';

const MODULE_DIR = path.resolve(__dirname, '../../services/visitorIntelligence');

function readSources(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...readSources(full));
    else if (e.name.endsWith('.ts')) out.push({ file: full.replace(MODULE_DIR, 'visitorIntelligence'), text: fs.readFileSync(full, 'utf8') });
  }
  return out;
}
const SOURCES = readSources(MODULE_DIR);
const ALL = SOURCES.map((s) => s.text).join('\n');

// Owner-company-identity CONSUMPTION signals (fetch / DB read / owner-specific fields / classifiers).
const FORBIDDEN_IDENTITY: [string, RegExp][] = [
  ['resolveCompanyProjection', /resolveCompanyProjection/],
  ['getCanonicalProfile', /getCanonicalProfile/],
  ['getProfile', /\bgetProfile\b/],
  ['company_profiles read', /company_profiles/],
  ['report_settings read', /report_settings/],
  ['CompanyProfile type', /\bCompanyProfile\b/],
  ['business_model', /business_?model/i],
  ['operating_model', /operating_?model/i],
  ['domain_role', /\bdomain_role\b/],
  ['provider_type', /provider_type/],
  ['solution_domains', /solution_domains/],
  ['market_position', /market_position/],
  ['company classifiers', /classifyCompanyBusiness|inferEntityArchetype|inferCompanyDomainShape/],
];
const FORBIDDEN_PROMPT: [string, RegExp][] = [
  ['LLM client', /openai|anthropic|chat\.completions/i],
  ['AI gateway seam', /aiGateway|runCompletionWithOperation|runAiExecution/],
  ['prompt builder', /buildPrompt|systemPrompt/i],
];

describe('U3·C6 · consumer classification / inventory', () => {
  it('the canonical Visitor module exists and is scanned', () => {
    expect(SOURCES.length).toBeGreaterThan(0);
  });
});

describe('U3·C6 · identity audit — Visitor never consumes owner-company identity', () => {
  it.each(FORBIDDEN_IDENTITY)('does not contain %s anywhere in the module', (_label, re) => {
    expect(SOURCES.filter((s) => re.test(s.text)).map((s) => s.file)).toEqual([]);
  });
});

describe('U3·C6 · reference-only + segmentation integrity', () => {
  it('references company by reference (companyRef/companyId), not by identity read', () => {
    expect(/companyRef|companyId/.test(ALL)).toBe(true);
  });
});

describe('U3·C6 · prompt integrity — no prompt, no identity inference', () => {
  it.each(FORBIDDEN_PROMPT)('constructs no %s (never asks an LLM to infer identity)', (_label, re) => {
    expect(SOURCES.filter((s) => re.test(s.text)).map((s) => s.file)).toEqual([]);
  });
});

describe('U3·C6 · output parity / approved / regression / rollback — vacuous', () => {
  it('has no owner-identity code path, so nothing can diverge, regress, or require rollback', () => {
    expect(FORBIDDEN_IDENTITY.every(([, re]) => !re.test(ALL))).toBe(true);
  });
});
