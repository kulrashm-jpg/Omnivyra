/**
 * scripts/ci/t2-actor-fk-parity.js — actor-FK results compared HEAD vs BASE (#28).
 * Input mirrors `check-actor-fk-compatibility.js --json`. Each failure case names its
 * triggering input (#27).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/ci/t2-actor-fk-parity.js');
type F = { rule: string; severity: string; table: string; column: string; constraint?: string };
const E1: F = { rule: 'set_null_on_not_null', severity: 'error', table: 'a', column: 'x', constraint: 'a_fk' };
const E2: F = { rule: 'set_null_vs_check', severity: 'error', table: 'b', column: 'y', constraint: 'b_fk' };
const I1: F = { rule: 'registry_column_missing', severity: 'info', table: 'c', column: 'z' };
type Side = { errors?: F[]; known?: F[]; stale?: string[]; info?: F[]; tables?: number; countsError?: number; event?: string };
const side = (s: Side = {}) => {
  const errors = s.errors || [];
  const stale = s.stale || [];
  const r = {
    event: s.event ?? 'actor_fk_compatibility.check',
    findings: [...errors, ...(s.info || [])],
    known_open: s.known || [],
    stale_known: stale,
    counts: { error: s.countsError ?? errors.length + stale.length, warn: 0, info: (s.info || []).length },
    coverage: { tables: s.tables ?? 862, foreignKeys: 800, boundary: null },
  };
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'afk-')), 'r.json');
  fs.writeFileSync(f, JSON.stringify(r, null, 2));
  return f;
};
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const run = (head: string, base: string, det: string[] = ['--head-detector-sha', SHA_A, '--base-detector-sha', SHA_A]) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, '--head', head, '--base', base, ...det], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e: unknown) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: (err.stdout || '') + (err.stderr || '') };
  }
};

describe('t2-actor-fk-parity', () => {
  it('PASS: the same pre-existing errors and known-open on both sides (main carries debt)', () => {
    const s = { errors: [E1, E2], known: [E1], info: [I1] };
    const r = run(side(s), side(s));
    expect(r.code).toBe(0);
    expect(r.out).toContain('nothing new (2 error(s), 1 known-open pre-existing on base)');
  });
  it('PASS: zero findings on both sides', () => {
    expect(run(side(), side()).code).toBe(0);
  });
  it('PASS: an error truly resolved on head is reported, not failed', () => {
    const r = run(side({ errors: [E1] }), side({ errors: [E1, E2] }));
    expect(r.code).toBe(0);
    expect(r.out).toContain('RESOLVED ON HEAD (gone, not reclassified) (1)');
  });
  it('info findings are not part of the error identity set', () => {
    expect(run(side({ info: [I1] }), side()).code).toBe(0);
  });
  it('FAIL input: an error new on head', () => {
    const r = run(side({ errors: [E1, E2] }), side({ errors: [E1] }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('NEW ERROR ON HEAD (1)');
  });
  it('FAIL input: an ERROR moved to KNOWN OPEN on head (reclassification is not resolution)', () => {
    const r = run(side({ known: [E2] }), side({ errors: [E2] }));
    expect(r.code).toBe(1);
    expect(r.out).toContain('NEW KNOWN-OPEN ACKNOWLEDGEMENT ON HEAD');
    expect(r.out).not.toContain('RESOLVED ON HEAD');
  });
  it('FAIL input: a new stale acknowledgement on head', () => {
    const r = run(side({ stale: ['a.x'] }), side());
    expect(r.code).toBe(1);
    expect(r.out).toContain('NEW STALE ACKNOWLEDGEMENT ON HEAD (1)');
  });
  it('FAIL input: a missing result names the job, and for BASE names main + workflow_dispatch', () => {
    const missing = path.join(os.tmpdir(), 'nope-afk.json');
    expect(run(missing, side()).out).toContain('Real-schema replay + suites (head)');
    const b = run(side(), missing);
    expect(b.code).toBe(1);
    expect(b.out).toContain('defect on main');
    expect(b.out).toContain('workflow_dispatch');
  });
  it('FAIL input: output that is not JSON (the checker misbehaved)', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'afk-')), 'r.json');
    fs.writeFileSync(f, '{"event":"actor_fk_compatibility.check"\n[actor-fk] FAILED: boom\n');
    expect(run(f, side()).out).toContain('checker misbehaved: its output is not JSON');
  });
  it('FAIL input: JSON without the checker event', () => {
    expect(run(side({ event: 'other' }), side()).out).toContain('no actor_fk_compatibility.check event');
  });
  it('FAIL input: 0 tables (not a replayed catalog)', () => {
    expect(run(side({ tables: 0 }), side()).out).toContain('not a replayed catalog');
  });
  it('FAIL input: counts.error disagrees with the listed errors + stale (refuse to compare)', () => {
    expect(run(side({ errors: [E1], countsError: 3 }), side({ errors: [E1] })).out).toContain('refusing to compare');
  });
  it('FAIL input: pre-registering an acknowledgement for a finding not yet present (stale on head)', () => {
    const r = run(side({ stale: ['b.y'] }), side());
    expect(r.code).toBe(1);
    expect(r.out).toContain('NEW STALE ACKNOWLEDGEMENT ON HEAD');
  });

  describe('same detector on both sides', () => {
    const ackFile = (content: string) => {
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'afkack-')), 'ack.txt');
      fs.writeFileSync(f, content);
      return f;
    };
    it('FAIL input: the detector differs on head (a weakened rule would read as resolved), even with findings gone', () => {
      const r = run(side(), side({ errors: [E1] }), ['--head-detector-sha', SHA_B, '--base-detector-sha', SHA_A]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('differs between HEAD');
      expect(r.out).not.toContain('RESOLVED ON HEAD');
    });
    it('FAIL input: a detector hash missing or malformed', () => {
      expect(run(side(), side(), []).out).toContain('detector hashes missing or malformed');
      expect(run(side(), side(), ['--head-detector-sha', 'xyz', '--base-detector-sha', SHA_A]).code).toBe(1);
    });
    it('FAIL input: both hashes are sha256 of empty input (detector absent at both refs) - never "identical"', () => {
      const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const r = run(side(), side(), ['--head-detector-sha', EMPTY, '--base-detector-sha', EMPTY]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('empty or absent');
      expect(r.out).not.toContain('identical');
    });
    it('FAIL input: an ack for a DIFFERENT sha does not cover the head detector', () => {
      const r = run(side(), side(), ['--head-detector-sha', SHA_B, '--base-detector-sha', SHA_A, '--detector-ack', ackFile(`${SHA_A} # old\n`)]);
      expect(r.code).toBe(1);
    });
    it('FAIL input: an ack line without a reason', () => {
      const r = run(side(), side(), ['--head-detector-sha', SHA_B, '--base-detector-sha', SHA_A, '--detector-ack', ackFile(`${SHA_B}\n`)]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('"<sha256> # <reason>"');
    });
    it('FAIL input: an ack for the sha BOTH sides already run (stale after merge)', () => {
      const r = run(side(), side(), ['--head-detector-sha', SHA_A, '--base-detector-sha', SHA_A, '--detector-ack', ackFile(`${SHA_A} # merged change\n`)]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('STALE DETECTOR ACK');
    });
    it('PASS: identical detector, ack file has only comments', () => {
      const r = run(side(), side(), ['--head-detector-sha', SHA_A, '--base-detector-sha', SHA_A, '--detector-ack', ackFile('# nothing\n')]);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`detector identical on both sides (${SHA_A})`);
    });
    it('PASS: a changed detector acknowledged by head sha with a reason', () => {
      const r = run(side(), side(), ['--head-detector-sha', SHA_B, '--base-detector-sha', SHA_A, '--detector-ack', ackFile(`# reviewed\n${SHA_B} # rule X tightened, reviewed by virality-05\n`)]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('detector CHANGED on HEAD');
    });
  });
});
