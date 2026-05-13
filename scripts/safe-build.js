#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const { assertNoActiveDevRuntime } = require('./dev-runtime-guard');

const root = process.cwd();
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  assertNoActiveDevRuntime('build');
  run(process.execPath, [path.join(root, 'scripts', 'enforce-decision-intelligence.js')]);
  run(process.execPath, [path.join(root, 'scripts', 'clean.js'), '--trigger=safe-build']);
  run(process.execPath, [nextBin, 'build', '--webpack']);
} catch (error) {
  if (error?.code !== 'ACTIVE_DEV_RUNTIME') {
    console.error(error?.message || error);
  }
  process.exit(1);
}
