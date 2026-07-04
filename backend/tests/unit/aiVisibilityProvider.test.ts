import {
  aiVisibilityEvidenceAdapter, AI_VISIBILITY_EVIDENCE_KEYS, type AIVisibilityEvidenceInput,
} from '../../services/evidencePlatform/providers/aiVisibility/aiVisibilityEvidenceAdapter';
import { PROVIDER_FAILURE } from '../../services/evidencePlatform';
import {
  isAIVisibilityProviderConfigured, registerAIVisibilityProvider, isAIVisibilityProviderAvailable,
  aiVisibilityProviderReliability, buildAIVisibilityQueryRegistry, buildAIVisibilityProbes,
  consolidateProbeResults, fetchAIVisibilityEvidence, AI_VISIBILITY_PROMPT_SET_VERSION,
} from '../../services/aiVisibilityProviderBridge';
import { __clearProviderRegistry } from '../../services/evidencePlatform';
import type { AIVisibilityProbeResult, AIProviderId } from '../../services/intelligence/providerInterfaces';

const OBSERVED = '2026-01-31T00:00:00.000Z';

const input: AIVisibilityEvidenceInput = {
  subjectId: 'Acme',
  ecosystemsProbed: 5, ecosystemsResponding: 4, answerPresenceRate: 0.75, citationRate: 0.4,
  meanProminence: 0.55, citationCount: 12, distinctCitations: 8, queryCoverage: 4, topicCoverage: 3,
  providerAgreement: 0.75, freshnessHours: 6, observedAt: OBSERVED, providerReliability: 0.7,
  contributingProviders: ['chatgpt', 'gemini', 'claude', 'perplexity'],
};

const mkResult = (provider: AIProviderId, appeared: boolean, citationRate: number, opts: Partial<AIVisibilityProbeResult> = {}): AIVisibilityProbeResult => ({
  provider, query_class: 'branded', state: 'measured', citation_rate: citationRate,
  mean_prominence: appeared ? 0.6 : 0, mentions: appeared ? [{ provider, query: 'q', query_class: 'branded', appeared: true, prominence: 0.6, evidence_excerpt: `cite-${provider}`, observed_at: OBSERVED }] : [],
  evidence: { count: 1, sources: [provider], freshness: { last_observed_at: OBSERVED, age_hours: 0 }, observations: [] },
  reason_unavailable: null, ...opts,
});

describe('AI Visibility Provider — canonical adapter (BETA-PROVIDER-007)', () => {
  it('converts consolidated AI visibility to canonical Evidence, per-field MEASURED / derived CALCULATED', () => {
    const ev = aiVisibilityEvidenceAdapter.toEvidence(input, { observedAt: OBSERVED });
    const byKey = Object.fromEntries(ev.map((e) => [e.id.split(':').pop(), e]));
    expect(byKey['ai_answer_presence'].value).toBe(0.75);
    expect(byKey['ai_answer_presence'].maturity).toBe('MEASURED');
    expect(byKey['ai_citation_rate'].value).toBe(0.4);
    expect(byKey['ai_citation_count'].value).toBe(12);
    expect(byKey['ai_ecosystem_coverage'].value).toBe(5);
    expect(byKey['ai_responding_ecosystems'].value).toBe(4);
    expect(byKey['ai_provider_agreement'].value).toBe(0.75);
    expect(byKey['ai_provider_agreement'].maturity).toBe('CALCULATED');
    for (const e of ev) expect(e.sourceType).toBe('external_api');
  });

  it('observed absence (presence=0) is a genuine measurement, emitted not omitted', () => {
    const absent = { ...input, answerPresenceRate: 0, citationRate: 0, citationCount: 0 };
    const ev = aiVisibilityEvidenceAdapter.toEvidence(absent, { observedAt: OBSERVED });
    const byKey = Object.fromEntries(ev.map((e) => [e.id.split(':').pop(), e]));
    expect(byKey['ai_answer_presence'].value).toBe(0);
    expect(byKey['ai_answer_presence'].maturity).toBe('MEASURED');
  });

  it('never fabricates: omits metrics not observed', () => {
    const sparse: AIVisibilityEvidenceInput = {
      subjectId: 'x', ecosystemsProbed: 5, ecosystemsResponding: 0, answerPresenceRate: null,
      citationRate: null, meanProminence: null, citationCount: null, distinctCitations: null,
      queryCoverage: null, topicCoverage: null, providerAgreement: null, freshnessHours: null,
      observedAt: OBSERVED, providerReliability: 0.7, contributingProviders: [],
    };
    const ev = aiVisibilityEvidenceAdapter.toEvidence(sparse, { observedAt: OBSERVED });
    const keys = ev.map((e) => e.id.split(':').pop());
    expect(keys).toContain('ai_ecosystem_coverage');
    expect(keys).not.toContain('ai_citation_rate');
    expect(keys).not.toContain('ai_answer_presence');
  });

  it('is deterministic', () => {
    expect(aiVisibilityEvidenceAdapter.toEvidence(input, {})).toEqual(aiVisibilityEvidenceAdapter.toEvidence(input, {}));
  });

  it('maps failure to canonical Evidence (no silent failure, null value)', () => {
    const ev = aiVisibilityEvidenceAdapter.onFailure({
      providerId: 'llm_visibility', state: PROVIDER_FAILURE.TIMEOUT,
      reason: 'llm timeout', evidenceKey: 'ai_answer_presence', observedAt: OBSERVED,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toBeNull();
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect((ev[0].metadata as any).reason_code).toBe('PROVIDER_TIMEOUT');
  });

  it('exposes exactly the declared AI visibility evidence keys', () => {
    expect(aiVisibilityEvidenceAdapter.supportedEvidence).toEqual([...AI_VISIBILITY_EVIDENCE_KEYS]);
  });
});

describe('AI Visibility Provider — deterministic probe framework (Phase 5)', () => {
  it('query registry is deterministic + versioned (same inputs → same probes)', () => {
    const a = buildAIVisibilityQueryRegistry('Acme', 'CRM software');
    const b = buildAIVisibilityQueryRegistry('Acme', 'CRM software');
    expect(a).toEqual(b);
    expect(a.branded[0]).toContain('Acme');
    expect(a.category[0]).toContain('CRM software');
    expect(AI_VISIBILITY_PROMPT_SET_VERSION).toBe('1.0.0');
  });

  it('builds one probe per ecosystem × query class, deterministically ordered', () => {
    const probes = buildAIVisibilityProbes(['chatgpt', 'claude'], 'Acme', 'CRM');
    expect(probes).toHaveLength(2 * 4); // 2 ecosystems × 4 query classes
    expect(probes[0].provider).toBe('chatgpt');
    expect(probes[0].queries.length).toBeGreaterThan(0);
    // deterministic re-run
    expect(buildAIVisibilityProbes(['chatgpt', 'claude'], 'Acme', 'CRM')).toEqual(probes);
  });
});

describe('AI Visibility Provider — deterministic multi-ecosystem consolidation (Phase 7)', () => {
  it('consolidates observed results: presence rate, agreement, distinct citations', () => {
    const results = [
      mkResult('chatgpt', true, 0.5),
      mkResult('gemini', true, 0.3),
      mkResult('claude', false, 0.0),
      mkResult('perplexity', true, 0.6),
    ];
    const c = consolidateProbeResults(results, OBSERVED);
    expect(c.ecosystemsResponding).toBe(4);
    expect(c.answerPresenceRate).toBeCloseTo(0.75, 5); // 3 of 4 appeared
    expect(c.citationCount).toBe(3); // one mention each for the 3 that appeared
    expect(c.distinctCitations).toBe(3); // cite-chatgpt/gemini/perplexity
    expect(c.providerAgreement).toBeCloseTo(0.75, 5); // majority(3 appeared) / 4
    expect(c.citationRate).toBeCloseTo((0.5 + 0.3 + 0.0 + 0.6) / 4, 5);
  });

  it('excludes unavailable ecosystems from aggregates but counts them as probed (missing retrieval visible)', () => {
    const results: AIVisibilityProbeResult[] = [
      mkResult('chatgpt', true, 0.5),
      { provider: 'gemini', query_class: 'branded', state: 'unavailable', citation_rate: null, mean_prominence: null, mentions: [], evidence: { count: 0, sources: [], freshness: { last_observed_at: OBSERVED, age_hours: 0 }, observations: [] }, reason_unavailable: 'no key' },
    ];
    const c = consolidateProbeResults(results, OBSERVED);
    expect(c.ecosystemsProbed).toBe(2);
    expect(c.ecosystemsResponding).toBe(1); // only chatgpt measured
    expect(c.answerPresenceRate).toBe(1); // 1 of 1 responding appeared
  });

  it('all-unavailable yields a null aggregate (no fabrication)', () => {
    const results: AIVisibilityProbeResult[] = [
      { provider: 'chatgpt', query_class: 'branded', state: 'unavailable', citation_rate: null, mean_prominence: null, mentions: [], evidence: { count: 0, sources: [], freshness: { last_observed_at: OBSERVED, age_hours: 0 }, observations: [] }, reason_unavailable: 'no key' },
    ];
    const c = consolidateProbeResults(results, OBSERVED);
    expect(c.ecosystemsResponding).toBe(0);
    expect(c.answerPresenceRate).toBeNull();
    expect(c.contributingProviders).toEqual([]);
  });

  it('deduplicates identical citations across ecosystems', () => {
    const shared = (provider: AIProviderId): AIVisibilityProbeResult => ({
      provider, query_class: 'category', state: 'measured', citation_rate: 0.5, mean_prominence: 0.5,
      mentions: [{ provider, query: 'q', query_class: 'category', appeared: true, prominence: 0.5, evidence_excerpt: 'https://acme.com/pricing', observed_at: OBSERVED }],
      evidence: { count: 1, sources: [provider], freshness: { last_observed_at: OBSERVED, age_hours: 0 }, observations: [] }, reason_unavailable: null,
    });
    const c = consolidateProbeResults([shared('chatgpt'), shared('claude')], OBSERVED);
    expect(c.citationCount).toBe(2); // two mentions observed
    expect(c.distinctCitations).toBe(1); // same excerpt → de-duplicated
  });
});

describe('AI Visibility Provider — availability + failure governance (bridge)', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });
  const clearKeys = () => { for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'PERPLEXITY_API_KEY', 'AZURE_COPILOT_API_KEY']) delete process.env[k]; };

  it('is UNAVAILABLE without any LLM credential (backward compatible)', () => {
    clearKeys();
    expect(isAIVisibilityProviderConfigured()).toBe(false);
    const d = registerAIVisibilityProvider();
    expect(d.authStatus).toBe('unauthenticated');
    expect(d.connectionStatus).toBe('disconnected');
    expect(isAIVisibilityProviderAvailable()).toBe(false);
  });

  it('flips to connected when any one ecosystem credential is present', () => {
    clearKeys();
    process.env.OPENAI_API_KEY = 'sk-test';
    const d = registerAIVisibilityProvider();
    expect(d.authStatus).toBe('authenticated');
    expect(d.connectionStatus).toBe('connected');
    expect(isAIVisibilityProviderAvailable()).toBe(true);
    expect(aiVisibilityProviderReliability()).toBe(0.7);
  });

  it('fetch without credentials returns canonical UNAVAILABLE evidence (no live probe, no fabrication)', async () => {
    clearKeys();
    const ev = await fetchAIVisibilityEvidence('Acme', 'CRM', OBSERVED);
    expect(ev).toHaveLength(1);
    expect(ev[0].maturity).toBe('UNAVAILABLE');
    expect(ev[0].value).toBeNull();
    expect((ev[0].metadata as any).failure_state).toBe(PROVIDER_FAILURE.UNAVAILABLE);
  });
});
