/** Dossier surfaces — pillars, dimensions, score drivers, trust coherence prelude — split from intelligenceSurfaces.ts (barrel preserved; importers unchanged). */
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

import type {
  CanonicalDimension,
  CanonicalDimensionKey,
  CanonicalReport,
  ConfidenceBand,
  PillarKey,
  ScoreState,
} from '../../canonicalReport/canonicalReportTypes';


const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

export function isMeasuredScore(score: { value: number | null; state: ScoreState }): boolean {
  return typeof score.value === 'number' && score.state !== 'insufficient_signal' && score.state !== 'unavailable';
}

// ── 1. Dimension Breakdown ────────────────────────────────────────────────

export type DimensionGroup = {
  pillar: PillarKey;
  pillar_label: string;
  /** Calibrated short interpretation that opens the pillar group. */
  interpretation: string;
  rows: Array<{
    key: CanonicalDimensionKey;
    label: string;
    value: number | null;
    state: ScoreState;
    pillar: PillarKey;
    rationale: string | null;
  }>;
};

export type DimensionBreakdown = {
  state: 'measured' | 'insufficient_signal';
  groups: DimensionGroup[];
};

function pillarInterpretationFor(pillar: PillarKey, rows: DimensionGroup['rows']): string {
  const measured = rows.filter((r) => isMeasuredScore({ value: r.value, state: r.state }));
  if (measured.length === 0) {
    return `${PILLAR_LABEL[pillar]} dimensions are not yet sufficiently measured.`;
  }
  const avg = Math.round(measured.reduce((s, r) => s + (r.value as number), 0) / measured.length);
  if (avg >= 70) return `${PILLAR_LABEL[pillar]} reads as a strength — the contributing dimensions reinforce each other.`;
  if (avg >= 50) return `${PILLAR_LABEL[pillar]} is operational — the dimensions hold together but coverage is uneven.`;
  if (avg >= 30) return `${PILLAR_LABEL[pillar]} is developing — at least one dimension is suppressing the pillar's contribution.`;
  return `${PILLAR_LABEL[pillar]} is foundational — the substrate is still forming across the dimensions that compose it.`;
}

export function buildDimensionBreakdown(report: CanonicalReport): DimensionBreakdown {
  const axes = report.discoverability_authority_radar?.axes ?? [];
  if (axes.length === 0) {
    // Fallback: read dimensions out of pillars[].dimensions if the radar
    // surface is empty (export payload path).
    const fallback: CanonicalDimension[] = [];
    for (const p of report.pillars) {
      for (const d of p.dimensions) fallback.push(d);
    }
    if (fallback.length === 0) {
      return { state: 'insufficient_signal', groups: [] };
    }
    return composeBreakdownFromDimensions(fallback);
  }
  return composeBreakdownFromDimensions(axes);
}

function composeBreakdownFromDimensions(axes: CanonicalDimension[]): DimensionBreakdown {
  const grouped = new Map<PillarKey, DimensionGroup['rows']>();
  for (const axis of axes) {
    const list = grouped.get(axis.pillar) ?? [];
    list.push({
      key: axis.key,
      label: axis.label,
      value: axis.score.value,
      state: axis.score.state,
      pillar: axis.pillar,
      rationale: axis.rationale ?? null,
    });
    grouped.set(axis.pillar, list);
  }
  const order: PillarKey[] = ['foundation', 'authority', 'discoverability', 'trust', 'momentum'];
  const groups: DimensionGroup[] = [];
  for (const p of order) {
    const rows = grouped.get(p);
    if (rows && rows.length > 0) {
      groups.push({
        pillar: p,
        pillar_label: PILLAR_LABEL[p],
        interpretation: pillarInterpretationFor(p, rows),
        rows,
      });
    }
  }
  if (groups.every((g) => g.rows.every((r) => !isMeasuredScore({ value: r.value, state: r.state })))) {
    return { state: 'insufficient_signal', groups };
  }
  return { state: 'measured', groups };
}

// ── 2. Score Drivers ──────────────────────────────────────────────────────

export type ScoreDriverEntry = {
  pillar: PillarKey;
  label: string;
  value: number;
  why: string;
};

export type ScoreDrivers = {
  state: 'measured' | 'insufficient_signal';
  drivers: ScoreDriverEntry[];
  rate_limiters: ScoreDriverEntry[];
  compounders: ScoreDriverEntry[];
  /** Single-paragraph executive read on what is helping vs. suppressing authority. */
  read: string;
};

export function buildScoreDrivers(report: CanonicalReport): ScoreDrivers {
  const measuredAxes: Array<{ pillar: PillarKey; label: string; value: number }> = [];
  for (const axis of report.discoverability_authority_radar?.axes ?? []) {
    if (isMeasuredScore(axis.score)) {
      measuredAxes.push({ pillar: axis.pillar, label: axis.label, value: axis.score.value as number });
    }
  }
  // Fallback to pillar dimensions if the radar surface is empty.
  if (measuredAxes.length === 0) {
    for (const p of report.pillars) {
      for (const d of p.dimensions) {
        if (isMeasuredScore(d.score)) {
          measuredAxes.push({ pillar: d.pillar, label: d.label, value: d.score.value as number });
        }
      }
    }
  }
  if (measuredAxes.length < 2) {
    return {
      state: 'insufficient_signal',
      drivers: [],
      rate_limiters: [],
      compounders: [],
      read: 'Score drivers cannot yet be isolated — measurement across the dimensions is still forming.',
    };
  }
  const sortedDesc = [...measuredAxes].sort((a, b) => b.value - a.value);
  const sortedAsc = [...measuredAxes].sort((a, b) => a.value - b.value);
  const drivers = sortedDesc.slice(0, 2).map((d) => ({
    pillar: d.pillar,
    label: d.label,
    value: d.value,
    why: `Reads ${d.value}/100 — the highest-contributing dimension on the ${PILLAR_LABEL[d.pillar]} pillar.`,
  }));
  const rate_limiters = sortedAsc.slice(0, 2).map((d) => ({
    pillar: d.pillar,
    label: d.label,
    value: d.value,
    why: `Reads ${d.value}/100 — slowest-moving dimension; suppresses ${PILLAR_LABEL[d.pillar]} until it lifts.`,
  }));
  // Compounders: dimensions ≥60 with a measured pillar peer also ≥60 (mutually reinforcing).
  const byPillar = new Map<PillarKey, number[]>();
  for (const a of measuredAxes) {
    const arr = byPillar.get(a.pillar) ?? [];
    arr.push(a.value);
    byPillar.set(a.pillar, arr);
  }
  const compounders: ScoreDriverEntry[] = [];
  for (const a of sortedDesc) {
    if (a.value < 60) continue;
    const peers = byPillar.get(a.pillar) ?? [];
    const peerSupport = peers.filter((v) => v !== a.value && v >= 55).length;
    if (peerSupport > 0) {
      compounders.push({
        pillar: a.pillar,
        label: a.label,
        value: a.value,
        why: `Reads ${a.value}/100 alongside a peer dimension on ${PILLAR_LABEL[a.pillar]} ≥ 55 — mutually reinforcing.`,
      });
    }
    if (compounders.length === 2) break;
  }
  const read = (() => {
    const driverWord = drivers.length > 0 ? drivers[0].label : null;
    const rlWord = rate_limiters.length > 0 ? rate_limiters[0].label : null;
    if (driverWord && rlWord) {
      return `Authority is currently driven by ${driverWord} and held back by ${rlWord}. Closing the rate-limiter gap moves the system more than reinforcing the driver further.`;
    }
    if (driverWord) {
      return `Authority is currently driven by ${driverWord}. The supporting dimensions need to catch up before the driver compounds.`;
    }
    return 'Authority drivers are not yet isolated. Measurement across the dimensions is still forming.';
  })();
  return { state: 'measured', drivers, rate_limiters, compounders, read };
}

// ── 3. Comparative Positioning ────────────────────────────────────────────

export type ComparativePositioning = {
  state: 'measured' | 'unavailable';
  brand_value: number | null;
  peer_median: number | null;
  top_quartile: number | null;
  percentile: number | null;
  peer_count: number | null;
  vertical: string | null;
  read: string;
};

export function buildComparativePositioning(report: CanonicalReport): ComparativePositioning {
  const benchmark = report.benchmark;
  const overlay = benchmark.overlay;
  if (benchmark.state !== 'measured' || !overlay) {
    return {
      state: 'unavailable',
      brand_value: null,
      peer_median: null,
      top_quartile: null,
      percentile: null,
      peer_count: null,
      vertical: null,
      read: 'Comparative positioning is held open until peer measurement accumulates. The dossier interprets the brand on absolute evidence until then.',
    };
  }
  const overall = report.authority_overview.overall_score;
  const brand = isMeasuredScore(overall) ? (overall.value as number) : null;
  const peerMedianAuthority = overlay.median?.['authority_inflow'] ?? overlay.median?.['ai_surface_presence'] ?? null;
  const topQAuthority = overlay.top_quartile?.['authority_inflow'] ?? overlay.top_quartile?.['ai_surface_presence'] ?? null;
  const ahead = brand != null && peerMedianAuthority != null && brand >= peerMedianAuthority;
  const read = (() => {
    if (brand == null || peerMedianAuthority == null) {
      return 'Peer comparison anchors are present but the brand value is not yet measurable on the same axis.';
    }
    const gap = brand - (peerMedianAuthority as number);
    const gapAbs = Math.abs(gap);
    if (gapAbs <= 5) return 'The brand reads at peer parity. The relative shape — not the absolute score — is what now decides evaluation.';
    if (ahead) return `The brand reads ${gapAbs} points above peer median. That distance is the asset to defend, not extend.`;
    return `The brand reads ${gapAbs} points below peer median. Closing this gap shifts how the brand reads in side-by-side evaluation more than absolute lift.`;
  })();
  return {
    state: 'measured',
    brand_value: brand,
    peer_median: typeof peerMedianAuthority === 'number' ? peerMedianAuthority : null,
    top_quartile: typeof topQAuthority === 'number' ? topQAuthority : null,
    percentile: overlay.percentile ?? null,
    peer_count: overlay.peer_count ?? null,
    vertical: overlay.vertical ?? null,
    read,
  };
}

// ── 4. Trajectory & Movement ──────────────────────────────────────────────

export type TrajectoryMovement = {
  state: 'measured' | 'insufficient_history';
  snapshots: Array<{ observed_at: string; value: number | null }>;
  authority_delta: { current: number | null; previous: number | null; delta: number | null; direction: string };
  ai_visibility_delta: { current: number | null; previous: number | null; delta: number | null; direction: string };
  notable_changes: string[];
  read: string;
};

export function buildTrajectoryMovement(report: CanonicalReport): TrajectoryMovement {
  const change = report.change_intelligence;
  const trajectory = report.authority_trajectory;
  const snapshots = (trajectory?.snapshots ?? []).map((s) => ({
    observed_at: s.observed_at,
    value: isMeasuredScore(s.score) ? (s.score.value as number) : null,
  }));
  if (change.state !== 'measured' && snapshots.filter((s) => s.value != null).length < 3) {
    return {
      state: 'insufficient_history',
      snapshots,
      authority_delta: { current: null, previous: null, delta: null, direction: 'first_observation' },
      ai_visibility_delta: { current: null, previous: null, delta: null, direction: 'first_observation' },
      notable_changes: [],
      read: 'Trajectory needs repeated observation to interpret. The dossier holds the present read as the baseline rather than a trend.',
    };
  }
  const direction = change.authority_delta?.direction ?? 'first_observation';
  const read = (() => {
    if (direction === 'improved') {
      return 'Authority is moving upward across the observed window. Sustain the inputs that produced the lift; do not switch them.';
    }
    if (direction === 'regressed') {
      return 'Authority has receded across the observed window. Decay typically signals a maintenance failure rather than the absence of new work.';
    }
    if (direction === 'stagnated') {
      return 'Authority has held position across the observed window. In a category where peers move, holding becomes relative loss over enough quarters.';
    }
    return 'Trajectory direction is forming. One observation describes the present; only repetition describes the trend.';
  })();
  return {
    state: change.state === 'measured' ? 'measured' : 'insufficient_history',
    snapshots,
    authority_delta: change.authority_delta ?? { current: null, previous: null, delta: null, direction },
    ai_visibility_delta: change.ai_visibility_delta ?? { current: null, previous: null, delta: null, direction: 'first_observation' },
    notable_changes: change.notable_changes ?? [],
    read,
  };
}

// ── 5. Data Confidence ────────────────────────────────────────────────────

export type DataConfidence = {
  measured_count: number;
  inferred_count: number;
  insufficient_count: number;
  unavailable_count: number;
  total_observations: number;
  total_providers: number;
  healthy_providers: number;
  freshness_label: string;
  read: string;
};

export function buildDataConfidence(report: CanonicalReport): DataConfidence {
  let measured = 0, inferred = 0, insufficient = 0, unavailable = 0;
  const states: ScoreState[] = [];
  for (const p of report.pillars) {
    states.push(p.score.state);
    for (const d of p.dimensions) states.push(d.score.state);
  }
  states.push(report.authority_overview.overall_score.state);
  states.push(report.ai_surface_presence.score.state);
  states.push(report.knowledge_graph.score.state);
  states.push(report.authority_inflow.score.state);
  states.push(report.trust_coherence.score.state);
  for (const s of states) {
    if (s === 'measured') measured++;
    else if (s === 'inferred') inferred++;
    else if (s === 'insufficient_signal') insufficient++;
    else if (s === 'unavailable') unavailable++;
  }
  const overallEvidence = report.evidence_trace?.overall;
  const total_observations = overallEvidence?.count ?? 0;
  const providers = report.provider_observability?.providers ?? [];
  const total_providers = providers.length;
  const healthy_providers = providers.filter((p) => p.state === 'healthy').length;
  const freshness_label = (() => {
    const ageHours = overallEvidence?.freshness?.age_hours;
    if (ageHours == null) return 'Freshness not yet measurable';
    if (ageHours <= 24) return 'Evidence within the last 24 hours';
    if (ageHours <= 168) return 'Evidence within the last week';
    if (ageHours <= 720) return 'Evidence within the last month';
    return 'Evidence is older than one month';
  })();
  const read = (() => {
    if (measured + inferred === 0) {
      return 'Data confidence is forming. The dossier holds the architecture honestly open until measurement begins.';
    }
    if (insufficient + unavailable > measured) {
      return 'Data confidence is partial. Read interpretive sections as directional; treat measured surfaces as load-bearing.';
    }
    return 'Data confidence is sufficient for executive-grade interpretation. Where dimensions are inferred or insufficient, the dossier names them explicitly rather than fabricating coverage.';
  })();
  return {
    measured_count: measured,
    inferred_count: inferred,
    insufficient_count: insufficient,
    unavailable_count: unavailable,
    total_observations,
    total_providers,
    healthy_providers,
    freshness_label,
    read,
  };
}

// ── 6. Channel Leverage (AI provider × query-class gap interpretation) ───

export type ChannelLeverageEntry = {
  provider: string;
  query_class: string;
  citation_rate: number | null;
  status: 'leverage' | 'gap' | 'absent';
  why: string;
};

export type ChannelLeverage = {
  state: 'measured' | 'unavailable';
  top_leverage_cells: ChannelLeverageEntry[];
  /** Single executive read on where AI investment compounds. */
  read: string;
};

export function buildChannelLeverage(report: CanonicalReport): ChannelLeverage {
  const matrix = report.ai_surface_presence.citation_matrix;
  if (!matrix || matrix.cells.length === 0) {
    return {
      state: 'unavailable',
      top_leverage_cells: [],
      read: 'Channel leverage requires the AI citation matrix to resolve. The dossier holds this open until provider × query-class measurement accumulates.',
    };
  }
  const cells = matrix.cells.filter((c) => c.state !== 'unavailable');
  if (cells.length === 0) {
    return {
      state: 'unavailable',
      top_leverage_cells: [],
      read: 'Citation cells are not yet measurable. Establishing measurement is the first move.',
    };
  }
  // Leverage cells: high prominence already. Gap cells: low rate but measurable.
  const highRate = cells.filter((c) => (c.citation_rate ?? 0) >= 0.6);
  const gaps = cells.filter((c) => (c.citation_rate ?? 0) < 0.3);
  const top_leverage_cells: ChannelLeverageEntry[] = [];
  for (const c of highRate.slice(0, 2)) {
    top_leverage_cells.push({
      provider: c.provider,
      query_class: c.query_class,
      citation_rate: c.citation_rate,
      status: 'leverage',
      why: `Citation rate ${Math.round((c.citation_rate ?? 0) * 100)}% — the brand is reliably retrieved here. Defend this surface deliberately.`,
    });
  }
  for (const c of gaps.slice(0, 2)) {
    top_leverage_cells.push({
      provider: c.provider,
      query_class: c.query_class,
      citation_rate: c.citation_rate,
      status: 'gap',
      why: `Citation rate ${Math.round((c.citation_rate ?? 0) * 100)}% — the brand is largely absent. Closing this cell extends retrieval where it currently does not reach.`,
    });
  }
  const read =
    top_leverage_cells.length === 0
      ? 'Citation coverage is uniform across cells; channel leverage is moot until variance emerges.'
      : 'Channel leverage is in the cells where the brand is already retrieved (defend) and where it is absent (extend). Investment compounds where coverage is uneven.';
  return { state: 'measured', top_leverage_cells, read };
}

// ── 8. Market Context (external pressure interpretation) ─────────────────

export type MarketContextEntry = {
  label: string;
  reading: string;
};

export type MarketContext = {
  state: 'measured' | 'unavailable';
  vertical: string | null;
  peer_count: number | null;
  entries: MarketContextEntry[];
  /** A single executive interpretation tying the entries together. */
  read: string;
};

export function buildMarketContext(report: CanonicalReport): MarketContext {
  const benchmark = report.benchmark;
  const overlay = benchmark.overlay;
  const competitive = report.competitive_surface_share;
  if (benchmark.state !== 'measured' || !overlay) {
    return {
      state: 'unavailable',
      vertical: null,
      peer_count: null,
      entries: [],
      read: 'Market context is held open until peer measurement accumulates. The dossier interprets the brand on absolute evidence until then.',
    };
  }
  const entries: MarketContextEntry[] = [];
  const peerCount = overlay.peer_count ?? null;
  const vertical = overlay.vertical ?? null;

  // Category pressure — derived from peer count + percentile.
  if (peerCount != null && peerCount >= 2) {
    const percentile = overlay.percentile;
    const pressure =
      peerCount >= 12
        ? 'high — the category is crowded and authority signals must work harder to be noticed.'
        : peerCount >= 6
          ? 'moderate — the comparable set is large enough to set evaluation norms but small enough that distinctiveness cuts through.'
          : 'low — the comparable set is narrow; differentiation depends less on volume of signal and more on coherence of position.';
    entries.push({
      label: 'Category Pressure',
      reading: `Measurable peer set: ${peerCount}${vertical ? ` in ${vertical}` : ''}. Pressure is ${pressure}${percentile != null ? ` Brand reads at the ${percentile}th percentile of this set.` : ''}`,
    });
  }

  // Authority distance — gap between brand and top quartile on authority/AI.
  const overall = report.authority_overview.overall_score;
  const topQAuthority = overlay.top_quartile?.['authority_inflow'] ?? overlay.top_quartile?.['ai_surface_presence'] ?? null;
  if (overall.value != null && topQAuthority != null) {
    const gap = (topQAuthority as number) - overall.value;
    if (gap >= 15) {
      entries.push({
        label: 'Authority Distance',
        reading: `${gap} points to top-quartile authority. The distance is structural — closing it requires sustained corroboration density, not single campaigns.`,
      });
    } else if (gap >= 5) {
      entries.push({
        label: 'Authority Distance',
        reading: `${gap} points to top-quartile authority. The gap is closeable within one or two compounding cycles if the work concentrates.`,
      });
    } else if (gap > -5) {
      entries.push({
        label: 'Authority Position',
        reading: 'The brand reads at the top quartile of the comparable set. The asset is the position; the work is non-regression.',
      });
    } else {
      entries.push({
        label: 'Authority Position',
        reading: `The brand reads ${Math.abs(gap)} points above the top quartile. Defending this distance is the strategic question.`,
      });
    }
  }

  // Discoverability pressure — peer median on AI surface vs brand.
  const peerMedianAi = overlay.median?.['ai_surface_presence'] ?? null;
  const brandAi = report.ai_surface_presence.score.value;
  if (typeof peerMedianAi === 'number' && brandAi != null) {
    const aiGap = brandAi - peerMedianAi;
    if (aiGap < -10) {
      entries.push({
        label: 'Discoverability Pressure',
        reading: `Peer median AI surface presence reads ${peerMedianAi}/100 versus the brand's ${brandAi}/100. AI-mediated discovery is shifting where peers already sit; the gap costs more each quarter buyer behaviour migrates further toward AI answers.`,
      });
    } else if (aiGap < 5) {
      entries.push({
        label: 'Discoverability Pressure',
        reading: `Peer median AI surface presence reads ${peerMedianAi}/100; the brand reads at parity. Holding parity here is non-trivial — peers will continue to invest in the same surface.`,
      });
    } else {
      entries.push({
        label: 'Discoverability Advantage',
        reading: `Brand AI surface presence (${brandAi}/100) reads above peer median (${peerMedianAi}/100). The retrieval lead is the asset; the work is uniformity of coverage as peers catch up.`,
      });
    }
  }

  // Competitor texture — short note from canonical competitive_summary.
  const competitorCount = competitive.competitors?.length ?? 0;
  if (competitorCount > 0) {
    entries.push({
      label: 'Competitor Texture',
      reading: `${competitorCount} competitor${competitorCount === 1 ? '' : 's'} measured on the same dimensions. The competitive shape — not the score gap — is what evaluators read in side-by-side comparison.`,
    });
  }

  const read = entries.length > 0
    ? 'Market context surrounds the absolute reading. The brand exists inside a moving peer set; the dossier interprets that shape rather than the brand in isolation.'
    : 'Market context is forming. The dossier names what is currently measurable.';

  return {
    state: entries.length > 0 ? 'measured' : 'unavailable',
    vertical,
    peer_count: peerCount,
    entries,
    read,
  };
}

// ── 9. AI Retrieval Reliability (provider variance + retrievability) ─────

export type AIRetrievalEntry = {
  label: string;
  reading: string;
};

export type AIRetrievalReliability = {
  state: 'measured' | 'unavailable';
  retrieval_consistency_pct: number | null;
  measured_providers: number;
  total_providers: number;
  measured_query_classes: number;
  total_query_classes: number;
  cited_cells: number;
  weak_cells: number;
  entries: AIRetrievalEntry[];
  read: string;
};

export function buildAIRetrievalReliability(report: CanonicalReport): AIRetrievalReliability {
  const matrix = report.ai_surface_presence.citation_matrix;
  if (!matrix) {
    return {
      state: 'unavailable',
      retrieval_consistency_pct: null,
      measured_providers: 0,
      total_providers: 0,
      measured_query_classes: 0,
      total_query_classes: 0,
      cited_cells: 0,
      weak_cells: 0,
      entries: [],
      read: 'AI retrieval reliability is held open until the citation matrix resolves.',
    };
  }
  const cells = matrix.cells.filter((c) => c.state !== 'unavailable' && c.state !== 'insufficient_signal');
  const measuredProviders = matrix.by_provider.filter((p) => p.state !== 'unavailable' && p.state !== 'insufficient_signal').length;
  const measuredQc = matrix.by_query_class.filter((q) => q.state !== 'unavailable' && q.state !== 'insufficient_signal').length;
  const totalProviders = matrix.by_provider.length;
  const totalQc = matrix.by_query_class.length;
  const citedCells = cells.filter((c) => (c.citation_rate ?? 0) >= 0.6).length;
  const weakCells = cells.filter((c) => (c.citation_rate ?? 0) < 0.3).length;
  const consistency = cells.length > 0 ? Math.round((cells.length / Math.max(matrix.coverage.total_cells, 1)) * 100) : null;

  if (cells.length === 0) {
    return {
      state: 'unavailable',
      retrieval_consistency_pct: null,
      measured_providers: 0,
      total_providers: totalProviders,
      measured_query_classes: 0,
      total_query_classes: totalQc,
      cited_cells: 0,
      weak_cells: 0,
      entries: [],
      read: 'AI retrieval cells are not yet measurable. Establishing measurement is the first move.',
    };
  }

  const entries: AIRetrievalEntry[] = [];

  // Retrieval consistency — variance across measured cells.
  if (consistency != null) {
    entries.push({
      label: 'Retrieval Consistency',
      reading: `${cells.length} of ${matrix.coverage.total_cells} provider × query-class cells measured (${consistency}%). The measured surface is where retrieval can be trusted; the unmeasured surface is where pressure compounds invisibly.`,
    });
  }

  // Answer-engine trust state — count of cells with high citation.
  if (citedCells > 0) {
    entries.push({
      label: 'Answer-Engine Trust',
      reading: `${citedCells} cell${citedCells === 1 ? '' : 's'} citing the brand at ≥60% reliability. Where trust is established, AI systems return the brand without prompting; this is the asset that compounds.`,
    });
  } else {
    entries.push({
      label: 'Answer-Engine Trust',
      reading: 'No measured cell yet shows ≥60% reliability. Trust here is built through citation-readiness — entity clarity, structured answers, and authoritative corroboration.',
    });
  }

  // Brand retrievability pressure — proportion of weak cells.
  if (weakCells > 0) {
    const pct = Math.round((weakCells / cells.length) * 100);
    entries.push({
      label: 'Retrievability Pressure',
      reading: `${weakCells} of ${cells.length} measured cells return the brand at <30% reliability (${pct}%). Each weak cell is a question the brand is not answering for buyers researching through AI.`,
    });
  }

  // Provider variance — how uneven retrieval is across providers.
  if (measuredProviders >= 2) {
    const rates = matrix.by_provider.filter((p) => typeof p.citation_rate === 'number').map((p) => p.citation_rate as number);
    if (rates.length >= 2) {
      const max = Math.max(...rates);
      const min = Math.min(...rates);
      const variance = max - min;
      if (variance >= 0.2) {
        entries.push({
          label: 'Provider Variance',
          reading: `Citation rate varies by ${Math.round(variance * 100)} points across measured providers. Coverage is uneven — strong on some surfaces, absent on others; uniformity is where investment compounds.`,
        });
      }
    }
  }

  const read =
    citedCells === 0 && weakCells > 0
      ? 'AI retrieval is currently a structural gap. Buyers asking AI systems about the category are not consistently being shown the brand. The cost is not theoretical — it grows each quarter buyer research migrates further toward AI-mediated answers.'
      : citedCells > 0 && weakCells === 0
        ? 'AI retrieval is structurally working. The brand is consistently surfaced where evaluators look. The strategic question is uniformity as peers invest in the same surface.'
        : 'AI retrieval is partial. The cells where the brand is cited are assets to defend; the cells where it is absent are where competitive pressure quietly builds.';

  return {
    state: 'measured',
    retrieval_consistency_pct: consistency,
    measured_providers: measuredProviders,
    total_providers: totalProviders,
    measured_query_classes: measuredQc,
    total_query_classes: totalQc,
    cited_cells: citedCells,
    weak_cells: weakCells,
    entries,
    read,
  };
}

// ── 10. AI Trajectory (AI visibility delta direction) ────────────────────

