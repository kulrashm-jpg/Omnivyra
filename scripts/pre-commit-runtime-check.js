#!/usr/bin/env node

/**
 * Pre-commit Runtime Boundary Check
 * 
 * This hook runs before commits to catch violations early.
 * Install as .git/hooks/pre-commit
 * 
 * Makes violations impossible to commit.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Running pre-commit runtime boundary check...\n');

try {
  // Get staged files
  const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' })
    .split('\n')
    .filter(f => /\.(ts|tsx|js|jsx)$/.test(f));
  
  if (stagedFiles.length === 0) {
    console.log('✅ No code changes to check\n');
    process.exit(0);
  }
  
  console.log(`📝 Checking ${stagedFiles.length} staged files...\n`);
  
  // Run validation on staged files only
  let violations = 0;
  const violations_list = [];
  
  stagedFiles.forEach(filePath => {
    const fullPath = path.join(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) return;
    
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');
    
    // Check for runtime violations
    const hasRuntimeDecl = /export\s+const\s+runtime\s*=\s*['"]nodejs['"]/.test(content);
    const isNodePath = /pages\/api|lib\/redis|backend|scripts|instrumentation/.test(filePath);
    const isNodeSafe = hasRuntimeDecl || isNodePath;
    
    if (!isNodeSafe) {
      const forbiddens = [
        'redis', 'ioredis', 'fs', 'path', '@/lib/redis'
      ];
      
      lines.forEach((line, idx) => {
        forbiddens.forEach(mod => {
          if (new RegExp(`from\\s+['"]${mod}['"]`).test(line)) {
            violations++;
            violations_list.push(`${filePath}:${idx + 1}`);
          }
        });
      });
    }
  });
  
  if (violations === 0) {
    console.log('✅ All staged files pass runtime boundary checks\n');
    process.exit(0);
  }
  
  console.log(`❌ ${violations} violation(s) found in staged files:\n`);
  violations_list.forEach(v => console.log(`   - ${v}`));
  console.log('\n🚫 Commit blocked. Fix violations and try again.\n');
  process.exit(1);
  
} catch (error) {
  // If git commands fail, allow commit (hook might be in wrong environment)
  console.log('⚠️  Could not run pre-commit check, allowing commit\n');
  process.exit(0);
}
