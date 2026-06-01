import { expectContainsAll, listRepoFiles, readRepoFile } from '../contracts/stabilityTestUtils';

describe('stability/runtime safety contract', () => {
  test('dev startup does not invoke operator scripts or auth repair tools', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> };
    const startAll = readRepoFile('scripts/start-all.js');

    expect(pkg.scripts.dev).toBe('node scripts/start-all.js --app-only');
    expect(pkg.scripts['dev:app']).toBe('node scripts/start-all.js --app-only');
    expect(pkg.scripts['dev:full']).toBe('node scripts/start-all.js');
    expect(startAll).not.toContain('scripts/operator');
    expect(startAll).not.toContain('repair-local-login');
    expect(startAll).not.toContain('auth:repair-login');
  });

  test('runtime app code does not import operator scripts or operator safety helpers', () => {
    const runtimeFiles = [
      ...listRepoFiles('pages', ['.ts', '.tsx', '.js', '.jsx']),
      ...listRepoFiles('components', ['.ts', '.tsx', '.js', '.jsx']),
      ...listRepoFiles('hooks', ['.ts', '.tsx', '.js', '.jsx']),
      ...listRepoFiles('lib', ['.ts', '.tsx', '.js', '.jsx']),
      ...listRepoFiles('backend', ['.ts', '.tsx', '.js', '.jsx']),
    ];

    // Test files are not runtime app code — they legitimately import operator
    // tooling to exercise it and are never bundled into the shipped app.
    const isTestFile = (file: string) =>
      /(?:\.test\.|\.spec\.|(?:^|\/)(?:tests|__tests__|__mocks__)\/)/.test(file);

    const offenders = runtimeFiles.filter((file) => {
      if (isTestFile(file)) return false;
      const source = readRepoFile(file);
      return source.includes('scripts/operator') || source.includes('operatorSafety');
    });

    expect(offenders).toEqual([]);
  });

  test('startup env validation remains a validation command, not an operator mutation command', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> };
    const envValidation = readRepoFile('scripts/validate_startup_env.ts');

    expect(pkg.scripts['env:validate']).toBe('tsx scripts/validate_startup_env.ts');
    expect(envValidation).not.toContain('.insert(');
    expect(envValidation).not.toContain('.update(');
    expect(envValidation).not.toContain('.delete(');
    expect(envValidation).not.toContain('supabase.auth.admin');
  });

  test('operator scripts retain explicit safety gates and cannot be package-dev startup dependencies', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> };
    const operatorSafety = readRepoFile('scripts/_core/operatorSafety.ts');

    expectContainsAll(operatorSafety, [
      'requireExplicitMutationIntent',
      'requireTargetEnvironment',
      'requireProductionConfirmation',
      'detectRemoteSupabase',
      'Missing explicit mutation intent flag',
    ]);

    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (name === 'dev' || name === 'dev:app' || name === 'dev:full' || name === 'start' || name === 'prestart') {
        expect(command).not.toContain('scripts/operator');
      }
    }
  });
});
