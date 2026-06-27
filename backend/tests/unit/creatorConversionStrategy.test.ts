import { extractIntelligence } from '../../../lib/creator-templates/contentIntelligence';
import { classifyStrategy } from '../../../lib/creator-templates/communicationStrategy';
import { classifyAudienceJourney } from '../../../lib/creator-templates/audienceJourney';
import { extractMessageDocument } from '../../../lib/creator-templates/messageExtraction';
import { buildVisualMessagingPlan } from '../../../lib/creator-templates/visualMessagingPlan';
import {
  buildConversionStrategy, packageConversionStrategy, conversionVisualHints,
  planToTemplateConversionFields, summarizeConversionStrategy, searchConversionStrategy,
  type ConversionStrategy,
} from '../../../lib/creator-templates/conversionStrategy';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';

const AT = '2026-06-26T00:00:00.000Z';
const convOf = (content: string, family: 'image' | 'carousel' | 'infographic' = 'carousel'): ConversionStrategy => {
  const intel = extractIntelligence(content);
  const strategy = classifyStrategy(intel);
  const journey = classifyAudienceJourney(strategy, intel);
  const message = extractMessageDocument({ content, source: 'extraction', id: 'm' });
  const plan = buildVisualMessagingPlan({ intel, strategy, journey, message, assetFamily: family });
  return buildConversionStrategy({ intel, strategy, journey, message, plan, assetFamily: family });
};

const PURCHASE = 'Pricing that scales.\nPlans start at $49/month. $199/month for teams.\nGet started free today. Sign up now.';
const LEADGEN = 'Teams struggle with slow onboarding.\nOur solution automates it so you can ship faster.\nGet the free guide. Learn more.';
const HIRING = "We're hiring! Join our growing team. We're hiring engineers. Apply to join our team. We're hiring now.";
const EVENT = 'Join our live webinar.\nRegister now to save your seat. Limited spots.';

describe('Conversion Strategy — deterministic classification', () => {
  it('classifies conversion goals from upstream signals', () => {
    expect(convOf(PURCHASE).conversionGoal).toBe('Purchase');
    expect(convOf(LEADGEN).conversionGoal).toBe('Lead Generation');
    expect(convOf(HIRING).conversionGoal).toBe('Hiring');
    expect(convOf(EVENT).conversionGoal).toBe('Event Registration');
  });

  it('same inputs → byte-identical strategy (no AI, no randomness)', () => {
    expect(JSON.stringify(convOf(PURCHASE))).toBe(JSON.stringify(convOf(PURCHASE)));
  });

  it('trust + proof + objections are deterministic', () => {
    const c = convOf(PURCHASE);
    expect(['None', 'Basic', 'Medium', 'High', 'Critical']).toContain(c.trustRequirement);
    expect(c.proofRequirement).toContain('Pricing');
    expect(c.likelyObjections).toEqual(expect.arrayContaining(['Price', 'Budget']));
    expect(['Low', 'Medium', 'High']).toContain(c.objectionLevel);
  });

  it('CTA intensity / placement / style are deterministic', () => {
    const c = convOf(EVENT);
    expect(['Soft', 'Medium', 'Strong', 'Urgent']).toContain(c.ctaIntensity);
    expect(['Opening', 'Middle', 'Closing', 'Repeated', 'Single']).toContain(c.ctaPlacement);
    expect(c.ctaStyle).toBe('Urgent'); // urgency cue ("limited", "now")
  });

  it('conversion sequence + required assets + channels are deterministic', () => {
    const c = convOf(PURCHASE);
    expect(c.conversionSequence.length).toBeGreaterThan(0);
    expect(c.conversionSequence[0]!.expectedAction).toBeTruthy();
    expect(c.requiredAssets).toEqual(expect.arrayContaining(['Pricing Page']));
    expect(c.recommendedChannels).toContain('Email');
    expect(c.recommendedChannels).toContain('Sales Call');
  });

  it('contains NO rendering data (no colors/fonts/coords/pixels/template ids)', () => {
    const blob = JSON.stringify(convOf(PURCHASE)).toLowerCase();
    for (const f of ['#', 'rgb', 'hex', 'px', 'font', 'pixel', 'coordinate', 'template_id', 'templateid', 'color']) {
      expect(blob.includes(f)).toBe(false);
    }
  });
});

describe('Conversion Strategy — bridges, search, summary, package bridge', () => {
  it('visual + template bridges expose conversion guidance only', () => {
    const c = convOf(PURCHASE);
    const vh = conversionVisualHints(c);
    expect(vh.ctaEmphasis).toBe(c.ctaIntensity);
    expect(vh.conversionOrder.length).toBeGreaterThan(0);
    const tf = planToTemplateConversionFields(c);
    expect((tf as any).cta_intensity).toBe(c.ctaIntensity);
    expect((tf as any).offer).toBe('Purchase');
    expect(Array.isArray((tf as any).proof)).toBe(true);
  });

  it('search is deterministic (cta / objections / trust / assets / proof / channels)', () => {
    const c = convOf(PURCHASE);
    expect((searchConversionStrategy(c, 'find cta') as any).intensity).toBe(c.ctaIntensity);
    expect(searchConversionStrategy(c, 'find objections')).toEqual(c.likelyObjections);
    expect(searchConversionStrategy(c, 'find required assets')).toEqual(c.requiredAssets);
    expect(searchConversionStrategy(c, 'find proof')).toEqual(c.proofRequirement);
    expect(JSON.stringify(searchConversionStrategy(c, 'find channels'))).toBe(JSON.stringify(searchConversionStrategy(c, 'find channels')));
  });

  it('summary returns the conversion contract', () => {
    const s = summarizeConversionStrategy(convOf(PURCHASE));
    expect(s.primaryConversion).toBe('Purchase');
    expect(s.cta.intensity).toBeTruthy();
    expect(s.requiredAssets.length).toBeGreaterThan(0);
    expect(s.channels.length).toBeGreaterThan(0);
    expect(s.confidence).toBeGreaterThan(0);
  });

  it('package bridge reruns identically whenever the package changes', () => {
    let p = createPackage('pkg-c');
    p = addIntakeSource(p, fromExistingContent(PURCHASE), { id: 's1', createdAt: AT });
    const a = packageConversionStrategy(p, 'carousel');
    const b = packageConversionStrategy(p, 'carousel');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.conversionGoal).toBe('Purchase');
  });
});
