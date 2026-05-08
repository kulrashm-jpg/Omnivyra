// Executive visualization primitives.
//
// A small set of restrained, print-safe HTML helpers that reintroduce
// strategic visual storytelling without regressing into dashboard UX.
// Each primitive is:
//
//   - calm           (soft palette, no SaaS gradients, no chart noise)
//   - print-safe     (HTML/CSS only, no canvas, no client-side JS)
//   - interpretive   (the visual carries a strategic read, not a metric dump)
//   - composable     (each helper returns an HTML string that drops into
//                     the canonical exportRenderer)
//
// The primitives:
//
//   AuthorityBar           — a single horizontal bar with track + fill
//                            + value, used for any 0–100 score.
//   PillarBalanceStrip     — five mini-bars in a row showing relative
//                            pillar balance and weakest-link pressure.
//   MaturityContinuum      — six-stage horizontal track with a marker
//                            at the current stage.
//   AISurfaceSpectrum      — three-zone spectrum (Absent / Retrievable
//                            / Cited) with a marker at the AI surface
//                            presence value.
//   BottleneckBar          — emphasis-styled bar that names the
//                            dominant strategic constraint.
//
// All visuals stay in the same restrained ink palette established by
// the structural-invisibility CSS — slate / sky / amber / emerald used
// only where they communicate a state the typography cannot.

import type {
  CanonicalPillarScore,
  PillarKey,
} from '../../canonicalReport/canonicalReportTypes';

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

const PILLAR_ACCENT: Record<PillarKey, string> = {
  foundation: '#0369a1',
  authority: '#4f46e5',
  discoverability: '#047857',
  trust: '#b45309',
  momentum: '#be123c',
};

const MATURITY_STAGES: Array<{ key: string; label: string }> = [
  { key: 'foundational', label: 'Foundational' },
  { key: 'emerging', label: 'Emerging' },
  { key: 'developing', label: 'Developing' },
  { key: 'operational', label: 'Operational' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'leading', label: 'Leading' },
];

function escape(text: string | null | undefined): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampPercent(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

// ── Authority bar ──────────────────────────────────────────────────────────

export type AuthorityBarOptions = {
  value: number | null;
  /** 'measured' | 'inferred' | 'insufficient_signal' | 'unavailable' */
  state?: string;
  /** Optional label that appears beneath the bar (e.g., "Authority Index"). */
  label?: string;
  /** Override the fill color. Defaults to the canonical ink (#0f4c6b). */
  accent?: string;
  /** Visual variant — 'standard' (default) or 'emphasis' (heavier). */
  variant?: 'standard' | 'emphasis';
};

export function renderAuthorityBar(opts: AuthorityBarOptions): string {
  const measured = typeof opts.value === 'number' && opts.state !== 'insufficient_signal' && opts.state !== 'unavailable';
  const pct = measured ? clampPercent(opts.value) : 0;
  const accent = opts.accent ?? '#0f4c6b';
  const variant = opts.variant ?? 'standard';
  const valueText = measured ? String(opts.value) : '—';
  return `
    <div class="ds-vbar ds-vbar-${escape(variant)}">
      <div class="ds-vbar-track">
        <div class="ds-vbar-fill" style="width: ${pct}%; background: ${escape(accent)};"></div>
      </div>
      <div class="ds-vbar-value">${escape(valueText)}<span class="ds-vbar-of">/100</span></div>
      ${opts.label ? `<p class="ds-vbar-label">${escape(opts.label)}</p>` : ''}
    </div>
  `;
}

// ── Pillar balance strip ───────────────────────────────────────────────────

export function renderPillarBalanceStrip(pillars: CanonicalPillarScore[]): string {
  return `
    <div class="ds-vstrip">
      ${pillars
        .map((p) => {
          const measured =
            typeof p.score.value === 'number' &&
            p.score.state !== 'insufficient_signal' &&
            p.score.state !== 'unavailable';
          const pct = measured ? clampPercent(p.score.value) : 0;
          const accent = PILLAR_ACCENT[p.pillar];
          const valueText = measured ? String(p.score.value) : '—';
          return `
            <div class="ds-vstrip-row">
              <div class="ds-vstrip-label" style="color: ${escape(accent)};">${escape(PILLAR_LABEL[p.pillar])}</div>
              <div class="ds-vstrip-track">
                <div class="ds-vstrip-fill" style="width: ${pct}%; background: ${escape(accent)};"></div>
              </div>
              <div class="ds-vstrip-value">${escape(valueText)}</div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

// ── Maturity continuum ────────────────────────────────────────────────────

export function renderMaturityContinuum(currentStage: string | null): string {
  const idx = MATURITY_STAGES.findIndex((s) => s.key === currentStage);
  const isMeasured = idx >= 0;
  // Position the marker on the centre of the current stage chip.
  const pct = isMeasured
    ? Math.round(((idx + 0.5) / MATURITY_STAGES.length) * 100)
    : 0;
  const fillPct = isMeasured ? Math.round(((idx + 0.5) / MATURITY_STAGES.length) * 100) : 0;
  return `
    <div class="ds-vcontinuum">
      <div class="ds-vcontinuum-track">
        <div class="ds-vcontinuum-progress" style="width: ${fillPct}%;"></div>
        ${
          isMeasured
            ? `<div class="ds-vcontinuum-marker" style="left: ${pct}%;"></div>`
            : ''
        }
      </div>
      <div class="ds-vcontinuum-stages">
        ${MATURITY_STAGES.map((stage, i) => {
          const cls =
            i === idx
              ? 'ds-vcontinuum-stage is-current'
              : i < idx
                ? 'ds-vcontinuum-stage is-passed'
                : 'ds-vcontinuum-stage';
          return `<span class="${cls}">${escape(stage.label)}</span>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ── AI surface spectrum ───────────────────────────────────────────────────
//
// A three-zone spectrum: Absent (0–29) / Retrievable (30–59) / Cited (60+).
// Boundaries align with the existing canonical band thresholds the dossier
// uses to interpret AI surface presence narratively. The marker is the
// strategic anchor — it tells the reader where the brand sits on the
// "absent → cited" continuum at a glance.

export function renderAISurfaceSpectrum(value: number | null, state?: string): string {
  const measured =
    typeof value === 'number' && state !== 'insufficient_signal' && state !== 'unavailable';
  const pct = measured ? clampPercent(value) : 0;
  const valueText = measured ? String(value) : '—';
  return `
    <div class="ds-vspectrum">
      <div class="ds-vspectrum-track">
        <div class="ds-vspectrum-zone is-absent">Absent</div>
        <div class="ds-vspectrum-zone is-retrievable">Retrievable</div>
        <div class="ds-vspectrum-zone is-cited">Cited</div>
        ${measured ? `<div class="ds-vspectrum-marker" style="left: ${pct}%;"></div>` : ''}
      </div>
      <div class="ds-vspectrum-meta">
        <span>${escape(valueText)}<span class="ds-vspectrum-of">/100</span></span>
        <span>AI Surface Presence</span>
      </div>
    </div>
  `;
}

// ── Bottleneck bar ────────────────────────────────────────────────────────
//
// Visualises the dominant strategic constraint. The bar uses an amber
// accent (state-meaningful, not decorative) to signal "this is the
// rate-limiter on the rest of the system". Used in the Strategic
// Constraints section above the constraint narrative.

export function renderBottleneckBar(pillars: CanonicalPillarScore[]): string {
  const measured = pillars.filter(
    (p) =>
      typeof p.score.value === 'number' &&
      p.score.state !== 'insufficient_signal' &&
      p.score.state !== 'unavailable',
  );
  if (measured.length === 0) {
    return '';
  }
  const weakest = [...measured].sort(
    (a, b) => (a.score.value as number) - (b.score.value as number),
  )[0];
  const value = weakest.score.value as number;
  const pct = clampPercent(value);
  return `
    <div class="ds-vbottleneck">
      <div class="ds-vbottleneck-row">
        <div class="ds-vbottleneck-label">
          <span class="ds-vbottleneck-eyebrow">Dominant Constraint</span>
          <span class="ds-vbottleneck-pillar">${escape(PILLAR_LABEL[weakest.pillar])}</span>
        </div>
        <div class="ds-vbottleneck-track">
          <div class="ds-vbottleneck-fill" style="width: ${pct}%;"></div>
        </div>
        <div class="ds-vbottleneck-value">${value}<span class="ds-vbottleneck-of">/100</span></div>
      </div>
      <p class="ds-vbottleneck-note">The pillar carrying the most maturity transition friction. Movement here lifts every other pillar's contribution.</p>
    </div>
  `;
}

// ── Insufficient-signal hint ──────────────────────────────────────────────
//
// Optional helper used when a visual primitive cannot resolve to a
// confident state. The dossier renders this in place of a blank bar so
// the page does not feel structurally incomplete.

export function renderInsufficientHint(message: string): string {
  return `<p class="ds-vinsufficient">${escape(message)}</p>`;
}

// ── Positioning band (peer comparison) ───────────────────────────────────
//
// Shows where the brand sits relative to a peer set on a 0–100 band.
// The peer median is rendered as a soft tick; the brand position is
// rendered as a small filled marker. NOT a competitor matrix, NOT a
// chart — a single horizontal band with two anchored points.

export function renderPositioningBand(opts: {
  brandValue: number | null;
  peerMedian: number | null;
  topQuartile?: number | null;
  vertical?: string | null;
  percentile?: number | null;
  peerCount?: number | null;
}): string {
  const brand = clampPercent(opts.brandValue);
  const median = clampPercent(opts.peerMedian);
  const topQ = opts.topQuartile != null ? clampPercent(opts.topQuartile) : null;
  const measured = opts.brandValue != null && opts.peerMedian != null;
  if (!measured) {
    return `<p class="ds-vinsufficient">Comparative positioning is held open until peer measurement accumulates.</p>`;
  }
  const ahead = brand >= median;
  return `
    <div class="ds-vposition">
      <div class="ds-vposition-track">
        <div class="ds-vposition-tick is-median" style="left: ${median}%;" title="Peer median ${median}"></div>
        ${topQ != null ? `<div class="ds-vposition-tick is-top" style="left: ${topQ}%;" title="Top quartile ${topQ}"></div>` : ''}
        <div class="ds-vposition-marker" style="left: ${brand}%;"></div>
      </div>
      <div class="ds-vposition-meta">
        <span class="ds-vposition-meta-label">Brand</span>
        <span class="ds-vposition-meta-value">${brand}</span>
        <span class="ds-vposition-meta-divider">·</span>
        <span class="ds-vposition-meta-label">Peer Median</span>
        <span class="ds-vposition-meta-value">${median}</span>
        ${topQ != null ? `<span class="ds-vposition-meta-divider">·</span><span class="ds-vposition-meta-label">Top Quartile</span><span class="ds-vposition-meta-value">${topQ}</span>` : ''}
        ${
          opts.percentile != null
            ? `<span class="ds-vposition-meta-divider">·</span><span class="ds-vposition-meta-label">Percentile</span><span class="ds-vposition-meta-value">${opts.percentile}</span>`
            : ''
        }
      </div>
      <p class="ds-vposition-note">${
        ahead
          ? `The brand reads above the peer median${opts.peerCount ? ` of the measurable set (${opts.peerCount} peers)` : ''}. The relative position is the asset to defend.`
          : `The brand reads below the peer median${opts.peerCount ? ` of the measurable set (${opts.peerCount} peers)` : ''}. Closing this gap shifts the brand's read in evaluation more than absolute lift.`
      }</p>
    </div>
  `;
}

// ── Trajectory spark (historical authority movement) ─────────────────────
//
// Minimal sparkline-style band of past authority snapshots. Bars are
// fixed-width vertical strokes scaled to the 0–100 range; the most
// recent observation is highlighted. Renders only when ≥3 snapshots
// exist; otherwise an honest "first observation" hint is returned.

export function renderTrajectorySpark(opts: {
  snapshots: Array<{ observed_at: string; value: number | null }>;
}): string {
  const points = opts.snapshots
    .filter((s) => typeof s.value === 'number')
    .map((s) => ({ at: s.observed_at, value: s.value as number }));
  if (points.length < 3) {
    return `<p class="ds-vinsufficient">Trajectory is held open until at least three comparable snapshots accumulate.</p>`;
  }
  const max = 100;
  const bars = points.map((p, i) => {
    const h = Math.max(2, Math.round((p.value / max) * 100));
    const isLast = i === points.length - 1;
    return `<div class="ds-vspark-bar ${isLast ? 'is-current' : ''}" style="height: ${h}%;" title="${escape(p.at)}: ${p.value}"></div>`;
  }).join('');
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const delta = last - first;
  const direction =
    delta > 5 ? 'upward' : delta < -5 ? 'downward' : 'steady';
  const directionPhrase =
    direction === 'upward'
      ? `Authority is moving upward across the observed window (+${delta} points).`
      : direction === 'downward'
        ? `Authority has receded across the observed window (${delta} points).`
        : 'Authority has held position across the observed window.';
  return `
    <div class="ds-vspark">
      <div class="ds-vspark-track">${bars}</div>
      <p class="ds-vspark-note">${escape(directionPhrase)}</p>
    </div>
  `;
}

// ── Confidence matrix (4 cells) ───────────────────────────────────────────
//
// Compact summary of the evidence/coverage state across the canonical
// score states. Four cells: Measured / Inferred / Insufficient /
// Unavailable. Each cell is a single number + label — readers grasp
// the evidence shape in one glance.

export function renderConfidenceMatrix(counts: {
  measured: number;
  inferred: number;
  insufficient: number;
  unavailable: number;
  totalProviders?: number;
  healthyProviders?: number;
}): string {
  const cells: Array<{ key: string; label: string; count: number; tone: string }> = [
    { key: 'measured', label: 'Measured', count: counts.measured, tone: 'measured' },
    { key: 'inferred', label: 'Inferred', count: counts.inferred, tone: 'inferred' },
    { key: 'insufficient', label: 'Insufficient', count: counts.insufficient, tone: 'insufficient' },
    { key: 'unavailable', label: 'Unavailable', count: counts.unavailable, tone: 'unavailable' },
  ];
  const providerLine =
    counts.totalProviders && counts.totalProviders > 0
      ? `${counts.healthyProviders ?? 0} of ${counts.totalProviders} provider surfaces healthy`
      : null;
  return `
    <div class="ds-vconfidence">
      <div class="ds-vconfidence-grid">
        ${cells
          .map(
            (c) => `
              <div class="ds-vconfidence-cell ds-vconfidence-${escape(c.tone)}">
                <span class="ds-vconfidence-value">${c.count}</span>
                <span class="ds-vconfidence-label">${escape(c.label)}</span>
              </div>
            `,
          )
          .join('')}
      </div>
      ${providerLine ? `<p class="ds-vconfidence-note">${escape(providerLine)}.</p>` : ''}
    </div>
  `;
}

// ── Evidence Anchor Row (compact analytical strip) ───────────────────────
//
// Horizontal evidence-led strip used at the top of dense analytical
// sections so the reader registers analytical density within ~5 seconds
// of scanning. Editorial: small uppercase eyebrow labels + larger
// tabular-num values + optional accent. NOT a dashboard band — single
// row of typographic key/value pairs.

export type EvidenceAnchorItem = {
  label: string;
  value: string;
  /** Optional state hint for colour shift: 'positive' | 'warn' | 'neutral'. */
  tone?: 'positive' | 'warn' | 'neutral' | 'risk';
};

export function renderEvidenceAnchorRow(items: EvidenceAnchorItem[]): string {
  if (items.length === 0) return '';
  return `
    <div class="ds-vanchor">
      ${items
        .map(
          (item) => `
            <div class="ds-vanchor-cell ${item.tone ? `is-${escape(item.tone)}` : ''}">
              <span class="ds-vanchor-label">${escape(item.label)}</span>
              <span class="ds-vanchor-value">${escape(item.value)}</span>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

// ── Pillar deltas strip (movement indicators) ────────────────────────────
//
// Compact horizontal row showing pillar-level direction since the last
// snapshot. Each pillar gets a small ↑ ↓ → glyph and a delta value when
// measured. Renders only when at least one pillar carries a measured
// direction; otherwise emits nothing.

export type PillarDelta = {
  pillar: PillarKey;
  delta_value: number | null;
  direction: 'improved' | 'regressed' | 'stagnated' | 'first_observation';
  significant: boolean;
};

export function renderPillarDeltasStrip(deltas: PillarDelta[]): string {
  const measured = deltas.filter(
    (d) => d.direction !== 'first_observation' && typeof d.delta_value === 'number',
  );
  if (measured.length === 0) return '';
  const order: PillarKey[] = ['foundation', 'authority', 'discoverability', 'trust', 'momentum'];
  const ordered = order
    .map((p) => measured.find((d) => d.pillar === p))
    .filter((d): d is PillarDelta => d != null);
  return `
    <div class="ds-vdeltas">
      <p class="ds-vdeltas-eyebrow">Movement Since Last Snapshot</p>
      <div class="ds-vdeltas-row">
        ${ordered
          .map((d) => {
            const glyph = d.direction === 'improved' ? '↑' : d.direction === 'regressed' ? '↓' : '→';
            const delta = d.delta_value as number;
            const sign = delta > 0 ? '+' : '';
            const dirClass =
              d.direction === 'improved'
                ? 'is-up'
                : d.direction === 'regressed'
                  ? 'is-down'
                  : 'is-flat';
            return `
              <div class="ds-vdeltas-pillar ${dirClass}">
                <span class="ds-vdeltas-name" style="color: ${escape(PILLAR_ACCENT[d.pillar])};">${escape(PILLAR_LABEL[d.pillar])}</span>
                <span class="ds-vdeltas-arrow">${glyph}</span>
                <span class="ds-vdeltas-delta">${sign}${delta}</span>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

// ── Dimension row (compact dimension reading) ────────────────────────────
//
// One row per canonical dimension. Pillar tag + dimension label +
// hairline bar + score. Used to compose the Dimension Breakdown
// without becoming a metric grid.

export function renderDimensionRow(opts: {
  pillar: PillarKey;
  label: string;
  value: number | null;
  state?: string;
  rationale?: string | null;
}): string {
  const measured =
    typeof opts.value === 'number' && opts.state !== 'insufficient_signal' && opts.state !== 'unavailable';
  const pct = measured ? clampPercent(opts.value) : 0;
  const accent = PILLAR_ACCENT[opts.pillar];
  const valueText = measured ? String(opts.value) : '—';
  return `
    <div class="ds-vdim-row">
      <div class="ds-vdim-tag" style="color: ${escape(accent)};">${escape(PILLAR_LABEL[opts.pillar])}</div>
      <div class="ds-vdim-label">${escape(opts.label)}</div>
      <div class="ds-vdim-track">
        <div class="ds-vdim-fill" style="width: ${pct}%; background: ${escape(accent)};"></div>
      </div>
      <div class="ds-vdim-value">${escape(valueText)}</div>
    </div>
  `;
}
