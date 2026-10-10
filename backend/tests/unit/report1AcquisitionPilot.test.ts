/**
 * SLICE 3E — controlled pilot model.
 *
 * The governing rule is abstention: if the experiment cannot be responsibly specified, the
 * pilot is null. These tests exist mostly to prove the engine refuses, because a half-valid
 * pilot is the failure mode that costs a customer money.
 */
import fs from 'fs';
import path from 'path';
import {
  constructAcquisitionPilot,
  deriveDeclaredAudience,
  deriveChannel,
  acceptableDestination,
  acceptableConversionEvent,
  type PilotConstructionInput,
} from '../../services/snapshotReport/acquisitionPilot';
import {
  assessAcquisitionNeed,
  decideAcquisitionPosture,
  attachAcquisitionDependencies,
} from '../../services/snapshotReport/acquisitionPosture';
import type {
  AcquisitionDecision,
  AcquisitionPosture,
  OrganicCondition,
  PaidActivityObservation,
  PaidReadiness,
} from '../../services/snapshotReport/acquisitionContract';

const MODULE = 'backend/services/snapshotReport/acquisitionPilot.ts';
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
const paidActivity = (): PaidActivityObservation => ({
  platform: null, presence: 'none_found', advertiserIdentity: 'UNRESOLVED',
  evidence: { state: 'measured', basis: 'b', notMeasurable: 'Spend…', unlock: null },
});
const paidReadiness = (): PaidReadiness => ({
  conversionReadiness: 'ready', destination: 'https://acme.test/demo', offerClarity: 'clear',
  audienceDefinable: true, conversionEventObservable: true,
  evidence: { state: 'inferred', basis: 'b', notMeasurable: null, unlock: null },
});

/** A decision at the given posture, with dependencies wired exactly as 3C/3D would. */
function decisionAt(posture: AcquisitionPosture): AcquisitionDecision {
  const common = {
    organic: organic('operational'), paidActivity: paidActivity(), paidReadiness: paidReadiness(),
  };
  const map: Record<AcquisitionPosture, () => AcquisitionDecision> = {
    ORGANIC_PLUS_CONTROLLED_PAID_PILOT: () => decideAcquisitionPosture({
      ...common, need: assessAcquisitionNeed({ declaredGrowthPriorities: 'Grow enquiries' }),
      overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
    }),
    ORGANIC_LED: () => decideAcquisitionPosture({
      ...common, need: assessAcquisitionNeed({}),
      overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
    }),
    PAID_BLOCKED_BY_PREREQUISITE: () => decideAcquisitionPosture({
      ...common, need: assessAcquisitionNeed({ declaredGrowthPriorities: 'Grow' }),
      overallExperienceReadiness: 'obstructed', conversionPillarReadiness: 'partial',
    }),
    INSUFFICIENT_EVIDENCE: () => decideAcquisitionPosture({
      ...common, need: assessAcquisitionNeed({ declaredGrowthPriorities: 'Grow' }),
      overallExperienceReadiness: 'ready', conversionPillarReadiness: 'insufficient_evidence',
    }),
    PAID_NOT_CURRENTLY_RECOMMENDED: () => decideAcquisitionPosture({
      ...common,
      paidReadiness: { ...paidReadiness(), audienceDefinable: false, offerClarity: 'unclear' },
      need: assessAcquisitionNeed({}),
      overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
    }),
    PAID_SCALE_CANDIDATE: () => decideAcquisitionPosture({
      ...common, need: assessAcquisitionNeed({ declaredGrowthPriorities: 'Grow' }),
      overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
      reviewedPilot: { completed: true, metSuccessThreshold: true, basis: 'Reviewed.' },
    }),
    // Unreachable in 3C; constructed directly only to prove 3E invents nothing for it.
    PAID_SUPPORTED_URGENCY: () => ({
      ...decideAcquisitionPosture({
        ...common, need: assessAcquisitionNeed({ declaredGrowthPriorities: 'Grow' }),
        overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
      }),
      posture: 'PAID_SUPPORTED_URGENCY',
    }),
  };
  const decided = map[posture]();
  return attachAcquisitionDependencies(decided, {
    overallExperienceReadiness: posture === 'PAID_BLOCKED_BY_PREREQUISITE' ? 'obstructed' : 'ready',
    conversionPillarReadiness: posture === 'PAID_BLOCKED_BY_PREREQUISITE' ? 'partial' : 'ready',
    obstructedPillars: [{ pillar: 'value_communication', label: 'Value communication' }],
  });
}

/** Synthetic, fully defensible context. No real-company values. */
const COMPLETE: PilotConstructionInput = {
  declaredIcp: 'Operations leads at mid-sized logistics firms',
  declaredGeography: 'India',
  declaredPositioning: 'a structured way to shorten route planning',
  observedDestination: { url: 'https://acme.test/demo', kind: 'demo', isHomepage: false },
  observedConversionEvent: { label: 'a demo request', ctaOnly: false },
  channelEvidence: { channelClass: { name: 'Search advertising', basis: 'Observed buyer queries.' } },
};

describe('Pilot eligibility', () => {
  it('constructs a pilot for ORGANIC_PLUS_CONTROLLED_PAID_PILOT', () => {
    const out = constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), COMPLETE);
    expect(out.pilot).not.toBeNull();
  });

  it.each([
    'ORGANIC_LED',
    'PAID_BLOCKED_BY_PREREQUISITE',
    'PAID_NOT_CURRENTLY_RECOMMENDED',
    'INSUFFICIENT_EVIDENCE',
    'PAID_SCALE_CANDIDATE',
    'PAID_SUPPORTED_URGENCY',
  ] as AcquisitionPosture[])('constructs no pilot for %s', (posture) => {
    const decision = decisionAt(posture);
    expect(decision.posture).toBe(posture);
    expect(constructAcquisitionPilot(decision, COMPLETE).pilot).toBeNull();
  });

  it('DRISHIQ SHAPE: blocked posture with a blocking dependency yields no pilot', () => {
    const decision = decisionAt('PAID_BLOCKED_BY_PREREQUISITE');
    expect(decision.dependencies.some((d) => d.kind === 'blocking')).toBe(true);
    expect(constructAcquisitionPilot(decision, COMPLETE).pilot).toBeNull();
  });

  it('a blocking dependency abstains even at an eligible posture', () => {
    const decision = {
      ...decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'),
      dependencies: [{ id: 'conversion_readiness', kind: 'blocking' as const, label: 'C', why: 'w', resolvedBy: null }],
    };
    expect(constructAcquisitionPilot(decision, COMPLETE).pilot).toBeNull();
  });

  it('an ADVISORY dependency does not prevent construction, and is preserved', () => {
    const advisory = [{ id: 'conversion_readiness', kind: 'advisory' as const, label: 'C', why: 'w', resolvedBy: null }];
    const decision = { ...decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), dependencies: advisory };
    const out = constructAcquisitionPilot(decision, COMPLETE);
    expect(out.pilot).not.toBeNull();
    expect(out.dependencies).toEqual(advisory);
  });
});

describe('Objective', () => {
  const pilot = () => constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), COMPLETE).pilot!;

  it('states exactly one business question', () => {
    expect(typeof pilot().objective).toBe('string');
    expect(pilot().objective.split('Test whether').length - 1).toBe(1);
  });

  it('names the audience, proposition and conversion event', () => {
    const o = pilot().objective;
    expect(o).toContain('Operations leads at mid-sized logistics firms');
    expect(o).toContain('shorten route planning');
    expect(o).toContain('a demo request');
  });

  it('is never a vanity objective', () => {
    const o = pilot().objective.toLowerCase();
    for (const vanity of ['impression', 'click', 'reach', 'run ads', 'test advertising']) {
      expect(o).not.toContain(vanity);
    }
  });

  it('falls back to a neutral phrase rather than inventing a proposition', () => {
    const out = constructAcquisitionPilot(
      decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'),
      { ...COMPLETE, declaredPositioning: null },
    );
    expect(out.pilot!.objective).toContain('the current proposition');
  });
});

describe('Audience', () => {
  it('derives from declared ICP, narrowed by declared geography', () => {
    expect(deriveDeclaredAudience({ declaredIcp: 'Ops leads', declaredGeography: 'India' }))
      .toBe('Ops leads in India');
  });

  it('accepts a declared segment as an anchor', () => {
    expect(deriveDeclaredAudience({ declaredSegment: 'Mid-market SaaS' })).toBe('Mid-market SaaS');
  });

  it('MISSING AUDIENCE CONTROL: no declared ICP or segment yields no pilot', () => {
    const out = constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), {
      ...COMPLETE, declaredIcp: null, declaredSegment: null,
    });
    expect(out.pilot).toBeNull();
  });

  it('never treats geography or positioning alone as an audience', () => {
    expect(deriveDeclaredAudience({ declaredGeography: 'India' })).toBeNull();
    expect(deriveDeclaredAudience({ declaredPositioning: 'A clarity tool' })).toBeNull();
  });

  it('invents no demographics, titles, sizes or list segments', () => {
    const body = codeOnly();
    // Word-boundary matched: 'age' alone also appears inside 'homepage'.
    for (const invented of [/\bjob\s?title/i, /\bcompanySize\b/, /\bincome\b/i, /\bage\b/i,
      /\blookalike/i, /\bremarketing/i, /\bcustomerList\b/, /\bdemographic/i]) {
      expect(body).not.toMatch(invented);
    }
  });
});

describe('Channel', () => {
  it('uses a specific channel only with company-specific evidence', () => {
    expect(deriveChannel({ specific: { name: 'Google Search Ads', basis: 'Owned advertiser observed.' } }))
      .toEqual({ kind: 'specific_channel', name: 'Google Search Ads', basis: 'Owned advertiser observed.' });
  });

  it('keeps channel class distinct from a specific channel', () => {
    const out = deriveChannel({ channelClass: { name: 'Search advertising', basis: 'Buyer queries observed.' } });
    expect(out.kind).toBe('channel_class');
    expect(out.kind).not.toBe('specific_channel');
  });

  it('UNKNOWN CHANNEL CONTROL: no evidence yields unavailable, and no pilot', () => {
    expect(deriveChannel(null).kind).toBe('unavailable');
    const out = constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), {
      ...COMPLETE, channelEvidence: null,
    });
    expect(out.pilot).toBeNull();
  });

  it('never defaults an unknown platform to Google', () => {
    expect(JSON.stringify(deriveChannel({}))).not.toContain('oogle');
    const body = codeOnly();
    expect(body).not.toMatch(/\?\?\s*['"]google/i);
    expect(body.toLowerCase()).not.toContain("'google'");
  });

  it('observed advertising alone is not a channel recommendation', () => {
    // Supporting evidence must still be supplied as explicit `specific` evidence with a basis.
    expect(deriveChannel({ specific: { name: 'Google Search Ads', basis: '' } }).kind).toBe('unavailable');
  });
});

describe('Destination', () => {
  it('accepts an observed non-homepage destination', () => {
    expect(acceptableDestination({ url: 'https://a.test/demo', kind: 'demo', isHomepage: false }))
      .toBe('https://a.test/demo');
  });

  it('MISSING DESTINATION CONTROL: none observed yields no pilot', () => {
    const out = constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), {
      ...COMPLETE, observedDestination: null,
    });
    expect(out.pilot).toBeNull();
  });

  it('never treats the homepage as an acquisition destination by default', () => {
    expect(acceptableDestination({ url: 'https://a.test/', kind: 'homepage', isHomepage: true })).toBeNull();
    const out = constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), {
      ...COMPLETE, observedDestination: { url: 'https://a.test/', kind: 'homepage', isHomepage: true },
    });
    expect(out.pilot).toBeNull();
  });

  it('fabricates no URL and assumes no conventional path', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/['"]\/contact['"]|['"]\/demo['"]|['"]\/pricing['"]|https?:\/\//);
  });
});

describe('Conversion event', () => {
  it('accepts an observed conversion event', () => {
    expect(acceptableConversionEvent({ label: 'a demo request', ctaOnly: false })).toBe('a demo request');
  });

  it('a CTA alone is not a measurable conversion event', () => {
    expect(acceptableConversionEvent({ label: 'Get started button', ctaOnly: true })).toBeNull();
  });

  it('MISSING CONVERSION EVENT CONTROL: none observed yields no pilot', () => {
    for (const event of [null, { label: 'Get started', ctaOnly: true }]) {
      const out = constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), {
        ...COMPLETE, observedConversionEvent: event,
      });
      expect(out.pilot).toBeNull();
    }
  });

  it('substitutes no click, page view, engagement or traffic proxy', () => {
    const body = codeOnly().toLowerCase();
    for (const proxy of ['pageview', 'page_view', 'clickthrough', 'click-through', 'engagement', 'traffic']) {
      expect(body).not.toContain(proxy);
    }
  });
});

describe('Duration', () => {
  it('preserves an existing defensible duration', () => {
    const out = constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), {
      ...COMPLETE, durationDays: 28,
    });
    expect(out.pilot!.durationDays).toBe(28);
  });

  it('DURATION CONTROL: no source yields null, never a fabricated number', () => {
    const out = constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), COMPLETE);
    expect(out.pilot).not.toBeNull();
    expect(out.pilot!.durationDays).toBeNull();
  });

  it('introduces no default duration constant', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/\b(7|14|21|30|90)\b\s*;|durationDays\s*[:=]\s*\d/);
  });
});

describe('Experiment integrity', () => {
  const pilot = constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), COMPLETE).pilot!;

  it('carries exactly one of each element', () => {
    expect(Object.keys(pilot).sort()).toEqual(
      ['audience', 'channel', 'conversionEvent', 'destination', 'durationDays', 'objective'],
    );
    expect(Array.isArray(pilot.channel)).toBe(false);
    expect(typeof pilot.destination).toBe('string');
    expect(typeof pilot.conversionEvent).toBe('string');
  });

  it('carries no budget, learning floor, threshold or scale decision', () => {
    const blob = JSON.stringify(pilot).toLowerCase();
    for (const forbidden of ['budget', 'currency', 'cpc', 'cpm', 'cpa', 'cac', 'spend', 'threshold', 'learning', 'scale']) {
      expect(blob).not.toContain(forbidden);
    }
    expect(codeOnly()).not.toMatch(/[₹€£]\s*\d|\$\s*\d/);
  });

  it('performs no external advertising action and assumes no private analytics', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/fetch|axios|googleads|meta|linkedin|tiktok|microsoft|campaign/i);
    expect(body).not.toMatch(/\bga4?\b|gsc|crm|roas|ltv/i);
  });

  it('writes nothing', () => {
    const body = codeOnly();
    expect(body).not.toMatch(/supabase|saveProfile|insert\(|upsert\(|update\(/);
    expect(body).not.toContain('company_profiles');
  });
});

describe('Decision preservation — only pilot changes', () => {
  it.each([
    'ORGANIC_PLUS_CONTROLLED_PAID_PILOT',
    'ORGANIC_LED',
    'PAID_BLOCKED_BY_PREREQUISITE',
    'INSUFFICIENT_EVIDENCE',
  ] as AcquisitionPosture[])('%s: everything but pilot is identical', (posture) => {
    const before = decisionAt(posture);
    const after = constructAcquisitionPilot(before, COMPLETE);
    expect(after.posture).toBe(before.posture);
    expect(after.need).toEqual(before.need);
    expect(after.organic).toEqual(before.organic);
    expect(after.paidActivity).toEqual(before.paidActivity);
    expect(after.paidReadiness).toEqual(before.paidReadiness);
    expect(after.dependencies).toEqual(before.dependencies);
    expect(after.evidence).toEqual(before.evidence);
    expect(after.confidence).toBe(before.confidence);
    expect(after.priority).toBe(before.priority);
    expect(after.horizon).toBe(before.horizon);
    expect({ ...after, pilot: before.pilot }).toEqual(before);
  });

  it('does not mutate the decision it was given', () => {
    const before = decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT');
    const snapshot = JSON.parse(JSON.stringify(before));
    constructAcquisitionPilot(before, COMPLETE);
    expect(before).toEqual(snapshot);
  });

  it('leaves budget, learning floor, measurement and review gate untouched', () => {
    const out = constructAcquisitionPilot(decisionAt('ORGANIC_PLUS_CONTROLLED_PAID_PILOT'), COMPLETE);
    expect(out.budget).toBeNull();
    expect(out.learningFloor).toBeNull();
    expect(out.measurement).toBeNull();
    expect(out.reviewGate).toBeNull();
  });
});
