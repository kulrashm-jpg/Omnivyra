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

export async function loadNormalizedCompetitorSignals(companyId: string, lookbackDays = 90): Promise<NormalizedCompetitorSignal[]> {
  void companyId;
  void lookbackDays;
  return [];
}
