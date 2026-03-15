/**
 * Simulation: recommendation polish + card content flow.
 * Run: npx ts-node scripts/simulate-recommendation-polish.ts
 */
import { polishRecommendations } from '../backend/services/recommendationPolishService';
import type { CompanyProfile } from '../backend/services/companyProfileService';

// Sample recommendations (as from engine)
const sampleRecs = [
  { topic: 'stress from career uncertainty', volume: 100, source: 'NewsAPI' },
  { topic: 'Career Guidance', volume: 80, source: 'YouTube' },
  { topic: 'AI technology', volume: 90, source: 'SerpAPI' },
];

// Minimal profile with authority domains (triggers Authority Opportunity for overlap)
const profile: CompanyProfile = {
  id: 'test',
  company_id: 'test-co',
  name: 'Test Co',
  core_problem_statement: 'Individuals feel stuck, anxious, and unable to make confident decisions.',
  desired_transformation: 'Helping Individuals seeking clarity, Professionals, Students.',
  authority_domains: ['career', 'guidance', 'clarity'],
  brand_voice: 'professional',
  website_url: null,
  created_at: '',
  updated_at: '',
} as CompanyProfile;

console.log('=== 1. POLISH RECOMMENDATIONS (capitalization check) ===\n');
const polished = polishRecommendations(sampleRecs, profile, null);
polished.forEach((p, i) => {
  console.log(`Rec ${i + 1}: topic="${sampleRecs[i].topic}"`);
  console.log(`       polished_title="${p.polished_title}"`);
  console.log(`       (stress→Stress? ${p.polished_title.includes('Stress') ? 'YES' : 'NO'})\n`);
});

console.log('=== 2. CARD CONTENT SOURCE (problem/transformation) ===\n');
// Simulate what RecommendationBlueprintCard receives
const mockRecommendations = polished.map((p) => ({
  ...p,
  intelligence: {
    problem_being_solved: profile.core_problem_statement,
    expected_transformation: profile.desired_transformation,
  },
  company_context_snapshot: {
    core_problem_statement: profile.core_problem_statement,
    desired_transformation: profile.desired_transformation,
  },
}));

console.log('Profile (shared):');
console.log('  core_problem_statement:', profile.core_problem_statement);
console.log('  desired_transformation:', profile.desired_transformation);
console.log('\nPer-card intelligence (from company_context_snapshot):');
mockRecommendations.forEach((r, i) => {
  console.log(`  Card ${i + 1} (${r.polished_title}):`);
  console.log('    problem_being_solved:', (r.intelligence as any).problem_being_solved);
  console.log('    expected_transformation:', (r.intelligence as any).expected_transformation);
  console.log('    → Same as profile? YES (shared snapshot)\n');
});

console.log('=== 3. TRANSFORMATION LINE (what card displays) ===\n');
function getTransformationSummary(problem: string | null, transformation: string | null): string {
  const truncate = (s: string) => (s.length <= 80 ? s : s.slice(0, 80).trim() + '…');
  if (problem && transformation) {
    return `Designed to move your audience from ${truncate(problem)} → ${truncate(transformation)}`;
  }
  return 'Designed to create clear audience progress and momentum.';
}

mockRecommendations.forEach((r, i) => {
  const intel = r.intelligence as any;
  const line = getTransformationSummary(intel.problem_being_solved, intel.expected_transformation);
  console.log(`Card ${i + 1}: ${line.substring(0, 100)}...`);
});
console.log('\n→ All cards get IDENTICAL transformation line (same profile problem/transformation)\n');
