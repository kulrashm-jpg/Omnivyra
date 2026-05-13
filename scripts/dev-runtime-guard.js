const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = process.cwd();
const nextDir = path.join(root, '.next');
const devLockPath = path.join(nextDir, 'dev-server.lock');
const defaultDevPort = Number(process.env.PORT || 3000);

function nowIso() {
  return new Date().toISOString();
}

function normalizeCommand(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function removeFileIfExists(file) {
  try {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  } catch {}
}

function listProcessesWindows() {
  const psCommand = "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|npm|npx|cmd)\\.exe$' } | ForEach-Object { [string]::Join([char]9, @($_.ProcessId, $_.ParentProcessId, $_.Name, ($_.CommandLine -replace '`r?`n', ' '))) }";
  const ps = ['-NoProfile', '-EncodedCommand', Buffer.from(psCommand, 'utf16le').toString('base64')];
  try {
    const raw = execFileSync('powershell.exe', ps, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
      windowsHide: true,
      env: { ...process.env, DEV_RUNTIME_PROCESS_SCAN: '1' },
    }).trim();
    if (!raw) return [];
    const processes = raw
      .split(/\r?\n/)
      .map((line) => line.split('\t'))
      .filter((parts) => parts.length >= 4)
      .map(([pid, ppid, name, ...commandParts]) => ({
        pid: Number(pid),
        ppid: Number(ppid),
        name: String(name || ''),
        command: normalizeCommand(commandParts.join('\t')),
      }))
      .filter((proc) => Number.isInteger(proc.pid));
    return processes;
  } catch (err) {
    if (process.env.DEV_RUNTIME_GUARD_DEBUG) {
      console.error('[dev-runtime-debug] powershell process scan failed:', err.message);
    }
    return listProcessesWindowsWmic();
  }
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function listProcessesWindowsWmic() {
  try {
    const raw = execFileSync(process.env.ComSpec || 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      'wmic process where "name=\'node.exe\' or name=\'npm.exe\' or name=\'npx.exe\' or name=\'cmd.exe\'" get ProcessId,ParentProcessId,Name,CommandLine /FORMAT:CSV',
    ], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
      windowsHide: true,
    });
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('Node,'))
      .map(parseCsvLine)
      .filter((cells) => cells.length >= 5)
      .map(([, command, name, ppid, pid]) => ({
        pid: Number(pid),
        ppid: Number(ppid),
        name: String(name || ''),
        command: normalizeCommand(command || ''),
      }))
      .filter((proc) => Number.isInteger(proc.pid));
  } catch (err) {
    if (process.env.DEV_RUNTIME_GUARD_DEBUG) {
      console.error('[dev-runtime-debug] wmic process scan failed:', err.message);
    }
    return [];
  }
}

function listProcessesPosix() {
  try {
    const raw = execFileSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
        if (!match) return null;
        return {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          name: match[3],
          command: normalizeCommand(match[4]),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function listProcesses() {
  return process.platform === 'win32' ? listProcessesWindows() : listProcessesPosix();
}

function collectStartupChainPids(processes, pid = process.pid) {
  const byPid = new Map(processes.map((proc) => [Number(proc.pid), proc]));
  const chain = new Set([Number(pid)]);
  let current = byPid.get(Number(pid));
  while (current && Number.isInteger(Number(current.ppid)) && Number(current.ppid) > 0) {
    const parentPid = Number(current.ppid);
    if (chain.has(parentPid)) break;
    chain.add(parentPid);
    current = byPid.get(parentPid);
  }
  return chain;
}

function commandMentionsWorkspace(command) {
  const lower = command.toLowerCase();
  const rootLower = root.toLowerCase();
  const slashRoot = rootLower.replace(/\\/g, '/');
  const normalized = lower.replace(/\\/g, '/');
  return (
    lower.includes(rootLower) ||
    normalized.includes(slashRoot) ||
    normalized.includes('scripts/start-all.js') ||
    normalized.includes('node_modules/next/dist/bin/next') ||
    normalized.includes('next/dist/server/lib/start-server.js') ||
    normalized.includes('npm-cli.js run dev') ||
    normalized.includes('npm-cli.js run build') ||
    normalized.includes('webpack-dev-server') ||
    normalized.includes('turbopack')
  );
}

function classifyRuntimeProcess(proc) {
  const command = normalizeCommand(proc.command);
  const lower = command.toLowerCase().replace(/\\/g, '/');
  if (!command || !commandMentionsWorkspace(command)) return null;

  const isNextBin = lower.includes('node_modules/next/dist/bin/next') || /\bnext(\.cmd)?\b/.test(lower);
  const isNextDev = isNextBin && lower.includes(' dev');
  const isNextBuild = isNextBin && lower.includes(' build');
  const isStartAll = lower.includes('scripts/start-all.js');
  const isNpmDev = lower.includes('npm-cli.js run dev');
  const isNpmBuild = lower.includes('npm-cli.js run build');
  const isNextServer = lower.includes('next/dist/server/lib/start-server.js');
  const isWebpackDev = lower.includes('webpack-dev-server');
  const isTurbopack = lower.includes('turbopack') || lower.includes('--turbopack') || lower.includes('--turbo');

  if (isNextDev || isStartAll || isNpmDev || isNextServer || isWebpackDev || (isNextDev && isTurbopack)) {
    return {
      ...proc,
      kind: isStartAll ? 'start-all' : isNpmDev ? 'npm-dev' : isNextServer ? 'next-server' : isTurbopack ? 'next-dev-turbopack' : 'next-dev',
    };
  }
  if (isNextBuild || isNpmBuild) {
    return { ...proc, kind: 'next-build' };
  }
  return null;
}

function findActiveRuntimeProcesses(options = {}) {
  const processes = listProcesses();
  const startupChain = options.allowStartupChain
    ? collectStartupChainPids(processes)
    : new Set();
  const exclude = new Set([
    process.pid,
    ...startupChain,
    ...(options.excludePids || []),
  ].map(Number));
  return processes
    .filter((proc) => !exclude.has(Number(proc.pid)))
    .map(classifyRuntimeProcess)
    .filter(Boolean);
}

function findStartupChainRuntimeProcesses() {
  const processes = listProcesses();
  const startupChain = collectStartupChainPids(processes);
  return processes
    .filter((proc) => startupChain.has(Number(proc.pid)))
    .map(classifyRuntimeProcess)
    .filter(Boolean);
}

function findListeningPorts(ports = [defaultDevPort]) {
  const wanted = new Set(ports.map(Number).filter((port) => Number.isInteger(port) && port > 0));
  if (wanted.size === 0) return [];
  try {
    const raw = process.platform === 'win32'
      ? execFileSync('netstat', ['-ano', '-p', 'tcp'], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 5000,
          windowsHide: true,
        })
      : execFileSync('netstat', ['-anp', 'tcp'], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 5000,
        });
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\bLISTEN(?:ING)?\b/i.test(line))
      .map((line) => {
        const portMatch = line.match(/(?:\[?[a-f0-9:.]*\]?|0\.0\.0\.0|127\.0\.0\.1):(\d+)\s+/i);
        if (!portMatch) return null;
        const port = Number(portMatch[1]);
        if (!wanted.has(port)) return null;
        const pidMatch = process.platform === 'win32' ? line.match(/\s(\d+)$/) : null;
        return {
          pid: pidMatch ? Number(pidMatch[1]) : 0,
          kind: 'dev-port-listener',
          port,
          command: `tcp port ${port} is listening`,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readDevLock() {
  return readJson(devLockPath);
}

function activeLockState() {
  const lock = readDevLock();
  if (!lock) return { lock: null, active: false, stale: false };
  const active = pidAlive(lock.pid);
  return { lock, active, stale: !active };
}

function cleanupStaleDevLock() {
  const state = activeLockState();
  if (state.stale) {
    removeFileIfExists(devLockPath);
    console.log(`[dev-runtime] STALE_LOCK_RECOVERED pid=${state.lock.pid}`);
    return state.lock;
  }
  return null;
}

function formatProcess(proc) {
  return `pid=${proc.pid} kind=${proc.kind} command="${proc.command}"`;
}

function logCleanupAttempt({ trigger, allowed, force, processes, lockState }) {
  console.log('[dev-runtime-cleanup]', JSON.stringify({
    at: nowIso(),
    trigger,
    allowed,
    force,
    lock: lockState.lock
      ? {
          pid: lockState.lock.pid,
          port: lockState.lock.port,
          active: lockState.active,
          stale: lockState.stale,
          startedAt: lockState.lock.startedAt,
        }
      : null,
    activeProcesses: processes.map((p) => ({
      pid: p.pid,
      kind: p.kind,
      command: p.command,
    })),
  }));
}

function assertCleanupAllowed(options = {}) {
  const force = Boolean(options.force);
  const trigger = options.trigger || 'cleanup';
  const lockState = activeLockState();
  const activeProcesses = findActiveRuntimeProcesses({
    excludePids: options.excludePids,
    allowStartupChain: true,
  });
  const activePorts = findListeningPorts([lockState.lock?.port, defaultDevPort]);
  const lockOwnedByCaller =
    lockState.active &&
    Number(options.allowLockOwnerPid) === Number(lockState.lock.pid);
  const blocking = [
    ...activeProcesses,
    ...activePorts,
    ...(lockState.active && !lockOwnedByCaller
      ? [{ pid: lockState.lock.pid, kind: 'dev-lock', command: lockState.lock.command || 'dev-server.lock' }]
      : []),
  ];

  if (force) {
    logCleanupAttempt({ trigger, allowed: true, force, processes: [...activeProcesses, ...activePorts], lockState });
    console.warn('[dev-runtime-cleanup] FORCE MODE ENABLED. .next cleanup may corrupt a running dev server if the caller is wrong.');
    return;
  }

  if (blocking.length > 0) {
    logCleanupAttempt({ trigger, allowed: false, force, processes: [...activeProcesses, ...activePorts], lockState });
    console.error('\nRefusing to clean build artifacts while a Next.js runtime is active.\n');
    blocking.forEach((proc) => console.error(`  - ${formatProcess(proc)}`));
    console.error('\nStop the dev/build process first, or rerun with --force if you intentionally want to delete artifacts.\n');
    const err = new Error('UNSAFE_CLEANUP_BLOCKED');
    err.code = 'UNSAFE_CLEANUP_BLOCKED';
    throw err;
  }

  if (lockState.stale) removeFileIfExists(devLockPath);
  logCleanupAttempt({ trigger, allowed: true, force, processes: [...activeProcesses, ...activePorts], lockState });
}

function assertNoActiveDevRuntime(reason, options = {}) {
  cleanupStaleDevLock();

  const lockState = activeLockState();
  const startupChainProcesses = findStartupChainRuntimeProcesses()
    .filter((proc) => Number(proc.pid) !== Number(process.pid));
  if (startupChainProcesses.length > 0) {
    console.log('[dev-runtime] STARTUP_CHAIN_TRANSFER allowing bootstrap processes:');
    startupChainProcesses.forEach((proc) => console.log(`  - ${formatProcess(proc)}`));
  }
  const activeProcesses = findActiveRuntimeProcesses({
    excludePids: options.excludePids,
    allowStartupChain: true,
  })
    .filter((proc) => proc.kind !== 'next-build');
  const activePorts = findListeningPorts([lockState.lock?.port, defaultDevPort]);
  const blocking = [
    ...activeProcesses,
    ...activePorts,
    ...(lockState.active ? [{ pid: lockState.lock.pid, kind: 'dev-lock', command: lockState.lock.command || 'dev-server.lock' }] : []),
  ];

  if (blocking.length > 0) {
    console.error(`\nEXISTING_EXTERNAL_RUNTIME: Cannot ${reason} while a Next.js dev runtime is active.\n`);
    blocking.forEach((proc) => console.error(`  - ${formatProcess(proc)}`));
    console.error('\nStop the existing dev server first.\n');
    const err = new Error('ACTIVE_DEV_RUNTIME');
    err.code = 'ACTIVE_DEV_RUNTIME';
    throw err;
  }
}

function acquireDevLock(input) {
  cleanupStaleDevLock();
  assertNoActiveDevRuntime('start another dev server', { excludePids: [process.pid] });
  fs.mkdirSync(nextDir, { recursive: true });
  const lock = {
    pid: process.pid,
    supervisorPid: process.pid,
    childPid: input.childPid || null,
    port: input.port,
    mode: input.mode,
    command: input.command || process.argv.join(' '),
    startedAt: nowIso(),
    cwd: root,
    hostname: os.hostname(),
  };
  fs.writeFileSync(devLockPath, JSON.stringify(lock, null, 2), 'utf8');
  return lock;
}

function updateDevLock(patch) {
  const current = readDevLock();
  const ownsLock =
    current &&
    (Number(current.pid) === process.pid || Number(current.supervisorPid) === process.pid);
  if (!ownsLock) return null;
  const canonicalPid = patch.childPid ? Number(patch.childPid) : Number(current.pid);
  const next = {
    ...current,
    ...patch,
    pid: Number.isInteger(canonicalPid) && canonicalPid > 0 ? canonicalPid : current.pid,
    supervisorPid: current.supervisorPid || process.pid,
    updatedAt: nowIso(),
  };
  fs.writeFileSync(devLockPath, JSON.stringify(next, null, 2), 'utf8');
  if (patch.childPid) {
    console.log(`[dev-runtime] STARTUP_CHAIN_TRANSFER lock owner normalized supervisor=${process.pid} runtime=${patch.childPid}`);
  }
  return next;
}

function releaseDevLock() {
  const current = readDevLock();
  if (!current) return;
  if (
    Number(current.pid) === process.pid ||
    Number(current.supervisorPid) === process.pid ||
    !pidAlive(current.pid)
  ) {
    removeFileIfExists(devLockPath);
  }
}

function printDevStatus(lock) {
  console.log('\nDEV SERVER STATUS');
  console.log(`  pid: ${lock.pid}${lock.childPid ? ` (next child: ${lock.childPid})` : ''}`);
  console.log(`  mode: ${lock.mode}`);
  console.log('  lock acquired: yes');
  console.log('  cleanup protection active: yes');
  console.log('  watched artifact path: .next/dev');
  console.log(`  startup timestamp: ${lock.startedAt}`);
  console.log(`  port: ${lock.port}\n`);
}

module.exports = {
  devLockPath,
  pidAlive,
  readDevLock,
  cleanupStaleDevLock,
  listProcesses,
  findListeningPorts,
  findActiveRuntimeProcesses,
  assertCleanupAllowed,
  assertNoActiveDevRuntime,
  acquireDevLock,
  updateDevLock,
  releaseDevLock,
  printDevStatus,
};
