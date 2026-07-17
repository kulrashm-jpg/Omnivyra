/**
 * PROD-CX-004 §2/§8 — the STAGED DNS-existence classifier. Distinguishes a
 * unanimous, definitive "this domain does not exist" (the only hard-reject
 * signal) from a real domain whose website we merely could not reach. Every
 * resolver seam (c-ares, getaddrinfo, DoH, MX, NS) is injected so the mapping is
 * exercised hermetically — no real DNS or network.
 */
import { classifyDomainDnsDefault, type DomainDnsResolvers } from '../../services/companyIdentityValidationService';

const records = (ips: string[]) => async () => ips;
const empty = async () => [] as string[];
const rejectWith = (code: string) => async () => {
  const err = new Error(code) as Error & { code?: string };
  err.code = code;
  throw err;
};

/** Every resolver reports a DEFINITIVE absence — the unanimous "nothing" base. */
const blank: DomainDnsResolvers = {
  resolve4: rejectWith('ENOTFOUND'),
  resolve6: rejectWith('ENOTFOUND'),
  lookup: rejectWith('ENOTFOUND'),
  resolveMx: rejectWith('ENODATA'),
  resolveNs: rejectWith('ENOTFOUND'),
  dohQuery: empty,
};

describe('classifyDomainDnsDefault — staged multi-resolver existence', () => {
  it('has_records when c-ares A resolves', async () => {
    const r = await classifyDomainDnsDefault('acme.com', { ...blank, resolve4: records(['1.2.3.4']) });
    expect(r).toBe('has_records');
  });

  it('has_records via getaddrinfo when c-ares fails (the SNIS class)', async () => {
    // c-ares (resolve4/6) spuriously fails on serverless, but getaddrinfo — the
    // OS resolver the real HTTP request uses — resolves the host. Must PASS.
    const r = await classifyDomainDnsDefault('snis.edu.in', {
      ...blank,
      resolve4: rejectWith('ENODATA'),
      resolve6: rejectWith('ENODATA'),
      lookup: records(['160.153.0.196']),
    });
    expect(r).toBe('has_records');
  });

  it('has_records via DoH when c-ares AND getaddrinfo both fail', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      ...blank,
      dohQuery: async (_name, type) => (type === 'A' ? ['1.2.3.4'] : []),
    });
    expect(r).toBe('has_records');
  });

  it('has_records via DoH AAAA (IPv6-only web host)', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      ...blank,
      dohQuery: async (_name, type) => (type === 'AAAA' ? ['2606:4700::1'] : []),
    });
    expect(r).toBe('has_records');
  });

  it('resolver disagreement resolves to has_records when ANY resolver sees the host', async () => {
    // Cloudflare/Google union (modeled by the injected dohQuery) surfaces a
    // record even though c-ares + getaddrinfo saw nothing → PASS, never reject.
    const r = await classifyDomainDnsDefault('acme.com', {
      ...blank,
      resolve4: rejectWith('ENOTFOUND'),
      lookup: rejectWith('ENOTFOUND'),
      dohQuery: async (_n, type) => (type === 'A' ? ['203.0.113.7'] : []),
    });
    expect(r).toBe('has_records');
  });

  it('registered_no_web when only MX exists (mail, no web host)', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      ...blank,
      resolveMx: records(['mail.acme.com']),
    });
    expect(r).toBe('registered_no_web');
  });

  it('registered_no_web when only NS exists (delegated zone, no web host)', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      ...blank,
      resolveNs: records(['ns1.registrar.com']),
    });
    expect(r).toBe('registered_no_web');
  });

  it('registered_no_web when only DoH MX answers', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      ...blank,
      dohQuery: async (_n, type) => (type === 'MX' ? ['10 mail.acme.com'] : []),
    });
    expect(r).toBe('registered_no_web');
  });

  it('no_records ONLY when every resolver is unanimously definitive-absent', async () => {
    const r = await classifyDomainDnsDefault('this-domain-does-not-exist.example', blank);
    expect(r).toBe('no_records');
  });

  it('transient when a resolver flaked (ESERVFAIL) and nothing definitive was found', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      ...blank,
      resolve4: rejectWith('ESERVFAIL'),
      resolve6: rejectWith('ESERVFAIL'),
    });
    expect(r).toBe('transient');
  });

  it('transient on ETIMEOUT (never a hard reject)', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      ...blank,
      lookup: rejectWith('ETIMEOUT'),
    });
    expect(r).toBe('transient');
  });

  it('a single transient lookup overrides otherwise-definitive NXDOMAINs', async () => {
    // apex NXDOMAIN everywhere but www getaddrinfo timed out → transient, not
    // a hard reject.
    const r = await classifyDomainDnsDefault('acme.com', {
      ...blank,
      lookup: async (host: string) => {
        if (host.startsWith('www.')) {
          const err = new Error('ETIMEOUT') as Error & { code?: string };
          err.code = 'ETIMEOUT';
          throw err;
        }
        const err = new Error('ENOTFOUND') as Error & { code?: string };
        err.code = 'ENOTFOUND';
        throw err;
      },
    });
    expect(r).toBe('transient');
  });

  it('web host beats MX — has_records short-circuits before Stage 2', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      ...blank,
      resolve4: records(['1.2.3.4']),
      resolveMx: records(['mail.acme.com']),
    });
    expect(r).toBe('has_records');
  });
});
