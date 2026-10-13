/**
 * Closure-014 (C) — the ONE call a super-admin UI write makes.
 *
 * Wraps submitSuperAdminWrite (passkey step-up on 401 STEP_UP_REQUIRED /
 * TRUSTED_DEVICE_REQUIRED, exactly ONE retry, never success after a cancel or a
 * failed ceremony) and turns every non-2xx into ONE actionable message, so call
 * sites never show "saved" for a refusal and never re-implement classification.
 *
 *   performSuperAdminWrite(fire, opts) →
 *     { ok: true,  status, body }          the write succeeded (2xx)
 *     { ok: false, status, message, code } nothing to report as done
 *
 * `fire` MUST build a fresh request each call (and, for idempotent routes, a
 * fresh Idempotency-Key): the retry after step-up is a second request.
 * `interactive: false` (automatic refresh, background save) never raises a
 * passkey prompt — it reports that a confirmation is needed instead.
 */
import { submitSuperAdminWrite } from './superAdminStepUp';

/**
 * Both arms carry every field (null on the arm where it does not apply) so call
 * sites in the non-strict frontend project — where `if (!r.ok)` does not narrow
 * a discriminated union — can read `r.message` without a cast.
 */
export type SuperAdminWriteOutcome =
  | { ok: true; status: number; body: unknown; message: null; code: null }
  | { ok: false; status: number | null; body: null; message: string; code: string | null };

type Body = { error?: unknown; message?: unknown; code?: unknown; details?: unknown } | null;

async function readBody(response: Response): Promise<Body> {
  try {
    const source = typeof response.clone === 'function' ? response.clone() : response;
    return (await source.json()) as Body;
  } catch {
    try {
      const text = await response.text();
      return text ? { error: text.slice(0, 300) } : null;
    } catch {
      return null;
    }
  }
}

/** Seconds from a Retry-After header (delta-seconds or HTTP-date); null when absent/unparseable. */
export function retryAfterSeconds(headers: Headers | null | undefined, now = Date.now()): number | null {
  const raw = headers?.get?.('retry-after');
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** One actionable sentence for a refused super-admin write. */
export function describeWriteFailure(status: number, body: Body, headers?: Headers | null): string {
  const code = str(body?.code);
  const serverMessage = str(body?.error) ?? str(body?.message);
  if (status === 401) {
    if (code === 'STEP_UP_REQUIRED' || code === 'TRUSTED_DEVICE_REQUIRED') {
      return 'This action needs a passkey confirmation on a trusted device. Run it again from its button to confirm.';
    }
    return 'Your session has expired. Sign in again, then retry.';
  }
  if (status === 403) {
    if (code === 'PLATFORM_SUPER_ADMIN_REQUIRED') return 'Only an active platform super-admin can make this change.';
    if (code === 'CAPABILITY_NOT_HELD') return 'Your account does not have permission for this change. Ask a platform super-admin.';
    return serverMessage ? `Not allowed: ${serverMessage}` : 'Not allowed for your account.';
  }
  if (status === 409) {
    return serverMessage
      ? `Conflict: ${serverMessage} Refresh and try again.`
      : 'This item changed or the same request is already running. Refresh and try again.';
  }
  if (status === 429) {
    const wait = retryAfterSeconds(headers ?? null);
    return wait !== null
      ? `Too many requests. Wait ${wait} second${wait === 1 ? '' : 's'} and try again.`
      : 'Too many requests. Wait about a minute and try again.';
  }
  if (status >= 500) return serverMessage ? `Server error: ${serverMessage}` : `Server error (${status}). Nothing was confirmed as saved; try again.`;
  return serverMessage ?? `Request failed (${status}).`;
}

export async function performSuperAdminWrite(
  fire: () => Promise<Response>,
  options: { interactive?: boolean; onChallengeStart?: () => void } = {},
): Promise<SuperAdminWriteOutcome> {
  let result;
  try {
    result = await submitSuperAdminWrite(fire, options);
  } catch {
    return { ok: false, status: null, body: null, message: 'Network error. Nothing was confirmed as saved; check your connection and try again.', code: null };
  }
  if (result.status === 'blocked') return { ok: false, status: null, body: null, message: result.message, code: null };
  const body = await readBody(result.response);
  if (result.status === 'ok') return { ok: true, status: result.response.status, body, message: null, code: null };
  return {
    ok: false,
    status: result.response.status,
    body: null,
    message: describeWriteFailure(result.response.status, body, result.response.headers),
    code: str(body?.code),
  };
}

/** Header bag with a FRESH Idempotency-Key per call (each retry is its own request). */
export function freshIdempotencyHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...extra };
}
