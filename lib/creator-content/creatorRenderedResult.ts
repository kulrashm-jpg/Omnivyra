import type { CreatorResult } from './creatorWorkflowModel';
import { refreshDiagnosticReportVisuals } from '../../backend/services/creator/creatorDiagnosticReport';

export function shouldOfferInlineCreatorRender(status: string | undefined, _queuedSeconds: number): boolean {
  if (status === 'failed' || status === 'cancelled' || status === 'dead_letter') return true;
  return false;
}

export const CREATOR_RENDER_POLL_MAX_ATTEMPTS = 90;

export function hasCreatorRenderPollExhausted(attempts: number): boolean {
  return attempts >= CREATOR_RENDER_POLL_MAX_ATTEMPTS;
}

export function isCreatorRenderJobStatus(
  status: unknown,
): status is 'queued' | 'active' | 'completed' | 'failed' | 'cancelled' | 'dead_letter' | 'waiting' {
  return status === 'queued'
    || status === 'active'
    || status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'dead_letter'
    || status === 'waiting';
}

export type CreatorRenderJobStatusResponse = {
  success?: boolean;
  render_job?: {
    status?: string;
    progress?: number;
    attemptsMade?: number;
    result?: { url?: string; files?: string[]; metadata?: Record<string, unknown> };
  };
};

export async function fetchCreatorRenderJobStatus(
  jobId: string,
  signal: AbortSignal,
  fetchStatus: (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>> = fetch,
): Promise<CreatorRenderJobStatusResponse> {
  const response = await fetchStatus(
    `/api/command-center/creator-content/render-job/${encodeURIComponent(jobId)}`,
    { credentials: 'include', signal },
  );
  if (!response.ok) {
    throw new Error(`Render status request failed (HTTP ${response.status}).`);
  }

  let payload: CreatorRenderJobStatusResponse | null;
  try {
    payload = await response.json() as CreatorRenderJobStatusResponse;
  } catch {
    throw new Error('Render status response was malformed.');
  }
  const renderJob = payload?.render_job;
  if (!payload || !renderJob || !isCreatorRenderJobStatus(renderJob.status)) {
    throw new Error('Render status response was malformed.');
  }
  const status = renderJob.status;
  if (status === 'completed' && !payload?.render_job?.result) {
    throw new Error('Completed render response did not include a result.');
  }
  return payload;
}

export function creatorRenderPollStatus(status: string):
  'queued' | 'active' | 'completed' | 'failed' | 'cancelled' | 'dead_letter' | 'waiting' {
  switch (status) {
    case 'completed': return 'completed';
    case 'active': return 'active';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'dead_letter': return 'dead_letter';
    case 'waiting': return 'waiting';
    default: return 'queued';
  }
}

export function creatorRenderPollTerminalMessage(
  reason: 'status_unavailable' | 'timed_out' | 'not_completed',
): string {
  if (reason === 'timed_out') {
    return 'Render status could not be confirmed before polling timed out. '
      + 'Your structured copy is preserved; the worker may still be running. Check saved assets and do not retry inline until a terminal status is confirmed.';
  }
  if (reason === 'not_completed') {
    return 'Rendering did not finish within 90 status checks. Your structured copy is preserved; the worker may still be running. Check saved assets and do not retry inline until a terminal status is confirmed.';
  }
  return 'Render status could not be confirmed after repeated status-check failures. '
    + 'Your structured copy is preserved; the worker may still be running. Check saved assets and do not retry inline until a terminal status is confirmed.';
}

export function creatorRenderPollFailureReason(error: unknown): 'status_unavailable' | 'timed_out' {
  return error instanceof Error && error.name === 'AbortError' ? 'timed_out' : 'status_unavailable';
}

export function mergeRenderedCreatorResult(
  current: CreatorResult | null,
  expected: CreatorResult,
  rendered: {
    url?: string;
    files?: string[];
    metadata?: Record<string, unknown>;
  },
  renderedVia?: string,
): CreatorResult | null {
  if (current !== expected) return current;

  const assetPayload = current.output.asset_payload;
  const existingBundle = assetPayload.media_bundle ?? {};
  const existingMeta = (existingBundle.metadata ?? {}) as Record<string, unknown>;
  const renderedMeta = (rendered.metadata ?? {}) as Record<string, unknown>;
  // The async render carries the FRESH visual verdict. The diagnostic report
  // was built before the render finished, so its verdict is stale: refresh its
  // render-derived parts from the merged metadata instead of keeping it.
  const mergedForReport = { ...existingMeta, ...renderedMeta };
  const hasFreshVerdict = !!renderedMeta.visual_validation && typeof renderedMeta.visual_validation === 'object';
  const refreshedReport = hasFreshVerdict && existingMeta.creator_diagnostic_report && !renderedMeta.creator_diagnostic_report
    ? refreshDiagnosticReportVisuals(existingMeta.creator_diagnostic_report, mergedForReport)
    : null;
  return {
    ...current,
    output: {
      ...current.output,
      asset_payload: {
        ...assetPayload,
        media_bundle: {
          ...existingBundle,
          ...(rendered.url ? { url: rendered.url } : {}),
          ...(rendered.files?.length ? { files: rendered.files } : {}),
          metadata: {
            ...(existingBundle.metadata ?? {}),
            ...(rendered.metadata ?? {}),
            ...(refreshedReport ? { creator_diagnostic_report: refreshedReport } : {}),
            render_async: false,
            render_completed_at: new Date().toISOString(),
            ...(renderedVia ? { rendered_via: renderedVia } : {}),
          },
        },
      },
    },
  };
}
