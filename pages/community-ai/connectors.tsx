import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';

type ConnectorStatus = 'connected' | 'disconnected' | 'expired';

type ConnectorRecord = {
  platform: string;
  displayName: string;
  status: ConnectorStatus;
  expires_at?: string | null;
};

const toStatusLabel = (status: ConnectorStatus) => {
  if (status === 'connected') return 'Connected';
  if (status === 'expired') return 'Expired';
  return 'Not connected';
};

const resolveStatus = (record: ConnectorRecord): ConnectorStatus => {
  if (record.status !== 'connected') return record.status;
  if (!record.expires_at) return 'connected';
  return new Date(record.expires_at).getTime() < Date.now() ? 'expired' : 'connected';
};

export default function CommunityAiConnectors() {
  const { selectedCompanyId } = useCompanyContext();
  const router = useRouter();
  const tenantId = selectedCompanyId || '';
  const [connectors, setConnectors] = useState<ConnectorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchStatus = React.useCallback(async () => {
    if (!tenantId) {
      setConnectors([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/community-ai/connectors/status?tenant_id=${encodeURIComponent(tenantId)}&organization_id=${encodeURIComponent(tenantId)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const errCode = body?.error;
        const msg =
          errCode === 'FORBIDDEN_ROLE'
            ? 'You need Company Admin, Content Publisher, or Content Reviewer role to manage connectors. Contact your organization admin if you need access.'
            : errCode === 'COMPANY_ACCESS_DENIED'
              ? 'You do not have access to this company. Please select a company you belong to.'
              : errCode === 'UNAUTHORIZED'
                ? 'Please sign in to manage connectors.'
                : body?.error || res.statusText || 'Failed to load status';
        setErrorMessage(msg);
        setConnectors([]);
        return;
      }
      const data = (await res.json()) as {
        connections: { platform: string; expires_at?: string | null; connected: boolean }[];
        configured_platforms: { platform: string; displayName: string }[];
      };
      const list = data?.connections ?? [];
      const configured = data?.configured_platforms ?? [];
      const byPlatform = new Map(list.map((r) => [r.platform.toLowerCase(), r]));
      const displayList = configured.map((entry) => {
        const fromDb = byPlatform.get(entry.platform);
        if (!fromDb) return { ...entry, status: 'disconnected' as const, expires_at: null };
        return {
          ...entry,
          status: 'connected' as const,
          expires_at: fromDb.expires_at ?? null,
        };
      });
      setConnectors(displayList);
      setErrorMessage(null);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Failed to load status');
      setConnectors([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const error = typeof router.query.error === 'string' ? router.query.error : null;
    if (error) setErrorMessage(decodeURIComponent(error));
    const connected = typeof router.query.connected === 'string' ? router.query.connected : null;
    const status = typeof router.query.status === 'string' ? router.query.status : null;
    if (connected && status === 'success') fetchStatus();
  }, [router.query, fetchStatus]);

  const linkForPlatform = (platform: string) => {
    if (!tenantId) return '#';
    const redirect = encodeURIComponent('/community-ai/connectors');
    return `/api/community-ai/connectors/${platform}/auth?tenant_id=${encodeURIComponent(
      tenantId
    )}&organization_id=${encodeURIComponent(tenantId)}&redirect=${redirect}`;
  };

  const handleDisconnect = async (platform: string) => {
    if (!tenantId) return;
    try {
      const res = await fetch(
        `/api/community-ai/connectors/${encodeURIComponent(platform)}?tenant_id=${encodeURIComponent(tenantId)}&organization_id=${encodeURIComponent(tenantId)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body?.error || res.statusText || 'Disconnect failed');
        return;
      }
      await fetchStatus();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Disconnect failed');
    }
  };

  const resolved = useMemo(
    () =>
      connectors.map((entry) => ({
        ...entry,
        resolvedStatus: resolveStatus(entry),
      })),
    [connectors]
  );

  return (
    <CommunityAiLayout
      title="Connectors"
      context={{ tenant_id: tenantId, organization_id: tenantId }}
      showChat={false}
    >
      <button
        type="button"
        onClick={() => router.push('/social-platforms')}
        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-4"
        aria-label="Back to Configured Platforms"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}

      <SectionCard
        title="Connected Platforms"
        subtitle="Connect your social accounts for engagement actions. Only platforms with OAuth configured in your environment appear below."
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left text-gray-700">
            <thead className="text-xs uppercase text-gray-500 border-b">
              <tr>
                <th className="px-3 py-2">platform</th>
                <th className="px-3 py-2">status</th>
                <th className="px-3 py-2">expires</th>
                <th className="px-3 py-2">actions</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((entry) => (
                <tr key={entry.platform} className="border-b">
                  <td className="px-3 py-2">{entry.displayName}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        entry.resolvedStatus === 'connected'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : entry.resolvedStatus === 'expired'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-gray-100 text-gray-600 border border-gray-200'
                      }`}
                    >
                      {toStatusLabel(entry.resolvedStatus)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{entry.expires_at || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <a
                        className="px-2 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
                        href={linkForPlatform(entry.platform)}
                        aria-disabled={!tenantId}
                      >
                        Connect {entry.displayName}
                      </a>
                      <button
                        className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600"
                        onClick={() => handleDisconnect(entry.platform)}
                        disabled={entry.resolvedStatus === 'disconnected'}
                      >
                        Disconnect
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {resolved.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-gray-400" colSpan={4}>
                    No social platforms configured for this company. Add LinkedIn, Facebook, Instagram, Twitter, or Reddit in Social Platforms or Company Profile, then return here to connect them.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </CommunityAiLayout>
  );
}
