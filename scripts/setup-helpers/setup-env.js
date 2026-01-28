#!/usr/bin/env node
/**
 * Environment Setup Helper
 * Creates .env.local from .env.example with user prompts
 * 
 * Usage: node scripts/setup-helpers/setup-env.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { generateEncryptionKey } = require('./generate-encryption-key');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupEnv() {
  console.log('\n🚀 P0 IMPLEMENTATION - ENVIRONMENT SETUP\n');
  console.log('This will create/update .env.local with required configuration.\n');

  const envPath = path.join(process.cwd(), '.env.local');
  const examplePath = path.join(process.cwd(), '.env.example');
  
  // Check if .env.local already exists
  let existingEnv = {};
  if (fs.existsSync(envPath)) {
    console.log('⚠️  .env.local already exists. Current values will be preserved.\n');
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        existingEnv[match[1].trim()] = match[2].trim();
      }
    });
  }

  // Read .env.example if it exists
  let template = '';
  if (fs.existsSync(examplePath)) {
    template = fs.readFileSync(examplePath, 'utf8');
  } else {
    // Create template if .env.example doesn't exist
    template = `# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Redis
REDIS_URL=redis://localhost:6379

# Encryption
ENCRYPTION_KEY=

# Social Media API Credentials (placeholders for dev)
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=

# Development
USE_MOCK_PLATFORMS=true
CRON_INTERVAL_SECONDS=60
`;
  }

  const envVars = {};
  
  // Collect required values
  console.log('📝 Please provide the following values:\n');
  
  // Supabase
  envVars.NEXT_PUBLIC_SUPABASE_URL = existingEnv.NEXT_PUBLIC_SUPABASE_URL || 
    await question('NEXT_PUBLIC_SUPABASE_URL (your Supabase project URL): ');
  
  envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY = existingEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
    await question('NEXT_PUBLIC_SUPABASE_ANON_KEY (anon/public key): ');
  
  envVars.SUPABASE_SERVICE_ROLE_KEY = existingEnv.SUPABASE_SERVICE_ROLE_KEY || 
    await question('SUPABASE_SERVICE_ROLE_KEY (service role key - KEEP SECRET): ');
  
  // Redis
  envVars.REDIS_URL = existingEnv.REDIS_URL || 
    (await question('REDIS_URL [default: redis://localhost:6379]: ')) || 'redis://localhost:6379';
  
  // Encryption Key
  if (!existingEnv.ENCRYPTION_KEY) {
    console.log('\n🔐 Generating encryption key...');
    const { hex } = generateEncryptionKey();
    envVars.ENCRYPTION_KEY = hex;
    console.log('✅ Encryption key generated and will be added to .env.local\n');
  } else {
    envVars.ENCRYPTION_KEY = existingEnv.ENCRYPTION_KEY;
    console.log('✅ Using existing ENCRYPTION_KEY\n');
  }
  
  // Development flags
  envVars.USE_MOCK_PLATFORMS = existingEnv.USE_MOCK_PLATFORMS || 'true';
  envVars.CRON_INTERVAL_SECONDS = existingEnv.CRON_INTERVAL_SECONDS || '60';
  
  // Build .env.local content
  let envContent = `# ==========================================
# P0 IMPLEMENTATION - ENVIRONMENT CONFIG
# Generated: ${new Date().toISOString()}
# ==========================================

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=${envVars.NEXT_PUBLIC_SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${envVars.SUPABASE_SERVICE_ROLE_KEY}

# Redis Configuration
REDIS_URL=${envVars.REDIS_URL}

# Encryption (AES-256-GCM)
ENCRYPTION_KEY=${envVars.ENCRYPTION_KEY}

# Development Mode
USE_MOCK_PLATFORMS=${envVars.USE_MOCK_PLATFORMS}
CRON_INTERVAL_SECONDS=${envVars.CRON_INTERVAL_SECONDS}

# Social Media API Credentials (Optional for dev, required for production)
# LINKEDIN_CLIENT_ID=your_linkedin_client_id
# LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
# TWITTER_CLIENT_ID=your_twitter_client_id
# TWITTER_CLIENT_SECRET=your_twitter_client_secret
# FACEBOOK_CLIENT_ID=your_facebook_client_id
# FACEBOOK_CLIENT_SECRET=your_facebook_client_secret
# INSTAGRAM_CLIENT_ID=your_instagram_client_id
# INSTAGRAM_CLIENT_SECRET=your_instagram_client_secret
# YOUTUBE_CLIENT_ID=your_youtube_client_id
# YOUTUBE_CLIENT_SECRET=your_youtube_client_secret
`;

  // Write .env.local
  fs.writeFileSync(envPath, envContent);
  
  console.log('\n✅ .env.local created successfully!\n');
  console.log('📋 Next steps:');
  console.log('1. Review .env.local and verify all values');
  console.log('2. Make sure .env.local is in .gitignore');
  console.log('3. Start Redis: docker run -d -p 6379:6379 --name redis redis:7');
  console.log('4. Apply database schema: Run db-utils/safe-database-migration.sql in Supabase SQL Editor');
  console.log('5. Start worker: npm run start:worker');
  console.log('6. Start cron: npm run start:cron\n');
  
  rl.close();
}

if (require.main === module) {
  setupEnv().catch(err => {
    console.error('❌ Setup failed:', err);
    process.exit(1);
  });
}

module.exports = { setupEnv };

