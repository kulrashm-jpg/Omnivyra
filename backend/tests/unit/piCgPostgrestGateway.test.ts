/**
 * `scripts/ci/pi-cg-postgrest-gateway.js` — direct tests.
 *
 * The gateway reproduces ONE behaviour of Supabase's own API gateway: stripping
 * the `/rest/v1` prefix in front of a bare PostgREST, so the repository's real
 * supabase-js client can be exercised unmodified. Until now it was covered only
 * TRANSITIVELY — the PostgREST integration suite happened to pass through it —
 * which proves the methods and headers that suite uses and nothing else. These
 * tests drive it directly.
 *
 * THE ARTEFACT UNDER TEST IS THE REAL FILE, SPAWNED AS CI SPAWNS IT.
 * `node scripts/ci/pi-cg-postgrest-gateway.js` with the two port variables, and
 * a local HTTP server standing in for PostgREST. Nothing is imported: the script
 * calls `server.listen` at module scope, and importing it would both bind a port
 * inside jest and mean the thing tested was no longer the thing CI runs.
 *
 * CI ONLY, and it stays that way: the gateway is not imported by application
 * code, and a test below asserts that.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import http from 'http';
import net from 'net';
import path from 'path';

type Seen = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
};

/** What the stub upstream should answer with next. */
const reply = {
  status: 200,
  headers: { 'content-type': 'application/json', 'x-upstream': 'yes' } as Record<string, string>,
  body: '[{"ok":true}]',
};

let seen: Seen[] = [];
let upstream: http.Server;
let upstreamPort = 0;
let gateway: ChildProcessWithoutNullStreams | null = null;
let gatewayPort = 0;
/** A gateway whose upstream port is closed, for the 502 path. */
let deadGateway: ChildProcessWithoutNullStreams | null = null;
let deadGatewayPort = 0;

const GATEWAY = path.join(__dirname, '..', '..', '..', 'scripts', 'ci', 'pi-cg-postgrest-gateway.js');

/** A port nothing is listening on: bound, read, released. */
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address() as net.AddressInfo;
    s.close(() => resolve(port));
  });
});

/** Spawn the real script and resolve once it prints its ready line. */
const startGateway = (listenPort: number, targetPort: number): Promise<ChildProcessWithoutNullStreams> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GATEWAY], {
      env: {
        ...process.env,
        PI_CG_GATEWAY_PORT: String(listenPort),
        PI_CG_POSTGREST_PORT: String(targetPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    const timer = setTimeout(() => reject(new Error('gateway did not report ready')), 10_000);
    child.stdout.on('data', (d: Buffer) => {
      if (d.toString().includes('pi-cg gateway:')) { clearTimeout(timer); resolve(child); }
    });
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
  });

interface Res { status: number; headers: http.IncomingHttpHeaders; body: string }

const call = (
  port: number,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Res> => new Promise((resolve, reject) => {
  const req = http.request(
    { host: '127.0.0.1', port, path: url, method: init.method ?? 'GET', headers: init.headers },
    (r) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => resolve({
        status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks).toString(),
      }));
    },
  );
  req.once('error', reject);
  if (init.body !== undefined) req.write(init.body);
  req.end();
});

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        method: String(req.method),
        url: String(req.url),
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(reply.status, reply.headers);
      res.end(reply.body);
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
  upstreamPort = (upstream.address() as net.AddressInfo).port;

  gatewayPort = await freePort();
  gateway = await startGateway(gatewayPort, upstreamPort);

  // A second gateway aimed at a port nothing serves, for the failure path.
  deadGatewayPort = await freePort();
  deadGateway = await startGateway(deadGatewayPort, await freePort());
}, 30_000);

afterAll(async () => {
  gateway?.kill();
  deadGateway?.kill();
  await new Promise<void>((r) => upstream.close(() => r()));
});

beforeEach(() => {
  seen = [];
  reply.status = 200;
  reply.headers = { 'content-type': 'application/json', 'x-upstream': 'yes' };
  reply.body = '[{"ok":true}]';
});

describe('pi-cg PostgREST gateway — path mapping', () => {
  it('1. strips the /rest/v1 prefix, which is the one behaviour it exists for', async () => {
    const res = await call(gatewayPort, '/rest/v1/contact_governance_records?select=id');
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/contact_governance_records?select=id');
  });

  it('2. an EXACT /rest/v1 becomes /, not the empty string', async () => {
    // `req.url.slice(PREFIX.length)` is '' here, and an empty path would make the
    // upstream request invalid, so it must fall back to '/'.
    const res = await call(gatewayPort, '/rest/v1');
    expect(res.status).toBe(200);
    expect(seen[0].url).toBe('/');
  });

  it('3. a non-prefixed request is forwarded unchanged', async () => {
    await call(gatewayPort, '/');
    await call(gatewayPort, '/contact_governance_records?select=id');
    expect(seen.map((s) => s.url)).toEqual(['/', '/contact_governance_records?select=id']);
  });

  it('3b. a path that merely BEGINS with the prefix text is not stripped', async () => {
    // `/rest/v1x` is not `/rest/v1` and does not start with `/rest/v1/`, so a
    // careless `startsWith(PREFIX)` would corrupt it into `x`. It must pass
    // through whole.
    await call(gatewayPort, '/rest/v1x/table');
    await call(gatewayPort, '/rest/v1_other');
    expect(seen.map((s) => s.url)).toEqual(['/rest/v1x/table', '/rest/v1_other']);
  });

  it('3c. only the FIRST prefix is removed — a repeated one survives as a path', async () => {
    await call(gatewayPort, '/rest/v1/rest/v1/t');
    expect(seen[0].url).toBe('/rest/v1/t');
  });

  it('5. the query string is preserved exactly, including commas and encoding', async () => {
    await call(gatewayPort, '/rest/v1/t?select=id,read_at&id=eq.%2B1&order=id.asc');
    expect(seen[0].url).toBe('/t?select=id,read_at&id=eq.%2B1&order=id.asc');
  });
});

describe('pi-cg PostgREST gateway — request fidelity', () => {
  it('4. the method is preserved, including the ones PostgREST uses for writes', async () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS']) {
      seen = [];
      await call(gatewayPort, '/rest/v1/t', { method });
      expect(seen[0].method).toBe(method);
    }
  });

  it('4b. a request body is forwarded byte for byte', async () => {
    const body = JSON.stringify({ target_normalized: '+15550100001', channel: 'whatsapp' });
    await call(gatewayPort, '/rest/v1/t', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    expect(seen[0].body).toBe(body);
  });

  it('6. Authorization and the PostgREST headers arrive unchanged', async () => {
    await call(gatewayPort, '/rest/v1/t', {
      headers: {
        authorization: 'Bearer test-service-role-token',
        apikey: 'test-anon-key',
        accept: 'application/vnd.pgrst.object+json',
        prefer: 'return=representation,count=exact',
        'accept-profile': 'public',
        'content-profile': 'public',
        'x-client-info': 'supabase-js/2.0.0',
      },
    });
    const h = seen[0].headers;
    expect(h.authorization).toBe('Bearer test-service-role-token');
    expect(h.apikey).toBe('test-anon-key');
    expect(h.accept).toBe('application/vnd.pgrst.object+json');
    expect(h.prefer).toBe('return=representation,count=exact');
    expect(h['accept-profile']).toBe('public');
    expect(h['content-profile']).toBe('public');
    expect(h['x-client-info']).toBe('supabase-js/2.0.0');
  });

  it('6b. `host` is replaced by the upstream’s own, not forwarded', async () => {
    // The script deletes `host` so the upstream sees itself. If it were
    // forwarded, a caller could make the upstream believe it was serving some
    // other name — and virtual-host routing would follow the caller.
    await call(gatewayPort, '/rest/v1/t', { headers: { host: 'evil.example.com' } });
    expect(seen[0].headers.host).toBe(`127.0.0.1:${upstreamPort}`);
    expect(seen[0].headers.host).not.toBe('evil.example.com');
  });
});

describe('pi-cg PostgREST gateway — response fidelity', () => {
  it('7. status, headers and body come back exactly as the upstream sent them', async () => {
    reply.status = 206;
    reply.headers = {
      'content-type': 'application/json; charset=utf-8',
      'content-range': '0-0/1',
      'x-upstream': 'marker',
    };
    reply.body = '[{"id":"g1","read_at":"2026-10-05T00:00:00.000000+00:00"}]';

    const res = await call(gatewayPort, '/rest/v1/contact_governance_records?select=id,read_at');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('0-0/1');
    expect(res.headers['x-upstream']).toBe('marker');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.body).toBe(reply.body);
  });

  it('7b. a PostgREST REFUSAL is passed through, not turned into a gateway error', async () => {
    // The whole value of the proof is that a real refusal — a role without
    // EXECUTE on the computed field — is what the caller sees.
    reply.status = 403;
    reply.headers = { 'content-type': 'application/json' };
    reply.body = '{"code":"42501","message":"permission denied for function read_at"}';

    const res = await call(gatewayPort, '/rest/v1/contact_governance_records?select=read_at');
    expect(res.status).toBe(403);
    expect(res.body).toBe(reply.body);
    expect(JSON.parse(res.body).code).toBe('42501');
    expect(res.body).not.toContain('pi-cg-postgrest-gateway');
  });

  it('7c. an empty upstream body stays empty, with the upstream status', async () => {
    reply.status = 204;
    reply.headers = {};
    reply.body = '';
    const res = await call(gatewayPort, '/rest/v1/t', { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(res.body).toBe('');
  });
});

describe('pi-cg PostgREST gateway — failure and confinement', () => {
  it('8. an unreachable upstream yields 502 with the documented body and a real reason', async () => {
    const res = await call(deadGatewayPort, '/rest/v1/t?select=id');
    expect(res.status).toBe(502);
    expect(res.headers['content-type']).toBe('application/json');

    const payload = JSON.parse(res.body);
    expect(payload.gateway).toBe('pi-cg-postgrest-gateway');
    expect(typeof payload.upstreamPort).toBe('number');
    // Never a blank error: an empty body is what made the first failure of this
    // job hard to read, and the comment in the script says so.
    expect(typeof payload.error).toBe('string');
    expect(payload.error.length).toBeGreaterThan(0);
    expect(payload.error).toMatch(/ECONNREFUSED|connect/i);
  });

  it('9. the upstream host is FIXED at loopback — no input can redirect it', async () => {
    const code = require('fs').readFileSync(GATEWAY, 'utf8') as string;
    const body = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // The upstream address is a literal, and the only configuration is two ports.
    expect(body).toContain("host: '127.0.0.1'");
    expect(body).toContain("server.listen(LISTEN_PORT, '127.0.0.1'");
    const envReads = body.match(/process\.env\.[A-Z_]+/g) ?? [];
    expect([...new Set(envReads)].sort()).toEqual(['process.env.PI_CG_GATEWAY_PORT', 'process.env.PI_CG_POSTGREST_PORT']);
    // No way to name a host, and nothing reads one from a header or the URL.
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).not.toContain('req.headers.host');
  });

  it('9b. it listens on loopback only, so nothing off-host can reach it', async () => {
    // Proven by behaviour, not only by reading the source: a connect to the
    // machine's routable address must be refused while loopback answers.
    const external = Object.values(require('os').networkInterfaces())
      .flat()
      .filter((i: any) => i && i.family === 'IPv4' && !i.internal)
      .map((i: any) => i.address);

    await expect(call(gatewayPort, '/rest/v1/t')).resolves.toMatchObject({ status: 200 });

    for (const addr of external) {
      await expect(new Promise((resolve, reject) => {
        const s = net.createConnection({ host: addr, port: gatewayPort });
        s.once('connect', () => { s.destroy(); resolve('connected'); });
        s.once('error', reject);
        s.setTimeout(3000, () => { s.destroy(); reject(new Error('timeout')); });
      })).rejects.toBeDefined();
    }
  }, 20_000);

  it('the gateway is CI-only: no application code imports it', () => {
    const { execFileSync } = require('child_process');
    const root = path.join(__dirname, '..', '..', '..');
    let hits = '';
    try {
      hits = execFileSync(
        'git',
        ['grep', '-l', 'pi-cg-postgrest-gateway', '--', 'backend', 'pages', 'lib', 'hooks', 'components'],
        { cwd: root, encoding: 'utf8' },
      );
    } catch {
      hits = '';   // git grep exits 1 when nothing matches
    }
    const offenders = hits.split('\n').filter((f) => f && !f.includes('/tests/'));
    expect(offenders).toEqual([]);
  });
});
