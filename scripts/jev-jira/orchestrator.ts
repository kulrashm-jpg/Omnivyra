/**
 * Jira ↔ BJC orchestrator — phase 2, T1 / Acceptance Criterion only.
 *
 * The explicit mediation layer: Jira never calls JEV and JEV never calls
 * Jira. runAcJudgment() runs only when a caller deliberately invokes it for
 * one issue key; there are no hooks, webhooks, schedules or background work.
 *
 *   Jira AC (+ parent Story) → bounded BJC request → judge() (JEV advisory +
 *   deterministic combiner) → integration audit → optional advisory write-back
 *
 * It never throws. Every failure is a typed result and is audited; a JEV
 * failure never produces a Jira write and never touches deterministic fields.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONTRACT_VERSION, QUESTIONS_VERSION, type BjcResponse } from '../jev-bjc/contract';
import { canonicalJson, sha256Hex } from '../jev-bjc/canonical';
import type { AuditSink } from '../jev-bjc/audit';
import type { JevTransport } from '../jev-bjc/provider';
import { judge } from '../jev-bjc/judge';
import { AC_FETCH_FIELDS, STORY_FETCH_FIELDS, buildBjcRequest, extractAcContext, extractStoryContext } from './context';
import { ISSUE_KEY_RE, JiraClientError, type JiraClient, type JiraIssue } from './jiraClient';
import { buildAdvisoryUpdate, mapJiraJevVerdict, writeAdvisoryFields, type WritebackResult } from './writeback';

export const INTEGRATION_VERSION = 'bjc-jira/1' as const;

export type IntegrationStatus = 'COMPLETED' | 'JUDGMENT_UNAVAILABLE' | 'BJC_REJECTED' | 'REJECTED' | 'JIRA_ERROR';

export interface IntegrationAuditRecord {
  record_id: string;
  schema: typeof INTEGRATION_VERSION;
  timestamp: string;
  invoked_by: string | null;
  jira_issue_key: string;
  parent_story_key: string | null;
  ac_id: string | null;
  ac_kind: string | null;
  status: IntegrationStatus;
  error: { code: string; message: string } | null;
  input_hash: string | null;
  evidence_digest: string | null;
  evidence: Array<{ id: string; kind: string; result: string; sha256: string }>;
  jira_recorded_deterministic_result: string | null;
  deterministic_result: BjcResponse['deterministic_result'];
  jev_answer: BjcResponse['jev']['answer'] | null;
  jev_confidence: number | null;
  jira_jev_verdict: string | null;
  combiner: { verdict: BjcResponse['verdict']; conflict: boolean; review_required: boolean; verification_eligible: boolean } | null;
  model: { requested: string | null; resolved: string | null; pinned: boolean };
  reproducible: boolean;
  bjc: { status: BjcResponse['status'] | null; error_code: string | null; audit_record_id: string | null; audit_written: boolean };
  writeback: { requested: boolean; status: WritebackResult['status'] | null; fields_written: string[]; error: string | null };
  versions: { integration: string; contract: string; questions: string };
}

export interface IntegrationAuditSink {
  append(record: IntegrationAuditRecord): Promise<void>;
}

export interface IntegrationResult {
  status: IntegrationStatus;
  ok: boolean;
  jira_issue_key: string;
  error: { code: string; message: string } | null;
  bjc: BjcResponse | null;
  writeback: WritebackResult | null;
  reproducibility: { model_requested: string | null; model_resolved: string | null; pinned: boolean; reproducible: boolean; input_hash: string | null; schema: string };
  audit: { record_id: string; written: boolean; error: string | null };
}

export interface RunInput {
  jiraIssueKey: string;
  model: string;
  invokedBy: string;
  /** Write the advisory fields back to Jira. Off ⇒ Jira is only read. */
  writeBack: boolean;
}

export interface OrchestratorDeps {
  jira: JiraClient;
  /** null when TYPESAFE_API_KEY is absent — BJC then fails visibly with MISSING_API_KEY. */
  transport: JevTransport | null;
  bjcAudit: AuditSink;
  audit: IntegrationAuditSink;
  now?: () => Date;
  newRecordId?: () => string;
}

const bounded = (t: string, max = 300): string => (t.length > max ? `${t.slice(0, max - 3)}...` : t);

export async function runAcJudgment(input: RunInput, deps: OrchestratorDeps): Promise<IntegrationResult> {
  const now = deps.now ?? (() => new Date());
  const key = typeof input?.jiraIssueKey === 'string' && ISSUE_KEY_RE.test(input.jiraIssueKey) ? input.jiraIssueKey : 'invalid';
  const record: IntegrationAuditRecord = {
    record_id: (deps.newRecordId ?? randomUUID)(),
    schema: INTEGRATION_VERSION,
    timestamp: now().toISOString(),
    invoked_by: typeof input?.invokedBy === 'string' && /^(human|claude-code):[A-Za-z0-9._@-]{1,100}$/.test(input.invokedBy) ? input.invokedBy : null,
    jira_issue_key: key,
    parent_story_key: null,
    ac_id: null,
    ac_kind: null,
    status: 'REJECTED',
    error: null,
    input_hash: null,
    evidence_digest: null,
    evidence: [],
    jira_recorded_deterministic_result: null,
    deterministic_result: null,
    jev_answer: null,
    jev_confidence: null,
    jira_jev_verdict: null,
    combiner: null,
    model: { requested: null, resolved: null, pinned: false },
    reproducible: false,
    bjc: { status: null, error_code: null, audit_record_id: null, audit_written: false },
    writeback: { requested: input?.writeBack === true, status: null, fields_written: [], error: null },
    versions: { integration: INTEGRATION_VERSION, contract: CONTRACT_VERSION, questions: QUESTIONS_VERSION },
  };
  let bjc: BjcResponse | null = null;
  let writeback: WritebackResult | null = null;

  const stop = (status: IntegrationStatus, code: string, message: string): void => {
    record.status = status;
    record.error = { code, message: bounded(message) };
  };

  try {
    await run();
  } catch {
    stop('JIRA_ERROR', 'INTERNAL_ERROR', 'unexpected internal error in the orchestrator');
  }

  const result: IntegrationResult = {
    status: record.status,
    ok: record.status === 'COMPLETED' && (writeback === null || writeback.status === 'WRITTEN' || writeback.status === 'SKIPPED'),
    jira_issue_key: key,
    error: record.error,
    bjc,
    writeback,
    reproducibility: {
      model_requested: record.model.requested,
      model_resolved: record.model.resolved,
      pinned: record.model.pinned,
      reproducible: record.reproducible,
      input_hash: record.input_hash,
      schema: INTEGRATION_VERSION,
    },
    audit: { record_id: record.record_id, written: false, error: null },
  };
  try {
    await deps.audit.append(record);
    result.audit.written = true;
  } catch (err) {
    result.audit.error = bounded(`integration audit write failed: ${(err as Error)?.message ?? 'unknown error'}`, 200);
    result.ok = false;
  }
  return result;

  async function run(): Promise<void> {
    if (key === 'invalid') return stop('REJECTED', 'INVALID_ISSUE_KEY', 'jiraIssueKey must look like OMNI-<number>');
    if (!record.invoked_by) return stop('REJECTED', 'INVALID_INVOKER', 'invokedBy must be human:<id> or claude-code:<id>');

    let acIssue: JiraIssue;
    let storyIssue: JiraIssue;
    try {
      acIssue = await deps.jira.getIssue(key, AC_FETCH_FIELDS);
    } catch (err) {
      return stop('JIRA_ERROR', err instanceof JiraClientError ? err.code : 'JIRA_ERROR', err instanceof JiraClientError ? err.message : 'Jira read failed');
    }
    const ac = extractAcContext(acIssue);
    if (ac.ok === false) return stop('REJECTED', ac.code, ac.message);
    record.parent_story_key = ac.value.parentKey;
    record.ac_id = ac.value.acId;
    record.ac_kind = ac.value.kind;
    record.jira_recorded_deterministic_result = ac.value.deterministicResult;

    try {
      storyIssue = await deps.jira.getIssue(ac.value.parentKey, STORY_FETCH_FIELDS);
    } catch (err) {
      return stop('JIRA_ERROR', err instanceof JiraClientError ? err.code : 'JIRA_ERROR', err instanceof JiraClientError ? `parent Story: ${err.message}` : 'Jira read failed');
    }
    const story = extractStoryContext(storyIssue);
    if (story.ok === false) return stop('REJECTED', story.code, story.message);

    const built = buildBjcRequest(ac.value, story.value, { model: input.model, invokedBy: record.invoked_by });
    if (built.ok === false) return stop('REJECTED', built.code, built.message);
    const request = built.value;
    record.evidence = request.evidence.map((ev) => ({ id: ev.id, kind: ev.kind, result: ev.result, sha256: ev.sha256 }));
    record.evidence_digest = `sha256:${sha256Hex(canonicalJson(record.evidence))}`;

    bjc = await judge(request, { transport: deps.transport, audit: deps.bjcAudit, now: deps.now });
    record.input_hash = bjc.input_hash;
    record.deterministic_result = bjc.deterministic_result;
    record.model = { requested: bjc.model.requested, resolved: bjc.model.resolved, pinned: bjc.model.pinned };
    record.reproducible = bjc.reproducible;
    record.bjc = { status: bjc.status, error_code: bjc.error?.code ?? null, audit_record_id: bjc.audit.record_id, audit_written: bjc.audit.written };

    if (bjc.status === 'REQUEST_REJECTED') return stop('BJC_REJECTED', bjc.error?.code ?? 'REQUEST_REJECTED', bjc.error?.message ?? 'BJC rejected the request');
    if (bjc.status !== 'COMPLETED') {
      stop('JUDGMENT_UNAVAILABLE', bjc.error?.code ?? 'JUDGMENT_UNAVAILABLE', bjc.error?.message ?? 'no advisory judgment');
      record.writeback = { requested: input.writeBack, status: 'SKIPPED', fields_written: [], error: 'no completed judgment; Jira left unchanged' };
      writeback = { status: 'SKIPPED', fields_written: [], error: 'no completed judgment; Jira left unchanged' };
      return;
    }

    record.status = 'COMPLETED';
    record.jev_answer = bjc.jev.answer;
    record.jev_confidence = bjc.jev.confidence;
    record.jira_jev_verdict = mapJiraJevVerdict(bjc);
    record.combiner = { verdict: bjc.verdict, conflict: bjc.conflict, review_required: bjc.review_required, verification_eligible: bjc.verification_eligible };

    writeback = input.writeBack
      ? await writeAdvisoryFields(deps.jira, key, acIssue, buildAdvisoryUpdate(bjc))
      : { status: 'SKIPPED', fields_written: [], error: 'write-back not requested' };
    record.writeback = { requested: input.writeBack, status: writeback.status, fields_written: writeback.fields_written, error: writeback.error };
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

/** Append-only JSONL, one file per UTC day. Refuses any directory inside a git work tree (the repo is public). */
export class FileIntegrationAuditSink implements IntegrationAuditSink {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = path.resolve(dir);
    if (insideGitWorkTree(this.dir)) throw new Error(`integration audit directory must be outside any git work tree: ${this.dir}`);
  }

  async append(record: IntegrationAuditRecord): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `bjc-jira-audit-${record.timestamp.slice(0, 10)}.jsonl`);
    await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
  }
}

export class MemoryIntegrationAuditSink implements IntegrationAuditSink {
  readonly records: IntegrationAuditRecord[] = [];
  async append(record: IntegrationAuditRecord): Promise<void> {
    this.records.push(JSON.parse(JSON.stringify(record)));
  }
}
