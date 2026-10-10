/**
 * SLICE 3F — budget + learning floor.
 *
 * The product currently supplies no declared budget input anywhere, so every real tenant
 * resolves to `unavailable`. These tests lock that this stays an honest absence with an
 * unlock rather than becoming a fabricated number, and that the derivation paths are
 * reachable only from explicitly declared figures.
 */
import fs from 'fs';
import path from 'path';
import {
  attachBudgetAndLearningFloor,
  deriveAcquisitionBudget,
  deriveLearningFloor,
  type DeclaredBudgetInputs,
} from '../../services/snapshotReport/acquisitionBudget';
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

const MODULE = 'backend/services/snapshotReport/acquisitionBudget.ts';
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
const paidActivity = (): PaidActivityObservation => ({
  platform: null, presence: 'none_found', advertiserIdentity: 'UNRESOLVED',
  evidence: { state: 'measured', basis: 'b', notMeasurable: 'Spend…', unlock: null },
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

/** A decision with a constructed pilot (positive fixture). */
function decisionWithPilot(): AcquisitionDecision {
  const decided = decideAcquisitionPosture({
    organic: organic('operational'), paidActivity: paidActivity(), paidReadiness: paidReadiness(),
    need: assessAcquisitionNeed({ declaredGrowthPriorities: 'Grow enquiries' }),
    overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
  });
  const wired = attachAcquisitionDependencies(decided, {
    overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
  });
  return constructAcquisitionPilot(wired, PILOT_CONTEXT);
}

/** The real Drishiq shape: obstructed overall, partial pillar, blocked, pilot null. */
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
  return constructAcquisitionPilot(wired, PILOT_CONTEXT);
}

const DECLARED: DeclaredBudgetInputs = {
  declaredAmount: 40000, declaredCurrency: 'INR',
  declaredAcceptableCostPerConversion: 2000, declaredAcceptableCostCurrency: 'INR',
};

describe('Budget is unavailable by default', () => {
  it('CASE A: a valid pilot with no budget inputs keeps the pilot and reports unavailable', () => {
    const out = attachBudgetAndLearningFloor(decisionWithPilot(), {});
    expect(out.pilot).not.toBeNull();
    expect(out.budget!.state).toBe('unavailable');
    expect(out.learningFloor!.state).toBe('unavailable');
  });

  it('carries no amount, min, max or currency when unavailable', () => {
    const budget = deriveAcquisitionBudget({}, { state: 'unavailable', unlock: 'u' });
    expect(budget).not.toHaveProperty('amount');
    expect(budget).not.toHaveProperty('min');
    expect(budget).not.toHaveProperty('max');
    expect(budget).not.toHaveProperty('currency');
  });

  it('explains what would unlock a defensible budget', () => {
    const out = attachBudgetAndLearningFloor(decisionWithPilot(), {});
    expect(out.budget!.state).toBe('unavailable');
    expect((out.budget as { unlock: string }).unlock).toContain('Declare what you could spend');
    expect((out.learningFloor as { unlock: string }).unlock).toBeTruthy();
  });

  it('invents no currency symbol or monetary default anywhere in the source', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/[₹€£]\s*\d|\$\s*\d/);
    expect(body).not.toMatch(/\b(10000|25000|500|100)\b/);
    expect(body).not.toMatch(/\bINR\b|\bUSD\b|\bEUR\b|\bGBP\b/);
  });

  it('assumes no CPC, CPM or CPA constant', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/\bcpc\b|\bcpm\b|\bcpa\b/i);
    expect(body).not.toMatch(/=\s*\d+(\.\d+)?\s*;\s*$/m);
  });
});

describe('Budget is never inferred from the wrong evidence', () => {
  it('reads no company size, revenue, industry, pricing or competitor signal', () => {
    const body = codeOnly();
    for (const forbidden of [/companySize/i, /employee/i, /revenue/i, /industry/i, /pricing/i,
      /competitor/i, /benchmark/i, /impression/i, /adCount/i, /locale/i]) {
      expect(body).not.toMatch(forbidden);
    }
  });

  it('is unaffected by public advertising evidence', () => {
    const withAds = decisionWithPilot();
    withAds.paidActivity = { ...withAds.paidActivity!, presence: 'observed', advertiserIdentity: 'MATCHED' };
    const a = attachBudgetAndLearningFloor(decisionWithPilot(), {});
    const b = attachBudgetAndLearningFloor(withAds, {});
    expect(b.budget).toEqual(a.budget);
    expect(b.budget!.state).toBe('unavailable');
  });

  it('takes nothing from the decision itself — only declared inputs', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/decision\.(organic|paidActivity|paidReadiness|need)/);
  });
});

describe('Declared budget', () => {
  it('preserves the declaration and its currency verbatim', () => {
    const out = attachBudgetAndLearningFloor(decisionWithPilot(), DECLARED);
    expect(out.budget).toMatchObject({ state: 'declared', amount: 40000, currency: 'INR' });
  });

  it('CASE C: an amount without a currency does not guess — it abstains', () => {
    const out = attachBudgetAndLearningFloor(decisionWithPilot(), {
      declaredAmount: 40000, declaredCurrency: null,
    });
    expect(out.budget!.state).toBe('unavailable');
    expect((out.budget as { unlock: string }).unlock).toContain('not inferred from location');
  });

  it('rejects a non-positive or non-finite amount rather than coercing it', () => {
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const budget = deriveAcquisitionBudget(
        { declaredAmount: amount, declaredCurrency: 'INR' },
        { state: 'unavailable', unlock: 'u' },
      );
      expect(budget.state).toBe('unavailable');
    }
  });

  it('keeps the posture low-risk and never reaches scale_ready', () => {
    const big = attachBudgetAndLearningFloor(decisionWithPilot(), {
      ...DECLARED, declaredAmount: 100000000,
    });
    expect(big.budget!.posture).toBe('low_risk_test');
    expect(big.budget!.posture).not.toBe('scale_ready');
  });

  it('does not escalate an unavailable budget into a higher risk posture', () => {
    const out = attachBudgetAndLearningFloor(decisionWithPilot(), {});
    expect(out.budget!.posture).toBe('low_risk_test');
  });
});

describe('Learning floor', () => {
  it('CASE D: missing inputs leave it unavailable with an unlock', () => {
    for (const inputs of [
      {},
      { declaredAmount: 40000, declaredCurrency: 'INR' },
      { declaredAcceptableCostPerConversion: 2000, declaredAcceptableCostCurrency: 'INR' },
    ] as DeclaredBudgetInputs[]) {
      const floor = deriveLearningFloor(inputs);
      expect(floor.state).toBe('unavailable');
      expect((floor as { unlock: string }).unlock).toBeTruthy();
    }
  });

  it('CASE E: derives deterministically from two declared figures, and exposes the basis', () => {
    const floor = deriveLearningFloor(DECLARED);
    expect(floor).toMatchObject({ state: 'derived', expectedConversionEvents: 20 });
    expect((floor as { basis: string }).basis).toContain('40000');
    expect((floor as { basis: string }).basis).toContain('2000');
    expect((floor as { basis: string }).basis).toContain('company declarations, not observed performance');
    // Reproducible.
    expect(deriveLearningFloor(DECLARED)).toEqual(floor);
  });

  it('refuses to divide across currencies', () => {
    const floor = deriveLearningFloor({
      declaredAmount: 40000, declaredCurrency: 'INR',
      declaredAcceptableCostPerConversion: 20, declaredAcceptableCostCurrency: 'USD',
    });
    expect(floor.state).toBe('unavailable');
    expect((floor as { unlock: string }).unlock).toContain('no exchange rate is assumed');
  });

  it('uses no safety multiplier, confidence claim or hidden constant', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/multiplier|safetyFactor|confidence\s*[:=]\s*0?\.\d|1\.\d\s*\*/i);
    expect(body).not.toMatch(/statistically|significance|p\s*<\s*0/i);
  });

  it('does not block the pilot when unavailable', () => {
    const out = attachBudgetAndLearningFloor(decisionWithPilot(), {});
    expect(out.learningFloor!.state).toBe('unavailable');
    expect(out.pilot).not.toBeNull();
  });

  it('records the comparison only when the floor exists', () => {
    expect((attachBudgetAndLearningFloor(decisionWithPilot(), DECLARED).budget as { meetsLearningFloor: boolean | null }).meetsLearningFloor).toBe(true);
    const noFloor = attachBudgetAndLearningFloor(decisionWithPilot(), {
      declaredAmount: 40000, declaredCurrency: 'INR',
    });
    expect((noFloor.budget as { meetsLearningFloor: boolean | null }).meetsLearningFloor).toBeNull();
  });
});

describe('DRISHIQ regression', () => {
  const before = drishiqDecision();
  const after = attachBudgetAndLearningFloor(before, DECLARED);

  it('stays blocked with its dependency and no pilot', () => {
    expect(after.posture).toBe('PAID_BLOCKED_BY_PREREQUISITE');
    expect(after.dependencies).toEqual(before.dependencies);
    expect(after.dependencies.some((d) => d.kind === 'blocking')).toBe(true);
    expect(after.pilot).toBeNull();
  });

  it('receives no budget and no learning floor, even with declared inputs', () => {
    expect(after.budget).toBeNull();
    expect(after.learningFloor).toBeNull();
  });
});

describe('3F changes budget and learning floor only', () => {
  it.each([
    ['with pilot', decisionWithPilot()],
    ['blocked', drishiqDecision()],
  ])('%s: every other field is identical', (_name, before) => {
    const after = attachBudgetAndLearningFloor(before, DECLARED);
    expect(after.posture).toBe(before.posture);
    expect(after.need).toEqual(before.need);
    expect(after.organic).toEqual(before.organic);
    expect(after.paidActivity).toEqual(before.paidActivity);
    expect(after.paidReadiness).toEqual(before.paidReadiness);
    expect(after.dependencies).toEqual(before.dependencies);
    expect(after.pilot).toEqual(before.pilot);
    expect(after.evidence).toEqual(before.evidence);
    expect(after.confidence).toBe(before.confidence);
    expect(after.priority).toBe(before.priority);
    expect(after.horizon).toBe(before.horizon);
    expect({ ...after, budget: before.budget, learningFloor: before.learningFloor }).toEqual(before);
  });

  it('does not mutate the decision it was given', () => {
    const before = decisionWithPilot();
    const snapshot = JSON.parse(JSON.stringify(before));
    attachBudgetAndLearningFloor(before, DECLARED);
    expect(before).toEqual(snapshot);
  });

  it('leaves measurement and review gate for 3G', () => {
    const out = attachBudgetAndLearningFloor(decisionWithPilot(), DECLARED);
    expect(out.measurement).toBeNull();
    expect(out.reviewGate).toBeNull();
  });

  it('builds no review threshold, stop or scale logic', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/successThreshold|stopCondition|reviewGate|scaleCondition|AcquisitionMeasurement/);
  });
});

describe('3F boundary', () => {
  it('assumes no private analytics source', () => {
    const body = codeOnly();
    for (const forbidden of [/\bga4?\b/i, /searchConsole/i, /\bgsc\b/i, /\bcrm\b/i, /roas/i,
      /\bcac\b/i, /\bltv\b/i, /adsManager/i, /googleAds/i]) {
      expect(body).not.toMatch(forbidden);
    }
  });

  it('writes nothing and creates no schema', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/supabase|saveProfile|insert\(|upsert\(|update\(/);
    expect(body).not.toMatch(/company_profiles|report_settings|migration/);
  });

  it('cannot produce a scale posture', () => {
    const out = attachBudgetAndLearningFloor(decisionWithPilot(), {
      ...DECLARED, declaredAmount: 99999999,
    });
    expect(out.posture).not.toBe('PAID_SCALE_CANDIDATE');
    expect(codeOnly()).not.toContain('PAID_SCALE_CANDIDATE');
  });
});
