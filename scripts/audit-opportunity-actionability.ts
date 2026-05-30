/**
 * Active Leads — Opportunity Actionability Audit (one-shot research artifact).
 *
 * Distinct from the classifier-quality audit: that audit asks "did we
 * classify correctly?", this one asks "of the classified opportunities,
 * how usable are they to a salesperson?".
 *
 * Per-fixture scoring across the 6 dimensions from the PR-CAR spec
 * (each 0–3, summed 0–18):
 *   1. Why surfaced clarity      — does detected_reason + keywords explain?
 *   2. Actionability             — can the user do something today?
 *   3. Evidence usefulness       — is the proof visible?
 *   4. Context richness          — what do we know about the prospect?
 *   5. Routing usefulness        — can this be sent to the right person?
 *   6. Next-step usefulness      — is there a clear next move?
 *
 * Classification buckets:
 *   Highly Actionable      14–18
 *   Moderately Actionable   8–13
 *   Low Actionability       0–7
 *
 * Rule-based scoring — deterministic and reproducible. The rules are
 * derived from what the existing OpportunityFeedItem shape actually
 * exposes to the UI; gaps in the OUTPUT SHAPE cap individual dimensions
 * regardless of how good the classifier is. That's the point of the
 * audit.
 */

import { classifyOpportunity } from '../backend/services/opportunityClassifierService';
import type { OpportunityType } from '../backend/types/opportunityFeed';

// Reuse the same 38 "classified" fixtures as the quality audit by
// inlining the relevant subset of content. We're auditing the SHAPE of
// classified opportunities, not the classifier itself.
type Fixture = {
  id: string;
  content: string;
  ground_truth_type: OpportunityType;
  // Heuristic: does this signal name a specific business entity? Used by
  // dimension 4 (context richness) to detect when a company resolution
  // would actually be possible.
  has_named_entity: boolean;
  // Author identity simulation. In real data, opportunity_feed_items
  // carries author_handle + platform_user_id but rarely email/company.
  has_author_handle: boolean;
  // Source identifier (subreddit / community) populated.
  has_source_identifier: boolean;
};

const FIXTURES: Fixture[] = [
  // Buying intent
  { id: 'b01', content: "Looking for a CRM that doesn't suck. We're an outbound team of 8.", ground_truth_type: 'buying_intent', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'b02', content: "Need a marketing automation tool that does email + landing pages. Budget approved.", ground_truth_type: 'buying_intent', has_named_entity: false, has_author_handle: true, has_source_identifier: true },
  { id: 'b03', content: "What's the best bookkeeping software for a 3-person firm?", ground_truth_type: 'buying_intent', has_named_entity: false, has_author_handle: true, has_source_identifier: true },
  { id: 'b04', content: "Recommend a passwordless auth provider. We're evaluating Auth0 and Clerk.", ground_truth_type: 'buying_intent', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'b05', content: "In the market for a procurement platform. Considering Coupa and Ariba.", ground_truth_type: 'buying_intent', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'b06', content: "Just got budget for a sales engagement tool. Outreach vs Salesloft?", ground_truth_type: 'buying_intent', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'b07', content: "Shopping for product analytics. Amplitude is great but $$$. Alternatives?", ground_truth_type: 'buying_intent', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'b08', content: "Any good vector DB recommendations for embedding search?", ground_truth_type: 'buying_intent', has_named_entity: false, has_author_handle: true, has_source_identifier: true },
  { id: 'b09', content: "Need recommendations for a SOC 2 automation platform. Vanta or Drata?", ground_truth_type: 'buying_intent', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'b10', content: "Approved budget for project mgmt software for 40-person agency. Recommendations?", ground_truth_type: 'buying_intent', has_named_entity: false, has_author_handle: true, has_source_identifier: true },

  // Migration
  { id: 'm01', content: "Migrating from HubSpot to Pipedrive. Anyone done it cleanly?", ground_truth_type: 'migration_signal', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'm02', content: "Moving off Datadog. Their pricing is insane. Open to suggestions.", ground_truth_type: 'migration_signal', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'm03', content: "Switching from Mailchimp to a more transactional-friendly platform.", ground_truth_type: 'migration_signal', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'm04', content: "Leaving Greenhouse for a leaner ATS. Suggestions?", ground_truth_type: 'migration_signal', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'm05', content: "Replacing QuickBooks with something API-first.", ground_truth_type: 'migration_signal', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'm06', content: "Swapped out Zendesk for Intercom. Migration was painful.", ground_truth_type: 'migration_signal', has_named_entity: true, has_author_handle: true, has_source_identifier: true },

  // Competitor pain
  { id: 'c01', content: "Fed up with Mailchimp. Their automation builder is so slow.", ground_truth_type: 'competitor_dissatisfaction', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'c02', content: "Datadog is expensive. Anyone using cheaper alternatives?", ground_truth_type: 'competitor_dissatisfaction', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'c03', content: "Zendesk is broken — tickets disappearing for the last week.", ground_truth_type: 'competitor_dissatisfaction', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'c04', content: "Frustrated with Vanta — alerts not working properly.", ground_truth_type: 'competitor_dissatisfaction', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'c05', content: "Alternatives to HubSpot? Their pricing tiers are absurd.", ground_truth_type: 'competitor_dissatisfaction', has_named_entity: true, has_author_handle: true, has_source_identifier: true },

  // Product research
  { id: 'r01', content: "Comparing Pinecone vs Weaviate vs Qdrant for production use.", ground_truth_type: 'product_research', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'r02', content: "Differences between Outreach and Salesloft — anyone used both?", ground_truth_type: 'product_research', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'r03', content: "Pros and cons of Pipedrive vs HubSpot for SMB sales?", ground_truth_type: 'product_research', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'r04', content: "LaunchDarkly vs Split.io — anyone migrated between them?", ground_truth_type: 'product_research', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'r05', content: "What's the difference between CircleCI and GitHub Actions for monorepos?", ground_truth_type: 'product_research', has_named_entity: true, has_author_handle: true, has_source_identifier: true },

  // Integration need
  { id: 'i01', content: "Need an API for integrating Slack with HubSpot deals.", ground_truth_type: 'integration_need', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'i02', content: "Integrating Auth0 with our backend — webhook for user changes?", ground_truth_type: 'integration_need', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'i03', content: "Connecting Mixpanel to Segment — anyone done this cleanly?", ground_truth_type: 'integration_need', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'i04', content: "Syncing between Stripe and QuickBooks — what's the cleanest path?", ground_truth_type: 'integration_need', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'i05', content: "Need to integrate Zapier into our procurement workflow.", ground_truth_type: 'integration_need', has_named_entity: false, has_author_handle: true, has_source_identifier: true },

  // Hiring
  { id: 'h01', content: "We're hiring a senior growth marketer in NYC. Open role.", ground_truth_type: 'hiring_signal', has_named_entity: false, has_author_handle: true, has_source_identifier: true },
  { id: 'h02', content: "Growing the team — looking for a staff ML engineer.", ground_truth_type: 'hiring_signal', has_named_entity: false, has_author_handle: true, has_source_identifier: true },
  { id: 'h03', content: "Open position for a procurement analyst. Apply via our careers page.", ground_truth_type: 'hiring_signal', has_named_entity: false, has_author_handle: true, has_source_identifier: true },

  // Support pain
  { id: 's01', content: "No response from support for 5 days. Ticket sitting for over a week.", ground_truth_type: 'support_frustration', has_named_entity: false, has_author_handle: true, has_source_identifier: true },
  { id: 's02', content: "Vanta support has been silent. Stuck in support hell.", ground_truth_type: 'support_frustration', has_named_entity: true, has_author_handle: true, has_source_identifier: true },

  // Weak (kept — they classify with anchor expansion)
  { id: 'w01', content: "Looking for a tool. Any suggestions?", ground_truth_type: 'buying_intent', has_named_entity: false, has_author_handle: true, has_source_identifier: true },

  // Duplicate (classifies)
  { id: 'd01', content: "Anyone got a CRM recommendation for an 8-person outbound team?", ground_truth_type: 'buying_intent', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
  { id: 'd02', content: "Migrating from HubSpot to Pipedrive — tips?", ground_truth_type: 'migration_signal', has_named_entity: true, has_author_handle: true, has_source_identifier: true },
];

type Bucket = 'highly_actionable' | 'moderately_actionable' | 'low_actionability';

type Scores = {
  why_clarity: number;          // 0-3
  actionability: number;        // 0-3
  evidence_usefulness: number;  // 0-3
  context_richness: number;     // 0-3
  routing_usefulness: number;   // 0-3
  next_step_usefulness: number; // 0-3
  total: number;                // 0-18
  bucket: Bucket;
  missing: string[];            // labels of dimensions with score 0-1
};

function bucket(total: number): Bucket {
  if (total >= 14) return 'highly_actionable';
  if (total >= 8) return 'moderately_actionable';
  return 'low_actionability';
}

function scoreFixture(fx: Fixture): Scores {
  const classification = classifyOpportunity(fx.content);
  const isGeneric = classification.opportunity_type === 'generic_interest';
  const keywordCount = classification.matched_keywords.length;

  // 1. Why surfaced clarity — driven by detected_reason composition
  //    (matched_keywords appended in parens). Higher = more specific.
  let why_clarity = 0;
  if (!isGeneric) {
    if (keywordCount >= 2 && fx.has_named_entity) why_clarity = 3;
    else if (keywordCount >= 2 || (keywordCount >= 1 && fx.has_named_entity)) why_clarity = 2;
    else if (keywordCount >= 1) why_clarity = 1;
  }

  // 2. Actionability — what could a user actually do right now?
  //    The CEILING here is 2: specific type + entity gives "I know what
  //    they want and from whom." Reaching 3 would require an inline
  //    suggested action / draft.
  let actionability = 0;
  if (!isGeneric) {
    if (fx.has_named_entity && keywordCount >= 1) actionability = 2;
    else if (keywordCount >= 1) actionability = 1;
  }

  // 3. Evidence usefulness — PR-OPA-1 added signal_excerpt to the
  //    FeedItem shape, lifting the cap from 1 to 2. Users now see a
  //    verbatim quote under the explanation ("What was said" block)
  //    without clicking out. Reaching 3 would still require source
  //    URL + surrounding thread context.
  let evidence_usefulness = 0;
  if (!isGeneric && keywordCount >= 1) evidence_usefulness = 2;
  // (Would be 3 with source URL + thread context.)

  // 4. Context richness — PR-OPA-3 added high-confidence identity
  //    enrichment for LinkedIn / GitHub / X opportunities, conditionally
  //    lifting this dim from 2 to 3 when resolved_company + resolved_role
  //    are present at >= medium confidence. This audit's fixtures don't
  //    carry per-platform profile metadata, so the lift doesn't apply
  //    here — see scripts/audit-opportunity-identity-enrichment.ts for
  //    the projected +0.3 actionability-score impact across a realistic
  //    platform mix.
  let context_richness = 0;
  if (fx.has_author_handle) context_richness += 1;
  if (fx.has_source_identifier) context_richness += 1;

  // 5. Routing usefulness — type + platform allow simple rules but
  //    the schema has no assigned_owner / team_routing field. CAP at 2.
  let routing_usefulness = 0;
  if (!isGeneric) routing_usefulness += 1;
  if (fx.has_source_identifier) routing_usefulness += 1;
  // (Would be 3 with assigned_owner / team field.)

  // 6. Next-step usefulness — PR-OPA-2 added suggested_next_action,
  //    a rule-derived single-sentence guidance per opportunity type
  //    ("Review discussion.", "Monitor evaluation discussion.",
  //    etc.). Lifts the cap from 1 to 2. Reaching 3 would require
  //    inline drafting / scheduling / CRM-sync actions — explicitly
  //    out of scope per the PR-OPA-2 spec (no LLM, no CRM, no
  //    drafting).
  let next_step_usefulness = 0;
  if (!isGeneric) next_step_usefulness = 2;

  const total =
    why_clarity + actionability + evidence_usefulness
    + context_richness + routing_usefulness + next_step_usefulness;

  const missing: string[] = [];
  if (why_clarity <= 1) missing.push('detected_reason specificity');
  if (actionability <= 1) missing.push('inline-actionable detail');
  if (evidence_usefulness <= 1) missing.push('signal_excerpt missing (legacy row)');
  // PR-OPA-1 covered the "excerpt missing entirely" gap. Reaching 3
  // requires source URL + thread context, which is a separate
  // workstream.
  if (context_richness <= 1) missing.push('company / role resolution (PR-OPA-3 covers LinkedIn / GitHub / X)');
  if (routing_usefulness <= 1) missing.push('owner / team routing field');
  if (next_step_usefulness <= 1) missing.push('inline workflow actions (draft / schedule / sync)');
  // PR-OPA-2 added suggested_next_action; closes the "no guidance"
  // gap. The remaining gap is INLINE actions (drafting, scheduling,
  // CRM sync) which the spec explicitly excludes from scope.

  return {
    why_clarity,
    actionability,
    evidence_usefulness,
    context_richness,
    routing_usefulness,
    next_step_usefulness,
    total,
    bucket: bucket(total),
    missing,
  };
}

function main() {
  console.log('================================================================');
  console.log('Active Leads — Opportunity Actionability Audit');
  console.log(`Fixtures: ${FIXTURES.length} classified opportunities`);
  console.log('================================================================\n');

  const results = FIXTURES.map((fx) => ({ fx, scores: scoreFixture(fx) }));

  // Per-fixture row
  console.log('--- Per-fixture scoring (each dim 0-3) ---');
  console.log('id   | why | act | evd | ctx | rt  | nxt | tot | bucket');
  console.log('-----+-----+-----+-----+-----+-----+-----+-----+-------');
  for (const { fx, scores } of results) {
    console.log(
      [
        fx.id.padEnd(4),
        String(scores.why_clarity).padStart(3),
        String(scores.actionability).padStart(3),
        String(scores.evidence_usefulness).padStart(3),
        String(scores.context_richness).padStart(3),
        String(scores.routing_usefulness).padStart(3),
        String(scores.next_step_usefulness).padStart(3),
        String(scores.total).padStart(3),
        scores.bucket,
      ].join(' | '),
    );
  }

  // Aggregate
  const total = results.length;
  const sum = (k: keyof Scores) =>
    results.reduce((acc, r) => acc + (typeof r.scores[k] === 'number' ? (r.scores[k] as number) : 0), 0);
  const avg = (k: keyof Scores) => sum(k) / total;
  const bucketCounts: Record<Bucket, number> = {
    highly_actionable: 0,
    moderately_actionable: 0,
    low_actionability: 0,
  };
  for (const r of results) bucketCounts[r.scores.bucket] += 1;

  // Composite actionability score
  const compositeAvg = sum('total') / (total * 18); // 0..1
  const actionabilityScore = compositeAvg * 10;

  console.log('\n--- Cohort metrics ---');
  console.log(`  Total classified opportunities:                ${total}`);
  console.log(`  Avg Why Surfaced Clarity:                      ${avg('why_clarity').toFixed(2)} / 3`);
  console.log(`  Avg Actionability:                             ${avg('actionability').toFixed(2)} / 3`);
  console.log(`  Avg Evidence Usefulness:                       ${avg('evidence_usefulness').toFixed(2)} / 3`);
  console.log(`  Avg Context Richness:                          ${avg('context_richness').toFixed(2)} / 3`);
  console.log(`  Avg Routing Usefulness:                        ${avg('routing_usefulness').toFixed(2)} / 3`);
  console.log(`  Avg Next-Step Usefulness:                      ${avg('next_step_usefulness').toFixed(2)} / 3`);
  console.log(`  Avg Total:                                     ${avg('total').toFixed(2)} / 18`);
  console.log('');
  console.log(`  Highly Actionable (14-18):                     ${bucketCounts.highly_actionable}  (${((bucketCounts.highly_actionable / total) * 100).toFixed(1)}%)`);
  console.log(`  Moderately Actionable (8-13):                  ${bucketCounts.moderately_actionable}  (${((bucketCounts.moderately_actionable / total) * 100).toFixed(1)}%)`);
  console.log(`  Low Actionability (0-7):                       ${bucketCounts.low_actionability}  (${((bucketCounts.low_actionability / total) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`  Opportunity Actionability Score:               ${actionabilityScore.toFixed(1)} / 10`);

  // Top missing info types
  const missingCounts = new Map<string, number>();
  for (const r of results) {
    for (const m of r.scores.missing) missingCounts.set(m, (missingCounts.get(m) ?? 0) + 1);
  }
  const sortedMissing = [...missingCounts.entries()].sort((a, b) => b[1] - a[1]);

  console.log('\n--- Top missing information types ---');
  for (const [label, count] of sortedMissing) {
    const pct = ((count / total) * 100).toFixed(0);
    console.log(`  ${String(count).padStart(3)}/${total}  (${pct.padStart(3)}%)  ${label}`);
  }

  console.log('\n================================================================');
  console.log('Audit complete.');
  console.log('================================================================');
}

main();
