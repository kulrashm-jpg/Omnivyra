#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const LIMIT = Number(process.env.FILE_LINE_LIMIT || 500);
const INCLUDE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.sql']);
const EXCLUDED_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tmp',
  'artifacts',
]);

function shouldSkipDir(name) {
  if (EXCLUDED_DIRS.has(name)) return true;
  return name.startsWith('tmp_');
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.length === 0) return 0;
  return content.split(/\r?\n/).length;
}

function walk(dirPath, results) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        walk(path.join(dirPath, entry.name), results);
      }
      continue;
    }

    const ext = path.extname(entry.name);
    if (!INCLUDE_EXTENSIONS.has(ext)) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(ROOT, fullPath);
    const lines = countLines(fullPath);
    if (lines > LIMIT) {
      results.push({ lines, path: relativePath });
    }
  }
}

const offenders = [];
walk(ROOT, offenders);
offenders.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));

if (offenders.length === 0) {
  console.log(`All tracked source files are within ${LIMIT} lines.`);
  process.exit(0);
}

console.log(`Found ${offenders.length} source files over ${LIMIT} lines:`);
for (const offender of offenders) {
  console.log(`${String(offender.lines).padStart(5)}  ${offender.path}`);
}

process.exit(1);
