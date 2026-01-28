#!/usr/bin/env node
/**
 * Setup Verification Script
 * Verifies that all P0 implementation requirements are met
 * 
 * Usage: node scripts/setup-helpers/verify-setup.js
 */

const fs = require('fs');
const path = require('path');

const checks = {
  envFile: {
    name: 'Environment File (.env.local)',
    check: () => {
      const envPath = path.join(process.cwd(), '.env.local');
      if (!fs.existsSync(envPath)) {
        return { pass: false, message: '.env.local not found. Run: node scripts/setup-helpers/setup-env.js' };
      }
      
      const content = fs.readFileSync(envPath, 'utf8');
      const required = [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'REDIS_URL',
        'ENCRYPTION_KEY'
      ];
      
      const missing = required.filter(key => !content.includes(key));
      if (missing.length > 0) {
        return { pass: false, message: `Missing env vars: ${missing.join(', ')}` };
      }
      
      // Check encryption key format
      const keyMatch = content.match(/ENCRYPTION_KEY=([^\n\r]+)/);
      if (keyMatch) {
        const key = keyMatch[1].trim();
        if (key.length !== 64) {
          return { pass: false, message: 'ENCRYPTION_KEY must be 64 hex characters. Generate new: node scripts/setup-helpers/generate-encryption-key.js' };
        }
      }
      
      return { pass: true, message: 'All required env vars present' };
    }
  },
  
  backendFiles: {
    name: 'Backend Files',
    check: () => {
      const requiredFiles = [
        'backend/queue/bullmqClient.ts',
        'backend/queue/worker.ts',
        'backend/queue/jobProcessors/publishProcessor.ts',
        'backend/scheduler/cron.ts',
        'backend/scheduler/schedulerService.ts',
        'backend/auth/tokenStore.ts',
        'backend/adapters/platformAdapter.ts',
        'backend/db/supabaseClient.ts',
      ];
      
      const missing = requiredFiles.filter(file => !fs.existsSync(path.join(process.cwd(), file)));
      if (missing.length > 0) {
        return { pass: false, message: `Missing files: ${missing.join(', ')}` };
      }
      
      return { pass: true, message: `All ${requiredFiles.length} required files present` };
    }
  },
  
  packageJson: {
    name: 'Package.json Scripts',
    check: () => {
      const pkgPath = path.join(process.cwd(), 'package.json');
      if (!fs.existsSync(pkgPath)) {
        return { pass: false, message: 'package.json not found' };
      }
      
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const requiredScripts = ['start:worker', 'start:cron'];
      const missing = requiredScripts.filter(script => !pkg.scripts?.[script]);
      
      if (missing.length > 0) {
        return { pass: false, message: `Missing scripts: ${missing.join(', ')}` };
      }
      
      return { pass: true, message: 'All required scripts present' };
    }
  },
  
  migrations: {
    name: 'Database Migration Script',
    check: () => {
      const migrationPath = path.join(process.cwd(), 'db-utils', 'safe-database-migration.sql');
      if (!fs.existsSync(migrationPath)) {
        return { pass: false, message: 'Migration script not found at db-utils/safe-database-migration.sql' };
      }
      
      const content = fs.readFileSync(migrationPath, 'utf8');
      const requiredTables = ['queue_jobs', 'queue_job_logs', 'scheduled_posts', 'social_accounts'];
      const missing = requiredTables.filter(table => !content.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
      
      if (missing.length > 0) {
        return { pass: false, message: `Migration missing tables: ${missing.join(', ')}` };
      }
      
      return { pass: true, message: 'Migration script contains all required tables' };
    }
  },
  
  gitignore: {
    name: '.gitignore Protection',
    check: () => {
      const gitignorePath = path.join(process.cwd(), '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        return { pass: false, message: '.gitignore not found. Create one to protect secrets.' };
      }
      
      const content = fs.readFileSync(gitignorePath, 'utf8');
      if (!content.includes('.env.local') && !content.includes('.env*')) {
        return { pass: false, message: '.env.local not in .gitignore. Add it to protect secrets.' };
      }
      
      return { pass: true, message: '.env.local is protected in .gitignore' };
    }
  }
};

async function verifySetup() {
  console.log('\n🔍 P0 IMPLEMENTATION - SETUP VERIFICATION\n');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let allPassed = true;
  const results = [];
  
  for (const [key, check] of Object.entries(checks)) {
    const result = check.check();
    results.push({ ...result, name: check.name });
    allPassed = allPassed && result.pass;
    
    const icon = result.pass ? '✅' : '❌';
    console.log(`${icon} ${check.name}`);
    console.log(`   ${result.message}\n`);
  }
  
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (allPassed) {
    console.log('✅ All checks passed! Your setup is ready.\n');
    console.log('📋 Next steps:');
    console.log('1. Start Redis: docker run -d -p 6379:6379 --name redis redis:7');
    console.log('2. Apply DB schema: Run db-utils/safe-database-migration.sql in Supabase');
    console.log('3. Start worker: npm run start:worker');
    console.log('4. Start cron: npm run start:cron');
    console.log('5. Seed test data: Run scripts/seed-demo-data.sql in Supabase\n');
  } else {
    console.log('❌ Some checks failed. Please fix the issues above before proceeding.\n');
    process.exit(1);
  }
}

if (require.main === module) {
  verifySetup().catch(err => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  });
}

module.exports = { verifySetup, checks };

