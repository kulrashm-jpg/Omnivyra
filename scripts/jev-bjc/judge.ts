/**
 * BJC — the single, explicit JEV invocation path.
 *
 * judge() runs only when a caller deliberately calls it with an explicit
 * transport and audit sink. Nothing here registers hooks, intercepts prompts,
 * picks models, or runs in the background. It never throws: every outcome —
 * including every failure — comes back as a typed BjcResponse and is audited.
 *
 * Fail-closed rule: `verdict` is non-null ONLY when the judgment COMPLETED;
 * any rejection or provider failure yields verdict=null and
 * verification_eligible=false, so a failure can never read as a PASS.
 */
import { randomUUID } from 'node:crypto';
import {
  CLIENT_VERSION,
  CONTRACT_VERSION,
  LIMITS,
  LOW_CONFIDENCE_THRESHOLD,
  PROVIDER_NAME,
  QUESTIONS_VERSION,
  bjcRequestSchema,
  isFloatingModel,
  type BjcErrorCode,
  type BjcRequest,
  type BjcResponse,
  type BjcStatus,
  type JevAcAnswer,
  type JevInvariantAnswer,
} from './contract';
import { canonicalJson, computeInputHash, sha256Hex } from './canonical';
import { combine, deriveDeterministicResult } from './combiner';
import { buildQuestions, buildState } from './questions';
import { BjcTransportError, parseAnswers, type JevTransport, type ProviderReply } from './provider';
import { findSecretShapes, type RedactionFinding } from './redaction';
import { buildAuditRecord, type AuditSink } from './audit';

export const DEFAULT_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 2; // spec §2.5: one retry, retryable failures only

export interface JudgeDeps {
  /** null when no API key is configured — the call then fails visibly as MISSING_API_KEY. */
  transport: JevTransport | null;
  audit: AuditSink;
  timeoutMs?: number;
  now?: () => Date;
  newRecordId?: () => string;
}

const bounded = (text: string, max = 300): string => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** Echo a caller identifier only if it is short, plain and not credential-shaped. */
function safeEcho<T>(v: unknown, fallback: T): string | T {
  if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(v)) return fallback;
  return findSecretShapes(v).length === 0 ? v : fallback;
}

export async function judge(rawRequest: unknown, deps: JudgeDeps): Promise<BjcResponse> {
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const raw = (rawRequest ?? {}) as Record<string, unknown>;
  const rawAc = (raw.acceptance_criterion ?? {}) as Record<string, unknown>;

  const response: BjcResponse = {
    schema: CONTRACT_VERSION,
    request_id: safeEcho(raw.request_id, 'unknown'),
    work_item: safeEcho(raw.work_item, 'unknown'),
    ac_id: safeEcho(rawAc.id, null),
    status: 'REQUEST_REJECTED',
    verdict: null,
    deterministic_result: null,
    jev: { answer: 'NONE', confidence: null, probabilities: null, low_confidence: false },
    invariants: [],
    bundle_consistency: null,
    conflict: false,
    review_required: false,
    verification_eligible: false,
    rationale: '',
    evidence_considered: [],
    model: { requested: safeEcho(raw.model, null), resolved: 'unknown', pinned: false },
    provider: PROVIDER_NAME,
    reproducible: false,
    input_hash: null,
    payload_hash: null,
    contract_version: CONTRACT_VERSION,
    questions_version: QUESTIONS_VERSION,
    client_version: CLIENT_VERSION,
    timestamp: now().toISOString(),
    latency_ms: 0,
    error: null,
    audit: { record_id: (deps.newRecordId ?? randomUUID)(), written: false, error: null },
  };

  let request: BjcRequest | null = null;
  let redaction: { blocked: boolean; findings: RedactionFinding[] } = { blocked: false, findings: [] };

  const finish = (status: BjcStatus, code: BjcErrorCode | null, message: string): void => {
    response.status = status;
    response.error = code ? { code, message: bounded(message) } : null;
    if (status !== 'COMPLETED') {
      response.verdict = null;
      response.verification_eligible = false;
      response.rationale = bounded(`No advisory judgment: ${message}`, 500);
    }
  };

  try {
    if (raw.schema !== CONTRACT_VERSION) {
      finish('REQUEST_REJECTED', 'SCHEMA_VERSION_MISMATCH', `request schema must be ${CONTRACT_VERSION}`);
    } else {
      const parsed = bjcRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        // Path + code only: zod messages can echo submitted values.
        const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '$'}:${i.code}`);
        finish('REQUEST_REJECTED', 'INVALID_REQUEST', `request failed validation (${issues.join('; ')})`);
      } else {
        const ids = parsed.data;
        if (findSecretShapes({ r: ids.request_id, w: ids.work_item, t: ids.task_id, i: ids.invoked_by }).length > 0) {
          finish('REQUEST_REJECTED', 'INVALID_REQUEST', 'a request identifier has a credential shape');
        } else {
          request = ids;
          await run(request);
        }
      }
    }
  } catch {
    finish('JUDGMENT_UNAVAILABLE', 'INTERNAL_ERROR', 'unexpected internal error in BJC');
  }

  response.latency_ms = Date.now() - started;
  try {
    await deps.audit.append(buildAuditRecord(response, request, redaction));
    response.audit.written = true;
  } catch (err) {
    response.audit.error = bounded(`audit write failed: ${(err as Error)?.message ?? 'unknown error'}`, 200);
  }
  return response;

  async function run(req: BjcRequest): Promise<void> {
    response.ac_id = req.acceptance_criterion.id;
    response.model = { requested: req.model, resolved: 'unknown', pinned: !isFloatingModel(req.model) };

    const computed = computeInputHash(req);
    response.input_hash = computed;
    if (computed !== req.input_hash) {
      finish('REQUEST_REJECTED', 'HASH_MISMATCH', 'input_hash does not match the canonical hash of the request');
      return;
    }

    response.deterministic_result = deriveDeterministicResult(req);
    const state = buildState(req);
    if (state.length > LIMITS.maxStateChars) {
      finish('REQUEST_REJECTED', 'OVERSIZE', `serialized state is ${state.length} chars (limit ${LIMITS.maxStateChars})`);
      return;
    }

    const findings = findSecretShapes({ state, model: req.model });
    if (findings.length > 0) {
      redaction = { blocked: true, findings };
      finish('JUDGMENT_UNAVAILABLE', 'REDACTION_BLOCK', `credential-shaped text found (${findings.map((f) => f.pattern).join(', ')}); nothing was sent`);
      return;
    }

    if (!deps.transport) {
      finish('JUDGMENT_UNAVAILABLE', 'MISSING_API_KEY', 'no JEV API key configured; nothing was sent');
      return;
    }

    const body = { state, model: req.model, questions: buildQuestions(req) };
    response.payload_hash = `sha256:${sha256Hex(canonicalJson(body))}`;
    response.evidence_considered = req.evidence.map((ev) => ev.id);

    let reply: ProviderReply | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && reply === null; attempt++) {
      try {
        reply = await deps.transport.send(body, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      } catch (err) {
        const transportErr = err instanceof BjcTransportError ? err : null;
        if (transportErr?.retryable && attempt < MAX_ATTEMPTS) continue;
        finish(
          'JUDGMENT_UNAVAILABLE',
          transportErr?.code ?? 'NETWORK_ERROR',
          transportErr ? `${transportErr.message} (attempt ${attempt})` : 'provider transport failed',
        );
        return;
      }
    }

    const answers = parseAnswers(reply as ProviderReply, req.invariants.length);
    // Explicit discriminant: the repo compiles with strictNullChecks off, where `!answers.ok` does not narrow.
    if (answers.ok === false) {
      finish('JUDGMENT_UNAVAILABLE', answers.code, answers.message);
      return;
    }

    response.model.resolved = answers.resolvedModel;
    // Reproducible only when the requested id is pinned AND the provider confirms exactly that id.
    response.reproducible = response.model.pinned && answers.resolvedModel === req.model;
    response.jev = {
      answer: answers.ac.choice as JevAcAnswer,
      confidence: answers.ac.confidence,
      probabilities: answers.ac.probabilities,
      low_confidence: answers.ac.confidence < LOW_CONFIDENCE_THRESHOLD,
    };
    response.invariants = answers.invariants.map((inv, i) => ({
      id: req.invariants[i].id,
      answer: inv.choice as JevInvariantAnswer,
      confidence: inv.confidence,
    }));
    response.bundle_consistency = answers.bundleConsistency;

    const combined = combine({
      kind: req.acceptance_criterion.kind,
      deterministic: response.deterministic_result,
      jev: response.jev.answer,
      invariantAnswers: response.invariants.map((inv) => inv.answer),
    });
    response.verdict = combined.verdict;
    response.conflict = combined.conflict;
    response.review_required = combined.review_required;
    response.verification_eligible = combined.verification_eligible;
    response.rationale = bounded(combined.rationale, 500);
    finish('COMPLETED', null, '');
  }
}
