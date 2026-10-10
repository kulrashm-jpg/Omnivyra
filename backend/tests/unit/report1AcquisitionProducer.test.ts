/**
 * ACQUISITION DECISION PRODUCER.
 *
 * The producer is an orchestrator, so these tests check two different things and keep them
 * apart: that it composes the frozen 3A-3G functions faithfully, and that it contains none of
 * their rules itself. The second is asserted against the module source, because a rule that
 * creeps back in would otherwise be invisible as long as the output still looked right.
 *
 * Everything the product cannot currently supply — a destination, a labelled conversion event,
 * channel evidence, a declared budget, a connected measurement source, a runtime outcome — is
 * locked here as an ABSENCE. These are the assertions that would fail first if a later change
 * decided to fill a gap with a default.
 */
import fs from 'fs';
import path from 'path';
import {
  buildAcquisitionDecision,
  type AcquisitionProducerInput,
} from '../../services/snapshotReport/acquisitionDecision';
import type { DigitalExperienceResult, ExperienceReadiness } from '../../services/digitalExperience';
import type { SnapshotAdvertising } from '../../services/snapshotReportTypes';
import type { ScoreState } from '../../services/snapshotReport/canonicalScoreState';

const MODULE = 'backend/services/snapshotReport/acquisitionDecision.ts';
const COMPOSER = 'backend/services/snapshotReportService.ts';

const read = (relative: string): string =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

/** Source with comment lines removed, so prose about a rule is not mistaken for the rule. */
const codeOnly = (): string => read(MODULE)
  .split('\n')
  .filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
  })
  .join('\n');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dimension = (key: string, value: number | null, state: ScoreState) => ({ key, value, state });

/** Dimension values high enough that the weakest measured one does not band as foundational. */
const HEALTHY_DIMENSIONS = [
  dimension('content_quality', 72, 'measured'),
  dimension('coverage', 68, 'measured'),
  dimension('reach', 65, 'measured'),
  dimension('authority', 61, 'measured'),
  dimension('aeo', 58, 'measured'),
  dimension('platforms', 55, 'measured'),
  // Deliberately present and deliberately ignored by 3B.
  dimension('conversion', 12, 'measured'),
];

const pillar = (name: string, label: string, readiness: ExperienceReadiness) => ({
  pillar: name, label, readiness, findings: [], evaluated: 3,
});

const experience = (
  overall: ExperienceReadiness,
  conversion: ExperienceReadiness,
  valueCommunication: ExperienceReadiness = 'ready',
): DigitalExperienceResult => ({
  readiness: overall,
  pillars: [
    pillar('information_accessibility', 'Information accessibility', 'ready'),
    pillar('value_communication', 'Value communication', valueCommunication),
    pillar('conversion_readiness', 'Conversion readiness', conversion),
    pillar('technical_friction', 'Technical friction', 'ready'),
  ],
} as unknown as DigitalExperienceResult);

const advertising = (overrides: Partial<SnapshotAdvertising> = {}): SnapshotAdvertising => ({
  platform: 'google_ads',
  accessState: 'observed',
  reason: null,
  source: 'ads_transparency',
  provenance: 'PUBLIC_OBSERVED',
  vantage: null,
  observedAt: '2026-10-01T00:00:00.000Z',
  subjectLegalNameUsed: 'Acme Technologies Private Limited',
  companyAdvertisers: [],
  otherAdvertisers: [],
  counts: { domainAdCountLabel: null, advertiserAccountsDiscovered: 0, matchedAdvertiserAccounts: 0 },
  ...overrides,
} as unknown as SnapshotAdvertising);

const DECLARED_PROFILE = {
  ideal_customer_profile: 'Operations leads at mid-sized logistics firms',
  target_customer_segment: 'Mid-market logistics',
  geography: 'India',
  brand_positioning: 'a structured way to shorten route planning',
  growth_priorities: 'Grow qualified enquiries from new regions',
  goals: 'Open two new regional markets',
};

/** A tenant whose evidence supports a decision: healthy organic, a usable conversion path. */
const completeInput = (): AcquisitionProducerInput => ({
  scoreDimensions: HEALTHY_DIMENSIONS,
  searchVisibilityState: 'measured',
  geoVisibilityState: 'measured',
  advertising: advertising(),
  digitalExperience: experience('ready', 'ready'),
  declaredProfile: DECLARED_PROFILE,
});

/** Drishiq-like: the conversion path is obstructed, so paid is blocked by a prerequisite. */
const drishiqLikeInput = (): AcquisitionProducerInput => ({
  scoreDimensions: [
    dimension('content_quality', 54, 'measured'),
    dimension('coverage', 41, 'measured'),
    dimension('reach', 32, 'measured'),
    dimension('authority', null, 'insufficient_signal'),
    dimension('aeo', 29, 'measured'),
    dimension('platforms', null, 'unavailable'),
  ],
  searchVisibilityState: 'insufficient_signal',
  geoVisibilityState: 'insufficient_signal',
  advertising: advertising({ companyAdvertisers: [], subjectLegalNameUsed: null }),
  digitalExperience: experience('obstructed', 'obstructed', 'obstructed'),
  declaredProfile: DECLARED_PROFILE,
});

// ── Test 1 — complete synthetic input ─────────────────────────────────────────

describe('producer — complete synthetic input', () => {
  it('produces a structured decision with a posture', () => {
    const decision = buildAcquisitionDecision(completeInput());
    expect(decision.posture).toBe('ORGANIC_PLUS_CONTROLLED_PAID_PILOT');
    expect(decision.applicability).toBe('relevant');
    expect(decision.rationale.length).toBeGreaterThan(0);
    expect(decision.organic).not.toBeNull();
    expect(decision.paidActivity).not.toBeNull();
    expect(decision.paidReadiness).not.toBeNull();
    expect(decision.need).not.toBeNull();
  });

  it('carries the 3B organic band and confidence through unchanged', () => {
    const decision = buildAcquisitionDecision(completeInput());
    // Weakest MEASURED organic dimension is platforms = 55 → operational. `conversion` = 12 is
    // present in the input and must not drag the band: 3B excludes it by design.
    expect(decision.organic?.band).toBe('operational');
    expect(decision.organic?.confidence).toBe('high');
  });

  it('fabricates no fields beyond the contract', () => {
    const decision = buildAcquisitionDecision(completeInput());
    expect(Object.keys(decision).sort()).toEqual([
      'applicability', 'budget', 'confidence', 'dependencies', 'evidence', 'horizon',
      'learningFloor', 'measurement', 'need', 'organic', 'paidActivity', 'paidReadiness',
      'pilot', 'posture', 'priority', 'rationale', 'reviewGate',
    ]);
  });

  it('reads the advertising partition the surface already performed', () => {
    const matched = advertising({
      companyAdvertisers: [{ advertiserId: 'a1' }] as unknown as SnapshotAdvertising['companyAdvertisers'],
    });
    const decision = buildAcquisitionDecision({ ...completeInput(), advertising: matched });
    expect(decision.paidActivity?.presence).toBe('observed');
    expect(decision.paidActivity?.advertiserIdentity).toBe('MATCHED');
    expect(decision.paidActivity?.platform).toBe('google_ads');
  });
});

// ── Test 2 — Drishiq-like case ────────────────────────────────────────────────

describe('producer — Drishiq-like obstructed conversion path', () => {
  const decision = buildAcquisitionDecision(drishiqLikeInput());

  it('blocks paid on a prerequisite rather than declaring paid unsuitable', () => {
    expect(decision.posture).toBe('PAID_BLOCKED_BY_PREREQUISITE');
    expect(decision.applicability).toBe('conditional');
    expect(decision.horizon).toBe('immediate');
    expect(decision.priority).toBe('high');
  });

  it('names conversion readiness as the blocking dependency', () => {
    expect(decision.dependencies).toHaveLength(1);
    expect(decision.dependencies[0].id).toBe('conversion_readiness');
    expect(decision.dependencies[0].kind).toBe('blocking');
  });

  it('carries no pilot, budget, learning floor, measurement or review gate', () => {
    expect(decision.pilot).toBeNull();
    expect(decision.budget).toBeNull();
    expect(decision.learningFloor).toBeNull();
    expect(decision.measurement).toBeNull();
    expect(decision.reviewGate).toBeNull();
  });

  it('still reports the organic and paid conditions it could establish', () => {
    expect(decision.organic?.supportingDimensions).toHaveLength(6);
    expect(decision.paidActivity?.advertiserIdentity).toBe('UNRESOLVED');
  });
});

// ── Test 3 — missing acquisition inputs ───────────────────────────────────────

describe('producer — missing inputs abstain', () => {
  const decision = buildAcquisitionDecision({});

  it('reports insufficient evidence rather than a default posture', () => {
    expect(decision.posture).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.applicability).toBe('undetermined');
    expect(decision.confidence).toBe('low');
    expect(decision.evidence.state).toBe('insufficient_signal');
  });

  it('invents no organic value and no paid observation', () => {
    expect(decision.organic?.band).toBe('insufficient');
    expect(decision.organic?.supportingDimensions).toEqual([]);
    expect(decision.paidActivity?.presence).toBe('not_observable');
    expect(decision.paidActivity?.platform).toBeNull();
  });

  it('leaves need undetermined when no declaration exists', () => {
    expect(decision.need?.state).toBe('undetermined');
    expect(decision.need?.evidence.unlock).not.toBeNull();
  });

  it('emits no horizon, priority or dependencies it cannot support', () => {
    expect(decision.horizon).toBeNull();
    expect(decision.priority).toBeNull();
    expect(decision.dependencies).toEqual([]);
  });
});

// ── Test 4 — no channel evidence ──────────────────────────────────────────────

describe('producer — no channel evidence', () => {
  it('abstains from a pilot rather than naming a channel', () => {
    const decision = buildAcquisitionDecision(completeInput());
    expect(decision.posture).toBe('ORGANIC_PLUS_CONTROLLED_PAID_PILOT');
    expect(decision.pilot).toBeNull();
  });

  it('names no platform anywhere in the producer source', () => {
    const code = codeOnly().toLowerCase();
    for (const platform of ['google ads', 'googleads', 'facebook', 'meta ads', 'linkedin ads']) {
      expect(code).not.toContain(platform);
    }
  });

  it('passes channel evidence as absent', () => {
    expect(codeOnly()).toContain('channelEvidence: null');
  });
});

// ── Test 5 — no labelled conversion event ─────────────────────────────────────

describe('producer — no labelled conversion event', () => {
  it('passes the conversion event and destination as absent', () => {
    const code = codeOnly();
    expect(code).toContain('observedConversionEvent: null');
    expect(code).toContain('observedDestination: null');
    expect(code).toContain('destination: null');
  });

  it('leaves the pilot null even where every other condition is met', () => {
    const decision = buildAcquisitionDecision(completeInput());
    expect(decision.pilot).toBeNull();
  });

  it('reports the missing conversion path on paid readiness rather than asserting one', () => {
    const decision = buildAcquisitionDecision(completeInput());
    expect(decision.paidReadiness?.destination).toBeNull();
    expect(decision.paidReadiness?.evidence.notMeasurable).toContain('destination page');
  });
});

// ── Test 6 — no budget declarations ───────────────────────────────────────────

describe('producer — no budget declaration', () => {
  it('supplies no amount, currency or acceptable cost', () => {
    const code = codeOnly();
    expect(code).toContain('declaredAmount: null');
    expect(code).toContain('declaredCurrency: null');
    expect(code).toContain('declaredAcceptableCostPerConversion: null');
    expect(code).toContain('declaredAcceptableCostCurrency: null');
  });

  it('never reads a deal-size or spend field from the profile', () => {
    const code = codeOnly();
    for (const field of ['avg_deal_size', 'marketing_budget', 'spend_tolerance', 'acceptable_cpa']) {
      expect(code).not.toContain(field);
    }
  });

  it('leaves budget and learning floor null with no pilot to fund', () => {
    const decision = buildAcquisitionDecision(completeInput());
    expect(decision.budget).toBeNull();
    expect(decision.learningFloor).toBeNull();
  });
});

// ── Test 7 — no measurement source ────────────────────────────────────────────

describe('producer — no measurement source', () => {
  it('declares the primary conversion source unconnected', () => {
    const code = codeOnly();
    expect(code).toContain('primaryConversionSourceConnected: false');
    expect(code).toContain('primaryConversionSource: null');
    expect(code).toContain('availableSecondarySignals: []');
  });

  it('declares no success threshold on the tenant behalf', () => {
    expect(codeOnly()).toContain('declaredSuccessThreshold: null');
  });
});

// ── Test 8 — no runtime outcome ───────────────────────────────────────────────

describe('producer — no runtime outcome', () => {
  it('supplies no reviewed-pilot evidence, so scale is unreachable', () => {
    expect(codeOnly()).not.toContain('reviewedPilot');
    expect(buildAcquisitionDecision(completeInput()).posture).not.toBe('PAID_SCALE_CANDIDATE');
    expect(buildAcquisitionDecision(drishiqLikeInput()).posture).not.toBe('PAID_SCALE_CANDIDATE');
  });

  it('produces no review verdict of any kind', () => {
    const code = codeOnly();
    for (const verdict of ['STOP', 'MODIFY', 'CONTINUE', 'SCALE', 'metSuccessThreshold']) {
      expect(code).not.toContain(verdict);
    }
    expect(buildAcquisitionDecision(completeInput()).reviewGate).toBeNull();
  });
});

// ── Test 9 — evidence preservation ────────────────────────────────────────────

describe('producer — evidence states survive', () => {
  it('carries each dimension value and state through unchanged', () => {
    const input: AcquisitionProducerInput = {
      scoreDimensions: [
        dimension('content_quality', 71, 'measured'),
        dimension('coverage', 44, 'inferred'),
        dimension('reach', null, 'insufficient_signal'),
        dimension('authority', null, 'unavailable'),
      ],
      digitalExperience: experience('partial', 'partial'),
      declaredProfile: DECLARED_PROFILE,
    };
    const supporting = buildAcquisitionDecision(input).organic?.supportingDimensions ?? [];
    expect(supporting).toEqual([
      { key: 'content_quality', value: 71, state: 'measured' },
      { key: 'coverage', value: 44, state: 'inferred' },
      { key: 'reach', value: null, state: 'insufficient_signal' },
      { key: 'authority', value: null, state: 'unavailable' },
    ]);
  });

  it('never turns an unmeasured dimension into a zero', () => {
    const decision = buildAcquisitionDecision({
      scoreDimensions: [
        dimension('content_quality', 71, 'measured'),
        dimension('reach', null, 'unavailable'),
      ],
      digitalExperience: experience('ready', 'ready'),
    });
    const reach = decision.organic?.supportingDimensions.find((d) => d.key === 'reach');
    expect(reach?.value).toBeNull();
    expect(decision.organic?.band).toBe('operational');
  });

  it('passes a non-ScoreState search outcome as absent rather than re-coding it', () => {
    const withFailed = buildAcquisitionDecision({ ...completeInput(), searchVisibilityState: 'failed' });
    const withNone = buildAcquisitionDecision({ ...completeInput(), searchVisibilityState: null });
    expect(withFailed.organic?.evidence).toEqual(withNone.organic?.evidence);
  });

  it('keeps a declared need declared rather than promoting it to an observed shortfall', () => {
    const decision = buildAcquisitionDecision(completeInput());
    expect(decision.need?.state).toBe('observed');
    expect(decision.need?.evidence.state).toBe('inferred');
    expect(decision.need?.evidence.notMeasurable).toContain('revenue pressure');
  });
});

// ── Test 10 — purity ──────────────────────────────────────────────────────────

describe('producer — purity', () => {
  it('leaves every input deep-equal after execution', () => {
    const input = completeInput();
    const before = JSON.stringify(input);
    buildAcquisitionDecision(input);
    expect(JSON.stringify(input)).toEqual(before);
  });

  it('runs against deeply frozen inputs', () => {
    const freeze = (value: unknown): unknown => {
      if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(freeze);
        Object.freeze(value);
      }
      return value;
    };
    const input = freeze(completeInput()) as AcquisitionProducerInput;
    expect(() => buildAcquisitionDecision(input)).not.toThrow();
  });

  it('is deterministic for the same input', () => {
    expect(JSON.stringify(buildAcquisitionDecision(completeInput())))
      .toEqual(JSON.stringify(buildAcquisitionDecision(completeInput())));
  });
});

// ── Test 11 — no persistence or provider access ───────────────────────────────

describe('producer — no side effects', () => {
  it('imports no client, provider or transport', () => {
    const source = read(MODULE);
    for (const forbidden of ['supabase', 'fetch(', 'axios', 'node-fetch', 'puppeteer', 'openai']) {
      expect(source.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('performs no write, no await and no randomness', () => {
    const code = codeOnly();
    for (const forbidden of ['await ', 'async ', '.insert(', '.update(', '.upsert(', '.delete(', 'Math.random', 'Date.now']) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('imports only the frozen acquisition slices and their types', () => {
    const imports = [...read(MODULE).matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      '../digitalExperience',
      '../snapshotReportTypes',
      './acquisitionAssessors',
      './acquisitionBudget',
      './acquisitionContract',
      './acquisitionMeasurement',
      './acquisitionPilot',
      './acquisitionPosture',
      './canonicalScoreState',
    ]);
  });
});

// ── The no-rules-in-producer test ─────────────────────────────────────────────

describe('producer — holds no acquisition rule of its own', () => {
  const code = codeOnly();

  it('contains no posture literal', () => {
    for (const posture of [
      'ORGANIC_LED', 'ORGANIC_PLUS_CONTROLLED_PAID_PILOT', 'PAID_SUPPORTED_URGENCY',
      'PAID_SCALE_CANDIDATE', 'PAID_BLOCKED_BY_PREREQUISITE', 'PAID_NOT_CURRENTLY_RECOMMENDED',
      'INSUFFICIENT_EVIDENCE',
    ]) {
      expect(code).not.toContain(posture);
    }
  });

  it('contains no band, applicability or gate vocabulary', () => {
    // Quoted literals, because the only legitimate near-match is the `insufficient_signal`
    // member of the ScoreState guard set — an evidence state, not an organic band.
    for (const token of [
      'leading', 'operational', 'developing', 'foundational', 'insufficient',
      'BLOCKING', 'CONSTRAINED', 'ADEQUATE', 'NO_POSTURE',
      'not_recommended', 'conditional', 'relevant', 'undetermined', 'low_risk_test',
    ]) {
      expect(code).not.toContain(`'${token}'`);
    }
    expect(code).toContain(`'insufficient_signal'`);
  });

  it('contains no numeric threshold or arithmetic', () => {
    expect(code).not.toMatch(/[<>]=?\s*\d/);
    expect(code).not.toMatch(/\d+\s*[*/+-]\s*\d+/);
    expect(code).not.toContain('Math.');
  });

  it('decides nothing: every call is to a frozen slice', () => {
    for (const fn of [
      'assessOrganicCondition(', 'assessPaidActivity(', 'assessPaidReadiness(',
      'assessAcquisitionNeed(', 'decideAcquisitionPosture(', 'attachAcquisitionDependencies(',
      'constructAcquisitionPilot(', 'attachBudgetAndLearningFloor(', 'attachMeasurementAndReview(',
    ]) {
      expect(code).toContain(fn);
    }
  });

  it('reuses the exported audience helper instead of re-deriving precedence', () => {
    expect(code).toContain('deriveDeclaredAudience(');
  });
});

// ── Test 12 — canonical integration at the composer seam ──────────────────────

describe('composer seam', () => {
  const composer = read(COMPOSER);

  it('assigns acquisition_decision from the producer', () => {
    expect(composer).toContain('canonicalSnapshotShape.acquisition_decision = buildAcquisitionDecision({');
  });

  it('runs after the digital snapshot assembler and before the return', () => {
    const assembler = composer.indexOf('canonicalSnapshotShape.digital_snapshot = assembleDigitalSnapshot(');
    const producer = composer.indexOf('canonicalSnapshotShape.acquisition_decision = buildAcquisitionDecision(');
    const returned = composer.indexOf('\n  return canonicalSnapshotShape;');
    expect(assembler).toBeGreaterThan(-1);
    expect(producer).toBeGreaterThan(assembler);
    expect(returned).toBeGreaterThan(producer);
  });

  it('feeds it only already-produced canonical state', () => {
    const block = composer.slice(
      composer.indexOf('canonicalSnapshotShape.acquisition_decision = buildAcquisitionDecision({'),
      composer.indexOf('\n  return canonicalSnapshotShape;'),
    );
    expect(block).toContain('scoreDimensions: score.dimensions');
    expect(block).toContain('canonicalSnapshotShape.search_visibility?.state');
    expect(block).toContain('geoAeoExecutiveSummary.overall_ai_visibility_score_state');
    expect(block).toContain('canonicalSnapshotShape.advertising');
    expect(block).toContain('digitalExperience');
    expect(block).toContain('params.resolvedInput?.profile');
    // No second source of truth, and nothing recomputed at the seam.
    expect(block).not.toContain('await');
    expect(block).not.toContain('buildReportScoreModel');
    expect(block).not.toContain('assessDigitalExperience');
  });
});

// ── The REAL Drishiq shape, as production actually produced it ───────────────
//
// Report 2bb30e17-4254-463e-a8da-9add678cede1 (2026-10-05) is the evidence artifact from the
// one authorized real-tenant run. It differs from the fixture above in a way that matters:
// the conversion pillar is PARTIAL and overall readiness is obstructed via
// value_communication, so the blocking dependency is value_communication rather than
// conversion_readiness. That path existed in 3D's own tests but had never been exercised
// through the producer, which is why the prose leak reached a customer before a test saw it.

const drishiqProductionInput = (): AcquisitionProducerInput => ({
  scoreDimensions: [
    dimension('content_quality', 54, 'measured'),
    dimension('coverage', 41, 'measured'),
    dimension('reach', 32, 'measured'),
    dimension('authority', null, 'insufficient_signal'),
    dimension('aeo', 29, 'measured'),
    dimension('platforms', null, 'unavailable'),
  ],
  searchVisibilityState: 'insufficient_signal',
  geoVisibilityState: 'insufficient_signal',
  advertising: advertising({ companyAdvertisers: [], subjectLegalNameUsed: null }),
  digitalExperience: experience('obstructed', 'partial', 'obstructed'),
  declaredProfile: DECLARED_PROFILE,
});

describe('producer — real Drishiq production shape', () => {
  const decision = buildAcquisitionDecision(drishiqProductionInput());

  it('reproduces the persisted posture, applicability, horizon and priority', () => {
    expect(decision.posture).toBe('PAID_BLOCKED_BY_PREREQUISITE');
    expect(decision.applicability).toBe('conditional');
    expect(decision.horizon).toBe('immediate');
    expect(decision.priority).toBe('high');
  });

  it('reproduces the persisted organic, paid and need states', () => {
    expect(decision.organic?.band).toBe('developing');
    expect(decision.paidActivity?.presence).toBe('none_found');
    expect(decision.paidActivity?.advertiserIdentity).toBe('UNRESOLVED');
    expect(decision.need?.state).toBe('observed');
    expect(decision.need?.evidence.state).toBe('inferred');
  });

  it('names value_communication as the single blocking dependency', () => {
    expect(decision.dependencies).toHaveLength(1);
    expect(decision.dependencies[0].id).toBe('value_communication');
    expect(decision.dependencies[0].kind).toBe('blocking');
  });

  it('keeps every downstream abstention intact', () => {
    expect(decision.pilot).toBeNull();
    expect(decision.budget).toBeNull();
    expect(decision.learningFloor).toBeNull();
    expect(decision.measurement).toBeNull();
    expect(decision.reviewGate).toBeNull();
  });

  it('exposes no internal token in the persisted evidence prose', () => {
    const basis = decision.evidence.basis;
    expect(basis).not.toContain('demand need observed');
    expect(basis).not.toContain('BLOCKING');
    expect(basis).not.toContain('none_found');
    expect(basis).not.toContain('UNRESOLVED');
    expect(basis).not.toContain('insufficient');
  });

  it('states the same facts in truthful words', () => {
    const basis = decision.evidence.basis;
    expect(basis).toContain('Organic condition is developing');
    expect(basis).toContain('critical obstruction');
    expect(basis).toContain('No public advertising was found through the available search');
    expect(basis).toContain('advertiser ownership could not be established');
    expect(basis).toContain('A near-term demand need was declared');
  });

  it('never describes the declared need as an observed shortfall', () => {
    const blob = JSON.stringify(decision);
    expect(blob).toContain('declaration of intent, not an observed shortfall');
    expect(blob).not.toContain('demand need observed');
  });
});
