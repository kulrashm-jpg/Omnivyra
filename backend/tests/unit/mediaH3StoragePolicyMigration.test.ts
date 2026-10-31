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
