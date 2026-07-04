// Executive dossier composer.
//
// Maps the canonical report into the 8-section dossier narrative the PDF
// renderer consumes:
//
//   1. Executive Reality       — what is the actual situation
//   2. Authority Position      — strength of the digital authority foundation
//   3. AI Discoverability      — can AI systems understand and cite the brand
//   4. Trust & Consistency     — public trust signals coherent and reinforcing
//   5. Strategic Constraints   — what limits authority growth
//   6. Market Position         — how does the brand compare contextually
//   7. Momentum & Maturity     — is authority compounding or stagnating
//   8. Strategic Action Plan   — what should happen next (4-bucket sequence)
//
// Each section consumes only the canonical fields it needs. No data is
// fabricated; every absent field surfaces as an honest "not yet measured"
// in the rendered dossier.

import type {
  CanonicalAction,
  CanonicalNarrative,
  CanonicalPillarScore,
  CanonicalReport,
  CanonicalScore,
  PillarKey,
} from '../../canonicalReport/canonicalReportTypes';
import {
  buildExecutiveInsightCards,
  type InsightCard,
} from './insightCards';
import {
  groupActionsForDossier,
  type ActionDossierGroup,
} from './actionGrouping';
import {
  buildSectionConstraintNarratives,
  type ConstraintNarrative,
  type SectionConstraintNarratives,
} from './constraintNarrative';
import {
  maturityPatternFor,
  type MaturityPattern,
} from './maturityPatterns';
import {
  buildSectionFraming,
  type SectionFraming,
} from './executivePhrasing';
import {
  classifyAuthorityShape,
  type AuthorityShape,
} from './authorityShape';
import {
  composeMaturityEvolution,
  type MaturityEvolution,
} from './maturityEvolution';
import {
  classifyMomentumShape,
  type MomentumShape,
} from './momentumShape';
import {
  composeClosingInterpretation,
  type ClosingInterpretation,
} from './closingInterpretation';

export type DossierSectionId =
  | 'executive_reality'
  | 'authority_position'
  | 'ai_discoverability'
  | 'trust_consistency'
  | 'strategic_constraints'
  | 'market_position'
  | 'momentum_maturity'
  | 'strategic_action_plan';

export type DossierSectionMeta = {
  id: DossierSectionId;
  title: string;
  // The single executive question this section answers.
  dominant_question: string;
};

// ── Section types ────────────────────────────────────────────────────────────

export type ExecutiveRealitySection = {
  id: 'executive_reality';
  meta: DossierSectionMeta;
  headline_thesis: CanonicalNarrative;
  current_maturity_label: string;
  authority_index: CanonicalScore;
  /** A single 1-2 sentence summary of the brand's situation. */
  reality_brief: string;
  /** One-line strategic priority — distilled from the next-unlock and primary-constraint narratives. */
  strategic_priority: string;
  insight_cards: InsightCard[];
};

export type AuthorityPositionSection = {
  id: 'authority_position';
  meta: DossierSectionMeta;
  /** Foundation, Authority, Discoverability, Trust, Momentum — all 5, even when unavailable. */
  pillars: CanonicalPillarScore[];
  /** Strongest measured pillar, or null. */
  dominant_strength: { pillar: PillarKey; score: number; signal: string | null } | null;
  /** Weakest measured pillar, or null. */
  dominant_weakness: { pillar: PillarKey; score: number; signal: string | null } | null;
  narrative: CanonicalNarrative;
  /** Memorable framing sentence that opens the section. */
  framing_sentence: string;
  /** 4-part strategic interpretation block. Null when the underlying canonical fields are insufficient. */
  constraint_narrative: ConstraintNarrative | null;
};

export type AiDiscoverabilitySection = {
  id: 'ai_discoverability';
  meta: DossierSectionMeta;
  surface_score: CanonicalScore;
  rationale: CanonicalNarrative;
  /** The full citation matrix for hero rendering — providers × query classes. */
  citation_matrix: CanonicalReport['ai_surface_presence']['citation_matrix'];
  /** Entity / extraction readiness signals. */
  entity_score: CanonicalScore;
  entity_summary: CanonicalReport['knowledge_graph']['entity'];
  /** "Why this section matters" — preface the AI hero. */
  positioning_paragraph: string;
  framing_sentence: string;
  constraint_narrative: ConstraintNarrative | null;
};

export type TrustConsistencySection = {
  id: 'trust_consistency';
  meta: DossierSectionMeta;
  trust_score: CanonicalScore;
  rationale: CanonicalNarrative;
  signals: CanonicalReport['trust_coherence']['signals'];
  framing_sentence: string;
  constraint_narrative: ConstraintNarrative | null;
};

export type StrategicConstraintsSection = {
  id: 'strategic_constraints';
  meta: DossierSectionMeta;
  primary_constraint: CanonicalNarrative;
  authority_risk: CanonicalNarrative;
  /** Specific weakest dimensions (top 3) for context. */
  weak_dimensions: Array<{ key: string; label: string; value: number; pillar: PillarKey }>;
  framing_sentence: string;
  constraint_narrative: ConstraintNarrative | null;
};

export type MarketPositionSection = {
  id: 'market_position';
  meta: DossierSectionMeta;
  benchmark_state: 'measured' | 'unavailable';
  benchmark_overlay: CanonicalReport['benchmark']['overlay'];
  benchmark_rationale: CanonicalNarrative;
  competitive_summary: CanonicalNarrative;
  framing_sentence: string;
  constraint_narrative: ConstraintNarrative | null;
};

export type MomentumMaturitySection = {
  id: 'momentum_maturity';
  meta: DossierSectionMeta;
  current_stage: CanonicalReport['maturity_stage'];
  trajectory: CanonicalReport['authority_trajectory'];
  forecast: CanonicalReport['forecast'];
  momentum_narrative: CanonicalNarrative;
  framing_sentence: string;
  constraint_narrative: ConstraintNarrative | null;
  /** "What leaders typically do" pattern observation for the current maturity stage. */
  maturity_pattern: MaturityPattern | null;
  /** Maturity evolution narrative (why_this_stage / characteristics / friction / unlock / what higher systems show). */
  maturity_evolution: MaturityEvolution | null;
  /** Authority momentum shape (compounding / stable / fragile / stagnating / declining / insufficient_history). */
  momentum_shape: MomentumShape;
};

export type StrategicActionPlanSection = {
  id: 'strategic_action_plan';
  meta: DossierSectionMeta;
  groups: ActionDossierGroup[];
  sequence_narrative: string;
  framing_sentence: string;
};

export type ExecutiveDossier = {
  generated_at: string;
  brand: { tenant_id: string; company_id: string; brand_name: string | null; domain: string | null };
  summary_brief: ExecutiveSummaryBrief;
  /** Canonical Authority Shape — the dossier's signature interpretation primitive, referenced from cover, snapshot, authority position, strategic direction, and closing summary. */
  authority_shape: AuthorityShape;
  /** Authority Momentum Shape — the qualitative trajectory read. */
  momentum_shape: MomentumShape;
  /** Final Strategic Interpretation — the single executive takeaway closing the dossier. */
  closing_interpretation: ClosingInterpretation;
  sections: {
    executive_reality: ExecutiveRealitySection;
    authority_position: AuthorityPositionSection;
    ai_discoverability: AiDiscoverabilitySection;
    trust_consistency: TrustConsistencySection;
    strategic_constraints: StrategicConstraintsSection;
    market_position: MarketPositionSection;
    momentum_maturity: MomentumMaturitySection;
    strategic_action_plan: StrategicActionPlanSection;
  };
};

// ── Boardroom executive summary brief ────────────────────────────────────────

export type ExecutiveSummaryBrief = {
  headline_thesis: string;
  current_maturity: string;
  dominant_strength: { label: string; detail: string };
  dominant_weakness: { label: string; detail: string };
  biggest_opportunity: { label: string; detail: string };
  biggest_risk: { label: string; detail: string };
  strategic_priority: { label: string; detail: string };
};

const SECTION_META: Record<DossierSectionId, DossierSectionMeta> = {
  executive_reality: {
    id: 'executive_reality',
    title: 'Executive Reality',
    dominant_question: 'What is the actual authority and discoverability situation?',
  },
  authority_position: {
    id: 'authority_position',
    title: 'Authority Position',
    dominant_question: 'How strong is the digital authority foundation?',
  },
  ai_discoverability: {
    id: 'ai_discoverability',
    title: 'AI Discoverability',
    dominant_question: 'Can AI systems understand, retrieve, and trust this brand?',
  },
  trust_consistency: {
    id: 'trust_consistency',
    title: 'Trust & Consistency',
    dominant_question: 'Are public trust signals coherent and reinforcing?',
  },
  strategic_constraints: {
    id: 'strategic_constraints',
    title: 'Strategic Constraints',
    dominant_question: 'What is limiting authority growth?',
  },
  market_position: {
    id: 'market_position',
    title: 'Market Position',
    dominant_question: 'How does the brand compare in context?',
  },
  momentum_maturity: {
    id: 'momentum_maturity',
    title: 'Momentum & Maturity',
    dominant_question: 'Is authority compounding or stagnating?',
  },
  strategic_action_plan: {
    id: 'strategic_action_plan',
    title: 'Strategic Action Plan',
    dominant_question: 'What should happen next?',
  },
};

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

function isMeasured(score: CanonicalScore): boolean {
  return typeof score.value === 'number' && score.state !== 'insufficient_signal' && score.state !== 'unavailable';
}

function findStrongest(report: CanonicalReport): CanonicalPillarScore | null {
  const measured = report.pillars.filter((p) => isMeasured(p.score));
  if (measured.length === 0) return null;
  return [...measured].sort((a, b) => (b.score.value ?? 0) - (a.score.value ?? 0))[0];
}

function findWeakest(report: CanonicalReport): CanonicalPillarScore | null {
  const measured = report.pillars.filter((p) => isMeasured(p.score));
  if (measured.length === 0) return null;
  return [...measured].sort((a, b) => (a.score.value ?? 0) - (b.score.value ?? 0))[0];
}

function topAction(report: CanonicalReport): CanonicalAction | null {
  return report.action_playbook.actions[0] ?? null;
}

function buildRealityBrief(report: CanonicalReport): string {
  const overall = report.authority_overview.overall_score;
  if (!isMeasured(overall)) {
    return 'Authority cannot yet be measured. Evidence is insufficient across the pillars; the dossier renders the structure honestly until measurement begins.';
  }
  const strongest = findStrongest(report);
  const weakest = findWeakest(report);
  const stage = report.maturity_stage.label;
  const valueText = `${overall.value}/100 (${stage})`;
  if (strongest && weakest && strongest.pillar !== weakest.pillar) {
    return `The brand reads as ${valueText}. ${PILLAR_LABEL[strongest.pillar]} is leading at ${strongest.score.value}/100 while ${PILLAR_LABEL[weakest.pillar]} (${weakest.score.value}/100) is throttling overall position.`;
  }
  return `The brand reads as ${valueText}. The canonical pillars sit within a tight range — work compounds rather than diverges.`;
}

function buildStrategicPriority(report: CanonicalReport): string {
  const top = topAction(report);
  if (!top) return 'No high-leverage action could be derived yet — the playbook will sharpen as evidence accumulates.';
  return `Lead with ${top.title}. ${top.expected_outcome || top.reasoning}`;
}

function buildPositioningParagraph(report: CanonicalReport): string {
  const score = report.ai_surface_presence.score;
  if (!isMeasured(score)) {
    return 'AI discoverability is the surface where buyer attention has shifted most rapidly. The brand has not yet been measured here — establishing measurement is the first move.';
  }
  const value = score.value as number;
  if (value >= 60) {
    return 'AI discoverability is the surface where buyer attention has shifted most rapidly. The brand performs meaningfully here — defending and extending this position is what differentiates leaders from peers in the next 24 months.';
  }
  if (value >= 30) {
    return 'AI discoverability is the surface where buyer attention has shifted most rapidly. The brand is partially retrievable — closing the gap converts a known weakness into market advantage.';
  }
  return 'AI discoverability is the surface where buyer attention has shifted most rapidly. The brand is largely absent here — the strategic cost of inaction grows each quarter.';
}

function buildMomentumNarrative(report: CanonicalReport): CanonicalNarrative {
  // Reuse the canonical executive insight; if change-aware narrative is more recent, prefer it.
  return report.executive_insights.momentum_interpretation;
}

function buildSummaryBrief(report: CanonicalReport): ExecutiveSummaryBrief {
  const strongest = findStrongest(report);
  const weakest = findWeakest(report);
  const top = topAction(report);
  const change = report.change_intelligence;
  const change_signal =
    change.state === 'measured' && change.notable_changes.length > 0
      ? change.notable_changes[0]
      : null;

  return {
    headline_thesis: report.executive_insights.headline_thesis.text,
    current_maturity: report.maturity_stage.label,
    dominant_strength: strongest
      ? {
          label: `${PILLAR_LABEL[strongest.pillar]} at ${strongest.score.value}/100`,
          detail: strongest.primary_signal ?? `Operating in the ${strongest.score.band} band — the pillar carrying the brand's authority story today.`,
        }
      : { label: 'No measured strength yet', detail: 'No pillar has measured evidence above the operational band.' },
    dominant_weakness: weakest
      ? {
          label: `${PILLAR_LABEL[weakest.pillar]} at ${weakest.score.value}/100`,
          detail: weakest.primary_signal ?? `The dominant drag on the Authority Index — closing this gap moves the system the most.`,
        }
      : { label: 'No measured weakness yet', detail: 'Insufficient signal to identify a dominant drag.' },
    biggest_opportunity: { label: 'Strategic opportunity', detail: report.executive_insights.strategic_opportunity.text },
    biggest_risk: { label: 'Authority risk', detail: report.executive_insights.authority_risk.text },
    strategic_priority: top
      ? { label: top.title, detail: top.reasoning || 'Highest-leverage move in the canonical playbook.' }
      : {
          label: 'No prioritised action yet',
          detail: 'Evidence is too thin to surface a single high-leverage move.',
        },
  };
}

// ── Composer ─────────────────────────────────────────────────────────────────

export function composeExecutiveDossier(params: {
  report: CanonicalReport;
  brand: ExecutiveDossier['brand'];
}): ExecutiveDossier {
  const { report } = params;
  const insight_cards = buildExecutiveInsightCards(report);
  const summary_brief = buildSummaryBrief(report);
  const constraints: SectionConstraintNarratives = buildSectionConstraintNarratives(report);
  const framing: SectionFraming = buildSectionFraming(report);
  const maturity_pattern = maturityPatternFor(report);
  const authority_shape = classifyAuthorityShape(report);
  const maturity_evolution = composeMaturityEvolution(report);
  const momentum_shape = classifyMomentumShape(report);
  const closing_interpretation = composeClosingInterpretation({
    report,
    authority_shape,
    maturity_evolution,
    momentum_shape,
  });

  const strongest = findStrongest(report);
  const weakest = findWeakest(report);

  // Weak dimensions: top 3 lowest measured.
  const weakDimensions = report.discoverability_authority_radar.axes
    .filter((axis) => isMeasured(axis.score))
    .sort((a, b) => (a.score.value as number) - (b.score.value as number))
    .slice(0, 3)
    .map((axis) => ({
      key: axis.key,
      label: axis.label,
      value: axis.score.value as number,
      pillar: axis.pillar,
    }));

  return {
    generated_at: new Date().toISOString(),
    brand: params.brand,
    summary_brief,
    authority_shape,
    momentum_shape,
    closing_interpretation,
    sections: {
      executive_reality: {
        id: 'executive_reality',
        meta: SECTION_META.executive_reality,
        headline_thesis: report.executive_insights.headline_thesis,
        current_maturity_label: report.maturity_stage.label,
        authority_index: report.authority_overview.overall_score,
        reality_brief: buildRealityBrief(report),
        strategic_priority: buildStrategicPriority(report),
        insight_cards,
      },
      authority_position: {
        id: 'authority_position',
        meta: SECTION_META.authority_position,
        pillars: report.pillars,
        dominant_strength: strongest
          ? { pillar: strongest.pillar, score: strongest.score.value as number, signal: strongest.primary_signal }
          : null,
        dominant_weakness: weakest
          ? { pillar: weakest.pillar, score: weakest.score.value as number, signal: weakest.primary_signal }
          : null,
        narrative: report.authority_overview.headline,
        framing_sentence: framing.authority_position,
        constraint_narrative: constraints.authority_position,
      },
      ai_discoverability: {
        id: 'ai_discoverability',
        meta: SECTION_META.ai_discoverability,
        surface_score: report.ai_surface_presence.score,
        rationale: report.ai_surface_presence.rationale,
        citation_matrix: report.ai_surface_presence.citation_matrix,
        entity_score: report.knowledge_graph.score,
        entity_summary: report.knowledge_graph.entity,
        positioning_paragraph: buildPositioningParagraph(report),
        framing_sentence: framing.ai_discoverability,
        constraint_narrative: constraints.ai_discoverability,
      },
      trust_consistency: {
        id: 'trust_consistency',
        meta: SECTION_META.trust_consistency,
        trust_score: report.trust_coherence.score,
        rationale: report.trust_coherence.rationale,
        signals: report.trust_coherence.signals,
        framing_sentence: framing.trust_consistency,
        constraint_narrative: constraints.trust_consistency,
      },
      strategic_constraints: {
        id: 'strategic_constraints',
        meta: SECTION_META.strategic_constraints,
        primary_constraint: report.executive_insights.primary_constraint,
        authority_risk: report.executive_insights.authority_risk,
        weak_dimensions: weakDimensions,
        framing_sentence: framing.strategic_constraints,
        constraint_narrative: constraints.strategic_constraints,
      },
      market_position: {
        id: 'market_position',
        meta: SECTION_META.market_position,
        benchmark_state: report.benchmark.state === 'measured' ? 'measured' : 'unavailable',
        benchmark_overlay: report.benchmark.overlay,
        benchmark_rationale: report.benchmark.rationale,
        competitive_summary: report.competitive_surface_share.summary,
        framing_sentence: framing.market_position,
        constraint_narrative: constraints.market_position,
      },
      momentum_maturity: {
        id: 'momentum_maturity',
        meta: SECTION_META.momentum_maturity,
        current_stage: report.maturity_stage,
        trajectory: report.authority_trajectory,
        forecast: report.forecast,
        momentum_narrative: buildMomentumNarrative(report),
        framing_sentence: framing.momentum_maturity,
        constraint_narrative: constraints.momentum_maturity,
        maturity_pattern,
        maturity_evolution,
        momentum_shape,
      },
      strategic_action_plan: {
        id: 'strategic_action_plan',
        meta: SECTION_META.strategic_action_plan,
        groups: groupActionsForDossier(report),
        sequence_narrative: report.strategic_playbook.sequence_narrative,
        framing_sentence: framing.strategic_action_plan,
      },
    },
  };
}
