/**
 * Predictive operational intelligence — DETERMINISTIC heuristics (NOT ML).
 *
 * Projects near-term operational signals from real historical telemetry using
 * transparent maths only: simple linear regression slope + EWMA over the
 * maturity-snapshot timeline and append-only escalation/replay counts.
 * Confidence is purely sample-size driven (more history ⇒ higher confidence).
 * No learned model, no training, no autonomous claims. Read-only.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { getMaturityHistory } from './maturitySnapshotService';

export interface Forecast {
  metric: string;
  current: number;
  projected: number;
  direction: 'up' | 'down' | 'flat';
  confidence: number; // 0..100 (sample-size based)
  basis: string;
}

export interface PredictiveReport {
  companyId: string;
  generatedAt: string;
  forecasts: Forecast[];
  capabilityNote: string;
}

function linearSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xs = ys.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function ewma(ys: number[], alpha = 0.4): number {
  if (ys.length === 0) return 0;
  return ys.reduce((acc, y, i) => (i === 0 ? y : alpha * y + (1 - alpha) * acc), ys[0]);
}

function confidenceFromN(n: number): number {
  // 0 samples → 0; saturates ~ 24 samples.
  return Math.max(0, Math.min(100, Math.round((1 - Math.exp(-n / 8)) * 100)));
}

async function countAudit(companyId: string, resourceType: string, sinceIso: string): Promise<number> {
  try {
    const { count } = await ownedDbTable('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('resource_type', resourceType)
      .gte('created_at', sinceIso);
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

export async function buildPredictiveReport(companyId: string): Promise<PredictiveReport> {
  const forecasts: Forecast[] = [];

  // 1. Maturity / readiness-drift projection from the snapshot timeline.
  const history = await getMaturityHistory(companyId).catch(() => null);
  const scores = (history?.snapshots ?? []).map((s) => s.maturityScore);
  if (scores.length >= 2) {
    const slope = linearSlope(scores);
    const current = scores[scores.length - 1];
    const projected = Math.max(0, Math.min(100, Math.round(current + slope * 3))); // ~3 intervals ahead
    forecasts.push({
      metric: 'operational_maturity',
      current,
      projected,
      direction: slope > 0.5 ? 'up' : slope < -0.5 ? 'down' : 'flat',
      confidence: confidenceFromN(scores.length),
      basis: `linear slope ${slope.toFixed(2)} over ${scores.length} snapshots`,
    });
  } else {
    forecasts.push({
      metric: 'operational_maturity',
      current: scores[scores.length - 1] ?? 0,
      projected: scores[scores.length - 1] ?? 0,
      direction: 'flat',
      confidence: confidenceFromN(scores.length),
      basis: 'insufficient snapshot history',
    });
  }

  // 2. Escalation risk projection (EWMA of daily escalation volume, 7d).
  const now = Date.now();
  const daily: number[] = [];
  for (let d = 6; d >= 0; d -= 1) {
    const gte = new Date(now - (d + 1) * 86_400_000).toISOString();
    daily.push(await countAudit(companyId, 'worker_escalation', gte));
  }
  const escSmoothed = ewma(daily.map((v, i) => (i === 0 ? v : Math.max(0, v - daily[i - 1]))));
  const escCurrent = daily[daily.length - 1];
  forecasts.push({
    metric: 'escalation_risk',
    current: escCurrent,
    projected: Math.max(0, Math.round(escSmoothed)),
    direction: escSmoothed > 1 ? 'up' : escSmoothed < -1 ? 'down' : 'flat',
    confidence: confidenceFromN(7),
    basis: `EWMA of 7-day escalation deltas (${escSmoothed.toFixed(2)})`,
  });

  // 3. Replay-failure projection (24h dead_letter vs replay_executed ratio).
  const since24 = new Date(now - 86_400_000).toISOString();
  const deadLetters = await countAudit(companyId, 'dead_letter', since24);
  const executed = await countAudit(companyId, 'replay_executed', since24);
  const failRatio = deadLetters + executed > 0 ? deadLetters / (deadLetters + executed) : 0;
  forecasts.push({
    metric: 'replay_failure_risk',
    current: Number(failRatio.toFixed(3)),
    projected: Number(Math.min(1, failRatio * 1.1).toFixed(3)),
    direction: failRatio > 0.3 ? 'up' : 'flat',
    confidence: confidenceFromN(deadLetters + executed),
    basis: `dead_letter/(dead_letter+executed) over 24h`,
  });

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    forecasts,
    capabilityNote:
      'Deterministic linear/EWMA projections over real telemetry. Confidence is sample-size only. No ML, no learned model, no autonomous adaptation.',
  };
}
