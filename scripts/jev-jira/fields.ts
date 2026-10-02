/**
 * OMNI Jira constants for the Jira ↔ BJC orchestrator (phase 2, T1 / AC only).
 *
 * These ids were created by the OMNI Jira foundation provisioning
 * (2026-10-01) and are frozen for this phase. Pure: constants only.
 */

/** Atlassian Cloud gateway. The scoped token only works here, never on the site URL. */
export const OMNI_CLOUD_ID = 'bc333815-4c2e-4d3d-a989-2e87956e851f';
export const JIRA_GATEWAY_BASE = `https://api.atlassian.com/ex/jira/${OMNI_CLOUD_ID}`;
export const JIRA_EMAIL_ENV = 'JIRA_EMAIL';
export const JIRA_TOKEN_ENV = 'JIRA_PROVISION_TOKEN';
/**
 * Explicit Jira auth mode: `basic` (email:token, the default when unset) or
 * `bearer` (scoped service-account API token). Never inferred from the token.
 */
export const JIRA_AUTH_MODE_ENV = 'JIRA_AUTH_MODE';
export const JIRA_AUTH_MODES = ['basic', 'bearer'] as const;
export type JiraAuthMode = (typeof JIRA_AUTH_MODES)[number];

export const OMNI_PROJECT_ID = '10033';
export const OMNI_PROJECT_KEY = 'OMNI';
export const ISSUE_TYPE = { story: '10005', acceptanceCriterion: '10074' } as const;

/** Acceptance Criterion fields. */
export const AC_FIELDS = {
  acId: 'customfield_10093',
  statement: 'customfield_10094',
  kind: 'customfield_10095',
  evidenceKind: 'customfield_10096',
  deterministicResult: 'customfield_10097',
  evidenceReferences: 'customfield_10084',
  verification: 'customfield_10098',
  jevVerdict: 'customfield_10099',
  jevConfidence: 'customfield_10100',
  jevModel: 'customfield_10101',
  jevInputHash: 'customfield_10102',
  jevAdvisoryDisposition: 'customfield_10103',
} as const;

/** Parent Story fields (read-only context). */
export const STORY_FIELDS = {
  objective: 'customfield_10075',
  architecture: 'customfield_10085',
  invariants: 'customfield_10086',
  prohibitedPaths: 'customfield_10087',
  verificationRequirements: 'customfield_10088',
  evidenceReferences: 'customfield_10084',
  gateResult: 'customfield_10077',
  commit: 'customfield_10090',
} as const;

/**
 * The ONLY fields the orchestrator may write. Everything else — Verification,
 * Deterministic Result, Kind, JEV Advisory Disposition, Gate Result,
 * Deployment Authorized By/At, status — is outside JEV authority and has no
 * write path here. These four are also the only AC fields on the OMNI
 * advisory-safe Edit screen that touch JEV.
 */
export const ADVISORY_WRITE_FIELDS = [
  AC_FIELDS.jevVerdict,
  AC_FIELDS.jevConfidence,
  AC_FIELDS.jevModel,
  AC_FIELDS.jevInputHash,
] as const;
export type AdvisoryWriteField = (typeof ADVISORY_WRITE_FIELDS)[number];

/** Fields that must be byte-identical before and after a write-back. */
export const PROTECTED_AC_FIELDS = [
  AC_FIELDS.acId,
  AC_FIELDS.statement,
  AC_FIELDS.kind,
  AC_FIELDS.evidenceKind,
  AC_FIELDS.deterministicResult,
  AC_FIELDS.evidenceReferences,
  AC_FIELDS.verification,
  AC_FIELDS.jevAdvisoryDisposition,
] as const;

/** Select option ids in the OMNI contexts. */
export const JEV_VERDICT_OPTIONS = {
  PASS: '10044',
  FAIL: '10045',
  INSUFFICIENT_EVIDENCE: '10046',
  CONFLICT: '10047',
  NOT_RUN: '10048',
} as const;
export type JiraJevVerdict = keyof typeof JEV_VERDICT_OPTIONS;

/*
 * JEV Advisory Disposition is human-only: ACCEPTED / REJECTED / NOT_APPLICABLE
 * satisfy the AC workflow's judgment-Verify condition, so it is set only on the
 * human "Record Verification" transition. The orchestrator never sets or clears it.
 */

/** Jira Evidence Kind → BJC deterministic evidence kind. Unmapped kinds cannot be judged in BJC v1. */
export const EVIDENCE_KIND_TO_BJC: Readonly<Record<string, 'test_run' | 'typecheck' | 'build'>> = {
  Test: 'test_run',
  Typecheck: 'typecheck',
  Build: 'build',
};

export const AC_KIND_TO_BJC: Readonly<Record<string, 'OBJECTIVE' | 'JUDGMENT'>> = {
  Deterministic: 'OBJECTIVE',
  Judgment: 'JUDGMENT',
};
