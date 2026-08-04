/**
 * Reddit Identity Enrichment Feasibility Audit (one-shot research artifact).
 *
 * Reddit is structurally different from GitHub / LinkedIn:
 *   - Reddit profile has NO structured `company` field
 *   - Reddit profile has NO structured `title` / `role` field
 *   - Reddit DOES expose: username, karma, account_age, public bio
 *     (subreddit.public_description), verified social links, list of
 *     active subreddits via /user/{name}/comments and /submitted.
 *
 * That means the resolver for Reddit can resolve:
 *   - persona  (via bio role anchors + subreddit history)
 *   - role     (via bio extraction)
 *   - company  (only when explicitly named in bio — rare)
 *   - credibility tier (via karma + account age + verified status)
 *
 * Per PR-OPA-3's display rule (hide when confidence < medium), this
 * audit projects how often Reddit's enrichment data would meet the
 * medium-confidence bar, and what the cohort-wide actionability
 * impact would be given Reddit's dominance (~74% of opps today).
 *
 * Output: identity coverage, confidence distribution, projected
 * cohort lift, implementation complexity, ROI classification.
 */

// ---------------------------------------------------------------------------
// Deterministic RNG (seeded LCG)
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

function sampleFromWeights<T>(items: T[], weights: number[], rng: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ---------------------------------------------------------------------------
// Reddit user archetypes (informed by public-OSS-comparable B2B-subreddit norms)
// ---------------------------------------------------------------------------

type ProfileFill = {
  has_bio: boolean;
  bio_has_role_anchor: boolean;
  bio_has_explicit_employer: boolean;
  karma_tier: 'new' | 'low' | 'medium' | 'high';
  account_age_years: number;
  /** Most-active subreddit category inferable from posting history. */
  inferred_persona: string | null;
  /** Linked verified social account (twitter/github/etc.) — secondary identity hop. */
  has_verified_social_link: boolean;
};

type Archetype = {
  name: string;
  weight: number;
  fill: () => ProfileFill;
};

const BIO_WITH_ROLE = [
  'CTO @ {company}. Building infra.',
  'Senior Engineer. Opinions my own.',
  'VP Engineering at {company}.',
  'Founder. Building tools.',
  'Engineering Manager. Coffee enthusiast.',
  'Staff Engineer. Distributed systems.',
  'Head of Platform at {company}.',
  'Product Manager focused on devtools.',
  'Director of Engineering. Side projects.',
];
const BIO_NO_ROLE = [
  'opinions are my own',
  'he/him. dad of two.',
  'tinkering with side projects',
  'just here to learn',
  '🧙 making things',
  'building in public',
  'climber + dev',
];
const BIO_WITH_EMPLOYER_ONLY = [
  'building stuff at {company}',
  '@{company}. all things SaaS.',
  'at {company}. opinions my own.',
];

const PERSONAS = ['devops_engineer','founder','marketing_leader','sales_leader','product_manager','data_scientist','indie_dev', null];

const ARCHETYPES: Archetype[] = [
  // Throwaway / newly created — high in adversarial / privacy-conscious cohorts
  {
    name: 'throwaway_or_new',
    weight: 0.30,
    fill: () => ({
      has_bio: false,
      bio_has_role_anchor: false,
      bio_has_explicit_employer: false,
      karma_tier: 'new',
      account_age_years: 0.1,
      inferred_persona: null,
      has_verified_social_link: false,
    }),
  },
  // Active casual user — moderate karma, no bio
  {
    name: 'active_casual',
    weight: 0.35,
    fill: () => ({
      has_bio: false,
      bio_has_role_anchor: false,
      bio_has_explicit_employer: false,
      karma_tier: 'medium',
      account_age_years: 4,
      inferred_persona: Math.random() > 0.5 ? pickRandom(PERSONAS, Math.random) : null,
      has_verified_social_link: false,
    }),
  },
  // Bio but no role mention
  {
    name: 'bio_no_role',
    weight: 0.15,
    fill: () => ({
      has_bio: true,
      bio_has_role_anchor: false,
      bio_has_explicit_employer: false,
      karma_tier: 'medium',
      account_age_years: 5,
      inferred_persona: pickRandom(PERSONAS, Math.random),
      has_verified_social_link: false,
    }),
  },
  // Bio with role anchor (PRIMARY medium-confidence path)
  {
    name: 'bio_with_role',
    weight: 0.12,
    fill: () => ({
      has_bio: true,
      bio_has_role_anchor: true,
      bio_has_explicit_employer: false,
      karma_tier: 'medium',
      account_age_years: 6,
      inferred_persona: pickRandom(PERSONAS, Math.random),
      has_verified_social_link: false,
    }),
  },
  // Bio with explicit employer mention (rare — PRIMARY high-confidence path)
  {
    name: 'bio_with_employer',
    weight: 0.05,
    fill: () => ({
      has_bio: true,
      bio_has_role_anchor: true,
      bio_has_explicit_employer: true,
      karma_tier: 'high',
      account_age_years: 7,
      inferred_persona: pickRandom(PERSONAS, Math.random),
      has_verified_social_link: false,
    }),
  },
  // Power user / industry pro — high karma, rich bio, verified social link
  {
    name: 'power_user_industry',
    weight: 0.03,
    fill: () => ({
      has_bio: true,
      bio_has_role_anchor: true,
      bio_has_explicit_employer: true,
      karma_tier: 'high',
      account_age_years: 10,
      inferred_persona: pickRandom(PERSONAS, Math.random),
      has_verified_social_link: true,
    }),
  },
];

const COMPANIES = ['Stripe','Anthropic','Vercel','GitLab','Datadog','Cloudflare','HubSpot','Mailchimp','Notion','Linear'];

// ---------------------------------------------------------------------------
// Fixture generation
// ---------------------------------------------------------------------------

type Fixture = {
  id: string;
  archetype: string;
  author_metadata: Record<string, unknown>;
  inferred_persona: string | null;
};

function buildBio(fill: ProfileFill, rng: () => number): string {
  if (!fill.has_bio) return '';
  if (fill.bio_has_explicit_employer) {
    const template = pickRandom(BIO_WITH_ROLE, rng);
    return template.replace('{company}', pickRandom(COMPANIES, rng));
  }
  if (fill.bio_has_role_anchor) {
    const template = pickRandom(BIO_WITH_ROLE, rng);
    return template.replace('{company}', 'an org');
  }
  return pickRandom(BIO_NO_ROLE, rng);
}

function generateFixtures(seed = 0x71EDD17, n = 100): Fixture[] {
  const rng = makeRng(seed);
  const weights = ARCHETYPES.map((a) => a.weight);
  const fixtures: Fixture[] = [];
  for (let i = 0; i < n; i++) {
    const archetype = sampleFromWeights(ARCHETYPES, weights, rng);
    const fill = archetype.fill();
    const handle = `u_${(i + 1).toString().padStart(3, '0')}`;
    const author_metadata: Record<string, unknown> = {
      platform_user_id: `reddit:${handle}`,
      author_handle: handle,
      karma_tier: fill.karma_tier,
      account_age_years: fill.account_age_years,
    };
    if (fill.has_bio) {
      const bio = buildBio(fill, rng);
      if (bio) author_metadata.profile_bio = bio;
    }
    if (fill.has_verified_social_link) {
      author_metadata.verified_social_links = ['twitter'];
    }
    if (fill.inferred_persona) {
      author_metadata.inferred_persona = fill.inferred_persona;
    }
    fixtures.push({ id: `r-${(i + 1).toString().padStart(3, '0')}`, archetype: archetype.name, author_metadata, inferred_persona: fill.inferred_persona });
  }
  return fixtures;
}

// ---------------------------------------------------------------------------
// Simulated Reddit branch of the PR-OPA-3 resolver
// ---------------------------------------------------------------------------

// Mirrors the bio-extraction patterns used by the existing X branch.
const BIO_ROLE_PATTERNS: RegExp[] = [
  /\b(C(?:EO|TO|FO|MO|OO|RO|IO|ISO|PO))\b/,
  /\b(VP(?: of)? [A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*){0,2})\b/,
  /\b(Head of [A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*){0,2})\b/,
  /\b(Director(?: of)? [A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*){0,2})\b/,
  /\b(Founder|Co-?founder|Engineering Manager|Product Manager|Engineering Lead)\b/,
  /\b(Senior [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?|Staff [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)\b/,
];
const BIO_COMPANY_PATTERNS: RegExp[] = [
  /(?:^|\s)@\s?([A-Z][A-Za-z0-9]+(?:[ -][A-Z][A-Za-z0-9]+)*)/,
  /\bat ([A-Z][A-Za-z0-9]+(?:[ -][A-Z][A-Za-z0-9]+){0,3})\b/,
];

function extract(pattern: RegExp[], text: string): string | null {
  for (const p of pattern) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

type RedditResolved = {
  resolved_company: string | null;
  resolved_role: string | null;
  resolved_persona: string | null;
  identity_confidence: 'high' | 'medium' | 'low' | null;
};

/**
 * Proposed Reddit branch of the PR-OPA-3 resolver.
 *
 * Rule:
 *   - explicit company AND role extracted from bio → high
 *   - role extracted (no company) but high-credibility account
 *     (karma_tier high or account_age >= 5y) → medium
 *   - role extracted alone → medium (lower bar than GitHub/X because
 *     Reddit profile signal is structurally weaker)
 *   - inferred_persona only (no bio extraction) → low (HIDDEN by UI)
 *   - nothing → null
 */
function resolveRedditSimulated(meta: Record<string, unknown>): RedditResolved {
  const bio = typeof meta.profile_bio === 'string' ? meta.profile_bio : '';
  const company = bio ? extract(BIO_COMPANY_PATTERNS, bio) : null;
  const role    = bio ? extract(BIO_ROLE_PATTERNS, bio)    : null;
  const persona = typeof meta.inferred_persona === 'string' ? meta.inferred_persona : null;
  const karma   = typeof meta.karma_tier === 'string' ? meta.karma_tier : 'new';

  if (company && role) {
    return { resolved_company: company, resolved_role: role, resolved_persona: persona, identity_confidence: 'high' };
  }
  if (role) {
    return { resolved_company: null, resolved_role: role, resolved_persona: persona, identity_confidence: 'medium' };
  }
  if (persona && (karma === 'high' || karma === 'medium')) {
    return { resolved_company: null, resolved_role: null, resolved_persona: persona, identity_confidence: 'low' };
  }
  return { resolved_company: null, resolved_role: null, resolved_persona: null, identity_confidence: null };
}

// ---------------------------------------------------------------------------
// Aggregate + report
// ---------------------------------------------------------------------------

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

function main() {
  const fixtures = generateFixtures();
  const total = fixtures.length;
  const resolved = fixtures.map((f) => ({ fixture: f, ...resolveRedditSimulated(f.author_metadata) }));

  console.log('================================================================');
  console.log('Reddit Identity Enrichment Feasibility Audit');
  console.log(`Fixtures: ${total} synthetic Reddit opportunities`);
  console.log('================================================================\n');

  // Per-fixture summary (compact — sample of first 30 only)
  console.log('--- Per-fixture (first 30) ---');
  console.log('id     | archetype                | block | confidence | company             | role                  | persona');
  console.log('-------+--------------------------+-------+------------+---------------------+-----------------------+--------------');
  for (const r of resolved.slice(0, 30)) {
    const block = r.identity_confidence === 'high' || r.identity_confidence === 'medium' ? 'YES  ' : 'no   ';
    console.log(
      [
        r.fixture.id.padEnd(6),
        r.fixture.archetype.padEnd(24),
        block,
        (r.identity_confidence ?? '—').padEnd(10),
        (r.resolved_company ?? '—').padEnd(19),
        (r.resolved_role ?? '—').padEnd(21),
        r.resolved_persona ?? '—',
      ].join(' | '),
    );
  }

  // Cohort metrics
  const blockShown    = resolved.filter((r) => r.identity_confidence === 'high' || r.identity_confidence === 'medium').length;
  const companyHit    = resolved.filter((r) => r.resolved_company !== null).length;
  const roleHit       = resolved.filter((r) => r.resolved_role !== null).length;
  const personaHit    = resolved.filter((r) => r.resolved_persona !== null).length;
  const highCount     = resolved.filter((r) => r.identity_confidence === 'high').length;
  const mediumCount   = resolved.filter((r) => r.identity_confidence === 'medium').length;
  const lowCount      = resolved.filter((r) => r.identity_confidence === 'low').length;

  console.log('\n--- Reddit cohort metrics (100 fixtures) ---');
  console.log(`  Identity Coverage Rate (block shown):         ${pct(blockShown, total)}`);
  console.log(`  Company Resolution Rate:                      ${pct(companyHit, total)}`);
  console.log(`  Role Resolution Rate:                         ${pct(roleHit, total)}`);
  console.log(`  Persona Resolution Rate (any):                ${pct(personaHit, total)}`);
  console.log(`  High Confidence Rate:                         ${pct(highCount, total)}`);
  console.log(`  Medium Confidence Rate:                       ${pct(mediumCount, total)}`);
  console.log(`  Low (hidden by UI rule):                      ${pct(lowCount, total)}`);

  // Per-archetype breakdown
  console.log('\n--- Per-archetype breakdown ---');
  console.log('archetype                  |  n  | block shown | high | medium | low | none');
  console.log('---------------------------+-----+-------------+------+--------+-----+-----');
  const archetypeNames = Array.from(new Set(resolved.map((r) => r.fixture.archetype)));
  for (const arch of archetypeNames) {
    const subset = resolved.filter((r) => r.fixture.archetype === arch);
    const n = subset.length;
    const block = subset.filter((r) => r.identity_confidence === 'high' || r.identity_confidence === 'medium').length;
    const high = subset.filter((r) => r.identity_confidence === 'high').length;
    const med = subset.filter((r) => r.identity_confidence === 'medium').length;
    const low = subset.filter((r) => r.identity_confidence === 'low').length;
    const none = subset.filter((r) => r.identity_confidence === null).length;
    console.log(
      [
        arch.padEnd(26),
        String(n).padStart(3),
        `${pct(block, n)}`.padStart(11),
        String(high).padStart(4),
        String(med).padStart(6),
        String(low).padStart(3),
        String(none).padStart(4),
      ].join(' | '),
    );
  }

  // ---- Actionability impact (cohort-wide projection) ----
  //
  // From the prior LinkedIn audit, Reddit produces ~10,000 opportunities
  // per customer per month — 74% of the existing cohort of ~13,450.
  //
  // Per-opportunity dim 4 lift on Reddit:
  //   - high confidence (5% of Reddit opps)  → +1.0 dim 4
  //   - medium confidence (~12%)             → +0.5 dim 4
  //   - low (~30%)                           → 0 (UI hides)
  //   - none (~53%)                          → 0
  //
  // Score-point lift per Reddit opp = (avg dim 4 lift / 18) × 10
  const dim4PerReddit =
    (highCount * 1.0 + mediumCount * 0.5 + lowCount * 0.0 + (total - highCount - mediumCount - lowCount) * 0.0) / total;
  const perOppScoreLift = (dim4PerReddit / 18) * 10;

  // Cohort impact: Reddit's volume share × per-Reddit-opp lift
  const REDDIT_VOLUME_SHARE = 0.74; // from LinkedIn feasibility audit
  const cohortLift = REDDIT_VOLUME_SHARE * perOppScoreLift;

  console.log('\n--- Projected actionability impact (cohort-wide) ---');
  console.log(`  Reddit volume share of total cohort:          74%  (~10,000 opps/month per customer)`);
  console.log(`  Avg dim 4 lift per Reddit opp:                +${dim4PerReddit.toFixed(2)}`);
  console.log(`  Per-Reddit-opp score lift:                    +${perOppScoreLift.toFixed(2)} / 10`);
  console.log(`  Projected cohort lift:                        +${cohortLift.toFixed(2)} / 10`);

  // ---- Comparison vs GitHub PR-OPA-4 baseline ----
  console.log('\n--- Comparison vs GitHub PR-OPA-4 (delivered) ---');
  console.log(`  GitHub PR-OPA-4 per-opp lift:                 +0.19 / 10`);
  console.log(`  GitHub volume share of cohort:                ~9%   (1,200 / 13,450)`);
  console.log(`  GitHub cohort lift:                           ~+0.017 / 10`);
  console.log(`  Reddit cohort lift:                           +${cohortLift.toFixed(3)} / 10  (${(cohortLift / 0.017).toFixed(1)}× GitHub)`);

  // ---- Implementation complexity ----
  console.log('\n--- Implementation complexity ---');
  console.log('  Existing connector?                           YES (redditListeningConnector.ts)');
  console.log('  Existing OAuth flow?                          YES (reused)');
  console.log('  Required new API call:                        GET /user/{username}/about');
  console.log('  Optional secondary call:                      GET /user/{username}/comments (persona inference)');
  console.log('  Required code changes:');
  console.log('    1. redditListeningConnector.ts              + ~80 LOC  (enrichment phase + cache, mirrors GitHub PR-OPA-4)');
  console.log('    2. opportunityFeedService.ts                + ~5 LOC   (already covered via pickProfileFields helper)');
  console.log('    3. resolveIdentityFor "reddit" branch       + ~40 LOC  (new branch in resolver)');
  console.log('  Total estimated LOC:                          ~125');
  console.log('  Rate limit envelope:                          Already accommodated (Reddit OAuth: 60/min)');
  console.log('  Partnership / review required:                NO');
  console.log('  Scraping required:                            NO');

  // ---- ROI ----
  //
  // Cost: ~125 LOC, no API access risk, no partnership requirement.
  // Lift: +cohortLift score points cohort-wide.
  // Per-LOC ROI: cohortLift / 125 LOC.
  // Compare to GitHub: 0.019 cohort lift per 100 LOC.
  const githubCohortLiftPer100 = 0.017 / 1.0; // 100 LOC = 0.017 score lift
  const redditLiftPer100LOC = cohortLift / (125 / 100);

  console.log('\n--- ROI classification ---');
  console.log(`  Reddit cohort lift per 100 LOC:               +${redditLiftPer100LOC.toFixed(3)} / 10`);
  console.log(`  GitHub cohort lift per 100 LOC (baseline):    +${githubCohortLiftPer100.toFixed(3)} / 10`);
  console.log(`  Reddit efficiency vs GitHub:                  ${(redditLiftPer100LOC / githubCohortLiftPer100).toFixed(1)}×`);

  let roi: 'HIGH' | 'MEDIUM' | 'LOW';
  if (redditLiftPer100LOC / githubCohortLiftPer100 >= 2.0) roi = 'HIGH';
  else if (redditLiftPer100LOC / githubCohortLiftPer100 >= 1.0) roi = 'MEDIUM';
  else roi = 'LOW';
  console.log(`  ROI classification:                           ${roi}`);

  // ---- Recommendation ----
  const recommendation = roi === 'HIGH' ? 'GO' : roi === 'MEDIUM' ? 'GO (sequence after one X-bio-extraction quick pass)' : 'NO-GO';
  console.log('\n--- Recommendation ---');
  console.log(`  Decision:                                     ${recommendation}`);

  console.log('\n================================================================');
  console.log('Audit complete.');
  console.log('================================================================');
}

main();

// TYPECHECK-BASELINE-REDUCTION: this file has no top-level import or export, so
// TypeScript compiles it as a GLOBAL script and its top-level declarations share
// one scope with every other global script under tsconfig.scripts.json. That is
// the root cause of the duplicate-identifier / duplicate-implementation errors,
// and of the downstream mismatches where a colliding name resolved to another
// file's type. Declaring it a module scopes its names to this file.
// Runtime is unchanged: no static import is added and the script still executes
// top-to-bottom exactly as before.
export {};