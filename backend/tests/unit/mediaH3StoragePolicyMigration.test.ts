/**
 * H-3 independent review (Agent A) — static contract for the MEDIA-H3 storage
 * policy migration and its rollback. The behavioural proof (policies executed
 * on a real PG17 with a storage-schema shim, SET ROLE anon/authenticated/
 * service_role) lives in the review evidence (H3-STORAGE-POLICY-TESTS.md);
 * this guard keeps the migration and rollback in lock-step in CI.
 */
import fs from 'fs';
import path from 'path';

const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations');
const ROLLBACKS = path.join(MIGRATIONS, 'rollbacks');

const migrationFile = fs.readdirSync(MIGRATIONS).filter((f) => /media_h3_storage_quarantine_policies\.sql$/.test(f));
const rollbackFile = fs.readdirSync(ROLLBACKS).filter((f) => /media_h3_storage_quarantine_policies_rollback\.sql$/.test(f));

const EXPECTED_POLICIES = [
  'media_h3_deny_client_insert',
  'media_h3_deny_client_update',
  'media_h3_deny_client_delete',
  'media_h3_deny_client_quarantine_select',
  'media_h3_deny_client_delivery_select',
];

describe('MEDIA-H3 storage policy migration', () => {
  it('exists exactly once, with a matching rollback of the same version', () => {
    expect(migrationFile).toHaveLength(1);
    expect(rollbackFile).toHaveLength(1);
    expect(rollbackFile[0].slice(0, 14)).toBe(migrationFile[0].slice(0, 14));
  });

  it('does not share its 14-digit version with any other migration', () => {
    const version = migrationFile[0].slice(0, 14);
    const sameVersion = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f.startsWith(version));
    expect(sameVersion).toEqual(migrationFile);
  });

  const sql = migrationFile.length ? fs.readFileSync(path.join(MIGRATIONS, migrationFile[0]), 'utf8') : '';
  const rollback = rollbackFile.length ? fs.readFileSync(path.join(ROLLBACKS, rollbackFile[0]), 'utf8') : '';

  it.each(EXPECTED_POLICIES)('%s is RESTRICTIVE, scoped to anon+authenticated, and dropped by the rollback', (name) => {
    const create = new RegExp(`CREATE POLICY ${name} ON storage\\.objects\\s+AS RESTRICTIVE FOR \\w+ TO anon, authenticated`);
    expect(sql).toMatch(create);
    expect(rollback).toContain(`DROP POLICY IF EXISTS ${name} ON storage.objects`);
  });

  it('client SELECT on the delivery bucket is denied (no key enumeration via /object/list)', () => {
    expect(sql).toMatch(/media_h3_deny_client_delivery_select[\s\S]*?FOR SELECT[\s\S]*?USING \(bucket_id <> 'media-uploads'\)/);
  });

  it('every policy the migration creates is one the rollback drops (no orphan policy)', () => {
    const created = [...sql.matchAll(/CREATE POLICY (\w+) ON storage\.objects/g)].map((m) => m[1]).sort();
    const dropped = [...rollback.matchAll(/DROP POLICY IF EXISTS (\w+) ON storage\.objects/g)].map((m) => m[1]).sort();
    expect(created).toEqual([...EXPECTED_POLICIES].sort());
    expect(dropped).toEqual(created);
  });

  it('the quarantine bucket is forced private and the rollback never deletes buckets or objects', () => {
    expect(sql).toMatch(/'media-quarantine', 'media-quarantine', false/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE\s+SET public = false/);
    expect(rollback).not.toMatch(/DELETE FROM storage\.|DROP TABLE|storage\.buckets/i);
  });

  it('is a guarded no-op where the storage schema does not exist (real-schema CI replay)', () => {
    expect(sql).toMatch(/to_regclass\('storage\.buckets'\) IS NULL OR to_regclass\('storage\.objects'\) IS NULL/);
    expect(rollback).toMatch(/to_regclass\('storage\.objects'\) IS NULL/);
  });
});

/**
 * J1 H3-1 deployment guard (documentation-as-test). The H-3 code must not ship
 * before 20270111000000 is applied. What enforces that today:
 *   - the PRIVATE `media-quarantine` bucket is created ONLY by this migration,
 *     so before it is applied `upload-media-authorize` cannot mint a signed
 *     upload token (503; mediaH3UploadAuthorize.test.ts) and finalize finds no
 *     quarantined object (404): the new flow is inert, it does not fail open;
 *   - the rollback deliberately keeps the bucket and drops only the deny
 *     policies, so AFTER a rollback the flow keeps running while clients may
 *     again write `media-uploads`. That window is what J1 H3-1 exploited; the
 *     in-code control for it is verifyExistingDeliveryObject (finalize refuses a
 *     delivery object that is not the validated one).
 * There is no runtime probe of the storage policies (the app has no read access
 * to pg_policies through PostgREST); the release checklist must apply the
 * migration first. J1-FIXES.md records this.
 */
describe('J1 H3-1 deployment guard: code-before-migration is inert, rollback window is covered in code', () => {
  it('no other migration creates the media-quarantine bucket', () => {
    const creators = fs.readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => /INSERT INTO storage\.buckets[\s\S]*?'media-quarantine'/i.test(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')));
    expect(creators).toEqual(migrationFile);
  });
  it('the rollback keeps the bucket (so the in-code delivery check is the control after a rollback)', () => {
    const rollbackSql = fs.readFileSync(path.join(ROLLBACKS, rollbackFile[0]), 'utf8');
    expect(rollbackSql).not.toMatch(/storage\.buckets/i);
    const service = fs.readFileSync(path.resolve(__dirname, '../../services/activityWorkspace/quarantinedMediaUpload.ts'), 'utf8');
    expect(service).toMatch(/export async function verifyExistingDeliveryObject/);
    expect(service).toMatch(/const match = await verifyExistingDeliveryObject\(objectPath, validated\)/);
  });
});

