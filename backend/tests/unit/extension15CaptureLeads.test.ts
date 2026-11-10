/**
 * Sales Navigator capture, the Outreach side (EXTENSION-1.5.0-CONTRACT.md §5.3):
 * dark by default; everything verified before PI is called; no ids or PII in the response.
 */
const verify = jest.fn();
const finish = jest.fn(async () => ({ ok: true }));
jest.mock('../../services/extension15/index', () => ({
  SALESNAV_CAPTURE_ISSUABLE: false,
  verifyResultCommand: (...a: unknown[]) => verify(...a),
  finishCommand: (...a: unknown[]) => (finish as any)(...a),
}));
import { createCaptureLeadsHandler, checkCaptureBatch, MAX_LEADS_PER_BATCH } from '../../services/extension15/captureLeads';
import { SALESNAV_CAPTURE_ISSUABLE } from '../../services/extension15/index';

const SESSION = { userId: 'u-1', orgId: 'o-1', expiresAt: Date.now() + 1e6, hmacNonce: 'n' };
const ME = 'urn:li:fsd_profile:ACoAAme0001';
const lead = (over: Record<string, unknown> = {}) => ({ lead_key: 'ACwAAAbCdEf123', full_name: 'Jane Doe', title: 'CTO', company_name: 'Acme', ...over });
const body = (over: Record<string, unknown> = {}) => ({
  command_id: 'cmd-1', extension_version: '1.5.0', provider: 'linkedin_salesnav_extension', contract_version: 1, provisional: true,
  captured_at: '2026-11-10T10:00:00Z', source: { surface: 'sales_navigator', list_kind: 'saved_leads', page_index: 0 },
  leads: [lead()], ...over,
});
function call(handler: any, b: unknown, method = 'POST') {
  const res: any = { statusCode: 0, body: undefined, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (j: unknown) => { res.body = j; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  return handler({ method, body: b, headers: {} }, res).then(() => res);
}
const auth = jest.fn(async () => ({ session: SESSION }));

beforeEach(() => {
  verify.mockReset().mockResolvedValue({ ok: true, actingMemberUrn: ME, params: {} });
  finish.mockClear();
  auth.mockClear();
});

it('ships DARK: the default switch refuses before auth or PI is touched', async () => {
  expect(SALESNAV_CAPTURE_ISSUABLE).toBe(false);
  const ingest = jest.fn();
  const res = await call(createCaptureLeadsHandler({ auth, ingest }), body());
  expect(res.statusCode).toBe(403);
  expect(res.body).toMatchObject({ error: 'SALESNAV_CAPTURE_DISABLED' });
  expect(auth).not.toHaveBeenCalled();
  expect(ingest).not.toHaveBeenCalled();
});

describe('when enabled (test switch)', () => {
  const on = () => true;

  it('verifies, calls PI with a branded context, finishes the command, and returns key/status only', async () => {
    const ingest = jest.fn(async (ctx: any) => {
      expect(ctx).toMatchObject({ orgId: 'o-1', userId: 'u-1', actingMemberUrn: ME, commandId: 'cmd-1', extensionVersion: '1.5.0', socialAccountId: null });
      expect(Object.isFrozen(ctx)).toBe(true);
      return { ok: true as const, results: [{ key: 'k1', status: 'created' as const, prospectId: 'SHOULD-NOT-LEAK', name: 'Jane' } as any, { key: 'k2', status: 'rejected' as const, reason: 'duplicate' }] };
    });
    const res = await call(createCaptureLeadsHandler({ auth, ingest, issuable: on }), body());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, results: [{ key: 'k1', status: 'created' }, { key: 'k2', status: 'rejected', reason: 'duplicate' }] });
    expect(JSON.stringify(res.body)).not.toMatch(/SHOULD-NOT-LEAK|Jane/);
    expect(verify).toHaveBeenCalledWith(SESSION, 'cmd-1', 'li.salesnav.capture_saved_leads');
    expect(finish).toHaveBeenCalledWith(SESSION, 'cmd-1', 'completed', { created: 1, updated: 0, unchanged: 0, rejected: 1 });
  });

  it.each([
    ['an old extension', { extension_version: '1.4.1' }, 426, 'EXTENSION_UPGRADE_REQUIRED'],
    ['a missing version', { extension_version: undefined }, 426, 'EXTENSION_UPGRADE_REQUIRED'],
  ])('refuses %s before verifying the command', async (_n, over, status, code) => {
    const ingest = jest.fn();
    const res = await call(createCaptureLeadsHandler({ auth, ingest, issuable: on }), body(over));
    expect(res.statusCode).toBe(status);
    expect(res.body).toMatchObject({ error: code });
    expect(verify).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it('a command that is not live, dispatched and bound never reaches PI', async () => {
    verify.mockResolvedValueOnce({ ok: false, status: 409, code: 'BINDING_MISMATCH' });
    const ingest = jest.fn();
    const res = await call(createCaptureLeadsHandler({ auth, ingest, issuable: on }), body());
    expect(res.statusCode).toBe(409);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('a refused batch finishes the command as refused and never reaches PI', async () => {
    const ingest = jest.fn();
    const res = await call(createCaptureLeadsHandler({ auth, ingest, issuable: on }), body({ leads: [lead({ lead_key: 'urn:li:fs_salesProfile:(ACwAA1,NAME_SEARCH,x)' })] }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'INVALID_LEAD_KEY' });
    expect(finish).toHaveBeenCalledWith(SESSION, 'cmd-1', 'refused', { code: 'INVALID_LEAD_KEY' });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('auth failure stops the handler (the auth function has already responded)', async () => {
    const ingest = jest.fn();
    await call(createCaptureLeadsHandler({ auth: jest.fn(async () => null), ingest, issuable: on }), body());
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('batch checks', () => {
  it.each([
    ['a full fs_salesProfile tuple as lead_key', { leads: [lead({ lead_key: '(ACwAA1,NAME_SEARCH,x)' })] }, 'INVALID_LEAD_KEY'],
    ['a /sales/ URL as the profile url', { leads: [lead({ public_profile_url: 'https://www.linkedin.com/sales/lead/ACwAA1,NAME_SEARCH,abc' })] }, 'SALES_URL_REFUSED'],
    ['a /sales/ URL hidden in any field', { leads: [lead({ company_linkedin_url: 'https://www.linkedin.com/sales/company/1' })] }, 'SALES_URL_REFUSED'],
    ['a non-/in/ profile url', { leads: [lead({ public_profile_url: 'https://evil.example/in/x' })] }, 'INVALID_PROFILE_URL'],
    ['no name', { leads: [lead({ full_name: ' ' })] }, 'FULL_NAME_REQUIRED'],
    ['too many leads', { leads: Array.from({ length: MAX_LEADS_PER_BATCH + 1 }, () => lead()) }, 'TOO_MANY_LEADS'],
    ['an empty batch', { leads: [] }, 'LEADS_REQUIRED'],
    ['another provider', { provider: 'linkedin_snap' }, 'UNSUPPORTED_CONTRACT'],
  ])('refuses %s', (_n, over, code) => {
    expect(checkCaptureBatch(body(over))).toBe(code);
  });
  it.each([
    'https://www.linkedin.com/in/jane-doe-123/',
    'http://linkedin.com/in/jane-doe-123',
    'https://uk.linkedin.com/in/jane-doe-123',
  ])('accepts a displayed /in/ URL in any form PI normalizes: %s', (u) => {
    expect(checkCaptureBatch(body({ leads: [lead({ public_profile_url: u })] }))).toBeNull();
  });
  it.each(['https://linkedin.com.evil.example/in/x', 'https://www.linkedin.com/in/', 'javascript:alert(1)'])('refuses a lookalike or empty /in/ URL: %s', (u) => {
    expect(checkCaptureBatch(body({ leads: [lead({ public_profile_url: u })] }))).toBe('INVALID_PROFILE_URL');
  });
});
