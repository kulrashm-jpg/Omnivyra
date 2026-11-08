#!/usr/bin/env node
/**
 * A Supabase-shaped path gateway in front of a bare PostgREST, for CI only.
 *
 * ─── WHY THIS IS NEEDED, AND WHY IT IS NOT A MOCK ───────────────────────────
 * The whole point of the PostgREST proof is to exercise the REPOSITORY'S OWN
 * client — `backend/db/supabaseClient.ts`, which calls
 * `createClient(SUPABASE_URL, key)`. supabase-js builds its REST base as
 * `${SUPABASE_URL}/rest/v1`, so `supabase.from('x').select()` requests
 * `/rest/v1/x`. A bare PostgREST serves tables at the ROOT, so every such
 * request arrives as a table named `rest` and fails. Run 42513889443 failed
 * exactly there, with a postgrest-js error object whose `message` was undefined.
 *
 * In production that mapping is done by Supabase's own API gateway (Kong), which
 * sits in front of PostgREST and strips the prefix. This reproduces THAT ONE
 * BEHAVIOUR and nothing else, so that the client under test can stay completely
 * unmodified. The alternative was to hand the client a custom `fetch` that
 * rewrote the path — which would mean the thing being tested was no longer the
 * client the application uses.
 *
 * It is a PATH REWRITE, not a stand-in for PostgREST:
 *   • it never answers a request itself, and has no table, row or verdict in it;
 *   • it forwards the method, every header and the body unchanged;
 *   • it returns PostgREST's own status, headers and body unchanged;
 *   • a request that does not begin with `/rest/v1` is forwarded as-is, so the
 *     suite's raw HTTP assertions and the readiness probe reach PostgREST
 *     directly through the same port.
 * If PostgREST refuses a request — an unauthenticated one, or a role without
 * EXECUTE on the computed field — that refusal is what the caller sees.
 *
 * CI ONLY. It binds loopback, takes no configuration beyond two ports, and is
 * never imported by application code.
 */

const http = require('http');

const LISTEN_PORT = Number(process.env.PI_CG_GATEWAY_PORT || 3000);
const TARGET_PORT = Number(process.env.PI_CG_POSTGREST_PORT || 3001);
const PREFIX = '/rest/v1';

const server = http.createServer((req, res) => {
  const path = req.url.startsWith(`${PREFIX}/`) || req.url === PREFIX
    ? (req.url.slice(PREFIX.length) || '/')
    : req.url;

  // `host` is dropped so the upstream sees its own; everything else is passed
  // through, including Authorization, Accept, Prefer and Content-Profile.
  const headers = { ...req.headers };
  delete headers.host;

  const upstream = http.request(
    { host: '127.0.0.1', port: TARGET_PORT, method: req.method, path, headers },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    // 502 and the real reason. Never an empty body: a blank error is the thing
    // that made the first failure of this job hard to read.
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ gateway: 'pi-cg-postgrest-gateway', upstreamPort: TARGET_PORT, error: String(err && err.message) }));
  });

  req.pipe(upstream);
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  process.stdout.write(`pi-cg gateway: 127.0.0.1:${LISTEN_PORT}${PREFIX}/* -> 127.0.0.1:${TARGET_PORT}/*\n`);
});
