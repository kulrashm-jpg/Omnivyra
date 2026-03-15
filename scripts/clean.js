#!/usr/bin/env node
/**
 * Clean .next directory with retry on EPERM (Windows lock).
 * When .next is locked, auto-stops the Next.js dev server (port 3000) and retries.
 *
 * Usage: node scripts/clean.js
 *    or: npm run clean
 */

const path = require('path');
const { execSync } = require('child_process');
const rimraf = require('rimraf');

const TARGET = path.join(process.cwd(), '.next');
const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run() {
  return new Promise((resolve, reject) => {
    rimraf(TARGET, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function killProcessOnPort(port) {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr LISTENING`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const pids = new Set();
      for (const line of out.trim().split('\n')) {
        // Windows: "TCP  0.0.0.0:3000  0.0.0.0:0  LISTENING  12345" - port after first :, PID last
        const portMatch = line.match(/(?:\d+\.\d+\.\d+\.\d+|\[::\]):(\d+)\s/);
        const pidMatch = line.match(/\s+(\d+)\s*$/);
        if (portMatch && pidMatch && parseInt(portMatch[1], 10) === port && pidMatch[1] !== '0') {
          pids.add(pidMatch[1]);
        }
      }
      for (const pid of pids) {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      }
      return pids.size > 0;
    } else {
      const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (pids) {
        execSync(`kill -9 ${pids}`, { stdio: 'ignore' });
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function killNextDevProcesses() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execSync('wmic process where "name=\'node.exe\'" get processid,commandline 2>nul', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const pids = [];
    for (const line of out.split('\n')) {
      const cmd = (line || '').toLowerCase();
      if (cmd.includes('next') && (cmd.includes('dev') || cmd.includes('.next'))) {
        const m = line.match(/(\d+)\s*$/);
        const pid = m ? m[1] : line.trim().split(/\s+/).pop();
        if (pid && /^\d+$/.test(pid)) pids.push(pid);
      }
    }
    for (const pid of [...new Set(pids)]) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } catch {}
    }
    return pids.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await run();
      return;
    } catch (err) {
      const isEperm = err.code === 'EPERM' || err.errno === -4048;
      if (isEperm && attempt < MAX_RETRIES) {
        console.warn(`[clean] .next is locked. Stopping dev server...`);
        let killed = killProcessOnPort(PORT);
        if (!killed) {
          for (const p of [3001, 3002]) {
            if (killProcessOnPort(p)) {
              killed = true;
              break;
            }
          }
        }
        if (!killed && process.platform === 'win32') {
          killed = killNextDevProcesses();
        }
        if (killed) {
          console.warn('[clean] Dev server stopped. Retrying...');
        } else {
          console.warn(`[clean] No dev server found. Retrying in ${RETRY_DELAY_MS / 1000}s (${attempt}/${MAX_RETRIES})...`);
        }
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(
          '\nCould not delete .next. Stop the dev server (Ctrl+C in its terminal), then run: npm run fresh\n'
        );
        process.exit(1);
      }
    }
  }
}

main();
