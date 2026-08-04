/**
 * Active Leads — Opportunity Identity Enrichment Feasibility Audit
 * (one-shot research artifact, READ-ONLY).
 *
 * Question being answered: across realistic incoming opportunities,
 * does enough source data exist to support reliable identity
 * enrichment (company / role resolution)?
 *
 * IMPORTANT: this audit does NOT implement enrichment. It evaluates
 * the SUPPLY side — what signals are available, per platform, in
 * realistic signal content + platform metadata.
 *
 * Method: 50 fixtures spread across the platforms the listening
 * pipeline ingests today. Each fixture carries (a) a realistic
 * synthetic content_text, (b) flags representing what platform
 * metadata is realistically available on that platform, (c) a
 * ground-truth label for whether company / role could be resolved
 * with high / medium / low confidence given a perfect enrichment
 * implementation.
 *
 * Outputs:
 *   - Company resolution rate (high-confidence)
 *   - Role resolution rate (high or medium)
 *   - Confidence distribution
 *   - Expected actionability-score improvement from enrichment alone
 */

type Platform = 'reddit' | 'x' | 'linkedin' | 'github' | 'hackernews' | 'discord';

type ProfileAvailability = {
  /** Platform exposes a structured profile with title/company fields. */
  has_structured_profile: boolean;
  /** Platform exposes a bio / description string we can scrape. */
  has_bio_text: boolean;
  /** A public profile URL is dereferenceable. */
  has_profile_url: boolean;
};

const PLATFORM_PROFILE_AVAILABILITY: Record<Platform, ProfileAvailability> = {
  // Reddit: only username + karma + frequented subreddits via API. No
  // structured title/company, bios are free-text and rare.
  reddit:     { has_structured_profile: false, has_bio_text: false, has_profile_url: true  },
  // X: bio is rich (title + employer common), URL is dereferenceable.
  x:          { has_structured_profile: false, has_bio_text: true,  has_profile_url: true  },
  // LinkedIn: structured everything when accessible (auth or scraped).
  linkedin:   { has_structured_profile: true,  has_bio_text: true,  has_profile_url: true  },
  // GitHub: bio + company field + location.
  github:     { has_structured_profile: true,  has_bio_text: true,  has_profile_url: true  },
  // Hacker News: handle only. No bio. No metadata.
  hackernews: { has_structured_profile: false, has_bio_text: false, has_profile_url: false },
  // Discord: handle + display name only.
  discord:    { has_structured_profile: false, has_bio_text: false, has_profile_url: false },
};

type Fixture = {
  id: string;
  platform: Platform;
  has_author_handle: boolean;
  content: string;
  /**
   * Ground-truth label for inspection: what *should* be resolvable
   * given a perfect implementation? Used to validate the rule below
   * matches expectations.
   */
  notes: string;
};

const FIXTURES: Fixture[] = [
  // ---- Reddit (20) — handle + subreddit, content varies ----
  { id: 'rd01', platform: 'reddit', has_author_handle: true,
    content: "Looking for a CRM that doesn't suck. I'm a CTO at a 20-person fintech startup. Budget is tight.",
    notes: 'Explicit company size + explicit role' },
  { id: 'rd02', platform: 'reddit', has_author_handle: true,
    content: "As a sales manager at a Series A SaaS, our team is evaluating Outreach vs Salesloft.",
    notes: 'Explicit role + company stage' },
  { id: 'rd03', platform: 'reddit', has_author_handle: true,
    content: "We at Stripe are looking at CDP options for our marketing team.",
    notes: 'Explicit company (Stripe)' },
  { id: 'rd04', platform: 'reddit', has_author_handle: true,
    content: "Marketing director here — need a better attribution tool.",
    notes: 'Role only' },
  { id: 'rd05', platform: 'reddit', has_author_handle: true,
    content: "I work at HubSpot but we still use Pipedrive internally for one team. Weird I know.",
    notes: 'Explicit employer mention' },
  { id: 'rd06', platform: 'reddit', has_author_handle: true,
    content: "Looking for a CRM that doesn't suck.",
    notes: 'No identity signals beyond handle' },
  { id: 'rd07', platform: 'reddit', has_author_handle: true,
    content: "Need a marketing automation tool that does email + landing pages.",
    notes: 'No identity signals' },
  { id: 'rd08', platform: 'reddit', has_author_handle: true,
    content: "Founder of a B2B SaaS, just got budget for a sales engagement tool. Recommendations?",
    notes: 'Role + company segment' },
  { id: 'rd09', platform: 'reddit', has_author_handle: true,
    content: "Migrating from HubSpot to Pipedrive. Anyone done it cleanly?",
    notes: 'Mentions vendors but not employer' },
  { id: 'rd10', platform: 'reddit', has_author_handle: true,
    content: "DevOps engineer at a 50-person company — Datadog is too expensive.",
    notes: 'Role + company size' },
  { id: 'rd11', platform: 'reddit', has_author_handle: true,
    content: "I'm the head of RevOps at a Series B fintech. Need to consolidate our stack.",
    notes: 'Role + company segment + stage' },
  { id: 'rd12', platform: 'reddit', has_author_handle: true,
    content: "We just hired a senior ML engineer — looking for our 2nd one.",
    notes: 'Hiring signal but no employer' },
  { id: 'rd13', platform: 'reddit', has_author_handle: true,
    content: "Zendesk is broken — tickets disappearing for the last week.",
    notes: 'Complaint, no identity' },
  { id: 'rd14', platform: 'reddit', has_author_handle: true,
    content: "Comparing Pinecone vs Weaviate for our embedding pipeline.",
    notes: 'No identity' },
  { id: 'rd15', platform: 'reddit', has_author_handle: true,
    content: "Hi I'm Sarah, VP of Marketing at Acme. We're evaluating MAP tools.",
    notes: 'Name + role + employer' },
  { id: 'rd16', platform: 'reddit', has_author_handle: true,
    content: "Anyone else find recruiters annoying? Looking for an ATS that filters them out lol.",
    notes: 'Vague, no identity' },
  { id: 'rd17', platform: 'reddit', has_author_handle: true,
    content: "Just got promoted to head of growth at a 100-person fintech. What's the stack everyone uses?",
    notes: 'Role + company size' },
  { id: 'rd18', platform: 'reddit', has_author_handle: true,
    content: "I run a 5-person agency and need a better project management tool.",
    notes: 'Company segment + role implied (owner)' },
  { id: 'rd19', platform: 'reddit', has_author_handle: true,
    content: "Need a SOC 2 automation platform. Vanta or Drata?",
    notes: 'Vendors named, no employer' },
  { id: 'rd20', platform: 'reddit', has_author_handle: true,
    content: "Connecting Mixpanel to Segment — anyone done this cleanly?",
    notes: 'Integration question, no identity' },

  // ---- X/Twitter (12) — bio commonly has title + company ----
  { id: 'xt01', platform: 'x', has_author_handle: true,
    content: "Anyone got a CRM recommendation? Our outbound team is hitting limits with HubSpot.",
    notes: 'Bio likely has role + employer' },
  { id: 'xt02', platform: 'x', has_author_handle: true,
    content: "@hubspot pricing tiers are getting absurd. Looking at Pipedrive.",
    notes: 'Bio + named competitor' },
  { id: 'xt03', platform: 'x', has_author_handle: true,
    content: "We just signed off on Datadog migration. Bye Splunk!",
    notes: 'Bio + named tools' },
  { id: 'xt04', platform: 'x', has_author_handle: true,
    content: "Hiring our 5th senior backend engineer.",
    notes: 'Hiring; bio carries employer' },
  { id: 'xt05', platform: 'x', has_author_handle: true,
    content: "I'm the founder of Acme. We're evaluating LLM providers.",
    notes: 'Explicit founder + employer' },
  { id: 'xt06', platform: 'x', has_author_handle: true,
    content: "Comparing Outreach and Salesloft for our team.",
    notes: 'Bio + named tools' },
  { id: 'xt07', platform: 'x', has_author_handle: true,
    content: "Why is every CRM either too expensive or too dumb?",
    notes: 'Vent; bio still useful' },
  { id: 'xt08', platform: 'x', has_author_handle: true,
    content: "Just got budget for a sales engagement tool 💰",
    notes: 'Bio carries employer' },
  { id: 'xt09', platform: 'x', has_author_handle: true,
    content: "Marketing leader here — need recommendations for attribution.",
    notes: 'Explicit role + bio' },
  { id: 'xt10', platform: 'x', has_author_handle: true,
    content: "We're hiring a staff ML engineer at @anthropic — DM me.",
    notes: 'Named employer + role' },
  { id: 'xt11', platform: 'x', has_author_handle: true,
    content: "Switching from Greenhouse to Lever. Both have rough edges.",
    notes: 'Bio carries employer' },
  { id: 'xt12', platform: 'x', has_author_handle: false,
    content: "(quoted RT, original author anonymous)",
    notes: 'No handle — anonymous RT chain' },

  // ---- LinkedIn (8) — full structured profile assumed ----
  { id: 'li01', platform: 'linkedin', has_author_handle: true,
    content: "Excited to share our team is evaluating new CRM platforms for the B2B segment.",
    notes: 'Profile resolves title + company directly' },
  { id: 'li02', platform: 'linkedin', has_author_handle: true,
    content: "We're hiring across product, engineering, and design.",
    notes: 'Profile resolves employer' },
  { id: 'li03', platform: 'linkedin', has_author_handle: true,
    content: "Looking for recommendations on procurement platforms for a 300-person org.",
    notes: 'Profile resolves; company size in content' },
  { id: 'li04', platform: 'linkedin', has_author_handle: true,
    content: "Migration from on-prem to cloud is harder than expected.",
    notes: 'Profile resolves' },
  { id: 'li05', platform: 'linkedin', has_author_handle: true,
    content: "Just promoted to VP of RevOps. Time to clean up our tooling.",
    notes: 'Role change announcement + profile resolves' },
  { id: 'li06', platform: 'linkedin', has_author_handle: true,
    content: "Anyone else struggling with Workday consolidation?",
    notes: 'Profile resolves' },
  { id: 'li07', platform: 'linkedin', has_author_handle: true,
    content: "Comparing ATS vendors for our recruiting team.",
    notes: 'Profile resolves' },
  { id: 'li08', platform: 'linkedin', has_author_handle: true,
    content: "Excited to start at Acme Corp as Head of Engineering!",
    notes: 'New role + employer explicit' },

  // ---- GitHub (4) — handle + bio + optional company field ----
  { id: 'gh01', platform: 'github', has_author_handle: true,
    content: "Looking for a feature flag service. We've outgrown homemade.",
    notes: 'Profile carries company field sometimes' },
  { id: 'gh02', platform: 'github', has_author_handle: true,
    content: "Integrating Auth0 — webhook for user changes?",
    notes: 'Bio sometimes carries title' },
  { id: 'gh03', platform: 'github', has_author_handle: true,
    content: "PR comment — pinging a maintainer about a regression.",
    notes: 'Bio rare; mostly handle' },
  { id: 'gh04', platform: 'github', has_author_handle: true,
    content: "Issue: WMS sync to Stripe failing intermittently.",
    notes: 'Bio sometimes carries company' },

  // ---- Hacker News (4) — handle only ----
  { id: 'hn01', platform: 'hackernews', has_author_handle: true,
    content: "What's the best observability tool in 2026? Datadog is too expensive for us.",
    notes: 'No metadata; content may hint' },
  { id: 'hn02', platform: 'hackernews', has_author_handle: true,
    content: "Switching from Postgres to Neon. The migration tooling is rough.",
    notes: 'No metadata; vendor names only' },
  { id: 'hn03', platform: 'hackernews', has_author_handle: true,
    content: "Working at a 1000-person fintech. Our compliance stack is overkill.",
    notes: 'Vague company size; no specific employer' },
  { id: 'hn04', platform: 'hackernews', has_author_handle: true,
    content: "As CTO of a Series B AI startup, looking for vector DB recommendations.",
    notes: 'Explicit role + company segment' },

  // ---- Discord (2) — handle, no other metadata ----
  { id: 'dc01', platform: 'discord', has_author_handle: true,
    content: "We're evaluating new CRM tools. Marketing director here.",
    notes: 'Role mentioned; no profile' },
  { id: 'dc02', platform: 'discord', has_author_handle: true,
    content: "Need integration for Stripe + QuickBooks.",
    notes: 'Vendor mention; no identity' },
];

// ---------------------------------------------------------------------------
// Heuristic signal extraction (READ-ONLY)
// ---------------------------------------------------------------------------

/** Explicit employer mention: "at Acme", "@Acme", "I work at X", "we at X are". */
function detectsCompanyMention(content: string): boolean {
  return /\b(?:work(?:ing)? at|founder of|head of [a-z]+ at|at\s+(?:[A-Z][a-zA-Z]+|@[a-z]+)|we at [A-Z][a-zA-Z]+|excited to start at [A-Z])\b/.test(content)
    || /@(?:[a-z]+)\b/i.test(content);
}

/**
 * Role mention. Conservative regex — covers explicit role tokens with
 * common preceding cues so "engineer in the room" doesn't false-fire.
 */
function detectsRoleMention(content: string): boolean {
  return /\b(?:I'?m the |I am the |I'?m a |I am a |As a |as a |head of |VP of |C(?:T|E|F|M|O|RO)O\b|founder|director|manager|recruiter|engineer here|leader here|analyst here|specialist here)\b/i.test(content)
    || /\b(CTO|CEO|CFO|CMO|COO|CRO|CIO|CISO|VP|director|founder|head of [a-z]+|sales manager|marketing director|marketing leader|product manager|growth lead|devops|recruiting team|head of growth)\b/i.test(content);
}

/** Hints about company size / segment — useful as auxiliary confidence. */
function detectsCompanySegment(content: string): boolean {
  return /\b(\d{1,4}-person|\d{1,4} person|series [a-d]|seed|smb|enterprise|startup|agency|firm)\b/i.test(content);
}

type Resolution = {
  company: 'high' | 'medium' | 'low' | 'none';
  role:    'high' | 'medium' | 'low' | 'none';
  overall: 'high_confidence' | 'medium_confidence' | 'low_confidence' | 'unresolvable';
};

function resolveForFixture(fx: Fixture): Resolution {
  const profile = PLATFORM_PROFILE_AVAILABILITY[fx.platform];

  const explicitCompany = detectsCompanyMention(fx.content);
  const explicitRole    = detectsRoleMention(fx.content);
  const segmentHint     = detectsCompanySegment(fx.content);

  // ---- Company resolution ----
  let company: Resolution['company'] = 'none';
  if (!fx.has_author_handle && !explicitCompany) {
    company = 'none';
  } else if (explicitCompany) {
    // Direct mention is highest confidence.
    company = 'high';
  } else if (profile.has_structured_profile) {
    // Platform exposes a company field directly (LinkedIn, GitHub).
    company = 'high';
  } else if (profile.has_bio_text) {
    // X bio carries employer most of the time but not always.
    company = 'medium';
  } else if (segmentHint) {
    // Only segment ("Series B fintech") — type of company but not named.
    company = 'low';
  } else {
    // Handle + community only.
    company = 'low';
  }

  // ---- Role resolution ----
  let role: Resolution['role'] = 'none';
  if (!fx.has_author_handle && !explicitRole) {
    role = 'none';
  } else if (explicitRole) {
    role = 'high';
  } else if (profile.has_structured_profile) {
    role = 'high';
  } else if (profile.has_bio_text) {
    role = 'medium';
  } else {
    role = 'low';
  }

  // ---- Overall confidence ----
  // High = both company AND role resolvable at >= medium.
  // Medium = one of them resolvable at >= medium.
  // Low = at least one signal but neither fully resolvable.
  // Unresolvable = no handle and no content signal.
  const cScore = company === 'high' ? 3 : company === 'medium' ? 2 : company === 'low' ? 1 : 0;
  const rScore = role    === 'high' ? 3 : role    === 'medium' ? 2 : role    === 'low' ? 1 : 0;
  const total = cScore + rScore;

  let overall: Resolution['overall'];
  if (cScore === 0 && rScore === 0) overall = 'unresolvable';
  else if (total >= 5) overall = 'high_confidence';
  else if (total >= 3) overall = 'medium_confidence';
  else overall = 'low_confidence';

  return { company, role, overall };
}

// ---------------------------------------------------------------------------
// Aggregate + report
// ---------------------------------------------------------------------------

function main() {
  console.log('================================================================');
  console.log('Active Leads — Opportunity Identity Enrichment Feasibility Audit');
  console.log(`Fixtures: ${FIXTURES.length}`);
  console.log('================================================================\n');

  console.log('--- Per-fixture resolution ---');
  console.log('id    | platform   | handle | company    | role       | overall');
  console.log('------+------------+--------+------------+------------+-------------------');
  const outcomes = FIXTURES.map((fx) => ({ fx, res: resolveForFixture(fx) }));
  for (const { fx, res } of outcomes) {
    console.log(
      [
        fx.id.padEnd(5),
        fx.platform.padEnd(10),
        (fx.has_author_handle ? 'Y' : 'N').padEnd(6),
        res.company.padEnd(10),
        res.role.padEnd(10),
        res.overall,
      ].join(' | '),
    );
  }

  // Aggregate
  const total = outcomes.length;
  const companyHighRate    = outcomes.filter((o) => o.res.company === 'high').length / total;
  const companyMedRate     = outcomes.filter((o) => o.res.company === 'medium').length / total;
  const companyResolvable  = outcomes.filter((o) => o.res.company === 'high' || o.res.company === 'medium').length / total;

  const roleHighRate    = outcomes.filter((o) => o.res.role === 'high').length / total;
  const roleMedRate     = outcomes.filter((o) => o.res.role === 'medium').length / total;
  const roleResolvable  = outcomes.filter((o) => o.res.role === 'high' || o.res.role === 'medium').length / total;

  const distribution = {
    high_confidence:   outcomes.filter((o) => o.res.overall === 'high_confidence').length,
    medium_confidence: outcomes.filter((o) => o.res.overall === 'medium_confidence').length,
    low_confidence:    outcomes.filter((o) => o.res.overall === 'low_confidence').length,
    unresolvable:      outcomes.filter((o) => o.res.overall === 'unresolvable').length,
  };

  // Per-platform breakdown
  const platforms = Array.from(new Set(FIXTURES.map((f) => f.platform)));
  console.log('\n--- Per-platform supply ---');
  for (const platform of platforms) {
    const subset = outcomes.filter((o) => o.fx.platform === platform);
    const high   = subset.filter((o) => o.res.overall === 'high_confidence').length;
    const med    = subset.filter((o) => o.res.overall === 'medium_confidence').length;
    const low    = subset.filter((o) => o.res.overall === 'low_confidence').length;
    const unres  = subset.filter((o) => o.res.overall === 'unresolvable').length;
    console.log(`  ${platform.padEnd(10)}  n=${String(subset.length).padStart(2)}  high=${high}  med=${med}  low=${low}  unres=${unres}`);
  }

  // Expected actionability improvement.
  //
  // The actionability audit currently caps Context Richness at 2 / 3
  // (handle + platform + source_identifier). Enrichment promotes the
  // ceiling to 3 when company AND role are resolvable.
  //
  //   high_confidence  → dim 4 = 3.0  (handle + company + role)
  //   medium_confidence → dim 4 = 2.5  (partial enrichment)
  //   low_confidence    → dim 4 = 2.0  (no change from baseline)
  //   unresolvable      → dim 4 = 2.0  (no change)
  const dim4PerFixture =
    (distribution.high_confidence   * 3.0
   + distribution.medium_confidence * 2.5
   + distribution.low_confidence    * 2.0
   + distribution.unresolvable      * 2.0) / total;
  const dim4Baseline = 2.0;
  const dim4Lift = dim4PerFixture - dim4Baseline; // per fixture, 0..1

  // The actionability audit total avg (post OPA-1, OPA-2) was 11.74 / 18.
  // Adding dim4Lift per fixture lifts the total by that amount.
  const baselineTotal = 11.74;
  const newTotal = baselineTotal + dim4Lift;
  const baselineScore = (baselineTotal / 18) * 10;
  const newScore = (newTotal / 18) * 10;

  console.log('\n--- Cohort metrics ---');
  console.log(`  Total fixtures:                                 ${total}`);
  console.log(`  Company high-confidence rate:                   ${(companyHighRate * 100).toFixed(1)}%`);
  console.log(`  Company medium-confidence rate:                 ${(companyMedRate  * 100).toFixed(1)}%`);
  console.log(`  Company resolvable (high or medium):            ${(companyResolvable * 100).toFixed(1)}%`);
  console.log(`  Role high-confidence rate:                      ${(roleHighRate * 100).toFixed(1)}%`);
  console.log(`  Role medium-confidence rate:                    ${(roleMedRate  * 100).toFixed(1)}%`);
  console.log(`  Role resolvable (high or medium):               ${(roleResolvable * 100).toFixed(1)}%`);
  console.log('');
  console.log('  Confidence distribution:');
  console.log(`    High confidence:   ${distribution.high_confidence}  (${(distribution.high_confidence / total * 100).toFixed(1)}%)`);
  console.log(`    Medium confidence: ${distribution.medium_confidence}  (${(distribution.medium_confidence / total * 100).toFixed(1)}%)`);
  console.log(`    Low confidence:    ${distribution.low_confidence}  (${(distribution.low_confidence / total * 100).toFixed(1)}%)`);
  console.log(`    Unresolvable:      ${distribution.unresolvable}  (${(distribution.unresolvable / total * 100).toFixed(1)}%)`);
  console.log('');
  console.log('  Expected Actionability Score improvement:');
  console.log(`    Baseline (post OPA-1 + OPA-2):                ${baselineScore.toFixed(1)} / 10`);
  console.log(`    Avg dim 4 (Context Richness) lift:            +${dim4Lift.toFixed(2)} per fixture`);
  console.log(`    Projected actionability score after:          ${newScore.toFixed(1)} / 10  (Δ +${(newScore - baselineScore).toFixed(1)})`);

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