/**
 * Central log redaction (SEC log-redaction programme).
 *
 * WHY: credentials reached public git history and agent transcripts. Logs are the next
 * most likely leak path: a provider error, a request echo, an env dump or a raw Error
 * with an attached request config is serialised verbatim by `JSON.stringify`.
 *
 * `redact(value)` is applied by `backend/services/logger.ts` to the event name and to the
 * whole structured payload of EVERY log call. It is exported so any other sink (metrics
 * labels, audit rows, error reporters, API error bodies) can reuse the same rules.
 *
 * Two layers, both high-recall (a redacted non-secret is a cosmetic cost; a leaked secret
 * is an incident):
 *   1. KEY NAMES — a structured field whose name says it holds a credential
 *      (password, secret, token, api_key, authorization, cookie, set-cookie, private_key,
 *      access_key, credential, …) has its string value replaced, recursively for nested
 *      objects/arrays. Numbers and booleans are kept (`max_tokens: 4000` is not a secret),
 *      and names that describe a credential rather than hold it (`*_name`, `*_env`,
 *      `*_id`, `*_count`, `*_type`, `*_expires_at`, `*_present`, …) are kept.
 *   2. VALUE SHAPES — every string (messages, nested values, Error message/stack) is
 *      scanned for token families: JWTs, Supabase sb_secret_/sbp_, OpenAI sk-, Anthropic
 *      sk-ant-, AWS AKIA/ASIA, Google GOCSPX-/AIza, Railway rw_, GitHub, Slack, Stripe,
 *      webhook secrets, PEM private keys, Authorization/Bearer/Basic values, cookies,
 *      credentials inside connection URLs, `key=value` / `"key":"value"` pairs with a
 *      secret-named key, and long hex/base64 blobs right after a secret-named word.
 *
 * Detection of secrets in COMMITS is a different job with the opposite trade-off (high
 * precision, placeholder-aware, allowlist pinned by fingerprint): see
 * scripts/check-secrets.js and scripts/security/scan-staged-secrets.js. The token families
 * are kept in step by backend/tests/unit/logRedaction.test.ts, which runs the same
 * synthetic samples through both.
 *
 * Bounded: depth, keys per object, array items, total nodes and string length are capped,
 * cycles become "[Circular]", and every regex is linear (no nested quantifiers over the
 * same characters; every open-ended class is anchored on a literal prefix or capped).
 */

export const REDACTED = '[REDACTED]';

export type RedactLimits = {
  /** Maximum object/array nesting depth (default 8). */
  maxDepth?: number;
  /** Maximum keys kept per object (default 100). */
  maxKeys?: number;
  /** Maximum items kept per array (default 100). */
  maxArrayItems?: number;
  /** Maximum characters kept per string, after redaction (default 8192). */
  maxStringLength?: number;
  /** Maximum total nodes visited in one call (default 2000). */
  maxNodes?: number;
};

const DEFAULTS: Required<RedactLimits> = {
  maxDepth: 8,
  maxKeys: 100,
  maxArrayItems: 100,
  maxStringLength: 8192,
  maxNodes: 2000,
};

/** Strings longer than this are truncated BEFORE regex scanning so scan time stays bounded. */
const SCAN_HARD_CAP = 65536;

type Rule = { id: string; re: RegExp; replace: (match: string, ...groups: string[]) => string };

const tag = (id: string) => `[REDACTED:${id}]`;
const hasDigit = (s: string) => /[0-9]/.test(s);

/** Words that only ever precede an Authorization value, never are one. */
const AUTH_SCHEME_WORD = /^(?:bearer|basic|token|digest|negotiate|ntlm|hmac|aws4-hmac-sha256)$/i;

/**
 * Token-family rules. ORDER MATTERS: specific families first (sk-ant- before sk-), then
 * header/URL forms, then the generic key=value and adjacent-blob layers.
 */
const TOKEN_RULES: Rule[] = [
  // PEM private key blocks (whole block when complete; header alone otherwise).
  {
    id: 'private-key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,8192}?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
    replace: () => tag('private-key'),
  },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g, replace: () => tag('private-key') },
  // JSON Web Tokens (any role: service_role, anon, user access tokens, id_tokens).
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+)?/g, replace: () => tag('jwt') },
  // Supabase secret API keys and personal access tokens.
  { id: 'supabase-secret-key', re: /\bsb_secret_[A-Za-z0-9_-]{8,}/g, replace: () => tag('supabase-secret-key') },
  { id: 'supabase-access-token', re: /\bsbp_[A-Za-z0-9_]{20,}/g, replace: () => tag('supabase-access-token') },
  // Anthropic before OpenAI (both start with sk-).
  { id: 'anthropic-api-key', re: /\bsk-ant-[A-Za-z0-9_-]{10,}/g, replace: () => tag('anthropic-api-key') },
  { id: 'openai-api-key', re: /\bsk-(?:proj-|svcacct-|admin-|None-)?[A-Za-z0-9_-]{20,}/g, replace: () => tag('openai-api-key') },
  { id: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: () => tag('aws-access-key-id') },
  { id: 'google-oauth-client-secret', re: /\bGOCSPX-[A-Za-z0-9_-]{10,}/g, replace: () => tag('google-oauth-client-secret') },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{30,}/g, replace: () => tag('google-api-key') },
  // Railway tokens: rw_ followed by a random body (must contain a digit, so identifiers
  // such as rw_lock_timeout are left alone).
  {
    id: 'railway-token',
    re: /\brw_[A-Za-z0-9_-]{16,}/g,
    replace: (m) => (hasDigit(m) ? tag('railway-token') : m),
  },
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, replace: () => tag('github-token') },
  { id: 'github-token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: () => tag('github-token') },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replace: () => tag('slack-token') },
  { id: 'stripe-secret', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, replace: () => tag('stripe-secret') },
  { id: 'webhook-secret', re: /\bwhsec_[A-Za-z0-9+/=_-]{10,}/g, replace: () => tag('webhook-secret') },
  // Authorization header values, with or without a scheme, in header/JSON/kv form.
  {
    id: 'authorization',
    re: /\b((?:proxy-)?authorization)(["']?\s*[:=]\s*["']?)(?:(Bearer|Basic|Token|Digest|Negotiate|NTLM)\s+)?([^\s"',;]{1,4096})/gi,
    replace: (_m, name, sep, scheme, value) =>
      value.startsWith('[REDACTED') ? _m : `${name}${sep}${scheme ? `${scheme} ` : ''}${REDACTED}`,
  },
  // Stand-alone Bearer / Basic credentials (no header name). Requires a digit or a
  // base64/token punctuation character so prose ("Basic information") is untouched.
  {
    id: 'bearer',
    re: /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/-]{8,4096}=*)/g,
    replace: (m, scheme, value) =>
      value.startsWith('[REDACTED') || !(hasDigit(value) || /[+/=._~-]/.test(value)) || value.length < 12
        ? m
        : `${scheme} ${REDACTED}`,
  },
  // Cookie / Set-Cookie headers: the whole header value (to end of quoted string / line).
  {
    id: 'cookie',
    re: /(["']?)\b((?:set-)?cookie)\1(\s*[:=]\s*)("(?:[^"\\\r\n]|\\.){0,4096}"|'[^'\r\n]{0,4096}'|[^\r\n"']{1,4096})/gi,
    replace: (_m, q, name, sep, value) => {
      if (value.startsWith('[REDACTED') || value.startsWith('"[REDACTED') || value.startsWith("'[REDACTED")) return _m;
      const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
      return `${q}${name}${q}${sep}${quote}${REDACTED}${quote}`;
    },
  },
  // Credentials embedded in connection / service URLs: scheme://user:PASSWORD@host.
  {
    id: 'url-credentials',
    re: /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|https?|ftp|smtps?):\/\/[^\s:/@'"`]{0,256}:)([^\s@'"`/]{1,512})@/gi,
    replace: (_m, prefix, pass) => (pass.startsWith('[REDACTED') ? _m : `${prefix}${REDACTED}@`),
  },
];

/** Secret-named key in free text: `password=…`, `"api_key": "…"`, `client_secret: …`, `?access_token=…`. */
const SECRET_WORD = '(?:password|passwd|passphrase|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credentials?|signature|session[_-]?id|auth[_-]?code)';
const KEY_VALUE_RE = new RegExp(
  `(["']?)\\b([A-Za-z0-9_.-]{0,40}${SECRET_WORD}s?[A-Za-z0-9_-]{0,24})\\1(\\s*[:=]\\s*)` +
    `("(?:[^"\\\\\\r\\n]|\\\\.){1,4096}"|'[^'\\r\\n]{1,4096}'|[^\\s&,;"'}\\])]{1,4096})`,
  'gi',
);

/** A long hex / base64 blob directly after a secret-named word: "secret 3f9a…", "signing key: Qk9…". */
const ADJACENT_BLOB_RE = new RegExp(
  `\\b((?:[A-Za-z0-9]{1,24}[_ -])?(?:key|secret|token|password|signature|hmac|salt))\\b(["']?\\s*(?:[:=]|is|was|of)?\\s*["']?)` +
    `([A-Fa-f0-9]{32,4096}|[A-Za-z0-9+/_-]{32,4096}={0,2})`,
  'gi',
);

/** Key-name suffixes that DESCRIBE a credential without holding it. Applied to the normalised key. */
const DESCRIPTIVE_SUFFIX = /(?:name|names|env|envvar|id|ids|count|type|types|present|configured|set|length|len|status|hint|expiresat|expiresin|expiry|expiration|ttl|source|valid|required|version|kind|provider|scope|scopes|header)$/;

/** Normalised (lowercase, alphanumerics only) substrings that mark a credential-bearing key. */
const SECRET_KEY_PART = /password|passwd|passphrase|secret|token|apikey|authorization|cookie|privatekey|accesskey|credential|sessionid|signature|authcode|dsn|connectionstring/;

/** LLM usage counters (`max_tokens`, `prompt_tokens`, `tokens_used`, …) are not credentials. */
const LLM_TOKEN_USAGE = /^(?:max|min|prompt|completion|input|output|total|cached|reasoning|remaining|used|estimated)tokens|^tokens(?:used|remaining|in|out|total|estimated)?$/;

/** True when a structured field name indicates its value is a credential. */
export function isSecretKeyName(key: string): boolean {
  const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!norm) return false;
  if (norm === 'pwd' || norm === 'auth' || norm === 'xapikey') return true;
  if (!SECRET_KEY_PART.test(norm)) return false;
  if (LLM_TOKEN_USAGE.test(norm)) return false;
  return !DESCRIPTIVE_SUFFIX.test(norm);
}

function isNonSecretScalarText(value: string): boolean {
  return /^(?:-?\d+(?:\.\d+)?|true|false|null|undefined|none|\*+)$/i.test(value);
}

/**
 * Redact credential shapes inside one string. Does not truncate beyond the scan hard cap;
 * `redact()` applies the configured string limit.
 */
export function redactString(input: string): string {
  let out = input.length > SCAN_HARD_CAP ? `${input.slice(0, SCAN_HARD_CAP)}…[truncated]` : input;
  for (const rule of TOKEN_RULES) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, rule.replace as (substring: string, ...args: any[]) => string);
  }
  KEY_VALUE_RE.lastIndex = 0;
  out = out.replace(KEY_VALUE_RE, (m, q: string, key: string, sep: string, value: string) => {
    const bare = value.replace(/^["']|["']$/g, '');
    if (!bare || bare.startsWith('[REDACTED') || isNonSecretScalarText(bare) || AUTH_SCHEME_WORD.test(bare)) return m;
    if (!isSecretKeyName(key)) return m;
    const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
    return `${q}${key}${q}${sep}${quote}${REDACTED}${quote}`;
  });
  ADJACENT_BLOB_RE.lastIndex = 0;
  out = out.replace(ADJACENT_BLOB_RE, (m, word: string, sep: string, blob: string) =>
    hasDigit(blob) && /[A-Za-z]/.test(blob) ? `${word}${sep}${REDACTED}` : m,
  );
  return out;
}

type State = { nodes: number; seen: WeakSet<object>; limits: Required<RedactLimits> };

function clampString(s: string, limits: Required<RedactLimits>): string {
  return s.length > limits.maxStringLength ? `${s.slice(0, limits.maxStringLength)}…[truncated ${s.length - limits.maxStringLength} chars]` : s;
}

/** Error properties that carry request config, sockets, headers or raw bodies. */
const ERROR_DROP_KEYS = new Set(['config', 'request', 'response', 'headers', 'socket', 'agent', 'options']);

function walk(value: unknown, depth: number, forceSecret: boolean, state: State): unknown {
  const { limits } = state;
  state.nodes++;
  if (state.nodes > limits.maxNodes) return '[Truncated: node budget]';

  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') {
    if (forceSecret) return (value as string).length === 0 ? value : REDACTED;
    return clampString(redactString(value as string), limits);
  }
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return forceSecret ? REDACTED : String(value);
  if (t === 'symbol') return String(value);
  if (t === 'function') return '[Function]';

  const obj = value as object;
  if (state.seen.has(obj)) return '[Circular]';
  if (depth >= limits.maxDepth) return '[Truncated: depth]';
  state.seen.add(obj);
  try {
    if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString();
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj)) return forceSecret ? REDACTED : `[Binary ${obj.length} bytes]`;
    if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return forceSecret ? REDACTED : `[Binary ${(obj as ArrayBuffer).byteLength} bytes]`;
    if (obj instanceof RegExp) return String(obj);

    if (obj instanceof Error) {
      const e = obj as Error & Record<string, unknown>;
      const out: Record<string, unknown> = {
        name: e.name,
        message: walk(e.message, depth + 1, forceSecret, state),
      };
      if (typeof e.stack === 'string') out.stack = walk(e.stack, depth + 1, forceSecret, state);
      const status = (e.response as { status?: unknown } | undefined)?.status;
      if (typeof status === 'number') out.status = status;
      let kept = 0;
      for (const key of Object.keys(e)) {
        if (key === 'name' || key === 'message' || key === 'stack' || ERROR_DROP_KEYS.has(key)) continue;
        if (++kept > limits.maxKeys) break;
        out[key] = walk(e[key], depth + 1, forceSecret || isSecretKeyName(key), state);
      }
      if ('cause' in e && !('cause' in out)) out.cause = walk(e.cause, depth + 1, forceSecret, state);
      return out;
    }

    if (Array.isArray(obj) || obj instanceof Set) {
      const items = Array.isArray(obj) ? obj : Array.from(obj);
      const out = items.slice(0, limits.maxArrayItems).map((v) => walk(v, depth + 1, forceSecret, state));
      if (items.length > limits.maxArrayItems) out.push(`[Truncated: ${items.length - limits.maxArrayItems} more items]`);
      return out;
    }

    const entries: Array<[string, unknown]> =
      obj instanceof Map ? Array.from(obj.entries()).map(([k, v]) => [String(k), v]) : Object.entries(obj);
    const out: Record<string, unknown> = {};
    let i = 0;
    for (const [key, v] of entries) {
      if (i++ >= limits.maxKeys) {
        out['[truncated]'] = `${entries.length - limits.maxKeys} more keys`;
        break;
      }
      const secretKey = forceSecret || isSecretKeyName(key);
      out[key] = walk(v, depth + 1, secretKey, state);
    }
    return out;
  } finally {
    state.seen.delete(obj);
  }
}

/**
 * Deep, cycle-safe, bounded redaction of any value. Returns a NEW JSON-serialisable value;
 * the input is never mutated. Strings are scanned for credential shapes; fields whose
 * name marks them as credentials have their string values replaced outright.
 */
export function redact<T = unknown>(value: T, limits: RedactLimits = {}): unknown {
  const state: State = { nodes: 0, seen: new WeakSet(), limits: { ...DEFAULTS, ...limits } };
  return walk(value, 0, false, state);
}
