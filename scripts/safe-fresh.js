#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const { assertNoActiveDevRuntime } = require('./dev-runtime-guard');

const root = process.cwd();

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  assertNoActiveDevRuntime('fresh-start');
  run(process.execPath, [path.join(root, 'scripts', 'clean.js'), '--trigger=safe-fresh']);
  run('npm', ['run', 'update:browserslist']);
  run('npm', ['run', 'dev']);
} catch (error) {
  if (error?.code !== 'ACTIVE_DEV_RUNTIME') {
    console.error(error?.message || error);
  }
  process.exit(1);
}
