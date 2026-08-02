import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import useSWR from 'swr';
import { useCompanyContext } from '../components/CompanyContext';
import Header from '../components/Header';
import { apiFetch } from '../lib/apiFetch';
import { emitSetupChanged } from '../lib/setup/setupEvents';
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
  PlusCircle,
  Send,
  ClipboardList,
  Settings2,
  ChevronRight,
} from 'lucide-react';

interface PlatformStatus {
  platform_key: string;
  platform_label: string;
  auth_path: string | null;
  category: 'social' | 'community';
  oauth_configured: boolean;
  available?: boolean;
  connected: boolean;
  connection_status?: 'connected' | 'disconnected' | 'not_connected';
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
const ARCHIVED_COMMUNITY_KEY     = 'archived_community_platforms';
const HIDDEN_SOCIAL_KEY          = 'hidden_social_platforms';
const HIDDEN_TREND_KEY           = 'hidden_trend_apis';
const HIDDEN_IMAGE_KEY           = 'hidden_image_apis';
const HIDDEN_COMMUNITY_API_KEY   = 'hidden_community_apis';

const PLATFORM_META: Record<string, { icon: string; color: string }> = {
  linkedin:      { icon: '🔵', color: 'border-blue-200 bg-blue-50' },
  x:             { icon: '𝕏', color: 'border-gray-200 bg-gray-50' },
  youtube:       { icon: '▶️', color: 'border-red-200 bg-red-50' },
  threads:       { icon: '@', color: 'border-gray-200 bg-gray-50' },
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


export function useSocialPlatforms() {
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
  const [hiddenCommunityApi, setHiddenCommunityApi] = useState<Set<string>>(new Set());
  const [showHiddenSocial, setShowHiddenSocial] = useState(false);
  const [showHiddenCommunity, setShowHiddenCommunity] = useState(false);
  const [showHiddenTrend, setShowHiddenTrend] = useState(false);
  const [showHiddenImage, setShowHiddenImage] = useState(false);
  const [showHiddenCommunityApi, setShowHiddenCommunityApi] = useState(false);
  const [activeTab, setActiveTab] = useState<'social' | 'trend' | 'community' | 'image' | 'request-new' | 'queue'>('social');
  const [catalogApis, setCatalogApis] = useState<any[]>([]);
  const [loadingCatalogApis, setLoadingCatalogApis] = useState(false);
  const [companyConfigs, setCompanyConfigs] = useState<any[]>([]);
  const [togglingApiId, setTogglingApiId] = useState<string | null>(null);
  // Content type prefs
  const [platformContentPrefs, setPlatformContentPrefs] = useState<Record<string, string[]>>({});
  const [savingContentPrefs, setSavingContentPrefs] = useState(false);
  const [expandedContentTypes, setExpandedContentTypes] = useState<Set<string>>(new Set());
  const [customTypeInputs, setCustomTypeInputs] = useState<Record<string, string>>({});
  // API request state (Request New / Queue tabs)
  const [apiRequests, setApiRequests] = useState<Array<{ id: string; name: string; base_url: string; status: string; created_at: string; purpose?: string | null; category?: string | null; auth_type?: string | null; api_key_env_name?: string | null; rejection_reason?: string | null }>>([]);
  const [isLoadingApiRequests, setIsLoadingApiRequests] = useState(false);
  const [apiRejectionReasons, setApiRejectionReasons] = useState<Record<string, string>>({});
  const [requestForm, setRequestForm] = useState({ name: '', base_url: '', purpose: 'trends', category: '', method: 'GET' as 'GET' | 'POST', auth_type: 'none', api_key_env_name: '', description: '' });
  const [isSubmittingApiRequest, setIsSubmittingApiRequest] = useState(false);

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
      // Fire-and-forget: refresh any expiring connector tokens for this org so the
      // first action after login doesn't hit an expired token. Backend is idempotent.
      if (selectedCompanyId) {
        apiFetch('/api/social-accounts/refresh-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: selectedCompanyId }),
        }).catch(() => { /* non-fatal */ });
      }
    } catch (e) {
      console.error('Failed to load social accounts', e);
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  // ── OPT-005 Phase 2C: cache-safe GETs (catalog metadata, content-type
  // prefs, API requests) are SWR entries keyed on the exact request URLs.
  // The existing state variables (and their exported setters) are preserved
  // and fed from the shared cache, so the hook's public API is unchanged.
  // Company config, social-account status and token-refresh stay raw.
  const catalogKey = selectedCompanyId ? `/api/external-apis?companyId=${selectedCompanyId}&catalog=1` : null;
  const contentPrefsKey = selectedCompanyId ? `/api/social-platforms/content-type-prefs?companyId=${selectedCompanyId}` : null;
  const apiRequestsKey = selectedCompanyId ? `/api/external-apis/requests?companyId=${selectedCompanyId}` : null;

  const { data: catalogData, isLoading: catalogIsLoading, mutate: mutateCatalog } =
    useSWR<{ apis?: any[] }>(catalogKey);
  const { data: contentPrefsData, mutate: mutateContentPrefs } =
    useSWR<{ prefs?: Record<string, string[]> }>(contentPrefsKey);
  const { data: apiRequestsData, isLoading: apiRequestsIsLoading, mutate: mutateApiRequests } =
    useSWR<{ requests?: any[] }>(apiRequestsKey);

  useEffect(() => { if (catalogData) setCatalogApis(catalogData.apis || []); }, [catalogData]);
  useEffect(() => { if (contentPrefsData) setPlatformContentPrefs(contentPrefsData.prefs || {}); }, [contentPrefsData]);
  useEffect(() => { if (apiRequestsData) setApiRequests(apiRequestsData.requests || []); }, [apiRequestsData]);
  // Loading flags map to SWR isLoading (first uncached load / company change);
  // manual reloads and focus revalidations are silent background refreshes.
  useEffect(() => { setLoadingCatalogApis(catalogIsLoading); }, [catalogIsLoading]);
  useEffect(() => { setIsLoadingApiRequests(apiRequestsIsLoading); }, [apiRequestsIsLoading]);

  const loadCatalogApis = useCallback(async () => {
    if (!selectedCompanyId) return;
    await mutateCatalog();
  }, [selectedCompanyId, mutateCatalog]);

  const loadCompanyConfigs = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const r = await apiFetch(`/api/external-apis/company-config?companyId=${selectedCompanyId}`);
      if (r.ok) { const d = await r.json(); setCompanyConfigs(d.configs || []); }
    } catch { /* non-fatal */ }
  }, [selectedCompanyId]);

  // ── Content type per platform ──────────────────────────────────────────────

  /** All content types available for each social platform. */
  const CONTENT_TYPES_PER_PLATFORM: Record<string, string[]> = {
    linkedin:      ['post', 'article', 'blog', 'carousel', 'video', 'poll', 'newsletter'],
    instagram:     ['post', 'reel', 'story', 'carousel'],
    facebook:      ['post', 'video', 'story', 'carousel', 'blog'],
    x:             ['post', 'thread', 'poll'],
    threads:       ['post', 'thread'],
    youtube:       ['video', 'short'],
    tiktok:        ['video', 'short'],
    reddit:        ['post', 'thread'],
    whatsapp:      ['post'],
    pinterest:     ['post', 'idea_pin'],
    github:        ['post', 'article'],
    medium:        ['post', 'article', 'blog', 'newsletter'],
    devto:         ['post', 'article', 'blog'],
    blog:          ['post', 'article', 'blog'],
  };

  const loadContentPrefs = useCallback(async () => {
    if (!selectedCompanyId) return;
    await mutateContentPrefs();
  }, [selectedCompanyId, mutateContentPrefs]);

  const saveContentPrefs = async (prefs: Record<string, string[]>) => {
    if (!selectedCompanyId) return;
    setSavingContentPrefs(true);
    try {
      await apiFetch(`/api/social-platforms/content-type-prefs?companyId=${selectedCompanyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs }),
      });
      // Same post-PUT local update as before, written through the shared
      // cache entry (revalidate:false — the server was just told).
      setPlatformContentPrefs(prefs);
      await mutateContentPrefs(() => ({ prefs }), { revalidate: false });
    } catch { /* non-fatal */ }
    finally { setSavingContentPrefs(false); }
  };

  /** Add a type to a platform's active list (built-in re-add or new custom). */
  const addContentType = (platformKey: string, type: string) => {
    const normalized = type.trim().toLowerCase().replace(/\s+/g, '_');
    if (!normalized) return;
    const current = platformContentPrefs[platformKey] ?? (CONTENT_TYPES_PER_PLATFORM[platformKey] ?? []);
    if (current.includes(normalized)) return;
    saveContentPrefs({ ...platformContentPrefs, [platformKey]: [...current, normalized] });
  };

  /** Remove a type from a platform's active list (any type, built-in or custom). */
  const removeContentType = (platformKey: string, type: string) => {
    const current = platformContentPrefs[platformKey] ?? (CONTENT_TYPES_PER_PLATFORM[platformKey] ?? []);
    saveContentPrefs({ ...platformContentPrefs, [platformKey]: current.filter((t) => t !== type) });
  };

  /** Add a new custom type from the text input and clear the input. */
  const addCustomContentType = (platformKey: string) => {
    const raw = (customTypeInputs[platformKey] ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!raw) return;
    addContentType(platformKey, raw);
    setCustomTypeInputs((p) => ({ ...p, [platformKey]: '' }));
  };

  const toggleExpandContentTypes = (platformKey: string) => {
    setExpandedContentTypes((prev) => {
      const next = new Set(prev);
      if (next.has(platformKey)) next.delete(platformKey); else next.add(platformKey);
      return next;
    });
  };

  // ── API Request / Queue ─────────────────────────────────────────────────────

  const loadApiRequests = useCallback(async () => {
    if (!selectedCompanyId) return;
    await mutateApiRequests();
  }, [selectedCompanyId, mutateApiRequests]);

  const submitApiRequest = async () => {
    if (!selectedCompanyId || !requestForm.name.trim() || !requestForm.base_url.trim()) return;
    setIsSubmittingApiRequest(true);
    try {
      const r = await apiFetch(`/api/external-apis/requests?companyId=${selectedCompanyId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestForm }),
      });
      if (r.ok) {
        setRequestForm({ name: '', base_url: '', purpose: 'trends', category: '', method: 'GET', auth_type: 'none', api_key_env_name: '', description: '' });
        notify('success', 'API request submitted for review.');
        await loadApiRequests();
        setActiveTab('queue');
      } else {
        const e = await r.json().catch(() => ({}));
        notify('error', e.error || 'Failed to submit request');
      }
    } catch { notify('error', 'Failed to submit request'); }
    finally { setIsSubmittingApiRequest(false); }
  };

  const updateApiRequestStatus = async (id: string, status: 'approved' | 'rejected') => {
    const rejection_reason = status === 'rejected' ? (apiRejectionReasons[id] || '') : undefined;
    try {
      const r = await apiFetch('/api/external-apis/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, rejection_reason }),
      });
      if (r.ok) {
        notify('success', `Request ${status}.`);
        // Write the status change through the shared cache entry
        // (revalidate:false — the server was just told).
        await mutateApiRequests(
          (current) => ({
            requests: (current?.requests ?? apiRequests).map((req: any) =>
              req.id === id
                ? { ...req, status, ...(status === 'rejected' ? { rejection_reason } : {}) }
                : req
            ),
          }),
          { revalidate: false }
        );
      } else {
        const e = await r.json().catch(() => ({}));
        notify('error', e.error || 'Failed to update request');
      }
    } catch { notify('error', 'Failed to update request'); }
  };

  const toggleApiSelection = async (api: any, enable: boolean) => {
    if (!selectedCompanyId) return;
    setTogglingApiId(api.id);
    try {
      const r = await apiFetch(`/api/external-apis/company-config?companyId=${selectedCompanyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_source_id: api.id, enabled: enable }),
      });
      if (r.ok) {
        await loadCompanyConfigs();
        // Canonical Setup event — external-API integration configured / removed.
        emitSetupChanged(enable ? 'integration-configured' : 'integration-removed', { api_source_id: api.id });
        emitSetupChanged('api-key-updated', { api_source_id: api.id });
      }
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
    setHiddenCommunityApi(load(HIDDEN_COMMUNITY_API_KEY));
  }, []);

  const makeHideHandlers = (storageKey: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => ({
    hide: (id: string) => setter((prev) => { const next = new Set(prev).add(id); try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /**/ } return next; }),
    unhide: (id: string) => setter((prev) => { const next = new Set(prev); next.delete(id); try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /**/ } return next; }),
  });

  const socialHiders        = makeHideHandlers(HIDDEN_SOCIAL_KEY, setHiddenSocial);
  const communityHiders     = makeHideHandlers(ARCHIVED_COMMUNITY_KEY, setArchivedCommunity);
  const communityApiHiders  = makeHideHandlers(HIDDEN_COMMUNITY_API_KEY, setHiddenCommunityApi);
  const trendHiders         = makeHideHandlers(HIDDEN_TREND_KEY, setHiddenTrend);
  const imageHiders         = makeHideHandlers(HIDDEN_IMAGE_KEY, setHiddenImage);

  // Keep old names for backward compat with community card render
  const archiveCommunity = communityHiders.hide;
  const restoreCommunity = communityHiders.unhide;

  // Load cached checks on mount and auto-check stale entries
  useEffect(() => {
    const cached = loadCachedChecks();
    setChecks(cached);
  }, []);

  // Each loader has its own try/catch internally, but if any synchronous
  // throw escapes (extremely rare, e.g. setState on an unmounted hook), the
  // unhandled rejection lights up the Next.js dev overlay. .catch() on the
  // useEffect invocation closes that gap — production behaviour unchanged.
  useEffect(() => { loadStatus().catch(() => {}); }, [loadStatus]);
  useEffect(() => { loadCompanyConfigs().catch(() => {}); }, [loadCompanyConfigs]);
  // OPT-005 Phase 2C: catalog / content-prefs / api-requests now fetch via
  // their SWR entries on mount — their old mount effects are gone.

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

  // Handle OAuth callback redirect (same-tab legacy + community-ai connector flow)
  useEffect(() => {
    const { connected, success, status, error } = router.query;
    const succeeded = success === 'true' || status === 'success';
    if (connected && succeeded) {
      const platformKey = String(connected);
      // Evict the stale check verdict for this platform — the previous "Token
      // invalid" was captured before the reconnect minted a fresh token. Both
      // the in-memory map and the localStorage cache must be cleared, otherwise
      // the badge keeps showing the old result until the 24h TTL expires.
      setChecks((prev) => {
        const next = { ...prev };
        delete next[platformKey];
        try {
          const raw = localStorage.getItem(CACHE_KEY);
          if (raw) {
            const cached = JSON.parse(raw) as Record<string, CheckResult>;
            delete cached[platformKey];
            localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
          }
        } catch { /* ignore */ }
        return next;
      });
      notify('success', `${platformKey} account connected successfully!`);
      loadStatus();
      emitSetupChanged('social-connected', { platform: platformKey });
      router.replace('/social-platforms', undefined, { shallow: true });
    } else if (error) {
      notify('error', `Connection failed: ${decodeURIComponent(String(error))}`);
      router.replace('/social-platforms', undefined, { shallow: true });
    }
  }, [router.query]);

  // Refresh when a connector OAuth completes in a popup tab
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'omnivyra_connector_connected') {
        loadStatus();
        const platform = e.newValue?.split(':')[0] || 'account';
        notify('success', `${platform} connected successfully!`);
        emitSetupChanged('social-connected', { platform });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [loadStatus]);

  const handleConnect = async (p: PlatformStatus) => {
    const params = new URLSearchParams({ returnTo: '/social-platforms' });
    try {
      const { getSupabaseBrowser } = await import('../lib/supabaseBrowser');
      const { data } = await getSupabaseBrowser().auth.getSession();
      if (data.session?.user?.id) params.set('userId', data.session.user.id);
    } catch { /* non-fatal */ }

    // Route through community-ai connectors so one OAuth connect writes to both
    // social_accounts (publishing) and community_ai_platform_tokens (engagement).
    // YouTube does not have a community-ai connector route yet, so it must keep
    // using the legacy OAuth flow with explicit company context.
    const connectorPlatforms = new Set(['linkedin', 'x', 'facebook', 'instagram', 'reddit', 'youtube']);
    if (selectedCompanyId && connectorPlatforms.has(p.platform_key)) {
      const connectorKey = p.platform_key;
      const connectorParams = new URLSearchParams({
        tenant_id: selectedCompanyId,
        organization_id: selectedCompanyId,
        redirect: '/social-platforms',
      });
      window.location.href = `/api/community-ai/connectors/${connectorKey}/auth?${connectorParams.toString()}`;
      return;
    }

    if (!p.auth_path) return;

    if (selectedCompanyId) {
      params.set('companyId', selectedCompanyId);
    }
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
        emitSetupChanged('social-disconnected', { platform: p.platform_key });
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
    const isThreads = p.platform_key === 'threads';
    if (p.connected && p.expired) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <Clock className="h-3 w-3" /> Token Expired
      </span>
    );
    if (p.connected) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="h-3 w-3" /> {p.platform_key === 'threads' ? 'Enabled' : 'Connected'}
      </span>
    );
    if (isThreads && p.connection_status === 'disconnected') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <AlertCircle className="h-3 w-3" /> Disconnected
        </span>
      );
    }
    if (!p.oauth_configured && !isThreads) {
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
    const isThreads = p.platform_key === 'threads';
    const oauthConfigured = p.oauth_configured || isThreads;
    const authPath = isThreads ? '/api/auth/instagram' : p.auth_path;
    const meta = PLATFORM_META[p.platform_key];
    const isChecking = checking === p.platform_key;
    const builtinTypes = CONTENT_TYPES_PER_PLATFORM[p.platform_key] ?? ['post'];
    const savedPrefs = platformContentPrefs[p.platform_key];
    // Active = what's saved (or all built-ins by default)
    const activeTypes = savedPrefs ?? builtinTypes;
    const activeSet = new Set<string>(activeTypes);
    // Custom types = active types that aren't in the built-in list
    const customExtras = activeTypes.filter((t) => !builtinTypes.includes(t));
    // Removed built-ins = built-ins not currently active (available to re-add)
    const removedBuiltins = builtinTypes.filter((t) => !activeSet.has(t));
    const isExpanded = expandedContentTypes.has(p.platform_key);

    return (
      <div
        key={p.platform_key}
        className={`bg-white rounded-xl border transition-colors ${
          p.connected ? 'border-emerald-200' : 'border-gray-200'
        }`}
      >
        {/* Main row */}
        <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
              {!oauthConfigured && !p.connected && isSuperAdmin && (
                <div className="mt-0.5 text-xs text-gray-400">
                  Add credentials in Super Admin → Platform Config
                </div>
              )}
              {oauthConfigured && !p.connected && authPath && (
                <div className="mt-0.5 text-xs text-gray-400">
                  {isThreads && p.connection_status === 'disconnected' ? 'Ready to reconnect' : 'Ready to connect'}
                  {(p.platform_key === 'facebook' || p.platform_key === 'instagram' || p.platform_key === 'whatsapp' || isThreads) && (
                    <span className="ml-1 italic text-amber-600">
                      {isThreads
                        ? '- connect Instagram to enable Threads'
                        : '- connects Facebook, Instagram & WhatsApp in one Meta consent'}
                    </span>
                  )}
                </div>
              )}
              {checks[p.platform_key] && (
                <div className="mt-1">{getCheckBadge(p.platform_key)}</div>
              )}
              {/* Content type summary — active types */}
              <div className="mt-1 flex items-center gap-1 flex-wrap">
                {activeTypes.map((t) => (
                  <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    customExtras.includes(t)
                      ? 'bg-violet-50 border-violet-200 text-violet-700'
                      : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  }`}>{t}</span>
                ))}
                {removedBuiltins.length > 0 && (
                  <span className="text-[10px] text-gray-400">+{removedBuiltins.length} hidden</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Content type config button */}
            <button
              onClick={() => toggleExpandContentTypes(p.platform_key)}
              title="Configure content types for AI planning"
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                isExpanded
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Content Types
              <ChevronRight className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </button>

            {oauthConfigured && (
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
                {p.expired && authPath && (
                  <button
                    onClick={() => handleConnect({ ...p, auth_path: authPath, oauth_configured: oauthConfigured })}
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
            ) : oauthConfigured && authPath ? (
              <button
                onClick={() => handleConnect({ ...p, auth_path: authPath, oauth_configured: oauthConfigured })}
                title={
                  p.platform_key === 'facebook' || p.platform_key === 'instagram' || p.platform_key === 'whatsapp'
                    ? 'Meta requires one consent for Facebook, Instagram, and WhatsApp — all three will be connected together.'
                    : isThreads
                      ? 'Connect Instagram to enable Threads.'
                    : `Connect ${p.platform_label}`
                }
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
              >
                <Link2 className="h-3.5 w-3.5" /> {
                  isThreads && p.connection_status === 'disconnected'
                    ? 'Reconnect'
                    : isThreads
                      ? 'Connect Instagram (enables Threads)'
                      : 'Connect'
                }
              </button>
            ) : oauthConfigured && !authPath ? (
              <span className="text-xs text-gray-400">Coming soon</span>
            ) : isSuperAdmin ? (
              <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                <Lock className="h-3.5 w-3.5" /> Configure
              </span>
            ) : null}
            {!p.connected && !oauthConfigured && (
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

        {/* Content type configuration panel */}
        {isExpanded && (
          <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 rounded-b-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <p className="text-xs font-semibold text-gray-700">Content Types for AI Planning</p>
              <p className="text-xs text-gray-400">Used in BOLT, weekly plan, daily plan &amp; AI chat</p>
            </div>

            {/* Active types — removable tags */}
            <div>
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">Active</p>
              <div className="flex flex-wrap gap-2 min-h-[32px]">
                {activeTypes.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No types active — AI planning will use system defaults</p>
                )}
                {activeTypes.map((type) => (
                  <span
                    key={type}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium ${
                      customExtras.includes(type)
                        ? 'bg-violet-100 text-violet-800 border border-violet-200'
                        : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                    }`}
                  >
                    {type}
                    <button
                      onClick={() => removeContentType(p.platform_key, type)}
                      disabled={savingContentPrefs}
                      title={`Remove ${type}`}
                      className="ml-0.5 opacity-60 hover:opacity-100 hover:text-red-600 transition-colors disabled:cursor-not-allowed"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Removed built-ins — click to re-add */}
            {removedBuiltins.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">Removed — click to re-add</p>
                <div className="flex flex-wrap gap-2">
                  {removedBuiltins.map((type) => (
                    <button
                      key={type}
                      onClick={() => addContentType(p.platform_key, type)}
                      disabled={savingContentPrefs}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm text-gray-500 bg-white border border-dashed border-gray-300 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                    >
                      <PlusCircle className="h-3 w-3" /> {type}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Add new custom type */}
            <div>
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">Add custom type</p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="e.g. infographic, case_study, whitepaper"
                  value={customTypeInputs[p.platform_key] ?? ''}
                  onChange={(e) => setCustomTypeInputs((prev) => ({ ...prev, [p.platform_key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomContentType(p.platform_key); } }}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 bg-white"
                />
                <button
                  onClick={() => addCustomContentType(p.platform_key)}
                  disabled={!(customTypeInputs[p.platform_key] ?? '').trim() || savingContentPrefs}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >
                  <PlusCircle className="h-3.5 w-3.5" /> Add
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-1 border-t border-gray-200">
              {savingContentPrefs && <p className="text-xs text-gray-400">Saving…</p>}
              {savedPrefs && (
                <button
                  onClick={() => {
                    const newPrefs = { ...platformContentPrefs };
                    delete newPrefs[p.platform_key];
                    saveContentPrefs(newPrefs);
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline ml-auto"
                >
                  Reset to defaults
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCommunityCard = (p: PlatformStatus, archived = false) => {
    const meta = PLATFORM_META[p.platform_key];
    return (
      <div
        key={p.platform_key}
        className={`bg-white rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-colors ${
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
        <div className="flex flex-wrap items-center gap-2">
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
  // Catalog API tab data — only active APIs visible to company admin
  const trendApis        = catalogApis.filter((a) => a.is_active && getCatalogApiCategory(a) === 'trend');
  const imageApis        = catalogApis.filter((a) => a.is_active && getCatalogApiCategory(a) === 'image');
  const communityApiList = catalogApis.filter((a) => a.is_active && getCatalogApiCategory(a) === 'community');

  // Writer vs Creator split is inclusive — a platform can appear in both buckets:
  //   Writer  = supports text-only publishing (post can be sent without image/video).
  //   Creator = accepts image/video content (whether or not text-only is also supported).
  // LinkedIn / X / Facebook / Reddit / Threads accept both, so they show in both sections.
  // Instagram / YouTube / TikTok / Pinterest only accept image/video → Creator only.
  // WhatsApp is text-only in our pipeline → Writer only.
  const WRITER_PLATFORM_KEYS  = new Set(['linkedin', 'x', 'facebook', 'reddit', 'threads', 'whatsapp']);
  const CREATOR_PLATFORM_KEYS = new Set(['linkedin', 'x', 'facebook', 'reddit', 'threads', 'instagram', 'youtube', 'tiktok', 'pinterest']);

  const writerSocial  = visibleSocial.filter((p) => WRITER_PLATFORM_KEYS.has(p.platform_key));
  const creatorSocial = visibleSocial.filter((p) => CREATOR_PLATFORM_KEYS.has(p.platform_key));

  // Social: split by connected / available / hidden — separately for writer & creator buckets.
  // OAuth-configured platforms are never hidden (they have a connect button the user needs).
  const partition = (list: typeof visibleSocial) => ({
    connected: list.filter((p) => p.connected),
    available: list.filter((p) => !p.connected && (!hiddenSocial.has(p.platform_key) || p.oauth_configured || p.platform_key === 'threads')),
    hidden:    list.filter((p) => !p.connected && hiddenSocial.has(p.platform_key) && !p.oauth_configured && p.platform_key !== 'threads'),
  });
  const writerParts  = partition(writerSocial);
  const creatorParts = partition(creatorSocial);

  // Backward-compat aliases (combined writer+creator) so existing callers keep working.
  // Computed from visibleSocial directly so platforms that appear in both buckets
  // (e.g. LinkedIn) aren't double-counted.
  const allParts = partition(visibleSocial);
  const connectedSocial  = allParts.connected;
  const availableSocial  = allParts.available;
  const hiddenSocialList = allParts.hidden;

  const connectedWriter   = writerParts.connected;
  const availableWriter   = writerParts.available;
  const hiddenWriterList  = writerParts.hidden;
  const connectedCreator  = creatorParts.connected;
  const availableCreator  = creatorParts.available;
  const hiddenCreatorList = creatorParts.hidden;

  // Community OAuth — kept for backward compat with renderCommunityCard (archived restore)

  // Trend/Image: selection state from company_api_configs
  const isSelected = (api: any) => companyConfigs.some((c) => c.api_source_id === api.id && c.enabled);

  // Trend: selected (company enabled) → available (not selected, not hidden) → hidden
  const selectedTrendApis   = trendApis.filter((a) => isSelected(a));
  const visibleTrendApis    = trendApis.filter((a) => !isSelected(a) && !hiddenTrend.has(a.name));
  const hiddenTrendList     = trendApis.filter((a) => !isSelected(a) && hiddenTrend.has(a.name));

  // Image: same pattern
  const selectedImageApis     = imageApis.filter((a) => isSelected(a));
  const visibleImageApis      = imageApis.filter((a) => !isSelected(a) && !hiddenImage.has(a.name));
  const hiddenImageList       = imageApis.filter((a) => !isSelected(a) && hiddenImage.has(a.name));

  // Community catalog APIs: same selection pattern
  const selectedCommunityApis = communityApiList.filter((a) => isSelected(a));
  const visibleCommunityApis  = communityApiList.filter((a) => !isSelected(a) && !hiddenCommunityApi.has(a.name));
  const hiddenCommunityApiList = communityApiList.filter((a) => !isSelected(a) && hiddenCommunityApi.has(a.name));

  // Community OAuth platforms: only those actually connected or that have a connect path
  const connectableCommunity  = communityPlatforms.filter((p) => p.oauth_configured && p.auth_path);
  const connectedCommunityOAuth = communityPlatforms.filter((p) => p.connected);
  const archivedCommunityList = communityPlatforms.filter((p) => archivedCommunity.has(p.platform_key));

  type TabId = 'social' | 'trend' | 'community' | 'image' | 'request-new' | 'queue';
  const ALL_TABS: Array<{ id: TabId; label: string; icon: React.ReactNode; dividerBefore?: boolean }> = [
    { id: 'social',       label: 'Social',       icon: <Share2 className="h-4 w-4" /> },
    { id: 'trend',        label: 'Trend',        icon: <TrendingUp className="h-4 w-4" /> },
    { id: 'community',    label: 'Community',    icon: <Users className="h-4 w-4" /> },
    { id: 'image',        label: 'Image',        icon: <ImageIcon className="h-4 w-4" /> },
    { id: 'request-new',  label: 'Request API',  icon: <PlusCircle className="h-4 w-4" />, dividerBefore: true },
    { id: 'queue',        label: 'API Queue',    icon: <ClipboardList className="h-4 w-4" /> },
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
      <div key={api.id} className={`rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-colors ${
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
        <div className="flex flex-wrap items-center gap-2">
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


  return {
    ALL_TABS,
    CONTENT_TYPES_PER_PLATFORM,
    activeTab,
    addContentType,
    addCustomContentType,
    apiRejectionReasons,
    apiRequests,
    archiveCommunity,
    archivedCommunity,
    archivedCommunityList,
    availableSocial,
    catalogApis,
    checking,
    checks,
    communityApiHiders,
    communityApiList,
    communityHiders,
    communityPlatforms,
    companyConfigs,
    connectableCommunity,
    connectedCommunityOAuth,
    connectedCount,
    connectedSocial,
    connectedWriter,
    availableWriter,
    hiddenWriterList,
    connectedCreator,
    availableCreator,
    hiddenCreatorList,
    customTypeInputs,
    disconnecting,
    expandedContentTypes,
    getCheckBadge,
    getStatusBadge,
    handleCheck,
    handleConnect,
    handleDisconnect,
    hiddenCommunityApi,
    hiddenCommunityApiList,
    hiddenImage,
    hiddenImageList,
    hiddenSocial,
    hiddenSocialList,
    hiddenTrend,
    hiddenTrendList,
    imageApis,
    imageHiders,
    isLoadingApiRequests,
    isSelected,
    isSubmittingApiRequest,
    isSuperAdmin,
    loadApiRequests,
    loadCatalogApis,
    loadCompanyConfigs,
    loadContentPrefs,
    loadStatus,
    loading,
    loadingCatalogApis,
    makeHideHandlers,
    notice,
    notify,
    platformContentPrefs,
    platforms,
    removeContentType,
    renderCatalogApiCard,
    renderCommunityCard,
    renderPlatformCard,
    requestForm,
    restoreCommunity,
    router,
    saveContentPrefs,
    savingContentPrefs,
    selectedCommunityApis,
    selectedCompanyId,
    selectedImageApis,
    selectedTrendApis,
    setActiveTab,
    setApiRejectionReasons,
    setApiRequests,
    setArchivedCommunity,
    setCatalogApis,
    setChecking,
    setChecks,
    setCompanyConfigs,
    setCustomTypeInputs,
    setDisconnecting,
    setExpandedContentTypes,
    setHiddenCommunityApi,
    setHiddenImage,
    setHiddenSocial,
    setHiddenTrend,
    setIsLoadingApiRequests,
    setIsSubmittingApiRequest,
    setLoading,
    setLoadingCatalogApis,
    setNotice,
    setPlatformContentPrefs,
    setPlatforms,
    setRequestForm,
    setSavingContentPrefs,
    setShowHiddenCommunity,
    setShowHiddenCommunityApi,
    setShowHiddenImage,
    setShowHiddenSocial,
    setShowHiddenTrend,
    setTogglingApiId,
    setUserRole,
    showHiddenCommunity,
    showHiddenCommunityApi,
    showHiddenImage,
    showHiddenSocial,
    showHiddenTrend,
    socialHiders,
    socialPlatforms,
    submitApiRequest,
    toggleApiSelection,
    toggleExpandContentTypes,
    togglingApiId,
    trendApis,
    trendHiders,
    updateApiRequestStatus,
    userRole,
    visibleCommunityApis,
    visibleImageApis,
    visibleSocial,
    visibleTrendApis,
  };
}
