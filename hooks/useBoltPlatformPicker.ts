/**
 * useBoltPlatformPicker — shared platform-picker data hook for BOLT modes.
 * ──────────────────────────────────────────────────────────────────────────
 * Fetches capability-filtered connected platforms for the given BOLT mode
 * from `/api/bolt/available-platforms` and emits the canonical
 * `platform.capability.filtered` log. Owned data only — selection state
 * stays with the consuming hook so existing session-storage persistence
 * (BoltStrategyState, BoltCreatorState, IntelMixState …) is not disturbed.
 *
 * Round-6 Phase 4 — single source for fetch + log emission across:
 *   - useBoltStrategy        (BOLT Text)
 *   - useBoltCreator         (BOLT Creator)
 *   - useIntelMix            (legacy, deprecated — route renders BoltCombined)
 *   - bolt-combined-strategy (Intelligent Mix / combined, inline page)
 * (Strategic Mix is NOT a BOLT mode — its canonical shell is the Campaign
 * Planner; see STRATEGIC-MIX-SPEC-001.)
 */

import { useEffect, useState } from 'react';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import {
  CAPABILITY_LOG_EVENTS,
  type CapabilityLogPayload,
} from '../lib/shared/social/capabilityEvents';
import type { ContentCapability } from '../lib/shared/social/platformCapabilities';

export type BoltMode = 'bolt-text' | 'bolt-creator' | 'intelligent-mix' | 'strategy-mix';

export interface PlatformPickerEntry {
  platform: string;
  reason: string;
}

export interface BoltPlatformPickerData {
  /** Loading state for the fetch. */
  loading: boolean;
  /** Resolved capability — `null` for mix modes (union) and for unresolved. */
  capability: ContentCapability | null;
  /** Registered + capability-compatible. */
  supported: string[];
  /** Registered + capability-incompatible. Render as disabled chips. */
  hidden: PlatformPickerEntry[];
  /** Not in the registry. NEVER render. Returned only for diagnostics. */
  unregistered: PlatformPickerEntry[];
  /** Whether the API responded with an explicit `capability: null` AND no
   *  supported platforms — i.e. mode-resolution failure that requires the
   *  blocking-state UI message. */
  blocked: boolean;
}

const INITIAL: BoltPlatformPickerData = {
  loading: false,
  capability: null,
  supported: [],
  hidden: [],
  unregistered: [],
  blocked: false,
};

/** Modes whose API contract returns `capability: null` legitimately because
 *  they are union/multi-capability modes — these must NOT trigger the
 *  blocking state when capability is null. */
export const MIX_MODES: ReadonlySet<BoltMode> = new Set(['intelligent-mix', 'strategy-mix']);

/**
 * Pure resolver — converts an API body into the picker state. Exported so
 * the hook contract is unit-testable without React/DOM. Used internally by
 * `useBoltPlatformPicker` after the fetch resolves.
 */
export function resolveBoltPickerState(
  mode: BoltMode,
  body: unknown,
): BoltPlatformPickerData {
  const b = (body ?? {}) as Record<string, unknown>;
  const supported = Array.isArray(b.supported) ? (b.supported as string[]) : [];
  const hidden = Array.isArray(b.hidden) ? (b.hidden as PlatformPickerEntry[]) : [];
  const unregistered = Array.isArray(b.unregistered) ? (b.unregistered as PlatformPickerEntry[]) : [];
  const apiCapability: ContentCapability | null =
    typeof b.capability === 'string' || b.capability === null
      ? (b.capability as ContentCapability | null)
      : null;
  // Mix modes legitimately return `capability: null` — only single-
  // capability modes (text/creator) treat null as a blocking failure.
  const blocked = apiCapability === null && !MIX_MODES.has(mode) && supported.length === 0;
  return { loading: false, capability: apiCapability, supported, hidden, unregistered, blocked };
}

export function useBoltPlatformPicker(
  companyId: string | null | undefined,
  mode: BoltMode,
): BoltPlatformPickerData {
  const [data, setData] = useState<BoltPlatformPickerData>(INITIAL);

  useEffect(() => {
    if (!companyId) {
      setData(INITIAL);
      return;
    }
    let cancelled = false;
    setData((prev) => ({ ...prev, loading: true }));

    fetchWithAuth(
      `/api/bolt/available-platforms?companyId=${encodeURIComponent(companyId)}&mode=${encodeURIComponent(mode)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        const result = resolveBoltPickerState(mode, body);
        setData(result);

        const payload: CapabilityLogPayload = {
          surface: `bolt:${mode}`,
          publishSource: `bolt:${mode}`,
          resolvedCapability: result.capability,
          supportedPlatforms: result.supported,
          hiddenPlatforms: result.hidden.map((h) => h.platform),
          unregisteredPlatforms: result.unregistered.map((u) => u.platform),
          hiddenReasons: result.hidden.reduce<Record<string, string>>((acc, h) => {
            acc[h.platform] = h.reason;
            return acc;
          }, {}),
          unregisteredReasons: result.unregistered.reduce<Record<string, string>>((acc, u) => {
            acc[u.platform] = u.reason;
            return acc;
          }, {}),
        };
        // eslint-disable-next-line no-console
        console.info(JSON.stringify({ event: CAPABILITY_LOG_EVENTS.FILTERED, ...payload }));
      })
      .catch(() => {
        if (!cancelled) setData({ ...INITIAL });
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, mode]);

  return data;
}
