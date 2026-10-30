/**
 * PI — WHICH STORED MESSAGES THE SERVER WOULD ACTUALLY ACCEPT AS A STATEMENT.
 *
 * The capture path can now derive a problem observation from one stored
 * `engagement_messages` row. That path REFUSES most rows, and it is right to:
 * `source_not_prospect_authored`, `source_subject_mismatch`,
 * `source_statement_absent` and `source_observation_time_absent` each describe a
 * row that cannot become evidence. An operator picking a message out of a thread
 * cannot see any of that, so without this module the only way to discover that a
 * message is unusable is to try to capture it and read a 400.
 *
 * This module answers the question BEFORE the attempt: of the messages stored
 * against this prospect, which ones would the verifier accept. It is a READ, it
 * is the same set of assertions the capture path makes, and it is deliberately
 * nothing else.
 *
 * ─── IT IS NOT A SECOND VERIFIER OF RECORD ────────────────────────────────
 * The capture path remains the authority: it re-reads the row and refuses on its
 * own evidence, and a message this module lists is still verified again at
 * capture time. A picker is a convenience, never a grant. What this module must
 * not do is be LOOSER than the capture path — a listed message that cannot be
 * captured is the exact failure it exists to remove — so every assertion below
 * is the capture-side assertion, stated in the same terms as the refusal it
 * corresponds to.
 *
 * ─── ELIGIBILITY IS SERVER-SIDE AND NOT WIDENABLE ─────────────────────────
 * No argument relaxes a rule. `limit` bounds how much is read and nothing more;
 * there is no `includeOutbound`, no `includeUndated`, no `relaxAuthorship` and no
 * parameter that could grow into one. An operator can ask for FEWER rows, never
 * for rows that fail a requirement.
 *
 * ─── `direction` IS NOT PROOF OF AUTHORSHIP ───────────────────────────────
 * `engagement_messages.direction` has no CHECK, its column default is
 * `'inbound'`, and a live writer emits `'outgoing'`. So `'inbound'` is
 * indistinguishable from "no writer stated a direction", and treating it as
 * evidence would be a default standing in for a fact. Authorship is established
 * POSITIVELY instead: the message names an author, the author's platform
 * identity resolves — through `contacts` and its UNIQUE
 * `(organization_id, platform, platform_user_id)` — to the SAME canonical person
 * the observation is attributed to, and `isAuthorSelf` is false so the row is not
 * one of this workspace's own sent messages. `direction` is read ONLY as an input
 * to `isAuthorSelf`, which uses it to EXCLUDE a self-sent row; it is never read
 * as a reason to include one.
 *
 * ─── AND THE WORKSPACE'S OWN IDENTITIES ARE EXCLUDED FROM IT ──────────────
 * The capture path refuses an author that this tenant has ATTESTED as one of
 * its own engagement identities, so this module must too — a message it listed
 * and capture then refused is the exact failure it exists to remove. The
 * registry is consulted in the ENGAGEMENT namespace (`engagement_authors`'
 * `(platform, platform_user_id)`, keyed by the shared
 * `engagementIdentityKey`), never through the OAuth tables, whose
 * `platform_user_id` is a different namespace entirely.
 *
 * It is NEGATIVE evidence: a match excludes, and an absent attestation proves
 * nothing, so every positive requirement below still holds. An UNREADABLE
 * registry is not an empty one — it refuses the whole answer with
 * `store_unavailable`, because a list computed without the check would be a
 * list this module cannot stand behind.
 *
 * ─── TENANCY IS THE THREAD'S, BECAUSE THE MESSAGE MAY NOT HAVE ONE ────────
 * `engagement_messages.organization_id` exists only after migration
 * `20261221000000`, whose applied state is not verified here. So no read below
 * filters or selects it: messages are fetched EXCLUSIVELY by thread ids that a
 * tenant-filtered `engagement_threads` query already returned, which is the
 * isolation WS-5 relies on for the same table and the same reason. Every message
 * is then re-checked against its thread's tenant and person on the DATA, not only
 * in the query, so a widened query cannot fail open.
 *
 * ─── IT READS. IT WRITES NOTHING. ─────────────────────────────────────────
 * There is no insert, update, upsert or delete call anywhere in this file.
 * `ELIGIBLE_PROSPECT_MESSAGES_PERFORMS_NO_WRITE` makes that test-visible rather
 * than leaving it to reviewer vigilance, and it is also what keeps a module that
 * legitimately reads the person spine outside the canonical sole-writer and
 * identity ingestion-boundary tripwires.
 *
 * ─── SAFETY BEATS RICHNESS IN THE PROJECTION ──────────────────────────────
 * A picker needs enough to choose and no more. `raw_payload` is read (it carries
 * the self-authorship flags) and NEVER emitted: it also carries
 * `sender_username`, `sender_profile_url` and `sender_name`. The author's name,
 * handle, profile url and avatar are never emitted either — publishing a third
 * party's identity under a prospect's record is a disclosure, not a convenience.
 * Engagement metrics are not emitted: they belong to the engagement surface and
 * would arrive here as an implied ranking.
 *
 * The text is a CAPPED PREVIEW carrying an explicit `truncated` flag, so an
 * operator is never shown a shortened string that looks like the whole
 * statement. The statement that gets stored is the one the capture path reads
 * from the row, not this preview.
 *
 * ─── IT SCORES NOTHING ────────────────────────────────────────────────────
 * No score, dimension, weight, rank or priority is produced, read or implied.
 * Order is by the SOURCE's own instant, newest first, which is chronology rather
 * than judgement.
 *
 * ─── THE SUBJECT RESOLVER IS NOT FORKED ───────────────────────────────────
 * `resolveSubject` is module-private in `problemObservationIngestion.ts`, and a
 * second copy of "which canonical subject may this caller name" is exactly the
 * drift that would let this module list a message for a subject the capture path
 * resolves differently. So the published seam is reused instead:
 * `readProspectProblemObservations` is called with a read port that returns an
 * empty available read, which runs its tenant-scoped subject resolution and
 * reaches no relation. The observations relation is deliberately NOT consulted —
 * whether a prospect has stated problems before has nothing to do with which
 * messages are capturable, and coupling the two would make this endpoint fail
 * when a relation it does not need is unreadable.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { logger } from '../logger';
import { isAuthorSelf, stripSenderColonPrefix } from '../../../lib/engagement/messageRoles';
import {
  ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
  engagementIdentityKey,
  type OwnedIdentityLookup,
} from '../engagementIdentity/attestedIdentityContract';
import {
  readProspectProblemObservations,
  type ProblemObservationPorts,
} from './problemObservationIngestion';
import type {
  ProblemObservationRefusal,
  ProblemObservationSubjectType,
} from './types';

/** Bumped when the eligibility rules or the projection change. */
export const ELIGIBLE_PROSPECT_MESSAGES_VERSION = 'pi-problem-obs-eligible.1';

/**
 * A structural property, exported so a guard can read it rather than trust a
 * header comment: this module mutates nothing.
 */
export const ELIGIBLE_PROSPECT_MESSAGES_PERFORMS_NO_WRITE = true;

/** The preview cap. A longer statement is shown short and FLAGGED as short. */
export const ELIGIBLE_MESSAGE_PREVIEW_MAX = 280;

/** Reads are bounded. A caller may ask for fewer, never for more. */
export const ELIGIBLE_PROSPECT_MESSAGES_LIMIT_DEFAULT = 50;
export const ELIGIBLE_PROSPECT_MESSAGES_LIMIT_MAX = 200;

/**
 * The relations this module reads, named once so a test can pin the set and a
 * sixth table cannot be added quietly.
 */
export const ELIGIBLE_PROSPECT_MESSAGES_RELATIONS: readonly string[] = [
  'engagement_threads',
  'engagement_messages',
  'engagement_authors',
  'contacts',
  // The attested-identity registry. Read as NEGATIVE evidence only: an active
  // attestation excludes an author, and an absent one proves nothing.
  ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
];

// ─────────────────────────────────────────────────────────────────────────────
// Rows, as the ports hand them back — column names verbatim.
// ─────────────────────────────────────────────────────────────────────────────

export interface EligibleThreadRow {
  readonly id: string;
  readonly platform: string | null;
  readonly organization_id: string | null;
  readonly unified_person_id: string | null;
}

/**
 * NOTE the absence of `organization_id`. It is not selected, because the column
 * may not exist yet; tenancy comes from `thread_id` alone.
 */
export interface EligibleMessageRow {
  readonly id: string;
  readonly thread_id: string | null;
  readonly platform: string | null;
  readonly author_id: string | null;
  readonly platform_message_id: string | null;
  /** Read ONLY as an input to `isAuthorSelf`. Never proof of inbound-ness. */
  readonly direction: string | null;
  readonly content: string | null;
  /** Read for the self-authorship flags. NEVER emitted. */
  readonly raw_payload: unknown;
  /** The SOURCE's instant. `created_at` is OURS and is never substituted. */
  readonly platform_created_at: string | null;
}

/** Identity only. No display name, no handle, no profile url, no avatar. */
export interface EligibleAuthorRow {
  readonly id: string;
  readonly platform: string | null;
  readonly platform_user_id: string | null;
}

/** One platform identity that belongs to the subject, per `contacts`. */
export interface SubjectPlatformIdentityRow {
  readonly platform: string | null;
  readonly platform_user_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The answer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One message the capture path would accept.
 *
 * Exactly these fields. Adding one is a disclosure decision, not a formatting
 * one, and the test suite pins the key set in both directions.
 */
export interface EligibleProspectMessage {
  /** What `source: { messageId }` takes at capture. */
  readonly messageId: string;
  readonly threadId: string;
  readonly channel: string | null;
  /** Capped. Not the statement — the capture path re-reads the row. */
  readonly preview: string;
  /** TRUE when `preview` is shorter than the text, so nobody mistakes it. */
  readonly truncated: boolean;
  /** The SOURCE's own instant, as the source reported it. Never our clock. */
  readonly observedAt: string;
  readonly subjectType: ProblemObservationSubjectType;
  readonly subjectId: string;
}

/**
 * Why the list is short — COUNTS ONLY.
 *
 * No ids and no text: an excluded row is excluded because the platform cannot
 * establish that the prospect said it, and publishing it under the prospect's
 * record anyway would defeat the exclusion. An operator still needs to know that
 * rows exist and why they were dropped, which a count answers.
 *
 * A message is counted ONCE, under the FIRST requirement it failed, so the
 * counts plus the eligible messages account for exactly the window that was read.
 */
export interface EligibleMessageIneligibleCounts {
  /** Messages examined in this window — eligible and ineligible together. */
  readonly examined: number;
  /** The thread did not resolve to this tenant and this subject. */
  readonly subjectMismatch: number;
  /** Nothing positively establishes that the PROSPECT wrote it. */
  readonly notProspectAuthored: number;
  /** No `platform_created_at`. Our ingest clock is never substituted. */
  readonly observationTimeAbsent: number;
  /** No text to transcribe once the sender prefix and whitespace are removed. */
  readonly statementAbsent: number;
}

export type EligibleProspectMessagesResult =
  | {
    readonly ok: true;
    readonly version: string;
    readonly subjectType: ProblemObservationSubjectType;
    readonly subjectId: string;
    /** Plain prose. Says why a list is empty, so emptiness is never mute. */
    readonly reason: string;
    readonly messages: readonly EligibleProspectMessage[];
    readonly ineligible: EligibleMessageIneligibleCounts;
  }
  | {
    readonly ok: false;
    /** `subject_not_found`, `subject_other_tenant` or `store_unavailable`. */
    readonly refusal: ProblemObservationRefusal;
    readonly detail: string;
  };

export interface EligibleProspectMessagesInput {
  /** The VERIFIED tenant. Never a body field, never ambient. */
  readonly organizationId: string;
  readonly prospectId: string;
  readonly subjectType: ProblemObservationSubjectType;
  /** Clamped to `ELIGIBLE_PROSPECT_MESSAGES_LIMIT_MAX`. Narrows only. */
  readonly limit?: number;
}

/**
 * Everything this module reads. One port, so exactly one place names a table
 * and the suite can exercise the real filters against a stub database.
 */
export interface EligibleProspectMessagesPorts {
  /** Tenant-scoped AND person-scoped. Both predicates are mandatory. */
  loadThreads(
    organizationId: string, personId: string,
  ): Promise<readonly EligibleThreadRow[]>;
  /**
   * Tenancy comes from the threads. This function must never be handed thread
   * ids from anywhere but a tenant-filtered query.
   */
  loadMessages(
    threadIds: readonly string[], limit: number,
  ): Promise<readonly EligibleMessageRow[]>;
  /** `engagement_authors` has no tenant column; it is keyed by ids from above. */
  loadAuthors(authorIds: readonly string[]): Promise<readonly EligibleAuthorRow[]>;
  /** The subject's own platform identities, tenant-scoped. */
  loadSubjectPlatformIdentities(
    organizationId: string, personId: string,
  ): Promise<readonly SubjectPlatformIdentityRow[]>;
  /**
   * Which of THESE engagement identities this tenant has attested as its own.
   *
   * The signature is the attested-identity repository's own
   * (`findOwnedIdentities({ organizationId, keys })`), so the coordinator can
   * rebind the default below to that function without touching a caller or a
   * test. `keys` bounds the read to the identities actually in hand; the answer
   * carries `legible`, so "the question could not be asked" is never
   * representable as "nothing is owned".
   */
  loadOwnedIdentities(
    args: { readonly organizationId: string; readonly keys: readonly string[] },
  ): Promise<OwnedIdentityLookup>;
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

const msOf = (t: string | null): number | null => {
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * `(platform, platform_user_id)` as one comparable key.
 *
 * The local spelling is GONE: `engagementIdentityKey` from the attested-identity
 * contract is the one normaliser, so the key this module builds for `contacts`
 * and for `engagement_authors` is byte-identical to the key the registry is
 * keyed by. Two normalisers over the same pair is how an ownership check comes
 * to match nothing — `backend/constants/platforms.ts` ALIASES (`x` → `twitter`),
 * while `engagement_authors.platform` was written by a lower-casing writer that
 * does not, so a stored row can legitimately hold `'x'`.
 */
const identityKey = (
  platform: string | null | undefined,
  platformUserId: string | null | undefined,
): string | null => engagementIdentityKey(platform, platformUserId);

/**
 * The default ports. The ONLY place in this module that names a table.
 *
 * `loadMessages` carries no tenant predicate and cannot: the column may not
 * exist. Its isolation is `threadIds`, which `loadThreads` produced under a
 * mandatory tenant filter. `loadAuthors` is the same shape for the same reason —
 * `engagement_authors` is a global platform-identity dimension with no tenant
 * column, and it is reached only by ids that tenant-scoped messages named.
 */
export const defaultEligibleProspectMessagesPorts: EligibleProspectMessagesPorts = {
  async loadThreads(organizationId: string, personId: string): Promise<readonly EligibleThreadRow[]> {
    const { data, error } = await ownedDbTable('engagement_threads')
      .select('id, platform, organization_id, unified_person_id')
      .eq('organization_id', organizationId)     // tenant boundary — never optional
      .eq('unified_person_id', personId);
    if (error) throw new Error(`engagement_threads read failed: ${error.message}`);
    return (data ?? []) as EligibleThreadRow[];
  },

  async loadMessages(
    threadIds: readonly string[], limit: number,
  ): Promise<readonly EligibleMessageRow[]> {
    if (threadIds.length === 0) return [];
    const { data, error } = await ownedDbTable('engagement_messages')
      // `organization_id` is NEITHER selected NOR filtered: it exists only
      // after 20261221000000 and this module does not assume that migration.
      .select(
        'id, thread_id, platform, author_id, platform_message_id, direction,'
        + ' content, raw_payload, platform_created_at',
      )
      .in('thread_id', [...threadIds])
      // Newest by the SOURCE's clock. `nullsFirst: false` is explicit because
      // Postgres orders DESC as NULLS FIRST, which would otherwise fill the
      // whole window with rows that are ineligible for having no source time.
      .order('platform_created_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(`engagement_messages read failed: ${error.message}`);
    // `.order(...).limit(...)` narrows the client's row type to its error shape,
    // so the widening goes through `unknown`. The error path above already
    // returned, which is why this is a shape cast and not a trusted claim.
    return (data ?? []) as unknown as EligibleMessageRow[];
  },

  async loadAuthors(authorIds: readonly string[]): Promise<readonly EligibleAuthorRow[]> {
    if (authorIds.length === 0) return [];
    const { data, error } = await ownedDbTable('engagement_authors')
      // Identity columns only. A reader that could select a display name would
      // be one refactor away from publishing a third party's name.
      .select('id, platform, platform_user_id')
      .in('id', [...authorIds]);
    if (error) throw new Error(`engagement_authors read failed: ${error.message}`);
    return (data ?? []) as EligibleAuthorRow[];
  },

  async loadSubjectPlatformIdentities(
    organizationId: string, personId: string,
  ): Promise<readonly SubjectPlatformIdentityRow[]> {
    const { data, error } = await ownedDbTable('contacts')
      .select('platform, platform_user_id')
      .eq('organization_id', organizationId)     // tenant boundary — never optional
      .eq('unified_person_id', personId);
    if (error) throw new Error(`contacts read failed: ${error.message}`);
    return (data ?? []) as SubjectPlatformIdentityRow[];
  },

  /**
   * The ACTIVE attestations among the identities handed in.
   *
   * `revoked_at IS NULL` is the whole definition of active, and `= NULL` is
   * never true in SQL, so this is `.is(...)` and not `.eq(...)`. The tenant and
   * the active-ness are then re-asserted on the DATA, like every other
   * predicate in this module, and a returned key is kept only if it was one of
   * the keys asked about — a row the caller did not ask about cannot widen the
   * owned set.
   *
   * A read failure is `legible: false` WITH A DETAIL and never an empty set:
   * the caller refuses the whole answer on it. This local binding exists so the
   * module compiles and is exercisable ahead of the attested-identity
   * repository, which owns this relation and the key spelling; it is the one
   * place here that names the relation, so rebinding it is a one-line change.
   */
  async loadOwnedIdentities(
    { organizationId, keys }: { readonly organizationId: string; readonly keys: readonly string[] },
  ): Promise<OwnedIdentityLookup> {
    const asked = new Set(keys);
    if (asked.size === 0) return { legible: true, detail: null, ownedKeys: new Set<string>() };

    // The key is `platform` + a separator + the verbatim identity, as
    // `engagementIdentityKey` builds it. Split back only to BOUND the read;
    // the comparison below is on whole keys rebuilt by that same function.
    const platforms = new Set<string>();
    const identities = new Set<string>();
    for (const key of asked) {
      const at = key.indexOf('\u0000');
      if (at <= 0) continue;
      platforms.add(key.slice(0, at));
      identities.add(key.slice(at + 1));
    }
    if (platforms.size === 0 || identities.size === 0) {
      return { legible: true, detail: null, ownedKeys: new Set<string>() };
    }

    const { data, error } = await ownedDbTable(ATTESTED_ENGAGEMENT_IDENTITY_RELATION)
      .select('organization_id, platform, platform_user_id, revoked_at')
      .eq('organization_id', organizationId)     // tenant boundary — never optional
      .is('revoked_at', null)                    // ACTIVE only
      .in('platform', [...platforms])
      .in('platform_user_id', [...identities]);
    if (error) {
      return {
        legible: false,
        detail: `${ATTESTED_ENGAGEMENT_IDENTITY_RELATION} read failed: ${error.message}`,
        ownedKeys: new Set<string>(),
      };
    }

    const ownedKeys = new Set<string>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (text(row.organization_id) !== organizationId) continue;
      if (text(row.revoked_at) !== null) continue;
      const key = identityKey(
        row.platform as string | null,
        row.platform_user_id as string | null,
      );
      if (key !== null && asked.has(key)) ownedKeys.add(key);
    }
    return { legible: true, detail: null, ownedKeys };
  },
};

/**
 * A read port that reaches no relation.
 *
 * `readProspectProblemObservations` is called ONLY to run its tenant-scoped
 * subject resolution, so its observations read is satisfied with an empty
 * AVAILABLE result rather than left to touch a relation this module does not
 * need. `record` is never invoked and throws if it ever is, which is louder than
 * a no-op that would hide a mistaken call.
 */
const subjectResolutionOnlyPorts: ProblemObservationPorts = {
  record: () => {
    throw new Error(
      'eligibleProspectMessages: the capture port is never used here — this module reads only',
    );
  },
  read: async () => ({ state: 'available', detail: null, observations: [] }),
};

const emptyCounts = (examined: number): EligibleMessageIneligibleCounts => ({
  examined,
  subjectMismatch: 0,
  notProspectAuthored: 0,
  observationTimeAbsent: 0,
  statementAbsent: 0,
});

/** The bound a caller actually gets: a positive integer, never above the max. */
export function resolveEligibleMessagesLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
    return ELIGIBLE_PROSPECT_MESSAGES_LIMIT_DEFAULT;
  }
  return Math.min(Math.floor(limit), ELIGIBLE_PROSPECT_MESSAGES_LIMIT_MAX);
}

/**
 * The messages the capture path would accept for this prospect, or the reason
 * there is no answer.
 *
 * Returns a VALUE for every outcome a caller can act on; it throws only for a
 * missing tenant, which is a programming error in the caller rather than a bad
 * record. An unreadable relation is `store_unavailable` and is NEVER an empty
 * list: "there are none to pick" and "we could not look" are different answers.
 */
export async function readEligibleProspectMessages(
  input: EligibleProspectMessagesInput,
  ports: EligibleProspectMessagesPorts = defaultEligibleProspectMessagesPorts,
): Promise<EligibleProspectMessagesResult> {
  const organizationId = text(input?.organizationId);
  if (!organizationId) {
    throw new Error(
      'readEligibleProspectMessages: organizationId is required — the tenant is the VERIFIED one, '
      + 'never a body field and never ambient',
    );
  }

  const prospectId = text(input?.prospectId);
  if (!prospectId) {
    return { ok: false, refusal: 'subject_not_found', detail: 'no prospect id was supplied' };
  }

  const subjectType = input?.subjectType === 'person' || input?.subjectType === 'account'
    ? input.subjectType : null;
  if (!subjectType) {
    return {
      ok: false,
      refusal: 'subject_not_found',
      detail: "subjectType must be 'person' or 'account'",
    };
  }

  // ── 1. THE SUBJECT, THROUGH THE SEAM THAT ALREADY OWNS THAT QUESTION ────
  const resolved = await readProspectProblemObservations(
    { organizationId, prospectId, subjectType }, subjectResolutionOnlyPorts,
  );
  if (resolved.ok !== true) {
    return { ok: false, refusal: resolved.refusal, detail: resolved.detail };
  }
  const subjectId = resolved.subjectId;

  // ── 2. AN ACCOUNT HAS NO MESSAGES TO PICK ───────────────────────────────
  // A thread links to a PERSON (`engagement_threads.unified_person_id`), and a
  // message from one employee is not a statement by the company. Answering with
  // an empty list and the reason is honest; inventing company-attributed
  // messages out of one person's words would not be.
  if (subjectType === 'account') {
    return {
      ok: true,
      version: ELIGIBLE_PROSPECT_MESSAGES_VERSION,
      subjectType,
      subjectId,
      reason: 'a stored message is attributable to a person, never to an account — a thread links to '
        + 'one person, and one employee speaking is not the company stating a problem',
      messages: [],
      ineligible: emptyCounts(0),
    };
  }

  // ── 3. THE READS. TENANT FIRST, THEN THREAD-SCOPED. ─────────────────────
  try {
    const threads = (await ports.loadThreads(organizationId, subjectId))
      // Re-asserted on the DATA, not only in the query: a widened query must not
      // be able to fail open.
      .filter((t) => text(t.organization_id) === organizationId
        && text(t.unified_person_id) === subjectId
        && text(t.id) !== null);

    if (threads.length === 0) {
      return {
        ok: true,
        version: ELIGIBLE_PROSPECT_MESSAGES_VERSION,
        subjectType,
        subjectId,
        reason: 'no engagement thread in this tenant links to this prospect, so there is no stored '
          + 'message that could be verified as something the prospect said',
        messages: [],
        ineligible: emptyCounts(0),
      };
    }

    const threadById = new Map<string, EligibleThreadRow>();
    for (const t of threads) threadById.set(String(t.id), t);

    const limit = resolveEligibleMessagesLimit(input?.limit);
    const messages = await ports.loadMessages([...threadById.keys()], limit);

    const authorIds = Array.from(new Set(
      messages.map((m) => text(m.author_id)).filter((a): a is string => a !== null),
    ));
    // The authors, the subject's own identities, and which of the authors this
    // tenant has attested as ITS own — batched together, and the registry read
    // issued ONCE per call for the whole window rather than once per row.
    //
    // The ownership read is chained to the author load inside the same batch
    // because it is bounded BY the author identities: the keys it asks about are
    // exactly the ones in hand, so no attestation outside this window can
    // influence this answer and the read cannot grow with the registry.
    const [{ authors, owned }, subjectIdentities] = await Promise.all([
      (async () => {
        const loadedAuthors = await ports.loadAuthors(authorIds);
        const authorKeys = Array.from(new Set(
          loadedAuthors
            .map((a) => identityKey(a.platform, a.platform_user_id))
            .filter((k): k is string => k !== null),
        ));
        return {
          authors: loadedAuthors,
          owned: await ports.loadOwnedIdentities({ organizationId, keys: authorKeys }),
        };
      })(),
      ports.loadSubjectPlatformIdentities(organizationId, subjectId),
    ]);

    // FAIL CLOSED, AND FOR THE WHOLE ANSWER.
    //
    // `legible: false` is "we could not ask whether these authors are ours",
    // which is not "none of them is". Counting it as a per-row exclusion would
    // publish a list computed without the check; so it throws, and the caller
    // gets `store_unavailable` with no `messages` and no counts at all —
    // the same answer an unreadable thread or contact relation produces.
    if (owned.legible !== true) {
      throw new Error(
        `${ATTESTED_ENGAGEMENT_IDENTITY_RELATION} read failed: `
        + `${owned.detail ?? 'the attested-identity registry could not be read'}`,
      );
    }
    const ownedKeys = owned.ownedKeys;

    const authorById = new Map<string, EligibleAuthorRow>();
    for (const a of authors) {
      const id = text(a.id);
      if (id !== null) authorById.set(id, a);
    }

    // The POSITIVE authorship set: every platform identity `contacts` says
    // belongs to this canonical person, under this tenant.
    const subjectKeys = new Set<string>();
    for (const c of subjectIdentities) {
      const key = identityKey(c.platform, c.platform_user_id);
      if (key !== null) subjectKeys.add(key);
    }

    const eligible: EligibleProspectMessage[] = [];
    let subjectMismatch = 0;
    let notProspectAuthored = 0;
    let observationTimeAbsent = 0;
    let statementAbsent = 0;

    for (const m of messages) {
      // (a) the thread belongs to the verified tenant AND to the subject.
      const threadId = text(m.thread_id);
      const thread = threadId === null ? undefined : threadById.get(threadId);
      if (!thread || threadId === null) { subjectMismatch += 1; continue; }

      const messageId = text(m.id);
      if (messageId === null) { subjectMismatch += 1; continue; }

      // (b) the PROSPECT wrote it. Established positively, never from a default.
      const authorId = text(m.author_id);
      const author = authorId === null ? undefined : authorById.get(authorId);
      const authorKey = author ? identityKey(author.platform, author.platform_user_id) : null;
      const payload = (m.raw_payload ?? {}) as Record<string, unknown>;
      const selfAuthored = isAuthorSelf({
        platform: text(m.platform) ?? text(thread.platform),
        platform_message_id: text(m.platform_message_id),
        direction: text(m.direction),
        author_self: payload.author_self === true ? true : null,
        sender_self: payload.sender_self === true ? true : null,
        sender_username: text(payload.sender_username),
        sender_profile_url: text(payload.sender_profile_url),
        content: typeof m.content === 'string' ? m.content : null,
      });
      // One combined condition, and the owned-identity test is a member of it:
      // an author this tenant has attested as its own is not the prospect
      // speaking, which is the SAME requirement — "nothing positively
      // establishes that the PROSPECT wrote it" — and is counted under it. A
      // separate counter would publish, per window, how many of a prospect's
      // messages were written by an identity the workspace has registered, and
      // an operator can do nothing differently with that number.
      if (authorId === null || authorKey === null || !subjectKeys.has(authorKey)
        || ownedKeys.has(authorKey) || selfAuthored) {
        notProspectAuthored += 1;
        continue;
      }

      // (c) the SOURCE reported an instant. Our ingest clock is not substituted.
      const observedAt = text(m.platform_created_at);
      if (observedAt === null || msOf(observedAt) === null) {
        observationTimeAbsent += 1;
        continue;
      }

      // (d) there is text to transcribe, once the platform's sender prefix and
      // whitespace padding are removed. An empty statement is an absence.
      const statement = stripSenderColonPrefix(m.content).replace(/\s+/g, ' ').trim();
      if (statement === '') { statementAbsent += 1; continue; }

      const truncated = statement.length > ELIGIBLE_MESSAGE_PREVIEW_MAX;
      eligible.push({
        messageId,
        threadId,
        channel: text(m.platform) ?? text(thread.platform),
        preview: truncated ? statement.slice(0, ELIGIBLE_MESSAGE_PREVIEW_MAX) : statement,
        truncated,
        observedAt,
        subjectType,
        subjectId,
      });
    }

    // Newest SOURCE time first. Chronology, not a ranking — and re-sorted here
    // rather than trusted from the query, so the contract holds whatever the
    // store returned.
    eligible.sort((a, b) => (msOf(b.observedAt) ?? 0) - (msOf(a.observedAt) ?? 0));

    return {
      ok: true,
      version: ELIGIBLE_PROSPECT_MESSAGES_VERSION,
      subjectType,
      subjectId,
      reason: eligible.length > 0
        ? 'every message listed would be accepted as a statement by this prospect'
        : 'messages are stored for this prospect, but none of them can be verified as something the '
          + 'prospect said — the counts say which requirement each one failed',
      messages: eligible,
      ineligible: {
        examined: messages.length,
        subjectMismatch,
        notProspectAuthored,
        observationTimeAbsent,
        statementAbsent,
      },
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    logger.error('eligible_prospect_messages_unavailable', { organizationId, prospectId, detail });
    // NEVER an empty list. A caller that rendered this as "nothing to pick"
    // would state something the store never said.
    return { ok: false, refusal: 'store_unavailable', detail };
  }
}
