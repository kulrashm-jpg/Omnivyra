/**
 * PI-041-A — Email execution-context resolution, and the canonical recipient.
 *
 * Two boundaries that both answer "who and which run", kept together because the
 * second depends on the first and neither is useful alone.
 *
 * ─── CONTEXT: THE 040 HANDOFF IS THE SOURCE OF TRUTH ──────────────────────
 * The Email Engine is reached through the common transport boundary, which
 * carries only the legacy task — no campaign, workflow, version, instance, plan,
 * step or subject kind. All of it lives on the 040 handoff, addressable by
 * `(organization_id, outreach_task_id)`, which 040 made UNIQUE for exactly this.
 * So one tenant-scoped read recovers the whole chain and `TransportRequest` never
 * has to grow.
 *
 * This module READS that table; 040's store remains its only WRITER. Nothing
 * here duplicates the context into another table — a second copy would be a
 * second answer to what a run is.
 *
 * `subject_kind` is taken from the handoff and NEVER inferred from the legacy
 * `lead_id`, which cannot express a kind at all.
 *
 * ─── RECIPIENT: ONE CANDIDATE, OR NOTHING ─────────────────────────────────
 * `unified_persons.primary_email` is the authoritative address. There is no
 * alternate-email table and no verification flag anywhere in this repository, so
 * there is exactly one candidate and nothing to choose between — which is
 * precisely what makes an AUTONOMOUS send safe here. Absent or unusable, this
 * fails closed, and it does so BEFORE any attempt exists.
 *
 * Note what is deliberately NOT here: no staleness horizon and no alternate
 * address, because neither is representable in the ratified model, and inventing
 * one would be deciding a product question this workstream was not given.
 */
import { ownedDbTable } from '../../db/writeOwner';

const HANDOFFS_TABLE = 'outreach_bridge_handoffs';
const PERSONS_TABLE = 'unified_persons';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deliberately conservative: a single `@`, non-empty local and domain parts, a
 * dot in the domain, and no whitespace or angle brackets. It rejects rather than
 * repairs — a near-miss address is a fail-closed case, not something to clean up.
 */
const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;.]+$/;

export class EmailContextError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'EmailContextError';
    this.code = code;
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new EmailContextError(message, code);
}

function assertTenant(organizationId: string): void {
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
    fail('organizationId must be a uuid', 'invalid_org');
  }
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

type Row = Record<string, unknown>;

export interface EmailExecutionContext {
  readonly organizationId: string;
  readonly campaignId: string;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly executionInstanceId: string;
  readonly executionPlanId: string;
  readonly executionPlanStepId: string;
  readonly executionTaskId: string;
  readonly subjectKind: 'lead' | 'prospect';
  readonly subjectId: string;
  readonly personId: string;
  readonly executionMode: 'human' | 'assisted' | 'autonomous';
  readonly workflowRequiresApproval: boolean;
  readonly policySource: 'authored' | 'legacy_default';
}

const HANDOFF_COLUMNS = 'organization_id, campaign_id, workflow_id, workflow_version_id, '
  + 'execution_instance_id, execution_plan_id, execution_plan_step_id, execution_task_id, '
  + 'subject_kind, subject_id, person_id, execution_mode, workflow_requires_approval, '
  + 'policy_source';

/**
 * Recover the run behind a legacy outreach task.
 *
 * Tenant first, and tenant only: a handoff belonging to another organization is
 * not found rather than refused, which is the same answer as one that does not
 * exist — the point being that a caller learns nothing either way.
 */
export async function resolveEmailExecutionContext(
  organizationId: string, outreachTaskId: string,
): Promise<EmailExecutionContext> {
  assertTenant(organizationId);
  if (typeof outreachTaskId !== 'string' || !UUID.test(outreachTaskId)) {
    fail('outreachTaskId must be a uuid', 'invalid_task');
  }

  const res = await ownedDbTable(HANDOFFS_TABLE)
    .select(HANDOFF_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('outreach_task_id', outreachTaskId)
    .maybeSingle();
  if (res.error) {
    fail(String((res.error as { message?: string }).message ?? 'handoff read failed'),
      'context_error');
  }
  if (!res.data) {
    fail('that outreach task has no execution handoff in this tenant', 'handoff_not_found');
  }

  const r = res.data as unknown as Row;
  const kind = str(r.subject_kind);
  if (kind !== 'lead' && kind !== 'prospect') {
    fail('the handoff carries an unusable subject kind', 'invalid_context');
  }
  const mode = str(r.execution_mode);
  if (mode !== 'human' && mode !== 'assisted' && mode !== 'autonomous') {
    fail('the handoff carries an unusable execution mode', 'invalid_context');
  }
  const personId = str(r.person_id);
  if (personId === null) {
    // The 040 bridge makes this NOT NULL, so reaching here means something has
    // gone wrong upstream rather than that a person is merely unknown.
    fail('the handoff carries no person', 'invalid_context');
  }

  return {
    organizationId: String(r.organization_id),
    campaignId: String(r.campaign_id),
    workflowId: String(r.workflow_id),
    workflowVersionId: String(r.workflow_version_id),
    executionInstanceId: String(r.execution_instance_id),
    executionPlanId: String(r.execution_plan_id),
    executionPlanStepId: String(r.execution_plan_step_id),
    executionTaskId: String(r.execution_task_id),
    subjectKind: kind,
    subjectId: String(r.subject_id),
    personId,
    executionMode: mode,
    workflowRequiresApproval: r.workflow_requires_approval === true,
    policySource: str(r.policy_source) === 'legacy_default' ? 'legacy_default' : 'authored',
  };
}

export interface EmailRecipient {
  readonly personId: string;
  readonly email: string;
  /** Provenance available from the person record, for evidence and audit. */
  readonly sourceOfTruth: string | null;
  /** Personalization values the generator is allowed to use. */
  readonly personalization: Record<string, string>;
}

const PERSON_COLUMNS = 'id, company_id, primary_email, source_of_truth, full_name, '
  + 'first_name, last_name, job_title, department, seniority, city, region, timezone';

/**
 * The address to contact a person at, with the fields a render may personalize on.
 *
 * FAILS CLOSED on a missing person, a cross-tenant person, a missing address and
 * an unusable address. It never falls back to a caller-supplied recipient: an
 * operator-provided address is acceptable for the legacy activation route and is
 * not a basis for workflow-driven sending.
 */
export async function resolveEmailRecipient(
  organizationId: string, personId: string,
): Promise<EmailRecipient> {
  assertTenant(organizationId);
  if (typeof personId !== 'string' || !UUID.test(personId)) {
    fail('personId must be a uuid', 'invalid_person');
  }

  const res = await ownedDbTable(PERSONS_TABLE)
    .select(PERSON_COLUMNS)
    // Tenant FIRST, and as part of the match rather than a check afterwards, so a
    // cross-tenant person is simply not found.
    .eq('company_id', organizationId)
    .eq('id', personId)
    .maybeSingle();
  if (res.error) {
    fail(String((res.error as { message?: string }).message ?? 'person read failed'),
      'recipient_error');
  }
  if (!res.data) {
    fail('no such person in this tenant', 'person_not_found');
  }

  const r = res.data as unknown as Row;
  const email = str(r.primary_email);
  if (email === null) {
    fail(
      'that person has no primary email; refusing rather than guessing an address',
      'email_missing',
    );
  }
  const trimmed = email.trim();
  if (!EMAIL.test(trimmed)) {
    fail('that person\'s primary email is not a usable address', 'email_invalid');
  }

  // Only the canonical fields 041-D authorized. No enrichment, no inference.
  const personalization: Record<string, string> = {};
  for (const key of ['full_name', 'first_name', 'last_name', 'job_title',
    'department', 'seniority', 'city', 'region', 'timezone']) {
    const value = str(r[key]);
    if (value !== null) personalization[key] = value.trim();
  }

  return {
    personId: String(r.id),
    email: trimmed,
    sourceOfTruth: str(r.source_of_truth),
    personalization,
  };
}

export const OUTREACH_BRIDGE_HANDOFFS_TABLE = HANDOFFS_TABLE;
export const UNIFIED_PERSONS_TABLE = PERSONS_TABLE;
export const EMAIL_ADDRESS_PATTERN = EMAIL;
