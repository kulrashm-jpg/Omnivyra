/**
 * gov readiness gate: may this Story be worked on under governance?
 *
 * `evaluateReadiness` is PURE and deterministic; it fails closed on anything
 * missing or ambiguous and, only when nothing is wrong, projects the Story,
 * its Acceptance Criteria, scope and verification into the packet shapes.
 * Verification Requirements lines are registry ids (D-4) — never shell text.
 */
import { AC_FIELDS, ISSUE_TYPE, STORY_FIELDS } from '../jev-jira/fields';
import { JiraClientError, type JiraIssue } from '../jev-jira/jiraClient';
import {
  AC_EVIDENCE_KIND_TO_BJC,
  REGISTRY_ID_RE,
  STORY_KEY_RE,
  canonicalHash,
  type AcKind,
  type EvidenceKind,
  type PacketAc,
  type PacketScope,
  type PacketStory,
  type PacketVerification,
  type ReadinessCode,
  type ReadinessFinding,
  type ReadinessResult,
  type VerificationRegistry,
  type VerificationRegistryEntry,
} from './types';
import { STORY_AUTHORIZED_PATHS_FIELD, type JiraQuery } from './jiraQuery';

/** Story statuses after which a Story is no longer worked on. */
export const INACTIVE_STORY_STATUS_IDS: readonly string[] = ['10039', '10040', '10041'];
const INACTIVE_STORY_STATUS_NAMES: readonly string[] = ['Verified', 'Integrated', 'Released'];
export const AC_ID_RE = /^AC-\d{1,4}$/;
const AC_KINDS: readonly AcKind[] = ['Deterministic', 'Judgment'];

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function lines(v: unknown): string[] {
  return typeof v === 'string'
    ? v
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '')
    : [];
}

/** Select fields arrive as {id, value}; tolerate a bare string. */
function selectValue(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'string') return (v as { value: string }).value.trim();
  return '';
}

function objId(v: unknown): string {
  return v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : '';
}

function objName(v: unknown): string {
  return v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : '';
}

function objKey(v: unknown): string {
  return v && typeof v === 'object' && typeof (v as { key?: unknown }).key === 'string' ? (v as { key: string }).key : '';
}

function keyNumber(key: string): number | null {
  const m = /^[A-Z][A-Z0-9_]*-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** Jira keys by number when both are keys, otherwise by code units. */
export function compareIssueKeys(a: string, b: string): number {
  const na = keyNumber(a);
  const nb = keyNumber(b);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortFindings(findings: ReadinessFinding[]): ReadinessFinding[] {
  return [...findings].sort(
    (x, y) => compareIssueKeys(x.issue, y.issue) || cmp(x.code, y.code) || cmp(x.field ?? '', y.field ?? '') || cmp(x.message, y.message),
  );
}

/**
 * Path pattern rules (types.ts PacketScope): repo-relative, forward slashes,
 * no leading `/`, no `..`, no backslash; `dir/**` (final segment only), `*`
 * within a segment, otherwise an exact path. Returns a reason or null.
 */
export function pathPatternProblem(pattern: string): string | null {
  if (pattern.includes('\\')) return 'contains a backslash';
  if (pattern.startsWith('/')) return 'starts with /';
  if (/^[A-Za-z]:/.test(pattern)) return 'is an absolute (drive) path';
  if (pattern.endsWith('/')) return 'ends with /';
  const segments = pattern.split('/');
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s === '') return 'has an empty segment';
    if (s === '..' || s === '.') return 'has a . or .. segment';
    if (s.includes('**')) {
      if (s !== '**' || i !== segments.length - 1) return '** is allowed only as the final segment';
      if (i === 0) return 'bare ** is not allowed (use dir/**)';
    }
  }
  return null;
}

/** SHARED FORMULA: canonicalHash of the referenced entries, in registry_ids order. */
export function registryDigest(registryIds: readonly string[], registry: VerificationRegistry) {
  return canonicalHash(registryIds.map((id) => registry.entries.find((e) => e.id === id)));
}

function notReady(storyKey: string, findings: ReadinessFinding[]): ReadinessResult {
  return { ready: false, story_key: storyKey, findings: sortFindings(findings) };
}

export function evaluateReadiness(storyKey: string, story: JiraIssue | null, acs: JiraIssue[], registry: VerificationRegistry): ReadinessResult {
  const findings: ReadinessFinding[] = [];
  const add = (code: ReadinessCode, issue: string, message: string, field?: string) =>
    findings.push(field === undefined ? { code, issue, message } : { code, issue, field, message });

  if (typeof storyKey !== 'string' || !STORY_KEY_RE.test(storyKey)) {
    add('INVALID_STORY_KEY', String(storyKey), 'Story key must look like OMNI-<number>');
    return notReady(String(storyKey), findings);
  }
  if (!story) {
    add('STORY_NOT_FOUND', storyKey, `Story ${storyKey} was not found in Jira`);
    return notReady(storyKey, findings);
  }
  const f = story.fields ?? {};
  if (story.key !== storyKey) {
    add('JIRA_ERROR', storyKey, 'Jira returned a different issue than requested');
    return notReady(storyKey, findings);
  }
  if (objId(f.issuetype) !== ISSUE_TYPE.story) {
    add('NOT_A_STORY', storyKey, `${storyKey} is not a Story (issue type ${ISSUE_TYPE.story})`, 'issuetype');
    return notReady(storyKey, findings);
  }
  const statusId = objId(f.status);
  const statusName = objName(f.status);
  if (INACTIVE_STORY_STATUS_IDS.includes(statusId) || INACTIVE_STORY_STATUS_NAMES.includes(statusName)) {
    add('STORY_NOT_ACTIVE', storyKey, `Story is ${statusName || statusId}; Verified / Integrated / Released Stories cannot be worked on`, 'status');
  }
  const updated = text(f.updated);
  if (!updated) add('JIRA_ERROR', storyKey, 'Story has no updated timestamp', 'updated');

  const objective = text(f[STORY_FIELDS.objective]);
  if (!objective) add('STORY_FIELD_MISSING', storyKey, 'Objective is empty', STORY_FIELDS.objective);

  const authorized = [...new Set(lines(f[STORY_AUTHORIZED_PATHS_FIELD]))];
  const prohibited = [...new Set(lines(f[STORY_FIELDS.prohibitedPaths]))];
  if (authorized.length === 0) add('STORY_FIELD_MISSING', storyKey, 'Authorized Paths is empty', STORY_AUTHORIZED_PATHS_FIELD);
  for (const [field, patterns] of [
    [STORY_AUTHORIZED_PATHS_FIELD, authorized],
    [STORY_FIELDS.prohibitedPaths, prohibited],
  ] as const) {
    for (const p of patterns) {
      const problem = pathPatternProblem(p);
      if (problem !== null) add('INVALID_PATH_PATTERN', storyKey, `path pattern "${p}" ${problem}`, field);
    }
  }

  const vrField = STORY_FIELDS.verificationRequirements;
  const vrLines = lines(f[vrField]);
  const registryIds: string[] = [];
  let registryOk = vrLines.length > 0;
  if (vrLines.length === 0) add('STORY_FIELD_MISSING', storyKey, 'Verification Requirements is empty', vrField);
  vrLines.forEach((line, i) => {
    if (!REGISTRY_ID_RE.test(line)) {
      // The line is never echoed: it may be arbitrary shell text.
      add('INVALID_REGISTRY_REFERENCE', storyKey, `Verification Requirements line ${i + 1} is not a registry id`, vrField);
      registryOk = false;
    } else if (!registry.entries.some((e) => e.id === line)) {
      add('UNKNOWN_REGISTRY_ID', storyKey, `registry id "${line}" is not in verification-registry.json`, vrField);
      registryOk = false;
    } else if (!registryIds.includes(line)) {
      registryIds.push(line);
    }
  });
  const producedKinds = new Set<EvidenceKind>(
    registryIds.map((id) => (registry.entries.find((e) => e.id === id) as VerificationRegistryEntry).evidence_kind),
  );

  if (acs.length === 0) add('NO_ACCEPTANCE_CRITERIA', storyKey, 'Story has no Acceptance Criteria');
  const packetAcs: PacketAc[] = [];
  const acIdOwners = new Map<string, string[]>();
  for (const ac of acs) {
    const af = ac.fields ?? {};
    const key = ac.key;
    if (objId(af.issuetype) !== ISSUE_TYPE.acceptanceCriterion || objKey(af.parent) !== storyKey) {
      add('JIRA_ERROR', key, `${key} is not an Acceptance Criterion of ${storyKey}`);
      continue;
    }
    const acId = text(af[AC_FIELDS.acId]);
    const statement = text(af[AC_FIELDS.statement]);
    const kind = selectValue(af[AC_FIELDS.kind]);
    const evidenceKind = selectValue(af[AC_FIELDS.evidenceKind]);
    const acUpdated = text(af.updated);
    let complete = true;
    if (!AC_ID_RE.test(acId)) {
      add('AC_INCOMPLETE', key, 'AC ID is missing or not AC-<number>', AC_FIELDS.acId);
      complete = false;
    }
    if (!statement) {
      add('AC_INCOMPLETE', key, 'Statement is empty', AC_FIELDS.statement);
      complete = false;
    }
    if (!(AC_KINDS as readonly string[]).includes(kind)) {
      add('AC_INCOMPLETE', key, 'Kind is missing or not Deterministic / Judgment', AC_FIELDS.kind);
      complete = false;
    }
    if (!evidenceKind) {
      add('AC_INCOMPLETE', key, 'Evidence Kind is empty', AC_FIELDS.evidenceKind);
      complete = false;
    }
    if (!acUpdated) {
      add('JIRA_ERROR', key, 'AC has no updated timestamp', 'updated');
      complete = false;
    }
    if (AC_ID_RE.test(acId)) acIdOwners.set(acId, [...(acIdOwners.get(acId) ?? []), key]);
    if (kind === 'Deterministic' && evidenceKind) {
      const bjcKind = AC_EVIDENCE_KIND_TO_BJC[evidenceKind];
      if (!bjcKind) {
        add('AC_UNSUPPORTED_EVIDENCE_KIND', key, `Evidence Kind "${evidenceKind}" cannot be verified deterministically`, AC_FIELDS.evidenceKind);
        complete = false;
      } else if (registryOk && !producedKinds.has(bjcKind)) {
        add('AC_NO_MATCHING_VERIFICATION', key, `no Story registry id produces ${bjcKind} evidence`, AC_FIELDS.evidenceKind);
        complete = false;
      }
    }
    if (complete) {
      const verification = selectValue(af[AC_FIELDS.verification]);
      packetAcs.push({
        key,
        ac_id: acId,
        statement,
        kind: kind as AcKind,
        evidence_kind: evidenceKind,
        status: objName(af.status),
        verification: verification || null,
        updated: acUpdated,
      });
    }
  }
  for (const [acId, owners] of acIdOwners) {
    if (owners.length > 1) for (const key of owners) add('AC_DUPLICATE_ID', key, `${acId} is used by ${owners.length} Acceptance Criteria`, AC_FIELDS.acId);
  }

  if (findings.length > 0) return notReady(storyKey, findings);

  const packetStory: PacketStory = {
    key: storyKey,
    summary: text(f.summary),
    status: statusName,
    objective,
    architecture: text(f[STORY_FIELDS.architecture]) || null,
    invariants: lines(f[STORY_FIELDS.invariants]),
    updated,
  };
  const scope: PacketScope = { authorized_paths: authorized, prohibited_paths: prohibited };
  const verification: PacketVerification = { registry_ids: registryIds, registry_digest: registryDigest(registryIds, registry) };
  return {
    ready: true,
    story_key: storyKey,
    findings: [],
    story: packetStory,
    acceptance_criteria: packetAcs.sort((a, b) => compareIssueKeys(a.key, b.key)),
    scope,
    verification,
  };
}

/** Reads Jira through `query` and evaluates; Jira failures become a JIRA_ERROR finding. */
export async function checkReadiness(storyKey: string, deps: { query: JiraQuery; registry: VerificationRegistry }): Promise<ReadinessResult> {
  if (typeof storyKey !== 'string' || !STORY_KEY_RE.test(storyKey)) return evaluateReadiness(storyKey, null, [], deps.registry);
  let story: JiraIssue | null;
  let acs: JiraIssue[] = [];
  try {
    story = await deps.query.getStory(storyKey);
    if (story) acs = await deps.query.listAcceptanceCriteria(storyKey);
  } catch (err) {
    const code = err instanceof JiraClientError ? err.code : 'JIRA_UNKNOWN';
    const detail = err instanceof JiraClientError ? `: ${err.message}` : '';
    return notReady(storyKey, [{ code: 'JIRA_ERROR', issue: storyKey, message: `Jira read failed (${code})${detail}` }]);
  }
  return evaluateReadiness(storyKey, story, acs, deps.registry);
}
