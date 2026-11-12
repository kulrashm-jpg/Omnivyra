/**
 * scripts/ci/t2-parity.js — the gate behind the T2 GitHub Actions workflow (#28).
 * Each "must fail" case names the input that makes the gate fail (#27: in place of
 * mutation testing, every postcondition's failing input is named and exercised).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readSide, compare, SUITE_FAILED } = require('../../../scripts/ci/t2-parity.js');
const SCRIPT = path.resolve(__dirname, '../../../scripts/ci/t2-parity.js');

type T = { file: string; name: string; status: 'passed' | 'failed' | 'pending' };
const shard = (tests: T[], brokenSuites: string[] = []) => {
  const byFile = new Map<string, T[]>();
  for (const t of tests) byFile.set(t.file, [...(byFile.get(t.file) || []), t]);
  const testResults = [...byFile.entries()].map(([file, ts]) => ({
    name: file,
    status: ts.some((t) => t.status === 'failed') ? 'failed' : 'passed',
    assertionResults: ts.map((t) => ({ fullName: t.name, title: t.name, ancestorTitles: [], status: t.status })),
  }));
  for (const f of brokenSuites) testResults.push({ name: f, status: 'failed', assertionResults: [] });
  return { numTotalTests: tests.length, testResults };
};
const writeSide = (shards: object[]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2parity-'));
  shards.forEach((s, i) => fs.writeFileSync(path.join(dir, `shard-${i + 1}.json`), JSON.stringify(s)));
  return dir;
};
const many = (n: number, file = 'backend/tests/unit/a.test.ts', status: T['status'] = 'passed'): T[] =>
  Array.from({ length: n }, (_, i) => ({ file, name: `t${i}`, status }));
const run = (head: string, base: string, extra: string[] = []) => {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--head', head, '--base', base, '--shards', '2', '--min-tests', '4', ...extra], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: (err.stdout || '') + (err.stderr || '') };
  }
};

describe('t2-parity gate', () => {
  it('PASS: identical sides with a pre-existing failure on both (debt is reported, not new)', () => {
    const sides = () => writeSide([shard([...many(3), { file: 'f.test.ts', name: 'old', status: 'failed' }]), shard(many(3, 'b.test.ts'))]);
    const r = run(sides(), sides());
    expect(r.code).toBe(0);
    expect(r.out).toContain('T2 PARITY PASS');
    expect(r.out).toContain('"pre_existing_failures":1');
  });

  it('FAIL input: a test passing on base and failing on head', () => {
    const base = writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const headTests = many(4);
    headTests[2] = { ...headTests[2], status: 'failed' };
    const head = writeSide([shard(headTests), shard(many(3, 'b.test.ts'))]);
    const r = run(head, base);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ONLY FAILING ON HEAD (1)');
    expect(r.out).toContain('backend/tests/unit/a.test.ts::t2');
  });

  it('FAIL input: a brand-new test that fails on head (absent on base)', () => {
    const base = writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard([...many(4), { file: 'n.test.ts', name: 'new', status: 'failed' }]), shard(many(3, 'b.test.ts'))]);
    expect(run(head, base).code).toBe(1);
  });

  it('FAIL input: a suite that fails to run on head but ran on base', () => {
    const base = writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard(many(4), ['b.test.ts']), shard([])]);
    const r = run(head, base);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`b.test.ts::${SUITE_FAILED}`);
  });

  it('FAIL input: a missing shard on either side', () => {
    const full = writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const short = writeSide([shard(many(7))]);
    expect(run(short, full).out).toContain('expected 2 shard result(s), found 1');
    expect(run(full, short).code).toBe(1);
  });

  it('FAIL input: a side below the test floor (0 tests must not pass)', () => {
    const empty = writeSide([shard([]), shard([])]);
    const r = run(empty, empty);
    expect(r.code).toBe(1);
    expect(r.out).toContain('below the floor');
  });

  it('FAIL input: no test identity in common (vacuous comparison), even with enough tests each side', () => {
    const head = writeSide([shard(many(4, 'x.test.ts')), shard(many(3, 'y.test.ts'))]);
    const base = writeSide([shard(many(4, 'p.test.ts')), shard(many(3, 'q.test.ts'))]);
    const r = run(head, base);
    expect(r.code).toBe(1);
    expect(r.out).toContain('EMPTY');
  });

  it('FAIL input: an unreadable shard file', () => {
    const base = writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    fs.writeFileSync(path.join(head, 'shard-2.json'), '{not json');
    expect(run(head, base).out).toContain('not valid jest JSON');
  });

  it('pending/skipped tests are neither executed nor failing', () => {
    const dir = writeSide([shard([...many(2), { file: 'a', name: 'skip', status: 'pending' }]), shard([])]);
    const side = readSide(dir, 2, 'X');
    expect(side.total).toBe(2);
    expect(compare(side, side, { minTests: 1 }).problems).toEqual([]);
  });
  it('FAIL input: a FAILING test that is .skip()ed on head (the cheapest red-to-green) is NOT reported as fixed', () => {
    const baseTests = [...many(4), { file: 'f.test.ts', name: 'broken', status: 'failed' as const }];
    const headTests = [...many(4), { file: 'f.test.ts', name: 'broken', status: 'pending' as const }];
    const base = writeSide([shard(baseTests), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard(headTests), shard(many(3, 'b.test.ts'))]);
    const r = run(head, base, ['--max-drop-pct', '50']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('DOES NOT RUN ON HEAD (deleted, renamed or skipped; not acknowledged) (1)');
    expect(r.out).not.toContain('FIXED ON HEAD');
  });

  it('FAIL input: a passing test deleted on head', () => {
    const base = writeSide([shard(many(5)), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const r = run(head, base, ['--max-drop-pct', '50']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('backend/tests/unit/a.test.ts::t4');
  });

  it('PASS: a removal listed in the acknowledgement file with a reason', () => {
    const base = writeSide([shard(many(5)), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, '# intentional removals\nbackend/tests/unit/a.test.ts::t4 # replaced by realschema suite X (owner OK)\n');
    const r = run(head, base, ['--max-drop-pct', '50', '--ack', ack]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('(acknowledged) (1)');
  });

  it('FAIL input: an acknowledgement line without a reason is rejected', () => {
    const side = () => writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, 'backend/tests/unit/a.test.ts::t4\n');
    const r = run(side(), side(), ['--ack', ack]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('needs a reason');
  });

  it('FAIL input: HEAD runs more than --max-drop-pct fewer tests than BASE (relative, no stale constant)', () => {
    const extra = Array.from({ length: 10 }, (_, i) => ({ file: 'z.test.ts', name: `z${i}`, status: 'passed' as const }));
    const base = writeSide([shard([...many(4), ...extra]), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const ackLines = extra.map((t) => `z.test.ts::${t.name} # bulk test`).join('\n');
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, ackLines + '\n');
    const r = run(head, base, ['--ack', ack]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('a drop of more than 2%');
  });

  it('a failing test that runs and passes on head IS reported as fixed', () => {
    const base = writeSide([shard([...many(4), { file: 'f.test.ts', name: 'x', status: 'failed' as const }]), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard([...many(4), { file: 'f.test.ts', name: 'x', status: 'passed' as const }]), shard(many(3, 'b.test.ts'))]);
    const r = run(head, base);
    expect(r.code).toBe(0);
    expect(r.out).toContain('FIXED ON HEAD (failed on base, runs and passes on head) (1)');
  });

  it('PASS: a rename acknowledgement whose replacement RUNS on head', () => {
    const base = writeSide([shard([...many(4), { file: 'r.test.ts', name: 'old title', status: 'passed' as const }]), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard([...many(4), { file: 'r.test.ts', name: 'new title', status: 'passed' as const }]), shard(many(3, 'b.test.ts'))]);
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, 'r.test.ts::old title -> r.test.ts::new title # assertion inverted by mode B\n');
    const r = run(head, base, ['--max-drop-pct', '50', '--ack', ack]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('-> r.test.ts::new title');
  });

  it('FAIL input: a rename acknowledgement whose replacement does NOT run on head (the ack cannot excuse a vanished test)', () => {
    const base = writeSide([shard([...many(4), { file: 'r.test.ts', name: 'old title', status: 'passed' as const }]), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, 'r.test.ts::old title -> r.test.ts::new title # claimed rename\n');
    const r = run(head, base, ['--max-drop-pct', '50', '--ack', ack]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('name a replacement that does NOT run on HEAD');
    expect(r.out).toContain('DOES NOT RUN ON HEAD (deleted, renamed or skipped; not acknowledged) (1)');
  });

  it('FAIL input: a rename line with an empty side is rejected', () => {
    const side = () => writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, 'a.test.ts::t1 ->  # no target\n');
    const r = run(side(), side(), ['--ack', ack]);
    expect(r.code).toBe(1);
  });

  it('a test NAME containing " -> " still splits correctly (the unique split leaving two jest ids)', () => {
    const base = writeSide([shard([...many(4), { file: 'r.test.ts', name: 'state queued -> sent', status: 'passed' as const }]), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard([...many(4), { file: 'r.test.ts', name: 'state queued -> refused', status: 'passed' as const }]), shard(many(3, 'b.test.ts'))]);
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, 'r.test.ts::state queued -> sent -> r.test.ts::state queued -> refused # DMs refused\n');
    const r = run(head, base, ['--max-drop-pct', '50', '--ack', ack]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('-> r.test.ts::state queued -> refused');
  });

  it('FAIL input: an ack whose id is not a jest id (path.test.ext::name) is refused by line number', () => {
    const side = () => writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, '# header\nnot-an-id # reason\n');
    const r = run(side(), side(), ['--ack', ack]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ack.txt:2');
    expect(r.out).toContain('is not a jest test id');
  });

  it('a .spec.* test can be acknowledged, as a plain ack and as either side of a rename (virality-05)', () => {
    const base = writeSide([shard([...many(4), { file: 'w.spec.ts', name: 'old', status: 'passed' as const }, { file: 'g.spec.ts', name: 'gone', status: 'passed' as const }]), shard(many(3, 'b.test.ts'))]);
    const head = writeSide([shard([...many(4), { file: 'w.spec.ts', name: 'new', status: 'passed' as const }]), shard(many(3, 'b.test.ts'))]);
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, 'w.spec.ts::old -> w.spec.ts::new # renamed in abc\ng.spec.ts::gone # deleted in def: covered by x\n');
    const r = run(head, base, ['--max-drop-pct', '50', '--ack', ack]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('(acknowledged) (2)');
  });

  it('stale acknowledgements are grouped by their [track] tag', () => {
    const side = () => writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, '[pi-e1] gone.test.ts::old # deleted in abc: covered by x\n[outreach-6f] other.test.ts::old # deleted in def\n');
    const r = run(side(), side(), ['--ack', ack]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('track [pi-e1]');
    expect(r.out).toContain('track [outreach-6f]');
  });

  it('a stale acknowledgement (matches no removed test) is a WARNING, not a failure', () => {
    const side = () => writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
    const ack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2ack-')), 'ack.txt');
    fs.writeFileSync(ack, 'gone.test.ts::old # deleted in abc123: covered by b.test.ts::t0\n');
    const r = run(side(), side(), ['--ack', ack]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('WARNING: STALE ACKNOWLEDGEMENTS, track [untagged]');
  });
});

describe('t2-parity quarantine (e9 2026-11-12: flaky tests get reason + owner, no retry loops)', () => {
  const F = 'backend/tests/unit/a.test.ts';
  const qfile = (body: string) => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't2q-')), 'q.txt');
    fs.writeFileSync(p, body);
    return p;
  };
  const Q = (id: string) => `${id} # FLAKY-T-1 owner=track-x track=post-launch reason=wall-clock bound\n`;
  const baseSide = () => writeSide([shard(many(4)), shard(many(3, 'b.test.ts'))]);
  const headWith = (failing: string[]) => writeSide([
    shard(many(4).map((t) => (failing.includes(t.name) ? { ...t, status: 'failed' as const } : t))),
    shard(many(3, 'b.test.ts')),
  ]);
  it('CONTROL: without a quarantine, a HEAD-only failure fails the gate', () => {
    const r = run(headWith(['t1']), baseSide());
    expect(r.code).toBe(1);
    expect(r.out).toContain('1 test(s) fail on HEAD that do not fail on BASE');
  });
  it('a HEAD-only failure of a QUARANTINED test is reported, not counted', () => {
    const r = run(headWith(['t1']), baseSide(), ['--quarantine', qfile(Q(`${F}::t1`))]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('QUARANTINED (failed only on HEAD; known flaky, NOT counted) (1)');
    expect(r.out).toContain('FLAKY-T-1 owner=track-x');
    expect(r.out).toContain('"quarantined_failures":1');
  });
  it('the quarantine excuses ONLY its own id: another HEAD-only failure still fails', () => {
    const r = run(headWith(['t1', 't2']), baseSide(), ['--quarantine', qfile(Q(`${F}::t1`))]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('1 test(s) fail on HEAD that do not fail on BASE');
  });
  it('a quarantine never excuses a REMOVED test', () => {
    const head = writeSide([shard(many(3)), shard(many(3, 'b.test.ts'))]); // t3 no longer runs
    const r = run(head, baseSide(), ['--quarantine', qfile(Q(`${F}::t3`))]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('do not run on HEAD');
  });
  it('a malformed quarantine line (no FLAKY id / owner / reason) refuses the run', () => {
    const r = run(headWith(['t1']), baseSide(), ['--quarantine', qfile(`${F}::t1 # flaky\n`)]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/quarantine lines need/);
  });
});
