import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/prospect-identity/owned-identities — the organization's own engagement
 * identities, attested and revoked.
 *
 *   GET    /api/prospect-identity/owned-identities?companyId=<uuid>
 *   POST   /api/prospect-identity/owned-identities?companyId=<uuid>
 *            body: { candidateAuthorId: <uuid>, statement: <text>, confirmed: true }
 *   DELETE /api/prospect-identity/owned-identities?companyId=<uuid>&id=<uuid>&reason=<text>
 *
 * `attestedIdentityContract.ts` defines what an attestation IS: an authorized
 * administrator stating that one `(platform, platform_user_id)` pair as
 * `engagement_authors` holds it belongs to their own organization — a RECORD,
 * not a proof. An active attestation is NEGATIVE EVIDENCE ONLY: "never admit
 * this as a prospect's own statement". This route is the control plane for that
 * record, and it claims nothing the contract does not.
 *
 * ─── THE SERVER CHOOSES THE IDENTITY. THE CALLER CHOOSES THE CANDIDATE. ───
 * `POST` takes `candidateAuthorId` — an `engagement_authors.id` the companion
 * `owned-identity-candidates` read reported — and NOTHING about the identity
 * itself. The server then re-resolves that id through the candidate path,
 * re-proving from the thread relationship that the author is still observed in
 * THIS tenant and still attestable, and reads `(platform, platform_user_id)`
 * OFF THE STORED ROW.
 *
 * That is the whole security argument of this surface. If the pair came from the
 * body, an administrator — or anything holding their session — could register
 * an arbitrary identity as organization-owned, and because an active attestation
 * means "never admit this as a prospect's statement", a registered identity
 * SUPPRESSES evidence. A body-supplied pair would therefore be a way to silence
 * a prospect's own words by naming them. So `platform`, `platformUserId`,
 * `organizationId`, `attestedByUserId`, `attestedAt` and `id` are each a NAMED
 * 400 rather than an ignored field: a caller who sends one and receives a 201
 * would reasonably believe it was honoured. The style is the one
 * `/api/outreach/outcomes` and `/api/prospects/[id]/problems` established.
 *
 * The acting user comes from the AUTHORIZED PRINCIPAL, never the body, so an
 * attestation is attributable to the person the platform authenticated rather
 * than to the one the request claimed.
 *
 * ─── `confirmed: true` IS REQUIRED ────────────────────────────────────────
 * Absent or anything other than `true` is a 400. An attestation suppresses
 * future evidence about a real person and is not the kind of act that should be
 * reachable by a request that was almost something else; the administrator
 * confirms it explicitly.
 *
 * ─── REVOCATION IS BY THE REGISTRY ROW'S OWN UUID ─────────────────────────
 * `DELETE` takes `id`, the attestation's primary key, and never the identity.
 * Revoking by `(platform, platform_user_id)` would put a profile URL in a query
 * string, and from there into an access log, a proxy log and a browser history.
 * `reason` is REQUIRED and a blank one is a 400: a revocation with no reason is
 * an audit record nobody can act on, which is the same as no audit record.
 *
 * ─── HOW THE TENANT IS ESTABLISHED ────────────────────────────────────────
 * `companyId` arrives in the QUERY STRING ONLY and is not trusted — it is an
 * assertion. `requireTenantAccess` verifies live membership, writes its own
 * 401/403 and refuses a legacy cookie bridge principal, exactly as the sibling
 * `authority.ts` does. Everything after the guard uses the VERIFIED id and never
 * re-reads `req.query`, because two reads of a repeated parameter can diverge.
 *
 * ─── ADMINISTRATOR-ONLY ON EVERY METHOD, READS INCLUDED ───────────────────
 * Gated on `PROSPECT_INGEST`, bound to the VERIFIED `companyId`, on GET as well
 * as POST and DELETE. This is governance configuration, and `authority.ts` is
 * administrator-only on every method for that reason: membership alone would let
 * an ordinary member read which identities their organization claims. No
 * capability is minted and no step-up is required — the step-up policy registry
 * keys by capability, so gating this would gate four already-shipped routes.
 *
 * ─── FAIL CLOSED. AN UNREADABLE REGISTRY IS NOT AN EMPTY ONE. ─────────────
 * 503 `owned_identities_unavailable`, never an empty 200, for any read or write
 * that could not reach the store. The contract is explicit that "an UNREADABLE
 * registry is NOT an empty registry" and that confusing the two is how the
 * predecessor failed. A caller that received `{ entries: [] }` from a failed
 * read would conclude the organization owns nobody.
 *
 * ─── A CANDIDATE IN ANOTHER TENANT IS AN ABSENT CANDIDATE ─────────────────
 * 404 `candidate_not_found` for an author id that does not exist AND for one
 * that exists but was never observed in this tenant, indistinguishably.
 * Reporting them apart would make this route a cross-tenant existence oracle for
 * a global identity table, which is the defect the PI surfaces already document
 * closing for prospects.
 *
 * ─── ONE UI CONSUMER: THE COMPANY-ADMIN PANEL ─────────────────────────────
 * This route is no longer API-only. `components/prospects/OwnedIdentitiesPanel`
 * is a minimal company-admin panel over exactly these three methods: it lists
 * the active attestations, posts `{ candidateAuthorId, statement, confirmed }`
 * for one candidate the companion read reported, and deletes by the registry
 * row's own uuid with a reason.
 *
 * It adds NO second API and NO new capability. The panel is a client, not an
 * authority: `PROSPECT_INGEST` bound to the verified `companyId`, on every
 * method, remains the only thing that decides anything. Nothing about the
 * identity is sent from the browser — the panel submits the candidate id and
 * never a pair — so the security argument above is untouched by the existence
 * of a UI. The panel also claims no authorization of its own:
 * `CompanyContext` defaults an empty role map to `COMPANY_ADMIN`, so a
 * client-side role check can read "admin" for a principal this route would
 * refuse, and every permission sentence the panel shows is produced from a 401
 * or 403 returned HERE.
 *
 * It is mounted inside `pages/settings/company-admin-access.tsx`, the existing
 * company-admin governance page, because that page's authority axis is the one
 * this route uses. The Integration Hub was rejected: its Enrichment tab gates
 * on `requireExternalApiAccess` / `requireManage`, a DIFFERENT axis, and two
 * authorities behind one surface misleads whoever reads it. That page is in no
 * navigation menu — `lib/routes/canonicalRegistry.ts` registers its path and
 * two Command Center readiness items link it as help, and nothing else does —
 * so the panel is URL-reachable only. That is a real limitation of the mount,
 * recorded rather than hidden.
 *
 * The fail-closed rules below are the ones the panel depends on most: it
 * renders "no attestation records" only from a real 200 carrying `entries: []`,
 * and a 503 as "we could not read the registry". A route that answered an
 * empty list on a failed read would make the panel assert that an organization
 * owns nobody.
 *
 * ─── THIS ROUTE WRITES NOTHING ITSELF ────────────────────────────────────
 * Every mutation goes through WS-A's repository, injected as a port so this file
 * compiles independently of it. There is no insert, update, upsert or delete
 * call here and none in the candidate service.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import { PROSPECT_API_VERSION } from '../../../backend/apiHandlers/prospects/prospectIntelligenceRead';
import { logger } from '../../../backend/services/logger';
import * as attestedIdentityRepository from '../../../backend/services/engagementIdentity/attestedIdentityRepository';
import {
  resolveOwnedIdentityCandidate,
  OWNED_IDENTITY_API_CONTRACT_VERSION,
  type ResolveOwnedIdentityCandidateResult,
} from '../../../backend/services/engagementIdentity/ownedIdentityCandidates';
import {
  type AttestIdentityInput,
  type AttestIdentityResult,
  type AttestedEngagementIdentity,
  type AttestationFailure,
  type RevokeIdentityResult,
} from '../../../backend/services/engagementIdentity/attestedIdentityContract';

const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim() !== '') return v[0].trim();
  return null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A uuid is checked HERE rather than left to the membership lookup, which would
 * send a malformed value to Postgres, get a `22P02`, and have it classified as a
 * membership failure — answering 403 "access denied" for what is a malformed
 * request, and spending a round trip on unvalidated input.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every envelope leads with the API version, then this surface's own contract.
 * `PROBLEM_OBSERVATION_CONTRACT_VERSION` is deliberately NOT reused: a client
 * that pinned it would believe it had pinned a different surface's rules.
 */
const envelope = <T extends Record<string, unknown>>(body: T) =>
  ({ version: PROSPECT_API_VERSION, contract: OWNED_IDENTITY_API_CONTRACT_VERSION, ...body });

/**
 * Fields the server owns, each a NAMED 400 rather than an ignored field.
 *
 * `platform` and `platformUserId` are the load-bearing two: the pair that gets
 * attested is read off the stored author row the candidate id names, so a
 * body-supplied pair would be a caller choosing which identity to suppress. The
 * tenant keys are here because the tenant is the one `requireTenantAccess`
 * VERIFIED, and `attestedByUserId` / `attestedAt` / `id` because provenance is
 * the platform's to state. Snake-case spellings are listed too: a client that
 * sent `platform_user_id` and got a 201 would have been just as misled.
 */
const SERVER_OWNED_FIELDS = [
  'platform',
  'platformUserId', 'platform_user_id',
  'organizationId', 'organization_id',
  'companyId', 'company_id',
  'attestedByUserId', 'attested_by_user_id',
  'attestedAt', 'attested_at',
  'id',
  'attestedAs', 'attested_as',
  'revokedAt', 'revoked_at',
  'revokedByUserId', 'revoked_by_user_id',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// WS-A's repository, injected.
// ─────────────────────────────────────────────────────────────────────────────

/** What `DELETE` hands the repository. The actor and the tenant are server-derived. */
interface RevokeIdentityInput {
  readonly organizationId: string;
  /** The registry row's OWN uuid. Never an identity string. */
  readonly id: string;
  readonly revokedByUserId: string;
  readonly reason: string;
}

/**
 * What a listing can answer.
 *
 * Several envelopes are accepted on purpose. The repository is on disk and
 * returns `{ legible, detail, identities }`; a bare array and an
 * `{ ok: true, identities }` envelope are tolerated too, and an `{ ok: false }`
 * refusal is accepted because the contract REQUIRES the unreadable case be
 * representable. The tolerance is not indecision — it is what makes an
 * unexpected shape fail CLOSED into 503. What is NOT accepted anywhere below is
 * treating a refusal as an empty list.
 */
export type ListActiveAttestedIdentitiesResult =
  | readonly AttestedEngagementIdentity[]
  | { readonly ok: true; readonly identities: readonly AttestedEngagementIdentity[] }
  | { readonly ok: false; readonly reason: AttestationFailure; readonly detail: string };

/**
 * The repository module as it ACTUALLY is — which is not the port.
 *
 * An earlier revision cast the required module straight to
 * `OwnedIdentityRegistryPorts`. That made two deliberately different shapes
 * look identical to the compiler, and the consequence was silent: the adapter
 * handed `listActiveAttestedIdentities` a bare tenant string where the
 * repository destructures `{ organizationId }`, so `requireTenant` read
 * `undefined`, threw, and the handler's catch turned EVERY active-list read into
 * `503 owned_identities_unavailable`. Fail-closed, therefore invisible — and the
 * route suite could not see it either, because it replaces the whole port.
 *
 * The read is typed `Promise<unknown>` on purpose. This route does not trust the
 * envelope: it re-validates below precisely so an unexpected shape becomes a 503
 * rather than an empty registry, and a type that promised more than that would
 * be asserting a guarantee nothing checks.
 */
interface AttestedIdentityRepositoryModule {
  attestIdentity(input: AttestIdentityInput): Promise<AttestIdentityResult>;
  revokeIdentity(input: RevokeIdentityInput): Promise<RevokeIdentityResult>;
  listActiveAttestedIdentities(query: { readonly organizationId: string }): Promise<unknown>;
}

/**
 * The registry, injected.
 *
 * One port, so there is exactly one place this route reaches a write, and so the
 * suite can exercise every status this handler can produce without a database —
 * the convention `problemObservationIngestion.ts` established.
 *
 * The default binding resolves the repository LAZILY. That began as a way to
 * compile before the module existed; it is kept because a build in which the
 * repository is genuinely missing then answers 503 rather than failing to start.
 *
 * NOTE THE NARROWING, because it is the point of the port: this route may name
 * only the VERIFIED tenant. It may not pass a `platform` filter or a `limit`,
 * which a caller could use to widen or re-shape a governance read. The
 * repository's own read accepts those, for callers that legitimately need them.
 * So the module and the port are deliberately DIFFERENT shapes, and the
 * adapter below converts between them.
 */
export interface OwnedIdentityRegistryPorts {
  attestIdentity(input: AttestIdentityInput): Promise<AttestIdentityResult>;
  revokeIdentity(input: RevokeIdentityInput): Promise<RevokeIdentityResult>;
  /**
   * Returns `unknown` ON PURPOSE, and the handler re-validates it.
   *
   * An earlier revision declared `Promise<ListActiveAttestedIdentitiesResult>`.
   * Nothing verified that: the repository is resolved by a lazy `require` and
   * hands back whatever it hands back, so the annotation was a promise the type
   * system could not keep, and it is what let a refusal carrying an empty array
   * read as a successful empty list. Declaring `unknown` makes the handler do
   * what it already claimed to do — distinguish the envelopes, and fail CLOSED
   * on one it cannot read. `ListActiveAttestedIdentitiesResult` stays below as
   * the documented set of shapes the handler accepts.
   */
  listActiveAttestedIdentities(organizationId: string): Promise<unknown>;
}

/**
 * The repository, bound as a STATIC import.
 *
 * This was a lazy `require(...)` resolved on first use, to avoid making the
 * compiler resolve a path while WS-A's file was still in flight. That file has
 * been on disk for some time, so the reason is gone — and the form was not
 * merely redundant, it was BROKEN under the bundler that actually serves this
 * route. Next compiles `pages/api` with webpack, which installs a module's
 * export bindings only for dependencies reached by `import`; a bare CommonJS
 * `require` of an ES module that nothing else imports got back an exports
 * object with NO KEYS (`__esModule` absent, no `default`). So
 * `loadRegistry().listActiveAttestedIdentities` was `undefined`, calling it
 * threw `TypeError`, and `handleList`'s catch turned every request into
 * `503 owned_identities_unavailable` — fail-closed, and invisible, because the
 * same `require` works under plain Node, so in-process tests and the unit
 * suite (which replaces the whole port object) both passed.
 *
 * A namespace import is what makes webpack link the module and populate the
 * bindings. The cast stays a shape claim, so the signatures above remain the
 * contract this route relies on.
 */
function loadRegistry(): AttestedIdentityRepositoryModule {
  return attestedIdentityRepository as unknown as AttestedIdentityRepositoryModule;
}

const defaultRegistryPorts: OwnedIdentityRegistryPorts = {
  attestIdentity: (input) => loadRegistry().attestIdentity(input),
  revokeIdentity: (input) => loadRegistry().revokeIdentity(input),
  /**
   * The repository's read takes a QUERY OBJECT, not a bare tenant id.
   *
   * This adapter exists because the two shapes genuinely differ: the port is
   * narrow on purpose — the route may name only the verified tenant, never a
   * `platform` filter or a `limit` a caller could widen — while the repository
   * accepts `{ organizationId, platform?, limit? }` for callers that legitimately
   * need those. Forwarding the string directly is what an earlier revision did,
   * and it was silently fatal: `requireTenant(query?.organizationId)` read
   * `undefined` off a string, threw, and the handler's catch turned every active
   * list into `503 owned_identities_unavailable` — fail-closed, so nothing
   * surfaced the mismatch. The route suite could not catch it either, because it
   * replaces this whole port object. Adapting here, at the boundary that owns
   * the narrowing, is the fix; a port-contract test pins it.
   */
  listActiveAttestedIdentities: (organizationId) =>
    loadRegistry().listActiveAttestedIdentities({ organizationId }),
};

/**
 * The bound registry.
 *
 * A mutable binding rather than a `jest.mock` of the repository path, because
 * the repository is NOT ON DISK in this build: a virtual module mock would have
 * to resolve a path that does not exist, from a different file than the one that
 * requires it, and a mock that silently failed to apply would turn every
 * assertion about a 201 into an assertion about the 503 the failed `require`
 * produces — a suite that passes for the wrong reason. This seam cannot
 * misapply. Nothing in the product calls the setter, and the default is the real
 * repository.
 */
let registryPorts: OwnedIdentityRegistryPorts = defaultRegistryPorts;

/** @internal — test seam. Passing `null` restores the real repository. */
export function __setOwnedIdentityRegistryPorts(ports: OwnedIdentityRegistryPorts | null): void {
  registryPorts = ports ?? defaultRegistryPorts;
}

const unavailable = (res: NextApiResponse) =>
  res.status(503).json(envelope({ error: 'owned_identities_unavailable', retryable: true }));

// ─────────────────────────────────────────────────────────────────────────────
// The handler.
// ─────────────────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json(envelope({ error: 'method_not_allowed' }));
  }

  // QUERY ONLY. A body never names the tenant on this surface.
  const companyId = str(req.query?.companyId) ?? str(req.query?.company_id);
  if (!companyId) return res.status(400).json(envelope({ error: 'companyId is required' }));
  if (!UUID.test(companyId)) return res.status(400).json(envelope({ error: 'companyId must be a uuid' }));

  // Membership-verified. Writes its own 401/403, audits the decision, and
  // returns null — returning here is what stops a denied request continuing.
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  // Membership said WHICH tenant. This says WHETHER this principal may read or
  // change the tenant's identity-ownership record. On EVERY method, bound to the
  // VERIFIED companyId — never to anything from the body.
  const guard = await requireCapability(req, res, {
    capability: PROSPECT_INGEST,
    organizationId: companyId,
    reason: 'administer the engagement identities this organization attests as its own',
    resourceId: str(req.query?.id) ?? companyId,
  });
  if (guard.ok !== true) return;

  // The acting user is the AUTHORIZED PRINCIPAL. `tenant.userId` is the fallback
  // only because both guards resolve the same principal; neither is the body.
  const actorUserId = str(guard.principal?.userId) ?? str(tenant.userId);

  if (method === 'GET') return handleList(res, companyId);
  if (method === 'POST') return handleAttest(req, res, companyId, actorUserId);
  return handleRevoke(req, res, companyId, actorUserId);
}

/**
 * The read. Three answers, and they stay three: the active attestations
 * (possibly zero), a refusal from the registry, and a store that could not be
 * reached. The last two are both 503 and NEITHER is an empty 200.
 */
async function handleList(res: NextApiResponse, companyId: string) {
  try {
    const result = await registryPorts.listActiveAttestedIdentities(companyId);

    // Read through `unknown` and distinguish the envelopes here rather than
    // assuming one. The repository is on disk now and returns
    // `{ legible, detail, identities }`, which the second branch below accepts;
    // an earlier revision of this comment said the module was still being
    // written, which is no longer true. The tolerance is kept deliberately: it
    // is what makes an unexpected shape fail CLOSED into 503 rather than render
    // as an empty registry, and that is the one thing this route must never do.
    const answer = result as unknown;

    // A DECLARED FAILURE IS CHECKED FIRST, AND THIS ORDER IS THE WHOLE POINT.
    //
    // The repository reports an unreadable relation as
    // `{ legible: false, detail, identities: [] }` — a refusal that CARRIES an
    // empty array. An earlier revision tested only `Array.isArray(identities)`,
    // so that refusal matched the success branch and an unreadable registry was
    // rendered as `200 { entries: [], state: 'available' }`: the route told an
    // administrator their organization owns nobody when it had not managed to
    // look. That is this file's own stated invariant inverted, and it is exactly
    // why the failure flags are consulted BEFORE the rows are read, not after.
    if (isRecord(answer) && (answer.legible === false || answer.ok === false)) {
      // WHY THIS IS LOGGED. The three refusals here are indistinguishable to a
      // caller by design, which also made them indistinguishable to an operator:
      // a 503 was emitted with no record of which one fired. The event name is
      // static and the payload carries no token, header, tenant or identity.
      logger.error('owned_identities_unavailable', {
        branch: 'declared_refusal',
        detail: String(answer.detail ?? '').slice(0, 160),
      });
      return unavailable(res);
    }

    let rows: readonly unknown[];
    if (Array.isArray(answer)) {
      rows = answer;
    } else if (isRecord(answer) && Array.isArray(answer.identities)) {
      rows = answer.identities;
    } else {
      // A shape this route cannot read. "We could not answer", and the contract
      // forbids rendering it as an empty registry.
      logger.error('owned_identities_unavailable', {
        branch: 'unreadable_shape',
        answerType: answer === null ? 'null' : typeof answer,
        answerKeys: isRecord(answer) ? Object.keys(answer).sort().join(',') : '-',
      });
      return unavailable(res);
    }

    // The projection, stated rather than spread: a repository row carries
    // `statement` and the revocation columns, and the entry list is about which
    // identities are claimed, not about what was written when claiming them.
    // Re-asserted on the tenant too, so a widened repository read cannot leak.
    const entries = rows
      .filter(isRecord)
      .filter((r) => str(r.organizationId) === companyId)
      .map((r) => ({
        id: str(r.id),
        platform: str(r.platform),
        // VERBATIM. `str` trims, and a profile URL's case is significant, so the
        // stored string is passed through untouched.
        platformUserId: typeof r.platformUserId === 'string' ? r.platformUserId : null,
        attestedAt: str(r.attestedAt),
        attestedByUserId: str(r.attestedByUserId),
      }));

    return res.status(200).json(envelope({ entries, state: 'available' }));
  } catch (err: unknown) {
    // Nothing from the failure reaches the caller: a store message can quote a
    // column or echo request input, and this surface holds identity strings.
    // It IS recorded, though — a swallowed cause is how this route came to
    // answer 503 with nothing an operator could diagnose from.
    logger.error('owned_identities_unavailable', {
      branch: 'threw',
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message.slice(0, 200) : '-',
      dbCode: isRecord(err) && typeof err.code === 'string' ? err.code : '-',
      stackHead: err instanceof Error
        ? String(err.stack).split('\n').slice(1, 4).join(' | ').slice(0, 300)
        : '-',
    });
    return unavailable(res);
  }
}

/**
 * The attestation.
 *
 * Validation order is deliberate: the refused fields are named FIRST, before the
 * accepted ones are looked at, so a caller who sent a `platform` alongside a
 * `candidateAuthorId` is told the request was refused rather than quietly given
 * a 201 for a different identity than the one they named.
 */
async function handleAttest(
  req: NextApiRequest, res: NextApiResponse, companyId: string, actorUserId: string | null,
) {
  if (!actorUserId) {
    // Both guards passed, so a principal exists. If no user id can be read from
    // either, that is a defect here and not a client error — and an attestation
    // with no actor is exactly the unusable audit record `reason` exists to stop.
    return res.status(500).json(envelope({ error: 'attesting_user_unresolved' }));
  }

  const body = isRecord(req.body)
    ? req.body
    : (typeof req.body === 'string' ? ((): Record<string, unknown> | null => {
      try {
        const parsed: unknown = JSON.parse(req.body || '{}');
        return isRecord(parsed) ? parsed : null;
      } catch { return null; }
    })() : null);
  if (!body) return res.status(400).json(envelope({ error: 'a JSON object body is required' }));

  const supplied = SERVER_OWNED_FIELDS.filter((f) => body[f] !== undefined);
  if (supplied.length > 0) {
    // Named, all at once, so a caller fixes one request rather than one field
    // per round trip. REFUSED, never ignored — see the header.
    return res.status(400).json(envelope({ error: 'server_owned_field', fields: supplied }));
  }

  const candidateAuthorId = str(body.candidateAuthorId);
  if (!candidateAuthorId) {
    return res.status(400).json(envelope({
      error: 'candidateAuthorId is required — name the candidate to attest, never the identity itself',
    }));
  }
  if (!UUID.test(candidateAuthorId)) {
    return res.status(400).json(envelope({ error: 'candidateAuthorId must be a uuid' }));
  }

  const statement = str(body.statement);
  if (!statement) {
    return res.status(400).json(envelope({
      error: 'statement is required — an attestation with no stated basis is an unusable record',
    }));
  }

  // Explicit, and `true` only. A truthy value is not a confirmation: `'false'`,
  // `1` and `{}` are all truthy, and none of them is an administrator saying yes.
  if (body.confirmed !== true) {
    return res.status(400).json(envelope({
      error: 'confirmation_required',
      detail: 'an attestation suppresses future evidence about a real person — send `confirmed: true`',
    }));
  }

  // ── THE RE-RESOLUTION ───────────────────────────────────────────────────
  // The server proves, from the thread relationship and under the VERIFIED
  // tenant, that this author is still observed here and still attestable, and
  // takes the pair off the stored row. Nothing about the identity came from the
  // request, which is the whole security argument of this route.
  let resolved: ResolveOwnedIdentityCandidateResult;
  try {
    resolved = await resolveOwnedIdentityCandidate({
      organizationId: companyId,          // the VERIFIED tenant, never a body field
      authorId: candidateAuthorId,
    });
  } catch {
    return unavailable(res);
  }

  if ('refusal' in resolved) {
    if (resolved.refusal === 'store_unavailable') return unavailable(res);
    if (resolved.refusal === 'candidate_not_attestable') {
      // The identity IS in this tenant, so saying so discloses nothing
      // cross-tenant, and the caller can act on which requirement it failed.
      return res.status(400).json(envelope({
        error: 'candidate_not_attestable',
        detail: resolved.detail,
        requirement: resolved.exclusion ?? null,
      }));
    }
    // Absent, and not-observed-in-this-tenant, answered IDENTICALLY.
    return res.status(404).json(envelope({ error: 'candidate_not_found' }));
  }

  try {
    const result = await registryPorts.attestIdentity({
      organizationId: companyId,                        // VERIFIED
      platform: resolved.candidate.platform,            // off the STORED row
      platformUserId: resolved.candidate.platformUserId, // off the STORED row, verbatim
      statement,
      attestedByUserId: actorUserId,                    // the AUTHORIZED principal
    });

    // A SHAPE CLAIM, for the reason the list path states: the repository is in
    // flight, so its answer is inspected rather than trusted.
    const answer = result as unknown;
    if (isRecord(answer) && 'reason' in answer) {
      const refusal = answer.reason as AttestationFailure;
      if (refusal === 'store_unavailable') return unavailable(res);
      return res.status(400).json(envelope({
        error: 'attestation_refused',
        requirement: refusal,
      }));
    }

    if (!isRecord(answer) || typeof answer.id !== 'string') {
      // A repository that answered neither a refusal nor an id has not written
      // anything this route can report. Fail closed.
      return unavailable(res);
    }

    // 201 for a row that was written, 200 for a replay of one already active.
    // `alreadyActive` is carried on both, so a caller never has to infer it.
    const alreadyActive = answer.alreadyActive === true;
    return res.status(alreadyActive ? 200 : 201).json(envelope({
      entryId: answer.id,
      alreadyActive,
    }));
  } catch {
    return unavailable(res);
  }
}

/**
 * The revocation. By the registry row's own uuid, with a reason, and never by
 * the identity — see the header on why a profile URL must not reach a query
 * string.
 */
async function handleRevoke(
  req: NextApiRequest, res: NextApiResponse, companyId: string, actorUserId: string | null,
) {
  if (!actorUserId) {
    return res.status(500).json(envelope({ error: 'revoking_user_unresolved' }));
  }

  const id = str(req.query?.id);
  if (!id) {
    return res.status(400).json(envelope({
      error: 'id is required — revoke by the registry entry’s own uuid, never by the identity',
    }));
  }
  if (!UUID.test(id)) return res.status(400).json(envelope({ error: 'id must be a uuid' }));

  const reason = str(req.query?.reason);
  if (!reason) {
    return res.status(400).json(envelope({
      error: 'reason is required — a revocation with no reason is an audit record nobody can act on',
    }));
  }

  try {
    const result = await registryPorts.revokeIdentity({
      organizationId: companyId,        // VERIFIED
      id,
      revokedByUserId: actorUserId,     // the AUTHORIZED principal
      reason,
    });

    const answer = result as unknown;
    if (isRecord(answer) && 'reason' in answer) {
      const refusal = answer.reason as AttestationFailure;
      if (refusal === 'store_unavailable') return unavailable(res);
      if (refusal === 'not_found') {
        // An entry in another tenant is answered exactly as an absent one.
        return res.status(404).json(envelope({ error: 'entry_not_found' }));
      }
      if (refusal === 'already_revoked') {
        // Not an error. The entry is not active, which is what was asked for.
        return res.status(200).json(envelope({ revoked: false }));
      }
      return res.status(400).json(envelope({ error: 'revocation_refused', requirement: refusal }));
    }

    if (!isRecord(answer) || typeof answer.revoked !== 'boolean') {
      return unavailable(res);
    }
    return res.status(200).json(envelope({ revoked: answer.revoked }));
  } catch {
    return unavailable(res);
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-identity/owned-identities' });
