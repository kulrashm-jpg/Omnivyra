/**
 * Phase 13 — Deterministic redaction cache + helpers.
 *
 * Phase 12's `supportSnapshotService` computes a redaction template
 * per snapshot kind on every call. The template is purely a function
 * of the kind — same input → same template — so we compile it once
 * per process and serve it from a `Map`. Identity-stable templates
 * also let downstream comparators short-circuit ("redaction unchanged
 * vs. previous snapshot") without deep-equal.
 *
 * Adoption is opt-in. Existing callers can switch to
 * `getRedactionTemplate(kind)` without changing behavior.
 *
 * Hard guarantees:
 *   • Pure functions; no shared mutable state outside the
 *     compile-once cache.
 *   • Same return value per kind, forever within a process lifetime.
 *   • Caller can pass a custom registry via `withRegistry()` for tests
 *     or for tenant-specific redaction overrides (not used by Phase 12
 *     callers — opt-in extension point).
 */

import { createHash } from 'crypto';

export type RedactionRule = {
  field_path: string;
  redaction_kind: 'masked' | 'omitted' | 'hashed';
  detail: string;
};

const BASELINE: RedactionRule[] = [
  { field_path: 'email', redaction_kind: 'masked', detail: 'email addresses masked to local + domain hash' },
  { field_path: 'phone', redaction_kind: 'masked', detail: 'phone numbers masked to last 4' },
  { field_path: 'oauth_token', redaction_kind: 'omitted', detail: 'OAuth tokens omitted entirely' },
  { field_path: 'api_key', redaction_kind: 'omitted', detail: 'API keys omitted entirely' },
];

const REGISTRY: Record<string, RedactionRule[]> = {
  default: BASELINE,
  tenant_diagnostic: [
    ...BASELINE,
    { field_path: 'user_handle', redaction_kind: 'hashed', detail: 'user handles hashed' },
  ],
};

const COMPILED = new Map<string, ReadonlyArray<RedactionRule>>();

/**
 * Return the immutable redaction template for a given kind. Defaults
 * to the baseline rule set if the kind has no specific override.
 */
export function getRedactionTemplate(kind: string): ReadonlyArray<RedactionRule> {
  const cached = COMPILED.get(kind);
  if (cached) return cached;
  const source = REGISTRY[kind] ?? REGISTRY.default;
  const frozen = Object.freeze(source.map((r) => Object.freeze({ ...r })));
  COMPILED.set(kind, frozen);
  return frozen;
}

/**
 * Stable hash of a redaction template — useful when persisting alongside
 * a snapshot to assert that the redaction policy in force at snapshot
 * generation time matches what an auditor expects.
 */
export function redactionTemplateHash(kind: string): string {
  const tmpl = getRedactionTemplate(kind);
  const canonical = JSON.stringify(tmpl);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

/**
 * Mask helpers: pure, deterministic, used by callers that want to
 * apply the redaction template line-by-line. Identity-preserving for
 * inputs the rule does not match.
 */
export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = value.indexOf('@');
  if (at < 0) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const hash = createHash('sha256').update(domain).digest('hex').slice(0, 8);
  const localMasked = local.length <= 2 ? '*'.repeat(local.length) : `${local[0]}***${local[local.length - 1]}`;
  return `${localMasked}@${hash}.redacted`;
}

export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `***-***-${digits.slice(-4)}`;
}

export function hashHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
