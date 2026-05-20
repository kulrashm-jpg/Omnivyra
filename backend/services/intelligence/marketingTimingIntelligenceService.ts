/**
 * Publish-time intelligence — DETERMINISTIC engagement-window analysis.
 *
 * Reads `tracking_events` and groups engagement by (UTC dow, hour). Recommends
 * publish windows where engagement events historically concentrate. No ML.
 */
import { ownedDbTable } from '../../db/writeOwner';

export interface TimingBucket {
  dayOfWeek: number; // 0..6 (UTC)
  hour: number;      // 0..23 (UTC)
  events: number;
  share: number;     // 0..1 of total
}

export interface TimingIntelligenceReport {
  companyId: string;
  generatedAt: string;
  buckets: TimingBucket[];
  topWindows: TimingBucket[];
  recommendation: string;
  confidence: number;
  capabilityNote: string;
}

export async function buildTimingIntelligence(companyId: string): Promise<TimingIntelligenceReport> {
  const sinceIso = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const counts = new Map<string, number>();
  let total = 0;
  try {
    const { data } = await ownedDbTable('tracking_events')
      .select('occurred_at, event_category')
      .eq('company_id', companyId)
      .gte('occurred_at', sinceIso)
      .limit(20000);
    for (const r of ((data ?? []) as any[])) {
      if (r.event_category === 'system') continue;
      const t = Date.parse(String(r.occurred_at ?? ''));
      if (Number.isNaN(t)) continue;
      const d = new Date(t);
      const k = `${d.getUTCDay()}:${d.getUTCHours()}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      total += 1;
    }
  } catch { /* absent */ }

  const buckets: TimingBucket[] = Array.from(counts.entries())
    .map(([k, events]) => {
      const [dow, hour] = k.split(':').map(Number);
      return { dayOfWeek: dow, hour, events, share: total > 0 ? Number((events / total).toFixed(3)) : 0 };
    });
  buckets.sort((a, b) => b.events - a.events);
  const topWindows = buckets.slice(0, 5);

  const recommendation = topWindows.length === 0
    ? 'Not enough engagement data yet to recommend a publish window.'
    : `Top engagement window (UTC): day ${topWindows[0].dayOfWeek} hour ${topWindows[0].hour} (${(topWindows[0].share * 100).toFixed(1)}% of traffic).`;

  return {
    companyId, generatedAt: new Date().toISOString(),
    buckets: buckets.slice(0, 50),
    topWindows,
    recommendation,
    confidence: Math.round((1 - Math.exp(-total / 200)) * 100),
    capabilityNote: 'Deterministic (UTC day, hour) histogram over 30d non-system tracking_events. No ML.',
  };
}
