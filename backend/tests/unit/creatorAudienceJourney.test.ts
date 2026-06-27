import { extractIntelligence } from '../../../lib/creator-templates/contentIntelligence';
import { classifyStrategy } from '../../../lib/creator-templates/communicationStrategy';
import {
  classifyAudienceJourney, listJourneys, resolveJourney, searchJourneys,
  summarizeAudienceJourney, journeyArchitectureHints,
} from '../../../lib/creator-templates/audienceJourney';
import { createPackage, addIntakeSource, packageAudienceJourney } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';

const journeyOf = (t: string) => { const intel = extractIntelligence(t); return classifyAudienceJourney(classifyStrategy(intel), intel); };

const EVAL = 'Acme vs others.\n92% faster activation. 3x retention compared to the alternative.\n"It changed everything." — Jane Doe, CEO. How Acme scaled onboarding.';
const DECISION = 'Pricing that scales.\nPlans start at $49/month. $199/month for teams.\nGet started free today. Sign up now.';
const PROBLEM = 'Teams struggle with slow manual onboarding that wastes time and frustrates new hires every single week.';
const CUSTOMER = 'Onboarding help.\nHow do I set this up?\nWhat if I get stuck?\nStep 1: connect. Step 2: configure. Step 3: invite your team.';
const HIRING = "We're hiring! Join our growing team. We're hiring engineers and designers. Apply to join our team. We're hiring now.";
const DEVELOPER = 'API integration guide.\nStep 1: install the SDK. Step 2: configure the endpoint. Step 3: deploy. The developer schema is documented.';

describe('Audience Journey — deterministic classification', () => {
  it('Evaluation: statistics + proof + comparison', () => {
    const j = journeyOf(EVAL).selectedJourney;
    expect(j.id).toBe('evaluation');
    expect(j.awarenessStage).toBe('Evaluation');
    expect(j.decisionStage).toBe('Compare');
    expect(j.trustLevel).toBe('High');
    expect(j.ctaIntensity).toBe('Strong');
    expect(j.requiredEvidence).toEqual(expect.arrayContaining(['Statistics', 'Comparison']));
  });
  it('Decision: pricing + CTA', () => {
    const j = journeyOf(DECISION).selectedJourney;
    expect(j.id).toBe('decision');
    expect(j.decisionStage).toBe('Purchase');
    expect(j.buyingIntent).toBe('High');
    expect(j.ctaIntensity).toBe('Strong');
  });
  it('Problem Aware: pains, no buying signals', () => {
    const j = journeyOf(PROBLEM).selectedJourney;
    expect(j.id).toBe('problem-aware');
    expect(j.awarenessStage).toBe('Problem Aware');
    expect(j.ctaIntensity).toBe('Soft');
  });
  it('Customer: FAQs + implementation steps', () => {
    const j = journeyOf(CUSTOMER).selectedJourney;
    expect(j.id).toBe('customer');
    expect(j.decisionStage).toBe('Implement');
    expect(j.knowledgeLevel).toBe('Intermediate');
  });
  it('Candidate: hiring strategy', () => {
    expect(journeyOf(HIRING).selectedJourney.id).toBe('candidate');
  });
  it('Developer: technical process', () => {
    const j = journeyOf(DEVELOPER).selectedJourney;
    expect(j.id).toBe('developer');
    expect(j.buyerType).toBe('Developer');
    expect(j.knowledgeLevel).toBe('Expert');
  });

  it('same input → byte-identical output (no AI, no randomness)', () => {
    expect(JSON.stringify(journeyOf(EVAL))).toBe(JSON.stringify(journeyOf(EVAL)));
  });
  it('candidates are stably ordered (score DESC, id ASC)', () => {
    const c = journeyOf(EVAL).candidateJourneys;
    for (let i = 1; i < c.length; i++) {
      const p = c[i - 1]!, q = c[i]!;
      expect(p.score > q.score || (p.score === q.score && p.journey.id <= q.journey.id)).toBe(true);
    }
  });
  it('signal-less content classifies as Unaware deterministically', () => {
    const r = classifyAudienceJourney(classifyStrategy(extractIntelligence('lorem ipsum')), extractIntelligence('lorem ipsum'));
    expect(r.selectedJourney.id).toBe('unaware');
    expect(r.selectedJourney.awarenessStage).toBe('Unaware');
  });
  it('exposes content order + blueprints + reasons; no rule leak', () => {
    const j = journeyOf(EVAL).selectedJourney;
    expect(j.recommendedContentOrder.length).toBeGreaterThan(0);
    expect(j.recommendedBlueprints).toContain('comparison');
    expect(j.decisionReasons.length).toBeGreaterThan(0);
    expect((j as Record<string, unknown>).rules).toBeUndefined();
  });
});

describe('Audience Journey — catalog, search, summary, bridge', () => {
  it('lists journeys covering awareness/decision stages; resolvable', () => {
    const all = listJourneys();
    expect(all.length).toBeGreaterThanOrEqual(12);
    expect(new Set(all.map((j) => j.awarenessStage)).size).toBeGreaterThanOrEqual(5);
    expect(resolveJourney('decision')?.decisionStage).toBe('Purchase');
    expect(resolveJourney('nope')).toBeNull();
  });
  it('search is deterministic + side-effect free', () => {
    const a = searchJourneys('executive'); const b = searchJourneys('executive');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
  });
  it('summary is human-readable + deterministic', () => {
    const s = summarizeAudienceJourney(journeyOf(EVAL));
    expect(s.journey).toBe('Evaluation');
    expect(s.recommendedBlueprint).toBe('comparison');
    expect(s.evidenceNeeded.length).toBeGreaterThan(0);
    expect(s.recommendedContentOrder.length).toBeGreaterThan(0);
  });
  it('architecture hints expose stage/evidence/order/CTA without sequencing', () => {
    const h = journeyArchitectureHints(journeyOf(DECISION));
    expect(h.decisionStage).toBe('Purchase');
    expect(h.ctaIntensity).toBe('Strong');
    expect(h.requiredEvidence).toContain('Pricing');
    expect(h.primaryQuestions.length).toBeGreaterThan(0);
  });
  it('package bridge: Package → Intelligence → Strategy → Journey (identical re-run)', () => {
    let p = createPackage('pkg-j');
    p = addIntakeSource(p, fromExistingContent(DECISION), { id: 's1', createdAt: '2026-06-26T00:00:00.000Z' });
    const r = packageAudienceJourney(p);
    expect(r.selectedJourney.id).toBe('decision');
    expect(JSON.stringify(packageAudienceJourney(p))).toBe(JSON.stringify(r));
  });
});
