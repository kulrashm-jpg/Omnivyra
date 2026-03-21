#!/usr/bin/env node
/**
 * AUTH SYSTEM FIXES - VERIFICATION CHECKLIST
 * 
 * This document verifies that all authentication gaps have been fixed.
 * Run this to validate the fixes are in place.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const checks = [
  {
    name: 'Domain Validation Utility Exists',
    check: () => fs.existsSync('lib/auth/domainValidation.ts'),
  },
  {
    name: '/signup.tsx uses /auth/callback redirect',
    check: () => {
      const content = fs.readFileSync('pages/signup.tsx', 'utf8');
      return content.includes('emailRedirectTo: `${window.location.origin}/auth/callback`');
    },
  },
  {
    name: '/login.tsx imports domain validation',
    check: () => {
      const content = fs.readFileSync('pages/login.tsx', 'utf8');
      return content.includes('import { validateEmailDomain }');
    },
  },
  {
    name: '/login.tsx calls validateEmailDomain',
    check: () => {
      const content = fs.readFileSync('pages/login.tsx', 'utf8');
      return content.includes('validateEmailDomain(trimmed)');
    },
  },
  {
    name: '/login.tsx has checkingSession state',
    check: () => {
      const content = fs.readFileSync('pages/login.tsx', 'utf8');
      return content.includes('const [checkingSession, setCheckingSession]');
    },
  },
  {
    name: '/create-account.tsx imports domain validation',
    check: () => {
      const content = fs.readFileSync('pages/create-account.tsx', 'utf8');
      return content.includes('import { validateEmailDomain }');
    },
  },
  {
    name: '/create-account.tsx calls validateEmailDomain',
    check: () => {
      const content = fs.readFileSync('pages/create-account.tsx', 'utf8');
      return content.includes('validateEmailDomain(trimmed)');
    },
  },
  {
    name: '/create-account.tsx has checkingSession state',
    check: () => {
      const content = fs.readFileSync('pages/create-account.tsx', 'utf8');
      return content.includes('const [checkingSession, setCheckingSession]');
    },
  },
];

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  AUTHENTICATION SYSTEM FIXES - VERIFICATION CHECKLIST');
console.log('═══════════════════════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

for (const check of checks) {
  try {
    const result = check.check();
    if (result) {
      console.log(`  ✅ ${check.name}`);
      passed++;
    } else {
      console.log(`  ❌ ${check.name}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ ${check.name} (Error: ${(e as Error).message})`);
    failed++;
  }
}

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════════════\n');

if (failed === 0) {
  console.log('🎉 All authentication fixes verified!\n');
  process.exit(0);
} else {
  console.log('⚠️  Some checks failed. Please review the fixes.\n');
  process.exit(1);
}
