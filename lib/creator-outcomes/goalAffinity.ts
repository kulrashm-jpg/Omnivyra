/**
 * Goal → visual-category affinity (CREATOR-125). Leaf module (no imports) so it
 * can be the ONE home of the goal-affinity mapping shared by the curated gallery
 * provider without creating a cycle through the materializer.
 *
 * The mapping mirrors `marketingSample`'s `GOAL_SAMPLE_CATEGORIES` exactly so the
 * gallery's goal filtering stays byte-identical. (`marketingSample` keeps its own
 * copy this phase — it is downstream/other-consumer code and is intentionally
 * untouched; the two converge to one home when marketingSample is retired.)
 */

const GOAL_SAMPLE_CATEGORIES: Record<string, string[]> = {
  'generate-leads': ['marketing', 'modern'],
  'promote-offer': ['marketing', 'photography'],
  'launch-product': ['photography', 'marketing', '3d'],
  'educate-audience': ['illustration', 'ui'],
  'explain-process': ['ui', 'illustration'],
  'present-framework': ['ui', 'modern'],
  'answer-faqs': ['ui', 'illustration'],
  'industry-insight': ['photography', 'modern'],
  'highlight-statistic': ['ui', 'modern'],
  'compare-options': ['ui', 'modern'],
  'customer-success': ['photography', 'modern'],
  'announce-news': ['modern', 'marketing'],
  'company-update': ['modern', 'marketing'],
  'promote-event': ['marketing', 'photography'],
  'brand-awareness': ['photography', 'illustration', 'modern'],
};

/** Visual categories affined to a goal (empty when the goal has no mapping). */
export function goalCategoriesFor(goalId: string | null | undefined): string[] {
  return goalId ? (GOAL_SAMPLE_CATEGORIES[goalId] ?? []) : [];
}
