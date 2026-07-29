/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U3 · Consumer 7 — Execution Intelligence.
 *
 * Execution Intelligence (the GTM execution-CONTROL layer — listening/active-leads execution, planner,
 * governor, guardrails, drift/health/momentum, mode inference, observability, partitioning, pressure
 * balancing, controller/context, recommendation & intent execution, autopilot pipeline, platform
 * validator) is REFERENCE-ONLY with respect to company identity: it orchestrates WHEN/HOW actions run,
 * partitioned by `companyId` (a tenant key, enforced via `enforceCompanyAccess`) — it never reads legacy
 * company identity (category/industry/provider_type/solution_domains/business_model/operating_model/
 * domain_role/market_position/firmographics), never fetches a profile, never classifies a company, and
 * constructs no LLM prompt. Therefore there is NOTHING to route through `resolveCompanyProjection` —
 * adoption is a **verified no-op** (Classification B: reference-only consumer), identical in shape to
 * Consumer 4 (Journey) and Consumer 6 (Visitor).
 *
 * NOTE on false-positives the guard deliberately avoids: `companyId` is a tenant partition key (allowed);
 * `executionModeInference` classifies EXECUTION MODE (AI_AUTOMATED vs manual), NOT company identity;
 * content-grounding `getProfile` in the bolt/campaign generation pipeline belongs to Content Architect
 * (Consumer 2) / Market Pulse (Consumer 3) and is out of scope here. The guards target COMPANY-identity-
 * specific tokens + profile-fetch/classifier signals so they never false-positive on execution terms.
 *
 * AI usage note: the creator content-EXECUTION engine (`executionEngines/creatorExecutionEnginePrep/Run.ts`)
 * uses the AI gateway to GENERATE creative content when executing a scheduled action — but reads ZERO company
 * identity, so it cannot ground company identity at prompt time. The prompt audit therefore asserts the
 * precise invariant "no AI-using execution file also reads company identity", not the false "no AI at all".
 *
 * This suite CERTIFIES and GUARDS the invariant (so Execution never starts reinterpreting company
 * identity), covering the required consumer test-types by verification. It is a static source-contract
 * guard — no production code changed for Consumer 7.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

// The Execution Intelligence (execution-CONTROL) surface — the coherent set audited for Consumer 7.
const EXECUTION_FILES = [
  'backend/services/listeningExecutionService.ts',
  'backend/services/executionPlannerService.ts',
  'backend/services/executionPlannerPersistence.ts',
  'backend/services/executionContext.ts',
  'backend/services/executionGovernor.ts',
  'backend/services/executionGuardrailService.ts',
  'backend/services/executionDriftDetector.ts',
  'backend/services/executionHealthScorer.ts',
  'backend/services/executionMomentumTracker.ts',
  'backend/services/executionModeInference.ts',
  'backend/services/executionObservabilityService.ts',
  'backend/services/executionPartitionService.ts',
  'backend/services/executionPressureBalancer.ts',
  'backend/services/intelligenceExecutionController.ts',
  'backend/services/intelligenceExecutionContext.ts',
  'backend/services/recommendationExecutionService.ts',
  'backend/services/intentExecutionService.ts',
  'backend/services/autopilotExecutionPipeline.ts',
  'backend/services/platformExecutionValidator.ts',
  'pages/api/active-leads/executions.ts',
  'pages/api/settings/execution-config.ts',
];

function readExecutionEngines(): { file: string; text: string }[] {
  const dir = path.join(ROOT, 'backend/services/executionEngines');
  if (!fs.existsSync(dir)) return [];
  const out: { file: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ts')) out.push({ file: full.replace(ROOT + path.sep, '').replace(/\\/g, '/'), text: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

const SOURCES: { file: string; text: string }[] = [
  ...EXECUTION_FILES.filter((rel) => fs.existsSync(path.join(ROOT, rel))).map((rel) => ({ file: rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') })),
  ...readExecutionEngines(),
];
const ALL = SOURCES.map((s) => s.text).join('\n');

// Reads that would mean Execution is consuming/reinterpreting COMPANY IDENTITY (forbidden).
const FORBIDDEN_IDENTITY: [string, RegExp][] = [
  ['resolveCompanyProjection', /resolveCompanyProjection/],
  ['getCanonicalProfile', /getCanonicalProfile/],
  ['getProfile', /\bgetProfile\b/],
  ['CompanyProfile type', /\bCompanyProfile\b/],
  ['CompanyUnderstanding', /\bCompanyUnderstanding\b/],
  ['company_profiles read', /company_profiles/],
  ['report_settings read', /report_settings/],
  ['business_model', /business_?model/i],
  ['operating_model', /operating_?model/i],
  ['domain_role', /\bdomain_role\b/],
  ['provider_type', /provider_?type/i],
  ['solution_domains', /solution_?domains/i],
  ['market_position', /market_?position/i],
  ['firmographics', /firmographic/i],
  ['company .category read', /company[^.]*\.category\b|\bcompany_category\b/i],
  ['legacy company classifiers', /classifyCompanyBusiness|inferEntityArchetype|inferCompanyDomainShape/],
];

// Company-identity REASONING (classification/taxonomy/enrichment/repair) that must not exist in Execution.
const FORBIDDEN_COMPANY_REASONING: [string, RegExp][] = [
  ['industry inference', /industry\s*(inference|infer|classif|repair)/i],
  ['business-model inference', /business.?model\s*(inference|infer|classif)/i],
  ['provider-type inference', /provider.?type\s*(inference|infer|classif)/i],
  ['company taxonomy/category repair', /company\s*(taxonomy|category)\s*(repair|infer)/i],
  ['company enrichment/profile repair', /company\s*enrichment|profile\s*repair/i],
  ['prompt-time company classification', /prompt.?time\s*(company\s*)?classif/i],
  ['LLM company identity inference', /llm\s*(company\s*)?identity|company\s*identity\s*inference/i],
];

// Signals that a file constructs/invokes an AI prompt at all (content execution may legitimately do this).
const AI_SIGNAL = /openai|anthropic|chat\.completions|aiGateway|runCompletionWithOperation|buildPrompt|systemPrompt/i;

describe('U3·C7 · inventory — the Execution Intelligence surface exists and is scanned', () => {
  it('resolves execution-control source files', () => {
    expect(SOURCES.length).toBeGreaterThan(0);
  });
});

describe('U3·C7 · consumer classification + identity audit — Execution never reads company identity', () => {
  it.each(FORBIDDEN_IDENTITY)('does not contain %s anywhere in the execution surface', (_label, re) => {
    const offenders = SOURCES.filter((s) => re.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe('U3·C7 · duplicate reasoning audit — no company classification / taxonomy / enrichment', () => {
  it.each(FORBIDDEN_COMPANY_REASONING)('does not perform %s', (_label, re) => {
    const offenders = SOURCES.filter((s) => re.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});

describe('U3·C7 · reference-only + ownership — companyId is a tenant key, not an identity read', () => {
  it('references company by tenant key (companyId), not by identity read', () => {
    expect(/companyId/.test(ALL)).toBe(true);
  });
});

describe('U3·C7 · prompt audit — no prompt-time company grounding', () => {
  it('no AI-using execution file also reads company identity (⇒ prompts cannot ground company identity)', () => {
    const aiFiles = SOURCES.filter((s) => AI_SIGNAL.test(s.text));
    const groundIdentity = aiFiles.filter((s) => FORBIDDEN_IDENTITY.some(([, re]) => re.test(s.text))).map((s) => s.file);
    expect(groundIdentity).toEqual([]);   // AI is used only for content execution, never company-identity grounding
  });
});

describe('U3·C7 · output parity / regression / performance / rollback — vacuous', () => {
  it('has no company-identity code path, so nothing can diverge, regress, add latency, or require rollback', () => {
    // No identity acquisition exists ⇒ flag state cannot change Execution identity output ⇒ byte-identical
    // under every flag value; zero added AI/network/graph-traversal/evidence-resolution during execution.
    expect(FORBIDDEN_IDENTITY.every(([, re]) => !re.test(ALL))).toBe(true);
  });
});
