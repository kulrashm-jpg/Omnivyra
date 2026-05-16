/**
 * Phase 4 — Opportunity classification.
 *
 * Deterministic, explainable, no AI calls. Given a signal's content + base
 * scores, returns:
 *   - the opportunity_type (one of 8 enum values, including a fallback
 *     'generic_interest' when no specific signal pattern matches),
 *   - the matched keywords that drove the classification,
 *   - a structured score breakdown so the UI explanation layer can show
 *     exactly why each component score landed where it did.
 *
 * If multiple patterns match, we pick the highest-priority match (buying
 * intent and migration > research > integration > hiring > support >
 * generic). This keeps the surfacing UI from over-classifying the same
 * signal under conflicting types.
 */

import type { OpportunityType } from '../types/opportunityFeed';

type PatternGroup = {
  type: OpportunityType;
  priority: number;
  patterns: RegExp[];
  type_multiplier: number;
};

const PATTERN_GROUPS: PatternGroup[] = [
  // 1. Buying intent — explicit "want to buy / looking for"
  {
    type: 'buying_intent',
    priority: 100,
    type_multiplier: 1.0,
    patterns: [
      /\b(looking for|need a|need an|need recommendations?|recommend a|any (good|great) [a-z]+|what('?| i)s the best)\b/i,
      /\b(in the market for|shopping for|evaluat(ing|ed) [a-z]+)\b/i,
      /\b(budget for|approved budget|signed off on|just got budget)\b/i,
    ],
  },

  // 2. Migration signal — actively switching off / onto
  {
    type: 'migration_signal',
    priority: 95,
    type_multiplier: 0.95,
    patterns: [
      /\b(migrating from|moving (off|away from|to)|switch(ed|ing) from|leaving [a-z]+ for)\b/i,
      /\b(replac(e|ing|ed) [a-z]+ with|swap(ped|ping) out)\b/i,
    ],
  },

  // 3. Competitor dissatisfaction — anti-brand language about a competitor
  {
    type: 'competitor_dissatisfaction',
    priority: 90,
    type_multiplier: 0.9,
    patterns: [
      /\b(hate (using )?[a-z]+|fed up with|frustrated (by|with) [a-z]+)\b/i,
      /\b([a-z]+ is (terrible|garbage|awful|broken|slow|expensive))\b/i,
      /\balternatives? to\b/i,
    ],
  },

  // 4. Product research — explicit comparison / "differences between"
  {
    type: 'product_research',
    priority: 80,
    type_multiplier: 0.85,
    patterns: [
      /\b(comparing|compar(e|ing) [a-z]+ (vs|with|and|to))\b/i,
      /\b(differences? between|what('?| i)s the difference|pros and cons of)\b/i,
      /\b([a-z]+ vs\.? [a-z]+)\b/i,
    ],
  },

  // 5. Integration need — connect X to Y
  {
    type: 'integration_need',
    priority: 70,
    type_multiplier: 0.8,
    patterns: [
      /\b(integrat(e|ing|ion)|connect(ing|ed)? [a-z]+ (to|with))\b/i,
      /\b(api for|webhook for|sync(s|ing|ed)? (between|with))\b/i,
    ],
  },

  // 6. Hiring signal — "we're hiring" / "looking for a [role]"
  {
    type: 'hiring_signal',
    priority: 60,
    type_multiplier: 0.75,
    patterns: [
      /\b(we('?re| are) hiring|growing the team|looking for a (senior |staff |lead )?[a-z]+ (engineer|developer|designer|manager|director))\b/i,
      /\bopen (role|position|req)\b/i,
    ],
  },

  // 7. Support frustration — explicit support pain
  {
    type: 'support_frustration',
    priority: 50,
    type_multiplier: 0.7,
    patterns: [
      /\b(support (is|has been) (awful|terrible|broken|silent|missing))\b/i,
      /\b(no response from support|ticket (open|sitting) for|stuck in support hell)\b/i,
    ],
  },
];

export type OpportunityClassification = {
  opportunity_type: OpportunityType;
  type_multiplier: number;
  matched_keywords: string[];
  matched_patterns: string[];
};

export function classifyOpportunity(content: string): OpportunityClassification {
  let best: { group: PatternGroup; patterns: string[]; keywords: string[] } | null = null;

  for (const group of PATTERN_GROUPS) {
    const matchedPatterns: string[] = [];
    const matchedKeywords: string[] = [];
    for (const pattern of group.patterns) {
      const m = content.match(pattern);
      if (m) {
        matchedPatterns.push(pattern.source);
        matchedKeywords.push(m[0]);
      }
    }
    if (matchedPatterns.length === 0) continue;
    if (best == null || group.priority > best.group.priority) {
      best = { group, patterns: matchedPatterns, keywords: matchedKeywords };
    }
  }

  if (!best) {
    return {
      opportunity_type: 'generic_interest',
      type_multiplier: 0.5,
      matched_keywords: [],
      matched_patterns: [],
    };
  }

  return {
    opportunity_type: best.group.type,
    type_multiplier: best.group.type_multiplier,
    matched_keywords: [...new Set(best.keywords.map((k) => k.toLowerCase()))],
    matched_patterns: best.patterns,
  };
}
