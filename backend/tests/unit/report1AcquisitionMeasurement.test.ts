/**
 * SLICE 3G — measurement + review gate.
 *
 * The sensitive properties here are negative: missing measurement must never read as failure,
 * and nothing except a completed pilot meeting a declared target may reach SCALE.
 */
import fs from 'fs';
import path from 'path';
import {
  attachMeasurementAndReview,
  buildMeasurementPlan,
  buildReviewGate,
  type DeclaredMeasurementInputs,
} from '../../services/snapshotReport/acquisitionMeasurement';
import { attachBudgetAndLearningFloor } from '../../services/snapshotReport/acquisitionBudget';
import { constructAcquisitionPilot } from '../../services/snapshotReport/acquisitionPilot';
import {
  assessAcquisitionNeed,
  decideAcquisitionPosture,
  attachAcquisitionDependencies,
} from '../../services/snapshotReport/acquisitionPosture';
import type {
  AcquisitionDecision,
  OrganicCondition,
  PaidActivityObservation,
  PaidReadiness,
} from '../../services/snapshotReport/acquisitionContract';

const MODULE = 'backend/services/snapshotReport/acquisitionMeasurement.ts';
const codeOnly = (): string => fs.readFileSync(path.join(process.cwd(), MODULE), 'utf8')
  .split('\n')
  .filter((l) => {
    const s = l.trim();
    return !s.startsWith('*') && !s.startsWith('//') && !s.startsWith('/*');
  })
  .join('\n');

const organic = (band: OrganicCondition['band']): OrganicCondition => ({
  band, evidence: { state: 'inferred', basis: 'b', notMeasurable: null, unlock: null },
  confidence: 'medium', supportingDimensions: [],
});
const paidActivity = (over: Partial<PaidActivityObservation> = {}): PaidActivityObservation => ({
  platform: null, presence: 'none_found', advertiserIdentity: 'UNRESOLVED',
  evidence: { state: 'measured', basis: 'b', notMeasurable: 'Spend…', unlock: null }, ...over,
});
const paidReadiness = (): PaidReadiness => ({
  conversionReadiness: 'ready', destination: 'https://acme.test/demo', offerClarity: 'clear',
  audienceDefinable: true, conversionEventObservable: true,
  evidence: { state: 'inferred', basis: 'b', notMeasurable: null, unlock: null },
});

const PILOT_CONTEXT = {
  declaredIcp: 'Operations leads at mid-sized logistics firms',
  declaredGeography: 'India',
  declaredPositioning: 'a structured way to shorten route planning',
  observedDestination: { url: 'https://acme.test/demo', kind: 'demo', isHomepage: false },
  observedConversionEvent: { label: 'a demo request', ctaOnly: false },
  channelEvidence: { channelClass: { name: 'Search advertising', basis: 'Observed buyer queries.' } },
};

function pilotDecision(over: Partial<PaidActivityObservation> = {}): AcquisitionDecision {
  const decided = decideAcquisitionPosture({
    organic: organic('operational'), paidActivity: paidActivity(over), paidReadiness: paidReadiness(),
    need: assessAcquisitionNeed({ declaredGrowthPriorities: 'Grow enquiries' }),
    overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
  });
  const wired = attachAcquisitionDependencies(decided, {
    overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
  });
  return attachBudgetAndLearningFloor(constructAcquisitionPilot(wired, PILOT_CONTEXT), {});
}

function drishiqDecision(): AcquisitionDecision {
  const decided = decideAcquisitionPosture({
    organic: organic('developing'), paidActivity: paidActivity(), paidReadiness: paidReadiness(),
    need: assessAcquisitionNeed({ declaredGrowthPriorities: 'Grow' }),
    overallExperienceReadiness: 'obstructed', conversionPillarReadiness: 'partial',
  });
  const wired = attachAcquisitionDependencies(decided, {
    overallExperienceReadiness: 'obstructed', conversionPillarReadiness: 'partial',
    obstructedPillars: [{ pillar: 'value_communication', label: 'Value communication' }],
  });
  return attachBudgetAndLearningFloor(constructAcquisitionPilot(wired, PILOT_CONTEXT), {});
}

const CONNECTED: DeclaredMeasurementInputs = {
  primaryConversionSourceConnected: true, primaryConversionSource: 'CRM enquiry record',
};
const JUDGEABLE: DeclaredMeasurementInputs = {
  ...CONNECTED, declaredSuccessThreshold: 'at least 8 qualified demo requests',
};

describe('Measurement plan', () => {
  it('CASE A: a valid pilot gets a measurement structure', () => {
    const out = attachMeasurementAndReview(pilotDecision(), {});
    expect(out.measurement).not.toBeNull();
    expect(out.reviewGate).not.toBeNull();
  });

  it('primary KPI is the actual 3E conversion event, unchanged', () => {
    const decision = pilotDecision();
    const out = attachMeasurementAndReview(decision, {});
    expect(out.measurement!.primaryKpi).toBe(decision.pilot!.conversionEvent);
    expect(out.measurement!.primaryKpi).toBe('a demo request');
  });

  it('never substitutes a vanity metric as the primary outcome', () => {
    const out = attachMeasurementAndReview(pilotDecision(), {
      availableSecondarySignals: ['clicks', 'impressions', 'CTR'],
    });
    const primary = out.measurement!.primaryKpi.toLowerCase();
    for (const vanity of ['click', 'impression', 'reach', 'ctr', 'pageview']) {
      expect(primary).not.toContain(vanity);
    }
    // They are admissible only as secondary signals, and only when supplied.
    expect(out.measurement!.secondaryKpis).toEqual(['clicks', 'impressions', 'CTR']);
  });

  it('has no secondary metrics unless a real source was supplied', () => {
    expect(attachMeasurementAndReview(pilotDecision(), {}).measurement!.secondaryKpis).toEqual([]);
  });

  it('fabricates no conversion result and no baseline', () => {
    const m = attachMeasurementAndReview(pilotDecision(), {}).measurement!;
    expect(m.baseline).toBeNull();
    expect(m).not.toHaveProperty('observedConversions');
    expect(m).not.toHaveProperty('result');
    expect(JSON.stringify(m)).not.toMatch(/"0"|:0[,}]/);
  });

  it('reports measurement unavailable rather than zero, with an unlock', () => {
    const m = attachMeasurementAndReview(pilotDecision(), {}).measurement!;
    expect(m.measurementAvailable).toBe(false);
    expect(m.source).toBeNull();
    expect(m.unlock).toContain('Connect a source that records this conversion event');
  });

  it('records a connected source when one genuinely exists', () => {
    const m = attachMeasurementAndReview(pilotDecision(), CONNECTED).measurement!;
    expect(m.measurementAvailable).toBe(true);
    expect(m.source).toBe('CRM enquiry record');
  });

  it('inherits the pilot review period and invents none', () => {
    const m = attachMeasurementAndReview(pilotDecision(), {}).measurement!;
    expect(m.reviewPeriodDays).toBeNull();
    const body = codeOnly();
    expect(body).not.toMatch(/\b(7|14|21|30|90)\b/);
  });

  it('assumes no private analytics source', () => {
    const body = codeOnly();
    for (const forbidden of [/\bga4?\b/i, /searchConsole/i, /\bgsc\b/i, /adsManager/i,
      /googleAds/i, /\broas\b/i, /\bcac\b/i, /\bltv\b/i]) {
      expect(body).not.toMatch(forbidden);
    }
  });
});

describe('Success threshold', () => {
  it('is null when none is declared, and says so in the unlock', () => {
    const m = attachMeasurementAndReview(pilotDecision(), CONNECTED).measurement!;
    expect(m.successThreshold).toBeNull();
    expect(m.unlock).toContain('will not assume one on your behalf');
  });

  it('preserves a declared threshold verbatim', () => {
    const m = attachMeasurementAndReview(pilotDecision(), JUDGEABLE).measurement!;
    expect(m.successThreshold).toBe('at least 8 qualified demo requests');
  });

  it('invents no numeric rate, ROAS, CAC or confidence level', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/\d+\s*%/);
    expect(body).not.toMatch(/0\.0[0-9]|p\s*<|significance|statistically/i);
  });

  it('keeps a declared target distinct from an observed result', () => {
    const m = attachMeasurementAndReview(pilotDecision(), JUDGEABLE).measurement!;
    // The contract carries the declared target only; no observed-result field exists.
    expect(m.successThreshold).toBe('at least 8 qualified demo requests');
    expect(Object.keys(m)).not.toContain('observedResult');
    expect(Object.keys(m)).not.toContain('actual');
  });
});

describe('Review gate', () => {
  const unjudgeable = buildReviewGate(buildMeasurementPlan(pilotDecision().pilot!, {}));
  const judgeable = buildReviewGate(buildMeasurementPlan(pilotDecision().pilot!, JUDGEABLE));

  it('defines all four states', () => {
    expect(Object.keys(judgeable).sort()).toEqual(['modify', 'proceed', 'scale', 'stop']);
  });

  it('STOP requires an observed result, never missing data', () => {
    expect(unjudgeable.stop.join(' ')).toContain('No stop condition can be pre-committed yet');
    expect(unjudgeable.stop.join(' ')).toContain('must not be recorded as a failed one');
    expect(judgeable.stop.join(' ')).toContain('was measured and fell short');
    expect(judgeable.stop.join(' ')).toContain('not a failed test');
  });

  it('SCALE is unavailable without both a readable result and a declared target', () => {
    expect(unjudgeable.scale.join(' ')).toContain('Scale cannot be considered yet');
    expect(unjudgeable.scale.join(' ')).toContain('No business success threshold has been declared');
    expect(unjudgeable.scale.join(' ')).toContain('cannot currently be observed');
  });

  it('SCALE requires a completed pilot meeting the declared target', () => {
    const s = judgeable.scale.join(' ');
    expect(s).toContain('ran to completion');
    expect(s).toContain('met the declared target');
    expect(s).toContain('conversion path still holds');
  });

  it('SCALE explicitly refuses budget, advertiser match, ads, traffic, clicks, impressions', () => {
    const s = judgeable.scale.join(' ');
    for (const substitute of ['larger budget', 'matched advertiser', 'observed ads', 'traffic', 'clicks', 'impressions']) {
      expect(s).toContain(substitute);
    }
    expect(s).toContain('do not substitute');
  });

  it('CONTINUE (proceed) stays distinct from SCALE', () => {
    expect(judgeable.proceed.join(' ')).toContain('not yet strong enough to justify increasing exposure');
    expect(judgeable.proceed.join(' ')).toContain('Continuing is not scaling');
  });

  it('MODIFY stays distinct from STOP', () => {
    const m = judgeable.modify.join(' ');
    expect(m).toContain('Change exactly one controlled variable');
    expect(m).not.toContain('fell short of the declared target (at least 8 qualified demo requests) by a margin');
  });

  it('emits no review outcome — the gate is pre-committed conditions only', () => {
    for (const list of [judgeable.stop, judgeable.modify, judgeable.proceed, judgeable.scale]) {
      expect(Array.isArray(list)).toBe(true);
      expect(list.every((entry) => typeof entry === 'string')).toBe(true);
    }
    const out = attachMeasurementAndReview(pilotDecision(), JUDGEABLE);
    expect(out).not.toHaveProperty('reviewOutcome');
    expect(out.posture).not.toBe('PAID_SCALE_CANDIDATE');
  });
});

describe('Nothing but a reviewed pilot can reach SCALE', () => {
  it('a declared budget does not change the posture', () => {
    const withBudget = attachBudgetAndLearningFloor(pilotDecision(), {
      declaredAmount: 500000, declaredCurrency: 'INR',
      declaredAcceptableCostPerConversion: 1000, declaredAcceptableCostCurrency: 'INR',
    });
    const out = attachMeasurementAndReview(withBudget, JUDGEABLE);
    expect(out.posture).not.toBe('PAID_SCALE_CANDIDATE');
    expect(out.posture).toBe('ORGANIC_PLUS_CONTROLLED_PAID_PILOT');
  });

  it('a matched advertiser with observed ads does not change the posture', () => {
    const out = attachMeasurementAndReview(
      pilotDecision({ presence: 'observed', advertiserIdentity: 'MATCHED' }), JUDGEABLE,
    );
    expect(out.posture).not.toBe('PAID_SCALE_CANDIDATE');
  });

  it('3G never writes a posture at all', () => {
    expect(codeOnly()).not.toContain('PAID_SCALE_CANDIDATE');
    expect(codeOnly()).not.toMatch(/posture\s*[:=]/);
  });
});

describe('Learning floor distinction is preserved', () => {
  it('does not relabel expected conversion events as an interpretability minimum', () => {
    const body = codeOnly();
    expect(body).not.toContain('expectedConversionEvents');
    expect(body).not.toContain('learningFloor');
    expect(body).not.toMatch(/minimum.*interpretab|interpretab.*minimum/i);
  });

  it('leaves the 3F learning floor untouched', () => {
    const before = attachBudgetAndLearningFloor(pilotDecision(), {
      declaredAmount: 40000, declaredCurrency: 'INR',
      declaredAcceptableCostPerConversion: 2000, declaredAcceptableCostCurrency: 'INR',
    });
    const after = attachMeasurementAndReview(before, JUDGEABLE);
    expect(after.learningFloor).toEqual(before.learningFloor);
    expect(after.budget).toEqual(before.budget);
  });
});

describe('DRISHIQ regression', () => {
  const before = drishiqDecision();
  const after = attachMeasurementAndReview(before, JUDGEABLE);

  it('stays blocked with its dependency and no pilot', () => {
    expect(after.posture).toBe('PAID_BLOCKED_BY_PREREQUISITE');
    expect(after.dependencies).toEqual(before.dependencies);
    expect(after.dependencies[0].id).toBe('value_communication');
    expect(after.pilot).toBeNull();
  });

  it('manufactures no measurement plan and no review gate', () => {
    expect(after.measurement).toBeNull();
    expect(after.reviewGate).toBeNull();
  });
});

describe('3G changes measurement and review gate only', () => {
  it.each([
    ['with pilot', pilotDecision()],
    ['blocked', drishiqDecision()],
  ])('%s: every other field is identical', (_name, before) => {
    const after = attachMeasurementAndReview(before, JUDGEABLE);
    expect(after.posture).toBe(before.posture);
    expect(after.need).toEqual(before.need);
    expect(after.organic).toEqual(before.organic);
    expect(after.paidActivity).toEqual(before.paidActivity);
    expect(after.paidReadiness).toEqual(before.paidReadiness);
    expect(after.dependencies).toEqual(before.dependencies);
    expect(after.pilot).toEqual(before.pilot);
    expect(after.budget).toEqual(before.budget);
    expect(after.learningFloor).toEqual(before.learningFloor);
    expect({
      ...after, measurement: before.measurement, reviewGate: before.reviewGate,
    }).toEqual(before);
  });

  it('does not mutate the decision it was given', () => {
    const before = pilotDecision();
    const snapshot = JSON.parse(JSON.stringify(before));
    attachMeasurementAndReview(before, JUDGEABLE);
    expect(before).toEqual(snapshot);
  });
});

describe('3G boundary', () => {
  it('executes no campaign action and writes nothing', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/fetch|axios|campaign|targeting|googleads|meta|linkedin/i);
    expect(body).not.toMatch(/supabase|saveProfile|insert\(|upsert\(|update\(/);
    expect(body).not.toMatch(/company_profiles|migration/);
  });

  it('infers no performance from public advertising evidence', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/decision\.(paidActivity|organic|need)/);
  });
});
