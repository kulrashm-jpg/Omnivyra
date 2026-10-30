/**
 * PI WS-3D — /api/prospects/:id/problems, INVOKED.
 *
 * A source-shape check cannot see what a handler DOES with a request, and the
 * properties that matter on this surface are all behavioural: that a method it
 * does not serve executes nothing, that a malformed tenant is refused BEFORE a
 * guard is consulted, that a guard which wrote its own 401/403 is not answered
 * over, that the capability is bound to the VERIFIED tenant rather than to
 * anything in the body, and that a prospect in another tenant is answered
 * EXACTLY as an absent one. So this suite calls the handler.
 *
 * Nothing here reaches a database: the route factory passes through, both guards
 * are `jest.fn`, and the capture seam is doubled — the tests assert on what the
 * route passed it and on what it answered.
 *
 * `TenantGuard` and `requireCapability` internals are NOT re-tested here; this
 * suite asserts only that the route consults them in the right order, with the
 * right arguments, and stops when they say stop.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

// The wrapper passes through, so the default export IS the handler — the pattern
// `phase4DiscoveryRoute.test.ts` already uses for this repository's routes.
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const requireTenantAccess = jest.fn();
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccess(...a),
}));

const requireCapability = jest.fn();
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));

const recordProspectProblemObservation = jest.fn();
const readProspectProblemObservations = jest.fn();
const recordProspectProblemFromMessage = jest.fn();

/**
 * Whether THIS BUILD's ingestion seam exports a message-sourced entry point.
 *
 * It is a getter on the mocked module rather than a fixed export, because the
 * route now imports the seam function directly. It had been bound through a
 * per-request port lookup only so the route could ship before the seam gained
 * that function, and the seam has it. The flag that simulated the "not on
 * disk yet" build went with it: that build cannot occur, and the 503 it
 * asserted would now arrive from the generic catch instead — which would have
 * kept the test name true after the assertion stopped meaning anything.
 * Genuine 503 coverage is the unreadable-store and thrown-seam cases below.
 */
jest.mock('../../services/prospectProblems/problemObservationIngestion', () => ({
  recordProspectProblemObservation: (...a: unknown[]) => recordProspectProblemObservation(...a),
  readProspectProblemObservations: (...a: unknown[]) => readProspectProblemObservations(...a),
  recordProspectProblemFromMessage: (...a: unknown[]) => recordProspectProblemFromMessage(...a),
}));

import fs from 'fs';
import path from 'path';
import handler from '../../../pages/api/prospects/[id]/problems';
import { PROSPECT_API_VERSION } from '../../apiHandlers/prospects/prospectIntelligenceRead';
import { PROBLEM_OBSERVATION_CONTRACT_VERSION } from '../../services/prospectProblems/types';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ORG_A = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const ORG_B = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const PROSPECT = 'bb2cf3d9-9d2e-4d8a-9a3e-0cf3b5d8e111';
const USER_A = 'f2f0b1c4-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const OBSERVED_AT = '2026-09-14T08:15:00.000Z';

function makeRes() {
  const res: Record<string, unknown> = { _status: 0, _json: null, _headers: {} };
  res.status = (c: number) => { res._status = c; return res; };
  res.json = (b: unknown) => { res._json = b; return res; };
  res.setHeader = (k: string, v: unknown) => { (res._headers as Record<string, unknown>)[k] = v; };
  res.end = () => res;
  return res as never;
}

const BODY = {
  subjectType: 'person',
  statement: 'our three dashboards disagree and nobody can say which one to take to the board',
  statementLanguage: 'en',
  origin: { store: 'crm_call_notes', recordId: 'call-2026-09-14' },
  originKind: 'provider',
  sourceRecordId: 'c0e1b2a3-4d5e-4f60-8a71-9b8c7d6e5f40',
  observedAt: OBSERVED_AT,
  confidence: 0.7,
};

const call = async (over: Record<string, unknown> = {}) => {
  const req = {
    method: 'POST',
    query: { companyId: ORG_A, id: PROSPECT },
    body: { ...BODY },
    url: '/api/prospects/[id]/problems',
    ...over,
  } as unknown as NextApiRequest;
  const res = makeRes();
  await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);
  return res as unknown as { _status: number; _json: Record<string, unknown>; _headers: Record<string, unknown> };
};

const get = (over: Record<string, unknown> = {}) =>
  call({ method: 'GET', body: undefined, ...over });

/** The SOURCED shape: a message id, and nothing else about the statement. */
const MESSAGE = '7a3f2d10-91bc-4e55-8f21-0cb3e5d7a902';
const SOURCE_BODY = { subjectType: 'person', source: { messageId: MESSAGE } };

const sourced = (over: Record<string, unknown> = {}) =>
  call({ body: { ...SOURCE_BODY, ...(over as Record<string, unknown>) } });

beforeEach(() => {
  jest.clearAllMocks();
  requireTenantAccess.mockResolvedValue({ organizationId: ORG_A, userId: USER_A });
  requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER_A } });
  recordProspectProblemObservation.mockResolvedValue({ ok: true, observationId: 'obs-1', duplicate: false });
  recordProspectProblemFromMessage.mockResolvedValue({ ok: true, observationId: 'obs-9', duplicate: false });
  readProspectProblemObservations.mockResolvedValue({
    ok: true, subjectType: 'person', subjectId: 'person-a',
    read: { state: 'available', detail: null, observations: [] },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · AUTHORIZATION
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D route · only GET and POST exist, and nothing else executes', () => {
  it.each(['PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('%s is 405 and executes NOTHING', async (method) => {
    const res = await call({ method });

    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('GET, POST');
    expect(res._json).toMatchObject({ error: 'method_not_allowed' });
    // Not even a membership lookup: a method this surface does not serve must
    // not reach a guard, a seam or a relation.
    expect(requireTenantAccess).not.toHaveBeenCalled();
    expect(requireCapability).not.toHaveBeenCalled();
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
    expect(readProspectProblemObservations).not.toHaveBeenCalled();
  });
});

describe('WS-3D route · the tenant is named and verified before anything happens', () => {
  it('a missing tenant is 400 BEFORE any guard runs', async () => {
    const res = await call({ query: { id: PROSPECT } });

    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/companyId is required/);
    expect(requireTenantAccess).not.toHaveBeenCalled();
    expect(requireCapability).not.toHaveBeenCalled();
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it('a malformed tenant is 400 BEFORE any guard runs — not a 403 from a 22P02', async () => {
    for (const companyId of ['not-a-uuid', '12345', `${ORG_A}x`]) {
      jest.clearAllMocks();
      const res = await call({ query: { companyId, id: PROSPECT } });
      expect(res._status).toBe(400);
      expect(res._json.error).toMatch(/companyId must be a uuid/);
      expect(requireTenantAccess).not.toHaveBeenCalled();
      expect(requireCapability).not.toHaveBeenCalled();
    }
  });

  it('accepts the snake_case spelling of the tenant parameter', async () => {
    const res = await call({ query: { company_id: ORG_A, id: PROSPECT } });
    expect(res._status).toBe(201);
    expect(requireTenantAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), ORG_A);
  });

  it('a membership guard that returns null leaves the response UNTOUCHED', async () => {
    // `requireTenantAccess` writes its own 401/403 and audits the decision.
    // Answering over it would replace an audited refusal with an invented one.
    requireTenantAccess.mockResolvedValue(null);

    const res = await call();

    expect(res._status).toBe(0);
    expect(res._json).toBeNull();
    expect(requireCapability).not.toHaveBeenCalled();
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it('a capability guard that already answered is never reached past', async () => {
    requireCapability.mockResolvedValue({ ok: false, sent: true });

    const res = await call();

    expect(res._status).toBe(0);
    expect(res._json).toBeNull();
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it('gates the write on PROSPECT_INGEST, bound to the VERIFIED tenant', async () => {
    await call();

    expect(requireCapability).toHaveBeenCalledTimes(1);
    const options = requireCapability.mock.calls[0][2] as Record<string, unknown>;
    expect(options.capability).toBe(PROSPECT_INGEST);
    expect(options.organizationId).toBe(ORG_A);
    expect(options.resourceId).toBe(PROSPECT);
    expect(typeof options.reason).toBe('string');
    // No provider credit is spent, no network call is made and no credential is
    // resolved, so the enrichment capability is deliberately NOT required.
    expect(JSON.stringify(options)).not.toMatch(/ENRICH/);
  });

  it('the capability is consulted AFTER membership, never before', async () => {
    const order: string[] = [];
    requireTenantAccess.mockImplementation(async () => { order.push('membership'); return { organizationId: ORG_A }; });
    requireCapability.mockImplementation(async () => { order.push('capability'); return { ok: true, principal: { userId: USER_A } }; });

    await call();

    expect(order).toEqual(['membership', 'capability']);
  });

  it('the READ is gated on membership alone, exactly as the sibling prospect detail read is', async () => {
    const res = await get();

    expect(res._status).toBe(200);
    expect(requireTenantAccess).toHaveBeenCalledTimes(1);
    expect(requireCapability).not.toHaveBeenCalled();
  });

  it('A BODY CANNOT STEER THE TENANT — the key is refused, not ignored', async () => {
    for (const key of ['organizationId', 'organization_id', 'companyId', 'company_id']) {
      jest.clearAllMocks();
      const res = await call({ body: { ...BODY, [key]: ORG_B } });

      expect(res._status).toBe(400);
      expect(res._json.error).toContain(key);
      expect(res._json.error).toMatch(/the tenant comes from the verified companyId/);
      // Ignoring it would be safe but silent: a caller who believes they wrote
      // into another tenant must be told they did not.
      expect(recordProspectProblemObservation).not.toHaveBeenCalled();
    }
  });

  it('a null-valued tenant override key is still refused — presence is the test', async () => {
    const res = await call({ body: { ...BODY, companyId: null } });
    expect(res._status).toBe(400);
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it('passes the VERIFIED tenant to the seam, and the path prospect id with it', async () => {
    await call();

    expect(recordProspectProblemObservation).toHaveBeenCalledTimes(1);
    expect(recordProspectProblemObservation.mock.calls[0][0]).toMatchObject({
      organizationId: ORG_A, prospectId: PROSPECT,
    });
  });

  it('refuses a missing or malformed prospect id after the tenant is verified', async () => {
    for (const id of [undefined, '', 'not-a-uuid']) {
      jest.clearAllMocks();
      const res = await call({ query: { companyId: ORG_A, id } });
      expect(res._status).toBe(400);
      expect(String(res._json.error)).toMatch(/prospect id/);
      expect(requireCapability).not.toHaveBeenCalled();
      expect(recordProspectProblemObservation).not.toHaveBeenCalled();
    }
  });

  it('takes the first value of a repeated path id rather than an array', async () => {
    await call({ query: { companyId: ORG_A, id: [PROSPECT, 'other'] } });
    expect(recordProspectProblemObservation.mock.calls[0][0]).toMatchObject({ prospectId: PROSPECT });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROVENANCE IS SERVER-OWNED
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D route · the server owns provenance, and says so', () => {
  it.each([
    'recordedAt', 'recorded_at',
    'recordedByUserId', 'recorded_by_user_id',
    'derivedFrom', 'derived_from',
    'id', 'statementHash', 'statement_hash',
  ])('refuses a body supplying %s, naming the field', async (field) => {
    const res = await call({ body: { ...BODY, [field]: 'x' } });

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: 'server_owned_field', fields: [field] });
    // A caller who sets one and receives a 200 would reasonably believe it was
    // honoured; this is why it is an error rather than an ignored field.
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it('names EVERY server-owned field supplied, not the first', async () => {
    const res = await call({ body: { ...BODY, recordedAt: 'x', derivedFrom: 'revenue', id: 'x' } });

    expect(res._status).toBe(400);
    expect(res._json.fields).toEqual(['recordedAt', 'derivedFrom', 'id']);
  });

  it('takes the recording user from the AUTHORIZED PRINCIPAL, only for a human origin', async () => {
    await call({ body: { ...BODY, originKind: 'human' } });
    expect(recordProspectProblemObservation.mock.calls[0][0]).toMatchObject({
      originKind: 'human', recordedByUserId: USER_A,
    });

    jest.clearAllMocks();
    requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER_A } });
    recordProspectProblemObservation.mockResolvedValue({ ok: true, observationId: 'obs-1', duplicate: false });
    await call();
    expect(recordProspectProblemObservation.mock.calls[0][0]).toMatchObject({
      originKind: 'provider', recordedByUserId: null,
    });
  });

  it('never forwards a derivedFrom to the seam, whatever the body said', async () => {
    await call();
    expect(Object.keys(recordProspectProblemObservation.mock.calls[0][0] as object))
      .not.toContain('derivedFrom');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SHAPE: NOTHING IS COERCED AND NO ABSENCE IS SUBSTITUTED
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D route · every field is refused explicitly, never coerced', () => {
  it.each([
    ['a non-object body', 'not json at all'],
    ['an array body', [1, 2, 3]],
    ['a null body', null],
  ])('refuses %s', async (_label, body) => {
    const res = await call({ body });
    expect(res._status).toBe(400);
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it('parses a JSON string body, as a raw-body transport delivers one', async () => {
    const res = await call({ body: JSON.stringify(BODY) });
    expect(res._status).toBe(201);
  });

  it.each([
    ['subjectType', { subjectType: 'company' }],
    ['subjectType', { subjectType: undefined }],
    ['statement', { statement: '   ' }],
    ['origin', { origin: undefined }],
    ['origin', { origin: { store: 'crm_call_notes' } }],
    ['origin', { origin: { recordId: 'r' } }],
    ['originKind', { originKind: 'operator' }],
    ['observedAt', { observedAt: undefined }],
    ['observedAt', { observedAt: 'last tuesday' }],
    ['confidence', { confidence: 4 }],
    ['confidence', { confidence: -1 }],
    ['confidence', { confidence: 'high' }],
    ['confidence', { confidence: Number.NaN }],
  ])('refuses a bad %s with 400 and reaches no seam', async (_field, over) => {
    const res = await call({ body: { ...BODY, ...(over as Record<string, unknown>) } });
    expect(res._status).toBe(400);
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it('an unparseable observedAt is a 400, NEVER the current time', async () => {
    const res = await call({ body: { ...BODY, observedAt: 'soon' } });
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/not a parseable timestamp/);
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it('an absent confidence stays null and is never defaulted', async () => {
    for (const body of [{ ...BODY, confidence: undefined }, { ...BODY, confidence: null }]) {
      jest.clearAllMocks();
      recordProspectProblemObservation.mockResolvedValue({ ok: true, observationId: 'o', duplicate: false });
      await call({ body });
      expect(recordProspectProblemObservation.mock.calls[0][0]).toMatchObject({ confidence: null });
    }
  });

  it('forwards the statement and the source instant verbatim', async () => {
    await call();
    expect(recordProspectProblemObservation.mock.calls[0][0]).toMatchObject({
      statement: BODY.statement,
      observedAt: OBSERVED_AT,
      origin: { store: 'crm_call_notes', recordId: 'call-2026-09-14' },
      statementLanguage: 'en',
      sourceRecordId: BODY.sourceRecordId,
    });
  });

  it('refuses a bad subjectType or limit on the READ', async () => {
    for (const query of [
      { companyId: ORG_A, id: PROSPECT, subjectType: 'company' },
      { companyId: ORG_A, id: PROSPECT, limit: '0' },
      { companyId: ORG_A, id: PROSPECT, limit: '-5' },
      { companyId: ORG_A, id: PROSPECT, limit: 'many' },
    ]) {
      jest.clearAllMocks();
      const res = await get({ query });
      expect(res._status).toBe(400);
      expect(readProspectProblemObservations).not.toHaveBeenCalled();
    }
  });

  it('defaults the read subject to the person and forwards an explicit account', async () => {
    await get();
    expect(readProspectProblemObservations.mock.calls[0][0]).toMatchObject({
      organizationId: ORG_A, prospectId: PROSPECT, subjectType: 'person', limit: undefined,
    });

    jest.clearAllMocks();
    readProspectProblemObservations.mockResolvedValue({
      ok: true, subjectType: 'account', subjectId: 'account-a',
      read: { state: 'available', detail: null, observations: [] },
    });
    await get({ query: { companyId: ORG_A, id: PROSPECT, subjectType: 'account', limit: '25' } });
    expect(readProspectProblemObservations.mock.calls[0][0]).toMatchObject({
      subjectType: 'account', limit: 25,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WHAT THE CLIENT IS AND IS NOT TOLD
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D route · the answers, and the ones it refuses to distinguish', () => {
  it('201 for a row recorded, 200 for a replay, and `duplicate` carried on both', async () => {
    const created = await call();
    expect(created._status).toBe(201);
    expect(created._json).toMatchObject({ observationId: 'obs-1', duplicate: false });

    recordProspectProblemObservation.mockResolvedValue({ ok: true, observationId: 'obs-1', duplicate: true });
    const replayed = await call();
    expect(replayed._status).toBe(200);
    // A caller never has to infer it from the status alone.
    expect(replayed._json).toMatchObject({ observationId: 'obs-1', duplicate: true });
  });

  it('a prospect in ANOTHER TENANT is answered BYTE-IDENTICALLY to an absent one', async () => {
    recordProspectProblemObservation.mockResolvedValue({
      ok: false, refusal: 'subject_not_found', detail: 'no such prospect in this tenant', rejections: [],
    });
    const absent = await call();

    recordProspectProblemObservation.mockResolvedValue({
      ok: false, refusal: 'subject_other_tenant', detail: 'the prospect belongs to another tenant', rejections: [],
    });
    const foreign = await call();

    expect(absent._status).toBe(404);
    expect(foreign._status).toBe(404);
    expect(absent._json).toEqual({
      version: PROSPECT_API_VERSION,
      contract: PROBLEM_OBSERVATION_CONTRACT_VERSION,
      error: 'prospect_not_found',
    });
    // Surfacing the difference would make this route a cross-tenant existence
    // oracle. The seam keeps it, in logs only.
    expect(JSON.stringify(foreign._json)).toBe(JSON.stringify(absent._json));
    expect(JSON.stringify(foreign._json)).not.toMatch(/tenant/);
  });

  it('answers both subject refusals identically on the READ as well', async () => {
    readProspectProblemObservations.mockResolvedValue({
      ok: false, refusal: 'subject_not_found', detail: 'x',
    });
    const absent = await get();

    readProspectProblemObservations.mockResolvedValue({
      ok: false, refusal: 'subject_other_tenant', detail: 'x',
    });
    const foreign = await get();

    expect(absent._status).toBe(404);
    expect(foreign._status).toBe(404);
    expect(JSON.stringify(foreign._json)).toBe(JSON.stringify(absent._json));
  });

  it('an unreadable relation is 503 and retryable — NEVER an empty 200', async () => {
    recordProspectProblemObservation.mockResolvedValue({
      ok: false, refusal: 'store_unavailable', detail: 'relation does not exist', rejections: [],
    });
    const write = await call();
    expect(write._status).toBe(503);
    expect(write._json).toMatchObject({ error: 'problem_observations_unavailable', retryable: true });

    readProspectProblemObservations.mockResolvedValue({
      ok: false, refusal: 'store_unavailable', detail: 'relation does not exist',
    });
    const refusedRead = await get();
    expect(refusedRead._status).toBe(503);

    // `state: 'unavailable'` is NOT an empty list, and is never reported as 200.
    readProspectProblemObservations.mockResolvedValue({
      ok: true, subjectType: 'person', subjectId: 'person-a',
      read: { state: 'unavailable', detail: 'cache is stale', observations: [] },
    });
    const unavailable = await get();
    expect(unavailable._status).toBe(503);
    expect(unavailable._json).toMatchObject({ error: 'problem_observations_unavailable', retryable: true });
    expect(unavailable._json.observations).toBeUndefined();
  });

  it('zero observations is a 200 with an empty list and the state named', async () => {
    const res = await get();
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({
      subjectType: 'person', subjectId: 'person-a', state: 'available', observations: [],
    });
  });

  it('passes the gate\'s rejections straight through on an inadmissible record', async () => {
    const rejections = [
      { field: 'observedAt', reason: 'our ingest time is not an observation time' },
      { field: 'statement', reason: 'an empty statement is an absence' },
    ];
    recordProspectProblemObservation.mockResolvedValue({
      ok: false, refusal: 'inadmissible_evidence', detail: 'the statement did not satisfy the contract', rejections,
    });

    const res = await call();

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: 'inadmissible_evidence', rejections });
    // Unmodified: a writer fixes one record rather than one field at a time.
    expect(res._json.rejections).toEqual(rejections);
  });

  it.each(['self_attributed_origin', 'origin_actor_incoherent'])(
    'names %s as what it is, with a 400 the caller can act on', async (refusal) => {
      recordProspectProblemObservation.mockResolvedValue({
        ok: false, refusal, detail: 'because', rejections: [{ field: 'f', reason: 'r' }],
      });

      const res = await call();

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({ error: refusal, detail: 'because' });
    },
  );

  it('a thrown seam is 503, and leaks nothing from the failure', async () => {
    recordProspectProblemObservation.mockRejectedValue(new Error('relation "x" does not exist: companyId=secret'));
    const write = await call();
    expect(write._status).toBe(503);
    expect(JSON.stringify(write._json)).not.toMatch(/secret/);

    readProspectProblemObservations.mockRejectedValue(new Error('boom: companyId=secret'));
    const read = await get();
    expect(read._status).toBe(503);
    expect(JSON.stringify(read._json)).not.toMatch(/secret/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE ENVELOPE, AND WHAT WAS NOT MOVED
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D route · every body leads with the version, then the contract', () => {
  it('stamps both on every answer, success and refusal alike', async () => {
    const answers = [
      await call({ method: 'PUT' }),
      await call({ query: { id: PROSPECT } }),
      await call(),
      await get(),
    ];
    for (const res of answers) {
      expect(Object.keys(res._json).slice(0, 2)).toEqual(['version', 'contract']);
      expect(res._json.version).toBe(PROSPECT_API_VERSION);
      expect(res._json.contract).toBe(PROBLEM_OBSERVATION_CONTRACT_VERSION);
    }
  });

  it('did NOT bump the prospect API version — a new subresource is not a new API', async () => {
    expect(PROSPECT_API_VERSION).toBe('ws10.1');
    expect(PROBLEM_OBSERVATION_CONTRACT_VERSION).toBe('pi-problem-obs.1');
  });

  it('is not wrapped in withIdempotency and requires no Idempotency-Key', async () => {
    // The relation's unique constraint is the guarantee; an application-level
    // check in front of it would be a race, not a guarantee.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'pages/api/prospects/[id]/problems.ts'), 'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/withIdempotency/);
    // And a request without the header is served, rather than refused for it.
    const res = await call({ headers: {} });
    expect(res._status).toBe(201);
  });

  it('exposes nothing that implies a score, a weight or a fit verdict', async () => {
    readProspectProblemObservations.mockResolvedValue({
      ok: true, subjectType: 'person', subjectId: 'person-a',
      read: {
        state: 'available',
        detail: null,
        observations: [{
          id: 'o1', organizationId: ORG_A, subjectType: 'person', subjectId: 'person-a',
          statement: BODY.statement, statementLanguage: 'en', originStore: 'crm_call_notes',
          originRecordId: 'call-2026-09-14', originKind: 'provider', recordedByUserId: null,
          sourceRecordId: null, confidence: 0.7, observedAt: OBSERVED_AT,
          recordedAt: '2026-10-28T11:30:00.000Z',
        }],
      },
    });

    const res = await get();

    expect(res._status).toBe(200);
    const serialized = JSON.stringify(res._json);
    for (const key of ['score', 'scorable', 'fit', 'problemFit', 'weight', 'priority', 'dimension']) {
      expect(serialized).not.toMatch(new RegExp(`"${key}"`, 'i'));
    }
    // The two clocks stay two, all the way out to the client.
    const obs = (res._json.observations as Array<Record<string, unknown>>)[0];
    expect(obs.observedAt).toBe(OBSERVED_AT);
    expect(obs.recordedAt).not.toBe(obs.observedAt);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE SECOND REQUEST SHAPE — `source: { messageId }`
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D route · the two POST shapes are MUTUALLY EXCLUSIVE', () => {
  it('routes a sourced capture to the message seam, and nowhere else', async () => {
    const res = await sourced();

    expect(res._status).toBe(201);
    expect(res._json).toMatchObject({ observationId: 'obs-9', duplicate: false });
    expect(recordProspectProblemFromMessage).toHaveBeenCalledTimes(1);
    // The TRANSCRIBED entry point is not also called: one request, one path.
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it('hands the seam the VERIFIED tenant and EXACTLY the four fields it takes', async () => {
    await sourced();

    const arg = recordProspectProblemFromMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toEqual({
      organizationId: ORG_A, prospectId: PROSPECT, messageId: MESSAGE, subjectType: 'person',
    });
    // Nothing about the statement travels from the request: no statement, no
    // origin, no observation time, and no recording user — the derived
    // observation's origin is the stored message, not an operator's attestation.
    expect(Object.keys(arg).sort()).toEqual(['messageId', 'organizationId', 'prospectId', 'subjectType']);
  });

  it('the TRANSCRIBED shape still reaches the original seam, unchanged', async () => {
    const res = await call();

    expect(res._status).toBe(201);
    expect(recordProspectProblemObservation).toHaveBeenCalledTimes(1);
    expect(recordProspectProblemFromMessage).not.toHaveBeenCalled();
  });

  it.each([
    'statement', 'observedAt', 'origin', 'originKind',
    'sourceRecordId', 'statementLanguage', 'confidence',
  ])('refuses a sourced body that also supplies %s, naming the field', async (field) => {
    const value = field === 'confidence' ? 0.5
      : field === 'origin' ? { store: 'crm_call_notes', recordId: 'r' }
        : 'x';
    const res = await sourced({ [field]: value });

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: 'source_derived_field', fields: [field] });
    // A 201 here would tell the caller their words were stored when what was
    // stored is the message's own text.
    expect(recordProspectProblemFromMessage).not.toHaveBeenCalled();
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it('names EVERY derived field supplied, not the first', async () => {
    const res = await sourced({
      statement: 'my own words', observedAt: OBSERVED_AT, confidence: 0.9,
    });

    expect(res._status).toBe(400);
    expect(res._json.fields).toEqual(['statement', 'observedAt', 'confidence']);
    expect(String(res._json.detail)).toMatch(/refused rather than ignored/);
  });

  it('the shape is chosen by the PRESENCE of `source`, not by its contents', async () => {
    for (const source of [null, 'msg-1', {}, { messageId: '   ' }, { messageId: 123 }]) {
      jest.clearAllMocks();
      requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER_A } });
      const res = await call({ body: { subjectType: 'person', source } });

      // A malformed `source` is a malformed SOURCED request — never a
      // TRANSCRIBED one that happens to carry a stray key.
      expect(res._status).toBe(400);
      expect(String(res._json.error)).toMatch(/source\.messageId/);
      expect(recordProspectProblemObservation).not.toHaveBeenCalled();
      expect(recordProspectProblemFromMessage).not.toHaveBeenCalled();
    }
  });

  it('refuses a messageId that is not a uuid', async () => {
    const res = await sourced({ source: { messageId: 'not-a-uuid' } });
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/source\.messageId must be a uuid/);
    expect(recordProspectProblemFromMessage).not.toHaveBeenCalled();
  });

  it('still requires a valid subjectType, and PROSPECT_INGEST bound to the verified tenant', async () => {
    const bad = await sourced({ subjectType: 'company' });
    expect(bad._status).toBe(400);
    expect(recordProspectProblemFromMessage).not.toHaveBeenCalled();

    jest.clearAllMocks();
    requireTenantAccess.mockResolvedValue({ organizationId: ORG_A, userId: USER_A });
    requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER_A } });
    recordProspectProblemFromMessage.mockResolvedValue({ ok: true, observationId: 'obs-9', duplicate: false });
    await sourced();
    const options = requireCapability.mock.calls[0][2] as Record<string, unknown>;
    expect(options.capability).toBe(PROSPECT_INGEST);
    expect(options.organizationId).toBe(ORG_A);
  });

  it('a capability guard that already answered is never reached past', async () => {
    requireCapability.mockResolvedValue({ ok: false, sent: true });
    const res = await sourced();
    expect(res._status).toBe(0);
    expect(recordProspectProblemFromMessage).not.toHaveBeenCalled();
  });

  it('a tenant override key in a sourced body is refused, not ignored', async () => {
    const res = await sourced({ companyId: ORG_B });
    expect(res._status).toBe(400);
    expect(String(res._json.error)).toContain('companyId');
    expect(recordProspectProblemFromMessage).not.toHaveBeenCalled();
  });

  it('201 for a new row, 200 with duplicate:true for a replay — both carry `duplicate`', async () => {
    const created = await sourced();
    expect(created._status).toBe(201);
    expect(created._json).toMatchObject({ observationId: 'obs-9', duplicate: false });

    recordProspectProblemFromMessage.mockResolvedValue({ ok: true, observationId: 'obs-9', duplicate: true });
    const replayed = await sourced();
    expect(replayed._status).toBe(200);
    expect(replayed._json).toMatchObject({ observationId: 'obs-9', duplicate: true });
  });

  it('every sourced answer leads with the version, then the contract', async () => {
    const answers = [
      await sourced(),
      await sourced({ statement: 'x' }),
      await sourced({ source: { messageId: 'nope' } }),
    ];
    for (const res of answers) {
      expect(Object.keys(res._json).slice(0, 2)).toEqual(['version', 'contract']);
      expect(res._json.version).toBe(PROSPECT_API_VERSION);
      expect(res._json.contract).toBe(PROBLEM_OBSERVATION_CONTRACT_VERSION);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// `subjectId` WAS ACCEPTED AND IGNORED — ON BOTH SHAPES
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D route · the canonical subject is never the caller\'s to name', () => {
  it.each(['subjectId', 'subject_id'])('refuses a body supplying %s on the TRANSCRIBED shape', async (field) => {
    const res = await call({ body: { ...BODY, [field]: 'person-b' } });

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: 'server_owned_field', fields: [field] });
    // Before this it was a 201 with the value silently dropped, and a caller
    // could not tell the subject they named had gone nowhere.
    expect(recordProspectProblemObservation).not.toHaveBeenCalled();
  });

  it.each(['subjectId', 'subject_id'])('refuses a body supplying %s on the SOURCED shape too', async (field) => {
    const res = await sourced({ [field]: 'person-b' });

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: 'server_owned_field', fields: [field] });
    expect(recordProspectProblemFromMessage).not.toHaveBeenCalled();
  });

  it('never forwards a subjectId to either seam', async () => {
    await call();
    expect(Object.keys(recordProspectProblemObservation.mock.calls[0][0] as object))
      .not.toContain('subjectId');

    jest.clearAllMocks();
    requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER_A } });
    recordProspectProblemFromMessage.mockResolvedValue({ ok: true, observationId: 'obs-9', duplicate: false });
    await sourced();
    expect(Object.keys(recordProspectProblemFromMessage.mock.calls[0][0] as object))
      .not.toContain('subjectId');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE FIVE NEW REFUSALS
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3D route · the source refusals, and the one it refuses to distinguish', () => {
  it('source_message_not_found is answered BYTE-IDENTICALLY to a missing prospect', async () => {
    recordProspectProblemFromMessage.mockResolvedValue({
      ok: false, refusal: 'source_message_not_found',
      detail: 'no such message under this tenant', rejections: [],
    });
    const badMessage = await sourced();

    recordProspectProblemObservation.mockResolvedValue({
      ok: false, refusal: 'subject_not_found', detail: 'no such prospect in this tenant', rejections: [],
    });
    const missingProspect = await call();

    expect(badMessage._status).toBe(404);
    expect(missingProspect._status).toBe(404);
    expect(badMessage._json).toEqual({
      version: PROSPECT_API_VERSION,
      contract: PROBLEM_OBSERVATION_CONTRACT_VERSION,
      error: 'prospect_not_found',
    });
    // Otherwise a caller could probe message ids and read existence out of the
    // status — the cross-tenant oracle this surface documents closing.
    expect(JSON.stringify(badMessage._json)).toBe(JSON.stringify(missingProspect._json));
    expect(JSON.stringify(badMessage._json)).not.toMatch(/message|tenant/i);
  });

  it('the subject refusals stay 404 on the sourced shape as well', async () => {
    for (const refusal of ['subject_not_found', 'subject_other_tenant']) {
      jest.clearAllMocks();
      requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER_A } });
      recordProspectProblemFromMessage.mockResolvedValue({
        ok: false, refusal, detail: 'x', rejections: [],
      });
      const res = await sourced();
      expect(res._status).toBe(404);
      expect(res._json).toMatchObject({ error: 'prospect_not_found' });
    }
  });

  it.each([
    'source_not_prospect_authored',
    'source_subject_mismatch',
    'source_statement_absent',
    'source_observation_time_absent',
  ])('names %s as what it is, with a 400 the caller can act on', async (refusal) => {
    const rejections = [{ field: 'source', reason: 'the stored row does not establish it' }];
    recordProspectProblemFromMessage.mockResolvedValue({
      ok: false, refusal, detail: 'because the row does not say so', rejections,
    });

    const res = await sourced();

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({
      error: refusal, detail: 'because the row does not say so', rejections,
    });
  });

  it('inadmissible evidence from the sourced path passes its rejections through', async () => {
    const rejections = [{ field: 'statement', reason: 'an empty statement is an absence' }];
    recordProspectProblemFromMessage.mockResolvedValue({
      ok: false, refusal: 'inadmissible_evidence', detail: 'the gate said no', rejections,
    });

    const res = await sourced();

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ error: 'inadmissible_evidence', rejections });
  });

  it('an unreadable store is 503, and a thrown seam leaks nothing', async () => {
    recordProspectProblemFromMessage.mockResolvedValue({
      ok: false, refusal: 'store_unavailable', detail: 'relation does not exist', rejections: [],
    });
    const unavailable = await sourced();
    expect(unavailable._status).toBe(503);
    expect(unavailable._json).toMatchObject({
      error: 'problem_observations_unavailable', retryable: true,
    });

    recordProspectProblemFromMessage.mockRejectedValue(new Error('boom: companyId=secret'));
    const thrown = await sourced();
    expect(thrown._status).toBe(503);
    expect(JSON.stringify(thrown._json)).not.toMatch(/secret/);
  });

  it('is still not wrapped in withIdempotency, and the contract constants did not move', async () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'pages/api/prospects/[id]/problems.ts'), 'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/withIdempotency/);
    expect(PROSPECT_API_VERSION).toBe('ws10.1');
    expect(PROBLEM_OBSERVATION_CONTRACT_VERSION).toBe('pi-problem-obs.1');

    // And the relation's unique index still owns idempotency: no header needed.
    const res = await sourced();
    expect(res._status).toBe(201);
  });
});
