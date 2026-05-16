#!/usr/bin/env node
/**
 * Pre-deploy verification (READ-ONLY — never deploys, never tags).
 *
 * Vercel is manual-CLI-only here (vercel.json: git.deploymentEnabled=false),
 * so deployments carry no Git metadata. This guard makes a manual deploy
 * traceable by refusing to proceed from an unclean tree and printing the
 * exact commit + the tag command to run AFTER a successful deploy.
 *
 * Exit 1 (block) if the working tree is dirty — you must never deploy a
 * snapshot that does not correspond to a committed, pushed SHA.
 */
const { execSync } = require('child_process');

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

const porcelain = git('status --porcelain');
const sha = git('rev-parse HEAD');
const shortSha = git('rev-parse --short HEAD');
const branch = git('rev-parse --abbrev-ref HEAD');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `-${pad(now.getHours())}${pad(now.getMinutes())}`;
const tag = `deploy/omnivyra-${stamp}`;

process.stdout.write(
  `── predeploy check ──\n` +
  `branch:    ${branch}\n` +
  `commit:    ${sha}\n` +
  `proposed deploy tag: ${tag}\n\n`,
);

if (porcelain) {
  process.stdout.write(
    `RESULT: BLOCKED — working tree is not clean:\n${porcelain}\n\n` +
    `Commit or stash before deploying so the deployed code maps to a SHA.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `RESULT: OK — clean tree at ${shortSha}.\n\n` +
  `Manual deploy is your action (not automated here). AFTER a verified\n` +
  `successful 'vercel --prod' deploy of omnivyra, record traceability:\n\n` +
  `  git tag -a ${tag} ${shortSha} -m "omnivyra prod deploy ${stamp}"\n` +
  `  git push origin ${tag}\n\n` +
  `Then confirm: vercel inspect <deployment-url>  ==  ${shortSha}\n`,
);
process.exit(0);
