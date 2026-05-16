export type AnalyticsFreshnessClassification =
  | 'live'
  | 'fresh'
  | 'aging'
  | 'stale'
  | 'failed'
  | 'unavailable';

export type AnalyticsTrustLevel = 'high' | 'medium' | 'low' | 'none';

export type AnalyticsFreshnessSnapshot = {
  source: 'ga' | 'gsc';
  classification: AnalyticsFreshnessClassification;
  trust_level: AnalyticsTrustLevel;
  freshness_score: number;
  last_successful_sync_at: string | null;
  age_hours: number | null;
  reason: string;
};

function ageHours(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Number(((Date.now() - parsed) / 36e5).toFixed(2)));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function classifyAnalyticsFreshness(params: {
  source: 'ga' | 'gsc';
  lastSuccessfulSyncAt: string | null | undefined;
  status?: string | null;
  errorMessage?: string | null;
  rowsOrEvents?: number | null;
}): AnalyticsFreshnessSnapshot {
  const status = String(params.status ?? '').toLowerCase();
  const rowsOrEvents = Number(params.rowsOrEvents ?? 0);
  const hours = ageHours(params.lastSuccessfulSyncAt ?? null);

  if (status === 'failed' || params.errorMessage) {
    return {
      source: params.source,
      classification: 'failed',
      trust_level: rowsOrEvents > 0 ? 'low' : 'none',
      freshness_score: rowsOrEvents > 0 ? 20 : 0,
      last_successful_sync_at: params.lastSuccessfulSyncAt ?? null,
      age_hours: hours,
      reason: params.errorMessage || 'Latest analytics sync failed.',
    };
  }

  if (!params.lastSuccessfulSyncAt || hours == null || rowsOrEvents <= 0) {
    return {
      source: params.source,
      classification: 'unavailable',
      trust_level: 'none',
      freshness_score: 0,
      last_successful_sync_at: params.lastSuccessfulSyncAt ?? null,
      age_hours: hours,
      reason: 'No trusted analytics sync with usable rows is available.',
    };
  }

  if (hours <= 6) {
    return {
      source: params.source,
      classification: 'live',
      trust_level: 'high',
      freshness_score: 100,
      last_successful_sync_at: params.lastSuccessfulSyncAt,
      age_hours: hours,
      reason: 'Analytics sync is current.',
    };
  }

  if (hours <= 24) {
    return {
      source: params.source,
      classification: 'fresh',
      trust_level: 'high',
      freshness_score: clampScore(95 - hours),
      last_successful_sync_at: params.lastSuccessfulSyncAt,
      age_hours: hours,
      reason: 'Analytics sync is fresh enough for reporting.',
    };
  }

  if (hours <= 72) {
    return {
      source: params.source,
      classification: 'aging',
      trust_level: 'medium',
      freshness_score: clampScore(80 - (hours - 24) * 0.8),
      last_successful_sync_at: params.lastSuccessfulSyncAt,
      age_hours: hours,
      reason: 'Analytics sync is aging; insights remain usable but should be treated with moderate confidence.',
    };
  }

  return {
    source: params.source,
    classification: 'stale',
    trust_level: 'low',
    freshness_score: clampScore(45 - (hours - 72) * 0.25),
    last_successful_sync_at: params.lastSuccessfulSyncAt,
    age_hours: hours,
    reason: 'Analytics sync is stale; insights should be treated as directional.',
  };
}
