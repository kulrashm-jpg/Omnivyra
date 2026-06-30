/**
 * Platform trend engine (Phase 37). Pure deterministic statistics over a persisted numeric
 * series (oldest → newest). No AI, no Date.now. Returns Unknown (null) when there is
 * insufficient history. Every consumer (predictive, dashboards, future plugins) reuses this.
 */
export type Direction = 'up' | 'down' | 'flat' | 'unknown';

export interface TrendResult {
  points: number;
  first: number | null;
  last: number | null;
  delta: number | null;          // last - first
  movingDelta: number | null;    // last - previous
  direction: Direction;
  momentum: number | null;       // recent-half mean - earlier-half mean
  acceleration: number | null;   // change in consecutive deltas (recent vs earlier)
  volatility: number | null;     // population stddev
  stability: number | null;      // 100 - clamp(volatility), higher = steadier
  consistency: number | null;    // 100 - clamp(mean abs step)
  rollingAverage: number | null; // mean of last min(3,n)
  growthRate: number | null;     // % change first→last, when first>0
  declineRate: number | null;    // % drop, when last<first
  improvement: boolean;
  regression: boolean;           // last < first beyond a 5-pt threshold
  recovery: boolean;             // dipped below first mid-series then ended >= first
  plateau: boolean;              // last 3 within 2 pts of each other
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stddev = (xs: number[]) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const r1 = (n: number) => Math.round(n * 10) / 10;

export function computeTrend(series: number[]): TrendResult {
  const n = series.length;
  const base: TrendResult = {
    points: n, first: null, last: null, delta: null, movingDelta: null, direction: 'unknown', momentum: null,
    acceleration: null, volatility: null, stability: null, consistency: null, rollingAverage: null,
    growthRate: null, declineRate: null, improvement: false, regression: false, recovery: false, plateau: false,
  };
  if (n === 0) return base;
  const first = series[0]!; const last = series[n - 1]!;
  if (n === 1) return { ...base, first, last, rollingAverage: last };

  const delta = r1(last - first);
  const movingDelta = r1(last - series[n - 2]!);
  const direction: Direction = delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat';
  const half = Math.floor(n / 2);
  const earlier = series.slice(0, half); const recent = series.slice(n - half);
  const momentum = half >= 1 ? r1(mean(recent) - mean(earlier)) : null;
  const steps = series.slice(1).map((v, i) => v - series[i]!);
  const acceleration = steps.length >= 2 ? r1(mean(steps.slice(Math.floor(steps.length / 2))) - mean(steps.slice(0, Math.floor(steps.length / 2)))) : null;
  const volatility = r1(stddev(series));
  const stability = clamp(100 - volatility);
  const consistency = clamp(100 - mean(steps.map((s) => Math.abs(s))));
  const rollingAverage = r1(mean(series.slice(Math.max(0, n - 3))));
  const growthRate = first > 0 ? r1(((last - first) / first) * 100) : null;
  const declineRate = last < first && first > 0 ? r1(((first - last) / first) * 100) : null;
  const minMid = Math.min(...series.slice(0, n - 1));
  const recovery = minMid < first - 2 && last >= first;
  const last3 = series.slice(Math.max(0, n - 3));
  const plateau = last3.length >= 3 && Math.max(...last3) - Math.min(...last3) <= 2;

  return {
    points: n, first, last, delta, movingDelta, direction, momentum, acceleration, volatility, stability, consistency,
    rollingAverage, growthRate, declineRate, improvement: last > first + 2, regression: last < first - 5, recovery, plateau,
  };
}

/** Direction of the confidence/freshness series (reuses computeTrend). */
export const computeConfidenceTrend = (series: number[]): TrendResult => computeTrend(series);
