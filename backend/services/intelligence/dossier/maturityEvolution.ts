// Maturity Evolution Narrative.
//
// Upgrades the maturity layer from static stage labelling to evolutionary
// storytelling. Every measured brand resolves to a structured narrative
// that answers, in order:
//
//   1. Why the brand is in this stage              — why_this_stage
//   2. The stage progression (current → next)      — stage_progression
//   3. What blocks advancement (transition friction) — transition_friction
//   4. What unlocks the next stage                 — unlock_path
//
// The stage progression is a single developmental flow that names what
// the current stage looks like AND what the next stage typically looks
// like — replacing the older split rows ("characteristics" + "what higher
// systems exhibit") with one tighter narrative.
//
// Stage progression is a restrained pattern observation that follows from
// the canonical 6-stage maturity model. NOT a fabricated benchmark.
// Transition friction is derived deterministically from the weakest
// measured dimension and pillar — it names the specific signal that
// prevents stage advancement.
//
// Signature language threaded through:
//   maturity transition friction, retrieval consistency, corroboration
//   density, trust coherence, authority propagation, discoverability
//   friction, authority reinforcement.

import type {
  CanonicalDimensionKey,
  CanonicalReport,
  PillarKey,
} from '../../canonicalReport/canonicalReportTypes';

export type MaturityEvolution = {
  why_this_stage: string;
  /** Combined developmental flow: what this stage is and what the next stage typically looks like. */
  stage_progression: string;
  transition_friction: string;
  unlock_path: string;
};

type MaturityStage =
  | 'foundational'
  | 'emerging'
  | 'developing'
  | 'operational'
  | 'advanced'
  | 'leading';

// Stage-progression narratives. Each entry is a single developmental
// paragraph that names the current stage's defining characteristic AND
// the shape of the next stage — replacing the older split rows with one
// tighter flow. At leading, there is no further stage; the second
// sentence becomes a posture observation rather than a forward look.

const STAGE_PROGRESSION: Record<MaturityStage, string> = {
  foundational:
    'At this stage the substrate is still forming — crawl integrity, schema readiness, and structural extractability define the work. The next stage carries early external corroboration: a working entity record, a handful of authoritative mentions, and content AI surfaces can find without effort.',
  emerging:
    'Directional readiness exists but external reinforcement is sparse — the brand can be found, but its presence is not yet widely corroborated. The next stage exhibits consistent retrieval across at least two AI surfaces and a coherent set of corroborating sources; the shape of authority becomes recognisable rather than circumstantial.',
  developing:
    'Authority signals are becoming coherent, but discoverability and corroboration remain uneven. The next stage runs a predictable authority cadence — content the ecosystem cites, reviews that match brand assertion, retrieval that holds across query classes. Authority propagation works as a system, not as isolated wins.',
  operational:
    'The brand demonstrates consistent authority behaviour across major discovery and trust surfaces; effort produces predictable signal. The next stage owns a recognisable thesis — citation patterns reflect identification with a position, not merely competence at producing content about it.',
  advanced:
    'The authority system runs reliably and self-reinforces; the work shifts from generation to differentiation. The next stage institutionalises the inputs that produced the position — authority survives leadership changes, focus shifts, and market noise because the rituals are codified rather than personality-led.',
  leading:
    'Authority is externally reinforced, strategically coherent, and consistently retrievable across AI and search ecosystems. There is no further stage — the strategic posture inverts to defence; maintaining the substrate of the position becomes the work.',
};

// ── Transition friction ────────────────────────────────────────────────────
//
// Per-dimension friction templates. The classifier picks the lowest-scoring
// measured dimension, then maps it to the dimension's friction interpretation.
// If the weakest dimension cannot be isolated, falls back to the weakest
// pillar's friction; if neither can be isolated, returns a neutral string.

const DIMENSION_FRICTION: Record<CanonicalDimensionKey, string> = {
  index_integrity:
    'Foundational integrity gaps — crawl health and indexability are blocking the substrate every other pillar relies on. Discoverability friction here cascades into every retrieval surface downstream.',
  extraction_readiness:
    'Structural extractability is the bottleneck — even strong content does not surface where evaluators look. Without machine-readable structure, AI surfaces cannot reliably extract answers, and authority propagation stalls at the page level.',
  authority_inflow:
    'Insufficient external corroboration — the authority footprint outside the brand\'s own surfaces is too thin to anchor the next stage. Corroboration density, not on-site assertion, is what evaluators verify against.',
  entity_graph_strength:
    'Inconsistent entity reinforcement — knowledge-graph sameAs targets and structured entity signals do not yet hold a single shape across sources. AI systems require consistent entity identity to retrieve confidently.',
  topical_authority:
    'Insufficient depth across the topic cluster — the brand reads as competent in pockets rather than canonical on a defined territory. Authority propagation requires a topical surface peers can cite back to.',
  ai_surface_presence:
    'Low retrieval consistency — AI surfaces find the brand inconsistently across providers, signalling structural rather than content gaps. The friction is not absence of expertise; it is absence of citation-readiness.',
  trust_coherence:
    'Trust signals do not yet hold one shape — fragmentation across description, NAP, founder credentials, or review parity dilutes external evaluation. Trust coherence is the silent multiplier; its absence quietly suppresses every other pillar.',
  authority_velocity:
    'Authority velocity is below the threshold the next stage requires — publishing cadence and freshness are not yet producing reinforcement signals at the rate that compounds. Momentum, not absolute output, is what changes the read.',
};

const PILLAR_FRICTION_FALLBACK: Record<PillarKey, string> = {
  foundation:
    'Foundational integrity is the rate-limiter — without a stable substrate, work in any other pillar produces signal that does not stick.',
  authority:
    'External authority reinforcement is thin — the brand\'s footprint in the corroborating ecosystem is not yet dense enough to anchor stage advancement.',
  discoverability:
    'Retrieval consistency is the friction — the brand is not yet reliably surfaced where category research happens, regardless of content quality.',
  trust:
    'Trust coherence is fragmented — public-facing signals do not yet hold one shape, suppressing how strongly every other pillar reads.',
  momentum:
    'Authority velocity is below threshold — the rate of new reinforcement signals is not yet sufficient to shift the system into the next stage.',
};

function findWeakestDimension(report: CanonicalReport): { key: CanonicalDimensionKey; value: number } | null {
  let weakest: { key: CanonicalDimensionKey; value: number } | null = null;
  for (const axis of report.discoverability_authority_radar.axes) {
    if (
      typeof axis.score.value === 'number' &&
      axis.score.state !== 'insufficient_signal' &&
      axis.score.state !== 'unavailable'
    ) {
      if (weakest == null || axis.score.value < weakest.value) {
        weakest = { key: axis.key, value: axis.score.value };
      }
    }
  }
  return weakest;
}

function findWeakestPillar(report: CanonicalReport): { pillar: PillarKey; value: number } | null {
  let weakest: { pillar: PillarKey; value: number } | null = null;
  for (const p of report.pillars) {
    if (
      typeof p.score.value === 'number' &&
      p.score.state !== 'insufficient_signal' &&
      p.score.state !== 'unavailable'
    ) {
      if (weakest == null || p.score.value < weakest.value) {
        weakest = { pillar: p.pillar, value: p.score.value };
      }
    }
  }
  return weakest;
}

export function transitionFriction(report: CanonicalReport): string {
  const stage = report.maturity_stage;
  if (stage.stage === 'leading') {
    return 'No further stage exists — the strategic posture is to defend, not advance. Friction at this stage shows up as regression, not blockage; the rituals that produced the position are what protect it.';
  }
  const dim = findWeakestDimension(report);
  if (dim) {
    return DIMENSION_FRICTION[dim.key];
  }
  const pillar = findWeakestPillar(report);
  if (pillar) {
    return PILLAR_FRICTION_FALLBACK[pillar.pillar];
  }
  return 'Maturity transition friction cannot yet be isolated — measurement of the constituent dimensions is still forming. The dossier holds this open until evidence accumulates.';
}

// ── Composer ───────────────────────────────────────────────────────────────

export function composeMaturityEvolution(report: CanonicalReport): MaturityEvolution | null {
  const stageRaw = report.maturity_stage.stage;
  if (stageRaw === 'insufficient_signal') return null;
  const stage = stageRaw as MaturityStage;

  const why = report.maturity_stage.why_this_stage ||
    `The brand reads at the ${report.maturity_stage.label} stage based on its current pillar configuration and supporting evidence.`;

  const stage_progression = STAGE_PROGRESSION[stage];
  const friction = transitionFriction(report);

  const unlock =
    report.maturity_stage.unlock?.explanation ||
    (stage === 'leading'
      ? 'At the leading stage, the unlock inverts: maintenance discipline replaces expansion as the primary form of strategic work.'
      : 'The unlock is concentration. Direct discretionary effort toward the dimension producing the friction above; do not parallel-track until that friction lifts.');

  return {
    why_this_stage: why,
    stage_progression,
    transition_friction: friction,
    unlock_path: unlock,
  };
}
