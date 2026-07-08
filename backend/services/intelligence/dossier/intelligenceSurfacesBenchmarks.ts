/** Dossier surfaces — peer gaps, benchmarks, aggregation — split from intelligenceSurfacesRest.ts (barrel preserved; importers unchanged). */
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

import type {
  CanonicalDimension,
  CanonicalDimensionKey,
  CanonicalReport,
  ConfidenceBand,
  PillarKey,
  ScoreState,
} from '../../canonicalReport/canonicalReportTypes';

import { isMeasuredScore, buildScoreDrivers } from './intelligenceSurfacesFoundations';

import { trim, COMPETITOR_MATRIX_DIMENSIONS, avg, buildCompetitorMatrix } from './intelligenceSurfacesCompetitive';

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


