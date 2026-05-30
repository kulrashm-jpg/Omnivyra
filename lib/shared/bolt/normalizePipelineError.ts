/**
 * BOLT pipeline error normalizer.
 *
 * Converts an unknown thrown value into a stable shape we can persist on
 * `bolt_execution_runs` and emit to `console.error('[bolt/pipeline-error]', …)`.
 *
 * The shape is intentionally minimal: the UI must NEVER consume `message`,
 * `stack`, or `code` directly — `getUserFriendlyMessage` handles user-facing
 * text. This helper exists to make the *raw* failure operator-queryable.
 *
 * AggregateError (Promise.any reject) and the ad-hoc `{ errors: [...] }`
 * shape used inside the campaign AI orchestrator both get flattened so the
 * first underlying message is preserved alongside the joined details.
 */

const MAX_STACK_BYTES = 8_000; // Postgres TEXT can hold more, but we trim
                                // to keep rows compact and grep-friendly.

export interface NormalizedPipelineError {
  /** Underlying error message, never the user-friendly fallback. */
  message: string;
  /** Stack trace, trimmed to MAX_STACK_BYTES. `null` when unavailable. */
  stack: string | null;
  /** Engine/error code if the thrower exposed one (PG sqlstate, Node code, …). */
  code: string | null;
  /** Coarse classification — used by operators to filter dashboards. */
  type: 'timeout' | 'network' | 'db_constraint' | 'validation' | 'ai_provider' | 'aggregate' | 'unknown';
  /** Worth a client-side retry? `false` for constraint / validation failures. */
  retriable: boolean;
  /** Joined details when the thrower was an AggregateError-like value. */
  details: string | null;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} bytes]`;
}

function classify(message: string, code: string | null, isAggregate: boolean): NormalizedPipelineError['type'] {
  const lower = message.toLowerCase();
  if (lower.includes('timed out') || lower.includes('timeout') || code === 'ETIMEDOUT') return 'timeout';
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    lower.includes('fetch failed') ||
    lower.includes('connection refused')
  ) {
    return 'network';
  }
  if (lower.includes('violates check constraint') || lower.includes('violates foreign key') || lower.includes('duplicate key')) {
    return 'db_constraint';
  }
  if (
    lower.includes('did not return a valid plan') ||
    lower.includes('validation') ||
    lower.includes('invalid') ||
    lower.includes('bolt execution blocked')
  ) {
    return 'validation';
  }
  if (lower.includes('openai') || lower.includes('rate limit') || lower.includes('insufficient_quota')) {
    return 'ai_provider';
  }
  if (isAggregate) return 'aggregate';
  return 'unknown';
}

function isRetriable(type: NormalizedPipelineError['type']): boolean {
  switch (type) {
    case 'timeout':
    case 'network':
    case 'ai_provider':
      return true;
    case 'db_constraint':
    case 'validation':
      return false;
    case 'aggregate':
    case 'unknown':
    default:
      return true;
  }
}

/**
 * Flatten an `AggregateError`-like value. Returns the array of underlying
 * messages, or `null` if the input is not aggregated.
 */
function unwrapAggregate(err: unknown): string[] | null {
  if (!err || typeof err !== 'object') return null;
  const errors = (err as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return errors.map((e) => (e instanceof Error ? e.message : String(e)));
}

export function normalizePipelineError(err: unknown): NormalizedPipelineError {
  const aggregateMessages = unwrapAggregate(err);
  const baseMessage = err instanceof Error ? err.message : String(err ?? '');
  // BoltError.code is a stable BOLT_ERROR_CODES value — capture it so
  // dashboards / log queries can filter by it. Falls through to the
  // generic `code` field on other Error subclasses.
  const code =
    err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : null;
  const stack = err instanceof Error && typeof err.stack === 'string' ? truncate(err.stack, MAX_STACK_BYTES) : null;

  const message = aggregateMessages
    ? aggregateMessages.length > 1
      ? `${aggregateMessages[0] ?? 'Unknown aggregate error'} (and ${aggregateMessages.length - 1} more)`
      : (aggregateMessages[0] ?? 'Unknown aggregate error')
    : baseMessage || 'Unknown pipeline error';

  const type = classify(message, code, Boolean(aggregateMessages));

  return {
    message,
    stack,
    code,
    type,
    retriable: isRetriable(type),
    details: aggregateMessages ? aggregateMessages.join('; ') : null,
  };
}
