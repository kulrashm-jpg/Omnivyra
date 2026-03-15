/**
 * System Health Metrics Service
 * Records operational health metrics for the engagement system.
 */

import { supabase } from '../db/supabaseClient';

export async function recordMetric(
  component: string,
  metric_name: string,
  metric_value: number,
  metric_unit?: string | null,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  try {
    await supabase.from('system_health_metrics').insert({
      component,
      metric_name,
      metric_value,
      metric_unit: metric_unit ?? null,
      observed_at: new Date().toISOString(),
      metadata: metadata ?? null,
    });
  } catch (err) {
    console.warn('[systemHealthMetrics] recordMetric error', (err as Error)?.message);
  }
}

export type HealthMetricRow = {
  id: string;
  component: string;
  metric_name: string;
  metric_value: number;
  metric_unit: string | null;
  observed_at: string;
  metadata: Record<string, unknown> | null;
};

export async function getMetrics(options: {
  component?: string | null;
  metric_name?: string | null;
  time_window_hours?: number | null;
  limit?: number;
}): Promise<HealthMetricRow[]> {
  const { component, metric_name, time_window_hours, limit = 500 } = options;
  let query = supabase
    .from('system_health_metrics')
    .select('id, component, metric_name, metric_value, metric_unit, observed_at, metadata')
    .order('observed_at', { ascending: false })
    .limit(limit);

  if (component) {
    query = query.eq('component', component);
  }
  if (metric_name) {
    query = query.eq('metric_name', metric_name);
  }
  if (time_window_hours && time_window_hours > 0) {
    const since = new Date(Date.now() - time_window_hours * 60 * 60 * 1000).toISOString();
    query = query.gte('observed_at', since);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[systemHealthMetrics] getMetrics error', error.message);
    return [];
  }
  return (data ?? []) as HealthMetricRow[];
}
