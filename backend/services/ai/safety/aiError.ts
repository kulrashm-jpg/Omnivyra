/**
 * WAVE-1 — Unified AI Error model (realizes AI-CONTRACT-000 §E1 / Substrate §S7).
 *
 * The single error shape every AI subsystem uses. No subsystem defines a parallel
 * error type; failures are typed values (see safeParse `Result`). This does NOT
 * replace existing app errors wholesale — it is the canonical model that Wave-1
 * safety/integrity code emits and that subsequent waves adopt platform-wide.
 */

export type AiErrorCategory =
  | 'transport' | 'validation' | 'grounding' | 'originality'
  | 'safety' | 'billing' | 'tenant' | 'internal';

export type AiErrorSeverity = 'info' | 'warn' | 'error' | 'critical';

/** Stable, namespaced codes (extend as waves adopt the model). */
export type AiErrorCode =
  | 'GATEWAY_TIMEOUT' | 'GATEWAY_NO_FALLBACK' | 'PROVIDER_ERROR'
  | 'VALIDATION_BAD_OUTPUT' | 'VALIDATION_REJECTED'
  | 'GROUNDING_MISSING_PROFILE' | 'GROUNDING_STALE'
  | 'ORIGINALITY_BLOCKED'
  | 'SAFETY_INJECTION_BLOCKED' | 'SAFETY_MODERATION_BLOCKED'
  | 'MARKET_FABRICATION_BLOCKED'
  | 'BILLING_INSUFFICIENT' | 'TENANT_REQUIRED' | 'CONTRACT_INCOMPATIBLE'
  | 'INTERNAL';

const CATEGORY_OF: Record<AiErrorCode, AiErrorCategory> = {
  GATEWAY_TIMEOUT: 'transport', GATEWAY_NO_FALLBACK: 'transport', PROVIDER_ERROR: 'transport',
  VALIDATION_BAD_OUTPUT: 'validation', VALIDATION_REJECTED: 'validation',
  GROUNDING_MISSING_PROFILE: 'grounding', GROUNDING_STALE: 'grounding',
  ORIGINALITY_BLOCKED: 'originality',
  SAFETY_INJECTION_BLOCKED: 'safety', SAFETY_MODERATION_BLOCKED: 'safety',
  MARKET_FABRICATION_BLOCKED: 'safety',
  BILLING_INSUFFICIENT: 'billing', TENANT_REQUIRED: 'tenant', CONTRACT_INCOMPATIBLE: 'internal',
  INTERNAL: 'internal',
};

const RETRYABLE: Partial<Record<AiErrorCode, boolean>> = {
  GATEWAY_TIMEOUT: true, PROVIDER_ERROR: true,
};

const HTTP_STATUS: Partial<Record<AiErrorCode, number>> = {
  GATEWAY_TIMEOUT: 504, GATEWAY_NO_FALLBACK: 502, PROVIDER_ERROR: 502,
  VALIDATION_BAD_OUTPUT: 422, VALIDATION_REJECTED: 422,
  GROUNDING_MISSING_PROFILE: 422, GROUNDING_STALE: 409,
  ORIGINALITY_BLOCKED: 409,
  SAFETY_INJECTION_BLOCKED: 400, SAFETY_MODERATION_BLOCKED: 451, MARKET_FABRICATION_BLOCKED: 422,
  BILLING_INSUFFICIENT: 402, TENANT_REQUIRED: 400, CONTRACT_INCOMPATIBLE: 409, INTERNAL: 500,
};

export interface AiErrorShape {
  code: AiErrorCode;
  category: AiErrorCategory;
  severity: AiErrorSeverity;
  retryable: boolean;
  httpStatus: number;
  /** Safe to surface to end users — never contains internals/PII. */
  userMessage: string;
  /** Diagnostics — never surfaced to end users. */
  devDetail?: string;
  correlationId?: string;
  cause?: AiErrorShape;
}

export class AiError extends Error implements AiErrorShape {
  readonly code: AiErrorCode;
  readonly category: AiErrorCategory;
  readonly severity: AiErrorSeverity;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly userMessage: string;
  readonly devDetail?: string;
  readonly correlationId?: string;
  readonly cause?: AiErrorShape;

  constructor(code: AiErrorCode, opts: {
    userMessage?: string; devDetail?: string; severity?: AiErrorSeverity;
    correlationId?: string; cause?: AiErrorShape; retryable?: boolean;
  } = {}) {
    super(opts.devDetail || opts.userMessage || code);
    this.name = 'AiError';
    this.code = code;
    this.category = CATEGORY_OF[code];
    this.severity = opts.severity ?? (this.category === 'internal' || this.category === 'transport' ? 'error' : 'warn');
    this.retryable = opts.retryable ?? RETRYABLE[code] ?? false;
    this.httpStatus = HTTP_STATUS[code] ?? 500;
    this.userMessage = opts.userMessage ?? defaultUserMessage(code);
    this.devDetail = opts.devDetail;
    this.correlationId = opts.correlationId;
    this.cause = opts.cause;
  }

  /** Machine-readable shape (safe to log; userMessage is UI-safe). */
  toShape(): AiErrorShape {
    return {
      code: this.code, category: this.category, severity: this.severity,
      retryable: this.retryable, httpStatus: this.httpStatus,
      userMessage: this.userMessage, devDetail: this.devDetail,
      correlationId: this.correlationId, cause: this.cause,
    };
  }
}

function defaultUserMessage(code: AiErrorCode): string {
  switch (CATEGORY_OF[code]) {
    case 'transport': return 'The AI service is temporarily unavailable. Please try again.';
    case 'validation': return 'The AI response could not be processed. Please try again.';
    case 'grounding': return 'Not enough company context is available to generate this safely.';
    case 'originality': return 'Similar content already exists; a fresh version is needed.';
    case 'safety': return 'This content was blocked by a safety policy.';
    case 'billing': return 'Insufficient credits for this AI operation.';
    case 'tenant': return 'A workspace context is required.';
    default: return 'An unexpected error occurred.';
  }
}

export function isAiError(e: unknown): e is AiError {
  return e instanceof AiError;
}
