/**
 * JEV Bounded Judgment Contract (BJC) — request/response contract, v1.
 *
 * Governing design: "JEV + JIRA REMEDIATION AND INTEGRATION SPECIFICATION
 * v0.1" §1 (charter) and §2 (contract). This module is pure: types, zod
 * schemas and constants only — no I/O, no network, no clock.
 *
 * Principle: deterministic evidence is authoritative; a JEV judgment is
 * advisory. One request judges exactly ONE acceptance criterion against the
 * invariants and evidence the caller supplies — nothing else is sent.
 */
import { z } from 'zod';

export const CONTRACT_VERSION = 'bjc/1' as const;
export const QUESTIONS_VERSION = 'bjcq/1' as const;
export const CLIENT_VERSION = '1.0.0' as const;
export const PROVIDER_NAME = 'typesafe' as const;

/** Spec §2.1 bounds. Oversize requests are rejected, never truncated. */
export const LIMITS = {
  maxInvariants: 20,
  maxEvidence: 50,
  maxStatementChars: 1000,
  maxExcerptChars: 1500,
  maxSummaryChars: 500,
  maxRefChars: 500,
  /** ≈25k estimated tokens of serialized state (fast-jev default budget). */
  maxStateChars: 100_000,
} as const;

/** Evidence produced by deterministic tools: the only kinds that can carry PASS/FAIL. */
export const DETERMINISTIC_EVIDENCE_KINDS = ['test_run', 'typecheck', 'build', 'ci_run'] as const;
/** Context-only evidence: given to JEV for context, never counted as a result. */
export const CONTEXT_EVIDENCE_KINDS = ['commit', 'diff_excerpt', 'log_excerpt', 'manual_observation'] as const;
export const EVIDENCE_KINDS = [...DETERMINISTIC_EVIDENCE_KINDS, ...CONTEXT_EVIDENCE_KINDS] as const;

export type DeterministicEvidenceKind = (typeof DETERMINISTIC_EVIDENCE_KINDS)[number];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const AC_KINDS = ['OBJECTIVE', 'JUDGMENT'] as const;
export type AcKind = (typeof AC_KINDS)[number];

/** Raw JEV answer classes (spec §2.2). */
export const JEV_AC_ANSWERS = ['SUPPORTS', 'CONTRADICTS', 'CANNOT_DETERMINE'] as const;
export type JevAcAnswer = (typeof JEV_AC_ANSWERS)[number] | 'NONE';
export const JEV_INVARIANT_ANSWERS = ['HOLDS', 'VIOLATED', 'CANNOT_DETERMINE'] as const;
export type JevInvariantAnswer = (typeof JEV_INVARIANT_ANSWERS)[number];

/** Combined outcome vocabulary (spec §2.4). Computed by the combiner, never by JEV. */
export const VERDICTS = [
  'PASS_CORROBORATED',
  'PASS_DISPUTED',
  'PASS_UNCORROBORATED',
  'FAIL',
  'INSUFFICIENT_EVIDENCE',
  'ADVISORY_ONLY',
] as const;
export type Verdict = (typeof VERDICTS)[number];

export type DeterministicResult = 'PASS' | 'FAIL' | 'MISSING';

export const STATUSES = ['COMPLETED', 'JUDGMENT_UNAVAILABLE', 'REQUEST_REJECTED'] as const;
export type BjcStatus = (typeof STATUSES)[number];

export const ERROR_CODES = [
  'INVALID_REQUEST',
  'SCHEMA_VERSION_MISMATCH',
  'HASH_MISMATCH',
  'OVERSIZE',
  'REDACTION_BLOCK',
  'MISSING_API_KEY',
  'TIMEOUT',
  'PROVIDER_HTTP_ERROR',
  'NETWORK_ERROR',
  'MALFORMED_RESPONSE',
  'MISSING_ANSWERS',
  'INVALID_ANSWER',
  'INTERNAL_ERROR',
] as const;
export type BjcErrorCode = (typeof ERROR_CODES)[number];

/** Below this the answer is flagged low-confidence (existing claude-jev threshold). Never changes an outcome. */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
export const INPUT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;

const evidenceSchema = z
  .object({
    id: z.string().regex(/^EV-\d{1,4}$/),
    kind: z.enum(EVIDENCE_KINDS),
    ref: z.string().min(1).max(LIMITS.maxRefChars),
    sha256: z.string().regex(SHA256_HEX),
    produced_by: z.string().min(1).max(120),
    result: z.enum(['PASS', 'FAIL', 'N/A']),
    captured_at: z.string().datetime({ offset: true }),
    ac_ids: z.array(z.string().regex(/^AC-\d{1,4}$/)).min(1).max(20),
    excerpt: z.string().max(LIMITS.maxExcerptChars).optional(),
  })
  .strict()
  .superRefine((ev, ctx) => {
    const contextOnly = (CONTEXT_EVIDENCE_KINDS as readonly string[]).includes(ev.kind);
    if (contextOnly && ev.result !== 'N/A') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `context evidence kind ${ev.kind} must have result N/A` });
    }
  });

export const bjcRequestSchema = z
  .object({
    schema: z.string(),
    request_id: z.string().regex(ID),
    work_item: z.string().regex(ID),
    task_id: z.string().regex(ID).optional(),
    invoked_by: z.string().regex(/^(human|claude-code):[A-Za-z0-9._@-]{1,100}$/),
    acceptance_criterion: z
      .object({
        id: z.string().regex(/^AC-\d{1,4}$/),
        statement: z.string().min(1).max(LIMITS.maxStatementChars),
        kind: z.enum(AC_KINDS),
        required_evidence: z.array(z.enum(DETERMINISTIC_EVIDENCE_KINDS)).max(DETERMINISTIC_EVIDENCE_KINDS.length),
      })
      .strict(),
    invariants: z
      .array(
        z
          .object({
            id: z.string().regex(/^INV-\d{1,4}$/),
            statement: z.string().min(1).max(LIMITS.maxStatementChars),
            source: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(LIMITS.maxInvariants),
    deterministic_summary: z.string().max(LIMITS.maxSummaryChars),
    evidence: z.array(evidenceSchema).max(LIMITS.maxEvidence),
    model: z.string().regex(MODEL_ID),
    input_hash: z.string().regex(INPUT_HASH_RE),
  })
  .strict()
  .superRefine((req, ctx) => {
    const ac = req.acceptance_criterion;
    if (ac.kind === 'OBJECTIVE' && ac.required_evidence.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'OBJECTIVE acceptance criterion must name required deterministic evidence' });
    }
    const ids = [...req.evidence.map((e) => e.id), ...req.invariants.map((i) => i.id)];
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'evidence and invariant ids must be unique' });
    }
  });

export type BjcRequest = z.infer<typeof bjcRequestSchema>;
export type BjcEvidence = BjcRequest['evidence'][number];

export interface BjcError {
  code: BjcErrorCode;
  /** Bounded, secret-free description. */
  message: string;
}

export interface JevAcJudgment {
  answer: JevAcAnswer;
  /** Probability of the chosen class, 2 dp; null when JEV gave no answer. */
  confidence: number | null;
  probabilities: Record<string, number> | null;
  low_confidence: boolean;
}

export interface JevInvariantJudgment {
  id: string;
  answer: JevInvariantAnswer;
  confidence: number;
}

export interface BjcResponse {
  schema: typeof CONTRACT_VERSION;
  request_id: string;
  work_item: string;
  ac_id: string | null;
  status: BjcStatus;
  /** Combined advisory outcome; null unless status is COMPLETED. */
  verdict: Verdict | null;
  /** Authoritative fact derived from deterministic evidence alone; null when the request was rejected. */
  deterministic_result: DeterministicResult | null;
  jev: JevAcJudgment;
  invariants: JevInvariantJudgment[];
  bundle_consistency: number | null;
  conflict: boolean;
  review_required: boolean;
  /**
   * True only when the judgment raises no objection: COMPLETED, OBJECTIVE AC,
   * deterministic PASS, no conflict, no invariant concern. Necessary, never
   * sufficient — BJC authorizes nothing.
   */
  verification_eligible: boolean;
  /** Bounded explanation generated by the combiner (the provider returns no text). */
  rationale: string;
  evidence_considered: string[];
  model: { requested: string | null; resolved: string; pinned: boolean };
  provider: typeof PROVIDER_NAME;
  reproducible: boolean;
  input_hash: string | null;
  /** sha256 of the exact provider request body; null when nothing was sent. */
  payload_hash: string | null;
  contract_version: typeof CONTRACT_VERSION;
  questions_version: typeof QUESTIONS_VERSION;
  client_version: typeof CLIENT_VERSION;
  timestamp: string;
  latency_ms: number;
  error: BjcError | null;
  audit: { record_id: string; written: boolean; error: string | null };
}

/** True for a floating alias such as `jev-latest`: allowed only when explicit, and never reproducible. */
export function isFloatingModel(model: string): boolean {
  return /(^|[-_.])latest$/.test(model);
}
