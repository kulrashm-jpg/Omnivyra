/** Dossier surfaces — trajectory, competitive AI visibility, trust coherence — split from intelligenceSurfacesRest.ts (barrel preserved; importers unchanged). */
/** Dossier surfaces — trajectory, competitive visibility, peer gaps, benchmarks — split from intelligenceSurfaces.ts (barrel preserved; importers unchanged). */
// Intelligence Surfaces.
//
// Recovers six analytical layers that the executive dossier needs to feel
// strategically rich (without regressing into a dashboard). Each surface
// derives strictly from canonical fields — no fabrication, no fake
// percentiles, no invented forecasts.
//
//   1. Dimension Breakdown        — canonical 8 dimensions grouped by pillar
//   2. Score Drivers              — drivers / compounders / rate-limiters
//   3. Comparative Positioning    — peer-band placement
//   4. Trajectory & Movement      — change_intelligence + authority_trajectory
//   5. Data Confidence            — evidence + provider summary
//   6. Channel Leverage           — AI citation matrix gap interpretation
//   7. Execution Window           — temporal action sequencing
//
// Each module returns a plain typed shape that the renderer maps to its
// editorial visualisation.

// GAP-12 — measured-coverage gate for AI absence language.
import { aiCoverageGate, aiCoverageQualifier } from './aiCoverageGate';
import type {
  CanonicalDimension,
  CanonicalDimensionKey,
  CanonicalReport,
  ConfidenceBand,
  PillarKey,
  ScoreState,
} from '../../canonicalReport/canonicalReportTypes';

import { isMeasuredScore, buildScoreDrivers } from './intelligenceSurfacesFoundations';


export type AITrajectory = {
  state: 'measured' | 'insufficient_history';
  current: number | null;
  previous: number | null;
  delta: number | null;
  direction: string;
  significant: boolean;
  reading: string;
};

export function buildAITrajectory(report: CanonicalReport): AITrajectory {
  const change = report.change_intelligence;
  if (change.state !== 'measured') {
    return {
      state: 'insufficient_history',
      current: null,
      previous: null,
      delta: null,
      direction: 'first_observation',
      significant: false,
      reading: 'AI visibility trajectory needs repeated observation to interpret. The dossier holds the present read as the baseline.',
    };
  }
  const ai = change.ai_visibility_delta;
  const dir = ai.direction;
  const reading = (() => {
    if (dir === 'improved') {
      const lift = ai.delta != null ? `+${ai.delta} points` : 'an upward move';
      return `AI visibility is moving upward (${lift}). Where buyers research through AI, the brand's surface is gaining ground; sustain the inputs that produced the lift.`;
    }
    if (dir === 'regressed') {
      const drop = ai.delta != null ? `${ai.delta} points` : 'a downward move';
      return `AI visibility has receded (${drop}). Each quarter buyer research migrates further toward AI answers; receding here is structurally costly.`;
    }
    if (dir === 'stagnated') {
      return 'AI visibility has held position. In a surface where peers continue to invest, holding is rarely neutral — it is relative loss measured over enough quarters.';
    }
    return 'AI visibility direction is forming. One observation describes the present; only repetition describes trajectory.';
  })();
  return {
    state: 'measured',
    current: ai.current,
    previous: ai.previous,
    delta: ai.delta,
    direction: dir,
    significant: ai.significant ?? false,
    reading,
  };
}

// ── 11. Competitive AI Visibility (peer AI average comparison) ───────────

export type CompetitiveAIVisibility = {
  state: 'measured' | 'unavailable';
  brand_value: number | null;
  peer_average: number | null;
  gap: number | null;
  reading: string;
};

export function buildCompetitiveAIVisibility(report: CanonicalReport): CompetitiveAIVisibility {
  const ai = report.ai_surface_presence.score;
  const competitorAvg = report.competitive_surface_share?.competitor_average?.['ai_surface_presence'];
  if (!isMeasuredScore(ai) || typeof competitorAvg !== 'number') {
    return {
      state: 'unavailable',
      brand_value: null,
      peer_average: null,
      gap: null,
      reading: 'Peer AI visibility comparison is held open until competitive measurement accumulates.',
    };
  }
  const brand = ai.value as number;
  const gap = brand - competitorAvg;
  const reading = (() => {
    if (gap >= 10) {
      return `Brand AI visibility (${brand}/100) reads ${Math.round(gap)} points above peer average (${Math.round(competitorAvg)}/100). The retrieval lead is the asset to defend; uniformity of coverage is the next investment.`;
    }
    if (gap >= -5) {
      return `Brand AI visibility (${brand}/100) reads close to peer average (${Math.round(competitorAvg)}/100). Holding parity here is non-trivial — peers continue to invest in the same surface.`;
    }
    return `Brand AI visibility (${brand}/100) reads ${Math.abs(Math.round(gap))} points below peer average (${Math.round(competitorAvg)}/100). The category is being retrieved without the brand's presence.`;
  })();
  return {
    state: 'measured',
    brand_value: brand,
    peer_average: competitorAvg,
    gap,
    reading,
  };
}

// ── 12. Brand Brief (cover/snapshot identity texture) ────────────────────
//
// Surfaces the canonical company context fields the legacy report
// carried prominently and the canonical dossier had been omitting.
// The brand brief is identity texture, not narrative — it tells the
// reader what the company actually is in 2–4 short lines.

export type BrandBriefField = {
  label: string;
  value: string;
};

export type BrandBrief = {
  state: 'measured' | 'unavailable';
  fields: BrandBriefField[];
};

export function trim(text: string | null | undefined, max = 120): string | null {
  if (!text) return null;
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

export function buildBrandBrief(companyContext: {
  primaryOffering?: string | null;
  marketContext?: string | null;
  positioning?: string | null;
  tagline?: string | null;
  homepageHeadline?: string | null;
  positioningNarrative?: string | null;
  positioningGap?: string | null;
} | null | undefined): BrandBrief {
  if (!companyContext) {
    return { state: 'unavailable', fields: [] };
  }
  const fields: BrandBriefField[] = [];
  const offering = trim(companyContext.primaryOffering);
  if (offering) fields.push({ label: 'Offering', value: offering });
  const positioning = trim(companyContext.positioning ?? companyContext.tagline ?? companyContext.homepageHeadline);
  if (positioning) fields.push({ label: 'Positioning', value: positioning });
  const market = trim(companyContext.marketContext);
  if (market) fields.push({ label: 'Market', value: market });
  const differentiation = trim(companyContext.positioningNarrative ?? companyContext.positioningGap);
  if (differentiation) fields.push({ label: 'Differentiation', value: differentiation });
  return {
    state: fields.length > 0 ? 'measured' : 'unavailable',
    fields,
  };
}

// ── 13. Strategic Posture (snapshot strength reading) ────────────────────
//
// A compact strategic posture read derived from canonical company
// context fields. Phrased as Position / Resilience / Posture rather
// than dashboard-style score cards.

export type StrategicPostureEntry = {
  label: string;
  value: string;
};

export type StrategicPosture = {
  state: 'measured' | 'unavailable';
  entries: StrategicPostureEntry[];
};

export function buildStrategicPosture(companyContext: {
  marketPosition?: string | null;
  marketPositionStatement?: string | null;
  positioningStrength?: string | null;
  executionRisk?: string | null;
  resilienceGuidance?: string | null;
  marketType?: string | null;
} | null | undefined): StrategicPosture {
  if (!companyContext) {
    return { state: 'unavailable', entries: [] };
  }
  const entries: StrategicPostureEntry[] = [];
  const position = trim(companyContext.marketPosition ?? companyContext.marketPositionStatement, 90);
  if (position) entries.push({ label: 'Market Position', value: position });
  const strength = trim(companyContext.positioningStrength, 60);
  if (strength) entries.push({ label: 'Positioning Strength', value: strength });
  const market = trim(companyContext.marketType, 60);
  if (market) entries.push({ label: 'Market Type', value: market });
  const risk = trim(companyContext.executionRisk, 90);
  if (risk) entries.push({ label: 'Execution Risk', value: risk });
  return {
    state: entries.length > 0 ? 'measured' : 'unavailable',
    entries,
  };
}

// ── 14. AI Visibility State (block 1 of 7-block AI architecture) ────────
//
// The opening diagnostic of the AI Discoverability section. Answers the
// executive question "Can AI systems reliably identify the company?"
// with a structured cross-signal assessment, then leaves the spectrum
// visualization + interpretive paragraph to do the rest.

export type AIVisibilityIdentityState = 'identified' | 'partial' | 'absent' | 'unmeasured';
export type AIEntityState = 'present' | 'partial' | 'absent' | 'unmeasured';

export type AIVisibilityState = {
  state: AIVisibilityIdentityState;
  state_label: string;
  entity_state: AIEntityState;
  entity_label: string;
  entity_detail: string | null;
  retrieval_consistency_pct: number | null;
  citation_density_label: string | null;
  reading: string;
};

export function buildAIVisibilityState(report: CanonicalReport): AIVisibilityState {
  const aiScore = report.ai_surface_presence.score;
  const matrix = report.ai_surface_presence.citation_matrix;
  const entity = report.knowledge_graph.entity;
  const aiValue = isMeasuredScore(aiScore) ? (aiScore.value as number) : null;

  // Identity state — derived from AI score using the canonical band
  // boundaries (foundational < 25, developing 25–49, operational
  // 50–74, leading 75+). The thresholds are NOT chosen ad-hoc; they
  // match the system-wide rule that defines what "developing" /
  // "operational" mean across every other section. Same rules apply
  // to every company regardless of domain, industry, or geography.
  const state: AIVisibilityIdentityState = (() => {
    if (aiValue == null) return 'unmeasured';
    if (aiValue >= 50) return 'identified';     // operational+
    if (aiValue >= 25) return 'partial';        // developing+
    return 'absent';                            // foundational
  })();
  // GAP-12 — the measured-coverage gate. `state` itself is NOT changed: it derives from the
  // aggregate score, which `aiCitationMatrixService` already computes from measured cells only.
  // What is gated is how far the resulting LABEL and reading are allowed to generalise.
  const coverage = aiCoverageGate(report);

  // "Not Identified" is a true statement about the cells that were measured, so it stays — but
  // rendered as a bare "Identification: Not Identified" it reads as a verdict on the whole AI
  // landscape. When providers went unqueried it is scoped to what was actually looked at.
  const state_label = state === 'identified' ? 'Identified'
    : state === 'partial' ? 'Partially Identified'
      : state === 'absent'
        ? (coverage.supportsGeneralClaim ? 'Not Identified' : 'Not Identified in measured surfaces')
        : 'Not Yet Measured';

  // Entity record state — derived from knowledge_graph entity payload.
  const entity_state: AIEntityState = (() => {
    if (!entity || entity.state !== 'measured') return 'unmeasured';
    const sameAs = entity.sameAs_count ?? 0;
    if (entity.wikidata_qid && sameAs >= 3) return 'present';
    if (entity.wikidata_qid || sameAs >= 1) return 'partial';
    return 'absent';
  })();
  const entity_label = entity_state === 'present' ? 'Present' : entity_state === 'partial' ? 'Partial' : entity_state === 'absent' ? 'Absent' : 'Not Yet Measured';
  const entity_detail = entity && entity.state === 'measured'
    ? `${entity.sameAs_count ?? 0} sameAs surface${(entity.sameAs_count ?? 0) === 1 ? '' : 's'}${entity.wikidata_qid ? ` · Wikidata ${entity.wikidata_qid}` : ''}`
    : null;

  // Retrieval consistency (% of cells measured) and citation density (cited cells / total).
  const retrieval_consistency_pct = matrix && matrix.coverage.total_cells > 0
    ? Math.round((matrix.coverage.measured_cells / matrix.coverage.total_cells) * 100)
    : null;
  const citedCells = matrix
    ? matrix.cells.filter((c) => (c.citation_rate ?? 0) >= 0.6).length
    : 0;
  const totalCells = matrix?.coverage.total_cells ?? 0;
  const citation_density_label = matrix && totalCells > 0
    ? `${citedCells} of ${totalCells} cells citing reliably`
    : null;

  const reading = (() => {
    if (state === 'unmeasured') {
      return 'AI visibility is not yet measurable. Establishing measurement is the first move; the dossier holds the architecture honestly open until evidence accumulates.';
    }
    if (state === 'identified') {
      return entity_state === 'present'
        ? 'AI systems reliably identify the brand and find a coherent entity record behind it. The work shifts from being seen to being uniformly retrieved across the surfaces buyers query.'
        : 'AI systems retrieve the brand at a meaningful rate, but the entity record behind it is incomplete. Strengthening the entity surface lifts retrieval where it currently dips.';
    }
    if (state === 'partial') {
      return entity_state === 'absent'
        ? 'AI systems find the brand inconsistently and cannot anchor it to a structured entity. The two gaps reinforce each other — closing entity recognition compounds into retrieval lift across providers.'
        : 'AI systems find the brand on some surfaces but not reliably across providers. The story is unevenness, not absence — uniformity of coverage is the strategic question.';
    }
    // GAP-12 — "AI systems do not reliably retrieve the brand" quantifies over every AI system.
    // With providers unqueried that is a claim about silence the report never listened for, so the
    // same measured finding is stated against the surfaces that actually answered.
    if (!coverage.supportsGeneralClaim) {
      return `The brand was not retrieved in the AI surfaces measured.${aiCoverageQualifier(coverage)} `
        + 'What the unqueried surfaces return is unknown, not absent.';
    }
    return 'AI systems do not reliably retrieve the brand. The cost is not theoretical — each quarter buyer research migrates further toward AI-mediated answers, the gap costs more.';
  })();

  return {
    state,
    state_label,
    entity_state,
    entity_label,
    entity_detail,
    retrieval_consistency_pct,
    citation_density_label,
    reading,
  };
}

// ── 15. AI Trust & Corroboration (block 4 of 7) ──────────────────────────
//
// Answers "Do AI systems encounter consistent or fragmented authority
// signals about this brand?" — a cross-signal coherence read that
// blends entity, trust_coherence, and authority_inflow signals.

export type AITrustCoherenceKind = 'consistent' | 'fragmented' | 'sparse' | 'weak' | 'unmeasured';

export type AITrustCoherence = {
  state: 'measured' | 'unavailable';
  kind: AITrustCoherenceKind;
  kind_label: string;
  reinforcement_signals: string[];
  reading: string;
};

export function buildAITrustCoherence(report: CanonicalReport): AITrustCoherence {
  const trust = report.trust_coherence;
  const entity = report.knowledge_graph.entity;
  const inflow = report.authority_inflow;
  const trustValue = isMeasuredScore(trust.score) ? (trust.score.value as number) : null;
  const inflowValue = isMeasuredScore(inflow.score) ? (inflow.score.value as number) : null;
  const sameAs = entity && entity.state === 'measured' ? (entity.sameAs_count ?? 0) : 0;

  if (trustValue == null && inflowValue == null && sameAs === 0) {
    return {
      state: 'unavailable',
      kind: 'unmeasured',
      kind_label: 'Not Yet Measurable',
      reinforcement_signals: [],
      reading: 'Cross-signal coherence cannot yet be assessed. AI trust readings need entity, trust, and authority signals to resolve before the coherence shape becomes interpretable.',
    };
  }

  const kind: AITrustCoherenceKind = (() => {
    const high = (trustValue ?? 0) >= 60 && sameAs >= 3 && (inflowValue ?? 0) >= 50;
    if (high) return 'consistent';
    const allLow = (trustValue == null || trustValue < 30) && sameAs < 2 && (inflowValue == null || inflowValue < 30);
    if (allLow) return 'sparse';
    const fragmented = trustValue != null && inflowValue != null && Math.abs(trustValue - inflowValue) >= 25;
    if (fragmented) return 'fragmented';
    return 'weak';
  })();
  const kind_label = kind === 'consistent' ? 'Consistent' : kind === 'fragmented' ? 'Fragmented' : kind === 'sparse' ? 'Sparse' : 'Weak';

  const reinforcement_signals: string[] = [];
  if (trustValue != null) reinforcement_signals.push(`Trust coherence ${trustValue}/100`);
  if (sameAs > 0) reinforcement_signals.push(`${sameAs} entity sameAs surface${sameAs === 1 ? '' : 's'}`);
  if (inflowValue != null) reinforcement_signals.push(`Authority inflow ${inflowValue}/100`);

  const reading = (() => {
    if (kind === 'consistent') {
      return 'AI systems encounter signals that reinforce each other — entity, trust, and external authority point at the same brand identity. Coherence at this level compounds: every new content asset benefits from the existing structure.';
    }
    if (kind === 'fragmented') {
      return 'AI systems encounter signals that disagree with each other — strong on one axis, weak on another. Fragmentation is detectable; AI systems penalise it by hedging citations rather than confidently surfacing the brand.';
    }
    if (kind === 'sparse') {
      return 'AI systems encounter sparse evidence about the brand across the measured signals. The work is not yet about coherence — it is about generating signal at all. Baseline trust corroboration is the first investment.';
    }
    return 'AI systems encounter weak corroboration — signals exist but none reinforce the others strongly. The strategic question is which axis to strengthen first; trust coherence usually compounds fastest at this stage.';
  })();

  return {
    state: 'measured',
    kind,
    kind_label,
    reinforcement_signals,
    reading,
  };
}

// ── 16. AI Absence & Risk (block 6 of 7, with retrieval examples) ────────
//
// Answers "What does AI fail to see, and what does that cost?" The
// block names absent cells explicitly and surfaces 3–4 retrieval
// examples (provider × query class anchors, NOT transcripts) so
// evidence diversity returns to the AI section.

export type AIRetrievalExample = {
  provider: string;
  query_class: string;
  citation_rate: number | null;
  status: 'cited' | 'partial' | 'absent';
  note: string;
};

export type AIAbsenceRisk = {
  state: 'measured' | 'unavailable';
  absent_cells: number;
  partial_cells: number;
  cited_cells: number;
  total_measured: number;
  retrieval_examples: AIRetrievalExample[];
  reading: string;
};

export function buildAIAbsenceRisk(report: CanonicalReport): AIAbsenceRisk {
  const matrix = report.ai_surface_presence.citation_matrix;
  if (!matrix) {
    return {
      state: 'unavailable',
      absent_cells: 0,
      partial_cells: 0,
      cited_cells: 0,
      total_measured: 0,
      retrieval_examples: [],
      reading: 'AI absence cannot yet be measured — establishing the citation matrix is the first move.',
    };
  }
  const measured = matrix.cells.filter((c) => c.state !== 'unavailable' && c.state !== 'insufficient_signal');
  const cited = measured.filter((c) => (c.citation_rate ?? 0) >= 0.6);
  const partial = measured.filter((c) => (c.citation_rate ?? 0) >= 0.3 && (c.citation_rate ?? 0) < 0.6);
  const absent = measured.filter((c) => (c.citation_rate ?? 0) < 0.3);

  // Build retrieval examples: 1–2 cited (Defends), 1–2 absent (Risk).
  const examples: AIRetrievalExample[] = [];
  for (const c of cited.slice(0, 2)) {
    examples.push({
      provider: c.provider,
      query_class: c.query_class,
      citation_rate: c.citation_rate,
      status: 'cited',
      note: `Cited at ${Math.round((c.citation_rate ?? 0) * 100)}% — buyers asking ${c.query_class} questions on ${c.provider} encounter the brand reliably.`,
    });
  }
  for (const c of absent.slice(0, 2)) {
    examples.push({
      provider: c.provider,
      query_class: c.query_class,
      citation_rate: c.citation_rate,
      status: 'absent',
      note: `Cited at ${Math.round((c.citation_rate ?? 0) * 100)}% — buyers asking ${c.query_class} questions on ${c.provider} are not seeing the brand.`,
    });
  }

  const reading = (() => {
    if (measured.length === 0) {
      return 'No retrieval cells are measurable yet. Until the matrix resolves, absence cannot be named — but the dossier holds this open honestly.';
    }
    if (absent.length === 0) {
      return 'No measured retrieval cell shows the brand absent. Where measurement exists, the brand is either cited or partially surfaced — defending uniformity of coverage is the strategic question.';
    }
    if (cited.length === 0) {
      return `${absent.length} of ${measured.length} measured cells return the brand at <30% reliability. AI-mediated buyer research is happening without the brand entering the consideration set; this is structural, not noise.`;
    }
    return `${absent.length} of ${measured.length} measured cells return the brand at <30% reliability while ${cited.length} cite it strongly. The asymmetry is the story — the cells where the brand is absent compound competitor presence in those exact buyer questions.`;
  })();

  return {
    state: 'measured',
    absent_cells: absent.length,
    partial_cells: partial.length,
    cited_cells: cited.length,
    total_measured: measured.length,
    retrieval_examples: examples,
    reading,
  };
}

// ── 17. AI Strategic Unlock (block 7 of 7 — the dominant unlock) ─────────
//
// The closing block of the AI section names ONE dominant unlock — the
// single highest-leverage move for AI discoverability. The unlock is
// concept-named ("Corroboration Density", "Entity Reinforcement", etc.)
// so it lives in the reader's memory after the section closes.

export type AIUnlockConcept =
  | 'corroboration_density'
  | 'entity_reinforcement'
  | 'coverage_uniformity'
  | 'citation_readiness'
  | 'expertise_signal'
  | 'trajectory_defence'
  | 'measurement_first';

export type AIStrategicUnlock = {
  concept: AIUnlockConcept;
  concept_label: string;
  headline: string;
  why: string;
};

export function buildAIStrategicUnlock(report: CanonicalReport): AIStrategicUnlock {
  const aiScore = report.ai_surface_presence.score;
  const matrix = report.ai_surface_presence.citation_matrix;
  const entity = report.knowledge_graph.entity;
  const trust = report.trust_coherence;
  const aiValue = isMeasuredScore(aiScore) ? (aiScore.value as number) : null;

  // Rule order — first match wins.

  // 1. AI score completely unmeasured → measurement first.
  if (aiValue == null) {
    return {
      concept: 'measurement_first',
      concept_label: 'Measurement First',
      headline: 'Establish AI surface measurement before optimisation begins.',
      why: 'Without baseline citation evidence, every AI investment runs blind. Measurement is the precondition for compounding.',
    };
  }

  // 2. Trajectory at leading band → defend.
  if (aiValue >= 75 && matrix && matrix.coverage.measured_cells / Math.max(matrix.coverage.total_cells, 1) >= 0.6) {
    return {
      concept: 'trajectory_defence',
      concept_label: 'Trajectory Defence',
      headline: 'Defend the existing retrieval position deliberately.',
      why: 'At leading AI visibility the strategic question inverts. Maintenance of the inputs that produced the position now outweighs reaching for a new one.',
    };
  }

  // 3. Trust coherence < 50 → corroboration density.
  if (isMeasuredScore(trust.score) && (trust.score.value as number) < 50) {
    return {
      concept: 'corroboration_density',
      concept_label: 'Corroboration Density',
      headline: 'Strengthen cross-source corroboration before reaching for more reach.',
      why: 'AI systems hedge when signals disagree. Closing the trust-coherence gap makes every other AI investment surface more reliably.',
    };
  }

  // 4. Entity record absent or partial → entity reinforcement.
  const sameAs = entity && entity.state === 'measured' ? (entity.sameAs_count ?? 0) : 0;
  if (!entity || entity.state !== 'measured' || sameAs < 3 || !entity.wikidata_qid) {
    return {
      concept: 'entity_reinforcement',
      concept_label: 'Entity Reinforcement',
      headline: 'Make the brand a recognised entity, then let citations follow.',
      why: 'AI retrieval depends on a clear, structured brand identity — a recognised knowledge-graph entry, links to authoritative profiles, and complete structured data. Without it, citations stay incidental rather than consistent.',
    };
  }

  // 5. Provider variance > 0.3 → coverage uniformity.
  if (matrix) {
    const rates = matrix.by_provider.filter((p) => typeof p.citation_rate === 'number').map((p) => p.citation_rate as number);
    if (rates.length >= 2) {
      const variance = Math.max(...rates) - Math.min(...rates);
      if (variance >= 0.3) {
        return {
          concept: 'coverage_uniformity',
          concept_label: 'Coverage Uniformity',
          headline: 'Close the variance between strongest and weakest providers.',
          why: 'Citation works on one surface and not on another — the gap is structural, not luck. Closing the gap is where investment compounds; defending the strong cells is where regression risks live.',
        };
      }
    }
  }

  // 6. AI score < 30 → citation readiness fundamentals.
  if (aiValue < 30) {
    return {
      concept: 'citation_readiness',
      concept_label: 'Citation Readiness',
      headline: 'Rebuild the substrate AI systems read before chasing visibility.',
      why: 'Below this band, AI surfaces do not have enough structured evidence to retrieve the brand. The work is foundational — schema, entity, content extractability — before any answer-engine optimisation lands.',
    };
  }

  // 7. Default for partial — expertise signal.
  return {
    concept: 'expertise_signal',
    concept_label: 'Expertise Signal',
    headline: 'Concentrate the next quarter on a single expertise the brand can own.',
    why: 'Partial AI visibility lifts fastest when the brand becomes canonical on one specific question type. Breadth comes after depth.',
  };
}

// ── 18. Competitor Matrix (per-competitor × dimension) ──────────────────
//
// Recovers the legacy Digital Snapshot's competitor matrix as a
// canonical-data-only editorial table. Rows = competitors, columns =
// the dimensions where overlap is observable. NOT a SaaS
// admin grid — restrained editorial composition with hairline rules.

export type CompetitorMatrixRow = {
  name: string;
  scores: Array<{ dimension: CanonicalDimensionKey; label: string; value: number | null }>;
  /** Overall measured average for this competitor across the columns. */
  overall: number | null;
};

export type CompetitorMatrix = {
  state: 'measured' | 'unavailable';
  columns: Array<{ key: CanonicalDimensionKey; label: string }>;
  user_row: CompetitorMatrixRow | null;
  competitor_rows: CompetitorMatrixRow[];
  read: string;
};

export const COMPETITOR_MATRIX_DIMENSIONS: Array<{ key: CanonicalDimensionKey; label: string }> = [
  { key: 'authority_inflow', label: 'Authority' },
  { key: 'topical_authority', label: 'Topical' },
  { key: 'ai_surface_presence', label: 'AI' },
  { key: 'trust_coherence', label: 'Trust' },
  { key: 'entity_graph_strength', label: 'Entity' },
];

export function avg(values: number[]): number | null {
  const measured = values.filter((v) => typeof v === 'number');
  if (measured.length === 0) return null;
  return Math.round(measured.reduce((a, b) => a + b, 0) / measured.length);
}

export function buildCompetitorMatrix(report: CanonicalReport): CompetitorMatrix {
  const competitive = report.competitive_surface_share;
  const competitors = competitive?.competitors ?? [];
  if (competitors.length === 0) {
    return {
      state: 'unavailable',
      columns: COMPETITOR_MATRIX_DIMENSIONS,
      user_row: null,
      competitor_rows: [],
      read: 'Competitor matrix is held open until peer measurement accumulates.',
    };
  }
  const userValues = competitive.user ?? {};
  const userScores = COMPETITOR_MATRIX_DIMENSIONS.map((c) => ({
    dimension: c.key,
    label: c.label,
    value: typeof userValues[c.key] === 'number' ? (userValues[c.key] as number) : null,
  }));
  const userOverall = avg(userScores.map((s) => s.value).filter((v): v is number => typeof v === 'number'));

  const competitorRows: CompetitorMatrixRow[] = competitors.map((c) => {
    const scores = COMPETITOR_MATRIX_DIMENSIONS.map((col) => ({
      dimension: col.key,
      label: col.label,
      value: typeof c.values[col.key] === 'number' ? (c.values[col.key] as number) : null,
    }));
    const overall = avg(scores.map((s) => s.value).filter((v): v is number => typeof v === 'number'));
    return { name: c.name, scores, overall };
  });

  const competitorAvgs = competitorRows.map((r) => r.overall).filter((v): v is number => typeof v === 'number');
  const peerAvg = competitorAvgs.length > 0 ? Math.round(competitorAvgs.reduce((a, b) => a + b, 0) / competitorAvgs.length) : null;
  const read = (() => {
    if (userOverall == null || peerAvg == null) {
      return `${competitorRows.length} competitor${competitorRows.length === 1 ? '' : 's'} measured on the dimensions where overlap is observable.`;
    }
    const gap = userOverall - peerAvg;
    if (gap >= 5) return `Brand reads ${gap} points above peer average across the measurable dimensions. The position is the asset to defend.`;
    if (gap >= -5) return `Brand reads close to peer average across the measurable dimensions. Holding parity is non-trivial as peers continue to invest.`;
    return `Brand reads ${Math.abs(gap)} points below peer average across the measurable dimensions. The shape — not the score gap — is what evaluators read.`;
  })();
  return {
    state: 'measured',
    columns: COMPETITOR_MATRIX_DIMENSIONS,
    user_row: { name: 'Brand', scores: userScores, overall: userOverall },
    competitor_rows: competitorRows,
    read,
  };
}

// ── 19. Strongest Peer Gap ───────────────────────────────────────────────
//
// Identifies the single dimension with the largest user-vs-peer-average
// gap and frames it as a strategic gap callout (Impact + Confidence
// chips). Recovers the legacy "Strongest Gap" surface canonically.

// Strongest Peer Gap — every value is sourced directly from canonical
// peer scan output. We deliberately do NOT synthesise an "impact score"
// (the legacy "75/100 impact" was a heuristic). The gap is the real
// arithmetic difference between the user's measured value and the peer
// average on the same dimension; the confidence band is the canonical
// confidence_band from competitive_surface_share, not synthesised.
