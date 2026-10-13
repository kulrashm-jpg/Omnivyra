/**
 * Closure-014 (G) — process-wide loopback-only egress guard for certification
 * runtimes (the cert publish worker). Wraps net.connect / net.createConnection
 * / tls.connect — the primitives under http, https, ioredis, pg and undici
 * fetch — and refuses any TCP/TLS connection whose target host is not loopback.
 * Unix-domain sockets (`path`) are allowed. Refusals are recorded and thrown
 * synchronously, so a provider call cannot leave the process.
 *
 * Certification-only: never imported by production entry points.
 */
import net from 'net';
import tls from 'tls';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1']);
const refused: Array<{ host: string; port: number | null; at: string }> = [];
let installed = false;

export class EgressRefusedError extends Error {
  constructor(host: string) {
    super(`EGRESS_REFUSED: certification runtime may only connect to loopback (attempted ${host})`);
    this.name = 'EgressRefusedError';
  }
}

type ConnectArgs = unknown[];

function targetOf(args: ConnectArgs): { host: string | null; port: number | null; unix: boolean } {
  const [a, b] = args;
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    const o = a as { host?: string; hostname?: string; port?: number | string; path?: string };
    if (o.path) return { host: null, port: null, unix: true };
    return { host: String(o.host ?? o.hostname ?? 'localhost'), port: o.port != null ? Number(o.port) : null, unix: false };
  }
  if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) {
    return { host: typeof b === 'string' ? b : 'localhost', port: Number(a), unix: false };
  }
  if (typeof a === 'string') return { host: null, port: null, unix: true }; // net.connect(path)
  return { host: 'localhost', port: null, unix: false };
}

function check(args: ConnectArgs): void {
  const t = targetOf(args);
  if (t.unix) return;
  const host = String(t.host ?? '').toLowerCase();
  if (!LOOPBACK.has(host)) {
    refused.push({ host, port: t.port, at: new Date().toISOString() });
    throw new EgressRefusedError(host);
  }
}

/** Install once per process. Returns a function that reports refused attempts. */
export function installLoopbackEgressGuard(): () => ReadonlyArray<{ host: string; port: number | null; at: string }> {
  if (!installed) {
    installed = true;
    const origConnect = net.connect;
    const origCreate = net.createConnection;
    const origTls = tls.connect;
    (net as { connect: unknown }).connect = (...args: ConnectArgs) => { check(args); return (origConnect as (...a: ConnectArgs) => net.Socket)(...args); };
    (net as { createConnection: unknown }).createConnection = (...args: ConnectArgs) => { check(args); return (origCreate as (...a: ConnectArgs) => net.Socket)(...args); };
    (tls as { connect: unknown }).connect = (...args: ConnectArgs) => { check(args); return (origTls as (...a: ConnectArgs) => tls.TLSSocket)(...args); };
  }
  return () => refused;
}
