/**
 * useBrowserAssist — Phase 35-D-5a + 5b + 5c.
 *
 * Four-hook split because React execution order in InboxDashboard
 * forces these sections to live in different positions:
 *
 *   const browserState = useBrowserAssistState();           // top of component
 *   const browserData = useBrowserAssistData({...});        // after connected-platform memos
 *   // ... runPlatformSyncAndRefresh + syncableBrowserPlatforms derived in component ...
 *   const browserHandlers = useBrowserAssistHandlers(state, deps);  // after data destructure
 *   useBrowserAssistEffects(state, deps);                   // after handlers + runPlatformSyncAndRefresh
 *
 * Order MUST be preserved by the caller. Each hook is byte-equivalent
 * to the inline original — no logic edits, no dep array changes,
 * no renames, no splitting/combining of effects.
 *
 * Phase progression:
 *   - 5a: state + refs container        (useBrowserAssistState)
 *   - 5b: 7 useCallback handlers        (useBrowserAssistHandlers)
 *   - 5c: 4 sub-hook calls + 4 effects  (useBrowserAssistData + useBrowserAssistEffects)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isBrowserAssistRuntimeEnabled } from '@/lib/featureFlags';
import { useEngagementPlatformHealth } from '@/hooks/useEngagementPlatformHealth';
import { useExtensionBridge } from '@/hooks/useExtensionBridge';
import { useEngagementPlatformPreferences } from '@/hooks/useEngagementPlatformPreferences';
import { useLinkedInEngagementWorkspace } from '@/hooks/useLinkedInEngagementWorkspace';
import {
  BACKGROUND_PLATFORM_SYNC_INTERVAL_MS,
  type PlatformSyncTrustState,
} from '@/components/engagement/inbox/helpers';

// =====================================================================
// useBrowserAssistState — Phase 35-D-5a (dumb container)
// =====================================================================

export function useBrowserAssistState() {
  const browserAssistEnabled = isBrowserAssistRuntimeEnabled();

  const [browserAssistError, setBrowserAssistError] = useState<string | null>(null);
  const [browserAssistBusyPlatform, setBrowserAssistBusyPlatform] = useState<string | null>(null);
  const [browserAssistStatusByPlatform, setBrowserAssistStatusByPlatform] = useState<
    Record<string, string | null>
  >({});
  const [browserAssistErrorByPlatform, setBrowserAssistErrorByPlatform] = useState<
    Record<string, string | null>
  >({});
  const [linkedInSurfaceActionBusy, setLinkedInSurfaceActionBusy] = useState<
    'sales_navigator' | 'recruiter' | null
  >(null);
  const [linkedInSurfaceActionStatus, setLinkedInSurfaceActionStatus] = useState<string | null>(null);
  const [platformSyncTrust, setPlatformSyncTrust] = useState<PlatformSyncTrustState>({
    status: 'idle',
    lastSyncedAt: null,
    message: null,
  });

  const attemptedExtensionAuthRef = useRef<string | null>(null);
  const initialPlatformSyncKeyRef = useRef<string | null>(null);
  const lastPlatformSyncAtRef = useRef<number>(0);

  return {
    browserAssistEnabled,

    browserAssistError,
    setBrowserAssistError,
    browserAssistBusyPlatform,
    setBrowserAssistBusyPlatform,
    browserAssistStatusByPlatform,
    setBrowserAssistStatusByPlatform,
    browserAssistErrorByPlatform,
    setBrowserAssistErrorByPlatform,
    linkedInSurfaceActionBusy,
    setLinkedInSurfaceActionBusy,
    linkedInSurfaceActionStatus,
    setLinkedInSurfaceActionStatus,
    platformSyncTrust,
    setPlatformSyncTrust,

    attemptedExtensionAuthRef,
    initialPlatformSyncKeyRef,
    lastPlatformSyncAtRef,
  };
}

export type BrowserAssistState = ReturnType<typeof useBrowserAssistState>;

// =====================================================================
// useBrowserAssistData — Phase 35-D-5c (the 4 sub-hooks)
// =====================================================================
//
// Sub-hooks moved AS-IS from InboxDashboard. Order preserved verbatim:
//   1. useEngagementPlatformHealth
//   2. useExtensionBridge
//   3. useEngagementPlatformPreferences
//   4. useLinkedInEngagementWorkspace
//
// Each return is renamed at the destructure point to match the names
// InboxDashboard already uses, so the component-side destructure is
// identical to before.

export interface UseBrowserAssistDataDeps {
  organizationId: string;
  integrations: Array<{ platform: string }>;
  hasLinkedInConnection: boolean;
}

export function useBrowserAssistData(deps: UseBrowserAssistDataDeps) {
  const { organizationId, integrations, hasLinkedInConnection } = deps;

  // Per-platform health (API / RPA / Extension / Publish adapter + ingress).
  // Renders as a compact strip under the platform tabs so the operator
  // can tell at a glance whether a given platform's selected actions
  // will actually execute. Read-only; no mutation of tokens or sessions.
  const {
    platforms: platformHealth,
    loading: platformHealthLoading,
    refresh: refreshPlatformHealth,
  } = useEngagementPlatformHealth(organizationId);
  const {
    status: extensionStatus,
    auth: extensionAuth,
    loading: extensionLoading,
    error: extensionError,
    refresh: refreshExtension,
    mergedPlatforms,
    updatingPlatform: updatingBrowserPlatform,
    authenticating: extensionAuthenticating,
    setBrowserPlatformEnabled,
    authenticateExtensionViaClaimCode,
    pollExtensionCommandsNow,
    triggerPlatformSync,
    executePlatformAction
  } = useExtensionBridge(integrations.map((integration) => integration.platform));
  const {
    preferenceMap: workspacePreferenceMap,
    loading: workspacePreferencesLoading,
    refresh: refreshWorkspacePreferences,
    updatingPlatform: updatingWorkspacePlatform,
    setPlatformEnabled: setWorkspacePlatformEnabled,
  } = useEngagementPlatformPreferences(organizationId);
  const {
    overview: linkedinOverview,
    loading: linkedinOverviewLoading,
    syncing: linkedinSyncing,
    error: linkedinOverviewError,
    lastSyncResult: linkedinLastSyncResult,
    refresh: refreshLinkedInOverview,
    syncNow: syncLinkedInNow,
  } = useLinkedInEngagementWorkspace(organizationId, hasLinkedInConnection);

  return {
    platformHealth,
    platformHealthLoading,
    refreshPlatformHealth,

    extensionStatus,
    extensionAuth,
    extensionLoading,
    extensionError,
    refreshExtension,
    mergedPlatforms,
    updatingBrowserPlatform,
    extensionAuthenticating,
    setBrowserPlatformEnabled,
    authenticateExtensionViaClaimCode,
    pollExtensionCommandsNow,
    triggerPlatformSync,
    executePlatformAction,

    workspacePreferenceMap,
    workspacePreferencesLoading,
    refreshWorkspacePreferences,
    updatingWorkspacePlatform,
    setWorkspacePlatformEnabled,

    linkedinOverview,
    linkedinOverviewLoading,
    linkedinSyncing,
    linkedinOverviewError,
    linkedinLastSyncResult,
    refreshLinkedInOverview,
    syncLinkedInNow,
  };
}

export type BrowserAssistData = ReturnType<typeof useBrowserAssistData>;

// =====================================================================
// useBrowserAssistHandlers — Phase 35-D-5b (the 7 useCallback handlers)
// =====================================================================

export interface UseBrowserAssistHandlerDeps {
  organizationId: string;

  // From useExtensionBridge
  extensionStatus: { runtimeId?: string | null; version?: string | null } | null | undefined;
  extensionAuth: { isAuthenticated?: boolean | null } | null | undefined;
  extensionError: string | null | undefined;
  authenticateExtensionViaClaimCode: (organizationId: string) => Promise<unknown>;
  setBrowserPlatformEnabled: (platform: string, enabled: boolean) => Promise<unknown> | unknown;
  triggerPlatformSync: (platform: string) => Promise<unknown> | unknown;
  executePlatformAction: unknown;
  refreshExtension: () => unknown;

  // From useEngagementPlatformPreferences
  setWorkspacePlatformEnabled: (platform: string, enabled: boolean) => Promise<unknown> | unknown;
  refreshWorkspacePreferences: () => unknown;

  // From useLinkedInEngagementWorkspace
  syncLinkedInNow: () => Promise<unknown> | unknown;
  refreshLinkedInOverview: () => Promise<unknown> | unknown;

  // Defined in InboxDashboard
  getBrowserActionPlatform: (platform: string) => string;
  getBrowserPlatformState: (platform: string) => {
    browserEnabled?: boolean;
    hasOpenTab?: boolean;
    hasMessagingTab?: boolean;
    hasFeedTab?: boolean;
    hasSalesNavigatorTab?: boolean;
    hasRecruiterTab?: boolean;
  } | null | undefined;

  // From data hooks
  refresh: () => unknown;
  refreshCounts: () => unknown;
  refreshWorkQueue: () => unknown;
  refreshMessages: () => unknown;
}

export function useBrowserAssistHandlers(
  state: BrowserAssistState,
  deps: UseBrowserAssistHandlerDeps,
) {
  const {
    setBrowserAssistError,
    setBrowserAssistBusyPlatform,
    setBrowserAssistStatusByPlatform,
    setBrowserAssistErrorByPlatform,
    setLinkedInSurfaceActionBusy,
    setLinkedInSurfaceActionStatus,
    attemptedExtensionAuthRef,
  } = state;
  const {
    organizationId,
    extensionStatus,
    extensionAuth,
    extensionError,
    authenticateExtensionViaClaimCode,
    setBrowserPlatformEnabled,
    triggerPlatformSync,
    executePlatformAction,
    refreshExtension,
    setWorkspacePlatformEnabled,
    refreshWorkspacePreferences,
    syncLinkedInNow,
    refreshLinkedInOverview,
    getBrowserActionPlatform,
    getBrowserPlatformState,
    refresh,
    refreshCounts,
    refreshWorkQueue,
    refreshMessages,
  } = deps;

  const handleToggleExtensionPlatform = useCallback(
    async (platform: string, enabled: boolean) => {
      await setWorkspacePlatformEnabled(platform, enabled);
      await setBrowserPlatformEnabled(platform, enabled);
    },
    [setBrowserPlatformEnabled, setWorkspacePlatformEnabled]
  );

  const bootstrapExtensionAuth = useCallback(async () => {
    if (!organizationId || !extensionStatus?.runtimeId || extensionError) return false;
    if (extensionAuth?.isAuthenticated) {
      attemptedExtensionAuthRef.current = null;
      return true;
    }

    const attemptKey = `${organizationId}:${extensionStatus.runtimeId}`;
    if (attemptedExtensionAuthRef.current === attemptKey) return false;
    attemptedExtensionAuthRef.current = attemptKey;

    try {
      await authenticateExtensionViaClaimCode(organizationId);
      attemptedExtensionAuthRef.current = null;
      return true;
    } catch (authError) {
      attemptedExtensionAuthRef.current = null;
      console.warn('[engagement] extension auto-auth failed:', authError);
      return false;
    }
  }, [
    authenticateExtensionViaClaimCode,
    extensionAuth?.isAuthenticated,
    extensionError,
    extensionStatus?.runtimeId,
    organizationId,
    attemptedExtensionAuthRef,
  ]);

  const handleRefreshExtensionPanel = useCallback(() => {
    void refreshExtension();
    void refreshWorkspacePreferences();
    void refreshLinkedInOverview();
    void bootstrapExtensionAuth();
  }, [bootstrapExtensionAuth, refreshExtension, refreshWorkspacePreferences, refreshLinkedInOverview]);

  const handleSyncLinkedIn = useCallback(async () => {
    await syncLinkedInNow();
    refresh();
    refreshCounts();
    refreshWorkQueue();
  }, [refresh, refreshCounts, refreshWorkQueue, syncLinkedInNow]);

  const handleRunLinkedInBrowserAssist = useCallback(async () => {
    setBrowserAssistError(null);
    setLinkedInSurfaceActionStatus(null);
    try {
      await bootstrapExtensionAuth();
      await triggerPlatformSync('linkedin');
      const settleDelays = [1200, 2500, 4500];

      for (const delay of settleDelays) {
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        await refreshLinkedInOverview();
        refresh();
        refreshCounts();
        refreshWorkQueue();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'LinkedIn browser assist is not available right now';
      setBrowserAssistError(message);
    }
  }, [bootstrapExtensionAuth, triggerPlatformSync, refreshLinkedInOverview, refresh, refreshCounts, refreshWorkQueue, setBrowserAssistError, setLinkedInSurfaceActionStatus]);

  const handleRunPlatformBrowserAssist = useCallback(
    async (platform: string) => {
      const browserActionPlatform = getBrowserActionPlatform(platform);
      setBrowserAssistBusyPlatform(browserActionPlatform);
      setBrowserAssistStatusByPlatform((current) => ({ ...current, [browserActionPlatform]: null }));
      setBrowserAssistErrorByPlatform((current) => ({ ...current, [browserActionPlatform]: null }));
      try {
        await bootstrapExtensionAuth();
        await triggerPlatformSync(browserActionPlatform);
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        await Promise.allSettled([
          refresh(),
          refreshCounts(),
          refreshWorkQueue(),
          refreshMessages(),
        ]);
        setBrowserAssistStatusByPlatform((current) => ({
          ...current,
          [browserActionPlatform]: `${browserActionPlatform === 'x' ? 'X' : browserActionPlatform.charAt(0).toUpperCase() + browserActionPlatform.slice(1)} browser assist ran successfully.`,
        }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : `${browserActionPlatform} browser assist is not available right now`;
        setBrowserAssistErrorByPlatform((current) => ({
          ...current,
          [browserActionPlatform]: message,
        }));
      } finally {
        setBrowserAssistBusyPlatform(null);
      }
    },
    [bootstrapExtensionAuth, getBrowserActionPlatform, refresh, refreshCounts, refreshMessages, refreshWorkQueue, triggerPlatformSync, setBrowserAssistBusyPlatform, setBrowserAssistStatusByPlatform, setBrowserAssistErrorByPlatform]
  );

  const handleCaptureLinkedInSurface = useCallback(
    async (surface: 'sales_navigator' | 'recruiter') => {
      setBrowserAssistError(null);
      setLinkedInSurfaceActionStatus(null);
      setLinkedInSurfaceActionBusy(surface);
      try {
        const browserState = getBrowserPlatformState('linkedin');
        const surfaceReady =
          surface === 'sales_navigator'
            ? browserState?.hasSalesNavigatorTab
            : browserState?.hasRecruiterTab;

        if (!surfaceReady) {
          throw new Error(
            surface === 'sales_navigator'
              ? 'Open Sales Navigator to capture lead workflows'
              : 'Open Recruiter to capture candidate workflows'
          );
        }

        await bootstrapExtensionAuth();
        // Direct platform action dispatch is disabled in the hardened
        // bridge. Sales Navigator / Recruiter capture is deferred until
        // the server-issued command path for those surfaces ships.
        void executePlatformAction;
        setLinkedInSurfaceActionStatus(
          surface === 'sales_navigator'
            ? 'Sales Navigator capture is deferred until server-issued command dispatch ships for this surface.'
            : 'Recruiter capture is deferred until server-issued command dispatch ships for this surface.',
        );

        await Promise.allSettled([
          refresh(),
          refreshCounts(),
          refreshWorkQueue(),
          refreshLinkedInOverview(),
        ]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'LinkedIn advanced surface capture is not available right now';
        setBrowserAssistError(message);
      } finally {
        setLinkedInSurfaceActionBusy(null);
      }
    },
    [
      bootstrapExtensionAuth,
      executePlatformAction,
      getBrowserPlatformState,
      refresh,
      refreshCounts,
      refreshLinkedInOverview,
      refreshWorkQueue,
      setBrowserAssistError,
      setLinkedInSurfaceActionStatus,
      setLinkedInSurfaceActionBusy,
    ]
  );

  return {
    handleToggleExtensionPlatform,
    bootstrapExtensionAuth,
    handleRefreshExtensionPanel,
    handleSyncLinkedIn,
    handleRunLinkedInBrowserAssist,
    handleRunPlatformBrowserAssist,
    handleCaptureLinkedInSurface,
  };
}

// =====================================================================
// useBrowserAssistEffects — Phase 35-D-5c (the 4 useEffects)
// =====================================================================
//
// Effects moved AS-IS from InboxDashboard, ZERO body edits, ZERO dep
// array changes. Order matches the inline original where the visibility
// lock was at the top of the component (line 116), then auto-bootstrap
// (line 1021), initial platform sync (line 1048), background sync
// (line 1082) at the bottom. Effects with empty deps array remain
// empty; dep arrays preserved verbatim.
//
// Cleanup functions PRESERVED (DOM listeners, setInterval, cancelled
// flag) — losing them would memory-leak or duplicate-poll.

export interface UseBrowserAssistEffectsDeps {
  organizationId: string;
  extensionStatus: { runtimeId?: string | null } | null | undefined;
  extensionAuth: { isAuthenticated?: boolean | null } | null | undefined;
  extensionError: string | null | undefined;
  bootstrapExtensionAuth: () => Promise<boolean>;
  syncableBrowserPlatforms: string[];
  runPlatformSyncAndRefresh: (platforms: string[]) => Promise<void>;
  browserAssistEnabled: boolean;
}

export function useBrowserAssistEffects(
  state: BrowserAssistState,
  deps: UseBrowserAssistEffectsDeps,
) {
  const { attemptedExtensionAuthRef, initialPlatformSyncKeyRef, lastPlatformSyncAtRef } = state;
  const {
    organizationId,
    extensionStatus,
    extensionAuth,
    extensionError,
    bootstrapExtensionAuth,
    syncableBrowserPlatforms,
    runPlatformSyncAndRefresh,
    browserAssistEnabled,
  } = deps;

  // Effect 1 — visibility / focus lock.
  // Clear the "already-attempted" lock whenever the user returns to the tab
  // or refocuses the window. The lock prevents redundant retries during a
  // single page session, but it also prevents recovery from a transient
  // initial failure (e.g. SW cold start, content-script not yet injected).
  // On focus/visibility we know the user is engaging — let the auto-bootstrap
  // try again from a clean slate.
  useEffect(() => {
    const clearLock = () => { attemptedExtensionAuthRef.current = null; };
    const onVisibility = () => { if (document.visibilityState === 'visible') clearLock(); };
    window.addEventListener('focus', clearLock);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', clearLock);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Effect 2 — auto-bootstrap.
  useEffect(() => {
    // Extension auth (claim-code redemption → HMAC secret) is required for
    // EVERY /api/extension/* call: DM/comment scraping, command polling,
    // platform health, etc. It is NOT specific to the browser-assist
    // feature, so we don't gate the bootstrap on browserAssistEnabled.
    // Without this, the SW never gets an HMAC secret and every signed
    // POST returns SIGNATURE_UNAVAILABLE.
    if (!organizationId || !extensionStatus?.runtimeId || extensionError) return;
    if (extensionAuth?.isAuthenticated) {
      attemptedExtensionAuthRef.current = null;
      return;
    }

    const attemptKey = `${organizationId}:${extensionStatus.runtimeId}`;
    if (attemptedExtensionAuthRef.current === attemptKey) {
      return;
    }
    void bootstrapExtensionAuth();
  }, [
    browserAssistEnabled,
    bootstrapExtensionAuth,
    extensionAuth?.isAuthenticated,
    extensionError,
    extensionStatus?.runtimeId,
    organizationId,
  ]);

  // Effect 3 — initial platform sync.
  useEffect(() => {
    if (!organizationId || !extensionStatus?.runtimeId || extensionError) return;
    if (syncableBrowserPlatforms.length === 0) return;

    const syncKey = `${organizationId}:${extensionStatus.runtimeId}:${syncableBrowserPlatforms.join(',')}`;
    if (initialPlatformSyncKeyRef.current === syncKey) return;

    let cancelled = false;
    initialPlatformSyncKeyRef.current = syncKey;

    void (async () => {
      const authenticated = await bootstrapExtensionAuth();
      if (!authenticated || cancelled) {
        if (!cancelled) initialPlatformSyncKeyRef.current = null;
        return;
      }
      await runPlatformSyncAndRefresh(syncableBrowserPlatforms);
    })().catch((syncError) => {
      initialPlatformSyncKeyRef.current = null;
      console.warn('[engagement] initial platform inbox sync failed:', syncError);
    });

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapExtensionAuth,
    extensionError,
    extensionStatus?.runtimeId,
    organizationId,
    runPlatformSyncAndRefresh,
    syncableBrowserPlatforms,
  ]);

  // Effect 4 — background sync interval.
  useEffect(() => {
    if (!organizationId || syncableBrowserPlatforms.length === 0) return;

    const runIfDue = () => {
      if (Date.now() - lastPlatformSyncAtRef.current < BACKGROUND_PLATFORM_SYNC_INTERVAL_MS) return;
      void (async () => {
        const authenticated = await bootstrapExtensionAuth();
        if (!authenticated) return;
        await runPlatformSyncAndRefresh(syncableBrowserPlatforms);
      })().catch((syncError) => {
        console.warn('[engagement] scheduled platform inbox sync failed:', syncError);
      });
    };

    const intervalId = window.setInterval(runIfDue, BACKGROUND_PLATFORM_SYNC_INTERVAL_MS);
    const onFocus = () => runIfDue();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') runIfDue();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [bootstrapExtensionAuth, organizationId, runPlatformSyncAndRefresh, syncableBrowserPlatforms]);
}
