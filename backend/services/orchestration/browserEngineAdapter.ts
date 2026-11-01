/**
 * The browser (Playwright/RPA) engine, as an orchestration adapter: it REFUSES
 * EVERY REQUEST, by design, and says why.
 *
 * ─── WHY NOTHING IS EXPOSED (audit 2026-10-28, base 4a7b17a0) ─────────────
 * The repo's Playwright users are:
 *
 *   rpaWorker/rpaWorkerService.executeRpaTask   reply | like on facebook,
 *       instagram, twitter, reddit, linkedin, as the tenant's stored browser
 *       session. The only operations that act toward a person — and they are
 *       the community engine's execution path (communityAiActionExecutor
 *       `runRpaExecution`), reached only after that engine's own gates
 *       (platform policy `execution_enabled`, `require_human_approval`,
 *       approval, playbook, plan limits). `executeRpaTask` carries none of those
 *       gates, so calling it from here would bypass them; calling the community
 *       engine instead is the `community` adapter's job, not a second route.
 *       It also cannot meet the adapter contract:
 *         - it re-runs a task after it may have acted: the in-process queue
 *           retries ANY non-success (including a failed post-condition after the
 *           submit click) and any throw; the durable `rpa_retry_queue` retries
 *           up to 5 times with no cross-process claim, bypassing admission;
 *           `executeRpaTask` itself enqueues those retries on env-not-ready and
 *           BLOCKED — a second action the caller's ledger cannot see;
 *         - the target URL is navigated verbatim; nothing checks it belongs to
 *           the platform named;
 *         - cancellation is keyed on a `community_ai_actions` row id;
 *         - a journey step carries no target (post URL) and nothing maps a
 *           person to one.
 *   rpaWorker/redditRpaHandler.executeRedditRpaTask   unreferenced; no session,
 *       hard-coded selectors.
 *   networkExpansion/rpaDiscoveryHandlers/redditDiscoveryRpa   internal
 *       discovery: scrapes an arbitrary `source_url` for usernames. Not an
 *       action toward a person.
 *   ads/adsAcquisitionRunner, export/htmlToPdfRenderer,
 *   creatorRenderDurableQueue   internal acquisition and rendering.
 *
 * So the action and target allowlists below are EMPTY. Widening either one is
 * an owner decision that first needs an engine operation which (a) never acts
 * twice for one key, (b) enforces its own tenant policy/approval/kill switch and
 * (c) validates its target against the platform — see the workstream report.
 *
 * ─── WHAT THIS ADAPTER DOES ───────────────────────────────────────────────
 * Nothing external, ever: it imports no browser, RPA, queue or database module,
 * claims no channel (so the registry can never route a step to it), writes no
 * `execution_engine_requests` row (there is no action to deduplicate), and
 * answers every request `unsupported` + `needs_human` with a code-level reason.
 * The result is a pure function of the context, so repeats, concurrency,
 * timeouts and crashes in the engine cannot change it.
 */

import { BROWSER_CAPABILITIES } from './engineCapabilities';
import type { EngineAdapter, EngineResult, EngineStepContext } from './engineAdapters';

/** Operations of the browser engine a journey step may request. None. */
export const BROWSER_ACTION_ALLOWLIST: readonly string[] = Object.freeze([]);

/** Hosts a browser operation may navigate to. None. */
export const BROWSER_TARGET_HOST_ALLOWLIST: readonly string[] = Object.freeze([]);

/** Channels this adapter claims in the registry. None: it must never be routed to. */
export const BROWSER_ADAPTER_CHANNELS: readonly string[] = Object.freeze([]);

export type BrowserRefusal =
  | 'tenant_context_invalid'
  | 'no_operation_requested'
  | 'operation_not_allowlisted'
  | 'target_invalid'
  | 'target_not_allowlisted';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** What the step snapshot asked for, read defensively; never executed. */
function requestedOperation(step: unknown): { operation: string | null; target: string | null } {
  const browser = step && typeof step === 'object' ? (step as Record<string, unknown>).browser : null;
  if (!browser || typeof browser !== 'object') return { operation: null, target: null };
  const b = browser as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { operation: s(b.operation), target: s(b.target_url) };
}

function hostOf(target: string): string | null {
  try {
    const u = new URL(target);
    return u.protocol === 'https:' && u.username === '' && u.password === '' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * The refusal for a request. Pure. Checked in a fixed order so the reported
 * reason is stable: tenant, then operation, then target. With both allowlists
 * empty every request is refused.
 */
export function classifyBrowserRequest(ctx: EngineStepContext): BrowserRefusal {
  if (!UUID.test(String(ctx.organizationId ?? '').trim())) return 'tenant_context_invalid';
  const { operation, target } = requestedOperation(ctx.step);
  if (operation === null) return 'no_operation_requested';
  if (!BROWSER_ACTION_ALLOWLIST.includes(operation)) return 'operation_not_allowlisted';
  const host = target === null ? null : hostOf(target);
  if (host === null) return 'target_invalid';
  if (!BROWSER_TARGET_HOST_ALLOWLIST.includes(host)) return 'target_not_allowlisted';
  // Unreachable while the allowlists are empty; a widened allowlist still has no
  // execution path here and must not fall through to one.
  return 'operation_not_allowlisted';
}

const REASONS: Record<BrowserRefusal, string> = {
  tenant_context_invalid: 'browser_unsupported:tenant_context_invalid',
  no_operation_requested: 'browser_unsupported:no_journey_safe_browser_operation_exists',
  operation_not_allowlisted: 'browser_unsupported:operation_not_allowlisted',
  target_invalid: 'browser_unsupported:target_invalid',
  target_not_allowlisted: 'browser_unsupported:target_not_allowlisted',
};

export function createBrowserAdapter(): EngineAdapter {
  return {
    engine: 'browser',
    channels: BROWSER_ADAPTER_CHANNELS,
    capabilities: BROWSER_CAPABILITIES,
    async execute(ctx): Promise<EngineResult> {
      // `needs_human`, not `skipped`: an unsupported step must stay visible to a
      // person rather than silently advance the journey as if it were declined.
      return {
        engine: 'browser',
        outcome: 'unsupported',
        disposition: 'needs_human',
        reason: REASONS[classifyBrowserRequest(ctx)],
        externalRef: null,
      };
    },
  };
}
