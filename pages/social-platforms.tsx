import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useCompanyContext } from '../components/CompanyContext';
import Header from '../components/Header';
import { apiFetch } from '../lib/apiFetch';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  Link2,
  Unlink,
  RefreshCw,
  Clock,
  ShieldCheck,
  Lock,
} from 'lucide-react';

interface PlatformStatus {
  platform_key: string;
  platform_label: string;
  auth_path: string | null;
  oauth_configured: boolean;
  connected: boolean;
  expired: boolean;
  account_name: string | null;
  username: string | null;
  token_expires_at: string | null;
  social_account_id: string | null;
}

const PLATFORM_META: Record<string, { icon: string; color: string }> = {
  linkedin:  { icon: '🔵', color: 'border-blue-200 bg-blue-50' },
  twitter:   { icon: '🐦', color: 'border-sky-200 bg-sky-50' },
  youtube:   { icon: '▶️', color: 'border-red-200 bg-red-50' },
  instagram: { icon: '📷', color: 'border-pink-200 bg-pink-50' },
  facebook:  { icon: '👤', color: 'border-indigo-200 bg-indigo-50' },
  tiktok:    { icon: '🎵', color: 'border-gray-200 bg-gray-50' },
  pinterest: { icon: '📌', color: 'border-rose-200 bg-rose-50' },
  reddit:    { icon: '🟠', color: 'border-orange-200 bg-orange-50' },
};

export default function SocialPlatformsPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const notify = (type: 'success' | 'error', message: string) => {
    setNotice({ type, message });
    setTimeout(() => setNotice(null), 4000);
  };

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const params = selectedCompanyId ? `?companyId=${selectedCompanyId}` : '';
      const r = await apiFetch(`/api/social-accounts/status${params}`);
      if (r.ok) {
        const data = await r.json();
        setPlatforms(data.accounts || []);
      }
    } catch (e) {
      console.error('Failed to load social accounts', e);
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Handle OAuth callback redirect
  useEffect(() => {
    const { connected, success, error } = router.query;
    if (connected && success === 'true') {
      notify('success', `${String(connected)} account connected successfully!`);
      loadStatus();
      router.replace('/social-platforms', undefined, { shallow: true });
    } else if (error) {
      notify('error', `Connection failed: ${decodeURIComponent(String(error))}`);
      router.replace('/social-platforms', undefined, { shallow: true });
    }
  }, [router.query]);

  const handleConnect = (p: PlatformStatus) => {
    if (!p.auth_path) return;
    const params = new URLSearchParams({ returnTo: '/social-platforms' });
    if (selectedCompanyId) params.set('companyId', selectedCompanyId);
    window.location.href = `${p.auth_path}?${params.toString()}`;
  };

  const handleDisconnect = async (p: PlatformStatus) => {
    if (!confirm(`Disconnect ${p.platform_label}? This will stop publishing to this account.`)) return;
    setDisconnecting(p.platform_key);
    try {
      const r = await apiFetch('/api/social-accounts/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: p.platform_key }),
      });
      if (r.ok) {
        notify('success', `${p.platform_label} disconnected.`);
        loadStatus();
      } else {
        const err = await r.json().catch(() => ({}));
        notify('error', err.error || 'Failed to disconnect');
      }
    } finally {
      setDisconnecting(null);
    }
  };

  const getStatusBadge = (p: PlatformStatus) => {
    if (p.connected && p.expired) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <Clock className="h-3 w-3" /> Token Expired
      </span>
    );
    if (p.connected) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="h-3 w-3" /> Connected
      </span>
    );
    if (!p.oauth_configured) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-500 border border-gray-200">
        <Lock className="h-3 w-3" /> Admin setup required
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200">
        <AlertCircle className="h-3 w-3" /> Not connected
      </span>
    );
  };

  const connected = platforms.filter((p) => p.connected).length;
  const available = platforms.filter((p) => p.oauth_configured && !p.connected).length;

  return (
    <>
      <Head><title>Social Platform Connections</title></Head>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto px-6 py-10">

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="h-6 w-6 text-indigo-600" />
              <h1 className="text-2xl font-bold text-gray-900">Social Platform Connections</h1>
            </div>
            <p className="text-gray-500 text-sm">
              Connect your social accounts to enable content publishing from the scheduler and activity workspace.
              Each connected account is used when scheduling posts to that platform.
            </p>
            {platforms.length > 0 && (
              <div className="mt-3 flex items-center gap-4 text-sm">
                <span className="text-emerald-600 font-medium">{connected} connected</span>
                {available > 0 && <span className="text-gray-400">{available} available to connect</span>}
              </div>
            )}
          </div>

          {/* Notice */}
          {notice && (
            <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
              notice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              {notice.message}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <div className="space-y-3">
              {platforms.map((p) => {
                const meta = PLATFORM_META[p.platform_key];
                return (
                  <div
                    key={p.platform_key}
                    className={`bg-white rounded-xl border p-5 flex items-center justify-between gap-4 transition-colors ${
                      p.connected ? 'border-emerald-200' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <span className="text-2xl shrink-0">{meta?.icon ?? '🌐'}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900">{p.platform_label}</span>
                          {getStatusBadge(p)}
                        </div>
                        {p.connected && (
                          <div className="mt-0.5 text-xs text-gray-500 truncate">
                            {p.account_name || p.username || 'Account connected'}
                            {p.token_expires_at && (
                              <span className="ml-2 text-gray-400">
                                · Expires {new Date(p.token_expires_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        )}
                        {!p.oauth_configured && !p.connected && (
                          <div className="mt-0.5 text-xs text-gray-400">
                            OAuth not configured — ask your Super Admin to add credentials
                          </div>
                        )}
                        {p.oauth_configured && !p.connected && p.auth_path && (
                          <div className="mt-0.5 text-xs text-gray-400">
                            Ready to connect
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {p.connected ? (
                        <>
                          {p.expired && p.auth_path && (
                            <button
                              onClick={() => handleConnect(p)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
                            >
                              <RefreshCw className="h-3.5 w-3.5" /> Reconnect
                            </button>
                          )}
                          <button
                            onClick={() => handleDisconnect(p)}
                            disabled={disconnecting === p.platform_key}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                          >
                            <Unlink className="h-3.5 w-3.5" />
                            {disconnecting === p.platform_key ? 'Disconnecting…' : 'Disconnect'}
                          </button>
                        </>
                      ) : p.oauth_configured && p.auth_path ? (
                        <button
                          onClick={() => handleConnect(p)}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
                        >
                          <Link2 className="h-3.5 w-3.5" /> Connect
                        </button>
                      ) : p.oauth_configured && !p.auth_path ? (
                        <span className="text-xs text-gray-400">Coming soon</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <Lock className="h-3.5 w-3.5" /> Setup required
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-8 text-xs text-gray-400 text-center">
            Connections are per-user. Each team member connects their own accounts independently.
            Platform OAuth credentials are managed by your Super Admin.
          </p>
        </div>
      </div>
    </>
  );
}
