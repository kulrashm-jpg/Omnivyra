import { extractIntelligence } from '../../../lib/creator-templates/contentIntelligence';
import { classifyStrategy } from '../../../lib/creator-templates/communicationStrategy';
import { classifyAudienceJourney } from '../../../lib/creator-templates/audienceJourney';
import { extractMessageDocument } from '../../../lib/creator-templates/messageExtraction';
import { buildVisualMessagingPlan } from '../../../lib/creator-templates/visualMessagingPlan';
import { buildConversionStrategy } from '../../../lib/creator-templates/conversionStrategy';
import {
  buildAssetAssembly, packageAssetAssembly, assemblyToTemplateFields, projectAssembly,
  validateAssetAssembly, summarizeAssetAssembly, searchAssetAssembly, type AssetAssembly,
} from '../../../lib/creator-templates/assetAssembly';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';

const AT = '2026-06-26T00:00:00.000Z';
const CONTENT = [
  'Boost activation by 92%',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship faster. 3x retention.',
  '"It changed everything." — Jane Doe, CEO.',
  'Get started free today. Sign up now.',
].join('\n');

function assemblyFor(content: string, family: 'image' | 'carousel' | 'infographic' = 'carousel'): AssetAssembly {
  const intel = extractIntelligence(content);
  const strategy = classifyStrategy(intel);
  const journey = classifyAudienceJourney(strategy, intel);
  const message = extractMessageDocument({ content, source: 'extraction', id: 'm' });
  const plan = buildVisualMessagingPlan({ intel, strategy, journey, message, assetFamily: family });
  const conversion = buildConversionStrategy({ intel, strategy, journey, message, plan, assetFamily: family });
  return buildAssetAssembly({ message, strategy, journey, plan, conversion, assetFamily: family });
}

describe('Asset Assembly — deterministic merge + ownership', () => {
  it('same inputs → byte-identical assembly', () => {
    expect(JSON.stringify(assemblyFor(CONTENT))).toBe(JSON.stringify(assemblyFor(CONTENT)));
  });

  it('every field has one authoritative owner', () => {
    const a = assemblyFor(CONTENT);
    expect(a.message.mainMessage).toBe('Boost activation by 92%');                 // Message Foundation
    expect(a.communication.communicationGoal).toBeTruthy();                        // Communication Strategy
    expect(a.journey.awarenessStage).toBeTruthy();                                 // Audience Journey
    expect(a.storyBlueprint.narrativeFlow.length).toBeGreaterThan(0);              // Story Blueprint
    expect(a.conversion.goal).toBeTruthy();                                        // Conversion Strategy
    expect(a.visualMessaging.unitCount).toBe(a.assets.length);                     // Visual Messaging Plan
    // CTA ownership = Conversion; headline ownership = Visual Plan.
    const cta = a.assets.find((u) => u.hierarchy === 'CTA');
    if (cta) expect(cta.cta).toBeTruthy();
  });

  it('every visual unit is represented', () => {
    const a = assemblyFor(CONTENT, 'carousel');
    expect(a.slides.length).toBeGreaterThan(0);
    expect(a.sections.length).toBe(0);
    expect(a.assets.length).toBe(a.slides.length);
    const ig = assemblyFor(CONTENT, 'infographic');
    expect(ig.sections.length).toBeGreaterThan(0);
    expect(ig.slides.length).toBe(0);
  });

  it('contains NO rendering data (no colors/fonts/coords/pixels/template ids)', () => {
    const blob = JSON.stringify(assemblyFor(CONTENT)).toLowerCase();
    for (const f of ['#', 'rgb', 'hex', 'px', 'font', 'pixel', 'coordinate', 'template_id', 'templateid', 'color']) {
      expect(blob.includes(f)).toBe(false);
    }
  });
});

describe('Asset Assembly — projections, template bridge, validation', () => {
  it('family projections are deterministic', () => {
    const a = assemblyFor(CONTENT, 'carousel');
    expect(projectAssembly(a, 'carousel').units.length).toBe(a.assets.length);
    expect(projectAssembly(a, 'thread').units.length).toBe(a.assets.length);
    const img = projectAssembly(a, 'post');
    expect(img.primary).toBeTruthy();
    expect(JSON.stringify(projectAssembly(a, 'newsletterImage'))).toBe(JSON.stringify(projectAssembly(a, 'newsletterImage')));
  });

  it('template bridge yields ONE input per family', () => {
    const carousel = assemblyToTemplateFields(assemblyFor(CONTENT, 'carousel'));
    expect(Array.isArray((carousel as any).slides)).toBe(true);
    expect((carousel as any).cta_intensity).toBeTruthy();
    const image = assemblyToTemplateFields(assemblyFor(CONTENT, 'image'));
    expect((image as any).headline).toBeTruthy();
    const ig = assemblyToTemplateFields(assemblyFor(CONTENT, 'infographic'));
    expect(Array.isArray((ig as any).sections)).toBe(true);
  });

  it('validation passes for a well-formed assembly', () => {
    const v = validateAssetAssembly(assemblyFor(CONTENT));
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });
});

describe('Asset Assembly — search, summary, package bridge', () => {
  it('search is deterministic (cta / hero / statistics / evidence / headlines / journey / conversion / quote)', () => {
    const a = assemblyFor(CONTENT);
    expect((searchAssetAssembly(a, 'find cta') as any[]).every((u) => u.hierarchy === 'CTA' || u.cta)).toBe(true);
    expect(Array.isArray(searchAssetAssembly(a, 'find statistics'))).toBe(true);
    expect(Array.isArray(searchAssetAssembly(a, 'find headlines'))).toBe(true);
    expect(searchAssetAssembly(a, 'find conversion')).toEqual(a.conversion);
    expect(JSON.stringify(searchAssetAssembly(a, 'find evidence'))).toBe(JSON.stringify(searchAssetAssembly(a, 'find evidence')));
  });

  it('summary returns the cross-layer contract', () => {
    const s = summarizeAssetAssembly(assemblyFor(CONTENT));
    expect(s.message).toBe('Boost activation by 92%');
    expect(s.story).toBeTruthy();
    expect(s.conversion).toBeTruthy();
    expect(s.completeness).toBeGreaterThan(0);
  });

  it('package bridge reruns identically whenever the package changes', () => {
    let p = createPackage('pkg-a');
    p = addIntakeSource(p, fromExistingContent(CONTENT), { id: 's1', createdAt: AT });
    const a = packageAssetAssembly(p, 'carousel');
    const b = packageAssetAssembly(p, 'carousel');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.assets.length).toBeGreaterThan(0);
    expect(validateAssetAssembly(a).ok).toBe(true);
  });
});
