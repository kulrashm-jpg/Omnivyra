/**
 * PI-041-A — the Email content evidence store.
 *
 * The SOLE writer of `email_outreach_content_evidence`: what was actually sent,
 * recorded immutably against the attempt that sent it.
 *
 * ─── EVIDENCE, NOT MESSAGE VERSIONING ─────────────────────────────────────
 * J-5 remains deferred. There is no message library, no template, no version
 * chain and no reuse — one row explains one attempt. Nothing here references
 * `gtm_messages`.
 *
 * ─── CREATE ONCE, THEN NEVER AGAIN ────────────────────────────────────────
 * There is no update and no delete, and none may be added: rewriting what was
 * sent would make the record a claim rather than evidence. The database refuses
 * a second row per attempt and refuses every UPDATE, so neither depends on this
 * module behaving well.
 *
 * ─── THE ATTEMPT IS NOT OURS ──────────────────────────────────────────────
 * Attempt identity belongs to Common Outreach (`appendAttempt`,
 * `buildIdempotencyKey`). This module records against an attempt that already
 * exists; it never creates one, numbers one, or invents a second send identity.
 */
import { ownedDbTable } from '../../db/writeOwner';

const EVIDENCE_TABLE = 'email_outreach_content_evidence';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EmailContentEvidenceError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'EmailContentEvidenceError';
    this.code = code;
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new EmailContentEvidenceError(message, code);
}

function assertTenant(organizationId: string): void {
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
    fail('organizationId must be a uuid', 'invalid_org');
  }
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

type Row = Record<string, unknown>;

export interface EmailContentEvidence {
  readonly id: string;
  readonly organizationId: string;
  readonly outreachAttemptId: string;
  /** The EXACT subject handed to the provider. */
  readonly renderedSubject: string;
  /** The EXACT body handed to the provider. */
  readonly renderedBody: string;
  readonly personalizationInputs: Record<string, unknown>;
  readonly contentSource: string;
  readonly createdAt: string | null;
}

const COLUMNS = 'id, organization_id, outreach_attempt_id, rendered_subject, '
  + 'rendered_body, personalization_inputs, content_source, created_at';

const toEvidence = (r: Row): EmailContentEvidence => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  outreachAttemptId: String(r.outreach_attempt_id),
  renderedSubject: String(r.rendered_subject),
  renderedBody: String(r.rendered_body),
  personalizationInputs: (r.personalization_inputs ?? {}) as Record<string, unknown>,
  contentSource: String(r.content_source),
  createdAt: str(r.created_at),
});

function translate(error: unknown, fallback: string): never {
  const code = String((error as { code?: string } | null)?.code ?? '');
  const message = String((error as { message?: string } | null)?.message ?? '');

  if (code === '23505') {
    fail('that attempt already has content evidence', 'evidence_exists');
  }
  if (message.includes('belongs to another tenant')) {
    fail('that attempt belongs to another tenant', 'cross_tenant');
  }
  if (message.includes('does not exist')) {
    fail('no such attempt', 'attempt_not_found');
  }
  if (message.includes('is immutable')) {
    fail('content evidence is immutable', 'immutable');
  }
  fail(message || fallback, 'evidence_error');
}

/**
 * Record what was sent. Once.
 *
 * The caller must pass the EXACT strings it is about to hand the provider — not
 * a draft, and not content rendered before personalization was applied. A second
 * call for the same attempt is refused by the database, which is also what makes
 * a retried send unable to overwrite the first send's record.
 */
export async function recordEmailContentEvidence(input: {
  organizationId: string;
  outreachAttemptId: string;
  renderedSubject: string;
  renderedBody: string;
  personalizationInputs: Record<string, unknown>;
  contentSource: string;
}): Promise<EmailContentEvidence> {
  assertTenant(input.organizationId);
  if (typeof input.outreachAttemptId !== 'string' || !UUID.test(input.outreachAttemptId)) {
    fail('outreachAttemptId must be a uuid', 'invalid_attempt');
  }
  if (str(input.renderedSubject) === null) {
    fail('renderedSubject must not be blank', 'invalid_content');
  }
  if (str(input.renderedBody) === null) {
    fail('renderedBody must not be blank', 'invalid_content');
  }
  if (str(input.contentSource) === null) {
    fail('contentSource must not be blank', 'invalid_content');
  }
  if (input.personalizationInputs === null
    || typeof input.personalizationInputs !== 'object'
    || Array.isArray(input.personalizationInputs)) {
    fail('personalizationInputs must be an object', 'invalid_content');
  }

  const res = await ownedDbTable(EVIDENCE_TABLE)
    .insert({
      organization_id: input.organizationId,
      outreach_attempt_id: input.outreachAttemptId,
      rendered_subject: input.renderedSubject,
      rendered_body: input.renderedBody,
      personalization_inputs: input.personalizationInputs,
      content_source: input.contentSource,
    })
    .select(COLUMNS)
    .maybeSingle();
  if (res.error) translate(res.error, 'recording content evidence failed');
  if (!res.data) fail('content evidence did not persist', 'evidence_error');
  return toEvidence(res.data as unknown as Row);
}

/** The evidence for one attempt, or null. At most one, by constraint. */
export async function getEmailContentEvidence(
  organizationId: string, outreachAttemptId: string,
): Promise<EmailContentEvidence | null> {
  assertTenant(organizationId);
  if (typeof outreachAttemptId !== 'string' || !UUID.test(outreachAttemptId)) {
    fail('outreachAttemptId must be a uuid', 'invalid_attempt');
  }
  const res = await ownedDbTable(EVIDENCE_TABLE)
    .select(COLUMNS)
    .eq('organization_id', organizationId)
    .eq('outreach_attempt_id', outreachAttemptId)
    .maybeSingle();
  if (res.error) translate(res.error, 'content evidence read failed');
  return res.data ? toEvidence(res.data as unknown as Row) : null;
}

export const EMAIL_CONTENT_EVIDENCE_TABLE = EVIDENCE_TABLE;
