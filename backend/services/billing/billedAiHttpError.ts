/**
 * Maps a runBilledAiCompletion refusal (BilledAiNotExecutedError) to the EXISTING HTTP shapes used by the
 * activity-workspace monetized workflows (contentRouteModel.ts MonetizedWorkflowError payloads), so every
 * runBilledAiCompletion route answers a refusal the same way: 402 insufficient / no account, 403 scope or org
 * control, 409 already settled. Returns null for any other error (the caller's own handling applies).
 */
import { BilledAiNotExecutedError } from './runBilledAiCompletion';

export function billedAiHttpError(err: unknown): { status: number; body: Record<string, unknown> } | null {
  if (!(err instanceof BilledAiNotExecutedError)) return null;
  const detail = err.detail as { required?: number; available?: number; code?: string; reason?: string };
  switch (err.status) {
    case 'insufficient_credits':
      return { status: 402, body: { error: 'Insufficient credits to generate content', required: detail.required, balance: detail.available } };
    case 'no_credit_account':
      return { status: 402, body: { error: 'No credit account for org' } };
    case 'not_a_member':
      return { status: 403, body: { error: 'ORG_SCOPE_VIOLATION' } };
    case 'org_control_blocked':
      return { status: 403, body: { error: detail.code, detail: detail.reason } };
    case 'already_confirmed':
      // The identical request was already processed AND charged (double-click / network retry). Not a failure:
      // the client should treat it as done and refresh.
      return { status: 409, body: { error: 'This request was already processed.', code: 'ALREADY_PROCESSED' } };
    case 'already_released':
      // Only reachable past the http reclaim cap (or for non-http keys): the earlier attempt failed, nothing charged.
      return { status: 409, body: { error: 'An earlier attempt of this request failed and was not charged. Please try again.', code: 'ALREADY_RELEASED' } };
    default:
      return { status: 409, body: { error: `Credit reservation is already settled: ${err.status}` } };
  }
}
