/**
 * Phase 14D — Digital Adoption Intelligence tests (pure, deterministic).
 */

import {
  classifyAdoption,
  analyzeDigitalAdoption,
  adoptionFromReadiness,
  CAPABILITIES,
  type AdoptionCompany,
  type AdoptionState,
  type Capability,
} from '../../services/digitalAdoptionService';

const caps = (over: Partial<Record<Capability, AdoptionState>> = {}): Record<Capability, AdoptionState> => {
  const base = Object.fromEntries(CAPABILITIES.map((c) => [c, 'NOT_STARTED'])) as Record<Capability, AdoptionState>;
  return { ...base, ...over };
};
const co = (over: Partial<AdoptionCompany> = {}): AdoptionCompany => ({
  company_id: 'c1', company_name: 'Acme', is_active: false, capabilities: caps(), ...over,
});

describe('classifyAdoption', () => {
  it('NOT_STARTED at 0 adopted', () => {
    const c = classifyAdoption(co());
    expect(c.adoption_status).toBe('NOT_STARTED');
    expect(c.adoption_score).toBe(0);
  });
  it('ADOPTED when all 7 capabilities adopted (score 100)', () => {
    const c = classifyAdoption(co({ capabilities: caps(Object.fromEntries(CAPABILITIES.map((x) => [x, 'ADOPTED']))) }));
    expect(c.adoption_status).toBe('ADOPTED');
    expect(c.adoption_score).toBe(100);
  });
  it('PARTIAL with some adopted; lists adopted + missing', () => {
    const c = classifyAdoption(co({ capabilities: caps({ PROFILE: 'ADOPTED', BILLING: 'ADOPTED' }) }));
    expect(c.adoption_status).toBe('PARTIAL');
    expect(c.adopted_capabilities).toEqual(['PROFILE', 'BILLING']);
    expect(c.missing_capabilities).toContain('GA');
    expect(c.adoption_score).toBe(Math.round((2 / 7) * 100)); // 29
  });
  it('UNKNOWN only when every capability is UNKNOWN', () => {
    expect(classifyAdoption(co({ capabilities: caps(Object.fromEntries(CAPABILITIES.map((x) => [x, 'UNKNOWN']))) })).adoption_status).toBe('UNKNOWN');
  });
  it('confidence MEDIUM when any capability UNKNOWN', () => {
    expect(classifyAdoption(co({ capabilities: caps({ GA: 'UNKNOWN' }) })).confidence).toBe('MEDIUM');
  });
});

describe('analyzeDigitalAdoption — funnel + matrix + paths', () => {
  const companies = [
    co({ company_id: 'a', is_active: true, capabilities: caps({ PROFILE: 'ADOPTED', DOMAIN_VERIFICATION: 'ADOPTED', BILLING: 'ADOPTED' }) }),
    co({ company_id: 'b', is_active: true, capabilities: caps({ PROFILE: 'ADOPTED', BILLING: 'ADOPTED' }) }),
    co({ company_id: 'c', is_active: false, capabilities: caps({ BILLING: 'ADOPTED' }) }),
    co({ company_id: 'd', is_active: false, capabilities: caps() }),
  ];
  const r = analyzeDigitalAdoption(companies);

  it('independent stage reach + conversion', () => {
    const by = Object.fromEntries(r.funnel.map((s) => [s.stage, s.reached]));
    expect(by.COMPANY_CREATED).toBe(4);
    expect(by.PROFILE_READY).toBe(2);   // a,b
    expect(by.BILLING_ACTIVE).toBe(3);  // a,b,c
    expect(by.ACTIVATED).toBe(2);
  });
  it('mean adoption score', () => {
    // scores: a=43 (3/7), b=29 (2/7), c=14 (1/7), d=0 → mean ≈ 21.5
    expect(r.mean_adoption_score).toBeCloseTo(21.5, 0);
  });
  it('capability matrix: present vs absent activation rates', () => {
    const profile = r.capability_matrix.find((c) => c.capability === 'PROFILE')!;
    expect(profile.ready).toBe(2);
    expect(profile.missing).toBe(2);
    expect(profile.rate_when_present).toBe(100); // a,b both active
    expect(profile.rate_when_absent).toBe(0);    // c,d inactive
  });
  it('top missing capabilities ranked by frequency', () => {
    expect(r.top_missing_capabilities[0].missing).toBeGreaterThanOrEqual(r.top_missing_capabilities[1].missing);
    expect(r.top_missing_capabilities[0].capability).not.toBe('BILLING'); // BILLING is most-present
  });
  it('paths split by activation; activated paths are capability signatures', () => {
    expect(r.paths_activated.map((p) => p.path)).toContain('PROFILE+DOMAIN_VERIFICATION+BILLING');
    expect(r.paths_non_activated.map((p) => p.path)).toContain('NONE'); // company d
  });
  it('status distribution', () => {
    expect(r.by_status.PARTIAL).toBe(3); // a,b,c have ≥1 adopted
    expect(r.by_status.NOT_STARTED).toBe(1); // d
  });
  it('deterministic', () => {
    expect(JSON.stringify(analyzeDigitalAdoption(companies))).toBe(JSON.stringify(r));
  });
});

describe('adoptionFromReadiness', () => {
  it('maps readiness states to adoption states', () => {
    const a = adoptionFromReadiness({
      company_id: 'x', company_name: 'X', tenant_status: 'ACTIVE',
      company_profile_ready: 'READY', website_ready: 'NOT_READY', ga_ready: 'UNKNOWN', gsc_ready: 'NOT_READY',
      social_ready: 'READY', team_ready: 'NOT_READY', billing_ready: 'READY',
    });
    expect(a.is_active).toBe(true);
    expect(a.capabilities.PROFILE).toBe('ADOPTED');
    expect(a.capabilities.DOMAIN_VERIFICATION).toBe('NOT_STARTED');
    expect(a.capabilities.GA).toBe('UNKNOWN');
  });
});
