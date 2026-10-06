/**
 * gov intake — classification, proposal, proposal store and audit ledger.
 *
 * `classifyIntake` is PURE and deterministic. It decides, first match wins:
 *
 *   1. GOVERNED_RESUME          the worktree already carries a valid binding
 *   2. EXISTING_STORY           clean tree; exactly one active Story covers the
 *                               changes, or --story names one that does
 *   3. NEW_WORK                 clean tree; no suitable Story → propose one
 *   4. PRE_GOVERNANCE_ADOPTION  dirty tree → report it; propose a Story when
 *                               none covers it; the human makes the baseline
 *
 * and refuses (fail closed) whenever ownership, Story choice, scope or
 * verification cannot be established without guessing.
 *
 * Authority boundary: nothing here talks to Jira, git or JEV. This module
 * writes only the intake proposal files and the append-only intake audit
 * ledger under GOV_HOME (outside any git work tree). It never creates a
 * commit, a binding, a Story or a transition.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STORY_FIELDS } from '../jev-jira/fields';
import type { JiraIssue } from '../jev-jira/jiraClient';
import { STORY_AUTHORIZED_PATHS_FIELD } from './jiraQuery';
import { pathPatternProblem } from './readiness';
import { matchesPattern } from './scope';
import type { LiveSession, WorktreeState } from './intakeProbe';
import {
  ADOPTION_CLASSIFICATION,
  GOVERNANCE_VERSION,
  INTAKE_AUDIT_SCHEMA,
  INTAKE_LABEL_PREFIX,
  INTAKE_PROPOSAL_SCHEMA,
  INTAKE_RULES_SCHEMA,
  REGISTRY_ID_RE,
  SHA256_REF_RE,
  STORY_KEY_RE,
  TRAILER_GOVERNED_BY,
  canonicalHash,
  hashHex,
  type EvidenceKind,
  type GovLayout,
  type IntakeClassification,
  type IntakeProposal,
  type IntakeProposedAc,
  type IntakeRefusalCode,
  type SessionBinding,
  type Sha256Ref,
  type StoredIntakeProposal,
  type VerificationRegistry,
} from './types';

// ---------------------------------------------------------------- rules

export interface IntakeVerificationMapping {
  paths: string[];
  registry_ids: string[];
}

export interface IntakeRules {
  schema: typeof INTAKE_RULES_SCHEMA;
  /** Always prohibited in an intake proposal; any change touching them is refused. */
  default_prohibited_paths: string[];
  /** Changed path → registry ids that verify it. A changed path no mapping covers is NO_REGISTRY_ID. */
  verification_mappings: IntakeVerificationMapping[];
}

export const DEFAULT_INTAKE_RULES_FILE = path.join(__dirname, 'intake-rules.json');

/** Validates the rules against the registry (every id must exist; every pattern valid). Throws on anything wrong. */
export function validateIntakeRules(value: unknown, registry: VerificationRegistry): IntakeRules {
  const v = value as IntakeRules;
  if (!v || typeof v !== 'object' || v.schema !== INTAKE_RULES_SCHEMA) throw new Error('intake rules: unexpected schema');
  if (!Array.isArray(v.default_prohibited_paths) || v.default_prohibited_paths.length === 0) throw new Error('intake rules: default_prohibited_paths must be a non-empty array');
  for (const p of v.default_prohibited_paths) {
    const why = typeof p === 'string' ? pathPatternProblem(p) : 'not a string';
    if (why !== null) throw new Error(`intake rules: invalid prohibited pattern ${JSON.stringify(p)}: ${why}`);
  }
  if (!Array.isArray(v.verification_mappings)) throw new Error('intake rules: verification_mappings must be an array');
  const known = new Set(registry.entries.map((e) => e.id));
  for (const m of v.verification_mappings) {
    if (!m || !Array.isArray(m.paths) || m.paths.length === 0 || !Array.isArray(m.registry_ids) || m.registry_ids.length === 0) {
      throw new Error('intake rules: each mapping needs non-empty paths and registry_ids');
    }
    for (const p of m.paths) {
      const why = typeof p === 'string' ? pathPatternProblem(p) : 'not a string';
      if (why !== null) throw new Error(`intake rules: invalid mapping pattern ${JSON.stringify(p)}: ${why}`);
    }
    for (const id of m.registry_ids) if (!known.has(id)) throw new Error(`intake rules: unknown registry id ${JSON.stringify(id)}`);
  }
  return {
    schema: INTAKE_RULES_SCHEMA,
    default_prohibited_paths: [...v.default_prohibited_paths],
    verification_mappings: v.verification_mappings.map((m) => ({ paths: [...m.paths], registry_ids: [...m.registry_ids] })),
  };
}

export function loadIntakeRules(registry: VerificationRegistry, file: string = DEFAULT_INTAKE_RULES_FILE): IntakeRules {
  return validateIntakeRules(JSON.parse(fs.readFileSync(file, 'utf8')), registry);
}

// ---------------------------------------------------------------- story candidates

export interface StoryCandidate {
  key: string;
  summary: string;
  authorized_paths: string[];
  prohibited_paths: string[];
}

function lines(v: unknown): string[] {
  return typeof v === 'string'
    ? v
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '')
    : [];
}

/** Projects a Jira Story (GOV_STORY_FIELDS) into the paths intake matches on. Pure. */
export function storyCandidateFromIssue(issue: JiraIssue): StoryCandidate {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    summary: typeof f.summary === 'string' ? f.summary : '',
    authorized_paths: lines(f[STORY_AUTHORIZED_PATHS_FIELD]),
    prohibited_paths: lines(f[STORY_FIELDS.prohibitedPaths]),
  };
}

// ---------------------------------------------------------------- classification

export interface IntakeOptions {
  intent: string | null;
  authorized: string[];
  prohibited: string[];
  verification: string[];
  judgmentAcs: string[];
}

export interface IntakeInput {
  state: WorktreeState;
  /** Every ledger binding recorded for this worktree, oldest first. */
  bindingsForWorktree: SessionBinding[];
  /** For the latest worktree binding: packet loads with its hash, and HEAD descends from the binding base. */
  resumeCheck: { packetIntact: boolean; descends: boolean } | null;
  sessionId: string | null;
  /** Story the requested session is already bound to (any worktree), or null. */
  sessionBoundStory: string | null;
  liveSessions: LiveSession[];
  /** --story, when given. */
  explicitStoryKey: string | null;
  explicitStory: StoryCandidate | null;
  /** Active (not Verified / Integrated / Released) OMNI Stories. */
  activeStories: StoryCandidate[];
  options: IntakeOptions;
  rules: IntakeRules;
  registry: VerificationRegistry;
}

export interface IntakeRefused {
  kind: 'REFUSED';
  code: IntakeRefusalCode;
  message: string;
  details: string[];
}

export interface IntakeResume {
  kind: 'GOVERNED_RESUME';
  binding: SessionBinding;
}

export interface IntakeExisting {
  kind: 'EXISTING_STORY';
  story: StoryCandidate;
  changed: string[];
  owner: string | null;
}

export interface IntakeNew {
  kind: 'NEW_WORK' | 'PRE_GOVERNANCE_ADOPTION';
  /** Candidate Story covering the work (adoption only), or null when a new Story is proposed. */
  candidate: StoryCandidate | null;
  /** Present iff candidate is null. */
  proposal: IntakeProposal | null;
  changed: string[];
  subject: string | null;
  owner: string | null;
}

export type IntakeDecision = IntakeRefused | IntakeResume | IntakeExisting | IntakeNew;

const posix = (p: string) => p.replace(/\\/g, '/');
/** Case-insensitive, forward-slash, no trailing slash — for comparing worktree paths. */
export function samePath(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const n = (p: string) => posix(path.resolve(p)).replace(/\/+$/, '').toLowerCase();
  return n(a) === n(b);
}

function refuse(code: IntakeRefusalCode, message: string, details: string[] = []): IntakeRefused {
  return { kind: 'REFUSED', code, message, details };
}

const covers = (patterns: string[], p: string) => patterns.some((pat) => matchesPattern(p, pat));

/** Subject inferred from the branch name (display only), or null. */
export function subjectFromBranch(branch: string | null): string | null {
  if (!branch) return null;
  const s = branch.replace(/[/_-]+/g, ' ').trim();
  return s === '' ? null : s;
}

/** Directories too broad to authorize wholesale: files directly under them are authorized individually. */
export const BROAD_DIRS: readonly string[] = ['backend', 'backend/services', 'backend/tests', 'backend/tests/unit', 'scripts', 'pages', 'pages/api', 'components', 'lib', 'docs', 'supabase'];

/**
 * Authorized-path patterns derived from changed paths: `<dir>/**` per parent
 * directory, except repo-root files and files directly under a broad directory,
 * which are authorized exactly. Covered exact paths are dropped. Pure.
 */
export function deriveAuthorizedPaths(changed: string[]): string[] {
  const pats = new Set<string>();
  for (const p of changed) {
    const dir = path.posix.dirname(posix(p));
    if (dir === '.' || BROAD_DIRS.includes(dir)) pats.add(posix(p));
    else pats.add(`${dir}/**`);
  }
  const globs = [...pats].filter((p) => p.endsWith('/**'));
  return [...pats].filter((p) => p.endsWith('/**') || !globs.some((g) => matchesPattern(p, g))).sort();
}

const EVIDENCE_LABEL: Readonly<Record<EvidenceKind, string>> = { test_run: 'Test', typecheck: 'Typecheck', build: 'Build' };

/** The live sessions whose reported cwd is this worktree (a claim, never proof). */
export function worktreeClaimants(live: LiveSession[], worktree: string): string[] {
  return [...new Set(live.filter((s) => samePath(s.cwd, worktree)).map((s) => s.session_id))].sort();
}

/** First-match classification. Pure and deterministic. */
export function classifyIntake(input: IntakeInput): IntakeDecision {
  const { state, options, rules, registry } = input;

  // Inputs.
  for (const p of [...options.authorized, ...options.prohibited]) {
    const why = pathPatternProblem(p);
    if (why !== null) return refuse('INVALID_INPUT', `invalid path pattern ${JSON.stringify(p)}: ${why}`);
  }
  const known = new Set(registry.entries.map((e) => e.id));
  const unknownIds = options.verification.filter((id) => !REGISTRY_ID_RE.test(id) || !known.has(id));
  if (unknownIds.length > 0) return refuse('NO_REGISTRY_ID', 'verification ids are not in the registry', unknownIds);
  if (input.explicitStoryKey !== null && !STORY_KEY_RE.test(input.explicitStoryKey)) return refuse('INVALID_INPUT', 'invalid --story');

  // 1. GOVERNED_RESUME.
  const bindings = input.bindingsForWorktree;
  if (bindings.length > 0) {
    const stories = [...new Set(bindings.map((b) => b.story_key))].sort();
    if (stories.length > 1) return refuse('CONFLICTING_BINDINGS', `worktree ${state.worktree} carries bindings for ${stories.length} Stories`, stories);
    const latest = bindings[bindings.length - 1];
    if (input.explicitStoryKey !== null && input.explicitStoryKey !== latest.story_key) {
      return refuse('CONFLICTING_BINDINGS', `worktree is governed by ${latest.story_key}, not ${input.explicitStoryKey}`);
    }
    if (input.sessionId !== null && input.sessionId !== latest.session_id) {
      return refuse('DUPLICATE_SESSION', `worktree is governed by session ${latest.session_id}; ${input.sessionId} cannot also own it`);
    }
    const rc = input.resumeCheck;
    if (!rc || rc.packetIntact !== true) return refuse('CONFLICTING_BINDINGS', `the binding packet ${latest.packet_hash} is missing or fails its integrity check`);
    if (rc.descends !== true) return refuse('CONFLICTING_BINDINGS', `HEAD ${state.head} does not descend from the binding base ${latest.base_commit}`);
    return { kind: 'GOVERNED_RESUME', binding: latest };
  }

  // Session ownership.
  if (input.sessionId !== null && input.sessionBoundStory !== null && input.sessionBoundStory !== input.explicitStoryKey) {
    return refuse('SESSION_BOUND_ELSEWHERE', `session ${input.sessionId} already governs ${input.sessionBoundStory}; one session governs one Story`);
  }
  const claimants = worktreeClaimants(input.liveSessions, state.worktree);
  const others = input.sessionId === null ? claimants : claimants.filter((s) => s !== input.sessionId);
  if ((input.sessionId === null && claimants.length > 1) || (input.sessionId !== null && others.length > 0)) {
    return refuse('DUPLICATE_SESSION', 'more than one live session claims this worktree', input.sessionId === null ? claimants : [input.sessionId, ...others]);
  }
  const owner = input.sessionId ?? (claimants.length === 1 ? claimants[0] : null);

  // Changed paths and the prohibited boundary.
  const changed = [...new Set([...state.dirty_files, ...state.changed_since_base].map(posix))].sort();
  const prohibited = [...new Set([...rules.default_prohibited_paths, ...options.prohibited])];
  const touched = changed.filter((p) => covers(prohibited, p));
  if (touched.length > 0) return refuse('PROHIBITED_PATH_TOUCHED', 'the work touches prohibited paths', touched);

  // Story resolution.
  let candidate: StoryCandidate | null = null;
  if (input.explicitStoryKey !== null) {
    const s = input.explicitStory;
    if (!s) return refuse('INVALID_INPUT', `${input.explicitStoryKey} was not found`);
    const sTouched = changed.filter((p) => covers(s.prohibited_paths, p));
    if (sTouched.length > 0) return refuse('PROHIBITED_PATH_TOUCHED', `the work touches paths ${s.key} prohibits`, sTouched);
    const uncovered = changed.filter((p) => !covers(s.authorized_paths, p));
    if (uncovered.length > 0) return refuse('PARTIAL_SCOPE_MATCH', `${s.key} does not authorize every changed path`, uncovered);
    candidate = s;
  } else if (changed.length > 0) {
    const scoped = input.activeStories.filter((s) => s.authorized_paths.length > 0);
    const full = scoped.filter((s) => changed.every((p) => covers(s.authorized_paths, p)));
    const partial = scoped.filter((s) => !full.includes(s) && changed.some((p) => covers(s.authorized_paths, p)));
    if (full.length > 1) return refuse('AMBIGUOUS_STORY', 'more than one Story covers the changes', full.map((s) => s.key).sort());
    if (full.length === 1) {
      const s = full[0];
      const sTouched = changed.filter((p) => covers(s.prohibited_paths, p));
      if (sTouched.length > 0) return refuse('PROHIBITED_PATH_TOUCHED', `the work touches paths ${s.key} prohibits`, sTouched);
      candidate = s;
    } else if (partial.length > 0) {
      return refuse('PARTIAL_SCOPE_MATCH', 'Stories cover only part of the changes', partial.map((s) => s.key).sort());
    }
  }

  const dirty = state.clean !== true;
  const subject = options.intent ?? subjectFromBranch(state.branch);
  if (dirty && owner === null) {
    return refuse('AMBIGUOUS_OWNERSHIP', 'the session that owns this uncommitted work cannot be established; pass --session <uuid>');
  }

  // 2. EXISTING_STORY.
  if (candidate !== null && !dirty) return { kind: 'EXISTING_STORY', story: candidate, changed, owner };
  if (candidate !== null) return { kind: 'PRE_GOVERNANCE_ADOPTION', candidate, proposal: null, changed, subject, owner };

  // 3./4. Propose a Story.
  const kind: 'NEW_WORK' | 'PRE_GOVERNANCE_ADOPTION' = dirty ? 'PRE_GOVERNANCE_ADOPTION' : 'NEW_WORK';
  const intent = options.intent?.trim() || null;
  if (intent === null && !(dirty && state.branch)) return refuse('INTENT_REQUIRED', 'the subject of this work cannot be established; pass --intent "<what you want to work on>"');
  const summary = intent ?? `Adopt existing work on ${state.branch}`;
  const objective = intent ?? `Adopt the pre-governance work on branch ${state.branch} (HEAD ${state.head}) and continue it under governance.`;

  const authorized = options.authorized.length > 0 ? [...new Set(options.authorized)].sort() : deriveAuthorizedPaths(changed);
  if (authorized.length === 0) return refuse('AUTHORIZED_PATHS_UNKNOWN', 'no changed paths to derive Authorized Paths from; pass --authorized <pattern>');
  const outside = changed.filter((p) => !covers(authorized, p));
  if (outside.length > 0) return refuse('AUTHORIZED_PATHS_UNKNOWN', 'the Authorized Paths do not cover every changed path', outside);
  const authorizedProhibited = authorized.filter((a) => prohibited.some((p) => matchesPattern(a.replace(/\/\*\*$/, '/x'), p) || a === p));
  if (authorizedProhibited.length > 0) return refuse('PROHIBITED_PATH_TOUCHED', 'Authorized Paths overlap prohibited paths', authorizedProhibited);

  let verification: string[];
  if (options.verification.length > 0) {
    verification = [...new Set(options.verification)];
  } else {
    const unmapped = changed.filter((p) => !rules.verification_mappings.some((m) => covers(m.paths, p)));
    if (changed.length === 0 || unmapped.length > 0) {
      return refuse('NO_REGISTRY_ID', 'no verification registry id covers the changed paths; pass --verification <id> or add a reviewed registry entry', unmapped);
    }
    const ids: string[] = [];
    for (const m of rules.verification_mappings) if (changed.some((p) => covers(m.paths, p))) for (const id of m.registry_ids) if (!ids.includes(id)) ids.push(id);
    verification = ids;
  }

  const acs: IntakeProposedAc[] = [];
  for (const id of verification) {
    const entry = registry.entries.find((e) => e.id === id);
    if (!entry) return refuse('NO_REGISTRY_ID', `registry id ${id} is unknown`);
    acs.push({ ac_id: `AC-${acs.length + 1}`, statement: `Registry check ${id} passes on the governed HEAD (${entry.description}).`, kind: 'Deterministic', evidence_kind: EVIDENCE_LABEL[entry.evidence_kind], registry_id: id });
  }
  for (const text of options.judgmentAcs) {
    const t = text.trim();
    if (t === '') return refuse('INVALID_INPUT', 'an empty --judgment-ac');
    acs.push({ ac_id: `AC-${acs.length + 1}`, statement: t, kind: 'Judgment', evidence_kind: 'Manual', registry_id: null });
  }

  const proposal: IntakeProposal = {
    schema: INTAKE_PROPOSAL_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    classification: kind,
    worktree: state.worktree,
    branch: state.branch,
    head: state.head,
    merge_base: state.merge_base,
    session_id: owner,
    story: {
      summary,
      objective,
      architecture: null,
      invariants: [],
      authorized_paths: authorized,
      prohibited_paths: [...prohibited].sort(),
      verification_requirements: verification,
    },
    acceptance_criteria: acs,
  };
  return { kind, candidate: null, proposal, changed, subject, owner };
}

// ---------------------------------------------------------------- proposal store

export interface IntakeLayout {
  dir: string;
  proposalFile: (hash: Sha256Ref, ext: 'json' | 'md') => string;
  auditFile: string;
}

export function intakeLayout(layout: GovLayout): IntakeLayout {
  const dir = path.join(layout.home, 'intake');
  return {
    dir,
    proposalFile: (h, ext) => path.join(dir, 'proposals', `${hashHex(h)}.${ext}`),
    auditFile: path.join(dir, 'audit.jsonl'),
  };
}

export function intakeLabel(hash: Sha256Ref): string {
  return `${INTAKE_LABEL_PREFIX}${hashHex(hash).slice(0, 12)}`;
}

export function storeProposal(layout: GovLayout, proposal: IntakeProposal): StoredIntakeProposal {
  const proposal_hash = canonicalHash(proposal);
  const stored: StoredIntakeProposal = { proposal, proposal_hash, label: intakeLabel(proposal_hash) };
  const il = intakeLayout(layout);
  fs.mkdirSync(path.dirname(il.proposalFile(proposal_hash, 'json')), { recursive: true });
  fs.writeFileSync(il.proposalFile(proposal_hash, 'json'), `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  fs.writeFileSync(il.proposalFile(proposal_hash, 'md'), renderProposalMarkdown(stored), 'utf8');
  return stored;
}

/** Loads a stored proposal and re-verifies its hash and label (INTEGRITY_FAILED on any mismatch). */
export function loadProposal(layout: GovLayout, hash: string): StoredIntakeProposal {
  if (!SHA256_REF_RE.test(hash)) throw new Error('INTEGRITY_FAILED: proposal hash must be sha256:<64 lowercase hex>');
  const file = intakeLayout(layout).proposalFile(hash as Sha256Ref, 'json');
  let stored: StoredIntakeProposal;
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredIntakeProposal;
  } catch {
    throw new Error(`no stored intake proposal ${hash}`);
  }
  if (!stored || !stored.proposal || stored.proposal.schema !== INTAKE_PROPOSAL_SCHEMA) throw new Error('INTEGRITY_FAILED: unexpected proposal schema');
  const recomputed = canonicalHash(stored.proposal);
  if (recomputed !== hash || stored.proposal_hash !== hash) throw new Error(`INTEGRITY_FAILED: proposal content hashes to ${recomputed}, not ${hash}`);
  if (stored.label !== intakeLabel(recomputed)) throw new Error('INTEGRITY_FAILED: proposal label does not match its hash');
  return stored;
}

export function renderProposalMarkdown(stored: StoredIntakeProposal): string {
  const p = stored.proposal;
  const s = p.story;
  const out = [
    `# gov intake proposal — ${p.classification}`,
    '',
    `Proposal hash: \`${stored.proposal_hash}\``,
    `Idempotency label: \`${stored.label}\``,
    `Worktree: ${p.worktree} · branch ${p.branch ?? '(detached)'} · HEAD ${p.head}`,
    `Session: ${p.session_id ?? '(none — a new session will be started)'}`,
    '',
    '## Story',
    '',
    `**Summary:** ${s.summary}`,
    '',
    `**Objective:** ${s.objective}`,
    '',
    '**Authorized Paths:**',
    '```',
    ...s.authorized_paths,
    '```',
    '**Prohibited Paths:**',
    '```',
    ...s.prohibited_paths,
    '```',
    '**Verification Requirements:**',
    '```',
    ...s.verification_requirements,
    '```',
    '',
    '## Acceptance Criteria',
    '',
    ...p.acceptance_criteria.map((a) => `- **${a.ac_id}** (${a.kind} / ${a.evidence_kind}) ${a.statement}`),
    '',
    'A human approves this proposal by running `gov intake --apply <hash>` in an interactive terminal and typing the hash.',
    'Nothing has been created in Jira.',
    '',
  ];
  return out.join('\n');
}

// ---------------------------------------------------------------- audit ledger

export interface IntakeAuditRecord {
  schema: typeof INTAKE_AUDIT_SCHEMA;
  governance_version: typeof GOVERNANCE_VERSION;
  at: string;
  event: 'classify' | 'refused' | 'apply' | 'bind' | 'check-forms';
  classification: IntakeClassification | null;
  refusal: IntakeRefusalCode | null;
  worktree: string | null;
  branch: string | null;
  head: string | null;
  merge_base: string | null;
  dirty_file_count: number | null;
  session_id: string | null;
  candidate_story: string | null;
  proposal_hash: string | null;
  label: string | null;
  /** apply: keys created / reused; bind: the binding result. */
  story_key: string | null;
  created_acs: string[];
  reused_acs: string[];
  approved_by: { account_id: string; display_name: string } | null;
  packet_hash: string | null;
  adoption_classification: typeof ADOPTION_CLASSIFICATION | null;
  outcome: string;
}

export type IntakeAuditInput = Partial<Omit<IntakeAuditRecord, 'schema' | 'governance_version' | 'at'>> & Pick<IntakeAuditRecord, 'event' | 'outcome'>;

/** Appends one metadata-only record (no transcript, prompt, credential or file content). */
export function appendIntakeAudit(layout: GovLayout, input: IntakeAuditInput, now: () => Date): IntakeAuditRecord {
  const rec: IntakeAuditRecord = {
    schema: INTAKE_AUDIT_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    at: now().toISOString(),
    event: input.event,
    classification: input.classification ?? null,
    refusal: input.refusal ?? null,
    worktree: input.worktree ?? null,
    branch: input.branch ?? null,
    head: input.head ?? null,
    merge_base: input.merge_base ?? null,
    dirty_file_count: input.dirty_file_count ?? null,
    session_id: input.session_id ?? null,
    candidate_story: input.candidate_story ?? null,
    proposal_hash: input.proposal_hash ?? null,
    label: input.label ?? null,
    story_key: input.story_key ?? null,
    created_acs: input.created_acs ?? [],
    reused_acs: input.reused_acs ?? [],
    approved_by: input.approved_by ?? null,
    packet_hash: input.packet_hash ?? null,
    adoption_classification: input.adoption_classification ?? null,
    outcome: input.outcome,
  };
  const file = intakeLayout(layout).auditFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(rec)}\n`, { encoding: 'utf8', flag: 'a' });
  return rec;
}

// ---------------------------------------------------------------- next steps (text only)

const q = (p: string) => (/[\s"]/.test(p) ? `"${p}"` : p);

/** Exact commands a HUMAN runs to make the adoption-baseline commit (intake never commits). */
export function baselineCommands(worktree: string, storyKey: string, summary: string, empty: boolean): string[] {
  const msg = `Adoption baseline: ${summary.replace(/"/g, "'")}`.slice(0, 120);
  return [
    `git -C ${q(worktree)} status --short   # review: everything listed becomes pre-governance baseline`,
    ...(empty ? [] : [`git -C ${q(worktree)} add -A`]),
    `git -C ${q(worktree)} commit${empty ? ' --allow-empty' : ''} -m "${msg}" -m "${TRAILER_GOVERNED_BY}: ${storyKey}"`,
  ];
}

/** Slug for `gov start` derived from a Story summary. */
export function slugFrom(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return /^[a-z0-9][a-z0-9-]{1,40}$/.test(s) ? s : 'governed-work';
}
