import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  getIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  testIntegration,
  getGAStatus,
  pollGAStatus,
  connectGoogleAnalytics,
  forceSyncGA,
  selectGAProperty,
  trackingAssist,
} from '@/features/integrations/data/integrations.api';
import type {
  Integration,
  IntegrationType,
  GoogleAnalyticsStatusResponse,
  TrackingAssistResponse,
} from '@/features/integrations/types';

type ModalState = { mode: 'create' | 'edit'; integration?: Integration } | null;

type CreatePayload = { type: IntegrationType; name: string; config: Record<string, string> };
type UpdatePayload = { name: string; config: Record<string, string> };

export function useIntegrations() {
  const { selectedCompanyId } = useCompanyContext();
  const router = useRouter();
  const companyId = selectedCompanyId || '';
  const focusParam = typeof router.query.focus === 'string' ? router.query.focus : '';

  // ── State ────────────────────────────────────────────────────────────────
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [gaStatus, setGaStatus] = useState<GoogleAnalyticsStatusResponse | null>(null);
  const [gaLoading, setGaLoading] = useState(false);
  const [gaError, setGaError] = useState<string | null>(null);
  const [gaNotice, setGaNotice] = useState<string | null>(null);
  const [gaConnecting, setGaConnecting] = useState(false);
  const [gaSelectingProperty, setGaSelectingProperty] = useState(false);
  const [gaSyncing, setGaSyncing] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [scriptAssistOpen, setScriptAssistOpen] = useState(false);
  const [scriptAssistLoading, setScriptAssistLoading] = useState(false);
  const [scriptAssistError, setScriptAssistError] = useState<string | null>(null);
  const [scriptAssistResult, setScriptAssistResult] = useState<TrackingAssistResponse | null>(null);
  const [scriptAssistForm, setScriptAssistForm] = useState({ website_url: '', platform: 'wordpress' });

  // ── Derived state ────────────────────────────────────────────────────────
  const leadIntegrations = useMemo(
    () => integrations.filter((integration) => integration.type === 'lead_webhook'),
    [integrations],
  );
  const blogIntegrations = useMemo(
    () => integrations.filter((integration) => integration.type === 'wordpress' || integration.type === 'custom_blog_api'),
    [integrations],
  );

  // ── Loaders ──────────────────────────────────────────────────────────────
  const loadIntegrations = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await getIntegrations(companyId);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load');
      }
      setIntegrations(data.integrations || []);
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
    try {
      const response = await getGAStatus(companyId);
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
    } catch (err: any) {
      setGaError(err?.message || 'Failed to load Google Analytics status');
    } finally {
      setGaLoading(false);
    }
  }, [companyId]);

  // ── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => {
    void loadIntegrations();
    void loadGoogleAnalyticsStatus();
  }, [loadIntegrations, loadGoogleAnalyticsStatus]);

  useEffect(() => {
    if (!router.isReady) return;
    if (focusParam !== 'website' && focusParam !== 'data') {
      void router.replace('/integrations?focus=website', undefined, { shallow: true });
      return;
    }
    const errorParam = typeof router.query.error === 'string' ? router.query.error : '';
    const gaConnected = typeof router.query.ga4 === 'string' ? router.query.ga4 : '';

    if (errorParam === 'oauth_failed') {
      setGaNotice('Failed to connect Google Analytics');
    } else if (errorParam === 'no_properties_found') {
      setGaNotice('No GA properties found');
    } else if (gaConnected === 'connected') {
      setGaNotice('Google Analytics connected. Select a property to finish setup.');
      void loadGoogleAnalyticsStatus();
    } else {
      setGaNotice(null);
    }
  }, [router, router.isReady, router.query.error, router.query.ga4, focusParam, loadGoogleAnalyticsStatus]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleGAConnect = useCallback(async () => {
    if (!companyId) return;
    setGaConnecting(true);
    setGaError(null);
    try {
      const response = await connectGoogleAnalytics(companyId, '/integrations?focus=data');
      const data = await response.json();
      if (!response.ok || !data?.authorizationUrl) {
        throw new Error(data?.message || 'Failed to connect Google Analytics');
      }
      window.location.href = data.authorizationUrl;
    } catch (err: any) {
      setGaError(err?.message || 'Failed to connect Google Analytics');
      setGaConnecting(false);
    }
  }, [companyId]);

  const handleGASync = useCallback(async () => {
    if (!companyId || gaSyncing) return;
    setGaSyncing(true);
    setGaError(null);
    setGaNotice('Syncing Google Analytics...');

    const requestStart = Date.now();

    try {
      const response = await forceSyncGA(companyId);
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

      const POLL_TIMEOUT_MS = 90_000;
      const POLL_INTERVAL_MS = 2_500;
      const pollDeadline = Date.now() + POLL_TIMEOUT_MS;

      let lastError: string | null = null;
      while (Date.now() < pollDeadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        try {
          const pollResponse = await pollGAStatus(companyId);
          if (!pollResponse.ok) continue;
          const pollData = await pollResponse.json();

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
  }, [companyId, gaSyncing, loadGoogleAnalyticsStatus]);

  const handleGAPropertySelect = useCallback(async () => {
    if (!companyId || !selectedPropertyId) return;
    setGaSelectingProperty(true);
    setGaError(null);
    try {
      const response = await selectGAProperty(companyId, selectedPropertyId);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to connect Google Analytics');
      }
      setGaNotice('Google Analytics property selected.');
      await loadGoogleAnalyticsStatus();
    } catch (err: any) {
      setGaError(err?.message || 'Failed to connect Google Analytics');
    } finally {
      setGaSelectingProperty(false);
    }
  }, [companyId, selectedPropertyId, loadGoogleAnalyticsStatus]);

  const handleTrackingAssist = useCallback(async () => {
    setScriptAssistLoading(true);
    setScriptAssistError(null);
    setScriptAssistResult(null);
    try {
      const response = await trackingAssist(scriptAssistForm);
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
  }, [scriptAssistForm]);

  const handleCreateIntegration = useCallback(async (payload: CreatePayload) => {
    const response = await createIntegration({ company_id: companyId, ...payload });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error);
    }
    setModal(null);
    await loadIntegrations();
  }, [companyId, loadIntegrations]);

  const handleUpdateIntegration = useCallback(async (id: string, payload: UpdatePayload) => {
    const response = await updateIntegration(id, companyId, { company_id: companyId, ...payload });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error);
    }
    setModal(null);
    await loadIntegrations();
  }, [companyId, loadIntegrations]);

  const handleTestIntegration = useCallback(async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const response = await testIntegration(id, companyId);
      const data = await response.json();
      setTestResult({ id, success: data.success, message: data.message });
      await loadIntegrations();
    } catch {
      setTestResult({ id, success: false, message: 'Test request failed.' });
    } finally {
      setTestingId(null);
    }
  }, [companyId, loadIntegrations]);

  const handleDeleteIntegration = useCallback(async (id: string) => {
    if (!confirm('Delete this integration? This cannot be undone.')) return;
    await deleteIntegration(id, companyId);
    await loadIntegrations();
  }, [companyId, loadIntegrations]);

  const openModal = useCallback((m: NonNullable<ModalState>) => {
    setModal(m);
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
  }, []);

  const dismissTestResult = useCallback(() => {
    setTestResult(null);
  }, []);

  return {
    state: {
      integrations,
      loading,
      error,
      testingId,
      testResult,
      modal,
      gaStatus,
      gaLoading,
      gaError,
      gaNotice,
      gaConnecting,
      gaSelectingProperty,
      gaSyncing,
      selectedPropertyId,
      scriptAssistOpen,
      scriptAssistLoading,
      scriptAssistError,
      scriptAssistResult,
      scriptAssistForm,
      leadIntegrations,
      blogIntegrations,
    },
    actions: {
      loadIntegrations,
      handleCreateIntegration,
      handleUpdateIntegration,
      handleDeleteIntegration,
      handleTestIntegration,
      handleGAConnect,
      handleGASync,
      handleGAPropertySelect,
      handleTrackingAssist,
      openModal,
      closeModal,
      dismissTestResult,
      // Direct setters for view-bound inputs (form fields, toggles)
      setSelectedPropertyId,
      setScriptAssistOpen,
      setScriptAssistForm,
    },
  };
}
