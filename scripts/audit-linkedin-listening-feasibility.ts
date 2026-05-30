/**
 * LinkedIn Listening Feasibility & Value Audit (one-shot research artifact).
 *
 * Evaluates whether building a LinkedIn listening connector is
 * justified PRIMARILY by opportunity-discovery value (per spec —
 * identity enrichment is secondary). Compares LinkedIn's projected
 * profile against the four existing listening sources (Reddit,
 * GitHub, Hacker News, keyword streams) along volume, signal
 * density, and identity dimensions.
 *
 * Numbers are estimates anchored in public knowledge of each
 * platform's content + API surface. They are NOT measurements of
 * production traffic. The script is structured so reviewers can
 * challenge each estimate by editing the constants below.
 */

type Platform = 'linkedin' | 'reddit' | 'github' | 'hackernews' | 'keyword_stream';

// ---------------------------------------------------------------------------
// Connector capability matrix
// ---------------------------------------------------------------------------

type ConnectorProfile = {
  platform: Platform;
  // Implementation reality
  api_access_path: string;
  api_access_difficulty: 1 | 2 | 3 | 4 | 5;  // 1 trivial, 5 blocked
  oauth_required: boolean;
  partnership_or_review_required: boolean;
  rate_limit_envelope: string;
  scraping_required: boolean;
  est_loc_to_build: number;
  // Volume (per typical active source per month)
  signals_per_source_per_month: { low: number; high: number };
  // Listening source identifier type (what user configures)
  source_identifier_kind: string;
  // Signal-type distribution: share of TOTAL classified opportunities
  signal_type_distribution: {
    buying_intent: number;
    competitor_dissatisfaction: number;
    migration_signal: number;
    hiring_signal: number;
    product_research: number;
    integration_need: number;
    support_frustration: number;
    growth_signal: number; // PR-CAR-2 surface; not currently in classifier enum
  };
  // Identity enrichment quality
  identity_coverage_rate: number;       // 0..1, share of opps that get an identity block
  identity_confidence_mix: { high: number; medium: number; low: number };
};

const PROFILES: ConnectorProfile[] = [
  // ---- LinkedIn (PROJECTED) ----
  {
    platform: 'linkedin',
    api_access_path:
      'No public "search posts by keyword" endpoint. Marketing Developer Platform (MDP) gates the relevant scopes (`r_organization_social`, `rw_organization_admin`). MDP requires LinkedIn application review (weeks to months; can be denied). Alternative paths: (1) Sales Navigator paid B2B tier, (2) scraping via headless browsers (ToS violation, IP-rotation infra required).',
    api_access_difficulty: 5,
    oauth_required: true,
    partnership_or_review_required: true,
    rate_limit_envelope: 'Marketing Developer Platform daily quota; tier-dependent. Unsuited for high-volume polling.',
    scraping_required: true, // Practically — without MDP approval, scraping is the only path
    est_loc_to_build: 1200,  // Connector + OAuth + MDP-handshake + scraping fallback
    signals_per_source_per_month: { low: 50, high: 300 },
    source_identifier_kind: 'company page id, keyword stream, or topic',
    signal_type_distribution: {
      // LinkedIn's professional norms suppress competitor venting and
      // public comparison shopping; hiring is its strength.
      hiring_signal: 0.40,
      growth_signal: 0.15,
      buying_intent: 0.15,
      migration_signal: 0.10,
      integration_need: 0.10,
      competitor_dissatisfaction: 0.05,
      product_research: 0.03,
      support_frustration: 0.02,
    },
    identity_coverage_rate: 1.0, // structured profile attached to every poster
    identity_confidence_mix: { high: 1.0, medium: 0.0, low: 0.0 },
  },

  // ---- Reddit (built; Phase 3) ----
  {
    platform: 'reddit',
    api_access_path:
      'Public OAuth REST. Per-subreddit /new + comments endpoints. Production-ready connector exists (redditListeningConnector.ts).',
    api_access_difficulty: 2,
    oauth_required: true,
    partnership_or_review_required: false,
    rate_limit_envelope: '60 req/min (app); 100 req/min (authenticated user). Connector aborts at <5 req remaining.',
    scraping_required: false,
    est_loc_to_build: 600,
    signals_per_source_per_month: { low: 500, high: 2000 },
    source_identifier_kind: 'subreddit name',
    signal_type_distribution: {
      buying_intent: 0.25,
      competitor_dissatisfaction: 0.20,
      migration_signal: 0.15,
      product_research: 0.15,
      hiring_signal: 0.10,
      integration_need: 0.10,
      support_frustration: 0.05,
      growth_signal: 0.0,
    },
    identity_coverage_rate: 0.0, // handle only; no profile metadata in listings
    identity_confidence_mix: { high: 0.0, medium: 0.0, low: 1.0 },
  },

  // ---- GitHub (built; Phase 5; identity enriched per PR-OPA-4) ----
  {
    platform: 'github',
    api_access_path:
      'Public REST API. Repo-scoped (owner/repo). Production-ready (githubListeningConnector.ts). PR-OPA-4 added /users/{login} for identity enrichment.',
    api_access_difficulty: 1,
    oauth_required: false, // works anonymous (60/hr) or token (5000/hr)
    partnership_or_review_required: false,
    rate_limit_envelope: '60 req/hr anon, 5000 req/hr authenticated. Comfortable for most workloads.',
    scraping_required: false,
    est_loc_to_build: 0, // Already built
    signals_per_source_per_month: { low: 100, high: 500 },
    source_identifier_kind: 'owner/repo',
    signal_type_distribution: {
      integration_need: 0.50,
      migration_signal: 0.15,
      product_research: 0.10,
      support_frustration: 0.10,
      buying_intent: 0.05,
      competitor_dissatisfaction: 0.05,
      hiring_signal: 0.05,
      growth_signal: 0.0,
    },
    identity_coverage_rate: 0.34, // measured in the GitHub identity impact audit
    identity_confidence_mix: { high: 0.34, medium: 0.0, low: 0.66 },
  },

  // ---- Hacker News (built; Phase 5) ----
  {
    platform: 'hackernews',
    api_access_path:
      'Public Algolia HN search + Firebase HN APIs. No auth required. Production-ready (hackerNewsListeningConnector.ts).',
    api_access_difficulty: 1,
    oauth_required: false,
    partnership_or_review_required: false,
    rate_limit_envelope: 'Algolia public limits; HN traffic permits comfortable polling.',
    scraping_required: false,
    est_loc_to_build: 0,
    signals_per_source_per_month: { low: 200, high: 800 },
    source_identifier_kind: 'topic / keyword query',
    signal_type_distribution: {
      product_research: 0.30,
      migration_signal: 0.20,
      buying_intent: 0.15,
      competitor_dissatisfaction: 0.15,
      integration_need: 0.10,
      hiring_signal: 0.05,
      support_frustration: 0.05,
      growth_signal: 0.0,
    },
    identity_coverage_rate: 0.0, // handle only; no public profile structure
    identity_confidence_mix: { high: 0.0, medium: 0.0, low: 1.0 },
  },

  // ---- Keyword stream (built; cross-platform fan-out) ----
  {
    platform: 'keyword_stream',
    api_access_path:
      'Meta-connector; routes through other registered connectors based on keyword fan-out.',
    api_access_difficulty: 1,
    oauth_required: false,
    partnership_or_review_required: false,
    rate_limit_envelope: 'Inherits from underlying connectors.',
    scraping_required: false,
    est_loc_to_build: 0,
    signals_per_source_per_month: { low: 100, high: 400 },
    source_identifier_kind: 'keyword query string',
    signal_type_distribution: {
      // Reflects the cross-platform fan-out; numbers approximate the
      // intersection of the 3 keyword_stream seeds (tool_migrations,
      // recommendation_requests, integration_needs).
      buying_intent: 0.30,
      migration_signal: 0.25,
      integration_need: 0.25,
      product_research: 0.10,
      competitor_dissatisfaction: 0.05,
      hiring_signal: 0.03,
      support_frustration: 0.02,
      growth_signal: 0.0,
    },
    identity_coverage_rate: 0.10,
    identity_confidence_mix: { high: 0.05, medium: 0.05, low: 0.90 },
  },
];

// ---------------------------------------------------------------------------
// Assumptions about a typical customer's listening footprint
// ---------------------------------------------------------------------------

const TYPICAL_SOURCES_PER_PLATFORM: Record<Platform, number> = {
  reddit: 8,         // a B2B customer typically listens on ~8 subreddits
  github: 4,
  hackernews: 3,     // few topic queries
  keyword_stream: 3,
  linkedin: 5,       // 5 company pages or keyword streams
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function midpoint(range: { low: number; high: number }): number {
  return (range.low + range.high) / 2;
}

function projectedMonthlyOpportunities(p: ConnectorProfile): number {
  return midpoint(p.signals_per_source_per_month) * TYPICAL_SOURCES_PER_PLATFORM[p.platform];
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

function difficultyLabel(d: number): string {
  return ['Trivial', 'Easy', 'Moderate', 'Hard', 'Blocked'][d - 1];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const linkedin = PROFILES.find((p) => p.platform === 'linkedin')!;
  const baselines = PROFILES.filter((p) => p.platform !== 'linkedin');

  console.log('================================================================');
  console.log('LinkedIn Listening Feasibility & Value Audit');
  console.log('================================================================\n');

  // ---- 1. Connector capability matrix ----
  console.log('--- Connector capability matrix ---\n');
  console.log('platform        | api access     | oauth | review | scrape | LOC   | difficulty');
  console.log('----------------+----------------+-------+--------+--------+-------+-----------');
  for (const p of PROFILES) {
    console.log(
      [
        p.platform.padEnd(15),
        `diff=${p.api_access_difficulty}`.padEnd(14),
        (p.oauth_required ? 'Y' : 'N').padEnd(5),
        (p.partnership_or_review_required ? 'Y' : 'N').padEnd(6),
        (p.scraping_required ? 'Y' : 'N').padEnd(6),
        String(p.est_loc_to_build).padStart(5),
        difficultyLabel(p.api_access_difficulty),
      ].join(' | '),
    );
  }

  // ---- 2. Volume projection ----
  console.log('\n--- Projected monthly opportunities per customer ---\n');
  console.log('platform        | sources | sig/source (mid) | projected opps/month');
  console.log('----------------+---------+------------------+---------------------');
  let totalExistingOpps = 0;
  for (const p of PROFILES) {
    const opps = projectedMonthlyOpportunities(p);
    if (p.platform !== 'linkedin') totalExistingOpps += opps;
    console.log(
      [
        p.platform.padEnd(15),
        String(TYPICAL_SOURCES_PER_PLATFORM[p.platform]).padStart(7),
        String(Math.round(midpoint(p.signals_per_source_per_month))).padStart(16),
        String(Math.round(opps)).padStart(20),
      ].join(' | '),
    );
  }
  const linkedinOpps = projectedMonthlyOpportunities(linkedin);
  const projectedLiftPct = (linkedinOpps / totalExistingOpps) * 100;
  console.log(`\n  Existing cohort total (4 connectors):           ${Math.round(totalExistingOpps)} opps/month`);
  console.log(`  LinkedIn projected addition:                    ${Math.round(linkedinOpps)} opps/month`);
  console.log(`  Projected volume lift:                          +${projectedLiftPct.toFixed(1)}%`);

  // ---- 3. Signal-type distribution comparison ----
  console.log('\n--- Signal-type density: LinkedIn vs existing baseline mix ---\n');
  // Weighted average of existing connectors (weighted by projected volume)
  const totalWeight = baselines.reduce((sum, p) => sum + projectedMonthlyOpportunities(p), 0);
  const baselineMix: Record<string, number> = {};
  for (const p of baselines) {
    const weight = projectedMonthlyOpportunities(p);
    for (const [k, v] of Object.entries(p.signal_type_distribution)) {
      baselineMix[k] = (baselineMix[k] ?? 0) + (v * weight) / totalWeight;
    }
  }
  const types = Object.keys(linkedin.signal_type_distribution) as (keyof ConnectorProfile['signal_type_distribution'])[];
  console.log('signal type                 | linkedin | baseline | linkedin advantage');
  console.log('----------------------------+----------+----------+-------------------');
  for (const t of types) {
    const li = linkedin.signal_type_distribution[t];
    const bl = baselineMix[t] ?? 0;
    const delta = li - bl;
    const flag = delta > 0.05 ? '  ↑ stronger' : delta < -0.05 ? '  ↓ weaker' : '  ≈ similar';
    console.log(
      [
        String(t).padEnd(27),
        `${(li * 100).toFixed(1)}%`.padStart(8),
        `${(bl * 100).toFixed(1)}%`.padStart(8),
        `${(delta * 100 >= 0 ? '+' : '')}${(delta * 100).toFixed(1)}pt${flag}`,
      ].join(' | '),
    );
  }

  // ---- 4. LinkedIn signal volumes BY type ----
  console.log('\n--- LinkedIn projected opportunities per type per month ---\n');
  for (const t of types) {
    const count = linkedin.signal_type_distribution[t] * linkedinOpps;
    if (count > 0) {
      console.log(`  ${String(t).padEnd(27)} ${Math.round(count).toString().padStart(5)}/month  (${(linkedin.signal_type_distribution[t] * 100).toFixed(1)}%)`);
    }
  }

  // ---- 5. Identity enrichment ----
  console.log('\n--- Identity coverage comparison ---\n');
  console.log('platform        | coverage | high  | medium | low');
  console.log('----------------+----------+-------+--------+----');
  for (const p of PROFILES) {
    console.log(
      [
        p.platform.padEnd(15),
        `${(p.identity_coverage_rate * 100).toFixed(0)}%`.padStart(8),
        `${(p.identity_confidence_mix.high   * 100).toFixed(0)}%`.padStart(5),
        `${(p.identity_confidence_mix.medium * 100).toFixed(0)}%`.padStart(6),
        `${(p.identity_confidence_mix.low    * 100).toFixed(0)}%`.padStart(3),
      ].join(' | '),
    );
  }

  // ---- 6. Actionability lift ----
  //
  // Per the actionability audit framework:
  //   - dim 4 (Context Richness) baseline = 2 / 3
  //   - identity-resolved (high confidence) lifts dim 4 to 3
  //   - medium confidence lifts dim 4 to 2.5
  //
  // LinkedIn projected coverage: 100% high. Per-opportunity dim 4 lift: +1.0
  // Score-point lift = (1.0 / 18) * 10 ≈ 0.56 per LinkedIn opportunity.
  //
  // Realized lift across overall cohort = LinkedIn share of new total × 0.56
  const linkedinShare = linkedinOpps / (totalExistingOpps + linkedinOpps);
  const perOppLift = (1.0 / 18) * 10;
  const cohortActionabilityLift = linkedinShare * perOppLift;

  console.log('\n--- Projected actionability lift ---\n');
  console.log(`  Per-LinkedIn-opportunity dim 4 lift:            +1.0 (capped to ceiling)`);
  console.log(`  Per-LinkedIn-opportunity score lift:            +${perOppLift.toFixed(2)} / 10`);
  console.log(`  LinkedIn share of total (after addition):       ${(linkedinShare * 100).toFixed(1)}%`);
  console.log(`  Realized cohort actionability lift:             +${cohortActionabilityLift.toFixed(2)} / 10`);
  console.log(`  (Only applies to LinkedIn-originated opps; non-LinkedIn opps unchanged.)`);

  // ---- 7. Implementation complexity ----
  console.log('\n--- Implementation complexity ---\n');
  console.log(`  API access:                                     ${difficultyLabel(linkedin.api_access_difficulty)}`);
  console.log(`  LOC estimate:                                   ${linkedin.est_loc_to_build} (vs Reddit ${PROFILES.find(p => p.platform === 'reddit')!.est_loc_to_build})`);
  console.log(`  Partnership / review required:                  ${linkedin.partnership_or_review_required ? 'YES' : 'no'}`);
  console.log(`  Scraping required (practical path):             ${linkedin.scraping_required ? 'YES (ToS risk)' : 'no'}`);
  console.log(`  Rate limit envelope:                            ${linkedin.rate_limit_envelope}`);

  // ---- 8. ROI ----
  //
  // Cost factors:
  //   - LOC (engineering effort)
  //   - API access uncertainty (Marketing Developer Platform timeline)
  //   - Operational risk (scraping)
  //   - Recurring infra cost (proxy rotation, headless browser farms)
  //
  // Lift factors:
  //   - Opportunity volume increase
  //   - Actionability score lift
  //   - Strategic differentiation (LinkedIn-sourced hiring/growth signals)
  //
  // Composite score (heuristic): weight strategic value, discount by risk
  const valueWeightedLift = projectedLiftPct + cohortActionabilityLift * 100;
  const costWeightedRisk =
    (linkedin.est_loc_to_build / 100) * 1.0   // LOC base
    + (linkedin.partnership_or_review_required ? 40 : 0)  // gate risk
    + (linkedin.scraping_required ? 30 : 0);              // ops risk
  const roiRatio = valueWeightedLift / costWeightedRisk;

  let roi: 'HIGH' | 'MEDIUM' | 'LOW';
  if (roiRatio >= 1.5) roi = 'HIGH';
  else if (roiRatio >= 0.5) roi = 'MEDIUM';
  else roi = 'LOW';

  console.log('\n--- ROI classification ---\n');
  console.log(`  Volume lift contribution:                       +${projectedLiftPct.toFixed(1)}pt`);
  console.log(`  Actionability lift contribution:                +${(cohortActionabilityLift * 100).toFixed(1)}pt`);
  console.log(`  Value-weighted lift score:                      ${valueWeightedLift.toFixed(1)}`);
  console.log(`  Cost-weighted risk score:                       ${costWeightedRisk.toFixed(1)}`);
  console.log(`  ROI ratio (lift / risk):                        ${roiRatio.toFixed(2)}`);
  console.log(`  ROI classification:                             ${roi}`);

  // ---- 9. Recommendation ----
  // GO requires:
  //   - HIGH or MEDIUM ROI
  //   - API access path is at least conditionally viable
  //   - Strategic value is meaningful
  const apiViable = linkedin.api_access_difficulty <= 4;
  const decision = roi === 'HIGH' && apiViable ? 'GO' : roi === 'LOW' ? 'NO-GO' : 'CONDITIONAL';

  console.log('\n--- Recommendation ---\n');
  console.log(`  API access viable today:                        ${apiViable ? 'YES' : 'NO'}`);
  console.log(`  Decision:                                       ${decision}`);

  console.log('\n================================================================');
  console.log('Audit complete.');
  console.log('================================================================');
}

main();
