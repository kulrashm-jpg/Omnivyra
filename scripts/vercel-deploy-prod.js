#!/usr/bin/env node
/**
 * Production Vercel deploy with explicit commit provenance.
 *
 * Vercel sets VERCEL_GIT_COMMIT_SHA to an EMPTY STRING on CLI deploys (there is
 * no git integration to populate it), so the deployed app cannot discover its
 * own commit. `config/provenanceEnv.ts` now refuses to treat that empty value as
 * a real SHA, which makes the absence explicit rather than silent — but the
 * value still has to come from somewhere. It comes from here.
 *
 * Supplying it in the deploy command (rather than relying on an operator to
 * remember `-e`) is what makes `/api/health/version` report the real commit by
 * default. Extra CLI args are passed through.
 */
const { execFileSync, execSync } = require('child_process');

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

const sha = git('rev-parse HEAD');
if (!/^[0-9a-f]{40}$/.test(sha)) {
  process.stderr.write(`REFUSING TO DEPLOY: 'git rev-parse HEAD' did not yield a 40-char SHA (got: ${sha || '<empty>'}).\n`);
  process.exit(1);
}

const dirty = git('status --porcelain');
if (dirty) {
  process.stderr.write(
    'REFUSING TO DEPLOY: working tree is not clean.\n' +
    'The injected VERCEL_GIT_COMMIT_SHA would claim a commit that does not\n' +
    'describe what is being uploaded.\n\n' + dirty + '\n',
  );
  process.exit(1);
}

const args = [
  '--prod',
  '--skip-domain',
  '--scope', 'rawats-projects-5fb9f1f3',
  '-e', `VERCEL_GIT_COMMIT_SHA=${sha}`,
  ...process.argv.slice(2),
];

process.stdout.write(`Deploying ${sha} (provenance injected explicitly)\n`);
execFileSync('vercel', args, { stdio: 'inherit', shell: true });
