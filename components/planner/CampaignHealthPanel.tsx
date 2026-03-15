/**
 * Campaign Health Panel
 * Displays AI campaign evaluation with health_score, health_status, health_grade,
 * health_summary, suggestions, warnings, and score breakdown.
 * Fetches from /api/campaigns/health. Shares report via plannerSessionStore for PlanningCanvas.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, ChevronDown, ChevronUp, Clock, Layers, MessageSquare, Play, Target, Users } from 'lucide-react';
import { usePlannerSession } from './plannerSessionStore';

export interface CampaignHealthPanelProps {
  /** Campaign ID; panel only fetches when present (persisted reports only) */
  campaignId?: string | null;
  /** Company ID for auth */
  companyId?: string | null;
  /** When provided, fetches health on mount and when state changes */
  onError?: (msg: string) => void;
}

type HealthSuggestionSeverity = 'info' | 'warning' | 'critical';

interface HealthSuggestion {
  message: string;
  severity: HealthSuggestionSeverity;
  category?: string;
}

interface CampaignHealthReport {
  narrative_score: number;
  content_mix_score: number;
  cadence_score: number;
  audience_alignment_score: number;
  execution_cadence_score?: number;
  platform_distribution_score?: number;
  role_balance_score?: number;
  health_score?: number;
  health_status?: string;
  health_grade?: string;
  health_summary?: string;
  issue_count?: number;
  visible_issue_count?: number;
  hidden_issue_count?: number;
  analysis_warnings?: string[];
  report_timestamp?: string;
  top_issue_categories?: string[];
  score_breakdown?: Record<string, number>;
  health_flags?: Record<string, boolean>;
  role_distribution?: {
    low_confidence_activities?: Array<{ id: string; predicted_role: string; confidence: number }>;
    missing_cta_count?: number;
    missing_objective_count?: number;
    missing_phase_count?: number;
  };
  suggestions: HealthSuggestion[];
}

function SeverityBadge({ severity }: { severity: HealthSuggestionSeverity }) {
  const styles: Record<HealthSuggestionSeverity, string> = {
    info: 'bg-blue-100 text-blue-800 text-xs font-medium px-1.5 py-0.5 rounded',
    warning: 'bg-amber-100 text-amber-800 text-xs font-medium px-1.5 py-0.5 rounded',
    critical: 'bg-red-100 text-red-800 text-xs font-medium px-1.5 py-0.5 rounded',
  };
  return <span className={styles[severity]}>{severity}</span>;
}

function ScoreBar({ label, score, icon: Icon }: { label: string; score: number; icon: React.ComponentType<{ className?: string }> }) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-gray-700">
          <Icon className="h-4 w-4 text-indigo-500" />
          {label}
        </span>
        <span className="font-medium text-gray-900">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function normalizeSuggestion(s: unknown): HealthSuggestion {
  if (s && typeof s === 'object' && 'message' in s && typeof (s as { message?: unknown }).message === 'string') {
    const obj = s as { message: string; severity?: string; category?: string };
    const sev = obj.severity;
    const severity: HealthSuggestionSeverity =
      sev === 'critical' || sev === 'warning' ? sev : 'info';
    return { message: obj.message, severity, category: obj.category };
  }
  return { message: String(s), severity: 'info' as const };
}

const SCORE_LABELS: Record<string, string> = {
  narrative_score: 'Narrative',
  content_mix_score: 'Content Mix',
  cadence_score: 'Cadence',
  audience_alignment_score: 'Audience Alignment',
  execution_cadence_score: 'Execution Cadence',
  platform_distribution_score: 'Platform Distribution',
  role_balance_score: 'Role Balance',
  metadata_completeness_score: 'Metadata Completeness',
};

export function CampaignHealthPanel({ campaignId, companyId, onError }: CampaignHealthPanelProps) {
  const { state, setHealthReport } = usePlannerSession();
  const [report, setReport] = useState<CampaignHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const fetchHealth = useCallback(() => {
    if (!campaignId) {
      setReport(null);
      setHealthReport(null);
      return;
    }
    setLoading(true);
    fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/health`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          onError?.(data.error);
          setReport(null);
          setHealthReport(null);
        } else {
          const raw = Array.isArray(data.suggestions) ? data.suggestions : [];
          const r: CampaignHealthReport = {
            narrative_score: data.narrative_score ?? 0,
            content_mix_score: data.content_mix_score ?? 0,
            cadence_score: data.cadence_score ?? 0,
            audience_alignment_score: data.audience_alignment_score ?? 0,
            execution_cadence_score: data.execution_cadence_score ?? 0,
            platform_distribution_score: data.platform_distribution_score ?? 0,
            role_balance_score: data.role_balance_score ?? 0,
            health_score: data.health_score ?? 0,
            health_status: data.health_status ?? 'moderate',
            health_grade: data.health_grade ?? 'C',
            health_summary: data.health_summary ?? '',
            issue_count: data.issue_count ?? 0,
            visible_issue_count: data.visible_issue_count ?? 0,
            hidden_issue_count: data.hidden_issue_count ?? 0,
            analysis_warnings: Array.isArray(data.analysis_warnings) ? data.analysis_warnings : [],
            report_timestamp: data.report_timestamp ?? '',
            top_issue_categories: Array.isArray(data.top_issue_categories) ? data.top_issue_categories : [],
            score_breakdown: data.score_breakdown && typeof data.score_breakdown === 'object' ? data.score_breakdown : undefined,
            role_distribution: data.role_distribution ?? undefined,
            suggestions: raw.map(normalizeSuggestion),
          };
          setReport(r);
          setHealthReport({
            health_score: r.health_score,
            health_status: r.health_status,
            health_grade: r.health_grade,
            health_summary: r.health_summary,
            issue_count: r.issue_count,
            visible_issue_count: r.visible_issue_count,
            hidden_issue_count: r.hidden_issue_count,
            analysis_warnings: r.analysis_warnings,
            report_timestamp: r.report_timestamp,
            top_issue_categories: r.top_issue_categories,
            score_breakdown: r.score_breakdown,
            health_flags: r.health_flags,
            role_distribution: r.role_distribution,
          });
        }
      })
      .catch((err) => {
        onError?.(err instanceof Error ? err.message : 'Failed to load health');
        setReport(null);
        setHealthReport(null);
      })
      .finally(() => setLoading(false));
  }, [campaignId, onError, setHealthReport]);

  useEffect(() => {
    if (!campaignId) {
      setReport(null);
      setHealthReport(null);
      return;
    }
    fetchHealth();
  }, [campaignId, fetchHealth, setHealthReport]);

  if (loading && !report) {
    return (
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 px-4 py-3">
        <p className="text-sm text-indigo-700">Loading campaign health…</p>
      </div>
    );
  }

  if (!campaignId) {
    return null;
  }

  if (!report) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
        <p className="text-sm text-gray-600">No health report yet. Save or update the campaign plan to generate one.</p>
      </div>
    );
  }

  const statusLabel = report?.health_status ? String(report.health_status).charAt(0).toUpperCase() + String(report.health_status).slice(1) : '—';
  const grade = report?.health_grade ?? '—';
  const score = report?.health_score ?? 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div
        className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-100 flex items-center justify-between cursor-pointer hover:bg-indigo-50/50 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronUp className="h-4 w-4 text-gray-500" />
          )}
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Campaign Health: {score} ({statusLabel}) — Grade {grade}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {report?.visible_issue_count != null && report.visible_issue_count > 0
                ? `Showing top ${report.visible_issue_count}`
                : 'Design & execution evaluation'}
              {(report?.hidden_issue_count ?? 0) > 0 && (
                <span className="text-amber-600 ml-1">+{report!.hidden_issue_count} additional issues not shown</span>
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fetchHealth();
          }}
          disabled={!campaignId || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play className="h-3.5 w-3.5" />
          {loading ? 'Running…' : 'Run Health Analysis'}
        </button>
      </div>
      {!collapsed && report && (
        <div className="p-4 space-y-4">
          {report.health_summary && (
            <div className="rounded-lg bg-gray-50 p-3">
              <h4 className="text-xs font-medium text-gray-600 mb-1">Summary</h4>
              <p className="text-sm text-gray-800">{report.health_summary}</p>
            </div>
          )}
          {(report.analysis_warnings?.length ?? 0) > 0 && (
            <div>
              <h4 className="text-xs font-medium text-amber-700 mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Health Warnings
              </h4>
              <ul className="space-y-1 text-sm text-amber-800">
                {report.analysis_warnings!.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {report.score_breakdown && Object.keys(report.score_breakdown).length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-600 mb-2">Score Breakdown</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(report.score_breakdown).map(([key, val]) => (
                      <tr key={key} className="border-b border-gray-100">
                        <td className="py-1.5 text-gray-700">{SCORE_LABELS[key] ?? key.replace(/_/g, ' ')}</td>
                        <td className="py-1.5 text-right font-medium text-gray-900">{val}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="space-y-4">
            <ScoreBar label="Narrative Balance" score={report.narrative_score} icon={MessageSquare} />
            <ScoreBar label="Content Mix" score={report.content_mix_score} icon={BarChart3} />
            <ScoreBar label="Cadence" score={report.cadence_score} icon={Activity} />
            <ScoreBar label="Audience Alignment" score={report.audience_alignment_score} icon={Users} />
            <ScoreBar label="Platform Distribution" score={report.platform_distribution_score ?? 0} icon={Layers} />
            <ScoreBar label="Execution Cadence" score={report.execution_cadence_score ?? 0} icon={Clock} />
            <ScoreBar label="Role Balance" score={report.role_balance_score ?? 0} icon={Target} />
          </div>
        </div>
      )}
      {!collapsed && report && report.suggestions.length > 0 && (
        <div className="px-4 pb-4 pt-0">
          <h4 className="text-xs font-medium text-gray-600 mb-2">Suggestions</h4>
          <ul className="space-y-1.5">
            {report.suggestions.map((s, i) => (
              <li
                key={i}
                className="text-sm text-gray-700 flex items-center gap-2"
              >
                <SeverityBadge severity={s.severity} />
                {s.category && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                    {s.category.replace(/_/g, ' ')}
                  </span>
                )}
                <span className="flex-1">{s.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
