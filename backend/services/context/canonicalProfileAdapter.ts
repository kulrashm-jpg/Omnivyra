/**
 * canonicalProfileAdapter.ts — CONTENT-INTELLIGENCE-003.
 *
 * Drop-in replacement for getProfile() that returns the SAME CompanyProfile
 * shape, but backfills EMPTY fields from the Canonical Context Engine. Consumers
 * migrate by aliasing their import (`getCanonicalProfile as getProfile`) — no
 * call-site, prompt, schema, or business-rule changes.
 *
 * Guarantees:
 *   - Present profile values are NEVER overwritten (business rules preserved).
 *   - When the profile already contains a field, output is identical to legacy
 *     (compatibility: canonical == legacy when context matches).
 *   - Canonical failure → returns the untouched legacy profile (graceful fallback).
 *   - Deterministic given the same profile + canonical inputs.
 *
 * E4 (Wave R2) — ROLLOUT GATE. All rollout logic lives HERE and nowhere else;
 * the 92 consumers are unchanged. The `canonical-grounding` flag (Foundation
 * Rollout Kit) governs every consumer through this one function:
 *
 *   OFF (default) — return the legacy getProfile result BYTE-FAITHFULLY.
 *                   Canonical never runs. This is what makes the reconciled
 *                   branch dark and merge-safe.
 *   SHADOW        — run legacy AND canonical, RETURN LEGACY (never canonical),
 *                   record divergence / latency / errors / quality via the
 *                   existing HARDEN-001 recorders. Per-tenant flag resolution
 *                   provides per-tenant rollout; the ambient request/job
 *                   context (F-03 ALS) provides trace correlation.
 *   ENFORCE       — return canonical grounding (the historical adapter
 *                   behavior). Legacy stays loaded/available for instant
 *                   rollback (flag → off).
 *
 * Kill switch: ROLLOUT_CANONICAL_GROUNDING_KILL / ROLLOUT_KILL_SWITCH → OFF.
 * No new infrastructure: reuses defineRolloutFlag/resolveRolloutSync and
 * recordRawCounter/recordRawHistogram only.
 */
import { getProfile } from '../companyProfileServiceRest1Rest2Pulse';
import { getCanonicalContext } from './contextAssimilationEngine';
import { recordCanonicalRead } from './canonicalAdoptionMetrics';
import { overlayCanonicalOntoProfile } from './canonicalProfileOverlay';
import { defineRolloutFlag, resolveRolloutSync } from '../../../lib/platform/rollout';
import { recordRawCounter, recordRawHistogram } from '../../observability';
// E3 (Wave R3): Foundation F-12 cache SDK — cache ONLY the deterministic
// canonical context so flag-on grounded reads reach W4-5 latency parity.
import { registerCacheNamespace } from '../../../lib/platform/cacheCore';
import { createCache } from '../../../lib/platform/cacheClient';

export { overlayCanonicalOntoProfile };

/**
 * E3 — canonical-context cache (F-12). Caches the deterministic context
 * assembled by getCanonicalContext, NOT the legacy profile (which keeps its
 * own W4-5 path) and NOT the overlaid result (recombined fresh each call).
 *   - tenant-scoped by construction (requireTenant → no tenant, no cache);
 *   - short TTL parity with the W4-5 profile cache (CANONICAL_CTX_TTL_SECONDS);
 *   - versioned invalidation (bump `version`); compression + metrics inherited;
 *   - request-level dedup via getOrLoad's memoRequest single-flight;
 *   - fail-open (Redis down → loader runs directly) and kill-switchable
 *     (CACHE_KILL_OMNIVYRA_CANONICAL_CTX / CACHE_KILL_ALL → uncached).
 * Deterministic grounding only — never AI output, prompts, or mutable state.
 */
const CANONICAL_CTX_NS = registerCacheNamespace({
  prefix: 'omnivyra:canonical_ctx',
  description: 'E3 canonical grounding context (deterministic, tenant-scoped)',
  version: 1,
  defaultTtlSeconds: Math.max(30, Number(process.env.CANONICAL_CTX_TTL_SECONDS) || 300),
  requireTenant: true,
});
const canonicalCtxCache = createCache(CANONICAL_CTX_NS);

type ProfileT = Awaited<ReturnType<typeof getProfile>>;
type GetProfileOptions = { autoRefine?: boolean; languageRefine?: boolean; includeStoredCompetitors?: boolean };

/**
 * E4 canonical-grounding rollout flag. Default off = legacy grounding for
 * every consumer (byte-faithful). Per-tenant promotable via the rollout kit.
 */
const CANONICAL_GROUNDING_FLAG = defineRolloutFlag({
  key: 'canonical-grounding',
  description: 'E4: canonical profile grounding rollout (off→shadow→enforce, per-tenant)',
});

/** Empty = no grounding signal (null/undefined/''/[]/{}) — safe to backfill. */
function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/**
 * SHADOW measurement: classify how canonical differs from legacy at the top
 * level. `backfilled` = fields canonical added where legacy was empty (the
 * intended value-add). `overwrote` = fields canonical CHANGED where legacy
 * had a value — this MUST be 0 (the adapter guarantees present values are
 * never overwritten); any nonzero reading is the shadow safety-violation
 * signal. Metrics only; never throws, never affects the returned result.
 */
function recordShadowDivergence(legacy: unknown, canonical: unknown, ctxOk: boolean): void {
  try {
    if (!legacy || !canonical || typeof legacy !== 'object' || typeof canonical !== 'object') {
      recordRawCounter('canonical_grounding.shadow', 1, { result: 'no_object' });
      return;
    }
    const l = legacy as Record<string, unknown>;
    const c = canonical as Record<string, unknown>;
    let backfilled = 0;
    let overwrote = 0;
    for (const key of new Set([...Object.keys(l), ...Object.keys(c)])) {
      const lv = l[key];
      const cv = c[key];
      if (isEmptyValue(lv) && !isEmptyValue(cv)) { backfilled++; continue; }
      if (!isEmptyValue(lv) && JSON.stringify(lv) !== JSON.stringify(cv)) overwrote++;
    }
    recordRawHistogram('canonical_grounding.fields_backfilled', backfilled, {});
    if (overwrote > 0) {
      // Safety violation — canonical changed a value legacy already held.
      recordRawCounter('canonical_grounding.shadow', 1, { result: 'overwrote' });
      recordRawHistogram('canonical_grounding.fields_overwrote', overwrote, {});
    } else {
      recordRawCounter('canonical_grounding.shadow', 1, { result: backfilled > 0 ? 'backfilled' : 'identical' });
    }
    recordRawCounter('canonical_grounding.shadow_context', 1, { ok: ctxOk });
  } catch {
    /* metrics must never break the call */
  }
}

/**
 * Assemble the canonical-grounded profile (shared by shadow + enforce).
 * Preserves the historical fallback: no profile OR canonical unavailable →
 * the untouched legacy profile. Records adoption + latency + errors.
 */
async function assembleCanonical(
  companyId: string,
  legacy: ProfileT,
  mode: string,
): Promise<{ canonical: ProfileT; ctxOk: boolean }> {
  const startedAt = Date.now();
  let canonical: ProfileT = legacy;
  let ctxOk = false;
  try {
    // E3: resolve the deterministic context through the F-12 cache. The
    // loader catches its own errors → null (never cached); getOrLoad is
    // fail-open (Redis down → loader runs directly) and request-memoized
    // (same-request repeat reads share one assembly). The freshly-loaded
    // legacy profile is still combined by the overlay below — only the
    // context fan-out is cached.
    const ctx = await canonicalCtxCache.getOrLoad<Awaited<ReturnType<typeof getCanonicalContext>> | null>({
      tenantId: companyId,
      parts: ['ctx'],
      load: async () => {
        try {
          const c = legacy
            ? await getCanonicalContext(companyId, { loadProfile: async () => legacy as unknown as Record<string, unknown> })
            : await getCanonicalContext(companyId);
          return c ?? null;
        } catch {
          return null;
        }
      },
    }).catch(() => null);
    ctxOk = !!ctx;
    recordCanonicalRead(companyId, ctxOk);
    if (legacy && ctx) {
      canonical = overlayCanonicalOntoProfile(legacy as unknown as Record<string, unknown>, ctx) as ProfileT;
    }
  } catch {
    try { recordRawCounter('canonical_grounding.error', 1, { mode }); } catch { /* fail-safe */ }
    canonical = legacy; // graceful fallback
  }
  try { recordRawHistogram('canonical_grounding.assembly_ms', Date.now() - startedAt, { mode }); } catch { /* fail-safe */ }
  return { canonical, ctxOk };
}

/**
 * Canonical-backed getProfile. Same signature + return shape. Alias its import
 * as `getProfile` in a consumer to migrate that consumer's grounding source.
 * The rollout mode decides what is returned (see file header).
 */
export async function getCanonicalProfile(
  companyId?: string,
  options?: GetProfileOptions,
): Promise<ProfileT> {
  const legacy = await getProfile(companyId, options);
  if (!companyId) return legacy;

  const mode = resolveRolloutSync(CANONICAL_GROUNDING_FLAG, { tenantId: companyId }).mode;

  // OFF (default): byte-faithful legacy. Canonical never runs.
  if (mode === 'off') return legacy;

  const { canonical, ctxOk } = await assembleCanonical(companyId, legacy, mode);

  // SHADOW: return LEGACY (never canonical); measure the divergence.
  if (mode === 'shadow') {
    recordShadowDivergence(legacy, canonical, ctxOk);
    return legacy;
  }

  // ENFORCE: canonical grounding (legacy remains available via flag → off).
  return canonical;
}
