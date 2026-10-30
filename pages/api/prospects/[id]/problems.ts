import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * /api/prospects/:id/problems — the problems a prospect has STATED.
 *
 *   POST — record one problem observation.
 *   GET  — read the observations recorded for this prospect.
 *
 * ─── WHY A SUBRESOURCE AND NOT A VERB ON `[id].ts` ────────────────────────
 * `/api/prospects/[id]` documents itself GET-only and answers "everything the
 * platform can say about one Prospect". Recording an utterance a prospect made
 * is a different kind of act, and `[id]/enrich.ts` already records the house
 * rule that such an act gets its own subresource rather than a verb switch
 * behind a documented read. This follows it.
 *
 * ─── THE TENANT IS NAMED, NEVER INFERRED, AND NEVER FROM THE BODY ─────────
 * `companyId` is a query parameter validated by `requireTenantAccess` against
 * live membership, exactly as both sibling routes do it. A body carrying
 * `organizationId` / `company_id` is REFUSED rather than ignored: ignoring it
 * would be safe but silent, and a caller who believes they are writing into
 * another tenant must be told they are not. The prospect id in the path is not
 * authorization either — the seam re-resolves it under the verified tenant and
 * re-asserts that tenant on the rows it reads.
 *
 * ─── MEMBERSHIP ANSWERS *WHICH*, THE CAPABILITY ANSWERS *WHETHER* ─────────
 * The write is gated on `PROSPECT_INGEST`, bound to the VERIFIED tenant id —
 * the same grant the three `lead-ingestion` routes require, for the same
 * reason: this is an ASSERTION ABOUT ONE PERSON entering the tenant's record.
 * No capability is minted here, and `PROSPECT_ENRICH_EXECUTE` is deliberately
 * NOT required: nothing below spends a provider credit, makes a network call or
 * resolves a credential. The read is gated on membership alone, exactly as the
 * sibling GET `/api/prospects/[id]` is: requiring an admin-tier INGEST grant in
 * order to READ would be the wrong trade, since these statements are the
 * tenant's own record of what a prospect told them.
 *
 * One field this read DOES add over that sibling, stated rather than implied:
 * `recordedByUserId`. `prospectIntelligenceRead` surfaces no recording user, so
 * this subresource is the first to return one to an ordinary tenant member. It
 * is a colleague's id on a note the same tenant recorded, which is attribution
 * rather than exposure — but it IS a genuine addition, and an earlier revision
 * of this header claimed the read added no field at all, which was untrue. If a
 * tenant should not see who attested a statement, the field has to be dropped
 * from the read projection; it cannot be waved away by this comment.
 *
 * ─── PROVENANCE IS SERVER-OWNED ───────────────────────────────────────────
 * `recordedAt`, the recording user and `derivedFrom` are never read from the
 * body; a body that supplies one is refused with the field named, the style
 * `/api/outreach/outcomes` established. The recording user comes from the
 * authorized principal, so an attested statement is attributable to the person
 * the platform authenticated and not to the one the request claimed.
 *
 * ─── IDEMPOTENCY IS THE DATABASE'S, NOT THIS ROUTE'S ──────────────────────
 * The relation carries a unique constraint over (tenant, origin store, origin
 * record, statement hash) and the repository reports its violation as
 * `duplicate: true`. This handler is therefore NOT wrapped in `withIdempotency`
 * and requires no `Idempotency-Key`: as `/api/outreach/outcomes` puts it, an
 * application-level check in front of a unique constraint would be a race, not
 * a guarantee. A replay is a 200 carrying `duplicate: true`; a first write is a
 * 201. Both are successes and neither is a second row.
 *
 * ─── WHAT THE CLIENT IS AND IS NOT TOLD ───────────────────────────────────
 * A prospect in another tenant is reported EXACTLY as an absent one — 404
 * `prospect_not_found`. The seam keeps the distinction, in logs only; surfacing
 * it would turn this route into a cross-tenant existence oracle, which is the
 * defect `/api/prospects/[id]` already documents closing.
 *
 * An unreadable relation is 503 `problem_observations_unavailable`, never an
 * empty 200: "there are none" and "we could not look" are different answers and
 * only the second is worth retrying.
 *
 * ─── TWO REQUEST SHAPES, AND THEY DO NOT MIX ──────────────────────────────
 * POST accepts either:
 *
 *   TRANSCRIBED — the original shape, unchanged. The caller supplies the
 *                 prospect's words and names where they can be re-read.
 *   SOURCED     — `source: { messageId }`. The server derives the statement,
 *                 the origin and the observation time from ONE stored message,
 *                 after verifying that the prospect actually authored it.
 *
 * `source` is the discriminator. When it is present, `statement`, `observedAt`,
 * `origin`, `originKind`, `sourceRecordId`, `statementLanguage` and `confidence`
 * are REFUSED with the field named rather than silently dropped: a caller who
 * sends a statement alongside a `messageId` and receives a 201 would reasonably
 * believe the statement they sent was stored, when what was stored is the
 * message's own text. Merging the two quietly would make the request body a
 * second, unverified source of the prospect's words — the exact thing deriving
 * from a stored row exists to avoid. `GET /api/prospects/:id/eligible-messages`
 * lists the messages this shape would accept, so a `messageId` need never be a
 * guess.
 *
 * ─── IT SCORES NOTHING ────────────────────────────────────────────────────
 * No score, dimension, weight or priority is produced or accepted here, and
 * nothing in this route makes Problem Fit scorable.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../../backend/security/TenantGuard';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { PROSPECT_INGEST } from '../../../../shared/contracts/security';
import { PROSPECT_API_VERSION } from '../../../../backend/apiHandlers/prospects/prospectIntelligenceRead';
import {
  recordProspectProblemObservation,
  readProspectProblemObservations,
  recordProspectProblemFromMessage,
} from '../../../../backend/services/prospectProblems/problemObservationIngestion';
import {
  PROBLEM_OBSERVATION_CONTRACT_VERSION,
  type ProblemObservationSubjectType,
  type RecordProblemObservationResult,
} from '../../../../backend/services/prospectProblems/types';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Body keys that would attempt to make the request body the tenant authority. */
const TENANT_OVERRIDE_KEYS = ['organizationId', 'organization_id', 'companyId', 'company_id'] as const;

/**
 * Fields the server owns. Supplying one is an error rather than an ignored
 * field: a caller who sets `recordedByUserId` and receives a 200 would
 * reasonably believe it was honoured, and the whole point of this route is that
 * an attested statement is attributable to the principal the platform
 * authenticated. `derivedFrom` is here for the same reason — it is the literal
 * the admission gate requires and the seam sets it, so accepting it from a
 * caller would let a request appear to declare its own admissibility.
 *
 * `subjectId` / `subject_id` are here for a sharper reason: they were ACCEPTED
 * AND IGNORED. The seam resolves the canonical subject from the path prospect id
 * under the verified tenant and takes `Omit<ProblemObservationInput, 'subjectId'>`
 * precisely so a caller cannot name one — a caller who could would be naming a
 * subject that may belong to a different prospect. A body supplying it got a 201
 * and no indication that the value went nowhere, which is the failure this list
 * exists to prevent, so it is now a named 400 on BOTH request shapes.
 */
const SERVER_OWNED_FIELDS = [
  'recordedAt', 'recorded_at',
  'recordedByUserId', 'recorded_by_user_id',
  'derivedFrom', 'derived_from',
  'id', 'statementHash', 'statement_hash',
  'subjectId', 'subject_id',
] as const;

/**
 * Fields the SOURCED shape derives, and therefore refuses.
 *
 * Each one is read from the stored message by the verification path. A body that
 * also supplies it is not merged and not ignored: it is named in a 400, because
 * the two possible silent outcomes are both wrong — honouring it would store a
 * caller's words under a server-verified provenance, and dropping it would
 * answer 201 to a request whose main content was discarded.
 */
const SOURCE_DERIVED_FIELDS = [
  'statement', 'observedAt', 'origin', 'originKind',
  'sourceRecordId', 'statementLanguage', 'confidence',
] as const;

/**
 * A uuid is checked HERE rather than left to the membership lookup, which would
 * send a malformed value to Postgres, get a `22P02`, and have it classified as a
 * membership failure — answering 403 "access denied" for what is a malformed
 * request, and spending a round trip on unvalidated input.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every envelope leads with the API version, so a client can pin what it parsed. */
const envelope = <T extends Record<string, unknown>>(body: T) =>
  ({ version: PROSPECT_API_VERSION, contract: PROBLEM_OBSERVATION_CONTRACT_VERSION, ...body });

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json(envelope({ error: 'method_not_allowed' }));
  }

  const companyId = str(req.query.companyId) ?? str(req.query.company_id);
  if (!companyId) return res.status(400).json(envelope({ error: 'companyId is required' }));
  if (!UUID.test(companyId)) return res.status(400).json(envelope({ error: 'companyId must be a uuid' }));

  // Membership-verified. Writes its own 401/403, audits the decision, and
  // returns null — returning here is what stops a denied request continuing.
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;

  const prospectId = str(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  if (!prospectId) return res.status(400).json(envelope({ error: 'prospect id is required' }));
  if (!UUID.test(prospectId)) return res.status(400).json(envelope({ error: 'prospect id must be a uuid' }));

  if (req.method === 'GET') return handleRead(req, res, companyId, prospectId);
  return handleCapture(req, res, companyId, prospectId);
}

/**
 * The read. Membership only, as the sibling prospect detail read is, and the
 * three answers it can give stay three: observations (possibly zero), a
 * prospect that is not readable here, and a relation that could not be read.
 */
async function handleRead(
  req: NextApiRequest, res: NextApiResponse, companyId: string, prospectId: string,
) {
  const subjectType = str(req.query.subjectType) ?? 'person';
  if (subjectType !== 'person' && subjectType !== 'account') {
    return res.status(400).json(envelope({ error: "subjectType must be 'person' or 'account'" }));
  }

  const limitRaw = str(req.query.limit);
  const limit = limitRaw === null ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    return res.status(400).json(envelope({ error: 'limit must be a positive number' }));
  }

  try {
    const result = await readProspectProblemObservations({
      organizationId: companyId, prospectId, subjectType, limit,
    });
    if (result.ok !== true) {
      if (result.refusal === 'store_unavailable') {
        return res.status(503).json(envelope({
          error: 'problem_observations_unavailable', retryable: true,
        }));
      }
      // `subject_other_tenant` is answered exactly as `subject_not_found`.
      return res.status(404).json(envelope({ error: 'prospect_not_found' }));
    }

    // `unavailable` is NOT an empty list, and is never reported as 200.
    if (result.read.state !== 'available') {
      return res.status(503).json(envelope({
        error: 'problem_observations_unavailable', retryable: true,
      }));
    }

    return res.status(200).json(envelope({
      subjectType: result.subjectType,
      subjectId: result.subjectId,
      state: result.read.state,
      observations: result.read.observations,
    }));
  } catch {
    // Nothing from the failure reaches the caller on this path: a refusal detail
    // can carry a store message, and a store message can echo request input.
    return res.status(503).json(envelope({
      error: 'problem_observations_unavailable', retryable: true,
    }));
  }
}

/**
 * The capture. Hand-rolled validation, no schema library on this surface —
 * every field is refused explicitly rather than coerced, and no absent value is
 * silently substituted. An unparseable `observedAt` is a 400, never the current
 * time; an absent confidence stays null, never a default.
 */
async function handleCapture(
  req: NextApiRequest, res: NextApiResponse, companyId: string, prospectId: string,
) {
  // Membership said WHICH tenant. This says WHETHER this principal may write an
  // assertion into it. Bound to the VERIFIED companyId — never to anything from
  // the body. `requireCapability` writes its own 401/403 and audits allow and
  // deny alike, so no refusal vocabulary is invented here.
  const guard = await requireCapability(req, res, {
    capability: PROSPECT_INGEST,
    organizationId: companyId,
    reason: 'record a problem observation stated by a prospect',
    resourceId: prospectId,
  });
  if (guard.ok !== true) return;

  const body = isRecord(req.body)
    ? req.body
    : (typeof req.body === 'string' ? ((): Record<string, unknown> | null => {
      try {
        const parsed: unknown = JSON.parse(req.body || '{}');
        return isRecord(parsed) ? parsed : null;
      } catch { return null; }
    })() : null);
  if (!body) return res.status(400).json(envelope({ error: 'a JSON object body is required' }));

  for (const key of TENANT_OVERRIDE_KEYS) {
    if (key in body) {
      return res.status(400).json(envelope({
        error: `'${key}' is not accepted in the body — the tenant comes from the verified companyId`,
      }));
    }
  }

  const supplied = SERVER_OWNED_FIELDS.filter((f) => body[f] !== undefined);
  if (supplied.length > 0) {
    return res.status(400).json(envelope({ error: 'server_owned_field', fields: supplied }));
  }

  const subjectType = str(body.subjectType);
  if (subjectType !== 'person' && subjectType !== 'account') {
    return res.status(400).json(envelope({ error: "subjectType must be 'person' or 'account'" }));
  }

  // ── THE DISCRIMINATOR ───────────────────────────────────────────────────
  // PRESENCE of `source` selects the shape, not its contents: a request that
  // names `source` and then malforms it is a malformed SOURCED request, never a
  // TRANSCRIBED one that happens to carry a stray key. Deciding by presence is
  // what makes the two shapes mutually exclusive instead of merely different.
  if ('source' in body) {
    return handleSourcedCapture(res, body, companyId, prospectId, subjectType);
  }

  const statement = str(body.statement);
  if (!statement) {
    return res.status(400).json(envelope({ error: 'statement is required' }));
  }

  const origin = isRecord(body.origin) ? body.origin : null;
  const originStore = origin === null ? null : str(origin.store);
  const originRecordId = origin === null ? null : str(origin.recordId);
  if (!originStore || !originRecordId) {
    return res.status(400).json(envelope({
      error: 'origin.store and origin.recordId are required — a statement must name where its words can be re-read',
    }));
  }

  const originKind = str(body.originKind);
  if (originKind !== 'provider' && originKind !== 'human') {
    return res.status(400).json(envelope({ error: "originKind must be 'provider' or 'human'" }));
  }

  // The source's own instant, required, and never replaced by the ingest clock:
  // an unparseable value is refused rather than quietly standing in for a real
  // observation time, which would answer a different question from the one asked.
  const observedAt = str(body.observedAt);
  if (!observedAt) {
    return res.status(400).json(envelope({
      error: 'observedAt is required — when the PROSPECT said it, as the source reported it',
    }));
  }
  if (Number.isNaN(Date.parse(observedAt))) {
    return res.status(400).json(envelope({ error: 'observedAt is not a parseable timestamp' }));
  }

  // Absent stays absent. `null` and omitted both mean the source recorded no
  // confidence; a present value must be a real number in 0..1.
  let confidence: number | null = null;
  if (body.confidence !== undefined && body.confidence !== null) {
    if (typeof body.confidence !== 'number' || !Number.isFinite(body.confidence)
      || body.confidence < 0 || body.confidence > 1) {
      return res.status(400).json(envelope({ error: 'confidence must be a number in 0..1, or omitted' }));
    }
    confidence = body.confidence;
  }

  // WHO recorded it comes from the authorized principal, never the body, and
  // only for a human origin — a provider record is not attributable to a person.
  const recordedByUserId = originKind === 'human' ? str(guard.principal.userId) : null;

  try {
    const result = await recordProspectProblemObservation({
      organizationId: companyId,
      prospectId,
      subjectType,
      statement,
      statementLanguage: str(body.statementLanguage),
      origin: { store: originStore, recordId: originRecordId },
      originKind,
      recordedByUserId,
      sourceRecordId: str(body.sourceRecordId),
      observedAt,
      confidence,
    });
    return answerCapture(res, result);
  } catch {
    return res.status(503).json(envelope({
      error: 'problem_observations_unavailable', retryable: true,
    }));
  }
}

/**
 * The SOURCED capture: `source: { messageId }`, and nothing else about the
 * statement.
 *
 * The caller names a stored message; the seam reads it, verifies that the
 * PROSPECT authored it, and derives the statement, the origin and the
 * observation time from the row. Nothing about the words comes from the request,
 * which is the whole point — a body-supplied statement with a server-supplied
 * provenance would be an unverified claim wearing verified clothes.
 *
 * No recording user is passed. The derived observation's origin is the stored
 * message, which is not an operator's attestation, and the seam decides the
 * origin kind for exactly that reason.
 */
async function handleSourcedCapture(
  res: NextApiResponse,
  body: Record<string, unknown>,
  companyId: string,
  prospectId: string,
  subjectType: ProblemObservationSubjectType,
) {
  // Every derived field is named at once, so a caller fixes one request rather
  // than one field per round trip — the same courtesy `server_owned_field` pays.
  const derived = SOURCE_DERIVED_FIELDS.filter((f) => body[f] !== undefined);
  if (derived.length > 0) {
    return res.status(400).json(envelope({
      error: 'source_derived_field',
      fields: derived,
      detail: 'when `source` is supplied the server derives the statement and its provenance from the '
        + 'stored message — these fields would be overwritten, so they are refused rather than ignored',
    }));
  }

  const source = isRecord(body.source) ? body.source : null;
  const messageId = source === null ? null : str(source.messageId);
  if (!messageId) {
    return res.status(400).json(envelope({
      error: 'source.messageId is required — a sourced capture must name the stored message to derive from',
    }));
  }
  if (!UUID.test(messageId)) {
    return res.status(400).json(envelope({ error: 'source.messageId must be a uuid' }));
  }

  try {
    // Called directly. An earlier revision bound this through a port with a
    // per-request lookup, because the seam function was being written by
    // another workstream and a type-level import of a not-yet-exported symbol
    // would have made this route uncompilable until that change merged. It has
    // merged, so the indirection and the "seam missing in this build" branch it
    // guarded are both gone: that branch described a condition no build can
    // reach, and a 503 arriving from the catch below would have kept the test
    // name true while the assertion had stopped meaning anything.
    const result = await recordProspectProblemFromMessage({
      organizationId: companyId,          // the VERIFIED tenant, never a body field
      prospectId,
      messageId,
      subjectType,
    });
    return answerCapture(res, result);
  } catch {
    return res.status(503).json(envelope({
      error: 'problem_observations_unavailable', retryable: true,
    }));
  }
}

/**
 * ONE status mapping for BOTH request shapes.
 *
 * Shared deliberately: two copies would be two places for a refusal to be
 * mapped differently, and the one mapping that must never drift is
 * `source_message_not_found` collapsing into `prospect_not_found`.
 */
function answerCapture(res: NextApiResponse, result: RecordProblemObservationResult) {
  if (result.ok === true) {
    // 201 for a row that was recorded, 200 for a replay of one that already
    // was. `duplicate` is carried on both, so a caller never has to infer it
    // from the status alone.
    return res.status(result.duplicate ? 200 : 201).json(envelope({
      observationId: result.observationId,
      duplicate: result.duplicate,
    }));
  }

  switch (result.refusal) {
    case 'store_unavailable':
      return res.status(503).json(envelope({
        error: 'problem_observations_unavailable', retryable: true,
      }));
    case 'subject_not_found':
    case 'subject_other_tenant':
      // Indistinguishable, deliberately. The seam logged which one it was.
      return res.status(404).json(envelope({ error: 'prospect_not_found' }));
    case 'source_message_not_found':
      // An EXPLICIT case, not a fall-through to the 400 default. A message that
      // is absent, or that belongs to another tenant, must be answered exactly
      // as a missing prospect is — otherwise a caller could probe message ids
      // and read existence out of the status, which is the cross-tenant oracle
      // this surface already documents closing for prospects. The seam keeps
      // the distinction in its logs.
      return res.status(404).json(envelope({ error: 'prospect_not_found' }));
    case 'inadmissible_evidence':
      // The gate's rejections, passed straight through: every unmet
      // requirement, in the gate's own words, so a writer fixes one record
      // rather than one field at a time.
      return res.status(400).json(envelope({
        error: 'inadmissible_evidence',
        detail: result.detail,
        rejections: result.rejections,
      }));
    default:
      // `self_attributed_origin`, `origin_actor_incoherent`, and the four
      // source refusals that describe a row which cannot become evidence
      // (`source_not_prospect_authored`, `source_subject_mismatch`,
      // `source_statement_absent`, `source_observation_time_absent`): the
      // request is wrong in a way the caller can act on, and is named as what
      // it is. `/eligible-messages` exists so the last four need never happen.
      return res.status(400).json(envelope({
        error: result.refusal,
        detail: result.detail,
        rejections: result.rejections,
      }));
  }
}

export default __createApiRoute(handler, { route: '/api/prospects/[id]/problems' });
