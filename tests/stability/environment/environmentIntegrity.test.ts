import {
  collectEnvironmentIntegrityFindings,
  collectVercelVisibilityFindings,
} from '../../../config/integrity/environmentIntegrity';
import { expectContainsAll, readRepoFile } from '../contracts/stabilityTestUtils';

describe('stability/environment integrity diagnostics', () => {
  test('Supabase target consistency reports mixed project refs as warn-only findings', () => {
    const findings = collectEnvironmentIntegrityFindings({
      NODE_ENV: 'development',
      SUPABASE_URL: 'https://server-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_URL: 'https://public-ref.supabase.co',
      SUPABASE_DB_URL: 'postgres://postgres:pass@db.server-ref.supabase.co:5432/postgres',
    } as NodeJS.ProcessEnv);

    expect(findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'MIXED_SUPABASE_PROJECT_REFS',
      'LOCAL_ENV_POINTS_REMOTE',
      'SERVER_PUBLIC_SUPABASE_MISMATCH',
    ]));
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
  });

  test('environment integrity validator is readonly and warn-only', () => {
    const source = readRepoFile('config/integrity/environmentIntegrity.ts');

    expectContainsAll(source, [
      'collectEnvironmentIntegrityFindings',
      'runEnvironmentIntegrity',
      'exitWarnOnly',
      'parseProjectRef',
      'MIXED_SUPABASE_PROJECT_REFS',
      'collectVercelVisibilityFindings',
      'STATIC_CONFIG_MIXED_SUPABASE_REFS',
    ]);
    expect(source).not.toContain('writeFile');
    expect(source).not.toContain('.insert(');
    expect(source).not.toContain('.update(');
    expect(source).not.toContain('.delete(');
  });

  test('Vercel/static env visibility scan is diagnostic only', () => {
    const findings = collectVercelVisibilityFindings();

    expect(Array.isArray(findings)).toBe(true);
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
  });
});
