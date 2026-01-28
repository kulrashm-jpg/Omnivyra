#!/usr/bin/env node
/**
 * Apply P2 Database Migrations
 * 
 * Reads and applies P2 migrations from db-utils/p2-migrations.sql
 * 
 * Usage: node scripts/apply-p2-migrations.js
 * 
 * Prerequisites:
 * - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

async function applyMigrations() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing required environment variables:');
    console.error('   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
    console.error('   SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const migrationFile = path.join(__dirname, '../db-utils/p2-migrations.sql');
  
  if (!fs.existsSync(migrationFile)) {
    console.error(`❌ Migration file not found: ${migrationFile}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationFile, 'utf8');

  console.log('\n🔄 Applying P2 database migrations...\n');

  try {
    // Split SQL by semicolons for execution
    // Note: This is a simplified approach. For production, use a proper migration tool
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    let applied = 0;
    let skipped = 0;

    for (const statement of statements) {
      try {
        // Execute each statement
        const { error } = await supabase.rpc('exec_sql', { sql_statement: statement });
        
        // If RPC doesn't exist, we'll need to use raw SQL execution
        // For now, log and skip
        if (error && error.message.includes('function exec_sql')) {
          console.warn('⚠️  Direct SQL execution not available. Please run migrations manually in Supabase SQL Editor.');
          console.warn('   File: db-utils/p2-migrations.sql');
          break;
        }

        if (error) {
          // Some errors are expected (e.g., table already exists)
          if (error.message.includes('already exists') || error.message.includes('duplicate')) {
            console.log('⏭️  Skipped (already exists)');
            skipped++;
          } else {
            console.error('❌ Error:', error.message);
          }
        } else {
          console.log('✅ Applied');
          applied++;
        }
      } catch (err) {
        console.warn('⚠️  Statement execution issue:', err.message);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`✅ Migrations complete: ${applied} applied, ${skipped} skipped`);
    console.log('\n💡 Note: Some statements may need manual execution in Supabase SQL Editor');
    console.log('   if direct SQL execution is not available.');
    console.log('   Open: db-utils/p2-migrations.sql in Supabase SQL Editor\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\n💡 Please run migrations manually in Supabase SQL Editor:');
    console.error('   1. Open Supabase Dashboard');
    console.error('   2. Go to SQL Editor');
    console.error('   3. Copy contents of: db-utils/p2-migrations.sql');
    console.error('   4. Paste and execute\n');
    process.exit(1);
  }
}

if (require.main === module) {
  // Load .env.local if exists
  const envPath = path.join(__dirname, '../.env.local');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }

  applyMigrations().catch(err => {
    console.error('❌ Failed:', err);
    process.exit(1);
  });
}

module.exports = { applyMigrations };

