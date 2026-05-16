import { listRepoFiles, readRepoFile } from '../contracts/stabilityTestUtils';

describe('stability/runtime environment safety contract', () => {
  test('frontend-facing code does not reference service-role secrets', () => {
    const frontendFiles = [
      ...listRepoFiles('pages', ['.ts', '.tsx', '.js', '.jsx']),
      ...listRepoFiles('components', ['.ts', '.tsx', '.js', '.jsx']),
      ...listRepoFiles('hooks', ['.ts', '.tsx', '.js', '.jsx']),
    ];

    const offenders = frontendFiles.filter((file) => {
      if (file.startsWith('pages/api/')) return false;
      return readRepoFile(file).includes('SUPABASE_SERVICE_ROLE_KEY');
    });

    expect(offenders).toEqual([]);
  });

  test('environment namespace guard remains warn-only for runtime startup', () => {
    const namespace = readRepoFile('lib/env/namespace.ts');
    const supabaseClient = readRepoFile('backend/db/supabaseClient.ts');

    expect(namespace).toContain('checkEnvIsolationOnce');
    expect(supabaseClient).toContain('checkEnvIsolationOnce()');
    expect(supabaseClient).toContain('Warn-only cross-environment contamination check. Never blocks startup.');
  });
});
