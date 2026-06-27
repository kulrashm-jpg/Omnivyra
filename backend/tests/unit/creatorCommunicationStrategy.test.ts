import { extractIntelligence } from '../../../lib/creator-templates/contentIntelligence';
import {
  classifyStrategy, listStrategies, resolveStrategy, searchStrategies, summarizeStrategy,
  strategyArchitectureHints,
} from '../../../lib/creator-templates/communicationStrategy';
import { createPackage, addIntakeSource, packageCommunicationStrategy } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';

const classifyText = (t: string) => classifyStrategy(extractIntelligence(t));

const PROBLEM_SOLUTION = 'Teams struggle with slow manual onboarding that wastes time.\nOur solution automates it so you can ship faster.\nGet started free today.';
const STATS = 'Growth by the numbers.\n92% faster activation. 3x retention. 47% lower cost compared to the alternative.';
const CASE = 'How Acme scaled. Challenge: slow onboarding. Our approach automated it. Results: 92% faster. "It changed everything." — Jane Doe, CEO.';
const FAQ = 'Questions answered.\nHow do I start?\nWhat does it cost?\nCan I cancel anytime?';
const HIRING = "We're hiring! Join our growing team. We're hiring engineers and designers. Open roles across the team. Apply to join our team and help build the future. Careers at Acme — we're hiring now.";

describe('Communication Strategy — deterministic classification', () => {
  it('classifies Problem → Solution from pains + solutions + CTA', () => {
    expect(classifyText(PROBLEM_SOLUTION).selectedStrategy.id).toBe('problem-solution');
  });
  it('classifies Statistics Driven from high stats + comparison', () => {
    expect(classifyText(STATS).selectedStrategy.id).toBe('statistics-driven');
  });
  it('classifies Case Study from caseStudy signals', () => {
    expect(classifyText(CASE).selectedStrategy.id).toBe('case-study');
  });
  it('classifies FAQ from multiple questions', () => {
    expect(classifyText(FAQ).selectedStrategy.id).toBe('faq');
  });
  it('classifies Hiring from recruiting language', () => {
    expect(classifyText(HIRING).selectedStrategy.id).toBe('hiring');
  });

  it('same intelligence → byte-identical result (no AI, no randomness)', () => {
    const a = classifyText(STATS); const b = classifyText(STATS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('candidates are stably ordered (score DESC, id ASC)', () => {
    const c = classifyText(STATS).candidateStrategies;
    for (let i = 1; i < c.length; i++) {
      const prev = c[i - 1]!, cur = c[i]!;
      expect(prev.score > cur.score || (prev.score === cur.score && prev.strategy.id <= cur.strategy.id)).toBe(true);
    }
  });

  it('defaults to Educational deterministically when nothing scores', () => {
    const r = classifyStrategy(extractIntelligence('lorem ipsum dolor sit amet consectetur'));
    expect(r.selectedStrategy.id).toBe('educational');
    expect(r.confidence).toBeGreaterThanOrEqual(0);
  });

  it('exposes recommendations + decision log + confidence', () => {
    const r = classifyText(PROBLEM_SOLUTION);
    expect(r.selectedStrategy.recommendedBlueprints).toContain('problem-solution');
    expect(r.selectedStrategy.recommendedCampaignGoals.length).toBeGreaterThan(0);
    expect(r.selectedStrategy.recommendedPlatforms.length).toBeGreaterThan(0);
    expect(r.decisionLog.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.matchedSignals).toContain('painPoints+solutions');
    // no rule machinery leaks into the public model
    expect((r.selectedStrategy as Record<string, unknown>).rules).toBeUndefined();
  });
});

describe('Communication Strategy — catalog, search, summary, bridge', () => {
  it('lists ≥ 34 strategies, resolvable by id', () => {
    expect(listStrategies().length).toBeGreaterThanOrEqual(34);
    expect(resolveStrategy('case-study')?.name).toBe('Case Study');
    expect(resolveStrategy('nope')).toBeNull();
  });

  it('search is deterministic and side-effect free', () => {
    const r1 = searchStrategies('authority'); const r2 = searchStrategies('authority');
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.length).toBeGreaterThan(0);
  });

  it('summary is human-readable + deterministic', () => {
    const s = summarizeStrategy(classifyText(CASE));
    expect(s.strategy).toBe('Case Study');
    expect(s.recommendedBlueprint).toBe('case-study');
    expect(s.recommendedCampaignGoals.length).toBeGreaterThan(0);
    expect(s.matchedEvidence.length).toBeGreaterThan(0);
  });

  it('architecture hints expose goal/intent/audience without sequencing', () => {
    const h = strategyArchitectureHints(classifyText(STATS));
    expect(h.communicationGoal).toBe('authority');
    expect(h.communicationIntent).toBe('inform');
    expect(h.recommendedBlueprints).toContain('statistics');
  });

  it('package bridge: ContentPackage → Intelligence → Strategy', () => {
    let p = createPackage('pkg-s');
    p = addIntakeSource(p, fromExistingContent(PROBLEM_SOLUTION), { id: 's1', createdAt: '2026-06-26T00:00:00.000Z' });
    const r = packageCommunicationStrategy(p);
    expect(r.selectedStrategy.id).toBe('problem-solution');
    // re-running over the same package is identical
    expect(JSON.stringify(packageCommunicationStrategy(p))).toBe(JSON.stringify(r));
  });
});
