import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizePlatform } from '@/utils/platformIcons';

type ExtensionAuthState = {
  isAuthenticated?: boolean;
  orgId?: string | null;
  userId?: string | null;
  user?: { name?: string | null; email?: string | null } | null;
  error?: string;
};

type ExtensionPlatformState = {
  openTabCount: number;
  hasOpenTab: boolean;
  hasMessagingTab?: boolean;
  hasFeedTab?: boolean;
  hasSalesNavigatorTab?: boolean;
  hasRecruiterTab?: boolean;
  enabled: boolean;
};

export type ExtensionPlatformRow = {
  platform: string;
  configured: boolean;
  browserEnabled: boolean;
  hasOpenTab: boolean;
  openTabCount: number;
  hasMessagingTab: boolean;
  hasFeedTab: boolean;
  hasSalesNavigatorTab: boolean;
  hasRecruiterTab: boolean;
};

type ExtensionStatus = {
  success?: boolean;
  runtimeId?: string | null;
  version?: string | null;
  supportedPlatforms?: string[];
  auth?: ExtensionAuthState | null;
  platforms?: Record<string, ExtensionPlatformState>;
  message?: string;
};

type ExtensionTokenPayload = {
  userId: string;
  orgId: string;
  sessionToken: string;
  apiBaseUrl?: string;
  expiresAt?: number;
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
  };
};

// 1.5s was too tight: a freshly-spun SW (cold start, post-reload) often
// can't reply that fast, the bridge timer fires, extensionError gets set,
// and the auto-bootstrap useEffect on /engagement bails before retrying.
// 5s gives the SW comfortable headroom while still failing fast when no
// extension is installed at all.
const RESPONSE_TIMEOUT_MS = 5000;
const AUTH_RESPONSE_TIMEOUT_MS = 15000;
const PLATFORM_SYNC_TIMEOUT_MS = 15000;
const PLATFORM_ACTION_TIMEOUT_MS = 45000;
const PLATFORM_ACTION_ACK_TIMEOUT_MS = 2500;
const BRIDGE_CAPABILITY_TIMEOUT_MS = 2500;

function waitForWindowMessage<T>(responseType: string, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      reject(new Error(`Timed out waiting for ${responseType}`));
    }, timeoutMs);

    function handleMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.data?.type !== responseType) return;

      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      resolve((event.data?.data ?? event.data) as T);
    }

    window.addEventListener('message', handleMessage);
  });
}

async function requestExtensionStatus(): Promise<ExtensionStatus> {
  const responsePromise = waitForWindowMessage<ExtensionStatus>('OMNIVYRA_EXTENSION_STATUS_RESPONSE');
  window.postMessage({ type: 'OMNIVYRA_EXTENSION_STATUS_REQUEST' }, '*');
  return await responsePromise;
}

async function requestAuthState(): Promise<ExtensionAuthState> {
  const responsePromise = waitForWindowMessage<ExtensionAuthState>('OMNIVYRA_EXTENSION_AUTH_STATE');
  window.postMessage({ type: 'OMNIVYRA_REQUEST_AUTH_STATE' }, '*');
  return await responsePromise;
}

async function updatePlatformState(platform: string, enabled: boolean) {
  const responsePromise = waitForWindowMessage<{ success?: boolean; message?: string }>(
    'OMNIVYRA_PLATFORM_STATE_RESULT'
  );
  window.postMessage({
    type: 'OMNIVYRA_SET_PLATFORM_STATE',
    data: { platform, enabled }
  }, '*');
  return await responsePromise;
}

async function redeemWithClaimCode(claimCode: string) {
  const responsePromise = waitForWindowMessage<{ success?: boolean; message?: string }>(
    'OMNIVYRA_CLAIM_CODE_RESULT',
    AUTH_RESPONSE_TIMEOUT_MS,
  );
  window.postMessage(
    {
      type: 'OMNIVYRA_CLAIM_CODE',
      data: { claim_code: claimCode },
    },
    window.location.origin,
  );
  return await responsePromise;
}

async function fetchClaimCode(organizationId: string) {
  const res = await fetch('/api/extension/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ organization_id: organizationId }),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { claim_code?: string }; error?: string };
  if (!res.ok || !json?.success || !json?.data?.claim_code) {
    throw new Error(json?.error || `Bootstrap failed (${res.status})`);
  }
  return json.data.claim_code;
}

async function triggerPlatformSyncRequest(platform: string) {
  const responsePromise = waitForWindowMessage<{ success?: boolean; message?: string }>(
    'OMNIVYRA_PLATFORM_SYNC_RESULT',
    PLATFORM_SYNC_TIMEOUT_MS
  );
  window.postMessage({
    type: 'OMNIVYRA_TRIGGER_PLATFORM_SYNC',
    data: { platform }
  }, '*');
  return await responsePromise;
}

async function pollExtensionCommandsNowRequest() {
  const responsePromise = waitForWindowMessage<{ success?: boolean; message?: string }>(
    'OMNIVYRA_POLL_COMMANDS_RESULT',
    PLATFORM_ACTION_TIMEOUT_MS
  );
  window.postMessage({ type: 'OMNIVYRA_POLL_COMMANDS_NOW' }, window.location.origin);
  return await responsePromise;
}

async function requestBridgeCapabilities() {
  const responsePromise = waitForWindowMessage<{
    success?: boolean;
    directActionAck?: boolean;
    message?: string;
  }>(
    'OMNIVYRA_BRIDGE_CAPABILITY_RESPONSE',
    BRIDGE_CAPABILITY_TIMEOUT_MS
  );
  window.postMessage({ type: 'OMNIVYRA_BRIDGE_CAPABILITY_REQUEST' }, window.location.origin);
  return await responsePromise;
}

async function executePlatformActionRequest(
  platform: string,
  action: string,
  payload: Record<string, unknown>
) {
  try {
    const capabilities = await requestBridgeCapabilities();
    if (!capabilities?.success || capabilities.directActionAck !== true) {
      throw new Error(capabilities?.message || 'Loaded Omnivyra bridge does not support direct send acknowledgements');
    }
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes('Timed out waiting for OMNIVYRA_BRIDGE_CAPABILITY_RESPONSE')
        ? 'Loaded Omnivyra extension bridge is stale or missing. Reload the unpacked extension, then refresh this Omnivyra tab before sending.'
        : error instanceof Error
          ? error.message
          : 'Loaded Omnivyra extension bridge is stale or missing'
    );
  }

  const ackPromise = waitForWindowMessage<{ success?: boolean; message?: string }>(
    'OMNIVYRA_PLATFORM_ACTION_ACK',
    PLATFORM_ACTION_ACK_TIMEOUT_MS
  );
  const responsePromise = waitForWindowMessage<{
    success?: boolean;
    message?: string;
    result?: unknown;
    trace?: unknown;
    pipelineDiagnostics?: unknown;
    error?: string;
  }>(
    'OMNIVYRA_PLATFORM_ACTION_RESULT',
    PLATFORM_ACTION_TIMEOUT_MS
  );
  window.postMessage({
    type: 'OMNIVYRA_EXECUTE_PLATFORM_ACTION',
    data: { platform, action, payload }
  }, window.location.origin);
  try {
    const ack = await ackPromise;
    if (ack?.success === false) {
      throw new Error(ack.message || 'Omnivyra extension bridge rejected the platform action');
    }
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes('Timed out waiting for OMNIVYRA_PLATFORM_ACTION_ACK')
        ? 'Omnivyra Chrome extension bridge did not acknowledge the send request. Reload the unpacked extension, then refresh this Omnivyra tab.'
        : error instanceof Error
          ? error.message
          : 'Omnivyra Chrome extension bridge did not acknowledge the send request'
    );
  }
  const response = await responsePromise;
  console.log('[Omnivyra][app] platform action result received', {
    platform,
    action,
    success: response?.success,
    hasResult: Boolean(response?.result),
    hasTrace: Boolean(response?.trace || (response?.result as { trace?: unknown } | null)?.trace),
    hasPipelineDiagnostics: Boolean(response?.pipelineDiagnostics || (response?.result as { pipelineDiagnostics?: unknown } | null)?.pipelineDiagnostics),
  });
  return response;
}

export function useExtensionBridge(configuredPlatforms: string[]) {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [auth, setAuth] = useState<ExtensionAuthState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingPlatform, setUpdatingPlatform] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextStatus, nextAuth] = await Promise.all([
        requestExtensionStatus(),
        requestAuthState()
      ]);

      setStatus(nextStatus);
      setAuth(nextAuth);
    } catch (err) {
      setStatus(null);
      setAuth(null);
      setError(err instanceof Error ? err.message : 'Unable to reach the Omnivyra extension');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Extension status polling. Was 5s — way too aggressive: every refresh
    // triggers an SW round-trip + re-renders cascade through the dashboard
    // (PlatformHealthStrip, tab counts, etc.), so clicking Reply on a comment
    // would visibly flicker through a "checking platform status" loop. 60s
    // matches the platform-health hook's staleness window and is plenty
    // for an inbox surface; focus + visibility events still kick a fresh
    // refresh when the user actually returns to the tab.
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 60000);

    const handleFocus = () => {
      void refresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  const setBrowserPlatformEnabled = useCallback(
    async (platform: string, enabled: boolean) => {
      setUpdatingPlatform(platform);
      try {
        const result = await updatePlatformState(platform, enabled);
        if (!result?.success) {
          throw new Error(result?.message || 'Unable to update platform state');
        }
        await refresh();
      } finally {
        setUpdatingPlatform(null);
      }
    },
    [refresh]
  );

  const authenticateExtensionSession = useCallback(
    async (payload: ExtensionTokenPayload) => {
      // BACKWARD-COMPAT SHIM. Callers that used to forward a raw session
      // token are redirected to the claim-code flow. We fetch a fresh
      // claim code for this org and send only the code to the extension.
      setAuthenticating(true);
      try {
        const orgId = payload?.orgId;
        if (!orgId) throw new Error('authenticateExtensionSession requires orgId');
        const claimCode = await fetchClaimCode(String(orgId));
        const result = await redeemWithClaimCode(claimCode);
        if (!result?.success) {
          throw new Error(result?.message || 'Unable to authenticate browser extension');
        }
        await refresh();
      } finally {
        setAuthenticating(false);
      }
    },
    [refresh],
  );

  const authenticateExtensionViaClaimCode = useCallback(
    async (organizationId: string) => {
      setAuthenticating(true);
      try {
        const claimCode = await fetchClaimCode(organizationId);
        const result = await redeemWithClaimCode(claimCode);
        if (!result?.success) throw new Error(result?.message || 'Unable to authenticate browser extension');
        await refresh();
        return result;
      } finally {
        setAuthenticating(false);
      }
    },
    [refresh],
  );

  const triggerPlatformSync = useCallback(
    async (platform: string) => {
      const result = await triggerPlatformSyncRequest(platform);
      if (!result?.success) {
        throw new Error(result?.message || `Unable to trigger ${platform} sync`);
      }
      await refresh();
      return result;
    },
    [refresh]
  );

  const executePlatformAction = useCallback(
    async (platform: string, action: string, payload: Record<string, unknown>) => {
      const result = await executePlatformActionRequest(platform, action, payload);
      if (!result?.success) {
        const error = new Error(result?.message || result?.error || `Unable to execute ${platform}.${action}`);
        Object.assign(error, {
          result: result?.result,
          trace: result?.trace,
          pipelineDiagnostics: result?.pipelineDiagnostics,
        });
        throw error;
      }
      await refresh();
      return result;
    },
    [refresh],
  );

  const pollExtensionCommandsNow = useCallback(async () => {
    const result = await pollExtensionCommandsNowRequest();
    if (!result?.success) {
      throw new Error(result?.message || 'Unable to trigger extension command dispatch');
    }
    await refresh();
    return result;
  }, [refresh]);

  const mergedPlatforms = useMemo(() => {
    const configured = configuredPlatforms.map((platform) => normalizePlatform(platform));
    const extensionPlatforms = Object.keys(status?.platforms || {}).map((platform) => normalizePlatform(platform));
    const all = Array.from(new Set([...configured, ...extensionPlatforms])).filter(Boolean);

    return all.map((platform) => {
      const platformState = status?.platforms?.[platform] || status?.platforms?.[platform === 'twitter' ? 'x' : platform] || {
        openTabCount: 0,
        hasOpenTab: false,
        enabled: true
      };

      return {
        platform,
        configured: configured.includes(platform),
        browserEnabled: platformState.enabled !== false,
        hasOpenTab: Boolean(platformState.hasOpenTab),
        openTabCount: platformState.openTabCount ?? 0,
        hasMessagingTab: Boolean(platformState.hasMessagingTab),
        hasFeedTab: Boolean(platformState.hasFeedTab),
        hasSalesNavigatorTab: Boolean(platformState.hasSalesNavigatorTab),
        hasRecruiterTab: Boolean(platformState.hasRecruiterTab),
      };
    });
  }, [configuredPlatforms, status?.platforms]);

  return {
    status,
    auth,
    loading,
    error,
    refresh,
    mergedPlatforms,
    updatingPlatform,
    authenticating,
    setBrowserPlatformEnabled,
    authenticateExtensionSession,
    authenticateExtensionViaClaimCode,
    pollExtensionCommandsNow,
    triggerPlatformSync,
    executePlatformAction,
  };
}
