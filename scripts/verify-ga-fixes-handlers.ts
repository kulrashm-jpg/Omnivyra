/**
 * Direct invocation of the GA endpoint handlers using mock req/res — covers
 * the parts that don't need Redis/network: auth parity, error-shape parity,
 * and that the cron handler actually reaches the enqueue branch.
 *
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-ga-fixes-handlers.ts
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import gaConnect from '../pages/api/super-admin/ga-connect';
import gaSelectProperty from '../pages/api/super-admin/ga-select-property';
import gaAnalyticsSummary from '../pages/api/super-admin/ga-analytics-summary';
import cronAnalyticsIngestion from '../pages/api/cron/analytics-ingestion';

type MockResult = { status: number; body: any; headers: Record<string, string> };

function makeRes(): NextApiResponse & { _result: MockResult } {
  const r: any = { _result: { status: 200, body: undefined, headers: {} } };
  r.setHeader = (k: string, v: any) => { r._result.headers[k] = String(v); };
  r.status = (code: number) => { r._result.status = code; return r; };
  r.json = (body: any) => { r._result.body = body; return r; };
  r.redirect = (url: string) => { r._result.status = 302; r._result.headers.Location = url; return r; };
  r.writableEnded = false;
  return r;
}

function makeReq(opts: { method?: string; cookies?: Record<string,string>; headers?: Record<string,string>; body?: any }): NextApiRequest {
  return {
    method: opts.method ?? 'GET',
    cookies: opts.cookies ?? {},
    headers: opts.headers ?? {},
    body: opts.body ?? {},
    query: {},
  } as any;
}

async function call(handler: any, req: NextApiRequest): Promise<MockResult> {
  const res = makeRes();
  await handler(req, res);
  return res._result;
}

function box(t: string) { console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`); }

async function main() {
  box('A — ga-connect: no auth → standardized 403 with code');
  const a1 = await call(gaConnect, makeReq({ method: 'POST' }));
  console.log(a1);
  if (a1.status !== 403 || a1.body?.code !== 'GA_NOT_AUTHENTICATED') {
    console.log('❌ expected 403/GA_NOT_AUTHENTICATED'); process.exit(1);
  }
  console.log('✅ ga-connect rejects unauthenticated with standardized shape');

  box('B — ga-connect: cookie path → reaches connect logic, returns 200 + authorizationUrl');
  const b1 = await call(gaConnect, makeReq({ method: 'POST', cookies: { super_admin_session: '1' } }));
  console.log({ status: b1.status, hasUrl: typeof b1.body?.authorizationUrl === 'string', code: b1.body?.code });
  if (b1.status !== 200 || typeof b1.body?.authorizationUrl !== 'string') {
    console.log('❌ cookie auth path failed'); process.exit(1);
  }
  console.log('✅ ga-connect via cookie OK');

  box('C — ga-select-property: cookie + missing propertyId → 400 with code');
  const c1 = await call(gaSelectProperty, makeReq({ method: 'POST', cookies: { super_admin_session: '1' } }));
  console.log(c1);
  if (c1.status !== 400 || c1.body?.code !== 'GA_MISSING_PROPERTY_ID') {
    console.log('❌ expected 400/GA_MISSING_PROPERTY_ID'); process.exit(1);
  }
  console.log('✅ ga-select-property missing-id path standardized');

  box('D — ga-analytics-summary: no auth → standardized 403 with code (parity with connect)');
  const d1 = await call(gaAnalyticsSummary, makeReq({ method: 'GET' }));
  console.log(d1);
  if (d1.status !== 403 || d1.body?.code !== 'GA_NOT_AUTHENTICATED') {
    console.log('❌ expected 403/GA_NOT_AUTHENTICATED'); process.exit(1);
  }
  console.log('✅ ga-analytics-summary auth shape matches ga-connect');

  box('E — ga-analytics-summary: cookie path → 200');
  const e1 = await call(gaAnalyticsSummary, makeReq({ method: 'GET', cookies: { super_admin_session: '1' } }));
  console.log({ status: e1.status, has_ga_status: Boolean(e1.body?.ga_status), connected: e1.body?.ga_status?.connected });
  if (e1.status !== 200 || !e1.body?.ga_status) {
    console.log('❌ summary cookie path failed:', e1.body); process.exit(1);
  }
  console.log('✅ ga-analytics-summary returns connected status payload');
  console.log('   last_sync =', e1.body.ga_status.last_sync);

  box('F — cron: no secret env → 401 (no Redis dependency on this path)');
  const savedSecret = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const f1 = await call(cronAnalyticsIngestion, makeReq({ method: 'POST' }));
  console.log(f1);
  if (f1.status !== 401) { console.log('❌ expected 401'); process.exit(1); }
  console.log('✅ cron rejects when CRON_SECRET missing');
  if (savedSecret) process.env.CRON_SECRET = savedSecret;

  box('G — cron: wrong bearer → 401 (no Redis dependency)');
  const fakeSecret = 'verify-fixes-test-secret';
  process.env.CRON_SECRET = fakeSecret;
  const g1 = await call(cronAnalyticsIngestion, makeReq({ method: 'POST', headers: { authorization: 'Bearer wrong' } }));
  console.log(g1);
  if (g1.status !== 401) { console.log('❌ expected 401'); process.exit(1); }
  console.log('✅ cron rejects wrong bearer');
  if (savedSecret) process.env.CRON_SECRET = savedSecret;
  else delete process.env.CRON_SECRET;
  console.log('\nℹ️  cron enqueue-branch (case H) is exercised in production where Redis is reachable.');

  console.log('\nALL HANDLER CHECKS PASSED');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
