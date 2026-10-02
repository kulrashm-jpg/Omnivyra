/**
 * Jira AC → bounded BJC request. PURE — no I/O.
 *
 * Reads exactly one Acceptance Criterion and its parent Story (never the
 * project, never other issues), validates them, and builds a `bjc/1`
 * request. Oversize text is rejected, never truncated (BJC policy).
 *
 * Evidence provenance (limitation, stated plainly): in this phase the
 * deterministic result is the one RECORDED on the Jira AC (Deterministic
 * Result + Evidence Kind + Evidence References). The evidence item's sha256 is
 * a digest of the recorded reference text, not of the underlying artifact;
 * the orchestrator does not re-run or fetch the artifact.
 */
import { randomUUID } from 'node:crypto';
import { LIMITS, type BjcEvidence, type BjcRequest } from '../jev-bjc/contract';
import { computeInputHash, sha256Hex } from '../jev-bjc/canonical';
import { AC_FIELDS, AC_KIND_TO_BJC, EVIDENCE_KIND_TO_BJC, ISSUE_TYPE, OMNI_PROJECT_ID, STORY_FIELDS } from './fields';
import type { JiraIssue } from './jiraClient';

/** Field lists requested from Jira — the orchestrator never asks for more. */
export const AC_FETCH_FIELDS = ['issuetype', 'project', 'status', 'parent', 'updated', ...Object.values(AC_FIELDS)];
export const STORY_FETCH_FIELDS = ['issuetype', 'project', 'updated', ...Object.values(STORY_FIELDS)];

export interface AcContext {
  issueKey: string;
  status: string | null;
  parentKey: string;
  updated: string;
  acId: string;
  statement: string;
  kind: string;
  evidenceKind: string | null;
  deterministicResult: string | null;
  evidenceReferences: string | null;
  verification: string | null;
  advisory: {
    jevVerdict: string | null;
    jevConfidence: number | null;
    jevModel: string | null;
    jevInputHash: string | null;
    jevAdvisoryDisposition: string | null;
  };
}

export interface StoryContext {
  key: string;
  updated: string;
  objective: string | null;
  architecture: string | null;
  invariants: string | null;
  prohibitedPaths: string | null;
  verificationRequirements: string | null;
  evidenceReferences: string | null;
  gateResult: string | null;
  commit: string | null;
}

export type ContextErrorCode =
  | 'NOT_AN_ACCEPTANCE_CRITERION'
  | 'WRONG_PROJECT'
  | 'NO_PARENT_STORY'
  | 'PARENT_NOT_STORY'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_AC_ID'
  | 'UNSUPPORTED_AC_KIND'
  | 'UNSUPPORTED_EVIDENCE_KIND'
  | 'OVERSIZE'
  | 'MALFORMED_ISSUE';

export type Result<T> = { ok: true; value: T } | { ok: false; code: ContextErrorCode; message: string };

const fail = <T>(code: ContextErrorCode, message: string): Result<T> => ({ ok: false, code, message });

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
const select = (v: unknown): string | null =>
  v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'string' ? (v as { value: string }).value : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const idOf = (v: unknown): string | null =>
  v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null;

function isoTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function extractAcContext(issue: JiraIssue): Result<AcContext> {
  const f = issue.fields;
  if (idOf(f.issuetype) !== ISSUE_TYPE.acceptanceCriterion) return fail('NOT_AN_ACCEPTANCE_CRITERION', 'issue is not an Acceptance Criterion (type 10074)');
  if (idOf(f.project) !== OMNI_PROJECT_ID) return fail('WRONG_PROJECT', 'issue is not in project OMNI (10033)');
  const parent = f.parent as { key?: unknown } | null | undefined;
  const parentKey = parent && typeof parent.key === 'string' ? parent.key : null;
  if (!parentKey) return fail('NO_PARENT_STORY', 'acceptance criterion has no parent Story');
  const updated = isoTime(f.updated);
  if (!updated) return fail('MALFORMED_ISSUE', 'issue has no valid updated timestamp');

  const acId = text(f[AC_FIELDS.acId]);
  const statement = text(f[AC_FIELDS.statement]);
  const kind = select(f[AC_FIELDS.kind]);
  const missing = [!acId && 'AC ID', !statement && 'Statement', !kind && 'Kind'].filter(Boolean);
  if (missing.length > 0) return fail('MISSING_REQUIRED_FIELD', `acceptance criterion is missing: ${missing.join(', ')}`);

  const status = f.status && typeof (f.status as { name?: unknown }).name === 'string' ? (f.status as { name: string }).name : null;
  return {
    ok: true,
    value: {
      issueKey: issue.key,
      status,
      parentKey,
      updated,
      acId: acId as string,
      statement: statement as string,
      kind: kind as string,
      evidenceKind: select(f[AC_FIELDS.evidenceKind]),
      deterministicResult: select(f[AC_FIELDS.deterministicResult]),
      evidenceReferences: text(f[AC_FIELDS.evidenceReferences]),
      verification: select(f[AC_FIELDS.verification]),
      advisory: {
        jevVerdict: select(f[AC_FIELDS.jevVerdict]),
        jevConfidence: num(f[AC_FIELDS.jevConfidence]),
        jevModel: text(f[AC_FIELDS.jevModel]),
        jevInputHash: text(f[AC_FIELDS.jevInputHash]),
        jevAdvisoryDisposition: select(f[AC_FIELDS.jevAdvisoryDisposition]),
      },
    },
  };
}

export function extractStoryContext(issue: JiraIssue): Result<StoryContext> {
  const f = issue.fields;
  if (idOf(f.issuetype) !== ISSUE_TYPE.story) return fail('PARENT_NOT_STORY', 'parent of the acceptance criterion is not a Story');
  if (idOf(f.project) !== OMNI_PROJECT_ID) return fail('WRONG_PROJECT', 'parent Story is not in project OMNI (10033)');
  const updated = isoTime(f.updated);
  if (!updated) return fail('MALFORMED_ISSUE', 'parent Story has no valid updated timestamp');
  return {
    ok: true,
    value: {
      key: issue.key,
      updated,
      objective: text(f[STORY_FIELDS.objective]),
      architecture: text(f[STORY_FIELDS.architecture]),
      invariants: text(f[STORY_FIELDS.invariants]),
      prohibitedPaths: text(f[STORY_FIELDS.prohibitedPaths]),
      verificationRequirements: text(f[STORY_FIELDS.verificationRequirements]),
      evidenceReferences: text(f[STORY_FIELDS.evidenceReferences]),
      gateResult: select(f[STORY_FIELDS.gateResult]),
      commit: text(f[STORY_FIELDS.commit]),
    },
  };
}

/** One invariant per non-empty line; leading bullets removed. Never truncated. */
export function parseInvariants(raw: string | null, storyKey: string): Result<BjcRequest['invariants']> {
  const lines = (raw ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0);
  if (lines.length > LIMITS.maxInvariants) return fail('OVERSIZE', `Story has ${lines.length} invariants (limit ${LIMITS.maxInvariants})`);
  if (lines.some((l) => l.length > LIMITS.maxStatementChars)) return fail('OVERSIZE', `an invariant exceeds ${LIMITS.maxStatementChars} chars`);
  return { ok: true, value: lines.map((statement, i) => ({ id: `INV-${i + 1}`, statement, source: `jira:${storyKey}:Invariants` })) };
}

export interface BuildOptions {
  model: string;
  invokedBy: string;
  requestId?: string;
}

export function buildBjcRequest(ac: AcContext, story: StoryContext, opts: BuildOptions): Result<BjcRequest> {
  if (!/^AC-\d{1,4}$/.test(ac.acId)) return fail('INVALID_AC_ID', 'AC ID must look like AC-<1-4 digits>');
  const kind = AC_KIND_TO_BJC[ac.kind];
  if (!kind) return fail('UNSUPPORTED_AC_KIND', 'Kind must be Deterministic or Judgment');
  if (ac.statement.length > LIMITS.maxStatementChars) return fail('OVERSIZE', `Statement exceeds ${LIMITS.maxStatementChars} chars`);
  if (ac.evidenceReferences && ac.evidenceReferences.length > LIMITS.maxRefChars) {
    return fail('OVERSIZE', `Evidence References exceeds ${LIMITS.maxRefChars} chars`);
  }

  const bjcEvidenceKind = ac.evidenceKind ? EVIDENCE_KIND_TO_BJC[ac.evidenceKind] : undefined;
  if (kind === 'OBJECTIVE' && !bjcEvidenceKind) {
    return fail('UNSUPPORTED_EVIDENCE_KIND', `Evidence Kind ${ac.evidenceKind ?? '(empty)'} has no deterministic BJC v1 kind (Test, Typecheck, Build only)`);
  }

  const invariants = parseInvariants(story.invariants, story.key);
  if (invariants.ok === false) return invariants;

  const evidence: BjcEvidence[] = [];
  const refs = ac.evidenceReferences;
  const recorded = ac.deterministicResult === 'PASS' || ac.deterministicResult === 'FAIL' ? ac.deterministicResult : null;
  // A recorded FAIL stands even without references; a PASS counts only with references behind it.
  if (bjcEvidenceKind && (recorded === 'FAIL' || (recorded === 'PASS' && refs))) {
    const ref = refs ?? `jira:${ac.issueKey}:deterministic-result=FAIL (no evidence references recorded)`;
    evidence.push({
      id: 'EV-1',
      kind: bjcEvidenceKind,
      ref,
      sha256: sha256Hex(ref),
      produced_by: `jira:${ac.issueKey}:deterministic-result`,
      result: recorded as 'PASS' | 'FAIL',
      captured_at: ac.updated,
      ac_ids: [ac.acId],
    });
  } else if (refs) {
    // References without a recorded PASS/FAIL are context only: they can never count as a result.
    evidence.push({
      id: 'EV-1',
      kind: 'manual_observation',
      ref: refs,
      sha256: sha256Hex(refs),
      produced_by: `jira:${ac.issueKey}:evidence-references`,
      result: 'N/A',
      captured_at: ac.updated,
      ac_ids: [ac.acId],
    });
  }
  if (story.commit && /^[0-9a-f]{7,40}$/i.test(story.commit)) {
    evidence.push({
      id: 'EV-2',
      kind: 'commit',
      ref: `commit:${story.commit.toLowerCase()}`,
      sha256: sha256Hex(story.commit.toLowerCase()),
      produced_by: `jira:${story.key}:commit`,
      result: 'N/A',
      captured_at: story.updated,
      ac_ids: [ac.acId],
    });
  }

  const summaryParts = [`Jira-recorded deterministic result: ${ac.deterministicResult ?? 'none'} (evidence kind: ${ac.evidenceKind ?? 'none'}).`];
  if (story.verificationRequirements) summaryParts.push(`Verification requirements: ${story.verificationRequirements}`);
  const deterministic_summary = summaryParts.join(' ');
  if (deterministic_summary.length > LIMITS.maxSummaryChars) {
    return fail('OVERSIZE', `deterministic summary with verification requirements exceeds ${LIMITS.maxSummaryChars} chars`);
  }

  const draft = {
    schema: 'bjc/1',
    request_id: opts.requestId ?? `jira-${ac.issueKey}-${randomUUID().slice(0, 8)}`,
    work_item: ac.issueKey,
    task_id: story.key,
    invoked_by: opts.invokedBy,
    acceptance_criterion: {
      id: ac.acId,
      statement: ac.statement,
      kind,
      required_evidence: kind === 'OBJECTIVE' && bjcEvidenceKind ? [bjcEvidenceKind] : [],
    },
    invariants: invariants.value,
    deterministic_summary,
    evidence,
    model: opts.model,
  } as Omit<BjcRequest, 'input_hash'>;
  return { ok: true, value: { ...draft, input_hash: computeInputHash(draft) } as BjcRequest };
}
