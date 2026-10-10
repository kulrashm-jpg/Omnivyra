/**
 * SLICE 3H — acquisition decision rendering.
 *
 * Pure presentation. These tests assert the renderer passes structured data through without
 * recomputing it, and that no display label implies more evidence than the underlying state.
 */
import fs from 'fs';
import path from 'path';
import { renderAcquisitionDecision } from '../../services/intelligence/exportRendererReport1';
import type { CanonicalExportPayload } from '../../services/intelligence/canonicalExport';
import { attachMeasurementAndReview } from '../../services/snapshotReport/acquisitionMeasurement';
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

const RENDERER = 'backend/services/intelligence/exportRendererReport1.ts';
const source = (): string => fs.readFileSync(path.join(process.cwd(), RENDERER), 'utf8');

function payloadWith(decision: AcquisitionDecision | null): CanonicalExportPayload {
  return { report1: { acquisition_decision: decision } } as unknown as CanonicalExportPayload;
}

const organic = (band: OrganicCondition['band']): OrganicCondition => ({
  band,
  evidence: { state: 'inferred', basis: 'Assessed from 3 observed dimensions.', notMeasurable: 'authority', unlock: 'Connect a backlink source.' },
  confidence: 'medium',
  supportingDimensions: [
    { key: 'content_quality', value: 35, state: 'measured' },
    { key: 'authority', value: null, state: 'insufficient_signal' },
  ],
});
const paidActivity = (over: Partial<PaidActivityObservation> = {}): PaidActivityObservation => ({
  platform: null, presence: 'none_found', advertiserIdentity: 'UNRESOLVED',
  evidence: { state: 'measured', basis: 'Public ad record read.', notMeasurable: 'Spend, return on ad spend.', unlock: null },
  ...over,
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

/** Positive fixture: valid pilot, budget unavailable, measurement unavailable, gate present. */
function pilotDecision(): AcquisitionDecision {
  const decided = decideAcquisitionPosture({
    organic: organic('operational'), paidActivity: paidActivity(), paidReadiness: paidReadiness(),
    need: assessAcquisitionNeed({ declaredGrowthPriorities: 'Grow enquiries' }),
    overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
  });
  const wired = attachAcquisitionDependencies(decided, {
    overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
  });
  const piloted = constructAcquisitionPilot(wired, PILOT_CONTEXT);
  return attachMeasurementAndReview(attachBudgetAndLearningFloor(piloted, {}), {});
}

/** Drishiq shape: blocked, value_communication, pilot null. */
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
  const piloted = constructAcquisitionPilot(wired, PILOT_CONTEXT);
  return attachMeasurementAndReview(attachBudgetAndLearningFloor(piloted, {}), {});
}

describe('Posture and evidence', () => {
  const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');

  it('renders the human label without altering the enum', () => {
    expect(html).toContain('Organic + controlled paid pilot');
    expect(html).not.toContain('ORGANIC_PLUS_CONTROLLED_PAID_PILOT');
  });

  it('does not recompute the posture — it prints what it was given', () => {
    const forced = { ...pilotDecision(), posture: 'ORGANIC_LED' as const };
    expect(renderAcquisitionDecision(payloadWith(forced), '08')).toContain('Organic-led');
  });

  it('preserves evidence state without upgrading it', () => {
    expect(html).toContain('Inferred from available evidence');
    expect(html).not.toMatch(/\bMeasured\b.*Assessed from 3 observed dimensions/);
  });

  it('never renders insufficient_signal as zero or unavailable as poor', () => {
    const blob = html.toLowerCase();
    expect(blob).not.toContain('insufficient_signal');
    expect(blob).not.toMatch(/\bpoor\b/);
    // The unmeasured authority dimension renders its state inline in lowercase.
    expect(blob).toContain('insufficient evidence');
  });
});

describe('Acquisition need', () => {
  it('keeps a declared growth priority framed as intent, not a shortfall', () => {
    const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');
    expect(html).toContain('declaration of intent, not an observed shortfall');
    const blob = html.toLowerCase();
    // These words may appear ONLY in the boundary line declaring them unobservable.
    expect(blob).toContain('none is publicly observable');
    expect(blob).not.toMatch(/has a demand shortfall|observed revenue pressure|is under revenue pressure/);
  });

  it('renders an undetermined need as undetermined', () => {
    const d = pilotDecision();
    const undet = { ...d, need: assessAcquisitionNeed({}) };
    expect(renderAcquisitionDecision(payloadWith(undet), '08'))
      .toContain('could not be established either way');
  });
});

describe('Organic condition', () => {
  const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');

  it('passes the band through as a label', () => {
    expect(html).toContain('Organic condition: Operational');
  });

  it('shows an unmeasured dimension as not established, never zero', () => {
    expect(html).toContain('authority: not established');
    expect(html).not.toMatch(/authority: 0/);
    expect(html).toContain('content_quality: 35');
  });
});

describe('Paid condition', () => {
  it('never renders none_found as "does not advertise"', () => {
    const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08').toLowerCase();
    expect(html).toContain('no public advertising was found');
    expect(html).not.toContain('does not advertise');
    expect(html).not.toContain('has never advertised');
  });

  it('never renders UNRESOLVED as "not advertising"', () => {
    const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');
    expect(html).toContain('Advertiser ownership could not be established');
    expect(html.toLowerCase()).not.toContain('is not advertising');
  });

  it('never defaults an unknown platform to Google', () => {
    const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');
    expect(html.toLowerCase()).not.toContain('google');
    expect(source()).not.toMatch(/\?\?\s*['"]google/i);
  });

  it('states the performance boundary', () => {
    const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');
    expect(html).toContain('no spend, return, cost per acquisition or conversion rate is observable');
  });
});

describe('Dependencies', () => {
  it('renders a blocking dependency as blocking', () => {
    const html = renderAcquisitionDecision(payloadWith(drishiqDecision()), '08');
    expect(html).toContain('Value communication — blocking');
  });

  it('keeps an advisory dependency advisory', () => {
    const d = pilotDecision();
    const advisory = {
      ...d,
      dependencies: [{ id: 'conversion_readiness', kind: 'advisory' as const, label: 'Conversion readiness', why: 'Partial.', resolvedBy: null }],
    };
    const html = renderAcquisitionDecision(payloadWith(advisory), '08');
    expect(html).toContain('Conversion readiness — advisory');
    expect(html).not.toContain('Conversion readiness — blocking');
  });

  it('manufactures no dependency when there are none', () => {
    const d = { ...pilotDecision(), dependencies: [] };
    expect(renderAcquisitionDecision(payloadWith(d), '08')).not.toContain('Prerequisites');
  });
});

describe('Pilot', () => {
  it('renders only the structured fields when a pilot exists', () => {
    const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');
    expect(html).toContain('Operations leads at mid-sized logistics firms in India');
    expect(html).toContain('Search advertising');
    expect(html).toContain('https://acme.test/demo');
    expect(html).toContain('a demo request');
    expect(html).toContain('Duration: not yet established');
  });

  it('constructs no hypothetical pilot when there is none', () => {
    const html = renderAcquisitionDecision(payloadWith(drishiqDecision()), '08');
    expect(html).toContain('No controlled pilot has been specified');
    expect(html).not.toContain('Operations leads');
    expect(html).not.toContain('Search advertising');
    expect(html).not.toContain('https://acme.test/demo');
  });

  it('invents no duration when the contract supplies none', () => {
    const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');
    expect(html).not.toMatch(/Duration: (7|14|21|30|90) days/);
  });
});

describe('Budget and expected conversion events', () => {
  it('renders an unavailable budget with its unlock, never zero', () => {
    const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');
    expect(html).toContain('Not available.');
    expect(html).toContain('Declare what you could spend');
    expect(html).not.toMatch(/[₹$€£]\s*0\b/);
  });

  it('labels a declared budget as declared, not as observed spend', () => {
    const declared = attachBudgetAndLearningFloor(
      constructAcquisitionPilot(
        attachAcquisitionDependencies(
          decideAcquisitionPosture({
            organic: organic('operational'), paidActivity: paidActivity(), paidReadiness: paidReadiness(),
            need: assessAcquisitionNeed({ declaredGrowthPriorities: 'Grow' }),
            overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready',
          }),
          { overallExperienceReadiness: 'ready', conversionPillarReadiness: 'ready' },
        ),
        PILOT_CONTEXT,
      ),
      { declaredAmount: 40000, declaredCurrency: 'INR', declaredAcceptableCostPerConversion: 2000, declaredAcceptableCostCurrency: 'INR' },
    );
    const html = renderAcquisitionDecision(payloadWith(declared), '08');
    expect(html).toContain('Company-declared: 40000 INR');
    expect(html).toContain('not observed advertising spend');
    expect(html.toLowerCase()).not.toContain('current advertising spend');
  });

  it('never calls expected conversion events a minimum required', () => {
    const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');
    expect(html).toContain('Expected conversion events');
    expect(html.toLowerCase()).not.toContain('minimum conversions required');
    expect(html.toLowerCase()).not.toContain('statistical');
  });
});

describe('Measurement', () => {
  const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');

  it('takes the primary KPI from the pilot conversion event', () => {
    expect(html).toContain('Primary outcome: a demo request');
  });

  it('never substitutes a vanity metric for the primary outcome', () => {
    expect(html).not.toMatch(/Primary outcome: (clicks|impressions|CTR|reach|pageviews)/i);
  });

  it('renders a null baseline as not yet observed, never zero', () => {
    expect(html).toContain('Baseline: not yet observed');
    expect(html).not.toContain('Baseline: 0');
  });

  it('renders missing measurement as unreadable, not as failure', () => {
    expect(html).toContain('Can this be read today: no');
    const blob = html.toLowerCase();
    expect(blob).not.toContain('the campaign failed');
    expect(blob).not.toContain('0 conversions');
  });

  it('renders a missing success target as not established', () => {
    expect(html).toContain('Success target: not established');
  });

  it('derives the measurement method from the structured object, not hardcoded prose', () => {
    const custom = pilotDecision();
    custom.measurement = { ...custom.measurement!, primaryKpi: 'a booked consultation', source: 'HubSpot' };
    const out = renderAcquisitionDecision(payloadWith(custom), '08');
    expect(out).toContain('Primary outcome: a booked consultation');
    expect(out).toContain('Source: HubSpot');
  });
});

describe('Review gate', () => {
  const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');

  it('is labelled as pre-committed, not as a result', () => {
    expect(html).toContain('agreed before any spend');
    expect(html).toContain('They are not results: no experiment has been run');
  });

  it('renders proceed as Continue while the contract keeps proceed', () => {
    expect(html).toContain('>Continue<');
    expect(html).not.toContain('>proceed<');
    expect(source()).toContain('gate.proceed');
  });

  it('shows all four states', () => {
    for (const state of ['>Stop<', '>Modify<', '>Continue<', '>Scale<']) {
      expect(html).toContain(state);
    }
  });

  it('fabricates no runtime outcome', () => {
    const blob = html.toLowerCase();
    expect(blob).not.toContain('the test succeeded');
    expect(blob).not.toContain('result: scale');
    expect(blob).not.toContain('verdict');
  });
});

describe('DRISHIQ render regression', () => {
  const decision = drishiqDecision();
  const html = renderAcquisitionDecision(payloadWith(decision), '08');

  it('renders blocked posture and the value-communication prerequisite', () => {
    expect(html).toContain('Paid blocked by prerequisite');
    expect(html).toContain('Value communication — blocking');
  });

  it('renders no pilot, no budget, no measurement and no review gate', () => {
    expect(decision.pilot).toBeNull();
    expect(decision.budget).toBeNull();
    expect(decision.measurement).toBeNull();
    expect(decision.reviewGate).toBeNull();
    expect(html).toContain('No controlled pilot has been specified');
    expect(html).not.toContain('How this will be measured');
    expect(html).not.toContain('agreed before any spend');
  });

  it('creates no synthetic acquisition plan', () => {
    expect(html).not.toContain('Expected conversion events');
    expect(html).not.toMatch(/[₹$€£]\s*\d/);
  });
});

describe('Renderer architecture and purity', () => {
  it('omits the section entirely when no decision exists', () => {
    expect(renderAcquisitionDecision(payloadWith(null), '08')).toBe('');
    expect(renderAcquisitionDecision({} as CanonicalExportPayload, '08')).toBe('');
  });

  it('uses the canonical dossier vocabulary', () => {
    const html = renderAcquisitionDecision(payloadWith(pilotDecision()), '08');
    expect(html).toContain('ds-section');
    expect(html).toContain('ds-framing');
    expect(html).toContain('ds-playbook-group');
  });

  it('is emitted by the canonical output, not merely defined', () => {
    const output = fs.readFileSync(
      path.join(process.cwd(), 'backend/services/intelligence/exportRendererOutput.ts'), 'utf8',
    );
    expect(output).toContain('renderAcquisitionDecision,');
    expect(output).toContain('${renderAcquisitionDecision(payload, EYEBROW_EVIDENCE)}');
  });

  it('invokes no legacy renderer', () => {
    expect(source()).not.toContain('reportHtmlSections');
    expect(source()).not.toContain('reportPdfRenderer');
  });

  it('does not mutate the decision it renders', () => {
    const decision = pilotDecision();
    const snapshot = JSON.parse(JSON.stringify(decision));
    renderAcquisitionDecision(payloadWith(decision), '08');
    expect(decision).toEqual(snapshot);
  });

  it('writes nothing and reads no database', () => {
    const acquisitionSection = source().slice(source().indexOf('SLICE 3H'));
    expect(acquisitionSection).not.toMatch(/supabase|insert\(|upsert\(|update\(|company_profiles/);
  });

  it('produces one HTML string used by both HTML and PDF — no second transformation', () => {
    const pipeline = fs.readFileSync(
      path.join(process.cwd(), 'backend/services/export/canonicalReportPipeline.ts'), 'utf8',
    );
    // PDF renders the same canonical HTML; there is no separate acquisition transform.
    expect(pipeline).toContain('renderPdfFromHtml');
    expect(pipeline).not.toContain('renderAcquisitionDecision');
  });
});
