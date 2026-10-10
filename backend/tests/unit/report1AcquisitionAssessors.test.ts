/**
 * SLICE 3B — organic and paid CONDITION assessors.
 *
 * 3B assesses; it does not decide. The boundary tests at the bottom are the mandatory part:
 * no posture, no need, no pilot, no budget, no review gate, no profile write.
 *
 * The Drishiq fixture mirrors the real production report 3a0c23b3 (content/coverage measured,
 * authority null, search insufficient, ads observed but advertiser identity unresolved) and
 * is used ONLY as a regression fixture -- none of its values are hard-coded in the source.
 */
import fs from 'fs';
import path from 'path';
import {
  assessOrganicCondition,
  assessPaidActivity,
  assessPaidReadiness,
  ORGANIC_DIMENSION_KEYS,
} from '../../services/snapshotReport/acquisitionAssessors';

const MODULE = 'backend/services/snapshotReport/acquisitionAssessors.ts';
const source = (): string => fs.readFileSync(path.join(process.cwd(), MODULE), 'utf8');
/** Source with comments stripped, for assertions that must not trip on explanatory prose. */
const codeOnly = (): string => source()
  .split('\n')
  .filter((l) => {
    const s = l.trim();
    return !s.startsWith('*') && !s.startsWith('//') && !s.startsWith('/*');
  })
  .join('\n');

/** The real Drishiq dimension set. */
const drishiqDimensions = [
  { key: 'content_quality', value: 35, state: 'measured' as const },
  { key: 'coverage', value: 35, state: 'measured' as const },
  { key: 'reach', value: 32, state: 'measured' as const },
  { key: 'authority', value: null, state: 'insufficient_signal' as const },
  { key: 'aeo', value: null, state: 'insufficient_signal' as const },
  { key: 'platforms', value: 67, state: 'inferred' as const },
  { key: 'conversion', value: 29, state: 'measured' as const },
];

describe('Organic condition assessor', () => {
  it('derives a band only from measured dimensions', () => {
    const out = assessOrganicCondition({ dimensions: drishiqDimensions });
    // Weakest measured organic dimension is reach at 32. Under the EXISTING classifier
    // (CANONICAL_SCORE_BANDS.developing = 25) that is 'developing' -- taken from the real
    // contract rather than asserted from intuition.
    expect(out.band).toBe('developing');
    expect(out.evidence.state).toBe('inferred');
  });

  it('never lets a missing dimension contribute zero', () => {
    const withAuthority = assessOrganicCondition({
      dimensions: drishiqDimensions.map((d) =>
        d.key === 'authority' ? { key: 'authority', value: 80, state: 'measured' as const } : d),
    });
    const withoutAuthority = assessOrganicCondition({ dimensions: drishiqDimensions });
    // A null authority must not drag the band below a real weakest value.
    expect(withoutAuthority.band).toBe(withAuthority.band);
    expect(withoutAuthority.band).toBe('developing');
    const authority = withoutAuthority.supportingDimensions.find((d) => d.key === 'authority');
    expect(authority?.value).toBeNull();
    expect(authority?.value).not.toBe(0);
  });

  it('stays insufficient when nothing was measured', () => {
    const out = assessOrganicCondition({
      dimensions: [
        { key: 'content_quality', value: null, state: 'insufficient_signal' },
        { key: 'authority', value: null, state: 'unavailable' },
      ],
    });
    expect(out.band).toBe('insufficient');
    expect(out.evidence.state).toBe('insufficient_signal');
    expect(out.confidence).toBe('low');
  });

  it('does not force insufficient into weak', () => {
    const out = assessOrganicCondition({ dimensions: [] });
    expect(out.band).toBe('insufficient');
    expect(out.band).not.toBe('foundational');
  });

  it('preserves each dimension state rather than flattening it', () => {
    const out = assessOrganicCondition({ dimensions: drishiqDimensions });
    const states = Object.fromEntries(out.supportingDimensions.map((d) => [d.key, d.state]));
    expect(states.authority).toBe('insufficient_signal');
    expect(states.platforms).toBe('inferred');
    expect(states.content_quality).toBe('measured');
  });

  it('treats public absence as a gap in evidence, not poor performance', () => {
    const out = assessOrganicCondition({
      dimensions: drishiqDimensions,
      searchVisibilityState: 'insufficient_signal',
    });
    expect(out.evidence.notMeasurable).toContain('not a finding of zero performance');
    expect(out.evidence.unlock).toBeTruthy();
  });

  it('excludes conversion from the organic dimension set', () => {
    // Conversion describes what happens after demand arrives; it is paid-readiness evidence.
    expect([...ORGANIC_DIMENSION_KEYS]).not.toContain('conversion');
    const out = assessOrganicCondition({ dimensions: drishiqDimensions });
    expect(out.supportingDimensions.map((d) => d.key)).not.toContain('conversion');
  });

  it('creates no new organic score', () => {
    const out = assessOrganicCondition({ dimensions: drishiqDimensions });
    expect(out).not.toHaveProperty('score');
    expect(out).not.toHaveProperty('value');
    // Band assignment is delegated to the existing classifier. Scan the CODE, not the
    // prose: the docblock legitimately explains why there are no weights.
    expect(source()).toContain('canonicalBandFromValue');
    expect(codeOnly()).not.toMatch(/weight/i);
  });
});

describe('Paid activity observation', () => {
  const observedNoMatch = {
    advertising: {
      platform: 'google', accessState: 'observed',
      subjectLegalNameUsed: null, companyAdvertiserCount: 0, otherAdvertiserCount: 0,
    },
  };

  it('represents observed company advertising', () => {
    const out = assessPaidActivity({
      advertising: {
        platform: 'google', accessState: 'observed',
        subjectLegalNameUsed: 'Acme Ltd', companyAdvertiserCount: 2, otherAdvertiserCount: 1,
      },
    });
    expect(out.presence).toBe('observed');
    expect(out.advertiserIdentity).toBe('MATCHED');
  });

  it('never turns "no ads found" into "does not advertise"', () => {
    const out = assessPaidActivity(observedNoMatch);
    expect(out.presence).toBe('none_found');
    const blob = JSON.stringify(out).toLowerCase();
    expect(blob).not.toContain('does not advertise');
    expect(blob).not.toContain('no advertising');
  });

  it('keeps unresolved identity distinct from no advertiser observed', () => {
    const unresolved = assessPaidActivity(observedNoMatch);
    expect(unresolved.advertiserIdentity).toBe('UNRESOLVED');
    expect(unresolved.evidence.basis).toContain('declares no legal name');

    const notMatched = assessPaidActivity({
      advertising: { ...observedNoMatch.advertising, subjectLegalNameUsed: 'Acme Ltd' },
    });
    expect(notMatched.advertiserIdentity).toBe('NOT_MATCHED');
    expect(notMatched.advertiserIdentity).not.toBe('UNRESOLVED');
  });

  it('never coerces an unknown platform to Google', () => {
    const out = assessPaidActivity({
      advertising: { ...observedNoMatch.advertising, platform: null },
    });
    expect(out.platform).toBeNull();
    expect(JSON.stringify(out)).not.toContain('google');
    expect(source()).not.toMatch(/\?\?\s*'google'/);
  });

  it('marks an unreadable record not_observable, not absent', () => {
    for (const accessState of ['blocked', 'restricted', 'requires_auth', 'unreachable', 'unavailable']) {
      const out = assessPaidActivity({
        advertising: { ...observedNoMatch.advertising, accessState },
      });
      expect(out.presence).toBe('not_observable');
      expect(out.advertiserIdentity).toBe('INSUFFICIENT_EVIDENCE');
      expect(out.evidence.notMeasurable).toContain('not a finding that it does not');
    }
  });

  it('states the performance boundary on every observation', () => {
    const out = assessPaidActivity(observedNoMatch);
    expect(out.evidence.notMeasurable).toContain('Spend');
    expect(out.evidence.notMeasurable).toContain('return on ad spend');
    expect(out.evidence.notMeasurable).toContain('cost per acquisition');
  });

  it('claims no spend, ROAS, CAC or conversion rate anywhere', () => {
    const out = assessPaidActivity({
      advertising: {
        platform: 'google', accessState: 'observed',
        subjectLegalNameUsed: 'Acme Ltd', companyAdvertiserCount: 2, otherAdvertiserCount: 0,
      },
    });
    expect(out).not.toHaveProperty('spend');
    expect(out).not.toHaveProperty('roas');
    expect(out).not.toHaveProperty('cac');
    expect(out).not.toHaveProperty('conversionRate');
  });
});

describe('Paid readiness', () => {
  it('uses ExperienceReadiness, never a numeric threshold', () => {
    const out = assessPaidReadiness({ conversionReadiness: 'partial' });
    expect(out.conversionReadiness).toBe('partial');
    expect(source()).not.toMatch(/conversion\w*\s*[<>]=?\s*\d+/i);
  });

  it('represents destination readiness', () => {
    const out = assessPaidReadiness({ conversionReadiness: 'ready', destination: 'https://x.com/demo' });
    expect(out.destination).toBe('https://x.com/demo');
  });

  it('represents conversion-event observability, and abstains when unknown', () => {
    expect(assessPaidReadiness({ conversionReadiness: 'ready' }).conversionEventObservable).toBe(true);
    expect(assessPaidReadiness({ conversionReadiness: 'insufficient_evidence' }).conversionEventObservable).toBeNull();
    expect(assessPaidReadiness({}).conversionEventObservable).toBeNull();
  });

  it('leaves a missing audience unknown rather than inventing one', () => {
    expect(assessPaidReadiness({}).audienceDefinable).toBeNull();
    expect(assessPaidReadiness({ declaredAudience: 'Mid-market SaaS' }).audienceDefinable).toBe(true);
  });

  it('leaves offer clarity unknown when value communication was not evaluated', () => {
    expect(assessPaidReadiness({}).offerClarity).toBe('unknown');
    expect(assessPaidReadiness({ valueCommunicationReadiness: 'obstructed' }).offerClarity).toBe('unclear');
    expect(assessPaidReadiness({ valueCommunicationReadiness: 'ready' }).offerClarity).toBe('clear');
  });

  it('keeps activity and readiness separate', () => {
    const readiness = assessPaidReadiness({ conversionReadiness: 'partial' });
    expect(readiness).not.toHaveProperty('presence');
    expect(readiness).not.toHaveProperty('advertiserIdentity');
    expect(readiness).not.toHaveProperty('platform');
  });
});

describe('3B boundary — assesses, never decides', () => {
  it('emits no acquisition posture', () => {
    const exported = require('../../services/snapshotReport/acquisitionAssessors');
    for (const key of Object.keys(exported)) {
      expect(key).not.toMatch(/posture|decide|recommend/i);
    }
    const body = source();
    for (const posture of [
      'ORGANIC_LED', 'ORGANIC_PLUS_CONTROLLED_PAID_PILOT', 'PAID_SUPPORTED_URGENCY',
      'PAID_SCALE_CANDIDATE', 'PAID_BLOCKED_BY_PREREQUISITE', 'PAID_NOT_CURRENTLY_RECOMMENDED',
    ]) {
      expect(body).not.toContain(posture);
    }
  });

  it('calculates no acquisition need and reads no growth priorities', () => {
    expect(source()).not.toMatch(/growth_priorities|acquisitionNeed|AcquisitionNeed/);
  });

  it('generates no pilot, budget, channel or review gate', () => {
    const body = source();
    expect(body).not.toMatch(/AcquisitionPilot|AcquisitionBudget|PilotChannel|AcquisitionReviewGate/);
    expect(body).not.toMatch(/specific_channel|channel_class/);
    // A currency AMOUNT, not the `$` of a template literal.
    expect(body).not.toMatch(/[₹€£]\s*\d|\$\s*\d/);
    expect(body).not.toMatch(/\bcpc\b|\bcpm\b|\bcpa\b/i);
  });

  it('computes no learning floor', () => {
    expect(source()).not.toMatch(/learningFloor|LearningFloor|expectedConversionEvents/);
  });

  it('writes nothing: no persistence, no profile mutation', () => {
    const body = source();
    expect(body).not.toMatch(/supabase|saveProfile|update\(|insert\(|upsert\(/);
    expect(body).not.toMatch(/company_profiles/);
  });

  it('leaves acquisition_decision unpopulated', () => {
    expect(source()).not.toContain('acquisition_decision');
  });

  it('acquires no new data: no providers, crawlers or APIs', () => {
    const imports = source().match(/^import .*$/gm) ?? [];
    for (const line of imports) {
      expect(line).not.toMatch(/fetch|axios|crawl|provider|serp/i);
    }
  });
});
