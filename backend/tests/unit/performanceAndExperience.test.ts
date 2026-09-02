/**
 * Phase 4 — performance + digital-experience evidence contract.
 *
 * The governing rule: a provider outage, a missing metric or a client-rendered site must
 * never become a performance claim or an experience diagnosis.
 */
import {
  CWV_THRESHOLDS,
  aggregatePerformanceEvidence,
  categorizeLabMetric,
  fetchPageSpeed,
  parsePageSpeedResponse,
  unavailableObservation,
  type PerformanceObservation,
} from '../../services/performanceEvidence';
import {
  assessDigitalExperience,
  detectClientSideRendering,
  type ExperiencePage,
} from '../../services/digitalExperience';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A PSI response with CrUX field data — the preferred, real-user source. */
const PSI_WITH_FIELD = {
  loadingExperience: {
    overall_category: 'AVERAGE',
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3200, category: 'AVERAGE' },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: 'FAST' },
      INTERACTION_TO_NEXT_PAINT: { percentile: 620, category: 'SLOW' },
    },
  },
  lighthouseResult: {
    finalUrl: 'https://acme.test/',
    configSettings: { formFactor: 'mobile' },
    categories: { performance: { score: 0.62 } },
    audits: {
      'largest-contentful-paint': { numericValue: 4100 },
      'first-contentful-paint': { numericValue: 1500 },
      'server-response-time': { numericValue: 300 },
      'bootup-time': { numericValue: 2400 },
    },
  },
};

/** A PSI response with lab data only — no field data available for this URL. */
const PSI_LAB_ONLY = {
  lighthouseResult: {
    finalUrl: 'https://acme.test/pricing',
    categories: { performance: { score: 0.91 } },
    audits: {
      'largest-contentful-paint': { numericValue: 2100 },
      'cumulative-layout-shift': { numericValue: 0.04 },
      'first-contentful-paint': { numericValue: 1200 },
      'server-response-time': { numericValue: 950 },
    },
  },
};

const page = (over: Partial<ExperiencePage> = {}): ExperiencePage => ({
  url: 'https://acme.test/', page_type: 'home', title: 'Acme', meta_description: 'Acme site',
  headings: [{ level: 1, text: 'Acme' }], ctas: [{ text: 'Book a demo' }],
  internal_link_count: 6, http_status: 200, crawl_depth: 0, wordCount: 400,
  crawl_metadata: { signals: { form_count: 1 } }, ...over,
});

// ── Performance provider ──────────────────────────────────────────────────────

describe('Phase 4 — performance provider', () => {
  it('parses a valid response and PREFERS CrUX field data over lab data', () => {
    const o = parsePageSpeedResponse({ body: PSI_WITH_FIELD, url: 'https://acme.test/', formFactor: 'mobile' });
    expect(o.state).toBe('measured');
    const lcp = o.metrics.find((m) => m.key === 'LCP')!;
    // Field says 3200 (AVERAGE); lab says 4100. Field must win.
    expect(lcp.value).toBe(3200);
    expect(lcp.source).toBe('crux_field');
    expect(lcp.category).toBe('AVERAGE');
    expect(lcp.verdict).toBe('needs_improvement');
    expect(o.providerPerformanceScore).toBe(62);
    expect(o.overallCategory).toBe('AVERAGE');
  });

  it('normalises the CrUX CLS integer onto the published unit scale', () => {
    const o = parsePageSpeedResponse({ body: PSI_WITH_FIELD, url: 'https://acme.test/', formFactor: 'mobile' });
    const cls = o.metrics.find((m) => m.key === 'CLS')!;
    expect(cls.value).toBeCloseTo(0.05, 5);
    expect(cls.category).toBe('FAST');
  });

  it('falls back to lab data and TAGS it as lab, never as real-user data', () => {
    const o = parsePageSpeedResponse({ body: PSI_LAB_ONLY, url: 'https://acme.test/pricing', formFactor: 'desktop' });
    const lcp = o.metrics.find((m) => m.key === 'LCP')!;
    expect(lcp.source).toBe('lighthouse_lab');
    expect(lcp.value).toBe(2100);
    expect(lcp.category).toBe('FAST');
    const ttfb = o.metrics.find((m) => m.key === 'TTFB')!;
    expect(ttfb.value).toBe(950);
    expect(ttfb.category).toBe('AVERAGE'); // 950 is between good(800) and poor(1800)
  });

  it('a metric absent from the response stays unavailable — never estimated', () => {
    const o = parsePageSpeedResponse({ body: PSI_LAB_ONLY, url: 'https://acme.test/pricing', formFactor: 'desktop' });
    const inp = o.metrics.find((m) => m.key === 'INP')!;
    expect(inp.state).toBe('unavailable');
    expect(inp.value).toBeNull();
    expect(inp.category).toBe('NONE');
    expect(inp.verdict).toBe('unknown');
  });

  it('a malformed response yields unavailable, not a throw and not a score', () => {
    for (const body of [null, undefined, {}, { lighthouseResult: null }, 'not json']) {
      const o = parsePageSpeedResponse({ body, url: 'https://acme.test/', formFactor: 'mobile' });
      expect(o.state).toBe('unavailable');
      expect(o.providerPerformanceScore).toBeNull();
      expect(o.metrics.every((m) => m.value === null)).toBe(true);
    }
  });

  it('an HTTP error returns unavailable carrying the real reason', async () => {
    const failing = (async () => ({
      ok: false, status: 500,
      json: async () => ({ error: { message: 'Internal error' } }),
    })) as unknown as typeof fetch;
    const o = await fetchPageSpeed({ url: 'https://acme.test/', formFactor: 'mobile', fetchImpl: failing });
    expect(o.state).toBe('unavailable');
    expect(o.reasonUnavailable).toContain('HTTP 500');
    expect(o.providerPerformanceScore).toBeNull();
  });

  it('a rate limit is reported as a quota problem with the remedy', async () => {
    const limited = (async () => ({
      ok: false, status: 429,
      json: async () => ({ error: { message: 'Quota exceeded' } }),
    })) as unknown as typeof fetch;
    const o = await fetchPageSpeed({ url: 'https://acme.test/', formFactor: 'mobile', fetchImpl: limited });
    expect(o.reasonUnavailable).toContain('quota exceeded');
    expect(o.reasonUnavailable).toContain('PAGESPEED_API_KEY');
  });

  it('a timeout is reported as a timeout, not as a slow site', async () => {
    const hanging = (async () => { throw new Error('The operation was aborted due to timeout'); }) as unknown as typeof fetch;
    const o = await fetchPageSpeed({ url: 'https://acme.test/', formFactor: 'mobile', timeoutMs: 10, fetchImpl: hanging });
    expect(o.state).toBe('unavailable');
    expect(o.reasonUnavailable).toContain('timed out');
    // Critically: a timeout must NOT become a poor performance verdict.
    expect(o.metrics.every((m) => m.verdict === 'unknown')).toBe(true);
  });

  it('classifies lab metrics against the PUBLISHED thresholds', () => {
    expect(categorizeLabMetric('LCP', CWV_THRESHOLDS.LCP.good)).toBe('FAST');
    expect(categorizeLabMetric('LCP', CWV_THRESHOLDS.LCP.poor + 1)).toBe('SLOW');
    expect(categorizeLabMetric('LCP', 3000)).toBe('AVERAGE');
    expect(categorizeLabMetric('LCP', null)).toBe('NONE');
  });
});

// ── Aggregation + coverage ────────────────────────────────────────────────────

describe('Phase 4 — performance aggregation', () => {
  const measured = (formFactor: 'mobile' | 'desktop', body: unknown): PerformanceObservation =>
    parsePageSpeedResponse({ body, url: `https://acme.test/${formFactor}`, formFactor });

  it('aggregate verdict is the WORST measured metric, not an average', () => {
    // Field data contains a SLOW INP alongside a FAST CLS.
    const evidence = aggregatePerformanceEvidence({ observations: [measured('mobile', PSI_WITH_FIELD)], eligiblePages: 10 });
    expect(evidence.byFormFactor.mobile.verdict).toBe('poor');
  });

  it('keeps mobile and desktop separate and never infers one from the other', () => {
    const evidence = aggregatePerformanceEvidence({
      observations: [measured('mobile', PSI_WITH_FIELD)], eligiblePages: 10,
    });
    expect(evidence.byFormFactor.mobile.measured).toBe(1);
    expect(evidence.byFormFactor.desktop.measured).toBe(0);
    expect(evidence.byFormFactor.desktop.verdict).toBe('unknown');
  });

  it('reports coverage without letting it become a verdict', () => {
    const evidence = aggregatePerformanceEvidence({ observations: [measured('mobile', PSI_WITH_FIELD)], eligiblePages: 40 });
    expect(evidence.coverage).toEqual({ measured: 1, attempted: 1, eligible: 40 });
    expect(evidence.state).toBe('measured');
  });

  it('no observations → unavailable with a reason, never a score', () => {
    const evidence = aggregatePerformanceEvidence({ observations: [], eligiblePages: 12 });
    expect(evidence.state).toBe('unavailable');
    expect(evidence.reasonUnavailable).toBeTruthy();
    expect(evidence.byFormFactor.mobile.verdict).toBe('unknown');
  });

  it('all-failed observations stay unavailable and surface the provider reason', () => {
    const evidence = aggregatePerformanceEvidence({
      observations: [unavailableObservation({ url: 'https://acme.test/', formFactor: 'mobile', reason: 'quota exceeded' })],
      eligiblePages: 5,
    });
    expect(evidence.state).toBe('unavailable');
    expect(evidence.reasonUnavailable).toContain('quota exceeded');
  });
});

// ── Digital experience ────────────────────────────────────────────────────────

describe('Phase 4 — digital experience', () => {
  it('no crawl → abstains with an explicit limitation', () => {
    const dx = assessDigitalExperience({ pages: [] });
    expect(dx.readiness).toBe('insufficient_evidence');
    expect(dx.state).toBe('unavailable');
    expect(dx.findings).toEqual([]);
    expect(dx.limitations[0].kind).toBe('no_crawl');
  });

  it('a healthy site produces no fabricated problems', () => {
    const pages = [page(), page({ url: 'https://acme.test/pricing', page_type: 'pricing', crawl_depth: 1 }),
      page({ url: 'https://acme.test/contact', page_type: 'contact', crawl_depth: 1 })];
    const dx = assessDigitalExperience({ pages });
    expect(dx.findings.filter((f) => f.severity === 'critical')).toHaveLength(0);
    expect(['ready', 'partial']).toContain(dx.readiness);
  });

  it('observable problems produce evidence-linked findings', () => {
    const pages = [
      page({ url: 'https://acme.test/gone', http_status: 404 }),
      page({ url: 'https://acme.test/deep', crawl_depth: 6, internal_link_count: 0 }),
      page({ url: 'https://acme.test/x', ctas: [], internal_link_count: 0 }),
    ];
    const dx = assessDigitalExperience({ pages });
    const broken = dx.findings.find((f) => f.problem.includes('return errors'));
    expect(broken).toBeDefined();
    expect(broken!.evidence).toMatch(/\d+ of \d+/);
    expect(broken!.severity).toBe('critical');
    // Every finding must carry the full recommendation contract.
    for (const f of dx.findings) {
      expect(f.problem && f.evidence && f.whyItMatters && f.action && f.measurement).toBeTruthy();
    }
    expect(dx.readiness).toBe('obstructed');
  });

  it('NEVER claims visitor behaviour', () => {
    const dx = assessDigitalExperience({ pages: [page({ ctas: [] }), page({ url: 'https://acme.test/b', ctas: [] })] });
    expect(dx.describesVisitorBehavior).toBe(false);
    const serialized = JSON.stringify(dx).toLowerCase();
    for (const term of ['bounce', 'drop-off', 'dropoff', 'conversion rate', 'visitors left', 'session']) {
      expect(serialized).not.toContain(term);
    }
  });

  it('detects client-side rendering and reports it as a LIMITATION, not thin content', () => {
    const shells = Array.from({ length: 5 }, (_, i) => page({
      url: `https://spa.test/${i}`, wordCount: 10, headings: [], ctas: [],
    }));
    expect(detectClientSideRendering(shells)).toBe(true);
    const dx = assessDigitalExperience({ pages: shells });
    const limitation = dx.limitations.find((l) => l.kind === 'client_side_rendering');
    expect(limitation).toBeDefined();
    expect(limitation!.message).toContain('client-side rendering');
    // The thin-content FINDING must be suppressed — it would be a fabricated diagnosis.
    expect(dx.findings.some((f) => f.problem.includes('too little content'))).toBe(false);
  });

  it('does not mistake a few thin pages for a rendering architecture', () => {
    const pages = [page(), page(), page({ url: 'https://acme.test/thin', wordCount: 10, headings: [] })];
    expect(detectClientSideRendering(pages)).toBe(false);
  });

  it('performance findings cite the metric, threshold, form factor and source', () => {
    const perf = aggregatePerformanceEvidence({
      observations: [parsePageSpeedResponse({ body: PSI_WITH_FIELD, url: 'https://acme.test/', formFactor: 'mobile' })],
      eligiblePages: 3,
    });
    const dx = assessDigitalExperience({ pages: [page()], performance: perf });
    const finding = dx.findings.find((f) => f.pillar === 'technical_friction');
    expect(finding).toBeDefined();
    expect(finding!.evidence).toContain('mobile');
    expect(finding!.evidence).toMatch(/threshold for "good" is \d/);
    expect(finding!.evidence).toContain('real-user field data');
    expect(finding!.measurement).toContain('Re-run PageSpeed Insights');
  });

  it('unavailable performance is a limitation, never a poor verdict', () => {
    const perf = aggregatePerformanceEvidence({ observations: [], eligiblePages: 4 });
    const dx = assessDigitalExperience({ pages: [page()], performance: perf });
    expect(dx.findings.some((f) => f.pillar === 'technical_friction')).toBe(false);
    expect(dx.limitations.some((l) => l.kind === 'performance_unavailable')).toBe(true);
  });

  it('is deterministic', () => {
    const pages = [page(), page({ url: 'https://acme.test/b', http_status: 404 })];
    expect(JSON.stringify(assessDigitalExperience({ pages })))
      .toEqual(JSON.stringify(assessDigitalExperience({ pages })));
  });
});
