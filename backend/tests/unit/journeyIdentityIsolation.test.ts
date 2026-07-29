/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 4 — Journey Intelligence.
 *
 * Journey Intelligence (the canonical `journeyIntelligence/` Understanding) is REFERENCES-ONLY: it owns
 * temporal progression and references Company by `companyRef`/`companyId` — it never reads legacy company
 * identity (category/business_model/operating_model/domain_role/industry/ICP/positioning), never fetches a
 * profile, never classifies, and constructs no LLM prompt. Therefore there is NOTHING to route through
 * `resolveCompanyProjection` — adoption is a verified no-op.
 *
 * This suite CERTIFIES and GUARDS that invariant (so Journey never starts reinterpreting company identity),
 * covering the required consumer test-types by verification. It is a static source-contract guard — no
 * production code changed for Consumer 4.
 */
import * as fs from 'fs';
import * as path from 'path';

const MODULE_DIR = path.resolve(__dirname, '../../services/journeyIntelligence');

function readSources(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readSources(full));
    else if (entry.name.endsWith('.ts')) out.push({ file: full.replace(MODULE_DIR, 'journeyIntelligence'), text: fs.readFileSync(full, 'utf8') });
  }
  return out;
}

const SOURCES = readSources(MODULE_DIR);
const ALL = SOURCES.map((s) => s.text).join('\n');

// Reads that would mean Journey is consuming/reinterpreting COMPANY IDENTITY (forbidden).
const FORBIDDEN_IDENTITY: [string, RegExp][] = [
  ['resolveCompanyProjection', /resolveCompanyProjection/],
  ['getCanonicalProfile', /getCanonicalProfile/],
  ['getProfile', /\bgetProfile\b/],
  ['CompanyProfile type', /\bCompanyProfile\b/],
  ['report_settings', /report_settings/],
  ['business_model', /business_?model/i],
  ['operating_model', /operating_?model/i],
  ['domain_role', /\bdomain_role\b/],
  ['ideal_customer', /ideal_customer/i],
  ['.category read', /\.category\b/],
  ['legacy classifiers', /classifyCompanyBusiness|inferEntityArchetype|inferCompanyDomainShape/],
];
// Note: journey's own `runCompletion` is the completion ENGINE (progression), not an LLM call — excluded.
const FORBIDDEN_PROMPT: [string, RegExp][] = [
  ['LLM client', /openai|anthropic|chat\.completions/i],
  ['AI gateway seam', /aiGateway|runCompletionWithOperation|runAiExecution/],
  ['prompt builder', /buildPrompt|systemPrompt/i],
];

describe('U3·C4 · inventory — the canonical Journey module exists and is scanned', () => {
  it('has source files under journeyIntelligence/', () => {
    expect(SOURCES.length).toBeGreaterThan(0);
  });
});

describe('U3·C4 · consumer isolation — Journey never reads company identity', () => {
  it.each(FORBIDDEN_IDENTITY)('does not contain %s anywhere in the module', (_label, re) => {
    const offenders = SOURCES.filter((s) => re.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe('U3·C4 · projection integration / journey context — references-only', () => {
  it('references Company by reference (companyRef/companyId), not by identity read', () => {
    expect(/companyRef|companyId/.test(ALL)).toBe(true); // reference key present
  });
});

describe('U3·C4 · prompt integrity + narrative integrity — no prompt, no reinterpretation', () => {
  it.each(FORBIDDEN_PROMPT)('constructs no %s (never asks an LLM to infer identity)', (_label, re) => {
    const offenders = SOURCES.filter((s) => re.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe('U3·C4 · output parity / approved improvement / unexpected regression / rollback — vacuous', () => {
  it('has no company-identity code path, so nothing can diverge, regress, or require rollback', () => {
    // No identity acquisition exists ⇒ flag state cannot change Journey identity output ⇒ byte-identical
    // under every flag value. Certified by the absence guards above.
    expect(FORBIDDEN_IDENTITY.every(([, re]) => !re.test(ALL))).toBe(true);
  });
});
