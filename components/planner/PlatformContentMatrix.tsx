/**
 * Platform Content Matrix
 * Renders Platform → Content Type → Frequency input.
 * Only displays platforms/content types from company config.
 * Updates platform_content_requests in planner session state.
 * Supports presets, default suggestions, distribution preview, frequency warnings, Clear Matrix, Auto Balance.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { usePlannerSession, type PlatformContentRequests } from './plannerSessionStore';
import { getCompanyPlatformConfig, type PlatformConfigItem } from '../../lib/companyPlatformService';
import { PLATFORM_LABELS } from '../../backend/constants/platforms';
import {
  DEFAULT_FREQUENCY_SUGGESTIONS,
  buildDistributionPreview,
  getExceededFrequencies,
  autoBalanceMatrix,
} from './platformContentPresets';
import { ChevronRight, ChevronDown, Trash2, Scale } from 'lucide-react';

export interface PlatformContentMatrixProps {
  companyId?: string | null;
  className?: string;
  /** Duration in weeks (for frequency warning context). */
  durationWeeks?: number;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function PlatformContentMatrix({ companyId, className = '', durationWeeks = 6 }: PlatformContentMatrixProps) {
  const { state, setPlatformContentRequests } = usePlannerSession();
  const [config, setConfig] = useState<PlatformConfigItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<string>>(new Set());

  const togglePlatform = (p: string) => {
    setExpandedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  /** Build allowed map: platform -> Set<content_type> from API config */
  const allowedMap = React.useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const { platform, content_types } of config) {
      const p = String(platform).toLowerCase().trim().replace(/^twitter$/i, 'x');
      if (!p) continue;
      const set = new Set<string>();
      for (const ct of content_types ?? []) {
        const c = String(ct).toLowerCase().trim();
        if (c) set.add(c);
      }
      m.set(p, set);
    }
    return m;
  }, [config]);

  /** Only use platform/content_type present in config; discard unsupported before saving */
  const current = React.useMemo(() => {
    const raw = state.platform_content_requests ?? {};
    if (allowedMap.size === 0) return {};
    const filtered: PlatformContentRequests = {};
    for (const [p, ctMap] of Object.entries(raw)) {
      const pNorm = p.toLowerCase().trim().replace(/^twitter$/i, 'x');
      const allowed = allowedMap.get(pNorm);
      if (!allowed) continue;
      const filteredCt: Record<string, number> = {};
      for (const [ct, val] of Object.entries(ctMap ?? {})) {
        const ctNorm = ct.toLowerCase().trim();
        if (allowed.has(ctNorm) && typeof val === 'number' && val >= 0 && val <= 14) {
          filteredCt[ctNorm] = val;
        }
      }
      if (Object.keys(filteredCt).length > 0) filtered[pNorm] = filteredCt;
    }
    return filtered;
  }, [state.platform_content_requests, allowedMap]);

  /** On config load: if current has unsupported entries, persist sanitized version */
  useEffect(() => {
    if (allowedMap.size === 0) return;
    const raw = state.platform_content_requests ?? {};
    let hasInvalid = false;
    for (const [p, ctMap] of Object.entries(raw)) {
      const pNorm = p.toLowerCase().trim().replace(/^twitter$/i, 'x');
      if (!allowedMap.has(pNorm)) {
        hasInvalid = true;
        break;
      }
      const allowed = allowedMap.get(pNorm)!;
      for (const ct of Object.keys(ctMap ?? {})) {
        if (!allowed.has(ct.toLowerCase().trim())) {
          hasInvalid = true;
          break;
        }
      }
    }
    if (hasInvalid && Object.keys(current).length >= 0) {
      const sanitized = Object.keys(current).length > 0 ? current : null;
      setPlatformContentRequests(sanitized);
    }
  }, [allowedMap, config, state.platform_content_requests]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!companyId?.trim()) {
      setConfig([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCompanyPlatformConfig(companyId)
      .then((res) => {
        if (!cancelled) setConfig(res.platforms ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          const status = (e as Error & { status?: number }).status;
          setError(
            status === 401
              ? 'Unauthorized. Please log in again.'
              : status === 403
                ? 'Access denied to this company.'
                : status === 500
                  ? 'Unable to load platform configuration. Please try again.'
                  : (e instanceof Error ? e.message : 'Failed to load platform config.')
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyId]);

  /** Build allowed set from config: platform -> Set<content_type> */
  const allowedPlatformContent = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const { platform, content_types } of config) {
      const p = platform.toLowerCase().trim();
      map.set(p, new Set((content_types ?? []).map((ct) => String(ct).toLowerCase().trim())));
    }
    return map;
  }, [config]);

  /** Sanitize matrix: keep only platform/content_type present in config */
  const sanitizeMatrix = React.useCallback(
    (m: PlatformContentRequests): PlatformContentRequests | null => {
      const next: PlatformContentRequests = {};
      for (const [p, vp] of Object.entries(m)) {
        const allowed = allowedPlatformContent.get(p);
        if (!allowed) continue;
        const filtered: Record<string, number> = {};
        for (const [ct, v] of Object.entries(vp ?? {})) {
          if (allowed.has(ct)) {
            const n = Math.max(0, Math.min(14, Number(v) ?? 0));
            if (n > 0) filtered[ct] = n;
          }
        }
        if (Object.keys(filtered).length > 0) next[p] = filtered;
      }
      return Object.keys(next).length > 0 ? next : null;
    },
    [allowedPlatformContent]
  );

  const handleChange = (platform: string, contentType: string, value: number) => {
    const p = String(platform).toLowerCase().trim();
    const ct = String(contentType).toLowerCase().trim();
    if (!p || !ct) return;
    const allowed = allowedPlatformContent.get(p);
    if (!allowed || !allowed.has(ct)) return;
    const next: PlatformContentRequests = {};
    for (const [kp, vp] of Object.entries(current)) {
      if (allowedPlatformContent.has(kp)) {
        next[kp] = {};
        for (const [kc, vc] of Object.entries(vp ?? {})) {
          if (allowedPlatformContent.get(kp)?.has(kc)) next[kp][kc] = vc;
        }
        if (Object.keys(next[kp]!).length === 0) delete next[kp];
      }
    }
    if (!next[p]) next[p] = {};
    const v = Math.max(0, Math.min(14, value));
    next[p][ct] = v;
    if (v === 0) delete next[p][ct];
    if (Object.keys(next[p] ?? {}).length === 0) delete next[p];
    const sanitized = sanitizeMatrix(next);
    setPlatformContentRequests(sanitized);
  };

  const handleClearMatrix = useCallback(() => {
    setPlatformContentRequests(null);
  }, [setPlatformContentRequests]);

  const handleAutoBalance = useCallback(() => {
    const m = current;
    if (Object.keys(m).length === 0) return;
    const balanced = autoBalanceMatrix(m, allowedPlatformContent);
    if (Object.keys(balanced).length > 0) setPlatformContentRequests(balanced);
  }, [current, allowedPlatformContent, setPlatformContentRequests]);

  const distributionPreview = useMemo(
    () => buildDistributionPreview(current, PLATFORM_LABELS),
    [current]
  );
  const exceededFrequencies = useMemo(
    () => getExceededFrequencies(current),
    [current]
  );
  const getSuggestion = (platform: string, contentType: string): number | null => {
    const p = platform.toLowerCase().replace(/^twitter$/i, 'x');
    const sug = DEFAULT_FREQUENCY_SUGGESTIONS[p]?.[contentType.toLowerCase()] ?? DEFAULT_FREQUENCY_SUGGESTIONS[platform]?.[contentType.toLowerCase()];
    return typeof sug === 'number' ? sug : null;
  };

  if (!companyId?.trim()) {
    return (
      <div className={className}>
        <label className="block text-sm font-medium text-gray-700 mb-2">Platform content matrix</label>
        <p className="text-sm text-gray-500">Select a company to configure platforms and content types.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={className}>
        <label className="block text-sm font-medium text-gray-700 mb-2">Platform content matrix</label>
        <p className="text-sm text-gray-500">Loading platform config…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <label className="block text-sm font-medium text-gray-700 mb-2">Platform content matrix</label>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (config.length === 0) {
    return (
      <div className={className}>
        <label className="block text-sm font-medium text-gray-700 mb-2">Platform content matrix</label>
        <p className="text-sm text-gray-500">No platforms configured for this company.</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-2">Platform content matrix (frequency per week)</label>
      <div className="space-y-1">
        {config.map(({ platform, content_types }) => {
          const p = platform.toLowerCase().trim();
          const label = PLATFORM_LABELS[p] ?? capitalize(p);
          const isExpanded = expandedPlatforms.has(p);
          const activeCount = content_types.filter((ct) => (current[p]?.[ct] ?? 0) > 0).length;
          return (
            <div key={p} className="rounded-lg border border-gray-200 bg-gray-50/30">
              {/* Collapsed summary row */}
              <button
                type="button"
                onClick={() => togglePlatform(p)}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 transition-colors rounded-lg"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                  {label}
                </span>
                <span className="text-xs text-gray-500">
                  {activeCount > 0
                    ? <span className="text-indigo-600 font-medium">{activeCount}/{content_types.length}</span>
                    : <span>{content_types.length}</span>
                  }
                </span>
              </button>

              {/* Expanded inputs */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 flex flex-wrap gap-3 border-t border-gray-100">
                  {content_types.map((ct) => {
                    const val = current[p]?.[ct] ?? 0;
                    const suggestion = (DEFAULT_FREQUENCY_SUGGESTIONS[p] ?? DEFAULT_FREQUENCY_SUGGESTIONS[p === 'twitter' ? 'x' : p === 'x' ? 'twitter' : p])?.[ct];
                    return (
                      <div key={ct} className="flex items-center gap-2" title={`${label} / ${capitalize(ct)}`}>
                        <span className="text-sm text-gray-600 w-20 capitalize">{ct}</span>
                        <input
                          type="number"
                          min={0}
                          max={14}
                          value={val}
                          placeholder={val === 0 && suggestion != null ? String(suggestion) : undefined}
                          onChange={(e) => handleChange(p, ct, parseInt(e.target.value, 10) || 0)}
                          className="w-16 px-2 py-1 text-sm border border-gray-300 rounded"
                        />
                        <span className="text-xs text-gray-500">/week</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
