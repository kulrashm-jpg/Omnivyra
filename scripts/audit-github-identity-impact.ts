/**
 * GitHub Identity Enrichment Impact Audit (one-shot research artifact).
 *
 * Measures realized value of PR-OPA-4 (GitHub identity supply) by
 * running 50 synthetic GitHub-originated opportunities through the
 * PR-OPA-3 resolver via the PR-OPA-4 forwarding pattern.
 *
 * Fixtures are sampled from author archetypes with documented
 * profile-population probabilities. The sampling is deterministic
 * (seeded LCG) so the report is reproducible.
 *
 * Output:
 *   - Identity coverage rate
 *   - Company / role resolution rates
 *   - High / medium confidence rates
 *   - Realized actionability lift
 *   - HIGH / MEDIUM / LOW ROI classification
 *   - GO/NO-GO recommendation for LinkedIn + X listening connectors
 */

import { resolveIdentityFor } from '../backend/services/opportunityFeedService';

// ---------------------------------------------------------------------------
// Deterministic RNG so the report is stable across runs.
// ---------------------------------------------------------------------------

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// GitHub author archetypes with realistic profile fill rates.
//
// The probabilities reflect what's observable on actual GitHub user
// profiles for issue / comment authors in popular OSS repos:
//   - Maintainers usually fill in company + bio + name
//   - Active contributors usually fill in company
//   - Drive-by reporters often fill name but not company
//   - Bot accounts fill nothing
// ---------------------------------------------------------------------------

type ProfileFill = {
  has_company: boolean;
  has_bio: boolean;
  has_name: boolean;
};

type Archetype = {
  name: string;
  weight: number;            // sampling weight
  fill: () => ProfileFill;   // generator
  sample_bios: string[];     // realistic bio strings when has_bio=true
  sample_companies: string[];
  sample_names: string[];
};

const COMPANIES = ['Stripe','Anthropic','Vercel','GitLab','Datadog','Cloudflare','Snowflake','Notion','Linear','Sentry','Neon','Supabase','PlanetScale','Auth0','Twilio'];
const NAMES = ['Jane Doe','John Smith','Alex Kim','Maria Garcia','Sam Chen','Priya Patel','David Mueller','Lin Park','Carlos Rivera','Aisha Ahmed','Owen Walsh','Yuki Tanaka','Erik Nystrom','Layla Hassan','Tobias Wegner'];

// Bios drawn from a pool of realistic GitHub bio strings. Some carry
// role anchors the PR-OPA-3 extractor can parse; others are
// stylistic with no extractable role.
const RICH_BIOS_WITH_ROLE = [
  'CTO @ {company}. Building infra.',
  'Senior Engineer at {company}.',
  'VP Engineering. Opinions my own.',
  'Founder. Building tools for devs.',
  'Engineering Manager at {company}.',
  'Staff Engineer at {company}. Distributed systems.',
  'Head of Platform at {company}.',
  'Product Manager focused on developer tools.',
  'Director of Engineering. Coffee enthusiast.',
];
const RICH_BIOS_NO_ROLE = [
  'opinions are my own',
  'he/him. dad of two.',
  'tinkering with side projects',
  'just here for the issues',
  '🧙 making things',
  'open to chat',
  'building in public',
];

const ARCHETYPES: Archetype[] = [
  {
    name: 'maintainer_active',
    weight: 0.18,
    fill: () => ({ has_company: true,  has_bio: true,  has_name: true  }),
    sample_bios: RICH_BIOS_WITH_ROLE,
    sample_companies: COMPANIES,
    sample_names: NAMES,
  },
  {
    name: 'oss_contributor_company',
    weight: 0.22,
    fill: () => ({ has_company: true,  has_bio: false, has_name: true  }),
    sample_bios: [],
    sample_companies: COMPANIES,
    sample_names: NAMES,
  },
  {
    name: 'oss_contributor_no_company',
    weight: 0.10,
    fill: () => ({ has_company: false, has_bio: true,  has_name: true  }),
    sample_bios: RICH_BIOS_NO_ROLE,
    sample_companies: [],
    sample_names: NAMES,
  },
  {
    name: 'drive_by_reporter_named',
    weight: 0.18,
    fill: () => ({ has_company: false, has_bio: false, has_name: true  }),
    sample_bios: [],
    sample_companies: [],
    sample_names: NAMES,
  },
  {
    name: 'drive_by_anonymous',
    weight: 0.18,
    fill: () => ({ has_company: false, has_bio: false, has_name: false }),
    sample_bios: [],
    sample_companies: [],
    sample_names: [],
  },
  {
    name: 'bot_or_ci',
    weight: 0.08,
    fill: () => ({ has_company: false, has_bio: false, has_name: false }),
    sample_bios: [],
    sample_companies: [],
    sample_names: [],
  },
  {
    name: 'rich_individual_indie',
    weight: 0.06,
    fill: () => ({ has_company: false, has_bio: true,  has_name: true  }),
    sample_bios: RICH_BIOS_WITH_ROLE.map((b) => b.replace('{company}', 'my own thing')),
    sample_companies: [],
    sample_names: NAMES,
  },
];

const OPPORTUNITY_TYPES = [
  'buying_intent', 'competitor_dissatisfaction', 'migration_signal',
  'hiring_signal', 'product_research', 'integration_need',
  'support_frustration',
] as const;

// ---------------------------------------------------------------------------
// Fixture generation
// ---------------------------------------------------------------------------

type Fixture = {
  id: string;
  opportunity_type: typeof OPPORTUNITY_TYPES[number];
  archetype: string;
  author_metadata: Record<string, unknown>;
};

function sampleFromWeights<T>(items: T[], weights: number[], rng: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function pickRandom<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function generateFixtures(seed = 0xDEADBEEF, n = 50): Fixture[] {
  const rng = makeRng(seed);
  const archetypeWeights = ARCHETYPES.map((a) => a.weight);
  const fixtures: Fixture[] = [];
  for (let i = 0; i < n; i++) {
    const archetype = sampleFromWeights(ARCHETYPES, archetypeWeights, rng);
    const fill = archetype.fill();
    const handle = `user_${(i + 1).toString().padStart(3, '0')}`;
    const author_metadata: Record<string, unknown> = {
      platform_user_id: `github:${handle}`,
      author_handle: handle,
    };
    if (fill.has_company && archetype.sample_companies.length > 0) {
      author_metadata.profile_company = pickRandom(archetype.sample_companies, rng);
    }
    if (fill.has_name && archetype.sample_names.length > 0) {
      author_metadata.profile_name = pickRandom(archetype.sample_names, rng);
    }
    if (fill.has_bio && archetype.sample_bios.length > 0) {
      let bio = pickRandom(archetype.sample_bios, rng);
      if (author_metadata.profile_company) {
        bio = bio.replace('{company}', String(author_metadata.profile_company));
      } else {
        bio = bio.replace(/\{company\}/g, 'an org');
      }
      author_metadata.profile_bio = bio;
    }
    fixtures.push({
      id: `gh-${(i + 1).toString().padStart(3, '0')}`,
      opportunity_type: pickRandom([...OPPORTUNITY_TYPES], rng),
      archetype: archetype.name,
      author_metadata,
    });
  }
  return fixtures;
}

// ---------------------------------------------------------------------------
// Resolve + aggregate
// ---------------------------------------------------------------------------

type Resolved = {
  fixture: Fixture;
  resolved_company: string | null;
  resolved_role: string | null;
  identity_confidence: 'high' | 'medium' | 'low' | null;
};

function resolveAll(fixtures: Fixture[]): Resolved[] {
  return fixtures.map((f) => {
    const r = resolveIdentityFor('github', f.author_metadata);
    return {
      fixture: f,
      resolved_company: r.resolved_company,
      resolved_role: r.resolved_role,
      identity_confidence: r.identity_confidence,
    };
  });
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

function main() {
  const fixtures = generateFixtures();
  const total = fixtures.length;
  const resolved = resolveAll(fixtures);

  console.log('================================================================');
  console.log('GitHub Identity Enrichment Impact Audit');
  console.log(`Fixtures: ${total} synthetic GitHub opportunities`);
  console.log('================================================================\n');

  console.log('--- Per-opportunity capture ---');
  console.log('id       | type                       | archetype                 | block | company             | role             | confidence');
  console.log('---------+----------------------------+---------------------------+-------+---------------------+------------------+-----------');
  for (const r of resolved) {
    const block = r.identity_confidence === 'high' || r.identity_confidence === 'medium' ? 'YES  ' : 'no   ';
    console.log(
      [
        r.fixture.id.padEnd(8),
        r.fixture.opportunity_type.padEnd(26),
        r.fixture.archetype.padEnd(25),
        block,
        (r.resolved_company ?? '—').padEnd(19),
        (r.resolved_role    ?? '—').padEnd(16),
        r.identity_confidence ?? '—',
      ].join(' | '),
    );
  }

  // Cohort metrics
  const blockShown   = resolved.filter((r) => r.identity_confidence === 'high' || r.identity_confidence === 'medium').length;
  const companyHit   = resolved.filter((r) => r.resolved_company !== null).length;
  const roleHit      = resolved.filter((r) => r.resolved_role    !== null).length;
  const highCount    = resolved.filter((r) => r.identity_confidence === 'high').length;
  const mediumCount  = resolved.filter((r) => r.identity_confidence === 'medium').length;

  console.log('\n--- Cohort metrics ---');
  console.log(`  Identity Coverage Rate (block shown):           ${pct(blockShown, total)}`);
  console.log(`  Company Resolution Rate:                        ${pct(companyHit, total)}`);
  console.log(`  Role Resolution Rate:                           ${pct(roleHit, total)}`);
  console.log(`  High Confidence Rate:                           ${pct(highCount, total)}`);
  console.log(`  Medium Confidence Rate:                         ${pct(mediumCount, total)}`);

  // Actionability dimension impact
  // Per actionability audit: dim 4 (Context Richness) baseline = 2.
  // With identity block: lifts to 3 for high confidence, 2.5 for medium.
  const dim4PerFixture =
    (highCount * 3.0 + mediumCount * 2.5 + (total - blockShown) * 2.0) / total;
  const dim4Baseline = 2.0;
  const dim4Lift = dim4PerFixture - dim4Baseline;

  // Without GitHub identity: baseline avg total (per latest actionability audit) = 11.74 / 18 → 6.5/10.
  // With realized GitHub lift: lifts only the GitHub slice of the total cohort.
  // For this audit, the relevant comparison is GitHub-vs-GitHub:
  //   without identity: total = 11.74
  //   with identity:    total = 11.74 + dim4Lift
  const totalWithout = 11.74;
  const totalWith    = totalWithout + dim4Lift;
  const scoreWithout = (totalWithout / 18) * 10;
  const scoreWith    = (totalWith    / 18) * 10;
  const realizedLift = scoreWith - scoreWithout;

  console.log('\n--- Actionability impact (GitHub-originated slice) ---');
  console.log(`  Without identity (baseline):                    ${scoreWithout.toFixed(2)} / 10`);
  console.log(`  With identity (PR-OPA-4 active):                ${scoreWith.toFixed(2)} / 10`);
  console.log(`  Realized Actionability Lift:                    +${realizedLift.toFixed(2)} points`);

  console.log('\n--- Understanding / prioritization / routing (resolved cohort only) ---');
  const easierUnderstand  = resolved.filter((r) => r.resolved_company !== null).length;
  const easierPrioritize  = resolved.filter((r) => r.identity_confidence === 'high').length;
  const easierRoute       = resolved.filter((r) => r.resolved_company !== null && r.resolved_role !== null).length;
  console.log(`  Easier to understand (company resolved):        ${easierUnderstand} / ${total}  (${pct(easierUnderstand, total)})`);
  console.log(`  Easier to prioritize (high confidence):         ${easierPrioritize} / ${total}  (${pct(easierPrioritize, total)})`);
  console.log(`  Easier to route (company + role both):          ${easierRoute} / ${total}  (${pct(easierRoute, total)})`);

  // ROI classification.
  // The threshold mapping reflects effort scale:
  //   - GitHub took ~100 LOC across 2 files (cheap)
  //   - LinkedIn/X each take ~600 LOC + OAuth + scope plumbing (expensive)
  // We classify the GitHub work itself, then project per-platform.
  let roi: 'HIGH ROI' | 'MEDIUM ROI' | 'LOW ROI';
  if (realizedLift >= 0.30) roi = 'HIGH ROI';
  else if (realizedLift >= 0.15) roi = 'MEDIUM ROI';
  else roi = 'LOW ROI';

  console.log('\n--- ROI classification ---');
  console.log(`  GitHub PR-OPA-4 ROI:                            ${roi}`);
  console.log(`  (lift ${realizedLift.toFixed(2)} for ~100 LOC of work)`);

  // Per-platform projection for LinkedIn and X.
  // Feasibility audit (50-fixture realistic mix) found:
  //   LinkedIn: 100% high confidence (structured profile)
  //   X:        92% medium-or-high (bio extraction)
  // Projected lift if their connectors existed:
  const linkedinProjectedLift = (1.0 * 1.0 + 0.0 * 0.5) ;  // every opportunity lifts dim 4 by 1
  const xProjectedLift =        (0.33 * 1.0 + 0.59 * 0.5);  // approximate from feasibility audit (4 high + 7 med of 12)
  // Scale to score points: lift × (1 / 18 × 10)
  const linkedinScoreLift = (linkedinProjectedLift / 18) * 10;
  const xScoreLift        = (xProjectedLift / 18) * 10;

  console.log('\n--- Per-platform projection (if connector existed) ---');
  console.log(`  LinkedIn projected lift:                        +${linkedinScoreLift.toFixed(2)} / 10`);
  console.log(`  X projected lift:                               +${xScoreLift.toFixed(2)} / 10`);

  // Decision: relative ROI per LOC.
  // GitHub: lift / ~100 LOC = high ROI/LOC
  // LinkedIn: lift / ~600 LOC = X / LinkedIn lift ratio
  const githubRoiPerLoc   = realizedLift / 100;
  const linkedinRoiPerLoc = linkedinScoreLift / 600;
  const xRoiPerLoc        = xScoreLift / 600;
  console.log('\n--- Per-LOC ROI ---');
  console.log(`  GitHub  ROI per 100 LOC:                        ${(githubRoiPerLoc * 100).toFixed(3)}  (baseline)`);
  console.log(`  LinkedIn ROI per 100 LOC:                       ${(linkedinRoiPerLoc * 100).toFixed(3)}  (${(linkedinRoiPerLoc / githubRoiPerLoc * 100).toFixed(0)}% of GitHub's)`);
  console.log(`  X       ROI per 100 LOC:                        ${(xRoiPerLoc * 100).toFixed(3)}  (${(xRoiPerLoc / githubRoiPerLoc * 100).toFixed(0)}% of GitHub's)`);

  // Recommendation
  // GO when projected lift is significant in absolute terms AND
  // ROI-per-LOC compares reasonably to alternatives. We use absolute
  // lift >= 0.3 as the GO threshold for new-connector investment.
  const linkedinGo = linkedinScoreLift >= 0.30;
  const xGo        = xScoreLift        >= 0.30;
  console.log('\n--- Recommendation ---');
  console.log(`  LinkedIn Listening Connector:                   ${linkedinGo ? 'GO' : 'NO-GO'}`);
  console.log(`  X        Listening Connector:                   ${xGo ? 'GO' : 'NO-GO'}`);

  console.log('\n================================================================');
  console.log('Audit complete.');
  console.log('================================================================');
}

main();
