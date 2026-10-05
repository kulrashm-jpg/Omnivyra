/**
 * SLICE 3C — acquisition need + posture engine.
 *
 * The Drishiq shape (conversion 29/100, overall experience readiness obstructed, conversion
 * pillar partial, organic incomplete, ads observed with advertiser identity UNRESOLVED) must
 * produce PAID_BLOCKED_BY_PREREQUISITE — "paid is currently blocked by a conversion
 * prerequisite while organic continues", never "paid is bad for this company".
 */
import fs from 'fs';
import path from 'path';
import {
  assessAcquisitionNeed,
  conversionGateFrom,
  decideAcquisitionPosture,
} from '../../services/snapshotReport/acquisitionPosture';
import type {
  OrganicCondition,
  PaidActivityObservation,
  PaidReadiness,
} from '../../services/snapshotReport/acquisitionContract';

const MODULE = 'backend/services/snapshotReport/acquisitionPosture.ts';
const source = (): string => fs.readFileSync(path.join(process.cwd(), MODULE), 'utf8');
const codeOnly = (): string => source()
  .split('\n')
  .filter((l) => {
    const s = l.trim();
    return !s.startsWith('*') && !s.startsWith('//') && !s.startsWith('/*');
  })
  .join('\n');

const organic = (band: OrganicCondition['band']): OrganicCondition => ({
  band,
  evidence: { state: 'inferred', basis: 'b', notMeasurable: null, unlock: null },
  confidence: 'medium',
  supportingDimensions: [],
});

const paidActivity = (over: Partial<PaidActivityObservation> = {}): PaidActivityObservation => ({
  platform: 'google',
  presence: 'none_found',
  advertiserIdentity: 'UNRESOLVED',
  evidence: { state: 'measured', basis: 'b', notMeasurable: 'Spend…', unlock: null },
  ...over,
});

const paidReadiness = (over: Partial<PaidReadiness> = {}): PaidReadiness => ({
  conversionReadiness: 'partial',
  destination: 'https://x.com/',
  offerClarity: 'clear',
  audienceDefinable: true,
  conversionEventObservable: true,
  evidence: { state: 'inferred', basis: 'b', notMeasurable: null, unlock: null },
  ...over,
});

const NEED_NONE = assessAcquisitionNeed({});
const NEED_DECLARED = assessAcquisitionNeed({ declaredGrowthPriorities: 'Expand in India' });

describe('Acquisition need', () => {
  it('establishes declared need from a declared growth priority', () => {
    expect(NEED_DECLARED.state).toBe('observed');
    expect(NEED_DECLARED.rationale).toContain('declaration of intent');
  });

  it('rates a time-bound driver above a general growth statement', () => {
    const timeBound = assessAcquisitionNeed({ declaredTimeBoundDriver: true });
    expect(timeBound.state).toBe('observed');
    expect(timeBound.confidence).toBe('medium');
    expect(NEED_DECLARED.confidence).toBe('low');
  });

  it('does not create urgency where none was declared', () => {
    expect(NEED_NONE.state).toBe('undetermined');
    expect(NEED_NONE.state).not.toBe('observed');
    expect(NEED_NONE.evidence.unlock).toContain('Declare your growth priorities');
  });

  it('cannot be reached from organic, conversion, ads or competitor signals', () => {
    // The function has no parameter through which performance could enter.
    const body = codeOnly();
    for (const forbidden of ['organic', 'searchVisibility', 'advertis', 'competitor', 'conversion']) {
      expect(body.slice(0, body.indexOf('export type ConversionGate'))).not.toContain(forbidden);
    }
  });

  it('never claims a pipeline shortfall it cannot observe', () => {
    expect(NEED_DECLARED.evidence.notMeasurable).toContain('pipeline shortfall');
  });
});

describe('Conversion gate — readiness, never a score', () => {
  it('blocks on an obstruction anywhere on the path', () => {
    expect(conversionGateFrom('obstructed', 'partial')).toBe('BLOCKING');
    expect(conversionGateFrom('ready', 'obstructed')).toBe('BLOCKING');
  });

  it('maps the remaining arms from the conversion pillar alone', () => {
    expect(conversionGateFrom('partial', 'partial')).toBe('CONSTRAINED');
    expect(conversionGateFrom('partial', 'ready')).toBe('ADEQUATE');
    expect(conversionGateFrom('ready', 'insufficient_evidence')).toBe('NO_POSTURE');
    expect(conversionGateFrom(null, null)).toBe('NO_POSTURE');
  });

  it('compares no numeric conversion score anywhere', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/conversion\w*\s*[<>]=?\s*\d/i);
    expect(body).not.toContain('29');
    expect(body).not.toMatch(/dimensions\.conversion/);
  });
});

describe('Posture matrix', () => {
  const base = { organic: organic('operational'), paidActivity: paidActivity(), paidReadiness: paidReadiness() };

  it('CASE A — healthy organic, no established need → ORGANIC_LED', () => {
    const out = decideAcquisitionPosture({
      ...base, need: NEED_NONE, conversionPillarReadiness: 'ready', overallExperienceReadiness: 'ready',
    });
    expect(out.posture).toBe('ORGANIC_LED');
    expect(out.rationale).toContain('not a reason to advertise');
  });

  it('CASE B — adequate organic + declared need + ready path → controlled pilot, not scale', () => {
    const out = decideAcquisitionPosture({
      ...base, need: NEED_DECLARED, conversionPillarReadiness: 'ready', overallExperienceReadiness: 'ready',
    });
    expect(out.posture).toBe('ORGANIC_PLUS_CONTROLLED_PAID_PILOT');
    expect(out.posture).not.toBe('PAID_SCALE_CANDIDATE');
  });

  it('CASE C — weak organic + declared need → controlled pilot, never "paid inappropriate"', () => {
    const out = decideAcquisitionPosture({
      ...base, organic: organic('foundational'), need: NEED_DECLARED,
      conversionPillarReadiness: 'ready', overallExperienceReadiness: 'ready',
    });
    expect(out.posture).toBe('ORGANIC_PLUS_CONTROLLED_PAID_PILOT');
    expect(out.rationale).toContain('paid does not replace the foundation');
  });

  it('CASE E — obstructed conversion → blocked, and names the prerequisite', () => {
    const out = decideAcquisitionPosture({
      ...base, need: NEED_DECLARED, overallExperienceReadiness: 'obstructed', conversionPillarReadiness: 'partial',
    });
    expect(out.posture).toBe('PAID_BLOCKED_BY_PREREQUISITE');
    expect(out.rationale).toContain('conversion path');
    expect(out.rationale).toContain('not a finding that advertising is wrong');
    expect(out.priority).toBe('high');
  });

  it('CASE F — partial conversion does NOT automatically block paid', () => {
    const out = decideAcquisitionPosture({
      ...base, need: NEED_DECLARED, conversionPillarReadiness: 'partial', overallExperienceReadiness: 'partial',
    });
    expect(out.posture).toBe('ORGANIC_PLUS_CONTROLLED_PAID_PILOT');
    expect(out.posture).not.toBe('PAID_BLOCKED_BY_PREREQUISITE');
    expect(out.rationale).toContain('constrained');
  });

  it('CASE G — unevaluable conversion → insufficient evidence, not another posture', () => {
    const out = decideAcquisitionPosture({
      ...base, need: NEED_DECLARED, conversionPillarReadiness: 'insufficient_evidence',
    });
    expect(out.posture).toBe('INSUFFICIENT_EVIDENCE');
    expect(out.posture).not.toBe('ORGANIC_LED');
    expect(out.posture).not.toBe('PAID_NOT_CURRENTLY_RECOMMENDED');
    expect(out.posture).not.toBe('PAID_BLOCKED_BY_PREREQUISITE');
    expect(out.evidence.unlock).toBeTruthy();
  });

  it('CASE G — no observable organic dimension → insufficient evidence', () => {
    const out = decideAcquisitionPosture({
      ...base, organic: organic('insufficient'), need: NEED_DECLARED, conversionPillarReadiness: 'ready',
    });
    expect(out.posture).toBe('INSUFFICIENT_EVIDENCE');
    expect(out.rationale).toContain('not a finding about this company');
  });
});

describe('PAID_SCALE_CANDIDATE safeguards', () => {
  const base = {
    organic: organic('operational'), paidActivity: paidActivity(), paidReadiness: paidReadiness(),
    need: NEED_DECLARED, conversionPillarReadiness: 'ready' as const, overallExperienceReadiness: 'ready' as const,
  };

  it('requires reviewed pilot evidence that met its threshold', () => {
    const out = decideAcquisitionPosture({
      ...base, reviewedPilot: { completed: true, metSuccessThreshold: true, basis: 'Reviewed.' },
    });
    expect(out.posture).toBe('PAID_SCALE_CANDIDATE');
  });

  it('is unreachable without pilot evidence', () => {
    expect(decideAcquisitionPosture(base).posture).not.toBe('PAID_SCALE_CANDIDATE');
    expect(decideAcquisitionPosture({ ...base, reviewedPilot: null }).posture).not.toBe('PAID_SCALE_CANDIDATE');
  });

  it('is unreachable from a pilot that missed its threshold', () => {
    const out = decideAcquisitionPosture({
      ...base, reviewedPilot: { completed: true, metSuccessThreshold: false, basis: 'Reviewed.' },
    });
    expect(out.posture).not.toBe('PAID_SCALE_CANDIDATE');
  });

  it('is unreachable from observed public ads or a matched advertiser', () => {
    const out = decideAcquisitionPosture({
      ...base,
      paidActivity: paidActivity({ presence: 'observed', advertiserIdentity: 'MATCHED' }),
    });
    expect(out.posture).not.toBe('PAID_SCALE_CANDIDATE');
  });
});

describe('Evidence discipline', () => {
  const base = {
    organic: organic('operational'), paidActivity: paidActivity(), paidReadiness: paidReadiness(),
    need: NEED_NONE,
    conversionPillarReadiness: 'ready' as const, overallExperienceReadiness: 'ready' as const,
  };

  it('no public ads found never yields PAID_NOT_CURRENTLY_RECOMMENDED', () => {
    const out = decideAcquisitionPosture({ ...base, paidActivity: paidActivity({ presence: 'none_found' }) });
    expect(out.posture).not.toBe('PAID_NOT_CURRENTLY_RECOMMENDED');
  });

  it('never says the company does not advertise', () => {
    const out = decideAcquisitionPosture({ ...base, paidActivity: paidActivity({ presence: 'none_found' }) });
    const blob = JSON.stringify(out).toLowerCase();
    expect(blob).not.toContain('does not advertise');
    expect(blob).not.toContain('has never advertised');
  });

  it('unresolved advertiser identity does not determine posture', () => {
    const unresolved = decideAcquisitionPosture({ ...base, paidActivity: paidActivity({ advertiserIdentity: 'UNRESOLVED' }) });
    const notMatched = decideAcquisitionPosture({ ...base, paidActivity: paidActivity({ advertiserIdentity: 'NOT_MATCHED' }) });
    expect(unresolved.posture).toBe(notMatched.posture);
    expect(unresolved.posture).not.toBe('PAID_NOT_CURRENTLY_RECOMMENDED');
  });

  it('requires positive evidence for PAID_NOT_CURRENTLY_RECOMMENDED', () => {
    const out = decideAcquisitionPosture({
      ...base,
      paidReadiness: paidReadiness({ audienceDefinable: false, offerClarity: 'unclear' }),
    });
    expect(out.posture).toBe('PAID_NOT_CURRENTLY_RECOMMENDED');
    // Unknown is not the same as observed-unsuitable.
    const unknown = decideAcquisitionPosture({
      ...base, paidReadiness: paidReadiness({ audienceDefinable: null, offerClarity: 'unknown' }),
    });
    expect(unknown.posture).not.toBe('PAID_NOT_CURRENTLY_RECOMMENDED');
  });

  it('claims no spend, ROAS, CAC, LTV or conversion rate', () => {
    const out = decideAcquisitionPosture({ ...base, paidActivity: paidActivity() });
    expect(out.evidence.notMeasurable).toContain('return on ad spend');
    expect(out.evidence.notMeasurable).toContain('lifetime value');
    const blob = JSON.stringify(out);
    expect(blob).not.toMatch(/"roas"|"cac"|"ltv"|"spend":/i);
  });
});

describe('3C scope boundary', () => {
  const out = decideAcquisitionPosture({
    organic: organic('operational'), paidActivity: paidActivity(), paidReadiness: paidReadiness(),
    need: NEED_DECLARED, conversionPillarReadiness: 'ready', overallExperienceReadiness: 'ready',
  });

  it('builds no pilot, budget, learning floor, measurement or review gate', () => {
    expect(out.pilot).toBeNull();
    expect(out.budget).toBeNull();
    expect(out.learningFloor).toBeNull();
    expect(out.measurement).toBeNull();
    expect(out.reviewGate).toBeNull();
  });

  it('wires no formal dependencies — 3D owns that', () => {
    expect(out.dependencies).toEqual([]);
  });

  it('contains no currency amount, CPC, CPM or CPA', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/[₹€£]\s*\d|\$\s*\d/);
    expect(body).not.toMatch(/\bcpc\b|\bcpm\b|\bcpa\b/i);
  });

  it('coerces no missing evidence to zero', () => {
    expect(codeOnly()).not.toMatch(/\?\?\s*0/);
  });

  it('reads Company Profile but never writes it', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/supabase|saveProfile|insert\(|upsert\(|update\(/);
    expect(body).not.toContain('company_profiles');
  });

  it('uses only the seven locked posture values', () => {
    const body = codeOnly();
    const found = body.match(/'(ORGANIC_LED|ORGANIC_PLUS_CONTROLLED_PAID_PILOT|PAID_SUPPORTED_URGENCY|PAID_SCALE_CANDIDATE|PAID_BLOCKED_BY_PREREQUISITE|PAID_NOT_CURRENTLY_RECOMMENDED|INSUFFICIENT_EVIDENCE)'/g) ?? [];
    expect(found.length).toBeGreaterThan(0);
    // No synonym or invented posture.
    expect(body).not.toMatch(/'PAID_RECOMMENDED'|'ORGANIC_ONLY'|'PAID_READY'/);
  });
});
