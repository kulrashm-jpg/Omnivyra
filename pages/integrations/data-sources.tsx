import React, { useCallback, useEffect, useState } from 'react';
import IntegrationHubNav from '../../components/integrations/IntegrationHubNav';

/**
 * PHASE-1A — the Data Sources area of the Company Admin integration hub.
 *
 * Renders the declared data-source catalogue with each provider's REAL status
 * for the active tenant. It builds nothing, connects nothing and configures
 * nothing: this phase establishes where future providers will live, and the
 * page is honest that most of them do not exist yet.
 *
 * Status comes from the API, which derives it from the tenant's own integration
 * rows. The page never infers "connected" from the presence of a definition.
 */

type Status = 'not_connected' | 'connected' | 'configuration_required' | 'error' | 'not_available';

interface SourceView {
  key: string;
  label: string;
  group: string;
  available: boolean;
  requires: string[];
  note: string;
  status: Status;
  integrationId: string | null;
}

const GROUP_LABEL: Record<string, string> = {
  prospect_discovery: 'Prospect discovery',
  enrichment: 'Enrichment',
  crm_import: 'CRM import',
};

const STATUS_STYLE: Record<Status, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'bg-emerald-100 text-emerald-800' },
  configuration_required: { label: 'Configuration required', className: 'bg-amber-100 text-amber-800' },
  error: { label: 'Error', className: 'bg-red-100 text-red-800' },
  not_connected: { label: 'Not connected', className: 'bg-gray-100 text-gray-700' },
  not_available: { label: 'Not available', className: 'bg-gray-100 text-gray-500' },
};

export default function DataSourcesPage() {
  const [sources, setSources] = useState<SourceView[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The tenant is resolved server-side from the authenticated session's
      // company; it is passed explicitly so the request is membership-verified
      // rather than relying on an implicit default.
      const companyId = new URLSearchParams(window.location.search).get('company_id');
      if (!companyId) {
        setError('No company selected. Open this page from the integrations hub.');
        setLoading(false);
        return;
      }
      const res = await fetch(`/api/integrations/data-sources?company_id=${encodeURIComponent(companyId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(String(body?.error ?? `Request failed (${res.status})`));
        setSources([]);
        return;
      }
      const body = await res.json();
      setSources(Array.isArray(body?.sources) ? body.sources : []);
      setGroups(Array.isArray(body?.groups) ? body.groups : []);
    } catch {
      setError('Could not load data sources.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Data Sources</h1>
          <p className="mt-1 text-sm text-gray-500">
            Where prospect records come from. Sources marked “Not available” are declared for the
            roadmap and cannot be connected yet.
          </p>
        </div>

        <IntegrationHubNav active="data_sources" />

        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {error}
          </div>
        )}

        {!loading && !error && groups.map((group) => {
          const inGroup = sources.filter((s) => s.group === group);
          if (inGroup.length === 0) return null;
          return (
            <section key={group} id={group} className="mb-8">
              <h2 className="mb-3 text-base font-semibold text-gray-900">
                {GROUP_LABEL[group] ?? group}
              </h2>
              <ul className="space-y-2">
                {inGroup.map((s) => {
                  const style = STATUS_STYLE[s.status] ?? STATUS_STYLE.not_connected;
                  return (
                    <li
                      key={s.key}
                      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{s.label}</span>
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${style.className}`}>
                            {style.label}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-500">{s.note}</p>
                        {s.requires.length > 0 && (
                          <p className="mt-1 text-xs text-gray-400">
                            Requires: {s.requires.join(', ')}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
