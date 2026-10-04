/**
 * WP-14 (Track M) — tests for the OFFLINE Report 1 artifact assertion helpers.
 *
 * WHAT THESE TESTS ARE FOR, AND WHAT THEY ARE NOT
 * They test the VALIDATOR, not the product. A green run here says the harness correctly
 * distinguishes a healthy artifact from a defective one and from an artifact that simply did not
 * exercise the behaviour. It says nothing whatsoever about whether a real tenant's Report 1 is
 * correct — that observation requires the authorized real-tenant exercise WP-14 prepares and
 * does not run.
 *
 * Each fixture below is SYNTHETIC. The defective fixtures are reconstructions of the seven
 * documented defects, written from the merged contract suites in `backend/tests/unit/report1*.ts`,
 * so a validator that would have missed the original defect fails here.
 *
 * The most load-bearing tests are the ones asserting that ABSENCE IS NOT SUCCESS: a missing
 * surface must yield `surface_absent` and a surface with nothing to judge must yield
 * `not_observed`. A harness that reported either as `expected` would let the later gate conclude
 * "validated" from a report that validated nothing, which is the failure mode this workstream
 * exists to prevent.
 */
import {
  assertPresenceCheckIntegrity,
  assertRenderedPresenceRows,
  assertProvenanceBoundary,
  assertCompetitiveBaselineIntegrity,
  assertConversionDecisionIntegrity,
  assertAdvertisingIntegration,
  assertAdvertisingSafety,
  assertReport1PayloadPresent,
  summarizeReport1Findings,
  validateReport1Artifact,
  PRIVATE_SOURCE_KINDS,
  GOVERNED_PRESENCE_CHECKS,
  type Report1Finding,
  type CheckStatus,
} from '../../services/report1Validation/report1ArtifactAssertions';

const statusOf = (findings: Report1Finding[], id: string): CheckStatus | undefined =>
  findings.find((f) => f.id === id)?.status;

const statusesOf = (findings: Report1Finding[], id: string): CheckStatus[] =>
  findings.filter((f) => f.id === id).map((f) => f.status);

const has = (findings: Report1Finding[], status: CheckStatus) => findings.some((f) => f.status === status);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const check = (key: string, label: string, status: string, detail: string | null) => ({
  key, label, status, detail, engine: 'content' as const,
});

/** A site that genuinely publishes all seven, correctly reported. */
const PRESENCE_HEALTHY_PRESENT = {
  website_checks: {
    groups: [{
      id: 'content_structure',
      label: 'Content',
      checks: GOVERNED_PRESENCE_CHECKS.map((k) => check(k, k, 'pass', `Contact route found among the 8 pages read`)),
    }],
    evaluated: 7, notEvaluable: 0, total: 7, pagesEvaluated: 8, provenance: 'PUBLIC_OBSERVED',
  },
};

/** A real crawl that read real pages and found none of the seven — the corrected wording. */
const PRESENCE_HEALTHY_ABSENT = {
  website_checks: {
    groups: [{
      id: 'content_structure',
      label: 'Content',
      checks: GOVERNED_PRESENCE_CHECKS.map((k) => check(k, k, 'fail', `No ${k} found among the 3 pages read`)),
    }],
    evaluated: 7, notEvaluable: 0, total: 7, pagesEvaluated: 3, provenance: 'PUBLIC_OBSERVED',
  },
};

/** The slice-001 defect exactly as it shipped: pass + "detected on the site" on an absent asset. */
const PRESENCE_DEFECTIVE = {
  website_checks: {
    groups: [{
      id: 'content_structure',
      label: 'Content',
      checks: GOVERNED_PRESENCE_CHECKS.map((k) => check(k, k, 'pass', `${k} page detected on the site`)),
    }],
    evaluated: 7, notEvaluable: 0, total: 7, pagesEvaluated: 3, provenance: 'PUBLIC_OBSERVED',
  },
};

/** A verdict shaped exactly like the canonical `EvidenceTrace.provenance`. */
const verdict = (classes: string[], excludedSources: string[] = []) => ({
  classes,
  excluded: excludedSources.map((s) => ({ signal: 'x', source: s, observed_at: null })),
  excludedSources,
  report1Clean: excludedSources.length === 0,
});

const PROVENANCE_HEALTHY = {
  canonical: {
    evidence_trace: {
      overall: { count: 2, sources: ['crawler', 'serp'], observations: [{ signal: 'a', source: 'crawler', observed_at: null }], provenance: verdict(['PUBLIC_OBSERVED']) },
      by_dimension: {
        trust_coherence: {
          count: 0,
          sources: [],
          observations: [],
          provenance: verdict([], ['platform_activity', 'company_declared']),
        },
      },
    },
  },
  // GAP-08 — declared identity, labelled as declared. Legitimately COMPANY_CONFIRMED.
  company_identity: {
    fields: [{ key: 'offering', label: 'Offering', value: 'x', provenance: 'COMPANY_CONFIRMED', declaredValue: 'x', observedValue: null, agreement: 'declared_only' }],
    hasDeclared: true, hasObserved: false,
  },
};

const PROVENANCE_DEFECTIVE = {
  canonical: {
    evidence_trace: {
      overall: {
        count: 2,
        // The slice-002 defect: a private origin retained as though it were public.
        sources: ['crawler', 'platform_activity'],
        observations: [{ signal: 'sentiment', source: 'platform_activity', observed_at: null }],
        provenance: verdict(['PUBLIC_OBSERVED', 'OMNIVYRA_OBSERVED']),
      },
    },
  },
  advertising_like: { provenance: 'CONNECTED_SOURCE' },
};

const metrics = (over: Record<string, unknown> = {}) => ({
  content_depth: 88, authority_score: 84, publishing_frequency: null,
  engagement_score: null, seo_coverage: 86, geo_presence: null, aeo_readiness: 82,
  ...over,
});

const COMPETITIVE_HEALTHY = {
  competitor_intelligence: {
    comparison: {
      company: null,
      competitors: [{ competitor: { name: 'Acme' }, metrics: metrics(), deltas_vs_company: null, metrics_state: 'inferred', crawl_outcome: 'success' }],
    },
    generated_gaps: [],
  },
};

const COMPETITIVE_DEFECTIVE = {
  competitor_intelligence: {
    comparison: {
      company: { content_depth: 60, authority_score: 55, publishing_frequency: 40, engagement_score: 50, seo_coverage: 58, geo_presence: 30, aeo_readiness: 54 },
      competitors: [{
        competitor: { name: 'Acme' },
        // Zeroes where nothing was observed, and the company's own value mirrored onto the competitor.
        metrics: metrics({ publishing_frequency: 40, engagement_score: 0, geo_presence: 0 }),
        // A delta computed against a null that silently became 0.
        deltas_vs_company: { content_depth: 28, authority_score: 29, publishing_frequency: 0, engagement_score: 50, seo_coverage: 28, geo_presence: 0, aeo_readiness: 28 },
        metrics_state: 'inferred',
        crawl_outcome: 'success',
      }],
      generated_gaps: [],
    },
    generated_gaps: [{ gap_type: 'content_gap', title: 'Behind on content' }],
  },
};

const opportunity = (id: string, priorityScore: number, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  problem: 'p',
  evidence: [{ source: 'crawl', statement: 's', state: 'measured' }],
  businessImplication: 'b',
  action: 'a',
  expectedImpact: 'e',
  impact: 70,
  confidence: 'high',
  effort: 'low',
  priorityScore,
  measurement: 'The outcome is NOT measurable from public evidence.',
  measurementAvailable: false,
  sources: ['digital_experience'],
  crossSource: false,
  horizon: '0-30',
  ...over,
});

const planItem = (title: string, over: Record<string, unknown> = {}) => ({
  title, action: 'a', why: 'w', measurement: 'm', measurementAvailable: true,
  effort: 'low', confidence: 'high', sources: ['crawl'], ...over,
});

const CONVERSION_HEALTHY = {
  digital_snapshot: {
    opportunities: [
      opportunity('conversion_readiness', 92),
      opportunity('content_search_foundation', 41, { measurement: 'Re-crawl.' }),
    ],
    topPriorities: [opportunity('conversion_readiness', 92)],
    plan: {
      days_0_30: [planItem('Start with being able to act')],
      days_31_60: [planItem('Build out the pages', { dependsOn: 'conversion_readiness' })],
      days_61_90: [],
      notes: [],
    },
    unmeasuredDimensions: [], empty: false,
  },
};

const CONVERSION_DEFECTIVE = {
  digital_snapshot: {
    opportunities: [
      // Demand generation ahead of a materially deficient conversion path — the slice-004 defect.
      opportunity('content_search_foundation', 75, { measurement: 'Re-crawl.' }),
      opportunity('conversion_readiness', 70),
    ],
    topPriorities: [opportunity('content_search_foundation', 75)],
    // And the slice-005 defect: the dependency dropped before the customer.
    plan: { days_0_30: [planItem('Build out the pages')], days_31_60: [], days_61_90: [], notes: [] },
    unmeasuredDimensions: [], empty: false,
  },
};

const advertiser = (over: Record<string, unknown> = {}) => ({
  advertiserId: 'AR01', legalName: 'ACME ANALYTICS LTD', basedIn: 'IN', verified: true,
  ambiguityFlagged: false, adCountLabel: '~40 ads', creativeIds: ['CR1'],
  profileUrl: 'https://adstransparency.google.com/advertiser/AR01',
  resolutionState: 'MATCHED', resolutionBasis: 'declared legal name matched a verified advertiser',
  discoveredVia: 'advertiser_name', ...over,
});

const ADS_HEALTHY = {
  advertising: {
    accessState: 'observed', reason: null, source: 'ads_transparency', provenance: 'PUBLIC_OBSERVED',
    vantage: 'railway/in', observedAt: '2026-09-27T08:09:59.384Z',
    subjectLegalNameUsed: 'ACME ANALYTICS LTD',
    companyAdvertisers: [advertiser()],
    otherAdvertisers: [],
    counts: { domainAdCountLabel: '~120 ads', advertiserAccountsDiscovered: 3, matchedAdvertiserAccounts: 1 },
  },
  digital_snapshot: {
    opportunities: [
      opportunity('conversion_readiness', 92),
      opportunity('advertising_conversion_posture', 44, { sources: ['advertising', 'digital_experience'], crossSource: true, dependsOn: 'conversion_readiness' }),
    ],
    topPriorities: [opportunity('conversion_readiness', 92)],
    plan: { days_0_30: [], days_31_60: [], days_61_90: [], notes: [] },
    unmeasuredDimensions: [], empty: false,
  },
};

const ADS_DEFECTIVE = {
  advertising: {
    accessState: 'blocked', reason: 'provider blocked the vantage', source: 'ads_transparency',
    provenance: 'COMPANY_CONFIRMED', vantage: 'railway/in', observedAt: 'not-a-date',
    subjectLegalNameUsed: null,
    // Attribution without a MATCHED resolution, and without a legal name to match against.
    companyAdvertisers: [advertiser({ resolutionState: 'PROBABLE_MATCH', adCountLabel: 40 })],
    otherAdvertisers: [],
    counts: { domainAdCountLabel: 120, advertiserAccountsDiscovered: 3, matchedAdvertiserAccounts: 0 },
  },
  digital_snapshot: {
    opportunities: [
      opportunity('paid_acquisition_consideration', 30, {
        horizon: '0-30',
        action: 'The company should start advertising.',
        businessImplication: 'Its ROAS would improve.',
      }),
    ],
    topPriorities: [],
    plan: { days_0_30: [], days_31_60: [], days_61_90: [], notes: [] },
    unmeasuredDimensions: [], empty: false,
  },
  summary: 'The company does not advertise.',
};

// ── Slice 001 ────────────────────────────────────────────────────────────────

describe('slice 001 — website presence integrity', () => {
  it('a missing website_checks surface is surface_absent, never a pass', () => {
    const f = assertPresenceCheckIntegrity({});
    expect(f).toHaveLength(1);
    expect(f[0].status).toBe('surface_absent');
    expect(f[0].level).toBe('artifact_present');
    expect(has(f, 'expected')).toBe(false);
  });

  it('the shipped defect is caught: pass + "detected on the site" on an absent asset', () => {
    const f = assertPresenceCheckIntegrity(PRESENCE_DEFECTIVE);
    expect(statusOf(f, 'P-01')).toBe('unexpected');
    expect(f.find((x) => x.id === 'P-01')!.message).toMatch(/7 check\(s\) still carry the fabricated detail/);
  });

  it('a correctly reported ABSENCE is expected, and never reads as a pass', () => {
    const f = assertPresenceCheckIntegrity(PRESENCE_HEALTHY_ABSENT);
    expect(statusOf(f, 'P-01')).toBe('expected');
    expect(statusesOf(f, 'P-03')).toEqual(Array(7).fill('expected'));
    expect(has(f, 'unexpected')).toBe(false);
  });

  it('an absence detail sitting on a pass is the exact slice-001 defect and is named as such', () => {
    const f = assertPresenceCheckIntegrity({
      website_checks: {
        groups: [{ id: 'content_structure', label: 'C', checks: [check('testimonials', 'Testimonials', 'pass', 'No testimonials found among the 3 pages read')] }],
        pagesEvaluated: 3,
      },
    });
    expect(statusOf(f, 'P-03')).toBe('unexpected');
    expect(f.find((x) => x.id === 'P-03')!.message).toMatch(/exact slice-001 defect/);
  });

  it('a genuine pass with the corrected wording is expected', () => {
    const f = assertPresenceCheckIntegrity(PRESENCE_HEALTHY_PRESENT);
    expect(statusesOf(f, 'P-04')).toEqual(Array(7).fill('expected'));
    expect(has(f, 'unexpected')).toBe(false);
  });

  it('a pass whose detail does not name the pages read is unexpected', () => {
    const f = assertPresenceCheckIntegrity({
      website_checks: { groups: [{ id: 'c', label: 'C', checks: [check('testimonials', 'T', 'pass', 'Testimonials are present')] }], pagesEvaluated: 8 },
    });
    expect(statusOf(f, 'P-04')).toBe('unexpected');
  });

  it('mass-abstention is caught: the seven may not stop answering when pages were read', () => {
    const f = assertPresenceCheckIntegrity({
      website_checks: { groups: [{ id: 'c', label: 'C', checks: [check('case_studies', 'Case studies', 'not_evaluable', null)] }], pagesEvaluated: 12 },
    });
    expect(statusOf(f, 'P-05')).toBe('unexpected');
  });

  it('an empty crawl emitting none of the seven is expected; emitting them is not', () => {
    expect(statusOf(assertPresenceCheckIntegrity({ website_checks: { groups: [], pagesEvaluated: 0 } }), 'P-02')).toBe('expected');
    expect(statusOf(assertPresenceCheckIntegrity({
      website_checks: { groups: [{ id: 'c', label: 'C', checks: [check('testimonials', 'T', 'fail', null)] }], pagesEvaluated: 0 },
    }), 'P-02')).toBe('unexpected');
  });

  it('checks present but none of the seven is not_observed — not a pass', () => {
    const f = assertPresenceCheckIntegrity({
      website_checks: { groups: [{ id: 'reachability', label: 'R', checks: [check('robots_txt', 'robots.txt', 'pass', 'robots.txt served')] }], pagesEvaluated: 9 },
    });
    expect(statusOf(f, 'P-02')).toBe('not_observed');
    expect(f.find((x) => x.id === 'P-02')!.level).toBe('report_generated');
  });
});

describe('slice 001 — the rendered document', () => {
  const row = (label: string, pill: string) => `<dt>${label} <span>${pill}</span></dt><dd>detail</dd>`;

  it('a non-passing check rendering as Observed is caught', () => {
    const html = row('Testimonials', 'Observed');
    const f = assertRenderedPresenceRows(PRESENCE_HEALTHY_ABSENT, html);
    expect(statusOf(f, 'P-H3')).toBe('unexpected');
  });

  it('an Observed belonging to the NEXT row is not attributed to this one', () => {
    // "Testimonials" did not pass; "Case studies" did. Without row slicing the Observed on the
    // following row would be read as a violation on Testimonials.
    const artifact = {
      website_checks: {
        groups: [{
          id: 'c', label: 'C',
          checks: [check('testimonials', 'Testimonials', 'fail', 'No testimonials found among the 3 pages read'), check('case_studies', 'Case studies', 'pass', 'Case studies found among the 3 pages read')],
        }],
        pagesEvaluated: 3,
      },
    };
    const html = `${row('Testimonials', 'Not observed')}${row('Case studies', 'Observed')}`;
    const f = assertRenderedPresenceRows(artifact, html);
    expect(f.filter((x) => x.status === 'unexpected')).toHaveLength(0);
    expect(statusesOf(f, 'P-H5')).toEqual(['expected', 'expected']);
  });

  it('a label the payload holds but the document does not render is not_observed', () => {
    const f = assertRenderedPresenceRows(PRESENCE_HEALTHY_ABSENT, '<p>nothing here</p>');
    expect(statusesOf(f, 'P-H2')).toEqual(Array(7).fill('not_observed'));
    expect(statusOf(f, 'P-H6')).toBe('not_observed');
  });

  it('the fabricated string in the rendered document is caught even through HTML entities', () => {
    const f = assertRenderedPresenceRows(PRESENCE_HEALTHY_ABSENT, '<dd>Testimonials page detected on the site</dd>');
    expect(statusOf(f, 'P-H1')).toBe('unexpected');
  });
});

// ── Slice 002 ────────────────────────────────────────────────────────────────

describe('slice 002 — provenance boundary', () => {
  it('derives the private source set from evidenceProvenance rather than restating it', () => {
    expect([...PRIVATE_SOURCE_KINDS].sort()).toEqual(
      ['company_declared', 'gsc', 'platform_activity', 'social_links', 'trajectory_history'].sort(),
    );
  });

  it('a clean artifact passes, and the GAP-08 declared-identity section is NOT a violation', () => {
    const f = assertProvenanceBoundary(PROVENANCE_HEALTHY);
    expect(statusOf(f, 'V-01')).toBe('expected');
    expect(statusOf(f, 'V-02')).toBe('expected');
    expect(statusOf(f, 'V-03')).toBe('expected');
    expect(has(f, 'unexpected')).toBe(false);
  });

  it('the exclusion record is reported as the mechanism working, not as a defect', () => {
    const f = assertProvenanceBoundary(PROVENANCE_HEALTHY);
    expect(statusOf(f, 'V-04')).toBe('expected');
    expect(f.find((x) => x.id === 'V-04')!.message).toMatch(/set aside rather than dropped/);
  });

  it('a private class retained in a verdict is caught', () => {
    const f = assertProvenanceBoundary(PROVENANCE_DEFECTIVE);
    expect(statusOf(f, 'V-02')).toBe('unexpected');
    expect(f.find((x) => x.id === 'V-02')!.message).toMatch(/OMNIVYRA_OBSERVED/);
  });

  it('a bare private provenance literal outside the exempt sections is caught', () => {
    const f = assertProvenanceBoundary(PROVENANCE_DEFECTIVE);
    expect(statusOf(f, 'V-01')).toBe('unexpected');
    expect(f.find((x) => x.id === 'V-01')!.message).toMatch(/CONNECTED_SOURCE/);
  });

  it('a retained private evidence source is caught in both a list and a single field', () => {
    expect(statusOf(assertProvenanceBoundary(PROVENANCE_DEFECTIVE), 'V-03')).toBe('unexpected');
    expect(statusOf(assertProvenanceBoundary({ x: { sources: ['gsc'] } }), 'V-03')).toBe('unexpected');
    expect(statusOf(assertProvenanceBoundary({ x: { source: 'social_links' } }), 'V-03')).toBe('unexpected');
  });

  it('a `sources` array from a different vocabulary is left alone', () => {
    // digital_snapshot opportunities carry sources like ['advertising','digital_experience'].
    // The second entry gives the scan something it DOES recognise, so this tests the ignoring
    // rather than the empty-scan guard.
    const f = assertProvenanceBoundary({ x: { sources: ['advertising', 'digital_experience', 'crawl'] }, y: { sources: ['crawler'] } });
    expect(statusOf(f, 'V-03')).toBe('expected');
  });

  it('an artifact with nothing to scan is surface_absent, not a clean verdict', () => {
    const f = assertProvenanceBoundary({ canonical: {} });
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe('V-00');
    expect(f[0].status).toBe('surface_absent');
    expect(f[0].message).toMatch(/not a clean result/i);
  });

  it('an evidence source with no verdict stamped on it is not_observed for the verdict check', () => {
    const f = assertProvenanceBoundary({ t: { sources: ['crawler'] } });
    expect(statusOf(f, 'V-02')).toBe('not_observed');
    expect(statusOf(f, 'V-04')).toBe('not_observed');
    expect(f.find((x) => x.id === 'V-02')!.message).toMatch(/NOT a clean verdict/);
  });

  it('a verdict that contradicts its own exclusion record is caught', () => {
    const f = assertProvenanceBoundary({ t: { provenance: { classes: ['PUBLIC_OBSERVED'], excluded: [], excludedSources: [], report1Clean: false } } });
    expect(statusOf(f, 'V-04')).toBe('unexpected');
  });
});

// ── Slice 003 ────────────────────────────────────────────────────────────────

describe('slice 003 — competitive baseline integrity', () => {
  it('a missing competitor_intelligence surface is surface_absent', () => {
    expect(statusOf(assertCompetitiveBaselineIntegrity({}), 'C-00')).toBe('surface_absent');
  });

  it('a null company baseline with observed competitors and no gaps is the healthy shape', () => {
    const f = assertCompetitiveBaselineIntegrity(COMPETITIVE_HEALTHY);
    expect(statusOf(f, 'C-01')).toBe('expected');
    expect(statusOf(f, 'C-02')).toBe('expected');
    expect(statusOf(f, 'C-05')).toBe('expected');
    expect(statusOf(f, 'C-06')).toBe('expected');
    expect(has(f, 'unexpected')).toBe(false);
  });

  it('zeroes on the three uncrawlable dimensions are caught', () => {
    const f = assertCompetitiveBaselineIntegrity(COMPETITIVE_DEFECTIVE);
    expect(statusOf(f, 'C-02')).toBe('unexpected');
    expect(f.find((x) => x.id === 'C-02')!.message).toMatch(/Zero is a measurement/);
  });

  it('a competitor value mirrored from the company baseline is caught', () => {
    const f = assertCompetitiveBaselineIntegrity(COMPETITIVE_DEFECTIVE);
    expect(statusOf(f, 'C-05')).toBe('unexpected');
  });

  it('a delta computed against an unobserved side is caught — the null-as-zero trap', () => {
    const f = assertCompetitiveBaselineIntegrity({
      competitor_intelligence: {
        comparison: {
          company: { content_depth: 60, authority_score: 55, publishing_frequency: null, engagement_score: null, seo_coverage: 58, geo_presence: null, aeo_readiness: 54 },
          competitors: [{ metrics: metrics({ publishing_frequency: 40 }), deltas_vs_company: { publishing_frequency: 40 }, metrics_state: 'inferred' }],
        },
        generated_gaps: [],
      },
    });
    const c4 = f.filter((x) => x.id === 'C-04');
    expect(c4).toHaveLength(1);
    expect(c4[0].status).toBe('unexpected');
    expect(c4[0].message).toMatch(/null-coerced-to-zero defect/);
  });

  it('an arithmetically wrong delta is caught even when both sides are observed', () => {
    const f = assertCompetitiveBaselineIntegrity({
      competitor_intelligence: {
        comparison: {
          company: { content_depth: 60, authority_score: 55, publishing_frequency: null, engagement_score: null, seo_coverage: 58, geo_presence: null, aeo_readiness: 54 },
          competitors: [{ metrics: metrics(), deltas_vs_company: { content_depth: 99 }, metrics_state: 'inferred' }],
        },
        generated_gaps: [],
      },
    });
    expect(statusOf(f, 'C-04')).toBe('unexpected');
  });

  it('gaps published with no company baseline are caught', () => {
    const f = assertCompetitiveBaselineIntegrity({
      competitor_intelligence: { comparison: { company: null, competitors: [] }, generated_gaps: [{ gap_type: 'content_gap' }] },
    });
    expect(statusOf(f, 'C-06')).toBe('unexpected');
  });

  it('an unavailable competitor carrying a filled metrics object is caught', () => {
    const f = assertCompetitiveBaselineIntegrity({
      competitor_intelligence: { comparison: { company: null, competitors: [{ metrics: metrics(), metrics_state: 'unavailable' }] }, generated_gaps: [] },
    });
    expect(statusOf(f, 'C-03')).toBe('unexpected');
  });

  it('no competitor metrics at all is not_observed, never a pass', () => {
    const f = assertCompetitiveBaselineIntegrity({
      competitor_intelligence: { comparison: { company: null, competitors: [{ metrics: null, metrics_state: 'unavailable' }] }, generated_gaps: [] },
    });
    expect(statusOf(f, 'C-02')).toBe('not_observed');
  });

  it('a present company baseline is reported as not_observed — the artifact cannot tell synthesized from observed', () => {
    const f = assertCompetitiveBaselineIntegrity({
      competitor_intelligence: { comparison: { company: metrics(), competitors: [] }, generated_gaps: [] },
    });
    expect(statusOf(f, 'C-01')).toBe('not_observed');
    expect(f.find((x) => x.id === 'C-01')!.message).toMatch(/trace its producer by hand/);
  });
});

// ── The WP-12 null-baseline delta scenario ───────────────────────────────────

describe('C-07 — the WP-12 null-baseline delta scenario', () => {
  /** Company baseline null + a competitor crawl that SUCCEEDED + deltas correctly null. */
  const SCENARIO_HELD = {
    competitor_intelligence: {
      comparison: {
        company: null,
        competitors: [{
          competitor: { name: 'Acme', domain: 'acme.test' },
          metrics: metrics(),
          deltas_vs_company: null,
          metrics_state: 'inferred',
          crawl_outcome: 'success',
        }],
      },
      generated_gaps: [],
    },
  };

  it('the full scenario held: null baseline, successful crawl, metrics present, delta null', () => {
    const f = assertCompetitiveBaselineIntegrity(SCENARIO_HELD);
    expect(statusOf(f, 'C-07')).toBe('expected');
    expect(f.find((x) => x.id === 'C-07')!.message).toMatch(/THE WP-12 SCENARIO IS OBSERVED AND HELD/);
    expect(f.find((x) => x.id === 'C-07')!.message).toMatch(/TypeError did not occur/);
  });

  it('a delta produced ANYWAY against a null baseline is caught', () => {
    const f = assertCompetitiveBaselineIntegrity({
      competitor_intelligence: {
        comparison: {
          company: null,
          competitors: [{ metrics: metrics(), deltas_vs_company: { content_depth: 88 }, metrics_state: 'inferred', crawl_outcome: 'success' }],
        },
        generated_gaps: [],
      },
    });
    expect(statusOf(f, 'C-07')).toBe('unexpected');
    expect(f.find((x) => x.id === 'C-07')!.message).toMatch(/A delta cannot exist when one side was never observed/);
  });

  it('no competitor crawl succeeded ⇒ the path was NOT exercised, and says so loudly', () => {
    const f = assertCompetitiveBaselineIntegrity({
      competitor_intelligence: {
        comparison: { company: null, competitors: [{ metrics: null, metrics_state: 'unavailable', crawl_outcome: 'client_error' }] },
        generated_gaps: [],
      },
    });
    expect(statusOf(f, 'C-07')).toBe('not_observed');
    expect(f.find((x) => x.id === 'C-07')!.message).toMatch(/single most important scenario to re-run/);
  });

  it('a non-null company baseline leaves the null-baseline path unexercised', () => {
    const f = assertCompetitiveBaselineIntegrity({
      competitor_intelligence: {
        comparison: { company: metrics(), competitors: [{ metrics: metrics(), deltas_vs_company: null, metrics_state: 'inferred' }] },
        generated_gaps: [],
      },
    });
    expect(statusOf(f, 'C-07')).toBe('not_observed');
  });
});

describe('R-00 — the thrown-composition fingerprint', () => {
  it('an artifact with NO Report 1 payload is unexpected, not merely empty', () => {
    const f = assertReport1PayloadPresent({ id: 'r1', status: 'completed' });
    expect(f).toHaveLength(1);
    expect(f[0].status).toBe('unexpected');
    expect(f[0].level).toBe('unexpected_behaviour');
    expect(f[0].message).toMatch(/fingerprint of a THROWN composition/);
    expect(f[0].message).toMatch(/console\.warn/);
  });

  it('a populated artifact confirms composition ran to completion', () => {
    const f = assertReport1PayloadPresent({ canonical: {}, website_checks: { groups: [] }, digital_snapshot: { opportunities: [] } });
    expect(f[0].status).toBe('expected');
    expect(f[0].message).toMatch(/Composition therefore ran to completion/);
  });

  it('surfaces present but no canonical report is flagged as a capture problem', () => {
    const f = assertReport1PayloadPresent({ website_checks: { groups: [] } });
    expect(f[0].status).toBe('unexpected');
    expect(f[0].message).toMatch(/inspect how this artifact was captured/);
  });

  it('distinguishes one absent surface (abstention) from all of them (incident)', () => {
    // Canonical present, advertising absent — an abstention, and R-00 stays expected.
    const abstention = assertReport1PayloadPresent({ canonical: {}, website_checks: { groups: [] } });
    expect(abstention[0].status).toBe('expected');
    // Nothing at all — an incident.
    const incident = assertReport1PayloadPresent({});
    expect(incident[0].status).toBe('unexpected');
  });
});

// ── Slices 004 + 005 ─────────────────────────────────────────────────────────

describe('slices 004/005 — conversion decision and dependency', () => {
  it('a missing digital_snapshot surface is surface_absent', () => {
    expect(statusOf(assertConversionDecisionIntegrity({}), 'D-00')).toBe('surface_absent');
  });

  it('a correctly sequenced report passes on every check', () => {
    const f = assertConversionDecisionIntegrity(CONVERSION_HEALTHY);
    expect(statusOf(f, 'D-01')).toBe('expected');
    expect(statusOf(f, 'D-02')).toBe('expected');
    expect(statusOf(f, 'D-03')).toBe('expected');
    expect(statusOf(f, 'D-04')).toBe('expected');
    expect(statusOf(f, 'D-05')).toBe('expected');
    expect(statusOf(f, 'D-07')).toBe('expected');
    expect(has(f, 'unexpected')).toBe(false);
  });

  it('demand generation outranking a conversion remediation is caught by score AND by position', () => {
    const f = assertConversionDecisionIntegrity(CONVERSION_DEFECTIVE);
    expect(statusOf(f, 'D-01')).toBe('unexpected');
    expect(statusOf(f, 'D-04')).toBe('unexpected');
  });

  it('a dependency dropped before the plan is reported, and not as a pass', () => {
    expect(statusOf(assertConversionDecisionIntegrity(CONVERSION_DEFECTIVE), 'D-05')).toBe('not_observed');
    expect(assertConversionDecisionIntegrity(CONVERSION_DEFECTIVE).find((x) => x.id === 'D-05')!.message)
      .toMatch(/lost between the opportunity and the plan/);
  });

  it('a dependency invented with no conversion remediation is caught', () => {
    const f = assertConversionDecisionIntegrity({
      digital_snapshot: { opportunities: [], topPriorities: [], plan: { days_0_30: [planItem('x', { dependsOn: 'conversion_readiness' })], days_31_60: [], days_61_90: [], notes: [] } },
    });
    expect(statusOf(f, 'D-05')).toBe('unexpected');
  });

  it('a plan item depending on something other than the conversion remediation is caught', () => {
    const f = assertConversionDecisionIntegrity({
      digital_snapshot: {
        opportunities: [opportunity('conversion_readiness', 92)],
        topPriorities: [opportunity('conversion_readiness', 92)],
        plan: { days_0_30: [planItem('x', { dependsOn: 'not_a_known_dependency' })], days_31_60: [], days_61_90: [], notes: [] },
      },
    });
    expect(statusOf(f, 'D-05')).toBe('unexpected');
  });

  it('no conversion remediation means the sequencing rule was not exercised — not that it passed', () => {
    const f = assertConversionDecisionIntegrity({
      digital_snapshot: { opportunities: [opportunity('content_search_foundation', 41)], topPriorities: [], plan: { days_0_30: [], days_31_60: [], days_61_90: [], notes: [] } },
    });
    expect(statusOf(f, 'D-01')).toBe('not_observed');
    expect(statusOf(f, 'D-05')).toBe('expected'); // no dependency invented — that IS observable
  });

  it('a conversion item claiming a measurement it cannot make is caught', () => {
    const f = assertConversionDecisionIntegrity({
      digital_snapshot: {
        opportunities: [opportunity('conversion_readiness', 92, { measurement: 'Track the uplift in signups.' })],
        topPriorities: [opportunity('conversion_readiness', 92)],
        plan: { days_0_30: [], days_31_60: [], days_61_90: [], notes: [] },
      },
    });
    expect(statusOf(f, 'D-03')).toBe('unexpected');
  });

  it('private-analytics language in the decision layer is caught', () => {
    const f = assertConversionDecisionIntegrity({
      digital_snapshot: { opportunities: [opportunity('conversion_readiness', 92, { businessImplication: 'Your conversion rate is falling.' })], topPriorities: [], plan: { days_0_30: [], days_31_60: [], days_61_90: [], notes: [] } },
    });
    expect(statusOf(f, 'D-07')).toBe('unexpected');
  });
});

// ── Slices 006 + 007 ─────────────────────────────────────────────────────────

describe('slice 006 — the ads read seam', () => {
  it('an absent advertising surface is surface_absent and says what it does NOT mean', () => {
    const f = assertAdvertisingIntegration({});
    expect(f[0].status).toBe('surface_absent');
    expect(f[0].message).toMatch(/NOT a finding that the company does not advertise/);
    expect(f[0].message).toMatch(/NOT evidence that the read seam is broken/);
  });

  it('a healthy observation passes provenance, freshness, attribution and counts', () => {
    const f = assertAdvertisingIntegration(ADS_HEALTHY);
    expect(statusOf(f, 'A-01')).toBe('expected');
    expect(statusOf(f, 'A-02')).toBe('expected');
    expect(statusOf(f, 'A-03')).toBe('expected');
    expect(statusOf(f, 'A-04')).toBe('expected');
    expect(statusOf(f, 'A-05')).toBe('expected');
    expect(statusOf(f, 'A-06')).toBe('expected');
  });

  it('every defect in the ads surface is caught', () => {
    const f = assertAdvertisingIntegration(ADS_DEFECTIVE);
    expect(statusOf(f, 'A-01')).toBe('unexpected'); // wrong provenance
    expect(statusOf(f, 'A-02')).toBe('unexpected'); // unparseable timestamp
    expect(statusOf(f, 'A-03')).toBe('unexpected'); // PROBABLE_MATCH attributed to the company
    expect(statusOf(f, 'A-04')).toBe('unexpected'); // count disagrees with the array
    expect(statusOf(f, 'A-05')).toBe('unexpected'); // attribution with no legal name used
    expect(statusOf(f, 'A-06')).toBe('unexpected'); // labels re-derived into integers
  });

  it('an observation with no matched advertiser is not_observed for attribution, not a failure', () => {
    const f = assertAdvertisingIntegration({
      advertising: { ...ADS_HEALTHY.advertising, companyAdvertisers: [], otherAdvertisers: [advertiser({ resolutionState: 'NOT_MATCHED' })], counts: { domainAdCountLabel: '~120 ads', advertiserAccountsDiscovered: 3, matchedAdvertiserAccounts: 0 } },
    });
    expect(statusOf(f, 'A-03')).toBe('not_observed');
    expect(statusOf(f, 'A-05')).toBe('expected');
  });
});

describe('slice 007 — advertising safety', () => {
  const DISCLAIMER = 'This is not a finding that the company does not advertise.';

  it('the renderer disclaimer is NOT reported as an affirmative absence claim', () => {
    // The guard is phrased as a negation of the forbidden claim, so a naive scan flags the guard.
    const f = assertAdvertisingSafety(ADS_HEALTHY, `<p>${DISCLAIMER} The vantage was blocked.</p>`);
    expect(statusOf(f, 'S-01')).toBe('expected');
    expect(statusOf(f, 'S-05')).toBe('expected');
  });

  it('an affirmative absence claim in the payload is caught', () => {
    expect(statusOf(assertAdvertisingSafety(ADS_DEFECTIVE), 'S-01')).toBe('unexpected');
  });

  it('an affirmative absence claim in the rendered document is caught beside the disclaimer', () => {
    const f = assertAdvertisingSafety(ADS_HEALTHY, `<p>${DISCLAIMER} The company is not advertising.</p>`);
    expect(statusOf(f, 'S-05')).toBe('unexpected');
  });

  it('performance language is caught in the payload and in the document', () => {
    expect(statusOf(assertAdvertisingSafety(ADS_DEFECTIVE), 'S-02')).toBe('unexpected');
    expect(statusOf(assertAdvertisingSafety(ADS_HEALTHY, '<p>Estimated ROAS is 3.1x.</p>'), 'S-06')).toBe('unexpected');
  });

  it('internal resolution enum names reaching the reader are caught', () => {
    expect(statusOf(assertAdvertisingSafety(ADS_HEALTHY, '<p>Acme (PROBABLE_MATCH)</p>'), 'S-07')).toBe('unexpected');
    expect(statusOf(assertAdvertisingSafety(ADS_HEALTHY, '<p>Acme Analytics Ltd</p>'), 'S-07')).toBe('expected');
  });

  it('an advertising decision without an observed read is caught', () => {
    expect(statusOf(assertAdvertisingSafety(ADS_DEFECTIVE), 'S-03')).toBe('unexpected');
  });

  it('a decision resting on an observed read is expected', () => {
    expect(statusOf(assertAdvertisingSafety(ADS_HEALTHY), 'S-03')).toBe('expected');
  });

  it('a consideration on day one or recommending spend is caught', () => {
    expect(statusOf(assertAdvertisingSafety(ADS_DEFECTIVE), 'S-04')).toBe('unexpected');
  });

  it('no advertising decision at all is not_observed, never a pass', () => {
    expect(statusOf(assertAdvertisingSafety({ digital_snapshot: { opportunities: [] } }), 'S-03')).toBe('not_observed');
    expect(statusOf(assertAdvertisingSafety({ digital_snapshot: { opportunities: [] } }), 'S-04')).toBe('not_observed');
  });

  it('the html checks do not run at all when no document was captured', () => {
    const ids = assertAdvertisingSafety(ADS_HEALTHY).map((f) => f.id);
    expect(ids).not.toContain('S-05');
    expect(ids).not.toContain('S-06');
    expect(ids).not.toContain('S-07');
  });
});

// ── Aggregate semantics — the point of the workstream ────────────────────────

describe('aggregate — absence is never success', () => {
  it('an empty artifact yields zero expected findings, and is flagged as a thrown composition', () => {
    const { findings, summary } = validateReport1Artifact({});
    expect(summary.expected).toBe(0);
    expect(summary.surfaceAbsent).toBeGreaterThan(0);
    expect(findings.every((f) => f.level !== 'expected_behaviour')).toBe(true);
    // The ONLY unexpected finding is R-00: an artifact with nothing in it is not an
    // uninteresting null result, it is the signature of a composition that threw.
    const unexpected = findings.filter((f) => f.status === 'unexpected');
    expect(unexpected.map((f) => f.id)).toEqual(['R-00']);
    // Slices 001/002/004/005/006/007 observed nothing at all.
    expect(summary.slicesNotObserved).toEqual(['001', '002', '004', '005', '006', '007']);
  });

  it('never emits route_reachable — a payload cannot establish that a route answered', () => {
    const { findings } = validateReport1Artifact({ ...PRESENCE_HEALTHY_ABSENT, ...ADS_HEALTHY }, '<p>x</p>');
    expect(findings.some((f) => f.level === 'route_reachable')).toBe(false);
  });

  it('a fully healthy artifact reports every slice as observed with no unexpected finding', () => {
    const artifact = {
      canonical: {},
      ...PRESENCE_HEALTHY_ABSENT,
      ...PROVENANCE_HEALTHY,
      ...COMPETITIVE_HEALTHY,
      ...ADS_HEALTHY,
      digital_snapshot: {
        ...CONVERSION_HEALTHY.digital_snapshot,
        opportunities: [...CONVERSION_HEALTHY.digital_snapshot.opportunities, ...ADS_HEALTHY.digital_snapshot.opportunities.slice(1)],
      },
    };
    const { summary } = validateReport1Artifact(artifact);
    expect(summary.unexpected).toBe(0);
    expect(summary.surfaceAbsent).toBe(0);
    expect(summary.slicesObserved).toEqual(['001', '002', '003', '004', '005', '006', '007']);
    expect(summary.slicesNotObserved).toEqual([]);
  });

  it('a fully defective artifact reports an unexpected finding for every slice', () => {
    const artifact = {
      ...PRESENCE_DEFECTIVE,
      ...PROVENANCE_DEFECTIVE,
      ...COMPETITIVE_DEFECTIVE,
      ...ADS_DEFECTIVE,
      digital_snapshot: {
        ...CONVERSION_DEFECTIVE.digital_snapshot,
        opportunities: [...CONVERSION_DEFECTIVE.digital_snapshot.opportunities, ...ADS_DEFECTIVE.digital_snapshot.opportunities],
      },
    };
    const { findings, summary } = validateReport1Artifact(artifact);
    expect(summary.unexpected).toBeGreaterThan(0);
    const slicesWithDefects = new Set(findings.filter((f) => f.status === 'unexpected').map((f) => f.slice));
    expect([...slicesWithDefects].sort()).toEqual(['001', '002', '003', '004', '006', '007']);
    // Slice 005's defect (the dependency dropped) is structurally indistinguishable from "no
    // demand item reached the plan", so the harness reports it as not_observed and says so —
    // it never guesses. The plan handles this by requiring the opportunity list to be read.
    expect(statusOf(findings, 'D-05')).toBe('not_observed');
  });

  it('the summary counts each status separately so nothing can be read as a pass by omission', () => {
    const s = summarizeReport1Findings([
      { id: 'a', slice: '001', status: 'expected', level: 'expected_behaviour', message: '', path: '$' },
      { id: 'b', slice: '002', status: 'not_observed', level: 'report_generated', message: '', path: '$' },
      { id: 'c', slice: '003', status: 'surface_absent', level: 'artifact_present', message: '', path: '$' },
      { id: 'd', slice: '004', status: 'unexpected', level: 'unexpected_behaviour', message: '', path: '$' },
    ]);
    expect(s).toEqual({
      total: 4, expected: 1, unexpected: 1, notObserved: 1, surfaceAbsent: 1,
      slicesObserved: ['001', '004'], slicesNotObserved: ['002', '003'],
    });
  });

  it('accepts the artifact at every depth the capture step may produce it', () => {
    const nested = { data: { report1: { website_checks: PRESENCE_HEALTHY_ABSENT.website_checks } } };
    expect(statusOf(assertPresenceCheckIntegrity(nested), 'P-01')).toBe('expected');
    expect(statusOf(assertPresenceCheckIntegrity({ report1: PRESENCE_HEALTHY_ABSENT }), 'P-01')).toBe('expected');
    expect(statusOf(assertPresenceCheckIntegrity({ data: PRESENCE_HEALTHY_ABSENT }), 'P-01')).toBe('expected');
  });

  it('accepts the camelCase view-payload spelling the API route returns', () => {
    // `/api/reports/[reportId]?type=snapshot` returns ReportViewPayload, not the persisted row.
    expect(statusOf(assertPresenceCheckIntegrity({ websiteChecks: PRESENCE_HEALTHY_ABSENT.website_checks }), 'P-01')).toBe('expected');
    expect(statusOf(assertConversionDecisionIntegrity({ digitalSnapshot: CONVERSION_HEALTHY.digital_snapshot }), 'D-01')).toBe('expected');
  });
});
