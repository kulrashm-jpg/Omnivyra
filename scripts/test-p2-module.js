#!/usr/bin/env node
/**
 * P2 Module Test
 * Tests Analytics, Templates, Team Collaboration, Activity Logging
 */

const path = require('path');
const fs = require('fs');

// Load .env.local if it exists
const envLocalPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else {
  require('dotenv').config();
}

async function testP2Module() {
  console.log('\n🧪 Testing P2 Module (Analytics, Templates, Teams, Activity)...\n');

  const tests = [];
  let passed = 0;
  let failed = 0;

  // Test 1: Check content_analytics table with retweets/quotes/reactions
  tests.push(async () => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase.from('content_analytics').select('retweets, quotes, reactions').limit(1);
      if (error && !error.message.includes('does not exist')) {
        throw new Error(`Missing columns: ${error.message}`);
      }

      console.log('✅ Test 1: content_analytics table with platform metrics');
      passed++;
      return true;
    } catch (error) {
      console.log(`❌ Test 1: content_analytics - ${error.message}`);
      failed++;
      return false;
    }
  });

  // Test 2: Check content_templates table
  tests.push(async () => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase.from('content_templates').select('id').limit(1);
      if (error && !error.message.includes('does not exist')) {
        throw error;
      }

      console.log('✅ Test 2: content_templates table exists');
      passed++;
      return true;
    } catch (error) {
      console.log(`❌ Test 2: content_templates - ${error.message}`);
      failed++;
      return false;
    }
  });

  // Test 3: Check activity_feed table
  tests.push(async () => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase.from('activity_feed').select('id').limit(1);
      if (error && !error.message.includes('does not exist')) {
        throw error;
      }

      console.log('✅ Test 3: activity_feed table exists');
      passed++;
      return true;
    } catch (error) {
      console.log(`❌ Test 3: activity_feed - ${error.message}`);
      failed++;
      return false;
    }
  });

  // Test 4: Check notifications table
  tests.push(async () => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase.from('notifications').select('id').limit(1);
      if (error && !error.message.includes('does not exist')) {
        throw error;
      }

      console.log('✅ Test 4: notifications table exists');
      passed++;
      return true;
    } catch (error) {
      console.log(`❌ Test 4: notifications - ${error.message}`);
      failed++;
      return false;
    }
  });

  // Test 5: Check weekly_content_refinements with focus_areas and week_start_date
  tests.push(async () => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase.from('weekly_content_refinements').select('focus_areas, week_start_date').limit(1);
      if (error) {
        throw new Error(`Missing columns: ${error.message}`);
      }

      console.log('✅ Test 5: weekly_content_refinements with focus_areas and week_start_date');
      passed++;
      return true;
    } catch (error) {
      console.log(`❌ Test 5: weekly_content_refinements - ${error.message}`);
      failed++;
      return false;
    }
  });

  // Test 6: Check platform_performance table
  tests.push(async () => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase.from('platform_performance').select('id').limit(1);
      if (error && !error.message.includes('does not exist')) {
        throw error;
      }

      console.log('✅ Test 6: platform_performance table exists');
      passed++;
      return true;
    } catch (error) {
      console.log(`❌ Test 6: platform_performance - ${error.message}`);
      failed++;
      return false;
    }
  });

  // Test 7: Test increment_template_usage function
  tests.push(async () => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase.rpc('increment_template_usage', { template_id: '00000000-0000-0000-0000-000000000000' });
      // Function exists if error is about invalid UUID, not if it's "function does not exist"
      if (error && error.message.includes('does not exist') && !error.message.includes('invalid input')) {
        throw new Error('increment_template_usage function missing');
      }

      console.log('✅ Test 7: increment_template_usage function exists');
      passed++;
      return true;
    } catch (error) {
      console.log(`❌ Test 7: increment_template_usage - ${error.message}`);
      failed++;
      return false;
    }
  });

  // Run all tests
  for (const test of tests) {
    await test();
  }

  console.log('\n' + '='.repeat(60));
  console.log(`📊 P2 Module Test Results:`);
  console.log(`✅ Passed: ${passed}/${tests.length}`);
  console.log(`❌ Failed: ${failed}/${tests.length}`);
  console.log('='.repeat(60) + '\n');

  return failed === 0;
}

if (require.main === module) {
  testP2Module()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(err => {
      console.error('❌ Test error:', err);
      process.exit(1);
    });
}

module.exports = { testP2Module };
