import { extractIntelligence } from '../../../lib/creator-templates/contentIntelligence';
import { classifyStrategy } from '../../../lib/creator-templates/communicationStrategy';
import { classifyAudienceJourney } from '../../../lib/creator-templates/audienceJourney';
import { extractMessageDocument } from '../../../lib/creator-templates/messageExtraction';
import {
  buildVisualMessagingPlan, packageVisualMessagingPlan, planToTemplateFields,
  searchVisualMessagingPlan, summarizeVisualMessagingPlan, type VisualMessagingPlan,
} from '../../../lib/creator-templates/visualMessagingPlan';
import { STORY_BLUEPRINTS } from '../../../lib/creator-templates/storyBlueprint';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';

const AT = '2026-06-26T00:00:00.000Z';
const CONTENT = [
  'Boost activation by 92%',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship faster. 3x retention.',
  '"It changed everything." — Jane Doe, CEO.',
  'Get started free today.',
].join('\n');

function planFor(content: string, family: 'image' | 'carousel' | 'infographic', blueprintId?: any): VisualMessagingPlan {
  const intel = extractIntelligence(content);
  const strategy = classifyStrategy(intel);
  const journey = classifyAudienceJourney(strategy, intel);
  const message = extractMessageDocument({ content, source: 'extraction', id: 'm' });
  return buildVisualMessagingPlan({ intel, strategy, journey, message, assetFamily: family, blueprintId });
}

describe('Visual Messaging Plan — deterministic planning', () => {
  it('every Story Blueprint role becomes exactly one messaging unit', () => {
    const plan = planFor(CONTENT, 'carousel', 'problem-solution');
    const units = plan.slides;
    expect(units.length).toBe(STORY_BLUEPRINTS['problem-solution'].narrativeFlow.length);
    units.forEach((u, i) => expect(u.role).toBe(STORY_BLUEPRINTS['problem-solution'].narrativeFlow[i]));
  });

  it('same inputs → byte-identical plan (no AI, no randomness)', () => {
    expect(JSON.stringify(planFor(CONTENT, 'carousel', 'problem-solution'))).toBe(JSON.stringify(planFor(CONTENT, 'carousel', 'problem-solution')));
  });

  it('headline hierarchy is deterministic (Hero first for a Hook-led blueprint)', () => {
    const plan = planFor(CONTENT, 'carousel', 'educational'); // narrativeFlow starts with Hook
    expect(plan.slides[0]!.recommendedHierarchy).toBe('Hero');
    expect(plan.slides[0]!.headline).toBe('Boost activation by 92%');
    expect(plan.slides.some((u) => u.recommendedHierarchy === 'CTA')).toBe(true);
  });

  it('density / visual intent / layout / image recommendation are deterministic', () => {
    const plan = planFor(CONTENT, 'carousel', 'statistics');
    const stat = plan.slides.find((u) => u.recommendedVisual === 'Statistic Card');
    expect(stat).toBeTruthy();
    expect(stat!.statistic).toBeTruthy();
    expect(['Minimal', 'Balanced', 'Rich', 'Dense', 'Very Dense']).toContain(plan.slides[0]!.density);
    expect(plan.overallVisualIntent).toBeTruthy();
    // infographic forces a data-graphic treatment + populates sections (not slides)
    const ig = planFor(CONTENT, 'infographic', 'statistics');
    expect(ig.sections.length).toBeGreaterThan(0);
    expect(ig.slides.length).toBe(0);
    expect(ig.sections[0]!.recommendedImageTreatment).toBe('Data Graphic');
  });

  it('contains NO rendering data anywhere (no colors/fonts/coords/pixels/template ids)', () => {
    const blob = JSON.stringify(planFor(CONTENT, 'carousel', 'problem-solution')).toLowerCase();
    for (const forbidden of ['#', 'rgb', 'hex', 'px', 'font', 'pixel', 'x:', 'y:', 'coordinate', 'template_id', 'templateid', 'fontsize', 'color']) {
      expect(blob.includes(forbidden)).toBe(false);
    }
  });
});

describe('Visual Messaging Plan — bridge, search, summary', () => {
  it('template consumption bridge maps to each family without touching templates', () => {
    const carousel = planToTemplateFields(planFor(CONTENT, 'carousel', 'problem-solution'));
    expect(Array.isArray((carousel as any).slides)).toBe(true);
    expect((carousel as any).slides[0].slide_number).toBe(1);
    const image = planToTemplateFields(planFor(CONTENT, 'image', 'problem-solution'));
    expect((image as any).headline).toBeTruthy();
    const ig = planToTemplateFields(planFor(CONTENT, 'infographic', 'statistics'));
    expect(Array.isArray((ig as any).sections)).toBe(true);
  });

  it('search is deterministic (find statistics / cta / hero / evidence)', () => {
    const plan = planFor(CONTENT, 'carousel', 'problem-solution');
    expect(searchVisualMessagingPlan(plan, 'find all statistics').every((u) => u.statistic || u.recommendedVisual === 'Statistic Card')).toBe(true);
    expect(searchVisualMessagingPlan(plan, 'find cta').every((u) => u.recommendedHierarchy === 'CTA' || u.cta)).toBe(true);
    expect(searchVisualMessagingPlan(planFor(CONTENT, 'carousel', 'educational'), 'find hero')[0]?.recommendedHierarchy).toBe('Hero');
    expect(JSON.stringify(searchVisualMessagingPlan(plan, 'find evidence'))).toBe(JSON.stringify(searchVisualMessagingPlan(plan, 'find evidence')));
  });

  it('summary returns purposes / headline order / hierarchy / density', () => {
    const s = summarizeVisualMessagingPlan(planFor(CONTENT, 'carousel', 'problem-solution'));
    expect(s.overallMessage).toBe('Boost activation by 92%');
    expect(s.slidePurposes.length).toBeGreaterThan(0);
    expect(s.headlineOrder.length).toBe(s.hierarchy.length);
    expect(s.ctaCount).toBeGreaterThan(0);
  });

  it('package bridge re-runs identically whenever the package changes', () => {
    let p = createPackage('pkg-v');
    p = addIntakeSource(p, fromExistingContent(CONTENT), { id: 's1', createdAt: AT });
    const a = packageVisualMessagingPlan(p, 'carousel');
    const b = packageVisualMessagingPlan(p, 'carousel');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.slides.length).toBeGreaterThan(0);
    expect(a.storyBlueprint).toBeTruthy();
  });
});
