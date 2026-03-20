/**
 * Autonomous Control Panel
 *
 * Allows company admins to:
 *   - Toggle autonomous campaign generation
 *   - Set approval requirement
 *   - Set risk tolerance (aggressive / balanced / conservative)
 *   - Review pending campaigns awaiting approval
 *   - View the AI decisions log
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bot, Shield, Zap, AlertTriangle, CheckCircle, XCircle, Clock, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

type RiskTolerance = 'aggressive' | 'balanced' | 'conservative';

type AutonomousSettings = {
  autonomous_mode: boolean;
  approval_required: boolean;
  risk_tolerance: RiskTolerance;
};

type PendingCampaign = {
  id: string;
  campaign_plan: {
    name: string;
    description: string;
    platforms: string[];
    duration_weeks: number;
    campaign_goal: string;
    generation_meta: {
      predicted_engagement_rate: number;
      confidence_score: number;
      optimization_notes: string[];
      risk_tolerance: string;
    };
  };
  status: string;
  expires_at: string;
  created_at: string;
};

type DecisionLog = {
  id: string;
  decision_type: string;
  reason: string;
  metrics_used: Record<string, unknown>;
  outcome: string | null;
  created_at: string;
  campaign_id: string | null;
};

const RISK_LABELS: Record<RiskTolerance, { label: string; description: string; color: string }> = {
  conservative: { label: 'Conservative', description: '2 platforms · lower frequency · 8-week cycles', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  balanced:     { label: 'Balanced',     description: '3 platforms · standard frequency · 12-week cycles', color: 'text-green-600 bg-green-50 border-green-200' },
  aggressive:   { label: 'Aggressive',   description: '4 platforms · high frequency · 12-week cycles', color: 'text-orange-600 bg-orange-50 border-orange-200' },
};

const DECISION_TYPE_COLORS: Record<string, string> = {
  generate:      'bg-blue-100 text-blue-700',
  approve:       'bg-green-100 text-green-700',
  reject:        'bg-red-100 text-red-700',
  auto_activate: 'bg-purple-100 text-purple-700',
  optimize:      'bg-yellow-100 text-yellow-700',
  scale:         'bg-emerald-100 text-emerald-700',
  pause:         'bg-orange-100 text-orange-700',
  recover:       'bg-rose-100 text-rose-700',
  learn:         'bg-slate-100 text-slate-700',
};

interface Props {
  companyId: string;
  token: string;
}

export default function AutonomousControlPanel({ companyId, token }: Props) {
  const [settings, setSettings]       = useState<AutonomousSettings | null>(null);
  const [pending, setPending]         = useState<PendingCampaign[]>([]);
  const [decisions, setDecisions]     = useState<DecisionLog[]>([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [expandedDecision, setExpandedDecision] = useState<string | null>(null);
  const [activeTab, setActiveTab]     = useState<'settings' | 'pending' | 'log'>('settings');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, pendingRes, decisionsRes] = await Promise.all([
        fetch(`/api/admin/autonomous?company_id=${companyId}`, { headers }),
        fetch(`/api/campaigns/pending?company_id=${companyId}`, { headers }),
        fetch(`/api/admin/autonomous/decisions?company_id=${companyId}&limit=30`, { headers }),
      ]);
      const [s, p, d] = await Promise.all([settingsRes.json(), pendingRes.json(), decisionsRes.json()]);
      if (s.success) setSettings(s.data);
      if (p.success) setPending(p.data);
      if (d.success) setDecisions(d.data);
    } finally {
      setLoading(false);
    }
  }, [companyId, token]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function saveSettings(updates: Partial<AutonomousSettings>) {
    if (!settings) return;
    setSaving(true);
    const next = { ...settings, ...updates };
    setSettings(next);
    try {
      await fetch('/api/admin/autonomous', {
        method: 'POST',
        headers,
        body: JSON.stringify({ company_id: companyId, ...next }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handlePendingAction(pendingId: string, action: 'approve' | 'reject') {
    setApprovingId(pendingId);
    try {
      await fetch(`/api/campaigns/pending/${pendingId}/${action}`, { method: 'POST', headers });
      await loadAll();
    } finally {
      setApprovingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading autonomous settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Autonomous Mode</h2>
            <p className="text-sm text-slate-500">Self-driving campaign engine</p>
          </div>
        </div>
        <button onClick={loadAll} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        {(['settings', 'pending', 'log'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md capitalize transition-colors ${
              activeTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'pending' ? `Pending${pending.length > 0 ? ` (${pending.length})` : ''}` : tab === 'log' ? 'AI Log' : tab}
          </button>
        ))}
      </div>

      {/* Settings tab */}
      {activeTab === 'settings' && settings && (
        <div className="space-y-4">
          {/* Autonomous mode toggle */}
          <div className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl">
            <div>
              <p className="font-medium text-slate-900">Autonomous Mode</p>
              <p className="text-sm text-slate-500">AI automatically generates and schedules campaigns</p>
            </div>
            <button
              onClick={() => saveSettings({ autonomous_mode: !settings.autonomous_mode })}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.autonomous_mode ? 'bg-purple-600' : 'bg-slate-200'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                settings.autonomous_mode ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          {/* Approval required toggle */}
          <div className={`flex items-center justify-between p-4 border rounded-xl transition-opacity ${
            settings.autonomous_mode ? 'bg-white border-slate-200 opacity-100' : 'bg-slate-50 border-slate-100 opacity-50 pointer-events-none'
          }`}>
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-blue-500" />
              <div>
                <p className="font-medium text-slate-900">Require Approval</p>
                <p className="text-sm text-slate-500">Review campaigns before they go live</p>
              </div>
            </div>
            <button
              onClick={() => saveSettings({ approval_required: !settings.approval_required })}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.approval_required ? 'bg-blue-600' : 'bg-slate-200'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                settings.approval_required ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          {/* Risk tolerance */}
          <div className={`p-4 border rounded-xl transition-opacity ${
            settings.autonomous_mode ? 'bg-white border-slate-200 opacity-100' : 'bg-slate-50 border-slate-100 opacity-50 pointer-events-none'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-5 h-5 text-yellow-500" />
              <p className="font-medium text-slate-900">Risk Tolerance</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(RISK_LABELS) as [RiskTolerance, typeof RISK_LABELS[RiskTolerance]][]).map(([key, meta]) => (
                <button
                  key={key}
                  onClick={() => saveSettings({ risk_tolerance: key })}
                  disabled={saving}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    settings.risk_tolerance === key
                      ? meta.color + ' border-current font-medium'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <p className="text-sm font-medium">{meta.label}</p>
                  <p className="text-xs opacity-70 mt-0.5">{meta.description}</p>
                </button>
              ))}
            </div>
          </div>

          {!settings.autonomous_mode && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              Autonomous mode is off. Enable it to allow the AI to generate and schedule campaigns automatically.
            </div>
          )}
          {settings.autonomous_mode && !settings.approval_required && (
            <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              Auto-activation is on. Campaigns will go live without human review.
            </div>
          )}
        </div>
      )}

      {/* Pending campaigns tab */}
      {activeTab === 'pending' && (
        <div className="space-y-3">
          {pending.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No campaigns awaiting approval
            </div>
          ) : pending.map(p => (
            <div key={p.id} className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{p.campaign_plan.name}</p>
                  <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{p.campaign_plan.description}</p>
                </div>
                <span className="shrink-0 text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full font-medium">Pending</span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="p-2 bg-slate-50 rounded-lg">
                  <p className="text-slate-500 text-xs">Predicted engagement</p>
                  <p className="font-semibold text-slate-900">{(p.campaign_plan.generation_meta.predicted_engagement_rate * 100).toFixed(2)}%</p>
                </div>
                <div className="p-2 bg-slate-50 rounded-lg">
                  <p className="text-slate-500 text-xs">Confidence</p>
                  <p className="font-semibold text-slate-900">{(p.campaign_plan.generation_meta.confidence_score * 100).toFixed(0)}%</p>
                </div>
                <div className="p-2 bg-slate-50 rounded-lg">
                  <p className="text-slate-500 text-xs">Duration</p>
                  <p className="font-semibold text-slate-900">{p.campaign_plan.duration_weeks}w</p>
                </div>
              </div>

              {p.campaign_plan.generation_meta.optimization_notes?.length > 0 && (
                <div className="text-xs text-slate-500 space-y-0.5">
                  {p.campaign_plan.generation_meta.optimization_notes.slice(0, 2).map((note, i) => (
                    <p key={i}>• {note}</p>
                  ))}
                </div>
              )}

              <p className="text-xs text-slate-400">
                Expires: {new Date(p.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => handlePendingAction(p.id, 'approve')}
                  disabled={approvingId === p.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={() => handlePendingAction(p.id, 'reject')}
                  disabled={approvingId === p.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-white hover:bg-red-50 text-red-600 border border-red-200 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Decision log tab */}
      {activeTab === 'log' && (
        <div className="space-y-2">
          {decisions.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No AI decisions recorded yet
            </div>
          ) : decisions.map(d => (
            <div key={d.id} className="p-3 bg-white border border-slate-200 rounded-xl">
              <button
                className="w-full text-left"
                onClick={() => setExpandedDecision(expandedDecision === d.id ? null : d.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DECISION_TYPE_COLORS[d.decision_type] ?? 'bg-slate-100 text-slate-600'}`}>
                      {d.decision_type}
                    </span>
                    <span className="text-sm text-slate-700 truncate max-w-[220px]">{d.reason}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-slate-400">{new Date(d.created_at).toLocaleDateString('en-GB')}</span>
                    {expandedDecision === d.id ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                  </div>
                </div>
              </button>

              {expandedDecision === d.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 text-xs space-y-2">
                  {d.outcome && (
                    <div>
                      <span className="text-slate-500 font-medium">Outcome: </span>
                      <span className="text-slate-700">{d.outcome}</span>
                    </div>
                  )}
                  {Object.keys(d.metrics_used).length > 0 && (
                    <div>
                      <p className="text-slate-500 font-medium mb-1">Metrics used:</p>
                      <pre className="bg-slate-50 rounded p-2 overflow-x-auto text-slate-600">
                        {JSON.stringify(d.metrics_used, null, 2)}
                      </pre>
                    </div>
                  )}
                  {d.campaign_id && (
                    <p className="text-slate-400">Campaign: {d.campaign_id}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
