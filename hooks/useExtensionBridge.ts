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
  enabled: boolean;
};

export type ExtensionPlatformRow = {
  platform: string;
  configured: boolean;
  browserEnabled: boolean;
  hasOpenTab: boolean;
  openTabCount: number;
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

const RESPONSE_TIMEOUT_MS = 1500;
const AUTH_RESPONSE_TIMEOUT_MS = 15000;
const PLATFORM_SYNC_TIMEOUT_MS = 15000;
const PLATFORM_ACTION_TIMEOUT_MS = 20000;

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

async function authenticateExtensionToken(payload: ExtensionTokenPayload) {
  const responsePromise = waitForWindowMessage<{ success?: boolean; message?: string }>(
    'OMNIVYRA_EXTENSION_AUTH_RESULT',
    AUTH_RESPONSE_TIMEOUT_MS
  );
  window.postMessage({
    type: 'OMNIVYRA_TOKEN',
    data: payload
  }, '*');
  return await responsePromise;
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

async function executePlatformActionRequest(
  platform: string,
  action: string,
  payload: Record<string, unknown>
) {
  const responsePromise = waitForWindowMessage<{ success?: boolean; message?: string; result?: unknown }>(
    'OMNIVYRA_PLATFORM_ACTION_RESULT',
    PLATFORM_ACTION_TIMEOUT_MS
  );
  window.postMessage({
    type: 'OMNIVYRA_EXECUTE_PLATFORM_ACTION',
    data: { platform, action, payload }
  }, '*');
  return await responsePromise;
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
      setAuthenticating(true);
      try {
        const result = await authenticateExtensionToken(payload);
        if (!result?.success) {
          throw new Error(result?.message || 'Unable to authenticate browser extension');
        }
        await refresh();
      } finally {
        setAuthenticating(false);
      }
    },
    [refresh]
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
        throw new Error(result?.message || `Unable to execute ${platform}.${action}`);
      }
      await refresh();
      return result;
    },
    [refresh]
  );

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
        openTabCount: platformState.openTabCount ?? 0
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
    triggerPlatformSync,
    executePlatformAction
  };
}
