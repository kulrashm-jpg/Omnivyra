/**
 * Report 1 assembly — cross-source opportunities, prioritisation, 30/60/90 plan.
 *
 * The governing rule for this layer: assembly may only CONNECT evidence, never manufacture
 * it. A missing source must shrink the report, not soften it into generic advice.
 */
import {
  CONFIDENCE_MULTIPLIER,
  MAX_TOP_PRIORITIES,
  assembleDigitalSnapshot,
  horizonFor,
  isUnmeasured,
  passesEvidenceGate,
  priorityScore,
  type AssemblyInput,
  type CrossSourceOpportunity,
} from '../../services/digitalSnapshotAssembly';
import { EFFORT_DIVISOR } from '../../services/canonicalReport/scoringGovernance';
import {
  isReport1Source,
  provenanceForSource,
} from '../../services/evidenceProvenance';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const finding = (over: Partial<Record<string, string>> = {}) => ({
  pillar: 'information_accessibility', problem: 'Pages return errors',
  evidence: '3 of 15 pages returned 4xx/5xx', whyItMatters: 'A broken page is a hard stop.',
  action: 'Fix or redirect each failing URL.', severity: 'critical', effort: 'low',
  measurement: 'Re-crawl and confirm HTTP 200.', ...over,
}) as never;

const FULL: AssemblyInput = {
  experienceFindings: [
    finding(),
    finding({ pillar: 'value_communication', problem: 'Pages carry too little content to explain the offering', evidence: '5 of 15 pages have under 150 words', severity: 'moderate', effort: 'medium' }),
    finding({ pillar: 'value_communication', problem: 'Pages are missing a title or meta description', evidence: '1 of 15 pages lack a title', severity: 'low', effort: 'low' }),
    finding({ pillar: 'conversion_readiness', problem: 'Most pages offer no clear next step', evidence: 'Only 4 of 15 pages expose a CTA', severity: 'moderate', effort: 'low' }),
  ],
  dimensionStates: {
    searchVisibility: 'unavailable', aiVisibility: 'measured', performance: 'unavailable',
    content: 'measured', technical: 'measured', competitive: 'measured',
  },
  contentSignals: { score: 72, weaknesses: ['Readability'] },
  technicalSignals: { score: 83, criticalIssues: [] },
  competitive: {
    productCompetition: [
      { competitor: 'HubSpot', classification: 'direct', productOverlap: 75 },
      { competitor: 'Semrush', classification: 'substitute', productOverlap: 50 },
    ],
    empty: false,
  },
  coverage: { coverage_percentage: 89, website_scanned: true },
  positioning: { hasCategory: true, hasOffering: true },
};

// ── Prioritisation ────────────────────────────────────────────────────────────

describe('Report 1 assembly — prioritisation', () => {
  it('uses Impact × Confidence ÷ Effort', () => {
    const expected = (80 * CONFIDENCE_MULTIPLIER.high) / EFFORT_DIVISOR.low;
    expect(priorityScore({ impact: 80, confidence: 'high', effort: 'low' }))
      .toBeCloseTo(Math.round(expected * 100) / 100, 2);
  });

  it('all three inputs move the score', () => {
    const base = priorityScore({ impact: 60, confidence: 'medium', effort: 'medium' });
    expect(priorityScore({ impact: 80, confidence: 'medium', effort: 'medium' })).toBeGreaterThan(base);
    expect(priorityScore({ impact: 60, confidence: 'high', effort: 'medium' })).toBeGreaterThan(base);
    expect(priorityScore({ impact: 60, confidence: 'medium', effort: 'low' })).toBeGreaterThan(base);
    expect(priorityScore({ impact: 60, confidence: 'medium', effort: 'high' })).toBeLessThan(base);
  });

  it('severity alone does not win — a severe, high-effort, low-impact item ranks below a cheap high-impact one', () => {
    const severeButNiche = priorityScore({ impact: 35, confidence: 'high', effort: 'high' });
    const cheapAndValuable = priorityScore({ impact: 70, confidence: 'medium', effort: 'low' });
    expect(cheapAndValuable).toBeGreaterThan(severeButNiche);
  });

  it('ordering is deterministic across runs', () => {
    const a = assembleDigitalSnapshot(FULL).opportunities.map((o) => o.id);
    const b = assembleDigitalSnapshot(FULL).opportunities.map((o) => o.id);
    expect(a).toEqual(b);
    const scores = assembleDigitalSnapshot(FULL).opportunities.map((o) => o.priorityScore);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });

  it('horizon comes from effort and impact, not severity', () => {
    expect(horizonFor({ impact: 80, effort: 'low' })).toBe('0-30');
    expect(horizonFor({ impact: 80, effort: 'high' })).toBe('61-90');
    expect(horizonFor({ impact: 80, effort: 'medium' })).toBe('31-60');
    // Low impact, low effort is NOT day-one work.
    expect(horizonFor({ impact: 20, effort: 'low' })).toBe('31-60');
  });
});

// ── Cross-source behaviour ────────────────────────────────────────────────────

describe('Report 1 assembly — cross-source opportunities', () => {
  it('produces opportunities drawn from more than one evidence domain', () => {
    const result = assembleDigitalSnapshot(FULL);
    expect(result.opportunities.length).toBeGreaterThan(0);
    expect(result.opportunities.every((o) => o.sources.length >= 2)).toBe(true);
    expect(result.opportunities.every((o) => o.crossSource)).toBe(true);
  });

  it('caps top priorities at five', () => {
    const result = assembleDigitalSnapshot(FULL);
    expect(result.topPriorities.length).toBeLessThanOrEqual(MAX_TOP_PRIORITIES);
    expect(result.topPriorities[0]).toEqual(result.opportunities[0]);
  });

  it('every opportunity carries the full decision contract', () => {
    for (const o of assembleDigitalSnapshot(FULL).opportunities) {
      expect(o.problem).toBeTruthy();
      expect(o.evidence.length).toBeGreaterThan(0);
      expect(o.businessImplication).toBeTruthy();
      expect(o.action).toBeTruthy();
      expect(o.expectedImpact).toBeTruthy();
      expect(o.measurement).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(o.effort);
      expect(['low', 'medium', 'high']).toContain(o.confidence);
      expect(o.priorityScore).toBeGreaterThan(0);
    }
  });

  it('every opportunity cites concrete evidence, not adjectives', () => {
    for (const o of assembleDigitalSnapshot(FULL).opportunities) {
      const cited = o.evidence.map((e) => e.statement).join(' ');
      expect(cited).toMatch(/\d/); // a count, a URL or a measured value
    }
  });

  it('rules abstain when their inputs are absent — no generic filler', () => {
    // Only performance evidence exists, and it is unavailable.
    const sparse = assembleDigitalSnapshot({
      experienceFindings: [], dimensionStates: { performance: 'unavailable' },
    });
    expect(sparse.empty).toBe(true);
    expect(sparse.opportunities).toEqual([]);
    expect(sparse.topPriorities).toEqual([]);
  });

  it('the performance rule stays silent while performance is unmeasured', () => {
    const withPerfFinding: AssemblyInput = {
      ...FULL,
      experienceFindings: [...(FULL.experienceFindings ?? []), finding({ pillar: 'technical_friction', problem: 'LCP is poor on mobile' })],
      dimensionStates: { ...FULL.dimensionStates, performance: 'unavailable' },
    };
    expect(assembleDigitalSnapshot(withPerfFinding).opportunities.some((o) => o.id === 'performance_friction')).toBe(false);

    const measured: AssemblyInput = { ...withPerfFinding, dimensionStates: { ...FULL.dimensionStates, performance: 'measured' } };
    expect(assembleDigitalSnapshot(measured).opportunities.some((o) => o.id === 'performance_friction')).toBe(true);
  });

  it('the competitive rule stays silent when no competitor was discovered', () => {
    const noComp = assembleDigitalSnapshot({ ...FULL, competitive: { productCompetition: [], empty: true } });
    expect(noComp.opportunities.some((o) => o.id === 'competitive_position')).toBe(false);
  });
});

// ── Contradiction prevention ──────────────────────────────────────────────────

describe('Report 1 assembly — contradiction prevention', () => {
  it('an opportunity built only from unavailable evidence is rejected', () => {
    const fabricated = {
      id: 'x', title: 't', problem: 'p',
      evidence: [{ source: 'search' as const, statement: 's', state: 'unavailable' as const }],
      businessImplication: 'b', action: 'a', expectedImpact: 'e',
      impact: 90, confidence: 'high' as const, effort: 'low' as const,
      priorityScore: 0, measurement: 'm', measurementAvailable: true,
      sources: ['search' as const], crossSource: false, horizon: '0-30' as const,
    } satisfies CrossSourceOpportunity;
    expect(passesEvidenceGate(fabricated)).toBe(false);
  });

  it('identifies unmeasured dimensions and reports them as limitations, not weaknesses', () => {
    const result = assembleDigitalSnapshot(FULL);
    expect(result.unmeasuredDimensions).toContain('searchVisibility');
    expect(result.unmeasuredDimensions).toContain('performance');
    const note = result.plan.notes.join(' ');
    expect(note).toContain('could not be measured');
    expect(note).toContain('rather than assumed weak');
  });

  it('no opportunity asserts a measured deficiency for an unmeasured dimension', () => {
    const result = assembleDigitalSnapshot(FULL);
    for (const o of result.opportunities) {
      // Any evidence item tagged to an unmeasured dimension must itself be marked unavailable.
      for (const e of o.evidence) {
        if (e.source === 'search' && isUnmeasured(FULL.dimensionStates?.searchVisibility)) {
          expect(e.state).toBe('unavailable');
          expect(e.statement).toMatch(/could not be measured|not yet quantified/);
        }
      }
    }
  });

  it('isUnmeasured treats undefined as unmeasured — absence is never a measurement', () => {
    expect(isUnmeasured(undefined)).toBe(true);
    expect(isUnmeasured('unavailable')).toBe(true);
    expect(isUnmeasured('insufficient_signal')).toBe(true);
    expect(isUnmeasured('measured')).toBe(false);
    expect(isUnmeasured('inferred')).toBe(false);
  });
});

// ── 30/60/90 plan ─────────────────────────────────────────────────────────────

describe('Report 1 assembly — 30/60/90 plan', () => {
  it('places every opportunity into exactly one horizon', () => {
    const { opportunities, plan } = assembleDigitalSnapshot(FULL);
    const total = plan.days_0_30.length + plan.days_31_60.length + plan.days_61_90.length;
    expect(total).toBe(opportunities.length);
  });

  it('every plan item carries an action and a measurement', () => {
    const { plan } = assembleDigitalSnapshot(FULL);
    for (const item of [...plan.days_0_30, ...plan.days_31_60, ...plan.days_61_90]) {
      expect(item.action).toBeTruthy();
      expect(item.why).toBeTruthy();
      expect(item.measurement).toBeTruthy();
      expect(typeof item.measurementAvailable).toBe('boolean');
    }
  });

  it('flags a measurement that requires an unavailable source rather than implying it works', () => {
    const { opportunities } = assembleDigitalSnapshot(FULL);
    const competitive = opportunities.find((o) => o.id === 'competitive_position');
    expect(competitive?.measurementAvailable).toBe(false);
    expect(competitive?.measurement).toContain('BLOCKED');
  });

  it('makes NO unsupported quantitative promises', () => {
    const { opportunities, plan } = assembleDigitalSnapshot(FULL);
    const text = JSON.stringify({ opportunities, plan }).toLowerCase();
    // No invented lead/revenue/traffic/percentage-uplift claims.
    for (const pattern of [/\d+\s*(more )?leads/, /\d+%\s*(more|increase|uplift|growth)/, /\$\s*\d/, /\d+x\s/]) {
      expect(text).not.toMatch(pattern);
    }
  });

  it('leaves a horizon empty with a note rather than inventing filler', () => {
    const onlyLowEffort = assembleDigitalSnapshot({
      experienceFindings: [finding()],
      dimensionStates: { technical: 'measured' },
      technicalSignals: { score: 83, criticalIssues: [] },
    });
    expect(onlyLowEffort.plan.days_0_30.length).toBeGreaterThan(0);
    expect(onlyLowEffort.plan.days_61_90).toEqual([]);
    expect(onlyLowEffort.plan.notes.join(' ')).toContain('No long-horizon work was evidenced');
  });

  it('empty evidence produces an empty plan with explanatory notes, not generic activity', () => {
    const empty = assembleDigitalSnapshot({});
    expect(empty.empty).toBe(true);
    expect(empty.plan.days_0_30).toEqual([]);
    expect(empty.plan.notes.length).toBeGreaterThan(0);
    expect(empty.plan.notes.join(' ')).toContain('rather than filled with generic activity');
  });
});

// ── Report 1 / Report 2 evidence boundary ─────────────────────────────────────

describe('Report 1 assembly — evidence boundary', () => {
  it('every opportunity source maps to Report 1 eligible provenance', () => {
    const { opportunities } = assembleDigitalSnapshot(FULL);
    const SOURCE_TO_EVIDENCE: Record<string, Parameters<typeof provenanceForSource>[0]> = {
      crawl: 'crawler', content: 'crawler', technical: 'crawler',
      digital_experience: 'crawler', search: 'competitor_intelligence',
      ai_visibility: 'llm_probe', competitive: 'competitor_intelligence',
      performance: 'public_audit',
    };
    for (const o of opportunities) {
      for (const source of o.sources) {
        const mapped = SOURCE_TO_EVIDENCE[source];
        expect(mapped).toBeDefined();
        expect(isReport1Source(mapped)).toBe(true);
      }
    }
  });

  it('no opportunity is sourced from private/connected evidence', () => {
    const { opportunities } = assembleDigitalSnapshot(FULL);
    const text = JSON.stringify(opportunities).toLowerCase();
    // GSC and Omnivyra-owned history are CONNECTED_SOURCE / OMNIVYRA_OBSERVED — Report 2 only.
    expect(provenanceForSource('gsc')).toBe('CONNECTED_SOURCE');
    expect(text).not.toContain('search console');
    expect(text).not.toContain('ga4');
    expect(text).not.toContain('crm');
  });

  it('conversion opportunity states that visitor behaviour is NOT measurable here', () => {
    const { opportunities } = assembleDigitalSnapshot(FULL);
    const conversion = opportunities.find((o) => o.id === 'conversion_readiness');
    expect(conversion?.measurement).toContain('NOT measurable from public evidence');
    expect(conversion?.measurement).toContain('Report 2');
  });
});
