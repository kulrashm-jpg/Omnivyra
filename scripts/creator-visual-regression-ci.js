const { spawnSync } = require('child_process');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'jest',
    'backend/tests/unit/creatorEnterpriseRuntimeOps.test.ts',
    'backend/tests/unit/creatorRolloutClosure.test.ts',
    '--runInBand',
    '--forceExit',
  ],
  { stdio: 'inherit' },
);

process.exit(result.status || 0);
