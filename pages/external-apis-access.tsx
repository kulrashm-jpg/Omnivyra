import React, { useEffect, useMemo, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';
import { getAuthToken } from '../utils/getAuthToken';
import { classifyApiError } from './external-apis.types';

type ApiSource = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  category?: string | null;
  company_id?: string | null;
  auth_type: string;
  method?: string | null;
  is_active: boolean;
  is_preset?: boolean | null;
  is_global_preset?: boolean | null;
  api_key_env_name?: string | null;
  headers?: Record<string, any> | null;
  query_params?: Record<string, any> | null;
  user_access?: UserAccess | null;
  usage_summary?: UsageSummary | null;
  usage_daily?: UsageDaily[];
  usage_company?: {
    total_calls: number;
    success_count: number;
    failure_count: number;
  } | null;
  company_limits?: { daily_limit: number | null; signal_limit: number | null } | null;
  usage_today?: { request_count: number; signals_generated: number };
  usage_by_feature?: Array<{
    feature: string;
    request_count: number;
    success_count: number;
    failure_count: number;
  }>;
  usage_by_user?: Array<{
    user_id: string;
    request_count: number;
    success_count: number;
    failure_count: number;
  }>;
};

type UserAccess = {
  api_source_id: string;
  is_enabled: boolean;
  api_key_env_name?: string | null;
  headers_override?: Record<string, any> | null;
  query_params_override?: Record<string, any> | null;
  rate_limit_per_min?: number | null;
};

type UsageSummary = {
  request_count: number;
  success_count: number;
  failure_count: number;
  last_used_at?: string | null;
  last_failure_at?: string | null;
  last_error_message?: string | null;
  last_error_at?: string | null;
  last_success_at?: string | null;
  last_error_code?: string | null;
};

type UsageDaily = {
  usage_date: string;
  request_count: number;
  success_count: number;
  failure_count: number;
};

type AccessDraft = {
  is_enabled: boolean;
  api_key_env_name: string;
  headers_override_json: string;
  query_params_override_json: string;
  rate_limit_per_min: string;
  error?: string | null;
  saving?: boolean;
};

type ApiRequest = {
  id: string;
  name: string;
  base_url: string;
  status: string;
  created_at: string;
  rejection_reason?: string | null;
  company_id?: string | null;
};

const PURPOSE_OPTIONS = [
  'trend_campaign_detection',
  'market_pulse_signals',
  'competitor_intelligence',
  'market_news',
  'influencer_signals',
  'technology_signals',
  'keyword_intelligence',
] as const;

const POLLING_OPTIONS = ['realtime', '2h', '6h', 'daily', 'weekly'] as const;
const PRIORITY_OPTIONS = ['HIGH', 'MEDIUM', 'LOW'] as const;

const emptyRequestForm = {
  name: '',
  base_url: '',
  purpose: 'trends',
  category: '',
  provider: '',
  connection_type: 'REST',
  documentation_url: '',
  sample_response: '',
  method: 'GET',
  auth_type: 'none',
  api_key_env_name: '',
  headers_json: '{}',
  query_params_json: '{}',
};

type TabId = 'presets' | 'request' | 'approval' | 'usage';

const FILTER_FIELD_KEYS = [
  'keywords',
  'topics',
  'competitors',
  'industries',
  'companies',
  'influencers',
  'technologies',
  'geography',
] as const;

type CompanyConfigState = {
  purposes: string[];
  include_filters: Record<string, string[]>;
  exclude_filters: Record<string, string[]>;
  polling_frequency: string;
  daily_limit: string;
  signal_limit: string;
  priority: string;
  saving: boolean;
  error: string | null;
};

function emptyFilterRecord(): Record<string, string[]> {
  return FILTER_FIELD_KEYS.reduce<Record<string, string[]>>((acc, k) => {
    acc[k] = [];
    return acc;
  }, {});
}

function filtersFromPayload(obj: unknown): Record<string, string[]> {
  const out = emptyFilterRecord();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  const rec = obj as Record<string, unknown>;
  for (const key of FILTER_FIELD_KEYS) {
    const val = rec[key];
    if (Array.isArray(val)) {
      out[key] = val.map((v) => String(v).trim()).filter(Boolean);
    }
  }
  return out;
}

const parseJsonObject = (value: string) => {
  try {
    const parsed = JSON.parse(value || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, value: parsed };
    }
    return { ok: false, error: 'Must be a JSON object.' };
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
};

const requiresAuth = (authType?: string | null) =>
  ['api_key', 'bearer', 'query', 'header'].includes(String(authType || 'none'));

/** Classify API error for display (API key, quota, rate limit, etc.) */

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const scaleHeight = (value: number, max: number, maxHeight = 60) => {
  if (max <= 0) return 4;
  return Math.max(4, Math.round((value / max) * maxHeight));
};

function FilterTagRow({
  label,
  values,
  onAdd,
  onRemove,
}: {
  label: string;
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [input, setInput] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-gray-500 w-20 shrink-0 capitalize">{label}</span>
      <div className="flex flex-wrap gap-1">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[11px]"
          >
            {v}
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="hover:bg-indigo-200 rounded-full p-0.5"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        className="border rounded px-2 py-0.5 text-xs w-28"
        placeholder="Add..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const v = input.trim();
            if (v) {
              onAdd(v);
              setInput('');
            }
          }
        }}
      />
      <button
        type="button"
        onClick={() => {
          const v = input.trim();
          if (v) {
            onAdd(v);
            setInput('');
          }
        }}
        className="text-[11px] text-indigo-600 hover:underline"
      >
        Add
      </button>
    </div>
  );
}

const HealthBadgeLegend = () => (
  <div className="text-[11px] text-gray-500 flex flex-wrap gap-3 items-center">
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full bg-green-400" />
      Healthy &lt; 2%
    </span>
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full bg-yellow-400" />
      Degraded 2–10%
    </span>
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full bg-red-400" />
      Unhealthy &gt; 10%
    </span>
  </div>
);

import { useExtApisAccess } from '../hooks/useExtApisAccess';
import ExtApisAccessView from '../components/ExtApisAccessView';
import PageLoader from '../components/PageLoader';
export default function ExternalApisAccessPage() {
  const d = useExtApisAccess();
  if (d._ef1) return <PageLoader message="Loading integrations…" />;
  if (d._ef2) return <PageLoader message="Loading integrations…" />;
  return <ExtApisAccessView d={d} />;
}
