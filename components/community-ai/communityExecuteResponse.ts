/**
 * How the community actions UI reads /api/community-ai/actions/execute and
 * /api/community-ai/actions/approve responses (Prompt 3 response mapping).
 *
 *   200            executed (or an idempotent replay of a finished action)
 *   202            AWAITING_EXTENSION: queued for the browser extension, not yet sent
 *   503            EXTENSION_NOT_READY: queued, but no extension is connected
 *   409            a genuine claim conflict (ACTION_CLAIM_CONFLICT, ACTION_IN_PROGRESS,
 *                  ACTION_DISPATCHED): someone else holds the action
 *   422            ACTION_TERMINAL / ACTION_NOT_EXECUTABLE: it already ended
 *   423            COMMUNITY_EXECUTION_DISABLED: kill switch or tenant policy (code in body)
 *   403            APPROVAL_REQUIRED / APPROVAL_EXPIRED / APPROVAL_EVIDENCE_REQUIRED
 *   401            PASSKEY_REQUIRED (approve) or STEP_UP_REQUIRED (session step-up)
 *
 * Pure: no fetch, no React. The server is the only authority; this only words it.
 */

export type CommunityResponseOutcome = {
  /** The request did what was asked (executed, queued, or approved). */
  ok: boolean;
  /** Show this to the person (null when there is nothing to say). */
  message: string | null;
  /** The action's status as the server reported it, when known. */
  status: string | null;
  /** Reload the list: the action's state changed elsewhere. */
  reload: boolean;
  /** The person must approve again (expired or unusable approval). */
  reapprove: boolean;
  /** A passkey / step-up verification is needed. */
  stepUp: boolean;
};

const out = (o: Partial<CommunityResponseOutcome>): CommunityResponseOutcome => ({
  ok: false, message: null, status: null, reload: false, reapprove: false, stepUp: false, ...o,
});

type Body = { error?: unknown; code?: unknown; status?: unknown; current_status?: unknown; reason?: unknown } | null | undefined;

const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function readExecuteResponse(httpStatus: number, body: Body): CommunityResponseOutcome {
  const error = s(body?.error);
  const code = s(body?.code);
  const status = s(body?.status) ?? s(body?.current_status);
  if (httpStatus === 202 || code === 'AWAITING_EXTENSION') {
    return out({ ok: true, status: status ?? 'pending', message: 'Queued for the browser extension; it is sent when the extension picks it up.', reload: true });
  }
  if (httpStatus >= 200 && httpStatus < 300) return out({ ok: true, status, reload: true });
  if (httpStatus === 503 && (error === 'EXTENSION_NOT_READY' || code === 'EXTENSION_NOT_READY')) {
    return out({ status, message: 'Queued, but no browser extension is connected. Open the extension to send it.', reload: true });
  }
  if (httpStatus === 409) {
    if (error === 'ACTION_DISPATCHED') return out({ status, message: 'The browser extension is already sending this action.', reload: true });
    if (error === 'ACTION_IN_PROGRESS' || error === 'ACTION_CLAIM_CONFLICT') {
      return out({ status, message: 'This action is already being executed.', reload: true });
    }
    return out({ status, message: error || 'This action changed; reload and try again.', reload: true });
  }
  if (httpStatus === 422) return out({ status, message: `This action already ended${status ? ` (${status})` : ''}.`, reload: true });
  if (httpStatus === 423) {
    return out({ message: `Community execution is disabled for this workspace${code ? ` (${code})` : ''}. Nothing was sent.` });
  }
  if (httpStatus === 403) {
    if (error === 'APPROVAL_EXPIRED') return out({ message: 'The approval is older than 7 days. Approve it again to execute.', reapprove: true, reload: true });
    if (error === 'APPROVAL_EVIDENCE_REQUIRED') {
      return out({ message: `This approval cannot be used${code ? ` (${code})` : ''}. Approve it again to execute.`, reapprove: true, reload: true });
    }
    if (error === 'APPROVAL_REQUIRED') return out({ message: 'Approve this action before executing it.', reapprove: true });
    return out({ message: error || 'Not allowed.' });
  }
  if (httpStatus === 401 && (error === 'PASSKEY_REQUIRED' || code === 'STEP_UP_REQUIRED')) {
    return out({ message: 'Verify with your passkey to continue.', stepUp: true });
  }
  return out({ message: error || 'Execution failed', status });
}

export function readApproveResponse(httpStatus: number, body: Body): CommunityResponseOutcome {
  const error = s(body?.error);
  const code = s(body?.code);
  if (httpStatus >= 200 && httpStatus < 300) return out({ ok: true, status: s(body?.status) ?? 'approved', reload: true });
  if (httpStatus === 401 && (error === 'PASSKEY_REQUIRED' || code === 'STEP_UP_REQUIRED')) {
    return out({ message: 'The passkey verification did not complete. Try approving again.', stepUp: true });
  }
  if (httpStatus === 409 && error === 'APPROVAL_STALE') {
    return out({ message: 'The action changed after it was shown. Review it again before approving.', reload: true });
  }
  if (httpStatus === 409) return out({ message: error || 'This action can no longer be approved.', reload: true });
  return out({ message: error || 'Approval failed' });
}
