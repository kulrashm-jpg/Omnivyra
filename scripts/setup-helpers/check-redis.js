#!/usr/bin/env node
/**
 * Redis Connection Checker
 * Verifies Redis is running and accessible
 * 
 * Usage: node scripts/setup-helpers/check-redis.js
 */

const IORedis = require('ioredis');

function parseRedisUrl(url) {
  if (url.includes('://')) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379'),
      password: parsed.password || undefined,
    };
  }
  return {
    host: 'localhost',
    port: 6379,
    password: undefined,
  };
}

async function checkRedis() {
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  const config = parseRedisUrl(REDIS_URL);
  
  console.log('\n🔍 Checking Redis Connection...\n');
  console.log(`Host: ${config.host}`);
  console.log(`Port: ${config.port}`);
  console.log(`Password: ${config.password ? '***' : 'none'}\n`);
  
  const redis = new IORedis({
    host: config.host,
    port: config.port,
    password: config.password,
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
  });
  
  try {
    // Test connection
    const pong = await redis.ping();
    console.log('✅ Redis is connected!');
    console.log(`   Response: ${pong}\n`);
    
    // Test set/get
    await redis.set('test:connection', 'ok', 'EX', 10);
    const value = await redis.get('test:connection');
    console.log('✅ Redis read/write test passed!');
    console.log(`   Test value: ${value}\n`);
    
    // Get Redis info
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    if (versionMatch) {
      console.log(`📊 Redis version: ${versionMatch[1]}\n`);
    }
    
    await redis.quit();
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ Redis is ready for BullMQ queue operations!\n');
    
  } catch (error) {
    console.error('❌ Redis connection failed!\n');
    console.error(`   Error: ${error.message}\n`);
    console.log('💡 Troubleshooting:');
    console.log('   1. Is Redis running? Check: docker ps | grep redis');
    console.log('   2. Start Redis: docker run -d -p 6379:6379 --name redis redis:7');
    console.log('   3. Check REDIS_URL in .env.local matches your Redis instance');
    console.log('   4. For Docker: Ensure port 6379 is exposed\n');
    
    await redis.quit();
    process.exit(1);
  }
}

if (require.main === module) {
  // Load .env.local if exists
  const path = require('path');
  const fs = require('fs');
  const envPath = path.join(process.cwd(), '.env.local');
  
  if (fs.existsSync(envPath)) {
    try {
      require('dotenv').config({ path: envPath });
    } catch (err) {
      // If dotenv is not installed, manually parse .env.local
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match && !match[1].startsWith('#')) {
          process.env[match[1].trim()] = match[2].trim();
        }
      });
    }
  }
  
  checkRedis().catch(err => {
    console.error('❌ Check failed:', err);
    process.exit(1);
  });
}

module.exports = { checkRedis };

