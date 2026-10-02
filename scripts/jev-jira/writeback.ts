/**
 * Controlled Jira write-back of the bounded JEV advisory fields.
 *
 * Writes ONLY: JEV Verdict, JEV Confidence, JEV Model and JEV Input Hash.
 * Never JEV Advisory Disposition (human-only), Verification, Deterministic
 * Result, Kind, Gate Result, Deployment Authorized By/At or status.
 *
 * Protocol: GET → verify type + unchanged since the judgment was built →
 * PUT allowlisted fields → GET → verify the written values AND that every
 * protected field and the status are byte-identical.
 */
import type { BjcResponse } from '../jev-bjc/contract';
import { canonicalJson } from '../jev-bjc/canonical';
import { ADVISORY_WRITE_FIELDS, AC_FIELDS, JEV_VERDICT_OPTIONS, PROTECTED_AC_FIELDS, type JiraJevVerdict } from './fields';
import { AC_FETCH_FIELDS, extractAcContext } from './context';
import { JiraClientError, type JiraClient, type JiraIssue } from './jiraClient';

/**
 * Jira "JEV Verdict" for a COMPLETED judgment, projected through the combiner
 * so JEV can never appear to upgrade an outcome:
 *  - any combiner conflict (det PASS + CONTRADICTS, det FAIL + SUPPORTS) → CONFLICT
 *  - deterministic FAIL → FAIL; missing deterministic evidence → INSUFFICIENT_EVIDENCE
 *  - PASS only for det PASS + SUPPORTS (objective) or SUPPORTS (judgment, advisory)
 * Returns null when there is no completed judgment — nothing is written then.
 */
export function mapJiraJevVerdict(res: BjcResponse): JiraJevVerdict | null {
  if (res.status !== 'COMPLETED' || res.verdict === null) return null;
  if (res.conflict) return 'CONFLICT';
  switch (res.verdict) {
    case 'FAIL':
      return 'FAIL';
    case 'INSUFFICIENT_EVIDENCE':
    case 'PASS_UNCORROBORATED':
      return 'INSUFFICIENT_EVIDENCE';
    case 'PASS_DISPUTED':
      return 'CONFLICT';
    case 'PASS_CORROBORATED':
      return 'PASS';
    case 'ADVISORY_ONLY':
      return res.jev.answer === 'SUPPORTS' ? 'PASS' : res.jev.answer === 'CONTRADICTS' ? 'FAIL' : 'INSUFFICIENT_EVIDENCE';
    default:
      return null;
  }
}

export function modelLabel(res: BjcResponse): string {
  return res.model.resolved !== 'unknown' ? res.model.resolved : `${res.model.requested ?? 'unknown'} (unresolved)`;
}

/** The complete set of field values a completed judgment may write; null when nothing may be written. */
export function buildAdvisoryUpdate(res: BjcResponse): Record<string, unknown> | null {
  const verdict = mapJiraJevVerdict(res);
  if (verdict === null || !res.input_hash) return null;
  return {
    [AC_FIELDS.jevVerdict]: { id: JEV_VERDICT_OPTIONS[verdict] },
    [AC_FIELDS.jevConfidence]: res.jev.confidence,
    [AC_FIELDS.jevModel]: modelLabel(res),
    [AC_FIELDS.jevInputHash]: res.input_hash,
  };
}

export type WritebackStatus = 'WRITTEN' | 'SKIPPED' | 'ABORTED_CONCURRENT_CHANGE' | 'ABORTED_NOT_AC' | 'WRITE_FAILED' | 'VERIFY_FAILED';

export interface WritebackResult {
  status: WritebackStatus;
  fields_written: string[];
  error: string | null;
}

/** Everything the integration must not change, as one comparable string. */
function protectedSnapshot(issue: JiraIssue): string {
  const f = issue.fields;
  const status = (f.status as { id?: unknown } | null)?.id ?? null;
  return canonicalJson({
    status,
    issuetype: (f.issuetype as { id?: unknown } | null)?.id ?? null,
    parent: (f.parent as { key?: unknown } | null)?.key ?? null,
    fields: Object.fromEntries(PROTECTED_AC_FIELDS.map((k) => [k, f[k] ?? null])),
  });
}

function advisorySnapshot(issue: JiraIssue): string {
  return canonicalJson(
    Object.fromEntries(
      ADVISORY_WRITE_FIELDS.map((k) => {
        const v = issue.fields[k];
        return [k, v && typeof v === 'object' ? ((v as { id?: unknown }).id ?? null) : (v ?? null)];
      }),
    ),
  );
}

function matchesWritten(after: JiraIssue, update: Record<string, unknown>): string[] {
  const wrong: string[] = [];
  for (const [k, want] of Object.entries(update)) {
    const got = after.fields[k];
    const ok =
      want && typeof want === 'object'
        ? !!got && typeof got === 'object' && (got as { id?: unknown }).id === (want as { id: string }).id
        : (got ?? null) === (want ?? null);
    if (!ok) wrong.push(k);
  }
  return wrong;
}

export async function writeAdvisoryFields(
  client: JiraClient,
  issueKey: string,
  judgedFrom: JiraIssue,
  update: Record<string, unknown> | null,
): Promise<WritebackResult> {
  if (!update) return { status: 'SKIPPED', fields_written: [], error: 'no completed judgment; Jira left unchanged' };

  let before: JiraIssue;
  try {
    before = await client.getIssue(issueKey, AC_FETCH_FIELDS);
  } catch (err) {
    return { status: 'WRITE_FAILED', fields_written: [], error: err instanceof JiraClientError ? `${err.code}: ${err.message}` : 'pre-write read failed' };
  }
  if (extractAcContext(before).ok === false) {
    return { status: 'ABORTED_NOT_AC', fields_written: [], error: 'issue is no longer a valid OMNI Acceptance Criterion' };
  }
  if (protectedSnapshot(before) !== protectedSnapshot(judgedFrom) || advisorySnapshot(before) !== advisorySnapshot(judgedFrom)) {
    return { status: 'ABORTED_CONCURRENT_CHANGE', fields_written: [], error: 'the issue changed after the judgment input was read; nothing written' };
  }

  try {
    await client.updateAdvisoryFields(issueKey, update);
  } catch (err) {
    return { status: 'WRITE_FAILED', fields_written: [], error: err instanceof JiraClientError ? `${err.code}: ${err.message}` : 'write failed' };
  }

  let after: JiraIssue;
  try {
    after = await client.getIssue(issueKey, AC_FETCH_FIELDS);
  } catch (err) {
    return {
      status: 'VERIFY_FAILED',
      fields_written: Object.keys(update),
      error: err instanceof JiraClientError ? `post-write read ${err.code}` : 'post-write read failed',
    };
  }
  const wrong = matchesWritten(after, update);
  if (wrong.length > 0) return { status: 'VERIFY_FAILED', fields_written: Object.keys(update), error: `read-back mismatch on ${wrong.join(', ')}` };
  if (protectedSnapshot(after) !== protectedSnapshot(before)) {
    return { status: 'VERIFY_FAILED', fields_written: Object.keys(update), error: 'a protected field or the status changed during write-back' };
  }
  return { status: 'WRITTEN', fields_written: Object.keys(update), error: null };
}
