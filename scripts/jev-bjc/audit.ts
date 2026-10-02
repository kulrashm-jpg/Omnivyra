/**
 * BJC audit records (spec §2.7) — minimal local abstraction only.
 *
 * Metadata-only by design (decision D-03; the repository is public): no
 * criterion/invariant statements, no excerpts, no state text, no evidence
 * refs, no provider body, no key. Evidence is identified by id, kind, result
 * and content hash. Records are append-only JSONL, one file per UTC day.
 *
 * This is NOT the future evidence/judgment store; it is the smallest durable
 * sink that makes every invocation auditable.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BjcRequest, BjcResponse } from './contract';
import type { RedactionFinding } from './redaction';

export const AUDIT_DIR_ENV = 'BJC_AUDIT_DIR';

export interface BjcAuditRecord {
  record_id: string;
  request_id: string;
  work_item: string;
  task_id: string | null;
  invoked_by: string | null;
  ac_id: string | null;
  ac_kind: string | null;
  timestamp: string;
  status: BjcResponse['status'];
  verdict: BjcResponse['verdict'];
  deterministic_result: BjcResponse['deterministic_result'];
  jev_answer: BjcResponse['jev']['answer'];
  confidence: number | null;
  conflict: boolean;
  review_required: boolean;
  verification_eligible: boolean;
  model: BjcResponse['model'];
  provider: BjcResponse['provider'];
  reproducible: boolean;
  input_hash: string | null;
  payload_hash: string | null;
  evidence: Array<{ id: string; kind: string; result: string; sha256: string }>;
  invariant_ids: string[];
  error: BjcResponse['error'];
  redaction: { blocked: boolean; findings: RedactionFinding[] };
  latency_ms: number;
  versions: { contract: string; questions: string; client: string };
}

export interface AuditSink {
  append(record: BjcAuditRecord): Promise<void>;
}

export function buildAuditRecord(
  response: BjcResponse,
  request: BjcRequest | null,
  redaction: { blocked: boolean; findings: RedactionFinding[] },
): BjcAuditRecord {
  return {
    record_id: response.audit.record_id,
    request_id: response.request_id,
    work_item: response.work_item,
    task_id: request?.task_id ?? null,
    invoked_by: request?.invoked_by ?? null,
    ac_id: response.ac_id,
    ac_kind: request?.acceptance_criterion.kind ?? null,
    timestamp: response.timestamp,
    status: response.status,
    verdict: response.verdict,
    deterministic_result: response.deterministic_result,
    jev_answer: response.jev.answer,
    confidence: response.jev.confidence,
    conflict: response.conflict,
    review_required: response.review_required,
    verification_eligible: response.verification_eligible,
    model: response.model,
    provider: response.provider,
    reproducible: response.reproducible,
    input_hash: response.input_hash,
    payload_hash: response.payload_hash,
    evidence: (request?.evidence ?? []).map((ev) => ({ id: ev.id, kind: ev.kind, result: ev.result, sha256: ev.sha256 })),
    invariant_ids: (request?.invariants ?? []).map((inv) => inv.id),
    error: response.error,
    redaction,
    latency_ms: response.latency_ms,
    versions: { contract: response.contract_version, questions: response.questions_version, client: response.client_version },
  };
}

export class MemoryAuditSink implements AuditSink {
  readonly records: BjcAuditRecord[] = [];
  async append(record: BjcAuditRecord): Promise<void> {
    this.records.push(JSON.parse(JSON.stringify(record)));
  }
}

function insideGitWorkTree(dir: string): boolean {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function defaultAuditDir(env: Record<string, string | undefined>): string {
  const configured = (env[AUDIT_DIR_ENV] ?? '').trim();
  return configured || path.join(os.homedir(), '.omnivyra', 'bjc-audit');
}

/** Append-only JSONL sink. Refuses any directory inside a git work tree, so records cannot land in the (public) repo. */
export class FileAuditSink implements AuditSink {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = path.resolve(dir);
    if (insideGitWorkTree(this.dir)) {
      throw new Error(`BJC audit directory must be outside any git work tree: ${this.dir}`);
    }
  }

  async append(record: BjcAuditRecord): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `bjc-audit-${record.timestamp.slice(0, 10)}.jsonl`);
    await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
  }
}
