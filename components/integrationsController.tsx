/** useIntegrationsPageController — ALL state/effects/handlers of the integrations page, verbatim. */
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

export function useIntegrationsPageController() {
  const { selectedCompanyId, userRole } = useCompanyContext();
  const router = useRouter();
  const companyId = selectedCompanyId || '';
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes((userRole || '').toUpperCase());
  const focusParam = typeof router.query.focus === 'string' ? router.query.focus : '';
  const focus: FocusArea = focusParam === 'data' ? 'data' : 'website';

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteDraft, setWebsiteDraft] = useState({ name: '', canonical_url: '' });
  const [websiteSaving, setWebsiteSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResultState | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; integration?: Integration } | null>(null);
  const [gaStatus, setGaStatus] = useState<GoogleAnalyticsStatusResponse | null>(null);
  const [gaLoading, setGaLoading] = useState(false);
  const [gaError, setGaError] = useState<string | null>(null);
  const [gaNotice, setGaNotice] = useState<string | null>(null);
  const [gaConnecting, setGaConnecting] = useState(false);
  const [gaSelectingProperty, setGaSelectingProperty] = useState(false);
  const [gaSyncing, setGaSyncing] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [gscStatus, setGscStatus] = useState<GoogleSearchConsoleStatusResponse | null>(null);
  const [gscError, setGscError] = useState<string | null>(null);
  const [gscNotice, setGscNotice] = useState<string | null>(null);
  const [gscConnecting, setGscConnecting] = useState(false);
  const [gscSelectingProperty, setGscSelectingProperty] = useState(false);
  const [gscSyncing, setGscSyncing] = useState(false);
  const [selectedGscPropertyId, setSelectedGscPropertyId] = useState('');
  const [scriptAssistOpen, setScriptAssistOpen] = useState(false);
  const [scriptAssistLoading, setScriptAssistLoading] = useState(false);
  const [scriptAssistError, setScriptAssistError] = useState<string | null>(null);
  const [scriptAssistResult, setScriptAssistResult] = useState<TrackingAssistResponse | null>(null);
  const [scriptAssistForm, setScriptAssistForm] = useState({ website_url: '', platform: 'wordpress' });
  const [providerCards, setProviderCards] = useState<Array<{
    provider: string;
    label: string;
    enabled: boolean;
    authType: string;
    apiDiscoveryMode: string;
    capabilities: { publish: boolean; update: boolean; delete: boolean; media: boolean; taxonomy: boolean; webhook: boolean; oauth: boolean; localDev: boolean };
    setupHints: string[];
    troubleshootingHints: string[];
    rateLimitNote: string;
    recentPublishAttempts: number;
    recentPublishSuccesses: number;
    recentPublishFailures: number;
    successRate: number;
    recentAuthFailures: number;
    recentErrors: Array<{ at: string; eventName: string; message: string }>;
    health: 'healthy' | 'warning' | 'degraded' | 'unused';
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  }>>([]);
  const [providerCardsLoading, setProviderCardsLoading] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [integrationResponse, websiteResponse] = await Promise.all([
        fetch(`/api/integrations?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' }),
        fetch(`/api/websites?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' }),
      ]);
      const data = await integrationResponse.json();
      const websiteData = await websiteResponse.json();
      if (!integrationResponse.ok) {
        throw new Error(data.error || 'Failed to load integrations');
      }
      if (!websiteResponse.ok) {
        throw new Error(websiteData.error || 'Failed to load websites');
      }
      setIntegrations(data.integrations || []);
      setWebsites(websiteData.websites || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const loadGoogleAnalyticsStatus = useCallback(async () => {
    if (!companyId) {
      setGaStatus(null);
      return;
    }

    setGaLoading(true);
    setGaError(null);
    setGscError(null);
    try {
      const response = await fetchWithAuth(`/api/analytics/status?companyId=${encodeURIComponent(companyId)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load Google Analytics status');
      }
      setGaStatus(data);
      if (data?.property?.id) {
        setSelectedPropertyId(data.property.id);
      } else {
        setSelectedPropertyId('');
      }
      setGscStatus(data?.search_console ?? null);
      if (data?.search_console?.property?.id) {
        setSelectedGscPropertyId(data.search_console.property.id);
      } else {
        setSelectedGscPropertyId('');
      }
    } catch (err: any) {
      setGaError(err?.message || 'Failed to load Google Analytics status');
      setGscError(err?.message || 'Failed to load Search Console status');
    } finally {
      setGaLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
    void loadGoogleAnalyticsStatus();
  }, [load, loadGoogleAnalyticsStatus]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setProviderCardsLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/integrations/diagnostics?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data?.providers) setProviderCards(data.providers);
      } catch { /* silent */ }
      finally { if (!cancelled) setProviderCardsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  useEffect(() => {
    if (!router.isReady) return;
    if (focusParam !== 'website' && focusParam !== 'data') {
      void router.replace('/integrations?focus=website', undefined, { shallow: true });
      return;
    }
    const error = typeof router.query.error === 'string' ? router.query.error : '';
    const gaConnected = typeof router.query.ga4 === 'string' ? router.query.ga4 : '';
    const gscConnected = typeof router.query.gsc === 'string' ? router.query.gsc : '';

    // Map every OAuth callback `error=` code that the server can emit to a
    // human-readable notice. Previously the page only handled `oauth_failed`
    // / `gsc_oauth_failed` / `no_properties_found` /
    // `no_search_console_properties_found`; the three callback gate codes
    // (`unauthorized`, `invalid_oauth_state`, `missing_code`) were silently
    // swallowed, leaving the user staring at a stale "setup required" state
    // with no idea why. The set below is kept in lock-step with the
    // pages/api/analytics/connect/google/callback.ts emitter.
    const isGsc =
      gscConnected === 'connected' || /search_console|gsc/i.test(error);
    const setNotice = (msg: string) => {
      if (isGsc) setGscNotice(msg);
      else setGaNotice(msg);
    };

    if (error === 'oauth_failed') {
      setGaNotice('Failed to connect Google Analytics. Please try again.');
    } else if (error === 'no_properties_found') {
      setGaNotice('No Google Analytics properties found on this account.');
    } else if (error === 'gsc_oauth_failed') {
      setGscNotice('Failed to connect Search Console. Please try again.');
    } else if (error === 'no_search_console_properties_found') {
      setGscNotice('No Search Console properties found on this account.');
    } else if (error === 'unauthorized') {
      setNotice('Your session expired during the OAuth flow. Sign in again, then reconnect.');
    } else if (error === 'invalid_oauth_state') {
      setNotice('OAuth state validation failed (likely a stale session or a redirect that took too long). Sign in fresh on www.omnivyra.com and reconnect.');
    } else if (error === 'missing_code') {
      setNotice('The provider redirected back without an authorization code. Retry the connection.');
    } else if (gaConnected === 'connected') {
      setGaNotice('Google Analytics connected. Select a property to finish setup.');
      void loadGoogleAnalyticsStatus();
    } else if (gscConnected === 'connected') {
      setGscNotice('Search Console connected. Select a property to finish setup.');
      void loadGoogleAnalyticsStatus();
    } else {
      setGaNotice(null);
      setGscNotice(null);
    }
  }, [router.isReady, router.query.error, router.query.ga4, router.query.gsc, loadGoogleAnalyticsStatus]);

  const handleConnectGoogleAnalytics = async () => {
    if (!companyId) return;
    const endpoint = '/api/analytics/connect/google';
    const payload = {
      companyId,
      returnTo: '/integrations?focus=data',
    };
    setGaConnecting(true);
    setGaError(null);
    try {
      if (process.env.NODE_ENV !== 'production') {
        console.group('[integrations][google_analytics][connect]');
        console.info('endpoint', endpoint);
        console.info('payload', payload);
      }
      const response = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (process.env.NODE_ENV !== 'production') {
        console.info('responseStatus', response.status);
        console.info('responseBody', data);
      }
      if (!response.ok || !data?.authorizationUrl) {
        throw new Error(data?.message || 'Failed to connect Google Analytics');
      }
      if (process.env.NODE_ENV !== 'production') {
        console.info('authorizationUrl', data.authorizationUrl);
      }
      window.location.href = data.authorizationUrl;
    } catch (err: any) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('error', err);
      }
      setGaError(err?.message || 'Failed to connect Google Analytics');
      setGaConnecting(false);
    } finally {
      if (process.env.NODE_ENV !== 'production') {
        console.groupEnd();
      }
    }
  };

  const handleConnectSearchConsole = async () => {
    if (!companyId) return;
    const endpoint = '/api/analytics/connect/google';
    const payload = {
      companyId,
      capability: 'google_search_console',
      returnTo: '/integrations?focus=data',
    };
    setGscConnecting(true);
    setGscError(null);
    try {
      if (process.env.NODE_ENV !== 'production') {
        console.group('[integrations][google_search_console][connect]');
        console.info('endpoint', endpoint);
        console.info('payload', payload);
      }
      const response = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (process.env.NODE_ENV !== 'production') {
        console.info('responseStatus', response.status);
        console.info('responseBody', data);
      }
      if (!response.ok || !data?.authorizationUrl) {
        throw new Error(data?.message || 'Failed to connect Search Console');
      }
      if (process.env.NODE_ENV !== 'production') {
        console.info('authorizationUrl', data.authorizationUrl);
      }
      window.location.href = data.authorizationUrl;
    } catch (err: any) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('error', err);
      }
      setGscError(err?.message || 'Failed to connect Search Console');
      setGscConnecting(false);
    } finally {
      if (process.env.NODE_ENV !== 'production') {
        console.groupEnd();
      }
    }
  };

  const handleForceSyncGoogleAnalytics = async () => {
    if (!companyId || gaSyncing) return;
    setGaSyncing(true);
    setGaError(null);
    setGaNotice('Syncing Google Analytics...');

    const requestStart = Date.now();

    try {
      const response = await fetchWithAuth('/api/analytics/force-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 400 && data?.error === 'no_active_property') {
        setGaError('Select a Google Analytics property before syncing.');
        return;
      }
      if (!response.ok && response.status !== 202) {
        throw new Error(data?.error || data?.message || 'Failed to sync Google Analytics');
      }

      if (data?.status === 'synced') {
        const written = typeof data.sessions_written === 'number' ? ` (${data.sessions_written} sessions)` : '';
        setGaNotice(`Sync complete${written}.`);
        await loadGoogleAnalyticsStatus();
        return;
      }

      // status === 'started' — poll /api/analytics/status until last_sync moves
      // past requestStart, or status becomes error, or hard timeout (90s).
      const POLL_TIMEOUT_MS = 90_000;
      const POLL_INTERVAL_MS = 2_500;
      const pollDeadline = Date.now() + POLL_TIMEOUT_MS;

      let lastError: string | null = null;
      while (Date.now() < pollDeadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        try {
          const pollResponse = await fetchWithAuth(
            `/api/analytics/status?companyId=${encodeURIComponent(companyId)}`,
          );
          if (!pollResponse.ok) continue;
          const pollData = await pollResponse.json();

          // Update the card live so the user sees status changes during polling.
          setGaStatus(pollData);

          if (pollData?.status === 'error') {
            lastError = pollData?.message || 'Sync failed';
            break;
          }

          const lastSyncMs = pollData?.last_sync ? new Date(pollData.last_sync).getTime() : 0;
          if (
            lastSyncMs > requestStart &&
            pollData?.status &&
            ['ready', 'low_data', 'waiting_for_data'].includes(pollData.status)
          ) {
            setGaNotice('Sync complete.');
            return;
          }
        } catch {
          // transient — keep polling
        }
      }

      if (lastError) {
        setGaError(lastError);
      } else {
        setGaNotice('Sync still running in the background. Refresh in a few minutes to see results.');
      }
    } catch (err: any) {
      setGaError(err?.message || 'Failed to sync Google Analytics');
    } finally {
      setGaSyncing(false);
    }
  };

  const handleForceSyncSearchConsole = async () => {
    if (!companyId || gscSyncing) return;
    setGscSyncing(true);
    setGscError(null);
    setGscNotice('Syncing Search Console...');
    const requestStart = Date.now();

    try {
      const response = await fetchWithAuth('/api/analytics/force-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, capability: 'google_search_console' }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 400 && data?.error === 'no_active_search_console_property') {
        setGscError('Select a Search Console property before syncing.');
        return;
      }
      if (!response.ok && response.status !== 202) {
        throw new Error(data?.error || data?.message || 'Failed to sync Search Console');
      }

      if (data?.status === 'synced') {
        setGscNotice('Sync complete.');
        await loadGoogleAnalyticsStatus();
        return;
      }

      const POLL_TIMEOUT_MS = 90_000;
      const POLL_INTERVAL_MS = 2_500;
      const pollDeadline = Date.now() + POLL_TIMEOUT_MS;
      let lastError: string | null = null;

      while (Date.now() < pollDeadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        try {
          const pollResponse = await fetchWithAuth(
            `/api/analytics/status?companyId=${encodeURIComponent(companyId)}`,
          );
          if (!pollResponse.ok) continue;
          const pollData = await pollResponse.json();
          const nextGscStatus = pollData?.search_console ?? null;
          setGscStatus(nextGscStatus);

          if (nextGscStatus?.status === 'error') {
            lastError = nextGscStatus?.message || 'Search Console sync failed';
            break;
          }

          const lastSyncMs = nextGscStatus?.last_sync ? new Date(nextGscStatus.last_sync).getTime() : 0;
          if (
            lastSyncMs > requestStart &&
            nextGscStatus?.status &&
            ['ready', 'limited_coverage', 'waiting_for_data'].includes(nextGscStatus.status)
          ) {
            setGscNotice(nextGscStatus.status === 'ready' ? 'Sync complete.' : nextGscStatus.message || 'Search Console data is still building coverage.');
            return;
          }
        } catch {
          // transient - keep polling
        }
      }

      if (lastError) {
        setGscError(lastError);
      } else {
        setGscNotice('Sync still running in the background. Refresh in a few minutes to see results.');
      }
    } catch (err: any) {
      setGscError(err?.message || 'Failed to sync Search Console');
    } finally {
      setGscSyncing(false);
    }
  };

  const handleDisconnectSearchConsole = async () => {
    if (!companyId) return;
    const confirmed = window.confirm('Disconnect Search Console for this company? Existing report data stays stored, but new search syncs will stop until it is reconnected.');
    if (!confirmed) return;

    setGscSyncing(true);
    setGscError(null);
    try {
      const response = await fetchWithAuth('/api/analytics/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, capability: 'google_search_console' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to disconnect Search Console');
      }
      setGscNotice('Search Console disconnected.');
      setSelectedGscPropertyId('');
      // Canonical Setup-changed emit: disconnecting an integration changes Setup
      // state, so notify the single canonical channel (the command center /
      // Setup consumers subscribe) instead of relying on focus recovery.
      emitSetupChanged('integration-removed', { capability: 'google_search_console' });
      await loadGoogleAnalyticsStatus();
    } catch (err: any) {
      setGscError(err?.message || 'Failed to disconnect Search Console');
    } finally {
      setGscSyncing(false);
    }
  };

  const handleSelectGoogleAnalyticsProperty = async () => {
    if (!companyId || !selectedPropertyId) return;
    setGaSelectingProperty(true);
    setGaError(null);
    try {
      const response = await fetchWithAuth('/api/analytics/select-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          propertyId: selectedPropertyId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to connect Google Analytics');
      }
      setGaNotice('Google Analytics property selected.');
      emitSetupChanged('integration-configured', { capability: 'google_analytics' });
      await loadGoogleAnalyticsStatus();
    } catch (err: any) {
      setGaError(err?.message || 'Failed to connect Google Analytics');
    } finally {
      setGaSelectingProperty(false);
    }
  };

  const handleSelectSearchConsoleProperty = async () => {
    if (!companyId || !selectedGscPropertyId) return;
    setGscSelectingProperty(true);
    setGscError(null);
    try {
      const response = await fetchWithAuth('/api/analytics/select-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          propertyId: selectedGscPropertyId,
          capability: 'google_search_console',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to connect Search Console');
      }
      setGscNotice('Search Console property selected.');
      emitSetupChanged('integration-configured', { capability: 'google_search_console' });
      await loadGoogleAnalyticsStatus();
    } catch (err: any) {
      setGscError(err?.message || 'Failed to connect Search Console');
    } finally {
      setGscSelectingProperty(false);
    }
  };

  const handleGenerateTrackingAssist = async () => {
    setScriptAssistLoading(true);
    setScriptAssistError(null);
    setScriptAssistResult(null);
    try {
      const response = await fetch('/api/analytics/tracking-assist', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scriptAssistForm),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to generate tracking help');
      }
      setScriptAssistResult(data);
    } catch (err: any) {
      setScriptAssistError(err?.message || 'Failed to generate tracking help');
    } finally {
      setScriptAssistLoading(false);
    }
  };

  const handleCreateWebsite = async () => {
    if (!companyId || !websiteDraft.name.trim() || !websiteDraft.canonical_url.trim()) return;
    setWebsiteSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/websites', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          name: websiteDraft.name.trim(),
          canonical_url: websiteDraft.canonical_url.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create website');
      setWebsiteDraft({ name: '', canonical_url: '' });
      emitSetupChanged('website-connected');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create website');
    } finally {
      setWebsiteSaving(false);
    }
  };

  const handleSave = async (payload: { type: IntegrationType; name: string; config: Record<string, string>; website_id?: string | null }) => {
    if (modal?.mode === 'create') {
      const response = await fetch('/api/integrations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...payload }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
    } else if (modal?.integration) {
      const response = await fetch(`/api/integrations/${modal.integration.id}?company_id=${encodeURIComponent(companyId)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          name: payload.name,
          config: payload.config,
          website_id: payload.website_id,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
    }

    setModal(null);
    emitSetupChanged('integration-configured', { type: payload.type });
    await load();
  };

  const handleTest = async (id: string, rediscover = false) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const response = await fetch(`/api/integrations/${id}/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, rediscover }),
      });
      const data = await response.json();
      setTestResult({
        id,
        success: data.success,
        message: data.message,
        code: data.code,
        diagnostics: data.diagnostics,
      });
      await load();
    } catch {
      setTestResult({ id, success: false, message: 'Test request failed.' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this integration? This cannot be undone.')) return;
    await fetch(`/api/integrations/${id}?company_id=${encodeURIComponent(companyId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    emitSetupChanged('integration-removed');
    await load();
  };

  const leadIntegrations = integrations.filter((integration) => integration.type === 'lead_webhook');
  const blogIntegrations = integrations.filter((integration) => integration.type === 'wordpress' || integration.type === 'custom_blog_api');
  const primaryWebsite =
    websites.find((website) => !website.canonical_url.includes('.local')) ??
    websites[0] ??
    null;
  const realWebsites = websites.filter((website) => !website.canonical_url.includes('.local'));
  const displayWebsites = realWebsites.length > 0 ? realWebsites : websites;
  const connectedPublishing = blogIntegrations.find((integration) => integration.status === 'connected') ?? null;
  const failedPublishing = blogIntegrations.find((integration) => integration.status === 'failed') ?? null;
  const publishingStatus: WorkflowStatus = connectedPublishing ? 'connected' : failedPublishing ? 'attention' : 'not_started';
  const publishingDetail = connectedPublishing
    ? `Connected through ${TYPE_LABELS[connectedPublishing.type]}${connectedPublishing.config.site_url ? ` at ${connectedPublishing.config.site_url}` : ''}.`
    : failedPublishing
      ? 'A publishing connection exists, but it needs attention before Omnivyra can publish blog content.'
      : 'Connect the CMS that powers your blog. WordPress uses an Application Password; other systems use their own token model.';
  const leadStatus: WorkflowStatus =
    leadIntegrations.some((integration) => integration.status === 'connected')
      ? 'connected'
      : leadIntegrations.some((integration) => integration.status === 'failed')
        ? 'attention'
        : websites.length > 0
          ? 'attention'
          : 'not_started';
  const analyticsStatus: WorkflowStatus =
    gaStatus?.connected || gscStatus?.connected
      ? 'connected'
      : gaStatus?.status === 'error' || gscStatus?.status === 'error'
        ? 'attention'
        : 'not_started';
  const intelligenceStatus: WorkflowStatus =
    publishingStatus === 'connected' && (leadStatus === 'connected' || analyticsStatus === 'connected')
      ? 'connected'
      : publishingStatus !== 'not_started' || leadStatus !== 'not_started' || analyticsStatus !== 'not_started'
        ? 'attention'
        : 'not_started';

  const highlightedIds = useMemo(() => {
    if (focus === 'website') return new Set(['website-publishing', 'lead-capture-forms']);
    if (focus === 'data') return new Set(['crm-pipeline', 'google-analytics', 'google-search-console', 'files-imports']);
    return new Set<string>();
  }, [focus]);

  const categoryCards: CategoryCard[] = [
    {
      id: 'website-publishing',
      focus: 'website',
      title: 'Connect Your Website',
      description: 'Link your site so Omnivyra can publish content to it automatically. We support most website platforms.',
      badge: 'Start here',
      icon: <Globe className="h-5 w-5" />,
      badgeClassName: 'border-blue-200 bg-blue-50 text-blue-700',
      items: ['Works with WordPress, Shopify, Webflow & more', 'Automatic publishing once connected', 'No code for most platforms'],
      actions: [
        { label: 'View connected websites', href: '#website-publishing-section' },
        ...(isAdmin ? [{ label: 'Connect a website', onClick: () => setModal({ mode: 'create', integration: { type: 'wordpress' } as Integration }), tone: 'secondary' as const }] : []),
      ],
    },
    {
      id: 'lead-capture-forms',
      focus: 'website',
      title: 'Capture Leads From Your Site',
      description: 'Collect leads from your website or landing pages and send them wherever your team works.',
      badge: 'Live now',
      icon: <Plug className="h-5 w-5" />,
      badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      items: ['Hosted lead capture pages', 'Embeddable website forms', 'Send leads to your CRM or tools'],
      actions: [
        { label: 'Set up forms', href: '/leads?tab=forms' },
        { label: 'Send leads elsewhere', href: '/leads?tab=connections' },
      ],
    },
    {
      id: 'crm-pipeline',
      focus: 'data',
      title: 'CRM & Pipeline',
      description: 'Bring deal, account, and owner context into the product so growth work can use real pipeline state.',
      badge: 'Planned next',
      icon: <Database className="h-5 w-5" />,
      badgeClassName: 'border-cyan-200 bg-cyan-50 text-cyan-700',
      items: ['CRM account sync', 'Lead and deal stage mapping', 'Owner and revenue context'],
      actions: [],
    },
    {
      id: 'google-analytics',
      focus: 'data',
      title: 'Google Analytics',
      description: 'Connect your Google Analytics account to track traffic, user behavior, and performance insights.',
      badge: 'Live now',
      icon: <BarChart3 className="h-5 w-5" />,
      badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700',
      items: ['Sessions and traffic sources', 'Page views and engagement', 'Conversion events'],
      actions: [],
    },
    {
      id: 'google-search-console',
      focus: 'data',
      title: 'Google Search Console',
      description: 'Connect verified search properties for organic query and landing-page performance.',
      badge: 'Live now',
      icon: <Search className="h-5 w-5" />,
      badgeClassName: 'border-sky-200 bg-sky-50 text-sky-700',
      items: ['Search queries and pages', 'Clicks, impressions, CTR, position', 'Verified property matching'],
      actions: [],
    },
    {
      id: 'files-imports',
      focus: 'data',
      title: 'Files & Imports',
      description: 'Use external files when leads, calling reports, or manual business inputs still live outside APIs.',
      badge: 'Planned next',
      icon: <Files className="h-5 w-5" />,
      badgeClassName: 'border-violet-200 bg-violet-50 text-violet-700',
      items: ['CSV and spreadsheet uploads', 'Calling and outreach reports', 'Email lead lists and manual dumps'],
      actions: [],
    },
  ];

  const visibleCategoryCards = categoryCards.filter((card) => card.focus === focus);
  const showWebsiteFlow = focus === 'website';
  const showDataFlow = focus === 'data';
  const categoryTitle = focus === 'website' ? 'What you can set up' : 'Data & CRM Sources';
  const categoryDescription =
    focus === 'website'
      ? 'Start by connecting your website — publishing, forms, and visitor tracking turn on from there.'
      : 'These are the business data setup cards for CRM, analytics, and imported files.';

  return {
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
  };
}
