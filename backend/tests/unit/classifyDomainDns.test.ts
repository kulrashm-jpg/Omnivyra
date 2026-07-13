/**
 * AUTH-VERIFY-001 rec #3 — coverage for the DNS transient-vs-definitive
 * classifier that decides whether a failed website probe is a HARD reject
 * (definitively no site) or a "try again" (transient). Resolver functions are
 * injected so the mapping is exercised hermetically (no real DNS).
 */
import { classifyDomainDnsDefault } from '../../services/companyIdentityValidationService';

const records = (ips: string[]) => async () => ips;
const rejectWith = (code: string) => async () => {
  const err = new Error(code) as Error & { code?: string };
  err.code = code;
  throw err;
};

describe('classifyDomainDnsDefault — transient vs definitive', () => {
  it('has_records when an A record resolves', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      resolve4: records(['1.2.3.4']),
      resolve6: rejectWith('ENODATA'),
    });
    expect(r).toBe('has_records');
  });

  it('no_records when apex + www are both NXDOMAIN (definitive)', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      resolve4: rejectWith('ENOTFOUND'),
      resolve6: rejectWith('ENOTFOUND'),
    });
    expect(r).toBe('no_records');
  });

  it('transient on ESERVFAIL', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      resolve4: rejectWith('ESERVFAIL'),
      resolve6: rejectWith('ESERVFAIL'),
    });
    expect(r).toBe('transient');
  });

  it('transient on ETIMEOUT', async () => {
    const r = await classifyDomainDnsDefault('acme.com', {
      resolve4: rejectWith('ETIMEOUT'),
      resolve6: rejectWith('ETIMEOUT'),
    });
    expect(r).toBe('transient');
  });

  it('never false-classifies as no_records when ANY lookup was transient', async () => {
    // apex NXDOMAIN but www times out → must be transient, not a hard reject.
    const r = await classifyDomainDnsDefault('acme.com', {
      resolve4: rejectWith('ENOTFOUND'),
      resolve6: rejectWith('ETIMEOUT'),
    });
    expect(r).toBe('transient');
  });
});
