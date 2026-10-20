/**
 * WP3 hardening — the REAL SNS signing-certificate fetcher.
 *
 * The webhook suite substitutes the fetcher; this suite does not. Only the
 * network boundary (`https.get`) is replaced, so the URL guard, the timeout, the
 * size cap, the status check, the certificate check and the cache all run as
 * written.
 */
import { EventEmitter } from 'events';

type Scenario = 'ok' | 'not_cert' | 'status_404' | 'oversize' | 'timeout' | 'error';
const net = {
  scenario: 'ok' as Scenario,
  calls: [] as Array<{ url: string; timeout: unknown }>,
  destroyed: 0,
  resumed: 0,
};

function fakeGet(url: string, opts: { timeout?: number }, onResponse: (res: EventEmitter) => void) {
  net.calls.push({ url, timeout: opts?.timeout });
  const request = Object.assign(new EventEmitter(), { destroy: () => { net.destroyed += 1; } });
  setImmediate(() => {
    if (net.scenario === 'timeout') { request.emit('timeout'); return; }
    if (net.scenario === 'error') { request.emit('error', new Error('ECONNRESET')); return; }
    const response = Object.assign(new EventEmitter(), {
      statusCode: net.scenario === 'status_404' ? 404 : 200,
      setEncoding: () => undefined,
      resume: () => { net.resumed += 1; },
    });
    onResponse(response);
    if (net.scenario === 'status_404') return;
    if (net.scenario === 'oversize') {
      for (let i = 0; i < 20; i += 1) response.emit('data', 'A'.repeat(4096)); // 80 KiB
      response.emit('end');
      return;
    }
    response.emit('data', net.scenario === 'not_cert' ? '<html>not a certificate</html>' : '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
    response.emit('end');
  });
  return request;
}

jest.mock('https', () => ({ __esModule: true, default: { get: (...a: unknown[]) => (fakeGet as never as (...x: unknown[]) => unknown)(...a) }, get: (...a: unknown[]) => (fakeGet as never as (...x: unknown[]) => unknown)(...a) }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('no database in this suite'); } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import {
  CERTIFICATE_FETCH_TIMEOUT_MS,
  CERTIFICATE_MAX_BYTES,
  __clearSnsCertificateCacheForTests,
  fetchSigningCertificate,
} from '../../../pages/api/webhooks/ses';

const URL_OK = 'https://sns.eu-north-1.amazonaws.com/SimpleNotificationService-abc.pem';

beforeEach(() => {
  net.scenario = 'ok';
  net.calls = [];
  net.destroyed = 0;
  net.resumed = 0;
  __clearSnsCertificateCacheForTests();
});

describe('WP3 hardening — the real certificate fetcher', () => {
  it('fetches a certificate with the 5 s timeout, then serves it from cache', async () => {
    expect(CERTIFICATE_FETCH_TIMEOUT_MS).toBe(5000);
    const first = await fetchSigningCertificate(URL_OK);
    const second = await fetchSigningCertificate(URL_OK);
    expect(first).toContain('BEGIN CERTIFICATE');
    expect(second).toBe(first);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0]).toEqual({ url: URL_OK, timeout: 5000 });
  });

  it('a TIMEOUT yields null and destroys the request', async () => {
    net.scenario = 'timeout';
    expect(await fetchSigningCertificate(URL_OK)).toBeNull();
    expect(net.destroyed).toBe(1);
  });

  it(`a response over ${CERTIFICATE_MAX_BYTES} bytes yields null and destroys the request`, async () => {
    net.scenario = 'oversize';
    expect(await fetchSigningCertificate(URL_OK)).toBeNull();
    expect(net.destroyed).toBeGreaterThanOrEqual(1);
  });

  it('a non-200 response yields null and its body is discarded', async () => {
    net.scenario = 'status_404';
    expect(await fetchSigningCertificate(URL_OK)).toBeNull();
    expect(net.resumed).toBe(1);
  });

  it('a body that is not a certificate yields null and is NOT cached', async () => {
    net.scenario = 'not_cert';
    expect(await fetchSigningCertificate(URL_OK)).toBeNull();
    expect(await fetchSigningCertificate(URL_OK)).toBeNull();
    expect(net.calls).toHaveLength(2);
  });

  it('a network error yields null', async () => {
    net.scenario = 'error';
    expect(await fetchSigningCertificate(URL_OK)).toBeNull();
  });

  it.each([
    'https://evil.example/cert.pem',
    'http://sns.eu-north-1.amazonaws.com/x.pem',
    'https://sns.eu-north-1.amazonaws.com/x.txt',
    'https://sns.eu-north-1.amazonaws.com.evil.example/x.pem',
  ])('refuses %s WITHOUT opening a connection', async (url) => {
    expect(await fetchSigningCertificate(url)).toBeNull();
    expect(net.calls).toHaveLength(0);
  });
});
