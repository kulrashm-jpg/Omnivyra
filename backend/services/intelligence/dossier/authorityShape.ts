// Canonical Authority Shape system.
//
// Authority Shape is the dossier's signature interpretation primitive.
// Every brand the platform measures resolves to ONE shape — a short,
// memorable phrase that names the kind of authority system the brand
// currently is. The same shape is referenced from the cover thesis, the
// executive snapshot, the Authority Position section, the strategic
// direction paragraph, and the closing strategic interpretation, so the
// reader leaves the dossier remembering one strategic identity rather
// than a list of metrics.
//
// All shapes are deterministic from canonical pillar scores + AI surface
// presence + change intelligence. No fabrication, no peer claims, no
// alarmism. The classifier is rule-ordered: first match wins.
//
// Signature language threaded through the descriptors:
//   authority reinforcement, retrieval consistency, corroboration density,
//   trust coherence, authority propagation, discoverability friction,
//   maturity transition friction, authority shape.

import type {
  CanonicalPillarScore,
  CanonicalReport,
  PillarKey,
} from '../../canonicalReport/canonicalReportTypes';

export type AuthorityShapeKind =
  | 'compounding_authority'
  | 'established_but_stagnating'
  | 'technically_mature_commercially_invisible'
  | 'structurally_strong_externally_underrecognized'
  | 'ai_visible_but_strategically_fragmented'
  | 'discoverable_but_weakly_corroborated'
  | 'high_trust_low_discoverability'
  | 'narrow_expertise_weak_reinforcement'
  | 'emerging_authority_with_strong_foundations'
  | 'fragmented_authority_presence'
  | 'coherent_foundational_system'
  | 'coherent_operational_system'
  | 'insufficiently_measured_system';

export type AuthorityShape = {
  kind: AuthorityShapeKind;
  /** The canonical, memorable phrase that names this shape. */
  name: string;
  /** A short descriptor (one or two words) used inline in narrative. */
  descriptor: string;
  /** Deterministic explanation of why the brand resolved to this shape. */
  why_this_shape: string;
  /** A single calm interpretive sentence on what the shape implies. */
  what_it_means: string;
};

function pillarMap(report: CanonicalReport): Partial<Record<PillarKey, number>> {
  const out: Partial<Record<PillarKey, number>> = {};
  for (const p of report.pillars) {
    if (typeof p.score.value === 'number' && p.score.state !== 'insufficient_signal' && p.score.state !== 'unavailable') {
      out[p.pillar] = p.score.value;
    }
  }
  return out;
}

function measuredCount(report: CanonicalReport): number {
  return report.pillars.filter(
    (p) => typeof p.score.value === 'number' && p.score.state !== 'insufficient_signal' && p.score.state !== 'unavailable',
  ).length;
}

function spread(values: number[]): { min: number; max: number; gap: number } | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, gap: max - min };
}

function aiScore(report: CanonicalReport): number | null {
  const s = report.ai_surface_presence.score;
  if (s.state === 'insufficient_signal' || s.state === 'unavailable' || typeof s.value !== 'number') return null;
  return s.value;
}

function overallScore(report: CanonicalReport): number | null {
  const s = report.authority_overview.overall_score;
  if (s.state === 'insufficient_signal' || s.state === 'unavailable' || typeof s.value !== 'number') return null;
  return s.value;
}

export function classifyAuthorityShape(report: CanonicalReport): AuthorityShape {
  const m = pillarMap(report);
  const measured = measuredCount(report);
  const overall = overallScore(report);
  const ai = aiScore(report);
  const change = report.change_intelligence;
  const direction = change.state === 'measured' ? change.authority_delta.direction : 'first_observation';
  const sp = spread(Object.values(m));

  if (measured < 2 || overall == null) {
    return {
      kind: 'insufficiently_measured_system',
      name: 'Insufficiently Measured System',
      descriptor: 'unmeasured',
      why_this_shape: 'Fewer than two pillars carry sufficient evidence to classify shape.',
      what_it_means: 'Authority shape cannot yet be read with confidence — the dossier holds the structure honestly until measurement accumulates.',
    };
  }

  // Compounding authority — operational across the board, AI retrieval working, momentum favourable.
  if (
    overall >= 70 &&
    ai != null && ai >= 60 &&
    (m.trust ?? 0) >= 55 &&
    (sp?.min ?? 0) >= 45
  ) {
    return {
      kind: 'compounding_authority',
      name: 'Compounding Authority System',
      descriptor: 'compounding',
      why_this_shape: `Authority Index reads ${overall}/100 with AI retrieval at ${ai}/100, trust at ${m.trust}/100, and no measured pillar below ${sp?.min ?? '—'}/100.`,
      what_it_means: 'Pillars reinforce each other rather than competing for attention. Authority propagation is working — incremental effort now produces non-linear returns.',
    };
  }

  // Established but stagnating — reasonable scores, no movement.
  if (overall >= 55 && (direction === 'stagnated' || direction === 'regressed')) {
    return {
      kind: 'established_but_stagnating',
      name: 'Established but Stagnating',
      descriptor: 'stagnating',
      why_this_shape: `Authority Index reads ${overall}/100, but trajectory is ${direction === 'regressed' ? 'regressing' : 'flat'} versus the last snapshot.`,
      what_it_means: 'The substrate is there; the momentum is not. Holding position in a moving category becomes relative loss over enough quarters.',
    };
  }

  // Technically mature, commercially invisible — strong foundation, weak external surfaces.
  if ((m.foundation ?? 0) >= 65 && (m.authority ?? 100) < 40 && (m.discoverability ?? 100) < 40) {
    return {
      kind: 'technically_mature_commercially_invisible',
      name: 'Technically Mature, Commercially Invisible',
      descriptor: 'invisible',
      why_this_shape: `Foundation reads ${m.foundation}/100, but authority reads ${m.authority}/100 and discoverability reads ${m.discoverability}/100 — the substrate is operational while external reinforcement is not.`,
      what_it_means: 'Technical readiness alone does not produce authority — without corroboration density and retrieval consistency, the brand is invisible to the surfaces that decide consideration.',
    };
  }

  // Structurally strong, externally under-recognized — foundation > authority by a clear gap.
  if ((m.foundation ?? 0) >= 60 && m.authority != null && (m.foundation as number) - m.authority >= 20) {
    return {
      kind: 'structurally_strong_externally_underrecognized',
      name: 'Structurally Strong, Externally Under-Recognised',
      descriptor: 'under-recognised',
      why_this_shape: `Foundation reads ${m.foundation}/100 while authority reads ${m.authority}/100 — a ${(m.foundation as number) - m.authority}-point gap between readiness and corroboration.`,
      what_it_means: 'The brand is prepared to be cited; it is not yet being cited. The bottleneck is signal generation, not signal capacity.',
    };
  }

  // AI-visible but strategically fragmented — AI surface working, but pillars fly apart.
  if (ai != null && ai >= 55 && sp && sp.gap >= 25) {
    return {
      kind: 'ai_visible_but_strategically_fragmented',
      name: 'AI-Visible but Strategically Fragmented',
      descriptor: 'fragmented',
      why_this_shape: `AI surface presence reads ${ai}/100, but the spread between strongest and weakest pillar is ${sp.gap} points — visibility is real, coherence is not.`,
      what_it_means: 'AI retrieval can outrun the rest of the system for one or two cycles, but unsupported retrieval gains are fragile. Coherence between pillars is what makes them durable.',
    };
  }

  // Discoverable but weakly corroborated — discoverability up, trust + authority down.
  if ((m.discoverability ?? 0) >= 55 && (m.trust ?? 100) < 40 && (m.authority ?? 100) < 50) {
    return {
      kind: 'discoverable_but_weakly_corroborated',
      name: 'Discoverable but Weakly Corroborated',
      descriptor: 'weakly corroborated',
      why_this_shape: `Discoverability reads ${m.discoverability}/100 with trust at ${m.trust}/100 and authority at ${m.authority}/100 — the brand is found, but it is not yet vouched for.`,
      what_it_means: 'Visibility without corroboration density converts inefficiently to consideration. Evaluators encounter the brand and then look for confirmation that is not there.',
    };
  }

  // High trust, low discoverability — trust-heavy but quiet on the surfaces that matter.
  if ((m.trust ?? 0) >= 55 && m.discoverability != null && (m.trust as number) - m.discoverability >= 20) {
    return {
      kind: 'high_trust_low_discoverability',
      name: 'High Trust, Low Discoverability',
      descriptor: 'quiet',
      why_this_shape: `Trust reads ${m.trust}/100 while discoverability reads ${m.discoverability}/100 — coherence exists, exposure does not.`,
      what_it_means: 'Trust coherence is intact, but the corroborated story reaches a narrower audience than the brand could carry. The work shifts from earning trust to expanding the surfaces on which it is visible.',
    };
  }

  // Narrow expertise, weak reinforcement — authority recognised, but isolated.
  if ((m.authority ?? 0) >= 55 && (m.discoverability ?? 100) < 40 && (m.trust ?? 100) < 40) {
    return {
      kind: 'narrow_expertise_weak_reinforcement',
      name: 'Narrow Expertise, Weak Reinforcement',
      descriptor: 'narrow',
      why_this_shape: `Authority reads ${m.authority}/100 but neither discoverability (${m.discoverability ?? '—'}/100) nor trust (${m.trust ?? '—'}/100) reinforces it.`,
      what_it_means: 'The brand carries credible expertise, but the corroborating ecosystem is thin. Without authority propagation across more surfaces, the expertise stays local rather than becoming categorical.',
    };
  }

  // Emerging authority with strong foundations — foundation operational, others still forming.
  if ((m.foundation ?? 0) >= 50 && (m.authority ?? 0) < 50 && overall < 50) {
    return {
      kind: 'emerging_authority_with_strong_foundations',
      name: 'Emerging Authority with Strong Foundations',
      descriptor: 'emerging',
      why_this_shape: `Foundation reads ${m.foundation}/100 while authority reads ${m.authority ?? '—'}/100 and the overall index reads ${overall}/100 — the substrate is in place, the corroborating signals are still building.`,
      what_it_means: 'The brand has done the unglamorous work; the next move is signal generation. Foundations of this quality predictably translate into authority once external reinforcement begins.',
    };
  }

  // Fragmented — large pillar spread without one of the named profiles.
  if (sp && sp.gap >= 30) {
    return {
      kind: 'fragmented_authority_presence',
      name: 'Fragmented Authority Presence',
      descriptor: 'fragmented',
      why_this_shape: `The spread between strongest and weakest measured pillar is ${sp.gap} points (${sp.min}/100 to ${sp.max}/100) — the system is not moving as one.`,
      what_it_means: 'Fragmented systems convert effort inefficiently — one pillar pulls forward while another holds the rest back. Closing the spread matters more than lifting the average.',
    };
  }

  // Coherent foundational — early but uniform.
  if (sp && sp.max <= 35 && sp.gap <= 12) {
    return {
      kind: 'coherent_foundational_system',
      name: 'Coherent Foundational System',
      descriptor: 'coherent (foundational)',
      why_this_shape: `All measured pillars sit between ${sp.min}/100 and ${sp.max}/100 — the system is uniformly early, with no pillar carrying the rest.`,
      what_it_means: 'Coherence at this stage is an asset — there are no broken pillars to repair. The work is uniform investment, not selective rescue.',
    };
  }

  // Coherent operational — middle band uniform.
  if (sp && sp.min >= 50 && sp.max <= 74 && sp.gap <= 12) {
    return {
      kind: 'coherent_operational_system',
      name: 'Coherent Operational System',
      descriptor: 'coherent (operational)',
      why_this_shape: `All measured pillars sit between ${sp.min}/100 and ${sp.max}/100 — authority is moving as a system rather than as a single pillar.`,
      what_it_means: 'Coherence at the operational band is the precondition for compounding. The next move is depth in one pillar that distinguishes the brand from competent peers.',
    };
  }

  // Catch-all — measured but no recognisable named shape.
  return {
    kind: 'fragmented_authority_presence',
    name: 'Mixed Authority Profile',
    descriptor: 'mixed',
    why_this_shape: `The pillar configuration does not yet match a single canonical authority shape. Authority Index reads ${overall}/100${ai != null ? ` with AI retrieval at ${ai}/100` : ''}.`,
    what_it_means: 'Mixed profiles benefit most from concentration: pick the pillar whose movement would unlock the most elsewhere and treat it as the lead pillar of the next planning cycle.',
  };
}
