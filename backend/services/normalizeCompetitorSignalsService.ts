import { supabase } from '../db/supabaseClient';

export type NormalizedCompetitorSignal = {
  competitor_name: string;
  signal_type: 'mention' | 'benchmark' | 'format' | 'frequency';
  platform: string | null;
  confidence: number;
  mention_count: number;
  benchmark_gap: number;
  benchmark_label: string;
  detected_at: string;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadNormalizedCompetitorSignals(companyId: string, lookbackDays = 90): Promise<NormalizedCompetitorSignal[]> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('competitor_signals')
    .select('competitor_name, signal_type, platform, value, confidence, detected_at')
    .eq('company_id', companyId)
    .gte('detected_at', since)
    .order('detected_at', { ascending: false })
    .limit(600);

  if (error) {
    throw new Error(`Failed to load competitor signals: ${error.message}`);
  }

  return ((data ?? []) as Array<{
    competitor_name: string;
    signal_type: string;
    platform: string | null;
    value: Record<string, unknown>;
    confidence: number;
    detected_at: string;
  }>).map((row) => ({
    competitor_name: String(row.competitor_name || 'unknown').trim().toLowerCase(),
    signal_type: (['mention', 'benchmark', 'format', 'frequency'].includes(String(row.signal_type))
      ? row.signal_type
      : 'mention') as NormalizedCompetitorSignal['signal_type'],
    platform: row.platform ? String(row.platform).trim().toLowerCase() : null,
    confidence: Math.max(0, Math.min(1, Number(row.confidence ?? 0))),
    mention_count: toNumber(row.value?.mention_count),
    benchmark_gap: toNumber(row.value?.gap),
    benchmark_label: String(row.value?.gap_label ?? '').trim().toLowerCase(),
    detected_at: row.detected_at,
  }));
}
