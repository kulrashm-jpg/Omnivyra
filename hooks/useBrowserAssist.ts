/**
 * useBrowserAssistState — Phase 35-D-5a (state-only pass).
 *
 * Dumb container: extracts the 7 useState declarations + 3 useRef
 * declarations + the `browserAssistEnabled` feature-flag read from
 * InboxDashboard. NO effects, NO handlers, NO sub-hook calls move
 * here this pass — those are 35-D-5b and 35-D-5c.
 *
 * Naming kept verbatim from the originals so the consumer's call sites
 * are byte-equivalent before/after destructuring this hook.
 */

import { useRef, useState } from 'react';
import { isBrowserAssistRuntimeEnabled } from '@/lib/featureFlags';
import type { PlatformSyncTrustState } from '@/components/engagement/inbox/helpers';

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
