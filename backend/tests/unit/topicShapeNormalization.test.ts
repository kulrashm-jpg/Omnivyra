/**
 * PHASE TITLE-B — Topic shape normalization (single authority:
 * refineCampaignTopicForHeadlines). Verifies every topic shape interpolates
 * cleanly into the strategic-card + weekly-arc templates: 0 broken titles, no
 * double-interrogatives, no malformed noun-slot titles, and byte-identity for
 * noun + gerund topics.
 */

import { refineCampaignTopicForHeadlines } from '@/backend/services/editorialTextRefinementService';
import {
  generateThemeFromTopic,
  generateThemeAngleForProgression,
  PROGRESSION_ANGLE_TEMPLATES,
} from '@/backend/services/themeAngleEngine';

/** Every strategic-card (6 angle seeds) + weekly-arc title for a topic. */
function allTitlesFor(topic: string): string[] {
  const out: string[] = [];
  for (let s = 0; s < 6; s++) out.push(generateThemeFromTopic(topic, undefined, s));
  for (const stage of Object.keys(PROGRESSION_ANGLE_TEMPLATES)) {
    out.push(generateThemeAngleForProgression(topic, stage, 0));
  }
  return out;
}

const ACTION_VERBS =
  'Unify|Build|Scale|Get|Reduce|Win|Cut|Fix|Save|Grow|Drive|Create|Boost|Lower|Raise|Retain|Close|Increase|Attract|Reach|Double|Optimize|Automate|Launch';
const hasDoubleInterrogative = (t: string) => /\b(Why|How|What|When|Where|Who)\s+(Why|How|What)\b/i.test(t);
const hasMalformedNounSlot = (t: string) =>
  new RegExp(`\\b(of|to|about|Ignoring|Approach)\\s+(Why|How|What|When|Where)\\b`, 'i').test(t) ||
  new RegExp(`\\bStop Doing (${ACTION_VERBS})\\b`, 'i').test(t) ||
  new RegExp(`\\bThe (${ACTION_VERBS})\\b[\\w ]*\\b(Problem|Myth)\\b`).test(t);
const isBroken = (t: string) => hasDoubleInterrogative(t) || hasMalformedNounSlot(t);

const SHAPES = {
  noun: ['Email Marketing', 'Lead Generation', 'Content Strategy', 'Brand Awareness', 'Customer Retention'],
  gerund: ['Scaling Marketing Operations', 'Building Better Campaigns', 'Improving Customer Retention'],
  imperative: ['Unify and Optimize with AI', 'Build Better Campaigns', 'Scale Your Marketing Team', 'Get More Leads', 'Reduce Customer Churn'],
  question: ['Why Retention Fails', 'How Teams Lose Momentum', 'What Customers Really Want', 'Why Campaigns Underperform', 'How Brands Lose Trust'],
  fragment: ['Teams Struggling with Attribution', 'Losing Audience Trust', 'Customer Retention Challenges'],
};

describe('TITLE-B — byte-identity protection', () => {
  test.each(SHAPES.noun)('noun topic unchanged: %s', (topic) => {
    expect(refineCampaignTopicForHeadlines(topic)).toBe(topic);
  });
  test.each(SHAPES.gerund)('gerund topic unchanged: %s', (topic) => {
    expect(refineCampaignTopicForHeadlines(topic)).toBe(topic);
  });
});

describe('TITLE-B — imperative → gerund normalization', () => {
  const cases: Array<[string, string]> = [
    ['Unify and Optimize with AI', 'Unifying and Optimizing with AI'],
    ['Get More Leads', 'Getting More Leads'],
    ['Reduce Customer Churn', 'Reducing Customer Churn'],
    ['Build Better Campaigns', 'Building Better Campaigns'],
    ['Scale Your Marketing Team', 'Scaling Your Marketing Team'],
  ];
  test.each(cases)('%s → %s', (input, expected) => {
    expect(refineCampaignTopicForHeadlines(input)).toBe(expected);
  });
});

describe('TITLE-D — question nounification (exact)', () => {
  const cases: Array<[string, string]> = [
    ['Why Retention Fails', 'Retention Failure'],
    ['How Teams Lose Momentum', 'Team Momentum Loss'],
    ['What Customers Really Want', 'Customer Demand'], // TITLE-H: want→demand
    ['Why Campaigns Underperform', 'Campaign Underperformance'],
    ['How Brands Lose Trust', 'Brand Trust Erosion'],
  ];
  test.each(cases)('%s → %s', (input, expected) => {
    const out = refineCampaignTopicForHeadlines(input);
    expect(out).toBe(expected); // nounified exact match
    expect(/^(Why|How|What|When|Where|Who)\b/i.test(out)).toBe(false); // no surviving interrogative
  });

  // TITLE-F — expanded predicate coverage (all 20 nounify; no verb-clause leaks).
  const titleF: Array<[string, string]> = [
    ['How Brands Adapt', 'Brand Adaptation'],
    ['How Markets Recover', 'Market Recovery'],
    ['Why Visitors Convert', 'Visitor Conversion'],
    ['How Customers Engage', 'Customer Engagement'],
    ['How Startups Acquire', 'Startup Acquisition'],
    ['How Brands Differentiate', 'Brand Differentiation'],
    ['How Startups Compete', 'Startup Competition'],
    ['How Teams Automate', 'Team Automation'],
    ['How Brands Expand', 'Brand Expansion'],
    ['How Businesses Transform', 'Business Transformation'],
    ['What Replaces Cookies', 'Cookie Replacement'],
    ['How Brands Personalize', 'Brand Personalization'],
  ];
  test.each(titleF)('TITLE-F %s → %s', (input, expected) => {
    expect(refineCampaignTopicForHeadlines(input)).toBe(expected);
  });

  // TITLE-H — singularization integrity (-ies → y, with -ie+s exceptions).
  const singCases: Array<[string, string]> = [
    ['Why Companies Fail', 'Company Failure'],
    ['Why Agencies Fail', 'Agency Failure'],
    ['Why Industries Fail', 'Industry Failure'],
    ['Why Communities Fail', 'Community Failure'],
    ['Why Technologies Fail', 'Technology Failure'],
    ['Why Strategies Fail', 'Strategy Failure'],
    ['Why Capabilities Fail', 'Capability Failure'],
    ['Why Businesses Fail', 'Business Failure'],
    ['Why Processes Fail', 'Process Failure'],
    ['What Replaces Cookies', 'Cookie Replacement'], // -ie+s exception preserved
  ];
  test.each(singCases)('TITLE-H singularization %s → %s', (input, expected) => {
    expect(refineCampaignTopicForHeadlines(input)).toBe(expected);
  });

  test('TITLE-H mapping revisions (want→demand, win→victory) — singular, collision-free', () => {
    expect(refineCampaignTopicForHeadlines('What Customers Really Want')).toBe('Customer Demand');
    expect(refineCampaignTopicForHeadlines('How Teams Win')).toBe('Team Victory');
  });

  test('TITLE-H2 agreement-fix mappings (struggle→friction, miss→shortfall) — singular', () => {
    expect(refineCampaignTopicForHeadlines('Why Companies Struggle')).toBe('Company Friction');
    expect(refineCampaignTopicForHeadlines('Why Teams Miss Targets')).toBe('Team Targets Shortfall');
    // No "Struggles Is"/"Gaps Is" agreement error in any generated title.
    for (const top of ['Why Companies Struggle', 'Why Teams Struggle', 'Why Brands Struggle']) {
      for (const title of allTitlesFor(top)) {
        expect(/\b(Struggles|Gaps)\s+Is\b/.test(title)).toBe(false);
      }
    }
  });

  test('formerly-unrecognized predicates no longer leak a verb clause', () => {
    for (const q of ['How Markets Recover', 'How Startups Acquire', 'How Brands Differentiate', 'How Startups Compete', 'What Replaces Cookies']) {
      const out = refineCampaignTopicForHeadlines(q);
      expect(/\b(Recover|Acquire|Differentiate|Compete|Replaces?)\b/.test(out.split(' ').slice(1).join(' '))).toBe(false);
    }
  });

  test('fallback gerundization when the predicate has no noun mapping', () => {
    // "evolve" is a recognized predicate but not in the noun map → gerundized.
    expect(refineCampaignTopicForHeadlines('Why Markets Evolve')).toBe('Markets Evolving');
    expect(/^(Why|How|What)\b/i.test(refineCampaignTopicForHeadlines('Why Markets Evolve'))).toBe(false);
  });

  test('topic never disappears from generated titles (dedup-collision fixed)', () => {
    for (const [input] of cases) {
      const normalized = refineCampaignTopicForHeadlines(input);
      const head = normalized.split(' ').find((w) => w.length >= 5) ?? normalized.split(' ')[0];
      for (const title of allTitlesFor(input)) {
        expect(title.toLowerCase()).toContain(head.toLowerCase());
        expect(hasDoubleInterrogative(title)).toBe(false);
        expect(isBroken(title)).toBe(false);
      }
    }
  });
});

describe('TITLE-B — regression matrix: 0 broken across all templates', () => {
  for (const [shape, topics] of Object.entries(SHAPES)) {
    test(`${shape} topics produce no double-interrogative or malformed noun-slot titles`, () => {
      const broken: string[] = [];
      for (const topic of topics) {
        for (const title of allTitlesFor(topic)) {
          expect(hasDoubleInterrogative(title)).toBe(false);
          if (isBroken(title)) broken.push(`${topic} -> ${title}`);
        }
      }
      expect(broken).toEqual([]);
    });
  }
});

// TITLE-I — duplicate collision regression lock. The in-authority invariant:
// normalization NEVER self-duplicates and NEVER introduces a duplicate concept
// that wasn't already in the source topic. (Topic∩template overlaps — e.g.
// "Community Growth Strategy" + "…Unlocks New Growth" — are category C / out of
// authority and intentionally NOT asserted to zero.)
describe('TITLE-I — duplicate collision regression lock', () => {
  const adjDup = (t: string): string | null => t.match(/\b(\w{4,})\s+\1\b/i)?.[1] ?? null;
  const conceptDup = (t: string): string | null => {
    const seen = new Set<string>();
    for (const w of t.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter((x) => x.length >= 6)) {
      if (seen.has(w)) return w;
      seen.add(w);
    }
    return null;
  };
  // Includes the known topic∩template dup-prone inputs (Growth/Success).
  const CORPUS = [
    ...SHAPES.noun, ...SHAPES.gerund, ...SHAPES.imperative, ...SHAPES.fragment,
    'Why Companies Fail', 'How Markets Recover', 'Why Companies Struggle', 'Why Teams Miss Targets',
    'What Customers Really Want', 'How Teams Win', 'How Brands Lose Trust', 'How Teams Lose Momentum',
    'Community Growth Strategy', 'Scaling Customer Success', 'E-commerce Growth Strategy',
  ];

  test('normalization output never self-duplicates (adjacent or concept)', () => {
    for (const topic of CORPUS) {
      const n = refineCampaignTopicForHeadlines(topic);
      expect(adjDup(n)).toBeNull();      // no "Demand Demand"
      expect(conceptDup(n)).toBeNull();  // no "Retention Retention Failure"
    }
  });

  test('no adjacent duplicate words in ANY generated title', () => {
    for (const topic of CORPUS) {
      for (const title of allTitlesFor(topic)) {
        expect(adjDup(title)).toBeNull();
      }
    }
  });

  test('authority never INTRODUCES a duplicate concept absent from the source topic', () => {
    for (const topic of CORPUS) {
      for (const title of allTitlesFor(topic)) {
        const dup = conceptDup(title);
        // A duplicated concept is only allowed when the topic itself contains it
        // (category C — topic-source). The pipeline must never create a new one.
        if (dup) expect(topic.toLowerCase()).toContain(dup);
      }
    }
  });

  test('topic never disappears; collision handling preserves the subject', () => {
    for (const topic of CORPUS) {
      const n = refineCampaignTopicForHeadlines(topic);
      const head = n.split(' ').find((w) => w.length >= 5) ?? n.split(' ')[0];
      for (const title of allTitlesFor(topic)) {
        expect(title.toLowerCase()).toContain(head.toLowerCase());
      }
    }
  });

  test('nounified concept does not erase semantic meaning', () => {
    // The subject is retained alongside the nounified predicate (not collapsed).
    expect(refineCampaignTopicForHeadlines('Why Retention Fails')).toBe('Retention Failure');
    expect(refineCampaignTopicForHeadlines('How Brands Lose Trust')).toBe('Brand Trust Erosion');
    expect(refineCampaignTopicForHeadlines('Why Companies Struggle')).toBe('Company Friction');
  });
});
