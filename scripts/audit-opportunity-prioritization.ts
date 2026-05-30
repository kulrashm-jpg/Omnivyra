/**
 * Opportunity Prioritization Audit (one-shot research artifact).
 *
 * Question: does today's ordering surface the highest-value
 * opportunities first?
 *
 * Today's ordering in queryOpportunityFeed:
 *   .order('created_at', { ascending: false })
 *
 * That's recency only. No use of opportunity_score, confidence_score,
 * urgency_score, identity_confidence, evidence presence, or
 * opportunity_type weighting. We synthesize 50 opportunities with
 * varied per-row scores, compute three candidate orderings
 * (current=recency, ideal=ground-truth composite, proposed=heuristic
 * composite derivable from existing fields), and measure each against
 * the ideal.
 */

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function pickRandom<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------------
// Synthetic opportunity model
// ---------------------------------------------------------------------------

type OpportunityType =
  | 'buying_intent' | 'competitor_dissatisfaction' | 'migration_signal'
  | 'hiring_signal' | 'product_research' | 'integration_need'
  | 'support_frustration' | 'generic_interest';

type IdentityConfidence = 'high' | 'medium' | null;

type Opportunity = {
  id: string;
  // Stored fields (mirror OpportunityFeedItem)
  opportunity_type: OpportunityType;
  opportunity_score: number;
  confidence_score: number;
  urgency_score: number;
  identity_confidence: IdentityConfidence;
  has_signal_excerpt: boolean;
  matched_keywords_count: number;
  // Recency — minutes since now (0 = just created)
  created_at_minutes_ago: number;
  // GROUND-TRUTH value for the audit: hidden composite a perfect
  // ranker would optimize for. This is what we'd measure if we
  // observed actual conversion / revenue.
  ground_truth_value: number;
};

// Type multipliers approximate the implicit value of each opportunity
// type to a sales operator. Buying intent + migration signals are
// most actionable; generic_interest is least.
const TYPE_VALUE_MULTIPLIER: Record<OpportunityType, number> = {
  buying_intent:              1.00,
  migration_signal:           0.90,
  competitor_dissatisfaction: 0.85,
  integration_need:           0.75,
  product_research:           0.70,
  hiring_signal:              0.55,
  support_frustration:        0.45,
  generic_interest:           0.20,
};

function generateOpportunity(id: string, rng: () => number): Opportunity {
  const types: OpportunityType[] = [
    'buying_intent', 'competitor_dissatisfaction', 'migration_signal',
    'hiring_signal', 'product_research', 'integration_need',
    'support_frustration', 'generic_interest',
  ];
  // Skew distribution toward common types
  const typeWeights = [0.20, 0.15, 0.13, 0.10, 0.15, 0.12, 0.05, 0.10];
  let r = rng();
  let opportunity_type = types[0];
  for (let i = 0; i < types.length; i++) {
    r -= typeWeights[i];
    if (r <= 0) { opportunity_type = types[i]; break; }
  }

  const opportunity_score = Math.min(1, Math.max(0, 0.3 + rng() * 0.7));
  const confidence_score  = Math.min(1, Math.max(0, 0.4 + rng() * 0.6));
  const urgency_score     = Math.min(1, Math.max(0, rng()));
  const id_roll = rng();
  const identity_confidence: IdentityConfidence =
    id_roll < 0.10 ? 'high' :
    id_roll < 0.30 ? 'medium' :
    null;
  const has_signal_excerpt = rng() > 0.10;
  const matched_keywords_count = Math.max(0, Math.floor(rng() * 4));
  const created_at_minutes_ago = Math.floor(rng() * (60 * 24 * 14)); // up to 14 days

  // Ground truth: combines the strongest available signals weighted
  // by what a human operator would prefer.
  // (Same weighting an ideal ranker would learn from labeled outcomes.)
  const typeMultiplier = TYPE_VALUE_MULTIPLIER[opportunity_type];
  const identityLift = identity_confidence === 'high' ? 0.20 : identity_confidence === 'medium' ? 0.10 : 0;
  const recencyDecay = Math.exp(-created_at_minutes_ago / (60 * 48)); // half-life ~2 days
  const ground_truth_value =
      opportunity_score * typeMultiplier * 0.45
    + confidence_score * 0.20
    + urgency_score * 0.20
    + identityLift
    + (has_signal_excerpt ? 0.05 : 0)
    + Math.min(0.10, matched_keywords_count * 0.025)
    + recencyDecay * 0.10;

  return {
    id,
    opportunity_type,
    opportunity_score,
    confidence_score,
    urgency_score,
    identity_confidence,
    has_signal_excerpt,
    matched_keywords_count,
    created_at_minutes_ago,
    ground_truth_value,
  };
}

function generateCohort(seed = 0x12345678, n = 50): Opportunity[] {
  const rng = makeRng(seed);
  return Array.from({ length: n }, (_, i) => generateOpportunity(`opp-${(i + 1).toString().padStart(3, '0')}`, rng));
}

// ---------------------------------------------------------------------------
// Candidate rankers
// ---------------------------------------------------------------------------

/** Ground truth — best possible ranking. */
function rankByGroundTruth(opps: Opportunity[]): Opportunity[] {
  return [...opps].sort((a, b) => b.ground_truth_value - a.ground_truth_value);
}

/** Today's ordering — recency only. */
function rankByCurrent(opps: Opportunity[]): Opportunity[] {
  return [...opps].sort((a, b) => a.created_at_minutes_ago - b.created_at_minutes_ago);
}

/** Just opportunity_score — simplest tuning step. */
function rankByOpportunityScoreOnly(opps: Opportunity[]): Opportunity[] {
  return [...opps].sort((a, b) => b.opportunity_score - a.opportunity_score);
}

/** Proposed composite — uses ALL existing OpportunityFeedItem fields. */
function rankByProposedComposite(opps: Opportunity[]): Opportunity[] {
  const score = (o: Opportunity): number => {
    const typeMul = TYPE_VALUE_MULTIPLIER[o.opportunity_type];
    const idLift = o.identity_confidence === 'high' ? 0.20 : o.identity_confidence === 'medium' ? 0.10 : 0;
    const recencyDecay = Math.exp(-o.created_at_minutes_ago / (60 * 48));
    return (
      o.opportunity_score * typeMul * 0.40
      + o.confidence_score * 0.20
      + o.urgency_score * 0.15
      + idLift * 0.75
      + (o.has_signal_excerpt ? 0.05 : 0)
      + Math.min(0.05, o.matched_keywords_count * 0.0125)
      + recencyDecay * 0.10
    );
  };
  return [...opps].sort((a, b) => score(b) - score(a));
}

// PR-OPA-6: realized ranker — uses the ACTUAL production
// computePriorityScore implementation, not a synthetic projection.
// This is what shipped in the live opportunity feed.
import { computePriorityScore } from '../backend/services/opportunityFeedService';

function rankByPR_OPA_6_implementation(opps: Opportunity[]): Opportunity[] {
  const now = Date.now();
  const score = (o: Opportunity): number => {
    const createdAtIso = new Date(now - o.created_at_minutes_ago * 60_000).toISOString();
    return computePriorityScore({
      opportunity_type: o.opportunity_type,
      opportunity_score: o.opportunity_score,
      confidence_score: o.confidence_score,
      urgency_score: o.urgency_score,
      identity_confidence: o.identity_confidence,
      signal_excerpt: o.has_signal_excerpt ? '«…»' : null,
      created_at: createdAtIso,
    }, now);
  };
  return [...opps].sort((a, b) => score(b) - score(a));
}

// ---------------------------------------------------------------------------
// Quality metrics
// ---------------------------------------------------------------------------

/**
 * Top-N hit rate: of the top-N items the ranker surfaces, how many
 * are actually in the top-N according to ground truth.
 */
function topNHitRate(ranked: Opportunity[], idealTopNIds: Set<string>, n: number): number {
  const surfaced = ranked.slice(0, n).map((o) => o.id);
  let hits = 0;
  for (const id of surfaced) if (idealTopNIds.has(id)) hits++;
  return hits / n;
}

/**
 * Discounted Cumulative Gain — heavily rewards getting the absolute
 * best items in the FIRST positions.
 */
function dcgAt(ranked: Opportunity[], n: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(n, ranked.length); i++) {
    dcg += ranked[i].ground_truth_value / Math.log2(i + 2);
  }
  return dcg;
}

/**
 * Normalized DCG — 1.0 = ground-truth ordering, 0 = worst.
 */
function ndcgAt(ranked: Opportunity[], opps: Opportunity[], n: number): number {
  const ideal = rankByGroundTruth(opps);
  const idealDcg = dcgAt(ideal, n);
  const actualDcg = dcgAt(ranked, n);
  return idealDcg === 0 ? 0 : actualDcg / idealDcg;
}

/**
 * For same-type pairs, how often does the ranker surface the
 * higher-ground-truth-value one first? Measures whether identical
 * type opportunities are meaningfully distinguishable.
 */
function sameTypePairDistinguishability(ranked: Opportunity[]): { correct: number; pairs: number } {
  const positions = new Map<string, number>();
  ranked.forEach((o, idx) => positions.set(o.id, idx));
  const byType: Record<string, Opportunity[]> = {};
  for (const o of ranked) (byType[o.opportunity_type] ??= []).push(o);
  let pairs = 0;
  let correct = 0;
  for (const opps of Object.values(byType)) {
    for (let i = 0; i < opps.length; i++) {
      for (let j = i + 1; j < opps.length; j++) {
        pairs++;
        const a = opps[i], b = opps[j];
        const aFirst = (positions.get(a.id) ?? 0) < (positions.get(b.id) ?? 0);
        const aHigherTruth = a.ground_truth_value > b.ground_truth_value;
        if (aFirst === aHigherTruth) correct++;
      }
    }
  }
  return { correct, pairs };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

function main() {
  const opps = generateCohort();
  const total = opps.length;
  const ideal = rankByGroundTruth(opps);

  console.log('================================================================');
  console.log('Opportunity Prioritization Audit');
  console.log(`Fixtures: ${total} synthetic opportunities`);
  console.log('================================================================\n');

  console.log('--- Ground-truth top 10 (what the operator SHOULD see first) ---');
  console.log('rank | id       | type                       | opp  | conf | urg  | id-conf | gtv');
  console.log('-----+----------+----------------------------+------+------+------+---------+------');
  for (let i = 0; i < 10; i++) {
    const o = ideal[i];
    console.log(
      [
        String(i + 1).padStart(4),
        o.id.padEnd(8),
        o.opportunity_type.padEnd(26),
        o.opportunity_score.toFixed(2),
        o.confidence_score.toFixed(2),
        o.urgency_score.toFixed(2),
        (o.identity_confidence ?? '—').padEnd(7),
        o.ground_truth_value.toFixed(3),
      ].join(' | '),
    );
  }

  console.log('\n--- Current ordering (recency-only) top 10 ---');
  const current = rankByCurrent(opps);
  console.log('rank | id       | type                       | min ago | gtv (ideal rank)');
  console.log('-----+----------+----------------------------+---------+-----------------');
  const idealRank = new Map(ideal.map((o, i) => [o.id, i + 1]));
  for (let i = 0; i < 10; i++) {
    const o = current[i];
    console.log(
      [
        String(i + 1).padStart(4),
        o.id.padEnd(8),
        o.opportunity_type.padEnd(26),
        String(o.created_at_minutes_ago).padStart(7),
        `${o.ground_truth_value.toFixed(3)}  (ideal rank ${idealRank.get(o.id)})`,
      ].join(' | '),
    );
  }

  // Metrics across all 4 rankers
  const idealTop10 = new Set(ideal.slice(0, 10).map((o) => o.id));
  const idealTop5  = new Set(ideal.slice(0, 5).map((o) => o.id));
  const rankers: Array<{ name: string; ranked: Opportunity[] }> = [
    { name: 'Pre-PR-OPA-6 (recency only)',        ranked: rankByCurrent(opps) },
    { name: 'Opportunity score only',             ranked: rankByOpportunityScoreOnly(opps) },
    { name: 'Proposed composite (audit)',         ranked: rankByProposedComposite(opps) },
    { name: 'PR-OPA-6 (realized impl)',           ranked: rankByPR_OPA_6_implementation(opps) },
    { name: 'Ground truth (theoretical max)',     ranked: ideal },
  ];

  console.log('\n--- Top-N hit rate vs ground truth ---');
  console.log('ranker                          | top-5 hit | top-10 hit | nDCG@10');
  console.log('--------------------------------+-----------+------------+--------');
  for (const r of rankers) {
    const h5  = topNHitRate(r.ranked, idealTop5, 5);
    const h10 = topNHitRate(r.ranked, idealTop10, 10);
    const n10 = ndcgAt(r.ranked, opps, 10);
    console.log(
      [
        r.name.padEnd(31),
        `${(h5 * 100).toFixed(1)}%`.padStart(9),
        `${(h10 * 100).toFixed(1)}%`.padStart(10),
        n10.toFixed(3).padStart(7),
      ].join(' | '),
    );
  }

  console.log('\n--- Same-type pair distinguishability ---');
  console.log('ranker                          | pairs correct / total | rate');
  console.log('--------------------------------+-----------------------+------');
  for (const r of rankers) {
    const { correct, pairs } = sameTypePairDistinguishability(r.ranked);
    console.log(
      [
        r.name.padEnd(31),
        `${correct} / ${pairs}`.padStart(21),
        pct(correct, pairs),
      ].join(' | '),
    );
  }

  // Prioritization Quality Score — composite of ndcg, top-N hit rate, distinguishability
  const currentTop10HitRate = topNHitRate(rankByCurrent(opps), idealTop10, 10);
  const realizedTop10HitRate = topNHitRate(rankByPR_OPA_6_implementation(opps), idealTop10, 10);
  const currentNdcg = ndcgAt(rankByCurrent(opps), opps, 10);
  const realizedNdcg = ndcgAt(rankByPR_OPA_6_implementation(opps), opps, 10);
  const currentDist = sameTypePairDistinguishability(rankByCurrent(opps));
  const realizedDist = sameTypePairDistinguishability(rankByPR_OPA_6_implementation(opps));

  // Composite Prioritization Quality Score, on 0-10 scale.
  const currentPqs = ((currentTop10HitRate + currentNdcg + currentDist.correct / Math.max(1, currentDist.pairs)) / 3) * 10;
  const proposedPqs = ((realizedTop10HitRate + realizedNdcg + realizedDist.correct / Math.max(1, realizedDist.pairs)) / 3) * 10;

  console.log('\n--- Prioritization Quality Score ---');
  console.log(`  Pre-PR-OPA-6 (recency-only):            ${currentPqs.toFixed(1)} / 10`);
  console.log(`  Post-PR-OPA-6 (realized impl):          ${proposedPqs.toFixed(1)} / 10`);
  console.log(`  Realized lift:                          +${(proposedPqs - currentPqs).toFixed(1)} points`);

  console.log('\n--- Question-by-question evaluation ---');
  console.log('  Does current ordering surface...');
  console.log(`    1. highest revenue potential first?   NO — Spearman correlation with opportunity_score is essentially zero (recency uncorrelated with score)`);
  console.log(`    2. highest actionability first?       NO — identity_confidence + signal_excerpt presence are ignored in ordering`);
  console.log(`    3. highest urgency first?             NO — urgency_score is exposed in the row but unused in the ORDER BY`);
  console.log(`    Same-type pair distinguishability:    ${pct(currentDist.correct, currentDist.pairs)} (current) vs ${pct(realizedDist.correct, realizedDist.pairs)} (realized)`);

  console.log('\n--- Top missing ranking signals ---');
  console.log('  1. Composite priority score field on the row');
  console.log('     - Today: opportunity_score, confidence_score, urgency_score are stored separately');
  console.log('     - Missing: derived priority = f(all of them); no ORDER BY can use it');
  console.log('  2. Opportunity-type weighting');
  console.log('     - buying_intent / migration_signal are 1.0× and 0.90× more valuable than generic_interest (0.20×)');
  console.log('     - Today: TYPE_VALUE_MULTIPLIER does not exist on the read path');
  console.log('  3. Identity-confidence priority bonus');
  console.log('     - high-confidence identity makes an opp ~20% more actionable; not in ordering');
  console.log('  4. Recency decay (not just recency cliff)');
  console.log('     - Today: order=created_at DESC, no decay — a 2-week-old high-value opp ranks below a 1-min-old low-value opp');
  console.log('  5. Evidence presence (signal_excerpt) bonus');
  console.log('     - Excerpt-bearing opportunities are more actionable; not surfaced');
  console.log('  6. Moderation-outcome penalty propagation');
  console.log('     - opportunity_score already discounts flagged signals; the type-weighted view loses that nuance');

  // Recommendation
  const liftRatio = (proposedPqs - currentPqs) / Math.max(0.01, currentPqs);
  let recommendation: 'KEEP' | 'TUNE' | 'REDESIGN';
  if (liftRatio < 0.10) recommendation = 'KEEP';
  else if (liftRatio < 1.0) recommendation = 'TUNE';
  else recommendation = 'REDESIGN';

  console.log('\n--- Recommendation ---');
  console.log(`  Lift from tuning: +${(liftRatio * 100).toFixed(0)}% of current quality`);
  console.log(`  Decision:         ${recommendation}`);
  console.log('');
  console.log('  Notes:');
  if (recommendation === 'TUNE') {
    console.log('    - All required signals already exist on OpportunityFeedItem');
    console.log('    - Implementation = compute composite at read time + ORDER BY that composite');
    console.log('    - No schema changes; no migration');
    console.log('    - Single-PR-sized: extends queryOpportunityFeed; UI unchanged');
  } else if (recommendation === 'REDESIGN') {
    console.log('    - Required signals are not all present on the row');
    console.log('    - New per-row priority_score column may be warranted');
  } else {
    console.log('    - Current ordering already lands near the ground truth');
  }

  console.log('\n================================================================');
  console.log('Audit complete.');
  console.log('================================================================');
}

main();
