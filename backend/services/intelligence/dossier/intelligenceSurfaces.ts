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

function isMeasuredScore(score: { value: number | null; state: ScoreState }): boolean {
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

function trim(text: string | null | undefined, max = 120): string | null {
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
  const state_label = state === 'identified' ? 'Identified' : state === 'partial' ? 'Partially Identified' : state === 'absent' ? 'Not Identified' : 'Not Yet Measured';

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

const COMPETITOR_MATRIX_DIMENSIONS: Array<{ key: CanonicalDimensionKey; label: string }> = [
  { key: 'authority_inflow', label: 'Authority' },
  { key: 'topical_authority', label: 'Topical' },
  { key: 'ai_surface_presence', label: 'AI' },
  { key: 'trust_coherence', label: 'Trust' },
  { key: 'entity_graph_strength', label: 'Entity' },
];

function avg(values: number[]): number | null {
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
export type StrongestPeerGap = {
  state: 'measured' | 'unavailable';
  dimension_label: string | null;
  user_value: number | null;
  peer_average: number | null;
  gap_points: number | null;
  confidence_band: ConfidenceBand;
  headline: string;
  why: string;
  led_by: string[];
};

export function buildStrongestPeerGap(report: CanonicalReport): StrongestPeerGap {
  const competitive = report.competitive_surface_share;
  const competitors = competitive?.competitors ?? [];
  const peerAverage = competitive?.competitor_average ?? {};
  const userValues = competitive?.user ?? {};
  if (competitors.length === 0) {
    return {
      state: 'unavailable',
      dimension_label: null,
      user_value: null,
      peer_average: null,
      gap_points: null,
      confidence_band: 'low',
      headline: 'Strongest peer gap is held open until competitive measurement accumulates.',
      why: 'The dossier interprets the brand on absolute evidence until a peer set resolves.',
      led_by: [],
    };
  }

  const candidates: Array<{ key: CanonicalDimensionKey; label: string; user: number; peer: number; gap: number }> = [];
  for (const col of COMPETITOR_MATRIX_DIMENSIONS) {
    const u = userValues[col.key];
    const p = peerAverage[col.key];
    if (typeof u === 'number' && typeof p === 'number') {
      candidates.push({ key: col.key, label: col.label, user: u, peer: p, gap: p - u });
    }
  }
  if (candidates.length === 0) {
    return {
      state: 'unavailable',
      dimension_label: null,
      user_value: null,
      peer_average: null,
      gap_points: null,
      confidence_band: 'low',
      headline: 'Strongest peer gap is held open — no overlapping measured dimensions resolved.',
      why: 'The brand and peer set do not yet share enough measured dimensions to isolate one dominant gap.',
      led_by: [],
    };
  }

  // Sort by absolute gap descending; if peer ahead (gap>0) takes priority.
  const sorted = [...candidates].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const top = sorted[0];
  const peerAhead = top.gap > 0;
  const ledBy = competitors
    .filter((c) => typeof c.values[top.key] === 'number' && (c.values[top.key] as number) >= top.peer)
    .slice(0, 3)
    .map((c) => c.name);

  // The gap_points value is the real arithmetic difference between the
  // user score and the peer average on the same canonical dimension.
  // No synthetic "impact" multiplier. Confidence is the canonical
  // competitive scan confidence band (not fabricated).
  const confidence: ConfidenceBand = competitive?.confidence ?? 'medium';

  const headline = peerAhead
    ? `${top.label === 'Authority' ? 'Authority leaders' : `Peers on ${top.label.toLowerCase()}`} are signalling more strength than the brand`
    : `Brand leads peer set on ${top.label.toLowerCase()}`;
  const why = peerAhead
    ? `${top.label} gap of ${Math.abs(top.gap)} points (peers ${top.peer}/100, brand ${top.user}/100) makes every downstream surface harder — buyers trust better-known alternatives faster.`
    : `${top.label} lead of ${Math.abs(top.gap)} points (brand ${top.user}/100, peers ${top.peer}/100) is the differentiation worth defending deliberately.`;

  return {
    state: 'measured',
    dimension_label: top.label,
    user_value: top.user,
    peer_average: top.peer,
    gap_points: top.gap,
    confidence_band: confidence,
    headline,
    why,
    led_by: ledBy,
  };
}

// ── 20. Competitor Benchmark (per-competitor average bars) ──────────────
//
// Visualises each competitor's overall measured average as a horizontal
// bar — recovers the legacy Competitor Benchmark visualization without
// the C/A pricing/feature columns.

export type CompetitorBenchmarkEntry = {
  name: string;
  overall: number | null;
  state: 'measured' | 'partial' | 'unmeasured';
};

export type CompetitorBenchmark = {
  state: 'measured' | 'unavailable';
  user_overall: number | null;
  entries: CompetitorBenchmarkEntry[];
  reading: string;
};

export function buildCompetitorBenchmark(report: CanonicalReport): CompetitorBenchmark {
  const matrix = buildCompetitorMatrix(report);
  if (matrix.state === 'unavailable') {
    return {
      state: 'unavailable',
      user_overall: null,
      entries: [],
      reading: 'Competitor benchmark is held open until peer measurement accumulates.',
    };
  }
  const entries: CompetitorBenchmarkEntry[] = matrix.competitor_rows.map((r) => ({
    name: r.name,
    overall: r.overall,
    state: r.overall != null ? 'measured' : 'unmeasured',
  }));
  const measured = entries.filter((e) => e.overall != null);
  if (measured.length === 0) {
    return {
      state: 'unavailable',
      user_overall: matrix.user_row?.overall ?? null,
      entries,
      reading: 'Competitor benchmark cannot be computed — peer dimensions are not yet measurable.',
    };
  }
  const peerAvg = Math.round(measured.reduce((a, b) => a + (b.overall as number), 0) / measured.length);
  const user = matrix.user_row?.overall ?? null;
  const reading = (() => {
    if (user == null) return `Peer set average reads ${peerAvg}/100 across ${measured.length} measured competitors.`;
    if (user >= peerAvg + 5) return `Peer set average reads ${peerAvg}/100; the brand reads ${user}/100 — leading the measured peer set.`;
    if (user >= peerAvg - 5) return `Peer set average reads ${peerAvg}/100; the brand reads ${user}/100 — at parity with peers on the measurable dimensions.`;
    return `Peer set average reads ${peerAvg}/100; the brand reads ${user}/100 — trailing the measurable peer set on the dimensions where overlap exists.`;
  })();
  return {
    state: 'measured',
    user_overall: user,
    entries,
    reading,
  };
}

// ── 21. Limiting Dimensions (top-3 lowest measured) ─────────────────────
//
// Recovers the legacy "What Is Limiting The Score" surface — instead of
// surfacing one bottleneck, it lists the top 3 lowest measured
// dimensions with a single sentence explaining each.

export type LimitingDimension = {
  pillar: PillarKey;
  label: string;
  value: number;
  why: string;
};

export type LimitingDimensions = {
  state: 'measured' | 'insufficient_signal';
  entries: LimitingDimension[];
};

export function buildLimitingDimensions(report: CanonicalReport): LimitingDimensions {
  const measured: Array<{ pillar: PillarKey; label: string; value: number }> = [];
  for (const axis of report.discoverability_authority_radar?.axes ?? []) {
    if (isMeasuredScore(axis.score)) {
      measured.push({ pillar: axis.pillar, label: axis.label, value: axis.score.value as number });
    }
  }
  if (measured.length === 0) {
    for (const p of report.pillars) {
      for (const d of p.dimensions) {
        if (isMeasuredScore(d.score)) {
          measured.push({ pillar: d.pillar, label: d.label, value: d.score.value as number });
        }
      }
    }
  }
  if (measured.length < 2) {
    return { state: 'insufficient_signal', entries: [] };
  }
  const sorted = [...measured].sort((a, b) => a.value - b.value).slice(0, 3);
  return {
    state: 'measured',
    entries: sorted.map((d) => ({
      pillar: d.pillar,
      label: d.label,
      value: d.value,
      why: `${d.label} is limiting the score because it currently reads ${d.value}/100 — the geometric mean drags every stronger dimension down toward this number.`,
    })),
  };
}

// ── 22. Fastest Improvement Lever ────────────────────────────────────────
//
// A single sentence naming the dimension whose movement would improve
// the overall score fastest. Recovers the legacy "Fastest Improvement
// Lever" callout.

export type FastestLever = {
  state: 'measured' | 'insufficient_signal';
  dimension_label: string | null;
  pillar: PillarKey | null;
  current_value: number | null;
  reading: string;
};

export function buildFastestLever(report: CanonicalReport): FastestLever {
  const drivers = buildScoreDrivers(report);
  if (drivers.state === 'insufficient_signal' || drivers.rate_limiters.length === 0) {
    return {
      state: 'insufficient_signal',
      dimension_label: null,
      pillar: null,
      current_value: null,
      reading: 'The fastest improvement lever cannot yet be isolated — measurement across the dimensions is still forming.',
    };
  }
  const lever = drivers.rate_limiters[0];
  return {
    state: 'measured',
    dimension_label: lever.label,
    pillar: lever.pillar,
    current_value: lever.value,
    reading: `${lever.label} is the clearest dimension to move next based on the current score model — its low position drags the geometric mean below what the strongest dimensions can carry.`,
  };
}

// ── 23. Growth Path Directives (3-line "Improve X" map) ──────────────────
//
// Recovers the legacy Growth Path's 3-line actionable improvement map.
// Currently the new dossier has Path Forward (single sentence); this
// adds the explicit 3-line "Improve X / Y / Z" directives derived
// deterministically from the limiting dimensions.

export type GrowthPathDirective = {
  pillar: PillarKey;
  text: string;
};

export type GrowthPathDirectives = {
  state: 'measured' | 'insufficient_signal';
  current_level: string;
  next_level: string;
  directives: GrowthPathDirective[];
};

export function buildGrowthPathDirectives(report: CanonicalReport): GrowthPathDirectives {
  const stage = report.maturity_stage;
  const limiting = buildLimitingDimensions(report);
  if (stage.stage === 'insufficient_signal' || limiting.state === 'insufficient_signal') {
    return {
      state: 'insufficient_signal',
      current_level: 'Foundation forming',
      next_level: 'Measurement first',
      directives: [],
    };
  }
  return {
    state: 'measured',
    current_level: stage.label,
    next_level: stage.next_stage ?? 'Hold position',
    directives: limiting.entries.slice(0, 3).map((d) => ({
      pillar: d.pillar,
      text: `Improve ${d.label.toLowerCase()} — currently the ${d.value}/100 drag on total score.`,
    })),
  };
}

// ── 24. Strategic Position 4-State (recovered from legacy snapshot) ──────
//
// Recovers the legacy "What's Broken / Fix First / Delay / If Ignored"
// 4-state framing as a visually punchy strategic position block. Every
// value is sourced from canonical fields — no synthesised content.

export type StrategicPositionFourState = {
  state: 'measured' | 'insufficient_signal';
  whats_broken: string;
  fix_first: string;
  delay: string;
  if_ignored: string;
};

export function buildStrategicPositionFourState(report: CanonicalReport): StrategicPositionFourState {
  const overall = report.authority_overview.overall_score;
  if (!isMeasuredScore(overall)) {
    return {
      state: 'insufficient_signal',
      whats_broken: 'Authority signals are still forming — the dominant break cannot yet be isolated.',
      fix_first: 'Establish baseline measurement across the dimensions before optimising.',
      delay: 'Distribution and amplification work — until the substrate measures, every push runs blind.',
      if_ignored: 'The brand will keep producing signal that is not registering anywhere measurable.',
    };
  }
  const primaryConstraint = report.executive_insights.primary_constraint?.text ?? '';
  const topAction = report.action_playbook?.actions?.[0];
  const lowSeverity = (report.action_playbook?.actions ?? []).find((a) => a.severity === 'low');
  const risk = report.executive_insights.authority_risk?.text ?? '';

  const whats_broken = primaryConstraint
    ? sentenceCapped(primaryConstraint, 180)
    : 'Authority signals are uneven across the canonical pillars; the system does not yet move as one.';
  const fix_first = topAction
    ? sentenceCapped(topAction.title, 180)
    : 'Pick the lowest-scoring pillar and concentrate effort there — the geometric mean rewards uniformity.';
  const delay = lowSeverity
    ? `Hold off on ${sentenceCapped(lowSeverity.title.toLowerCase(), 140)} — it does not unlock anything until upstream constraints clear.`
    : 'Hold off on parallel campaigns across multiple pillars at half-effort — depth on one moves the system more than breadth on five.';
  const if_ignored = risk
    ? sentenceCapped(risk, 200)
    : 'The brand keeps producing effort that converts inefficiently — incremental gains rather than compounding ones.';

  return {
    state: 'measured',
    whats_broken,
    fix_first,
    delay,
    if_ignored,
  };
}

function sentenceCapped(text: string, max: number): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

// ── 25. Data Source Status Panels (6-panel grid, recovered from legacy) ─
//
// Replaces the thin 4-cell confidence matrix with a richer 6-panel grid
// showing each canonical data source: state + current state + impact +
// what unlocks. Every panel reads its state from real adapter
// observability or from the relevant canonical field's score state.

export type DataSourceStatus = 'connected' | 'partial' | 'missing' | 'disabled';

export type DataSourcePanel = {
  source_label: string;
  status: DataSourceStatus;
  status_label: string;
  current_state: string;
  impact: string;
  what_unlocks: string;
};

function statusFromScore(score: { state: ScoreState; value: number | null }): DataSourceStatus {
  if (score.state === 'measured' && score.value != null) return 'connected';
  if (score.state === 'inferred') return 'partial';
  if (score.state === 'unavailable') return 'disabled';
  return 'missing';
}

function statusLabel(s: DataSourceStatus): string {
  switch (s) {
    case 'connected': return 'Connected';
    case 'partial': return 'Partial';
    case 'missing': return 'Missing';
    case 'disabled': return 'Not Configured';
  }
}

export type DataSourceStatusPanels = {
  panels: DataSourcePanel[];
  connected_count: number;
  total: number;
};

export function buildDataSourceStatusPanels(report: CanonicalReport): DataSourceStatusPanels {
  const findDimension = (key: CanonicalDimensionKey) => {
    for (const p of report.pillars) {
      const d = p.dimensions.find((x) => x.key === key);
      if (d) return d.score;
    }
    return null;
  };
  const indexIntegrity = findDimension('index_integrity');
  const extractionReadiness = findDimension('extraction_readiness');
  const aiSurface = report.ai_surface_presence.score;
  const authorityInflow = report.authority_inflow.score;
  const trustCoherence = report.trust_coherence.score;
  const competitive = report.competitive_surface_share;
  const competitorCount = competitive?.competitors?.length ?? 0;

  const panels: DataSourcePanel[] = [
    {
      source_label: 'SEO / Crawl Health',
      status: indexIntegrity ? statusFromScore(indexIntegrity) : 'missing',
      status_label: '',
      current_state: indexIntegrity && indexIntegrity.state === 'measured'
        ? `Crawl integrity reads ${indexIntegrity.value}/100 across the indexable surface.`
        : 'No live crawl health data is connected yet.',
      impact: indexIntegrity && indexIntegrity.state === 'measured'
        ? 'Foundation pillar carries this dimension forward.'
        : 'Cannot fully measure indexability or crawl integrity.',
      what_unlocks: 'Crawl health · indexability · metadata coverage',
    },
    {
      source_label: 'Content & Extraction',
      status: extractionReadiness ? statusFromScore(extractionReadiness) : 'missing',
      status_label: '',
      current_state: extractionReadiness && extractionReadiness.state === 'measured'
        ? `Extraction readiness reads ${extractionReadiness.value}/100 across structured surfaces.`
        : 'Content structure and extractability have not yet been measured.',
      impact: extractionReadiness && extractionReadiness.state === 'measured'
        ? 'Discoverability + AI Surface Presence depend on this dimension.'
        : 'Coverage gaps are directional, not exhaustive.',
      what_unlocks: 'Schema density · structured answers · extractability',
    },
    {
      source_label: 'Backlink & Authority',
      status: statusFromScore(authorityInflow),
      status_label: '',
      current_state: authorityInflow.state === 'measured'
        ? `Authority inflow reads ${authorityInflow.value}/100 across measurable sources.`
        : authorityInflow.state === 'inferred'
          ? 'Authority is currently estimated from on-site signals only.'
          : 'No backlink data source is connected.',
      impact: authorityInflow.state === 'measured'
        ? 'Authority score reflects measured external corroboration.'
        : 'Authority score may not reflect true strength.',
      what_unlocks: 'Referring domains · link quality · authority benchmarking',
    },
    {
      source_label: 'AI Visibility',
      status: statusFromScore(aiSurface),
      status_label: '',
      current_state: aiSurface.state === 'measured'
        ? `AI surface presence reads ${aiSurface.value}/100 with a live citation matrix.`
        : 'AI answer-engine citations have not yet been measured.',
      impact: aiSurface.state === 'measured'
        ? 'AI Discoverability section reads from the live citation matrix.'
        : 'Cannot measure actual AI answer presence.',
      what_unlocks: 'AI-engine × query-type citation rates · entity readiness',
    },
    {
      source_label: 'Competitor Intelligence',
      status: competitorCount > 0 ? 'connected' : 'missing',
      status_label: '',
      current_state: competitorCount > 0
        ? `${competitorCount} competitor${competitorCount === 1 ? '' : 's'} observed from public-web analysis.`
        : 'No competitor scan has resolved yet.',
      impact: competitorCount > 0
        ? 'Market Position section reads peer benchmarks directly.'
        : 'Market comparison is unavailable.',
      what_unlocks: 'Peer benchmarks · share of visibility · positioning gap',
    },
    {
      source_label: 'Trust & Reputation',
      status: statusFromScore(trustCoherence),
      status_label: '',
      current_state: trustCoherence.state === 'measured'
        ? `Trust coherence reads ${trustCoherence.value}/100 across consistency, review, and expertise signals.`
        : trustCoherence.state === 'inferred'
          ? 'Trust signals are inferred from public-facing surfaces only.'
          : 'No review or reputation source is connected yet.',
      impact: trustCoherence.state === 'measured'
        ? 'Trust & Consistency section reads measured signals.'
        : 'Trust coherence is held open until measurement begins.',
      what_unlocks: 'Review parity · NAP consistency · expertise extraction',
    },
  ];

  // Stamp the human-readable status_label.
  for (const p of panels) p.status_label = statusLabel(p.status);

  const connected = panels.filter((p) => p.status === 'connected').length;
  return {
    panels,
    connected_count: connected,
    total: panels.length,
  };
}

// ── 26. Execution Channel Mix (where execution capacity needs to land) ─
//
// Canonical owner_area distribution across the action playbook. Each
// owner area maps to a strategic team / channel responsible for the
// canonical actions assigned to it. Real data, no fabricated channels.

export type OwnerArea =
  | 'content'
  | 'engineering'
  | 'marketing_ops'
  | 'pr'
  | 'product'
  | 'cross_functional';

export type ExecutionChannelArea = {
  owner: OwnerArea;
  label: string;
  action_count: number;
  leading_action_title: string | null;
  pillars_touched: PillarKey[];
  has_critical_path: boolean;
  what_unlocks: string;
};

export type ExecutionChannelMix = {
  state: 'measured' | 'insufficient_signal';
  total_actions: number;
  areas: ExecutionChannelArea[];
  read: string;
};

const OWNER_LABEL: Record<OwnerArea, string> = {
  content: 'Content',
  engineering: 'Engineering',
  marketing_ops: 'Marketing Ops',
  pr: 'Public Relations',
  product: 'Product',
  cross_functional: 'Cross-Functional',
};

const OWNER_UNLOCK: Record<OwnerArea, string> = {
  content: 'Topical depth, citation-readiness, and answer extractability — the substrate AI surfaces read from.',
  engineering: 'Index integrity, schema readiness, and structural extractability — the foundation every other pillar relies on.',
  marketing_ops: 'Distribution rhythm and measurement — converting signal into compounding visibility.',
  pr: 'External corroboration and authority inflow — the proof evaluators verify off-site.',
  product: 'Differentiation and proof artefacts — what distinguishes the brand from operationally competent peers.',
  cross_functional: 'Coordination across content, engineering, ops, and PR — the rituals that make individual moves compound.',
};

export function buildExecutionChannelMix(report: CanonicalReport): ExecutionChannelMix {
  const playbook = report.strategic_playbook;
  const actions = playbook?.actions ?? [];
  if (actions.length === 0) {
    return {
      state: 'insufficient_signal',
      total_actions: 0,
      areas: [],
      read: 'Execution channel mix cannot yet be resolved — the action playbook is still forming.',
    };
  }
  const criticalPath = new Set(playbook.critical_path_ids ?? []);
  const groups = new Map<OwnerArea, typeof actions>();
  for (const a of actions) {
    const owner = (a.owner_area ?? 'cross_functional') as OwnerArea;
    const arr = groups.get(owner) ?? [];
    arr.push(a);
    groups.set(owner, arr);
  }
  const areas: ExecutionChannelArea[] = Array.from(groups.entries())
    .map(([owner, list]) => {
      const sorted = [...list].sort((a, b) => b.leverage_score - a.leverage_score);
      const pillarsTouched = Array.from(new Set(list.map((a) => a.pillar))) as PillarKey[];
      const hasCritical = list.some((a) => criticalPath.has(a.id));
      return {
        owner,
        label: OWNER_LABEL[owner],
        action_count: list.length,
        leading_action_title: sorted[0]?.title ?? null,
        pillars_touched: pillarsTouched,
        has_critical_path: hasCritical,
        what_unlocks: OWNER_UNLOCK[owner],
      };
    })
    .sort((a, b) => b.action_count - a.action_count);

  const total = actions.length;
  const dominant = areas[0];
  const read = dominant
    ? `${dominant.label} carries the heaviest share of execution this cycle (${dominant.action_count} of ${total} actions). The mix below names which teams own which moves so the playbook can be staffed without ambiguity.`
    : 'Execution capacity is distributed evenly across the owner areas.';
  return {
    state: 'measured',
    total_actions: total,
    areas,
    read,
  };
}

// ── 27. Competitor Pressure (per-competitor dominance breakdown) ────────
//
// For each measured competitor, identifies what kind of pressure they
// create on the brand by finding the dimension(s) where they outscore
// the brand the most. Recovers the legacy "Competitor Pressure" cards
// (Hubspot creates Feature pressure, Marketo creates Market pressure,
// etc.) using only canonical competitor scan data.

export type CompetitorPressureKind = 'authority' | 'discoverability' | 'trust' | 'foundation' | 'momentum' | 'parity';

export type CompetitorPressureCard = {
  name: string;
  pressure_kind: CompetitorPressureKind;
  pressure_label: string;
  dominant_dimension: string | null;
  dominant_gap: number | null;
  influence_mix: Array<{ pillar: PillarKey; level: 'high' | 'moderate' | 'low' }>;
  reading: string;
};

export type CompetitorPressure = {
  state: 'measured' | 'unavailable';
  cards: CompetitorPressureCard[];
};

const PRESSURE_LABEL: Record<CompetitorPressureKind, string> = {
  authority: 'Authority Pressure',
  discoverability: 'Discoverability Pressure',
  trust: 'Trust Pressure',
  foundation: 'Foundation Pressure',
  momentum: 'Momentum Pressure',
  parity: 'Parity',
};

function dimensionToPillarKey(d: CanonicalDimensionKey): PillarKey {
  if (d === 'index_integrity' || d === 'extraction_readiness') return 'foundation';
  if (d === 'authority_inflow' || d === 'entity_graph_strength') return 'authority';
  if (d === 'topical_authority' || d === 'ai_surface_presence') return 'discoverability';
  if (d === 'trust_coherence') return 'trust';
  return 'momentum';
}

export function buildCompetitorPressure(report: CanonicalReport): CompetitorPressure {
  const competitive = report.competitive_surface_share;
  const competitors = competitive?.competitors ?? [];
  const userValues = competitive?.user ?? {};
  if (competitors.length === 0) {
    return { state: 'unavailable', cards: [] };
  }
  const cards: CompetitorPressureCard[] = competitors.map((comp) => {
    // Find the dimension where this competitor most outscores the brand.
    const gaps: Array<{ key: CanonicalDimensionKey; label: string; gap: number }> = [];
    for (const col of COMPETITOR_MATRIX_DIMENSIONS) {
      const u = userValues[col.key];
      const c = comp.values[col.key];
      if (typeof u === 'number' && typeof c === 'number') {
        gaps.push({ key: col.key, label: col.label, gap: c - u });
      }
    }
    const sorted = [...gaps].sort((a, b) => b.gap - a.gap);
    const top = sorted[0];
    const pressureKind: CompetitorPressureKind = top
      ? top.gap >= 5
        ? dimensionToPillarKey(top.key)
        : 'parity'
      : 'parity';

    // Influence mix — high/moderate/low for each pillar based on competitor's
    // average score within that pillar's dimensions.
    const pillarBuckets = new Map<PillarKey, number[]>();
    for (const [k, v] of Object.entries(comp.values) as Array<[CanonicalDimensionKey, number]>) {
      const pk = dimensionToPillarKey(k);
      const arr = pillarBuckets.get(pk) ?? [];
      if (typeof v === 'number') arr.push(v);
      pillarBuckets.set(pk, arr);
    }
    const influenceMix: Array<{ pillar: PillarKey; level: 'high' | 'moderate' | 'low' }> = [];
    for (const pillar of ['foundation', 'authority', 'discoverability', 'trust', 'momentum'] as PillarKey[]) {
      const vals = pillarBuckets.get(pillar);
      if (!vals || vals.length === 0) continue;
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      const level: 'high' | 'moderate' | 'low' = avg >= 70 ? 'high' : avg >= 40 ? 'moderate' : 'low';
      influenceMix.push({ pillar, level });
    }

    const reading = pressureKind === 'parity'
      ? `${comp.name} reads at parity with the brand on the measurable dimensions. Pressure here is shape-based rather than score-based — the question is which posture evaluators prefer.`
      : `${comp.name} creates its strongest pressure on ${top.label} (${comp.values[top.key]}/100 vs brand ${userValues[top.key]}/100, a ${top.gap}-point gap). Buyers comparing the brand here encounter ${comp.name} ahead by a clear margin.`;

    return {
      name: comp.name,
      pressure_kind: pressureKind,
      pressure_label: PRESSURE_LABEL[pressureKind],
      dominant_dimension: top?.label ?? null,
      dominant_gap: top?.gap ?? null,
      influence_mix: influenceMix,
      reading,
    };
  });
  return { state: 'measured', cards };
}

// ── 7. Execution Window ───────────────────────────────────────────────────

export type ExecutionHorizon = 'immediate' | 'medium' | 'long';

export type ExecutionWindowEntry = {
  horizon: ExecutionHorizon;
  horizon_label: string;
  action_id: string;
  title: string;
  pillar: PillarKey;
  outcome: string;
  is_critical_path: boolean;
};

export type ExecutionWindow = {
  state: 'measured' | 'insufficient_signal';
  entries: ExecutionWindowEntry[];
  critical_path_count: number;
  read: string;
};

export function buildExecutionWindow(report: CanonicalReport): ExecutionWindow {
  const playbook = report.strategic_playbook;
  if (!playbook || playbook.actions.length === 0) {
    return {
      state: 'insufficient_signal',
      entries: [],
      critical_path_count: 0,
      read: 'Execution sequence is not yet resolved. The action playbook will sharpen as evidence accumulates.',
    };
  }
  const criticalPathSet = new Set(playbook.critical_path_ids ?? []);
  const horizonOf = (action: typeof playbook.actions[number]): ExecutionHorizon => {
    // Map: foundational blockers + critical severity → immediate
    //      tier-shifting / authority-extension moves → medium
    //      compounding / momentum → long
    if (action.severity === 'critical' || action.classification === 'foundational_blocker') return 'immediate';
    if (action.expected_maturity_shift === 'yes' || action.classification === 'strategic_unlock') return 'medium';
    return 'long';
  };
  const horizonLabel: Record<ExecutionHorizon, string> = {
    immediate: 'Within 90 days',
    medium: 'Within 6 months',
    long: '12+ months',
  };
  const entries: ExecutionWindowEntry[] = playbook.actions.slice(0, 9).map((a) => ({
    horizon: horizonOf(a),
    horizon_label: horizonLabel[horizonOf(a)],
    action_id: a.id,
    title: a.title,
    pillar: a.pillar,
    outcome: a.expected_outcome || a.reasoning,
    is_critical_path: criticalPathSet.has(a.id),
  }));
  const critical_path_count = entries.filter((e) => e.is_critical_path).length;
  const read =
    critical_path_count > 0
      ? `${critical_path_count} action${critical_path_count === 1 ? '' : 's'} sit on the critical path — sequence-aware. The dossier surfaces the leading move per horizon; downstream actions assume the predecessor lands.`
      : 'Execution is paced across horizons. Each horizon assumes the previous horizon\'s leading move has cleared.';
  return { state: 'measured', entries, critical_path_count, read };
}
