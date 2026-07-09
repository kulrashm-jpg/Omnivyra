/** IntegrationsPage — thin composition: controller + verbatim JSX. */
/** Part 4/4 of integrations.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import {
  ArrowRight,
  BarChart3,
  CheckCircle,
  Clock,
  Database,
  Files,
  Globe,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Rss,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import { emitSetupChanged } from '../lib/setup/setupEvents';

import { type IntegrationType, type FocusArea, type TestResultState, type Integration, type Website, type CategoryCard, type GoogleAnalyticsStatusResponse, type GoogleSearchConsoleStatusResponse, type TrackingAssistResponse, TYPE_LABELS, IntegrationModal } from './integrationsSupportA';
import { ConnectionCard, EmptyConnections, CategoryAction, type WorkflowStatus, WebsiteCommandCenter, CmsDiagnosticsPanel } from './integrationsSupportB';
import { GoogleAnalyticsGridCard, GoogleSearchConsoleGridCard, GoogleAnalyticsHelperPanel, GoogleSearchConsoleHelperPanel } from './integrationsSupportC';
import { useIntegrationsPageController } from './integrationsController';

export default function IntegrationsPage() {
  const f = useIntegrationsPageController();
  const {
    analyticsStatus, blogIntegrations, categoryCards, categoryDescription, categoryTitle, companyId,
    connectedPublishing, displayWebsites, error, expandedProvider, failedPublishing, focus, focusParam,
    gaConnecting, gaError, gaLoading, gaNotice, gaSelectingProperty, gaStatus, gaSyncing, gscConnecting,
    gscError, gscNotice, gscSelectingProperty, gscStatus, gscSyncing, handleConnectGoogleAnalytics,
    handleConnectSearchConsole, handleCreateWebsite, handleDelete, handleDisconnectSearchConsole,
    handleForceSyncGoogleAnalytics, handleForceSyncSearchConsole, handleGenerateTrackingAssist, handleSave,
    handleSelectGoogleAnalyticsProperty, handleSelectSearchConsoleProperty, handleTest, highlightedIds,
    integrations, intelligenceStatus, isAdmin, leadIntegrations, leadStatus, load, loadGoogleAnalyticsStatus,
    loading, modal, primaryWebsite, providerCards, providerCardsLoading, publishingDetail, publishingStatus,
    realWebsites, router, scriptAssistError, scriptAssistForm, scriptAssistLoading, scriptAssistOpen,
    scriptAssistResult, selectedCompanyId, selectedGscPropertyId, selectedPropertyId, setError,
    setExpandedProvider, setGaConnecting, setGaError, setGaLoading, setGaNotice, setGaSelectingProperty,
    setGaStatus, setGaSyncing, setGscConnecting, setGscError, setGscNotice, setGscSelectingProperty,
    setGscStatus, setGscSyncing, setIntegrations, setLoading, setModal, setProviderCards,
    setProviderCardsLoading, setScriptAssistError, setScriptAssistForm, setScriptAssistLoading,
    setScriptAssistOpen, setScriptAssistResult, setSelectedGscPropertyId, setSelectedPropertyId, setTestResult,
    setTestingId, setWebsiteDraft, setWebsiteSaving, setWebsites, showDataFlow, showWebsiteFlow, testResult,
    testingId, userRole, visibleCategoryCards, websiteDraft, websiteSaving, websites
  } = f;
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Website Integrations</h1>
            <p className="mt-1 text-sm text-gray-500">
              See what is connected, then choose the path you need: blog publishing, lead capture, analytics, or intelligence.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration })}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 sm:w-auto"
            >
              <Plus className="h-4 w-4" />
              Connect Publishing
            </button>
          )}
        </div>

        {showWebsiteFlow ? (
          <WebsiteCommandCenter
            primaryWebsite={primaryWebsite}
            websitesCount={displayWebsites.length}
            publishingStatus={publishingStatus}
            publishingDetail={publishingDetail}
            leadStatus={leadStatus}
            analyticsStatus={analyticsStatus}
            intelligenceStatus={intelligenceStatus}
            isAdmin={isAdmin}
            onConnectPublishing={() => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration })}
          />
        ) : (
          <section className="mb-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{categoryTitle}</h2>
                <p className="text-sm text-gray-500">{categoryDescription}</p>
              </div>
            </div>

            <div className="grid auto-rows-fr grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {visibleCategoryCards.map((card) => {
                if (card.id === 'google-analytics') {
                  return (
                    <GoogleAnalyticsGridCard
                      key={card.id}
                      isAdmin={isAdmin}
                      gaStatus={gaStatus}
                      gaLoading={gaLoading}
                      gaError={gaError}
                      gaNotice={gaNotice}
                      gaConnecting={gaConnecting}
                      gaSyncing={gaSyncing}
                      onConnect={handleConnectGoogleAnalytics}
                      onForceSync={handleForceSyncGoogleAnalytics}
                    />
                  );
                }
                if (card.id === 'google-search-console') {
                  return (
                    <GoogleSearchConsoleGridCard
                      key={card.id}
                      isAdmin={isAdmin}
                      gscStatus={gscStatus}
                      loading={gaLoading}
                      error={gscError}
                      notice={gscNotice}
                      connecting={gscConnecting}
                      syncing={gscSyncing}
                      onConnect={handleConnectSearchConsole}
                      onForceSync={handleForceSyncSearchConsole}
                      onDisconnect={handleDisconnectSearchConsole}
                    />
                  );
                }
                const isHighlighted = highlightedIds.has(card.id);
                return (
                  <div
                    key={card.id}
                    className={`flex h-full flex-col rounded-2xl border bg-white p-5 shadow-sm ${isHighlighted ? 'border-indigo-300 ring-1 ring-indigo-100 shadow-md' : 'border-gray-200'}`}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${card.badgeClassName}`}>
                        {card.icon}
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${card.badgeClassName}`}>
                        {card.badge}
                      </span>
                    </div>

                    <div className="mb-4">
                      <h3 className="text-base font-semibold text-gray-900">{card.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-gray-600">{card.description}</p>
                    </div>

                    <div className="mb-5 space-y-2">
                      {card.items.map((item) => (
                        <div key={item} className="flex items-start gap-2 text-sm text-gray-600">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-400" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>

                    {card.actions.length > 0 ? (
                      <div className="mt-auto flex flex-wrap gap-2">
                        {card.actions.map((action) => (
                          <CategoryAction key={action.label} action={action} />
                        ))}
                      </div>
                    ) : (
                      <div className="mt-auto rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
                        This source group is intentionally shown as a planned foundation area until a real setup surface exists.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!companyId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Select a company to manage integrations.
          </div>
        )}

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {testResult && (
          <div
            className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
              testResult.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            <div className="flex items-start gap-2">
              {testResult.success ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{testResult.message}</span>
              <button onClick={() => setTestResult(null)} className="ml-auto shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
            {testResult.diagnostics && (
              <CmsDiagnosticsPanel
                report={testResult.diagnostics}
                onRedetect={() => handleTest(testResult.id, true)}
                redetecting={testingId === testResult.id}
              />
            )}
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading integrations...</div>
        ) : (
          <div className="space-y-8">
            {showWebsiteFlow && (
              <>
                <section id="website-foundation-section" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Website registry</h2>
                      <p className="text-xs text-gray-500">Your customer-facing website records. Internal fallback records are hidden once a real site exists.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a href="/website-setup" className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700">Guided setup</a>
                      <code className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">/public/omnivera-tracker.js</code>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {displayWebsites.map((website) => (
                      <div key={website.id} className="rounded-xl border border-gray-200 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{website.name}</p>
                            <p className="mt-1 break-all text-xs text-gray-500">{website.canonical_url}</p>
                          </div>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{website.status}</span>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">Tracking snippet: <code>{`<script src="${origin}/omnivera-tracker.js" data-website-id="${website.id}"></script>`}</code></p>
                      </div>
                    ))}
                  </div>

                  {isAdmin && (
                    <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <input
                        value={websiteDraft.name}
                        onChange={(event) => setWebsiteDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Website name"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <input
                        value={websiteDraft.canonical_url}
                        onChange={(event) => setWebsiteDraft((current) => ({ ...current, canonical_url: event.target.value }))}
                        placeholder="https://example.com"
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        onClick={handleCreateWebsite}
                        disabled={websiteSaving || !websiteDraft.name.trim() || !websiteDraft.canonical_url.trim()}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" />
                        Add Website
                      </button>
                    </div>
                  )}
                </section>

                <section id="website-publishing-section">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Blog publishing connection</h2>
                      <p className="text-xs text-gray-500">The CMS connection Omnivyra uses when publishing blog content.</p>
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration })}
                          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Connect publishing
                        </button>
                        <button
                          onClick={() => setModal({ mode: 'create', integration: { type: 'custom_blog_api' } as Integration })}
                          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Custom publishing
                        </button>
                      </div>
                    )}
                  </div>

                  {blogIntegrations.length === 0 ? (
                    <EmptyConnections
                      title="No website connected yet — connect one to start publishing automatically."
                      actions={
                        isAdmin
                          ? [
                              { label: 'Connect publishing', onClick: () => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration }) },
                              { label: 'Connect custom publishing', onClick: () => setModal({ mode: 'create', integration: { type: 'custom_blog_api' } as Integration }) },
                            ]
                          : []
                      }
                    />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {blogIntegrations.map((integration) => (
                        <ConnectionCard
                          key={integration.id}
                          integration={integration}
                          isAdmin={isAdmin}
                          onEdit={(currentIntegration) => setModal({ mode: 'edit', integration: currentIntegration })}
                          onDelete={handleDelete}
                          onTest={handleTest}
                          testing={testingId === integration.id}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <details id="provider-diagnostics-section" className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Advanced provider diagnostics</h2>
                      <p className="text-xs text-gray-500">Open only when troubleshooting CMS capabilities, auth, or publish failures.</p>
                    </div>
                    <span className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
                      {providerCardsLoading ? 'Loading...' : 'Show diagnostics'}
                    </span>
                  </summary>
                  {providerCards.length > 0 ? (
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {providerCards.map((card) => (
                        <div key={card.provider} className={`rounded-xl border p-3 text-xs ${
                          card.health === 'healthy' ? 'border-emerald-200 bg-emerald-50' :
                          card.health === 'warning' ? 'border-amber-200 bg-amber-50' :
                          card.health === 'degraded' ? 'border-red-200 bg-red-50' :
                          'border-gray-200 bg-gray-50'
                        }`}>
                          <div className="flex items-center justify-between">
                            <strong className="text-sm">{card.label}</strong>
                            <span className="text-[10px] uppercase tracking-wider opacity-70">{card.health}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-gray-600">Auth: <code>{card.authType}</code> · {card.apiDiscoveryMode}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                            {Object.entries(card.capabilities).filter(([, v]) => v).map(([k]) => (
                              <span key={k} className="rounded bg-white/60 px-1.5 py-0.5 font-medium text-gray-700">{k}</span>
                            ))}
                          </div>
                          {card.recentPublishAttempts > 0 ? (
                            <p className="mt-1.5 text-[11px]">
                              7d publishes: <strong>{card.recentPublishSuccesses}</strong>/<strong>{card.recentPublishAttempts}</strong> ({(card.successRate * 100).toFixed(0)}%)
                              {card.recentAuthFailures > 0 && <span className="ml-1 rounded bg-red-100 px-1 text-red-700">{card.recentAuthFailures} auth fail</span>}
                            </p>
                          ) : (
                            <p className="mt-1.5 text-[11px] text-gray-500">No publishes in 7d.</p>
                          )}
                          <button
                            type="button"
                            onClick={() => setExpandedProvider((p) => p === card.provider ? null : card.provider)}
                            className="mt-1.5 text-[11px] font-medium text-indigo-700 underline"
                          >
                            {expandedProvider === card.provider ? 'Hide tips' : 'Show setup + troubleshooting'}
                          </button>
                          {expandedProvider === card.provider && (
                            <div className="mt-1.5 space-y-1.5 rounded bg-white p-2 text-[11px] text-gray-700">
                              {card.setupHints.length > 0 && (
                                <div>
                                  <p className="font-semibold text-gray-800">Setup hints</p>
                                  <ul className="ml-3 list-disc">
                                    {card.setupHints.map((h, i) => <li key={i}>{h}</li>)}
                                  </ul>
                                </div>
                              )}
                              {card.troubleshootingHints.length > 0 && (
                                <div>
                                  <p className="font-semibold text-gray-800">Troubleshooting</p>
                                  <ul className="ml-3 list-disc">
                                    {card.troubleshootingHints.map((h, i) => <li key={i}>{h}</li>)}
                                  </ul>
                                </div>
                              )}
                              <p className="text-gray-500">Rate limits: {card.rateLimitNote}</p>
                              {card.recentErrors.length > 0 && (
                                <div>
                                  <p className="font-semibold text-gray-800">Recent errors</p>
                                  <ul className="ml-3 list-disc">
                                    {card.recentErrors.map((e, i) => (
                                      <li key={i}><span className="text-gray-500">{new Date(e.at).toLocaleString()}</span> · {e.message}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : !providerCardsLoading && (
                    <p className="mt-4 text-xs text-gray-500">No provider data yet.</p>
                  )}
                </details>

                <section id="lead-capture-section" className="space-y-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">Forms &amp; Leads</h2>
                      <p className="text-xs text-gray-500">Collect leads from your site and choose where they should go.</p>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => setModal({ mode: 'create', integration: { type: 'lead_webhook' } as Integration })}
                        className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Send leads to a tool
                      </button>
                    )}
                  </div>

                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-emerald-950">Forms, hosted pages, and embed code already live in Lead Capture</h3>
                        <p className="mt-1 text-sm text-emerald-800">
                          Use the Lead Capture workspace for website forms, hosted links, HTML downloads, and embed snippets. Webhooks below handle where those submissions go next.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a href="/leads?tab=forms" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800">
                          Open forms
                          <ArrowRight className="h-4 w-4" />
                        </a>
                        <a href="/leads?tab=connections" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
                          Open webhooks
                        </a>
                      </div>
                    </div>
                  </div>

                  {leadIntegrations.length === 0 ? (
                    <EmptyConnections
                      title="No lead capture webhooks yet."
                      actions={isAdmin ? [{ label: 'Add Webhook', onClick: () => setModal({ mode: 'create', integration: { type: 'lead_webhook' } as Integration }) }] : []}
                    />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {leadIntegrations.map((integration) => (
                        <ConnectionCard
                          key={integration.id}
                          integration={integration}
                          isAdmin={isAdmin}
                          onEdit={(currentIntegration) => setModal({ mode: 'edit', integration: currentIntegration })}
                          onDelete={handleDelete}
                          onTest={handleTest}
                          testing={testingId === integration.id}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {showDataFlow && (
              <div className="space-y-3">
                <GoogleAnalyticsHelperPanel
                  gaStatus={gaStatus}
                  gaSelectingProperty={gaSelectingProperty}
                  selectedPropertyId={selectedPropertyId}
                  scriptAssistOpen={scriptAssistOpen}
                  scriptAssistLoading={scriptAssistLoading}
                  scriptAssistError={scriptAssistError}
                  scriptAssistForm={scriptAssistForm}
                  scriptAssistResult={scriptAssistResult}
                  onSelectedPropertyChange={setSelectedPropertyId}
                  onSelectProperty={handleSelectGoogleAnalyticsProperty}
                  onToggleScriptAssist={() => setScriptAssistOpen((current) => !current)}
                  onScriptAssistInput={(key, value) => setScriptAssistForm((current) => ({ ...current, [key]: value }))}
                  onGenerateScriptAssist={handleGenerateTrackingAssist}
                />
                <GoogleSearchConsoleHelperPanel
                  gscStatus={gscStatus}
                  selecting={gscSelectingProperty}
                  selectedPropertyId={selectedGscPropertyId}
                  onSelectedPropertyChange={setSelectedGscPropertyId}
                  onSelectProperty={handleSelectSearchConsoleProperty}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {modal && (
        <IntegrationModal
          mode={modal.mode}
          initial={modal.integration}
          websites={websites}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

