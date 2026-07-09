/**
 * HARDEN-006 — centralized AI request protection framework.
 *
 * THE single guard every AI execution path passes through before a provider is
 * invoked. It unifies the abuse/cost/burst controls that were previously either
 * missing or scattered, and is reusable by present and future AI capabilities
 * (text gen, chat, voice, image, embeddings) without per-endpoint logic.
 *
 * Layers (checked in order; the first failure short-circuits):
 *   1. Request validation — reject impossible/oversized requests BEFORE any
 *      provider-bound work (max prompt size, message count, token estimate).
 *   2. Burst protection — a tight short-window cap per user smooths sudden spikes.
 *   3. Layered rate limits — rolling windows per user, per company, per
 *      operation (endpoint), and per provider. Configurable via env.
 *
 * Design:
 *   - Identity comes from the AsyncLocalStorage request context (userId/orgId)
 *     plus the explicit companyId/operation the caller supplies — no auth or
 *     authorization is performed here (that already happened upstream).
 *   - Distributed + fail-OPEN: built on the platform's Redis sliding-window
 *     limiter (checkRateLimit), which degrades to a per-process in-memory cap
 *     when Redis is down. A guard INTERNAL error never blocks a legitimate
 *     request — it is logged and allowed.
 *   - Exemptions: super-admin context and env-listed orgs bypass rate/burst
 *     limits (validation still applies) so priority/enterprise/admin flows are
 *     unaffected. Extension point for future plan-tier / API-customer quotas.
 *   - Observability: allowed / blocked / throttled counters + the limited layer
 *     and operation/provider, via the HARDEN-001 registry (fail-safe).
 *
 * A blocked request throws AiGuardError with a stable `code` and HTTP `status`
 * (429 for rate/burst, 413 for oversize) so API routes and the gateway can
 * surface a standardized throttle response without changing contracts.
 */
import { checkRateLimit } from '../../../lib/auth/rateLimit';
import { getRequestContext } from '../requestContext';
import { recordRawCounter } from '../../observability';
import { logger } from '../logger';

export type AiGuardProvider = 'openai' | 'anthropic' | 'gemini' | 'other';

export interface AiGuardContext {
  /** Operation / endpoint label (e.g. 'blogGeneration', 'chat', 'voice.transcribe'). */
  operation: string;
  /** Best-effort provider bucket for per-provider limits. */
  provider?: AiGuardProvider;
  /** Company/org id (falls back to the request-context orgId). */
  companyId?: string | null;
  /** User id (falls back to the request-context userId). */
  userId?: string | null;
  /** Client IP when available (per-IP layer is best-effort/future-ready). */
  ip?: string | null;
  /** Messages/prompt for size validation. */
  messages?: Array<{ role: string; content: string }>;
  /** Requested output token budget (validated against the max estimate). */
  maxTokens?: number;
  /** Attachment / image counts for multimodal validation (future-ready). */
  attachmentCount?: number;
  imageCount?: number;
  /** When true, treat the caller as super-admin (bypasses rate/burst). */
  isAdmin?: boolean;
  /**
   * Trusted internal / background generation (worker jobs, cron, batch
   * pipelines) that is NOT a direct user-facing request. When true the
   * user-facing rate layers (per-user, per-company, per-IP, burst) are skipped
   * — those exist to shape interactive abuse, and legitimate batch generation
   * for one tenant would otherwise trip the per-company cap. Provider-protection
   * (per-operation, per-provider surge caps) and request validation STILL apply,
   * and cost/credit + LLM-concurrency controls upstream are unaffected. When not
   * set explicitly, a request with no user identity at all (no userId and no ip)
   * is treated as background.
   */
  background?: boolean;
}

export class AiGuardError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSecs?: number;
  readonly layer?: string;
  constructor(code: string, message: string, status: number, opts?: { retryAfterSecs?: number; layer?: string }) {
    super(message);
    this.name = 'AiGuardError';
    this.code = code;
    this.status = status;
    this.retryAfterSecs = opts?.retryAfterSecs;
    this.layer = opts?.layer;
  }
}

// ── Config (env-driven; generous defaults so legitimate users are unaffected) ──

function numEnv(name: string, dflt: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : dflt;
}
function boolEnv(name: string, dflt: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

interface GuardLimits {
  enabled: boolean;
  // request validation
  maxPromptChars: number;
  maxMessages: number;
  maxTokenEstimate: number;
  maxAttachments: number;
  maxImages: number;
  // rolling-window rate limits (limit / windowSecs)
  userPerMin: number;
  userPerHour: number;
  companyPerMin: number;
  companyPerHour: number;
  operationPerMin: number;
  providerPerMin: number;
  ipPerMin: number;
  // burst
  burstUserPer10s: number;
  exemptOrgs: Set<string>;
}

/** Read config fresh each call so env/admin changes take effect without redeploy. */
function loadLimits(): GuardLimits {
  return {
    enabled: boolEnv('AI_GUARD_ENABLED', true),
    maxPromptChars: numEnv('AI_MAX_PROMPT_CHARS', 600_000),   // ~150k tokens of prompt
    maxMessages: numEnv('AI_MAX_MESSAGES', 400),
    maxTokenEstimate: numEnv('AI_MAX_TOKEN_ESTIMATE', 200_000),
    maxAttachments: numEnv('AI_MAX_ATTACHMENTS', 25),
    maxImages: numEnv('AI_MAX_IMAGES', 20),
    userPerMin: numEnv('AI_RATE_USER_PER_MIN', 60),
    userPerHour: numEnv('AI_RATE_USER_PER_HOUR', 1_200),
    companyPerMin: numEnv('AI_RATE_COMPANY_PER_MIN', 300),
    companyPerHour: numEnv('AI_RATE_COMPANY_PER_HOUR', 6_000),
    operationPerMin: numEnv('AI_RATE_OP_PER_MIN', 240),
    providerPerMin: numEnv('AI_RATE_PROVIDER_PER_MIN', 1_500),
    ipPerMin: numEnv('AI_RATE_IP_PER_MIN', 90),
    burstUserPer10s: numEnv('AI_BURST_USER_PER_10S', 20),
    exemptOrgs: new Set(
      String(process.env.AI_GUARD_EXEMPT_ORGS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  };
}

function countBlocked(layer: string, operation: string, provider: string): void {
  try { recordRawCounter('ai.guard.blocked', 1, { layer, operation, provider }); } catch { /* fail-safe */ }
}
function countAllowed(operation: string, provider: string): void {
  try { recordRawCounter('ai.guard.allowed', 1, { operation, provider }); } catch { /* fail-safe */ }
}
function countThrottled(layer: string, operation: string): void {
  try { recordRawCounter('ai.guard.throttled', 1, { layer, operation }); } catch { /* fail-safe */ }
}

/** Rough token estimate (chars / 4) — good enough for an upper-bound guard. */
function estimateTokens(messages: Array<{ content: string }>): number {
  let chars = 0;
  for (const m of messages) chars += (m?.content?.length ?? 0);
  return Math.ceil(chars / 4);
}

function totalPromptChars(messages: Array<{ content: string }>): number {
  let chars = 0;
  for (const m of messages) chars += (m?.content?.length ?? 0);
  return chars;
}

// ── Request validation (Phase 6) ───────────────────────────────────────────────

function validateRequest(ctx: AiGuardContext, limits: GuardLimits): void {
  const messages = ctx.messages ?? [];
  if (messages.length > limits.maxMessages) {
    throw new AiGuardError('AI_REQUEST_TOO_MANY_MESSAGES', `Too many messages (${messages.length} > ${limits.maxMessages}).`, 413, { layer: 'validation' });
  }
  const chars = totalPromptChars(messages);
  if (chars > limits.maxPromptChars) {
    throw new AiGuardError('AI_PROMPT_TOO_LARGE', `Prompt too large (${chars} chars > ${limits.maxPromptChars}).`, 413, { layer: 'validation' });
  }
  const tokens = estimateTokens(messages);
  if (tokens > limits.maxTokenEstimate) {
    throw new AiGuardError('AI_CONTEXT_TOO_LARGE', `Estimated context too large (~${tokens} tokens > ${limits.maxTokenEstimate}).`, 413, { layer: 'validation' });
  }
  if ((ctx.attachmentCount ?? 0) > limits.maxAttachments) {
    throw new AiGuardError('AI_TOO_MANY_ATTACHMENTS', `Too many attachments (${ctx.attachmentCount} > ${limits.maxAttachments}).`, 413, { layer: 'validation' });
  }
  if ((ctx.imageCount ?? 0) > limits.maxImages) {
    throw new AiGuardError('AI_TOO_MANY_IMAGES', `Too many images (${ctx.imageCount} > ${limits.maxImages}).`, 413, { layer: 'validation' });
  }
}

// ── Rate-limit helper: one rolling-window check via the platform limiter ───────

async function checkLayer(
  keyPrefix: string,
  identifier: string,
  limit: number,
  windowSecs: number,
): Promise<{ allowed: boolean; retryAfterSecs: number }> {
  if (limit <= 0) return { allowed: true, retryAfterSecs: 0 }; // 0 = layer disabled
  const result = await checkRateLimit(identifier, { keyPrefix, limit, windowSecs });
  return {
    allowed: result.allowed,
    retryAfterSecs: result.allowed ? 0 : Math.max(1, result.resetAt - Math.floor(Date.now() / 1000)),
  };
}

/**
 * Guard an AI request. Resolves when the request is allowed; throws
 * AiGuardError (status 429/413) when it must be blocked. Fail-OPEN: any
 * internal error is logged and the request is allowed.
 */
export async function guardAiRequest(ctx: AiGuardContext): Promise<void> {
  const limits = loadLimits();
  const rc = getRequestContext();
  const userId = ctx.userId ?? rc.userId ?? null;
  const companyId = ctx.companyId ?? rc.orgId ?? null;
  const operation = ctx.operation || 'unknown';
  const provider = ctx.provider ?? 'other';

  if (!limits.enabled) { countAllowed(operation, provider); return; }

  // 1. Request validation always applies (even to admins/exempt orgs) — an
  //    oversized request is impossible regardless of who sends it.
  try {
    validateRequest(ctx, limits);
  } catch (err) {
    if (err instanceof AiGuardError) {
      countBlocked(err.layer ?? 'validation', operation, provider);
      throw err;
    }
    // never fail-closed on a validation bug
    logger.warn('ai_guard_validation_error', { operation, message: (err as Error)?.message });
  }

  // Admin + exempt orgs bypass rate/burst (validation already applied).
  const exempt = ctx.isAdmin === true || (companyId ? limits.exemptOrgs.has(companyId) : false);
  if (exempt) { countAllowed(operation, provider); return; }

  // Trusted internal/background generation: skip the user-facing rate layers
  // (per-user, per-company, per-IP, burst) but keep provider-protection layers.
  // Inferred when the caller passes no user identity at all.
  const background = ctx.background ?? (!userId && !ctx.ip);

  try {
    // 2. Burst protection — tight 10s window per user smooths sudden spikes.
    if (userId && !background) {
      const burst = await checkLayer('ai:burst:user', userId, limits.burstUserPer10s, 10);
      if (!burst.allowed) {
        countThrottled('burst_user', operation);
        countBlocked('burst_user', operation, provider);
        throw new AiGuardError('AI_BURST_LIMIT', 'AI request burst limit exceeded. Please slow down.', 429, { retryAfterSecs: burst.retryAfterSecs, layer: 'burst_user' });
      }
    }

    // 3. Layered rolling-window rate limits. Each layer is independent; the
    //    first exhausted layer blocks. Identifiers are scoped so a company's
    //    limit is shared across its users while each user also has their own.
    const layers: Array<{ label: string; prefix: string; id: string | null; limit: number; window: number; scope: 'user' | 'platform' }> = [
      { label: 'user_min',     prefix: 'ai:rl:user:min',  id: userId,    limit: limits.userPerMin,     window: 60,   scope: 'user' },
      { label: 'user_hour',    prefix: 'ai:rl:user:hr',   id: userId,    limit: limits.userPerHour,    window: 3600, scope: 'user' },
      { label: 'company_min',  prefix: 'ai:rl:co:min',    id: companyId, limit: limits.companyPerMin,  window: 60,   scope: 'user' },
      { label: 'company_hour', prefix: 'ai:rl:co:hr',     id: companyId, limit: limits.companyPerHour, window: 3600, scope: 'user' },
      // Operation + provider limits are platform-wide surge guards (protect the
      // provider integration itself) — they apply to background jobs too.
      { label: 'operation_min', prefix: 'ai:rl:op:min',   id: operation, limit: limits.operationPerMin, window: 60,  scope: 'platform' },
      { label: 'provider_min',  prefix: 'ai:rl:prov:min', id: provider,  limit: limits.providerPerMin,  window: 60,  scope: 'platform' },
      // Per-IP (best-effort; only when the caller supplies an IP — identity-light routes).
      { label: 'ip_min',        prefix: 'ai:rl:ip:min',   id: ctx.ip ?? null, limit: limits.ipPerMin,   window: 60,  scope: 'user' },
    ];

    for (const layer of layers) {
      if (!layer.id) continue;
      // Background/internal generation is exempt from user-facing layers.
      if (background && layer.scope === 'user') continue;
      const r = await checkLayer(layer.prefix, layer.id, layer.limit, layer.window);
      if (!r.allowed) {
        countThrottled(layer.label, operation);
        countBlocked(layer.label, operation, provider);
        throw new AiGuardError('AI_RATE_LIMIT', `AI rate limit exceeded (${layer.label}). Try again shortly.`, 429, { retryAfterSecs: r.retryAfterSecs, layer: layer.label });
      }
    }
  } catch (err) {
    if (err instanceof AiGuardError) throw err;
    // Fail-OPEN: a limiter/Redis error must never block a legitimate request.
    logger.warn('ai_guard_internal_error_failopen', { operation, message: (err as Error)?.message });
  }

  countAllowed(operation, provider);
}

/** Map a model name to a coarse provider bucket for per-provider limits. */
export function providerFromModel(model?: string | null): AiGuardProvider {
  const m = String(model ?? '').toLowerCase();
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic';
  if (m.includes('gemini') || m.includes('google')) return 'gemini';
  if (m.startsWith('gpt') || m.includes('openai') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('text-') || m.includes('davinci')) return 'openai';
  return 'other';
}
