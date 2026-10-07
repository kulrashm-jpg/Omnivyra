/**
 * gov intake — human credential freshness (pure units + the default reader's launch shape).
 *
 * Hermetic: `reg` is never actually launched — child_process.execFile is replaced by a
 * jest spy that records the argv/options and answers with a canned result. No registry
 * read, no network, no real credential value.
 */
import childProcess from 'node:child_process';
import { defaultGovDeps, readWindowsUserEnv } from '../../../scripts/jev-flow/cli';
import { INTAKE_FRESHNESS_VARS, checkIntakeCredentialFreshness, parseRegQueryValue, type UserEnvRead } from '../../../scripts/jev-flow/intakeJira';

// Built at runtime; never credential-shaped.
const TOKEN = ['human', 'test', 'value'].join('-');
const ROTATED = ['human', 'rotated', 'value'].join('-');
const EMAIL = 'human@example.invalid';
const ENV = { GOV_INTAKE_EMAIL: EMAIL, GOV_INTAKE_TOKEN: TOKEN };
const fresh = async (n: string): Promise<UserEnvRead> => ({ state: 'present', value: (ENV as Record<string, string>)[n] });

const regOut = (name: string, type: string, value: string) => `\r\nHKEY_CURRENT_USER\\Environment\r\n    ${name}    ${type}    ${value}\r\n\r\n`;

describe('parseRegQueryValue', () => {
  it('reads a REG_SZ value and a non-expanding REG_EXPAND_SZ value', () => {
    expect(parseRegQueryValue('GOV_INTAKE_TOKEN', regOut('GOV_INTAKE_TOKEN', 'REG_SZ', TOKEN), 0)).toEqual({ state: 'present', value: TOKEN });
    expect(parseRegQueryValue('GOV_INTAKE_EMAIL', regOut('GOV_INTAKE_EMAIL', 'REG_EXPAND_SZ', EMAIL), 0)).toEqual({ state: 'present', value: EMAIL });
  });

  it('exit 1 with no output = absent; any other failure = unavailable', () => {
    expect(parseRegQueryValue('GOV_INTAKE_TOKEN', null, 1)).toEqual({ state: 'absent' });
    for (const code of [2, null, 0]) expect(parseRegQueryValue('GOV_INTAKE_TOKEN', null, code).state).toBe('unavailable');
  });

  it('an empty value is absent', () => {
    expect(parseRegQueryValue('GOV_INTAKE_TOKEN', `\r\nHKEY_CURRENT_USER\\Environment\r\n    GOV_INTAKE_TOKEN    REG_SZ    \r\n`, 0)).toEqual({ state: 'absent' });
  });

  it('an unexpanded %VAR% expandable string, another type, or another name is unavailable (never guessed)', () => {
    expect(parseRegQueryValue('GOV_INTAKE_TOKEN', regOut('GOV_INTAKE_TOKEN', 'REG_EXPAND_SZ', '%OTHER%'), 0).state).toBe('unavailable');
    expect(parseRegQueryValue('GOV_INTAKE_TOKEN', regOut('GOV_INTAKE_TOKEN', 'REG_BINARY', 'ABCD'), 0).state).toBe('unavailable');
    expect(parseRegQueryValue('GOV_INTAKE_TOKEN', regOut('GOV_INTAKE_EMAIL', 'REG_SZ', EMAIL), 0).state).toBe('unavailable');
    expect(parseRegQueryValue('GOV_INTAKE_TOKEN', '', 0).state).toBe('unavailable');
  });

  it('unavailable reasons are fixed strings that never embed registry output', () => {
    const r = parseRegQueryValue('GOV_INTAKE_TOKEN', regOut('GOV_INTAKE_TOKEN', 'REG_EXPAND_SZ', `%X%${TOKEN}`), 0);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe('checkIntakeCredentialFreshness', () => {
  it('checks exactly GOV_INTAKE_EMAIL and GOV_INTAKE_TOKEN, and passes when both match', async () => {
    expect([...INTAKE_FRESHNESS_VARS]).toEqual(['GOV_INTAKE_EMAIL', 'GOV_INTAKE_TOKEN']);
    const reads: string[] = [];
    const r = await checkIntakeCredentialFreshness(ENV, async (n) => {
      reads.push(n);
      return fresh(n);
    });
    expect(r).toEqual({ ok: true });
    expect(reads).toEqual(['GOV_INTAKE_EMAIL', 'GOV_INTAKE_TOKEN']);
  });

  it('surrounding whitespace is not a mismatch', async () => {
    expect((await checkIntakeCredentialFreshness({ GOV_INTAKE_EMAIL: ` ${EMAIL} `, GOV_INTAKE_TOKEN: TOKEN }, async (n) => ({ state: 'present', value: `${(ENV as Record<string, string>)[n]} ` }))).ok).toBe(true);
  });

  it('stale token / stale email: refused with the fixed message naming only the variable', async () => {
    for (const [name, value] of [
      ['GOV_INTAKE_TOKEN', ROTATED],
      ['GOV_INTAKE_EMAIL', 'other@example.invalid'],
    ] as const) {
      const r = await checkIntakeCredentialFreshness(ENV, async (n) => ({ state: 'present', value: n === name ? value : (ENV as Record<string, string>)[n] }));
      expect(r).toEqual({ ok: false, variable: name, message: `${name} process environment is stale; refresh the process environment from the Windows User environment before retrying.` });
      expect(JSON.stringify(r)).not.toContain(TOKEN);
      expect(JSON.stringify(r)).not.toContain(ROTATED);
    }
  });

  it('a value differing only in its last character is stale', async () => {
    const r = await checkIntakeCredentialFreshness(ENV, async (n) => ({ state: 'present', value: n === 'GOV_INTAKE_TOKEN' ? `${TOKEN.slice(0, -1)}X` : EMAIL }));
    expect(r.ok).toBe(false);
  });

  it('missing in the process: refused without reading the User environment for it', async () => {
    const reads: string[] = [];
    const r = await checkIntakeCredentialFreshness({ GOV_INTAKE_EMAIL: EMAIL, GOV_INTAKE_TOKEN: '  ' }, async (n) => {
      reads.push(n);
      return fresh(n);
    });
    expect(r).toEqual({ ok: false, variable: 'GOV_INTAKE_TOKEN', message: 'GOV_INTAKE_TOKEN is not set in this process' });
    expect(reads).toEqual(['GOV_INTAKE_EMAIL']);
  });

  it('missing in the User environment: refused', async () => {
    const r = await checkIntakeCredentialFreshness(ENV, async (n) => (n === 'GOV_INTAKE_TOKEN' ? { state: 'absent' } : fresh(n)));
    expect(r).toMatchObject({ ok: false, variable: 'GOV_INTAKE_TOKEN', message: 'GOV_INTAKE_TOKEN is not set in the Windows User environment; set it there, then refresh this process' });
  });

  it('unavailable or a throwing reader: refused with a fixed reason (the error text is never surfaced)', async () => {
    const un = await checkIntakeCredentialFreshness(ENV, async () => ({ state: 'unavailable', reason: 'the Windows User environment is only available on Windows' }));
    expect(un).toMatchObject({ ok: false, variable: 'GOV_INTAKE_EMAIL' });
    expect((un as { message: string }).message).toBe('cannot verify GOV_INTAKE_EMAIL freshness: the Windows User environment is only available on Windows; refusing (the Windows User environment is the authoritative source)');
    const th = await checkIntakeCredentialFreshness(ENV, async () => {
      throw new Error(`leak ${TOKEN}`);
    });
    expect(th.ok).toBe(false);
    expect(JSON.stringify(th)).not.toContain(TOKEN);
  });

  it('does not mutate the process environment', async () => {
    const env = { ...ENV };
    await checkIntakeCredentialFreshness(env, async (n) => ({ state: 'present', value: n === 'GOV_INTAKE_TOKEN' ? ROTATED : EMAIL }));
    expect(env).toEqual(ENV);
  });
});

describe('readWindowsUserEnv (default reader) — launch shape, without launching', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const setPlatform = (p: string) => Object.defineProperty(process, 'platform', { ...realPlatform, value: p });
  let spy: jest.SpyInstance;
  let answer: { err: (Error & { code?: unknown }) | null; stdout: string };
  beforeEach(() => {
    answer = { err: null, stdout: '' };
    spy = jest.spyOn(childProcess, 'execFile').mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: unknown, out: string, err: string) => void;
      cb(answer.err, answer.stdout, '');
      return {} as childProcess.ChildProcess;
    }) as unknown as typeof childProcess.execFile);
  });
  afterEach(() => {
    spy.mockRestore();
    Object.defineProperty(process, 'platform', realPlatform);
  });

  it('is the default gov dependency (production uses the Windows User environment reader)', () => {
    expect(defaultGovDeps().readUserEnv).toBe(readWindowsUserEnv);
  });

  it('non-Windows always refuses, without launching anything', async () => {
    for (const p of ['linux', 'darwin']) {
      setPlatform(p);
      expect(await readWindowsUserEnv('GOV_INTAKE_TOKEN')).toEqual({ state: 'unavailable', reason: 'the Windows User environment is only available on Windows' });
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses any name other than the two human-intake variables, without launching', async () => {
    setPlatform('win32');
    for (const n of ['JIRA_PROVISION_TOKEN', 'JEV_ADVISORY_TOKEN', 'PATH', 'GOV_INTAKE_TOKEN /f', '']) {
      expect((await readWindowsUserEnv(n as 'GOV_INTAKE_TOKEN')).state).toBe('unavailable');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('launches exactly `reg query HKCU\\Environment /v <name>` via execFile with no shell', async () => {
    setPlatform('win32');
    answer = { err: null, stdout: regOut('GOV_INTAKE_TOKEN', 'REG_SZ', TOKEN) };
    expect(await readWindowsUserEnv('GOV_INTAKE_TOKEN')).toEqual({ state: 'present', value: TOKEN });
    expect(spy).toHaveBeenCalledTimes(1);
    const [cmd, argv, opts] = spy.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(cmd).toBe('reg');
    expect(argv).toEqual(['query', 'HKCU\\Environment', '/v', 'GOV_INTAKE_TOKEN']);
    expect(opts.shell).toBe(false);
    expect(opts.windowsHide).toBe(true);
  });

  it('reg exit 1 (value not found) is absent; any other failure is unavailable', async () => {
    setPlatform('win32');
    answer = { err: Object.assign(new Error('x'), { code: 1 }), stdout: '' };
    expect(await readWindowsUserEnv('GOV_INTAKE_EMAIL')).toEqual({ state: 'absent' });
    answer = { err: Object.assign(new Error('x'), { code: 'ENOENT' }), stdout: '' };
    expect((await readWindowsUserEnv('GOV_INTAKE_EMAIL')).state).toBe('unavailable');
    answer = { err: Object.assign(new Error('x'), { code: 5 }), stdout: regOut('GOV_INTAKE_EMAIL', 'REG_SZ', EMAIL) };
    expect((await readWindowsUserEnv('GOV_INTAKE_EMAIL')).state).toBe('unavailable');
  });
});
