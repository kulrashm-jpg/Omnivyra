/**
 * BJC provider boundary — the ONLY place BJC talks to JEV (TypeSafe SystemOne).
 *
 * Same wire contract the claude-jev plugin uses (POST {state, model,
 * questions} → {answers}); that plugin stays disabled and is not imported.
 *
 * Hardening vs the plugin (audit J-03/J-07):
 *  - one hard-coded endpoint; no env/base-URL override, no provider switching;
 *  - redirects refused, so the bearer key can never be forwarded elsewhere;
 *  - key read only from TYPESAFE_API_KEY in the environment (no settings file);
 *  - errors carry a code and an HTTP status only — never a body, never the key;
 *  - every answer is validated; anything incomplete is an error, never partial.
 */
import { JEV_AC_ANSWERS, JEV_INVARIANT_ANSWERS, type BjcErrorCode } from './contract';
import { AC_QUESTION_KEY, BUNDLE_QUESTION_KEY, invariantKey, type ProviderQuestion } from './questions';

export const TYPESAFE_SYSTEMONE_URL = 'https://api.typesafe.ai/v1/systemone';
export const API_KEY_ENV = 'TYPESAFE_API_KEY';

export interface ProviderRequestBody {
  state: string;
  model: string;
  questions: Record<string, ProviderQuestion>;
}

export interface ProviderReply {
  answers?: unknown;
  model?: unknown;
}

export interface JevTransport {
  send(body: ProviderRequestBody, timeoutMs: number): Promise<ProviderReply>;
}

type TransportErrorCode = Extract<BjcErrorCode, 'TIMEOUT' | 'PROVIDER_HTTP_ERROR' | 'NETWORK_ERROR' | 'MALFORMED_RESPONSE'>;

export class BjcTransportError extends Error {
  constructor(
    readonly code: TransportErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'BjcTransportError';
  }
}

export function resolveApiKey(env: Record<string, string | undefined>): string | null {
  const key = (env[API_KEY_ENV] ?? '').trim();
  return key.length > 0 ? key : null;
}

export function createTypeSafeTransport(opts: { apiKey: string; fetchImpl?: typeof fetch }): JevTransport {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async send(body, timeoutMs) {
      let res: Response;
      try {
        res = await doFetch(TYPESAFE_SYSTEMONE_URL, {
          method: 'POST',
          redirect: 'error',
          headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new BjcTransportError('TIMEOUT', `provider did not answer within ${timeoutMs} ms`, true);
        }
        throw new BjcTransportError('NETWORK_ERROR', 'provider request failed before a response', true);
      }
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        throw new BjcTransportError('PROVIDER_HTTP_ERROR', `provider returned HTTP ${res.status}`, retryable);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await res.text());
      } catch {
        throw new BjcTransportError('MALFORMED_RESPONSE', 'provider response is not valid JSON', false);
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new BjcTransportError('MALFORMED_RESPONSE', 'provider response is not a JSON object', false);
      }
      return parsed as ProviderReply;
    },
  };
}

export interface ParsedChoice {
  choice: string;
  confidence: number;
  probabilities: Record<string, number> | null;
}

export type ParsedAnswers =
  | {
      ok: true;
      ac: ParsedChoice;
      invariants: ParsedChoice[];
      bundleConsistency: number;
      resolvedModel: string;
    }
  | { ok: false; code: Extract<BjcErrorCode, 'MALFORMED_RESPONSE' | 'MISSING_ANSWERS' | 'INVALID_ANSWER'>; message: string };

const isUnit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

function parseChoice(raw: unknown, allowed: readonly string[], key: string): ParsedChoice | string {
  if (raw === null || typeof raw !== 'object') return `answer ${key} is not an object`;
  const a = raw as Record<string, unknown>;
  if (typeof a.choice !== 'string' || !allowed.includes(a.choice)) return `answer ${key} has no valid choice`;
  if (!isUnit(a.confidence)) return `answer ${key} has no valid confidence`;
  let probabilities: Record<string, number> | null = null;
  if (a.probabilities !== undefined) {
    if (a.probabilities === null || typeof a.probabilities !== 'object') return `answer ${key} has invalid probabilities`;
    probabilities = {};
    for (const [k, v] of Object.entries(a.probabilities as Record<string, unknown>)) {
      if (!allowed.includes(k) || !isUnit(v)) return `answer ${key} has invalid probabilities`;
      probabilities[k] = Math.round(v * 100) / 100;
    }
  }
  return { choice: a.choice, confidence: Math.round(a.confidence * 100) / 100, probabilities };
}

/** Validate a reply against exactly the questions that were asked. */
export function parseAnswers(reply: ProviderReply, invariantCount: number): ParsedAnswers {
  const answers = reply.answers;
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
    return { ok: false, code: 'MALFORMED_RESPONSE', message: 'provider reply has no answers object' };
  }
  const map = answers as Record<string, unknown>;
  const expected = [AC_QUESTION_KEY, BUNDLE_QUESTION_KEY, ...Array.from({ length: invariantCount }, (_, i) => invariantKey(i))];
  const missing = expected.filter((k) => !(k in map));
  if (missing.length > 0) {
    return { ok: false, code: 'MISSING_ANSWERS', message: `provider reply is missing answers: ${missing.join(', ')}` };
  }
  const ac = parseChoice(map[AC_QUESTION_KEY], JEV_AC_ANSWERS, AC_QUESTION_KEY);
  if (typeof ac === 'string') return { ok: false, code: 'INVALID_ANSWER', message: ac };
  const invariants: ParsedChoice[] = [];
  for (let i = 0; i < invariantCount; i++) {
    const inv = parseChoice(map[invariantKey(i)], JEV_INVARIANT_ANSWERS, invariantKey(i));
    if (typeof inv === 'string') return { ok: false, code: 'INVALID_ANSWER', message: inv };
    invariants.push(inv);
  }
  const bundle = map[BUNDLE_QUESTION_KEY] as Record<string, unknown> | null;
  if (bundle === null || typeof bundle !== 'object' || !isUnit(bundle.noul)) {
    return { ok: false, code: 'INVALID_ANSWER', message: `answer ${BUNDLE_QUESTION_KEY} has no valid probability` };
  }
  const resolvedModel =
    typeof reply.model === 'string' && /^[a-z0-9][a-z0-9._-]{1,63}$/.test(reply.model) ? reply.model : 'unknown';
  return { ok: true, ac, invariants, bundleConsistency: Math.round(bundle.noul * 100) / 100, resolvedModel };
}
