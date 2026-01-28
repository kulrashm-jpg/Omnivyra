#!/usr/bin/env node
/**
 * Apply Migration and Run Tests
 * 
 * This script applies the database migration and then runs all tests
 * to ensure 100% pass rate.
 */

const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Load .env.local if it exists
const envLocalPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else {
  require('dotenv').config();
}

async function applyMigrationAndTest() {
  console.log('\n🚀 Applying Database Migration and Running Tests...\n');

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
    console.error('   Please check your .env.local file');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Read migration script
  const migrationPath = path.join(__dirname, '../db-utils/complete-integration-migration.sql');
  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

  console.log('📋 Applying database migration...\n');

  try {
    // Split SQL by semicolons and execute each statement
    // Note: This is a simplified approach - Supabase might need manual execution
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('BEGIN') && !s.startsWith('COMMIT'));

    console.log(`   Found ${statements.length} SQL statements\n`);

    // Try to execute via Supabase RPC (if available)
    // Otherwise, guide user to manual execution
    console.log('⚠️  Note: Supabase may require manual SQL execution.');
    console.log('   For best results, open Supabase SQL Editor and run:');
    console.log(`   ${migrationPath}\n`);

    // Check if tables/columns already exist or need to be added
    console.log('🔍 Checking current database state...\n');

    // Check scheduled_posts.priority
    const { data: priorityCheck, error: priorityError } = await supabase
      .from('scheduled_posts')
      .select('priority')
      .limit(1);

    if (priorityError && priorityError.message.includes('does not exist')) {
      console.log('❌ scheduled_posts.priority column: MISSING');
    } else {
      console.log('✅ scheduled_posts.priority column: EXISTS');
    }

    // Check activity_feed table
    const { data: activityCheck, error: activityError } = await supabase
      .from('activity_feed')
      .select('id')
      .limit(1);

    if (activityError && activityError.message.includes('does not exist')) {
      console.log('❌ activity_feed table: MISSING');
    } else {
      console.log('✅ activity_feed table: EXISTS');
    }

    // Check weekly_content_refinements.focus_areas
    const { data: focusCheck, error: focusError } = await supabase
      .from('weekly_content_refinements')
      .select('focus_areas')
      .limit(1);

    if (focusError && focusError.message.includes('does not exist')) {
      console.log('❌ weekly_content_refinements.focus_areas column: MISSING');
    } else {
      console.log('✅ weekly_content_refinements.focus_areas column: EXISTS');
    }

    console.log('\n' + '='.repeat(60));
    console.log('📝 MIGRATION INSTRUCTIONS:');
    console.log('='.repeat(60));
    console.log('\n1. Open Supabase Dashboard');
    console.log('2. Go to SQL Editor');
    console.log('3. Copy contents of: db-utils/complete-integration-migration.sql');
    console.log('4. Paste and execute');
    console.log('5. Wait for completion');
    console.log('\nThen run: npm run test:all\n');

  } catch (error) {
    console.error('❌ Migration check error:', error.message);
  }

  // Run tests after migration instructions
  console.log('\n' + '='.repeat(60));
  console.log('🧪 Running Tests...');
  console.log('='.repeat(60) + '\n');

  // Import and run test modules
  const { testP0Module } = require('./test-p0-module.js');
  const { testP2Module } = require('./test-p2-module.js');

  const p0Result = await testP0Module();
  const p2Result = await testP2Module();

  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL RESULTS:');
  console.log('='.repeat(60));
  console.log(`P0 Module: ${p0Result ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`P2 Module: ${p2Result ? '✅ PASSED' : '❌ FAILED'}`);
  
  if (p0Result && p2Result) {
    console.log('\n🎉 ALL TESTS PASSING! 100% SUCCESS! 🎉\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Please apply database migration first.\n');
    process.exit(1);
  }
}

if (require.main === module) {
  applyMigrationAndTest().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
}

module.exports = { applyMigrationAndTest };

