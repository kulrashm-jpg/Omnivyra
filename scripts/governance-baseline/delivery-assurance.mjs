#!/usr/bin/env node
// Governance Delivery Assurance record (Release R3B).
//
// Associates a deployment with the verified Governance Runtime baseline. Runs the R3A verification engine
// and emits a machine-readable delivery-assurance record: Release ID, Release Digest, Runtime Version,
// Manifest Version, Verification Timestamp, Verification Result. Read-only; no runtime/constitution change.
//
// Usage:
//   node scripts/governance-baseline/delivery-assurance.mjs [--json] [--out <file>]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const VERSION = path.join(REPO, 'docs/governance-runtime-v1.0.0/VERSION.json');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

const version = existsSync(VERSION) ? JSON.parse(readFileSync(VERSION, 'utf8')) : {};
const verify = spawnSync('node', [path.join(HERE, 'verify-baseline.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let result = 'ERROR', driftCount = null;
try { const j = JSON.parse(verify.stdout); result = j.status; driftCount = j.driftCount; } catch { /* keep ERROR */ }

const record = {
  deliveryAssurance: 'Governance Runtime baseline association',
  releaseId: version.releaseId || null,
  releaseDigest: version.releaseDigest || null,
  runtimeVersion: version.runtimeVersion || null,
  constitutionalVersion: version.constitutionalVersion || null,
  manifestVersion: version.engineeringBaseline || version.runtimeVersion || null,
  verificationTimestamp: new Date().toISOString(),
  verificationResult: result,
  driftCount,
  deployAuthorized: result === 'VERIFIED',
};

const out = arg('--out');
if (out) writeFileSync(path.resolve(out), JSON.stringify(record, null, 2));
if (process.argv.includes('--json') || out) process.stdout.write(JSON.stringify(record, null, 2) + '\n');
else process.stdout.write(`delivery assurance: ${record.verificationResult}  release=${record.releaseId}  digest=${record.releaseDigest}  deployAuthorized=${record.deployAuthorized}\n`);
process.exit(record.deployAuthorized ? 0 : 1);
