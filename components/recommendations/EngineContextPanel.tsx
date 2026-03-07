import React, { useState, useEffect } from 'react';
import type { ContextMode, FocusModule } from './engine-framework/UnifiedContextModeSelector';

type FetchWithAuth = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

type CompanyContextApi = {
  company_context?: Record<string, unknown> | null;
  company_context_completion?: number;
  forced_context_enabled_fields?: string[];
  forced_context_active_labels?: string[];
  forced_context?: Record<string, unknown> | null;
};

type Props = {
  companyId: string | null;
  fetchWithAuth: FetchWithAuth;
  contextMode?: ContextMode;
  focusedModules?: FocusModule[];
  additionalDirection?: string;
};

const SECTION_LABELS: Record<string, string> = {
  identity: 'Identity',
  brand: 'Brand Strategy',
  customer: 'Customer / ICP',
  problem_transformation: 'Problem & Transformation',
  campaign: 'Campaign Guidance',
  commercial: 'Commercial',
};

const MODULE_TO_SECTIONS: Record<FocusModule, string[]> = {
  TARGET_CUSTOMER: ['customer'],
  PROBLEM_DOMAIN: ['problem_transformation'],
  CAMPAIGN_PURPOSE: ['campaign'],
  OFFERINGS: ['brand', 'campaign'],
  GEOGRAPHY: ['identity'],
  PRICING: ['commercial'],
};

function isGeographyField(fieldKey: string): boolean {
  return fieldKey === 'geography' || fieldKey === 'geography_list';
}

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasValue);
  return String(value).trim().length > 0;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object' && value != null) return JSON.stringify(value);
  return String(value ?? '');
}

export default function EngineContextPanel({
  companyId,
  fetchWithAuth,
  contextMode = 'FULL',
  focusedModules = [],
  additionalDirection = '',
}: Props) {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [contextData, setContextData] = useState<CompanyContextApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!companyId || typeof window === 'undefined') return;
    const handleProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (!detail?.companyId || detail.companyId === companyId) {
        setRefreshToken((v) => v + 1);
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === `company_profile_updated:${companyId}`) {
        setRefreshToken((v) => v + 1);
      }
    };
    window.addEventListener('company-profile-updated', handleProfileUpdated as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('company-profile-updated', handleProfileUpdated as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, [companyId]);

  useEffect(() => {
    if (!companyId) {
      setContextData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWithAuth(`/api/company-profile/context?companyId=${encodeURIComponent(companyId)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error('Failed to load company context');
        const data = (await res.json()) as CompanyContextApi;
        setContextData(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, fetchWithAuth, refreshToken]);

  const companyContext = (contextData?.company_context ?? {}) as Record<string, Record<string, unknown>>;
  const activeSectionKeys =
    contextMode === 'FOCUSED'
      ? Array.from(
          new Set(
            focusedModules.flatMap((m) => MODULE_TO_SECTIONS[m] ?? [])
          )
        )
      : Object.keys(companyContext);

  const visibleSections = activeSectionKeys
    .map((sectionKey) => ({
      key: sectionKey,
      label: SECTION_LABELS[sectionKey] || sectionKey.replace(/_/g, ' '),
      values: (companyContext[sectionKey] ?? {}) as Record<string, unknown>,
    }))
    .filter((s) => hasValue(s.values));

  const hasForced = (contextData?.forced_context_active_labels?.length ?? 0) > 0;
  const forcedContext = (contextData?.forced_context ?? {}) as Record<string, unknown>;

  const overlayContent = (
    <div className="px-3 pb-3 pt-0 text-sm text-gray-600 space-y-2">
      {loading && <p className="text-gray-500">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && !error && contextMode === 'NONE' && (
        <div className="space-y-1">
          <p className="text-gray-700">
            <span className="font-medium">No Company Context:</span> trend discovery runs without company/forced context.
          </p>
          {additionalDirection.trim() ? (
            <p className="text-gray-700">
              <span className="font-medium">Research direction:</span> {additionalDirection}
            </p>
          ) : (
            <p className="text-amber-700">
              Add &quot;Additional Research Direction&quot; to guide this run.
            </p>
          )}
        </div>
      )}
      {!loading && !error && contextMode !== 'NONE' && (
        <>
          <p className="text-gray-700">
            <span className="font-medium">Context mode:</span> {contextMode === 'FULL' ? 'Full Company Context' : 'Focused Context'}
          </p>
          {visibleSections.length === 0 ? (
            <p className="text-gray-500">No matching company context fields available for this mode.</p>
          ) : (
            <div className="space-y-2">
              {visibleSections.map((section) => (
                (() => {
                  const entries = Object.entries(section.values)
                    .filter(([field, value]) => !isGeographyField(field) && hasValue(value));
                  if (entries.length === 0) return null;
                  return (
                  <div key={section.key}>
                    <span className="text-gray-500 font-medium">{section.label}:</span>
                    <ul className="mt-0.5 list-disc list-inside text-gray-700 space-y-0.5">
                      {entries.map(([field, value]) => (
                          <li key={field}>
                            {field.replace(/_/g, ' ')}: {formatValue(value)}
                          </li>
                      ))}
                    </ul>
                  </div>
                    );
                  })()
                ))}
            </div>
          )}
          {hasForced && (
            <div className="pt-1">
              <span className="text-gray-500 font-medium">Forced Context (active selections):</span>
              <ul className="mt-0.5 list-disc list-inside text-gray-700 space-y-0.5">
                {(contextData?.forced_context_enabled_fields ?? [])
                  .filter((fieldKey) => !isGeographyField(fieldKey))
                  .map((fieldKey) => {
                  const allKeys = contextData?.forced_context_enabled_fields ?? [];
                  const index = allKeys.indexOf(fieldKey);
                  const label = (contextData?.forced_context_active_labels ?? [])[index] || fieldKey.replace(/_/g, ' ');
                  const value = forcedContext[fieldKey];
                  return (
                    <li key={label}>
                      {label}{hasValue(value) ? `: ${formatValue(value)}` : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="relative">
      <div className="border border-gray-200 rounded-lg bg-gray-50/80 overflow-hidden">
        <button
          type="button"
          onClick={() => setOverlayOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          <span>Company context</span>
          <span className="text-gray-500">{overlayOpen ? '▴' : '▼'}</span>
        </button>
      </div>
      {overlayOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOverlayOpen(false)}
          />
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-gray-200 bg-white shadow-xl max-h-[70vh] flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="company-context-overlay-title"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
              <h3 id="company-context-overlay-title" className="text-sm font-semibold text-gray-900">
                Company context
              </h3>
              <button
                type="button"
                onClick={() => setOverlayOpen(false)}
                className="text-gray-500 hover:text-gray-700 p-1 rounded"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto min-h-0">
              {overlayContent}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
