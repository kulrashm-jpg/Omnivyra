/**
 * workspaceConsumptionGuard — Phase-2 Step-30.
 *
 * Detects when workspace UI reads LEGACY execution signals directly
 * (bypassing the canonical render authority), emits observability, and
 * exposes fail-soft migration helpers so panels can switch to authoritative
 * consumption WITHOUT a redesign.
 *
 * Pure detection + logging. NEVER throws, NEVER mutates, NEVER changes what
 * renders — it only surfaces bypasses and offers a guarded selector. Legacy
 * remains the fallback (rollback / SHADOW / LEGACY / missing projection).
 */

function log(tag: string, payload: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a guard log */
  }
}

/** Legacy execution-state keys a panel must NOT consume directly anymore. */
export const LEGACY_DIRECT_SIGNALS = [
  'content_status',
  'creator_asset',
  'creator_lifecycle_state',
  'uploaded_media_url',
  'asset_payload',
  'execution_mode',
  'scheduled_for',
  'scheduling_status',
] as const;
export type LegacyDirectSignal = (typeof LEGACY_DIRECT_SIGNALS)[number];

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export interface DirectReadViolation {
  panel_name: string;
  signals: LegacyDirectSignal[];
  count: number;
}

/**
 * Inspect the raw resolve payload a panel receives. Reports which legacy
 * signals are PRESENT (and therefore at risk of direct consumption) on
 * `dailyExecutionItem` / the payload root. Detection only — fail-soft.
 */
export function detectDirectReads(
  panelName: string,
  rawPayload: unknown,
): DirectReadViolation {
  const payload = obj(rawPayload);
  const daily = obj(payload.dailyExecutionItem);
  const found: LegacyDirectSignal[] = [];
  for (const sig of LEGACY_DIRECT_SIGNALS) {
    if (sig in daily || sig in payload) found.push(sig);
  }
  const violation: DirectReadViolation = {
    panel_name: panelName,
    signals: found,
    count: found.length,
  };
  log('WORKSPACE_CONSUMPTION_GUARD', {
    panel_name: panelName,
    direct_read_detected: found.length > 0,
    signals: found,
  });
  if (found.length > 0) {
    log('WORKSPACE_DIRECT_READ', {
      panel_name: panelName,
      direct_read_detected: true,
      signals: found,
      count: found.length,
    });
  }
  return violation;
}

/**
 * Guarded selector — the one-line migration path for a panel. Returns the
 * authoritative value when the workspace is in AUTHORITATIVE mode and the
 * value is defined; otherwise the legacy value (fallback-only). Logs a
 * bypass whenever legacy is served while an authoritative value existed.
 */
export function guardedRead<T>(params: {
  panelName: string;
  signal: string;
  workspaceMode: string;
  authoritative: T | null | undefined;
  legacy: T;
}): T {
  const authoritativeAvailable =
    params.workspaceMode === 'AUTHORITATIVE' &&
    params.authoritative !== null &&
    params.authoritative !== undefined;
  if (authoritativeAvailable) {
    return params.authoritative as T;
  }
  const bypassed =
    params.authoritative !== null &&
    params.authoritative !== undefined &&
    params.workspaceMode !== 'AUTHORITATIVE';
  log(bypassed ? 'WORKSPACE_PANEL_FALLBACK' : 'WORKSPACE_PANEL_AUTHORITY', {
    panel_name: params.panelName,
    signal: params.signal,
    workspace_mode: params.workspaceMode,
    authority_bypassed: bypassed,
    fallback_active: true,
  });
  return params.legacy;
}

/**
 * Panel-level authority resolver. Given the central hook output `d`, return
 * the canonical render bundle a panel should consume + emit panel authority
 * / fallback observability. `d` is the `useActivityWorkspace(...)` result
 * (typed loose to avoid a UI-layer import cycle).
 */
export function panelAuthority(
  panelName: string,
  d: Record<string, unknown> | null | undefined,
): {
  mode: string;
  fallbackActive: boolean;
  render: Record<string, unknown> | null;
} {
  const hook = obj(d);
  const mode = String(hook.workspaceMode ?? 'LEGACY');
  const fallbackActive = mode !== 'AUTHORITATIVE';
  const render = {
    executionMode: hook.executionMode ?? null,
    isCreatorActivity: hook.isCreatorActivity ?? null,
    hasCreatorAsset: hook.hasCreatorAsset ?? null,
    renderReadinessState: hook.renderReadinessState ?? null,
    renderSchedulingState: hook.renderSchedulingState ?? null,
    renderAiAssetState: hook.renderAiAssetState ?? null,
    renderUploadRequired: hook.renderUploadRequired ?? null,
    renderBlockingReasons: hook.renderBlockingReasons ?? null,
    renderRoutingLineage: hook.renderRoutingLineage ?? null,
    renderProvenance: hook.renderProvenance ?? null,
  };
  log(fallbackActive ? 'WORKSPACE_PANEL_FALLBACK' : 'WORKSPACE_PANEL_AUTHORITY', {
    panel_name: panelName,
    workspace_mode: mode,
    fallback_active: fallbackActive,
  });
  return { mode, fallbackActive, render };
}

export interface ConsumptionDiffExtension {
  direct_consumption_violations: number;
  authority_bypassed: boolean;
  bypassed_signals: string[];
  panel_orchestration_fidelity: boolean;
}

/**
 * Extend the Step-29 render diff with panel-consumption fidelity and emit
 * [WORKSPACE_PANEL_DIFF]. `baseDiff` is the Step-29 RenderDiffResult shape
 * (loose) — combined fidelity = render fidelity AND zero direct violations.
 */
export function extendRenderDiffWithConsumption(params: {
  panelName: string;
  campaignId?: string | null;
  executionId?: string | null;
  workspaceMode: string;
  baseDiff: { orchestration_fidelity?: boolean; mismatch_count?: number } | null;
  violation: DirectReadViolation;
}): ConsumptionDiffExtension {
  const renderFidelity = params.baseDiff?.orchestration_fidelity ?? true;
  const authorityBypassed =
    params.violation.count > 0 && params.workspaceMode !== 'AUTHORITATIVE';
  const ext: ConsumptionDiffExtension = {
    direct_consumption_violations: params.violation.count,
    authority_bypassed: authorityBypassed,
    bypassed_signals: params.violation.signals,
    panel_orchestration_fidelity: renderFidelity && params.violation.count === 0,
  };
  log('WORKSPACE_PANEL_DIFF', {
    panel_name: params.panelName,
    campaign_id: params.campaignId ?? null,
    execution_id: params.executionId ?? null,
    workspace_mode: params.workspaceMode,
    direct_read_detected: params.violation.count > 0,
    authority_bypassed: authorityBypassed,
    mismatch_count: params.baseDiff?.mismatch_count ?? 0,
    panel_orchestration_fidelity: ext.panel_orchestration_fidelity,
  });
  return ext;
}
