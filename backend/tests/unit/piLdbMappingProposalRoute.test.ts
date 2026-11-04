/**
 * PI-LDB — the mapping PROPOSAL endpoint.
 *
 * A transport shell over the parent-owned mapping engine, so these tests are
 * mostly about what it REFUSES and what it REPORTS.
 *
 * Three assertions are unique to this route:
 *   1. the gate order — global flag, then membership, then capability, then the
 *      TENANT gate, so an unauthenticated caller can never probe which
 *      organisations have importing enabled;
 *   2. that no row of tenant data is accepted — headings and bounded samples
 *      only, with the row payload having no way in at all;
 *   3. that `aiAssisted` is false when the proposer was unavailable. The
 *      gateway is dark until its pricing row exists, the engine degrades
 *      silently by design, and telling a tenant their mapping was AI-assisted
 *      when the model was never reached is the exact failure this programme is
 *      trying to avoid.
 *
 * Follows the convention `piP1W02CsvIngestionRoute.test.ts` establishes:
 * collaborators mocked by relative path, `routeFactory` mocked to identity so
 * the handler is exercised unwrapped, and a hand-rolled response recorder.
 */

const enforceCompanyAccess = jest.fn();
const requireCapability = jest.fn();
const proposeFieldMappings = jest.fn();
const createGatewayMappingProposer = jest.fn();
const checkRateLimit = jest.fn();

let ingestionEnabled = true;
let tenantGateAllowed = true;

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => enforceCompanyAccess(...a),
}));

jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));

jest.mock('../../services/leadIngestion/orchestrator', () => ({
  isLeadIngestionEnabled: () => ingestionEnabled,
  resolveLeadIngestionGate: async () => ({
    allowed: tenantGateAllowed,
    reason: 'test',
  }),
}));

jest.mock('../../services/leadMapping/mappingEngine', () => ({
  // A real 64-hex digest shape, since the approval route's own validation and
  // the client both depend on that format.
  fingerprintSchema: (headers: readonly string[]) =>
    require('crypto').createHash('sha256').update(headers.join('|')).digest('hex'),
  proposeFieldMappings: (...a: unknown[]) => proposeFieldMappings(...a),
}));

jest.mock('../../services/leadMapping/gatewayProposer', () => ({
  createGatewayMappingProposer: (...a: unknown[]) => createGatewayMappingProposer(...a),
}));

jest.mock('../../../lib/auth/rateLimit', () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));

jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

import handler from '../../../pages/api/lead-ingestion/mapping-proposal';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import type { NextApiRequest, NextApiResponse } from 'next';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-00000000u001';

type Res = NextApiResponse & {
  _status: number;
  _json: Record<string, unknown>;
  _headers: Record<string, string>;
};

const makeRes = (): Res => {
  const r: Partial<Res> = { _status: 0, _json: {}, _headers: {} };
  r.status = ((c: number) => {
    (r as Res)._status = c;
    return r as Res;
  }) as Res['status'];
  r.json = ((b: Record<string, unknown>) => {
    (r as Res)._json = b;
    return r as Res;
  }) as Res['json'];
  r.setHeader = ((k: string, v: string) => {
    (r as Res)._headers[k] = v;
    return r as Res;
  }) as unknown as Res['setHeader'];
  return r as Res;
};

const req = (over: Partial<NextApiRequest> = {}): NextApiRequest =>
  ({
    method: 'POST',
    query: { company_id: ORG_A },
    headers: {},
    body: { source: 'csv', headers: ['Email'], samples: { Email: ['a@b.co'] } },
    ...over,
  }) as NextApiRequest;

/** The engine's shape for a clean, deterministic result. */
const engineResult = (over: Record<string, unknown> = {}) => ({
  sourceSchemaFingerprint: 'f'.repeat(64),
  proposals: [
    {
      sourceField: 'Email',
      status: 'high_confidence_suggestion',
      candidate: { target: 'email', entity: 'contact', score: 0.9, evidence: [], dataTypeCompatibility: 'compatible', transformation: 'lowercase_email' },
      alternatives: [],
      ambiguity: null,
      reasoning: 'header matches',
      requiresTenantApproval: false,
      provenance: 'deterministic',
      validation: null,
      model: null,
    },
  ],
  requiresReview: false,
  profile: null,
  degraded: [],
  ...over,
});

const call = async (r: NextApiRequest = req()) => {
  const res = makeRes();
  await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(r, res);
  return res;
};

beforeEach(() => {
  ingestionEnabled = true;
  tenantGateAllowed = true;
  enforceCompanyAccess.mockResolvedValue({ userId: USER });
  requireCapability.mockResolvedValue({ ok: true, principal: { userId: USER } });
  checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0, bypassed: false });
  createGatewayMappingProposer.mockReturnValue(async () => []);
  proposeFieldMappings.mockResolvedValue(engineResult());
});

describe('method', () => {
  it('accepts POST only and advertises it', async () => {
    const res = await call(req({ method: 'GET' }));
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('POST');
  });
});

describe('the gate order protects tenancy', () => {
  it('the global flag is checked BEFORE any membership lookup', async () => {
    ingestionEnabled = false;
    const res = await call();
    expect(res._status).toBe(404);
    expect(res._json.code).toBe('LEAD_INGESTION_DISABLED');
    // A disabled route must cost no membership lookup and leak no tenancy.
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
    expect(requireCapability).not.toHaveBeenCalled();
  });

  it('the TENANT gate is checked AFTER authorization', async () => {
    tenantGateAllowed = false;
    const res = await call();
    expect(res._status).toBe(404);
    expect(res._json.code).toBe('LEAD_INGESTION_DISABLED');
    // Only a verified admin of THIS tenant learns its state; otherwise the
    // route would let anyone enumerate which orgs have importing on.
    expect(enforceCompanyAccess).toHaveBeenCalled();
    expect(requireCapability).toHaveBeenCalled();
    expect(proposeFieldMappings).not.toHaveBeenCalled();
  });

  it('an authorization failure never reaches the engine', async () => {
    requireCapability.mockResolvedValue({ ok: false, sent: true });
    await call();
    expect(proposeFieldMappings).not.toHaveBeenCalled();
  });

  it('a membership failure never reaches the engine', async () => {
    enforceCompanyAccess.mockResolvedValue(null);
    await call();
    expect(requireCapability).not.toHaveBeenCalled();
    expect(proposeFieldMappings).not.toHaveBeenCalled();
  });

  it('binds the capability to the VERIFIED tenant', async () => {
    await call();
    expect(requireCapability).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ capability: PROSPECT_INGEST, organizationId: ORG_A }),
    );
  });
});

describe('the tenant is never taken from the body', () => {
  it.each(['organizationId', 'organization_id', 'companyId', 'company_id'])(
    'refuses a body carrying %s rather than ignoring it',
    async (key) => {
      const res = await call(
        req({ body: { source: 'csv', headers: ['Email'], [key]: 'other-org' } }),
      );
      expect(res._status).toBe(400);
      expect(String(res._json.error)).toContain(key);
      expect(proposeFieldMappings).not.toHaveBeenCalled();
    },
  );

  it('requires a uuid company_id so a malformed value is not a 403', async () => {
    const res = await call(req({ query: { company_id: 'not-a-uuid' } }));
    expect(res._status).toBe(400);
    expect(String(res._json.error)).toContain('uuid');
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
  });

  it('passes the verified tenant to the engine and the proposer, never the body', async () => {
    await call();
    expect(proposeFieldMappings).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ORG_A }),
      expect.anything(),
    );
    expect(createGatewayMappingProposer).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ORG_A, actorUserId: USER, sourceType: 'csv' }),
    );
  });
});

describe('input bounds', () => {
  it('refuses a source outside the allowlist, so profiles cannot fragment', async () => {
    const res = await call(req({ body: { source: 'sales_navigator', headers: ['Email'] } }));
    expect(res._status).toBe(400);
    expect(proposeFieldMappings).not.toHaveBeenCalled();
  });

  it('refuses an empty or non-array headers list', async () => {
    expect((await call(req({ body: { source: 'csv', headers: [] } })))._status).toBe(400);
    expect((await call(req({ body: { source: 'csv', headers: 'Email' } })))._status).toBe(400);
  });

  it('refuses duplicate headings, which cannot be mapped', async () => {
    const res = await call(
      req({ body: { source: 'csv', headers: ['Email', 'email', 'Name'] } }),
    );
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('DUPLICATE_HEADERS');
    expect(proposeFieldMappings).not.toHaveBeenCalled();
  });

  it('caps the column count', async () => {
    const res = await call(
      req({
        body: {
          source: 'csv',
          headers: Array.from({ length: 201 }, (_, i) => `c${i}`),
        },
      }),
    );
    expect(res._status).toBe(413);
  });

  it('caps samples per column and sample length', async () => {
    await call(
      req({
        body: {
          source: 'csv',
          headers: ['Email'],
          samples: { Email: Array.from({ length: 50 }, () => 'x'.repeat(5_000)) },
        },
      }),
    );
    const input = proposeFieldMappings.mock.calls[0][0] as {
      samples: Record<string, string[]>;
    };
    expect(input.samples.Email).toHaveLength(5);
    for (const value of input.samples.Email) expect(value.length).toBeLessThanOrEqual(200);
  });

  it('drops samples for headings that were not declared', async () => {
    await call(
      req({
        body: {
          source: 'csv',
          headers: ['Email'],
          samples: { Email: ['a@b.co'], Secret: ['should not travel'] },
        },
      }),
    );
    const input = proposeFieldMappings.mock.calls[0][0] as {
      samples: Record<string, string[]>;
    };
    expect(Object.keys(input.samples)).toEqual(['Email']);
  });

  it('accepts no row payload at all — there is no parameter for one', async () => {
    await call(
      req({
        body: {
          source: 'csv',
          headers: ['Email'],
          samples: { Email: ['a@b.co'] },
          // A client attempting to send the file's rows anyway.
          rows: [['a@b.co'], ['c@d.co']],
          records: [{ email: 'a@b.co' }],
        },
      }),
    );
    const input = proposeFieldMappings.mock.calls[0][0] as Record<string, unknown>;
    expect(input).not.toHaveProperty('rows');
    expect(input).not.toHaveProperty('records');
  });
});

describe('rate limiting', () => {
  it('is keyed on the tenant, because the budget being protected is theirs', async () => {
    await call();
    expect(checkRateLimit).toHaveBeenCalledWith(ORG_A, expect.objectContaining({ limit: 30 }));
  });

  it('answers 429 with Retry-After and does not reach the engine', async () => {
    const resetAt = Math.ceil(Date.now() / 1_000) + 120;
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt, bypassed: false });
    const res = await call();
    expect(res._status).toBe(429);
    expect(res._json.code).toBe('MAPPING_RATE_LIMITED');
    expect(Number(res._headers['Retry-After'])).toBeGreaterThan(0);
    expect(proposeFieldMappings).not.toHaveBeenCalled();
  });

  it('runs AFTER authorization, so an unauthorized caller cannot burn a tenant\'s budget', async () => {
    requireCapability.mockResolvedValue({ ok: false, sent: true });
    await call();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe('the response serves the destination allowlist', () => {
  it('includes every allowed target with a submittability verdict', async () => {
    const res = await call();
    const targets = res._json.allowedTargets as Array<{
      key: string;
      submittable: boolean;
      blockedReason?: string;
    }>;

    expect(targets.length).toBeGreaterThan(20);
    // The browser must not need its own copy of the vocabulary, and must not
    // be able to offer a destination the server would refuse.
    const email = targets.find((t) => t.key === 'email')!;
    expect(email.submittable).toBe(true);

    // `description` is SUBMITTABLE as of this deliverable. The premise this
    // assertion was written against — a registry key the ingestion contract
    // cannot carry — no longer holds: `CsvLeadInput = ManualLeadInput`
    // (csvAdapter.ts:67), `ManualLeadInput.description` exists
    // (manualAdapter.ts:105), `toNormalizedManualRecord` reads it onto the
    // normalized account (manualAdapter.ts:289), and the orchestrator persists
    // it via `toAccountAttributeInput` (orchestrator.ts:207) to
    // `prospect_accounts.description`, which `ACCOUNT_ATTRIBUTE_COLUMNS`
    // permits (attributes.ts:372). The route derives this field from
    // `isSubmittableTarget`, and `piLdbImportSubmittableTargets.test.ts`
    // asserts that function returns `true` for this key.
    const description = targets.find((t) => t.key === 'description')!;
    expect(description.submittable).toBe(true);
    expect(description).not.toHaveProperty('blockedReason');

    // The SHAPE guarantee this test is named for, stated so it survives a key
    // moving between the two partitions: every target carries a boolean
    // verdict, and a reason is present exactly where the verdict is false.
    for (const t of targets) {
      expect(typeof t.submittable).toBe('boolean');
      if (t.submittable) expect(t).not.toHaveProperty('blockedReason');
      else expect(typeof t.blockedReason).toBe('string');
    }
  });
});

describe('AI assistance is reported from evidence, never assumed', () => {
  it('is false when the proposer was unavailable', async () => {
    // Exactly what happens while the gateway is dark: the engine catches the
    // GatewayProposerError and records ONE degraded entry for the whole call.
    proposeFieldMappings.mockResolvedValue(
      engineResult({
        degraded: [{ sourceField: '*', cause: 'proposer_unavailable:GatewayProposerError' }],
      }),
    );
    const res = await call();
    expect(res._status).toBe(200);
    expect(res._json.aiAssisted).toBe(false);
    // The degraded entry is passed through so the UI can say so honestly.
    expect(res._json.degraded).toEqual([
      { sourceField: '*', cause: 'proposer_unavailable:GatewayProposerError' },
    ]);
  });

  it('is false when the model contributed nothing, even with no degraded entry', async () => {
    const res = await call();
    expect(res._json.aiAssisted).toBe(false);
  });

  it('is true only when a proposal actually carries a model echo', async () => {
    proposeFieldMappings.mockResolvedValue(
      engineResult({
        proposals: [
          {
            ...engineResult().proposals[0],
            model: { selfReportedConfidence: 0.8, reasoning: 'looks like an email column' },
          },
        ],
      }),
    );
    const res = await call();
    expect(res._json.aiAssisted).toBe(true);
  });

  it('is false when the gateway degraded even if some proposal carries a model echo', async () => {
    // Defensive: a partial model result plus a gateway failure must not be
    // reported as a clean AI-assisted mapping.
    proposeFieldMappings.mockResolvedValue(
      engineResult({
        proposals: [
          {
            ...engineResult().proposals[0],
            model: { selfReportedConfidence: 0.8, reasoning: 'x' },
          },
        ],
        degraded: [{ sourceField: '*', cause: 'proposer_unavailable:GatewayProposerError' }],
      }),
    );
    const res = await call();
    expect(res._json.aiAssisted).toBe(false);
  });
});

describe('the profile is honestly absent', () => {
  it('passes null as the stored profile and reports what the engine said', async () => {
    await call();
    const input = proposeFieldMappings.mock.calls[0][0] as { storedProfile: unknown };
    // The store is not delivered; fabricating a profile would claim a tenant
    // approved something they never saw.
    expect(input.storedProfile).toBeNull();

    const res = await call();
    expect(res._json.profile).toBeNull();
  });
});

describe('this endpoint writes nothing', () => {
  it('reports an engine failure as a client error with nothing altered', async () => {
    proposeFieldMappings.mockRejectedValue(new Error('registry unavailable'));
    const res = await call();
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('MAPPING_PROPOSAL_FAILED');
  });
});
