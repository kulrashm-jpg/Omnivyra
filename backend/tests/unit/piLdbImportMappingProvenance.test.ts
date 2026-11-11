/**
 * PI-LDB D: field-level mapping provenance - the server RE-VERIFIES the
 * browser's mapping before anything is stamped (coordinator ruling 2026-11-11).
 */
import { verifyImportMapping, parseSubmittedMapping } from '../../services/leadMapping/importMappingProvenance';
import { mappingProvenanceColumns, MAPPING_PROVENANCE_WRITES_ENABLED } from '../../services/prospectIdentity/ingestionBoundary';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-00000000u001'.replace('u', 'a');
const APPROVER = '00000000-0000-4000-8000-0000000000ap'.replace('ap', 'a9');
const FP = 'a'.repeat(64);
const NOW = '2026-11-11T12:00:00.000Z';
const PROFILE = {
  profileId: 'prof-1', version: 2, sourceSchemaFingerprint: FP, headers: ['Designation', 'Email', 'Company'],
  entries: [
    { sourceField: 'Designation', target: 'jobTitle', transformation: 'trim', approvedBy: APPROVER, approvedAt: '2026-11-01T00:00:00Z' },
    { sourceField: 'Company', target: 'companyName', transformation: 'trim', approvedBy: APPROVER, approvedAt: '2026-11-01T00:00:00Z' },
  ],
};
const run = (mapping: unknown, loadProfile: (k: unknown) => Promise<unknown> = async () => PROFILE) =>
  verifyImportMapping({ organizationId: ORG, source: 'csv', mapping, principalUserId: USER, now: NOW, loadProfile: loadProfile as never });

describe('verification', () => {
  it('a pair the SERVER-LOADED profile approved -> approved_profile_match with that profile and the entry approver', async () => {
    const v = await run({ schemaFingerprint: FP, profileId: 'prof-1', fields: [{ sourceField: 'designation ', target: 'jobTitle', method: 'approved_profile_match' }] });
    expect(v.person.job_title).toEqual({ sourceField: 'designation ', mappingMethod: 'approved_profile_match', mappingProfileId: 'prof-1', approvedBy: APPROVER, approvedAt: '2026-11-01T00:00:00Z' });
    expect(v.verifiedProfileId).toBe('prof-1');
  });

  it('a PLATFORM (vendor) profile match is cited in platformMappingProfileId, never in the tenant column (step E)', async () => {
    const v = await run(
      { schemaFingerprint: FP, fields: [{ sourceField: 'Designation', target: 'jobTitle', method: 'approved_profile_match' }] },
      async () => ({ ...PROFILE, profileId: 'plat-1', scope: 'platform' }),
    );
    expect(v.person.job_title).toEqual({
      sourceField: 'Designation', mappingMethod: 'approved_profile_match',
      platformMappingProfileId: 'plat-1', approvedBy: APPROVER, approvedAt: '2026-11-01T00:00:00Z',
    });
    expect(v.person.job_title.mappingProfileId).toBeUndefined();
    expect(v.verifiedProfileId).toBe('plat-1');
    // And the insert columns put it in the platform FK column, scope 'platform'.
    const cols = mappingProvenanceColumns(v.person.job_title, true);
    expect(cols).toMatchObject({ mapping_profile_id: null, platform_mapping_profile_id: 'plat-1', platform_mapping_profile_scope: 'platform' });
  });

  it('the profile is looked up by (tenant, source, fingerprint) - a request-supplied id is NEVER used', async () => {
    const keys: unknown[] = [];
    const v = await run({ schemaFingerprint: FP, profileId: 'someone-elses-profile', fields: [{ sourceField: 'Designation', target: 'jobTitle', method: 'approved_profile_match' }] },
      async (k) => { keys.push(k); return PROFILE; });
    expect(keys).toEqual([{ organizationId: ORG, source: 'csv', schemaFingerprint: FP }]);
    expect(v.person.job_title.mappingProfileId).toBe('prof-1');   // the loaded one, not the claimed one
  });

  it('a claimed profile match the profile does NOT contain -> tenant_confirmed, NO profile id, approved by the verified principal', async () => {
    const v = await run({ schemaFingerprint: FP, profileId: 'prof-1', fields: [{ sourceField: 'Designation', target: 'department', method: 'approved_profile_match' }] });
    expect(v.person.department).toEqual({ sourceField: 'Designation', mappingMethod: 'tenant_confirmed', approvedBy: USER, approvedAt: NOW });
    expect(v.person.department.mappingProfileId).toBeUndefined();
    expect(v.verifiedProfileId).toBeNull();
  });

  it('no stored profile, or an unreadable one -> downgraded, never refused', async () => {
    for (const load of [async () => null, async () => { throw new Error('read_failed'); }]) {
      const v = await run({ schemaFingerprint: FP, fields: [{ sourceField: 'Designation', target: 'jobTitle', method: 'approved_profile_match' }] }, load);
      expect(v.person.job_title.mappingMethod).toBe('tenant_confirmed');
      expect(v.person.job_title.mappingProfileId).toBeUndefined();
    }
  });

  it('tenant_override is kept; high_confidence_suggestion carries NO approver', async () => {
    const v = await run({ schemaFingerprint: FP, fields: [
      { sourceField: 'Title2', target: 'department', method: 'tenant_override' },
      { sourceField: 'Mail', target: 'email', method: 'high_confidence_suggestion' },
    ] }, async () => null);
    expect(v.person.department).toMatchObject({ mappingMethod: 'tenant_override', approvedBy: USER });
    expect(v.person.email).toEqual({ sourceField: 'Mail', mappingMethod: 'high_confidence_suggestion' });
  });

  it('routes by the registry ENTITY to the right attribute column (company fields -> account)', async () => {
    const v = await run({ schemaFingerprint: FP, fields: [{ sourceField: 'Company', target: 'companyName', method: 'approved_profile_match' }] });
    expect(Object.keys(v.account)).toHaveLength(1);
    expect(v.person).toEqual({});
  });

  it('unknown targets, unknown methods and a target fed by TWO columns get NO provenance', async () => {
    const v = await run({ schemaFingerprint: FP, fields: [
      { sourceField: 'X', target: 'not_a_field', method: 'tenant_confirmed' },
      { sourceField: 'Y', target: 'jobTitle', method: 'made_up' },
      { sourceField: 'A', target: 'department', method: 'tenant_confirmed' },
      { sourceField: 'B', target: 'department', method: 'tenant_confirmed' },
    ] }, async () => null);
    expect(v.person).toEqual({});
    expect(v.unstamped).toEqual({ invalid: 2, duplicateTarget: 2 });
  });

  it('a malformed description yields nothing (and is not an error)', async () => {
    for (const m of [null, 'x', { schemaFingerprint: 'nothex', fields: [] }, { schemaFingerprint: FP, fields: [] }, { schemaFingerprint: FP, fields: [{ sourceField: 1 }] }]) {
      expect(parseSubmittedMapping(m)).toBeNull();
      const v = await run(m);
      expect(v.person).toEqual({});
      expect(v.account).toEqual({});
    }
  });
});

describe('the insert columns (gated)', () => {
  const prov = { sourceField: 'Designation', mappingMethod: 'approved_profile_match' as const, mappingProfileId: 'prof-1', approvedBy: APPROVER, approvedAt: '2026-11-01T00:00:00Z' };

  it('OFF until 20270211000001 is live: no provenance column is ever named', () => {
    expect(MAPPING_PROVENANCE_WRITES_ENABLED).toBe(false);
    expect(mappingProvenanceColumns(prov)).toEqual({});
  });

  it('when enabled: the columns, tenant profile exclusive of platform, approval coherent', () => {
    expect(mappingProvenanceColumns(prov, true)).toEqual({
      source_field: 'Designation', mapping_method: 'approved_profile_match', mapping_profile_id: 'prof-1',
      platform_mapping_profile_id: null, platform_mapping_profile_scope: null,
      approved_by: APPROVER, approved_at: '2026-11-01T00:00:00Z',
    });
    expect(mappingProvenanceColumns({ ...prov, platformMappingProfileId: 'plat-1' }, true).platform_mapping_profile_id).toBeNull();
    expect(mappingProvenanceColumns({ sourceField: 'X', mappingMethod: 'tenant_confirmed', platformMappingProfileId: 'plat-1' }, true))
      .toMatchObject({ platform_mapping_profile_id: 'plat-1', platform_mapping_profile_scope: 'platform', mapping_profile_id: null });
    expect(mappingProvenanceColumns({ sourceField: 'X', mappingMethod: 'tenant_confirmed', approvedBy: USER }, true))
      .toMatchObject({ approved_by: null, approved_at: null });          // approver without a time -> neither
  });
});
