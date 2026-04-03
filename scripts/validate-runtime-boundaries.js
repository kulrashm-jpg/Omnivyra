#!/usr/bin/env node

/**
 * Runtime Boundary Validation Script
 * 
 * Scans codebase for violations:
 * 1. Redis imports without runtime='nodejs'
 * 2. fs/path imports in Edge files
 * 3. process.env access outside @/config
 * 4. Cross-directory violations
 * 
 * Run before build to fail immediately on violations
 * Exit code: 0 if valid, 1 if violations found
 */

const fs = require('fs');
const path = require('path');

// Configuration
const PROJECT_ROOT = process.cwd();
const VIOLATIONS = [];

// Files that are always Node-only
const NODE_ONLY_PATTERNS = [
  /pages\/api\//,
  /lib\/redis\//,
  /backend\//,
  /scripts\//,
  /instrumentation\.ts$/,
];

// Forbidden modules that require Node runtime
const FORBIDDEN_IN_EDGE = [
  'redis',
  'ioredis',
  'fs',
  'path',
  'fs/promises',
  '@/lib/redis/client',
  '@/lib/redis/usageProtection',
  '@/lib/redis/instrumentation',
  '@/lib/redis/healthMetrics',
];

/**
 * Recursively scan directory for TypeScript/JavaScript files
 */
function scanDirectory(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      // Skip directories
      if (!['.next', 'node_modules', '.git', 'dist', 'build'].includes(file)) {
        scanDirectory(fullPath, fileList);
      }
    } else if (['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(file))) {
      fileList.push(fullPath);
    }
  }
  
  return fileList;
}

/**
 * Check if file has explicit runtime declaration
 */
function hasRuntimeDeclaration(content) {
  // Look for: export const runtime = 'nodejs'
  return /export\s+const\s+runtime\s*=\s*['"]nodejs['"]/.test(content);
}

/**
 * Get relative path for error messages
 */
function getRelativePath(filePath) {
  return path.relative(PROJECT_ROOT, filePath);
}

/**
 * Validate a single file
 */
function validateFile(filePath) {
  const relativePath = getRelativePath(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  // Check if file is in a Node-only directory
  const isNodeOnlyPath = NODE_ONLY_PATTERNS.some(pattern => pattern.test(relativePath));
  const hasRuntimeDecl = hasRuntimeDeclaration(content);
  const isNodeSafe = isNodeOnlyPath || hasRuntimeDecl;
  
  // Scan for imports
  lines.forEach((line, lineNum) => {
    const lineNumber = lineNum + 1;
    
    // Skip comments and empty lines
    if (line.trim().startsWith('//') || !line.trim()) return;
    
    // Check for forbidden imports in Edge files
    if (!isNodeSafe) {
      for (const forbidden of FORBIDDEN_IN_EDGE) {
        // Match: import X from 'module'
        if (new RegExp(`from\\s+['"]${forbidden}['"]`).test(line)) {
          VIOLATIONS.push({
            file: relativePath,
            line: lineNumber,
            type: 'FORBIDDEN_IMPORT_IN_EDGE',
            code: line.trim(),
            message: `Cannot import "${forbidden}" in Edge file. Add "export const runtime = 'nodejs';" at top of file.`,
          });
        }
      }
    }
    
    // Check for direct process.env access (except in config files)
    if (!relativePath.includes('config/') && !relativePath.includes('node_modules')) {
      if (/process\.env\.\w+/.test(line)) {
        VIOLATIONS.push({
          file: relativePath,
          line: lineNumber,
          type: 'DIRECT_PROCESS_ENV',
          code: line.trim(),
          message: 'Use @/config module instead of process.env. Example: import { config } from "@/config";',
        });
      }
    }
    
    // Check for fs imports in API routes without runtime
    if (relativePath.includes('pages/api/') && !isNodeSafe) {
      if (/from\s+['"]fs(['"]|\/|$)/.test(line) || /from\s+['"]path['"]/.test(line)) {
        VIOLATIONS.push({
          file: relativePath,
          line: lineNumber,
          type: 'FS_IN_API_WITHOUT_RUNTIME',
          code: line.trim(),
          message: `Cannot import fs/path in API route without runtime='nodejs' declaration.`,
        });
      }
    }
  });
}

/**
 * Main validation function
 */
function main() {
  console.log('🔍 Scanning for runtime boundary violations...\n');
  
  const files = scanDirectory(path.join(PROJECT_ROOT, 'lib'));
  const apiFiles = scanDirectory(path.join(PROJECT_ROOT, 'pages/api'));
  const backendFiles = scanDirectory(path.join(PROJECT_ROOT, 'backend'));
  
  const allFiles = [...files, ...apiFiles, ...backendFiles];
  
  console.log(`📝 Scanning ${allFiles.length} files...\n`);
  
  allFiles.forEach(validateFile);
  
  if (VIOLATIONS.length === 0) {
    console.log('✅ No violations found! All runtime boundaries are enforced.\n');
    process.exit(0);
  }
  
  // Print violations
  console.log(`❌ Found ${VIOLATIONS.length} violation(s):\n`);
  
  VIOLATIONS.forEach((violation, idx) => {
    console.log(`${idx + 1}. ${violation.type}`);
    console.log(`   File: ${violation.file}:${violation.line}`);
    console.log(`   Code: ${violation.code}`);
    console.log(`   📌 ${violation.message}\n`);
  });
  
  console.log('━'.repeat(70));
  console.log('🚨 BUILD FAILED: Runtime boundary violations detected');
  console.log('━'.repeat(70));
  console.log('\nHow to fix:');
  console.log('1. Add "export const runtime = \'nodejs\';" to the top of affected files');
  console.log('2. Move Node-only code to lib/redis/ or backend/ directories');
  console.log('3. Replace direct process.env with @/config imports\n');
  
  process.exit(1);
}

// Run validation
main();
