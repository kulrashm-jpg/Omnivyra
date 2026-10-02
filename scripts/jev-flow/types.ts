/**
 * Governed Claude workflow ("gov") — shared contract (P0).
 *
 * Every gov module codes against these types and helpers. The contract is
 * deterministic and serialization-stable: hashes are SHA-256 over the BJC
 * canonical JSON (sorted keys, `undefined` dropped), so the same inputs always
 * give the same packet / evidence-bundle hash.
 *
 * Authority model (unchanged from Phase 2):
 *  - Jira is the durable work authority; humans create Stories/ACs, record
 *    results and verification, set Gate Result, transition, integrate, release.
 *  - gov reads Jira (reader identity) and writes ONLY the four JEV advisory
 *    fields through the existing Phase 2 write-back (advisory identity).
 *  - Verification runs ONLY commands defined in verification-registry.json —
 *    never shell text taken from Jira.
 *  - JEV is reached only through BJC `judge()`; nothing here is a hook.
 *  - Packets, bindings and evidence live under GOV_HOME, outside any git work
 *    tree; never credentials, prompts or raw evidence in the repo or in Jira.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, sha256Hex } from '../jev-bjc/canonical';

// ---------------------------------------------------------------- versions

export const GOVERNANCE_VERSION = 'gov-flow/1' as const;
export const PACKET_SCHEMA = 'gov-packet/1' as const;
export const BINDING_SCHEMA = 'gov-binding/1' as const;
export const EVIDENCE_SCHEMA = 'gov-evidence/1' as const;
export const REGISTRY_SCHEMA = 'gov-registry/1' as const;
export const JUDGE_SCHEMA = 'gov-judge/1' as const;

// ---------------------------------------------------------------- identifiers

/** `sha256:<64 lowercase hex>` — the only hash format in the contract. */
export type Sha256Ref = `sha256:${string}`;
export const SHA256_REF_RE = /^sha256:[0-9a-f]{64}$/;
/** Full 40-hex git commit id (never abbreviated in the contract). */
export const COMMIT_RE = /^[0-9a-f]{40}$/;
/** Same shape Phase 2 enforces (scripts/jev-jira/jiraClient.ts ISSUE_KEY_RE). */
export const STORY_KEY_RE = /^OMNI-[1-9]\d{0,6}$/;
/** Claude Code session id (UUID). */
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Verification registry id: lowercase, digits, `.`, `_`, `-`; 2–64 chars. */
export const REGISTRY_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

// ---------------------------------------------------------------- results / enums

/** Overall outcome of a gov operation. */
export type GovStatus =
  | 'OK'
  | 'NOT_READY' // readiness gate failed (fail closed; nothing created)
  | 'REFUSED' // a precondition failed (dirty tree, wrong base, unknown registry id, …)
  | 'STALE' // Jira or the registry changed after the packet was generated
  | 'INTEGRITY_FAILED' // packet / evidence / HEAD hash mismatch
  | 'VERIFICATION_FAILED' // a registry command exited non-zero
  | 'SCOPE_VIOLATION' // diff touched unauthorized or prohibited paths
  | 'JUDGMENT_UNAVAILABLE' // BJC/JEV did not complete (no fabricated verdict)
  | 'ERROR';

/** Deterministic (objective) result — authoritative. */
export type DeterministicResult = 'PASS' | 'FAIL';
/** JEV advisory answer, as BJC reports it. */
export type JevAdvisoryAnswer = 'SUPPORTS' | 'CONTRADICTS' | 'CANNOT_DETERMINE';
/** BJC combined verdict (scripts/jev-bjc/contract.ts BjcVerdict). */
export type CombinedVerdict = 'PASS_CORROBORATED' | 'PASS_UNCORROBORATED' | 'PASS_DISPUTED' | 'FAIL' | 'INSUFFICIENT_EVIDENCE' | 'ADVISORY_ONLY';
/** Jira "JEV Verdict" projection (scripts/jev-jira/writeback.ts mapJiraJevVerdict). */
export type JiraJevVerdict = 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE' | 'CONFLICT' | 'NOT_RUN';

/** Deterministic evidence kinds BJC accepts (contract.ts DETERMINISTIC_EVIDENCE_KINDS). */
export type EvidenceKind = 'test_run' | 'typecheck' | 'build';
/** Jira AC "Evidence Kind" values gov can verify, and their BJC kind. */
export const AC_EVIDENCE_KIND_TO_BJC: Readonly<Record<string, EvidenceKind>> = { Test: 'test_run', Typecheck: 'typecheck', Build: 'build' };
export type AcKind = 'Deterministic' | 'Judgment';

// ---------------------------------------------------------------- readiness

export type ReadinessCode =
  | 'INVALID_STORY_KEY'
  | 'STORY_NOT_FOUND'
  | 'NOT_A_STORY' // issue type is not Story (10005)
  | 'STORY_NOT_ACTIVE' // Story already Verified / Integrated / Released
  | 'STORY_FIELD_MISSING' // Objective / Authorized Paths / Verification Requirements empty
  | 'INVALID_PATH_PATTERN'
  | 'INVALID_REGISTRY_REFERENCE' // a Verification Requirements line is not a registry id
  | 'UNKNOWN_REGISTRY_ID' // registry id not in verification-registry.json
  | 'NO_ACCEPTANCE_CRITERIA'
  | 'AC_INCOMPLETE' // AC ID / Statement / Kind / Evidence Kind missing
  | 'AC_DUPLICATE_ID'
  | 'AC_UNSUPPORTED_EVIDENCE_KIND' // Deterministic AC with Lint/Security/Deployment/Manual/Other
  | 'AC_NO_MATCHING_VERIFICATION' // Deterministic AC whose evidence kind no registry id produces
  | 'JIRA_ERROR';

export interface ReadinessFinding {
  code: ReadinessCode;
  /** Jira issue key the finding is about. */
  issue: string;
  /** Jira field id or logical field name, when applicable. */
  field?: string;
  message: string;
}

export interface PacketStory {
  key: string;
  summary: string;
  status: string;
  objective: string;
  architecture: string | null;
  /** One invariant per line of the Story Invariants field, trimmed, empties dropped, order kept. */
  invariants: string[];
  /** Jira `updated` timestamp at packet time (staleness detection). */
  updated: string;
}

export interface PacketAc {
  /** Jira issue key of the Acceptance Criterion work item. */
  key: string;
  /** `AC-<n>`. */
  ac_id: string;
  statement: string;
  kind: AcKind;
  /** Jira Evidence Kind label (Test / Typecheck / Build / …). */
  evidence_kind: string;
  status: string;
  /** Verification field value at packet time (UNVERIFIED, VERIFIED, …) or null. */
  verification: string | null;
  updated: string;
}

export interface ReadinessResult {
  ready: boolean;
  story_key: string;
  /** Sorted by (issue, code, field). Empty iff ready. */
  findings: ReadinessFinding[];
  /** Present iff ready. */
  story?: PacketStory;
  /** Present iff ready; sorted by Jira key numeric ascending. */
  acceptance_criteria?: PacketAc[];
  scope?: PacketScope;
  verification?: PacketVerification;
}

// ---------------------------------------------------------------- scope

/**
 * Path patterns (Story Authorized Paths / Prohibited Paths, one per line):
 * repo-relative, forward slashes, no leading `/`, no `..`, no backslashes.
 *  - `dir/**`   matches everything under dir/
 *  - `*`        matches within one path segment
 *  - otherwise  exact file path
 * Prohibited always wins over Authorized.
 */
export interface PacketScope {
  authorized_paths: string[];
  prohibited_paths: string[];
}

export interface ScopeResult {
  ok: boolean;
  base_commit: string;
  head_commit: string;
  /** All paths changed between base and head (sorted, unique, forward slashes). */
  changed_paths: string[];
  /** Changed paths matching no authorized pattern. */
  outside_authorized: string[];
  /** Changed paths matching a prohibited pattern. */
  prohibited_touched: string[];
}

// ---------------------------------------------------------------- verification registry

export interface VerificationRegistryEntry {
  id: string;
  description: string;
  /** Executed with spawn (NO shell). argv[0] must be `node`. Paths relative to the governed worktree. */
  argv: string[];
  evidence_kind: EvidenceKind;
  timeout_ms: number;
}

export interface VerificationRegistry {
  schema: typeof REGISTRY_SCHEMA;
  entries: VerificationRegistryEntry[];
}

export interface PacketVerification {
  /** Registry ids from the Story Verification Requirements field, in field order, de-duplicated. */
  registry_ids: string[];
  /** canonicalHash of the registry entries referenced (detects registry drift after packet time). */
  registry_digest: Sha256Ref;
}

// ---------------------------------------------------------------- packet

export interface PacketBase {
  /** Full commit the governed branch starts from. */
  commit: string;
  branch: string;
  /** Absolute path of the governed worktree (forward slashes). */
  worktree: string;
}

/** Fixed human-only governance rules carried in every packet. */
export const HUMAN_ONLY_RULES: readonly string[] = [
  'Humans create Jira Stories and Acceptance Criteria.',
  'Humans record Deterministic Result and Evidence References (Record Result) and Verification / Disposition (Record Verification).',
  'Humans set Gate Result and perform every Jira transition (Verify, Integrate, Release).',
  'Humans merge, release and deploy. gov never merges, releases, deploys or transitions Jira.',
  'JEV is advisory only: it never overrides deterministic evidence and is invoked only via `gov judge`.',
  'Change only files matching the authorized paths; never touch prohibited paths.',
  'Verification runs only registry commands (`gov verify`); never paste credentials, tokens or secrets anywhere.',
];

export interface GovernedPacket {
  schema: typeof PACKET_SCHEMA;
  governance_version: typeof GOVERNANCE_VERSION;
  story: PacketStory;
  acceptance_criteria: PacketAc[];
  scope: PacketScope;
  verification: PacketVerification;
  base: PacketBase;
  rules: string[];
}

export interface StoredPacket {
  packet: GovernedPacket;
  packet_hash: Sha256Ref;
}

// ---------------------------------------------------------------- session binding

export type BindingMode = 'new' | 'attach';

export interface SessionFileFingerprint {
  /** Absolute path of the Claude transcript (.jsonl). */
  path: string;
  /** sha256 of the file bytes at bind time — proves gov never rewrote it. */
  sha256: Sha256Ref;
  bytes: number;
  /** `cwd` / `gitBranch` recorded in the transcript (first line that has them), or null. */
  cwd: string | null;
  git_branch: string | null;
}

export interface SessionBinding {
  schema: typeof BINDING_SCHEMA;
  governance_version: typeof GOVERNANCE_VERSION;
  story_key: string;
  packet_hash: Sha256Ref;
  session_id: string;
  mode: BindingMode;
  worktree: string;
  branch: string;
  base_commit: string;
  bound_at: string;
  /** Present for mode=attach (existing transcript); null for a new session not yet started. */
  session_file: SessionFileFingerprint | null;
  /**
   * Existing-work adoption (mode=attach only). Absent/null for ordinary
   * bindings, so pre-existing ledger records stay valid. When present,
   * baseline_commit === base_commit === the packet base commit.
   */
  adoption?: AdoptionBaseline | null;
}

/**
 * Existing-work adoption baseline. A human commits the existing work with a
 * `Governed-By: <STORY>` trailer and NO `Gov-Packet` trailer (the packet does
 * not exist yet); `gov attach` then records that clean HEAD as the baseline.
 * The baseline and everything before it are PRE-GOVERNANCE — never claimed to
 * have been governed. Governance (packet, scope, verification, trailers)
 * applies only to commits after the baseline.
 */
export const ADOPTION_CLASSIFICATION = 'PRE_GOVERNANCE_ADOPTION_BASELINE' as const;

export interface AdoptionBaseline {
  /** Full commit id of the human's adoption-baseline commit. */
  baseline_commit: string;
  classification: typeof ADOPTION_CLASSIFICATION;
}

// ---------------------------------------------------------------- evidence

export interface EvidenceItem {
  /** `EV-<n>`, assigned in registry-id order starting at 1. */
  id: string;
  registry_id: string;
  evidence_kind: EvidenceKind;
  /** canonicalHash of the argv actually executed. */
  argv_digest: Sha256Ref;
  exit_code: number;
  /** PASS iff exit_code === 0 and not timed out. */
  result: DeterministicResult;
  timed_out: boolean;
  /** sha256 of the captured stdout+stderr log (stored under GOV_HOME, never in the repo/Jira). */
  log_sha256: Sha256Ref;
  log_bytes: number;
  started_at: string;
  finished_at: string;
}

export interface EvidenceBundle {
  schema: typeof EVIDENCE_SCHEMA;
  governance_version: typeof GOVERNANCE_VERSION;
  story_key: string;
  packet_hash: Sha256Ref;
  worktree: string;
  branch: string;
  base_commit: string;
  /** HEAD at verification time; the tree was clean and fully committed. */
  head_commit: string;
  registry_digest: Sha256Ref;
  scope: ScopeResult;
  items: EvidenceItem[];
  /** PASS iff scope.ok and every item PASS. */
  deterministic_result: DeterministicResult;
  verified_at: string;
}

export interface StoredEvidenceBundle {
  bundle: EvidenceBundle;
  bundle_hash: Sha256Ref;
}

// ---------------------------------------------------------------- judgment

export interface AcJudgment {
  ac_key: string;
  ac_id: string;
  /** Evidence item ids presented to BJC for this AC. */
  evidence_ids: string[];
  bjc_status: string;
  deterministic_result: DeterministicResult | 'MISSING';
  jev_answer: JevAdvisoryAnswer | null;
  combined_verdict: CombinedVerdict | null;
  jira_jev_verdict: JiraJevVerdict | null;
  conflict: boolean;
  review_required: boolean;
  /** Phase 2 write-back status, or 'SKIPPED' when write-back was not requested. */
  writeback_status: string;
  bjc_audit_record_id: string | null;
  input_hash: string | null;
}

export interface JudgeFlowResult {
  schema: typeof JUDGE_SCHEMA;
  governance_version: typeof GOVERNANCE_VERSION;
  status: GovStatus;
  story_key: string;
  packet_hash: Sha256Ref;
  bundle_hash: Sha256Ref;
  model: string;
  write_back: boolean;
  per_ac: AcJudgment[];
  /** Human-readable reason when status !== 'OK'. */
  error: string | null;
}

// ---------------------------------------------------------------- helpers (pure except fs layout guard)

/** SHA-256 over BJC canonical JSON. */
export function canonicalHash(value: unknown): Sha256Ref {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

export function packetHash(packet: GovernedPacket): Sha256Ref {
  return canonicalHash(packet);
}

export function bundleHash(bundle: EvidenceBundle): Sha256Ref {
  return canonicalHash(bundle);
}

/** Hex part of a Sha256Ref (for file names). */
export function hashHex(ref: Sha256Ref): string {
  if (!SHA256_REF_RE.test(ref)) throw new Error('not a sha256 ref');
  return ref.slice('sha256:'.length);
}

/** Git trailers every commit on a governed branch must carry. */
export const TRAILER_GOVERNED_BY = 'Governed-By';
export const TRAILER_GOV_PACKET = 'Gov-Packet';

export const GOV_HOME_ENV = 'GOV_HOME';

/** On-disk layout under GOV_HOME (default ~/.omnivyra/gov). */
export interface GovLayout {
  home: string;
  packetsDir: (storyKey: string) => string;
  packetFile: (storyKey: string, hash: Sha256Ref, ext: 'json' | 'md') => string;
  bindingsFile: string;
  evidenceDir: (storyKey: string) => string;
  evidenceFile: (storyKey: string, hash: Sha256Ref) => string;
  logFile: (storyKey: string, logHash: Sha256Ref) => string;
}

export function insideGitWorkTree(dir: string): boolean {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** Resolves GOV_HOME; refuses any location inside a git work tree (the repo is public). Creates nothing. */
export function govLayout(env: Record<string, string | undefined>): GovLayout {
  const home = path.resolve((env[GOV_HOME_ENV] ?? '').trim() || path.join(os.homedir(), '.omnivyra', 'gov'));
  if (insideGitWorkTree(home)) throw new Error(`GOV_HOME must be outside any git work tree: ${home}`);
  const story = (k: string) => {
    if (!STORY_KEY_RE.test(k)) throw new Error('invalid story key');
    return k;
  };
  return {
    home,
    packetsDir: (k) => path.join(home, 'packets', story(k)),
    packetFile: (k, h, ext) => path.join(home, 'packets', story(k), `${hashHex(h)}.${ext}`),
    bindingsFile: path.join(home, 'bindings.jsonl'),
    evidenceDir: (k) => path.join(home, 'evidence', story(k)),
    evidenceFile: (k, h) => path.join(home, 'evidence', story(k), `${hashHex(h)}.json`),
    logFile: (k, h) => path.join(home, 'evidence', story(k), 'logs', `${hashHex(h)}.log`),
  };
}

/**
 * Git access injected into modules that need it (implemented once in
 * verify.ts/scope.ts; injected elsewhere so tracks never import each other).
 */
export interface GitProbe {
  /** Full HEAD commit of the worktree. */
  headCommit(worktree: string): Promise<string>;
  /** Current branch name, or null when detached. */
  currentBranch(worktree: string): Promise<string | null>;
  /** True iff no staged, unstaged or untracked (non-ignored) changes. */
  isClean(worktree: string): Promise<boolean>;
  /** True iff `ancestor` is an ancestor of (or equal to) `commit`. */
  isAncestor(worktree: string, ancestor: string, commit: string): Promise<boolean>;
  /** Paths changed between two commits (forward slashes, sorted, unique). */
  changedPaths(worktree: string, base: string, head: string): Promise<string[]>;
  /** Commit ids in base..head (oldest first). */
  commitsBetween(worktree: string, base: string, head: string): Promise<string[]>;
  /** Trailer values of one commit, e.g. { 'Governed-By': ['OMNI-7'] }. */
  commitTrailers(worktree: string, commit: string): Promise<Record<string, string[]>>;
}
