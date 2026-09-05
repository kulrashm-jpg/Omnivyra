import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useCompanyContext } from './CompanyContext';
import { apiFetch } from '../lib/apiFetch';
import LeadSourcesPanel from './prospects/LeadSourcesPanel';
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
const ARCHIVED_COMMUNITY_KEY     = 'archived_community_platforms';
const HIDDEN_SOCIAL_KEY          = 'hidden_social_platforms';
const HIDDEN_TREND_KEY           = 'hidden_trend_apis';
const HIDDEN_IMAGE_KEY           = 'hidden_image_apis';
const HIDDEN_COMMUNITY_API_KEY   = 'hidden_community_apis';

const PLATFORM_META: Record<string, { icon: string; color: string }> = {
  linkedin:      { icon: '🔵', color: 'border-blue-200 bg-blue-50' },
  twitter:       { icon: '𝕏', color: 'border-gray-200 bg-gray-50' },
  x:             { icon: '𝕏', color: 'border-gray-200 bg-gray-50' },
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

import type { useSocialPlatforms } from '../hooks/useSocialPlatforms';
type S = ReturnType<typeof useSocialPlatforms>;
export default function SocialPlatformsView({ d }: { d: S }) {
  const {
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
    connectedWriter,
    availableWriter,
    hiddenWriterList,
    connectedCreator,
    availableCreator,
    hiddenCreatorList,
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
  } = d;

    return (
    <>
      <Head><title>API Connections</title></Head>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">

          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="h-6 w-6 text-indigo-600 shrink-0" />
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">API Connections</h1>
            </div>
            <p className="text-gray-500 text-sm">
              Connect social platforms and manage trend, community &amp; image APIs in one place.
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
              {/* Tab bar */}
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex gap-1 overflow-x-auto mb-6 scrollbar-hide">
                {ALL_TABS.map((tab) => (
                  <React.Fragment key={tab.id}>
                    {tab.dividerBefore && <span className="self-stretch w-px bg-gray-200 mx-1" />}
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                      activeTab === tab.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                  </React.Fragment>
                ))}
              </div>

              {/* ── Social tab ── */}
              {activeTab === 'social' && (
                <div className="space-y-8">
                  {/* ── Writer Content ── text-first platforms (no image/video required) */}
                  <section className="space-y-6">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Writer Content</h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Text-first platforms used for AI-automated writer-content publishing — no image or video required.
                      </p>
                    </div>
                    {connectedWriter.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                        <div className="space-y-3">{connectedWriter.map(renderPlatformCard)}</div>
                      </div>
                    )}
                    {availableWriter.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to connect</p>
                        <div className="space-y-3">{availableWriter.map(renderPlatformCard)}</div>
                      </div>
                    )}
                    {connectedWriter.length === 0 && availableWriter.length === 0 && (
                      <p className="text-sm text-gray-400">No writer-content platforms configured yet.</p>
                    )}
                    {hiddenWriterList.length > 0 && (
                      <div>
                        <button onClick={() => setShowHiddenSocial((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                          <Archive className="h-4 w-4" />
                          <span className="font-medium">Hidden ({hiddenWriterList.length})</span>
                          {showHiddenSocial ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {showHiddenSocial && (
                          <div className="mt-3 space-y-3">
                            {hiddenWriterList.map((p) => (
                              <div key={p.platform_key} className="bg-white rounded-xl border border-dashed border-gray-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 opacity-60">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="text-2xl shrink-0">{PLATFORM_META[p.platform_key]?.icon ?? '🌐'}</span>
                                  <span className="font-semibold text-gray-700 truncate">{p.platform_label}</span>
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
                  </section>

                  {/* ── Creator Content ── platforms that require image or video */}
                  <section className="space-y-6 pt-2 border-t border-gray-200">
                    <div className="pt-6">
                      <h2 className="text-sm font-semibold text-gray-900">Creator Content</h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Platforms that require an image or video — used by the creator-content workflow, not the AI-automated writer flow.
                      </p>
                    </div>
                    {connectedCreator.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                        <div className="space-y-3">{connectedCreator.map(renderPlatformCard)}</div>
                      </div>
                    )}
                    {availableCreator.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to connect</p>
                        <div className="space-y-3">{availableCreator.map(renderPlatformCard)}</div>
                      </div>
                    )}
                    {connectedCreator.length === 0 && availableCreator.length === 0 && hiddenCreatorList.length === 0 && (
                      <p className="text-sm text-gray-400">No creator-content platforms configured yet.</p>
                    )}
                    {hiddenCreatorList.length > 0 && (
                      <div className="mt-3 space-y-3">
                        {hiddenCreatorList.map((p) => (
                          <div key={p.platform_key} className="bg-white rounded-xl border border-dashed border-gray-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 opacity-60">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-2xl shrink-0">{PLATFORM_META[p.platform_key]?.icon ?? '🌐'}</span>
                              <span className="font-semibold text-gray-700 truncate">{p.platform_label}</span>
                            </div>
                            <button onClick={() => socialHiders.unhide(p.platform_key)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors">
                              <RotateCcw className="h-3.5 w-3.5" /> Unhide
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* ── Community tab ── */}
              {activeTab === 'community' && (
                <div className="space-y-6">
                  {/* Connected OAuth accounts (In Use) */}
                  {connectedCommunityOAuth.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">Connected Accounts</p>
                      <div className="space-y-3">{connectedCommunityOAuth.map((p) => renderCommunityCard(p, false))}</div>
                    </div>
                  )}

                  {/* Catalog API Sources — In Use */}
                  {selectedCommunityApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">In Use</p>
                      <div className="space-y-3">
                        {selectedCommunityApis.map((a) => renderCatalogApiCard(a, 'selected'))}
                      </div>
                    </div>
                  )}

                  {/* OAuth platforms with a connect flow (rare, future) */}
                  {connectableCommunity.filter((p) => !p.connected).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — connect account</p>
                      <div className="space-y-3">
                        {connectableCommunity.filter((p) => !p.connected).map((p) => renderCommunityCard(p, false))}
                      </div>
                    </div>
                  )}

                  {/* Catalog API Sources — Available to select */}
                  {visibleCommunityApis.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Available — choose which to use</p>
                      <div className="space-y-3">
                        {visibleCommunityApis.map((a) => renderCatalogApiCard(a, 'available', () => communityApiHiders.hide(a.name)))}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {connectedCommunityOAuth.length === 0 && selectedCommunityApis.length === 0 && visibleCommunityApis.length === 0 && hiddenCommunityApiList.length === 0 && archivedCommunityList.length === 0 && (
                    <p className="text-sm text-gray-400">No community APIs active. Ask your Super Admin to configure them.</p>
                  )}

                  {/* Hidden catalog APIs */}
                  {hiddenCommunityApiList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenCommunityApi((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Hidden ({hiddenCommunityApiList.length})</span>
                        {showHiddenCommunityApi ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {showHiddenCommunityApi && (
                        <div className="mt-3 space-y-3">
                          {hiddenCommunityApiList.map((a) => renderCatalogApiCard(a, 'hidden', undefined, () => communityApiHiders.unhide(a.name)))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Archived OAuth community cards (restore) */}
                  {archivedCommunityList.length > 0 && (
                    <div>
                      <button onClick={() => setShowHiddenCommunity((v) => !v)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">
                        <Archive className="h-4 w-4" />
                        <span className="font-medium">Archived accounts ({archivedCommunityList.length})</span>
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

              {/* ── Lead Sources tab (A3R) ──
                  Self-contained: it reads and writes ONLY the A3P credential
                  API, so nothing in this view's existing state or fetch cycle
                  is shared with it and no existing tab can be affected. */}
              {activeTab === 'lead-sources' && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                  <h2 className="text-base font-semibold text-gray-900 mb-1">Lead Sources</h2>
                  <p className="text-sm text-gray-500 mb-5">
                    Connect the prospect-data providers this company has its own account with.
                    Each key is stored encrypted against this company alone.
                  </p>
                  <LeadSourcesPanel companyId={selectedCompanyId ?? null} />
                </div>
              )}

              {/* ── Request New API tab ── */}
              {activeTab === 'request-new' && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                  <h2 className="text-base font-semibold text-gray-900 mb-1">Request a New API</h2>
                  <p className="text-sm text-gray-500 mb-5">
                    Submit a request to add a new external API. Super Admin will review and approve or reject.
                  </p>
                  <div className="space-y-4 max-w-2xl">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        placeholder="e.g. Twitter Trends API"
                        value={requestForm.name}
                        onChange={(e) => setRequestForm((p) => ({ ...p, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Base URL *</label>
                      <input
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        placeholder="https://api.example.com/v1/trends"
                        value={requestForm.base_url}
                        onChange={(e) => setRequestForm((p) => ({ ...p, base_url: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Purpose</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          value={requestForm.purpose}
                          onChange={(e) => setRequestForm((p) => ({ ...p, purpose: e.target.value }))}
                        >
                          <option value="trends">Trends</option>
                          <option value="keywords">Keywords</option>
                          <option value="hashtags">Hashtags</option>
                          <option value="news">News</option>
                          <option value="demographics">Demographics</option>
                          <option value="social">Social</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                        <input
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          placeholder="e.g. social, analytics"
                          value={requestForm.category}
                          onChange={(e) => setRequestForm((p) => ({ ...p, category: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          value={requestForm.method}
                          onChange={(e) => setRequestForm((p) => ({ ...p, method: e.target.value as 'GET' | 'POST' }))}
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Auth type</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          value={requestForm.auth_type}
                          onChange={(e) => setRequestForm((p) => ({ ...p, auth_type: e.target.value }))}
                        >
                          <option value="none">None</option>
                          <option value="api_key">API Key</option>
                          <option value="bearer">Bearer</option>
                          <option value="query">Query param</option>
                          <option value="header">Header</option>
                        </select>
                      </div>
                    </div>
                    {['api_key', 'bearer', 'query', 'header'].includes(requestForm.auth_type) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">API key env var name *</label>
                        <input
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          placeholder="e.g. TWITTER_API_KEY"
                          value={requestForm.api_key_env_name}
                          onChange={(e) => setRequestForm((p) => ({ ...p, api_key_env_name: e.target.value }))}
                        />
                        <p className="text-xs text-gray-500 mt-1">Server-side env var; key value is not stored.</p>
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                      <textarea
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px]"
                        placeholder="Why your company needs this API, use case, etc."
                        value={requestForm.description}
                        onChange={(e) => setRequestForm((p) => ({ ...p, description: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={submitApiRequest}
                        disabled={isSubmittingApiRequest || !requestForm.name.trim() || !requestForm.base_url.trim()}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full sm:w-auto"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {isSubmittingApiRequest ? 'Submitting…' : 'Submit for approval'}
                      </button>
                      <span className="text-xs text-gray-400">Goes to API Queue for Super Admin review.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── API Queue tab ── */}
              {activeTab === 'queue' && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <h2 className="text-base font-semibold text-gray-900">API Requests Queue</h2>
                    <button
                      onClick={loadApiRequests}
                      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isLoadingApiRequests ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                  {isLoadingApiRequests ? (
                    <p className="text-sm text-gray-400">Loading requests…</p>
                  ) : apiRequests.length === 0 ? (
                    <div className="text-center py-10">
                      <ClipboardList className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No API requests yet.</p>
                      <button
                        onClick={() => setActiveTab('request-new')}
                        className="mt-3 inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
                      >
                        <PlusCircle className="h-4 w-4" /> Submit a request
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {apiRequests.map((req) => (
                        <div key={req.id} className="border border-gray-200 rounded-lg p-3 sm:p-4">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-medium text-gray-900 text-sm">{req.name}</div>
                                <div className="text-xs text-gray-500 truncate">{req.base_url}</div>
                                <div className="mt-1 flex items-center gap-2 flex-wrap">
                                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                    req.status === 'approved' ? 'bg-green-100 text-green-700'
                                    : req.status === 'rejected' ? 'bg-red-100 text-red-700'
                                    : 'bg-amber-100 text-amber-700'
                                  }`}>{req.status}</span>
                                  {req.purpose && <span className="text-xs text-gray-400">Purpose: {req.purpose}</span>}
                                  {req.category && <span className="text-xs text-gray-400">Category: {req.category}</span>}
                                  <span className="text-xs text-gray-400">{new Date(req.created_at).toLocaleDateString()}</span>
                                </div>
                                {req.status === 'rejected' && req.rejection_reason && (
                                  <div className="mt-1 text-xs text-red-600">Reason: {req.rejection_reason}</div>
                                )}
                              </div>
                            </div>
                            {req.status === 'pending' && isSuperAdmin && (
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  className="border border-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
                                  placeholder="Rejection reason"
                                  value={apiRejectionReasons[req.id] || ''}
                                  onChange={(e) => setApiRejectionReasons((prev) => ({ ...prev, [req.id]: e.target.value }))}
                                />
                                <button
                                  onClick={() => updateApiRequestStatus(req.id, 'approved')}
                                  className="text-xs text-green-700 hover:text-green-800 font-medium"
                                >Approve</button>
                                <button
                                  onClick={() => updateApiRequestStatus(req.id, 'rejected')}
                                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                                >Reject</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
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

