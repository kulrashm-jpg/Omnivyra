/**
 * /api/cron/outreach-dispatch-recovery — authentication and the disabled default.
 *
 * The sweep service is stubbed here (its behaviour is ws3RecoverySweep.test.ts);
 * this pins that the route refuses anyone without CRON_SECRET, compares it in
 * constant time, and is not scheduled anywhere.
 */
import fs from 'node:fs';
import path from 'node:path';

const runSweep = jest.fn();

const mockRes = () => {
  const res: { statusCode: number; body: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
    statusCode: 0,
    body: null,
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
  };
  return res;
};

const load = () => {
  let handler: (req: unknown, res: unknown) => Promise<unknown> = async () => undefined;
  jest.isolateModules(() => {
    jest.doMock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
    jest.doMock('../../services/leadOutreachRecoverySweep', () => ({ runOutreachDispatchRecoverySweep: runSweep }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    handler = require('../../../pages/api/cron/outreach-dispatch-recovery').default;
  });
  return handler;
};

const call = async (headers: Record<string, unknown>, method = 'POST', query: Record<string, unknown> = {}) => {
  const res = mockRes();
  await load()({ method, headers, query }, res);
  return res;
};

beforeEach(() => {
  runSweep.mockReset();
  runSweep.mockResolvedValue({ enabled: false, skipped: 'disabled', sent: 0, unrecoverable: 0, leadsDeferred: 0 });
  process.env.CRON_SECRET = 'cron-secret-test-1';
});

afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe('outreach-dispatch-recovery route', () => {
  it('refuses when CRON_SECRET is not configured, without running the sweep', async () => {
    delete process.env.CRON_SECRET;
    expect((await call({ authorization: 'Bearer anything' })).statusCode).toBe(401);
    expect(runSweep).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ authorization: 'Bearer wrong' }],
    [{ authorization: 'cron-secret-test-1' }],
    [{ authorization: 'Bearer cron-secret-test-' }],
  ])('refuses %p', async (headers) => {
    expect((await call(headers)).statusCode).toBe(401);
    expect(runSweep).not.toHaveBeenCalled();
  });

  it('rejects other methods', async () => {
    expect((await call({ authorization: 'Bearer cron-secret-test-1' }, 'DELETE')).statusCode).toBe(405);
    expect(runSweep).not.toHaveBeenCalled();
  });

  it('with the secret, runs the sweep and reports it disabled by default', async () => {
    const res = await call({ authorization: 'Bearer cron-secret-test-1' });
    expect(res.statusCode).toBe(200);
    expect(runSweep).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ success: true, enabled: false, message: 'Outreach dispatch recovery is disabled' });
  });

  it('a real run is requested unless ?dryRun=1; a dry run is reported as such', async () => {
    await call({ authorization: 'Bearer cron-secret-test-1' });
    expect(runSweep).toHaveBeenLastCalledWith({ dryRun: false });
    runSweep.mockResolvedValue({ enabled: false, dryRun: true, skipped: null, sent: 0, unrecoverable: 1, leadsDeferred: 0, wouldDispatch: [{ companyId: 'c', leadId: 'l', taskIds: ['t1', 't2'] }] });
    const res = await call({ authorization: 'Bearer cron-secret-test-1' }, 'POST', { dryRun: '1' });
    expect(runSweep).toHaveBeenLastCalledWith({ dryRun: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, message: 'Dry run: 2 task(s) would be dispatched; 1 need a human; nothing was dispatched' });
  });

  it('a sweep error is a 500, never a silent success', async () => {
    runSweep.mockRejectedValue(new Error('queued outreach tasks could not be read: boom'));
    const res = await call({ authorization: 'Bearer cron-secret-test-1' });
    expect(res.statusCode).toBe(500);
  });

  it('uses the shared constant-time bearer comparison', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'pages/api/cron/outreach-dispatch-recovery.ts'), 'utf8');
    expect(src).toMatch(/bearerTokenMatches\(req\.headers\['authorization'\], cronSecret\)/);
  });

  it('is NOT scheduled: no vercel.json cron and no Railway cron registration', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as { crons?: Array<{ path: string }> };
    expect((vercel.crons ?? []).map((c) => c.path)).not.toContain('/api/cron/outreach-dispatch-recovery');
    const railwayCron = path.join(process.cwd(), 'backend/scheduler/cron.ts');
    if (fs.existsSync(railwayCron)) expect(fs.readFileSync(railwayCron, 'utf8')).not.toMatch(/outreach-dispatch-recovery|runOutreachDispatchRecoverySweep/);
  });

  it('is registered in the route-auth allowlist as a machine-secret route', () => {
    const allow = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/route-auth-allowlist.json'), 'utf8'));
    const entries = (allow.routes ?? allow) as Record<string, { kind: string; env: string[] }>;
    const entry = entries['pages/api/cron/outreach-dispatch-recovery.ts'];
    expect(entry).toMatchObject({ kind: 'machine-secret', env: ['CRON_SECRET'] });
  });
});
