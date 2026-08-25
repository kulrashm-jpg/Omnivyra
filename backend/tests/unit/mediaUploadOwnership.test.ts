/**
 * Media upload ownership is the AUTHENTICATED identity.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `/api/media/upload` authenticated the caller and then threw that away:
 *
 *     const userId = uuidPattern.test(providedUserId) ? providedUserId : user.id;
 *
 * Any authenticated caller could file an upload under any uuid it chose — the
 * browser decided ownership. Phase 67 hit the benign form: the Creator panel
 * sends `getSupabaseBrowser().auth.getUser().id`, and on a browser whose
 * Supabase session had drifted from its server session that is a DIFFERENT
 * user. The row was stored under that other id, canonical registration
 * correctly refused to promote a file the caller did not own, and a real upload
 * was silently misfiled and unusable.
 *
 * These tests drive the ROUTE and assert what `uploadMedia` is actually asked
 * to own, rather than asserting on a re-implementation of the rule.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import * as fs from 'fs';
import * as path from 'path';

const AUTH_USER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

/** What the route was ultimately asked to store, and for whom. */
let uploadCalls: Array<Record<string, unknown>> = [];
let authUser: { id: string } | null = { id: AUTH_USER };
let authError: string | null = null;
let formFields: Record<string, unknown> = {};

jest.mock('formidable', () => {
  return jest.fn(() => ({
    parse: async () => [
      formFields,
      { file: [{ filepath: '/tmp/x.png', originalFilename: 'shapes.png', mimetype: 'image/png' }] },
    ],
  }));
});

jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  return { ...real, readFileSync: jest.fn(() => Buffer.from('bytes')), unlinkSync: jest.fn() };
});

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: authUser, error: authError }),
}));

jest.mock('../../services/mediaService', () => ({
  validateMedia: async () => ({ valid: true, errors: [], warnings: [] }),
  uploadMedia: async (opts: Record<string, unknown>) => {
    uploadCalls.push(opts);
    return { id: 'media-1', user_id: opts.userId, file_name: 'shapes.png' };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../../../pages/api/media/upload').default;

function makeRes() {
  const res: Record<string, unknown> = { statusCode: 0, body: null, headersSent: false };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

async function post(fields: Record<string, unknown>) {
  formFields = fields;
  const res = makeRes();
  await route({ method: 'POST', headers: {}, query: {} } as never, res as never);
  return res;
}

beforeEach(() => {
  uploadCalls = [];
  authUser = { id: AUTH_USER };
  authError = null;
  formFields = {};
});

describe('A — ownership comes from the authenticated identity', () => {
  it('no user_id supplied → owned by the authenticated user', async () => {
    const res = await post({});
    expect(res.statusCode).toBe(200);
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].userId).toBe(AUTH_USER);
  });

  it('user_id equal to the authenticated user → owned by them (legacy clients keep working)', async () => {
    await post({ user_id: [AUTH_USER] });
    expect(uploadCalls[0].userId).toBe(AUTH_USER);
  });

  it('CRITICAL: user_id naming ANOTHER user → that user does NOT become the owner', async () => {
    const res = await post({ user_id: [OTHER_USER] });
    expect(res.statusCode).toBe(200);
    expect(uploadCalls[0].userId).toBe(AUTH_USER);
    expect(uploadCalls[0].userId).not.toBe(OTHER_USER);
  });

  it('CRITICAL: a well-formed uuid is not privileged over the session', async () => {
    // The old rule accepted ANY value that merely looked like a uuid.
    for (const spoof of [OTHER_USER, '00000000-0000-4000-8000-000000000000',
      'ffffffff-ffff-4fff-8fff-ffffffffffff']) {
      uploadCalls = [];
      await post({ user_id: [spoof] });
      expect(uploadCalls[0].userId).toBe(AUTH_USER);
    }
  });

  it('a malformed user_id is equally irrelevant', async () => {
    for (const junk of ['not-a-uuid', '', '   ', '../../etc/passwd']) {
      uploadCalls = [];
      await post({ user_id: [junk] });
      expect(uploadCalls[0].userId).toBe(AUTH_USER);
    }
  });

  it('the field is still accepted — no client is broken by sending it', async () => {
    const res = await post({ user_id: [OTHER_USER] });
    expect(res.statusCode).toBe(200);
    expect((res.body as Record<string, unknown>).success).toBe(true);
  });
});

describe('B — authentication is still required', () => {
  it('CRITICAL: an unauthenticated upload is rejected and stores nothing', async () => {
    authUser = null; authError = 'MISSING_AUTH';
    const res = await post({ user_id: [AUTH_USER] });
    expect(res.statusCode).toBe(401);
    expect(uploadCalls).toHaveLength(0);
  });

  it('CRITICAL: a user_id cannot substitute for a session', async () => {
    authUser = null; authError = null;
    const res = await post({ user_id: [OTHER_USER] });
    expect(res.statusCode).toBe(401);
    expect(uploadCalls).toHaveLength(0);
  });
});

describe('C — nothing else about the request can steer storage', () => {
  it('CRITICAL: no bucket or storage path is accepted from the caller', async () => {
    await post({
      user_id: [OTHER_USER], bucket: ['secrets'], storage_bucket: ['secrets'],
      storage_path: ['../../elsewhere/x.png'], file_path: ['secrets/x.png'],
    });
    const call = uploadCalls[0];
    expect(call.userId).toBe(AUTH_USER);
    for (const k of ['bucket', 'storage_bucket', 'storagePath', 'storage_path', 'file_path']) {
      expect(Object.prototype.hasOwnProperty.call(call, k)).toBe(false);
    }
  });

  it('the upload service is handed only the fields it owns', async () => {
    // uploadMedia derives bucket and key itself from the media type, so no
    // caller-supplied location can reach it.
    await post({ user_id: [OTHER_USER], bucket: ['secrets'], storage_path: ['../x.png'] });
    expect(Object.keys(uploadCalls[0]).sort())
      .toEqual(['campaignId', 'file', 'fileName', 'metadata', 'mimeType', 'userId']);
  });
});

/* ── Source contract: pins the SHIPPED route, not a model of it ─────────────
 * `fs` is mocked above so the ROUTE can read a fake upload buffer; these reads
 * need the real one. */
const realFs = jest.requireActual('fs') as typeof fs;
const read = (p: string) => realFs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ROUTE_RAW = read('../../../pages/api/media/upload.ts');
const ROUTE = strip(ROUTE_RAW);

describe('D — mutation guards on the route itself', () => {
  it('CRITICAL M1: ownership is assigned from the session, unconditionally', () => {
    expect(ROUTE).toContain('const userId = user.id;');
  });

  it('CRITICAL M2: the client value can never be selected as the owner', () => {
    expect(ROUTE).not.toMatch(/const userId\s*=\s*[^;]*providedUserId/);
    expect(ROUTE).not.toMatch(/\?\s*providedUserId\s*:/);
    expect(ROUTE).not.toMatch(/userId\s*=\s*providedUserId/);
  });

  it('CRITICAL M3: authentication is not bypassed', () => {
    expect(ROUTE).toContain('await getSupabaseUserFromRequest(req)');
    expect(ROUTE).toContain('return res.status(401).json({ error: \'Unauthorized\' });');
    // The 401 must precede the ownership decision.
    expect(ROUTE.indexOf('401')).toBeLessThan(ROUTE.indexOf('const userId = user.id;'));
  });

  it('CRITICAL M4: no second ownership source is introduced', () => {
    for (const invented of ['owner_id', 'ownerId', 'impersonate', 'onBehalfOf', 'as_user', 'actingUserId']) {
      expect(ROUTE).not.toContain(invented);
    }
    expect((ROUTE.match(/const userId\s*=/g) ?? [])).toHaveLength(1);
  });

  it('the conflicting value is logged, so drift is visible rather than silent', () => {
    expect(ROUTE).toContain('providedUserId !== userId');
    expect(ROUTE).toContain('ignoring client-supplied user_id');
  });

  it('the warning does not leak the rejected identifier', () => {
    const warn = ROUTE.slice(ROUTE.indexOf('ignoring client-supplied user_id'));
    expect(warn.slice(0, 220)).not.toContain('providedUserId,');
  });
});

describe('E — the rest of the media contract is untouched', () => {
  it('Phase 66 storage locator and column contract still stand', () => {
    const media = strip(read('../../services/mediaService.ts'));
    expect(media).toContain('parseMediaStorageLocator(mediaFile.storage_url)');
    expect(media).toContain('storage_url: fileUrl');
    expect(media).toContain('stripMissingColumnFromInsertPayload');
  });

  it('canonical registration semantics are unchanged', () => {
    const reg = strip(read('../../services/creator/creatorCompositionAssetService.ts'));
    expect(reg).toContain("String(row.user_id || '') !== userId");
    expect(reg).toContain('Uploaded file not found for this user');
    expect(reg).toContain('parseMediaStorageLocator(row.storage_url)');
  });

  it('canonical deletion stays company-scoped', () => {
    const canonical = strip(read('../../services/canonicalMediaAssetService.ts'));
    expect(canonical).toMatch(/\.delete\(\)\s*\.eq\('company_id', companyId\)\s*\.eq\('id', assetId\)/);
  });

  it('no provider, template or schema change rides along', () => {
    expect(read('../../../lib/creator-templates/systemTemplates.ts').match(/assetSlots:/g) ?? [])
      .toHaveLength(2);
    expect(read('../../services/creator/creatorMultimodalReferences.ts'))
      .toContain('maxReferenceImages: 16');
  });
});
