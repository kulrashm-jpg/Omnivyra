/**
 * Protected-path enforcement after intake (harness certification gap B3).
 *
 * `gov intake` refuses work that touches a default prohibited path
 * (supabase/migrations/**, .env*, deployment configuration, …) unless a
 * reviewed `protected_path_authorizations` entry lifts it for exact files.
 * A Story created by hand in Jira never passes through intake, so its own
 * Authorized Paths could reach those files. This module carries the same
 * policy into `gov verify` and `gov check-merge`: a changed protected path is
 * accepted ONLY when the packet's Story Invariants cite a reviewed
 * authorization (exact id and digest, the line intake writes) that lists that
 * exact file, and the packet carries the authorization's required
 * verification. Everything else fails closed.
 *
 * Refusal only: this module grants nothing. A path it accepts must still pass
 * the Story's own Authorized / Prohibited Paths (scope.ts). The policy is the
 * reviewed intake-rules.json of the tool checkout; nothing here reads Jira,
 * git, JEV or the network, and nothing is written. Pure apart from the file
 * read in `loadProtectedPathPolicy`.
 */
import fs from 'node:fs';
import { DEFAULT_INTAKE_RULES_FILE, authorizationDigest, validateIntakeRules, type IntakeRules, type ProtectedPathAuthorization } from './intake';
import { matchesPattern } from './scope';
import type { Sha256Ref, VerificationRegistry } from './types';

export interface ProtectedPathPolicy {
  /** Patterns no Story may touch without an exact reviewed authorization (intake's default prohibited paths). */
  protected_patterns: string[];
  /** Reviewed exact-path authorizations, keyed by id. */
  authorizations: ProtectedPathAuthorization[];
}

export interface CitedAuthorization {
  id: string;
  digest: Sha256Ref;
}

export interface ProtectedPathResult {
  ok: boolean;
  /** Changed paths under a protected pattern (sorted). */
  protected_changed: string[];
  /** Protected changed paths that no valid cited authorization lists exactly (sorted). */
  unauthorized: string[];
  /** Problems with the authorizations the packet cites (sorted); any problem fails closed. */
  problems: string[];
}

/** Line prefix intake writes into Story Invariants for an applied authorization. */
export const AUTHORIZATION_INVARIANT_PREFIX = 'Protected-path authorization ';

/** `Protected-path authorization <id> (sha256:<hex>): …` — exactly the intake format. */
const AUTHORIZATION_INVARIANT_RE = /^Protected-path authorization ([a-z0-9][a-z0-9._-]{1,63}) \((sha256:[0-9a-f]{64})\): /;

export function protectedPathPolicy(rules: IntakeRules): ProtectedPathPolicy {
  return {
    protected_patterns: [...rules.default_prohibited_paths],
    authorizations: rules.protected_path_authorizations.map((a) => ({ ...a, paths: [...a.paths], required_verification: [...a.required_verification] })),
  };
}

/**
 * The reviewed policy of this tool checkout's intake-rules.json. Only the protected part is
 * validated (default prohibited paths and authorizations, whose required ids must exist in
 * `registry`); intake's path → registry mappings play no part in enforcement. Throws when the
 * file is missing or invalid (callers fail closed).
 */
export function loadProtectedPathPolicy(registry: VerificationRegistry, file: string = DEFAULT_INTAKE_RULES_FILE): ProtectedPathPolicy {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('intake rules: not an object');
  return protectedPathPolicy(validateIntakeRules({ ...raw, verification_mappings: [] }, registry));
}

/** Authorizations cited in Story Invariants; a line with the prefix that does not parse is malformed. Pure. */
export function parseCitedAuthorizations(invariants: readonly string[]): { cited: CitedAuthorization[]; malformed: string[] } {
  const cited: CitedAuthorization[] = [];
  const malformed: string[] = [];
  for (const line of invariants ?? []) {
    if (typeof line !== 'string' || !line.startsWith(AUTHORIZATION_INVARIANT_PREFIX)) continue;
    const m = AUTHORIZATION_INVARIANT_RE.exec(line);
    if (m) cited.push({ id: m[1], digest: m[2] as Sha256Ref });
    else malformed.push(line);
  }
  return { cited, malformed };
}

function posix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Pure verdict for the changed paths of a governed range. ok iff every changed
 * protected path is listed exactly by a valid cited authorization and no cited
 * authorization is malformed, unknown, digest-mismatched or missing its
 * required verification.
 */
export function evaluateProtectedPaths(
  changed: readonly string[],
  packet: { invariants: readonly string[]; registry_ids: readonly string[] },
  policy: ProtectedPathPolicy,
): ProtectedPathResult {
  const paths = [...new Set(changed.map(posix).filter((p) => p !== ''))].sort();
  const protected_changed = paths.filter((p) => policy.protected_patterns.some((pat) => matchesPattern(p, pat)));
  const problems: string[] = [];
  const { cited, malformed } = parseCitedAuthorizations(packet.invariants);
  for (const line of malformed) problems.push(`malformed protected-path authorization invariant: ${line.slice(0, 120)}`);
  const lifted = new Set<string>();
  for (const c of cited) {
    const reviewed = policy.authorizations.find((a) => a.id === c.id);
    if (!reviewed) {
      problems.push(`UNKNOWN_AUTHORIZATION ${c.id}: not in the reviewed intake rules`);
      continue;
    }
    if (authorizationDigest(reviewed) !== c.digest) {
      problems.push(`AUTHORIZATION_DIGEST_MISMATCH ${c.id}: the Story cites ${c.digest}, the reviewed rules hold ${authorizationDigest(reviewed)}`);
      continue;
    }
    const missing = reviewed.required_verification.filter((id) => !packet.registry_ids.includes(id));
    if (missing.length > 0) {
      problems.push(`AUTHORIZATION_VERIFICATION_MISSING ${c.id}: ${missing.join(', ')}`);
      continue;
    }
    for (const p of reviewed.paths) lifted.add(p);
  }
  const unauthorized = protected_changed.filter((p) => !lifted.has(p));
  problems.sort();
  return { ok: unauthorized.length === 0 && problems.length === 0, protected_changed, unauthorized, problems };
}

/** One-line refusal text for verify / check-merge. */
export function describeProtectedViolation(r: ProtectedPathResult): string {
  const parts: string[] = [];
  if (r.unauthorized.length > 0) parts.push(`protected path(s) without an exact reviewed authorization: ${r.unauthorized.join(', ')}`);
  if (r.problems.length > 0) parts.push(r.problems.join('; '));
  return parts.join('; ');
}
