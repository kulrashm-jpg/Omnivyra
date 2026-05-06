/**
 * useBrowserAssist — Phase 35-D-5a + 35-D-5b.
 *
 * Two hooks split because React execution order in InboxDashboard
 * forces the state declarations to live BEFORE the sub-hook calls
 * (useExtensionBridge etc), but the handlers' closure deps come FROM
 * those sub-hook returns. Calling them in two phases preserves the
 * original execution order without moving any code:
 *
 *   const browserState = useBrowserAssistState();           // top of component
 *   // ... sub-hook calls (useExtensionBridge, etc.) ...
 *   const browserHandlers = useBrowserAssistHandlers(browserState, deps);
 *
 * Handlers are byte-equivalent to the originals in InboxDashboard;
 * dep arrays kept identical per the user's "do not be clever" rule.
 *
 * Sub-hook calls and useEffects remain in InboxDashboard for now —
 * those move in 35-D-5c.
 */

import { useCallback, useRef, useState } from 'react';
import { isBrowserAssistRuntimeEnabled } from '@/lib/featureFlags';
import type { PlatformSyncTrustState } from '@/components/engagement/inbox/helpers';

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
