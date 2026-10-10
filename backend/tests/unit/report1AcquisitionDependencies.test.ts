/**
 * SLICE 3D — dependency wiring.
 *
 * 3D attaches prerequisites the decision already established. It is downstream of posture and
 * must never feed back into it. The invariance block at the end is the mandatory part.
 *
 * The Drishiq shape matters here: overall readiness `obstructed`, conversion pillar `partial`.
 * The blocker must name the pillar actually obstructed (value communication), NOT the
 * conversion pillar — naming conversion there would misreport the evidence.
 */
import fs from 'fs';
import path from 'path';
import {
  assessAcquisitionNeed,
  decideAcquisitionPosture,
  attachAcquisitionDependencies,
} from '../../services/snapshotReport/acquisitionPosture';
import type {
  OrganicCondition,
  PaidActivityObservation,
  PaidReadiness,
} from '../../services/snapshotReport/acquisitionContract';

const MODULE = 'backend/services/snapshotReport/acquisitionPosture.ts';
const codeOnly = (): string => fs.readFileSync(path.join(process.cwd(), MODULE), 'utf8')
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

/** Decide then wire, the way a producer would. */
function decideAndWire(opts: {
  organicBand?: OrganicCondition['band'];
  overall?: 'ready' | 'partial' | 'obstructed' | 'insufficient_evidence' | null;
  pillar?: 'ready' | 'partial' | 'obstructed' | 'insufficient_evidence' | null;
  need?: typeof NEED_NONE;
  activity?: Partial<PaidActivityObservation>;
  readiness?: Partial<PaidReadiness>;
  obstructedPillars?: Array<{ pillar: string; label: string }>;
  reviewedPilot?: { completed: true; metSuccessThreshold: boolean; basis: string } | null;
}) {
  const input = {
    organic: organic(opts.organicBand ?? 'operational'),
    paidActivity: paidActivity(opts.activity),
    paidReadiness: paidReadiness(opts.readiness),
    need: opts.need ?? NEED_DECLARED,
    overallExperienceReadiness: opts.overall ?? 'ready',
    conversionPillarReadiness: opts.pillar ?? 'ready',
    reviewedPilot: opts.reviewedPilot ?? null,
  };
  const decided = decideAcquisitionPosture(input);
  const wired = attachAcquisitionDependencies(decided, {
    overallExperienceReadiness: input.overallExperienceReadiness,
    conversionPillarReadiness: input.conversionPillarReadiness,
    obstructedPillars: opts.obstructedPillars,
  });
  return { decided, wired };
}

describe('Conversion dependencies', () => {
  it('obstructed conversion pillar creates a BLOCKING conversion dependency', () => {
    const { wired } = decideAndWire({ pillar: 'obstructed' });
    expect(wired.posture).toBe('PAID_BLOCKED_BY_PREREQUISITE');
    expect(wired.dependencies).toHaveLength(1);
    expect(wired.dependencies[0].kind).toBe('blocking');
    expect(wired.dependencies[0].id).toBe('conversion_readiness');
    expect(wired.dependencies[0].why).toContain('before treating paid acquisition as a responsible next step');
  });

  it('DRISHIQ SHAPE: overall obstructed + pillar partial blocks, and names the REAL pillar', () => {
    const { wired } = decideAndWire({
      overall: 'obstructed',
      pillar: 'partial',
      obstructedPillars: [{ pillar: 'value_communication', label: 'Value communication' }],
    });
    expect(wired.posture).toBe('PAID_BLOCKED_BY_PREREQUISITE');
    expect(wired.dependencies).toHaveLength(1);
    expect(wired.dependencies[0].id).toBe('value_communication');
    // Must NOT misreport the conversion pillar as obstructed — it is partial.
    expect(wired.dependencies[0].id).not.toBe('conversion_readiness');
  });

  it('falls back to experience readiness when the obstructed pillar was not supplied', () => {
    const { wired } = decideAndWire({ overall: 'obstructed', pillar: 'partial' });
    expect(wired.dependencies).toHaveLength(1);
    expect(wired.dependencies[0].id).toBe('experience_readiness');
    expect(wired.dependencies[0].kind).toBe('blocking');
  });

  it('PARTIAL IS NOT BLOCKING', () => {
    const { wired } = decideAndWire({ overall: 'ready', pillar: 'partial' });
    expect(wired.posture).toBe('ORGANIC_PLUS_CONTROLLED_PAID_PILOT');
    expect(wired.dependencies.every((d) => d.kind !== 'blocking')).toBe(true);
    expect(wired.dependencies[0]?.kind).toBe('advisory');
  });

  it('ready conversion creates no conversion dependency at all', () => {
    const { wired } = decideAndWire({ overall: 'ready', pillar: 'ready' });
    expect(wired.dependencies).toEqual([]);
  });

  it('insufficient conversion evidence creates no fabricated blocking defect', () => {
    const { wired } = decideAndWire({ pillar: 'insufficient_evidence' });
    expect(wired.posture).toBe('INSUFFICIENT_EVIDENCE');
    expect(wired.dependencies).toEqual([]);
    // The unlock stays on the decision, not duplicated as a blocker.
    expect(wired.evidence.unlock).toBeTruthy();
  });
});

describe('What must NOT become a dependency', () => {
  it('weak organic is never a paid blocker', () => {
    for (const band of ['developing', 'foundational'] as const) {
      const { wired } = decideAndWire({ organicBand: band, overall: 'ready', pillar: 'ready' });
      expect(wired.posture).toBe('ORGANIC_PLUS_CONTROLLED_PAID_PILOT');
      expect(wired.dependencies.some((d) => d.kind === 'blocking')).toBe(false);
      expect(wired.dependencies.some((d) => /organic/i.test(d.id))).toBe(false);
    }
  });

  it('no ads found creates no advertising dependency', () => {
    const { wired } = decideAndWire({
      overall: 'ready', pillar: 'ready', activity: { presence: 'none_found' },
    });
    expect(wired.dependencies).toEqual([]);
    const blob = JSON.stringify(wired.dependencies).toLowerCase();
    expect(blob).not.toContain('advertising setup');
    expect(blob).not.toContain('start advertising');
    expect(blob).not.toContain('does not advertise');
  });

  it('unresolved or not-matched advertiser identity creates no dependency', () => {
    for (const identity of ['UNRESOLVED', 'NOT_MATCHED'] as const) {
      const { wired } = decideAndWire({
        overall: 'ready', pillar: 'ready', activity: { advertiserIdentity: identity },
      });
      expect(wired.dependencies).toEqual([]);
    }
  });

  it('undeclared urgency creates no dependency', () => {
    const { wired } = decideAndWire({ need: NEED_NONE, overall: 'ready', pillar: 'ready' });
    expect(wired.dependencies).toEqual([]);
  });

  it('scale posture receives no duplicated synthetic scale gate', () => {
    const { wired } = decideAndWire({
      overall: 'ready', pillar: 'ready',
      reviewedPilot: { completed: true, metSuccessThreshold: true, basis: 'Reviewed.' },
    });
    expect(wired.posture).toBe('PAID_SCALE_CANDIDATE');
    expect(wired.dependencies).toEqual([]);
  });

  it('emits no duplicate representation of one prerequisite', () => {
    const { wired } = decideAndWire({ pillar: 'obstructed' });
    const ids = wired.dependencies.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Forbidden dependencies across the whole input matrix', () => {
  // Single-path assertions missed an injected violation on the `partial` branch, so these
  // sweep every combination rather than one representative case.
  const bands = ['leading', 'operational', 'developing', 'foundational'] as const;
  const readinesses = ['ready', 'partial', 'obstructed', 'insufficient_evidence'] as const;
  const presences = ['observed', 'none_found', 'not_observable'] as const;
  const identities = ['MATCHED', 'PROBABLE_MATCH', 'NOT_MATCHED', 'UNRESOLVED', 'INSUFFICIENT_EVIDENCE'] as const;

  const everyCase = () => {
    const out: ReturnType<typeof decideAndWire>[] = [];
    for (const organicBand of bands) {
      for (const overall of readinesses) {
        for (const pillar of readinesses) {
          for (const presence of presences) {
            for (const advertiserIdentity of identities) {
              for (const need of [NEED_NONE, NEED_DECLARED]) {
                out.push(decideAndWire({
                  organicBand, overall, pillar, need,
                  activity: { presence, advertiserIdentity },
                }));
              }
            }
          }
        }
      }
    }
    return out;
  };

  it('never creates an organic or advertising prerequisite, in any combination', () => {
    for (const { wired } of everyCase()) {
      for (const dep of wired.dependencies) {
        expect(dep.id).not.toMatch(/organic|advertis|identity|platform|urgency|need/i);
      }
    }
  });

  it('never creates a BLOCKING dependency unless the posture is blocked', () => {
    for (const { wired } of everyCase()) {
      if (wired.posture !== 'PAID_BLOCKED_BY_PREREQUISITE') {
        expect(wired.dependencies.some((d) => d.kind === 'blocking')).toBe(false);
      }
    }
  });

  it('emits at most one dependency, and never duplicates an id', () => {
    for (const { wired } of everyCase()) {
      const ids = wired.dependencies.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('3D changes dependencies and nothing else', () => {
  const cases = [
    { name: 'blocked', opts: { pillar: 'obstructed' as const } },
    { name: 'drishiq', opts: { overall: 'obstructed' as const, pillar: 'partial' as const } },
    { name: 'constrained pilot', opts: { overall: 'ready' as const, pillar: 'partial' as const } },
    { name: 'organic led', opts: { need: NEED_NONE, overall: 'ready' as const, pillar: 'ready' as const } },
    { name: 'insufficient', opts: { pillar: 'insufficient_evidence' as const } },
  ];

  for (const { name, opts } of cases) {
    it(`${name}: posture, need, organic and paid are identical before and after`, () => {
      const { decided, wired } = decideAndWire(opts);
      expect(wired.posture).toBe(decided.posture);
      expect(wired.need).toEqual(decided.need);
      expect(wired.organic).toEqual(decided.organic);
      expect(wired.paidActivity).toEqual(decided.paidActivity);
      expect(wired.paidReadiness).toEqual(decided.paidReadiness);
      expect(wired.applicability).toBe(decided.applicability);
      expect(wired.rationale).toBe(decided.rationale);
      expect(wired.evidence).toEqual(decided.evidence);
      expect(wired.confidence).toBe(decided.confidence);
      expect(wired.horizon).toBe(decided.horizon);
      expect(wired.priority).toBe(decided.priority);
      // The ONLY difference.
      expect({ ...wired, dependencies: decided.dependencies }).toEqual(decided);
    });
  }

  it('does not mutate the decision it was given', () => {
    const { decided } = decideAndWire({ pillar: 'obstructed' });
    const snapshot = JSON.parse(JSON.stringify(decided));
    attachAcquisitionDependencies(decided, { conversionPillarReadiness: 'obstructed' });
    expect(decided).toEqual(snapshot);
  });
});

describe('3D scope boundary', () => {
  const { wired } = decideAndWire({ overall: 'ready', pillar: 'partial' });

  it('builds no pilot, budget, learning floor, measurement or review gate', () => {
    expect(wired.pilot).toBeNull();
    expect(wired.budget).toBeNull();
    expect(wired.learningFloor).toBeNull();
    expect(wired.measurement).toBeNull();
    expect(wired.reviewGate).toBeNull();
  });

  it('creates no parallel dependency abstraction', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'backend/services/snapshotReport/acquisitionDependencies.ts'))).toBe(false);
  });

  it('introduces no numeric conversion threshold or currency', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/conversion\w*\s*[<>]=?\s*\d/i);
    expect(body).not.toMatch(/[₹€£]\s*\d|\$\s*\d/);
  });

  it('writes nothing', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/supabase|saveProfile|insert\(|upsert\(|update\(/);
    expect(body).not.toContain('company_profiles');
  });

  it('claims no private performance anywhere in a dependency', () => {
    const { wired: blocked } = decideAndWire({ pillar: 'obstructed' });
    const blob = JSON.stringify(blocked.dependencies).toLowerCase();
    for (const claim of ['roas', 'cac', 'conversion rate is low', 'paid advertising is ineffective', 'no paid campaigns']) {
      expect(blob).not.toContain(claim);
    }
  });
});
