/**
 * RPA browser-automation LOGIN BLOCK (owner decision #17, 2026-11-10).
 *
 * The live RPA session store writes Playwright storageState (session cookies) to
 * rpa_sessions in PLAINTEXT. The sealing code that encrypts it is not on main yet.
 * #17A scrubbed the existing plaintext rows and halted RPA tasks; this closes the
 * write path so no new plaintext session can be captured.
 *
 * Every route that issues an RPA auth token or saves a session answers 410 before
 * doing anything else: /api/rpa/auth/start, /api/rpa/auth/save-session and
 * /api/rpa/auth/complete. /api/rpa/auth/callback stays (read-only status).
 *
 * There is deliberately NO environment flag: nothing can re-enable it by accident.
 * Re-enabling is a code change (revert this module's use) after the sealing code is
 * live in both runtimes. The constant is typed `boolean` so TypeScript does not
 * treat the code after the guard as unreachable.
 */
import type { NextApiResponse } from 'next';

export const RPA_LOGIN_DISABLED: boolean = true;

export const RPA_DISABLED_BODY = Object.freeze({
  error: 'RPA_DISABLED',
  reason: 'Browser-automation logins are disabled until encrypted session storage ships.',
});

export function rejectRpaLogin(res: NextApiResponse): void {
  res.status(410).json(RPA_DISABLED_BODY);
}
