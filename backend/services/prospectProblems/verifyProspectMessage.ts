/**
 * PI WS-3G — VERIFY ONE ENGAGEMENT MESSAGE AS A PROSPECT UTTERANCE.
 *
 * ─── WHY THIS MODULE EXISTS AT ALL ────────────────────────────────────────
 * `offeringIntelligence/problemFit.ts` audited `engagement_messages` and found
 * it INSUFFICIENT as a source of a prospect-stated problem, and that verdict is
 * correct AS A UNIVERSAL CLAIM: nothing about the relation guarantees that a
 * given row is an utterance by a given prospect. The table carries no tenant of
 * its own in the deployed baseline, no link to the canonical person, and a
 * `direction` column whose value is a column default as often as it is a fact.
 *
 * But a universal claim about a relation is not a claim about a row. One row CAN
 * be established, and the gate is PURE — it never reads anything — so the only
 * honest way to let a verified row through is for someone else to do the reads
 * and hand the gate an attestation that they happened. That is this module, and
 * nothing else in the capture path is allowed to produce that attestation.
 *
 * ─── IT DERIVES; IT IS NEVER TOLD ─────────────────────────────────────────
 * The caller supplies an id and nothing else. The statement, the instant and the
 * origin all come out of the row this module read. A caller that could pass the
 * words alongside the id could pass words the row does not contain, and the
 * attestation would then certify a sentence nobody said. There is deliberately
 * no parameter by which a caller can influence any derived value.
 *
 * ─── IT READS, AND ONLY READS ─────────────────────────────────────────────
 * Every read goes through `ownedDbTable` — one call site, in the default port —
 * and this file contains no insert, update, upsert or delete of any kind. It
 * resolves nothing, matches nothing and stores nothing: the person link it
 * follows was written by the identity spine's own resolvers long before this
 * module ran.
 *
 * ─── ABSENCE IS NEVER FILLED IN ───────────────────────────────────────────
 * A missing instant is a refusal, not a clock reading. A missing author is a
 * refusal, not an assumption. A relation that could not be read is
 * `store_unavailable` — "we could not look" — and never a refusal of the
 * evidence, because refusing evidence that was never read states something the
 * data did not say.
 *
 * Nothing here produces or implies a number of any kind.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { logger } from '../logger';
import { isRelationIllegible } from '../prospectIdentity/relationshipRepository';
import { isAuthorSelf, stripSenderColonPrefix } from '../../../lib/engagement/messageRoles';
import { parseMessageDateMs } from '../../../lib/engagement/messageTime';
import {
  ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
  engagementIdentityKey,
  normalizeEngagementIdentity,
  normalizeEngagementPlatform,
} from '../engagementIdentity/attestedIdentityContract';
import {
  PROSPECT_MESSAGE_VERIFIER,
  type ProblemObservationRefusal,
  type ProblemObservationSubjectType,
  type SourceVerification,
} from './types';

/** Bumped when this verification's reads or requirements change. */
export const PROSPECT_MESSAGE_VERIFICATION_VERSION = 'pi-prospect-message-verify.1';

/**
 * The relation verified, named once. It is also the `origin.store` a verified
 * statement carries, so the attested relation and the cited relation cannot
 * drift apart into two different answers to "where can these words be re-read".
 */
export const PROSPECT_MESSAGE_RELATION = 'engagement_messages';

/**
 * A structural property, exported so a guard can read it instead of trusting
 * the header above: this module never mutates anything.
 */
export const PROSPECT_MESSAGE_VERIFICATION_PERFORMS_NO_WRITE = true;

type Row = Record<string, unknown>;

/** One row, or the reason there is not one. Never a thrown value. */
export interface ProspectMessageRowRead {
  readonly row: Row | null;
  readonly error: { code?: string; message?: string } | null;
}

/**
 * How a predicate compares. `eq` is the default and remains the only operator
 * any pre-existing read uses.
 *
 * `is` exists for exactly one predicate: `revoked_at IS NULL`, which is what
 * makes the attested-identity read an ACTIVE-rows read. SQL `= NULL` is never
 * true, so an equality-only port could not express "this attestation has not
 * been revoked" at all — it would silently match nothing and every revoked and
 * unrevoked row alike would look unowned. A third operator is a decision, not a
 * convenience: this union is closed so one cannot arrive by accident.
 */
export type ProspectMessageFilterOperator = 'eq' | 'is';

/**
 * One predicate. The operator is OPTIONAL and absent means `eq`, so every
 * existing call site — and every existing assertion on the recorded filters —
 * reads exactly as it did.
 */
export type ProspectMessageFilter = readonly [string, unknown, ProspectMessageFilterOperator?];

/**
 * The read port. ONE method, because every read this module makes is the same
 * shape: one row, by named predicates, selecting named columns.
 *
 * The predicates live in the module body rather than in the port, so the tenant
 * boundary is visible at the place that decides it and a double can assert that
 * it was asked for. The default implementation is the only thing that touches a
 * database, and it goes through the owned seam like every other read in PI.
 */
export interface ProspectMessagePorts {
  readRow(
    table: string,
    columns: string,
    filters: ReadonlyArray<ProspectMessageFilter>,
  ): Promise<ProspectMessageRowRead>;
}

type EqBuilder = {
  eq(column: string, value: unknown): EqBuilder;
  is(column: string, value: unknown): EqBuilder;
  maybeSingle(): Promise<{ data?: unknown; error?: { code?: string; message?: string } | null }>;
};

export const defaultProspectMessagePorts: ProspectMessagePorts = {
  readRow: async (table, columns, filters) => {
    const base = ownedDbTable(table).select(columns) as unknown as EqBuilder;
    const query = filters.reduce<EqBuilder>(
      (acc, [column, value, operator]) => (
        operator === 'is' ? acc.is(column, value) : acc.eq(column, value)
      ),
      base,
    );
    const res = await query.maybeSingle();
    return {
      row: ((res?.data as Row | null) ?? null),
      error: res?.error ?? null,
    };
  },
};

/**
 * The verdict. ONE shape, not a discriminated union.
 *
 * The backend project does not compile under `strict`, so narrowing a union by
 * a boolean discriminant type-checks and then loses the narrowed member's own
 * fields — the reason `problemObservationIngestion.ts` and
 * `prospectIdentity/relationshipObservationIngestion.ts` both use a single
 * shape for exactly this. One shape cannot degrade that way.
 */
export interface ProspectMessageVerification {
  readonly verified: boolean;
  /** The prospect's own words, normalised and never summarised or truncated. */
  readonly statement: string | null;
  /** The SOURCE's instant, from `platform_created_at` alone. */
  readonly observedAt: string | null;
  /** Where the words can be re-read. Derived, never supplied. */
  readonly origin: { readonly store: string; readonly recordId: string } | null;
  /** The server-set attestation the gate requires. Null unless verified. */
  readonly sourceVerification: SourceVerification | null;
  /**
   * `direction` exactly as stored, carried as CONTEXT and never as evidence.
   * It is here so a reviewer can see what the row claimed, and nothing in this
   * module's decision depends on it.
   */
  readonly directionAsStored: string | null;
  readonly refusal: ProblemObservationRefusal | null;
  /** Safe to surface: it never distinguishes absent from another tenant's. */
  readonly detail: string;
  /** For the LOGS only. The distinction a transport must collapse lives here. */
  readonly internalDetail: string;
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const cleaned = v.trim();
  return cleaned.length > 0 ? cleaned : null;
};

/**
 * The SAME whitespace normalisation the admission gate applies to a statement
 * (`problemFit.ts` collapses runs of whitespace to one space and trims). Applied
 * here so the attested text and the admitted text are the same string: if they
 * differed, the attestation would certify one sentence and the row would store
 * another.
 */
const normaliseStatement = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
};

const refused = (
  refusal: ProblemObservationRefusal,
  detail: string,
  internalDetail: string = detail,
): ProspectMessageVerification => ({
  verified: false,
  statement: null,
  observedAt: null,
  origin: null,
  sourceVerification: null,
  directionAsStored: null,
  refusal,
  detail,
  internalDetail,
});

const unavailable = (detail: string): ProspectMessageVerification =>
  refused('store_unavailable', detail);

/** Columns read from the message. Identity, routing, authorship, text, time. */
const MESSAGE_COLUMNS = 'id, thread_id, author_id, platform, platform_message_id, '
  + 'message_type, content, raw_payload, direction, platform_created_at';

/**
 * The same list plus the tenant column added by `20261221000000`.
 *
 * Whether that migration is applied in any given environment is UNVERIFIED from
 * here, so the tenant predicate on the message is attempted and then relaxed —
 * see `readMessage`. It is never relaxed into a tenant-less verification: the
 * thread read that follows is the tenancy, and it is not optional.
 */
const MESSAGE_COLUMNS_WITH_TENANT = `${MESSAGE_COLUMNS}, organization_id`;

const THREAD_COLUMNS = 'id, organization_id, unified_person_id';
const AUTHOR_COLUMNS = 'id, platform, platform_user_id';
const CONTACT_COLUMNS = 'id, organization_id, platform, platform_user_id, unified_person_id';

/**
 * The attested-identity columns. `revoked_at` is selected as well as predicated
 * so the ACTIVE-ness of a returned row can be re-asserted on the DATA, exactly
 * as the tenant is.
 */
const ATTESTED_IDENTITY_COLUMNS = 'id, organization_id, platform, platform_user_id, revoked_at';

/** The raw payload bag, or an empty one. Never a thrown property access. */
const payloadOf = (row: Row): Row => {
  const raw = row.raw_payload;
  return raw && typeof raw === 'object' ? (raw as Row) : {};
};

/**
 * Read the message by id, with the tenant as a predicate WHEN THE COLUMN EXISTS.
 *
 * `engagement_messages.organization_id` arrives with `20261221000000`, whose
 * applied state this module cannot observe. So the tenanted read is attempted
 * first, and ONLY an illegible-relation error (a missing column or relation,
 * judged by `isRelationIllegible` rather than by a second spelling of the same
 * rule) relaxes it to a read by id alone. Any other error is a read failure.
 *
 * Relaxing the predicate does not relax the tenancy: the caller re-reads the
 * message's thread under the verified tenant and asserts the message belongs to
 * it, which is the tenancy that holds in BOTH schema states. A row found here is
 * not yet a row this tenant owns, and nothing below treats it as one.
 */
async function readMessage(
  ports: ProspectMessagePorts,
  organizationId: string,
  messageId: string,
): Promise<ProspectMessageRowRead> {
  const tenanted = await ports.readRow(
    PROSPECT_MESSAGE_RELATION,
    MESSAGE_COLUMNS_WITH_TENANT,
    [['id', messageId], ['organization_id', organizationId]],
  );
  if (!tenanted.error) return tenanted;
  if (!isRelationIllegible(tenanted.error)) return tenanted;

  logger.warn('prospect_message_tenant_column_illegible', {
    organizationId,
    messageId,
    detail: tenanted.error?.message ?? null,
    code: tenanted.error?.code ?? null,
  });
  return ports.readRow(
    PROSPECT_MESSAGE_RELATION,
    MESSAGE_COLUMNS,
    [['id', messageId]],
  );
}

/**
 * Verify that one `engagement_messages` row is a problem statement BY THIS
 * PROSPECT, and derive the statement, the instant and the origin from it.
 *
 * ─── THE ORDER IS THE ARGUMENT ────────────────────────────────────────────
 *   0. request-only refusals, decided before a round trip is spent on them;
 *   1. TENANCY, thread-first — the only tenancy the relation really has;
 *   2. AUTHORSHIP, positively established and never inferred from `direction`;
 *  2b. OWNED-IDENTITY EXCLUSION, read from the attested-identity registry once
 *      the author's engagement identity is established — negative evidence
 *      only, and never a substitute for any check in this list;
 *   3. SUBJECT, the thread's canonical person against the observation's;
 *   4. the STATEMENT, derived from the stored text;
 *   5. the INSTANT, derived from the source clock alone.
 *
 * Steps 2 and 3 are both required and neither is sufficient. Step 2 rules out
 * the workspace's own connected account and anyone whose platform identity does
 * not resolve to this prospect; step 3 rules out the prospect's thread being
 * used to attribute a stranger's words to them. A thread is NOT single-author —
 * `message_type` defaults to `'comment'` — so a third party posting in the
 * prospect's thread passes step 3 on the thread's own person link and is
 * refused by step 2, while the prospect posting in someone else's thread passes
 * step 2 and is refused by step 3. Together they are what make "this prospect
 * said this" a statement about a row rather than about a relation.
 *
 * Never throws for a data problem: a refusal is a value, because a thrown
 * exception on this path is caught upstream and flattened into one generic
 * failure, which is the opposite of what the refusal vocabulary is for.
 */
export async function verifyProspectMessage(
  input: {
    readonly organizationId: string;
    readonly messageId: string;
    readonly subjectType: ProblemObservationSubjectType;
    readonly subjectId: string;
    readonly personId: string;
  },
  ports: ProspectMessagePorts = defaultProspectMessagePorts,
): Promise<ProspectMessageVerification> {
  const organizationId = text(input?.organizationId);
  if (!organizationId) {
    throw new Error(
      'verifyProspectMessage: organizationId is required — a verification is never tenant-less, and '
      + 'the tenant is the VERIFIED one, never a body field',
    );
  }

  const messageId = text(input?.messageId);
  if (!messageId) {
    return refused('source_message_not_found', 'no message id was supplied, so there is nothing to verify');
  }

  // ── 0. ACCOUNT SUBJECTS ARE NOT SUPPORTED ON THIS PATH ──────────────────
  // A thread links to a PERSON (`engagement_threads.unified_person_id`) and
  // never to an account, so there is no reading of this evidence that attests
  // to a company having said anything. One employee's message is that
  // employee's statement; attributing it to their employer would assert for an
  // organisation something only a person was observed to say. Refused here,
  // before any read, rather than silently attributed to the person instead —
  // a caller asking for an account-attributed statement must be told it cannot
  // come from this source, not handed a different subject than it asked for.
  if (input?.subjectType !== 'person') {
    return refused(
      'source_subject_mismatch',
      'an engagement message can only support a PERSON-attributed statement: a thread resolves to a '
      + 'person and never to an account, and one employee speaking is not their company speaking',
    );
  }

  const personId = text(input?.personId);
  const subjectId = text(input?.subjectId);
  if (!personId || !subjectId) {
    return refused(
      'source_subject_mismatch',
      'the canonical person the statement would be attributed to was not supplied, so nothing can be '
      + 'checked against the message',
    );
  }
  if (personId !== subjectId) {
    return refused(
      'source_subject_mismatch',
      'on this path the subject IS the canonical person, so a subject that differs from the person it '
      + 'resolved to cannot be verified against a thread that links to one of them',
    );
  }

  try {
    // ── 1. TENANCY, THREAD-FIRST ─────────────────────────────────────────
    const message = await readMessage(ports, organizationId, messageId);
    if (message.error) {
      logger.error('prospect_message_read_unavailable', {
        organizationId, messageId, code: message.error.code ?? null, detail: message.error.message ?? null,
      });
      return unavailable(`${PROSPECT_MESSAGE_RELATION} read failed: ${message.error.message ?? 'unknown error'}`);
    }
    const messageRow = message.row;
    if (!messageRow) {
      // COLLAPSED on purpose: absent here and present-in-another-tenant are one
      // answer, so this is not a cross-tenant existence oracle. The distinction
      // survives in the log line, which is where it is useful and harmless.
      logger.warn('prospect_message_not_found', {
        organizationId, messageId, reason: 'no row for this id under this tenant',
      });
      return refused(
        'source_message_not_found',
        'no such message is readable for this tenant',
        'absent, or present under another tenant — collapsed deliberately',
      );
    }

    const threadId = text(messageRow.thread_id);
    if (!threadId) {
      logger.warn('prospect_message_thread_absent', { organizationId, messageId });
      return refused(
        'source_message_not_found',
        'the message names no thread, so the tenancy of its words cannot be established',
      );
    }

    const thread = await ports.readRow(
      'engagement_threads',
      THREAD_COLUMNS,
      [['id', threadId], ['organization_id', organizationId]],   // tenant boundary — never optional
    );
    if (thread.error) {
      logger.error('prospect_message_thread_read_unavailable', {
        organizationId, messageId, code: thread.error.code ?? null, detail: thread.error.message ?? null,
      });
      return unavailable(`engagement_threads read failed: ${thread.error.message ?? 'unknown error'}`);
    }
    const threadRow = thread.row;
    if (!threadRow) {
      logger.warn('prospect_message_thread_not_in_tenant', { organizationId, messageId, threadId });
      return refused(
        'source_message_not_found',
        'no such message is readable for this tenant',
        'the thread is absent or belongs to another tenant — collapsed deliberately',
      );
    }
    // Re-asserted on the DATA, not only in the query: the predicate is what
    // makes the read correct, and this is what keeps it correct if the read is
    // ever edited wrongly.
    if (text(threadRow.organization_id) !== organizationId) {
      logger.warn('prospect_message_thread_other_tenant', { organizationId, messageId, threadId });
      return refused(
        'source_message_not_found',
        'no such message is readable for this tenant',
        'the returned thread row carried another tenant — collapsed deliberately',
      );
    }
    // And the message must actually belong to THAT thread. Without this the
    // tenanted thread read would be decoration: a message read by id alone,
    // under a schema where the tenant column is absent, would otherwise inherit
    // a tenancy from a thread it has nothing to do with.
    if (text(messageRow.thread_id) !== text(threadRow.id)) {
      logger.warn('prospect_message_thread_mismatch', { organizationId, messageId, threadId });
      return refused(
        'source_message_not_found',
        'no such message is readable for this tenant',
        'the message does not belong to the thread that was read under this tenant',
      );
    }
    // Defensive, never fail-open: when the tenant column IS present it must
    // agree. When it is absent the value is simply not there and the thread
    // scoping above is the whole tenancy, exactly as it is today.
    const messageTenant = text(messageRow.organization_id);
    if (messageTenant !== null && messageTenant !== organizationId) {
      logger.warn('prospect_message_tenant_disagreement', { organizationId, messageId, threadId });
      return refused(
        'source_message_not_found',
        'no such message is readable for this tenant',
        'the message row named a different tenant than the verified one',
      );
    }

    const directionAsStored = text(messageRow.direction);

    // ── 2. POSITIVELY PROSPECT-AUTHORED ──────────────────────────────────
    // `direction` is NOT the proof and is not consulted here: the column has no
    // CHECK, it DEFAULTS to 'inbound', and a live writer emits 'outgoing'
    // (`engagementOutboundMirrorService.ts`). So 'inbound' is indistinguishable
    // from "no writer ever stated a direction", which is a default standing in
    // for evidence. It is recorded above as context and nothing below reads it.
    const authorId = text(messageRow.author_id);
    if (!authorId) {
      return refused(
        'source_not_prospect_authored',
        'the message names no author, so nothing establishes that the prospect wrote it',
      );
    }

    // The canonical self predicate, reused rather than re-spelled, with the
    // same input mapping `engagementThreadService.ts` uses. It returns false on
    // ambiguity, so it is NECESSARY and NOT SUFFICIENT — which is why the
    // identity resolution below also has to hold.
    const payload = payloadOf(messageRow);
    const selfAuthored = isAuthorSelf({
      platform: messageRow.platform as string | null | undefined,
      platform_message_id: messageRow.platform_message_id as string | null | undefined,
      direction: directionAsStored,
      author_self: payload.author_self as boolean | null | undefined,
      sender_self: payload.sender_self as boolean | null | undefined,
      sender_username: payload.sender_username as string | null | undefined,
      sender_profile_url: payload.sender_profile_url as string | null | undefined,
      content: messageRow.content as string | null | undefined,
    });
    if (selfAuthored) {
      return refused(
        'source_not_prospect_authored',
        'the message was authored by this workspace, not by the prospect',
      );
    }

    // `engagement_authors` has NO tenant column, so it is read ONLY by an id
    // that came out of the tenant-established message above — never by platform
    // identity, which would be an untenanted lookup.
    const author = await ports.readRow('engagement_authors', AUTHOR_COLUMNS, [['id', authorId]]);
    if (author.error) {
      logger.error('prospect_message_author_read_unavailable', {
        organizationId, messageId, code: author.error.code ?? null, detail: author.error.message ?? null,
      });
      return unavailable(`engagement_authors read failed: ${author.error.message ?? 'unknown error'}`);
    }
    const authorRow = author.row;
    if (!authorRow || text(authorRow.id) !== authorId) {
      return refused(
        'source_not_prospect_authored',
        'the message names an author that cannot be read, so its platform identity cannot be resolved '
        + 'to the prospect',
      );
    }

    const authorPlatform = text(authorRow.platform);
    const authorPlatformUserId = text(authorRow.platform_user_id);
    if (!authorPlatform || !authorPlatformUserId) {
      // An identity we cannot state is not an identity. A blank provider id
      // would otherwise match every other author missing one.
      return refused(
        'source_not_prospect_authored',
        'the author carries no usable platform identity, so it resolves to nobody',
      );
    }

    // THIS READS AN ALREADY-RESOLVED CANONICAL LINK; IT PERFORMS NO MATCHING.
    //
    // `contacts.unified_person_id` was written by the identity spine's own
    // resolvers, under their own rules and provenance. This module does not
    // match a name, a handle or a profile URL to a person, does not create a
    // link and does not strengthen one: it asks whether the link ALREADY says
    // this platform identity is this canonical person, and refuses when it does
    // not. Any inference about identity made here would be a second, weaker
    // resolver competing with the canonical one.
    //
    // `(organization_id, platform, platform_user_id)` is UNIQUE
    // (`idx_contacts_org_platform_user`), so exactly one row can answer, and the
    // tenant is the leading predicate rather than a filter applied afterwards.
    const contact = await ports.readRow('contacts', CONTACT_COLUMNS, [
      ['organization_id', organizationId],                        // tenant boundary — never optional
      ['platform', authorPlatform],
      ['platform_user_id', authorPlatformUserId],
    ]);
    if (contact.error) {
      logger.error('prospect_message_contact_read_unavailable', {
        organizationId, messageId, code: contact.error.code ?? null, detail: contact.error.message ?? null,
      });
      return unavailable(`contacts read failed: ${contact.error.message ?? 'unknown error'}`);
    }
    const contactRow = contact.row;
    if (!contactRow) {
      return refused(
        'source_not_prospect_authored',
        "the author's platform identity is not a known contact in this tenant, so it resolves to no "
        + 'canonical person',
      );
    }
    if (text(contactRow.organization_id) !== organizationId) {
      logger.warn('prospect_message_contact_other_tenant', { organizationId, messageId });
      return refused(
        'source_not_prospect_authored',
        "the author's platform identity did not resolve to a contact in this tenant",
      );
    }
    if (text(contactRow.unified_person_id) !== personId) {
      return refused(
        'source_not_prospect_authored',
        "the author's platform identity resolves to a different canonical person than the subject the "
        + 'statement would be attributed to',
      );
    }

    // ── 2b. THE AUTHOR IS NOT ONE OF THIS WORKSPACE'S OWN IDENTITIES ─────
    //
    // WHY HERE, AND NOT EARLIER. The author's `(platform, platform_user_id)` is
    // established and non-blank by the time this runs, which is what the lookup
    // needs; and every refusal above is cheaper, so an author that is not a
    // contact of this tenant, or resolves to another person, never spends this
    // read. The reads before it are therefore unchanged in both order and
    // count, and this is the only read this section adds.
    //
    // WHY IT IS A SEPARATE QUESTION FROM `isAuthorSelf`. That predicate reads
    // the MESSAGE's own self-authorship hints and returns false on ambiguity, so
    // a workspace-operated account whose rows carry none of those hints passes
    // it. An attestation is a stated, revocable, tenant-scoped RECORD that one
    // engagement identity belongs to this organization, and it is consulted in
    // the engagement namespace the author row is actually written in.
    //
    // WHY IT IS NEGATIVE EVIDENCE ONLY. A match refuses. NO MATCH PROVES
    // NOTHING: every positive check above and below still runs and is still
    // required, because an unregistered identity is not thereby external.
    const ownedPlatform = normalizeEngagementPlatform(authorPlatform);
    const ownedIdentity = normalizeEngagementIdentity(authorPlatformUserId);
    const ownedKey = engagementIdentityKey(ownedPlatform, ownedIdentity);
    if (ownedPlatform === null || ownedIdentity === null || ownedKey === null) {
      // Unreachable from here — both halves were established non-blank above —
      // and refused rather than skipped anyway: a blank key must never be
      // allowed to match a blank attestation, which is the collapse the
      // predecessor had to patch.
      return refused(
        'source_not_prospect_authored',
        'the author carries no usable platform identity, so it resolves to nobody',
      );
    }

    // `isRelationIllegible` IS DELIBERATELY NOT APPLIED TO THIS READ.
    //
    // It relaxes the message's tenant predicate, and that is safe there only
    // because the thread read supplies the tenancy independently — the relaxed
    // read loses a predicate, not a guarantee. Here there is no second source:
    // an unapplied migration or a dropped column would turn "we could not ask
    // whether this author is ours" into "nobody is ours", which is the exact
    // fail-open this read exists to replace. So ANY error is unavailability.
    const attested = await ports.readRow(
      ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
      ATTESTED_IDENTITY_COLUMNS,
      [
        ['organization_id', organizationId],   // tenant boundary — never optional
        ['platform', ownedPlatform],
        ['platform_user_id', ownedIdentity],
        ['revoked_at', null, 'is'],            // ACTIVE only — `= NULL` is never true
      ],
    );
    if (attested.error) {
      logger.error('prospect_message_owned_identity_read_unavailable', {
        organizationId,
        messageId,
        code: attested.error.code ?? null,
        detail: attested.error.message ?? null,
      });
      return unavailable(
        `${ATTESTED_ENGAGEMENT_IDENTITY_RELATION} read failed: `
        + `${attested.error.message ?? 'unknown error'}`,
      );
    }
    const attestedRow = attested.row;
    if (attestedRow
      // Re-asserted on the DATA, not only in the query, like every other
      // predicate on this path.
      && text(attestedRow.organization_id) === organizationId
      && text(attestedRow.revoked_at) === null
      && engagementIdentityKey(
        attestedRow.platform as string | null,
        attestedRow.platform_user_id as string | null,
      ) === ownedKey) {
      logger.warn('prospect_message_author_is_attested_identity', { organizationId, messageId });
      // The EXISTING member, reused: `types.ts` already documents
      // `source_not_prospect_authored` as covering "an author that is one of
      // this workspace's own connected accounts". A new member would force the
      // route, its suite, the union and the panel to carry a distinction no
      // caller can act on differently — so the registry fact goes to the log
      // and to `internalDetail`, and the public detail is the one a
      // workspace-authored row already gets.
      return refused(
        'source_not_prospect_authored',
        'the message was authored by this workspace, not by the prospect',
        'the author is a registered owned identity of this tenant — an active attestation refuses it',
      );
    }

    // ── 3. SUBJECT MATCH ─────────────────────────────────────────────────
    // A NULL thread person is a REFUSAL and never a fallback to the author's
    // own resolution: an unlinked thread is an absence, and treating step 2 as
    // enough on its own would let the prospect's words be filed under a thread
    // nobody has established belongs to them.
    const threadPersonId = text(threadRow.unified_person_id);
    if (!threadPersonId) {
      return refused(
        'source_subject_mismatch',
        'the thread resolves to no canonical person, so nothing attributes its messages to this subject',
      );
    }
    if (threadPersonId !== personId) {
      return refused(
        'source_subject_mismatch',
        'the thread resolves to a different canonical person than the subject the statement would be '
        + 'attributed to',
      );
    }

    // ── 4. THE STATEMENT, DERIVED ────────────────────────────────────────
    // `stripSenderColonPrefix` is the canonical cleaner for the "Name: " prefix
    // the LinkedIn preview rows inject, reused rather than re-spelled, and the
    // whitespace normalisation is the gate's own. Nothing is summarised and
    // nothing is truncated: the evidence is the words, and a shortened quote is
    // a different claim.
    const statement = normaliseStatement(stripSenderColonPrefix(messageRow.content as string | null));
    if (!statement) {
      return refused(
        'source_statement_absent',
        'the message carries no text to transcribe, and an empty statement is an absence rather than a '
        + 'short one',
      );
    }

    // ── 5. THE INSTANT, FROM THE SOURCE CLOCK ALONE ──────────────────────
    // `platform_created_at` is the only column on this row that the SOURCE set.
    // `created_at` is our ingest clock, `scraped_at` and `normalized_time` are
    // ours too, and `detected_at` belongs to another relation entirely. None is
    // substituted, and no clock is read: an absent source instant is an absence.
    const observedRaw = text(messageRow.platform_created_at);
    const observedMs = parseMessageDateMs(observedRaw);
    if (!observedRaw || observedMs === null) {
      return refused(
        'source_observation_time_absent',
        'the source reports no usable instant for this message, and our own clock is never substituted '
        + 'for when the prospect spoke',
      );
    }
    const observedAt = new Date(observedMs).toISOString();

    // ── 6. THE ATTESTATION ───────────────────────────────────────────────
    // Every field below came out of the row. `recordId` is the message id in
    // both the origin and the attestation because the gate requires them to be
    // the same value: an attestation for one row and a citation of another would
    // certify a verification that never happened for the row being stored.
    return {
      verified: true,
      statement,
      observedAt,
      origin: { store: PROSPECT_MESSAGE_RELATION, recordId: messageId },
      sourceVerification: {
        verifier: PROSPECT_MESSAGE_VERIFIER,
        relation: PROSPECT_MESSAGE_RELATION,
        recordId: messageId,
      },
      directionAsStored,
      refusal: null,
      detail: 'ok',
      internalDetail: 'ok',
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    logger.error('prospect_message_verification_unavailable', { organizationId, messageId, detail });
    return unavailable(detail);
  }
}
