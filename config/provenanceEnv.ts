/**
 * Release-provenance environment reads.
 *
 * A platform may define a provenance variable as an EMPTY STRING rather than
 * leaving it unset. Vercel does exactly that for `VERCEL_GIT_COMMIT_SHA` on CLI
 * deploys. `??` only falls through on null/undefined, so an empty value WINS the
 * chain and the deployment reports no commit at all — `/api/health/version` then
 * serves `build: ""`, which is indistinguishable from "this build has no
 * provenance" and silently defeats every downstream reconciliation.
 *
 * Treat empty/whitespace-only as ABSENT so the next source is consulted.
 */
export function firstNonEmptyEnv(...names: readonly string[]): string | null {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}
