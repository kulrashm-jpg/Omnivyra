/**
 * PI-P1-W09D — the manual outcome entry seam.
 *
 * A transport shell over machinery that is already proven, so these tests are
 * mostly about what it REFUSES and what it REFUSES TO DECIDE.
 *
 * Three properties matter more than the happy path:
 *   • the tenant is named in the body but NEVER trusted — authorization is the
 *     guard's answer, and it runs before anything else is read;
 *   • the fields that make an outcome attributable (`source`, `provider`,
 *     `providerEventId`, `derived`, `recordedByUserId`) are server-owned, and a
 *     request naming one is refused rather than silently corrected;
 *   • the route performs NO task lookup, NO persistence and builds NO envelope —
 *     `ingestFeedback` remains the sole authoritative write path.
 */

const requireTenantAccess = jest.fn();
const ingestFeedback = jest.fn();

jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccess(...a),
}));

jest.mock('../../services/leadOutreachExecution', () => ({
  ingestFeedback: (...a: unknown[]) => ingestFeedback(...a),
}));

jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

import handler, { MANUAL_OUTCOME_SIGNALS } from '../../../pages/api/outreach/outcomes';
import { FEEDBACK_SIGNALS } from '../../services/leadOutreachExecution/feedbackIngestion';
import type { NextApiRequest, NextApiResponse } from 'next';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-00000000u001';
const TASK = '00000000-0000-4000-8000-0000000000t1';
const AT = '2026-09-01T10:00:00.000Z';

type Res = NextApiResponse & { _status: number; _json: Record<string, unknown>; _headers: Record<string, string> };

const makeRes = (): Res => {
  const r: Partial<Res> = { _status: 0, _json: {}, _headers: {} };
  r.status = ((c: number) => { (r as Res)._status = c; return r as Res; }) as Res['status'];
  r.json = ((b: Record<string, unknown>) => { (r as Res)._json = b; return r as Res; }) as Res['json'];
  r.setHeader = ((k: string, v: string) => { (r as Res)._headers[k] = v; return r as Res; }) as unknown as Res['setHeader'];
  return r as Res;
};

const okResult = (over: Record<string, unknown> = {}) => ({
  ok: true,
  duplicate: false,
  axis: 'business',
  recorded: { outcomeType: 'replied' },
  stateAdvanced: true,
  stateRefusal: null,
  rejection: null,
  error: null,
  ...over,
});

const failResult = (rejection: string) => ({
  ok: false,
  duplicate: false,
  axis: null,
  recorded: null,
  stateAdvanced: false,
  stateRefusal: null,
  rejection,
  error: rejection,
});

const call = async (body: Record<string, unknown> = {}, method = 'POST') => {
  const req = {
    method,
    body: { companyId: ORG_A, taskId: TASK, signal: 'replied', occurredAt: AT, ...body },
  } as unknown as NextApiRequest;
  const res = makeRes();
  await handler(req, res);
  return res;
};

beforeEach(() => {
  requireTenantAccess.mockReset();
  ingestFeedback.mockReset();
  // Default: an active member of ORG_A.
  requireTenantAccess.mockResolvedValue({
    userId: USER, supabaseUid: 'sb', organizationId: ORG_A,
    role: 'MEMBER', bypass: false, isPlatformSuperAdmin: false,
  });
  ingestFeedback.mockResolvedValue(okResult());
});

// ════════════════════════════════════════════════════════════════════════════
describe('W09D — method and shape', () => {
  it('accepts POST only', async () => {
    const res = await call({}, 'GET');
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('POST');
    expect(ingestFeedback).not.toHaveBeenCalled();
  });

  it('requires companyId, and refuses BEFORE consulting the guard', async () => {
    const res = await call({ companyId: undefined });
    expect(res._status).toBe(400);
    expect(requireTenantAccess).not.toHaveBeenCalled();
  });

  it('requires taskId and occurredAt', async () => {
    expect((await call({ taskId: '  ' }))._status).toBe(400);
    expect((await call({ occurredAt: undefined }))._status).toBe(400);
    expect(ingestFeedback).not.toHaveBeenCalled();
  });

  it('parses a string body, as the platform routes do', async () => {
    const req = {
      method: 'POST',
      body: JSON.stringify({ companyId: ORG_A, taskId: TASK, signal: 'converted', occurredAt: AT }),
    } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W09D — authentication and tenant authorization', () => {
  it('an unauthenticated caller never reaches ingestion — the guard owns the 401', async () => {
    requireTenantAccess.mockImplementation(async (_req: unknown, res: Res) => {
      res.status(401).json({ error: 'Not authenticated', code: 'NO_PRINCIPAL' });
      return null;
    });

    const res = await call();
    expect(res._status).toBe(401);
    expect(ingestFeedback).not.toHaveBeenCalled();
  });

  it('an authenticated NON-MEMBER never reaches ingestion — the guard owns the 403', async () => {
    requireTenantAccess.mockImplementation(async (_req: unknown, res: Res) => {
      res.status(403).json({ error: 'Access denied', code: 'NOT_A_MEMBER' });
      return null;
    });

    const res = await call();
    expect(res._status).toBe(403);
    expect(ingestFeedback).not.toHaveBeenCalled();
  });

  it('an active member is allowed through', async () => {
    const res = await call();
    expect(res._status).toBe(200);
    expect(ingestFeedback).toHaveBeenCalledTimes(1);
  });

  it('the guard is asked about the EXPLICIT companyId — never an inferred one', async () => {
    await call({ companyId: ORG_A });
    expect(requireTenantAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), ORG_A);
  });

  it('authorization runs BEFORE the server-owned-field check, so a denied caller learns nothing', async () => {
    requireTenantAccess.mockImplementation(async (_req: unknown, res: Res) => {
      res.status(403).json({ error: 'Access denied' });
      return null;
    });

    const res = await call({ source: 'provider_webhook' });
    expect(res._status).toBe(403);
    expect(res._json.error).toBe('Access denied');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W09D — the server owns attribution', () => {
  it.each(['source', 'provider', 'providerEventId', 'derived', 'recordedByUserId'])(
    'refuses a client-supplied %s rather than silently correcting it',
    async (field) => {
      const res = await call({ [field]: 'anything' });
      expect(res._status).toBe(400);
      expect(res._json.error).toBe('server_owned_field');
      expect(res._json.fields).toEqual([field]);
      expect(ingestFeedback).not.toHaveBeenCalled();
    },
  );

  it('reports every offending field at once', async () => {
    const res = await call({ source: 'x', provider: 'y' });
    expect(res._json.fields).toEqual(['source', 'provider']);
  });

  it('pins source to manual, with no provider and no provider event id', async () => {
    await call();
    expect(ingestFeedback).toHaveBeenCalledWith(expect.objectContaining({
      source: 'manual', provider: null, providerEventId: null,
    }));
  });

  it('takes the actor from the AUTHENTICATED principal, not the body', async () => {
    await call();
    expect(ingestFeedback).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { recordedByUserId: USER },
    }));
  });

  it('a different authenticated principal yields a different recorded actor', async () => {
    requireTenantAccess.mockResolvedValue({
      userId: 'someone-else', supabaseUid: 'sb', organizationId: ORG_A,
      role: null, bypass: true, isPlatformSuperAdmin: true,
    });
    await call();
    expect(ingestFeedback).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { recordedByUserId: 'someone-else' },
    }));
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W09D — the pilot signal vocabulary', () => {
  it('is exactly the four a human can honestly observe', () => {
    expect([...MANUAL_OUTCOME_SIGNALS]).toEqual(['replied', 'meeting_booked', 'converted', 'no_response']);
  });

  it('is a SUBSET of the ingestion contract — it invents nothing', () => {
    for (const s of MANUAL_OUTCOME_SIGNALS) {
      expect(FEEDBACK_SIGNALS as readonly string[]).toContain(s);
    }
  });

  it.each([...MANUAL_OUTCOME_SIGNALS])('accepts %s', async (signal) => {
    const res = await call({ signal });
    expect(res._status).toBe(200);
    expect(ingestFeedback).toHaveBeenCalledWith(expect.objectContaining({ signal }));
  });

  it.each(['unsubscribed', 'rejected', 'delivered', 'bounced', 'opened', 'clicked'])(
    'refuses %s — out of pilot scope, and never reaches ingestion',
    async (signal) => {
      const res = await call({ signal });
      expect(res._status).toBe(400);
      expect(res._json.error).toBe('unsupported_signal');
      expect(ingestFeedback).not.toHaveBeenCalled();
    },
  );

  it('refuses an invented value', async () => {
    const res = await call({ signal: 'became_a_customer_probably' });
    expect(res._status).toBe(400);
    expect(ingestFeedback).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W09D — the ingestion contract is passed through, not reinterpreted', () => {
  it('sends the operator-supplied occurredAt verbatim — not now()', async () => {
    await call({ occurredAt: AT });
    expect(ingestFeedback).toHaveBeenCalledWith(expect.objectContaining({ occurredAt: AT }));
  });

  it('does NOT validate the timestamp itself — ingestion owns that rule', async () => {
    ingestFeedback.mockResolvedValue(failResult('invalid_timestamp'));
    const res = await call({ occurredAt: 'yesterday' });
    // It reached ingestion rather than being pre-judged at the edge.
    expect(ingestFeedback).toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._json.rejection).toBe('invalid_timestamp');
  });

  it('carries a note as evidence, and omits evidence entirely when there is none', async () => {
    await call({ note: 'called back, wants a demo' });
    expect(ingestFeedback).toHaveBeenCalledWith(expect.objectContaining({
      evidence: { note: 'called back, wants a demo' },
    }));

    ingestFeedback.mockClear();
    await call();
    expect(ingestFeedback.mock.calls[0][0].evidence).toBeUndefined();
  });

  it('a cross-tenant task surfaces the EXISTING task_not_found, not a new semantic', async () => {
    ingestFeedback.mockResolvedValue(failResult('task_not_found'));
    const res = await call();
    expect(res._status).toBe(404);
    expect(res._json.rejection).toBe('task_not_found');
  });

  it('a write failure is a 500 and keeps the existing rejection code', async () => {
    ingestFeedback.mockResolvedValue(failResult('write_failed'));
    const res = await call();
    expect(res._status).toBe(500);
    expect(res._json.rejection).toBe('write_failed');
  });

  it('an unknown signal reaching ingestion is still reported with its own code', async () => {
    ingestFeedback.mockResolvedValue(failResult('unknown_signal'));
    const res = await call();
    expect(res._status).toBe(400);
    expect(res._json.rejection).toBe('unknown_signal');
  });

  it('returns the FeedbackResult unchanged on success', async () => {
    const result = okResult();
    ingestFeedback.mockResolvedValue(result);
    const res = await call();
    expect(res._json).toEqual(result);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W09D — idempotency stays where it already is', () => {
  it('a duplicate is a SUCCESS — 200 with duplicate:true, never an error', async () => {
    ingestFeedback.mockResolvedValue(okResult({ duplicate: true, stateAdvanced: false }));
    const res = await call();
    expect(res._status).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.duplicate).toBe(true);
  });

  it('performs NO pre-flight duplicate query — one call in, one call out', async () => {
    await call();
    expect(ingestFeedback).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('W09D — ingestion authority (guard test)', () => {
  const SRC = require('fs').readFileSync(
    require('path').join(__dirname, '../../../pages/api/outreach/outcomes.ts'), 'utf8');
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('imports ingestFeedback — the sole authoritative write path', () => {
    expect(code).toContain('ingestFeedback');
  });

  it('does NOT build a feedback envelope', () => {
    expect(code).not.toContain('buildFeedbackEnvelope');
  });

  it('does NOT persist an outcome itself', () => {
    expect(code).not.toContain('appendOutcome');
    expect(code).not.toContain('ownedDbTable');
    expect(code).not.toContain('outreach_outcomes');
  });

  it('implements NO task lookup of its own', () => {
    expect(code).not.toContain('getOutreachTaskById');
    expect(code).not.toContain('outreach_tasks');
  });

  it('uses the canonical guard, not the legacy shim or a capability', () => {
    expect(code).toContain('requireTenantAccess');
    expect(code).not.toContain('enforceCompanyAccess');
    expect(code).not.toContain('requireCapability');
    expect(code).not.toContain('requireAdminRateLimit');
  });

  it('adds no idempotency key and no second dedup mechanism', () => {
    expect(code).not.toContain('Idempotency-Key');
    expect(code).not.toContain('idempotencyKey');
  });
});
