/**
 * BJC redaction gate (spec §2.1, decision D-12).
 *
 * Policy: BLOCK, never rewrite. If any text that would leave the machine has
 * a credential shape, nothing is sent and the request ends as
 * JUDGMENT_UNAVAILABLE / REDACTION_BLOCK. Findings carry the pattern name and
 * the field path only — never the matched value.
 */

const SECRET_SHAPES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: 'supabase-secret-key', re: /\bsb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./ },
  { name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'stripe-key', re: /\b(?:sk|rk|pk)_live_[A-Za-z0-9]{10,}/ },
  { name: 'webhook-secret', re: /\bwhsec_[A-Za-z0-9]{10,}/ },
  { name: 'private-key-block', re: new RegExp('-----BEGIN [A-Z ]*PRIVATE KEY-----') },
  { name: 'url-with-password', re: /[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i },
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/ },
  {
    name: 'assigned-credential',
    re: /\b[A-Za-z_]*(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]?[A-Za-z0-9/+_.~-]{16,}/i,
  },
];

export interface RedactionFinding {
  path: string;
  pattern: string;
}

/** Walk every string in `value`; return one finding per (path, pattern). */
export function findSecretShapes(value: unknown, path = '$'): RedactionFinding[] {
  if (typeof value === 'string') {
    return SECRET_SHAPES.filter((s) => s.re.test(value)).map((s) => ({ path, pattern: s.name }));
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findSecretShapes(v, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => findSecretShapes(v, `${path}.${k}`));
  }
  return [];
}
