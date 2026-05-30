/**
 * Active Leads — Opportunity Quality Audit (one-shot research artifact).
 *
 * Runs the deterministic regex-based `classifyOpportunity` over 50
 * synthetic lead-signal text fixtures with ground-truth labels.
 * Computes precision / recall / duplicate rate / noise rate, plus a
 * per-signal quality classification (High / Medium / Low / Noise).
 *
 * NOT a unit test. NOT a runtime test. Purpose: produce numbers that
 * answer "how good is opportunity classification today?".
 *
 * Usage:
 *   npx tsx scripts/audit-opportunity-quality.ts
 *
 * Output: per-signal table + cohort metrics + top causes. Stdout only.
 */

import { classifyOpportunity } from '../backend/services/opportunityClassifierService';
import type { OpportunityType } from '../backend/types/opportunityFeed';

type GroundTruth = OpportunityType | 'noise';
type QualityClass = 'high_value' | 'medium_value' | 'low_value' | 'noise';
type Category =
  | 'true_buying_intent'
  | 'true_migration'
  | 'true_competitor_pain'
  | 'true_product_research'
  | 'true_integration_need'
  | 'true_hiring_signal'
  | 'true_support_pain'
  | 'weak_signal'
  | 'adversarial_buying'
  | 'adversarial_migration'
  | 'adversarial_competitor'
  | 'adversarial_research'
  | 'adversarial_integration'
  | 'adversarial_hiring'
  | 'true_noise'
  | 'duplicate';

type Fixture = {
  id: string;
  category: Category;
  company_profile: string;
  content: string;
  /** What this signal IS, in human terms. null = not a real opportunity. */
  ground_truth: GroundTruth;
  /** Signals that intentionally express the same buyer intent as another fixture. */
  duplicate_of?: string;
};

// 50 fixtures across diverse company contexts and intent shapes.
const FIXTURES: Fixture[] = [
  // ---- True buying intent (10) ----
  { id: 'b01', category: 'true_buying_intent', company_profile: 'SaaS · CRM',
    content: "Looking for a CRM that doesn't suck. We're an outbound team of 8.",
    ground_truth: 'buying_intent' },
  { id: 'b02', category: 'true_buying_intent', company_profile: 'SaaS · marketing',
    content: "Need a marketing automation tool that does email + landing pages. Budget approved.",
    ground_truth: 'buying_intent' },
  { id: 'b03', category: 'true_buying_intent', company_profile: 'Services · accounting',
    content: "What's the best bookkeeping software for a 3-person firm?",
    ground_truth: 'buying_intent' },
  { id: 'b04', category: 'true_buying_intent', company_profile: 'Technology · auth',
    content: "Recommend a passwordless auth provider. We're evaluating Auth0 and Clerk.",
    ground_truth: 'buying_intent' },
  { id: 'b05', category: 'true_buying_intent', company_profile: 'B2B · procurement',
    content: "In the market for a procurement platform. Considering Coupa and Ariba.",
    ground_truth: 'buying_intent' },
  { id: 'b06', category: 'true_buying_intent', company_profile: 'SaaS · sales',
    content: "Just got budget for a sales engagement tool. Outreach vs Salesloft?",
    ground_truth: 'buying_intent' },
  { id: 'b07', category: 'true_buying_intent', company_profile: 'SaaS · analytics',
    content: "Shopping for product analytics. Amplitude is great but $$$. Alternatives?",
    ground_truth: 'buying_intent' },
  { id: 'b08', category: 'true_buying_intent', company_profile: 'Technology · LLM',
    content: "Any good vector DB recommendations for embedding search?",
    ground_truth: 'buying_intent' },
  { id: 'b09', category: 'true_buying_intent', company_profile: 'B2B · compliance',
    content: "Need recommendations for a SOC 2 automation platform. Vanta or Drata?",
    ground_truth: 'buying_intent' },
  { id: 'b10', category: 'true_buying_intent', company_profile: 'Services · agency',
    content: "Approved budget for project mgmt software for 40-person agency. Recommendations?",
    ground_truth: 'buying_intent' },

  // ---- True migration signals (6) ----
  { id: 'm01', category: 'true_migration', company_profile: 'SaaS · CRM',
    content: "Migrating from HubSpot to Pipedrive. Anyone done it cleanly?",
    ground_truth: 'migration_signal' },
  { id: 'm02', category: 'true_migration', company_profile: 'Technology · observability',
    content: "Moving off Datadog. Their pricing is insane. Open to suggestions.",
    ground_truth: 'migration_signal' },
  { id: 'm03', category: 'true_migration', company_profile: 'SaaS · email',
    content: "Switching from Mailchimp to a more transactional-friendly platform.",
    ground_truth: 'migration_signal' },
  { id: 'm04', category: 'true_migration', company_profile: 'Technology · ATS',
    content: "Leaving Greenhouse for a leaner ATS. Suggestions?",
    ground_truth: 'migration_signal' },
  { id: 'm05', category: 'true_migration', company_profile: 'B2B · finance',
    content: "Replacing QuickBooks with something API-first.",
    ground_truth: 'migration_signal' },
  { id: 'm06', category: 'true_migration', company_profile: 'SaaS · helpdesk',
    content: "Swapped out Zendesk for Intercom. Migration was painful.",
    ground_truth: 'migration_signal' },

  // ---- True competitor pain (5) ----
  { id: 'c01', category: 'true_competitor_pain', company_profile: 'SaaS · email',
    content: "Fed up with Mailchimp. Their automation builder is so slow.",
    ground_truth: 'competitor_dissatisfaction' },
  { id: 'c02', category: 'true_competitor_pain', company_profile: 'Technology · observability',
    content: "Datadog is expensive. Anyone using cheaper alternatives?",
    ground_truth: 'competitor_dissatisfaction' },
  { id: 'c03', category: 'true_competitor_pain', company_profile: 'SaaS · helpdesk',
    content: "Zendesk is broken — tickets disappearing for the last week.",
    ground_truth: 'competitor_dissatisfaction' },
  { id: 'c04', category: 'true_competitor_pain', company_profile: 'B2B · compliance',
    content: "Frustrated with Vanta — alerts not working properly.",
    ground_truth: 'competitor_dissatisfaction' },
  { id: 'c05', category: 'true_competitor_pain', company_profile: 'SaaS · CRM',
    content: "Alternatives to HubSpot? Their pricing tiers are absurd.",
    ground_truth: 'competitor_dissatisfaction' },

  // ---- True product research (5) ----
  { id: 'r01', category: 'true_product_research', company_profile: 'Technology · LLM',
    content: "Comparing Pinecone vs Weaviate vs Qdrant for production use.",
    ground_truth: 'product_research' },
  { id: 'r02', category: 'true_product_research', company_profile: 'SaaS · sales',
    content: "Differences between Outreach and Salesloft — anyone used both?",
    ground_truth: 'product_research' },
  { id: 'r03', category: 'true_product_research', company_profile: 'SaaS · CRM',
    content: "Pros and cons of Pipedrive vs HubSpot for SMB sales?",
    ground_truth: 'product_research' },
  { id: 'r04', category: 'true_product_research', company_profile: 'Technology · feature flags',
    content: "LaunchDarkly vs Split.io — anyone migrated between them?",
    ground_truth: 'product_research' },
  { id: 'r05', category: 'true_product_research', company_profile: 'Technology · CI/CD',
    content: "What's the difference between CircleCI and GitHub Actions for monorepos?",
    ground_truth: 'product_research' },

  // ---- True integration need (5) ----
  { id: 'i01', category: 'true_integration_need', company_profile: 'SaaS · CRM',
    content: "Need an API for integrating Slack with HubSpot deals.",
    ground_truth: 'integration_need' },
  { id: 'i02', category: 'true_integration_need', company_profile: 'Technology · auth',
    content: "Integrating Auth0 with our backend — webhook for user changes?",
    ground_truth: 'integration_need' },
  { id: 'i03', category: 'true_integration_need', company_profile: 'SaaS · analytics',
    content: "Connecting Mixpanel to Segment — anyone done this cleanly?",
    ground_truth: 'integration_need' },
  { id: 'i04', category: 'true_integration_need', company_profile: 'Technology · API',
    content: "Syncing between Stripe and QuickBooks — what's the cleanest path?",
    ground_truth: 'integration_need' },
  { id: 'i05', category: 'true_integration_need', company_profile: 'Services · ops',
    content: "Need to integrate Zapier into our procurement workflow.",
    ground_truth: 'integration_need' },

  // ---- True hiring (3) ----
  { id: 'h01', category: 'true_hiring_signal', company_profile: 'SaaS · marketing',
    content: "We're hiring a senior growth marketer in NYC. Open role.",
    ground_truth: 'hiring_signal' },
  { id: 'h02', category: 'true_hiring_signal', company_profile: 'Technology · LLM',
    content: "Growing the team — looking for a staff ML engineer.",
    ground_truth: 'hiring_signal' },
  { id: 'h03', category: 'true_hiring_signal', company_profile: 'B2B · procurement',
    content: "Open position for a procurement analyst. Apply via our careers page.",
    ground_truth: 'hiring_signal' },

  // ---- True support pain (2) ----
  { id: 's01', category: 'true_support_pain', company_profile: 'SaaS · helpdesk',
    content: "No response from support for 5 days. Ticket sitting for over a week.",
    ground_truth: 'support_frustration' },
  { id: 's02', category: 'true_support_pain', company_profile: 'B2B · compliance',
    content: "Vanta support has been silent. Stuck in support hell.",
    ground_truth: 'support_frustration' },

  // ---- Weak / vague signals (4) — classifiable but borderline ----
  { id: 'w01', category: 'weak_signal', company_profile: 'SaaS · generic',
    content: "Looking for a tool. Any suggestions?",
    ground_truth: 'buying_intent' },
  { id: 'w02', category: 'weak_signal', company_profile: 'SaaS · generic',
    content: "Comparing options for our stack.",
    ground_truth: 'product_research' },
  { id: 'w03', category: 'weak_signal', company_profile: 'B2B · generic',
    content: "Need recommendations.",
    ground_truth: 'buying_intent' },
  { id: 'w04', category: 'weak_signal', company_profile: 'Technology · generic',
    content: "Anything better out there?",
    ground_truth: 'noise' }, // too vague — engineers chatter

  // ---- Adversarial / false positives (8) ----
  { id: 'x01', category: 'adversarial_buying', company_profile: 'noise',
    content: "Looking for a workout buddy this weekend in Brooklyn.",
    ground_truth: 'noise' }, // FP candidate: "looking for"
  { id: 'x02', category: 'adversarial_buying', company_profile: 'noise',
    content: "Need a coffee before this meeting.",
    ground_truth: 'noise' }, // FP candidate: "need a"
  { id: 'x03', category: 'adversarial_migration', company_profile: 'noise',
    content: "Moving to Austin next month. Anyone else relocating?",
    ground_truth: 'noise' }, // FP candidate: "moving to"
  { id: 'x04', category: 'adversarial_migration', company_profile: 'noise',
    content: "Switching from coffee to tea for the new year.",
    ground_truth: 'noise' }, // FP candidate: "switching from"
  { id: 'x05', category: 'adversarial_competitor', company_profile: 'noise',
    content: "Mondays are terrible. Hate Mondays.",
    ground_truth: 'noise' }, // FP candidate: "is terrible" + "hate [verb]"
  { id: 'x06', category: 'adversarial_research', company_profile: 'noise',
    content: "Cats vs dogs — which is the better pet?",
    ground_truth: 'noise' }, // FP candidate: "vs" pattern
  { id: 'x07', category: 'adversarial_integration', company_profile: 'noise',
    content: "Just connecting the dots on this — interesting thread.",
    ground_truth: 'noise' }, // FP candidate: "connecting" pattern
  { id: 'x08', category: 'adversarial_hiring', company_profile: 'noise',
    content: "We're hiring a babysitter on Saturday nights.",
    ground_truth: 'noise' }, // FP candidate: "we're hiring"

  // ---- True noise (no buyer intent at all) (4) ----
  { id: 'n01', category: 'true_noise', company_profile: 'noise',
    content: "Just deployed our new feature. Production looks stable.",
    ground_truth: 'noise' },
  { id: 'n02', category: 'true_noise', company_profile: 'noise',
    content: "Beautiful sunset over the Hudson tonight.",
    ground_truth: 'noise' },
  { id: 'n03', category: 'true_noise', company_profile: 'noise',
    content: "Anyone going to KubeCon this year?",
    ground_truth: 'noise' },
  { id: 'n04', category: 'true_noise', company_profile: 'noise',
    content: "Congrats on the launch! Looks great.",
    ground_truth: 'noise' },

  // ---- Duplicates of true opportunities (2) ----
  { id: 'd01', category: 'duplicate', company_profile: 'SaaS · CRM',
    content: "Anyone got a CRM recommendation for an 8-person outbound team?",
    ground_truth: 'buying_intent', duplicate_of: 'b01' },
  { id: 'd02', category: 'duplicate', company_profile: 'SaaS · CRM',
    content: "Migrating from HubSpot to Pipedrive — tips?",
    ground_truth: 'migration_signal', duplicate_of: 'm01' },
];

// ---------------------------------------------------------------------------
// Classify + label
// ---------------------------------------------------------------------------

type Outcome = {
  fixture: Fixture;
  classifier_type: OpportunityType;
  classifier_keywords: string[];
  classifier_patterns: string[];
  type_multiplier: number;
  // Derived
  is_true_positive: boolean;
  is_false_positive: boolean;
  is_false_negative: boolean;
  is_correct_type: boolean;
  is_classified_as_opportunity: boolean;
  has_keyword_anchor: boolean;
  detected_reason_specific: boolean;
  quality: QualityClass;
};

function buildDetectedReasonSpecific(
  type: OpportunityType,
  matched_keywords: string[],
): boolean {
  // The detected_reason in opportunityFeedService includes keywords if
  // the classifier matched any. "Specific" = has at least one keyword
  // anchor surfaced to the user.
  return type !== 'generic_interest' && matched_keywords.length > 0;
}

function classifyQuality(
  fixture: Fixture,
  classifier_type: OpportunityType,
  keywords: string[],
): QualityClass {
  const isOpportunity = classifier_type !== 'generic_interest';
  const groundIsOpportunity = fixture.ground_truth !== 'noise';

  if (!isOpportunity && !groundIsOpportunity) return 'noise'; // correctly NOT classified
  if (isOpportunity && !groundIsOpportunity) return 'noise'; // FALSE POSITIVE
  if (!isOpportunity && groundIsOpportunity) return 'low_value'; // FALSE NEGATIVE
  // both real
  const correctType = classifier_type === fixture.ground_truth;
  if (!correctType) return 'low_value'; // misclassified type
  // correct type + real opportunity — distinguish high vs medium by keyword anchor
  if (keywords.length >= 2 && fixture.category.startsWith('true_')) return 'high_value';
  if (keywords.length >= 1) return 'medium_value';
  return 'low_value';
}

function classifyAll(): Outcome[] {
  return FIXTURES.map((fixture) => {
    const result = classifyOpportunity(fixture.content);
    const classified = result.opportunity_type !== 'generic_interest';
    const truth = fixture.ground_truth;
    const groundIsOpportunity = truth !== 'noise';
    return {
      fixture,
      classifier_type: result.opportunity_type,
      classifier_keywords: result.matched_keywords,
      classifier_patterns: result.matched_patterns,
      type_multiplier: result.type_multiplier,
      is_true_positive: classified && groundIsOpportunity,
      is_false_positive: classified && !groundIsOpportunity,
      is_false_negative: !classified && groundIsOpportunity,
      is_correct_type: classified && groundIsOpportunity && result.opportunity_type === truth,
      is_classified_as_opportunity: classified,
      has_keyword_anchor: result.matched_keywords.length > 0,
      detected_reason_specific: buildDetectedReasonSpecific(
        result.opportunity_type,
        result.matched_keywords,
      ),
      quality: classifyQuality(fixture, result.opportunity_type, result.matched_keywords),
    };
  });
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

function pct(num: number, den: number): string {
  return den === 0 ? '—' : `${((num / den) * 100).toFixed(1)}%`;
}

function main() {
  const outcomes = classifyAll();

  console.log('================================================================');
  console.log('Active Leads — Opportunity Quality Audit');
  console.log(`Fixtures: ${FIXTURES.length} synthetic lead signals`);
  console.log('================================================================\n');

  // Per-signal table
  console.log('--- Per-signal classification ---');
  console.log(
    'id   | category                | truth                       | classified                  | quality      | keywords'
  );
  console.log(
    '-----+-------------------------+-----------------------------+-----------------------------+--------------+--------------------'
  );
  for (const o of outcomes) {
    console.log(
      [
        o.fixture.id.padEnd(4),
        o.fixture.category.padEnd(23),
        String(o.fixture.ground_truth).padEnd(27),
        o.classifier_type.padEnd(27),
        o.quality.padEnd(12),
        o.classifier_keywords.slice(0, 3).join(', '),
      ].join(' | ')
    );
  }

  // Cohort metrics
  const total = outcomes.length;
  const trueOpportunities = outcomes.filter((o) => o.fixture.ground_truth !== 'noise');
  const classifiedAsOpp = outcomes.filter((o) => o.is_classified_as_opportunity);
  const truePositives = outcomes.filter((o) => o.is_true_positive);
  const correctTypes = outcomes.filter((o) => o.is_correct_type);
  const falsePositives = outcomes.filter((o) => o.is_false_positive);
  const falseNegatives = outcomes.filter((o) => o.is_false_negative);

  // Precision: of opportunities the classifier surfaced, how many are real?
  const precision = classifiedAsOpp.length === 0
    ? 0
    : correctTypes.length / classifiedAsOpp.length;
  // Recall: of real opportunities, how many did the classifier surface AND type correctly?
  const recall = trueOpportunities.length === 0
    ? 0
    : correctTypes.length / trueOpportunities.length;

  // Duplicate rate: explicitly tagged duplicates / total classified
  const dups = outcomes.filter((o) => o.fixture.duplicate_of && o.is_true_positive);
  const dupRate = classifiedAsOpp.length === 0 ? 0 : dups.length / classifiedAsOpp.length;

  // Noise rate: false positives + low-value classifications / total classified
  const noiseClassifications = outcomes.filter((o) => o.is_classified_as_opportunity && o.quality === 'noise');
  const noiseRate = classifiedAsOpp.length === 0 ? 0 : noiseClassifications.length / classifiedAsOpp.length;

  // Quality distribution
  const qualityCounts: Record<QualityClass, number> = {
    high_value: 0,
    medium_value: 0,
    low_value: 0,
    noise: 0,
  };
  for (const o of outcomes) qualityCounts[o.quality] += 1;

  console.log('\n--- Cohort metrics ---');
  console.log(`  Total fixtures:                                ${total}`);
  console.log(`  Real opportunities (ground truth):             ${trueOpportunities.length}`);
  console.log(`  Classified as opportunity (non-generic):       ${classifiedAsOpp.length}`);
  console.log(`  True positives (classified + real):            ${truePositives.length}`);
  console.log(`  Correct type (classified + correct type):      ${correctTypes.length}`);
  console.log(`  False positives (classified noise as opp):     ${falsePositives.length}`);
  console.log(`  False negatives (missed real opportunity):     ${falseNegatives.length}`);
  console.log('');
  console.log(`  Opportunity Precision:                         ${(precision * 100).toFixed(1)}%`);
  console.log(`  Opportunity Recall:                            ${(recall * 100).toFixed(1)}%`);
  console.log(`  Duplicate Rate (tagged):                       ${(dupRate * 100).toFixed(1)}%`);
  console.log(`  Noise Rate (FP / classified):                  ${(noiseRate * 100).toFixed(1)}%`);
  console.log('');
  console.log(`  Quality distribution:`);
  console.log(`    High Value:    ${qualityCounts.high_value}  (${pct(qualityCounts.high_value, total)})`);
  console.log(`    Medium Value:  ${qualityCounts.medium_value}  (${pct(qualityCounts.medium_value, total)})`);
  console.log(`    Low Value:     ${qualityCounts.low_value}  (${pct(qualityCounts.low_value, total)})`);
  console.log(`    Noise:         ${qualityCounts.noise}  (${pct(qualityCounts.noise, total)})`);

  // Composite Opportunity Quality Score
  // Weight: High×1.0 + Medium×0.5 + Low×0.2 + Noise×0
  const qualityScore =
    (qualityCounts.high_value * 1.0
      + qualityCounts.medium_value * 0.5
      + qualityCounts.low_value * 0.2
      + qualityCounts.noise * 0.0) / total;
  console.log(`\n  Opportunity Quality Score:                     ${(qualityScore * 10).toFixed(1)} / 10`);

  // Top causes of poor quality
  console.log('\n--- Top causes of poor opportunities ---');
  const lowOrNoise = outcomes.filter((o) => o.quality === 'low_value' || o.quality === 'noise');
  const causes: Record<string, number> = {};
  for (const o of lowOrNoise) {
    if (o.is_false_positive) {
      const key = `False positive (${o.fixture.category}) → classified as ${o.classifier_type}`;
      causes[key] = (causes[key] ?? 0) + 1;
    } else if (o.is_false_negative) {
      causes['False negative (vague signal not caught)'] = (causes['False negative (vague signal not caught)'] ?? 0) + 1;
    } else if (!o.is_correct_type) {
      const key = `Misclassified type: ground=${o.fixture.ground_truth} got=${o.classifier_type}`;
      causes[key] = (causes[key] ?? 0) + 1;
    } else if (o.classifier_keywords.length < 1) {
      causes['Classified but no keyword anchor → weak explanation'] = (causes['Classified but no keyword anchor → weak explanation'] ?? 0) + 1;
    }
  }
  const sortedCauses = Object.entries(causes).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sortedCauses) console.log(`  ${v}x  ${k}`);

  console.log('\n================================================================');
  console.log('Audit complete. See report for interpretation.');
  console.log('================================================================');
}

main();
