#!/usr/bin/env node
/**
 * Wait for Next.js dev server to be fully ready
 * Checks for both port availability and routes-manifest.json existence
 * Usage: node scripts/wait-for-next.js [timeout_ms] [port]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const TIMEOUT_MS = parseInt(process.argv[2] || '30000', 10);
const PORT = parseInt(process.argv[3] || '3000', 10);
const POLL_INTERVAL = 500; // ms
const START_TIME = Date.now();

function isRouteManifestReady() {
  try {
    const manifestPath = path.join(process.cwd(), '.next/dev/routes-manifest.json');
    return fs.existsSync(manifestPath);
  } catch {
    return false;
  }
}

function checkServerReady() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}/api/ready`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.ok === true);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => req.abort());
  });
}

async function wait() {
  console.log(`⏳ Waiting for Next.js to be ready on port ${PORT}... (timeout: ${TIMEOUT_MS}ms)`);
  
  let lastError = null;
  while (Date.now() - START_TIME < TIMEOUT_MS) {
    try {
      const ready = await checkServerReady();
      const manifestReady = isRouteManifestReady();
      
      if (ready && manifestReady) {
        console.log(`✅ Next.js is ready! (took ${Date.now() - START_TIME}ms)`);
        process.exit(0);
      }
      
      if (manifestReady) {
        process.stdout.write('.');
      }
    } catch (err) {
      lastError = err;
    }
    
    // Wait before next check
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
  
  console.error(`\n❌ Next.js failed to be ready within ${TIMEOUT_MS}ms`);
  if (lastError) console.error('   Last error:', lastError.message);
  process.exit(1);
}

wait().catch((err) => {
  console.error('Error waiting for Next.js:', err);
  process.exit(1);
});
