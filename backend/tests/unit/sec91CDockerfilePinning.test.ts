/**
 * SEC-C9 (STEP 3AH-91) — container images are reproducible from reviewed
 * inputs: every Dockerfile.* base image is pinned by digest and every
 * dependency install is a lockfile install (`npm ci`), never `npm install`
 * (which may resolve newer versions than package-lock.json records).
 */
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const dockerfiles = fs.readdirSync(REPO).filter((f) => /^Dockerfile(\..+)?$/.test(f));

describe('Dockerfiles are pinned and lockfile-installed', () => {
  it('finds the worker and cron Dockerfiles', () => {
    expect(dockerfiles).toEqual(expect.arrayContaining(['Dockerfile.worker', 'Dockerfile.cron']));
  });

  it.each(dockerfiles)('%s', (file) => {
    const lines = fs.readFileSync(path.join(REPO, file), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const froms = lines.filter((l) => /^FROM\s/i.test(l));
    expect(froms.length).toBeGreaterThan(0);
    for (const from of froms) {
      expect(from).toMatch(/^FROM\s+\S+@sha256:[0-9a-f]{64}(\s+AS\s+\S+)?$/i);
    }
    const installs = lines.filter((l) => /\bnpm\s+(install|i|ci)\b/.test(l));
    expect(installs.length).toBeGreaterThan(0);
    for (const l of installs) expect(l).not.toMatch(/\bnpm\s+(install|i)\b/);
  });

  it('the cron image compiles with the same alias rewrite as the worker image', () => {
    expect(fs.readFileSync(path.join(REPO, 'Dockerfile.cron'), 'utf8')).toContain('node scripts/fix-worker-aliases.js');
  });
});
