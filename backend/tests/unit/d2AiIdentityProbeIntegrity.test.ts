/**
 * D2 — AI VISIBILITY IDENTITY INTEGRITY.
 *
 * WHY THIS SUITE EXISTS. D1 established that a cell may be called `measured`
 * only when a retrieval-grounded engine returned source evidence. It left a
 * second hole open, one layer up: `buildAICitationMatrix` received
 * `{ brandName, domain }` and forwarded NEITHER to `provider.probe()`.
 *
 * Both adapters recovered the identity through a cast —
 *   `(probe as AIVisibilityProbe & { brandName?: string }).brandName ?? ''`
 * — which compiled cleanly against a contract that never declared the fields.
 * So `brandName` was `''` and `domain` was `null` on every probe in production.
 * `extractCitation` then built an EMPTY candidate set, found nothing to match,
 * and returned `appeared: false` for every answer.
 *
 * The consequence is the single most damaging outcome available in this path:
 * the first run against a retrieval-grounded engine would have published
 * `citation_rate: 0` in state `measured`, stamped `answer_engine`, for every
 * cell — a FALSE MEASURED ZERO. "We asked the answer engines about you and you
 * appear in none of them" is a sentence the system had no basis to say, and it
 * is indistinguishable, in the report, from the genuine measured zero this
 * suite also pins down.
 *
 * THE RULE THIS SUITE ENFORCES. These five must stay distinct and must never
 * collapse into one another or into zero:
 *   measured + cited | measured zero | not retrieved | provider failed |
 *   structurally unmeasurable
 *
 * SECRETS: all synthetic. No network, no credential, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

// Only the HTTP seam is replaced. Rate limiter, cache, retry, logging, grounding
// and state resolution all stay real.
const fetchProduction = jest.fn();
jest.mock('../../services/intelligence/productionPrimitives', () => ({
  ...jest.requireActual('../../services/intelligence/productionPrimitives'),
  fetchProduction: (...args: unknown[]) => fetchProduction(...args),
}));

import {
  buildAICitationMatrix,
  deriveCitationQueries,
  type AICitationMatrix,
} from '../../services/intelligence/aiCitationMatrixService';
import { aiSurfaceRationaleText } from '../../services/canonicalReport/canonicalReportBuilderAssembly';
import { resolveEvidenceReadiness } from '../../services/canonicalReport/reportEvidenceReadiness';
import { extractCitation } from '../../services/intelligence/citationExtractor';
import {
  resolveProbeIdentity,
  resolveProbeOutcome,
  type ProbeObservationOutcome,
} from '../../services/intelligence/aiVisibilityGrounding';
import { PerplexityAdapter } from '../../services/intelligence/adapters/perplexityAdapter';
import { OpenAIChatGPTAdapter } from '../../services/intelligence/adapters/openaiAdapter';
import type {
  AIQueryClass,
  AIVisibilityProbe,
  AIVisibilityProbeResult,
  LLMVisibilityProvider,
} from '../../services/intelligence/providerInterfaces';
import type { CanonicalReport } from '../../services/canonicalReport/canonicalReportTypes';

const BRAND = 'Northwind Analytics';
const DOMAIN = 'northwind.test';
// `as const` made this a readonly tuple, which cannot satisfy the mutable `string[]` the
// query-set parameter declares — one fixture, 24 call sites, 24 identical TS2322s. Typed as the
// parameter's own type instead: the fixture is the same value and the production contract is
// untouched; only the fixture now states the shape it is actually passed as.
const BRANDED_QUERIES: Partial<Record<AIQueryClass, string[]>> = { branded: [`What is ${BRAND}?`] };

/** Perplexity's shape: an answer plus the grounded `citations[]` sonar returns. */
const perplexityBody = (content: string, citations: string[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }], citations, model: 'sonar' }),
});

const openAiBody = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }], model: 'gpt-4o-mini' }),
});

/** A stub that records every probe it is handed, so the producer can be audited. */
function recordingProvider(opts: {
  id?: AIVisibilityProbeResult['provider'];
  grounded?: boolean;
  seen: AIVisibilityProbe[];
}): LLMVisibilityProvider {
  return {
    id: opts.id ?? 'chatgpt',
    retrieval_grounded: opts.grounded ?? false,
    isAvailable: async () => true,
    probe: async (probe: AIVisibilityProbe) => {
      opts.seen.push(probe);
      return {
        provider: probe.provider,
        query_class: probe.query_class,
        state: 'insufficient_signal',
        observation_outcome: 'ungrounded_answer',
        citation_rate: null,
        mean_prominence: null,
        mentions: [],
        evidence: {
          count: 0,
          sources: [],
          freshness: { last_observed_at: null, age_hours: null },
          observations: [],
        },
        reason_unavailable: 'ungrounded',
      } as AIVisibilityProbeResult;
    },
  } as LLMVisibilityProvider;
}

/** A report shell carrying only what the readiness orchestrator reads. */
const reportWithMatrix = (matrix: AICitationMatrix): CanonicalReport =>
  ({
    pillars: [
      {
        pillar: 'discoverability',
        dimensions: [{ key: 'ai_surface_presence', score: { value: 40, state: 'measured' } }],
      },
    ],
    competitive_surface_share: { competitors: [] },
    ai_surface_presence: { citation_matrix: { coverage: matrix.coverage } },
    scan_metadata: { persisted_at: '2026-02-01T00:00:00.000Z' },
    authority_overview: { overall_score: { state: 'measured' } },
  }) as unknown as CanonicalReport;

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

// ── THE DEFECT ITSELF: the producer dropped the subject ──────────────────────

describe('D2 — the matrix producer forwards company identity to every probe', () => {
  it('each probe carries the brand name and the domain it was built for', async () => {
    // THE NEGATIVE CONTROL TARGET. With the defect present this assertion fails
    // on the first probe: `brandName` arrives `undefined` and `domain`
    // `undefined`, which the adapters' old cast turned into `''` / `null`.
    const seen: AIVisibilityProbe[] = [];
    await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [recordingProvider({ seen })],
    );
    expect(seen).toHaveLength(4); // one per query class
    for (const probe of seen) {
      expect(probe.brandName).toBe(BRAND);
      expect(probe.domain).toBe(DOMAIN);
    }
  });

  it('the matrix records WHOSE visibility it measured', async () => {
    const seen: AIVisibilityProbe[] = [];
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [recordingProvider({ seen })],
    );
    expect(matrix.identity).toEqual({ brand_name: BRAND, domain: DOMAIN, resolved: true });
  });

  it('whitespace is not identity', async () => {
    const seen: AIVisibilityProbe[] = [];
    const matrix = await buildAICitationMatrix(
      { brandName: '   ', domain: '  ', queries: BRANDED_QUERIES },
      [recordingProvider({ seen })],
    );
    expect(matrix.identity.resolved).toBe(false);
    expect(resolveProbeIdentity({ brandName: '   ', domain: null }).resolved).toBe(false);
  });
});

// ── CASE A: correct domain + grounded retrieval ──────────────────────────────

describe('D2 / A — correct identity plus grounded retrieval reaches measured', () => {
  it('a grounded answer naming the brand and citing its domain is measured, cited and corroborated', async () => {
    fetchProduction.mockResolvedValue(
      perplexityBody(`${BRAND} is a data analytics firm.`, [`https://${DOMAIN}/about`]),
    );
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    const branded = matrix.cells.find((c) => c.query_class === 'branded')!;
    expect(branded.state).toBe('measured');
    expect(branded.observation_outcome).toBe<ProbeObservationOutcome>('grounded_observation');
    expect(branded.citation_rate).toBe(1);
    expect(branded.observed_count).toBe(1);
    expect(branded.structurally_unmeasurable).toBe(false);
  });

  it('NON-VACUITY: the legitimate case still produces a published number', async () => {
    // The fix must not be blanket suppression. A real grounded observation about
    // a real company must still reach the customer as a score.
    fetchProduction.mockResolvedValue(
      perplexityBody(`${BRAND} is a data analytics firm.`, [`https://${DOMAIN}/about`]),
    );
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    expect(matrix.coverage.measured_cells).toBeGreaterThan(0);
    expect(matrix.overall_score.value).not.toBeNull();
    expect(aiSurfaceRationaleText(matrix)).toContain('grounded citation data');
  });
});

// ── CASE G: a GENUINE measured zero ─────────────────────────────────────────

describe('D2 / G — a genuine measured zero exists, and is not the false one', () => {
  it('a grounded, sourced answer that does NOT name the brand is a measured 0', async () => {
    // The architecture DOES permit a real measured zero: the engine retrieved,
    // cited its sources, and simply did not mention this company. That is a
    // finding. It is reachable only because identity was supplied and the match
    // genuinely failed — which is exactly what the false zero counterfeited.
    fetchProduction.mockResolvedValue(
      perplexityBody('The leading analytics vendors are Acme BI and Globex Insight.', [
        'https://acme.test/bi',
      ]),
    );
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    const branded = matrix.cells.find((c) => c.query_class === 'branded')!;
    expect(branded.state).toBe('measured');
    expect(branded.observation_outcome).toBe<ProbeObservationOutcome>('grounded_observation');
    expect(branded.citation_rate).toBe(0);
    expect(branded.observed_count).toBe(0);
  });

  it('the genuine zero and the identity refusal are DIFFERENT findings', async () => {
    fetchProduction.mockResolvedValue(
      perplexityBody('The leading analytics vendors are Acme BI.', ['https://acme.test/bi']),
    );
    const real = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    const noSubject = await buildAICitationMatrix(
      { brandName: null, domain: null, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    const realCell = real.cells.find((c) => c.query_class === 'branded')!;
    const nullCell = noSubject.cells.find((c) => c.query_class === 'branded')!;
    expect([realCell.state, realCell.citation_rate]).toEqual(['measured', 0]);
    expect([nullCell.state, nullCell.citation_rate]).toEqual(['unavailable', null]);
    expect(realCell.observation_outcome).not.toBe(nullCell.observation_outcome);
  });
});

// ── CASE E: wrong or missing company identity ────────────────────────────────

describe('D2 / E — missing identity can never become a measured zero', () => {
  it('no brand and no domain: every cell is unavailable with outcome no_identity', async () => {
    fetchProduction.mockResolvedValue(
      perplexityBody('Some analytics vendors are Acme BI.', ['https://acme.test/bi']),
    );
    const matrix = await buildAICitationMatrix(
      { brandName: null, domain: null, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    expect(matrix.coverage.measured_cells).toBe(0);
    for (const cell of matrix.cells) {
      expect(cell.state).toBe('unavailable');
      expect(cell.citation_rate).toBeNull();
      expect(cell.mean_prominence).toBeNull();
    }
    expect(matrix.cells.find((c) => c.query_class === 'branded')!.observation_outcome)
      .toBe<ProbeObservationOutcome>('no_identity');
    expect(matrix.overall_score.value).toBeNull();
    expect(matrix.overall_score.state).not.toBe('measured');
  });

  it('the refusal happens BEFORE any paid provider call', async () => {
    // A subject-less run could only ever buy a citation rate of zero about
    // nobody, so it must not reach the transport at all.
    await buildAICitationMatrix(
      { brandName: null, domain: null, queries: BRANDED_QUERIES },
      [new PerplexityAdapter(), new OpenAIChatGPTAdapter()],
    );
    expect(fetchProduction).not.toHaveBeenCalled();
  });

  it('a brand alone is enough identity; a domain alone is enough identity', async () => {
    const brandOnly = resolveProbeIdentity({ brandName: BRAND, domain: null });
    const domainOnly = resolveProbeIdentity({ brandName: null, domain: DOMAIN });
    expect(brandOnly.resolved).toBe(true);
    expect(domainOnly.resolved).toBe(true);
    fetchProduction.mockResolvedValue(
      perplexityBody(`${BRAND} is a data firm.`, [`https://${DOMAIN}/a`]),
    );
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: null, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    expect(matrix.cells.find((c) => c.query_class === 'branded')!.state).toBe('measured');
  });

  it('a WRONG domain cannot manufacture corroboration from the brand name alone', async () => {
    // Naming the company in prose while citing someone else's site is a measured
    // observation, but not a corroborated one. The distinction is what stops a
    // confabulated name from reading as "an engine pointed a reader at your site".
    fetchProduction.mockResolvedValue(
      perplexityBody(`${BRAND} is often compared with Acme BI.`, ['https://acme.test/compare']),
    );
    const result = await new PerplexityAdapter().probe({
      provider: 'perplexity',
      query_class: 'branded',
      queries: [`What is ${BRAND}?`],
      brandName: BRAND,
      domain: DOMAIN,
    });
    expect(result.state).toBe('measured');
    expect(result.mentions[0].appeared).toBe(true);
    expect(result.mentions[0].citation_corroborated).toBe(false);
  });

  it('the `expertise` class is not asked at all without a brand label', () => {
    // It used to ask "What expertise does this company bring to X?" — a question
    // that names nobody, whose answer could still have carried a citation rate.
    const withBrand = deriveCitationQueries({
      brandName: BRAND,
      domain: DOMAIN,
      category: null,
      competitors: [],
      productServices: ['forecasting'],
    });
    const withoutBrand = deriveCitationQueries({
      brandName: null,
      domain: DOMAIN,
      category: null,
      competitors: [],
      productServices: ['forecasting'],
    });
    expect(withBrand.expertise).toHaveLength(1);
    expect(withBrand.expertise![0]).toContain(BRAND);
    expect(withoutBrand.expertise).toBeUndefined();
  });
});

// ── CASES B, C, D: unavailable vs not-performed vs performed-but-worthless ───

describe('D2 / B,C,D — the non-measured findings stay distinguishable', () => {
  it('B: no credential is unavailable + no_provider, never measured', async () => {
    delete process.env.PERPLEXITY_API_KEY;
    const result = await new PerplexityAdapter().probe({
      provider: 'perplexity',
      query_class: 'branded',
      queries: [`What is ${BRAND}?`],
      brandName: BRAND,
      domain: DOMAIN,
    });
    expect(result.state).toBe('unavailable');
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('no_provider');
    expect(result.citation_rate).toBeNull();
  });

  it('B: a provider that was reached and threw is provider_failed, not no_provider', async () => {
    fetchProduction.mockRejectedValue(new Error('gateway timeout'));
    const result = await new PerplexityAdapter().probe({
      provider: 'perplexity',
      query_class: 'branded',
      queries: [`What is ${BRAND}?`],
      brandName: BRAND,
      domain: DOMAIN,
    });
    expect(result.state).toBe('unavailable');
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('provider_failed');
  });

  it('C: no question to ask is no_queries — retrieval was never performed', async () => {
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: {} },
      [new PerplexityAdapter()],
    );
    expect(fetchProduction).not.toHaveBeenCalled();
    for (const cell of matrix.cells) {
      expect(cell.observation_outcome).toBe<ProbeObservationOutcome>('no_queries');
      expect(cell.citation_rate).toBeNull();
    }
  });

  it('D: retrieval performed but nothing cited is insufficient_signal, with NO rate', async () => {
    fetchProduction.mockResolvedValue(perplexityBody(`${BRAND} is a data firm.`, []));
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    const branded = matrix.cells.find((c) => c.query_class === 'branded')!;
    expect(branded.state).toBe('insufficient_signal');
    expect(branded.observation_outcome).toBe<ProbeObservationOutcome>('ungrounded_answer');
    expect(branded.citation_rate).toBeNull();
  });

  it('all five findings are pairwise distinct, and none of them is a measured zero', async () => {
    const outcomes = new Set<ProbeObservationOutcome>();

    fetchProduction.mockResolvedValue(
      perplexityBody('Acme BI leads the market.', ['https://acme.test/bi']),
    );
    const measuredZero = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    outcomes.add(measuredZero.cells.find((c) => c.query_class === 'branded')!.observation_outcome);

    fetchProduction.mockResolvedValue(perplexityBody(`${BRAND} exists.`, []));
    const ungrounded = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    outcomes.add(ungrounded.cells.find((c) => c.query_class === 'branded')!.observation_outcome);

    const noQueries = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: {} },
      [new PerplexityAdapter()],
    );
    outcomes.add(noQueries.cells[0].observation_outcome);

    fetchProduction.mockRejectedValue(new Error('boom'));
    const failed = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    outcomes.add(failed.cells.find((c) => c.query_class === 'branded')!.observation_outcome);

    const noIdentity = await buildAICitationMatrix(
      { brandName: null, domain: null, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    outcomes.add(noIdentity.cells[0].observation_outcome);

    delete process.env.PERPLEXITY_API_KEY;
    const noCredential = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    outcomes.add(noCredential.cells.find((c) => c.query_class === 'branded')!.observation_outcome);

    expect([...outcomes].sort()).toEqual([
      'grounded_observation',
      'no_identity',
      'no_provider',
      'no_queries',
      'provider_failed',
      'ungrounded_answer',
    ]);
    // Only the first of those is a measurement, and it is the only one that may
    // carry a rate of 0.
    expect(measuredZero.coverage.measured_cells).toBe(1);
    expect(ungrounded.coverage.measured_cells).toBe(0);
    expect(failed.coverage.measured_cells).toBe(0);
    expect(noIdentity.coverage.measured_cells).toBe(0);
    expect(noCredential.coverage.measured_cells).toBe(0);
  });
});

// ── CASE F: structurally unmeasurable cells ──────────────────────────────────

describe('D2 / F — structurally unmeasurable cells are named, and excluded from coverage', () => {
  it('a chat-model cell is flagged structurally unmeasurable; a grounded one is not', async () => {
    fetchProduction.mockImplementation(async (providerId: string) =>
      providerId === 'perplexity'
        ? perplexityBody(`${BRAND} is a data firm.`, [`https://${DOMAIN}/a`])
        : openAiBody(`${BRAND} is a data firm.`),
    );
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new OpenAIChatGPTAdapter(), new PerplexityAdapter()],
    );
    const chat = matrix.cells.filter((c) => c.provider === 'chatgpt');
    const grounded = matrix.cells.filter((c) => c.provider === 'perplexity');
    expect(chat.every((c) => c.structurally_unmeasurable)).toBe(true);
    expect(grounded.every((c) => !c.structurally_unmeasurable)).toBe(true);
    expect(matrix.coverage.total_cells).toBe(8);
    expect(matrix.coverage.measurable_cells).toBe(4);
    expect(matrix.coverage.structurally_unmeasurable_cells).toBe(4);
  });

  it('the coverage percentage divides by what COULD be measured, not by the grid', async () => {
    fetchProduction.mockResolvedValue(
      perplexityBody(`${BRAND} is a data firm.`, [`https://${DOMAIN}/a`]),
    );
    const matrix = await buildAICitationMatrix(
      {
        brandName: BRAND,
        domain: DOMAIN,
        queries: { branded: ['q1'], category: ['q2'], competitive: ['q3'], expertise: ['q4'] },
      },
      [new OpenAIChatGPTAdapter(), new PerplexityAdapter()],
    );
    expect(matrix.coverage.measured_cells).toBe(4);
    expect(matrix.coverage.total_cells).toBe(8);
    // The old denominator reported 50% for a run in which every measurable cell
    // was measured. The honest answer is 100%.
    const readiness = resolveEvidenceReadiness(reportWithMatrix(matrix));
    expect(readiness.ai_coverage_percentage).toBe(100);
    expect(Math.round((matrix.coverage.measured_cells / matrix.coverage.total_cells) * 100)).toBe(50);
  });

  it('nothing measurable reads as NO percentage, never as 0%', async () => {
    fetchProduction.mockResolvedValue(openAiBody(`${BRAND} is a data firm.`));
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new OpenAIChatGPTAdapter()],
    );
    expect(matrix.coverage.measurable_cells).toBe(0);
    const readiness = resolveEvidenceReadiness(reportWithMatrix(matrix));
    expect(readiness.ai_coverage_percentage).toBeNull();
    // And the gap does NOT disappear just because the percentage did.
    const aiGap = readiness.gaps.find((g) => g.area === 'AI visibility');
    expect(aiGap).toBeDefined();
    expect(aiGap!.why).toContain('cannot be measured at all');
    expect(aiGap!.impact).toContain('not low');
  });

  it('a report persisted before D2 keeps its historical denominator', () => {
    // Backwards compatibility: an absent `measurable_cells` means "not recorded",
    // which must not be read as zero.
    const legacy = {
      pillars: [],
      competitive_surface_share: { competitors: [] },
      ai_surface_presence: {
        citation_matrix: { coverage: { measured_cells: 1, unavailable_cells: 19, total_cells: 20 } },
      },
      scan_metadata: { persisted_at: null },
      authority_overview: { overall_score: { state: 'measured' } },
    } as unknown as CanonicalReport;
    expect(resolveEvidenceReadiness(legacy).ai_coverage_percentage).toBe(5);
  });
});

// ── THE RATIONALE SENTENCE ───────────────────────────────────────────────────

describe('D2 — the AI rationale states what actually happened', () => {
  it('never says "no LLM provider is configured" when a provider ran and answered', async () => {
    // THE DEFECT: the unmeasured branch was unconditional prose, and its only
    // trigger was `measured_cells === 0` — the steady state in production WITH
    // OPENAI_API_KEY set and the ChatGPT adapter billing on every run.
    fetchProduction.mockResolvedValue(openAiBody(`${BRAND} is a data firm.`));
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new OpenAIChatGPTAdapter()],
    );
    const text = aiSurfaceRationaleText(matrix);
    expect(matrix.coverage.measured_cells).toBe(0);
    expect(text).not.toContain('no LLM provider is configured');
    expect(text).toContain('does not retrieve from the live web');
    expect(text).toContain('no verifiable sources');
  });

  it('a genuinely unqueried surface DOES say no engine was queried', async () => {
    const seen: AIVisibilityProbe[] = [];
    const noProvider: LLMVisibilityProvider = {
      ...recordingProvider({ seen }),
      probe: async (probe: AIVisibilityProbe) =>
        ({
          provider: probe.provider,
          query_class: probe.query_class,
          state: 'unavailable',
          observation_outcome: 'no_provider',
          citation_rate: null,
          mean_prominence: null,
          mentions: [],
          evidence: {
            count: 0,
            sources: [],
            freshness: { last_observed_at: null, age_hours: null },
            observations: [],
          },
          reason_unavailable: 'not configured',
        }) as AIVisibilityProbeResult,
    } as LLMVisibilityProvider;
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [noProvider],
    );
    expect(aiSurfaceRationaleText(matrix)).toContain('no answer engine was queried');
  });

  it('a subject-less run says so, and claims no absence from AI surfaces', async () => {
    const matrix = await buildAICitationMatrix(
      { brandName: null, domain: null, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    const text = aiSurfaceRationaleText(matrix);
    expect(text).toContain('no company name or domain');
    expect(text).toContain('not a measured absence');
  });

  it('a failed provider is reported as unknown, not as absent', async () => {
    fetchProduction.mockRejectedValue(new Error('upstream 503'));
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new PerplexityAdapter()],
    );
    expect(aiSurfaceRationaleText(matrix)).toContain('unknown, not absent');
  });
});

// ── NEGATIVE CONTROLS: the defect, reproduced at the unit level ──────────────

describe('D2 — negative controls: the defect reproduced, and the guard that stops it', () => {
  it('REPRODUCTION: identity-less scoring plus the D1 rule yields a MEASURED ZERO', () => {
    // This is precisely what production would have published on its first
    // grounded run. The two halves are each individually correct; together,
    // without the identity precondition, they manufacture a false measurement.
    const mention = extractCitation({
      provider: 'perplexity',
      query: `What is ${BRAND}?`,
      query_class: 'branded',
      answer: `${BRAND} is a data analytics firm cited widely.`,
      brandName: '', // what the cast produced when the producer forwarded nothing
      domain: null,
      groundedSources: [`https://${DOMAIN}/about`],
      observedAt: new Date().toISOString(),
    });
    expect(mention.appeared).toBe(false); // nothing to match → "absent"
    expect(mention.citation_corroborated).toBe(false);

    const withoutGuard = resolveProbeOutcome({
      retrievalGrounded: true,
      identityResolved: true, // the defect: identity never checked
      observations: [mention],
      failureReason: null,
    });
    expect(withoutGuard.state).toBe('measured'); // ← the false measured zero

    const withGuard = resolveProbeOutcome({
      retrievalGrounded: true,
      identityResolved: false,
      observations: [mention],
      failureReason: null,
    });
    expect(withGuard.state).toBe('unavailable');
    expect(withGuard.outcome).toBe<ProbeObservationOutcome>('no_identity');
  });

  it('REPRODUCTION: a producer that drops identity is caught by the recording probe', async () => {
    // The defect was one missing pair of properties at one call site. Reproduce
    // it by handing the adapter the OLD probe shape and show the adapter refuses
    // rather than scoring a zero.
    fetchProduction.mockResolvedValue(
      perplexityBody(`${BRAND} is a data firm.`, [`https://${DOMAIN}/a`]),
    );
    const legacyProbe = {
      provider: 'perplexity',
      query_class: 'branded',
      queries: [`What is ${BRAND}?`],
    } as unknown as AIVisibilityProbe;
    const result = await new PerplexityAdapter().probe(legacyProbe);
    expect(result.state).not.toBe('measured');
    expect(result.observation_outcome).toBe<ProbeObservationOutcome>('no_identity');
    expect(result.citation_rate).toBeNull();
    expect(fetchProduction).not.toHaveBeenCalled();
  });

  it('REPRODUCTION: the old coverage denominator understates a complete run', async () => {
    fetchProduction.mockResolvedValue(
      perplexityBody(`${BRAND} is a data firm.`, [`https://${DOMAIN}/a`]),
    );
    const matrix = await buildAICitationMatrix(
      { brandName: BRAND, domain: DOMAIN, queries: BRANDED_QUERIES },
      [new OpenAIChatGPTAdapter(), new PerplexityAdapter()],
    );
    // Every measurable cell that had a question was measured, yet the old
    // formula reports 12% — a shortfall no operator could ever close.
    const oldPct = Math.round((matrix.coverage.measured_cells / matrix.coverage.total_cells) * 100);
    const newPct = resolveEvidenceReadiness(reportWithMatrix(matrix)).ai_coverage_percentage;
    expect(oldPct).toBe(13);
    expect(newPct).toBe(25);
    expect(newPct).toBeGreaterThan(oldPct);
  });
});
