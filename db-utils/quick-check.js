#!/usr/bin/env node

/**
 * DrishiQ Quick Database Check
 * Simple utility to quickly check database schema and data
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables from parent directory
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '..', '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        process.env[key.trim()] = value;
      }
    });
  } catch (error) {
    console.error('❌ Error loading .env.local:', error.message);
    process.exit(1);
  }
}

// Load environment variables
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkTable(tableName) {
  try {
    console.log(`🔍 Checking table: ${tableName}\n`);

    // Combined query to get both count and sample data
    const { data: sample, count, error } = await supabase
      .from(tableName)
      .select('*', { count: 'exact' })
      .limit(3);

    if (error) {
      console.error('❌ Error fetching data:', error.message);
      return;
    }

    console.log(`📊 Table: ${tableName}`);
    console.log(`📈 Row count: ${count || 0}`);
    
    if (sample && sample.length > 0) {
      console.log(`\n📋 Columns found:`);
      const columns = Object.keys(sample[0]);
      columns.forEach(col => {
        console.log(`  - ${col}`);
      });

      // Check for translation columns
      const translationCols = columns.filter(col => 
        col.match(/_([a-z]{2})$/i)
      );
      
      if (translationCols.length > 0) {
        console.log(`\n🌐 Translation columns (${translationCols.length}):`);
        translationCols.forEach(col => {
          console.log(`  ${col}`);
        });
      }

      console.log('\n📝 Sample data:');
      console.log(JSON.stringify(sample[0], null, 2));
    } else {
      console.log('📝 No data found in table');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function listTables() {
  try {
    console.log('🔍 Checking accessible tables...\n');

    const commonTables = [
      'blog_posts', 'testimonials', 'users', 'profiles', 'sessions',
      'invitations', 'payments', 'subscriptions', 'media', 'categories',
      'pricing_plans', 'testimonial_translations', 'blog_translations',
      'admin_users', 'pricing_tiers', 'currency_rates', 'testimonials_translations'
    ];
    
    // Process tables in parallel for better performance
    const tablePromises = commonTables.map(async (table) => {
      try {
        const { data, count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact' })
          .limit(1);
        
        if (!error) {
          return { name: table, count: count || 0 };
        }
        return null;
      } catch (e) {
        // Table doesn't exist or no access
        return null;
      }
    });

    const results = await Promise.all(tablePromises);
    const existingTables = results.filter(result => result !== null);

    console.log(`📋 Found ${existingTables.length} accessible tables:`);
    existingTables.forEach(table => {
      console.log(`  ${table.name}: ${table.count} rows`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Main execution
async function main() {
  const tableName = process.argv[2];
  
  if (tableName) {
    await checkTable(tableName);
  } else {
    await listTables();
  }
}

main().catch(console.error);


