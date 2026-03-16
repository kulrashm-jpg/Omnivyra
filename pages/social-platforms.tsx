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
  Users,
  Share2,
  FlaskConical,
  Archive,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  X,
  TrendingUp,
  ImageIcon,
  Zap,
  Globe2,
} from 'lucide-react';

interface PlatformStatus {
  platform_key: string;
  platform_label: string;
  auth_path: string | null;
  category: 'social' | 'community';
  oauth_configured: boolean;
  connected: boolean;
  expired: boolean;
  account_name: string | null;
  username: string | null;
  token_expires_at: string | null;
  social_account_id: string | null;
}

interface CheckResult {
  credentials_ok: boolean;
  token_ok: boolean | null;
  token_detail: string | null;
  checked_at: string;
}

const CACHE_KEY = 'social_platform_checks';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ARCHIVED_COMMUNITY_KEY = 'archived_community_platforms';
const HIDDEN_SOCIAL_KEY  = 'hidden_social_platforms';
const HIDDEN_TREND_KEY   = 'hidden_trend_apis';
const HIDDEN_IMAGE_KEY   = 'hidden_image_apis';

const PLATFORM_META: Record<string, { icon: string; color: string }> = {
  linkedin:      { icon: '🔵', color: 'border-blue-200 bg-blue-50' },
  twitter:       { icon: '🐦', color: 'border-sky-200 bg-sky-50' },
  youtube:       { icon: '▶️', color: 'border-red-200 bg-red-50' },
  instagram:     { icon: '📷', color: 'border-pink-200 bg-pink-50' },
  facebook:      { icon: '👤', color: 'border-indigo-200 bg-indigo-50' },
  whatsapp:      { icon: '💬', color: 'border-green-200 bg-green-50' },
  tiktok:        { icon: '🎵', color: 'border-gray-200 bg-gray-50' },
  pinterest:     { icon: '📌', color: 'border-rose-200 bg-rose-50' },
  reddit:        { icon: '🟠', color: 'border-orange-200 bg-orange-50' },
  github:        { icon: '🐙', color: 'border-gray-200 bg-gray-50' },
  hackernews:    { icon: '🔶', color: 'border-orange-200 bg-orange-50' },
  discord:       { icon: '💬', color: 'border-violet-200 bg-violet-50' },
  devto:         { icon: '👩‍💻', color: 'border-gray-200 bg-gray-50' },
  medium:        { icon: '✍️', color: 'border-gray-200 bg-gray-50' },
  stackoverflow: { icon: '📚', color: 'border-amber-200 bg-amber-50' },
  quora:         { icon: '❓', color: 'border-red-200 bg-red-50' },
};

// Helper: categorise an external-api catalog entry by its base_url
function getCatalogApiCategory(api: any): 'trend' | 'community' | 'llm' | 'image' | 'others' {
  const url = (api.base_url || '').toLowerCase();
  if (url.includes('/v1/images') || url.includes('stability.ai') || url.includes('replicate.com') || url.includes('fal.run') || url.includes('unsplash.com') || url.includes('pixabay.com') || url.includes('pexels.com')) return 'image';
  if (url.includes('openai.com') || url.includes('anthropic.com') || url.includes('generativelanguage.googleapis') || url.includes('groq.com') || url.includes('mistral.ai') || url.includes('cohere.ai')) return 'llm';
  if (url.includes('reddit.com') || url.includes('hn.algolia.com') || url.includes('stackexchange.com') || url.includes('api.github.com') || url.includes('discord.com/api')) return 'community';
  if (url.includes('googleapis.com/youtube') || url.includes('newsapi.org') || url.includes('serpapi.com') || url.includes('searchapi.io') || url.includes('gdeltproject.org') || url.includes('trends-proxy')) return 'trend';
  return 'others';
}

const CATALOG_ICON: Record<string, string> = {
  'googleapis.com/youtube': '▶️', 'newsapi.org': '📰', 'serpapi.com': '🔍',
  'searchapi.io': '🔎', 'gdeltproject.org': '🌍', 'trends-proxy': '📈',
  '/v1/images': '🖼️', 'stability.ai': '🎨', 'replicate.com': '🔁',
  'fal.run': '⚡', 'unsplash.com': '📷', 'pixabay.com': '🌄', 'pexels.com': '🖼️',
  'openai.com': '🤖', 'anthropic.com': '🧠', 'groq.com': '⚡',
  'mistral.ai': '🌊', 'cohere.ai': '🔗',
};
function getCatalogIcon(api: any): string {
  const url = (api.base_url || '').toLowerCase();
  for (const [k, v] of Object.entries(CATALOG_ICON)) { if (url.includes(k)) return v; }
  return '🔌';
}

function loadCachedChecks(): Record<string, CheckResult> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CheckResult>;
  } catch { return {}; }
}

function saveCachedChecks(checks: Record<string, CheckResult>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(checks)); } catch { /* ignore */ }
}

function isStale(result: CheckResult): boolean {
  return Date.now() - new Date(result.checked_at).getTime() > CACHE_TTL_MS;
}

export default function SocialPlatformsPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckResult>>({});
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [archivedCommunity, setArchivedCommunity] = useState<Set<string>>(new Set());
  const [hiddenSocial, setHiddenSocial] = useState<Set<string>>(new Set());
  const [hiddenTrend, setHiddenTrend] = useState<Set<string>>(new Set());
  const [hiddenImage, setHiddenImage] = useState<Set<string>>(new Set());
  const [showHiddenSocial, setShowHiddenSocial] = useState(false);
  const [showHiddenCommunity, setShowHiddenCommunity] = useState(false);
  const [showHiddenTrend, setShowHiddenTrend] = useState(false);
  const [showHiddenImage, setShowHiddenImage] = useState(false);
  const [activeTab, setActiveTab] = useState<'social' | 'trend' | 'community' | 'image'>('social');
  const [catalogApis, setCatalogApis] = useState<any[]>([]);
  const [loadingCatalogApis, setLoadingCatalogApis] = useState(false);
  const [companyConfigs, setCompanyConfigs] = useState<any[]>([]);
  const [togglingApiId, setTogglingApiId] = useState<string | null>(null);

  const isSuperAdmin = userRole === 'SUPER_ADMIN';

  const notify = (type: 'success' | 'error', message: string) => {
    setNotice({ type, message });
    setTimeout(() => setNotice(null), 5000);
  };

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const params = selectedCompanyId ? `?companyId=${selectedCompanyId}` : '';
      const r = await apiFetch(`/api/social-accounts/status${params}`);
      if (r.ok) {
        const data = await r.json();
        setPlatforms(data.accounts || []);
        setUserRole(data.user_role ?? null);
      }
    } catch (e) {
      console.error('Failed to load social accounts', e);
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  const loadCatalogApis = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoadingCatalogApis(true);
    try {
      // catalog=1 returns all active global preset APIs so the company can browse and select
      const r = await apiFetch(`/api/external-apis?companyId=${selectedCompanyId}&catalog=1`);
      if (r.ok) { const d = await r.json(); setCatalogApis(d.apis || []); }
    } catch { /* non-fatal */ }
    finally { setLoadingCatalogApis(false); }
  }, [selectedCompanyId]);

  const loadCompanyConfigs = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const r = await apiFetch(`/api/external-apis/company-config?companyId=${selectedCompanyId}`);
      if (r.ok) { const d = await r.json(); setCompanyConfigs(d.configs || []); }
    } catch { /* non-fatal */ }
  }, [selectedCompanyId]);

  const toggleApiSelection = async (api: any, enable: boolean) => {
    if (!selectedCompanyId) return;
    setTogglingApiId(api.id);
    try {
      const r = await apiFetch(`/api/external-apis/company-config?companyId=${selectedCompanyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_source_id: api.id, enabled: enable }),
      });
      if (r.ok) await loadCompanyConfigs();
    } catch { /* non-fatal */ }
    finally { setTogglingApiId(null); }
  };

  // Load all hidden/archived sets from localStorage on mount
  useEffect(() => {
    const load = (key: string) => { try { const r = localStorage.getItem(key); return r ? new Set<string>(JSON.parse(r)) : new Set<string>(); } catch { return new Set<string>(); } };
    setArchivedCommunity(load(ARCHIVED_COMMUNITY_KEY));
    setHiddenSocial(load(HIDDEN_SOCIAL_KEY));
    setHiddenTrend(load(HIDDEN_TREND_KEY));
    setHiddenImage(load(HIDDEN_IMAGE_KEY));
  }, []);

  const makeHideHandlers = (storageKey: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => ({
    hide: (id: string) => setter((prev) => { const next = new Set(prev).add(id); try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /**/ } return next; }),
    unhide: (id: string) => setter((prev) => { const next = new Set(prev); next.delete(id); try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /**/ } return next; }),
  });

  const socialHiders   = makeHideHandlers(HIDDEN_SOCIAL_KEY, setHiddenSocial);
  const communityHiders = makeHideHandlers(ARCHIVED_COMMUNITY_KEY, setArchivedCommunity);
  const trendHiders    = makeHideHandlers(HIDDEN_TREND_KEY, setHiddenTrend);
  const imageHiders    = makeHideHandlers(HIDDEN_IMAGE_KEY, setHiddenImage);

  // Keep old names for backward compat with community card render
  const archiveCommunity = communityHiders.hide;
  const restoreCommunity = communityHiders.unhide;

  // Load cached checks on mount and auto-check stale entries
  useEffect(() => {
    const cached = loadCachedChecks();
    setChecks(cached);
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadCatalogApis(); }, [loadCatalogApis]);
  useEffect(() => { loadCompanyConfigs(); }, [loadCompanyConfigs]);

  // Daily auto-check: re-verify any configured platform whose cache is stale
  useEffect(() => {
    if (platforms.length === 0) return;
    const cached = loadCachedChecks();
    const stale = platforms
      .filter((p) => p.oauth_configured)
      .filter((p) => !cached[p.platform_key] || isStale(cached[p.platform_key]));

    if (stale.length === 0) return;

    // Run stale checks sequentially (avoid hammering APIs)
    let i = 0;
    const runNext = async () => {
      if (i >= stale.length) return;
      const p = stale[i++];
      try {
        const r = await apiFetch(`/api/social-accounts/verify-config?platform=${p.platform_key}`);
        if (r.ok) {
          const result: CheckResult = await r.json();
          setChecks((prev) => {
            const next = { ...prev, [p.platform_key]: result };
            saveCachedChecks(next);
            return next;
          });
        }
      } catch { /* non-fatal */ }
      setTimeout(runNext, 1200); // 1.2s between checks
    };
    setTimeout(runNext, 2000); // start after page settles
  }, [platforms]);

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

  const handleConnect = async (p: PlatformStatus) => {
    if (!p.auth_path) return;
    const params = new URLSearchParams({ returnTo: '/social-platforms' });
    if (selectedCompanyId) params.set('companyId', selectedCompanyId);
    try {
      const { supabase: sbClient } = await import('../utils/supabaseClient');
      const { data } = await sbClient.auth.getSession();
      if (data.session?.user?.id) params.set('userId', data.session.user.id);
    } catch { /* non-fatal */ }
    window.open(`${p.auth_path}?${params.toString()}`, '_blank', 'noopener,noreferrer');
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

  const handleCheck = async (p: PlatformStatus) => {
    setChecking(p.platform_key);
    try {
      const r = await apiFetch(`/api/social-accounts/verify-config?platform=${p.platform_key}`);
      if (r.ok) {
        const result: CheckResult = await r.json();
        setChecks((prev) => {
          const next = { ...prev, [p.platform_key]: result };
          saveCachedChecks(next);
          return next;
        });
        if (!result.credentials_ok) {
          notify('error', `${p.platform_label}: OAuth credentials not configured.`);
        } else if (result.token_ok === false) {
          notify('error', `${p.platform_label}: ${result.token_detail || 'Token invalid — reconnect.'}`);
        } else if (result.token_ok === true) {
          notify('success', `${p.platform_label}: Configuration OK — token is valid.`);
        } else {
          notify('success', `${p.platform_label}: Credentials configured. Connect an account to verify token.`);
        }
      }
    } catch (e) {
      notify('error', `Check failed for ${p.platform_label}`);
    } finally {
      setChecking(null);
    }
  };

  const getCheckBadge = (key: string) => {
    const c = checks[key];
    if (!c) return null;
    const age = Math.round((Date.now() - new Date(c.checked_at).getTime()) / 60000);
    const ageLabel = age < 1 ? 'just now' : age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;

    if (!c.credentials_ok) return (
      <span className="inline-flex items-center gap-1 text-xs text-red-500" title={`Checked ${ageLabel}`}>
        <XCircle className="h-3 w-3" /> Credentials missing
      </span>
    );
    if (c.token_ok === false) return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600" title={c.token_detail || ''}>
        <AlertCircle className="h-3 w-3" /> Token invalid · {ageLabel}
      </span>
    );
    if (c.token_ok === true) return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600" title={`Checked ${ageLabel}`}>
        <CheckCircle2 className="h-3 w-3" /> Verified · {ageLabel}
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400" title={`Checked ${ageLabel}`}>
        <CheckCircle2 className="h-3 w-3" /> Credentials OK · {ageLabel}
      </span>
    );
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
    if (!p.oauth_configured) {
      // Super admins see the setup-required indicator; everyone else sees "Not available"
      return isSuperAdmin ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-500 border border-gray-200">
          <Lock className="h-3 w-3" /> Setup required
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-400 border border-gray-200">
          Not available
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200">
        <AlertCircle className="h-3 w-3" /> Not connected
      </span>
    );
  };

  const renderPlatformCard = (p: PlatformStatus) => {
    const meta = PLATFORM_META[p.platform_key];
    const isChecking = checking === p.platform_key;

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
            {/* Show admin-only helper text only to super admins */}
            {!p.oauth_configured && !p.connected && isSuperAdmin && (
              <div className="mt-0.5 text-xs text-gray-400">
                Add credentials in Super Admin → Platform Config
              </div>
            )}
            {p.oauth_configured && !p.connected && p.auth_path && (
              <div className="mt-0.5 text-xs text-gray-400">Ready to connect</div>
            )}
            {/* Check result badge */}
            {checks[p.platform_key] && (
              <div className="mt-1">{getCheckBadge(p.platform_key)}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Check button — for any configured platform */}
          {p.oauth_configured && (
            <button
              onClick={() => handleCheck(p)}
              disabled={isChecking}
              title="Verify credentials and token"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {isChecking
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : <FlaskConical className="h-3.5 w-3.5" />
              }
              {isChecking ? 'Checking…' : 'Check'}
            </button>
          )}

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
          ) : isSuperAdmin ? (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <Lock className="h-3.5 w-3.5" /> Configure
            </span>
          ) : null}
          {/* Hide button — only for non-connected, non-configured platforms */}
          {!p.connected && !p.oauth_configured && (
            <button
              onClick={() => socialHiders.hide(p.platform_key)}
              title="Hide from my list"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 text-xs font-medium hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderCommunityCard = (p: PlatformStatus, archived = false) => {
    const meta = PLATFORM_META[p.platform_key];
    return (
      <div
        key={p.platform_key}
        className={`bg-white rounded-xl border p-5 flex items-center justify-between gap-4 transition-colors ${
          archived ? 'opacity-60 border-dashed border-gray-200' : p.connected ? 'border-emerald-200' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-4 min-w-0">
          <span className="text-2xl shrink-0">{meta?.icon ?? '🌐'}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">{p.platform_label}</span>
              {archived ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400 border border-gray-200">
                  <Archive className="h-3 w-3" /> Archived
                </span>
              ) : getStatusBadge(p)}
            </div>
            {!archived && p.connected && (
              <div className="mt-0.5 text-xs text-gray-500 truncate">
                {p.account_name || p.username || 'Account connected'}
              </div>
            )}
            {!archived && checks[p.platform_key] && (
              <div className="mt-1">{getCheckBadge(p.platform_key)}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {archived ? (
            <button
              onClick={() => restoreCommunity(p.platform_key)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restore
            </button>
          ) : (
            <>
              {p.oauth_configured && (
                <button
                  onClick={() => handleCheck(p)}
                  disabled={checking === p.platform_key}
                  title="Verify credentials and token"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {checking === p.platform_key
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <FlaskConical className="h-3.5 w-3.5" />}
                  {checking === p.platform_key ? 'Checking…' : 'Check'}
                </button>
              )}
              {p.connected ? (
                <button
                  onClick={() => handleDisconnect(p)}
                  disabled={disconnecting === p.platform_key}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  {disconnecting === p.platform_key ? 'Disconnecting…' : 'Disconnect'}
                </button>
              ) : p.oauth_configured && p.auth_path ? (
                <button
                  onClick={() => handleConnect(p)}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
                >
                  <Link2 className="h-3.5 w-3.5" /> Connect
                </button>
              ) : p.oauth_configured && !p.auth_path ? (
                <span className="text-xs text-gray-400">Coming soon</span>
              ) : isSuperAdmin ? (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <Lock className="h-3.5 w-3.5" /> Configure
                </span>
              ) : null}
              <button
                onClick={() => archiveCommunity(p.platform_key)}
                title="Remove from my profile"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 text-xs font-medium hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const socialPlatforms = platforms.filter((p) => p.category === 'social');
  const communityPlatforms = platforms.filter((p) => p.category === 'community');
  const connectedCount = platforms.filter((p) => p.connected).length;

  // All users see all platforms. oauth_configured controls whether Connect is available.
  const visibleSocial = socialPlatforms;
  const activeCommunity = communityPlatforms.filter((p) => !archivedCommunity.has(p.platform_key));
  const archivedCommunityList = communityPlatforms.filter((p) => archivedCommunity.has(p.platform_key));

  // Catalog API tab data — only active APIs visible to company admin
  const trendApis   = catalogApis.filter((a) => a.is_active && getCatalogApiCategory(a) === 'trend');
  const imageApis   = catalogApis.filter((a) => a.is_active && getCatalogApiCategory(a) === 'image');

  // Social: split by connected / available / hidden
  const connectedSocial   = visibleSocial.filter((p) => p.connected);
  // OAuth-configured platforms are never hidden (they have a connect button the user needs)
  const availableSocial   = visibleSocial.filter((p) => !p.connected && (!hiddenSocial.has(p.platform_key) || p.oauth_configured));
  const hiddenSocialList  = visibleSocial.filter((p) => !p.connected && hiddenSocial.has(p.platform_key) && !p.oauth_configured);

  // Community: split by connected / available / hidden (uses existing archivedCommunity)
  const connectedCommunity  = activeCommunity.filter((p) => p.connected);
  const availableCommunity  = activeCommunity.filter((p) => !p.connected);

  // Trend/Image: selection state from company_api_configs
  const isSelected = (api: any) => companyConfigs.some((c) => c.api_source_id === api.id && c.enabled);

  // Trend: selected (company enabled) → available (not selected, not hidden) → hidden
  const selectedTrendApis   = trendApis.filter((a) => isSelected(a));
  const visibleTrendApis    = trendApis.filter((a) => !isSelected(a) && !hiddenTrend.has(a.name));
  const hiddenTrendList     = trendApis.filter((a) => !isSelected(a) && hiddenTrend.has(a.name));

  // Image: same pattern
  const selectedImageApis   = imageApis.filter((a) => isSelected(a));
  const visibleImageApis    = imageApis.filter((a) => !isSelected(a) && !hiddenImage.has(a.name));
  const hiddenImageList     = imageApis.filter((a) => !isSelected(a) && hiddenImage.has(a.name));

  type TabId = 'social' | 'trend' | 'community' | 'image';
  const ALL_TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: 'social',    label: 'Social',    icon: <Share2 className="h-4 w-4" /> },
    { id: 'trend',     label: 'Trend',     icon: <TrendingUp className="h-4 w-4" /> },
    { id: 'community', label: 'Community', icon: <Users className="h-4 w-4" /> },
    { id: 'image',     label: 'Image',     icon: <ImageIcon className="h-4 w-4" /> },
  ];

  const renderCatalogApiCard = (
    api: any,
    mode: 'selected' | 'available' | 'hidden',
    onHide?: () => void,
    onUnhide?: () => void,
  ) => {
    const selected = mode === 'selected';
    const hidden   = mode === 'hidden';
    const toggling = togglingApiId === api.id;
    return (
      <div key={api.id} className={`rounded-xl border p-5 flex items-center justify-between gap-4 transition-colors ${
        selected ? 'bg-indigo-50 border-indigo-300' : hidden ? 'bg-white border-dashed border-gray-200 opacity-60' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center gap-4 min-w-0">
          <span className="text-2xl shrink-0">{getCatalogIcon(api)}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-semibold ${selected ? 'text-indigo-900' : 'text-gray-900'}`}>{api.name}</span>
              {selected && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 border border-indigo-300">
                  <CheckCircle2 className="h-3 w-3" /> In Use
                </span>
              )}
              {api.health?.last_test_status === 'ok' && !hidden && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
                  <CheckCircle2 className="h-3 w-3" /> Verified
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-gray-400 truncate">{api.base_url}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onUnhide && (
            <button onClick={onUnhide} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors">
              <RotateCcw className="h-3.5 w-3.5" /> Unhide
            </button>
          )}
          {selected && (
            <button onClick={() => toggleApiSelection(api, false)} disabled={toggling} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-50">
              {toggling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
              {toggling ? 'Removing…' : 'Remove'}
            </button>
          )}
          {mode === 'available' && (
            <>
              <button onClick={() => toggleApiSelection(api, true)} disabled={toggling} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
                {toggling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                {toggling ? 'Adding…' : 'Use this'}
              </button>
              {onHide && (
                <button onClick={onHide} title="Hide from my list" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 text-xs font-medium hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <Head><title>Platform Connections</title></Head>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto px-6 py-10">

          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="h-6 w-6 text-indigo-600" />
              <h1 className="text-2xl font-bold text-gray-900">Platform Connections</h1>
            </div>
            <p className="text-gray-500 text-sm">
              Connect your accounts to enable content publishing and community engagement.
            </p>
            {connectedCount > 0 && (
              <div className="mt-3 text-sm">
                <span className="text-emerald-600 font-medium">{connectedCount} connected</span>
                <span className="text-gray-400 ml-2">· Configs auto-checked daily</span>
              </div>
            )}
          </div>

          {notice && (
            <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
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
            <>
              {/* Tab bar — always 4 tabs */}
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex gap-1 mb-6">
                {ALL_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── Social tab ── */}
              {activeTab === 'social' && (
                <div className="space-y-6">
                  {/* Connected = In Use — shown first */}
                  {connectedSocial.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                      <div className="space-y-3">{connectedSocial.map(renderPlatformCard)}</div>
                    </div>
                  )}
                  {/* Available to connect */}
                  {availableSocial.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to connect</p>
                      <div className="space-y-3">{availableSocial.map(renderPlatformCard)}</div>
                    </div>
                  )}
                  {connectedSocial.length === 0 && availableSocial.length === 0 && (
                    <p className="text-sm text-gray-400">No social platforms configured yet.</p>
                  )}
                  {/* Hidden */}
                  {hiddenSocialList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenSocial((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Hidden ({hiddenSocialList.length})</span>
                        {showHiddenSocial ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showHiddenSocial && (
                        <div className="mt-3 space-y-3">
                          {hiddenSocialList.map((p) => (
                            <div key={p.platform_key} className="bg-white rounded-xl border border-dashed border-gray-200 p-5 flex items-center justify-between gap-4 opacity-60">
                              <div className="flex items-center gap-4">
                                <span className="text-2xl">{PLATFORM_META[p.platform_key]?.icon ?? '🌐'}</span>
                                <span className="font-semibold text-gray-700">{p.platform_label}</span>
                              </div>
                              <button onClick={() => socialHiders.unhide(p.platform_key)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors">
                                <RotateCcw className="h-3.5 w-3.5" /> Unhide
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Community tab ── */}
              {activeTab === 'community' && (
                <div className="space-y-6">
                  {connectedCommunity.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                      <div className="space-y-3">{connectedCommunity.map((p) => renderCommunityCard(p, false))}</div>
                    </div>
                  )}
                  {availableCommunity.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to connect</p>
                      <div className="space-y-3">{availableCommunity.map((p) => renderCommunityCard(p, false))}</div>
                    </div>
                  )}
                  {connectedCommunity.length === 0 && availableCommunity.length === 0 && archivedCommunityList.length === 0 && (
                    <p className="text-sm text-gray-400">No community platforms configured yet.</p>
                  )}
                  {archivedCommunityList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenCommunity((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Hidden ({archivedCommunityList.length})</span>
                        {showHiddenCommunity ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showHiddenCommunity && (
                        <div className="mt-3 space-y-3">
                          {archivedCommunityList.map((p) => renderCommunityCard(p, true))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Trend tab ── */}
              {activeTab === 'trend' && (
                <div className="space-y-6">
                  {selectedTrendApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                      <div className="space-y-3">
                        {selectedTrendApis.map((a) => renderCatalogApiCard(a, 'selected'))}
                      </div>
                    </div>
                  )}
                  {visibleTrendApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to use</p>
                      <div className="space-y-3">
                        {visibleTrendApis.map((a) => renderCatalogApiCard(a, 'available', () => trendHiders.hide(a.name)))}
                      </div>
                    </div>
                  )}
                  {selectedTrendApis.length === 0 && visibleTrendApis.length === 0 && !hiddenTrendList.length && (
                    <p className="text-sm text-gray-400">No trend APIs active. Ask your Super Admin to configure them.</p>
                  )}
                  {hiddenTrendList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenTrend((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Hidden ({hiddenTrendList.length})</span>
                        {showHiddenTrend ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showHiddenTrend && (
                        <div className="mt-3 space-y-3">
                          {hiddenTrendList.map((a) => renderCatalogApiCard(a, 'hidden', undefined, () => trendHiders.unhide(a.name)))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Image tab ── */}
              {activeTab === 'image' && (
                <div className="space-y-6">
                  {selectedImageApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                      <div className="space-y-3">
                        {selectedImageApis.map((a) => renderCatalogApiCard(a, 'selected'))}
                      </div>
                    </div>
                  )}
                  {visibleImageApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to use</p>
                      <div className="space-y-3">
                        {visibleImageApis.map((a) => renderCatalogApiCard(a, 'available', () => imageHiders.hide(a.name)))}
                      </div>
                    </div>
                  )}
                  {selectedImageApis.length === 0 && visibleImageApis.length === 0 && !hiddenImageList.length && (
                    <p className="text-sm text-gray-400">No image APIs active. Ask your Super Admin to configure them.</p>
                  )}
                  {hiddenImageList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenImage((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Hidden ({hiddenImageList.length})</span>
                        {showHiddenImage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showHiddenImage && (
                        <div className="mt-3 space-y-3">
                          {hiddenImageList.map((a) => renderCatalogApiCard(a, 'hidden', undefined, () => imageHiders.unhide(a.name)))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            </>
          )}

          <p className="mt-10 text-xs text-gray-400 text-center">
            Connections are per-user. Platform credentials are managed by your Super Admin.
          </p>
        </div>
      </div>
    </>
  );
}
