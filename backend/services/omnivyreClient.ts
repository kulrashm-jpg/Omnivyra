import { ViralitySnapshot } from './viralitySnapshotBuilder';
import { DiagnosticsByType, DiagnosticComparisons } from './viralityAdvisorService';

export interface DecideRequest {
  campaign_id: string;
  snapshot_hash: string;
  model_version: string;
  snapshot: ViralitySnapshot;
  virality_signals: {
    diagnostics: DiagnosticsByType;
    comparisons: DiagnosticComparisons[];
    overall_summary: string;
  };
}

export interface DecisionResult {
  status: 'ok' | 'error';
  decision_id?: string;
  recommendation?: string;
  raw?: any;
  error?: {
    message: string;
    status?: number;
  };
}

const DEFAULT_TIMEOUT_MS = 8000;

function getBaseUrl(): string {
  const baseUrl = process.env.OMNIVYRE_BASE_URL;
  if (!baseUrl) {
    throw new Error('Missing OMNIVYRE_BASE_URL');
  }
  return baseUrl.replace(/\/$/, '');
}

export function buildDecideRequest(input: {
  campaign_id: string;
  snapshot_hash: string;
  model_version: string;
  snapshot: ViralitySnapshot;
  diagnostics: DiagnosticsByType;
  comparisons: DiagnosticComparisons[];
  overall_summary: string;
}): DecideRequest {
  return {
    campaign_id: input.campaign_id,
    snapshot_hash: input.snapshot_hash,
    model_version: input.model_version,
    snapshot: input.snapshot,
    virality_signals: {
      diagnostics: input.diagnostics,
      comparisons: input.comparisons,
      overall_summary: input.overall_summary,
    },
  };
}

export async function requestDecision(
  payload: DecideRequest,
  options?: { timeoutMs?: number }
): Promise<DecisionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options?.timeoutMs || DEFAULT_TIMEOUT_MS
  );

  try {
    const response = await fetch(`${getBaseUrl()}/omnivyre/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let rawJson: any = null;
    if (rawText) {
      try {
        rawJson = JSON.parse(rawText);
      } catch (error) {
        rawJson = { raw_text: rawText };
      }
    }

    if (!response.ok) {
      return {
        status: 'error',
        error: {
          message: rawJson?.error || response.statusText || 'Omnivyre error',
          status: response.status,
        },
        raw: rawJson,
      };
    }

    return {
      status: 'ok',
      decision_id: rawJson?.decision_id,
      recommendation: rawJson?.recommendation,
      raw: rawJson,
    };
  } catch (error: any) {
    return {
      status: 'error',
      error: {
        message: error?.name === 'AbortError' ? 'Omnivyre request timed out' : error?.message,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
