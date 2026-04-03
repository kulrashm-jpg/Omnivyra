
/**
 * GET /api/admin/intelligence/execution-insights?days=7&company_id=optional
 *
 * Returns aggregated execution metrics from intelligence_execution_log:
 * - Summary counts (total / success / failed / skipped) + avg duration
 * - Skip reason breakdown (disabled / budget_exceeded / deferred / other)
 * - Per-day breakdown (last N days)
 * - Per-job-type breakdown with avg duration
 * - Slowest 10 individual runs
 *
 * Auth: super_admin_session cookie
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';

function isSuperAdmin(req: NextApiRequest): boolean {
  return req.cookies?.super_admin_session === '1';
}

interface LogRow {
  job_type:    string;
  company_id:  string | null;
  status:      string;
  reason:      string | null;
  duration_ms: number | null;
  started_at:  string;
  triggered_by: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const days      = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : null;

  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    let q = supabase
      .from('intelligence_execution_log')
      .select('job_type, company_id, status, reason, duration_ms, started_at, triggered_by')
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(5000);

    if (companyId) q = q.eq('company_id', companyId);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as LogRow[];

    // ── Summary ───────────────────────────────────────────────────────────────
    const completed = rows.filter(r => r.status === 'completed');
    const failed    = rows.filter(r => r.status === 'failed');
    const skipped   = rows.filter(r => r.status === 'skipped');

    const durations = completed.map(r => r.duration_ms).filter((d): d is number => d != null);
    const avgDurationMs = durations.length
      ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
      : null;

    // ── Skip reason breakdown ─────────────────────────────────────────────────
    const skipReasons: Record<string, number> = {};
    for (const r of skipped) {
      const key = r.reason ?? 'unknown';
      skipReasons[key] = (skipReasons[key] ?? 0) + 1;
    }

    // ── Per-day breakdown ─────────────────────────────────────────────────────
    const dayMap = new Map<string, { completed: number; failed: number; skipped: number; runs: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      dayMap.set(d, { completed: 0, failed: 0, skipped: 0, runs: 0 });
    }
    for (const r of rows) {
      const day = r.started_at.slice(0, 10);
      if (!dayMap.has(day)) continue;
      const entry = dayMap.get(day)!;
      entry.runs++;
      if (r.status === 'completed') entry.completed++;
      else if (r.status === 'failed') entry.failed++;
      else if (r.status === 'skipped') entry.skipped++;
    }
    const byDay = Array.from(dayMap.entries())
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Per-job-type breakdown ─────────────────────────────────────────────────
    const jtMap = new Map<string, { completed: number; failed: number; skipped: number; durations: number[] }>();
    for (const r of rows) {
      if (!jtMap.has(r.job_type)) {
        jtMap.set(r.job_type, { completed: 0, failed: 0, skipped: 0, durations: [] });
      }
      const entry = jtMap.get(r.job_type)!;
      if (r.status === 'completed') { entry.completed++; if (r.duration_ms != null) entry.durations.push(r.duration_ms); }
      else if (r.status === 'failed') entry.failed++;
      else if (r.status === 'skipped') entry.skipped++;
    }
    const byJobType = Array.from(jtMap.entries()).map(([job_type, v]) => ({
      job_type,
      completed:      v.completed,
      failed:         v.failed,
      skipped:        v.skipped,
      total:          v.completed + v.failed + v.skipped,
      avg_duration_ms: v.durations.length
        ? Math.round(v.durations.reduce((s, d) => s + d, 0) / v.durations.length)
        : null,
    })).sort((a, b) => b.total - a.total);

    // ── Slowest individual runs ───────────────────────────────────────────────
    const slowestRuns = completed
      .filter(r => r.duration_ms != null)
      .sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0))
      .slice(0, 10)
      .map(r => ({
        job_type:    r.job_type,
        company_id:  r.company_id,
        duration_ms: r.duration_ms,
        started_at:  r.started_at,
      }));

    return res.status(200).json({
      period_days: days,
      company_id:  companyId,
      summary: {
        total:          rows.length,
        success:        completed.length,
        failed:         failed.length,
        skipped:        skipped.length,
        avg_duration_ms: avgDurationMs,
      },
      skip_reasons: skipReasons,
      by_day:       byDay,
      by_job_type:  byJobType,
      slowest_runs: slowestRuns,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load insights' });
  }
}
