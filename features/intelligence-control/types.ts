// Shared types for the intelligence-control module.
// Co-located here so extracted components can import without depending
// on the hook (which would be a reverse import).

export type Tab = 'global' | 'overrides' | 'boost' | 'insights';

export type Msg = { type: 'ok' | 'err'; text: string } | null;

export interface GlobalConfigRow {
  job_type:          string;
  label:             string;
  description:       string | null;
  priority:          number;
  frequency_minutes: number;
  enabled:           boolean;
  max_concurrent:    number;
  timeout_seconds:   number;
  retry_count:       number;
  model:             string | null;
  updated_at:        string;
  updated_by:        string;
  last_run:          { started_at: string; status: string; duration_ms: number | null } | null;
}

export interface ResolvedJob {
  job_type:          string;
  label:             string;
  priority:          number;
  frequency_minutes: number;
  enabled:           boolean;
  max_concurrent:    number;
  timeout_seconds:   number;
  retry_count:       number;
  model:             string | null;
  is_boosted:        boolean;
  boost_expires_at:  string | null;
  source:            'global' | 'override' | 'boosted';
  override: {
    id:                      string;
    priority:                number | null;
    frequency_minutes:       number | null;
    enabled:                 boolean | null;
    max_concurrent:          number | null;
    timeout_seconds:         number | null;
    retry_count:             number | null;
    model:                   string | null;
    boost_until:             string | null;
    boost_priority:          number | null;
    boost_frequency_minutes: number | null;
    reason:                  string | null;
    updated_at:              string;
    updated_by:              string;
  } | null;
  global: GlobalConfigRow;
}

export interface InsightsSummary {
  total:           number;
  success:         number;
  failed:          number;
  skipped:         number;
  avg_duration_ms: number | null;
}
export interface DayBucket   { date: string; completed: number; failed: number; skipped: number; runs: number }
export interface JobTypeStat { job_type: string; completed: number; failed: number; skipped: number; total: number; avg_duration_ms: number | null }
export interface SlowestRun  { job_type: string; company_id: string | null; duration_ms: number | null; started_at: string }
export interface InsightsData {
  period_days:  number;
  summary:      InsightsSummary;
  skip_reasons: Record<string, number>;
  by_day:       DayBucket[];
  by_job_type:  JobTypeStat[];
  slowest_runs: SlowestRun[];
}

export interface CompanyEntry {
  company_id: string;
  name:       string;
}
