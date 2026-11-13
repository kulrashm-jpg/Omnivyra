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
    default:
      return { status: 409, body: { error: `Credit reservation is already settled: ${err.status}` } };
  }
}
