import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
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
  const [connectors, setConnectors] = useState<ConnectorRecord[]>([
    { platform: 'linkedin', displayName: 'LinkedIn', status: 'disconnected', expires_at: null },
    { platform: 'facebook', displayName: 'Facebook', status: 'disconnected', expires_at: null },
    { platform: 'instagram', displayName: 'Instagram', status: 'disconnected', expires_at: null },
    { platform: 'twitter', displayName: 'Twitter', status: 'disconnected', expires_at: null },
    { platform: 'reddit', displayName: 'Reddit', status: 'disconnected', expires_at: null },
  ]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const connected = typeof router.query.connected === 'string' ? router.query.connected : null;
    const status = typeof router.query.status === 'string' ? router.query.status : null;
    const error = typeof router.query.error === 'string' ? router.query.error : null;

    if (error) {
      setErrorMessage(decodeURIComponent(error));
    }

    if (connected && status === 'success') {
      setConnectors((prev) =>
        prev.map((entry) =>
          entry.platform === connected
            ? { ...entry, status: 'connected' }
            : entry
        )
      );
    }
  }, [router.query]);

  const linkForPlatform = (platform: string) => {
    if (!tenantId) return '#';
    const redirect = encodeURIComponent('/community-ai/connectors');
    return `/api/community-ai/connectors/${platform}/auth?tenant_id=${encodeURIComponent(
      tenantId
    )}&organization_id=${encodeURIComponent(tenantId)}&redirect=${redirect}`;
  };

  const handleDisconnect = (platform: string) => {
    setConnectors((prev) =>
      prev.map((entry) =>
        entry.platform === platform ? { ...entry, status: 'disconnected' } : entry
      )
    );
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
    >
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
          {errorMessage}
        </div>
      )}

      <SectionCard
        title="Connected Platforms"
        subtitle="Manage Community-AI connectors for engagement actions."
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
                    <div className="flex gap-2">
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
                        disabled={entry.resolvedStatus !== 'connected'}
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
                    No connectors configured.
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
