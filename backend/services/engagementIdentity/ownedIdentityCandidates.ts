/**
 * PI WS-4B — WHICH ENGAGEMENT IDENTITIES AN ADMINISTRATOR COULD ACTUALLY ATTEST.
 *
 * `attestedIdentityContract.ts` describes the registry: an authorized
 * administrator stating that one `(platform, platform_user_id)` pair as
 * `engagement_authors` holds it belongs to their own organization. It says
 * nothing about where an administrator is supposed to FIND that pair. Without
 * this module the only way to populate the registry is to type a profile URL
 * from memory, and a typo produces a row that looks correct, equality-matches
 * nothing and silently protects nobody — the precise failure the contract's
 * header spends two paragraphs refusing.
 *
 * So this module answers the question before the attestation: of the engagement
 * identities OBSERVED IN THIS TENANT, which ones carry enough identity for an
 * attestation to mean anything. It is a READ, it writes nothing, and it is
 * deliberately nothing else.
 *
 * ─── IT IS NOT A GRANT, AND IT PROVES NO OWNERSHIP ────────────────────────
 * A listed candidate is an identity this tenant has talked to. That is all. The
 * contract is explicit that an attestation is a RECORD rather than a proof, and
 * this module cannot and does not make it stronger: an administrator may attest
 * an identity that is not theirs, and listing it here does not say otherwise.
 * What a candidate IS good for is that the pair was read off a stored row, so
 * the registry row will match the author row it is about.
 *
 * ─── TENANCY IS THE THREAD'S, BECAUSE NEITHER OTHER TABLE HAS ONE ─────────
 * `engagement_authors` is a GLOBAL platform-identity lookup: no tenant
 * column, and a unique key over `(platform, platform_user_id)` shared by every
 * organization that ever saw that identity. `engagement_messages.organization_id`
 * exists only after migration `20261221000000`, whose applied state is not
 * verified here, so no read below selects or filters it.
 *
 * Visibility is therefore proven through the relationship, in this order and no
 * other: a tenant-filtered `engagement_threads` query yields thread ids; messages
 * are fetched EXCLUSIVELY by those ids; authors are fetched EXCLUSIVELY by the
 * ids those messages named. `engagement_authors` is NEVER queried by
 * `platform_user_id`, and there is no deployment-wide author read anywhere in
 * this file — a query keyed on an identity string would answer "who else in the
 * deployment has this identity", which is not a question a tenant may ask.
 *
 * Every message is then re-checked AGAINST THE DATA — it must map back to a
 * thread from the tenant-filtered map — so a widened or mistaken query cannot
 * fail open.
 *
 * ─── ELIGIBILITY IS SERVER-SIDE AND NOT WIDENABLE ─────────────────────────
 * No argument relaxes a rule. `limit` bounds how much is read and nothing more;
 * there is no `includeAnonymous`, no `platform` override and no parameter that
 * could grow into one. A caller may ask for FEWER rows, never for rows that fail
 * a requirement.
 *
 * ─── SAFETY BEATS RICHNESS IN THE PROJECTION ──────────────────────────────
 * `display_name`, `username`, `profile_url` and `avatar_url` are NOT selected
 * and NOT emitted. `engagement_authors` has no tenant column and a global unique
 * key, so those four columns are a THIRD PARTY'S PERSONAL DATA sitting on a row
 * this tenant shares with every other tenant that saw the same identity.
 * Publishing them under a tenant control plane would be a disclosure, not a
 * convenience. `raw_payload` is not selected either — it carries
 * `sender_username`, `sender_profile_url` and `sender_name` — and no message
 * content is read or emitted. What an administrator gets is the identity pair
 * they would attest plus proof that it was observed here, which is exactly what
 * the decision needs.
 *
 * ─── IT READS. IT WRITES NOTHING. ─────────────────────────────────────────
 * There is no insert, update, upsert or delete call anywhere in this file. Every
 * registry write goes through WS-A's repository, reached only from the route.
 * `OWNED_IDENTITY_CANDIDATES_PERFORMS_NO_WRITE` makes that test-visible rather
 * than leaving it to reviewer vigilance, and it is also what keeps this module
 * outside the canonical sole-writer and identity ingestion-boundary tripwires.
 *
 * ─── IT ORDERS BY TIME AND JUDGES NOTHING ─────────────────────────────────
 * Candidates come back newest-observed first, which is chronology. Nothing here
 * grades, orders by importance or produces a number an operator could read as a
 * verdict.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { logger } from '../logger';
import { normalizeEngagementPlatform } from './attestedIdentityContract';

/** Bumped when the candidate rules or the projection change. */
export const OWNED_IDENTITY_CANDIDATES_VERSION = 'pi-owned-identity-candidates.1';

/**
 * The contract both WS-4B routes put in their envelope, after
 * `PROSPECT_API_VERSION`. Named once here so the two routes cannot drift, and
 * deliberately NOT `PROBLEM_OBSERVATION_CONTRACT_VERSION`: that string belongs
 * to a different surface and reusing it would make a client that pinned one
 * believe it had pinned the other.
 */
export const OWNED_IDENTITY_API_CONTRACT_VERSION = 'pi-owned-identity-api.1';

/**
 * A structural property, exported so a guard can read it rather than trust a
 * header comment: this module mutates nothing.
 */
export const OWNED_IDENTITY_CANDIDATES_PERFORMS_NO_WRITE = true;

/** Reads are bounded. A caller may ask for fewer, never for more. */
export const OWNED_IDENTITY_CANDIDATES_LIMIT_DEFAULT = 50;
export const OWNED_IDENTITY_CANDIDATES_LIMIT_MAX = 200;

/**
 * The relations this module reads, named once so a test can pin the set and a
 * fourth table cannot be added quietly.
 */
export const OWNED_IDENTITY_CANDIDATE_RELATIONS: readonly string[] = [
  'engagement_threads',
  'engagement_messages',
  'engagement_authors',
];

/**
 * The platforms on which an identity pair is attestable.
 *
 * NOT taken from `backend/constants/platforms.ts` and NOT aliased, for the
 * reason `normalizeEngagementPlatform` states at length: the WRITERS
 * (`engagementNormalizationService.normalizePlatform`,
 * `extensionEventIngestionService.ingestExtensionEvent`) lower-case and do not
 * alias, so a stored row may legitimately hold `'x'` or `'li'`. Such a row is
 * EXCLUDED here rather than folded into `'twitter'` or `'linkedin'`: folding it
 * would hand the administrator a pair that does not equal the author row it came
 * from, which is a registry entry that matches nothing.
 */
export const ATTESTABLE_PLATFORMS: readonly string[] = [
  'linkedin',
  'facebook',
  'instagram',
  'twitter',
  'youtube',
];

// ─────────────────────────────────────────────────────────────────────────────
// Rows, as the ports hand them back — column names verbatim.
// ─────────────────────────────────────────────────────────────────────────────

export interface CandidateThreadRow {
  readonly id: string;
  readonly platform: string | null;
  readonly organization_id: string | null;
}

/**
 * NOTE the absence of `organization_id`. It is not selected, because the column
 * may not exist yet; tenancy comes from `thread_id` alone. NOTE also the absence
 * of `content` and `raw_payload`: a control plane that chooses between identities
 * has no use for what was said, and reading it would put a third party's words
 * one refactor away from a response body.
 */
export interface CandidateMessageRow {
  readonly id: string;
  readonly thread_id: string | null;
  readonly author_id: string | null;
  /** The SOURCE's instant. `created_at` is OURS and is never substituted. */
  readonly platform_created_at: string | null;
}

/** Identity only. No display name, no handle, no profile url, no avatar. */
export interface CandidateAuthorRow {
  readonly id: string;
  readonly platform: string | null;
  readonly platform_user_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The answer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One identity an administrator could attest.
 *
 * Exactly these fields. Adding one is a disclosure decision, not a formatting
 * one, and the suite pins the key set in both directions.
 */
export interface OwnedIdentityCandidate {
  /** `engagement_authors.id`. What `POST` takes, so no identity string travels. */
  readonly authorId: string;
  /** As the author row holds it, lower-cased only. Never aliased. */
  readonly platform: string;
  /** VERBATIM, case preserved — a profile URL path is case-significant. */
  readonly platformUserId: string;
  /** Observation proof: messages from this identity inside the read window. */
  readonly messageCount: number;
  /** How many of this tenant's threads it appears in. */
  readonly threadCount: number;
  /** Earliest SOURCE instant in the window. Null when no message carried one. */
  readonly firstObservedAt: string | null;
  /** Latest SOURCE instant in the window. Null when no message carried one. */
  readonly lastObservedAt: string | null;
}

/**
 * Why the list is short — COUNTS ONLY.
 *
 * No ids, no identity strings and no text. An excluded identity is excluded
 * precisely because the platform cannot say who it is, and naming it in the
 * response anyway would defeat the exclusion while still publishing a third
 * party's token. An administrator does need to know that identities were seen
 * and dropped, and why, which a count answers.
 *
 * An identity is counted ONCE, under the FIRST requirement it failed, so the
 * counts plus the candidates account for exactly the identities that were read.
 */
export interface OwnedIdentityExcludedCounts {
  /** Distinct identities examined in this window — listed and excluded together. */
  readonly examined: number;
  /** `platform_user_id` was blank, or the row named no platform. */
  readonly identityBlank: number;
  /** An `anon_*` token minted by `engagementNormalizationService`. */
  readonly anonymousFallback: number;
  /** An `extension_author_*` token minted per MESSAGE, not per person. */
  readonly extensionFallback: number;
  /** Not a profile URL — a bare handle or display name identifies nobody. */
  readonly identityNotAProfileUrl: number;
  /** The platform is not one on which this pair can be attested. */
  readonly platformNotAttestable: number;
}

/** The exclusion keys, in the order they are applied. */
export type OwnedIdentityExclusion =
  | 'identityBlank'
  | 'anonymousFallback'
  | 'extensionFallback'
  | 'identityNotAProfileUrl'
  | 'platformNotAttestable';

export type OwnedIdentityCandidatesResult =
  | {
    readonly ok: true;
    readonly version: string;
    /** Plain prose. Says why a list is empty, so emptiness is never mute. */
    readonly reason: string;
    readonly candidates: readonly OwnedIdentityCandidate[];
    readonly excluded: OwnedIdentityExcludedCounts;
  }
  | {
    readonly ok: false;
    readonly refusal: 'store_unavailable';
    readonly detail: string;
  };

export type ResolveOwnedIdentityCandidateResult =
  | { readonly ok: true; readonly candidate: OwnedIdentityCandidate }
  | {
    readonly ok: false;
    /**
     * `candidate_not_found` covers an author id that does not exist AND one
     * that is not observed in this tenant, indistinguishably — reporting them
     * apart would turn this path into a cross-tenant existence oracle.
     * `candidate_not_attestable` is a different answer: the identity IS in this
     * tenant, so nothing cross-tenant is disclosed by saying so, and the caller
     * can act on it.
     */
    readonly refusal: 'candidate_not_found' | 'candidate_not_attestable' | 'store_unavailable';
    readonly detail: string;
    /** Set only for `candidate_not_attestable`. */
    readonly exclusion?: OwnedIdentityExclusion;
  };

export interface OwnedIdentityCandidatesInput {
  /** The VERIFIED tenant. Never a body field, never ambient. */
  readonly organizationId: string;
  /** Clamped to `OWNED_IDENTITY_CANDIDATES_LIMIT_MAX`. Narrows only. */
  readonly limit?: number;
}

export interface ResolveOwnedIdentityCandidateInput {
  /** The VERIFIED tenant. Never a body field, never ambient. */
  readonly organizationId: string;
  /** `engagement_authors.id`, as the candidate list reported it. */
  readonly authorId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The ports. One place names a table.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything this module reads. One port, so exactly one place names a table
 * and the suite can exercise the real filters against a stub database.
 */
export interface OwnedIdentityCandidatePorts {
  /** Tenant-scoped. The predicate is mandatory and is the whole isolation. */
  loadThreads(organizationId: string): Promise<readonly CandidateThreadRow[]>;
  /**
   * Tenancy comes from the threads. This function must never be handed thread
   * ids from anywhere but a tenant-filtered query.
   */
  loadMessages(
    threadIds: readonly string[], limit: number,
  ): Promise<readonly CandidateMessageRow[]>;
  /**
   * The same read, narrowed to ONE author. Used by the re-resolution path so a
   * named author is proven observed in this tenant without depending on whether
   * it happened to fall inside the listing window.
   */
  loadMessagesForAuthor(
    threadIds: readonly string[], authorId: string, limit: number,
  ): Promise<readonly CandidateMessageRow[]>;
  /** `engagement_authors` has no tenant column; it is reached by id ONLY. */
  loadAuthors(authorIds: readonly string[]): Promise<readonly CandidateAuthorRow[]>;
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/**
 * The default ports. The ONLY place in this module that names a table.
 *
 * `loadMessages` / `loadMessagesForAuthor` carry no tenant predicate and cannot:
 * the column may not exist. Their isolation is `threadIds`, which `loadThreads`
 * produced under a mandatory tenant filter. `loadAuthors` is the same shape for
 * the same reason, and is filtered on `id` — never on `platform_user_id`, which
 * would be a deployment-wide identity lookup.
 */
export const defaultOwnedIdentityCandidatePorts: OwnedIdentityCandidatePorts = {
  async loadThreads(organizationId: string): Promise<readonly CandidateThreadRow[]> {
    const { data, error } = await ownedDbTable('engagement_threads')
      .select('id, platform, organization_id')
      .eq('organization_id', organizationId);     // tenant boundary — never optional
    if (error) throw new Error(`engagement_threads read failed: ${error.message}`);
    return (data ?? []) as CandidateThreadRow[];
  },

  async loadMessages(
    threadIds: readonly string[], limit: number,
  ): Promise<readonly CandidateMessageRow[]> {
    if (threadIds.length === 0) return [];
    const { data, error } = await ownedDbTable('engagement_messages')
      // `organization_id` is NEITHER selected NOR filtered: it exists only
      // after 20261221000000 and this module does not assume that migration.
      // `content` and `raw_payload` are not selected either — see the header.
      .select('id, thread_id, author_id, platform_created_at')
      .in('thread_id', [...threadIds])
      // Newest by the SOURCE's clock. `nullsFirst: false` is explicit because
      // Postgres orders DESC as NULLS FIRST, which would otherwise fill the
      // whole window with rows that carry no source instant.
      .order('platform_created_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(`engagement_messages read failed: ${error.message}`);
    // `.order(...).limit(...)` narrows the client's row type to its error shape,
    // so the widening goes through `unknown`. The error path above already
    // returned, which is why this is a shape cast and not a trusted claim.
    return (data ?? []) as unknown as CandidateMessageRow[];
  },

  async loadMessagesForAuthor(
    threadIds: readonly string[], authorId: string, limit: number,
  ): Promise<readonly CandidateMessageRow[]> {
    if (threadIds.length === 0) return [];
    const { data, error } = await ownedDbTable('engagement_messages')
      .select('id, thread_id, author_id, platform_created_at')
      .in('thread_id', [...threadIds])            // tenant isolation, as above
      .eq('author_id', authorId)                  // narrows; never widens
      .order('platform_created_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(`engagement_messages read failed: ${error.message}`);
    return (data ?? []) as unknown as CandidateMessageRow[];
  },

  async loadAuthors(authorIds: readonly string[]): Promise<readonly CandidateAuthorRow[]> {
    if (authorIds.length === 0) return [];
    const { data, error } = await ownedDbTable('engagement_authors')
      // Identity columns only. A reader that could select a display name would
      // be one refactor away from publishing a third party's name.
      .select('id, platform, platform_user_id')
      .in('id', [...authorIds]);                  // BY ID. Never by identity.
    if (error) throw new Error(`engagement_authors read failed: ${error.message}`);
    return (data ?? []) as CandidateAuthorRow[];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Attestability.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An `anon_*` identity. Minted by `engagementNormalizationService` at two
 * places — `anon_${row.platform_comment_id}` and `anon_${row.message_id}` —
 * whenever a synced row carried no author username, profile url or name. It is
 * unique per COMMENT or per MESSAGE, so it identifies an utterance, never a
 * person, and attesting one would register an identity that can never recur.
 */
const ANONYMOUS_FALLBACK = /^anon_/;

/**
 * An `extension_author_*` identity. `extensionEventIngestionService.buildAuthorId`
 * falls back to `extension_author_${platform_message_id}` when the event carried
 * no author identity at all, and that file's own comment says the token is
 * "unique per MESSAGE, so using it as a visitor identity would mint a fresh
 * visitor for every event". The same objection applies to attesting it.
 */
const EXTENSION_FALLBACK = /^extension_author_/;

/**
 * A profile URL. The identity an administrator attests has to be one a human can
 * recognise and a platform can resolve, and both live writers can emit something
 * that is neither: `extensionEventIngestionService` prefers
 * `author_username` FIRST, and `engagementNormalizationService` prefers
 * `author_username` then `author_name`, so a stored `platform_user_id` is often a
 * BARE HANDLE or a BARE DISPLAY NAME. `lib/engagement/extensionIngestion`'s
 * `buildProfileUrl` returns a bare handle too whenever the platform is one it
 * does not know. None of those three is attestable: a handle is not unique
 * across platforms, a display name is not unique at all, and neither equals the
 * stable identity the registry exists to pin.
 */
const PROFILE_URL = /^https?:\/\//i;

/**
 * Whether this pair can be attested, and if not, WHICH requirement it failed
 * first.
 *
 * `null` means attestable. The order is fixed and the first failure wins, so the
 * counts in `OwnedIdentityExcludedCounts` partition the identities examined
 * exactly once each.
 */
export function classifyOwnedIdentityCandidate(
  platform: string | null | undefined,
  platformUserId: string | null | undefined,
): OwnedIdentityExclusion | null {
  // Lower-cased and trimmed by the contract's own helper. NOT aliased.
  const normalizedPlatform = normalizeEngagementPlatform(platform);
  // Trimmed only; case is preserved, because a profile URL path is
  // case-significant and a folded value would stop matching the author row.
  const identity = typeof platformUserId === 'string' ? platformUserId.trim() : '';

  if (identity === '' || normalizedPlatform === null) return 'identityBlank';
  if (ANONYMOUS_FALLBACK.test(identity)) return 'anonymousFallback';
  if (EXTENSION_FALLBACK.test(identity)) return 'extensionFallback';
  if (!PROFILE_URL.test(identity)) return 'identityNotAProfileUrl';
  if (!ATTESTABLE_PLATFORMS.includes(normalizedPlatform)) return 'platformNotAttestable';
  return null;
}

/** The bound a caller actually gets: a positive integer, never above the max. */
export function resolveOwnedIdentityCandidatesLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
    return OWNED_IDENTITY_CANDIDATES_LIMIT_DEFAULT;
  }
  return Math.min(Math.floor(limit), OWNED_IDENTITY_CANDIDATES_LIMIT_MAX);
}

const emptyExcluded = (examined: number): OwnedIdentityExcludedCounts => ({
  examined,
  identityBlank: 0,
  anonymousFallback: 0,
  extensionFallback: 0,
  identityNotAProfileUrl: 0,
  platformNotAttestable: 0,
});

/** Observation proof accumulated from the tenant-scoped messages. */
interface Observation {
  messageIds: Set<string>;
  threadIds: Set<string>;
  firstMs: number | null;
  firstAt: string | null;
  lastMs: number | null;
  lastAt: string | null;
}

const newObservation = (): Observation => ({
  messageIds: new Set<string>(),
  threadIds: new Set<string>(),
  firstMs: null,
  firstAt: null,
  lastMs: null,
  lastAt: null,
});

/**
 * Fold one tenant-proven message into an author's observation proof.
 *
 * `threadById` is the TENANT-FILTERED map, and a message whose `thread_id` is
 * not in it is dropped. That re-assertion is on the DATA rather than only in the
 * query, so a widened or mistaken read cannot fail open.
 */
function observe(
  byAuthor: Map<string, Observation>,
  message: CandidateMessageRow,
  threadById: ReadonlyMap<string, CandidateThreadRow>,
): void {
  const threadId = text(message.thread_id);
  if (threadId === null || !threadById.has(threadId)) return;

  const authorId = text(message.author_id);
  const messageId = text(message.id);
  if (authorId === null || messageId === null) return;

  let proof = byAuthor.get(authorId);
  if (!proof) {
    proof = newObservation();
    byAuthor.set(authorId, proof);
  }
  proof.messageIds.add(messageId);
  proof.threadIds.add(threadId);

  const observedAt = text(message.platform_created_at);
  if (observedAt === null) return;
  const ms = Date.parse(observedAt);
  if (!Number.isFinite(ms)) return;
  if (proof.firstMs === null || ms < proof.firstMs) { proof.firstMs = ms; proof.firstAt = observedAt; }
  if (proof.lastMs === null || ms > proof.lastMs) { proof.lastMs = ms; proof.lastAt = observedAt; }
}

/** The projection, built from an author row and its observation proof. */
function project(author: CandidateAuthorRow, proof: Observation): OwnedIdentityCandidate {
  return {
    authorId: String(author.id),
    platform: normalizeEngagementPlatform(author.platform) as string,
    // VERBATIM after an outer trim, exactly as the contract's
    // `normalizeEngagementIdentity` does it. Never case-folded.
    platformUserId: String(author.platform_user_id).trim(),
    messageCount: proof.messageIds.size,
    threadCount: proof.threadIds.size,
    firstObservedAt: proof.firstAt,
    lastObservedAt: proof.lastAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The listing.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The engagement identities this tenant could attest, or the reason there is no
 * answer.
 *
 * Returns a VALUE for every outcome a caller can act on; it throws only for a
 * missing tenant, which is a programming error in the caller rather than a bad
 * record. An unreadable relation is `store_unavailable` and is NEVER an empty
 * list: "there are none to pick" and "we could not look" are different answers
 * and only the second is worth retrying. The contract's header makes the same
 * point about the registry, and it holds here for the same reason.
 */
export async function readOwnedIdentityCandidates(
  input: OwnedIdentityCandidatesInput,
  ports: OwnedIdentityCandidatePorts = defaultOwnedIdentityCandidatePorts,
): Promise<OwnedIdentityCandidatesResult> {
  const organizationId = text(input?.organizationId);
  if (!organizationId) {
    throw new Error(
      'readOwnedIdentityCandidates: organizationId is required — the tenant is the VERIFIED one, '
      + 'never a body field and never ambient',
    );
  }

  try {
    const threadById = await loadTenantThreads(ports, organizationId);
    if (threadById.size === 0) {
      return {
        ok: true,
        version: OWNED_IDENTITY_CANDIDATES_VERSION,
        reason: 'no engagement thread in this tenant, so no engagement identity has been observed '
          + 'here and there is nothing an administrator could attest from stored evidence',
        candidates: [],
        excluded: emptyExcluded(0),
      };
    }

    const limit = resolveOwnedIdentityCandidatesLimit(input?.limit);
    const messages = await ports.loadMessages([...threadById.keys()], limit);

    const byAuthor = new Map<string, Observation>();
    for (const m of messages) observe(byAuthor, m, threadById);

    if (byAuthor.size === 0) {
      return {
        ok: true,
        version: OWNED_IDENTITY_CANDIDATES_VERSION,
        reason: 'the threads in this tenant name no author on any message in the window that was '
          + 'read, so no identity could be put forward',
        candidates: [],
        excluded: emptyExcluded(0),
      };
    }

    const authors = await ports.loadAuthors([...byAuthor.keys()]);

    const candidates: OwnedIdentityCandidate[] = [];
    const counts = {
      identityBlank: 0,
      anonymousFallback: 0,
      extensionFallback: 0,
      identityNotAProfileUrl: 0,
      platformNotAttestable: 0,
    };
    let examined = 0;

    for (const author of authors) {
      const authorId = text(author.id);
      if (authorId === null) continue;
      // Re-asserted on the DATA: an author row that no tenant-proven message
      // named is not examined at all, so a widened author read cannot leak one.
      const proof = byAuthor.get(authorId);
      if (!proof) continue;

      examined += 1;
      const exclusion = classifyOwnedIdentityCandidate(author.platform, author.platform_user_id);
      if (exclusion !== null) { counts[exclusion] += 1; continue; }
      candidates.push(project(author, proof));
    }

    // Newest observation first. Chronology, not judgement. A candidate with no
    // source instant sorts last rather than being treated as recent.
    candidates.sort((a, b) => {
      const at = a.lastObservedAt === null ? -1 : Date.parse(a.lastObservedAt);
      const bt = b.lastObservedAt === null ? -1 : Date.parse(b.lastObservedAt);
      return bt - at;
    });

    return {
      ok: true,
      version: OWNED_IDENTITY_CANDIDATES_VERSION,
      reason: candidates.length > 0
        ? 'every identity below was observed on a message in a thread belonging to this tenant; '
          + 'listing one is not a claim that the tenant owns it'
        : 'identities were observed in this tenant, but none of them carries an identity stable '
          + 'enough to attest — the counts say which requirement each one failed',
      candidates,
      excluded: { examined, ...counts },
    };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : 'engagement read failed';
    logger.error('owned_identity_candidates_unavailable', { organizationId, detail });
    return { ok: false, refusal: 'store_unavailable', detail };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The re-resolution.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-resolve ONE author id through the candidate path, at attestation time.
 *
 * This is the function that makes `POST /api/prospect-identity/owned-identities`
 * safe. The request names an author id and NOTHING about the identity; the
 * server re-proves, from the same three-hop relationship the listing uses, that
 * the author is still observed in THIS tenant and still attestable, and then
 * reads `(platform, platform_user_id)` OFF THE STORED ROW. So the pair that
 * gets attested is the pair the database holds, never a pair the request
 * supplied — which is what stops a caller registering an arbitrary identity by
 * sending it in a body.
 *
 * It does NOT reuse the listing window. A tenant with more traffic than the
 * clamp would otherwise make a perfectly valid candidate un-attestable
 * depending on where it fell in a read bound, which is a limit deciding an
 * authorization question. The messages read here are narrowed to this one
 * author, under the same mandatory thread scoping.
 */
export async function resolveOwnedIdentityCandidate(
  input: ResolveOwnedIdentityCandidateInput,
  ports: OwnedIdentityCandidatePorts = defaultOwnedIdentityCandidatePorts,
): Promise<ResolveOwnedIdentityCandidateResult> {
  const organizationId = text(input?.organizationId);
  if (!organizationId) {
    throw new Error(
      'resolveOwnedIdentityCandidate: organizationId is required — the tenant is the VERIFIED one, '
      + 'never a body field and never ambient',
    );
  }

  const authorId = text(input?.authorId);
  if (!authorId) {
    return {
      ok: false,
      refusal: 'candidate_not_found',
      detail: 'no author id was supplied',
    };
  }

  try {
    const threadById = await loadTenantThreads(ports, organizationId);
    if (threadById.size === 0) {
      // No thread in this tenant means the identity cannot have been observed
      // here. Answered exactly as an absent author: see the refusal comment.
      return {
        ok: false,
        refusal: 'candidate_not_found',
        detail: 'no engagement thread in this tenant could have observed this identity',
      };
    }

    const messages = await ports.loadMessagesForAuthor(
      [...threadById.keys()], authorId, OWNED_IDENTITY_CANDIDATES_LIMIT_MAX,
    );

    const byAuthor = new Map<string, Observation>();
    for (const m of messages) {
      // Re-asserted on the DATA, and on the AUTHOR too: a read that returned a
      // different author's row must not be able to stand in for this one.
      if (text(m.author_id) !== authorId) continue;
      observe(byAuthor, m, threadById);
    }

    const proof = byAuthor.get(authorId);
    if (!proof || proof.messageIds.size === 0) {
      return {
        ok: false,
        refusal: 'candidate_not_found',
        detail: 'this author is not observed on any message in a thread belonging to this tenant',
      };
    }

    const authors = await ports.loadAuthors([authorId]);
    const author = authors.find((a) => text(a.id) === authorId);
    if (!author) {
      return {
        ok: false,
        refusal: 'candidate_not_found',
        detail: 'the author row named by this tenant’s messages could not be read back',
      };
    }

    const exclusion = classifyOwnedIdentityCandidate(author.platform, author.platform_user_id);
    if (exclusion !== null) {
      return {
        ok: false,
        refusal: 'candidate_not_attestable',
        detail: 'this identity is observed in this tenant but cannot be attested',
        exclusion,
      };
    }

    return { ok: true, candidate: project(author, proof) };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : 'engagement read failed';
    logger.error('owned_identity_candidate_resolution_unavailable', {
      organizationId, authorId, detail,
    });
    return { ok: false, refusal: 'store_unavailable', detail };
  }
}

/**
 * The tenant's threads, as a map keyed by id.
 *
 * Shared by both entry points DELIBERATELY: two copies of "which threads belong
 * to this tenant" is how the listing and the attestation path would come to
 * disagree, and the one disagreement that must never happen is an identity that
 * is un-listable but attestable. The tenant predicate is re-asserted on the
 * DATA here, so a widened query cannot fail open on either path.
 */
async function loadTenantThreads(
  ports: OwnedIdentityCandidatePorts,
  organizationId: string,
): Promise<ReadonlyMap<string, CandidateThreadRow>> {
  const threads = (await ports.loadThreads(organizationId))
    .filter((t) => text(t.organization_id) === organizationId && text(t.id) !== null);
  const threadById = new Map<string, CandidateThreadRow>();
  for (const t of threads) threadById.set(String(t.id), t);
  return threadById;
}
