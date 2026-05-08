'use client';

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { CanonicalScore, ConfidenceBand, ScoreState } from './CanonicalPrimitives';

function ConfidenceLegend({
  confidence,
  hasBenchmark,
  hasInferredAxis,
  hasInsufficientAxis,
}: {
  confidence: ConfidenceBand;
  hasBenchmark: boolean;
  hasInferredAxis: boolean;
  hasInsufficientAxis: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-1 w-6 rounded-full"
          style={{
            background: confidence === 'high' ? '#1d4ed8' : 'transparent',
            border: confidence === 'high' ? 'none' : '1.5px dashed #1d4ed8',
          }}
        />
        <span className="font-semibold uppercase tracking-wide">{confidence} confidence</span>
        <span>
          (
          {confidence === 'high' && 'solid stroke'}
          {confidence === 'medium' && 'dashed stroke = uncertainty'}
          {confidence === 'low' && 'dotted stroke = sparse evidence'}
          )
        </span>
      </span>
      {hasBenchmark ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1 w-6 rounded-full border border-dashed border-slate-500" />
          <span>benchmark overlay</span>
        </span>
      ) : null}
      {hasInferredAxis ? <span>°&nbsp;= inferred axis</span> : null}
      {hasInsufficientAxis ? <span>·&nbsp;= insufficient signal (gap)</span> : null}
    </div>
  );
}

const TIER_TICKS = [0, 25, 50, 75, 100];

type Axis = {
  key: string;
  label: string;
  pillar: 'foundation' | 'authority' | 'discoverability' | 'trust' | 'momentum';
  score: CanonicalScore;
  rationale: string;
};

type Props = {
  axes: Axis[];
  overallConfidence: ConfidenceBand;
  benchmarkLabel: string | null;
  competitorOverlay: Array<{
    label: string;
    values: Record<string, number | undefined>;
  }>;
};

function strokeDashFromConfidence(confidence: ConfidenceBand): string | undefined {
  if (confidence === 'high') return undefined;
  if (confidence === 'medium') return '6 4';
  return '2 4';
}

function fillOpacityFromConfidence(confidence: ConfidenceBand): number {
  if (confidence === 'high') return 0.32;
  if (confidence === 'medium') return 0.22;
  return 0.12;
}

function describeState(state: ScoreState): string {
  if (state === 'measured') return 'Measured';
  if (state === 'inferred') return 'Inferred';
  if (state === 'insufficient_signal') return 'Insufficient signal';
  return 'Unavailable';
}

/**
 * The single canonical radar for the entire Omnivyra report.
 *
 * Replaces SeoCapabilityRadar + AiAnswerPresenceRadar + CompetitorPositioningRadar.
 *
 * Visual integrity rules (carried over from CanonicalRadar):
 *  - Insufficient/unavailable axes render as gaps, never as zero.
 *  - Maturity tier ticks (0/25/50/75/100) on the radial axis.
 *  - Stroke style varies by confidence (solid / dashed / dotted).
 *  - Benchmark + competitor overlays are first-class.
 *  - Pillar accent shows on each axis label so the user reads which pillar each axis belongs to.
 */
export default function DiscoverabilityAuthorityRadar({
  axes,
  overallConfidence,
  benchmarkLabel,
  competitorOverlay,
}: Props) {
  const polygonRows = axes.map((axis) => {
    const isMissing =
      axis.score.state === 'insufficient_signal' || axis.score.state === 'unavailable';
    const labelMarker =
      axis.score.state === 'measured' ? '' : axis.score.state === 'inferred' ? ' °' : ' ·';
    return {
      key: axis.key,
      label: `${axis.label}${labelMarker}`,
      rawLabel: axis.label,
      pillar: axis.pillar,
      value: isMissing || axis.score.value == null ? null : Math.max(0, Math.min(100, axis.score.value)),
      benchmark: typeof axis.score.benchmark.value === 'number' ? axis.score.benchmark.value : null,
      state: axis.score.state,
      ...Object.fromEntries(
        competitorOverlay.map((overlay, idx) => [
          `overlay_${idx}`,
          typeof overlay.values[axis.key] === 'number' ? overlay.values[axis.key] : null,
        ]),
      ),
    };
  });

  const hasAnyMeasured = polygonRows.some((row) => row.value != null);
  const hasBenchmark = polygonRows.some((row) => row.benchmark != null);
  const hasCompetitorOverlay = competitorOverlay.length > 0 && polygonRows.some(
    (row) => competitorOverlay.some((_, idx) => row[`overlay_${idx}` as keyof typeof row] != null),
  );
  const dashArray = strokeDashFromConfidence(overallConfidence);
  const fillOpacity = fillOpacityFromConfidence(overallConfidence);

  if (!hasAnyMeasured) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center"
        style={{ minHeight: 380 }}
      >
        <p className="text-sm font-semibold text-slate-700">
          Insufficient signal to draw the Discoverability Authority Radar.
        </p>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          No axis has measured evidence yet. The radar is intentionally not drawn — it appears as
          soon as crawl, search, or competitor signal is observed.
        </p>
      </div>
    );
  }

  const competitorColors = ['#f59e0b', '#a855f7', '#10b981', '#6366f1'];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fafc_48%,#ecfeff_100%)] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          Discoverability Authority Radar
        </p>
        <h3 className="mt-1 text-xl font-bold text-slate-900">
          One radar across Foundation · Authority · Discoverability · Trust · Momentum
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Eight canonical axes, mapped one-to-one to the five pillars. Axes with insufficient
          evidence render as gaps; geometry tracks confidence.
        </p>
      </div>

      <div className="p-5">
        <div className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={polygonRows} outerRadius="80%">
              <PolarGrid gridType="polygon" stroke="#e2e8f0" />
              <PolarAngleAxis
                dataKey="label"
                tick={{ fill: '#334155', fontSize: 12, fontWeight: 600 }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                ticks={TIER_TICKS}
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                axisLine={false}
                stroke="#cbd5e1"
              />
              {hasBenchmark ? (
                <Radar
                  name={benchmarkLabel ?? 'Benchmark'}
                  dataKey="benchmark"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  fill="#64748b"
                  fillOpacity={0.06}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ) : null}
              {hasCompetitorOverlay
                ? competitorOverlay.map((overlay, idx) => (
                    <Radar
                      key={`overlay-${idx}`}
                      name={overlay.label}
                      dataKey={`overlay_${idx}`}
                      stroke={competitorColors[idx % competitorColors.length]}
                      strokeWidth={1.75}
                      strokeDasharray="5 4"
                      fill={competitorColors[idx % competitorColors.length]}
                      fillOpacity={0.08}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  ))
                : null}
              <Radar
                name="You"
                dataKey="value"
                stroke="#1d4ed8"
                strokeWidth={2.5}
                strokeDasharray={dashArray}
                fill="#60a5fa"
                fillOpacity={fillOpacity}
                connectNulls={false}
              />
              <Tooltip
                formatter={(value: number, name, payload) => {
                  const state = payload?.payload?.state as ScoreState | undefined;
                  if (typeof value !== 'number' || state === 'insufficient_signal' || state === 'unavailable') {
                    return [describeState(state ?? 'insufficient_signal'), payload?.payload?.rawLabel ?? name ?? 'Score'];
                  }
                  return [`${Math.round(value)}/100`, payload?.payload?.rawLabel ?? name ?? 'Score'];
                }}
                contentStyle={{
                  borderRadius: 12,
                  borderColor: '#cbd5e1',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
                  fontSize: 12,
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <ConfidenceLegend
          confidence={overallConfidence}
          hasBenchmark={hasBenchmark}
          hasInferredAxis={axes.some((a) => a.score.state === 'inferred')}
          hasInsufficientAxis={axes.some(
            (a) => a.score.state === 'insufficient_signal' || a.score.state === 'unavailable',
          )}
        />

        {hasCompetitorOverlay ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
            {competitorOverlay.map((overlay, idx) => (
              <span key={overlay.label} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-1 w-6 rounded-full"
                  style={{
                    background: competitorColors[idx % competitorColors.length],
                    opacity: 0.7,
                  }}
                />
                {overlay.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
