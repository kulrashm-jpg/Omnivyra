/**
 * Governed Claude workflow ("gov") — `gov judge` (Track 4).
 *
 * Takes a stored packet + a stored evidence bundle produced by `gov verify`
 * and asks JEV, through Phase 2 BJC `judge()` only, for an advisory judgment
 * of every packet Acceptance Criterion. Optionally projects the result onto the
 * four JEV advisory fields through Phase 2 `writeAdvisoryFields` — the ONLY
 * Jira write path in this module. No workflow moves, no creates, no protected
 * field writes, no HTTP of its own.
 *
 * Fail closed BEFORE any JEV call (in this order):
 *  1. packet hash, 2. bundle hash, 3. bundle ↔ packet binding  → INTEGRITY_FAILED
 *  4. bundle came from a successful `gov verify` (scope ok, items)  → REFUSED
 *  5. HEAD unchanged since verification → INTEGRITY_FAILED; dirty tree → REFUSED
 *  6. every AC re-read from Jira and unchanged since the packet → else STALE
 *
 * Deterministic evidence is authoritative (BJC combiner): a FAIL bundle flows
 * through BJC and stays FAIL; JEV can only add conflict / review flags.
 * Never throws for expected failures; every outcome is a JudgeFlowResult.
 */
import { LIMITS, type BjcEvidence, type BjcRequest, type BjcResponse } from '../jev-bjc/contract';
import { computeInputHash } from '../jev-bjc/canonical';
import { judge } from '../jev-bjc/judge';
import type { AuditSink } from '../jev-bjc/audit';
import type { JevTransport } from '../jev-bjc/provider';
import { JiraClientError, type JiraClient, type JiraIssue } from '../jev-jira/jiraClient';
import { AC_FETCH_FIELDS, extractAcContext } from '../jev-jira/context';
import { buildAdvisoryUpdate, mapJiraJevVerdict, writeAdvisoryFields } from '../jev-jira/writeback';
import { DEFAULT_JEV_MODEL } from '../jev-jira/cli';
import {
  AC_EVIDENCE_KIND_TO_BJC,
  GOVERNANCE_VERSION,
  JUDGE_SCHEMA,
  SHA256_REF_RE,
  bundleHash,
  hashHex,
  packetHash,
  type AcJudgment,
  type EvidenceItem,
  type GitProbe,
  type GovStatus,
  type JudgeFlowResult,
  type PacketAc,
  type StoredEvidenceBundle,
  type StoredPacket,
} from './types';

export interface JudgeFlowInput {
  stored: StoredPacket;
  evidence: StoredEvidenceBundle;
  /** Absolute path of the governed worktree (the one `gov verify` ran in). */
  worktree: string;
  git: GitProbe;
  jira: JiraClient;
  /** null when no JEV key is configured — every AC then ends JUDGMENT_UNAVAILABLE. */
  transport: JevTransport | null;
  bjcAudit: AuditSink;
  writeBack: boolean;
  /** `human:<id>` or `claude-code:<id>` (Phase 2 rule). */
  invokedBy: string;
  model?: string;
  now?: () => Date;
  newRecordId?: () => string;
}

/** Same shapes Phase 2 enforces (contract.ts bjcRequestSchema). */
const INVOKED_BY_RE = /^(human|claude-code):[A-Za-z0-9._@-]{1,100}$/;
const MODEL_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const AC_ID_RE = /^AC-\d{1,4}$/;
const EV_ID_RE = /^EV-\d{1,4}$/;
const BJC_KIND = { Deterministic: 'OBJECTIVE', Judgment: 'JUDGMENT' } as const;

const bounded = (text: string, max = 300): string => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** Jira timestamps come as `...+0000`; compare instants, not spellings. */
function instant(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function issueNumber(key: string): number {
  const n = Number(key.slice(key.indexOf('-') + 1));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function isIsoDate(v: unknown): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
}

function malformedItem(item: EvidenceItem): boolean {
  return (
    !item ||
    !EV_ID_RE.test(String(item.id)) ||
    !['test_run', 'typecheck', 'build'].includes(item.evidence_kind) ||
    (item.result !== 'PASS' && item.result !== 'FAIL') ||
    !SHA256_REF_RE.test(String(item.log_sha256)) ||
    typeof item.registry_id !== 'string' ||
    !isIsoDate(item.finished_at)
  );
}

/** Bounded, metadata-only summary of what `gov verify` recorded (no log content). */
export function deterministicSummary(head: string, branch: string, items: EvidenceItem[], overall: string): string {
  const head12 = head.slice(0, 12);
  const full = `${GOVERNANCE_VERSION} verified ${head12} on ${branch}: ${items.map((i) => `${i.registry_id}=${i.result}`).join(', ')}; scope ok; overall ${overall}.`;
  if (full.length <= LIMITS.maxSummaryChars) return full;
  const pass = items.filter((i) => i.result === 'PASS').length;
  const short = `${GOVERNANCE_VERSION} verified ${head12}: ${items.length} registry checks, ${pass} PASS, ${items.length - pass} FAIL; scope ok; overall ${overall}.`;
  return short.slice(0, LIMITS.maxSummaryChars);
}

export type BuildGovRequestResult = { ok: true; request: BjcRequest } | { ok: false; message: string };

/** One bounded `bjc/1` request for one packet AC. Pure. */
export function buildGovBjcRequest(stored: StoredPacket, evidence: StoredEvidenceBundle, ac: PacketAc, invokedBy: string, model: string): BuildGovRequestResult {
  const packet = stored.packet;
  const bundle = evidence.bundle;
  const kind = BJC_KIND[ac.kind as keyof typeof BJC_KIND];
  if (!kind) return { ok: false, message: `${ac.key}: AC kind must be Deterministic or Judgment` };
  if (!AC_ID_RE.test(ac.ac_id)) return { ok: false, message: `${ac.key}: AC ID must look like AC-<1-4 digits>` };
  if (typeof ac.statement !== 'string' || ac.statement.trim().length === 0 || ac.statement.length > LIMITS.maxStatementChars) {
    return { ok: false, message: `${ac.key}: AC statement is empty or exceeds ${LIMITS.maxStatementChars} chars` };
  }
  const bjcKind = AC_EVIDENCE_KIND_TO_BJC[ac.evidence_kind];
  if (kind === 'OBJECTIVE' && !bjcKind) return { ok: false, message: `${ac.key}: Evidence Kind ${ac.evidence_kind} has no deterministic BJC kind` };

  // Oversize is rejected, never truncated (BJC policy): dropping invariants would silently narrow the judgment.
  const invariantLines = (packet.story.invariants ?? []).map((s) => String(s).trim()).filter((s) => s.length > 0);
  if (invariantLines.length > LIMITS.maxInvariants) return { ok: false, message: `Story has ${invariantLines.length} invariants (limit ${LIMITS.maxInvariants})` };
  if (invariantLines.some((s) => s.length > LIMITS.maxStatementChars)) return { ok: false, message: `an invariant exceeds ${LIMITS.maxStatementChars} chars` };
  const invariants = invariantLines.map((statement, i) => ({ id: `INV-${i + 1}`, statement, source: `${packet.story.key} Invariants` }));

  const head12 = bundle.head_commit.slice(0, 12);
  const relevant = kind === 'OBJECTIVE' ? bundle.items.filter((i) => i.evidence_kind === bjcKind) : bundle.items;
  if (relevant.length > LIMITS.maxEvidence) return { ok: false, message: `${relevant.length} evidence items (limit ${LIMITS.maxEvidence})` };
  // Metadata only: no excerpt, no log, no diff, no argv.
  const evidenceItems: BjcEvidence[] = relevant.map((item) => ({
    id: item.id,
    kind: item.evidence_kind,
    ref: `gov:${item.registry_id}@${head12}`,
    sha256: hashHex(item.log_sha256),
    produced_by: GOVERNANCE_VERSION,
    result: item.result,
    captured_at: item.finished_at,
    ac_ids: [ac.ac_id],
  }));

  const draft = {
    schema: 'bjc/1',
    request_id: `gov-${ac.key}-${hashHex(evidence.bundle_hash).slice(0, 12)}`,
    work_item: ac.key,
    task_id: packet.story.key,
    invoked_by: invokedBy,
    acceptance_criterion: {
      id: ac.ac_id,
      statement: ac.statement,
      kind,
      required_evidence: kind === 'OBJECTIVE' ? [bjcKind] : [],
    },
    invariants,
    deterministic_summary: deterministicSummary(bundle.head_commit, bundle.branch, bundle.items, bundle.deterministic_result),
    evidence: evidenceItems,
    model,
  } as Omit<BjcRequest, 'input_hash'>;
  return { ok: true, request: { ...draft, input_hash: computeInputHash(draft) } as BjcRequest };
}

function toJudgment(ac: PacketAc, request: BjcRequest, res: BjcResponse, writebackStatus: string): AcJudgment {
  return {
    ac_key: ac.key,
    ac_id: ac.ac_id,
    evidence_ids: request.evidence.map((e) => e.id),
    bjc_status: res.status,
    deterministic_result: res.deterministic_result ?? 'MISSING',
    jev_answer: res.jev.answer === 'NONE' ? null : res.jev.answer,
    combined_verdict: res.verdict,
    jira_jev_verdict: mapJiraJevVerdict(res),
    conflict: res.conflict,
    review_required: res.review_required,
    writeback_status: writebackStatus,
    bjc_audit_record_id: res.audit?.record_id ?? null,
    input_hash: res.input_hash,
  };
}

export async function runJudgeFlow(input: JudgeFlowInput): Promise<JudgeFlowResult> {
  const model = input?.model ?? DEFAULT_JEV_MODEL;
  const result: JudgeFlowResult = {
    schema: JUDGE_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    status: 'ERROR',
    story_key: input?.stored?.packet?.story?.key ?? 'unknown',
    packet_hash: input?.stored?.packet_hash,
    bundle_hash: input?.evidence?.bundle_hash,
    model,
    write_back: input?.writeBack === true,
    per_ac: [],
    error: null,
  };
  const stop = (status: GovStatus, message: string): JudgeFlowResult => {
    result.status = status;
    result.error = bounded(message, 500);
    return result;
  };

  try {
    const { stored, evidence, worktree, git, jira } = input;
    if (!stored?.packet || !evidence?.bundle) return stop('REFUSED', 'a stored packet and a stored evidence bundle are required');
    if (typeof input.invokedBy !== 'string' || !INVOKED_BY_RE.test(input.invokedBy)) {
      return stop('REFUSED', 'invoked-by must be human:<id> or claude-code:<id>');
    }
    if (!MODEL_RE.test(model)) return stop('REFUSED', 'model id is not a valid JEV model id');

    // 1–3. integrity
    if (packetHash(stored.packet) !== stored.packet_hash) return stop('INTEGRITY_FAILED', 'packet hash does not match the stored packet');
    const bundle = evidence.bundle;
    if (bundleHash(bundle) !== evidence.bundle_hash) return stop('INTEGRITY_FAILED', 'evidence bundle hash does not match the stored bundle');
    if (bundle.packet_hash !== stored.packet_hash) return stop('INTEGRITY_FAILED', 'evidence bundle was produced for a different packet');
    if (bundle.story_key !== stored.packet.story.key) return stop('INTEGRITY_FAILED', 'evidence bundle story key does not match the packet');

    // 4. bundle must come from a successful `gov verify` run (FAIL evidence is still evidence)
    if (!bundle.scope || bundle.scope.ok !== true) return stop('REFUSED', 'evidence bundle has no passing scope check; run gov verify');
    if (!Array.isArray(bundle.items) || bundle.items.length === 0) return stop('REFUSED', 'evidence bundle has no evidence items; run gov verify');
    if (bundle.items.some(malformedItem)) return stop('REFUSED', 'evidence bundle has a malformed evidence item');
    if (new Set(bundle.items.map((i) => i.id)).size !== bundle.items.length) return stop('REFUSED', 'evidence bundle has duplicate evidence ids');
    if (bundle.deterministic_result !== 'PASS' && bundle.deterministic_result !== 'FAIL') return stop('REFUSED', 'evidence bundle has no deterministic result');

    // 5. the code judged is the code verified
    let head: string;
    let clean: boolean;
    try {
      head = await git.headCommit(worktree);
      clean = await git.isClean(worktree);
    } catch {
      return stop('ERROR', 'git probe failed for the governed worktree');
    }
    if (head !== bundle.head_commit) return stop('INTEGRITY_FAILED', 'HEAD moved after verification; run gov verify again');
    if (clean !== true) return stop('REFUSED', 'worktree has uncommitted or untracked changes');

    const acs = [...(stored.packet.acceptance_criteria ?? [])].sort((a, b) => issueNumber(a.key) - issueNumber(b.key) || a.key.localeCompare(b.key));
    if (acs.length === 0) return stop('REFUSED', 'packet has no acceptance criteria');

    // Build every request before any network call: a bad request refuses the whole run.
    const requests = new Map<string, BjcRequest>();
    for (const ac of acs) {
      const built = buildGovBjcRequest(stored, evidence, ac, input.invokedBy, model);
      if (built.ok === false) return stop('REFUSED', built.message);
      requests.set(ac.key, built.request);
    }

    // 6. staleness: every AC re-read; any change since the packet refuses the whole run
    const fresh = new Map<string, JiraIssue>();
    for (const ac of acs) {
      let issue: JiraIssue;
      try {
        issue = await jira.getIssue(ac.key, AC_FETCH_FIELDS);
      } catch (err) {
        if (err instanceof JiraClientError && err.code === 'JIRA_NOT_FOUND') return stop('STALE', `${ac.key} no longer exists in Jira`);
        return stop('ERROR', err instanceof JiraClientError ? `Jira read of ${ac.key} failed: ${err.code}` : `Jira read of ${ac.key} failed`);
      }
      const ctx = extractAcContext(issue);
      if (ctx.ok === false) return stop('STALE', `${ac.key} is no longer a valid Acceptance Criterion (${ctx.code})`);
      const was = instant(ac.updated) ?? ac.updated;
      if (ctx.value.updated !== was) return stop('STALE', `${ac.key} changed in Jira after the packet was generated; regenerate the packet`);
      if (ctx.value.parentKey !== stored.packet.story.key || ctx.value.acId !== ac.ac_id) {
        return stop('STALE', `${ac.key} no longer matches the packet (parent or AC ID changed)`);
      }
      fresh.set(ac.key, issue);
    }

    // judge every AC through BJC (never throws)
    const responses = new Map<string, BjcResponse>();
    for (const ac of acs) {
      const res = await judge(requests.get(ac.key), {
        transport: input.transport,
        audit: input.bjcAudit,
        now: input.now,
        newRecordId: input.newRecordId,
      });
      responses.set(ac.key, res);
    }
    const incomplete = acs.filter((ac) => responses.get(ac.key).status !== 'COMPLETED');

    // write-back only when every AC completed — a partial run leaves Jira untouched
    let writeFailures = 0;
    for (const ac of acs) {
      const res = responses.get(ac.key);
      let wb = 'SKIPPED';
      if (input.writeBack === true && incomplete.length === 0) {
        const out = await writeAdvisoryFields(jira, ac.key, fresh.get(ac.key), buildAdvisoryUpdate(res));
        wb = out.status;
        if (out.status !== 'WRITTEN') writeFailures += 1;
      }
      result.per_ac.push(toJudgment(ac, requests.get(ac.key), res, wb));
    }

    if (incomplete.length > 0) {
      const first = responses.get(incomplete[0].key);
      return stop(
        'JUDGMENT_UNAVAILABLE',
        `${incomplete.length} of ${acs.length} AC judgments did not complete (${first.status}${first.error ? `: ${first.error.code}` : ''}); nothing written`,
      );
    }
    if (writeFailures > 0) return stop('ERROR', `${writeFailures} of ${acs.length} advisory write-backs did not complete; see per_ac writeback_status`);
    result.status = 'OK';
    result.error = null;
    return result;
  } catch (err) {
    return stop('ERROR', `unexpected error in gov judge: ${bounded((err as Error)?.message ?? 'unknown', 200)}`);
  }
}
