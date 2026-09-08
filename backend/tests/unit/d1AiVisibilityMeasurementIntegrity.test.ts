/**
 * D1 — AI/GEO MEASUREMENT INTEGRITY.
 *
 * WHY THIS SUITE EXISTS. Report 1 told every customer "AI systems reliably
 * identify the brand" and printed an `AI surface N/100`. The number behind that
 * sentence came from asking `gpt-4o-mini` "What is {brand}?" and running a
 * word-boundary regex for the brand over the reply.
 *
 * The prompt NAMES THE BRAND. So any fluent answer contains it by construction,
 * and a model confabulating about a company it has never encountered scored
 * `appeared: true, prominence: 1.0` — byte-identical to a genuine citation. The
 * surface measured whether a brand name looked plausible to a language model.
 *
 * The fix is not wording. It is that `measured` now requires the provider to
 * have RETRIEVED something and to have returned externally checkable source
 * evidence for it. A model's recall of its own training data is not an
 * observation of the outside world, and this suite is what stops it becoming
 * one again.
 *
 * SECRETS: all synthetic. No network, no credential, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

// Only the HTTP seam is replaced. Rate limiter, cache, retry, logging and
// freshness all stay real — a probe that passes here passed the real machinery.
const fetchProduction = jest.fn();
jest.mock('../../services/intelligence/productionPrimitives', () => ({
  ...jest.requireActual('../../services/intelligence/productionPrimitives'),
  fetchProduction: (...args: unknown[]) => fetchProduction(...args),
}));

import { extractCitation } from '../../services/intelligence/citationExtractor';
import {
  resolveProbeOutcome,
  type ProbeObservationOutcome,
} from '../../services/intelligence/aiVisibilityGrounding';
import { OpenAIChatGPTAdapter } from '../../services/intelligence/adapters/openaiAdapter';
import { PerplexityAdapter } from '../../services/intelligence/adapters/perplexityAdapter';
import { provenanceForSource } from '../../services/evidenceProvenance';
import { buildAICitationMatrix } from '../../services/intelligence/aiCitationMatrixService';
import type {
  AIVisibilityProbe,
  AIVisibilityProbeResult,
  LLMVisibilityProvider,
} from '../../services/intelligence/providerInterfaces';

const BRAND = 'Northwind Analytics';
const DOMAIN = 'northwind.test';

/** The exact shape the OpenAI probe path consumes. */
const openAiBody = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }], model: 'gpt-4o-mini' }),
});

/** The Perplexity shape, including the grounded `citations[]` sonar returns. */
const perplexityBody = (content: string, citations: string[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }], citations, model: 'sonar' }),
});

const probeFor = (queries: string[]): AIVisibilityProbe =>
  ({
    provider: 'chatgpt',
    query_class: 'branded',
    queries,
    brandName: BRAND,
    domain: DOMAIN,
  }) as AIVisibilityProbe;

beforeEach(() => {
  fetchProduction.mockReset();
  process.env.OPENAI_API_KEY = 'test-key-not-a-real-credential';
  process.env.PERPLEXITY_API_KEY = 'test-key-not-a-real-credential';
  delete process.env.OPENAI_ADAPTER_GATEWAY_TRANSPORT;
  delete process.env.PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT;
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
});

// ── 1. THE FALSE POSITIVE ITSELF ────────────────────────────────────────────

describe('D1 — a model answer is not an observation of AI visibility', () => {
  it('a confabulated answer that names the brand is NOT measured', async () => {
    // THE DEFECT, reproduced. The model was asked "What is Northwind Analytics?"
    // and produced a fluent, entirely invented description. Under the old rule
    // this returned state:'measured', citation_rate 1.0, prominence 1.0.
    fetchProduction.mockResolvedValue(
      openAiBody(
        'Northwind Analytics is a leading provider of business intelligence software, ' +
          'founded in 2011 and headquartered in Seattle.',
      ),
    );
    const result = await new OpenAIChatGPTAdapter().probe(probeFor(['What is Northwind Analytics?']));
    expect(result.state).not.toBe('measured');
    expect(result.state).toBe('insufficient_signal');
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('ungrounded_answer');
  });

  it('the brand appearing ONLY because the prompt contained it earns nothing', async () => {
    // The decisive case. The answer is a refusal — it echoes the brand from the
    // question and states no knowledge. There is nothing here to observe.
    fetchProduction.mockResolvedValue(
      openAiBody(`I do not have any information about ${BRAND}.`),
    );
    const result = await new OpenAIChatGPTAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.state).not.toBe('measured');
    expect(result.citation_rate).toBeNull();
  });

  it('an ungrounded probe never yields a citation rate, however many queries ran', async () => {
    fetchProduction.mockResolvedValue(openAiBody(`${BRAND} is a data company.`));
    const result = await new OpenAIChatGPTAdapter().probe(
      probeFor([`What is ${BRAND}?`, `Is ${BRAND} legitimate?`, `Who founded ${BRAND}?`]),
    );
    expect(result.state).toBe('insufficient_signal');
    expect(result.citation_rate).toBeNull();
    expect(result.mean_prominence).toBeNull();
  });

  it('the ungrounded provider declares itself ungrounded', () => {
    expect(new OpenAIChatGPTAdapter().retrieval_grounded).toBe(false);
  });
});

// ── 2. WHAT A REAL OBSERVATION LOOKS LIKE ───────────────────────────────────

describe('D1 — a retrieval-grounded answer with sources can be measured', () => {
  it('grounded answer naming the brand, with citations, IS measured and corroborated', async () => {
    fetchProduction.mockResolvedValue(
      perplexityBody(`${BRAND} builds analytics tooling for mid-market retailers.`, [
        `https://${DOMAIN}/about`,
        'https://techreview.test/northwind-profile',
      ]),
    );
    const result = await new PerplexityAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.state).toBe('measured');
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('grounded_observation');
    expect(result.citation_rate).toBe(1);
    // Corroborated: the brand's OWN domain is among the sources the engine cited.
    expect(result.mentions[0].citation_corroborated).toBe(true);
    expect(result.mentions[0].grounded_sources).toContain(`https://${DOMAIN}/about`);
  });

  it('a grounded answer that does NOT name the brand is a measured NEGATIVE', async () => {
    // This is a real finding, not an absence of one: the answer engine retrieved
    // sources and this brand was not among what it surfaced.
    fetchProduction.mockResolvedValue(
      perplexityBody('The leading vendors are Contoso and Fabrikam.', [
        'https://contoso.test/',
        'https://fabrikam.test/',
      ]),
    );
    const result = await new PerplexityAdapter().probe(probeFor(['best retail analytics tools']));
    expect(result.state).toBe('measured');
    expect(result.citation_rate).toBe(0);
    expect(result.mentions[0].appeared).toBe(false);
    expect(result.mentions[0].citation_corroborated).toBe(false);
  });

  it('a grounded provider that returns NO sources cannot be measured', async () => {
    // Sonar answered, but without citations we cannot tell retrieval from recall.
    fetchProduction.mockResolvedValue(perplexityBody(`${BRAND} is a data company.`, []));
    const result = await new PerplexityAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.state).toBe('insufficient_signal');
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('ungrounded_answer');
  });

  it('naming the brand in prose while citing unrelated sources is NOT corroborated', async () => {
    fetchProduction.mockResolvedValue(
      perplexityBody(`${BRAND} is often compared to Contoso.`, ['https://contoso.test/blog']),
    );
    const result = await new PerplexityAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.state).toBe('measured');
    expect(result.mentions[0].appeared).toBe(true);
    expect(result.mentions[0].citation_corroborated).toBe(false);
  });

  it('the grounded provider declares itself grounded', () => {
    expect(new PerplexityAdapter().retrieval_grounded).toBe(true);
  });
});

// ── 3. ABSENCE AND FAILURE ARE DIFFERENT FINDINGS ───────────────────────────

describe('D1 — unavailable, failed and insufficient are distinguishable', () => {
  it('no credential yields unavailable, never measured', async () => {
    delete process.env.PERPLEXITY_API_KEY;
    const result = await new PerplexityAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.state).toBe('unavailable');
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('no_provider');
    expect(result.citation_rate).toBeNull();
  });

  it('a provider that was reached and threw is FAILED, not merely unavailable', async () => {
    fetchProduction.mockRejectedValue(new Error('upstream 503'));
    const result = await new PerplexityAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.state).toBe('unavailable');
    // "we could not ask" and "we asked and it broke" must stay separable.
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('provider_failed');
    expect(result.reason_unavailable).toBeTruthy();
  });

  it('no queries derived is its own outcome', async () => {
    const result = await new PerplexityAdapter().probe(probeFor([]));
    expect(result.state).toBe('unavailable');
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('no_queries');
  });
});

// ── 4. THE DECISION FUNCTION, DIRECTLY ──────────────────────────────────────

describe('D1 — resolveProbeOutcome is the single place state is decided', () => {
  const grounded = { appeared: true, grounded_sources: ['https://x.test/a'] };
  const ungrounded = { appeared: true, grounded_sources: [] as string[] };

  it('ungrounded provider can never reach measured, whatever it observed', () => {
    for (const observations of [[grounded], [grounded, grounded]]) {
      const out = resolveProbeOutcome({
        retrievalGrounded: false,
        observations,
        failureReason: null,
      });
      expect(out.state).not.toBe('measured');
    }
  });

  it('grounded provider with at least one sourced observation is measured', () => {
    expect(
      resolveProbeOutcome({ retrievalGrounded: true, observations: [grounded], failureReason: null })
        .state,
    ).toBe('measured');
  });

  it('grounded provider with zero sourced observations is insufficient_signal', () => {
    expect(
      resolveProbeOutcome({ retrievalGrounded: true, observations: [ungrounded], failureReason: null })
        .state,
    ).toBe('insufficient_signal');
  });

  it('no observations plus a failure reason is provider_failed', () => {
    const out = resolveProbeOutcome({
      retrievalGrounded: true,
      observations: [],
      failureReason: 'timeout',
    });
    expect(out.outcome).toBe<ProbeObservationOutcome>('provider_failed');
    expect(out.state).toBe('unavailable');
  });

  it('never returns measured for an empty observation set', () => {
    for (const retrievalGrounded of [true, false]) {
      expect(
        resolveProbeOutcome({ retrievalGrounded, observations: [], failureReason: null }).state,
      ).not.toBe('measured');
    }
  });
});

// ── 5. THE EXTRACTOR NO LONGER DECIDES GROUNDING ────────────────────────────

describe('D1 — extractCitation reports corroboration, and never invents it', () => {
  const base = {
    provider: 'perplexity' as const,
    query: `What is ${BRAND}?`,
    query_class: 'branded' as const,
    brandName: BRAND,
    domain: DOMAIN,
    observedAt: '2026-09-08T00:00:00.000Z',
  };

  it('with no sources, a brand match is never corroborated', () => {
    const m = extractCitation({ ...base, answer: `${BRAND} is great.`, groundedSources: [] });
    expect(m.appeared).toBe(true);
    expect(m.citation_corroborated).toBe(false);
    expect(m.grounded_sources).toEqual([]);
  });

  it('corroboration requires the brand DOMAIN among the sources, not any source', () => {
    const other = extractCitation({
      ...base,
      answer: `${BRAND} is great.`,
      groundedSources: ['https://unrelated.test/x'],
    });
    expect(other.citation_corroborated).toBe(false);

    const own = extractCitation({
      ...base,
      answer: `${BRAND} is great.`,
      groundedSources: ['https://www.northwind.test/pricing'],
    });
    expect(own.citation_corroborated).toBe(true);
  });

  it('a source whose host merely CONTAINS the domain does not corroborate', () => {
    // `northwind.test.evil.test` is a different host. Substring matching here
    // would let any attacker-controlled domain corroborate any brand.
    const m = extractCitation({
      ...base,
      answer: `${BRAND} is great.`,
      groundedSources: ['https://northwind.test.evil.test/x'],
    });
    expect(m.citation_corroborated).toBe(false);
  });

  it('an unparseable source is ignored rather than counted', () => {
    const m = extractCitation({
      ...base,
      answer: `${BRAND} is great.`,
      groundedSources: ['not a url', ''],
    });
    expect(m.citation_corroborated).toBe(false);
  });
});

// ── 6. PROVENANCE ───────────────────────────────────────────────────────────

describe('D1 — a model answer is not a public observation', () => {
  it('llm_probe is NOT PUBLIC_OBSERVED', () => {
    // It was. That is what let an ungrounded completion pass the Report 1
    // provenance boundary as though someone had looked at the outside world.
    expect(provenanceForSource('llm_probe')).not.toBe('PUBLIC_OBSERVED');
    expect(provenanceForSource('llm_probe')).toBe('INFERRED');
  });

  it('a grounded answer-engine observation IS PUBLIC_OBSERVED', () => {
    expect(provenanceForSource('answer_engine')).toBe('PUBLIC_OBSERVED');
  });
});

// ── 7. THE SCORE ────────────────────────────────────────────────────────────

describe('D1 — the customer-facing score cannot come from regex-only evidence', () => {
  const providerStub = (result: Partial<AIVisibilityProbeResult>): LLMVisibilityProvider =>
    ({
      id: 'chatgpt',
      retrieval_grounded: false,
      isAvailable: async () => true,
      probe: async (p: AIVisibilityProbe) =>
        ({
          provider: 'chatgpt',
          query_class: p.query_class,
          state: 'insufficient_signal',
          observation_outcome: 'ungrounded_answer',
          citation_rate: null,
          mean_prominence: null,
          mentions: [],
          evidence: { count: 0, sources: [], freshness: { last_observed_at: null, age_hours: null }, observations: [] },
          reason_unavailable: 'ungrounded',
          ...result,
        }) as AIVisibilityProbeResult,
    }) as LLMVisibilityProvider;

  it('an all-ungrounded matrix produces NO number', async () => {
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: {} as never },
      [providerStub({})],
    );
    expect(matrix.overall_score.value).toBeNull();
    expect(matrix.overall_score.state).not.toBe('measured');
  });
});

// ── 8. THE SECOND PATH ──────────────────────────────────────────────────────

describe('D1 — a structural crawl proxy cannot become an AI observation', () => {
  const { buildAIVisibilityState } = require('../../services/intelligence/dossier/intelligenceSurfacesCompetitive');

  /**
   * A canonical report's AI surface.
   *
   * `measuredCells` is the discriminator that matters: zero means no AI surface
   * was ever observed and the score can only have come from the structural crawl
   * proxy, however confident its state claims to be.
   */
  const reportWithAiScore = (state: string, value: number | null, measuredCells = 0) => ({
    ai_surface_presence: {
      score: { value, state, confidence: 'medium', band: 'operational', evidence: { count: 1, sources: ['crawler'], freshness: { last_observed_at: null, age_hours: null }, observations: [] } },
      citation_matrix:
        measuredCells > 0
          ? { cells: [], coverage: { measured_cells: measuredCells, unavailable_cells: 0, total_cells: 20 } }
          : null,
    },
    knowledge_graph: { entity: null },
  });

  it('an INFERRED structural score does not say "AI systems reliably identify the brand"', () => {
    // The path the adapter fix does not reach: `answer_coverage_score` is the
    // share of the company's OWN pages that look answer-shaped. It witnessed no
    // AI system. Scored 82, it used to read as confident retrieval.
    const out = buildAIVisibilityState(reportWithAiScore('inferred', 82));
    expect(out.state).toBe('unmeasured');
    expect(out.state_label).toBe('Not Yet Measured');
    expect(out.reading).not.toMatch(/reliably identify/i);
    expect(out.reading).toMatch(/not yet measurable/i);
  });

  it('a score backed by REAL measured AI cells still drives the narrative', () => {
    // The fix must not simply mute the section — real evidence still speaks, and
    // a partially-covered run counts, because a cell can only reach `measured`
    // through a grounded observation.
    const out = buildAIVisibilityState(reportWithAiScore('inferred', 82, 4));
    expect(out.state).toBe('identified');
  });

  it('a confident-looking score with ZERO observed cells stays unmeasured', () => {
    // Even stamped `measured`, a score no AI surface produced says nothing.
    const out = buildAIVisibilityState(reportWithAiScore('measured', 82, 0));
    expect(out.state).toBe('unmeasured');
  });

  it('the structural composite is never stated as measured AI visibility', () => {
    const { buildGeoAeoExecutiveSummary } = require('../../services/snapshotReport/geoAeoSummaryHelpers');
    expect(typeof buildGeoAeoExecutiveSummary).toBe('function');
  });
});

// ── 9. MUTATION-CLOSING ASSERTIONS ──────────────────────────────────────────
//
// Each test below exists because a mutation survived without it. They are the
// difference between a suite that describes the fix and one that enforces it.

describe('D1 — an unmeasured probe publishes no number and no observation source', () => {
  it('a grounded provider with no sources publishes NEITHER rate NOR prominence', async () => {
    // Kills: `measured = true` in the shared base, and an unconditional
    // citation_rate. Without this, the state stayed honest while the NUMBER —
    // the thing the customer actually reads — was published anyway.
    fetchProduction.mockResolvedValue(perplexityBody(`${BRAND} is a data company.`, []));
    const result = await new PerplexityAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.state).toBe('insufficient_signal');
    expect(result.citation_rate).toBeNull();
    expect(result.mean_prominence).toBeNull();
  });

  it('an ungrounded probe is sourced llm_probe, never answer_engine', async () => {
    // Kills: stamping every result `answer_engine`. The source kind is what the
    // Report 1 provenance boundary reads, so forging it re-opens the whole path.
    fetchProduction.mockResolvedValue(openAiBody(`${BRAND} is a data company.`));
    const result = await new OpenAIChatGPTAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.evidence.sources).toEqual(['llm_probe']);
    expect(result.evidence.sources).not.toContain('answer_engine');
  });

  it('a grounded, sourced probe IS stamped answer_engine', async () => {
    fetchProduction.mockResolvedValue(
      perplexityBody(`${BRAND} builds analytics tooling.`, [`https://${DOMAIN}/about`]),
    );
    const result = await new PerplexityAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.evidence.sources).toEqual(['answer_engine']);
  });
});

describe('D1 — the prompt is not evidence', () => {
  it('a brand named in the QUERY but absent from the ANSWER did not appear', () => {
    // Kills: scoring the query alongside the answer. This is the defect in its
    // purest form — the question contains the brand, so folding it into the
    // scored text makes every probe a guaranteed hit.
    const m = extractCitation({
      provider: 'perplexity',
      query: `What is ${BRAND}?`,
      query_class: 'branded',
      answer: 'I have no information on that company.',
      brandName: BRAND,
      domain: DOMAIN,
      groundedSources: [`https://${DOMAIN}/`],
      observedAt: '2026-09-08T00:00:00.000Z',
    });
    expect(m.appeared).toBe(false);
    expect(m.prominence).toBe(0);
  });

  it('end to end: the answer, not the question, decides appearance', async () => {
    fetchProduction.mockResolvedValue(
      perplexityBody('I have no information on that company.', ['https://ref.test/a']),
    );
    const result = await new PerplexityAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.mentions[0].appeared).toBe(false);
    expect(result.citation_rate).toBe(0);
  });
});

describe('D1 — the structural dimension itself cannot claim measurement', () => {
  const { DIMENSION_BUILDERS } = require('../../services/canonicalReport/canonicalReportBuilderInputs');

  const ctxWithRadar = (answerCoverage: number | null, axisHint?: string) => ({
    snapshot: {
      geo_aeo_visuals: {
        ai_answer_presence_radar: {
          answer_coverage_score: answerCoverage,
          axis_states: axisHint ? { answer_coverage_score: axisHint } : undefined,
        },
      },
    },
  });

  it('a numeric structural coverage score yields INFERRED, not measured', () => {
    // Kills: `typeof value === 'number' ? 'measured' : …`. This is the dimension
    // behind the export's "AI surface N/100", built from a crawl heuristic.
    const dim = DIMENSION_BUILDERS.ai_surface_presence(ctxWithRadar(82) as never);
    expect(dim.score.state).toBe('inferred');
    expect(dim.score.state).not.toBe('measured');
  });

  it('a `measured` axis hint cannot promote it either', () => {
    // The hint is computed from value-presence alone, so trusting it reintroduces
    // exactly the bug by a different route.
    const dim = DIMENSION_BUILDERS.ai_surface_presence(ctxWithRadar(82, 'measured') as never);
    expect(dim.score.state).toBe('inferred');
  });

  it('no structural value at all stays insufficient_signal', () => {
    const dim = DIMENSION_BUILDERS.ai_surface_presence(ctxWithRadar(null) as never);
    expect(dim.score.state).toBe('insufficient_signal');
  });
});

describe('D1 — the shared adapter base stamps its source from the evidence too', () => {
  it('a grounded provider whose run carried NO sources is stamped llm_probe', async () => {
    // Kills: forging `answer_engine` in the SHARED BASE. The earlier source-kind
    // test drove the OpenAI adapter, which keeps its own probe body — so the base,
    // which every other provider inherits, went unobserved. Perplexity answering
    // without citations is the case that reaches the base's ungrounded branch.
    fetchProduction.mockResolvedValue(perplexityBody(`${BRAND} is a data company.`, []));
    const result = await new PerplexityAdapter().probe(probeFor([`What is ${BRAND}?`]));
    expect(result.state).toBe('insufficient_signal');
    expect(result.evidence.sources).toEqual(['llm_probe']);
    expect(result.evidence.observations.every((o) => o.source === 'llm_probe')).toBe(true);
  });
});
