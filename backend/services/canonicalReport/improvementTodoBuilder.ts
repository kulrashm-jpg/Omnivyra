// ── Quantified Improvement Plan builder ───────────────────────────────────────
//
// Turns each measurably weak canonical dimension into a concrete to-do: WHAT to do,
// HOW to do it (ordered steps), and HOW MUCH it will improve the score.
//
// The "how much" is not a linear estimate. It is recomputed from the SAME aggregation
// the scoring engine uses — pillar score = average of its measured dimensions; overall
// score = geometric mean of the measured pillars (see canonicalReportBuilder
// aggregatePillarScore / aggregateOverallScore + scoringGovernance.geometricMean). We
// raise the one weak dimension to its target, re-run both aggregations, and report the
// true delta. This never overstates: a single low dimension inside a geometric mean
// moves the overall only as much as the real formula allows.

import { geometricMean } from './scoringGovernance';
import {
  PILLAR_META,
  type CanonicalActionEffort,
  type CanonicalDimensionKey,
  type CanonicalDimensionTodo,
  type CanonicalPillarScore,
  type CanonicalScore,
  type ConfidenceBand,
  type PillarKey,
} from './canonicalReportTypes';

// A dimension at or above this measured value is "solid" — no urgent to-do is emitted.
const WEAK_THRESHOLD = 70;
// A strong, credible target band (not perfection). The projection aims here.
const TARGET_CAP = 85;
// Cap the claimed single-plan-cycle lift so projections stay realistic even for a
// dimension starting very low (a 30→85 jump in one cycle is not a credible promise).
const MAX_SINGLE_CYCLE_LIFT = 25;

type ScoreState = CanonicalScore['state'];

// Mirror of the (non-exported) isMeasured predicate in canonicalReportBuilder so the
// recomputation counts exactly the same dimensions/pillars the live aggregation does.
function isMeasured(value: number | null | undefined, state: ScoreState | undefined): boolean {
  return typeof value === 'number' && state !== 'insufficient_signal' && state !== 'unavailable';
}

function roundedMean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Overall aggregation, identical to aggregateOverallScore: rounded, clamped geometric mean.
function overallFromPillars(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(clamp(geometricMean(values), 0, 100));
}

type RemediationEntry = {
  what: string;
  how: string[];
  effort: CanonicalActionEffort;
  owner_area: CanonicalDimensionTodo['owner_area'];
};

// Real, dimension-specific remediation guidance. Keyed by the canonical dimension so
// each weak score maps to concrete work — not a generic "improve your SEO" line.
const REMEDIATION: Record<CanonicalDimensionKey, RemediationEntry> = {
  index_integrity: {
    what: 'Make every important page cleanly crawlable, indexable, and internally linked.',
    how: [
      'Crawl the site and list pages returning non-200 status, blocked by robots.txt, or carrying noindex — fix or intentionally remove each.',
      'Ensure every page has a unique <title> and meta description and a single canonical URL; resolve duplicate/conflicting canonicals.',
      'Add internal links from high-authority pages (home, top nav, pillar pages) to orphaned or deep pages so crawlers can reach them in ≤3 clicks.',
      'Submit an up-to-date XML sitemap in Search Console and confirm the important URLs report as indexed.',
    ],
    effort: 'medium',
    owner_area: 'engineering',
  },
  extraction_readiness: {
    what: 'Structure pages so AI and search engines can lift clean, self-contained answers.',
    how: [
      'Lead key pages with a 2–3 sentence summary block that answers the page\'s core question up front.',
      'Use a strict heading hierarchy (one H1, descriptive H2/H3) and short, scannable paragraphs and lists.',
      'Add relevant schema.org structured data (Organization, Product/Service, FAQ, HowTo, Article) and validate it in the Rich Results test.',
      'Break long pages into clearly-labelled sections so each answers one question in isolation.',
    ],
    effort: 'medium',
    owner_area: 'content',
  },
  accessibility: {
    what: 'Raise WCAG conformance and semantic markup so the foundation is healthy for all consumers.',
    how: [
      'Run an automated audit (axe / Lighthouse) and fix critical issues: missing alt text, insufficient colour contrast, unlabeled form fields.',
      'Use semantic HTML landmarks (header, nav, main, footer) and native controls instead of div-based widgets.',
      'Ensure full keyboard operability and a visible focus state on every interactive element.',
      'Add descriptive link text and ARIA labels only where native semantics are insufficient.',
    ],
    effort: 'medium',
    owner_area: 'engineering',
  },
  authority_inflow: {
    what: 'Earn inbound authority — quality backlinks and consistent brand mentions from credible sources.',
    how: [
      'Publish one genuinely link-worthy asset (original data, a definitive guide, a free tool) and pitch it to relevant publications and newsletters.',
      'Reclaim unlinked brand mentions: find sites naming the brand without a link and request one.',
      'Get listed in the authoritative directories and roundups for your category with a consistent name/URL.',
      'Build relationships for guest contributions and expert quotes (HARO-style) to accrue editorial links over time.',
    ],
    effort: 'high',
    owner_area: 'pr',
  },
  entity_graph_strength: {
    what: 'Make the brand a clear, well-linked entity in the knowledge graph.',
    how: [
      'Add complete Organization schema (name, logo, url, sameAs) linking every official profile (LinkedIn, Crunchbase, X, GitHub, Wikidata).',
      'Create or correct the Wikidata entry and, where eligible, a Wikipedia entry, so the entity is machine-verifiable.',
      'Keep the brand name, description, and category identical across all profiles and the site to reinforce one entity.',
      'Cover the core topics with entity-rich pages (about, founders, products) that establish what the brand is known for.',
    ],
    effort: 'high',
    owner_area: 'marketing_ops',
  },
  topical_authority: {
    what: 'Deepen and broaden coverage of the brand\'s core topic cluster.',
    how: [
      'Map the full topic cluster: one pillar page per core theme plus supporting pages for each subtopic and question.',
      'Fill the gaps — publish the missing subtopic pages and interlink them to the pillar so the cluster is complete.',
      'Refresh thin or shallow pages with original depth: examples, data, and answers competitors do not provide.',
      'Interlink related pages with descriptive anchors so the cluster reads as a coherent, authoritative body of work.',
    ],
    effort: 'high',
    owner_area: 'content',
  },
  ai_surface_presence: {
    what: 'Increase how often AI answer engines surface and cite the brand.',
    how: [
      'Publish direct, citable answers to the category\'s real questions (definitions, comparisons, "how to") in clean, extractable format.',
      'Strengthen extraction readiness (summaries, headings, schema) so AI engines can quote the page confidently.',
      'Reinforce the entity graph and third-party mentions AI models draw on — consistent facts across the web raise citation odds.',
      'Track branded and category prompts across ChatGPT/Gemini/Perplexity and close the gaps where a competitor is cited instead.',
    ],
    effort: 'high',
    owner_area: 'content',
  },
  trust_coherence: {
    what: 'Make the brand\'s description, proof, and reputation consistent and verifiable everywhere.',
    how: [
      'Align the one-line description, category, and key claims across the site, social profiles, and directories so they tell one story.',
      'Surface concrete proof on-site: named case studies, testimonials, logos, credentials, and verifiable outcomes.',
      'Actively gather reviews on the platforms your buyers trust and respond to them to signal an active, credible brand.',
      'Publish trust essentials — clear about/contact, team, privacy, and security pages — that both users and models can verify.',
    ],
    effort: 'medium',
    owner_area: 'marketing_ops',
  },
  authority_velocity: {
    what: 'Establish a steady publishing cadence so the site reads as active and current.',
    how: [
      'Set and hold a realistic cadence (e.g. weekly) for new or substantially updated content.',
      'Refresh the highest-value existing pages on a schedule — update facts, dates, and examples so freshness signals stay strong.',
      'Maintain a rolling content calendar tied to the topic cluster so publishing is continuous, not sporadic.',
      'Show recency where it matters (visible published/updated dates, a live changelog or blog) so the momentum is observable.',
    ],
    effort: 'medium',
    owner_area: 'content',
  },
};

/**
 * Builds the quantified improvement plan: one to-do per measurably weak dimension,
 * each carrying the exact projected point gain, ordered by overall leverage (highest
 * first). Returns [] when the overall score is unmeasurable or nothing is weak.
 */
export function buildImprovementTodos(
  pillars: CanonicalPillarScore[],
  overall: CanonicalScore,
): CanonicalDimensionTodo[] {
  const baselineOverall = overall.value;
  if (!isMeasured(baselineOverall, overall.state) || typeof baselineOverall !== 'number') {
    return [];
  }

  // Current measured pillar values, used as the baseline vector for the overall recompute.
  const measuredPillars = pillars.filter((p) => isMeasured(p.score.value, p.score.state));

  const todos: CanonicalDimensionTodo[] = [];

  for (const pillar of pillars) {
    const currentPillarValue = pillar.score.value;
    if (!isMeasured(currentPillarValue, pillar.score.state) || typeof currentPillarValue !== 'number') {
      continue;
    }

    const measuredDims = pillar.dimensions.filter((d) => isMeasured(d.score.value, d.score.state));

    for (const dim of measuredDims) {
      const current = dim.score.value as number;
      if (current >= WEAK_THRESHOLD) continue;

      const target = Math.min(TARGET_CAP, current + MAX_SINGLE_CYCLE_LIFT);
      if (target <= current) continue;

      // Recompute this pillar's average with the weak dimension raised to target.
      const newDimValues = measuredDims.map((d) => (d.key === dim.key ? target : (d.score.value as number)));
      const newPillarValue = roundedMean(newDimValues);
      const projectedPillarGain = Math.max(0, newPillarValue - currentPillarValue);

      // Recompute the overall geometric mean with this pillar's new value substituted in.
      const newOverallVector = measuredPillars.map((p) =>
        p.pillar === pillar.pillar ? newPillarValue : (p.score.value as number),
      );
      const newOverall = overallFromPillars(newOverallVector);
      const projectedOverallGain = Math.max(0, newOverall - baselineOverall);

      const remedy = REMEDIATION[dim.key];

      todos.push({
        dimension: dim.key,
        dimension_label: dim.label,
        pillar: pillar.pillar,
        pillar_label: PILLAR_META[pillar.pillar].label,
        current_score: current,
        target_score: target,
        what: remedy.what,
        how: remedy.how,
        projected_pillar_gain: projectedPillarGain,
        projected_overall_gain: projectedOverallGain,
        effort: remedy.effort,
        confidence: dim.score.confidence as ConfidenceBand,
        owner_area: remedy.owner_area,
      });
    }
  }

  // Highest-leverage first: overall gain, then pillar gain, then the lowest current
  // score (most broken) as a final tie-break.
  return todos.sort((a, b) => {
    if (b.projected_overall_gain !== a.projected_overall_gain) {
      return b.projected_overall_gain - a.projected_overall_gain;
    }
    if (b.projected_pillar_gain !== a.projected_pillar_gain) {
      return b.projected_pillar_gain - a.projected_pillar_gain;
    }
    return a.current_score - b.current_score;
  });
}

// Exposed for tests: the tunable thresholds so the projection contract is lockable.
export const IMPROVEMENT_TODO_TUNING = {
  WEAK_THRESHOLD,
  TARGET_CAP,
  MAX_SINGLE_CYCLE_LIFT,
} as const;
